<script lang="ts">
  /** Host-side modal: mints a guest session, renders the QR the passenger
   * scans, and offers "End Session" to revoke immediately. */
  import { onMount, onDestroy } from 'svelte'
  import QRCode from 'qrcode'
  import { session } from '../stores/session'
  import { player } from '../stores/player'

  interface Props { onClose: () => void }
  let { onClose }: Props = $props()

  let token = $state<string | null>(null)
  let expiresAt = $state<number>(0)
  let url = $state('')
  let error = $state<string | null>(null)
  let canvasEl: HTMLCanvasElement | null = $state(null)
  let now = $state(Date.now() / 1000)
  let tick: number | null = null

  onMount(async () => {
    tick = window.setInterval(() => { now = Date.now() / 1000 }, 1000)
    try {
      const client = $session.client
      if (!client) throw new Error('not signed in')
      const s = await client.createGuestSession($player.deviceId)
      token = s.token
      expiresAt = s.expiresAt
      url = `${location.origin}/guest/${encodeURIComponent(s.token)}`
    } catch (_) {
      error = 'Could not start guest session.'
    }
  })

  // Render the QR once we have both the URL and the canvas element on-screen.
  $effect(() => {
    if (!url || !canvasEl) return
    QRCode.toCanvas(canvasEl, url, { width: 260, margin: 1,
      color: { dark: '#111', light: '#ffffff' } }).catch(() => { error = 'QR failed to render' })
  })

  async function endSession() {
    const t = token
    token = null
    if (t) { try { await $session.client?.revokeGuestSession(t) } catch (_) {} }
    onClose()
  }

  onDestroy(() => { if (tick != null) window.clearInterval(tick) })

  const remaining = $derived(Math.max(0, Math.floor(expiresAt - now)))
  const remainingLabel = $derived.by(() => {
    if (!expiresAt) return ''
    const m = Math.floor(remaining / 60), s = remaining % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  })
</script>

<div class="backdrop" onclick={onClose} role="none">
  <div class="card" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Guest QR">
    <button class="x" onclick={onClose} aria-label="Close">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
    </button>
    <div class="retro retro-xl title">Guest Request</div>
    <div class="retro retro-sm retro-graphite sub">
      Ask a passenger to scan — they'll be able to play songs on this device.
    </div>

    {#if error}
      <div class="error retro retro-sm">{error}</div>
    {:else if !token}
      <div class="loading retro retro-sm retro-graphite">Opening session…</div>
    {:else}
      <div class="qr-wrap">
        <canvas bind:this={canvasEl} width="260" height="260"></canvas>
      </div>
      <div class="url mono">{url}</div>
      <div class="retro retro-sm retro-graphite meta">
        Session ends in {remainingLabel}
      </div>
      <button class="end retro retro-sm retro-medium" onclick={endSession}>End Guest Session</button>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0; z-index: 50;
    background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
  }
  .card {
    position: relative;
    background: var(--paper);
    border: 1px solid var(--hairline); border-radius: 16px;
    padding: 28px 24px 20px;
    max-width: 340px; width: 100%;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    box-shadow: 0 24px 60px rgba(0,0,0,0.25);
  }
  .x {
    position: absolute; top: 8px; right: 8px;
    width: 36px; height: 36px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    color: var(--graphite); background: transparent; border: 0;
  }
  .x:hover { background: color-mix(in oklab, var(--hairline) 60%, transparent); }
  .title { color: var(--ink); }
  .sub { text-align: center; padding: 0 4px; }
  .qr-wrap {
    background: white;
    padding: 12px; border-radius: 12px; border: 1px solid var(--hairline);
    margin: 8px 0 6px;
  }
  .url {
    font-size: 10px; color: var(--graphite);
    word-break: break-all; text-align: center; padding: 0 6px;
  }
  .meta { margin-top: 6px; }
  .end {
    margin-top: 14px; padding: 10px 18px;
    background: var(--ink); color: var(--paper);
    border: 0; border-radius: 999px;
  }
  .end:hover { opacity: 0.85; }
  .error, .loading { padding: 30px 0; text-align: center; }
  .error { color: #e64444; }
  .mono { font-family: var(--font-mono); }
</style>
