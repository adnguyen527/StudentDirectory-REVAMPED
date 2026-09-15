import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BarChart, ColumnChart } from '../../src/charts/BarChart'

/**
 * The marks themselves -- the little that is observable about them without layout.
 *
 * jsdom performs no layout and `css: false` means no stylesheet is parsed, so a bar's
 * rendered size cannot be asserted on and by this project's convention is not. What *is*
 * observable is which elements exist and what inline length each was handed, and that is
 * enough to pin the one rule a stylesheet cannot express.
 */

const DATA = [
  { key: 'a', label: 'Alpha', value: 50 },
  { key: 'b', label: 'Beta', value: 0 },
]

describe('bar marks', () => {
  it('draws no fill at all for a zero', () => {
    // ⚠️ The regression. `min-width: 2px` keeps a small non-zero bar visible and applies
    // just as happily to a zero, so a fill element left in place renders 0 as a 2px sliver
    // that looks like a small value. On the data-quality page that made "no date: 0" --
    // the good news -- look like a finding.
    const { container } = render(
      <BarChart data={DATA} caption="Test" valueLabel="Count" />,
    )

    expect(container.querySelectorAll('.bar-row')).toHaveLength(2)
    expect(container.querySelectorAll('.bar-fill')).toHaveLength(1)
  })

  it('sizes a bar as a share of the axis, not of the data', () => {
    // niceScale rounds 50 up to its own maximum, so the bar is a share of the axis the
    // gridlines are drawn to -- otherwise the tallest bar would always touch the top.
    const { container } = render(
      <BarChart
        data={[{ key: 'a', label: 'Alpha', value: 47 }]}
        caption="Test"
        valueLabel="Count"
      />,
    )

    // 47 against a nice maximum of 50.
    expect(container.querySelector('.bar-fill')?.getAttribute('style')).toContain('94%')
  })

  it('still lists the zero in the table twin', () => {
    // The mark is gone; the number is not. The twin is where every value is readable.
    const { getByRole } = render(
      <BarChart data={DATA} caption="Test" valueLabel="Count" />,
    )

    expect(getByRole('row', { name: /Beta/ })).toHaveTextContent('0')
  })
})

describe('column marks', () => {
  it('draws no fill at all for a zero bucket', () => {
    const { container } = render(
      <ColumnChart data={DATA} caption="Test" valueLabel="Count" />,
    )

    // Every bucket keeps its slot, so the axis stays evenly spaced and gapless.
    expect(container.querySelectorAll('.column-slot')).toHaveLength(2)
    expect(container.querySelectorAll('.column-fill')).toHaveLength(1)
  })

  it('keeps every band label in the DOM, whatever the width', () => {
    // A container query thins them visually when the card is narrow. The markup does not
    // change, so the tests -- which parse no CSS -- always see a complete axis.
    const { container } = render(
      <ColumnChart data={DATA} caption="Test" valueLabel="Count" />,
    )

    expect(container.querySelectorAll('.column-band-label')).toHaveLength(2)
  })

  it('hides the marks from assistive tech, leaving the twin to speak', () => {
    const { container } = render(
      <ColumnChart data={DATA} caption="Test" valueLabel="Count" />,
    )

    expect(container.querySelector('.chart-plot')).toHaveAttribute('aria-hidden', 'true')
  })

  it('reserves the chart height while loading rather than collapsing', () => {
    // AsyncBoundary's centred "Loading…" would shrink the card to one line and make it
    // jump when data lands -- the problem StatTile's own skeleton exists to avoid.
    const { container } = render(
      <ColumnChart data={[]} caption="Test" valueLabel="Count" loading />,
    )

    expect(container.querySelector('.chart-skeleton')).toBeInTheDocument()
    expect(container.querySelector('.column-list')).toBeNull()
  })
})

describe('mark tooltips', () => {
  it('says the days a bucket covers, not just its axis label', () => {
    // ⚠️ The whole reason `hint` exists: an axis has room for "W25" and nothing more, and
    // "W25" on its own does not say when. The hover is where the dates go.
    const { container } = render(
      <ColumnChart
        data={[{ key: '2025-W25', label: 'W25', hint: '16–22 Jun 2025', value: 42 }]}
        caption="Test"
        valueLabel="Sessions"
      />,
    )

    expect(container.querySelector('.column-slot')).toHaveAttribute(
      'title',
      '16–22 Jun 2025: 42',
    )
    // And the axis keeps the short form, so fifty of them still fit.
    expect(container.querySelector('.column-band-label')).toHaveTextContent('W25')
  })

  it('falls back to the label where a hint would say nothing new', () => {
    // The centre distributions pass none: "Westside" is already the whole answer.
    const { container } = render(
      <BarChart
        data={[{ key: 'w', label: 'Westside', value: 395 }]}
        caption="Test"
        valueLabel="Students"
      />,
    )

    expect(container.querySelector('.bar-row')).toHaveAttribute('title', 'Westside: 395')
  })

  it('carries the partial marker, so a dimmed bar is not colour-only', () => {
    const { container } = render(
      <ColumnChart
        data={[{ key: '2025-W25', label: 'W25', hint: '16–22 Jun 2025', value: 8, partial: true }]}
        caption="Test"
        valueLabel="Sessions"
      />,
    )

    expect(container.querySelector('.column-slot')).toHaveAttribute(
      'title',
      '16–22 Jun 2025 (partial): 8',
    )
  })

  it('gives the table twin the same dates the hover has', () => {
    // A reader who cannot hover must not be the only one left without the "when".
    const { getByRole } = render(
      <ColumnChart
        data={[{ key: '2025-W25', label: 'W25', hint: '16–22 Jun 2025', value: 42 }]}
        caption="Test"
        valueLabel="Sessions"
      />,
    )

    expect(getByRole('row', { name: /16–22 Jun 2025/ })).toHaveTextContent('42')
  })
})
