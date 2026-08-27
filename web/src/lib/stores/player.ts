/** Player store — mirrors GeetHubKit's PlayerEngine + PlaybackQueue combined.
 *
 * One shared HTMLAudioElement drives playback. State (queue, current, isPlaying,
 * time, favorites, downloads) lives in a Svelte writable so components can
 * subscribe reactively. Media Session API is wired in wireMediaSession() so
 * browser lock-screen / media keys reach us. */
import { writable, get, type Readable } from 'svelte/store'
import { session } from './session'
import type { Song, DownloadStatus, Device, DeviceSong } from '../subsonic/models'

export type RepeatMode = 'off' | 'all' | 'one'

interface PlayerState {
  queue: Song[]
  index: number            // position within `queue`
  shuffleOrder: number[] | null  // when shuffled, a permutation of indices into `queue`
  isShuffled: boolean
  repeatMode: RepeatMode
  isPlaying: boolean
  currentTime: number
  duration: number
  // Local favorite overrides (optimistic) — song.id → true|false.
  favoriteOverride: Record<string, boolean>
  // Recently played (persisted to localStorage, capped at 10).
  recentlyPlayed: Song[]
  // Save-to-library progress by yt/ytm id.
  savedYouTube: Set<string>
  downloads: Record<string, number>   // id → percent 0-99 while in flight
  failedDownloads: Set<string>
  // Per-app volume 0..1 (doesn't touch OS volume).
  volume: number
  // Multi-device
  deviceId: string
  devices: Device[]
}

const RECENTS_KEY = 'geethub.recentlyPlayed'
const RECENTS_MAX = 10
const DEVICE_ID_KEY = 'geethub.deviceId'
const VOLUME_KEY = 'geethub.volume'

function loadVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY)
    if (raw != null) {
      const v = parseFloat(raw)
      if (isFinite(v)) return Math.min(1, Math.max(0, v))
    }
  } catch (_) {}
  return 1
}

function loadDeviceId(): string {
  try {
    const v = localStorage.getItem(DEVICE_ID_KEY)
    if (v) return v
  } catch (_) {}
  const fresh = crypto.randomUUID()
  try { localStorage.setItem(DEVICE_ID_KEY, fresh) } catch (_) {}
  return fresh
}

function deviceName(): string {
  // Best-effort — the browser doesn't expose an OS device name, so we
  // synthesise one from browser + platform hints.
  const ua = navigator.userAgent
  const isMac = /Mac/.test(navigator.platform)
  const isWin = /Win/.test(navigator.platform)
  const isLinux = /Linux/.test(navigator.platform)
  const browser = /Firefox/.test(ua) ? 'Firefox'
                : /Edg/.test(ua)     ? 'Edge'
                : /Chrome/.test(ua)  ? 'Chrome'
                : /Safari/.test(ua)  ? 'Safari' : 'Browser'
  const os = isMac ? 'Mac' : isWin ? 'PC' : isLinux ? 'Linux' : 'Web'
  return `${os} · ${browser}`
}

// One shared audio element — created lazily on first play() call (browsers
// only allow createInstance on user interaction anyway).
let audio: HTMLAudioElement | null = null
let pollTimer: number | null = null

function loadRecents(): Song[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    if (raw) return JSON.parse(raw) as Song[]
  } catch (_) {}
  return []
}

function saveRecents(list: Song[]) {
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX))) } catch (_) {}
}

const initial: PlayerState = {
  queue: [], index: 0, shuffleOrder: null, isShuffled: false, repeatMode: 'off',
  isPlaying: false, currentTime: 0, duration: 0,
  favoriteOverride: {}, recentlyPlayed: loadRecents(),
  savedYouTube: new Set(), downloads: {}, failedDownloads: new Set(),
  volume: loadVolume(),
  deviceId: loadDeviceId(), devices: [],
}

const store = writable<PlayerState>(initial)

