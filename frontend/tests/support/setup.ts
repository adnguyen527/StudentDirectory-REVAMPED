import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'

import { server } from './server'

/**
 * onUnhandledRequest: 'error' is the important setting here.
 *
 * A request the handlers do not cover fails the test loudly instead of hanging until the
 * assertion times out with a message about missing text. It is the same instinct as
 * conftest.py pointing MONGODB_URI at an unroutable host: an unmocked call should be a
 * clear failure, never a silent one.
 */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

afterEach(() => {
  // Drop any server.use() override so one test's forced 500 cannot leak into the next.
  server.resetHandlers()
  cleanup()
})

afterAll(() => server.close())
