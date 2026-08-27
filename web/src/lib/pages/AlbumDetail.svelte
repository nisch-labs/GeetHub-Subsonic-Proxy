<script lang="ts">
  import { onMount } from 'svelte'
  import { requireClient } from '../stores/session'
  import { player } from '../stores/player'
  import { navigate } from '../stores/router'
  import type { AlbumWithSongs } from '../subsonic/models'
  import Artwork from '../components/Artwork.svelte'
  import SongList from '../components/SongList.svelte'

  interface Props { id: string }
  let { id }: Props = $props()

  let album = $state<AlbumWithSongs | undefined>()
  let loading = $state(true)

  onMount(async () => {
    try { album = await requireClient().album(id) }
    finally { loading = false }
  })

  function playAll()      { if (album?.song?.length) player.play(album.song, 0) }
  function playShuffled() { if (album?.song?.length) player.playShuffled(album.song) }
</script>

<div class="page">
  <header>
    <button class="back" onclick={() => navigate({ name: 'library', tab: 2 })} aria-label="Back">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>
    </button>
  </header>

  {#if loading}
    <div class="empty retro retro-sm retro-light retro-graphite">Loading…</div>
  {:else if album}
    <div class="hero">
      <Artwork coverArt={album.coverArt} size={180} corner={10} />
      <div class="meta">
        <div class="retro retro-hero title">{album.name}</div>
        <div class="retro retro-sm retro-light retro-graphite subtitle">
          {album.artist ?? ''}{album.year ? ` · ${album.year}` : ''}
        </div>
        <div class="actions">
          <button class="btn primary" onclick={playAll}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M6 4v16l14-8z" /></svg>
            <span class="retro retro-sm">Play</span>
          </button>
          <button class="btn ghost" onclick={playShuffled}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" /></svg>
            <span class="retro retro-sm">Shuffle</span>
          </button>
        </div>
      </div>
    </div>

    {#if album.song?.length}
      <SongList songs={album.song} secondary="artist" />
    {/if}
  {:else}
    <div class="empty retro retro-sm retro-light retro-graphite">Album not found.</div>
  {/if}
</div>

<style>
  .page { display: flex; flex-direction: column; gap: 20px; padding-bottom: 40px; }
  header { padding: 12px 20px 0; }
  .back {
    width: 36px; height: 36px;
    display: flex; align-items: center; justify-content: center;
    color: var(--ink); border-radius: 50%;
  }
  .back:hover { background: color-mix(in oklab, var(--hairline) 60%, transparent); }

  .hero {
    display: flex; gap: 20px; padding: 0 20px;
    align-items: center;
  }
  .meta { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .title { font-size: 28px; }
  .subtitle { letter-spacing: 0.12em; }

  .actions { display: flex; gap: 8px; margin-top: 8px; }
  .btn {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 8px 16px; border-radius: 999px;
    transition: background 0.15s, color 0.15s;
  }
  .btn.primary { background: var(--accent); color: white; }
  .btn.primary:hover { filter: brightness(1.05); }
  .btn.ghost { background: transparent; color: var(--accent); border: 1px solid var(--accent); }
  .btn.ghost:hover { background: color-mix(in oklab, var(--accent) 12%, transparent); }

  .empty { padding: 30px 20px; text-align: center; }

  @media (max-width: 600px) {
    .hero { flex-direction: column; align-items: flex-start; }
  }
</style>
