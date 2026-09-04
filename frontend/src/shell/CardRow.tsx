import type { CSSProperties, ReactNode } from 'react'

import './CardRow.css'

interface CardRowProps {
  /**
   * Narrowest a column may become before the row drops to fewer of them.
   *
   * The only knob, because it is the only thing that varies: a row of three compact cards
   * wants a smaller floor than a row of two holding prose. The *count* is deliberately not
   * a parameter -- see below.
   */
  min?: number
  children: ReactNode
}

/**
 * A row of cards, however many.
 *
 * The number of columns is not passed in and not counted: `auto-fit` fits as many as `min`
 * allows and drops to fewer when the window narrows, which is the same idiom `.tile-row`
 * uses (shell/AppShell.css). That is what makes this reusable rather than a two-card
 * special case -- a page wanting three across writes exactly the same thing, and no caller
 * has to restate its own child count in a second place where the two can disagree.
 */
export function CardRow({ min = 360, children }: CardRowProps) {
  return (
    <div className="card-row" style={{ '--card-row-min': `${min}px` } as CSSProperties}>
      {children}
    </div>
  )
}
