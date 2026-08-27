/** Theme store — mirrors ThemeManager.swift.
 *
 * `scheme` picks system / light / dark and drives [data-theme] on <html>
 * (used by the CSS variables in app.css). `accent` is any of the seven named
 * colors and rewrites --accent live. Both are persisted to localStorage. */
import { writable } from 'svelte/store'

export type SchemeChoice = 'system' | 'light' | 'dark'

export interface AccentDef { id: AccentChoice; label: string; hex: string }
export type AccentChoice =
  | 'teal' | 'indigo' | 'crimson' | 'amber' | 'violet' | 'forest' | 'slate'

export const ACCENTS: AccentDef[] = [
  { id: 'teal',    label: 'Teal',    hex: '#12798F' },
  { id: 'indigo',  label: 'Indigo',  hex: '#434EB8' },
  { id: 'crimson', label: 'Crimson', hex: '#C8284A' },
  { id: 'amber',   label: 'Amber',   hex: '#D4851B' },
  { id: 'violet',  label: 'Violet',  hex: '#8347A9' },
  { id: 'forest',  label: 'Forest',  hex: '#217957' },
  { id: 'slate',   label: 'Slate',   hex: '#475567' },
]

const SCHEME_KEY = 'geethub.scheme'
const ACCENT_KEY = 'geethub.accent'

function loadScheme(): SchemeChoice {
  const v = localStorage.getItem(SCHEME_KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}
function loadAccent(): AccentChoice {
  const v = localStorage.getItem(ACCENT_KEY) as AccentChoice | null
  return ACCENTS.some((a) => a.id === v) ? v! : 'teal'
}

function applyScheme(choice: SchemeChoice) {
  const root = document.documentElement
  if (choice === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
}
function applyAccent(choice: AccentChoice) {
  const def = ACCENTS.find((a) => a.id === choice) ?? ACCENTS[0]
  document.documentElement.style.setProperty('--accent', def.hex)
}

function createTheme() {
  // Initialise once from storage, then push to <html> so first paint uses it.
  const initialScheme = loadScheme()
  const initialAccent = loadAccent()
  applyScheme(initialScheme)
  applyAccent(initialAccent)

  const scheme = writable<SchemeChoice>(initialScheme)
  const accent = writable<AccentChoice>(initialAccent)

  scheme.subscribe((s) => {
    localStorage.setItem(SCHEME_KEY, s)
    applyScheme(s)
  })
  accent.subscribe((a) => {
    localStorage.setItem(ACCENT_KEY, a)
    applyAccent(a)
  })

  return { scheme, accent }
}

export const theme = createTheme()
