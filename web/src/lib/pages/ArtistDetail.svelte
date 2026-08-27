<script lang="ts">
  import { onMount } from 'svelte'
  import { requireClient } from '../stores/session'
  import { navigate } from '../stores/router'
  import type { ArtistWithAlbums } from '../subsonic/models'
  import Artwork from '../components/Artwork.svelte'

  interface Props { id: string }
  let { id }: Props = $props()

  let artist = $state<ArtistWithAlbums | undefined>()
  let loading = $state(true)

  onMount(async () => {
    try { artist = await requireClient().artist(id) }
    finally { loading = false }
  })
</script>

<div class="page">
  <header>
    <button class="back" onclick={() => navigate({ name: 'library', tab: 3 })} aria-label="Back">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>
    </button>
  </header>

  {#if loading}
    <div class="empty retro retro-sm retro-light retro-graphite">Loading…</div>
  {:else if artist}
    <div class="hero">
      <div class="portrait">
        <svg viewBox="0 0 24 24" width="60" height="60" fill="none" stroke="var(--graphite)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm-6 18a6 6 0 0 1 12 0" />
        </svg>
      </div>
      <div class="meta">
        <div class="retro retro-hero title">{artist.name}</div>
        <div class="retro retro-sm retro-light retro-graphite subtitle">
          {artist.album?.length ?? 0} albums
        </div>
      </div>
    </div>

    {#if artist.album?.length}
      <div class="grid">
        {#each artist.album as a}
          <button class="cell" onclick={() => navigate({ name: 'album', id: a.id })}>
            <Artwork coverArt={a.coverArt} size={150} corner={8} />
            <div class="retro cell-title">{a.name}</div>
            {#if a.year}
              <div class="retro retro-light retro-graphite cell-sub">{a.year}</div>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  {:else}
    <div class="empty retro retro-sm retro-light retro-graphite">Artist not found.</div>
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
  .portrait {
    width: 120px; height: 120px; border-radius: 50%;
    background: var(--surface); border: 1px solid var(--hairline);
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .meta { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .title { font-size: 28px; }
  .subtitle { letter-spacing: 0.12em; }

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
  .cell-sub { font-size: 9px; }

  .empty { padding: 30px 20px; text-align: center; }

  @media (max-width: 600px) {
    .hero { flex-direction: column; align-items: flex-start; }
  }
</style>
