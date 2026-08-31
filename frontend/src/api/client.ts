/**
 * The one place the app talks to the API.
 *
 * Requests go to same-origin /api/*. Authentication is not handled here on purpose: in
 * dev the Vite proxy attaches X-API-Key server-side (see vite.config.ts), because a
 * shared key in a bundle is readable in DevTools -- auth.py says so directly. When
 * session auth lands, this file gains `credentials: 'include'` and nothing else changes.
 */

export type QueryValue = string | number | boolean | null | undefined

/**
 * A non-2xx answer from the API, with the body's own words kept.
 *
 * The three failures that actually happen mean different things to whoever is looking at
 * the screen, so the UI needs to be able to tell them apart:
 *   401 {error}          -- the proxy sent no key, or the wrong one
 *   500 {error, detail}  -- API_KEY is unset server-side; `detail` names the fix
 *   400 {error}          -- a bad limit/offset, or a search under 2 characters
 */
export class ApiError extends Error {
  readonly status: number
  readonly detail?: string

  constructor(status: number, message: string, detail?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }

  /** One line for a card's error state: the error, plus the fix when the body gives one. */
  get displayMessage(): string {
    return this.detail ? `${this.message} — ${this.detail}` : this.message
  }
}

function buildQuery(params?: Record<string, QueryValue>): string {
  if (!params) return ''
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    // Empty strings are dropped too: `?query=` is not the same request as no query at
    // all, and sending it would filter the list on nothing.
    if (value === null || value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

export async function request<T>(
  path: string,
  params?: Record<string, QueryValue>,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}${buildQuery(params)}`, {
      headers: { Accept: 'application/json' },
      signal,
    })
  } catch (error) {
    // An aborted request is a component unmounting, not a failure -- let useApi ignore it.
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'Could not reach the API. Is the Flask server running?')
  }

  // Read as text first: a proxy error or a stack trace is not JSON, and letting
  // response.json() throw would replace a useful status with a parse error.
  const body = await response.text()
  let parsed: unknown = null
  try {
    parsed = body ? JSON.parse(body) : null
  } catch {
    parsed = null
  }

  if (!response.ok) {
    // The dev proxy answers with its own non-JSON body when Flask is not listening at
    // all. That is the most common failure in development by a wide margin, so it gets a
    // message naming the cause rather than a bare status nobody can act on.
    if (parsed === null && response.status >= 502 && response.status <= 504) {
      throw new ApiError(
        response.status,
        'The API did not answer.',
        'Is the Flask server running? Start it with `python app.py`.',
      )
    }

    const payload = (parsed ?? {}) as { error?: string; detail?: string }
    throw new ApiError(
      response.status,
      payload.error ?? `Request failed (${response.status})`,
      payload.detail,
    )
  }

  return parsed as T
}
