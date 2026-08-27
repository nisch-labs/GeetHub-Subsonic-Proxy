<script lang="ts">
  import { player, currentSongOf } from '../stores/player'
  import { session } from '../stores/session'
  import { virtualSource, shortLabel, type LyricLine } from '../subsonic/models'
  import Artwork from './Artwork.svelte'

  const current = $derived(currentSongOf($player))
  // Chunked streams (YouTube transcodes) report duration = Infinity — the
  // scrubber and remaining-time need a sensible fallback in that case.
  const knownDuration = $derived(isFinite($player.duration) && $player.duration > 0 ? $player.duration : 0)
  const progress = $derived(knownDuration > 0 ? $player.currentTime / knownDuration : 0)
  // Reactive favourite state — reads favoriteOverride from the store so the
  // heart re-renders the moment `toggleFavorite` mutates it (calling
  // `player.isFavorite(...)` from a template isn't reactive).
  const isFav = $derived(
    !!current && ($player.favoriteOverride[current.id] ?? !!current.starred),
  )

  const artURL = $derived.by(() => {
    if (!current?.coverArt || !$session.client) return ''
    return $session.client.coverArtURL(current.coverArt, 512)
  })

  const upNext = $derived.by(() => {
    if (!$player.queue.length) return []
    if ($player.isShuffled && $player.shuffleOrder) {
      // Songs remaining in the shuffled order.
      return $player.shuffleOrder.slice($player.index + 1).map((i) => $player.queue[i])
    }
    return $player.queue.slice($player.index + 1)
  })

  function jumpFromUpNext(relIndex: number) {
    if ($player.isShuffled && $player.shuffleOrder) {
      const real = $player.shuffleOrder[$player.index + 1 + relIndex]
      if (real != null) player.jumpTo(real)
    } else {
      player.jumpTo($player.index + 1 + relIndex)
    }
  }

  function fmt(t: number): string {
    if (!isFinite(t) || t < 0) return '--:--'
    const s = Math.floor(t)
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
  }

  function onScrub(e: Event) {
    player.seek(Number((e.currentTarget as HTMLInputElement).value))
  }

  function onVolume(e: Event) {
    player.setVolume(Number((e.currentTarget as HTMLInputElement).value))
  }

  type Tab = 'upNext' | 'lyrics'
  let tab = $state<Tab>('upNext')

  // Devices popover state
  let devicesOpen = $state(false)

  function openDevices() {
    devicesOpen = !devicesOpen
    if (devicesOpen) player.refreshDevices()
  }
  function pickDevice(id: string) {
    devicesOpen = false
    if (id !== $player.deviceId) player.transferToDevice(id)
  }

  function deviceIcon(kind: string): string {
    switch (kind) {
      case 'iphone': return 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm5 17v.5'
      case 'ipad':   return 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm7 15v.5'
      case 'mac':    return 'M3 5h18v11H3zM2 20h20l-2-2H4z'
      case 'web':    return 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18'
      default:       return 'M4 8v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8'
    }
  }

  // Lyrics — fetched on demand for the current song.
  let lyrics = $state<LyricLine[] | null>(null)
  let lyricsFor = $state<string | null>(null)
  let lyricsLoading = $state(false)

  $effect(() => {
    if (tab !== 'lyrics' || !current) return
    if (lyricsFor === current.id) return
    const id = current.id
    lyricsFor = id
    lyricsLoading = true
    lyrics = null
    $session.client?.lyrics(id)
      .then((lines) => { if (lyricsFor === id) lyrics = lines })
      .catch(() => { if (lyricsFor === id) lyrics = [] })
      .finally(() => { if (lyricsFor === id) lyricsLoading = false })
  })

  // Progress arc geometry.
  const RING = 240, R = 110
  const C = 2 * Math.PI * R
</script>

