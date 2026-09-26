/** Player store — mirrors GeetHubKit's PlayerEngine + PlaybackQueue combined.
 *
 * One shared HTMLAudioElement drives playback. State (queue, current, isPlaying,
 * time, favorites, downloads) lives in a Svelte writable so components can
 * subscribe reactively. Media Session API is wired in wireMediaSession() so
 * browser lock-screen / media keys reach us. */
import { writable, get, type Readable } from 'svelte/store'
import { session } from './session'
import type { Song, DownloadStatus, Device, DeviceSong } from '../subsonic/models'
import { youtubeVideoId } from '../subsonic/models'
import { ytVideo } from '../player/youtubeVideo'

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
  // "Watch video": for a virtual (yt-/ytm-) track, the embedded YouTube player
  // takes over from the audio element until toggled off.
  videoMode: boolean
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
  // Radio: when on, natural queue-end triggers a fetch of similar tracks
  // seeded from the currently-playing song so playback never dries up.
  radioMode: boolean
}

const RECENTS_KEY = 'geethub.recentlyPlayed'
const RECENTS_MAX = 10
const DEVICE_ID_KEY = 'geethub.deviceId'
const VOLUME_KEY = 'geethub.volume'
const RADIO_KEY = 'geethub.radioMode'
// Fetch more similar songs when fewer than this many remain after the current.
const RADIO_LOOKAHEAD = 2
// How many similar songs to ask for each top-up.
const RADIO_BATCH = 20

function loadRadio(): boolean {
  try { return localStorage.getItem(RADIO_KEY) === '1' } catch (_) { return false }
}
function saveRadio(on: boolean) {
  try { localStorage.setItem(RADIO_KEY, on ? '1' : '0') } catch (_) {}
}

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
  isPlaying: false, currentTime: 0, duration: 0, videoMode: false,
  favoriteOverride: {}, recentlyPlayed: loadRecents(),
  savedYouTube: new Set(), downloads: {}, failedDownloads: new Set(),
  volume: loadVolume(),
  deviceId: loadDeviceId(), devices: [],
  radioMode: loadRadio(),
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
  // Always prime the audio element so exiting video mode resumes the right song.
  a.src = client.streamURL(song.id)
  a.currentTime = 0
  if (next.videoMode) {
    const vid = youtubeVideoId(song.id)
    if (vid) {
      a.pause()                       // iframe stays the active engine
      ytVideo.load(vid, 0, true)
    } else {
      // Next track isn't a video source — drop back to audio.
      ytVideo.destroy()
      videoMounted = false
      next.videoMode = false
      a.play().catch(() => {})
    }
  } else {
    a.play().catch(() => { /* interrupted — user will retry */ })
  }
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

function fromDeviceSong(d: DeviceSong): Song {
  return {
    id: d.id, title: d.title,
    artist: d.artist ?? undefined,
    album: d.album ?? undefined,
    coverArt: d.coverArt ?? undefined,
    duration: d.duration ?? undefined,
  }
}

async function drainDeviceCommands() {
  const client = get(session).client
  if (!client) return
  const s = get(store)
  const cmds = await client.pollDeviceCommands(s.deviceId).catch(() => [])
  for (const cmd of cmds) {
    if (cmd.type === 'pause') {
      if (audio && !audio.paused) audio.pause()
    } else if (cmd.type === 'replaceNowPlaying' && cmd.song) {
      // Guest Request tapped a track — swap our current now-playing for it,
      // leaving the rest of the queue intact.
      replaceNowPlaying(fromDeviceSong(cmd.song))
    } else if (cmd.type === 'transferTo' && cmd.target_id) {
      // Some other device is asking us to hand playback over — do a normal
      // transfer, which ships the full queue.
      transferToDevice(cmd.target_id)
    } else if (cmd.type === 'play' && cmd.song) {
      // Newer clients ship the full up-next list so the target sees the same
      // queue the source was playing. Older clients omit it — fall back to
      // a single-song queue built from `song`.
      const songs: Song[] = (cmd.queue && cmd.queue.length > 0)
        ? cmd.queue.map(fromDeviceSong)
        : [fromDeviceSong(cmd.song)]
      const startAt = (cmd.queue && cmd.queue.length > 0)
        ? Math.min(Math.max(cmd.index ?? 0, 0), songs.length - 1)
        : 0
      play(songs, startAt)
      const pos = cmd.position ?? 0
      if (pos > 0) {
        // Wait briefly for metadata to load before seeking.
        setTimeout(() => seek(pos), 400)
      }
    }
  }
}