// ─── Internal helpers ───────────────────────────────────────────

function currentSong(s: PlayerState): Song | undefined {
  if (s.queue.length === 0) return undefined
  const realIdx = s.isShuffled && s.shuffleOrder ? s.shuffleOrder[s.index] : s.index
  return s.queue[realIdx]
}

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio
  audio = new Audio()
  audio.preload = 'metadata'
  audio.crossOrigin = 'anonymous'
  audio.volume = get(store).volume
  audio.addEventListener('play',  () => store.update((s) => ({ ...s, isPlaying: true })))
  audio.addEventListener('pause', () => store.update((s) => ({ ...s, isPlaying: false })))
  audio.addEventListener('ended', () => next())
  audio.addEventListener('loadedmetadata', () => {
    store.update((s) => ({ ...s, duration: audio!.duration || 0 }))
  })
  if (pollTimer == null) {
    pollTimer = window.setInterval(() => {
      if (audio && !audio.paused) {
        store.update((s) => ({ ...s, currentTime: audio!.currentTime }))
      }
    }, 500)
  }
  return audio
}

function startCurrent(next: PlayerState) {
  const song = currentSong(next)
  if (!song) return
  const client = get(session).client
  if (!client) return
  const a = ensureAudio()
  a.src = client.streamURL(song.id)
  a.currentTime = 0
  a.play().catch(() => { /* interrupted — user will retry */ })
  recordPlayed(song)
  updateMediaSession(song)
}

function recordPlayed(song: Song) {
  store.update((s) => {
    const list = [song, ...s.recentlyPlayed.filter((x) => x.id !== song.id)].slice(0, RECENTS_MAX)
    saveRecents(list)
    return { ...s, recentlyPlayed: list }
  })
}

function updateMediaSession(song: Song | undefined) {
  if (!('mediaSession' in navigator)) return
  if (!song) { navigator.mediaSession.metadata = null; return }
  const client = get(session).client
  const artworkURL = client && song.coverArt ? client.coverArtURL(song.coverArt, 512) : ''
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist ?? '',
    album: song.album ?? '',
    artwork: artworkURL ? [{ src: artworkURL, sizes: '512x512', type: 'image/jpeg' }] : undefined,
  })
}

// ─── Multi-device sync ──────────────────────────────────────

function toDeviceSong(song: Song): DeviceSong {
  return {
    id: song.id, title: song.title,
    artist: song.artist ?? null, album: song.album ?? null,
    coverArt: song.coverArt ?? null, duration: song.duration ?? null,
  }
}

async function pushHeartbeat() {
  const client = get(session).client
  if (!client) return
  const s = get(store)
  const cur = currentSong(s)
  await client.deviceHeartbeat({
    id: s.deviceId, name: deviceName(), kind: 'web',
    isPlaying: s.isPlaying,
    currentSong: cur ? toDeviceSong(cur) : null,
    position: s.currentTime, duration: s.duration,
  }).catch(() => {})
}

async function refreshDevices() {
  const client = get(session).client
  if (!client) return
  const list = await client.listDevices().catch(() => [] as Device[])
  store.update((s) => ({ ...s, devices: list }))
}

async function drainDeviceCommands() {
  const client = get(session).client
  if (!client) return
  const s = get(store)
  const cmds = await client.pollDeviceCommands(s.deviceId).catch(() => [])
  for (const cmd of cmds) {
    if (cmd.type === 'pause') {
      if (audio && !audio.paused) audio.pause()
    } else if (cmd.type === 'play' && cmd.song) {
      // Reconstruct a Song-shaped object so the existing play() path works.
      const reconstructed: Song = {
        id: cmd.song.id, title: cmd.song.title,
        artist: cmd.song.artist ?? undefined,
        album: cmd.song.album ?? undefined,
        coverArt: cmd.song.coverArt ?? undefined,
        duration: cmd.song.duration ?? undefined,
      }
      play([reconstructed], 0)
      const pos = cmd.position ?? 0
      if (pos > 0) {
        // Wait briefly for metadata to load before seeking.
        setTimeout(() => seek(pos), 400)
      }
    }
  }
}