{#if current}
  <aside class="dock" aria-label="Now playing">
    <header>
      <span class="retro retro-sm retro-graphite">Now Playing</span>
      <div class="spacer"></div>
      <div class="devices-wrap">
        <button class="hdr-btn" onclick={openDevices} aria-label="Devices">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 5h16v10H4zM8 19h8M12 15v4"/>
          </svg>
        </button>
        {#if devicesOpen}
          <div class="devices-popover" onclick={(e) => e.stopPropagation()} role="none">
            <div class="devices-title retro retro-sm retro-medium retro-graphite">Play on…</div>
            {#if $player.devices.length === 0}
              <div class="devices-empty retro retro-sm retro-light retro-graphite">
                No other devices signed in.
              </div>
            {:else}
              {#each $player.devices as d}
                {@const isSelf = d.id === $player.deviceId}
                <button class="device-row" class:on={d.isPlaying} disabled={isSelf}
                        onclick={() => pickDevice(d.id)}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
                       stroke={d.isPlaying ? 'var(--accent)' : 'var(--ink)'}
                       stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                    <path d={deviceIcon(d.kind)}/>
                  </svg>
                  <div class="device-text">
                    <div class="retro retro-sm retro-medium">
                      {d.name}
                      {#if isSelf}
                        <span class="retro retro-sm retro-light retro-graphite"> · this device</span>
                      {/if}
                    </div>
                    {#if d.isPlaying}
                      <div class="retro retro-sm retro-light retro-accent">Playing</div>
                    {/if}
                  </div>
                </button>
              {/each}
            {/if}
          </div>
        {/if}
      </div>
      {#if virtualSource(current.id) && !$player.savedYouTube.has(current.id)}
        <button class="hdr-btn" onclick={player.saveCurrentToLibrary} aria-label="Save to library">
          {#if $player.downloads[current.id] != null}
            <span class="ring-mini">{$player.downloads[current.id]}%</span>
          {:else}
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 3v13m-5-5 5 5 5-5M4 21h16" /></svg>
          {/if}
        </button>
      {:else}
        <button class="hdr-btn" onclick={player.toggleFavorite} aria-label="Favourite">
          <svg viewBox="0 0 24 24" width="18" height="18"
               fill={isFav ? 'var(--accent)' : 'none'}
               stroke={isFav ? 'var(--accent)' : 'currentColor'}
               stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6C19 16.5 12 21 12 21z" />
          </svg>
        </button>
      {/if}
    </header>

    <div class="record" style:--ring="{RING}px">
      <svg class="ring" viewBox="0 0 {RING} {RING}" aria-hidden="true">
        <circle cx={RING/2} cy={RING/2} r={R} fill="none" stroke="var(--hairline)" stroke-width="4" />
        <circle cx={RING/2} cy={RING/2} r={R} fill="none" stroke="var(--accent)" stroke-width="4"
                stroke-linecap="round"
                stroke-dasharray={C}
                stroke-dashoffset={C * (1 - Math.min(Math.max(progress, 0), 1))}
                transform="rotate(-90 {RING/2} {RING/2})" />
      </svg>
      <div class="vinyl" class:spin={$player.isPlaying}>
        <div class="black-rim"></div>
        {#if artURL}<img class="art" src={artURL} alt="" />{:else}<div class="art no-art"></div>{/if}
        <div class="label-ring"></div>
        <div class="spindle"></div>
      </div>
    </div>

    <div class="info">
      {#if virtualSource(current.id) && !$player.savedYouTube.has(current.id)}
        <span class="tag">{shortLabel(virtualSource(current.id)!)}</span>
      {/if}
      <div class="retro retro-xl title">{current.title}</div>
      <div class="retro retro-sm retro-light retro-graphite">{current.artist ?? ''}</div>
    </div>

    <div class="scrubber">
      <input type="range" min="0" max={Math.max(1, knownDuration)} value={$player.currentTime}
             step="0.5" oninput={onScrub} aria-label="Seek"
             disabled={knownDuration === 0}
             style:--fill="{Math.min(100, Math.max(0, progress * 100))}%" />
      <div class="times mono">
        <span>{fmt($player.currentTime)}</span>
        {#if knownDuration > 0}
          <span>-{fmt(Math.max(0, knownDuration - $player.currentTime))}</span>
        {:else}
          <span class="live">LIVE</span>
        {/if}
      </div>
    </div>

    <div class="transport">
      <button class="t-btn" onclick={player.previous} aria-label="Previous">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 6h2v12H6zm14 0-9 6 9 6z" /></svg>
      </button>
      <button class="t-btn play" onclick={player.toggle} aria-label={$player.isPlaying ? 'Pause' : 'Play'}>
        {#if $player.isPlaying}
          <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M6 4v16l14-8z" /></svg>
        {/if}
      </button>
      <button class="t-btn" onclick={player.next} aria-label="Next">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M16 6h2v12h-2zM4 6v12l9-6z" /></svg>
      </button>
    </div>

    <div class="volume">
      <button class="v-btn" onclick={() => player.setVolume(0)} aria-label="Mute">
        {#if $player.volume === 0}
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6"/></svg>
        {:else}
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4z"/></svg>
        {/if}
      </button>
      <input type="range" min="0" max="1" step="0.01" value={$player.volume}
             oninput={onVolume} aria-label="Volume"
             style:--fill="{Math.round($player.volume * 100)}%" />
      <button class="v-btn" onclick={() => player.setVolume(1)} aria-label="Full volume">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4zM15 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></svg>
      </button>
    </div>

    <div class="secondary">
      <button class="icon-btn" class:on={$player.isShuffled} onclick={player.toggleShuffle} aria-label="Shuffle">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
        </svg>
      </button>
      <button class="icon-btn" class:on={$player.repeatMode !== 'off'} onclick={player.cycleRepeat}
              aria-label="Repeat" title={$player.repeatMode === 'one' ? 'Repeat one' : $player.repeatMode === 'all' ? 'Repeat all' : 'Repeat off'}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" />
          {#if $player.repeatMode === 'one'}
            <text x="12" y="15" text-anchor="middle" font-size="7" fill="currentColor" stroke="none">1</text>
          {/if}
        </svg>
      </button>
    </div>

    <div class="tabs" role="tablist">
      <button class="tab" class:on={tab === 'upNext'} onclick={() => tab = 'upNext'} role="tab" aria-selected={tab === 'upNext'}>
        <span class="retro retro-sm retro-medium">Up Next</span>
      </button>
      <button class="tab" class:on={tab === 'lyrics'} onclick={() => tab = 'lyrics'} role="tab" aria-selected={tab === 'lyrics'}>
        <span class="retro retro-sm retro-medium">Lyrics</span>
      </button>
    </div>

    <div class="panel" role="tabpanel">
      {#if tab === 'upNext'}
        {#if upNext.length === 0}
          <div class="empty retro retro-sm retro-light retro-graphite">No more songs queued.</div>
        {:else}
          <ol class="queue">
            {#each upNext as s, i}
              <li>
                <button class="q-row" onclick={() => jumpFromUpNext(i)}>
                  <Artwork coverArt={s.coverArt} size={36} corner={5} />
                  <div class="q-text">
                    <div class="retro q-title">{s.title}</div>
                    <div class="retro retro-light retro-graphite q-sub">{s.artist ?? ''}</div>
                  </div>
                  <span class="mono q-dur">{fmt(s.duration ?? 0)}</span>
                </button>
              </li>
            {/each}
          </ol>
        {/if}
      {:else}
        {#if lyricsLoading}
          <div class="empty retro retro-sm retro-light retro-graphite">Loading lyrics…</div>
        {:else if !lyrics || lyrics.length === 0}
          <div class="empty retro retro-sm retro-light retro-graphite">No lyrics for this track.</div>
        {:else}
          <div class="lyrics">
            {#each lyrics as l}
              <p>{l.value}</p>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  </aside>
{/if}

<style>
  .dock {
    width: 400px;
    flex-shrink: 0;
    height: 100svh;
    display: flex; flex-direction: column;
    background: var(--surface);
    border-left: 1px solid var(--hairline);
    overflow: hidden;
  }

  header {
    display: flex; align-items: center; gap: 12px;
    padding: 14px 20px 4px;
  }
  .spacer { flex: 1; }
  .hdr-btn {
    width: 36px; height: 36px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%; color: var(--ink);
  }
  .hdr-btn:hover { background: color-mix(in oklab, var(--hairline) 50%, transparent); }

  .devices-wrap { position: relative; }
  .devices-popover {
    position: absolute; top: calc(100% + 8px); right: 0;
    min-width: 240px;
    background: var(--surface); border: 1px solid var(--hairline);
    border-radius: 12px;
    box-shadow: 0 10px 28px rgba(0,0,0,0.15);
    padding: 6px;
    z-index: 20;
  }
  .devices-title { padding: 8px 10px 4px; }
  .devices-empty { padding: 10px; text-align: center; }
  .device-row {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px;
    width: 100%; text-align: left;
    color: var(--ink);
    border-radius: 8px;
    background: transparent;
  }
  .device-row:hover:not(:disabled) { background: color-mix(in oklab, var(--hairline) 40%, transparent); }
  .device-row:disabled { opacity: 0.6; cursor: default; }
  .device-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .ring-mini { font-family: var(--font-mono); font-size: 11px; color: var(--accent); }

  .record {
    width: var(--ring); height: var(--ring);
    margin: 6px auto 4px;
    position: relative;
  }
  .ring { position: absolute; inset: 0; }
  .vinyl {
    position: absolute;
    inset: calc((var(--ring) - 200px) / 2);
    width: 200px; height: 200px;
    border-radius: 50%;
  }
  .vinyl.spin { animation: spin 14s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .black-rim { position: absolute; inset: -5px; border-radius: 50%; background: black; }
  .art {
    position: absolute; inset: 0;
    border-radius: 50%;
    object-fit: cover;
    width: 100%; height: 100%;
    box-shadow: 0 10px 24px rgba(0,0,0,0.35);
  }
  .no-art { background: var(--surface); }
  .label-ring {
    position: absolute; inset: 50% 50% 50% 50%;
    width: 72px; height: 72px; margin: -36px 0 0 -36px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.4);
  }
  .spindle {
    position: absolute; inset: 50% 50% 50% 50%;
    width: 22px; height: 22px; margin: -11px 0 0 -11px;
    border-radius: 50%;
    background: var(--surface);
    border: 1px solid var(--hairline);
    box-shadow: inset 0 0 0 6px var(--surface), inset 0 0 0 7px color-mix(in oklab, var(--ink) 80%, transparent);
  }

  .info { padding: 4px 24px 8px; }
  .info .title { font-size: 18px; }
  .tag {
    display: inline-block;
    padding: 3px 8px;
    background: rgb(230, 33, 33);
    color: white;
    font-family: var(--font-oswald);
    font-weight: 600; font-size: 9px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border-radius: 5px;
    margin-bottom: 6px;
  }

  .scrubber { padding: 2px 24px 8px; }
  .scrubber input[type=range] {
    width: 100%; -webkit-appearance: none; appearance: none;
    background: transparent; height: 18px;
  }
  /* WebKit/Blink: the "already played" fill is painted via a two-stop gradient
     on the runnable track — no native progress pseudo-element exists there. */
  .scrubber input[type=range]::-webkit-slider-runnable-track {
    height: 3px; border-radius: 2px;
    background: linear-gradient(to right,
      var(--accent) 0 var(--fill, 0%),
      var(--hairline) var(--fill, 0%) 100%);
  }
  /* Firefox: use the native ::-moz-range-progress that fills up to the thumb. */
  .scrubber input[type=range]::-moz-range-track {
    height: 3px; background: var(--hairline); border-radius: 2px;
  }
  .scrubber input[type=range]::-moz-range-progress {
    height: 3px; background: var(--accent); border-radius: 2px;
  }
  .scrubber input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 12px; height: 12px; border-radius: 50%;
    background: var(--accent); margin-top: -4.5px; border: none;
  }
  .scrubber input[type=range]::-moz-range-thumb {
    width: 12px; height: 12px; border-radius: 50%; background: var(--accent); border: none;
  }
  .times {
    display: flex; justify-content: space-between;
    font-family: var(--font-mono); font-size: 12px; color: var(--graphite); margin-top: 4px;
  }
  .times .live {
    color: var(--accent); font-family: var(--font-oswald);
    text-transform: uppercase; letter-spacing: 0.15em;
    font-weight: 700; font-size: 10px;
  }

  .transport {
    display: flex; align-items: center;
    padding: 4px 24px 8px;
    justify-content: space-between;
  }
  .t-btn {
    width: 60px; height: 44px;
    display: flex; align-items: center; justify-content: center;
    color: var(--ink);
    border-radius: 8px;
  }
  .t-btn:hover { background: color-mix(in oklab, var(--hairline) 50%, transparent); }
  .t-btn.play { color: var(--accent); }

  .volume {
    display: flex; align-items: center; gap: 10px;
    padding: 0 24px 6px;
    color: var(--graphite);
  }
  .v-btn {
    width: 24px; height: 24px;
    display: flex; align-items: center; justify-content: center;
    color: var(--graphite);
    border-radius: 6px;
  }
  .v-btn:hover { color: var(--ink); }
  .volume input[type=range] {
    flex: 1; -webkit-appearance: none; appearance: none;
    background: transparent; height: 18px;
  }
  .volume input[type=range]::-webkit-slider-runnable-track {
    height: 3px; border-radius: 2px;
    background: linear-gradient(to right,
      var(--accent) 0 var(--fill, 0%),
      var(--hairline) var(--fill, 0%) 100%);
  }
  .volume input[type=range]::-moz-range-track {
    height: 3px; background: var(--hairline); border-radius: 2px;
  }
  .volume input[type=range]::-moz-range-progress {
    height: 3px; background: var(--accent); border-radius: 2px;
  }
  .volume input[type=range]::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--accent); margin-top: -3.5px; border: none;
  }
  .volume input[type=range]::-moz-range-thumb {
    width: 10px; height: 10px; border-radius: 50%; background: var(--accent); border: none;
  }

  .secondary {
    display: flex; justify-content: center; gap: 22px;
    padding: 2px 0 8px;
  }
  .icon-btn {
    width: 40px; height: 32px;
    display: flex; align-items: center; justify-content: center;
    color: var(--graphite); border-radius: 8px;
  }
  .icon-btn.on { color: var(--accent); }
  .icon-btn:hover { background: color-mix(in oklab, var(--hairline) 50%, transparent); }

  .tabs {
    display: flex;
    border-top: 1px solid var(--hairline);
    border-bottom: 1px solid var(--hairline);
    background: color-mix(in oklab, var(--paper) 60%, transparent);
  }
  .tab {
    flex: 1;
    padding: 10px 12px;
    display: flex; align-items: center; justify-content: center; gap: 6px;
    color: var(--graphite);
    border-bottom: 2px solid transparent;
  }
  .tab.on { color: var(--accent); border-bottom-color: var(--accent); }
  .panel { flex: 1; overflow-y: auto; }
  .empty { padding: 30px 20px; text-align: center; }

  .queue { list-style: none; margin: 0; padding: 4px 0; display: flex; flex-direction: column; }
  .queue li { border-bottom: 1px solid var(--hairline); }
  .q-row {
    width: 100%; text-align: left;
    display: flex; align-items: center; gap: 10px;
    padding: 6px 20px;
    color: var(--ink);
    transition: background 0.12s;
  }
  .q-row:hover { background: color-mix(in oklab, var(--hairline) 50%, transparent); }
  .q-text { flex: 1; min-width: 0; }
  .q-title {
    font-size: 12px; font-family: var(--font-oswald); text-transform: uppercase;
    letter-spacing: 0.06em; font-weight: 600;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .q-sub {
    font-size: 9px; font-family: var(--font-oswald); text-transform: uppercase;
    letter-spacing: 0.07em; font-weight: 300;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .q-dur, .mono { font-family: var(--font-mono); font-size: 11px; color: var(--graphite); }

  .lyrics { padding: 12px 24px 24px; }
  .lyrics p {
    margin: 0 0 6px;
    line-height: 1.55; font-size: 14px; color: var(--ink);
  }

  /* On narrow screens, drop the dock (mobile handling is a follow-up). */
  @media (max-width: 900px) {
    .dock { display: none; }
  }
</style>
