import type { CSSProperties, ReactNode } from 'react'

import { formatNumber } from '../api/bson'
import { ChartFigure } from './ChartFigure'
import { ChartTable } from './ChartTable'
import { niceScale, percent } from './scale'
import './Chart.css'

export interface Datum {
  /** The category or bucket this mark is for. Unique within a chart. */
  key: string
  /** What the axis and the table call it. */
  label: string
  value: number
  /**
   * What the hover says instead of `label`, where the two should differ.
   *
   * The axis has to be terse -- fifty bands share one row, so a week is `W25` -- but `W25`
   * on its own does not say *when*, which is the whole point of reading a timeline. A time
   * chart passes the days the bucket covers here and keeps the short form on the axis.
   * Omitted where the label already says everything, as on the center distributions.
   */
  hint?: string
  /**
   * Drawn at reduced fill. On a time axis it marks a bucket the window only part-covers,
   * so a short edge bar reads as a short window rather than a quiet week.
   */
  partial?: boolean
}

interface CommonProps {
  data: readonly Datum[]
  caption: string
  /** Heading for the value column in the twin -- 'Sessions', 'Students'. */
  valueLabel: string
  loading?: boolean
  note?: ReactNode
  /** Formats a value for labels, tooltips and the twin. Defaults to a thousands-comma. */
  format?: (value: number) => string
}

/**
 * ⚠️ One file, two exports, on purpose.
 *
 * A bar and a column are the same mark rotated, and the fiddly part is the part they share:
 * the data-end is rounded 4px while the baseline stays square, which is
 * `border-radius: 0 4px 4px 0` lying down and `4px 4px 0 0` standing up. Two components
 * would spell that twice, and a mark spec written twice is a mark spec that drifts.
 *
 * They stay separate *exports* because the axis differs -- one bands down the left in
 * words, the other along the bottom in dates -- and a single component with an
 * `orientation` prop would branch in every function it has.
 */

/**
 * What a mark says on hover.
 *
 * `hint` where the caller gave one -- the days a bucket covers -- and the axis label
 * otherwise. The partial marker rides along, because the tooltip is the hover reading of
 * what the table twin spells out, and a dimmed bar with no explanation is colour-only.
 *
 * ⚠️ A nicety, never the only way to read a value: the twin carries every number as text.
 */
function tip(d: Datum, format: (value: number) => string): string {
  return `${d.hint ?? d.label}${d.partial ? ' (partial)' : ''}: ${format(d.value)}`
}

/** Lengths reach CSS as custom properties, the idiom CardRow established. */
function lengthVar(value: number, max: number): CSSProperties {
  return { '--mark': `${percent(value, max)}%` } as CSSProperties
}

/**
 * The table twin.
 *
 * ⚠️ It labels rows with `hint` too, not the axis's short form. A table's first column has
 * to identify its row on its own, and `W25` does not say which week any more in a table
 * than it does on hover -- so the reader who cannot hover would be the only one left
 * without the dates. The axis stays terse because fifty bands share a row; a table column
 * has the width.
 */
function twinOf(data: readonly Datum[], caption: string, valueLabel: string, format: (n: number) => string) {
  return (
    <ChartTable
      caption={caption}
      columns={['', valueLabel]}
      rows={data.map((d) => {
        const said = d.hint ?? d.label
        return [d.partial ? `${said} (partial)` : said, format(d.value)]
      })}
    />
  )
}

/**
 * Horizontal bars, one per category -- the center distributions.
 *
 * Horizontal because the categories are words: a center called "North Dallas" set under a
 * vertical column either wraps, tilts or truncates, and all three are worse than simply
 * running the bar the other way and letting the name sit beside it on one line.
 *
 * One colour for every bar. The centers have no order, so shading them by value would
 * re-encode bar length as hue -- spending the only free channel on what the length already
 * says. A single series also needs no legend: the card's title names what is plotted.
 */
