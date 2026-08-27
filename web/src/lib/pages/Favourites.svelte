<script lang="ts">
  import { onMount } from 'svelte'
  import { requireClient } from '../stores/session'
  import { player } from '../stores/player'
  import type { Song, Album, Artist } from '../subsonic/models'
  import Artwork from '../components/Artwork.svelte'
  import SectionHeader from '../components/SectionHeader.svelte'
  import SongList from '../components/SongList.svelte'
  import { navigate } from '../stores/router'

  let songs = $state<Song[]>([])
  let albums = $state<Album[]>([])
  let artists = $state<Artist[]>([])
  let loading = $state(true)

  onMount(async () => {
    try {
      const r = await requireClient().favorites()
      songs = r.song ?? []
      albums = r.album ?? []
      artists = r.artist ?? []
    } finally { loading = false }
  })

  function playAll()      { if (songs.length) player.play(songs, 0) }
  function playShuffled() { if (songs.length) player.playShuffled(songs) }
</script>

<div class="page">
  <header class="top">
    <div class="retro retro-xl">Favourites</div>
    <div class="spacer"></div>
    {#if songs.length}
      <button class="btn primary" onclick={playAll}>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M6 4v16l14-8z" /></svg>
        <span class="retro retro-sm">Play</span>
      </button>
      <button class="btn ghost" onclick={playShuffled}>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
        <span class="retro retro-sm">Shuffle</span>
      </button>
    {/if}
  </header>

  {#if loading}
    <div class="empty retro retro-sm retro-light retro-graphite">Loading…</div>
  {:else if songs.length === 0 && albums.length === 0 && artists.length === 0}
    <div class="empty retro retro-sm retro-light retro-graphite">
      Nothing starred yet. Tap the heart in the player to favourite a song.
    </div>
  {:else}
    {#if albums.length}
      <section>
        <SectionHeader title="Albums" trailing={String(albums.length)} />
        <div class="grid">
          {#each albums as a}
            <button class="cell" onclick={() => navigate({ name: 'album', id: a.id })}>
              <Artwork coverArt={a.coverArt} size={140} corner={8} />
              <div class="retro cell-title">{a.name}</div>
              <div class="retro retro-light retro-graphite cell-sub">{a.artist ?? ''}</div>
            </button>
          {/each}
        </div>
      </section>
    {/if}

    {#if songs.length}
      <section>
        <SectionHeader title="Songs" trailing={String(songs.length)} />
        <SongList {songs} />
      </section>
    {/if}
  {/if}
</div>

<style>
  .page { display: flex; flex-direction: column; gap: 20px; padding-top: 12px; padding-bottom: 40px; }
  .top { display: flex; align-items: center; gap: 10px; padding: 0 20px; }
  .top .retro-xl { color: var(--ink); }
  .spacer { flex: 1; }

  .btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 14px; border-radius: 999px;
  }
  .btn.primary { background: var(--accent); color: white; }
  .btn.ghost { color: var(--accent); border: 1px solid var(--accent); }
  .btn.primary:hover { filter: brightness(1.05); }
  .btn.ghost:hover { background: color-mix(in oklab, var(--accent) 12%, transparent); }

  .grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 20px;
    padding: 8px 20px 8px;
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
  .cell-sub { font-size: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .empty { padding: 30px 20px; text-align: center; }
</style>
