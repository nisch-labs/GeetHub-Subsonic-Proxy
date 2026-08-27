<script lang="ts">
  import { onMount } from 'svelte'
  import { session, requireClient } from '../stores/session'
  import { player } from '../stores/player'
  import { playlistFavs } from '../stores/playlistFavs'
  import { navigate } from '../stores/router'
  import type { Song, Album, Playlist } from '../subsonic/models'
  import Artwork from '../components/Artwork.svelte'
  import SectionHeader from '../components/SectionHeader.svelte'
  import SongShelf from '../components/SongShelf.svelte'

  let recentlyAdded = $state<Song[]>([])
  let mostListened = $state<Song[]>([])
  let favourites = $state<Song[]>([])
  let allPlaylists = $state<Playlist[]>([])
  let newestAlbums = $state<Album[]>([])
  let loading = $state(true)

  const user = $derived($session.client?.creds.username ?? 'friend')
  const greeting = $derived.by(() => {
    const h = new Date().getHours()
    if (h < 5)  return 'Late night'
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    if (h < 21) return 'Good evening'
    return 'Late night'
  })

  onMount(async () => {
    try {
      const c = requireClient()
      const [all, favs, albums, pls] = await Promise.all([
        c.allSongs(500).catch(() => [] as Song[]),
        c.favorites().catch(() => ({} as any)),
        c.albumList('newest', 20).catch(() => [] as Album[]),
        c.playlists().catch(() => [] as Playlist[]),
      ])
      mostListened = all.filter((s) => (s.playCount ?? 0) > 0)
        .sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0))
      favourites = favs.song ?? []
      newestAlbums = albums
      allPlaylists = pls

      const expanded = (await Promise.all(
        newestAlbums.slice(0, 15).map((a) => c.album(a.id).catch(() => undefined)),
      )).flatMap((a) => a?.song ?? [])
      recentlyAdded = expanded.sort((x, y) => (y.created ?? '').localeCompare(x.created ?? ''))
    } finally {
      loading = false
    }
  })

  // ─── Smart Play actions ──────────────────────────────────────

  async function discover() {
    play(await requireClient().randomSongs(100))
  }
  async function rediscover() {
    if (!newestAlbums.length) return
    const pick = newestAlbums[Math.floor(Math.random() * newestAlbums.length)]
    play((await requireClient().album(pick.id))?.song ?? [])
  }
  function onRepeat() {
    play([...mostListened.slice(0, 50)].sort(() => Math.random() - 0.5))
  }
  async function deepCuts() {
    const all = await requireClient().allSongs(500)
    play(all.filter((s) => (s.playCount ?? 0) === 0).sort(() => Math.random() - 0.5).slice(0, 50))
  }
  async function favouritesMix() {
    const fresh = (await requireClient().favorites()).song ?? favourites
    play([...fresh].sort(() => Math.random() - 0.5))
  }
  async function playlistRoulette() {
    if (!allPlaylists.length) return
    const pick = allPlaylists[Math.floor(Math.random() * allPlaylists.length)]
    play((await requireClient().playlist(pick.id))?.entry ?? [])
  }

  function play(songs: Song[]) {
    if (!songs.length) return
    player.play(songs, 0)
  }

  function fmt(seconds: number): string {
    const m = Math.floor(seconds / 60), s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const tiles = [
    { title: 'Discover',   sub: 'Fresh shuffle',   icon: 'shuffle', action: discover },
    { title: 'Rediscover', sub: 'Random album',    icon: 'disc',    action: rediscover },
    { title: 'On Repeat',  sub: 'Top plays',       icon: 'flame',   action: onRepeat },
    { title: 'Deep Cuts',  sub: 'Never played',    icon: 'sparkle', action: deepCuts },
    { title: 'Favourites', sub: 'Shuffle stars',   icon: 'heart',   action: favouritesMix },
    { title: 'Roulette',   sub: 'Random playlist', icon: 'list',    action: playlistRoulette },
  ]

  function iconPath(name: string): string {
    switch (name) {
      case 'shuffle': return 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5'
      case 'disc':    return 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6z'
      case 'flame':   return 'M12 2s4 4 4 8a4 4 0 1 1-8 0c0-1.5 1-3 2-4-1 5 3 4 2 8a3 3 0 0 1-6 0c0-6 6-8 6-12z'
      case 'sparkle': return 'M12 3l1.8 4.7L18 9l-4.2 2-1.8 5-1.8-5L6 9l4.2-1.3z'
      case 'heart':   return 'M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6C19 16.5 12 21 12 21z'
      case 'list':    return 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'
      default:        return ''
    }
  }
</script>

<div class="home">
  <header class="top">
    <div>
      <div class="retro retro-sm retro-light retro-graphite">{greeting}</div>
      <div class="retro retro-xl">{user}</div>
    </div>
    <button class="round" onclick={() => navigate({ name: 'search' })} aria-label="Search">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="10" cy="10" r="6" />
        <path d="M21 21l-6-6" />
      </svg>
    </button>
  </header>

  <section class="smart">
    <SectionHeader title="Smart Play" />
    <div class="grid">
      {#each tiles as t}
        <button class="tile" onclick={t.action}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill={t.icon === 'heart' ? 'var(--accent)' : 'none'}
               stroke="var(--accent)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d={iconPath(t.icon)} />
          </svg>
          <div class="tile-text">
            <div class="retro retro-sm retro-bold">{t.title}</div>
            <div class="retro retro-sm retro-light retro-graphite" style="font-size: 8px">{t.sub}</div>
          </div>
        </button>
      {/each}
    </div>
  </section>

  {#if favourites.length}
    <section>
      <SectionHeader title="Favourites" trailing={String(favourites.length)} />
      <SongShelf songs={favourites} size={150} />
    </section>
  {/if}

  {#if allPlaylists.some((p) => $playlistFavs.has(p.id))}
    <section>
      <SectionHeader title="Favourite Playlists" />
      <div class="pl-shelf">
        {#each allPlaylists.filter((p) => $playlistFavs.has(p.id)) as p}
          <button class="pl-cell" onclick={() => navigate({ name: 'playlist', id: p.id })}>
            {#if p.coverArt}
              <Artwork coverArt={p.coverArt} size={92} corner={10} />
            {:else}
              <div class="pl-placeholder">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
              </div>
            {/if}
            <div class="retro pl-title">{p.name}</div>
            {#if p.songCount != null}
              <div class="retro retro-light retro-graphite pl-sub">{p.songCount} songs</div>
            {/if}
          </button>
        {/each}
      </div>
    </section>
  {/if}
  {#if recentlyAdded.length}
    <section>
      <SectionHeader title="Recently Added" />
      <SongShelf songs={recentlyAdded.slice(0, 20)} size={92} />
    </section>
  {/if}
  {#if mostListened.length}
    <section>
      <SectionHeader title="Most Listened" />
      <ol class="most-listened">
        {#each mostListened.slice(0, 10) as s, i}
          <li>
            <button class="ml-row" onclick={() => player.play(mostListened.slice(0, 10), i)}>
              <Artwork coverArt={s.coverArt} size={44} />
              <div class="text">
                <div class="retro retro-md">{s.title}</div>
                <div class="retro retro-sm retro-light retro-graphite">{s.artist ?? ''}</div>
              </div>
              <span class="retro retro-sm retro-light retro-graphite mono">{fmt(s.duration ?? 0)}</span>
            </button>
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  {#if loading}<div class="loading">Loading…</div>{/if}
</div>

<style>
  .home { display: flex; flex-direction: column; gap: 30px; padding-top: 12px; padding-bottom: 120px; }
  .top { display: flex; align-items: center; gap: 12px; padding: 0 20px; }
  .top > div:first-child > *:first-child { margin-bottom: 2px; }
  .round {
    margin-left: auto;
    width: 42px; height: 42px; border-radius: 50%;
    background: var(--surface); border: 1px solid var(--hairline);
    color: var(--ink);
    display: flex; align-items: center; justify-content: center;
  }

  .smart { display: flex; flex-direction: column; gap: 14px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 0 20px; }
  .tile {
    display: flex; align-items: center; gap: 10px; padding: 10px;
    background: var(--surface); border: 1px solid var(--hairline);
    border-radius: 12px; color: var(--ink); text-align: left;
    transition: border-color 0.15s;
  }
  .tile:hover { border-color: var(--accent); }
  .tile-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }

  .pl-shelf {
    display: flex; gap: 12px;
    overflow-x: auto; padding: 0 20px 4px;
    scroll-snap-type: x proximity;
  }
  .pl-cell {
    flex: 0 0 auto;
    width: 92px;
    display: flex; flex-direction: column; gap: 6px;
    text-align: left; color: var(--ink);
    scroll-snap-align: start;
  }
  .pl-placeholder {
    width: 92px; height: 92px;
    background: var(--surface); border: 1px solid var(--hairline);
    border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
  }
  .pl-title {
    font-size: 10px; font-family: var(--font-oswald); text-transform: uppercase;
    letter-spacing: 0.07em; font-weight: 600;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .pl-sub { font-size: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .most-listened { list-style: none; margin: 0; padding: 0 20px; display: flex; flex-direction: column; }
  .most-listened li { border-bottom: 1px solid var(--hairline); }
  .ml-row {
    width: 100%; text-align: left;
    display: flex; align-items: center; gap: 12px; padding: 8px 0;
    color: var(--ink);
    transition: background 0.15s;
  }
  .ml-row:hover { background: color-mix(in oklab, var(--hairline) 40%, transparent); }
  .most-listened .text { flex: 1; min-width: 0; }
  .most-listened .mono { font-family: var(--font-mono); font-size: 12px; }

  .loading { padding: 40px; text-align: center; color: var(--graphite); }
</style>
