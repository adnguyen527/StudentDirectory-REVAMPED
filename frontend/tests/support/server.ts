import { setupServer } from 'msw/node'

import { handlers } from './handlers'

/**
 * The fake API every test runs against.
 *
 * This is mongomock's counterpart: a stand-in at the boundary, so the code under test is
 * the real thing all the way down to fetch. Nothing in src/api is mocked, which is the
 * point -- client.ts's error mapping and bson.ts's date unwrapping only get exercised if
 * a real response passes through them.
 */
export const server = setupServer(...handlers)
