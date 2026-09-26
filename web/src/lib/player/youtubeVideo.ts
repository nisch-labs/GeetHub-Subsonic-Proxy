/** YouTube IFrame Player wrapper — used by the player store when "Watch video"
 * is toggled on a virtual (yt-/ytm-) track.
 *
 * While video is on it is the SOLE playback engine (YouTube's own audio+video);
 * the store pauses the HTMLAudioElement and routes transport here, then hands
 * the position back to the audio element when video is toggled off.
 *
 * The IFrame API is a global (`window.YT`) loaded from youtube.com; we keep a
 * single Player instance and reuse it via load() across track changes. */

// The API is untyped here; keep the surface we use behind `any`.
let apiPromise: Promise<void> | null = null

function ensureAPI(): Promise<void> {
  const w = window as any
  if (w.YT?.Player) return Promise.resolve()
  if (apiPromise) return apiPromise
  apiPromise = new Promise<void>((resolve) => {
    const prev = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => { try { prev?.() } catch (_) {} resolve() }
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
  })
  return apiPromise
}

export interface YTVideoCallbacks {
  onEnded?: () => void
  onState?: (playing: boolean) => void
  onTime?: (current: number, duration: number) => void
  onError?: () => void
}

let ytPlayer: any = null
let pollTimer: number | null = null
let cbs: YTVideoCallbacks = {}

function startPolling() {
  if (pollTimer != null) return
  pollTimer = window.setInterval(() => {
    if (!ytPlayer?.getCurrentTime) return
    cbs.onTime?.(ytPlayer.getCurrentTime() || 0, ytPlayer.getDuration() || 0)
  }, 500)
}

function stopPolling() {
  if (pollTimer != null) { clearInterval(pollTimer); pollTimer = null }
}

export const ytVideo = {
  /** Create the player inside `container`, seeded to `start` seconds. Replaces
   * any previous iframe in the container. */
  async mount(container: HTMLElement, videoId: string, start: number,
              autoplay: boolean, callbacks: YTVideoCallbacks): Promise<void> {
    cbs = callbacks
    await ensureAPI()
    // Reuse an existing player rather than rebuilding the iframe.
    if (ytPlayer) { this.load(videoId, start, autoplay); return }
    container.innerHTML = ''
    const host = document.createElement('div')
    host.style.width = '100%'
    host.style.height = '100%'
    container.appendChild(host)
    ytPlayer = new (window as any).YT.Player(host, {
      width: '100%', height: '100%', videoId,
      playerVars: {
        playsinline: 1, controls: 1, rel: 0, modestbranding: 1, fs: 1,
        start: Math.floor(Math.max(0, start)),
      },
      events: {
        onReady: (e: any) => { if (autoplay) e.target.playVideo() },
        onStateChange: (e: any) => {
          // -1 unstarted · 0 ended · 1 playing · 2 paused · 3 buffering · 5 cued
          const s = e.data
          cbs.onState?.(s === 1)
          if (s === 0) cbs.onEnded?.()
        },
        onError: () => cbs.onError?.(),
      },
    })
    startPolling()
  },

  /** Switch the existing player to a new video. */
  load(videoId: string, start: number, autoplay: boolean): void {
    if (!ytPlayer) return
    const opts = { videoId, startSeconds: Math.floor(Math.max(0, start)) }
    if (autoplay) ytPlayer.loadVideoById(opts)
    else ytPlayer.cueVideoById(opts)
  },

  play(): void { ytPlayer?.playVideo?.() },
  pause(): void { ytPlayer?.pauseVideo?.() },
  seek(t: number): void { ytPlayer?.seekTo?.(t, true) },
  currentTime(): number { return ytPlayer?.getCurrentTime?.() ?? 0 },
  duration(): number { return ytPlayer?.getDuration?.() ?? 0 },
  isPlaying(): boolean { return ytPlayer?.getPlayerState?.() === 1 },

  destroy(): void {
    stopPolling()
    try { ytPlayer?.destroy?.() } catch (_) {}
    ytPlayer = null
    cbs = {}
  },
}
