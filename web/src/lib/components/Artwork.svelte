<script lang="ts">
  import { session } from '../stores/session'

  interface Props {
    coverArt?: string
    size?: number
    corner?: number
    shape?: 'sleeve' | 'circle'
    class?: string
  }
  let {
    coverArt, size = 44, corner = 6, shape = 'sleeve', class: extra = '',
  }: Props = $props()

  let src = $derived.by(() => {
    if (!coverArt || !$session.client) return ''
    return $session.client.coverArtURL(coverArt, size * 2)
  })
</script>

<div class="art {extra}"
     class:circle={shape === 'circle'}
     style:width="{size}px" style:height="{size}px"
     style:border-radius="{shape === 'circle' ? 999 : corner}px">
  {#if src}
    <img {src} alt="" width={size} height={size} loading="lazy" />
  {:else}
    <div class="fallback">
      <svg viewBox="0 0 24 24" width={size * 0.4} height={size * 0.4} fill="none"
           stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
      </svg>
    </div>
  {/if}
</div>

<style>
  .art {
    background: var(--surface);
    border: 1px solid var(--hairline);
    overflow: hidden;
    flex-shrink: 0;
    position: relative;
  }
  .art > img {
    width: 100%; height: 100%;
    display: block; object-fit: cover;
  }
  .fallback {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
  }
</style>
