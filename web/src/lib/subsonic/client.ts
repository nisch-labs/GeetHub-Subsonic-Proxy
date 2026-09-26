/** Thin, streaming-first Subsonic API client (matches GeetHubKit's SubsonicClient).
 *
 * Search is transient: no local library mirror, no persistence — pass the query
 * to the server live and render results in memory. Matches the design decision
 * in PROJECT.md. */
import { authQueryItems, type Credentials } from './credentials'
import type {
  Album, AlbumWithSongs, AntraJob, AntraTrack, Artist, ArtistWithAlbums,
  Device, DeviceCommand, DeviceSong, DownloadStatus,
  Genre, LyricLine, Playlist, PlaylistWithSongs,
  SearchResult3, Song, Starred2,
} from './models'

export class SubsonicAPIError extends Error {
  code: number
  constructor(code: number, message?: string) {
    super(message ?? `Subsonic API error (${code})`)
    this.code = code
  }
}

export class SubsonicClient {
  constructor(public creds: Credentials) {}

  // ─── URL building ─────────────────────────────────────────────

  private url(view: string, extra: Record<string, string | number | undefined> = {}): string {
    const q = authQueryItems(this.creds, extra)
    return `${this.creds.baseURL.replace(/\/$/, '')}/rest/${view}?${q.toString()}`
  }

  streamURL(id: string): string {
    return this.url('stream.view', { id })
  }
  coverArtURL(id: string, size?: number): string {
    return this.url('getCoverArt.view', { id, size })
  }

  // ─── Request helper ───────────────────────────────────────────

  private async send<T>(view: string, extra: Record<string, string | number | undefined> = {}): Promise<T> {
    const resp = await fetch(this.url(view, extra), { cache: 'no-store' })
    if (!resp.ok) throw new SubsonicAPIError(resp.status, `HTTP ${resp.status}`)
    const doc = (await resp.json())?.['subsonic-response']
    if (!doc) throw new SubsonicAPIError(-1, 'Malformed response')
    if (doc.status !== 'ok') {
      const err = doc.error ?? {}
      throw new SubsonicAPIError(err.code ?? -1, err.message ?? 'Server error')
    }
    return doc as T
  }

  // ─── Endpoints ─────────────────────────────────────────────────

  async ping(): Promise<void> {
    await this.send('ping.view')
  }

  async artists(): Promise<Artist[]> {
    const r = await this.send<any>('getArtists.view')
    const indices: Array<{ artist?: Artist[] }> = r.artists?.index ?? []
    return indices.flatMap((i) => i.artist ?? [])
  }

  async albumList(type: string = 'alphabeticalByName', size = 100, offset = 0): Promise<Album[]> {
    const r = await this.send<any>('getAlbumList2.view', { type, size, offset })
    return r.albumList2?.album ?? []
  }

  async album(id: string): Promise<AlbumWithSongs | undefined> {
    const r = await this.send<any>('getAlbum.view', { id })
    return r.album
  }

  async artist(id: string): Promise<ArtistWithAlbums | undefined> {
    const r = await this.send<any>('getArtist.view', { id })
    return r.artist
  }

  /** Live server search. Never persisted client-side. YouTube virtual tracks
   * (from subsonic-proxy) arrive here just like real songs when `ytSource`
   * is set — see the picker in Settings / Search. */
  async search(
    query: string,
    opts: { artistCount?: number; albumCount?: number; songCount?: number; ytSource?: string } = {},
  ): Promise<SearchResult3> {
    const {
      artistCount = 20, albumCount = 20, songCount = 40, ytSource,
    } = opts
    const r = await this.send<any>('search3.view', {
      query, artistCount, albumCount, songCount, ytSource,
    })
    return r.searchResult3 ?? {}
  }

  /** Every song (server-paged). Navidrome returns songs alphabetically by title
   * for empty query and honours `songCount` — a freshly-added track past that
   * cut-off is invisible here. Pair with `recentlyAddedSongs()` for guaranteed
   * coverage of new additions. */
  async allSongs(size = 500, offset = 0): Promise<Song[]> {
    const r = await this.send<any>('search3.view', {
      query: '', songCount: size, songOffset: offset,
      albumCount: 0, artistCount: 0,
    })
    return r.searchResult3?.song ?? []
  }

