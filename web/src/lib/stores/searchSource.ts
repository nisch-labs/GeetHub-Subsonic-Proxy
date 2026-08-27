/** Persisted YouTube search source — mirrors the app's @AppStorage("ytSearchSource").
 * Two-way binding via localStorage means the Search-page pill and the
 * Settings-page card stay in sync automatically. */
import { writable } from 'svelte/store'

export type SearchSource = 'youtube' | 'ytmusic'

const KEY = 'geethub.ytSearchSource'

function load(): SearchSource {
  const v = localStorage.getItem(KEY)
  return v === 'youtube' ? 'youtube' : 'ytmusic'
}

function createStore() {
  const s = writable<SearchSource>(load())
  s.subscribe((v) => localStorage.setItem(KEY, v))
  return s
}

export const ytSearchSource = createStore()

export function labelFor(src: SearchSource): string {
  return src === 'ytmusic' ? 'YouTube Music' : 'YouTube'
}
