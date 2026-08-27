<script lang="ts">
  import type { Song } from '../subsonic/models'
  import { virtualSource, shortLabel } from '../subsonic/models'
  import Artwork from './Artwork.svelte'
  import { player } from '../stores/player'

  interface Props { songs: Song[]; size?: number }
  let { songs, size = 92 }: Props = $props()

  const small = $derived(size < 120)
</script>

<div class="shelf">
  {#each songs as s, i}
    <button class="cell" style:width="{size}px" onclick={() => player.play(songs, i)}>
      <div class="art-wrap" style:width="{size}px" style:height="{size}px">
        <Artwork coverArt={s.coverArt} {size} corner={small ? 10 : 14} />
        {#if virtualSource(s.id)}
          <span class="tag">{shortLabel(virtualSource(s.id)!)}</span>
        {/if}
      </div>
      <div class="retro" class:sm={small}>{s.title}</div>
      <div class="retro retro-light retro-graphite" class:xs={small}>{s.artist ?? ''}</div>
    </button>
  {/each}
</div>

<style>
  .shelf {
    display: flex; gap: 16px;
    overflow-x: auto;
    padding: 0 20px 4px;
    scroll-snap-type: x proximity;
  }
  .cell {
    flex: 0 0 auto;
    display: flex; flex-direction: column; gap: 6px;
    text-align: left; color: var(--ink);
    background: none; padding: 0;
    scroll-snap-align: start;
  }
  .art-wrap { position: relative; }
  .tag {
    position: absolute; top: 6px; left: 6px;
    padding: 3px 8px;
    background: rgb(230, 33, 33);
    color: white;
    font-family: var(--font-oswald);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
    font-size: 9px;
    border-radius: 5px;
  }
  .retro { font-size: 12px; font-family: var(--font-oswald); text-transform: uppercase; letter-spacing: 0.07em; font-weight: 600;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .retro.sm { font-size: 10px; }
  .retro-light { font-weight: 300; }
  .retro-graphite { color: var(--graphite); font-size: 9px; }
  .xs { font-size: 8px; }
</style>
