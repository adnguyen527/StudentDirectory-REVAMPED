import { useEffect, useState } from 'react'

import { ApiError } from '../api/client'

export interface ApiState<T> {
  data: T | null
  loading: boolean
  error: ApiError | null
}

/**
 * Run an API call and track its loading and error state.
 *
 * Every page needs the same three things -- a result, a spinner while it is coming, and
 * an error that says what went wrong -- plus cancellation, so a fetch that outlives its
 * component cannot set state on it or overwrite a newer result. Written once here rather
 * than three times with three different bugs.
 *
 * `deps` is what re-runs the call: pass the values the request is built from (offset, the
 * query string), not the function itself, which is a new reference on every render.
 */
export function useApi<T>(
  call: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): ApiState<T> {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: true,
    error: null,
  })

  // The rule cannot statically see that `deps` is a dependency array, so it reads the
  // setState below as unguarded. It is guarded -- the effect re-runs only when `deps`
  // changes, and every caller passes primitives.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const controller = new AbortController()
    // Keep whatever is on screen while the next page loads -- blanking the table on every
    // page change makes a fast request look like a flicker.
    setState((previous) => ({ ...previous, loading: true, error: null }))

    call(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, loading: false, error: null })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          data: null,
          loading: false,
          error:
            error instanceof ApiError
              ? error
              : new ApiError(0, 'Something went wrong loading this data.'),
        })
      })

    return () => controller.abort()
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}
