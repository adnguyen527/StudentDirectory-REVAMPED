import { HttpResponse, http } from 'msw'
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../support/renderApp'
import { ANTHONY } from '../support/sampleData'
import { server } from '../support/server'

/**
 * The tile with this label.
 *
 * Scoped to the tile row: "Students" is also a sidebar nav item and a card title, so an
 * unscoped lookup is ambiguous on this page.
 */
async function tile(label: string): Promise<HTMLElement> {
  const row = await screen.findByTestId('tile-row')
  return within(row).getByText(label).closest('.stat-tile') as HTMLElement
}

describe('dashboard', () => {
  it('shows the all-time counts with their averages', async () => {
    renderApp('/')

    expect(within(await tile('Students')).getByText('3')).toBeInTheDocument()

    const reports = await tile('DWP reports')
    expect(within(reports).getByText('4')).toBeInTheDocument()
    expect(within(reports).getByText('1.33 per student on average')).toBeInTheDocument()
  })

  it('calls the preview what it is: the top of the alphabet, not recent activity', async () => {
    // /api/students sorts by name, so "recent" would be a claim the data cannot back.
    renderApp('/')
    expect(await screen.findByRole('heading', { name: /Students · first 8 A–Z/ })).toBeInTheDocument()
  })

  it('carries its own error on the tiles, where a missing key shows up first', async () => {
    server.use(
      http.get('/api/metrics', () =>
        HttpResponse.json(
          {
            error: 'Server is not configured for authentication',
            detail: 'Set API_KEY in .env -- see .env.example',
          },
          { status: 500 },
        ),
      ),
    )
    renderApp('/')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Set API_KEY in .env')
    // The student card still loads: one failed endpoint does not blank the page.
    expect(await screen.findByRole('row', { name: /Anthony Nguyen/ })).toBeInTheDocument()
  })

  it('tells an empty database from a broken one', async () => {
    server.use(
      http.get('/api/students', () =>
        HttpResponse.json({
          students: [],
          page: { limit: 8, offset: 0, total: 0, returned: 0 },
        }),
      ),
    )
    renderApp('/')

    expect(await screen.findByText(/run the ingestion scripts/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a dash for a student with no center', async () => {
    server.use(
      http.get('/api/students', () =>
        HttpResponse.json({
          students: [{ ...ANTHONY, centers: [] }],
          page: { limit: 8, offset: 0, total: 1, returned: 1 },
        }),
      ),
    )
    renderApp('/')

    const row = await screen.findByRole('row', { name: /Anthony Nguyen/ })
    expect(within(row).getByText('—')).toBeInTheDocument()
  })
})
