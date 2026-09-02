import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'

import { ApiError, request } from '../../src/api/client'
import { server } from '../support/server'

/**
 * The three failure shapes the API actually returns mean different things to whoever is
 * looking at the screen, so the client has to keep them apart -- and keep the body's own
 * words, which is what makes the unset-key case self-explaining.
 */
describe('request', () => {
  it('returns the parsed body on success', async () => {
    const metrics = await request<{ total_students: number }>('/metrics')
    expect(metrics.total_students).toBe(3)
  })

  it('builds a query string and drops empty values', async () => {
    // `?query=` is not the same request as no query at all -- sending it would filter on
    // nothing.
    let seen = ''
    server.use(
      http.get('/api/students', ({ request: req }) => {
        seen = new URL(req.url).search
        return HttpResponse.json({ students: [], page: { limit: 50, offset: 0, total: 0, returned: 0 } })
      }),
    )
    await request('/students', { limit: 10, query: '', offset: undefined, q: null })
    expect(seen).toBe('?limit=10')
  })

  it('repeats a key for an array, rather than keeping only the last value', async () => {
    // A multi-select filter sends ?center=A&center=B, which is what Flask's
    // request.args.getlist reads. URLSearchParams.set would keep only B.
    let seen = ''
    server.use(
      http.get('/api/students', ({ request: req }) => {
        seen = new URL(req.url).search
        return HttpResponse.json({ students: [], page: { limit: 50, offset: 0, total: 0, returned: 0 } })
      }),
    )
    await request('/students', { center: ['Westside', 'Eastside'] })
    expect(seen).toBe('?center=Westside&center=Eastside')
  })

  it('drops an empty array, as it drops an empty string', async () => {
    // Nothing ticked is not a filter on nothing.
    let seen = 'unset'
    server.use(
      http.get('/api/students', ({ request: req }) => {
        seen = new URL(req.url).search
        return HttpResponse.json({ students: [], page: { limit: 50, offset: 0, total: 0, returned: 0 } })
      }),
    )
    await request('/students', { center: [], limit: 10 })
    expect(seen).toBe('?limit=10')
  })

  it('sends no query string when there are no params', async () => {
    let seen = 'unset'
    server.use(
      http.get('/api/metrics', ({ request: req }) => {
        seen = new URL(req.url).search
        return HttpResponse.json({ total_students: 0 })
      }),
    )
    await request('/metrics')
    expect(seen).toBe('')
  })

  it('lets an abort propagate rather than reporting it as a failure', async () => {
    // An aborted request is a component unmounting, not something to show the user.
    const controller = new AbortController()
    const pending = request('/metrics', undefined, controller.signal).catch((e: unknown) => e)
    controller.abort()

    // Asserted on the name, not the class: DOMException is realm-bound, which is exactly
    // the trap the client had to stop falling into.
    const error = await pending
    expect((error as Error).name).toBe('AbortError')
    expect(error).not.toBeInstanceOf(ApiError)
  })

  it('falls back to a status message when the body names no error', async () => {
    server.use(http.get('/api/metrics', () => HttpResponse.json({}, { status: 418 })))
    const error = (await request('/metrics').catch((e: unknown) => e)) as ApiError
    expect(error.message).toBe('Request failed (418)')
    // No detail, so displayMessage is just the message.
    expect(error.displayMessage).toBe('Request failed (418)')
  })

  it('carries the error text from a 400', async () => {
    const error = await request('/students/search', { q: 'a' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(400)
    expect((error as ApiError).message).toBe('Query must be at least 2 characters')
  })

  it('surfaces a 401 as unauthorized', async () => {
    server.use(
      http.get('/api/metrics', () => HttpResponse.json({ error: 'Unauthorized' }, { status: 401 })),
    )
    const error = (await request('/metrics').catch((e: unknown) => e)) as ApiError
    expect(error.status).toBe(401)
    expect(error.message).toBe('Unauthorized')
  })

  it('keeps the detail from the unset-API_KEY 500, because it names the fix', async () => {
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
    const error = (await request('/metrics').catch((e: unknown) => e)) as ApiError
    expect(error.detail).toBe('Set API_KEY in .env -- see .env.example')
    expect(error.displayMessage).toContain('Set API_KEY in .env')
  })

  it('turns a proxy 502 into the message that names the real cause', async () => {
    // Flask not running is the most common failure in development by a wide margin, and
    // the proxy answers with a non-JSON body, so "Request failed (502)" is all a generic
    // path could say.
    server.use(http.get('/api/metrics', () => new HttpResponse('Bad Gateway', { status: 502 })))
    const error = (await request('/metrics').catch((e: unknown) => e)) as ApiError
    expect(error.message).toBe('The API did not answer.')
    expect(error.detail).toContain('python app.py')
  })

  it('reports an unreachable API rather than throwing a raw fetch error', async () => {
    server.use(http.get('/api/metrics', () => HttpResponse.error()))
    const error = (await request('/metrics').catch((e: unknown) => e)) as ApiError
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(0)
    expect(error.message).toContain('Could not reach the API')
  })

  it('does not let a non-JSON error body mask the status', async () => {
    server.use(http.get('/api/metrics', () => new HttpResponse('<html>oops</html>', { status: 503 })))
    const error = (await request('/metrics').catch((e: unknown) => e)) as ApiError
    expect(error.status).toBe(503)
  })
})