export function BarChart({
  data,
  caption,
  valueLabel,
  loading,
  note,
  format = formatNumber,
}: CommonProps) {
  const { max } = niceScale(data.map((d) => d.value))

  return (
    <ChartFigure
      caption={caption}
      loading={loading}
      note={note}
      twin={twinOf(data, caption, valueLabel, format)}
    >
      <div className="bar-list">
        {data.map((d) => (
          // Native title: a tooltip with no JS, no positioning, and nothing for .card's
          // overflow:hidden to clip. The twin is the guarantee; this is the nicety.
          <div className="bar-row" key={d.key} title={tip(d, format)}>
            <span className="bar-label">{d.label}</span>
            <span className="bar-track">
              {/* ⚠️ A zero draws no element at all, rather than a fill with no width.
                  `min-width: 2px` keeps a small non-zero bar visible, and it applies just
                  as happily to a zero -- so leaving the element in place renders 0 as a
                  2px sliver indistinguishable from 1. Caught by looking at the rendered
                  page, not by a test: jsdom parses no CSS, so nothing here can see it. */}
              {d.value > 0 && (
                <span
                  className={d.partial ? 'bar-fill bar-fill-partial' : 'bar-fill'}
                  style={lengthVar(d.value, max)}
                />
              )}
            </span>
            {/* Outside the bar, never inside: inside is --text-on-accent on --accent, which
                the contrast test already pins as a known shortfall in dark. */}
            <span className="bar-value">{format(d.value)}</span>
          </div>
        ))}
      </div>
    </ChartFigure>
  )
}

interface ColumnChartProps extends CommonProps {
  /** Drops the axis and the value column -- for the small multiples on Home. */
  compact?: boolean
}

/**
 * Vertical columns over time buckets -- report volume, the Home trends, instructor workload.
 *
 * Vertical because time reads left to right, and a reader looking for "is this rising"
 * expects to scan across rather than down.
 *
 * Gridlines are absolutely positioned hairlines at percentage offsets: a real 1px line in
 * both themes, where an SVG line in a stretched viewBox would render at a different
 * thickness on each axis. Solid, never dashed -- a dashed grid reads as a projection or a
 * threshold when it is only a grid.
 */
export function ColumnChart({
  data,
  caption,
  valueLabel,
  loading,
  note,
  compact,
  format = formatNumber,
}: ColumnChartProps) {
  const scale = niceScale(data.map((d) => d.value))
  const max = scale.max
  const ticks = compact ? [] : scale.ticks

  return (
    <ChartFigure
      caption={caption}
      loading={loading}
      note={note}
      twin={twinOf(data, caption, valueLabel, format)}
    >
      <div className={compact ? 'column-chart column-chart-compact' : 'column-chart'}>
        {!compact && (
          <div className="column-axis">
            {[...ticks].reverse().map((tick) => (
              <span className="column-tick" key={tick}>
                {format(tick)}
              </span>
            ))}
          </div>
        )}

        <div className="column-plot">
          {ticks.map((tick) => (
            <span
              className="chart-grid"
              key={tick}
              style={{ '--at': `${100 - percent(tick, max)}%` } as CSSProperties}
            />
          ))}

          <div className="column-list">
            {data.map((d) => (
              <div
                className="column-slot"
                key={d.key}
                title={tip(d, format)}
              >
                {/* A zero column draws nothing, for the reason BarChart states above. */}
                {d.value > 0 && (
                  <span
                    className={d.partial ? 'column-fill column-fill-partial' : 'column-fill'}
                    style={lengthVar(d.value, max)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {!compact && (
          <div className="column-bands">
            {data.map((d) => (
              // Every label is in the DOM at every width. A container query thins them
              // visually when the card is narrow, so the tests -- which parse no CSS -- see
              // a complete axis regardless, and a real browser never draws them overlapping.
              <span className="column-band" key={d.key}>
                <span className="column-band-label">{d.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </ChartFigure>
  )
}
