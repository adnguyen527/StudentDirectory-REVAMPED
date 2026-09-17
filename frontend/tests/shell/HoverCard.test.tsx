import { render, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { useRovingGroup } from '../../src/charts/useRovingGroup'
import { HoverTarget } from '../../src/shell/HoverCard'

/**
 * The card behind every hover target -- show/pin/dismiss and the roving group, exercised
 * directly rather than through a chart. What a chart adds on top of this (the mark markup,
 * the data-driven content) is covered in tests/charts/marks.test.tsx instead.
 *
 * ⚠️ Queries are scoped to `container` throughout, not the ambient `screen`. The card
 * portals to `document.body`, so once it is open its header repeats the anchor's own text
 * -- "Alpha" names both the target and the card that names it -- and an unscoped query
 * would match either.
 */

describe('hover target', () => {
  it('shows on hover and hides once the pointer leaves, unpinned', async () => {
    const user = userEvent.setup()
    const { container } = render(<HoverTarget card={{ header: 'Alpha' }}>Alpha</HoverTarget>)
    const anchor = within(container).getByText('Alpha')

    await user.hover(anchor)
    expect(document.body.querySelector('[role="tooltip"]')).toHaveTextContent('Alpha')

    await user.unhover(anchor)
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('survives the pointer leaving once a click has pinned it', async () => {
    const user = userEvent.setup()
    const { container } = render(<HoverTarget card={{ header: 'Alpha' }}>Alpha</HoverTarget>)
    const anchor = within(container).getByText('Alpha')

    await user.click(anchor)
    await user.unhover(anchor)
    expect(document.body.querySelector('[role="tooltip"]')).toHaveTextContent('Alpha')
  })

  it('unpins on a second click of the same target', async () => {
    const user = userEvent.setup()
    const { container } = render(<HoverTarget card={{ header: 'Alpha' }}>Alpha</HoverTarget>)
    const anchor = within(container).getByText('Alpha')

    await user.click(anchor)
    await user.click(anchor)
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('closes on Escape and returns focus to the anchor', async () => {
    const user = userEvent.setup()
    const { container } = render(<HoverTarget card={{ header: 'Alpha' }}>Alpha</HoverTarget>)
    const anchor = within(container).getByText('Alpha')

    await user.click(anchor)
    expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull()

    await user.keyboard('{Escape}')
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull()
    expect(anchor).toHaveFocus()
  })

  it('closes on an outside click', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <>
        <HoverTarget card={{ header: 'Alpha' }}>Alpha</HoverTarget>
        <p>Elsewhere</p>
      </>,
    )

    await user.click(within(container).getByText('Alpha'))
    expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull()

    await user.click(within(container).getByText('Elsewhere'))
    expect(document.body.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('closes the first card when a second target opens', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <>
        <HoverTarget card={{ header: 'Alpha' }}>Alpha</HoverTarget>
        <HoverTarget card={{ header: 'Beta' }}>Beta</HoverTarget>
      </>,
    )

    await user.click(within(container).getByText('Alpha'))
    expect(document.body.querySelector('[role="tooltip"]')).toHaveTextContent('Alpha')

    await user.click(within(container).getByText('Beta'))
    const cards = document.body.querySelectorAll('[role="tooltip"]')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('Beta')
  })

  it('renders rows and the prose variant', async () => {
    const user = userEvent.setup()
    const { container, rerender } = render(
      <HoverTarget card={{ header: 'Sessions', rows: [{ name: 'Count', value: '42' }] }}>
        target
      </HoverTarget>,
    )
    await user.click(within(container).getByText('target'))
    let dialog = document.body.querySelector('[role="tooltip"]') as HTMLElement
    expect(dialog).toHaveTextContent('Count')
    expect(dialog).toHaveTextContent('42')

    rerender(<HoverTarget card={{ header: 'Unfinalized', prose: 'Never completed.' }}>target</HoverTarget>)
    dialog = document.body.querySelector('[role="tooltip"]') as HTMLElement
    expect(dialog).toHaveTextContent('Never completed.')
  })
})

interface GroupProps {
  count: number
  stride?: number
}

/** A minimal 1-D roving group, standing in for a chart's mark loop. */
function Group({ count, stride }: GroupProps) {
  const { groupProps, itemProps } = useRovingGroup({ count, stride })
  return (
    <div onKeyDown={groupProps.onKeyDown}>
      {Array.from({ length: count }, (_, index) => (
        <HoverTarget key={index} card={{ header: `Mark ${index}` }} {...itemProps(index)}>
          {`Mark ${index}`}
        </HoverTarget>
      ))}
    </div>
  )
}

describe('roving group', () => {
  it('gives the group exactly one tab stop, at the active mark', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <>
        <button type="button">Before</button>
        <Group count={3} />
        <button type="button">After</button>
      </>,
    )
    const marks = within(container).getAllByText(/^Mark /)
    expect(marks.map((el) => el.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])

    await user.tab()
    expect(within(container).getByText('Before')).toHaveFocus()
    await user.tab()
    expect(marks[0]).toHaveFocus()
    await user.tab()
    expect(within(container).getByText('After')).toHaveFocus()
  })

  it('walks the marks with the arrow keys, and the card follows', async () => {
    const user = userEvent.setup()
    const { container } = render(<Group count={3} />)
    const marks = within(container).getAllByText(/^Mark /)

    marks[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(marks[1]).toHaveFocus()
    expect(document.body.querySelector('[role="tooltip"]')).toHaveTextContent('Mark 1')

    await user.keyboard('{ArrowRight}')
    expect(marks[2]).toHaveFocus()

    await user.keyboard('{Home}')
    expect(marks[0]).toHaveFocus()
    await user.keyboard('{End}')
    expect(marks[2]).toHaveFocus()
  })
})
