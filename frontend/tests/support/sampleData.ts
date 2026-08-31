/**
 * A miniature student directory, as the API serves it.
 *
 * Deliberately the same cast as the backend's tests/sample_data.py -- the Nguyen siblings,
 * Chloe Tan, Dana Reyes -- so a developer reading either suite recognises the same people
 * and the same traps. The difference is the dialect: these are the JSON shapes that come
 * back over HTTP, so dates are {"$date": ...} and ids are {"$oid": ...}, exactly as
 * routes/serialization.py emits them.
 *
 * Two properties carry most of the assertions, both inherited from the Python fixtures:
 *
 *   - ACCOUNT_NGUYEN holds two siblings. Anything keyed on account_id alone pulls both,
 *     which is the bug the student_key exists to prevent.
 *   - Anthony's 3/14 session was co-taught, so its pages are credited to each instructor
 *     in full and summing across a roster overshoots -- as it does on the real data.
 */

import type {
  AttendanceResponse,
  DwpReport,
  InstructorDetail,
  InstructorListItem,
  Metrics,
  StudentDetail,
  StudentListItem,
} from '../../src/api/types'

export const ACCOUNT_NGUYEN = 'a1b2c3d4-0000-4000-8000-000000000001'
export const ACCOUNT_TAN = 'a1b2c3d4-0000-4000-8000-000000000002'

export const ANTHONY_KEY = `${ACCOUNT_NGUYEN}_anthony-nguyen`
export const AVA_KEY = `${ACCOUNT_NGUYEN}_ava-nguyen`
export const CHLOE_KEY = `${ACCOUNT_TAN}_chloe-tan`

export const DANA = 'Dana Reyes'
export const MARCUS = 'Marcus Webb'

/** Midnight UTC on a date, the shape json_util emits for a naive stored datetime. */
export function day(iso: string) {
  return { $date: `${iso}T00:00:00Z` }
}

/** A wall-clock time on a date. Stored naive, so the Z is a label, not an offset. */
export function at(iso: string, time: string) {
  return { $date: `${iso}T${time}:00Z` }
}

export function oid(hex: string) {
  return { $oid: hex }
}

// --- Students ------------------------------------------------------------

export const ANTHONY: StudentListItem = {
  _id: oid('64b0000000000000000000a0'),
  student_key: ANTHONY_KEY,
  account_id: ACCOUNT_NGUYEN,
  student_name: 'Anthony Nguyen',
  centers: [{ name: 'Westside', sessions: 2 }],
  total_sessions: 2,
  last_session_date: day('2026-03-14'),
  last_assessment: null,
  total_pages_completed: 12,
  total_unique_topics_mastered: 1,
  total_unique_topics_completed: 0,
  total_unique_topics_finished: 1,
  total_topic_reassignments: 1,
  total_topics_on_plan: 1,
  total_topics_removed: 1,
  last_modified: at('2026-03-15', '09:00'),
}

export const AVA: StudentListItem = {
  ...ANTHONY,
  _id: oid('64b0000000000000000000b0'),
  student_key: AVA_KEY,
  student_name: 'Ava Nguyen',
  total_sessions: 1,
  total_pages_completed: 5,
  last_session_date: day('2026-03-10'),
  total_unique_topics_finished: 0,
  total_topics_on_plan: 2,
  total_topic_reassignments: 0,
}

export const CHLOE: StudentListItem = {
  ...ANTHONY,
  _id: oid('64b0000000000000000000c0'),
  student_key: CHLOE_KEY,
  account_id: ACCOUNT_TAN,
  student_name: 'Chloe Tan',
  centers: [{ name: 'Eastside', sessions: 1 }],
  total_sessions: 1,
  total_pages_completed: 3,
  last_session_date: day('2026-02-02'),
  total_unique_topics_finished: 0,
  total_topics_on_plan: 1,
  total_topic_reassignments: 0,
}

export const STUDENTS: StudentListItem[] = [ANTHONY, AVA, CHLOE]

/**
 * Anthony's full document.
 *
 * The topics are chosen to make the profile's filter meaningful: one finished, one still
 * on plan, one removed -- and the finished one was assigned twice, so it is the topic that
 * disagrees with the all-time counters.
 */
export const ANTHONY_DETAIL: StudentDetail = {
  ...ANTHONY,
  dwp_report_ids: [oid('64b0000000000000000000a1'), oid('64b0000000000000000000a2')],
  instructors: [
    { name: DANA, sessions: 2, pages_completed: 12 },
    { name: MARCUS, sessions: 1, pages_completed: 7 },
  ],
  topics: [
    {
      id: 'PK-1000-00',
      name: 'Distributive Property',
      status: 'Mastered',
      state: 'finished',
      sessions: 4,
      times_worked_on: 3,
      times_completed: 0,
      times_mastered: 1,
      times_assigned: 2,
      last_assignment_started: day('2026-03-01'),
      first_seen: day('2026-01-10'),
      last_seen: day('2026-03-14'),
    },
    {
      id: 'PK-2000-00',
      name: 'Combining Radicals',
      status: 'Worked On',
      state: 'on_plan',
      sessions: 2,
      times_worked_on: 2,
      times_completed: 0,
      times_mastered: 0,
      times_assigned: 1,
      last_assignment_started: day('2026-03-10'),
      first_seen: day('2026-03-10'),
      last_seen: day('2026-03-14'),
    },
    {
      id: 'PK-3000-00',
      name: 'Long Division',
      status: 'Worked On',
      state: 'removed',
      sessions: 1,
      times_worked_on: 1,
      times_completed: 0,
      times_mastered: 0,
      times_assigned: 1,
      last_assignment_started: day('2026-01-10'),
      first_seen: day('2026-01-10'),
      last_seen: day('2026-01-10'),
    },
  ],
}

