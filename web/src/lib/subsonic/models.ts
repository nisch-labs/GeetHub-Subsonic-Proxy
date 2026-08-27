/** Wire types matching GeetHubKit/SubsonicModels.swift.
 * Kept intentionally loose (all fields optional) — Navidrome + subsonic-proxy
 * responses have slight variance and we don't want a runtime error just because
 * one endpoint omits `duration`. */

export interface Song {
  id: string
  title: string
  album?: string
  albumId?: string
  artist?: string
  artistId?: string
  duration?: number
  playCount?: number
  coverArt?: string
  suffix?: string
  contentType?: string
  size?: number
  created?: string
  starred?: string
}

export interface Album {
  id: string
  name: string
  artist?: string
  artistId?: string
  coverArt?: string
  songCount?: number
  duration?: number
  year?: number
  starred?: string
}

export interface AlbumWithSongs extends Album {
  song?: Song[]
}

export interface Artist {
  id: string
  name: string
  coverArt?: string
  albumCount?: number
}

export interface ArtistWithAlbums extends Artist {
  album?: Album[]
}

export interface Playlist {
  id: string
  name: string
  songCount?: number
  duration?: number
  owner?: string
  public?: boolean
  coverArt?: string
}

export interface PlaylistWithSongs extends Playlist {
  entry?: Song[]
}

export interface SearchResult3 {
  artist?: Artist[]
  album?: Album[]
  song?: Song[]
}

export interface Starred2 {
  artist?: Artist[]
  album?: Album[]
  song?: Song[]
}

export interface Genre {
  value: string
  songCount?: number
  albumCount?: number
}

export interface LyricLine {
  start?: number
  value: string
}

export interface DownloadStatus {
  state: 'queued' | 'sourcing' | 'downloading' | 'saving-youtube' | 'done' | 'failed'
  percent: number
  detail: string
}

/** One Antra job — a download of a Spotify/YouTube/Apple Music/etc. URL. */
export interface AntraJob {
  id: number
  url: string
  title: string | null
  source: string | null
  format: string | null
  folder: string | null
  status: string        // queued · running · done · error · failed
  created: number | null
  finished: number | null
  exit_code: number | null
  owner: string | null
  progress: number | null   // 0..99 while in-flight, null otherwise
}

export interface AntraTrack {
  index: number
  total: number
  artist: string | null
  title: string
  state: 'queued' | 'downloading' | 'done' | 'skipped' | 'failed'
}

export function isTerminalJob(status: string): boolean {
  return status === 'done' || status === 'error' || status === 'failed'
}

// ─── Multi-device sync ───────────────────────────────────────

export interface DeviceSong {
  id: string
  title: string
  artist: string | null
  album: string | null
  coverArt: string | null
  duration: number | null
}

export interface Device {
  id: string
  name: string
  kind: string          // 'iphone' | 'ipad' | 'mac' | 'web' | 'other'
  isPlaying: boolean
  currentSong: DeviceSong | null
  position: number
  duration: number
  last_seen: number
}

export interface DeviceCommand {
  type: 'play' | 'pause'
  song: DeviceSong | null
  position: number | null
}

/** Virtual-track source, encoded as an id prefix by the proxy. */
export type VirtualSource = 'youtube' | 'youtubeMusic'

export function virtualSource(id: string): VirtualSource | null {
  if (id.startsWith('ytm-')) return 'youtubeMusic'
  if (id.startsWith('yt-')) return 'youtube'
  return null
}

export function shortLabel(source: VirtualSource): string {
  return source === 'youtubeMusic' ? 'YT Music' : 'YT'
}
