import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { currentLocation, renderApp } from '../support/renderApp'
import { server } from '../support/server'

/** The at-a-glance chart's twin, as [check, count] pairs. */
async function chartRows(): Promise<[string, string][]> {
  const table = await screen.findByRole('table', { name: /reports failing each check/i })
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map(
      (row) => within(row).getAllByRole('cell').map((cell) => cell.textContent ?? ''),
    ) as [string, string][]
}

/** The card for one check, by its heading. */
async function card(title: RegExp): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: title })
  return heading.closest('section.card') as HTMLElement
}

function withQuality(overrides: Partial<Record<string, number>> = {}, ambiguous: unknown[] = []) {
  const counts: Record<string, number> = {
    no_topics: 5945,
    missing_pages: 1068,
    missing_session_end: 217,
    no_instructor: 73,
    unfinalized: 1068,
    missing_date: 0,
    missing_session_start: 0,
    ...overrides,
  }
  server.use(
    http.get('/api/reports/quality', () =>
      HttpResponse.json({
        centers: [],
        total: 29382,
        checks: Object.entries(counts).map(([key, count]) => ({ key, count })),
        ambiguous_keys: ambiguous,
      }),
    ),
  )
}

describe('data quality page', () => {
  it('reports each check against the number of reports checked', async () => {
    // ⚠️ 5,945 alone means nothing -- the denominator is what makes it readable.
    withQuality()
    renderApp('/data-quality')

    const topics = await card(/no topics recorded/i)
    expect(within(topics).getByText('5,945')).toBeInTheDocument()
    expect(within(topics).getByText(/of 29,382/i)).toBeInTheDocument()
  })

  it('shows the checks that pass, rather than only the failures', async () => {
    // A zero is the good news. Hiding it makes the page look like it only finds problems,
    // and hides the tripwires that matter most when they stop reading zero.
    withQuality()
    renderApp('/data-quality')

    const noDate = await card(/^no date$/i)
    expect(within(noDate).getByText('0')).toBeInTheDocument()
  })

  it('leads with what can be acted on, not with the biggest number', async () => {
    // Sorting by count would open on "no topics recorded" -- 5,945 sessions, most of them
    // fine -- on a page whose first question is what needs chasing.
    withQuality()
    renderApp('/data-quality')

    const rows = await chartRows()
    expect(rows[0][0]).toMatch(/unfinalized/i)
    expect(rows.map(([label]) => label)).toHaveLength(7)
  })

  it('says the checks overlap rather than implying they partition', async () => {
    // ⚠️ An unfinalized report has no page count either, so the bars double-count.
    withQuality()
    renderApp('/data-quality')

    await chartRows()
    expect(
      await screen.findByText(/can fail more than one check, so these bars overlap/i),
    ).toBeInTheDocument()
  })

  it('names the ambiguous keys, since there are only a few and each needs chasing', async () => {
    withQuality({}, [
      {
        account_id: 'acct-1',
        student_name: 'Elizabeth Burch',
        date: { $date: '2025-07-01T00:00:00Z' },
        session_start: { $date: '2025-07-01T15:30:00Z' },
        documents: 2,
      },
    ])
    renderApp('/data-quality')

    const row = await screen.findByRole('row', { name: /Elizabeth Burch/ })
    expect(within(row).getByText('2')).toBeInTheDocument()
  })

  it('links an ambiguous key by search rather than by a key it built itself', async () => {
    // ⚠️ student_key is account_id + a slug of the name, derived on the server. Spelling it
    // again here would be a second source of truth for a routing key -- and a wrong one
    // links to a profile that does not exist.
    withQuality({}, [
      {
        account_id: 'acct-1',
        student_name: 'Elizabeth Burch',
        date: { $date: '2025-07-01T00:00:00Z' },
        session_start: null,
        documents: 2,
      },
    ])
    renderApp('/data-quality')

    const link = await screen.findByRole('link', { name: 'Elizabeth Burch' })
    await userEvent.click(link)

    await waitFor(() => expect(currentLocation()).toContain('/students?query=Elizabeth'))
  })

  it('says so when no two reports share a key', async () => {
    withQuality()
    renderApp('/data-quality')

    expect(await screen.findByText(/no two reports share a natural key/i)).toBeInTheDocument()
  })

  it('admits the counts are not clickable yet', async () => {
    // Said plainly rather than shown as links that go nowhere: the reports list cannot
    // express "unfinalized" until it grows that filter.
    withQuality()
    renderApp('/data-quality')

    expect(await screen.findByText(/these counts are not yet clickable/i)).toBeInTheDocument()
  })

  it('scopes to the picked centres', async () => {
    const seen: string[] = []
    server.use(
      http.get('/api/reports/quality', ({ request }) => {
        seen.push(new URL(request.url).search)
        return HttpResponse.json({ centers: ['Westside'], total: 3, checks: [], ambiguous_keys: [] })
      }),
    )
    renderApp('/data-quality?center=Westside')

    await waitFor(() => expect(seen[0]).toContain('center=Westside'))
  })

  it('reaches the page from the sidebar', async () => {
    withQuality()
    const { user } = renderApp('/')

    await user.click(screen.getByRole('link', { name: 'Data Quality' }))

    await waitFor(() => expect(currentLocation()).toBe('/data-quality'))
  })

  it('reports a failure rather than an all-clear', async () => {
    // A 500 rendering as seven zeroes would read as a clean collection.
    server.use(http.get('/api/reports/quality', () => HttpResponse.json({}, { status: 500 })))
    renderApp('/data-quality')

    expect(await screen.findByRole('alert')).toHaveTextContent(/error 500/i)
    expect(screen.queryByRole('heading', { name: /no topics recorded/i })).not.toBeInTheDocument()
  })
})
