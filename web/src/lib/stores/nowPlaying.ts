/** Whether the full-screen now-playing sheet is open (mobile only).
 * On desktop the PlayerDock is a permanent sidebar and ignores this. */
import { writable } from 'svelte/store'

export const nowPlayingOpen = writable(false)
