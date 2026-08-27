<script lang="ts">
  import { onMount } from 'svelte'
  import { requireClient } from '../stores/session'
  import { player } from '../stores/player'
  import { playlistFavs } from '../stores/playlistFavs'
  import { navigate } from '../stores/router'
  import type { PlaylistWithSongs } from '../subsonic/models'
  import Artwork from '../components/Artwork.svelte'
  import SongList from '../components/SongList.svelte'

  interface Props { id: string }
  let { id }: Props = $props()

  let playlist = $state<PlaylistWithSongs | undefined>()
  let loading = $state(true)

  onMount(async () => {
    try { playlist = await requireClient().playlist(id) }
    finally { loading = false }
  })

  const fav = $derived($playlistFavs.has(id))

  function playAll()      { if (playlist?.entry?.length) player.play(playlist.entry, 0) }
  function playShuffled() { if (playlist?.entry?.length) player.playShuffled(playlist.entry) }
</script>

<div class="page">
  <header>
    <button class="back" onclick={() => navigate({ name: 'library', tab: 1 })} aria-label="Back">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>
    </button>
  </header>

  {#if loading}
    <div class="empty retro retro-sm retro-light retro-graphite">Loading…</div>
  {:else if playlist}
    <div class="hero">
      {#if playlist.coverArt}
        <Artwork coverArt={playlist.coverArt} size={180} corner={10} />
      {:else}
        <div class="placeholder">
          <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="var(--graphite)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
          </svg>
        </div>
      {/if}
      <div class="meta">
        <div class="retro retro-hero title">{playlist.name}</div>
        <div class="retro retro-sm retro-light retro-graphite subtitle">
          {playlist.entry?.length ?? 0} songs
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
          <button class="btn icon" onclick={() => playlistFavs.toggle(id)}
                  aria-label={fav ? 'Unfavourite playlist' : 'Favourite playlist'}>
            <svg viewBox="0 0 24 24" width="16" height="16"
                 fill={fav ? 'var(--accent)' : 'none'}
                 stroke={fav ? 'var(--accent)' : 'currentColor'}
                 stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6C19 16.5 12 21 12 21z" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    {#if playlist.entry?.length}
      <SongList songs={playlist.entry} />
    {/if}
  {:else}
    <div class="empty retro retro-sm retro-light retro-graphite">Playlist not found.</div>
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

  .hero { display: flex; gap: 20px; padding: 0 20px; align-items: center; }
  .meta { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .title { font-size: 28px; }
  .subtitle { letter-spacing: 0.12em; }

  .placeholder {
    width: 180px; height: 180px;
    display: flex; align-items: center; justify-content: center;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 10px;
    flex-shrink: 0;
  }

  .actions { display: flex; gap: 8px; margin-top: 8px; }
  .btn {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 8px 16px; border-radius: 999px;
  }
  .btn.primary { background: var(--accent); color: white; }
  .btn.primary:hover { filter: brightness(1.05); }
  .btn.ghost { background: transparent; color: var(--accent); border: 1px solid var(--accent); }
  .btn.ghost:hover { background: color-mix(in oklab, var(--accent) 12%, transparent); }
  .btn.icon {
    padding: 8px; width: 36px; height: 36px;
    color: var(--ink);
    display: inline-flex; align-items: center; justify-content: center;
  }
  .btn.icon:hover { background: color-mix(in oklab, var(--hairline) 60%, transparent); }

  .empty { padding: 30px 20px; text-align: center; }

  @media (max-width: 600px) {
    .hero { flex-direction: column; align-items: flex-start; }
  }
</style>
