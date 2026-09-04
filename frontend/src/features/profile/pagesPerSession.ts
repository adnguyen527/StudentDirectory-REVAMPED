/**
 * Pages per session for one (student, instructor) pair.
 *
 * Shared because both profile pages show it from opposite sides -- the student's
 * Instructors card and the instructor's Roster -- and they must agree. The same pair
 * appears on both pages, so two copies of this rule would eventually print two numbers for
 * one fact.
 */

/** Below this many sessions the figure is noise, not a pace. The median (student,
 *  instructor) pair is 2 sessions, so most rows show a dash. */
export const PAGES_PER_SESSION_MIN = 5

/**
 * Whatever carries the three figures, from either side. The roster and the student's
 * instructor entry are the same counts read in opposite directions.
 *
 * `finalized_sessions` is optional because the `instructors` collection only grew it when
 * the roster started showing this column -- a document built before that rebuild has no
 * such field, and the honest answer for it is the same dash an under-five pair gets.
 */
export interface SessionPace {
  sessions: number
  finalized_sessions?: number
  pages_completed: number
}

/**
 * The rate, or null where there is no rate to quote.
 *
 * ⚠️ The denominator is **finalized** sessions, never `sessions`. An unfinalized report has
 * no page count at all -- the two are the same thing in this data -- so dividing by every
 * session makes an instructor whose paperwork is behind read as one whose student did
 * nothing. It understates the rate on 23.7% of the rows the student profile shows it for.
 * See ingestion/build_students.py, where the two counts are kept apart for this reason.
 *
 * One function for the cell, the sort and the filter, so a row cannot display one figure
 * and be ordered by another. Null is the same answer in all three: shown as a dash, sorted
 * to the bottom, and matched by no range -- the same shape as topics' median.
 */
export function pagesPerSession(pair: SessionPace): number | null {
  if (pair.sessions < PAGES_PER_SESSION_MIN) return null
  if (!pair.finalized_sessions) return null
  return pair.pages_completed / pair.finalized_sessions
}
