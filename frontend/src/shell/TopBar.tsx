import { GlobalSearch } from '../features/GlobalSearch'
import { ChevronIcon } from './Icons'
import './TopBar.css'

/** Global search on the left, user menu on the right -- the reference's top bar. */
export function TopBar() {
  return (
    <header className="topbar">
      <GlobalSearch />

      {/* Placeholder until there are real users to show. Session auth is what turns this
          into a name and a sign-out; there is no identity to render before then. */}
      <button type="button" className="user-menu" disabled title="Coming with session sign-in">
        <span className="user-avatar" aria-hidden="true">
          ?
        </span>
        <span className="user-name">Not signed in</span>
        <ChevronIcon className="user-chevron" />
      </button>
    </header>
  )
}
