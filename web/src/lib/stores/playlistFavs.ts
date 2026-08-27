/** Local playlist favourites — mirrors PlaylistFavorites in the Swift app.
 *
 * Not backed by Navidrome (which doesn't have a native "starred playlists"
 * concept). Just a Set of playlist ids persisted to localStorage. */
import { writable } from 'svelte/store'

const KEY = 'geethub.favouritePlaylists'

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return new Set(JSON.parse(raw) as string[])
  } catch (_) {}
  return new Set()
}

function persist(s: Set<string>) {
  try { localStorage.setItem(KEY, JSON.stringify([...s])) } catch (_) {}
}

function create() {
  const s = writable<Set<string>>(load())
  return {
    subscribe: s.subscribe,
    toggle(id: string) {
      s.update((set) => {
        const next = new Set(set)
        if (next.has(id)) next.delete(id); else next.add(id)
        persist(next)
        return next
      })
    },
    has(id: string): boolean {
      let out = false
      s.subscribe((set) => out = set.has(id))()   // read once, then unsubscribe
      return out
    },
  }
}

export const playlistFavs = create()
