import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '../../src/api/client'
import { AsyncBoundary } from '../../src/shell/AsyncBoundary'

/**
 * Loading, failed and empty must look like three different things. The failure worth
 * designing against is a 500 rendering as an empty table and reading as "no results".
 */
describe('AsyncBoundary', () => {
  it('renders children once there is something to show', () => {
    render(
      <AsyncBoundary loading={false} error={null}>
        <p>rows</p>
      </AsyncBoundary>,
    )
    expect(screen.getByText('rows')).toBeInTheDocument()
  })

  it('shows an error ahead of everything else, as an alert', () => {
    render(
      <AsyncBoundary loading error={new ApiError(500, 'Boom', 'try this')} empty>
        <p>rows</p>
      </AsyncBoundary>,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Error 500')
    // The detail is shown because it is the half that names the fix.
    expect(alert).toHaveTextContent('try this')
    expect(screen.queryByText('rows')).not.toBeInTheDocument()
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument()
  })

  it('names an unreachable API rather than printing "Error 0"', () => {
    render(
      <AsyncBoundary loading={false} error={new ApiError(0, 'Could not reach the API.')}>
        <p>rows</p>
      </AsyncBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot reach the API')
  })

  it('prefers loading over empty, so a slow load is not reported as no data', () => {
    render(
      <AsyncBoundary loading error={null} empty>
        <p>rows</p>
      </AsyncBoundary>,
    )
    expect(screen.getByText(/Loading/)).toBeInTheDocument()
    expect(screen.queryByText('rows')).not.toBeInTheDocument()
  })

  it('uses the caller message when empty, and a default when none is given', () => {
    const { rerender } = render(
      <AsyncBoundary loading={false} error={null} empty emptyMessage="No students match.">
        <p>rows</p>
      </AsyncBoundary>,
    )
    expect(screen.getByText('No students match.')).toBeInTheDocument()
    // No alert: empty is an answer, not a failure.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    rerender(
      <AsyncBoundary loading={false} error={null} empty>
        <p>rows</p>
      </AsyncBoundary>,
    )
    expect(screen.getByText('Nothing to show.')).toBeInTheDocument()
  })
})
