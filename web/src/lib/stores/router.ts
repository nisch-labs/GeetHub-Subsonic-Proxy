/** Tiny page-based router — no library.
 *
 * The app has ~5 top-level tabs and a handful of detail pages. Instead of
 * pulling in svelte-navigator or SvelteKit's router, we keep the current
 * "page" as a discriminated union in a Svelte store and let components
 * read/write it directly. Deep-linking / browser back is handled through
 * history.pushState in `navigate`. */
import { writable } from 'svelte/store'

export type Route =
  | { name: 'home' }
  | { name: 'library'; tab?: 0 | 1 | 2 | 3 }
  | { name: 'favourites' }
  | { name: 'search' }
  | { name: 'downloader' }
  | { name: 'settings' }
  | { name: 'album'; id: string }
  | { name: 'artist'; id: string }
  | { name: 'playlist'; id: string }
  | { name: 'guest'; token: string }

function fromHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  const [name, ...rest] = raw.split('/')
  switch (name) {
    case 'library':    return { name: 'library', tab: Number(rest[0]) as any }
    case 'favourites': return { name: 'favourites' }
    case 'search':     return { name: 'search' }
    case 'downloader': return { name: 'downloader' }
    case 'settings':   return { name: 'settings' }
    case 'album':      return rest[0] ? { name: 'album',    id: rest[0] } : { name: 'home' }
    case 'artist':     return rest[0] ? { name: 'artist',   id: rest[0] } : { name: 'home' }
    case 'playlist':   return rest[0] ? { name: 'playlist', id: rest[0] } : { name: 'home' }
    default:           return { name: 'home' }
  }
}

function toHash(r: Route): string {
  switch (r.name) {
    case 'home':       return '#/'
    case 'library':    return r.tab != null ? `#/library/${r.tab}` : '#/library'
    case 'favourites': return '#/favourites'
    case 'search':     return '#/search'
    case 'downloader': return '#/downloader'
    case 'settings':   return '#/settings'
    case 'album':      return `#/album/${r.id}`
    case 'artist':     return `#/artist/${r.id}`
    case 'playlist':   return `#/playlist/${r.id}`
    case 'guest':      return `/guest/${r.token}`
  }
}

/** Guest URLs are path-based (`/guest/<token>`) rather than hash-based so a
 * passenger scanning a QR sees a clean URL. Detect at boot and bypass the
 * usual hash router — guests are terminal, they never navigate elsewhere. */
function guestFromPath(): Route | null {
  const m = location.pathname.match(/^\/guest\/([^\/?#]+)/)
  return m ? { name: 'guest', token: decodeURIComponent(m[1]) } : null
}

export const route = writable<Route>(guestFromPath() ?? fromHash(location.hash))

export function navigate(next: Route, push = true) {
  const hash = toHash(next)
  if (push && location.hash !== hash) {
    history.pushState({}, '', hash)
  }
  route.set(next)
}

window.addEventListener('hashchange', () => route.set(fromHash(location.hash)))
window.addEventListener('popstate', () => route.set(fromHash(location.hash)))
