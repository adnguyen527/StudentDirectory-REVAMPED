import '@testing-library/jest-dom/vitest'

import { cleanup, configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'

import { server } from './server'

/**
 * findBy*'s default 1000ms is too tight for this suite.
 *
 * Several pages fire two or three requests before the thing under test appears -- a student
 * profile fetches the detail and then its attendance, a list page the rows and then its
 * chart -- and each hop goes through MSW. On a loaded machine that overran 1000ms often
 * enough to fail a different test on each run, which is the worst kind of red: it says
 * nothing about the code and trains people to re-run.
 *
 * Raised rather than papered over with per-call timeouts, which would have to be argued for
 * again at every new assertion. It only lengthens the *failure* path -- a passing query
 * still resolves as soon as the element appears.
 */
configure({ asyncUtilTimeout: 5000 })

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
