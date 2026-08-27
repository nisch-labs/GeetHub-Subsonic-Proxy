<script lang="ts">
  import { onDestroy } from 'svelte'
  import { requireClient } from '../stores/session'
  import { player } from '../stores/player'
  import { ytSearchSource } from '../stores/searchSource'
  import type { Song } from '../subsonic/models'
  import { virtualSource, shortLabel } from '../subsonic/models'
  import Artwork from '../components/Artwork.svelte'

  const RECENTS_KEY = 'geethub.recentSearches'
  const RECENTS_MAX = 12
  const DEBOUNCE_MS = 300

  let query = $state('')
  let songs = $state<Song[]>([])
  let searching = $state(false)
  let recents = $state<string[]>(loadRecents())
  let folders = $state<string[]>([])
  let toast = $state<string | null>(null)
  let toastTimer: number | null = null
  let debounce: number | null = null

  // Menu open state per-song id (folder picker).
  let menuOpen = $state<string | null>(null)

  function loadRecents(): string[] {
    try {
      const raw = localStorage.getItem(RECENTS_KEY)
      if (raw) return JSON.parse(raw)
    } catch (_) {}
    return []
  }
  function saveRecents() {
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(recents.slice(0, RECENTS_MAX))) } catch (_) {}
  }
  function addRecent(q: string) {
    const t = q.trim()
    if (t.length < 2) return
    recents = [t, ...recents.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, RECENTS_MAX)
    saveRecents()
  }
  function clearRecents() { recents = []; saveRecents() }

  async function loadFolders() {
    try { folders = await requireClient().libraryFolders() } catch (_) { folders = [] }
  }
  loadFolders()

  // Debounced live search. Both text changes and source flips re-run.
  $effect(() => {
    const q = query.trim()
    const src = $ytSearchSource
    if (debounce != null) window.clearTimeout(debounce)
    if (q.length < 2) { songs = []; searching = false; return }
    searching = true
    debounce = window.setTimeout(async () => {
      try {
        const r = await requireClient().search(q, { songCount: 40, ytSource: src })
        songs = r.song ?? []
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
    toastTimer = window.setTimeout(() => toast = null, 2500)
  }

  async function saveSong(song: Song, folder?: string) {
    menuOpen = null
    const where = folder ? ` → ${folder}` : ''
    showToast(`Saving "${song.title}"${where}`)
    await player.saveTrack(song, folder)
  }

  function fmt(t: number): string {
    const s = Math.max(0, Math.floor(t))
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
  }

  function saveState(id: string): 'idle' | 'working' | 'done' | 'failed' {
    if ($player.savedYouTube.has(id)) return 'done'
    if ($player.downloads[id] != null) return 'working'
    if ($player.failedDownloads.has(id)) return 'failed'
    return 'idle'
  }
</script>

<div class="page">
  <header class="top">
    <div class="retro retro-xl">Search</div>
  </header>

  <div class="field">
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="10" cy="10" r="6" />
      <path d="M21 21l-6-6" />
    </svg>
    <input type="text" placeholder="Your library or YouTube" bind:value={query}
           onkeydown={(e) => { if (e.key === 'Enter') addRecent(query) }}
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
    <button class="pill" class:on={$ytSearchSource === 'youtube'} onclick={() => $ytSearchSource = 'youtube'}>
      <span class="retro retro-sm retro-medium">YouTube</span>
    </button>
    <button class="pill" class:on={$ytSearchSource === 'ytmusic'} onclick={() => $ytSearchSource = 'ytmusic'}>
      <span class="retro retro-sm retro-medium">YT Music</span>
    </button>
  </div>

  <div class="body">
    {#if !query}
      {#if recents.length === 0}
        <div class="empty retro retro-sm retro-light retro-graphite">
          Search your library — or anything on YouTube.
        </div>
      {:else}
        <div class="recents-header">
          <span class="retro retro-sm retro-bold retro-graphite">Recent</span>
          <button class="linky retro retro-sm retro-medium retro-accent" onclick={clearRecents}>Clear</button>
        </div>
        <ul class="recents">
          {#each recents as term}
            <li>
              <button class="rr" onclick={() => query = term}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 8v4l3 2M21 12a9 9 0 1 1-3-6.7L21 8V3" />
                </svg>
                <span class="retro retro-md">{term}</span>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17 7L7 17M17 17H7V7" />
                </svg>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if !searching && songs.length === 0}
      <div class="empty retro retro-sm retro-light retro-graphite">
        No results for "{query}".
      </div>
    {:else}
      <ul class="results">
        {#each songs as s, i}
          <li>
            <div class="hit">
              <button class="hit-body" onclick={() => { addRecent(query); player.play(songs, i) }}>
                <Artwork coverArt={s.coverArt} size={44} corner={5} />
                <div class="text">
                  <div class="retro title">{s.title}</div>
                  <div class="retro retro-light retro-graphite sub">{s.artist ?? ''}</div>
                </div>
              </button>
              {#if virtualSource(s.id) && saveState(s.id) === 'idle'}
                <span class="tag">{shortLabel(virtualSource(s.id)!)}</span>
              {/if}
              {#if virtualSource(s.id)}
                {@const state = saveState(s.id)}
                {#if state === 'done'}
                  <span class="save done" aria-label="Saved">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="var(--accent)"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 15-5-5 1.4-1.4L11 14.2l6.6-6.6L19 9z"/></svg>
                  </span>
                {:else if state === 'working'}
                  <span class="save ring" title="Downloading">
                    <span class="ring-inner">{$player.downloads[s.id] ?? 0}%</span>
                  </span>
                {:else if state === 'failed'}
                  <button class="save" onclick={() => saveSong(s)} aria-label="Retry download">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="#e64444"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 5h2v6h-2zm0 8h2v2h-2z"/></svg>
                  </button>
                {:else}
                  <div class="save-wrap">
                    <button class="save" aria-label="Save to library"
                            onclick={() => folders.length ? (menuOpen = menuOpen === s.id ? null : s.id) : saveSong(s)}>
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--accent)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 3v13m-5-5 5 5 5-5M4 21h16" />
                      </svg>
                    </button>
                    {#if menuOpen === s.id}
                      <div class="menu" role="none" onclick={(e) => e.stopPropagation()}>
                        <button class="mi" onclick={() => saveSong(s)}>
                          <span class="retro retro-sm">Library root</span>
                        </button>
                        {#if folders.length}
                          <div class="menu-sep"></div>
                          {#each folders as f}
                            <button class="mi" onclick={() => saveSong(s, f)}>
                              <span class="retro retro-sm">{f}</span>
                            </button>
                          {/each}
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/if}
              {:else}
                <span class="mono dur">{fmt(s.duration ?? 0)}</span>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if toast}
    <div class="toast retro retro-sm retro-medium">{toast}</div>
  {/if}
</div>

<style>
  .page { display: flex; flex-direction: column; gap: 12px; padding-top: 12px; height: 100%; overflow: hidden; position: relative; }
  .top { padding: 0 20px; }
  .top .retro-xl { color: var(--ink); }

  .field {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 16px;
    margin: 0 20px;
    background: var(--surface); border: 1px solid var(--hairline);
    border-radius: 999px;
  }
  .field > input { flex: 1; font-size: 15px; color: var(--ink); }
  .clear { display: flex; align-items: center; justify-content: center; }
  .spin {
    width: 14px; height: 14px;
    border: 2px solid var(--hairline);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .pills {
    display: flex; gap: 8px;
    padding: 0 20px;
  }
  .pill {
    padding: 6px 14px; border-radius: 999px;
    background: var(--surface); color: var(--ink);
    border: 1px solid var(--hairline);
  }
  .pill.on {
    background: var(--accent); color: white; border-color: var(--accent);
  }

  .body { flex: 1; overflow-y: auto; }

  .empty { padding: 40px 20px; text-align: center; }

  .recents-header {
    display: flex; justify-content: space-between; align-items: baseline;
    padding: 12px 20px 4px;
  }
  .linky { background: transparent; padding: 0; }
  .recents { list-style: none; margin: 0; padding: 0; }
  .recents li { border-bottom: 1px solid var(--hairline); }
  .rr {
    width: 100%; text-align: left; color: var(--ink);
    display: flex; align-items: center; gap: 12px;
    padding: 10px 20px;
  }
  .rr:hover { background: color-mix(in oklab, var(--hairline) 50%, transparent); }
  .rr > .retro-md { flex: 1; }

  .results { list-style: none; margin: 0; padding: 0; }
  .results li { border-bottom: 1px solid var(--hairline); }
  .hit {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 20px;
  }
  .hit-body {
    flex: 1; min-width: 0;
    display: flex; align-items: center; gap: 12px;
    color: var(--ink); text-align: left;
    padding: 0;
    transition: background 0.12s;
  }
  .hit-body:hover { background: color-mix(in oklab, var(--hairline) 50%, transparent); }
  .text { flex: 1; min-width: 0; }
  .title {
    font-size: 13px; font-weight: 500;
    font-family: var(--font-oswald); text-transform: uppercase; letter-spacing: 0.06em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .sub { font-size: 10px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dur, .mono { font-family: var(--font-mono); font-size: 11px; color: var(--graphite); }

  .tag {
    padding: 2px 6px;
    background: rgb(230, 33, 33);
    color: white;
    font-family: var(--font-oswald);
    font-weight: 600; font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border-radius: 4px;
  }

  .save-wrap { position: relative; }
  .save {
    width: 32px; height: 32px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%;
    color: var(--accent);
  }
  .save:hover { background: color-mix(in oklab, var(--accent) 12%, transparent); }
  .ring {
    border: 2px solid color-mix(in oklab, var(--accent) 30%, transparent);
    color: var(--accent);
  }
  .ring-inner { font-family: var(--font-mono); font-size: 9px; }

  .menu {
    position: absolute; top: calc(100% + 6px); right: 0;
    background: var(--surface); border: 1px solid var(--hairline);
    border-radius: 10px;
    min-width: 180px; padding: 4px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
    z-index: 15;
    display: flex; flex-direction: column;
  }
  .mi {
    padding: 8px 12px;
    text-align: left; color: var(--ink);
    border-radius: 6px;
  }
  .mi:hover { background: color-mix(in oklab, var(--hairline) 60%, transparent); }
  .menu-sep { height: 1px; background: var(--hairline); margin: 2px 6px; }

  .toast {
    position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: var(--ink); color: var(--paper);
    padding: 10px 16px; border-radius: 999px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    animation: rise 0.2s ease-out;
  }
  @keyframes rise { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translate(-50%, 0); } }
</style>
