/**
 * What each data-quality check is called, and what it means.
 *
 * The keys are the API's contract (models/quality.py, CHECKS); the wording is this app's.
 * Kept here rather than served, unlike the centre names: a centre appears the day one opens
 * and the frontend must not need a release for it, whereas a new check is new code at both
 * ends anyway -- it needs a card, a label and a sentence explaining what to do about it.
 */

export interface CheckCopy {
  label: string
  /** What the number means, and whether it is a fault at all. */
  detail: string
}

export const CHECKS: Record<string, CheckCopy> = {
  unfinalized: {
    label: 'Unfinalized reports',
    // The actionable one, and the reason this page exists.
    detail: 'Sessions whose report was never finalized. These are the ones a manager can still chase.',
  },
  no_topics: {
    label: 'No topics recorded',
    // 5,945 on the live data -- much the largest, and not obviously a fault.
    detail:
      'Sessions that recorded no topic. Not necessarily wrong — a session can be spent on schoolwork — but it is why a topic-based chart counts fewer sessions than the session total.',
  },
  missing_pages: {
    label: 'No page count',
    detail:
      'The source leaves pages blank until a report is finalized, so this normally matches the unfinalized count. If the two drift apart, something else is going on.',
  },
  missing_session_end: {
    label: 'No end time',
    detail:
      'Sessions that never recorded an end, so they cannot be given a duration. The source writes the literal text “None”, which is nulled on import.',
  },
  no_instructor: {
    label: 'No instructor',
    detail: 'Sessions with nobody recorded as teaching them. They still count as sessions.',
  },
  missing_date: {
    label: 'No date',
    // A tripwire rather than a finding: 0 today, and it matters more than its value.
    detail:
      'Should always be zero. Every trend chart buckets on the date, so a session without one would vanish from all of them silently rather than show up as a gap.',
  },
  missing_session_start: {
    label: 'No start time',
    detail:
      'Should always be zero. The start time is a quarter of the natural key an import identifies a row by.',
  },
}

/**
 * The order the cards read in: the actionable first, the tripwires last.
 *
 * Deliberately not sorted by count. Sorting by size would put "no topics recorded" -- 5,945
 * sessions, most of them fine -- at the top of a page whose first question is what needs
 * doing, and would move the cards around as the data changed.
 */
export const CHECK_ORDER = [
  'unfinalized',
  'no_topics',
  'missing_pages',
  'missing_session_end',
  'no_instructor',
  'missing_date',
  'missing_session_start',
]

export function checkCopy(key: string): CheckCopy {
  // A check the API grew and this file has not caught up with still renders, under its own
  // key, rather than vanishing from a page whose whole job is to report problems.
  return CHECKS[key] ?? { label: key, detail: '' }
}
