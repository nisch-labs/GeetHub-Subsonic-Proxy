<script lang="ts">
  interface Props {
    options: string[]
    selected: number
    onselect?: (i: number) => void
  }
  let { options, selected, onselect }: Props = $props()
</script>

<div class="bar" role="tablist">
  {#each options as opt, i}
    <button
      class="seg" class:on={selected === i}
      role="tab" aria-selected={selected === i}
      onclick={() => onselect?.(i)}
    >
      <span class="retro retro-sm retro-medium">{opt}</span>
    </button>
  {/each}
</div>

<style>
  .bar {
    display: flex;
    gap: 4px;
    padding: 4px;
    margin: 0 20px;
    background: color-mix(in oklab, var(--hairline) 40%, transparent);
    border-radius: 12px;
  }
  .seg {
    flex: 1;
    padding: 8px 12px;
    border-radius: 9px;
    color: var(--graphite);
    transition: color 0.15s, background 0.15s;
  }
  .seg:hover { color: var(--ink); }
  .seg.on {
    color: var(--ink);
    background: var(--surface);
    box-shadow: 0 1px 2px rgba(0,0,0,0.06);
  }
</style>