  /** Songs from the most recently-added `albumCount` albums, fetched in
   * parallel. Guaranteed to include new arrivals — use alongside `allSongs()`
   * to work around its alphabetical truncation. */
  async recentlyAddedSongs(albumCount = 30): Promise<Song[]> {
    const albums = await this.albumList('newest', albumCount)
    const perAlbum = await Promise.all(
      albums.map((a) => this.album(a.id).then((x) => x?.song ?? []).catch(() => [] as Song[])),
    )
    return perAlbum.flat()
  }

  async genres(): Promise<Genre[]> {
    const r = await this.send<any>('getGenres.view')
    return r.genres?.genre ?? []
  }

  async songsByGenre(genre: string, count = 100): Promise<Song[]> {
    const r = await this.send<any>('getSongsByGenre.view', { genre, count })
    return r.songsByGenre?.song ?? []
  }

  async playlists(): Promise<Playlist[]> {
    const r = await this.send<any>('getPlaylists.view')
    return r.playlists?.playlist ?? []
  }

  async playlist(id: string): Promise<PlaylistWithSongs | undefined> {
    const r = await this.send<any>('getPlaylist.view', { id })
    return r.playlist
  }

  async createPlaylist(name: string): Promise<PlaylistWithSongs | undefined> {
    const r = await this.send<any>('createPlaylist.view', { name })
    return r.playlist
  }

  async addToPlaylist(playlistId: string, songId: string): Promise<void> {
    await this.send('updatePlaylist.view', { playlistId, songIdToAdd: songId })
  }
  async removeFromPlaylist(playlistId: string, index: number): Promise<void> {
    await this.send('updatePlaylist.view', { playlistId, songIndexToRemove: index })
  }

  async scrobble(id: string, submission = true): Promise<void> {
    await this.send('scrobble.view', { id, submission: submission ? 'true' : 'false' })
  }

  async star(id: string): Promise<void> { await this.send('star.view', { id }) }
  async unstar(id: string): Promise<void> { await this.send('unstar.view', { id }) }

  async favorites(): Promise<Starred2> {
    const r = await this.send<any>('getStarred2.view')
    return r.starred2 ?? {}
  }

  async similarSongs(id: string, count = 50): Promise<Song[]> {
    const r = await this.send<any>('getSimilarSongs2.view', { id, count })
    return r.similarSongs2?.song ?? []
  }

  async randomSongs(count = 50, genre?: string): Promise<Song[]> {
    const r = await this.send<any>('getRandomSongs.view', { size: count, genre })
    return r.randomSongs?.song ?? []
  }

  async lyrics(id: string): Promise<LyricLine[]> {
    const r = await this.send<any>('getLyricsBySongId.view', { id })
    return r.lyricsList?.structuredLyrics?.[0]?.line ?? []
  }

  // ─── Save-to-Library (subsonic-proxy extension, not standard Subsonic) ───

  async libraryFolders(): Promise<string[]> {
    const resp = await fetch(`${this.creds.baseURL.replace(/\/$/, '')}/api/folders`)
    if (resp.status === 404) return []
    if (!resp.ok) throw new SubsonicAPIError(resp.status)
    const data = await resp.json()
    return data?.folders ?? []
  }

  /** Kicks off a hybrid Antra→YouTube download. Returns download_id for polling. */
  async startSave(youtubeId: string, folder?: string): Promise<string | undefined> {
    const body: Record<string, string> = { id: youtubeId }
    if (folder) body.folder = folder
    const resp = await fetch(`${this.creds.baseURL.replace(/\/$/, '')}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) throw new SubsonicAPIError(resp.status)
    const data = await resp.json()
    return data?.download_id
  }

  // ─── Downloader pass-through (Antra) ───────────────────────

  async startAntraDownload(url: string, format: string = 'mp3', folder?: string): Promise<number> {
    const body: Record<string, string> = { url, format }
    if (folder) body.folder = folder
    const resp = await fetch(`${this.creds.baseURL.replace(/\/$/, '')}/api/antra/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) throw new SubsonicAPIError(resp.status)
    const data = await resp.json()
    return data?.job_id as number
  }

  async antraJobs(): Promise<AntraJob[]> {
    const resp = await fetch(`${this.creds.baseURL.replace(/\/$/, '')}/api/antra/jobs`,
      { cache: 'no-store' })
    if (!resp.ok) throw new SubsonicAPIError(resp.status)
    return await resp.json()
  }

