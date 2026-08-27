<script lang="ts">
  import { session, type SavedServer } from '../stores/session'

  interface Props { server: SavedServer; onclose: () => void }
  let { server, onclose }: Props = $props()

  let label = $state(server.label)
  let urlString = $state(server.credentials.baseURL)
  let username = $state(server.credentials.username)
  // Password field starts empty — blank means "keep the existing one".
  let password = $state('')
  let busy = $state(false)
  let error = $state<string | null>(null)
  let confirmRemove = $state(false)

  let canSubmit = $derived(urlString.trim().length > 0 && username.trim().length > 0)

  async function save() {
    if (!canSubmit || busy) return
    busy = true; error = null
    const effective = password || server.credentials.password
    const ok = await session.updateServer({
      id: server.id, label, urlString, username, password: effective,
    })
    busy = false
    if (ok) onclose()
    else error = 'Server rejected those details.'
  }

  function remove() {
    session.removeServer(server.id)
    onclose()
  }
</script>

<div class="scrim" onclick={onclose}
     onkeydown={(e) => { if (e.key === 'Escape') onclose() }}
     role="presentation">
  <div class="sheet" onclick={(e) => e.stopPropagation()}
       role="dialog" aria-modal="true" tabindex="-1">
    <header>
      <span class="retro retro-xl">Edit Server</span>
      <button class="close" onclick={onclose} aria-label="Cancel">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </header>

    <form onsubmit={(e) => { e.preventDefault(); save() }}>
      <div class="fields">
        <label class="fr">
          <span class="retro retro-sm retro-graphite">Label</span>
          <input type="text" bind:value={label} />
        </label>
        <div class="hairline"></div>
        <label class="fr">
          <span class="retro retro-sm retro-graphite">Server</span>
          <input type="url" bind:value={urlString} autocomplete="off" spellcheck="false" />
        </label>
        <div class="hairline"></div>
        <label class="fr">
          <span class="retro retro-sm retro-graphite">User</span>
          <input type="text" bind:value={username} autocomplete="username" autocapitalize="none" spellcheck="false" />
        </label>
        <div class="hairline"></div>
        <label class="fr">
          <span class="retro retro-sm retro-graphite">Password</span>
          <input type="password" bind:value={password} placeholder="Leave blank to keep" autocomplete="new-password" />
        </label>
      </div>

      {#if error}<div class="err retro retro-sm retro-accent">{error}</div>{/if}

      <button class="submit" type="submit" disabled={!canSubmit || busy}
              style:background={canSubmit && !busy ? 'var(--accent)' : 'var(--graphite)'}>
        {#if busy}<span class="spin"></span>{:else}<span class="retro retro-md">Save Changes</span>{/if}
      </button>

      <button class="remove retro retro-sm retro-medium" type="button" onclick={() => confirmRemove = true}>
        Remove This Server
      </button>
    </form>
  </div>
</div>

{#if confirmRemove}
  <div class="scrim" onclick={() => confirmRemove = false}
       onkeydown={(e) => { if (e.key === 'Escape') confirmRemove = false }} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <div class="retro retro-md retro-bold">Remove "{server.label}"?</div>
      <div class="retro retro-sm retro-light retro-graphite" style="margin-top:8px">
        Its credentials will be forgotten from this device.
      </div>
      <div class="modal-actions">
        <button class="btn ghost" onclick={() => confirmRemove = false}>Cancel</button>
        <button class="btn danger" onclick={remove}>Remove</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center;
    z-index: 200;
  }
  .sheet {
    background: var(--paper); color: var(--ink);
    border-radius: 16px;
    padding: 20px 24px;
    width: min(460px, 92vw);
    box-shadow: 0 12px 40px rgba(0,0,0,0.3);
    display: flex; flex-direction: column; gap: 16px;
  }
  header { display: flex; align-items: center; justify-content: space-between; }
  header .retro-xl { color: var(--ink); }
  .close {
    width: 34px; height: 34px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    color: var(--ink);
  }
  .close:hover { background: color-mix(in oklab, var(--hairline) 60%, transparent); }

  form { display: flex; flex-direction: column; gap: 12px; }
  .fields {
    background: var(--surface); border: 1px solid var(--hairline);
    border-radius: 12px; padding: 4px 0;
  }
  .fr { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
  .fr > span { width: 82px; }
  .fr > input {
    flex: 1;
    font-family: var(--font-mono); font-size: 14px;
    color: var(--ink);
  }
  .hairline { background: var(--hairline); height: 1px; margin-left: 96px; }
  .err { text-align: center; }

  .submit {
    padding: 12px 20px; border-radius: 999px;
    color: white; letter-spacing: 0.08em;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .submit:disabled { cursor: not-allowed; }
  .spin {
    width: 16px; height: 16px;
    border: 2px solid rgba(255,255,255,0.35); border-top-color: white;
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .remove {
    align-self: center; padding: 8px 12px;
    color: #e64444; background: transparent;
  }

  .modal {
    background: var(--surface); color: var(--ink);
    border-radius: 14px; padding: 20px 22px;
    min-width: 320px; max-width: 92vw;
    box-shadow: 0 12px 40px rgba(0,0,0,0.3);
    z-index: 210;
  }
  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }
  .btn { padding: 8px 16px; border-radius: 999px; }
  .btn.ghost { background: transparent; color: var(--ink); border: 1px solid var(--hairline); }
  .btn.danger { background: #e64444; color: white; }
  .btn.ghost:hover { background: color-mix(in oklab, var(--hairline) 60%, transparent); }
  .btn.danger:hover { filter: brightness(1.05); }
</style>
