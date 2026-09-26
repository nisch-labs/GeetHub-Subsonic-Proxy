<script lang="ts">
  // Mobile-only mini now-playing bar. Sits above the bottom tab bar; tapping it
  // opens the full-screen now-playing sheet (PlayerDock in overlay mode).
  //
  // When local is idle but another signed-in device is playing, the bar
  // surfaces that state instead — tap grabs the playback (queue-preserving,
  // ~3s round trip while the holder responds to the transferTo command).
  import { player, currentSongOf, remotePlayingDeviceOf } from '../stores/player'
  import { nowPlayingOpen } from '../stores/nowPlaying'
  import { virtualSource } from '../subsonic/models'
  import Artwork from './Artwork.svelte'

  const current = $derived(currentSongOf($player))
  const remote = $derived(current ? undefined : remotePlayingDeviceOf($player))
  const knownDuration = $derived(isFinite($player.duration) && $player.duration > 0 ? $player.duration : 0)
  const progress = $derived(knownDuration > 0 ? Math.min(1, Math.max(0, $player.currentTime / knownDuration)) : 0)

  let grabbing = $state(false)

  function open() { nowPlayingOpen.set(true) }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
  }
  function grab() {
    if (!remote || grabbing) return
    grabbing = true
    player.grabFromDevice(remote.id)
    // Auto-clear after ~5s so a lost/dropped command doesn't leave the bar
    // stuck in "Grabbing…". The next successful play command will replace
    // this bar with the normal local state anyway.
    setTimeout(() => { grabbing = false }, 5000)
  }
  function onGrabKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); grab() }
  }
</script>

{#if current}
  <div class="mini" role="button" tabindex="0" onclick={open} onkeydown={onKey}
       aria-label="Open now playing">
    <div class="mini-progress" style:width="{progress * 100}%"></div>
    <Artwork coverArt={current.coverArt} size={42} corner={8} />
    <div class="meta">
      <div class="mini-title">
        {#if virtualSource(current.id)}<span class="dot"></span>{/if}
        {current.title}
      </div>
      <div class="retro retro-light retro-graphite mini-sub">{current.artist ?? ''}</div>
    </div>
    <div class="controls">
      <button class="mc" onclick={(e) => { e.stopPropagation(); player.toggle() }}
              aria-label={$player.isPlaying ? 'Pause' : 'Play'}>
        {#if $player.isPlaying}
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M6 4v16l14-8z" /></svg>
        {/if}
      </button>
      <button class="mc" onclick={(e) => { e.stopPropagation(); player.next() }} aria-label="Next">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M16 6h2v12h-2zM4 6v12l9-6z" /></svg>
      </button>
    </div>
  </div>
{:else if remote && remote.currentSong}
  <div class="mini remote" role="button" tabindex="0" onclick={grab} onkeydown={onGrabKey}
       aria-label="Play here — grab from {remote.name}" aria-disabled={grabbing}>
    {#if remote.currentSong.coverArt}
      <Artwork coverArt={remote.currentSong.coverArt} size={42} corner={8} />
    {:else}
      <div class="remote-art">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--graphite)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
      </div>
    {/if}
    <div class="meta">
      <div class="mini-title">{remote.currentSong.title}</div>
      <div class="retro retro-light retro-graphite mini-sub">
        On {remote.name} · {remote.currentSong.artist ?? ''}
      </div>
    </div>
    <div class="controls">
      <div class="grab-pill" aria-hidden="true">
        {#if grabbing}
          <span class="spin white"></span>
          <span class="retro retro-sm retro-bold">Grabbing</span>
        {:else}
          <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          <span class="retro retro-sm retro-bold">Play Here</span>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  /* Hidden on desktop; the PlayerDock sidebar is the now-playing surface there. */
  .mini { display: none; }

  @media (max-width: 900px) {
    .mini {
      position: relative;
      display: flex; align-items: center; gap: 12px;
      width: 100%; box-sizing: border-box;
      padding: 8px 14px;
      background: var(--surface);
      border-top: 1px solid var(--hairline);
      color: var(--ink);
      text-align: left;
      cursor: pointer;
      order: 1;   /* between content (0) and the bottom nav (2) */
    }
  }

  .mini-progress {
    position: absolute; top: 0; left: 0; height: 2px;
    background: var(--accent);
    transition: width 0.2s linear;
  }

  .meta { flex: 1; min-width: 0; }
  .mini-title {
    font-family: var(--font-oswald); text-transform: uppercase;
    letter-spacing: 0.05em; font-weight: 600; font-size: 13px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    display: flex; align-items: center; gap: 6px;
  }
  .mini-sub {
    font-size: 10px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .dot {
    flex-shrink: 0;
    width: 7px; height: 7px; border-radius: 50%;
    background: rgb(230, 33, 33);
  }

  .controls { display: flex; align-items: center; gap: 4px; }
  .mc {
    width: 44px; height: 44px;
    display: flex; align-items: center; justify-content: center;
    color: var(--ink); border-radius: 10px; background: transparent;
  }
  .mc:active { background: color-mix(in oklab, var(--hairline) 60%, transparent); }

  /* Remote-playing state — visible on both mobile (as a full-width bar,
     via the mobile media query above) and desktop (as a floating pill
     bottom-right, since desktop's usual now-playing surface, PlayerDock,
     only renders while local has a current track). */
  .mini.remote { cursor: pointer; }
  .mini.remote[aria-disabled="true"] { opacity: 0.6; }
  .mini.remote:active { background: color-mix(in oklab, var(--accent) 8%, var(--surface)); }

  @media (min-width: 901px) {
    .mini.remote {
      display: flex; align-items: center; gap: 12px;
      position: fixed;
      bottom: 20px; right: 20px;
      width: min(360px, calc(100vw - 40px));
      padding: 10px 12px;
      background: var(--surface);
      border: 1px solid var(--hairline);
      border-radius: 14px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.16);
      z-index: 100;
    }
  }
  .remote-art {
    width: 42px; height: 42px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    background: var(--surface); border: 1px solid var(--hairline);
    flex-shrink: 0;
  }
  .grab-pill {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 13px;
    background: var(--accent); color: white;
    border-radius: 999px;
    white-space: nowrap;
    box-shadow: 0 2px 8px color-mix(in oklab, var(--accent) 30%, transparent);
  }
  .spin {
    width: 12px; height: 12px;
    border: 2px solid color-mix(in oklab, var(--accent) 30%, transparent);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  .spin.white {
    border-color: color-mix(in oklab, white 40%, transparent);
    border-top-color: white;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
