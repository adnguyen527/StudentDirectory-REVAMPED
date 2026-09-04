import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { currentLocation, renderApp } from '../support/renderApp'
import { ANTHONY, ANTHONY_KEY } from '../support/sampleData'
import { server } from '../support/server'

/** A page's worth of students, for the cases three fixtures cannot reach. */
function manyStudents(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    ...ANTHONY,
    _id: { $oid: String(i).padStart(24, '0') },
    student_key: `key-${i}`,
    student_name: `Student ${String(i).padStart(3, '0')}`,
  }))
}

function tableRows() {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1)
}

/** The first cell of each row, in the order served -- which is what a sort changes. */
function firstColumn() {
  return tableRows().map((row) => within(row).getAllByRole('cell')[0].textContent)
}

describe('students page', () => {
  it('shows a row per student with the figures a list is read for', async () => {
    renderApp('/students')

    const anthony = await screen.findByRole('row', { name: /Anthony Nguyen/ })
    expect(within(anthony).getByText('Westside')).toBeInTheDocument()
    // Sessions, topics finished, on plan.
    expect(within(anthony).getByText('2')).toBeInTheDocument()
    // The date renders as a date, in UTC -- not "[object Object]" and not a day early.
    expect(within(anthony).getByText('Mar 14, 2026')).toBeInTheDocument()
  })

  it('names the browser tab for the page', async () => {
    renderApp('/students')

    await screen.findByRole('row', { name: /Anthony Nguyen/ })
    expect(document.title).toBe('Students · Sigma')
  })

  it('takes its filter from the URL, so a search result is linkable', async () => {
    renderApp('/students?query=Chloe')

    expect(await screen.findByRole('row', { name: /Chloe Tan/ })).toBeInTheDocument()
    await waitFor(() => expect(tableRows()).toHaveLength(1))
    expect(screen.getByText(/1 matching/)).toBeInTheDocument()
  })

  it('filters from its own box, in place of the card title', async () => {
    // The page's <h1> already says Students, so the card header carries the filter
    // instead. Typing narrows the table without leaving the page.
    const { user } = renderApp('/students')
    await screen.findByRole('row', { name: /Anthony Nguyen/ })

    await user.type(screen.getByRole('searchbox', { name: /search students by name/i }), 'Chloe')

    await waitFor(() => expect(currentLocation()).toBe('/students?query=Chloe'))
    await waitFor(() => expect(tableRows()).toHaveLength(1))
    expect(screen.getByRole('row', { name: /Chloe Tan/ })).toBeInTheDocument()
  })

  it('clears the search from a button in the field', async () => {
    // The browsers' own clear button is switched off in ListFilter.css because it collides
    // with the rounded field, so this is the only way to empty the box in one gesture.
    // Deliberately past the end -- offset 50 over one match renders no rows, which is
    // exactly the state the offset has to be cleared out of.
    const { user } = renderApp('/students?query=Chloe&offset=50')
    const box = await screen.findByRole('searchbox', { name: /search students by name/i })
    await waitFor(() => expect(box).toHaveValue('Chloe'))

    await user.click(screen.getByRole('button', { name: /clear search/i }))

    // The offset goes with the term, as it does when the term is deleted by hand.
    await waitFor(() => expect(currentLocation()).toBe('/students'))
    expect(box).toHaveValue('')
    expect(await screen.findByRole('row', { name: /Anthony Nguyen/ })).toBeInTheDocument()
  })

  it('offers nothing to clear on an empty search box', async () => {
    // A permanently visible X on an empty field is a control that does nothing.
    renderApp('/students')

    await screen.findByRole('row', { name: /Anthony Nguyen/ })
    expect(screen.queryByRole('button', { name: /clear search/i })).not.toBeInTheDocument()
  })

  it('shows the filter it arrived with in the box', async () => {
    // Otherwise a linked-to search looks like an unexplained short list.
    renderApp('/students?query=Chloe')

    await screen.findByRole('row', { name: /Chloe Tan/ })
    expect(screen.getByRole('searchbox', { name: /search students by name/i })).toHaveValue('Chloe')
  })

  it('drops the offset when the filter changes', async () => {
    const { user } = renderApp('/students?offset=50')

    await user.type(screen.getByRole('searchbox', { name: /search students by name/i }), 'Chloe')

    await waitFor(() => expect(currentLocation()).toBe('/students?query=Chloe'))
  })

  it('filters by center, alongside the name search rather than instead of it', async () => {
    // The two narrow together: Chloe is the only Eastside student, and she is not a
    // Nguyen, so both filters at once find nobody.
    const { user } = renderApp('/students?query=Nguyen')
    await screen.findByRole('row', { name: /Anthony Nguyen/ })

    await user.click(screen.getByRole('button', { name: /all centers/i }))
    await user.click(await screen.findByRole('checkbox', { name: 'Eastside' }))

    await waitFor(() => expect(currentLocation()).toBe('/students?query=Nguyen&center=Eastside'))
    expect(await screen.findByText(/No students match/)).toBeInTheDocument()
  })

  it('takes the center filter from the URL, so a filtered list is linkable', async () => {
    renderApp('/students?center=Eastside')

    expect(await screen.findByRole('row', { name: /Chloe Tan/ })).toBeInTheDocument()
    await waitFor(() => expect(tableRows()).toHaveLength(1))
    expect(screen.getByRole('button', { name: /Eastside/ })).toBeInTheDocument()
  })

  it('clears the filter and the offset together', async () => {
    // Page 2 of a filtered list is not page 2 of the whole one.
    const { user } = renderApp('/students?query=Chloe&offset=0')
    await screen.findByRole('row', { name: /Chloe Tan/ })

    await user.click(screen.getByRole('button', { name: /clear filter/i }))

    await waitFor(() => expect(currentLocation()).toBe('/students'))
    expect(await screen.findByRole('row', { name: /Anthony Nguyen/ })).toBeInTheDocument()
  })

  it('offers to clear a center filter, which is the one that has no box to empty', async () => {
    // A search term can be cleared by deleting it; a ticked checkbox is only undone from
    // the dropdown, so the button appearing is what says the list is a subset at all.
    const { user } = renderApp('/students?center=Eastside')
    await screen.findByRole('row', { name: /Chloe Tan/ })

    await user.click(screen.getByRole('button', { name: /clear filter/i }))

    await waitFor(() => expect(currentLocation()).toBe('/students'))
    expect(await screen.findByRole('row', { name: /Anthony Nguyen/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /all centers/i })).toBeInTheDocument()
  })

  it('clears every filter at once, and says so in the plural', async () => {
    renderApp('/students?query=Nguyen&center=Westside&offset=50')

    expect(await screen.findByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })

  it('offers nothing to clear on an unfiltered list, paged or not', async () => {
    // The offset positions the list rather than narrowing it, so page 2 is not "filtered".
    renderApp('/students?offset=50')

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /clear filter/i })).not.toBeInTheDocument(),
    )
  })

  it('sorts by a column from its header, and states the order in the markup', async () => {
    const { user } = renderApp('/students')
    await screen.findByRole('row', { name: /Anthony Nguyen/ })

    await user.click(screen.getByRole('button', { name: 'Sessions' }))

    // A count column opens largest-first: most sessions is the end anyone clicks for.
    await waitFor(() => expect(currentLocation()).toBe('/students?sort=sessions&direction=desc'))
    await waitFor(() => expect(firstColumn()).toEqual(['Anthony Nguyen', 'Ava Nguyen', 'Chloe Tan']))
    expect(screen.getByRole('columnheader', { name: /sessions/i })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
  })

  it('reverses on a second click and turns off on a third', async () => {
    // The third state is the point: an order set by accident has to be undoable from the
    // button that set it, and the resting order is not always the name column.
    const { user } = renderApp('/students')
    await screen.findByRole('button', { name: 'Sessions' })
    // Re-queried before every click: the table is replaced while the next request is in
    // flight, so a header held across a click is a detached node that swallows it.
    // Exact, because the cell also holds a filter trigger that names the same column.
    const header = () => screen.getByRole('button', { name: 'Sessions' })

    await user.click(header())
    await waitFor(() => expect(currentLocation()).toBe('/students?sort=sessions&direction=desc'))

    await user.click(header())
    await waitFor(() => expect(currentLocation()).toBe('/students?sort=sessions&direction=asc'))
    // Ava and Chloe both have one session; the tie-break holds them in a fixed order.
    await waitFor(() => expect(firstColumn()).toEqual(['Ava Nguyen', 'Chloe Tan', 'Anthony Nguyen']))

    await user.click(header())
    await waitFor(() => expect(currentLocation()).toBe('/students'))
    expect(screen.getByRole('columnheader', { name: /sessions/i })).toHaveAttribute(
      'aria-sort',
      'none',
    )
  })

  it('opens a name column A-Z, not largest-first', async () => {
    // "First" means something different per column type, and the API agrees per column.
    const { user } = renderApp('/students')
    await screen.findByRole('row', { name: /Anthony Nguyen/ })

    await user.click(screen.getByRole('button', { name: 'Student' }))

    await waitFor(() => expect(currentLocation()).toBe('/students?sort=name&direction=asc'))
  })

  it('drops the offset when the order changes', async () => {
    // Page 3 of one ordering is not page 3 of another, and the rows are not the ones you
    // were looking at.
    const { user } = renderApp('/students?offset=1')

    await user.click(await screen.findByRole('button', { name: 'Sessions' }))

    await waitFor(() => expect(currentLocation()).toBe('/students?sort=sessions&direction=desc'))
  })

  it('shows the order it arrived with, so a sorted list is linkable', async () => {
    renderApp('/students?sort=sessions&direction=asc')

    await screen.findByRole('row', { name: /Anthony Nguyen/ })
    expect(screen.getByRole('columnheader', { name: /sessions/i })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    await waitFor(() => expect(firstColumn()).toEqual(['Ava Nguyen', 'Chloe Tan', 'Anthony Nguyen']))
  })

  it('resolves a sort with no direction the way the API does', async () => {
    // ?sort=sessions alone is a legitimate URL -- the column supplies the direction --
    // so the header has to draw an arrow rather than none.
    renderApp('/students?sort=sessions')

    await screen.findByRole('row', { name: /Anthony Nguyen/ })
    expect(screen.getByRole('columnheader', { name: /sessions/i })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
  })

  it('does not count an order as a filter', async () => {
    // Sorting does not narrow the list, so there is nothing to clear and no button.
    renderApp('/students?sort=sessions&direction=desc')

    await screen.findByRole('row', { name: /Anthony Nguyen/ })
    expect(screen.queryByRole('button', { name: /clear filter/i })).not.toBeInTheDocument()
  })

  it('keeps the order when the filters are cleared', async () => {
    const { user } = renderApp('/students?query=Nguyen&sort=sessions&direction=asc')
    await screen.findByRole('row', { name: /Anthony Nguyen/ })

    await user.click(screen.getByRole('button', { name: /clear filter/i }))

    await waitFor(() =>
      expect(currentLocation()).toBe('/students?sort=sessions&direction=asc'),
    )
  })

  it('says the order it is actually in, not the one it rests in', async () => {
    // The line under the title claimed "sorted by name" whatever the order was, which a
    // sorted list turned into a wrong statement about the rows underneath it.
    renderApp('/students?sort=sessions&direction=desc')

    expect(await screen.findByText(/most sessions first/)).toBeInTheDocument()
    expect(screen.queryByText(/sorted by name/)).not.toBeInTheDocument()
  })

  it('reads a sort with no direction the way the column does', async () => {
    renderApp('/students?sort=last_session')

    expect(await screen.findByText(/most recent session first/)).toBeInTheDocument()
  })

  it('filters a column to a range from its own header', async () => {
    // Anthony has 2 sessions; Ava and Chloe have 1 each.
    const { user } = renderApp('/students')
    await screen.findByRole('row', { name: /Anthony Nguyen/ })

    await user.click(screen.getByRole('button', { name: /filter by sessions/i }))
    await user.type(screen.getByRole('spinbutton', { name: /minimum sessions/i }), '2')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(currentLocation()).toBe('/students?sessions_min=2'))
    await waitFor(() => expect(firstColumn()).toEqual(['Anthony Nguyen']))
  })

  it('applies both bounds as one edit, not one per keystroke', async () => {
    // A range is a single question. Typing "1" on the way to "12" is not a question
    // anyone asked, and firing it would flash a wrong list on the way to the right one.
    const { user } = renderApp('/students')
    await screen.findByRole('row', { name: /Anthony Nguyen/ })

    await user.click(screen.getByRole('button', { name: /filter by sessions/i }))
    await user.type(screen.getByRole('spinbutton', { name: /minimum sessions/i }), '1')
    await user.type(screen.getByRole('spinbutton', { name: /maximum sessions/i }), '1')
    expect(currentLocation()).toBe('/students')

    await user.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(currentLocation()).toBe('/students?sessions_min=1&sessions_max=1'))
    await waitFor(() => expect(firstColumn()).toEqual(['Ava Nguyen', 'Chloe Tan']))
  })

  it('says on the trigger what the column is filtered to', async () => {
    // A closed panel that only named the column would leave a filtered list looking
    // unfiltered -- the same reason the center trigger says "2 centers".
    renderApp('/students?sessions_min=2')

    await screen.findByRole('row', { name: /Anthony Nguyen/ })
    expect(
      screen.getByRole('button', { name: /filter by sessions: 2 or more sessions/i }),
    ).toBeInTheDocument()
  })

  it('drops the offset when a range changes', async () => {
    const { user } = renderApp('/students?offset=1')

    await user.click(await screen.findByRole('button', { name: /filter by sessions/i }))
    await user.type(screen.getByRole('spinbutton', { name: /minimum sessions/i }), '2')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(currentLocation()).toBe('/students?sessions_min=2'))
  })

  it('counts a range as a filter, so it can be cleared with the others', async () => {
    const { user } = renderApp('/students?sessions_min=2&sort=name&direction=asc')
    await screen.findByRole('row', { name: /Anthony Nguyen/ })

    await user.click(screen.getByRole('button', { name: /clear filter/i }))

    // The range goes; the order stays, because an order is not a filter.
    await waitFor(() => expect(currentLocation()).toBe('/students?sort=name&direction=asc'))
  })

  it('filters by a date window, both ends inclusive', async () => {
    // Anthony 3/14, Ava 3/10, Chloe 2/1.
    renderApp('/students?last_session_from=2026-03-10')

    await waitFor(() => expect(firstColumn()).toEqual(['Anthony Nguyen', 'Ava Nguyen']))
    expect(
      screen.getByRole('button', { name: /filter by last session: since mar 10, 2026/i }),
    ).toBeInTheDocument()
  })

  it('offers date windows measured from the data, not from today', async () => {
    // The imported data ends long before the clock does, so "last 30 days" read off
    // today would match nobody. The preset names the date it resolves to.
    const { user } = renderApp('/students')
    await screen.findByRole('row', { name: /Anthony Nguyen/ })

    await user.click(screen.getByRole('button', { name: /filter by last session/i }))

    // The fixture's newest session is 2026-03-14, so 30 days back is 2026-02-12.
    const preset = await screen.findByRole('button', { name: /last 30 days/i })
    expect(preset).toHaveTextContent('Feb 12, 2026')

    await user.click(preset)
    await waitFor(() => expect(currentLocation()).toBe('/students?last_session_from=2026-02-12'))
  })

  it('clears one column filter without touching the others', async () => {
    const { user } = renderApp('/students?sessions_min=1&finished_min=1')
    await screen.findByRole('row', { name: /Anthony Nguyen/ })

    await user.click(screen.getByRole('button', { name: /filter by sessions/i }))
    await user.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(() => expect(currentLocation()).toBe('/students?finished_min=1'))
  })

  it('opens a student from their name in the list', async () => {
    const { user } = renderApp('/students')
    await user.click(await screen.findByRole('link', { name: 'Anthony Nguyen' }))

    await waitFor(() => {
      expect(currentLocation()).toBe(`/students/${encodeURIComponent(ANTHONY_KEY)}`)
    })
  })

  it('pages through the URL, so Back steps between pages', async () => {
    server.use(
      http.get('/api/students', ({ request }) => {
        const url = new URL(request.url)
        const limit = Number(url.searchParams.get('limit') ?? 50)
        const offset = Number(url.searchParams.get('offset') ?? 0)
        const all = manyStudents(60)
        const rows = all.slice(offset, offset + limit)
        return HttpResponse.json({
          students: rows,
          page: { limit, offset, total: all.length, returned: rows.length },
        })
      }),
    )
    const { user } = renderApp('/students')

    expect(await screen.findByText('1–50 of 60')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => expect(currentLocation()).toBe('/students?offset=50'))
    expect(await screen.findByText('51–60 of 60')).toBeInTheDocument()
    // Ten rows on the short last page, and nowhere further to go.
    await waitFor(() => expect(tableRows()).toHaveLength(10))
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('drops the offset from the URL when paging back to the first page', async () => {
    // ?offset=0 is noise: page one is the bare path, so a shared link is the clean one.
    server.use(
      http.get('/api/students', ({ request }) => {
        const url = new URL(request.url)
        const limit = Number(url.searchParams.get('limit') ?? 50)
        const offset = Number(url.searchParams.get('offset') ?? 0)
        const all = manyStudents(60)
        const rows = all.slice(offset, offset + limit)
        return HttpResponse.json({
          students: rows,
          page: { limit, offset, total: all.length, returned: rows.length },
        })
      }),
    )
    const { user } = renderApp('/students?offset=50')

    expect(await screen.findByText('51–60 of 60')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /previous/i }))

    await waitFor(() => expect(currentLocation()).toBe('/students'))
  })

  it('says no match, which must not look like a failure', async () => {
    renderApp('/students?query=nobody')

    expect(await screen.findByText(/No students match/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says what went wrong when the request fails, and shows no table', async () => {
    // The failure worth designing for: a 500 rendering as an empty list reads as
    // "no students".
    server.use(
      http.get('/api/students', () =>
        HttpResponse.json(
          {
            error: 'Server is not configured for authentication',
            detail: 'Set API_KEY in .env -- see .env.example',
          },
          { status: 500 },
        ),
      ),
    )
    renderApp('/students')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Error 500')
    expect(alert).toHaveTextContent('Set API_KEY in .env')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