async function transferToDevice(targetId: string) {
  const client = get(session).client
  if (!client) return
  const s = get(store)
  const cur = currentSong(s)
  if (!cur) return
  // Pause locally immediately.
  audio?.pause()
  await client.transferPlayback(targetId, s.deviceId, toDeviceSong(cur), s.currentTime)
    .catch(() => {})
  // Refresh device list soon so the target's isPlaying flips.
  setTimeout(() => { refreshDevices() }, 2000)
}

// Kick off after the session becomes connected. We call from module scope so
// it starts on module load; if no client is available yet the calls no-op
// harmlessly and try again on the next tick.
setInterval(() => { pushHeartbeat(); refreshDevices() }, 15000)
setInterval(() => { drainDeviceCommands() }, 3000)
// Also fire once immediately so the local device shows up right away.
setTimeout(() => { pushHeartbeat(); refreshDevices() }, 500)

function wireMediaSession() {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.setActionHandler('play',           () => resume())
  navigator.mediaSession.setActionHandler('pause',          () => pause())
  navigator.mediaSession.setActionHandler('nexttrack',      () => next())
  navigator.mediaSession.setActionHandler('previoustrack',  () => previous())
  navigator.mediaSession.setActionHandler('seekto', (details) => {
    if (audio && details.seekTime != null) audio.currentTime = details.seekTime
  })
}
wireMediaSession()

// ─── Public API ─────────────────────────────────────────────────

function play(songs: Song[], startAt = 0) {
  if (songs.length === 0) return
  store.update((s) => {
    const next: PlayerState = { ...s, queue: songs, index: startAt, shuffleOrder: null, isShuffled: false }
    startCurrent(next)
    return next
  })
}

function playShuffled(songs: Song[]) {
  if (songs.length === 0) return
  const order = [...songs.keys()].sort(() => Math.random() - 0.5)
  store.update((s) => {
    const next: PlayerState = { ...s, queue: songs, index: 0, shuffleOrder: order, isShuffled: true }
    startCurrent(next)
    return next
  })
}

function pause() {
  audio?.pause()
}
function resume() {
  audio?.play().catch(() => {})
}
function toggle() {
  if (!audio) return
  if (audio.paused) resume(); else pause()
}
function seek(t: number) {
  if (audio) audio.currentTime = t
  store.update((s) => ({ ...s, currentTime: t }))
}

function setVolume(v: number) {
  const clamped = Math.min(1, Math.max(0, v))
  if (audio) audio.volume = clamped
  try { localStorage.setItem(VOLUME_KEY, String(clamped)) } catch (_) {}
  store.update((s) => ({ ...s, volume: clamped }))
}

function next() {
  store.update((s) => {
    if (s.queue.length === 0) return s
    let i = s.index + 1
    if (s.repeatMode === 'one') { startCurrent(s); return s }
    if (i >= s.queue.length) {
      if (s.repeatMode === 'all') i = 0
      else { pause(); return s }
    }
    const nx: PlayerState = { ...s, index: i }
    startCurrent(nx)
    return nx
  })
}

function previous() {
  // Emulate the app's behaviour: within 3s → jump to prev song; else restart.
  if (audio && audio.currentTime > 3) { audio.currentTime = 0; return }
  store.update((s) => {
    if (s.queue.length === 0) return s
    const i = s.index === 0
      ? (s.repeatMode === 'all' ? s.queue.length - 1 : 0)
      : s.index - 1
    const nx: PlayerState = { ...s, index: i }
    startCurrent(nx)
    return nx
  })
}

