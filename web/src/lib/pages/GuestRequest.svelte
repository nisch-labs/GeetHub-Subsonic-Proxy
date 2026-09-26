<script lang="ts">
  /** Public guest-request page. Mounted at /guest/<token> — bypasses the
   * usual login gate. Same visual language as Search.svelte, but:
   *  - no `session`/`client` dependency; talks to /api/guest/* directly
   *  - no library nav, dock, save-to-library affordance, or player
   *  - tap on a row ships a `replaceNowPlaying` command to the host device */
  import { onDestroy } from 'svelte'
  import type { Song } from '../subsonic/models'

  interface Props { token: string }
  let { token }: Props = $props()

  const DEBOUNCE_MS = 300

  let query = $state('')
  let songs = $state<Song[]>([])
  let searching = $state(false)
  let sessionValid = $state<boolean | null>(null)
  let ytSource = $state<'youtube' | 'ytmusic'>('ytmusic')
  let toast = $state<string | null>(null)
  let toastTimer: number | null = null
  let debounce: number | null = null
  let requesting = $state<string | null>(null)   // song id currently being submitted

  // Validate the token once on mount so a stale QR shows a clear message
  // instead of silently failing every search.
  $effect(() => {
    fetch(`/api/guest/session/${encodeURIComponent(token)}`)
      .then((r) => { sessionValid = r.ok })
      .catch(() => { sessionValid = false })
  })

  $effect(() => {
    const q = query.trim()
    const src = ytSource
    if (debounce != null) window.clearTimeout(debounce)
    if (q.length < 2) { songs = []; searching = false; return }
    searching = true
    debounce = window.setTimeout(async () => {
      try {
        const url = `/api/guest/search?token=${encodeURIComponent(token)}`
                  + `&q=${encodeURIComponent(q)}&songCount=40&ytSource=${src}`
        const r = await fetch(url)
        if (!r.ok) { songs = []; return }
        const body = await r.json()
        songs = body?.['subsonic-response']?.searchResult3?.song ?? []
      } catch (_) { songs = [] }
      finally { searching = false }
    }, DEBOUNCE_MS)
  })

  onDestroy(() => {
    if (debounce != null) window.clearTimeout(debounce)
    if (toastTimer != null) window.clearTimeout(toastTimer)
  })

  function showToast(msg: string) {
    toast = msg
    if (toastTimer != null) window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => toast = null, 2200)
  }

  async function requestPlay(song: Song) {
    if (requesting) return
    requesting = song.id
    try {
      const r = await fetch('/api/guest/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          song: {
            id: song.id, title: song.title,
            artist: song.artist ?? null, album: song.album ?? null,
            coverArt: song.coverArt ?? null, duration: song.duration ?? null,
          },
        }),
      })
      if (r.ok) {
        showToast(`Playing "${song.title}"`)
      } else if (r.status === 404) {
        showToast('Host is offline or session ended')
      } else {
        showToast('Could not send request')
      }
    } catch (_) {
      showToast('Network error')
    } finally {
      requesting = null
    }
  }

  function coverUrl(id: string, size = 88): string {
    return `/api/guest/cover?token=${encodeURIComponent(token)}&id=${encodeURIComponent(id)}&size=${size}`
  }

  function fmt(t: number): string {
    const s = Math.max(0, Math.floor(t))
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
  }
</script>

