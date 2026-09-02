import type { ReactNode } from 'react'

import { MoreIcon } from './Icons'
import './Card.css'

interface CardProps {
  /** Optional because `lead` can stand in its place -- see below. */
  title?: string
  /**
   * Replaces the title on the left of the header. The list pages put their filter box
   * here: the page's own <h1> already names the table, so repeating it in the card was
   * two words where a control could go.
   */
  lead?: ReactNode
  /**
   * The header's right-hand slot. The layout reference gives every card its own controls
   * here -- a period dropdown where the data is time-scoped. Empty for now on the cards
   * that show all-time figures.
   */
  controls?: ReactNode
  /** The reference's corner overflow, which is where the pin button will go. */
  showOverflow?: boolean
  /** Tables want to meet the card edges; prose wants padding. */
  flush?: boolean
  children: ReactNode
}

/**
 * The container every page's content sits in.
 *
 * It exists this early so no page invents its own -- the whole content area of the layout
 * reference is cards, and the header controls slot is what the period dropdown and the
 * pinning menu will hang off later.
 */
export function Card({
  title,
  lead,
  controls,
  showOverflow = true,
  flush,
  children,
}: CardProps) {
  return (
    <section className="card">
      <header className="card-header">
        {/* A card with a `lead` has no heading of its own. That is deliberate on the list
            pages -- the page's <h1> names them -- and an unnamed <section> is simply not
            exposed as a landmark rather than being exposed under a duplicate name. */}
        {lead ?? <h2 className="card-title">{title}</h2>}
        <div className="card-controls">
          {controls}
          {showOverflow && (
            <button
              type="button"
              className="card-overflow"
              // Pinning is a later item; the affordance is here so the header layout is
              // settled, but it must not look available.
              disabled
              title="Card options — coming with pinned stats"
              aria-label="Card options"
            >
              <MoreIcon />
            </button>
          )}
        </div>
      </header>
      <div className={flush ? 'card-body card-body-flush' : 'card-body'}>{children}</div>
    </section>
  )
}
