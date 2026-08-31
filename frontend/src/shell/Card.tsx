import type { ReactNode } from 'react'

import { MoreIcon } from './Icons'
import './Card.css'

interface CardProps {
  title: string
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
export function Card({ title, controls, showOverflow = true, flush, children }: CardProps) {
  return (
    <section className="card">
      <header className="card-header">
        <h2 className="card-title">{title}</h2>
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