/// Ask the currently-playing device (holder) to transfer playback to us. The
/// holder handles the request on its next poll — ~3s round-trip on average.
async function grabFromDevice(holderId: string) {
  const client = get(session).client
  if (!client) return
  const s = get(store)
  await client.requestTransfer(holderId, s.deviceId).catch(() => {})
}

async function transferToDevice(targetId: string) {
  const client = get(session).client
  if (!client) return
  const s = get(store)
  const cur = currentSong(s)
  if (!cur) return
  // Pause locally immediately.
  audio?.pause()
  // Ship the FULL queue + index so the target restores the same up-next
  // list rather than a one-song stub. Fall back gracefully on the server
  // side if the target is an older client.
  const queue = s.queue.map(toDeviceSong)
  await client.transferPlayback(
    targetId, s.deviceId,
    toDeviceSong(cur), s.currentTime,
    queue, s.index,
  ).catch(() => {})
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

/** Swap the currently-playing slot for `song`, preserving the tail of the queue.
 *  If nothing is queued, seed the queue with just this song. */
function replaceNowPlaying(song: Song) {
  store.update((s) => {
    if (s.queue.length === 0) {
      const next: PlayerState = {
        ...s, queue: [song], index: 0,
        shuffleOrder: null, isShuffled: false,
      }
      startCurrent(next)
      return next
    }
    const realIdx = s.isShuffled && s.shuffleOrder ? s.shuffleOrder[s.index] : s.index
    const newQueue = [...s.queue]
    newQueue[realIdx] = song
    const next: PlayerState = { ...s, queue: newQueue }
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
  if (get(store).videoMode) { ytVideo.pause(); return }
  audio?.pause()
}
function resume() {
  if (get(store).videoMode) { ytVideo.play(); return }
  audio?.play().catch(() => {})
}
function toggle() {
  if (get(store).videoMode) {
    if (ytVideo.isPlaying()) ytVideo.pause(); else ytVideo.play()
    return
  }
  if (!audio) return
  if (audio.paused) resume(); else pause()
}
function seek(t: number) {
  if (get(store).videoMode) {
    ytVideo.seek(t)
    store.update((s) => ({ ...s, currentTime: t }))
    return
  }
  if (audio) audio.currentTime = t
  store.update((s) => ({ ...s, currentTime: t }))
}

// ─── Watch video (embedded YouTube) ─────────────────────────────
// The container div lives in PlayerDock; it registers via mountVideo() once
// videoMode flips on (so the element is laid out before the player attaches).
let videoMounted = false

/** Toggle "Watch video" for the current virtual track. */
function toggleVideo() {
  get(store).videoMode ? endVideo() : beginVideo()
}

function beginVideo() {
  const s = get(store)
  const song = currentSong(s)
  if (!song || !youtubeVideoId(song.id)) return
  pause()                              // stop the audio element first
  store.update((st) => ({ ...st, videoMode: true }))
}

/** Called by PlayerDock's effect once the video container is on-screen. */
function mountVideo(container: HTMLElement) {
  if (videoMounted) return
  const s = get(store)
  const song = currentSong(s)
  const vid = song ? youtubeVideoId(song.id) : null
  if (!vid) return
  videoMounted = true
  ytVideo.mount(container, vid, s.currentTime, true, {
    onEnded: () => next(),
    onState: (playing) => store.update((st) => ({ ...st, isPlaying: playing })),
    onTime: (cur, dur) => store.update((st) => ({
      ...st, currentTime: cur, duration: isFinite(dur) && dur > 0 ? dur : st.duration,
    })),
    onError: () => endVideo(),
  })
}

function endVideo() {
  if (!get(store).videoMode) return
  const t = ytVideo.currentTime()
  const wasPlaying = ytVideo.isPlaying()
  ytVideo.destroy()
  videoMounted = false
  store.update((st) => ({ ...st, videoMode: false, currentTime: t }))
  if (audio) {
    audio.currentTime = t
    if (wasPlaying) audio.play().catch(() => {})
  }
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
      else if (s.radioMode) {
        // Nothing scheduled after this — extend the queue with similar tracks
        // seeded from what's currently playing, then advance into them.
        void topUpRadio()
        pause()
        return s
      }
      else { pause(); return s }
    }
    const nx: PlayerState = { ...s, index: i }
    startCurrent(nx)
    // Pre-fetch when the tail gets thin so playback stays seamless.
    if (nx.radioMode && nx.queue.length - nx.index - 1 <= RADIO_LOOKAHEAD) {
      void topUpRadio()
    }
    return nx
  })
}

