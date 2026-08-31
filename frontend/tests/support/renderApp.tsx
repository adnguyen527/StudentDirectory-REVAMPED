import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'

import App from '../../src/App'

/**
 * Reports the current route into the DOM so a test can assert where a click went.
 *
 * Navigation is the thing several of these tests are actually about -- does picking a
 * search result open that student, does Enter go to the right list -- and asserting on
 * the rendered page alone cannot tell "/students/x" from "/students?query=x" when both
 * render a student's name.
 */
// This is a test helper, not part of the app tree, so fast refresh never sees it: the
// one-component-per-file rule buys nothing here, and splitting the probe away from the
// render helpers that use it would only scatter them.
// oxlint-disable-next-line react/only-export-components
function LocationProbe() {
  const location = useLocation()
  return (
    <div data-testid="location" hidden>
      {location.pathname}
      {location.search}
    </div>
  )
}

/**
 * Mount the whole app at a route.
 *
 * MemoryRouter rather than BrowserRouter: the same routes from App.tsx, without needing a
 * real URL bar. Everything below is the production tree -- shell, pages, client, hooks --
 * with only the network faked.
 */
export function renderApp(route = '/') {
  const user = userEvent.setup()
  const view = render(
    <MemoryRouter initialEntries={[route]}>
      <App />
      <LocationProbe />
    </MemoryRouter>,
  )
  return { user, ...view }
}

/** One component in a router, for pieces that navigate but are not a whole page. */
export function renderWithRouter(ui: ReactElement, route = '/') {
  const user = userEvent.setup()
  const view = render(
    <MemoryRouter initialEntries={[route]}>
      {ui}
      <LocationProbe />
    </MemoryRouter>,
  )
  return { user, ...view }
}

/** The current path plus query, as LocationProbe renders it. */
export function currentLocation(): string {
  return document.querySelector('[data-testid="location"]')?.textContent ?? ''
}