/** Jump to a specific position in the current queue (used by the queue list). */
function jumpTo(index: number) {
  store.update((s) => {
    if (index < 0 || index >= s.queue.length) return s
    const nx: PlayerState = { ...s, index }
    startCurrent(nx)
    return nx
  })
}

function toggleShuffle() {
  store.update((s) => {
    if (s.isShuffled) return { ...s, isShuffled: false, shuffleOrder: null }
    const order = [...s.queue.keys()].sort(() => Math.random() - 0.5)
    // Put the current song at position 0 so playback doesn't jump.
    const cur = order.indexOf(s.index)
    if (cur > 0) { [order[0], order[cur]] = [order[cur], order[0]] }
    return { ...s, isShuffled: true, shuffleOrder: order, index: 0 }
  })
}

function cycleRepeat() {
  store.update((s) => ({
    ...s,
    repeatMode: s.repeatMode === 'off' ? 'all' : s.repeatMode === 'all' ? 'one' : 'off',
  }))
}

// Favorites — optimistic; server star/unstar in the background.
function isFavorite(song: Song): boolean {
  const s = get(store)
  const override = s.favoriteOverride[song.id]
  return override ?? !!song.starred
}
async function toggleFavorite() {
  const s = get(store)
  const song = currentSong(s)
  if (!song) return
  const nowFav = !isFavorite(song)
  store.update((st) => ({ ...st, favoriteOverride: { ...st.favoriteOverride, [song.id]: nowFav } }))
  const client = get(session).client
  if (!client) return
  try { nowFav ? await client.star(song.id) : await client.unstar(song.id) } catch (_) {}
}

// Save-to-library flow (virtual yt-/ytm- tracks only).
async function saveCurrentToLibrary() {
  const s = get(store)
  const song = currentSong(s)
  if (!song) return
  await saveTrack(song)
}

async function saveTrack(song: Song, folder?: string) {
  const client = get(session).client
  if (!client) return
  const id = song.id
  if (get(store).savedYouTube.has(id)) return
  store.update((s) => {
    s.failedDownloads.delete(id)
    s.downloads = { ...s.downloads, [id]: 0 }
    return { ...s }
  })
  try {
    const did = await client.startSave(id, folder)
    if (!did) {
      finishDownload(id, true)
      return
    }
    let errors = 0
    // Poll every 1s until done/failed or too many errors.
    while (true) {
      await new Promise((r) => setTimeout(r, 1000))
      try {
        const st: DownloadStatus = await client.downloadStatus(did)
        errors = 0
        if (st.state === 'done') { finishDownload(id, true); return }
        if (st.state === 'failed') { finishDownload(id, false); return }
        store.update((s) => ({ ...s, downloads: { ...s.downloads, [id]: Math.max(0, Math.min(99, st.percent)) } }))
      } catch (_) {
        errors += 1
        if (errors >= 5) { finishDownload(id, false); return }
      }
    }
  } catch (_) {
    finishDownload(id, false)
  }
}

function finishDownload(id: string, success: boolean) {
  store.update((s) => {
    const downloads = { ...s.downloads }
    delete downloads[id]
    if (success) s.savedYouTube.add(id)
    else s.failedDownloads.add(id)
    return { ...s, downloads }
  })
}

function markSaved(id: string) {
  store.update((s) => { s.savedYouTube.add(id); return { ...s } })
}

// ─── Exports ─────────────────────────────────────────────────────

export const player = {
  subscribe: store.subscribe,
  play, playShuffled,
  toggle, pause, resume, seek, next, previous, jumpTo,
  setVolume,
  toggleShuffle, cycleRepeat,
  toggleFavorite, isFavorite,
  saveCurrentToLibrary, saveTrack, markSaved,
  // Multi-device
  refreshDevices, transferToDevice,
}

/** Convenience selector for the currently-playing song (or undefined). */
export function currentSongOf(state: PlayerState): Song | undefined {
  return currentSong(state)
}

export const playerStore: Readable<PlayerState> = store
