import type { ReactNode } from 'react'

import type { ApiError } from '../api/client'

interface AsyncBoundaryProps {
  loading: boolean
  error: ApiError | null
  /** True when the request succeeded but there is nothing to draw. */
  empty?: boolean
  emptyMessage?: string
  children: ReactNode
}

/**
 * Loading, failed and empty, told apart.
 *
 * The failure worth designing for is the one where a 500 renders as an empty table and
 * reads as "no students" -- so an error states what went wrong, and where the API's body
 * carries a `detail` (the unset-API_KEY case names its own fix) that is shown too.
 */
export function AsyncBoundary({
  loading,
  error,
  empty,
  emptyMessage = 'Nothing to show.',
  children,
}: AsyncBoundaryProps) {
  if (error) {
    return (
      <div className="state-error" role="alert">
        <strong>{error.status ? `Error ${error.status}` : 'Cannot reach the API'}</strong>
        {error.displayMessage}
      </div>
    )
  }

  if (loading) return <p className="state">Loading…</p>
  if (empty) return <p className="state">{emptyMessage}</p>

  return <>{children}</>
}
