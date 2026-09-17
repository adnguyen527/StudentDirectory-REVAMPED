import { useState } from 'react'
// hooks
import { useApi } from '../hooks/useApi'
// apis
import { formatDate, isoDay, todayLocal, toDate } from '../api/bson'
import { getMetrics } from '../api/endpoints'
import type { Metrics } from '../api/types'
// components
import { FunnelIcon } from '../shell/Icons'
import { FilterPopover } from '../shell/FilterPopover'
// utils
import { useRange, type RangeState } from './ranges'
// styles
import './ColumnFilter.css'

interface DateRangeFilterProps {
  column: string
  label: string
  /**
   * Renders as a labelled pill rather than the column headers' glyph.
   *
   * The two looks answer two positions. In a header row the filter is one of seven and has
   * to disappear until wanted, so it is a faint funnel; in a card header's control row it
   * stands beside a search box and a center dropdown, where a bare icon reads as a stray
   * button. FilterPopover already draws both -- it falls back to the summary text and a
   * caret when no icon is given -- so this only chooses between them.
   */
  standalone?: boolean
  /**
   * Where the bounds are kept. Omitted on the list pages, which keep them in the URL and
   * send them to the API; supplied by a profile card, which filters rows it already has.
   * Same escape hatch, same reason, as NumberRangeFilter.
   */
  range?: RangeState
}

/** Windows worth one click. Days back from the newest session, not from today. */
const PRESETS = [30, 90, 180]

function daysBefore(anchor: Date, days: number) {
  const start = new Date(anchor)
  start.setDate(start.getDate() - days)
  return isoDay(start)
}

/** "Any time", "Since Jun 19, 2025", "Up to …", "Sep 17, 2025", "Jun 19 to Sep 17, 2025". */
function dateSummary(from: string, to: string) {
  const said = (day: string) => formatDate({ $date: `${day}T00:00:00Z` })
  if (!from && !to) return 'Any time'
  if (from && !to) return `Since ${said(from)}`
  if (!from && to) return `Up to ${said(to)}`
  // One day is a date, not a range. "Sep 17, 2025 to Sep 17, 2025" is the same fact said
  // twice, and this pill is what tells a reader the card is showing a single day.
  if (from === to) return said(from)
  return `${said(from)} to ${said(to)}`
}

/**
 * A date window on the Last session column.
 *
 * ⚠️ The **Last N days** presets count back from the newest session in the data, not from
 * today. The imported data ends 2025-09-17, so those read off the calendar would match
 * nobody and would look like a broken filter rather than an empty answer. Each is labelled
 * with the date it actually resolves to, so nothing has to be taken on trust -- and until
 * that anchor has loaded they are not offered at all, rather than named dishonestly.
 */
export function DateRangeFilter({ column, label, standalone, range }: DateRangeFilterProps) {
  // Always called, ignored when the caller brought its own -- see NumberRangeFilter.
  const urlRange = useRange(column, 'date')
  const { low, high, active, apply } = range ?? urlRange
  const { data } = useApi<Metrics>((signal) => getMetrics(signal), [])

  // Seeded from the URL and re-seeded when it changes, so an arrived-at filter shows its
  // own bounds and "Clear filters" empties the boxes. Adjusted during render rather than
  // in an effect: an effect would render once with the stale value and then again with
  // the right one, which is the cascade the lint rule is about.
  const [from, setFrom] = useState(low)
  const [to, setTo] = useState(high)
  const [seed, setSeed] = useState({ low, high })
  if (seed.low !== low || seed.high !== high) {
    setSeed({ low, high })
    setFrom(low)
    setTo(high)
  }

  // toDate, not new Date(): $date has three spellings and only one of them is a
  // string a Date constructor accepts.
  const anchor = toDate(data?.latest_session_date)
  // The reader's calendar, not the data's newest session -- see todayLocal.
  const today = todayLocal()

  return (
    <FilterPopover
      label={`Filter by ${label}`}
      summary={dateSummary(low, high)}
      active={active}
      icon={standalone ? undefined : <FunnelIcon />}
      className={standalone ? undefined : 'column-filter-trigger'}
    >
      <form
        className="column-filter"
        onSubmit={(event) => {
          event.preventDefault()
          apply(from, to)
        }}
      >
        <div className="column-filter-presets">
          <button
            type="button"
            className="column-filter-preset"
            onClick={() => apply(today, today)}
          >
            <span>Today</span>
            <span className="muted">{formatDate({ $date: `${today}T00:00:00Z` })}</span>
          </button>

          {anchor &&
            PRESETS.map((days) => {
              const start = daysBefore(anchor, days)
              return (
                <button
                  key={days}
                  type="button"
                  className="column-filter-preset"
                  onClick={() => apply(start, '')}
                >
                  <span>Last {days} days</span>
                  <span className="muted">from {formatDate({ $date: `${start}T00:00:00Z` })}</span>
                </button>
                )
              })}
        </div>

        <label className="column-filter-field">
          <span>From</span>
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            aria-label={`Earliest ${label}`}
          />
        </label>
        <label className="column-filter-field">
          <span>To</span>
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            aria-label={`Latest ${label}`}
          />
        </label>

        <div className="column-filter-actions">
          {active && (
            <button type="button" className="button button-quiet" onClick={() => apply('', '')}>
              Clear
            </button>
          )}
          <button type="submit" className="button">
            Apply
          </button>
        </div>
      </form>
    </FilterPopover>
  )
}
