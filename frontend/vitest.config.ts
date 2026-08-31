import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Separate from vite.config.ts on purpose.
 *
 * That file exists to run the dev server: it reads the repo-root .env for the API key and
 * warns when the key is missing. Neither concern belongs in a test run -- tests never talk
 * to Flask, and inheriting the config would print a key warning on every `npm test`.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/support/setup.ts'],
    env: {
      /**
       * Pinned to a real, non-UTC zone -- the one the centers are actually in.
       *
       * The date helpers format in UTC on purpose, because the stored datetimes are naive
       * wall clock (see combine_session_time in ingestion/import_reports.py). On a UTC
       * machine, which is most CI, a local reading and a UTC reading agree, so those
       * regression tests would pass even with the fix removed. Forcing an offset keeps
       * them honest: -05:00/-06:00 turns a 17:53 session into 12:53 if anyone drops the
       * timeZone option.
       */
      TZ: 'America/Chicago',
    },
    // The components import their own .css; the tests assert on text and roles, never on
    // computed style, so parsing it would be work for nothing.
    css: false,
    restoreMocks: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // Coverage is a statement about src, and the tests now live outside it -- so the
      // only thing left to exclude is the entry point, which is a mount call.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx'],
    },
  },
})