// Radio: fetch songs similar to whatever's playing right now and append them
// to the queue. Deduped against ids we already have. Best-effort — swallows
// errors so a bad request never disrupts playback.
let radioTopUpInFlight = false
async function topUpRadio() {
  if (radioTopUpInFlight) return
  const s = get(store)
  const seed = currentSong(s)
  const client = get(session).client
  if (!seed || !client) return
  radioTopUpInFlight = true
  try {
    const similar = await client.similarSongs(seed.id, RADIO_BATCH)
    if (!similar || similar.length === 0) return
    store.update((st) => {
      const have = new Set(st.queue.map((x) => x.id))
      const fresh = similar.filter((x) => x && x.id && !have.has(x.id))
      if (fresh.length === 0) return st
      const queue = [...st.queue, ...fresh]
      // If playback stopped because we ran out of tracks, resume into the
      // first freshly-added one.
      if (!st.isPlaying && st.index >= st.queue.length - 1) {
        const nx: PlayerState = { ...st, queue, index: st.queue.length }
        startCurrent(nx)
        return nx
      }
      return { ...st, queue }
    })
  } catch (_) { /* transient — try again on the next transition */ }
  finally { radioTopUpInFlight = false }
}

function toggleRadio() {
  store.update((s) => {
    const on = !s.radioMode
    saveRadio(on)
    return { ...s, radioMode: on }
  })
  // Flipping on with a nearly-empty tail should feel instant — top up now.
  const s = get(store)
  if (s.radioMode && s.queue.length - s.index - 1 <= RADIO_LOOKAHEAD) {
    void topUpRadio()
  }
}

function previous() {
  // Emulate the app's behaviour: within 3s → jump to prev song; else restart.
  if (get(store).videoMode) {
    if (ytVideo.currentTime() > 3) { ytVideo.seek(0); return }
  } else if (audio && audio.currentTime > 3) { audio.currentTime = 0; return }
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
  play, playShuffled, replaceNowPlaying,
  toggle, pause, resume, seek, next, previous, jumpTo,
  setVolume,
  toggleVideo, mountVideo, endVideo,
  toggleShuffle, cycleRepeat, toggleRadio,
  toggleFavorite, isFavorite,
  saveCurrentToLibrary, saveTrack, markSaved,
  // Multi-device
  refreshDevices, transferToDevice, grabFromDevice,
}

/// The first other device currently reporting isPlaying — used by the mini
/// player to surface "playing on iPad" when local is idle.
export function remotePlayingDeviceOf(state: PlayerState): Device | undefined {
  return state.devices.find((d) => d.id !== state.deviceId && d.isPlaying && d.currentSong)
}

/** Convenience selector for the currently-playing song (or undefined). */
export function currentSongOf(state: PlayerState): Song | undefined {
  return currentSong(state)
}

export const playerStore: Readable<PlayerState> = store
