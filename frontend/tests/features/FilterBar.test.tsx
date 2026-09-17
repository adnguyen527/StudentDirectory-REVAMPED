import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { currentLocation, renderApp } from '../support/renderApp'

/**
 * Where the list filters sit.
 *
 * ⚠️ This file exists because the arrangement is the feature. The controls were built into
 * the list card's header, before there was a chart above it -- which left a control that
 * scopes two cards living inside the second one, below the thing it changes. Nothing about
 * *behaviour* would notice if they slid back; these tests would.
 *
 * The chart that prompted the move has since gone to the center metrics page, so the row
 * now sits above one card rather than two. That does not make its position arbitrary: it
 * still scopes the list from outside the list's own card, which is the thing being held.
 */

/** Every list page, and the search box each one is filtered by. */
const LISTS = [
  { path: '/students', search: /search students by name/i, heading: 'Students' },
  { path: '/instructors', search: /search instructors by name/i, heading: 'Instructors' },
  { path: '/reports', search: /search reports by student name/i, heading: 'Reports' },
  { path: '/topics', search: /search topics by name or id/i, heading: 'Topics' },
] as const

describe('the list filter row', () => {
  it.each(LISTS)('on $path, sits outside the list card', async ({ path, search }) => {
    renderApp(path)

    const box = await screen.findByRole('searchbox', { name: search })
    // The assertion: not inside any card at all. Inside one, it would be scoping a sibling
    // card from within its neighbour.
    expect(box.closest('.card')).toBeNull()
    expect(box.closest('.filter-bar')).not.toBeNull()
  })

  it.each(LISTS)('on $path, sits above everything it scopes', async ({ path, search }) => {
    renderApp(path)

    const box = await screen.findByRole('searchbox', { name: search })
    const row = box.closest('.filter-bar') as HTMLElement
    const firstCard = document.querySelector('.page .card') as HTMLElement

    // DOCUMENT_POSITION_FOLLOWING: the row comes first in the page's flow.
    expect(row.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each(LISTS)('on $path, the page heading no longer carries the count', async ({ path, heading }) => {
    // The count and the order describe the table, so they moved onto the table's card.
    // The page heading is left saying only what the page is.
    renderApp(path)

    const h1 = await screen.findByRole('heading', { level: 1, name: heading })
    expect(h1.parentElement?.textContent).toBe(heading)
  })

  it.each(LISTS)('on $path, the list card is named without repeating the page', async ({ path, heading }) => {
    // ⚠️ A card titled the same as the <h1> would say one thing twice on screen and make
    // getByRole('heading', { name }) ambiguous -- which is why the title leads with a count.
    renderApp(path)

    await screen.findByRole('heading', { level: 1, name: heading })
    await waitFor(() =>
      expect(screen.getAllByRole('heading', { name: heading })).toHaveLength(1),
    )
  })

  it('keeps Clear in the row, not in the card it used to sit in', async () => {
    renderApp('/students?query=Nguyen')

    const clear = await screen.findByRole('button', { name: /clear filter/i })
    expect(clear.closest('.filter-bar')).not.toBeNull()
    expect(clear.closest('.card')).toBeNull()
  })

  it('shows Clear only once something is actually set', async () => {
    // The button is the only sign that what you are reading is a subset, so it appearing
    // has to mean exactly that.
    renderApp('/students')

    await screen.findByRole('searchbox', { name: /search students by name/i })
    expect(screen.queryByRole('button', { name: /clear filter/i })).not.toBeInTheDocument()
  })

  it('still narrows the table it sits above', async () => {
    // The behaviour the move was careful not to break: one row, everything under it.
    //
    // It used to assert this over the centre chart as well, which was the second thing the
    // row scoped. That chart now lives on the center metrics page, so the table is the
    // whole of what is under the row and the whole of what this can check.
    renderApp('/students')

    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(4) // header + three students

    await userEvent.type(
      screen.getByRole('searchbox', { name: /search students by name/i }),
      'Nguyen',
    )
    await waitFor(() => expect(currentLocation()).toContain('query=Nguyen'))

    await waitFor(() =>
      expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3),
    )
  })
})

describe('the list card title', () => {
  it('counts one match in the singular', async () => {
    // ⚠️ The bug naming the noun introduced. The old line read "1 matching, sorted by name"
    // -- no noun, so no plural to get wrong -- and "1 matching students" only appears when a
    // filter happens to match exactly one row, which is how it survives a review.
    // Chloe Tan is the one fixture student neither Nguyen sibling shares a name with.
    renderApp('/students?query=Chloe')

    expect(
      await screen.findByRole('heading', { name: /^1 matching student, sorted by name$/i }),
    ).toBeInTheDocument()
  })

  it('counts many in the plural', async () => {
    renderApp('/students')

    expect(
      await screen.findByRole('heading', { name: /^3 students, sorted by name$/i }),
    ).toBeInTheDocument()
  })

  it('follows the order the table is actually in', async () => {
    // The line claimed "sorted by name" whatever the order was until orderPhrase existed;
    // moving it onto the card must not lose that.
    renderApp('/students?sort=sessions')

    expect(
      await screen.findByRole('heading', { name: /most sessions first/i }),
    ).toBeInTheDocument()
  })
})
