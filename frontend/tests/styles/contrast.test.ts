import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The palette, checked against WCAG AA.
 *
 * This exists because the light theme shipped with six pairs below 4.5:1 -- worst was
 * --text-faint at 2.07:1, on 11px labels -- while every one of them passed in dark. The
 * greys were tuned by eye against a dark browser, and nothing was watching the other
 * theme. Now something is.
 *
 * Pure arithmetic over tokens.css: no browser, no rendering. It only knows about pairs
 * declared below, so a new coloured-on-coloured combination in a component needs a line
 * adding here too.
 */

// Resolved from the Vitest root (frontend/) rather than import.meta.url: under the jsdom
// environment that is an http URL from Vite's module graph, not a file: one.
const CSS = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')

const DARK_AT = CSS.indexOf('@media (prefers-color-scheme: dark)')

/** The custom properties in force for a theme -- dark inherits everything it omits. */
function palette(theme: 'light' | 'dark'): Record<string, string> {
  const read = (text: string) => {
    const out: Record<string, string> = {}
    for (const [, name, value] of text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      out[name] = value.trim()
    }
    return out
  }
  const light = read(CSS.slice(0, DARK_AT))
  return theme === 'light' ? light : { ...light, ...read(CSS.slice(DARK_AT)) }
}

function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance(hex: string): number {
  const srgb = channels(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
}

function contrast(fg: string, bg: string): number {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** Foreground/background combinations the UI actually composes. */
const PAIRS: [label: string, fg: string, bg: string][] = [
  ['body text on the page', '--text', '--bg'],
  ['body text on a card', '--text', '--surface'],
  ['muted text on a card', '--text-muted', '--surface'],
  ['muted text on a sunken row', '--text-muted', '--surface-sunken'],
  ['faint text on the page', '--text-faint', '--bg'],
  ['faint text on a card', '--text-faint', '--surface'],
  ['accent link on a card', '--accent', '--surface'],
  ['active nav on its wash', '--accent', '--accent-soft'],
  // The selected session row takes the same wash, and carries ordinary row text over it.
  ['selected row text', '--text', '--accent-soft'],
  ['selected row muted text', '--text-muted', '--accent-soft'],
  ['button label on accent', '--text-on-accent', '--accent'],
  ['center tag', '--wash-1-ink', '--wash-1'],
  ['tile ink 2', '--wash-2-ink', '--wash-2'],
  ['warn pill', '--wash-3-ink', '--wash-3'],
  ['tile ink 4', '--wash-4-ink', '--wash-4'],
  ['error text on its wash', '--danger', '--danger-soft'],
  ['mastered status', '--success', '--surface'],
]

const AA = 4.5

/**
 * Two shortfalls in the dark theme, both left as they are on purpose.
 *
 * The light palette is what was asked to be fixed; each of these is a change to a theme
 * nobody asked to touch, and each has a visible design consequence. They are exempted by
 * name -- and pinned above 3:1 below, so they cannot quietly get worse while they wait
 * for a decision.
 *
 *   - `--text-faint` on the dark grounds, 3.54:1. The mirror of the bug fixed in light;
 *     the fix is to *lighten* it, on the same 11px labels.
 *   - `--text-on-accent` on `--accent`, 3.21:1. Dark redefines `--accent` from the dark
 *     violet to a light one (#9b7cf0) but keeps the white foreground that was picked for
 *     the dark violet. On a light violet the readable ink is a dark one, so the fix flips
 *     the Σ brand mark and the "New report" label from white to near-black -- both in
 *     Sidebar.css, and both plainly visible.
 */
const KNOWN_SHORTFALLS = new Set([
  'dark: faint text on the page',
  'dark: faint text on a card',
  'dark: button label on accent',
])

describe.each(['light', 'dark'] as const)('%s palette', (theme) => {
  const tokens = palette(theme)

  it.each(PAIRS)('%s clears AA', (label, fg, bg) => {
    const ratio = contrast(tokens[fg], tokens[bg])
    if (KNOWN_SHORTFALLS.has(`${theme}: ${label}`)) {
      // Pinned so it cannot quietly get worse while it waits for a decision.
      expect(ratio).toBeGreaterThanOrEqual(3)
      return
    }
    expect(ratio, `${fg} ${tokens[fg]} on ${bg} ${tokens[bg]}`).toBeGreaterThanOrEqual(AA)
  })

  it('keeps the grey ladder: text darker than muted darker than faint', () => {
    // Solving each token for AA independently once made faint darker than muted, which
    // inverts the hierarchy. The ratios against a fixed ground have to descend.
    const on = (name: string) => contrast(tokens[name], tokens['--surface'])
    expect(on('--text')).toBeGreaterThan(on('--text-muted'))
    expect(on('--text-muted')).toBeGreaterThan(on('--text-faint'))
  })
})

describe('palette structure', () => {
  it('defines every token in light, so dark is a pure override', () => {
    // A token declared only in dark would fall through to nothing in light.
    const light = new Set(Object.keys(palette('light')))
    const darkOnly = Object.keys(palette('dark')).filter((t) => !light.has(t))
    expect(darkOnly).toEqual([])
  })
})
