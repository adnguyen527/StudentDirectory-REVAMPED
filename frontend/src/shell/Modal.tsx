import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { CloseIcon } from './Icons'
import './Modal.css'

interface ModalProps {
  /** Names the dialog for a screen reader, and titles it on screen. */
  title: ReactNode
  /** A line under the title -- the chips that say which record this is. */
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
}

/**
 * A record opened in place, over the page that listed it.
 *
 * The first overlay in this app, so it carries the contract rather than each caller: it is
 * dismissed by Escape, by the close button, or by clicking outside it, exactly as
 * FilterPopover and GlobalSearch already are -- a thing that can only be closed by the
 * control that opened it is a trap.
 *
 * ⚠️ **It is a portal, and it has to be.** Rendered in place, the dialog would sit inside
 * the card that opened it, and `.app-content` is the only scrolling box in the layout --
 * so the overlay would scroll with the table underneath it and clip at the card's bounds.
 * Appended to `document.body` it is positioned against the viewport instead.
 *
 * Focus is moved in on open and put back on close. Without the second half, dismissing the
 * dialog drops focus onto `<body>` and a keyboard reader restarts from the top of the page
 * rather than from the row they were on.
 */
export function Modal({ title, subtitle, onClose, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useEffect(() => {
    // Captured before focus moves, so it is the element that opened the dialog rather
    // than anything inside it.
    const opener = document.activeElement as HTMLElement | null

    // The close button rather than the panel: it is the one control that is always
    // present, and landing on it means Escape and Enter both do the obvious thing.
    closeRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      // A minimal trap. Tabbing out of a dialog that covers the page lands the reader on
      // controls they cannot see, so the cycle is closed here rather than made inert --
      // `inert` is not carried by every browser this has to run in.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    // The page behind must not scroll under the overlay -- a wheel over the backdrop
    // otherwise moves the table the reader just left.
    const scrollLock = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = scrollLock
      opener?.focus?.()
    }
  }, [onClose])

  return createPortal(
    <div
      className="modal-backdrop"
      // The backdrop closes, the panel does not: the check is which element the press
      // landed on, not whether the panel contains it, so a drag that starts on a text
      // selection inside the panel and ends outside does not dismiss the dialog.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panelRef}>
        <header className="modal-header">
          <div className="modal-heading">
            <h2 className="modal-title" id={titleId}>
              {title}
            </h2>
            {subtitle && <p className="modal-subtitle">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            ref={closeRef}
          >
            <CloseIcon />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
