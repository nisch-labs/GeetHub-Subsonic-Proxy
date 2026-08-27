<script lang="ts">
  import { session } from './lib/stores/session'
  import { route } from './lib/stores/router'
  import { theme } from './lib/stores/theme'   // side-effect: applies initial theme
  import Login from './lib/pages/Login.svelte'
  import Home from './lib/pages/Home.svelte'
  import Library from './lib/pages/Library.svelte'
  import Favourites from './lib/pages/Favourites.svelte'
  import Search from './lib/pages/Search.svelte'
  import Downloader from './lib/pages/Downloader.svelte'
  import Settings from './lib/pages/Settings.svelte'
  import AlbumDetail from './lib/pages/AlbumDetail.svelte'
  import ArtistDetail from './lib/pages/ArtistDetail.svelte'
  import PlaylistDetail from './lib/pages/PlaylistDetail.svelte'
  import TabBar from './lib/components/TabBar.svelte'
  import PlayerDock from './lib/components/PlayerDock.svelte'

  void theme    // pin the import so tree-shaking keeps the side effects
</script>

{#if $session.state.kind !== 'connected'}
  <Login />
{:else}
  <main class="shell">
    <TabBar />
    <div class="content">
      {#if $route.name === 'home'}
        <Home />
      {:else if $route.name === 'library'}
        <Library initialTab={$route.tab ?? 0} />
      {:else if $route.name === 'favourites'}
        <Favourites />
      {:else if $route.name === 'search'}
        <Search />
      {:else if $route.name === 'downloader'}
        <Downloader />
      {:else if $route.name === 'settings'}
        <Settings />
      {:else if $route.name === 'album'}
        <AlbumDetail id={$route.id} />
      {:else if $route.name === 'artist'}
        <ArtistDetail id={$route.id} />
      {:else if $route.name === 'playlist'}
        <PlaylistDetail id={$route.id} />
      {/if}
    </div>
    <PlayerDock />
  </main>
{/if}

<style>
  .shell {
    display: flex;
    height: 100svh;
  }
  .content { flex: 1; min-width: 0; overflow-y: auto; }
  .placeholder {
    padding: 60px 20px; text-align: center;
    display: flex; flex-direction: column; align-items: center; gap: 8px;
  }

  @media (max-width: 720px) {
    .shell { flex-direction: column; }
    .content { order: 0; }
    :global(nav.sidebar) { order: 1; }
  }
</style>
