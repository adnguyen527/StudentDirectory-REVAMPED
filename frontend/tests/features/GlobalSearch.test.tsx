import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { currentLocation, renderApp } from '../support/renderApp'
import { ANTHONY, ANTHONY_KEY } from '../support/sampleData'
import { server } from '../support/server'

/**
 * The top-bar search, driven the way a person drives it.
 *
 * Nothing here is mocked below the network, so a passing test means the debounce, the
 * two-character floor, client.ts, useApi, the dropdown and the router all worked together.
 *
 * The fixture cast makes the cases: "an" matches students (Anthony, Chloe Tan) and an
 * instructor (Dana Reyes); "webb" matches only Marcus Webb; "chloe" only a student.
 */

/** Search requests seen since the last reset, so debouncing can be asserted. */
let searchCalls: string[] = []

beforeEach(() => {
  searchCalls = []
  server.events.on('request:start', onRequest)
})

afterEach(() => {
  server.events.removeListener('request:start', onRequest)
})

function onRequest({ request }: { request: Request }) {
  const url = new URL(request.url)
  if (url.pathname.endsWith('/search')) searchCalls.push(url.pathname + url.search)
}

function searchBox() {
  return screen.getByRole('searchbox', { name: /search students and instructors/i })
}

describe('global search', () => {
  it('does not ask the server below the two-character floor', async () => {
    const { user } = renderApp()
    await user.click(searchBox())
    await user.type(searchBox(), 'a')

    expect(await screen.findByText(/at least 2 characters/i)).toBeInTheDocument()
    // The server would answer 400; not asking is the point.
    expect(searchCalls).toHaveLength(0)
  })

  it('sends one request per pause, not one per keystroke', async () => {
    const { user } = renderApp()
    await user.type(searchBox(), 'an')
    await screen.findByRole('button', { name: /Anthony Nguyen/ })

    // Two endpoints, one request each -- four keystrokes' worth of typing did not become
    // four round trips.
    expect(searchCalls.filter((c) => c.includes('/students/search'))).toHaveLength(1)
    expect(searchCalls.filter((c) => c.includes('/instructors/search'))).toHaveLength(1)
  })

  it('groups the two kinds and totals each, because a name can match both', async () => {
    const { user } = renderApp()
    await user.type(searchBox(), 'an')

    // Each group is a labelled region, so this cannot accidentally match the dashboard's
    // "Students" card heading behind the dropdown.
    const students = await screen.findByRole('region', { name: 'Students' })
    expect(within(students).getByRole('button', { name: /Anthony Nguyen/ })).toBeInTheDocument()
    expect(within(students).getByRole('button', { name: /Chloe Tan/ })).toBeInTheDocument()

    const instructors = screen.getByRole('region', { name: 'Instructors' })
    expect(within(instructors).getByRole('button', { name: /Dana Reyes/ })).toBeInTheDocument()
    // Dana is not offered as a student, nor Anthony as an instructor.
    expect(within(instructors).queryByRole('button', { name: /Anthony/ })).not.toBeInTheDocument()
  })

  it('opens a student by key, so two students sharing a name still resolve', async () => {
    const { user } = renderApp()
    await user.type(searchBox(), 'an')
    await user.click(await screen.findByRole('button', { name: /Anthony Nguyen/ }))

    await waitFor(() => {
      expect(currentLocation()).toBe(`/students/${encodeURIComponent(ANTHONY_KEY)}`)
    })
  })

  it('opens an instructor by name, which is all the source data carries', async () => {
    const { user } = renderApp()
    await user.type(searchBox(), 'an')
    await user.click(await screen.findByRole('button', { name: /Dana Reyes/ }))

    await waitFor(() => {
      expect(currentLocation()).toBe('/instructors/Dana%20Reyes')
    })
  })

  it('Enter goes to the student list when students matched', async () => {
    const { user } = renderApp()
    await user.type(searchBox(), 'an')
    await screen.findByRole('button', { name: /Anthony Nguyen/ })
    await user.keyboard('{Enter}')

    await waitFor(() => expect(currentLocation()).toBe('/students?query=an'))
  })

  it('Enter goes to the instructor list when only instructors matched', async () => {
    // The open question the grouping settled: one destination cannot serve both kinds.
    const { user } = renderApp()
    await user.type(searchBox(), 'webb')
    await screen.findByRole('button', { name: /Marcus Webb/ })
    await user.keyboard('{Enter}')

    await waitFor(() => expect(currentLocation()).toBe('/instructors?query=webb'))
  })

  it('offers "see all" only for a group with more rows than it showed', async () => {
    const { user } = renderApp()
    await user.type(searchBox(), 'chloe')
    await screen.findByRole('button', { name: /Chloe Tan/ })

    // One match, one row shown: a "see all 1" link would be a link to the same thing.
    expect(screen.queryByRole('button', { name: /see all/i })).not.toBeInTheDocument()
  })

  it('offers "see all" when a group has more than it showed, and it goes to that list', async () => {
    // Four rows per group; the count is the whole match, so anything above four needs a
    // way through to the full list.
    server.use(
      http.get('/api/students/search', () =>
        HttpResponse.json({
          students: Array.from({ length: 4 }, (_, i) => ({
            ...ANTHONY,
            student_key: `key-${i}`,
            student_name: `Match ${i}`,
          })),
          page: { limit: 4, offset: 0, total: 12, returned: 4 },
        }),
      ),
    )
    const { user } = renderApp()
    await user.type(searchBox(), 'match')

    const seeAll = await screen.findByRole('button', { name: /see all 12 students/i })
    await user.click(seeAll)

    await waitFor(() => expect(currentLocation()).toBe('/students?query=match'))
  })

  it('says nothing matched once, not once per group', async () => {
    const { user } = renderApp()
    await user.type(searchBox(), 'zzzqqq')

    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument()
    expect(screen.queryAllByText(/Nothing matches/)).toHaveLength(1)
  })

  it('still shows the group that worked when the other endpoint fails', async () => {
    // One list is more useful than a blank dropdown.
    server.use(
      http.get('/api/instructors/search', () =>
        HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      ),
    )
    const { user } = renderApp()
    await user.type(searchBox(), 'an')

    expect(await screen.findByRole('button', { name: /Anthony Nguyen/ })).toBeInTheDocument()
    expect(screen.queryByText(/Unauthorized/)).not.toBeInTheDocument()
  })

  it('reports the failure when both endpoints fail', async () => {
    server.use(
      http.get('/api/students/search', () =>
        HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      ),
      http.get('/api/instructors/search', () =>
        HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      ),
    )
    const { user } = renderApp()
    await user.type(searchBox(), 'an')

    expect(await screen.findByText(/Unauthorized/)).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const { user } = renderApp()
    await user.type(searchBox(), 'an')
    await screen.findByRole('button', { name: /Anthony Nguyen/ })

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Anthony Nguyen/ })).not.toBeInTheDocument()
    })
  })
})
