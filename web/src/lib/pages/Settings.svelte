<script lang="ts">
  import { theme, ACCENTS, type SchemeChoice } from '../stores/theme'
  import { session } from '../stores/session'
  import { player } from '../stores/player'
  import { ytSearchSource, labelFor, type SearchSource } from '../stores/searchSource'
  import SectionHeader from '../components/SectionHeader.svelte'
  import AddServerSheet from '../components/AddServerSheet.svelte'
  import EditServerSheet from '../components/EditServerSheet.svelte'

  const { scheme, accent } = theme

  const schemes: { id: SchemeChoice; label: string }[] = [
    { id: 'system', label: 'System' },
    { id: 'light',  label: 'Light' },
    { id: 'dark',   label: 'Dark' },
  ]
  const sources: { id: SearchSource; label: string; blurb: string }[] = [
    { id: 'ytmusic', label: 'YouTube Music',
      blurb: 'Song-only results with real artist / album metadata. Cleaner. Occasionally misses obscure uploads.' },
    { id: 'youtube', label: 'YouTube',
      blurb: 'Full site search. Broader coverage — also includes lyric videos, karaoke and covers.' },
  ]

  let revealHost = $state(false)
  let revealUser = $state(false)
  let confirmSignOut = $state(false)
  let showAdd = $state(false)
  let showEdit = $state(false)
  let switchOpen = $state(false)

  const host = $derived($session.client?.creds.baseURL.replace(/^https?:\/\//, '').replace(/\/$/, '') ?? '')
  const user = $derived($session.client?.creds.username ?? '')
  const otherServers = $derived($session.servers.filter((s) => s.id !== $session.activeId))
  const activeServer = $derived($session.servers.find((s) => s.id === $session.activeId))

  function masked(v: string): string {
    return '•'.repeat(Math.min(10, Math.max(6, v.length)))
  }

  // ─── Storage utilities ────────────────────────────────────────

  const RECENTS_KEY = 'geethub.recentSearches'
  const RECENTLY_PLAYED_KEY = 'geethub.recentlyPlayed'

  let recentSearchesCount = $state(readRecentSearchesCount())
  function readRecentSearchesCount(): number {
    try {
      const raw = localStorage.getItem(RECENTS_KEY)
      if (raw) return (JSON.parse(raw) as string[]).length
    } catch (_) {}
    return 0
  }

  let confirmClear = $state<null | 'recent-searches' | 'recently-played' | 'saved-yt'>(null)

  function clearRecentSearches() {
    localStorage.removeItem(RECENTS_KEY)
    recentSearchesCount = 0
    confirmClear = null
  }
  function clearRecentlyPlayed() {
    localStorage.removeItem(RECENTLY_PLAYED_KEY)
    location.reload()   // simplest way to reset the in-memory recentlyPlayed
  }
  function clearSavedYT() {
    // We can't reach player store's internals directly without another export;
    // the state is session-only anyway, so a reload wipes it.
    localStorage.removeItem(RECENTLY_PLAYED_KEY)
    location.reload()
  }

  function performClear() {
    if (confirmClear === 'recent-searches') clearRecentSearches()
    if (confirmClear === 'recently-played') clearRecentlyPlayed()
    if (confirmClear === 'saved-yt') clearSavedYT()
    confirmClear = null
  }
</script>

<div class="settings">
  <SectionHeader title="Settings" />

  <div class="card">
    <div class="card-title retro retro-sm retro-medium retro-graphite">Appearance</div>
    <div class="row">
      <span class="retro retro-md">Theme</span>
      <div class="pills">
        {#each schemes as s}
          <button class="pill" class:on={$scheme === s.id} onclick={() => scheme.set(s.id)}>
            <span class="retro retro-sm retro-medium">{s.label}</span>
          </button>
        {/each}
      </div>
    </div>
    <div class="hairline"></div>
    <div class="row">
      <span class="retro retro-md">Accent</span>
      <div class="accents">
        {#each ACCENTS as a}
          <button class="dot" class:on={$accent === a.id}
                  style:background={a.hex} onclick={() => accent.set(a.id)}
                  aria-label={a.label}>
            {#if $accent === a.id}
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7" /></svg>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-title retro retro-sm retro-medium retro-graphite">Search source</div>
    {#each sources as s, i}
      {#if i > 0}<div class="hairline"></div>{/if}
      <button class="choose-row" onclick={() => $ytSearchSource = s.id}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
             stroke={$ytSearchSource === s.id ? 'var(--accent)' : 'var(--graphite)'} stroke-width="1.7">
          <circle cx="12" cy="12" r="9" />
          {#if $ytSearchSource === s.id}
            <circle cx="12" cy="12" r="4" fill="var(--accent)" stroke="none" />
          {/if}
        </svg>
        <div class="cr-text">
          <div class="retro retro-md">{s.label}</div>
          <div class="cr-blurb retro-graphite">{s.blurb}</div>
        </div>
      </button>
    {/each}
  </div>

  <div class="card">
    <div class="card-title retro retro-sm retro-medium retro-graphite">Server</div>
    <div class="info-row">
      <span class="retro retro-sm retro-medium retro-graphite">Host</span>
      <span class="mono">{revealHost ? host || '—' : masked(host)}</span>
      <button class="eye" onclick={() => revealHost = !revealHost} aria-label="{revealHost ? 'Hide' : 'Show'}">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          {#if revealHost}
            <path d="M2 2l20 20M6.7 6.7C4.7 8 3 10 2 12c2 4 6 7 10 7 2 0 4-.5 5.7-1.5M11 5.1c.3 0 .7-.1 1-.1 4 0 8 3 10 7-.7 1.5-1.7 2.9-2.9 4" />
            <path d="M9.9 9.9a3 3 0 1 0 4.2 4.2" />
          {:else}
            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          {/if}
        </svg>
      </button>
    </div>
    <div class="hairline"></div>
    <div class="info-row">
      <span class="retro retro-sm retro-medium retro-graphite">User</span>
      <span class="mono">{revealUser ? user || '—' : masked(user)}</span>
      <button class="eye" onclick={() => revealUser = !revealUser} aria-label="{revealUser ? 'Hide' : 'Show'}">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          {#if revealUser}
            <path d="M2 2l20 20M6.7 6.7C4.7 8 3 10 2 12c2 4 6 7 10 7 2 0 4-.5 5.7-1.5M11 5.1c.3 0 .7-.1 1-.1 4 0 8 3 10 7-.7 1.5-1.7 2.9-2.9 4" />
            <path d="M9.9 9.9a3 3 0 1 0 4.2 4.2" />
          {:else}
            <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
            <circle cx="12" cy="12" r="3" />
          {/if}
        </svg>
      </button>
    </div>
  </div>

  <div class="card">
    <button class="action-row" onclick={() => showAdd = true}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--accent)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14" /></svg>
      <span class="retro retro-md">Add Server</span>
      <div class="spacer"></div>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
    </button>
    <div class="hairline"></div>
    <div class="action-wrap">
      {#if otherServers.length === 0}
        <div class="action-row disabled">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8h13l-3-3M17 16H4l3 3" /></svg>
          <span class="retro retro-md">Switch Server</span>
          <div class="spacer"></div>
          <span class="retro retro-sm retro-light retro-graphite">Only one saved</span>
        </div>
      {:else}
        <button class="action-row" onclick={() => switchOpen = !switchOpen}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--accent)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8h13l-3-3M17 16H4l3 3" /></svg>
          <span class="retro retro-md">Switch Server</span>
          <div class="spacer"></div>
          <span class="retro retro-sm retro-light retro-graphite">{otherServers.length} other{otherServers.length === 1 ? '' : 's'}</span>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        {#if switchOpen}
          <div class="menu" role="none" onclick={(e) => e.stopPropagation()}>
            {#each otherServers as s}
              <button class="mi" onclick={() => { session.switchServer(s.id); switchOpen = false }}>
                <span class="retro retro-sm">{s.label}</span>
              </button>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
    <div class="hairline"></div>
    <button class="action-row" onclick={() => showEdit = true} disabled={!activeServer}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke={activeServer ? 'var(--accent)' : 'var(--graphite)'} stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
      <span class="retro retro-md" style:color={activeServer ? 'var(--ink)' : 'var(--graphite)'}>Edit Current Server</span>
      <div class="spacer"></div>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
    </button>
  </div>

  <div class="card">
    <div class="card-title retro retro-sm retro-medium retro-graphite">Storage</div>
    <button class="clear-row" onclick={() => confirmClear = 'recent-searches'}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--accent)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="6" /><path d="M21 21l-6-6" /></svg>
      <div class="cl-text">
        <div class="retro retro-md">Recent searches</div>
        <div class="retro retro-sm retro-light retro-graphite">{recentSearchesCount} saved</div>
      </div>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" /></svg>
    </button>
    <div class="hairline"></div>
    <button class="clear-row" onclick={() => confirmClear = 'recently-played'}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--accent)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4l3 2M21 12a9 9 0 1 1-3-6.7L21 8V3" /></svg>
      <div class="cl-text">
        <div class="retro retro-md">Recently played</div>
        <div class="retro retro-sm retro-light retro-graphite">{$player.recentlyPlayed.length} songs</div>
      </div>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" /></svg>
    </button>
    <div class="hairline"></div>
    <button class="clear-row" onclick={() => confirmClear = 'saved-yt'}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--accent)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13m-5-5 5 5 5-5M4 21h16" /></svg>
      <div class="cl-text">
        <div class="retro retro-md">Saved YouTube tags</div>
        <div class="retro retro-sm retro-light retro-graphite">{$player.savedYouTube.size} marked this session</div>
      </div>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" /></svg>
    </button>
  </div>

  <button class="signout retro retro-sm retro-medium" onclick={() => confirmSignOut = true}>
    Log out of Geet-Hub
  </button>

  <div class="summary retro retro-sm retro-light retro-graphite">
    {schemes.find((s) => s.id === $scheme)?.label ?? 'System'} · {ACCENTS.find((a) => a.id === $accent)?.label ?? 'Teal'} · {labelFor($ytSearchSource)}
  </div>
</div>

{#if confirmSignOut}
  <div class="modal-scrim" onclick={() => confirmSignOut = false} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <div class="retro retro-md retro-bold">Log out of Geet-Hub?</div>
      <div class="retro retro-sm retro-light retro-graphite" style="margin-top:8px">
        Every saved server will be cleared from this device.
      </div>
      <div class="modal-actions">
        <button class="btn ghost" onclick={() => confirmSignOut = false}>Cancel</button>
        <button class="btn danger" onclick={() => { session.signOut(); confirmSignOut = false }}>Log out</button>
      </div>
    </div>
  </div>
{/if}

{#if confirmClear}
  <div class="modal-scrim" onclick={() => confirmClear = null} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <div class="retro retro-md retro-bold">
        {#if confirmClear === 'recent-searches'}Clear recent searches?
        {:else if confirmClear === 'recently-played'}Clear recently played?
        {:else}Forget saved YouTube tags?{/if}
      </div>
      <div class="retro retro-sm retro-light retro-graphite" style="margin-top:8px">
        This only affects this device.
      </div>
      <div class="modal-actions">
        <button class="btn ghost" onclick={() => confirmClear = null}>Cancel</button>
        <button class="btn danger" onclick={performClear}>Clear</button>
      </div>
    </div>
  </div>
{/if}

{#if showAdd}
  <AddServerSheet onclose={() => showAdd = false} />
{/if}
{#if showEdit && activeServer}
  <EditServerSheet server={activeServer} onclose={() => showEdit = false} />
{/if}

<style>
  .settings {
    display: flex; flex-direction: column; gap: 20px;
    padding: 20px 20px 40px;
    max-width: 720px; margin: 0 auto;
  }
  .card {
    background: var(--surface); border: 1px solid var(--hairline);
    border-radius: 16px;
    padding: 6px 0;
  }
  .card-title { padding: 12px 20px 6px; }
  .row { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; gap: 16px; }
  .hairline { background: var(--hairline); height: 1px; margin-left: 20px; }

  .pills { display: flex; gap: 8px; }
  .pill {
    padding: 8px 14px;
    background: transparent; color: var(--ink);
    border: 1px solid var(--hairline);
    border-radius: 10px;
  }
  .pill.on { background: var(--accent); color: white; border-color: var(--accent); }

  .accents { display: flex; gap: 12px; flex-wrap: wrap; }
  .dot {
    width: 32px; height: 32px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    position: relative;
  }
  .dot.on::before {
    content: ''; position: absolute; inset: -5px;
    border: 2px solid var(--ink); border-radius: 50%;
  }

  .choose-row {
    width: 100%; display: flex; align-items: flex-start; gap: 12px;
    padding: 14px 20px;
    color: var(--ink); text-align: left;
    transition: background 0.12s;
  }
  .choose-row:hover { background: color-mix(in oklab, var(--hairline) 40%, transparent); }
  .cr-text { flex: 1; min-width: 0; }
  .cr-blurb { font-size: 12px; margin-top: 4px; line-height: 1.4; }

  .info-row { display: flex; align-items: center; gap: 10px; padding: 14px 20px; }
  .info-row > .retro-sm { flex: 0 0 60px; }
  .info-row .mono { flex: 1; font-family: var(--font-mono); font-size: 14px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; }
  .eye { display: flex; align-items: center; justify-content: center; padding: 4px; border-radius: 6px; }
  .eye:hover { background: color-mix(in oklab, var(--hairline) 60%, transparent); }

  .action-row {
    width: 100%; display: flex; align-items: center; gap: 12px;
    padding: 14px 20px;
    color: var(--ink); text-align: left;
    transition: background 0.12s;
  }
  .action-row:hover { background: color-mix(in oklab, var(--hairline) 40%, transparent); }
  .action-row:disabled, .action-row.disabled { cursor: not-allowed; }
  .action-wrap { position: relative; }
  .menu {
    background: var(--surface); border-top: 1px solid var(--hairline);
    display: flex; flex-direction: column;
    padding: 4px 0;
  }
  .mi { padding: 10px 20px; text-align: left; color: var(--ink); }
  .mi:hover { background: color-mix(in oklab, var(--hairline) 60%, transparent); }
  .spacer { flex: 1; }

  .clear-row {
    width: 100%; display: flex; align-items: center; gap: 12px;
    padding: 14px 20px;
    color: var(--ink); text-align: left;
    transition: background 0.12s;
  }
  .clear-row:hover { background: color-mix(in oklab, var(--hairline) 40%, transparent); }
  .cl-text { flex: 1; min-width: 0; }

  .signout {
    align-self: center;
    padding: 12px 20px;
    background: var(--accent); color: white;
    border-radius: 999px;
    letter-spacing: 0.08em;
    min-width: 200px;
  }
  .signout:hover { filter: brightness(1.05); }

  .summary { text-align: center; padding-top: 10px; }

  .modal-scrim {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center;
    z-index: 200;
  }
  .modal {
    background: var(--surface); color: var(--ink);
    border-radius: 14px;
    padding: 20px 22px;
    min-width: 320px; max-width: 92vw;
    box-shadow: 0 12px 40px rgba(0,0,0,0.3);
  }
  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }
  .btn { padding: 8px 16px; border-radius: 999px; }
  .btn.ghost { background: transparent; color: var(--ink); border: 1px solid var(--hairline); }
  .btn.danger { background: #e64444; color: white; }
  .btn.ghost:hover { background: color-mix(in oklab, var(--hairline) 60%, transparent); }
  .btn.danger:hover { filter: brightness(1.05); }
</style>
