/** Multi-server session — mirrors GeetHubKit's Session.
 *
 * State lives in a Svelte writable store; the source of truth for credentials
 * is localStorage under `geethub.servers`. Passwords are stored in cleartext
 * — same trust model as the app's Keychain: this device is trusted. Users on
 * shared machines should not "remember" credentials in a browser regardless. */
import { writable, get, type Readable } from 'svelte/store'
import { SubsonicClient, SubsonicAPIError } from '../subsonic/client'
import type { Credentials } from '../subsonic/credentials'

export interface SavedServer {
  id: string
  label: string
  credentials: Credentials
}
export interface SavedServers {
  activeId: string | null
  servers: SavedServer[]
}

export type ConnState =
  | { kind: 'signedOut' }
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'failed'; message: string }

export interface SessionState {
  state: ConnState
  servers: SavedServer[]
  activeId: string | null
  client: SubsonicClient | null
}

const STORAGE_KEY = 'geethub.servers'
const CLIENT_NAME = 'GeetHub Web'

function loadEnvelope(): SavedServers {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch (_) { /* corrupted storage — start fresh */ }
  return { activeId: null, servers: [] }
}

function persist(env: SavedServers) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(env)) } catch (_) {}
}

function makeClient(server: SavedServer): SubsonicClient {
  return new SubsonicClient(server.credentials)
}

function newId(): string {
  return crypto.randomUUID()
}

function normalizeURL(raw: string): string | null {
  let s = raw.trim()
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s
  s = s.replace(/\/+$/, '')
  try {
    const u = new URL(s)
    if (!u.host) return null
    return s
  } catch (_) { return null }
}

function describe(err: unknown): string {
  if (err instanceof SubsonicAPIError) return err.message
  if (err instanceof TypeError) return "Couldn't reach the server."
  return String((err as Error)?.message ?? err)
}

// ─── Store construction ─────────────────────────────────────────

function createSession() {
  const env = loadEnvelope()
  const active = env.servers.find((s) => s.id === env.activeId) ?? null
  const initial: SessionState = {
    state: active ? { kind: 'connected' } : { kind: 'signedOut' },
    servers: env.servers,
    activeId: env.activeId,
    client: active ? makeClient(active) : null,
  }
  const { subscribe, update, set } = writable<SessionState>(initial)

  function commit(mut: (s: SessionState) => SessionState) {
    update((s) => {
      const next = mut(s)
      persist({ activeId: next.activeId, servers: next.servers })
      return next
    })
  }

  async function connect(input: {
    urlString: string; username: string; password: string; label?: string
  }): Promise<boolean> {
    const url = normalizeURL(input.urlString)
    if (!url) {
      update((s) => ({ ...s, state: { kind: 'failed', message: "That doesn't look like a valid server URL." } }))
      return false
    }
    update((s) => ({ ...s, state: { kind: 'connecting' } }))

    const creds: Credentials = {
      baseURL: url, username: input.username, password: input.password, clientName: CLIENT_NAME,
    }
    const client = new SubsonicClient(creds)
    try {
      await client.ping()
      const server: SavedServer = {
        id: newId(),
        label: input.label && input.label.trim() ? input.label.trim() : (new URL(url).host || 'Server'),
        credentials: creds,
      }
      commit((s) => ({
        state: { kind: 'connected' },
        servers: [...s.servers, server],
        activeId: server.id,
        client,
      }))
      return true
    } catch (err) {
      update((s) => ({ ...s, state: { kind: 'failed', message: describe(err) } }))
      return false
    }
  }

  function switchServer(id: string) {
    commit((s) => {
      const target = s.servers.find((x) => x.id === id)
      if (!target) return s
      return { ...s, state: { kind: 'connected' }, activeId: id, client: makeClient(target) }
    })
  }

  async function updateServer(input: {
    id: string; label: string; urlString: string; username: string; password: string
  }): Promise<boolean> {
    const url = normalizeURL(input.urlString)
    if (!url) return false
    const creds: Credentials = { baseURL: url, username: input.username, password: input.password, clientName: CLIENT_NAME }
    const client = new SubsonicClient(creds)
    try {
      await client.ping()
      commit((s) => {
        const servers = s.servers.map((x) =>
          x.id === input.id
            ? { ...x, label: input.label.trim() || (new URL(url).host || 'Server'), credentials: creds }
            : x,
        )
        return {
          ...s,
          servers,
          client: s.activeId === input.id ? client : s.client,
          state: s.activeId === input.id ? { kind: 'connected' } : s.state,
        }
      })
      return true
    } catch (_) {
      return false
    }
  }

  function removeServer(id: string) {
    commit((s) => {
      const servers = s.servers.filter((x) => x.id !== id)
      if (s.activeId !== id) return { ...s, servers }
      const next = servers[0]
      if (next) return {
        state: { kind: 'connected' as const }, servers, activeId: next.id, client: makeClient(next),
      }
      return { state: { kind: 'signedOut' as const }, servers, activeId: null, client: null }
    })
  }

  function signOut() {
    commit(() => ({ state: { kind: 'signedOut' }, servers: [], activeId: null, client: null }))
  }

  return {
    subscribe,
    connect, switchServer, updateServer, removeServer, signOut,
  }
}

export const session = createSession()

/** Convenience: read the current SubsonicClient (or throw if signed out). */
export function requireClient(): SubsonicClient {
  const s = get(session)
  if (!s.client) throw new Error('No active server')
  return s.client
}

/** Read-only alias for typed subscriptions in components. */
export const sessionStore: Readable<SessionState> = session
