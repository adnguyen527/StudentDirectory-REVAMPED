import type { ReactNode } from 'react'

export interface ChartTableProps {
  /** Names the table. Also the name tests address it by -- see ChartFigure. */
  caption: string
  /** Column headings. The first is the category; the rest are numeric. */
  columns: readonly string[]
  /** One array per row, already formatted. The first cell labels the row. */
  rows: readonly (readonly ReactNode[])[]
}

/**
 * The table every chart renders beside its marks.
 *
 * It is three things at once, which is why it is never optional and never behind a toggle:
 *
 * - **The accessible reading of the chart.** The marks are `aria-hidden`, so this is the
 *   chart as far as assistive tech is concerned. A visualisation whose values are only in
 *   the picture is a visualisation half the readers cannot use.
 * - **The guarantee that a tooltip never gates a value.** Hovering is a nicety; every
 *   number a bar encodes is spelled out here, in text, always present.
 * - **The whole test surface.** jsdom performs no layout -- widths are 0, there is no
 *   ResizeObserver and no getBBox -- so a bar's geometry is not observable and, by this
 *   project's convention, not asserted on either (vitest.config.ts: the tests "assert on
 *   text and roles, never on computed style"). Numbers are checked here instead.
 *
 * ⚠️ It carries a `<caption>`, which no other table in the app does. That is deliberate: a
 * page now holds two tables -- this and the list it sits above -- so both need names before
 * `getByRole('table')` can say which one it means. StudentProfilePage.test.tsx already ran
 * into the unscoped version of that problem and documents the fix.
 */
export function ChartTable({ caption, columns, rows }: ChartTableProps) {
  return (
    <table className="table chart-twin">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column, index) => (
            // The first column labels the row; the rest hold figures.
            <th key={column} className={index === 0 ? undefined : 'numeric'}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          // The row's own label is the stable key: bucket keys and center names are unique
          // within a chart, and the index alone would reorder badly on a filter change.
          <tr key={String(row[0]) || rowIndex}>
            {row.map((cell, index) => (
              <td key={columns[index] ?? index} className={index === 0 ? undefined : 'numeric'}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
