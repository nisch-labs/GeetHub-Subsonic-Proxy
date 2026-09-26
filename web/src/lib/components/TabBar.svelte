<script lang="ts">
  import { route, navigate, type Route } from '../stores/router'
  import { theme, type SchemeChoice } from '../stores/theme'
  import { onMount, onDestroy } from 'svelte'

  const tabs: { name: Route['name']; icon: string; label: string }[] = [
    { name: 'home',       icon: 'home',        label: 'Home' },
    { name: 'library',    icon: 'square-stack', label: 'Library' },
    { name: 'favourites', icon: 'heart',       label: 'Favourites' },
    { name: 'search',     icon: 'search',      label: 'Search' },
    { name: 'downloader', icon: 'download',    label: 'Downloader' },
    { name: 'settings',   icon: 'gear',        label: 'Settings' },
  ]

  const { scheme } = theme

  // ─── Theme cycle: System → Light → Dark → System ─────────────
  const order: SchemeChoice[] = ['system', 'light', 'dark']
  function nextScheme() {
    const cur = order.indexOf($scheme as SchemeChoice)
    scheme.set(order[(cur + 1) % order.length])
  }
  function themeIconPath(current: SchemeChoice): string {
    // sun (light), moon (dark), half-circle (system-adaptive)
    switch (current) {
      case 'light':  return 'M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4M8 12a4 4 0 1 0 8 0 4 4 0 0 0-8 0z'
      case 'dark':   return 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'
      default:       return 'M12 3a9 9 0 1 0 0 18zm0 0v18a9 9 0 1 0 0-18z'   // half-circle
    }
  }
  function themeLabel(current: SchemeChoice): string {
    return current === 'light' ? 'Theme: Light — click for Dark'
         : current === 'dark'  ? 'Theme: Dark — click for System'
         : 'Theme: System — click for Light'
  }

  // ─── Fullscreen toggle ─────────────────────────────────────────
  let isFull = $state(false)
  function updateFull() { isFull = !!document.fullscreenElement }
  function toggleFull() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      document.documentElement.requestFullscreen().catch(() => {})
    }
  }
  onMount(() => {
    updateFull()
    document.addEventListener('fullscreenchange', updateFull)
  })
  onDestroy(() => document.removeEventListener('fullscreenchange', updateFull))

  // Outlined (inactive) and filled (active) variants — filled looks solid and
  // matches SF Symbols' `.fill` convention on iOS. Some shapes (magnifying
  // glass) don't have a clean filled form, so they get a solid version instead.
  function outlinePath(name: string): string {
    switch (name) {
      case 'home':         return 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z'
      case 'square-stack': return 'M7 5h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 8v11a2 2 0 0 0 2 2h11'
      case 'heart':        return 'M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6C19 16.5 12 21 12 21z'
      case 'search':       return 'M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm11 17-6-6'
      case 'download':     return 'M12 3v13m-5-5 5 5 5-5M4 21h16'
      case 'gear':         return 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm9 4c0-.6-.05-1.2-.14-1.8l2.14-1.6-2-3.5-2.55.9c-.9-.7-1.9-1.3-3-1.7L15 2h-6l-.45 2.3c-1.1.4-2.1 1-3 1.7l-2.55-.9-2 3.5 2.14 1.6C3.05 10.8 3 11.4 3 12s.05 1.2.14 1.8L1 15.4l2 3.5 2.55-.9c.9.7 1.9 1.3 3 1.7L9 22h6l.45-2.3c1.1-.4 2.1-1 3-1.7l2.55.9 2-3.5-2.14-1.6c.09-.6.14-1.2.14-1.8z'
      default:             return ''
    }
  }
</script>

<nav class="sidebar" aria-label="Primary">
  <div class="brand" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="22" height="22">
      <circle cx="12" cy="12" r="10" fill="none" stroke="var(--accent)" stroke-width="1.5" />
      <circle cx="12" cy="12" r="4"  fill="none" stroke="var(--accent)" stroke-width="1.5" />
      <circle cx="12" cy="12" r="1.2" fill="var(--accent)" />
    </svg>
  </div>

  {#each tabs as t}
    {@const active = $route.name === t.name || (t.name === 'library' && ($route.name === 'album' || $route.name === 'artist' || $route.name === 'playlist'))}
    <button
      class="tab" class:active
      onclick={() => navigate({ name: t.name } as Route)}
      aria-label={t.label}
      title={t.label}
    >
      <svg viewBox="0 0 24 24" width="20" height="20"
           fill={active ? 'currentColor' : 'none'}
           stroke="currentColor"
           stroke-width={active ? 1 : 1.7}
           stroke-linecap="round" stroke-linejoin="round">
        <path d={outlinePath(t.icon)} />
      </svg>
    </button>
  {/each}

  <div class="spacer"></div>

  <button class="tab" onclick={nextScheme}
          aria-label={themeLabel($scheme as SchemeChoice)}
          title={themeLabel($scheme as SchemeChoice)}>
    <svg viewBox="0 0 24 24" width="18" height="18"
         fill={$scheme === 'system' ? 'currentColor' : 'none'}
         stroke="currentColor" stroke-width="1.7"
         stroke-linecap="round" stroke-linejoin="round">
      <path d={themeIconPath($scheme as SchemeChoice)} />
    </svg>
  </button>

  <button class="tab" onclick={toggleFull}
          aria-label={isFull ? 'Exit fullscreen' : 'Enter fullscreen'}
          title={isFull ? 'Exit fullscreen' : 'Enter fullscreen'}>
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
         stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      {#if isFull}
        <path d="M9 3v4H5M15 3v4h4M9 21v-4H5M15 21v-4h4" />
      {:else}
        <path d="M5 9V5h4M19 9V5h-4M5 15v4h4M19 15v4h-4" />
      {/if}
    </svg>
  </button>
</nav>

<style>
  .sidebar {
    display: flex; flex-direction: column;
    gap: 6px;
    padding: 14px 8px;
    width: 56px;
    flex-shrink: 0;
    background: var(--surface);
    border-right: 1px solid var(--hairline);
    height: 100svh;
    box-sizing: border-box;
    align-items: center;
  }

  .brand {
    padding: 4px 0 18px;
    display: flex; align-items: center; justify-content: center;
  }

  .spacer { flex: 1; }

  .tab {
    width: 40px; height: 36px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 9px;
    color: var(--graphite);
    background: transparent;
    transition: color 0.15s, background 0.15s;
  }
  .tab:hover { color: var(--ink); background: color-mix(in oklab, var(--hairline) 60%, transparent); }
  .tab.active {
    color: var(--accent);
    background: transparent;
  }
  .tab.active:hover { background: transparent; }

  /* Narrow viewports: collapse to a bottom bar. */
  @media (max-width: 900px) {
    .sidebar {
      flex-direction: row;
      width: 100%; height: auto;
      padding: 8px 12px;
      padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
      border-right: none;
      border-top: 1px solid var(--hairline);
      justify-content: center;
      gap: 8px;
      align-items: center;
    }
    .brand { display: none; }
    .spacer { flex: 0; }
  }
</style>
