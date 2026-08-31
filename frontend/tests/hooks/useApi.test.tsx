import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '../../src/api/client'
import { useApi } from '../../src/hooks/useApi'

/**
 * The hook every page loads through. Its job is the three states plus cancellation, and
 * cancellation is the part nothing else can show: a fetch that outlives its component
 * must not set state on it or overwrite a newer result.
 */
describe('useApi', () => {
  it('reports data once the call resolves', async () => {
    const { result } = renderHook(() => useApi(() => Promise.resolve('ok'), []))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBe('ok')
    expect(result.current.error).toBeNull()
  })

  it('aborts the in-flight request when the component unmounts', async () => {
    let signal: AbortSignal | undefined
    const { unmount } = renderHook(() =>
      useApi((s) => {
        signal = s
        return new Promise<string>(() => {})
      }, []),
    )

    await waitFor(() => expect(signal).toBeDefined())
    expect(signal!.aborted).toBe(false)

    unmount()
    expect(signal!.aborted).toBe(true)
  })

  it('ignores a rejection that arrives after unmount', async () => {
    // Setting state on an unmounted component is the bug this guards; the assertion is
    // that nothing throws and the rejection is swallowed.
    let reject: (reason: unknown) => void = () => {}
    const { unmount } = renderHook(() =>
      useApi(() => new Promise<string>((_, r) => { reject = r }), []),
    )

    unmount()
    reject(new ApiError(500, 'too late'))
    await new Promise((r) => setTimeout(r, 0))
  })

  it('re-runs when the deps change and not otherwise', async () => {
    let calls = 0
    const { result, rerender } = renderHook(
      ({ id }: { id: number }) => useApi(() => { calls += 1; return Promise.resolve(id) }, [id]),
      { initialProps: { id: 1 } },
    )

    await waitFor(() => expect(result.current.data).toBe(1))
    expect(calls).toBe(1)

    rerender({ id: 1 })
    await waitFor(() => expect(result.current.data).toBe(1))
    expect(calls).toBe(1)

    rerender({ id: 2 })
    await waitFor(() => expect(result.current.data).toBe(2))
    expect(calls).toBe(2)
  })

  it('keeps the previous result on screen while the next one loads', async () => {
    // Blanking the table on every page change makes a fast request look like a flicker.
    let resolve: (value: string) => void = () => {}
    const { result, rerender } = renderHook(
      ({ id }: { id: number }) =>
        useApi(
          () => (id === 1 ? Promise.resolve('first') : new Promise<string>((r) => { resolve = r })),
          [id],
        ),
      { initialProps: { id: 1 } },
    )

    await waitFor(() => expect(result.current.data).toBe('first'))
    rerender({ id: 2 })

    await waitFor(() => expect(result.current.loading).toBe(true))
    expect(result.current.data).toBe('first')

    resolve('second')
    await waitFor(() => expect(result.current.data).toBe('second'))
  })

  it('passes an ApiError through untouched', async () => {
    const original = new ApiError(404, 'Student not found')
    const { result } = renderHook(() => useApi(() => Promise.reject(original), []))

    await waitFor(() => expect(result.current.error).toBe(original))
    expect(result.current.error?.status).toBe(404)
  })

  it('wraps a non-ApiError rejection so the UI still has something to show', async () => {
    const { result } = renderHook(() => useApi(() => Promise.reject(new TypeError('boom')), []))

    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError))
    expect(result.current.error?.message).toBe('Something went wrong loading this data.')
    expect(result.current.data).toBeNull()
  })
})