  async antraJobStatus(id: number): Promise<AntraJob> {
    const resp = await fetch(`${this.creds.baseURL.replace(/\/$/, '')}/api/antra/jobs/${id}`,
      { cache: 'no-store' })
    if (!resp.ok) throw new SubsonicAPIError(resp.status)
    return await resp.json()
  }

  async antraJobTracks(id: number): Promise<AntraTrack[]> {
    const resp = await fetch(`${this.creds.baseURL.replace(/\/$/, '')}/api/antra/jobs/${id}/tracks`,
      { cache: 'no-store' })
    if (!resp.ok) throw new SubsonicAPIError(resp.status)
    return await resp.json()
  }

  // ─── Multi-device sync ─────────────────────────────────────

  async deviceHeartbeat(payload: {
    id?: string; name: string; kind: string;
    isPlaying: boolean; currentSong: DeviceSong | null;
    position: number; duration: number;
  }): Promise<Device> {
    const q = `?u=${encodeURIComponent(this.creds.username)}`
    const resp = await fetch(`${this.creds.baseURL.replace(/\/$/, '')}/api/devices/heartbeat${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) throw new SubsonicAPIError(resp.status)
    return await resp.json()
  }

  async listDevices(): Promise<Device[]> {
    const q = `?u=${encodeURIComponent(this.creds.username)}`
    const resp = await fetch(`${this.creds.baseURL.replace(/\/$/, '')}/api/devices${q}`,
      { cache: 'no-store' })
    if (!resp.ok) throw new SubsonicAPIError(resp.status)
    return await resp.json()
  }

  async pollDeviceCommands(deviceId: string): Promise<DeviceCommand[]> {
    const q = `?u=${encodeURIComponent(this.creds.username)}`
    const resp = await fetch(`${this.creds.baseURL.replace(/\/$/, '')}/api/devices/${deviceId}/commands${q}`,
      { cache: 'no-store' })
    if (!resp.ok) throw new SubsonicAPIError(resp.status)
    return await resp.json()
  }

  async requestTransfer(holderId: string, targetId: string): Promise<void> {
    const q = `?u=${encodeURIComponent(this.creds.username)}`
    const resp = await fetch(`${this.creds.baseURL.replace(/\/$/, '')}/api/devices/${holderId}/request-transfer${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_id: targetId }),
    })
    if (!resp.ok) throw new SubsonicAPIError(resp.status)
  }

  async transferPlayback(
    targetId: string, sourceId: string | null,
    song: DeviceSong, position: number,
    queue?: DeviceSong[], index?: number,
  ): Promise<void> {
    const q = `?u=${encodeURIComponent(this.creds.username)}`
    const body: Record<string, unknown> = {
      source_id: sourceId, song, position,
    }
    if (queue && queue.length > 0) {
      body.queue = queue
      body.index = index ?? 0
    }
    const resp = await fetch(`${this.creds.baseURL.replace(/\/$/, '')}/api/devices/${targetId}/transfer${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) throw new SubsonicAPIError(resp.status)
  }

  // ─── Guest Request ─────────────────────────────────────────

  /** Mint a guest-session token bound to this host device. Returns the token
   *  and its absolute expiry (unix seconds). */
  async createGuestSession(hostDeviceId: string): Promise<{ token: string; expiresAt: number }> {
    const q = `?u=${encodeURIComponent(this.creds.username)}`
    const resp = await fetch(`${this.creds.baseURL.replace(/\/$/, '')}/api/guest/session${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: hostDeviceId }),
    })
    if (!resp.ok) throw new SubsonicAPIError(resp.status)
    return await resp.json()
  }

  /** End an active guest session. */
  async revokeGuestSession(token: string): Promise<void> {
    const q = `?u=${encodeURIComponent(this.creds.username)}`
    const resp = await fetch(`${this.creds.baseURL.replace(/\/$/, '')}/api/guest/session/${encodeURIComponent(token)}${q}`, {
      method: 'DELETE',
    })
    if (!resp.ok && resp.status !== 404) throw new SubsonicAPIError(resp.status)
  }

  async downloadStatus(downloadId: string): Promise<DownloadStatus> {
    const url = `${this.creds.baseURL.replace(/\/$/, '')}/api/download/status?id=${encodeURIComponent(downloadId)}`
    const resp = await fetch(url, { cache: 'no-store' })
    if (!resp.ok) throw new SubsonicAPIError(resp.status)
    return await resp.json()
  }
}
