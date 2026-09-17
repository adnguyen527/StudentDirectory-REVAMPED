import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

export interface HoverRow {
  /** Left-hand metric name. Omitted for an enumeration, where a row has no per-row label. */
  name?: string
  value: string
}

export interface HoverCardContent {
  /** Names the point: a date, a bucket range, a center, a pill's label. */
  header: string
  /** One row per metric. 1-3; more than that is a table, not a card. */
  rows?: readonly HoverRow[]
  /** Replaces `rows` for a card that explains a label rather than carries data. */
  prose?: string
  /** A muted caveat under the body -- "Partial", "No session". */
  footnote?: string
  /**
   * The ramp step this point sits at, 1-5, drawn as a swatch beside each row. Heatmap only
   * -- every other chart draws one series in --accent, so a swatch there would repeat what
   * the mark's own colour already says.
   */
  swatch?: 1 | 2 | 3 | 4 | 5
}

/**
 * Only one card is ever open app-wide. Opening a second closes whichever was open first --
 * a module global rather than a context provider, so nothing has to be mounted at the app
 * root and nothing can be forgotten there.
 */
let closeCurrent: (() => void) | null = null

const GAP = 8
const EDGE = 8

/**
 * Anchor rect in, transform out. A direct write to `card`'s own style, not React state:
 * scroll can fire every frame, and routing that through a render would fight the one thing
 * that has to stay smooth. Keep the write here and nowhere else, or the two will race.
 */
function place(anchor: HTMLElement, card: HTMLElement) {
  const a = anchor.getBoundingClientRect()
  const c = card.getBoundingClientRect()

  let x = a.left + a.width / 2 - c.width / 2
  let y = a.bottom + GAP
  // Flip above when there is no room below, rather than clamping into the anchor itself.
  if (y + c.height > window.innerHeight - EDGE) y = a.top - GAP - c.height

  x = Math.min(Math.max(x, EDGE), window.innerWidth - c.width - EDGE)
  y = Math.max(y, EDGE)

  card.style.transform = `translate3d(${x}px, ${y}px, 0)`
  card.style.visibility = 'visible'
}

interface CardState {
  pinned: boolean
}

/**
 * The show/pin/dismiss/position machinery behind every hover target.
 *
 * `HoverTarget` is the one caller this is meant for; exported for the rare site that
 * cannot render through it (an element whose own tag or children `HoverTarget` cannot
 * express).
 */
export function useHoverCard() {
  const id = useId()
  const anchorRef = useRef<HTMLElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<CardState | null>(null)

  const close = useCallback(() => setState(null), [])

  // A hover or a focus never downgrades a pin -- a stray pointerenter replaying over an
  // already-pinned card must not make it dismissable by mouseleave.
  const show = useCallback(() => {
    setState((current) => current ?? { pinned: false })
  }, [])

  const hide = useCallback(() => {
    setState((current) => (current?.pinned ? current : null))
  }, [])

  const toggle = useCallback(() => {
    setState((current) => (current?.pinned ? null : { pinned: true }))
  }, [])

  useEffect(() => {
    if (!state) return
    if (closeCurrent && closeCurrent !== close) closeCurrent()
    closeCurrent = close
    return () => {
      if (closeCurrent === close) closeCurrent = null
    }
  }, [state, close])

  useLayoutEffect(() => {
    if (!state) return
    const anchor = anchorRef.current
    const card = cardRef.current
    if (!anchor || !card) return

    const reposition = () => place(anchor, card)
    reposition()

    // Capture, not bubble: `.app-content` is the only scrolling box in the layout, and
    // capture reaches it without this hook needing to know which element that is.
    window.addEventListener('resize', reposition)
    document.addEventListener('scroll', reposition, { capture: true, passive: true })
    return () => {
      window.removeEventListener('resize', reposition)
      document.removeEventListener('scroll', reposition, { capture: true })
    }
  }, [state])

  useEffect(() => {
    if (!state) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      // Capture-phase and stopped here, so a card sitting over an open Modal absorbs the
      // first Escape and the dialog only sees a second one.
      event.stopPropagation()
      close()
      anchorRef.current?.focus()
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (anchorRef.current?.contains(target) || cardRef.current?.contains(target)) return
      close()
    }

    document.addEventListener('keydown', onKeyDown, { capture: true })
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown, { capture: true })
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [state, close])

  return { id, anchorRef, cardRef, state, show, hide, toggle, close }
}
