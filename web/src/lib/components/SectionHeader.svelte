<script lang="ts">
  interface Props { title: string; trailing?: string }
  let { title, trailing }: Props = $props()
</script>

<header>
  <h2 class="retro retro-xl">{title}</h2>
  {#if trailing}
    <span class="retro retro-sm retro-light retro-graphite">{trailing}</span>
  {/if}
</header>

<style>
  header {
    display: flex; justify-content: space-between; align-items: baseline;
    padding: 0 20px;
  }
  h2 { margin: 0; }
</style>
