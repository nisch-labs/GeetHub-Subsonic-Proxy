<script lang="ts">
  import { onMount } from 'svelte'
  import { requireClient } from '../stores/session'
  import { playlistFavs } from '../stores/playlistFavs'
  import { navigate } from '../stores/router'
  import type { Song, Album, Artist, Playlist } from '../subsonic/models'
  import { virtualSource } from '../subsonic/models'
  import Artwork from '../components/Artwork.svelte'
  import SectionHeader from '../components/SectionHeader.svelte'
  import SegmentedBar from '../components/SegmentedBar.svelte'
  import SongList from '../components/SongList.svelte'

  type Sort = 'title' | 'artist' | 'album' | 'added' | 'duration'
  const SORTS: { id: Sort; label: string }[] = [
    { id: 'title',    label: 'Name' },
    { id: 'artist',   label: 'Artist' },
    { id: 'album',    label: 'Album' },
    { id: 'added',    label: 'Recently Added' },
    { id: 'duration', label: 'Duration' },
  ]

  interface Props { initialTab?: number }
  let { initialTab = 0 }: Props = $props()

  let tab = $state<number>(initialTab)   // 0 Songs · 1 Playlists · 2 Albums · 3 Artists
  let sort = $state<Sort>('title')
  let sortOpen = $state(false)

  // Per-tab search — kept independent so switching tabs doesn't lose your
  // in-progress query. Placeholder is tab-scoped so the affordance is clear.
  let songQuery = $state('')
  let playlistQuery = $state('')
  let albumQuery = $state('')
  let artistQuery = $state('')

  let songs = $state<Song[]>([])
  let playlists = $state<Playlist[]>([])
  let albums = $state<Album[]>([])
  let artists = $state<Artist[]>([])
  let loading = $state(true)

  onMount(async () => {
    const c = requireClient()
    // Alphabetical `allSongs` truncates at 500 — freshly-added tracks past
    // that cut-off would be invisible here. Merge with a "recently added"
    // fetch that walks the newest albums to guarantee coverage.
    const [alphabet, recent, p, a, ar] = await Promise.all([
      c.allSongs(500).catch(() => [] as Song[]),
      c.recentlyAddedSongs(30).catch(() => [] as Song[]),
      c.playlists().catch(() => [] as Playlist[]),
      c.albumList('alphabeticalByName', 200).catch(() => [] as Album[]),
      c.artists().catch(() => [] as Artist[]),
    ])
    const byId = new Map<string, Song>()
    for (const s of alphabet) byId.set(s.id, s)
    // Prefer the album-walk version on collision — its metadata is fresher.
    for (const s of recent) byId.set(s.id, s)
    songs = Array.from(byId.values())
    playlists = p; albums = a; artists = ar
    loading = false
  })

  function norm(s: string | null | undefined): string {
    return (s ?? '').toLowerCase()
  }

  // Server-side song search — hits search3.view so results include tracks
  // beyond `allSongs`' alphabetical cap AND freshly-scanned downloads.
  let songSearchResults = $state<Song[]>([])
  let songSearchToken: number | null = null

  $effect(() => {
    const q = songQuery.trim()
    if (songSearchToken !== null) clearTimeout(songSearchToken)
    if (!q) { songSearchResults = []; return }
    songSearchToken = window.setTimeout(async () => {
      const c = requireClient()
      const r = await c.search(q, { artistCount: 0, albumCount: 0, songCount: 100 }).catch(() => null)
      // Strip virtuals (yt-/ytm-) — the proxy augments search3 with YouTube
      // results by default and Library search is real-tracks-only.
      songSearchResults = (r?.song ?? []).filter((s) => !virtualSource(s.id))
    }, 300)
  })

  const filteredSongs = $derived.by(() => {
    const q = songQuery.trim()
    // With a query, trust the server's results — they cover the whole library.
    if (q) return songSearchResults
    return songs
  })

  const filteredPlaylists = $derived.by(() => {
    const q = playlistQuery.trim().toLowerCase()
    if (!q) return playlists
    return playlists.filter((p) => norm(p.name).includes(q))
  })

  const filteredAlbums = $derived.by(() => {
    const q = albumQuery.trim().toLowerCase()
    if (!q) return albums
    return albums.filter((a) =>
      norm(a.name).includes(q) || norm(a.artist).includes(q))
  })

  const filteredArtists = $derived.by(() => {
    const q = artistQuery.trim().toLowerCase()
    if (!q) return artists
    return artists.filter((a) => norm(a.name).includes(q))
  })

  const sortedSongs = $derived.by(() => {
    const list = [...filteredSongs]
    switch (sort) {
      case 'title':    return list.sort((a, b) => a.title.localeCompare(b.title))
      case 'artist':   return list.sort((a, b) => (a.artist ?? '').localeCompare(b.artist ?? ''))
      case 'album':    return list.sort((a, b) => (a.album ?? '').localeCompare(b.album ?? ''))
      case 'added':    return list.sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''))
      case 'duration': return list.sort((a, b) => (a.duration ?? 0) - (b.duration ?? 0))
    }
  })

  const currentPlaceholder = $derived(
    tab === 0 ? 'Search songs' :
    tab === 1 ? 'Search playlists' :
    tab === 2 ? 'Search albums' :
                'Search artists',
  )

  const currentQuery = $derived(
    tab === 0 ? songQuery
    : tab === 1 ? playlistQuery
    : tab === 2 ? albumQuery
    : artistQuery,
  )

  function setQuery(v: string) {
    if (tab === 0) songQuery = v
    else if (tab === 1) playlistQuery = v
    else if (tab === 2) albumQuery = v
    else artistQuery = v
  }

  function clearQuery() { setQuery('') }
