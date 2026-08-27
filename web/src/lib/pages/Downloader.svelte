<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { requireClient } from '../stores/session'
  import type { AntraJob, AntraTrack } from '../subsonic/models'
  import { isTerminalJob } from '../subsonic/models'
  import SectionHeader from '../components/SectionHeader.svelte'

  // ─── State ─────────────────────────────────────────────────

  let urlText = $state('')
  let format = $state('mp3')
  let folder = $state<string | null>(null)
  let folders = $state<string[]>([])
  let queuing = $state(false)
  let toast = $state<string | null>(null)
  let toastTimer: number | null = null

  let jobs = $state<AntraJob[]>([])
  let loading = $state(true)
  let expanded = $state<Set<number>>(new Set())
  let tracksByJob = $state<Record<number, AntraTrack[]>>({})
  let pollTimer: number | null = null

  const formats = ['mp3', 'flac', 'alac', 'opus', 'wav']

  const sortedJobs = $derived([...jobs].sort((a, b) => b.id - a.id))
  const canQueue = $derived(!queuing && urlText.trim().length > 0)

  // ─── Lifecycle ────────────────────────────────────────────

  onMount(async () => {
    await loadFolders()
    await refreshJobs()
    pollTimer = window.setInterval(refreshJobs, 3000)
  })
  onDestroy(() => {
    if (pollTimer != null) window.clearInterval(pollTimer)
    if (toastTimer != null) window.clearTimeout(toastTimer)
  })

  // ─── Data ─────────────────────────────────────────────────

  async function loadFolders() {
    try { folders = await requireClient().libraryFolders() } catch (_) { folders = [] }
  }

  async function refreshJobs() {
    const c = requireClient()
    try {
      const list = await c.antraJobs()
      const active = list.filter((j) => j.status === 'running' || j.status === 'queued')

      const newestRunning = active.reduce<AntraJob | undefined>(
        (best, j) => (best == null || j.id > best.id) ? j : best, undefined,
      )
      if (newestRunning) expanded.add(newestRunning.id)

      const withProgress = [...list]
      if (active.length > 0) {
        const updates = await Promise.all(
          active.map((j) => c.antraJobStatus(j.id).catch(() => null)),
        )
        for (const upd of updates) {
          if (!upd) continue
          const idx = withProgress.findIndex((j) => j.id === upd.id)
          if (idx >= 0) withProgress[idx] = upd
        }
      }
      jobs = withProgress

      const idsToFetch = [...expanded].filter((id) => withProgress.some((j) => j.id === id))
      if (idsToFetch.length > 0) {
        const trackLists: Array<[number, AntraTrack[]]> = await Promise.all(
          idsToFetch.map(async (id) => {
            try { return [id, await c.antraJobTracks(id)] as [number, AntraTrack[]] }
            catch { return [id, []] as [number, AntraTrack[]] }
          }),
        )
        const next: Record<number, AntraTrack[]> = { ...tracksByJob }
        for (const [id, ts] of trackLists) next[id] = ts
        tracksByJob = next
      }
    } catch (_) { /* keep last known */ }
    loading = false
  }

  async function queue() {
    if (!canQueue) return
    const url = urlText.trim()
    queuing = true
    try {
      await requireClient().startAntraDownload(url, format, folder ?? undefined)
      urlText = ''
      showToast(folder ? `Queued → ${folder}` : 'Queued to library root')
      await refreshJobs()
    } catch (_) {
      showToast("Couldn't queue the download")
    } finally { queuing = false }
  }

  function toggleExpand(id: number) {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id); else next.add(id)
    expanded = next
    if (next.has(id)) {
      requireClient().antraJobTracks(id).then((ts) => {
        tracksByJob = { ...tracksByJob, [id]: ts }
      }).catch(() => {})
    }
  }

  function showToast(msg: string) {
    toast = msg
    if (toastTimer != null) window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => toast = null, 2500)
  }

  // ─── Rendering helpers ────────────────────────────────────

  function subtitleFor(job: AntraJob): string {
    const parts: string[] = []
    if (job.folder) parts.push(`→ ${job.folder}`)
    if (job.format) parts.push(job.format.toUpperCase())
    parts.push(statusLabel(job))
    return parts.join(' · ')
  }
  function statusLabel(job: AntraJob): string {
    switch (job.status) {
      case 'done':                  return 'Complete'
      case 'running':               return 'Downloading'
      case 'queued':                return 'Queued'
      case 'error': case 'failed':  return 'Failed'
      default:                      return job.status
    }
  }
  function shortURL(url: string): string {
    try {
      const u = new URL(url)
      return `${u.host}${u.pathname}`
    } catch (_) { return url }
  }
  function trackStateColor(state: string): string {
    switch (state) {
      case 'done':         return 'var(--accent)'
      case 'skipped':      return 'var(--graphite)'
      case 'downloading':  return '#f59e0b'
      case 'failed':       return '#e64444'
      default:             return 'var(--hairline)'
    }
  }
  function statusColor(job: AntraJob): string {
    switch (job.status) {
      case 'done':                  return 'var(--accent)'
      case 'error': case 'failed':  return '#e64444'
      case 'running':               return '#f59e0b'
      default:                      return 'var(--graphite)'
    }
  }
