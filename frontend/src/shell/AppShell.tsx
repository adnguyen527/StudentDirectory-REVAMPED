import { Outlet } from 'react-router-dom'

import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import './AppShell.css'

/**
 * The admin shell: fixed sidebar column, top bar row, scrolling content area.
 *
 * Only the content scrolls -- the rail and the bar stay put, which is what makes the
 * search persistent rather than something you scroll away from.
 */
export function AppShell() {
  return (
    <div className="app-shell">
      <Sidebar />
      <TopBar />
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  )
}
