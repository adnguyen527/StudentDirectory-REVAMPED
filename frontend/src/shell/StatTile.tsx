import type { ReactNode } from 'react'

import './StatTile.css'

interface StatTileProps {
  label: string
  /** Pre-formatted: the tile does not know whether it is showing a count or an average. */
  value: string
  sub?: string
  icon: ReactNode
  /**
   * Which pastel wash the icon sits in, 1-4. Cycled by position rather than assigned per
   * metric -- the reference row is decorative variety, not a colour code, and reading it
   * as one would imply a meaning the numbers do not have.
   */
  wash?: 1 | 2 | 3 | 4
  loading?: boolean
}

/** The small top-row tile from the layout reference: washed icon, big number, label. */
export function StatTile({ label, value, sub, icon, wash = 1, loading }: StatTileProps) {
  return (
    <div className="stat-tile">
      <span className={`stat-icon stat-icon-${wash}`}>{icon}</span>
      <div className="stat-text">
        <div className="stat-value">{loading ? <span className="stat-skeleton" /> : value}</div>
        <div className="stat-label">{label}</div>
        {sub && !loading && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  )
}