</script>

<div class="library">
  <header class="top">
    <span class="retro retro-xl">Library</span>
    <div class="spacer"></div>
    {#if tab === 0}
      <div class="sort" onclick={() => sortOpen = !sortOpen} role="button" tabindex="0"
           onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') sortOpen = !sortOpen }}>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18M6 12h12M10 18h4" />
        </svg>
        <span class="retro retro-sm retro-medium">{SORTS.find((s) => s.id === sort)?.label}</span>
        {#if sortOpen}
          <div class="menu" onclick={(e) => e.stopPropagation()} role="none">
            {#each SORTS as s}
              <button class="mi" class:on={sort === s.id} onclick={() => { sort = s.id; sortOpen = false }}>
                <span class="retro retro-sm">{s.label}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </header>

  <SegmentedBar options={['Songs', 'Playlists', 'Albums', 'Artists']} selected={tab}
                onselect={(i) => tab = i} />

  <div class="search-wrap">
    <div class="field">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input type="text" placeholder={currentPlaceholder} value={currentQuery}
             oninput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
             autocomplete="off" autocapitalize="none" spellcheck="false" />
      {#if currentQuery}
        <button class="clear" onclick={clearQuery} aria-label="Clear">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="var(--graphite)"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm3.5 13.5-3.5-3.5-3.5 3.5-1-1 3.5-3.5-3.5-3.5 1-1 3.5 3.5 3.5-3.5 1 1-3.5 3.5 3.5 3.5z" /></svg>
        </button>
      {/if}
    </div>
  </div>

  <div class="body">
    {#if loading}
      <div class="empty retro retro-sm retro-light retro-graphite">Loading…</div>
    {:else if tab === 0}
      {#if sortedSongs.length === 0 && songQuery}
        <div class="empty retro retro-sm retro-light retro-graphite">No songs match "{songQuery}"</div>
      {:else}
        <SongList songs={sortedSongs} />
      {/if}
    {:else if tab === 1}
      {#if filteredPlaylists.length === 0 && playlistQuery}
        <div class="empty retro retro-sm retro-light retro-graphite">No playlists match "{playlistQuery}"</div>
      {:else}
        <ul class="rows">
          {#each filteredPlaylists as p}
            {@const fav = $playlistFavs.has(p.id)}
            <li>
              <div class="row playlist-row">
                <button class="row-body" onclick={() => navigate({ name: 'playlist', id: p.id })}>
                  {#if p.coverArt}
                    <Artwork coverArt={p.coverArt} size={44} corner={5} />
                  {:else}
                    <div class="placeholder">
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                      </svg>
                    </div>
                  {/if}
                  <div class="text">
                    <div class="retro row-title">{p.name}</div>
                    {#if p.songCount != null}
                      <div class="retro retro-light retro-graphite row-sub">{p.songCount} songs</div>
                    {/if}
                  </div>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
                </button>
                <button class="fav-btn" onclick={() => playlistFavs.toggle(p.id)}
                        aria-label={fav ? 'Unfavourite playlist' : 'Favourite playlist'}>
                  <svg viewBox="0 0 24 24" width="18" height="18"
                       fill={fav ? 'var(--accent)' : 'none'}
                       stroke={fav ? 'var(--accent)' : 'var(--graphite)'}
                       stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6C19 16.5 12 21 12 21z" />
                  </svg>
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if tab === 2}
      {#if filteredAlbums.length === 0 && albumQuery}
        <div class="empty retro retro-sm retro-light retro-graphite">No albums match "{albumQuery}"</div>
      {:else}
        <div class="grid">
          {#each filteredAlbums as a}
            <button class="cell" onclick={() => navigate({ name: 'album', id: a.id })}>
              <Artwork coverArt={a.coverArt} size={150} corner={8} />
              <div class="retro cell-title">{a.name}</div>
              <div class="retro retro-light retro-graphite cell-sub">{a.artist ?? ''}</div>
            </button>
          {/each}
        </div>
      {/if}
    {:else}
      {#if filteredArtists.length === 0 && artistQuery}
        <div class="empty retro retro-sm retro-light retro-graphite">No artists match "{artistQuery}"</div>
      {:else}
        <ul class="rows">
          {#each filteredArtists as a}
            <li>
              <button class="row" onclick={() => navigate({ name: 'artist', id: a.id })}>
                <div class="artist-circle">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm-6 18a6 6 0 0 1 12 0" />
                  </svg>
                </div>
                <div class="text">
                  <div class="retro row-title">{a.name}</div>
                  {#if a.albumCount != null}
                    <div class="retro retro-light retro-graphite row-sub">{a.albumCount} albums</div>
                  {/if}
                </div>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</div>

<style>
  .library { display: flex; flex-direction: column; gap: 14px; padding-top: 12px; padding-bottom: 40px; height: 100%; overflow: hidden; }
  .top { display: flex; align-items: center; gap: 12px; padding: 0 20px; }
  .top > .retro-xl { color: var(--ink); }
  .spacer { flex: 1; }

  .sort {
    display: inline-flex; align-items: center; gap: 6px;
    color: var(--accent);
    cursor: pointer;
    position: relative;
    padding: 6px 10px;
    border-radius: 8px;
  }
  .sort:hover { background: color-mix(in oklab, var(--accent) 12%, transparent); }
  .menu {
    position: absolute; top: 100%; right: 0;
    background: var(--surface); border: 1px solid var(--hairline);
    border-radius: 10px;
    min-width: 180px; padding: 4px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
    z-index: 10;
    display: flex; flex-direction: column;
  }
  .mi {
    padding: 8px 12px;
    text-align: left; color: var(--ink);
    border-radius: 6px;
  }
  .mi:hover { background: color-mix(in oklab, var(--hairline) 60%, transparent); }
  .mi.on { color: var(--accent); }

  .search-wrap { padding: 0 20px; }
  .field {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 10px;
  }
  .field > input {
    flex: 1; font-size: 14px; color: var(--ink);
    background: transparent; border: 0; outline: 0;
    font-family: inherit;
  }
  .field > input::placeholder { color: var(--graphite); }
  .clear { display: flex; align-items: center; justify-content: center; }

  .body { flex: 1; overflow-y: auto; }

  .rows { list-style: none; margin: 0; padding: 0; }
  .rows li { border-bottom: 1px solid var(--hairline); }
  .row {
    width: 100%;
    display: flex; align-items: center; gap: 12px;
    padding: 8px 20px;
    color: var(--ink); text-align: left;
    transition: background 0.12s;
  }
  .row:hover { background: color-mix(in oklab, var(--hairline) 50%, transparent); }
  .playlist-row { padding: 0 8px 0 0; }
  .row-body {
    flex: 1; min-width: 0;
    display: flex; align-items: center; gap: 12px;
    padding: 8px 12px 8px 20px;
    color: var(--ink); text-align: left;
    background: transparent;
  }
  .row-body:hover { background: color-mix(in oklab, var(--hairline) 50%, transparent); }
  .fav-btn {
    width: 40px; height: 40px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%;
    color: var(--graphite);
    flex-shrink: 0;
  }
  .fav-btn:hover { background: color-mix(in oklab, var(--hairline) 50%, transparent); }
  .placeholder, .artist-circle {
    width: 44px; height: 44px;
    display: flex; align-items: center; justify-content: center;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 5px;
    flex-shrink: 0;
  }
  .artist-circle { border-radius: 50%; }
  .text { flex: 1; min-width: 0; }
  .row-title {
    font-size: 13px; font-weight: 500;
    font-family: var(--font-oswald); text-transform: uppercase; letter-spacing: 0.06em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .row-sub { font-size: 10px; margin-top: 2px; }

  .grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 20px;
    padding: 8px 20px 20px;
  }
  .cell {
    display: flex; flex-direction: column; gap: 6px; align-items: stretch;
    text-align: left; color: var(--ink);
  }
  .cell-title {
    font-size: 12px; font-weight: 600;
    font-family: var(--font-oswald); text-transform: uppercase; letter-spacing: 0.06em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .cell-sub {
    font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .empty { padding: 30px 20px; text-align: center; }
</style>