<div class="page">
  <header class="top">
    <div class="retro retro-xl">Guest Request</div>
    <div class="retro retro-sm retro-light retro-graphite">Play something on the host</div>
  </header>

  {#if sessionValid === false}
    <div class="empty retro retro-sm retro-graphite">
      This session has ended or the link is invalid. Ask the host for a fresh QR.
    </div>
  {:else}
    <div class="field">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="10" cy="10" r="6" />
        <path d="M21 21l-6-6" />
      </svg>
      <input type="text" placeholder="Search the host's library or YouTube" bind:value={query}
             autocomplete="off" autocapitalize="none" spellcheck="false" />
      {#if searching}
        <span class="spin" aria-label="Searching"></span>
      {:else if query}
        <button class="clear" onclick={() => query = ''} aria-label="Clear">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="var(--graphite)"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm3.5 13.5-3.5-3.5-3.5 3.5-1-1 3.5-3.5-3.5-3.5 1-1 3.5 3.5 3.5-3.5 1 1-3.5 3.5 3.5 3.5z" /></svg>
        </button>
      {/if}
    </div>

    <div class="pills">
      <button class="pill" class:on={ytSource === 'youtube'} onclick={() => ytSource = 'youtube'}>
        <span class="retro retro-sm retro-medium">YouTube</span>
      </button>
      <button class="pill" class:on={ytSource === 'ytmusic'} onclick={() => ytSource = 'ytmusic'}>
        <span class="retro retro-sm retro-medium">YT Music</span>
      </button>
    </div>

    <div class="body">
      {#if !query}
        <div class="empty retro retro-sm retro-light retro-graphite">
          Search the host's library — or anything on YouTube.
        </div>
      {:else if !searching && songs.length === 0}
        <div class="empty retro retro-sm retro-light retro-graphite">
          No results for "{query}".
        </div>
      {:else}
        <ul class="results">
          {#each songs as s}
            <li>
              <button class="hit" onclick={() => requestPlay(s)} disabled={requesting === s.id}>
                <div class="art" style:background-image={s.coverArt ? `url(${coverUrl(s.id)})` : ''}></div>
                <div class="text">
                  <div class="retro title">{s.title}</div>
                  <div class="retro retro-light retro-graphite sub">{s.artist ?? ''}</div>
                </div>
                {#if requesting === s.id}
                  <span class="spin" aria-label="Sending"></span>
                {:else}
                  <span class="mono dur">{fmt(s.duration ?? 0)}</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  {#if toast}
    <div class="toast retro retro-sm retro-medium">{toast}</div>
  {/if}
</div>

<style>
  .page {
    display: flex; flex-direction: column; gap: 12px;
    padding-top: 20px;
    height: 100svh; overflow: hidden;
    position: relative; max-width: 720px; margin: 0 auto;
  }
  .top { padding: 0 20px; }
  .top .retro-xl { color: var(--ink); }
  .top .retro-sm { margin-top: 4px; }

  .field {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 16px; margin: 0 20px;
    background: var(--surface); border: 1px solid var(--hairline);
    border-radius: 999px;
  }
  .field > input { flex: 1; font-size: 15px; color: var(--ink); background: transparent; border: 0; outline: 0; }
  .clear { display: flex; align-items: center; justify-content: center; background: transparent; border: 0; }
  .spin {
    width: 14px; height: 14px;
    border: 2px solid var(--hairline); border-top-color: var(--accent);
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .pills { display: flex; gap: 8px; padding: 0 20px; }
  .pill {
    padding: 6px 14px; border-radius: 999px;
    background: var(--surface); color: var(--ink);
    border: 1px solid var(--hairline);
  }
  .pill.on { background: var(--accent); color: white; border-color: var(--accent); }

  .body { flex: 1; overflow-y: auto; }
  .empty { padding: 40px 20px; text-align: center; }

  .results { list-style: none; margin: 0; padding: 0; }
  .results li { border-bottom: 1px solid var(--hairline); }
  .hit {
    width: 100%; text-align: left; color: var(--ink);
    display: flex; align-items: center; gap: 12px;
    padding: 10px 20px; background: transparent; border: 0;
  }
  .hit:hover:not(:disabled) { background: color-mix(in oklab, var(--hairline) 50%, transparent); }
  .hit:disabled { opacity: 0.6; }
  .art {
    width: 44px; height: 44px; border-radius: 5px;
    background: var(--surface); background-size: cover; background-position: center;
    border: 1px solid var(--hairline); flex-shrink: 0;
  }
  .text { flex: 1; min-width: 0; }
  .title {
    font-size: 13px; font-weight: 500;
    font-family: var(--font-oswald); text-transform: uppercase; letter-spacing: 0.06em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .sub { font-size: 10px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dur { font-family: var(--font-mono); font-size: 11px; color: var(--graphite); }

  .toast {
    position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: var(--ink); color: var(--paper);
    padding: 10px 16px; border-radius: 999px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    animation: rise 0.2s ease-out;
  }
  @keyframes rise { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translate(-50%, 0); } }
</style>
