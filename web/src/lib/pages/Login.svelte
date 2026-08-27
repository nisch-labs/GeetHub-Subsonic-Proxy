<script lang="ts">
  import { session } from '../stores/session'

  let urlString = $state(window.location.origin)
  let username = $state('')
  let password = $state('')
  let busy = $state(false)

  let canSubmit = $derived(urlString.trim().length > 0 && username.trim().length > 0)

  async function submit(e: SubmitEvent) {
    e.preventDefault()
    if (!canSubmit || busy) return
    busy = true
    await session.connect({ urlString, username, password })
    busy = false
  }
</script>

<form class="login" onsubmit={submit}>
  <div class="mark">
    <svg viewBox="0 0 24 24" width="64" height="64" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="var(--accent)" stroke-width="1.5" />
      <circle cx="12" cy="12" r="4"  fill="none" stroke="var(--accent)" stroke-width="1.5" />
      <circle cx="12" cy="12" r="1.2" fill="var(--accent)" />
    </svg>
  </div>
  <div class="title">
    <div class="retro retro-hero">Geet-Hub</div>
    <div class="retro retro-sm retro-light retro-graphite">Your records, anywhere</div>
  </div>

  <div class="fields">
    <label class="row">
      <span class="retro retro-sm retro-graphite">Server</span>
      <input type="url" bind:value={urlString} autocomplete="off" autocapitalize="none" spellcheck="false" />
    </label>
    <div class="hairline"></div>
    <label class="row">
      <span class="retro retro-sm retro-graphite">User</span>
      <input type="text" bind:value={username} autocomplete="username" autocapitalize="none" spellcheck="false" />
    </label>
    <div class="hairline"></div>
    <label class="row">
      <span class="retro retro-sm retro-graphite">Password</span>
      <input type="password" bind:value={password} autocomplete="current-password" />
    </label>
  </div>

  {#if $session.state.kind === 'failed'}
    <div class="retro retro-sm retro-accent error">{$session.state.message}</div>
  {/if}

  <button type="submit" class="submit" disabled={!canSubmit || busy}
          style:background={canSubmit && !busy ? 'var(--accent)' : 'var(--graphite)'}>
    {#if busy}<span class="spinner"></span>{:else}<span class="retro retro-lg" style="color: white;">Log in</span>{/if}
  </button>
</form>

<style>
  .login {
    max-width: 460px;
    margin: 0 auto;
    padding: 40px 28px;
    display: flex; flex-direction: column; align-items: stretch; gap: 22px;
    min-height: 100svh;
    justify-content: center;
  }
  .mark { display: flex; justify-content: center; }
  .title { text-align: center; }
  .title > *:first-child { margin-bottom: 4px; }

  .fields {
    background: var(--surface);
    border: 1px solid var(--hairline);
  }
  .row {
    display: flex; align-items: center; gap: 12px;
    padding: 15px 16px;
  }
  .row > span { width: 82px; }
  .row > input {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 15px;
  }

  .error { text-align: center; }

  .submit {
    padding: 15px 0;
    color: white;
    letter-spacing: 0.25em;
    transition: background 0.15s;
  }
  .submit:disabled { cursor: not-allowed; }

  .spinner {
    display: inline-block; width: 18px; height: 18px;
    border: 2px solid rgba(255,255,255,0.35);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