/**
 * Anthony's two sessions.
 *
 * The 3/14 one is the co-taught one, and carries the notes: a summary with an emoji
 * written as a character reference (as a tenth of the real notes are), plus a
 * student_notes line. The 3/10 one is deliberately bare, so a test can assert the
 * expander renders nothing rather than an empty labelled section.
 */
export const ANTHONY_REPORTS: DwpReport[] = [
  {
    _id: oid('64b0000000000000000000a2'),
    date: day('2026-03-14'),
    session_start: at('2026-03-14', '17:53'),
    session_end: at('2026-03-14', '18:53'),
    centers: ['Westside'],
    instructors: [DANA, MARCUS],
    delivery_method: 'In-Center',
    finalized: true,
    pages_completed: 7,
    session_page_goal: 9,
    mathlete_score: 88,
    topics: [{ id: 'PK-1000-00', name: 'Distributive Property', status: 'Mastered' }],
    session_summary_notes: 'Great progress on the distributive property today &#128077;',
    student_notes: 'Prefers worked examples first.',
    assessment: null,
  },
  {
    _id: oid('64b0000000000000000000a1'),
    date: day('2026-03-10'),
    session_start: at('2026-03-10', '16:00'),
    session_end: null,
    centers: ['Westside'],
    instructors: [DANA],
    delivery_method: 'In-Center',
    finalized: false,
    pages_completed: null,
    session_page_goal: 5,
    mathlete_score: null,
    topics: null,
    session_summary_notes: null,
    student_notes: null,
    assessment: null,
  },
]

export const ANTHONY_ATTENDANCE: AttendanceResponse = {
  student: {
    student_key: ANTHONY_KEY,
    student_name: 'Anthony Nguyen',
    account_id: ACCOUNT_NGUYEN,
  },
  period: { start: '2025-12-14', end: '2026-03-14' },
  // Three sessions over two days: the pair that must not be reported as one number.
  totals: { sessions: 3, days: 2 },
  by_month: [
    { month: '2026-02', sessions: 1, days: 1 },
    { month: '2026-03', sessions: 2, days: 1 },
  ],
  visits: [
    {
      _id: oid('64b0000000000000000000d1'),
      date: day('2026-02-02'),
      centers: ['Westside'],
      instructors: [DANA],
      delivery_methods: ['In-Center'],
      sessions: 1,
      sessions_timed: 1,
      minutes_present: 60,
      pages_completed: 5,
      first_session_start: at('2026-02-02', '16:00'),
      last_session_end: at('2026-02-02', '17:00'),
    },
    {
      _id: oid('64b0000000000000000000d2'),
      date: day('2026-03-14'),
      centers: ['Westside'],
      instructors: [DANA, MARCUS],
      delivery_methods: ['In-Center'],
      sessions: 2,
      sessions_timed: 2,
      minutes_present: 120,
      pages_completed: 7,
      first_session_start: at('2026-03-14', '17:53'),
      last_session_end: at('2026-03-14', '19:53'),
    },
  ],
}

// --- Instructors ---------------------------------------------------------

export const DANA_LIST: InstructorListItem = {
  _id: oid('64b0000000000000000000e0'),
  instructor_name: DANA,
  total_sessions_taught: 4,
  co_taught_sessions: 1,
  unfinalized_sessions: 1,
  total_pages_completed: 20,
  total_days_taught: 2,
  last_session_date: day('2026-03-14'),
  unique_students: 3,
  centers: [{ name: 'Westside', sessions: 3 }, { name: 'Eastside', sessions: 1 }],
  last_modified: at('2026-03-15', '09:00'),
}

export const MARCUS_LIST: InstructorListItem = {
  ...DANA_LIST,
  _id: oid('64b0000000000000000000f0'),
  instructor_name: MARCUS,
  total_sessions_taught: 1,
  co_taught_sessions: 1,
  unfinalized_sessions: 0,
  total_pages_completed: 7,
  total_days_taught: 1,
  unique_students: 1,
  centers: [{ name: 'Westside', sessions: 1 }],
}

export const INSTRUCTORS: InstructorListItem[] = [DANA_LIST, MARCUS_LIST]

export const DANA_DETAIL: InstructorDetail = {
  ...DANA_LIST,
  days_taught: [day('2026-02-02'), day('2026-03-14')],
  students: [
    {
      student_key: ANTHONY_KEY,
      student_name: 'Anthony Nguyen',
      account_id: ACCOUNT_NGUYEN,
      sessions: 2,
      pages_completed: 12,
    },
    {
      student_key: AVA_KEY,
      student_name: 'Ava Nguyen',
      account_id: ACCOUNT_NGUYEN,
      sessions: 1,
      pages_completed: 5,
    },
    {
      student_key: CHLOE_KEY,
      student_name: 'Chloe Tan',
      account_id: ACCOUNT_TAN,
      sessions: 1,
      pages_completed: 3,
    },
  ],
}

export const METRICS: Metrics = {
  total_students: 3,
  total_instructors: 2,
  total_dwp_reports: 4,
  total_attendance_records: 3,
  avg_dwp_per_student: 1.33,
  avg_attendance_per_student: 1,
}