</script>

<div class="page">
  <SectionHeader title="Downloader" />

  <!-- Queue card ─ URL / Folder / Format / Queue button ─────── -->
  <div class="card">
    <div class="card-title retro retro-sm retro-medium retro-graphite">Queue a download</div>

    <div class="row url-row">
      <span class="label retro retro-sm retro-medium retro-graphite">URL</span>
      <div class="input-pill">
        <input type="url" bind:value={urlText} placeholder="https://…"
               autocorrect="off" autocapitalize="none" spellcheck="false" />
        {#if urlText === ''}
          <button class="mini-link" onclick={async () => {
            try { urlText = (await navigator.clipboard.readText()).trim() } catch (_) {}
          }}>
            <span class="retro retro-sm retro-medium retro-accent">Paste</span>
          </button>
        {:else}
          <button class="mini-link" onclick={() => urlText = ''} aria-label="Clear">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="var(--graphite)"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm3.5 13.5-3.5-3.5-3.5 3.5-1-1 3.5-3.5-3.5-3.5 1-1 3.5 3.5 3.5-3.5 1 1-3.5 3.5 3.5 3.5z"/></svg>
          </button>
        {/if}
      </div>
    </div>
    <div class="hairline"></div>

    <div class="row">
      <span class="label retro retro-sm retro-medium retro-graphite">Folder</span>
      <select class="select" bind:value={folder}>
        <option value={null}>Library root</option>
        {#each folders as f}
          <option value={f}>{f}</option>
        {/each}
      </select>
    </div>
    <div class="hairline"></div>

    <div class="row">
      <span class="label retro retro-sm retro-medium retro-graphite">Format</span>
      <select class="select" bind:value={format}>
        {#each formats as f}
          <option value={f}>{f.toUpperCase()}</option>
        {/each}
      </select>
    </div>
    <div class="hairline"></div>

    <div class="row">
      <button class="queue-btn" disabled={!canQueue} onclick={queue}
              style:background={canQueue ? 'var(--accent)' : 'var(--graphite)'}>
        {#if queuing}
          <span class="spinner"></span>
        {:else}
          <span class="retro retro-md retro-medium" style="color: white; letter-spacing: 0.08em;">Queue Download</span>
        {/if}
      </button>
    </div>
  </div>

  <!-- Jobs card ─ list of Antra jobs ───────────────────────── -->
  <div class="card">
    <div class="card-title retro retro-sm retro-medium retro-graphite">
      Recent jobs
      {#if jobs.length > 0}
        <span class="count retro retro-sm retro-light">{jobs.length}</span>
      {/if}
    </div>

    {#if loading && jobs.length === 0}
      <div class="empty retro retro-sm retro-light retro-graphite">Loading…</div>
    {:else if jobs.length === 0}
      <div class="empty">
        <span class="retro retro-sm retro-medium">No downloads yet</span>
        <span class="retro retro-sm retro-light retro-graphite">Paste a URL above and hit Queue.</span>
      </div>
    {:else}
      {#each sortedJobs as job, i (job.id)}
        {#if i > 0}<div class="hairline job-divider"></div>{/if}
        <button class="job-row" onclick={() => toggleExpand(job.id)}>
          <div class="status-dot" style:background={statusColor(job)}></div>
          <div class="job-text">
            <div class="retro retro-md retro-medium job-title">
              {job.title ?? shortURL(job.url)}
            </div>
            <div class="job-sub mono">{subtitleFor(job)}</div>
            {#if !isTerminalJob(job.status) && job.progress != null}
              <div class="bar"><span style:width="{Math.max(0, Math.min(100, job.progress))}%"></span></div>
            {/if}
          </div>
          {#if !isTerminalJob(job.status) && job.progress != null}
            <span class="pct mono">{job.progress}%</span>
          {/if}
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d={expanded.has(job.id) ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}/>
          </svg>
        </button>
        {#if expanded.has(job.id)}
          {@const tracks = tracksByJob[job.id] ?? []}
          {#if tracks.length > 0}
            <div class="tracks">
              {#each tracks as t}
                <div class="track">
                  <div class="t-dot" style:background={trackStateColor(t.state)}></div>
                  <span class="t-idx mono">{t.index}</span>
                  <div class="t-text">
                    <div class="retro retro-sm retro-medium t-title">{t.title}</div>
                    {#if t.artist}
                      <div class="retro retro-sm retro-light retro-graphite">{t.artist}</div>
                    {/if}
                  </div>
                  <span class="t-state mono" style:color={trackStateColor(t.state)}>
                    {t.state.toUpperCase()}
                  </span>
                </div>
              {/each}
            </div>
          {:else}
            <div class="no-tracks retro retro-sm retro-light retro-graphite">
              No per-track breakdown — single-track jobs don't have one.
            </div>
          {/if}
        {/if}
      {/each}
    {/if}
  </div>

  {#if toast}<div class="toast retro retro-sm retro-medium">{toast}</div>{/if}
</div>

<style>
  /* Full-width shell — matches Home / Library / Search. Cards stretch to
     the content area, sidebar (56px) + player dock account for the rest. */
  .page {
    display: flex; flex-direction: column; gap: 20px;
    padding: 20px 20px 120px;
    position: relative;
  }

  /* Card / row / hairline — copied from Settings for exact parity. */
  .card {
    background: var(--surface); border: 1px solid var(--hairline);
    border-radius: 16px;
    padding: 6px 0;
  }
  .card-title { padding: 12px 20px 6px; display: flex; align-items: baseline; gap: 8px; }
  .count { margin-left: auto; }
  .row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px; gap: 16px;
  }
  .hairline { background: var(--hairline); height: 1px; margin-left: 20px; }
  .label { flex: 0 0 72px; }

  /* URL row — the label + input pill share a row like Server/Host in Settings. */
  .url-row .input-pill {
    flex: 1;
    display: flex; align-items: center; gap: 6px;
    padding: 8px 12px;
    background: var(--paper);
    border: 1px solid var(--hairline);
    border-radius: 10px;
  }
  .input-pill input {
    flex: 1;
    font-family: var(--font-mono); font-size: 13px;
    color: var(--ink);
  }
  .mini-link {
    display: flex; align-items: center; padding: 2px 4px;
    background: transparent;
  }

  /* Native select styled to look like a pill matching other inputs. */
  .select {
    flex: 1;
    padding: 8px 12px;
    background: var(--paper); color: var(--ink);
    border: 1px solid var(--hairline);
    border-radius: 10px;
    font-family: var(--font-mono); font-size: 13px;
    max-width: 220px;
  }

  .queue-btn {
    flex: 1;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    padding: 12px 20px;
    border-radius: 12px;
    color: white;
    transition: background 0.15s;
  }
  .queue-btn:disabled { cursor: not-allowed; }
  .spinner {
    width: 16px; height: 16px;
    border: 2px solid rgba(255,255,255,0.35); border-top-color: white;
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Jobs list — rows inside the card share the same 14px 20px padding
     rhythm as Settings rows, so Downloader and Settings look siblings. */
  .empty {
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 30px 20px; text-align: center;
  }

  .job-row {
    width: 100%; text-align: left;
    display: flex; align-items: center; gap: 10px;
    padding: 12px 20px;
    color: var(--ink);
    background: transparent;
    transition: background 0.15s;
  }
  .job-row:hover { background: color-mix(in oklab, var(--hairline) 30%, transparent); }
  .job-divider { margin-left: 20px; }

  .status-dot {
    width: 10px; height: 10px; border-radius: 50%;
    flex-shrink: 0;
  }
  .job-text { flex: 1; min-width: 0; }
  .job-title {
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .job-sub {
    font-size: 10px; color: var(--graphite);
    font-family: var(--font-mono);
    margin-top: 2px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .bar {
    height: 3px; background: var(--hairline); border-radius: 2px;
    margin-top: 4px;
  }
  .bar > span {
    display: block; height: 100%; background: var(--accent);
    border-radius: 2px; transition: width 0.3s;
  }
  .pct { font-size: 11px; color: var(--accent); }
  .mono { font-family: var(--font-mono); }

  .tracks {
    display: flex; flex-direction: column;
    background: color-mix(in oklab, var(--paper) 50%, transparent);
  }
  .track {
    display: flex; align-items: center; gap: 10px;
    padding: 6px 20px 6px 32px;
  }
  .t-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .t-idx { font-size: 10px; color: var(--graphite); width: 26px; text-align: right; }
  .t-text { flex: 1; min-width: 0; }
  .t-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
  .t-state { font-size: 9px; font-weight: 700; letter-spacing: 0.06em; }

  .no-tracks {
    padding: 12px 20px; text-align: center;
    background: color-mix(in oklab, var(--paper) 50%, transparent);
  }

  .toast {
    position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%);
    background: var(--ink); color: var(--paper);
    padding: 10px 16px; border-radius: 999px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    z-index: 100;
  }
</style>
