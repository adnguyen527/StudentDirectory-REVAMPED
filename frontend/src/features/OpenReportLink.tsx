import { Link } from 'react-router-dom'

interface OpenReportLinkProps {
  reportId: string
  /**
   * The control's accessible name.
   *
   * Passed in rather than built here: the reports list and the metrics card hold rows that
   * carry `student_name`, and a student profile's session history does not -- those rows
   * are `DwpReport`, and only the list route joins the student on. A shared component that
   * wrote "…session for {name}" would announce `undefined` on the profile.
   *
   * ⚠️ It has to name the session. Fifty controls all called "Open" are fifty identical
   * items in a screen reader's list of them.
   */
  label: string
  onOpen: (reportId: string) => void
}

/**
 * One report, two ways in.
 *
 * ⚠️ **An anchor, deliberately, even though an ordinary click never follows it.** A plain
 * click opens the modal -- quick to read, quick to dismiss, and the reader keeps their
 * place in the list. But a modified click still has to reach `/reports/:id` in a new tab,
 * which is how several reports get opened side by side; that matters more later than now,
 * since editing a report is coming and editing several at once is the case being kept
 * open. A `<button>` would be simpler and would quietly delete that -- there is no URL
 * behind a button to open, copy, or show on hover.
 *
 * So the modified clicks are handed back to the browser rather than intercepted. React
 * Router's Link ignores them for the same reason.
 *
 * Middle-click never arrives here at all: it fires `auxclick`, not `click`. Right-click
 * does not either, so "Open link in new tab" keeps working untouched.
 */
export function OpenReportLink({ reportId, label, onOpen }: OpenReportLinkProps) {
  return (
    <Link
      className="button button-row"
      to={`/reports/${reportId}`}
      aria-label={label}
      onClick={(event) => {
        // Two of the three tables toggle an inline expander on row click. Without this,
        // opening a report would also expand the row behind the dialog.
        event.stopPropagation()
        // "Open it over there", not "show me here" -- let the anchor be an anchor.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        onOpen(reportId)
      }}
    >
      Open
    </Link>
  )
}
