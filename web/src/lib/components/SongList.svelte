<script lang="ts">
  import { player, currentSongOf } from '../stores/player'
  import type { Song } from '../subsonic/models'
  import { virtualSource, shortLabel } from '../subsonic/models'
  import Artwork from './Artwork.svelte'

  interface Props {
    songs: Song[]
    /** Which field to show in the secondary text: artist (default) or album. */
    secondary?: 'artist' | 'album'
  }
  let { songs, secondary = 'artist' }: Props = $props()

  const currentId = $derived(currentSongOf($player)?.id)

  function fmt(t: number): string {
    if (!isFinite(t) || t <= 0) return '—'
    const s = Math.floor(t)
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
  }
</script>

<ul class="list">
  {#each songs as s, i}
    <li>
      <button class="row" class:playing={s.id === currentId}
              onclick={() => player.play(songs, i)}>
        <Artwork coverArt={s.coverArt} size={40} corner={5} />
        <div class="text">
          <div class="title-line">
            {#if s.id === currentId}
              <svg class="wave" viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                <rect x="4"  y="8"  width="3" height="8" rx="1"/>
                <rect x="10" y="5"  width="3" height="14" rx="1"/>
                <rect x="16" y="10" width="3" height="4" rx="1"/>
              </svg>
            {/if}
            <span class="retro title">{s.title}</span>
          </div>
          <div class="retro retro-light retro-graphite sub">
            {secondary === 'album' ? (s.album ?? '') : (s.artist ?? '')}
          </div>
        </div>
        {#if virtualSource(s.id) && !$player.savedYouTube.has(s.id)}
          <span class="tag">{shortLabel(virtualSource(s.id)!)}</span>
        {:else}
          <span class="mono dur">{fmt(s.duration ?? 0)}</span>
        {/if}
      </button>
    </li>
  {/each}
</ul>

<style>
  .list { list-style: none; margin: 0; padding: 0; }
  .list li { border-bottom: 1px solid var(--hairline); }
  .row {
    width: 100%;
    display: flex; align-items: center; gap: 12px;
    padding: 8px 20px;
    color: var(--ink);
    text-align: left;
    transition: background 0.12s;
  }
  .row:hover { background: color-mix(in oklab, var(--hairline) 50%, transparent); }
  .row.playing .title { color: var(--accent); }
  .wave { color: var(--accent); }
  .text { flex: 1; min-width: 0; }
  .title-line { display: flex; align-items: center; gap: 6px; }
  .title {
    font-size: 13px; font-weight: 500;
    font-family: var(--font-oswald);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    display: block; min-width: 0;
  }
  .sub {
    font-size: 10px; margin-top: 2px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
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
</style>
