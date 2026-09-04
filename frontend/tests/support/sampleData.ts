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
  InstructorBase,
  InstructorDetail,
  InstructorListItem,
  Metrics,
  ReportDetail,
  ReportListItem,
  StudentDetail,
  StudentListItem,
  TopicDetail,
  TopicListItem,
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
    // Six sessions, one never finalized. Above the five-session threshold, and 60/5 = 12.0
    // rather than the 10.0 a naive pages ÷ sessions would show -- so a test asserting 12.0
    // fails if the wrong denominator is used.
    { name: DANA, sessions: 6, finalized_sessions: 5, pages_completed: 60 },
    // One session: under the threshold, so this row shows a dash.
    { name: MARCUS, sessions: 1, finalized_sessions: 1, pages_completed: 7 },
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

/** Anthony's two sessions as the list route sends them: the student joined on, the staff
 *  notes stripped. */
const ANTHONY_LIST_REPORTS: ReportListItem[] = ANTHONY_REPORTS.map(
  ({ student_notes: _withheld, ...report }) => ({
    ...report,
    student_name: 'Anthony Nguyen',
    account_id: ACCOUNT_NGUYEN,
    student_key: ANTHONY_KEY,
  }),
)

/** Chloe's, which are what make the center and date filters testable at all: the second
 *  center, a third date, and a session that named no instructor. */
const CHLOE_LIST_REPORTS: ReportListItem[] = [
  {
    _id: oid('64b0000000000000000000c1'),
    date: day('2026-03-14'),
    session_start: at('2026-03-14', '15:00'),
    session_end: at('2026-03-14', '16:00'),
    centers: ['Eastside'],
    instructors: [MARCUS],
    delivery_method: 'In-Center',
    finalized: true,
    pages_completed: 4,
    session_page_goal: 4,
    mathlete_score: 91,
    topics: [{ id: 'PK-2000-00', name: 'Fractions', status: 'Worked On' }],
    session_summary_notes: 'Steady work on equivalent fractions.',
    assessment: null,
    student_name: 'Chloe Tan',
    account_id: ACCOUNT_TAN,
    student_key: CHLOE_KEY,
  },
  {
    _id: oid('64b0000000000000000000c2'),
    date: day('2026-01-05'),
    session_start: null,
    session_end: null,
    centers: ['Eastside'],
    // No instructor named. The session still happened and still counts -- ingestion drops
    // a placeholder name rather than inventing a person; see PLACEHOLDER_INSTRUCTORS.
    instructors: [],
    delivery_method: null,
    finalized: false,
    pages_completed: null,
    session_page_goal: null,
    mathlete_score: null,
    topics: null,
    session_summary_notes: null,
    assessment: null,
    student_name: 'Chloe Tan',
    account_id: ACCOUNT_TAN,
    student_key: CHLOE_KEY,
  },
]

/**
 * The report list, as /api/reports serves it -- the profile's rows plus the student, and
 * without student_notes, which that route does not send.
 *
 * Declared in the route's own resting order, date descending and _id ascending, because
 * the fake pages this array as it stands. Anthony's and Chloe's 3/14 sessions share a
 * date on purpose: date alone is not a total order on this collection, and a fixture
 * where it happened to be would let a paging bug through unnoticed.
 */
export const REPORTS: ReportListItem[] = [
  ANTHONY_LIST_REPORTS[0], // Mar 14, ...00a2
  CHLOE_LIST_REPORTS[0], //  Mar 14, ...00c1
  ANTHONY_LIST_REPORTS[1], // Mar 10
  CHLOE_LIST_REPORTS[1], //  Jan 5
]

/** Every field the detail page renders, at its empty value. Spread over each fixture so a
 *  field added to ReportDetail lands in both without either drifting. */
const NO_DETAIL_FIELDS = {
  student_notes: null,
  sessions_this_month: null,
  last_punch_of_day: null,
  needs_primary_deck_update: null,
  needs_secondary_deck_update: null,
  finalized_date: null,
  center_orgs: [],
  card_level: null,
  stars_current: null,
  stars_max: null,
  session_stars_added: null,
  primary_deck_next_page: null,
  secondary_deck_next_page: null,
  internet_rating: null,
  schoolwork_completed: null,
  schoolwork_checked: null,
  schoolwork_description: null,
  schoolwork_start_time: null,
  schoolwork_duration_min: null,
  student_goal1: null,
  student_goal2: null,
  student_goal3: null,
} satisfies Omit<ReportDetail, keyof ReportListItem>

/**
 * The two reports the detail page has to handle, and they are the two extremes.
 *
 * The rich one carries the sparse fields and the staff notes the list route withholds. The
 * bare one carries none of them and no topics, summary or assessment either -- it is the 7%
 * whose row the expander leaves inert, and the page must render exactly the same sections
 * for it, empty, rather than a shorter page.
 *
 * ⚠️ needs_*_deck_update are `false` rather than null on the bare one on purpose: false is a
 * value, and a page that blanked it would be reporting "we don't know".
 */
export const RICH_REPORT: ReportDetail = {
  ...REPORTS[0],
  ...NO_DETAIL_FIELDS,
  student_notes: 'Prefers worked examples first.',
  sessions_this_month: 6,
  last_punch_of_day: true,
  needs_primary_deck_update: true,
  needs_secondary_deck_update: false,
  finalized_date: day('2026-03-15'),
  center_orgs: ['Math Made Simple'],
  card_level: 'Level 3',
  stars_current: 4,
  stars_max: 10,
  session_stars_added: 2,
  primary_deck_next_page: 'p. 41',
  schoolwork_completed: true,
  schoolwork_checked: false,
  schoolwork_description: 'Unit 2 review packet',
  schoolwork_duration_min: 15,
  student_goal1: 'Finish the fractions deck',
  assessment: 'Algebra I',
}

export const BARE_REPORT: ReportDetail = {
  ...REPORTS[3],
  ...NO_DETAIL_FIELDS,
  needs_primary_deck_update: false,
  needs_secondary_deck_update: false,
}

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

/**
 * What both instructor shapes share. The list adds the two counts the server derives with
 * $size; the detail adds the arrays they were derived from. Neither carries both, which is
 * what /api/instructors and /api/instructors/<name> actually return.
 */
const DANA_BASE: InstructorBase = {
  _id: oid('64b0000000000000000000e0'),
  instructor_name: DANA,
  total_sessions_taught: 4,
  co_taught_sessions: 1,
  unfinalized_sessions: 1,
  total_pages_completed: 20,
  last_session_date: day('2026-03-14'),
  centers: [{ name: 'Westside', sessions: 3 }, { name: 'Eastside', sessions: 1 }],
  last_modified: at('2026-03-15', '09:00'),
}

export const DANA_LIST: InstructorListItem = {
  ...DANA_BASE,
  unique_students: 3,
  total_days_taught: 2,
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
  ...DANA_BASE,
  days_taught: [day('2026-02-02'), day('2026-03-14')],
  // Three rosters covering all three answers the Pages / session column can give: a real
  // rate, a dash for too few sessions, and a dash for a document built before the
  // collection carried finalized_sessions at all -- which is every document until
  // build_instructors.py is re-run.
  students: [
    {
      student_key: ANTHONY_KEY,
      student_name: 'Anthony Nguyen',
      account_id: ACCOUNT_NGUYEN,
      sessions: 6,
      // One of the six was never finalized, so it has no pages to divide -- the whole
      // reason this is not `sessions`. 12 / 5 = 2.4, where 12 / 6 would read 2.0.
      finalized_sessions: 5,
      pages_completed: 12,
    },
    {
      student_key: AVA_KEY,
      student_name: 'Ava Nguyen',
      account_id: ACCOUNT_NGUYEN,
      // Under PAGES_PER_SESSION_MIN: a rate here would be noise, not a pace.
      sessions: 1,
      finalized_sessions: 1,
      pages_completed: 5,
    },
    {
      // ⚠️ No finalized_sessions at all -- a roster document from before the rebuild.
      // The column must dash rather than fall back to dividing by `sessions`.
      student_key: CHLOE_KEY,
      student_name: 'Chloe Tan',
      account_id: ACCOUNT_TAN,
      sessions: 9,
      pages_completed: 27,
    },
  ],
}

/*
 * The topic rollup, carrying the two traps the real collection has.
 *
 *   - FRACTIONS was renamed: the source also called it "Halves and Quarters", so a search
 *     for the old name has to find it.
 *   - DECIMALS and DECIMALS_TWO share a name under different ids, as 90 real topics do.
 *     Only the id separates them, which is why the list shows it.
 */
export const FRACTIONS_ID = 'T-100'
export const DECIMALS_ID = 'T-110'
export const DECIMALS_TWO_ID = 'T-115'
export const ANGLES_ID = 'T-200'

export const FRACTIONS: TopicListItem = {
  _id: oid('64b000000000000000000a10'),
  topic_id: FRACTIONS_ID,
  name: 'Fractions',
  also_known_as: ['Halves and Quarters'],
  sessions: 9,
  times_worked_on: 6,
  times_completed: 1,
  times_mastered: 2,
  unique_students: 3,
  students_finished: 2,
  students_mastered: 1,
  students_on_plan: 1,
  students_removed: 0,
  students_ever_finished: 2,
  total_reassignments: 1,
  median_sessions_to_finish: 3,
  first_taught: day('2026-02-01'),
  last_taught: day('2026-03-14'),
  last_modified: at('2026-03-15', '09:00'),
}

export const DECIMALS: TopicListItem = {
  ...FRACTIONS,
  _id: oid('64b000000000000000000a20'),
  topic_id: DECIMALS_ID,
  name: 'Decimals',
  also_known_as: [],
  sessions: 4,
  unique_students: 2,
  students_finished: 1,
  students_mastered: 1,
  students_on_plan: 1,
  students_removed: 0,
  students_ever_finished: 1,
  total_reassignments: 0,
  median_sessions_to_finish: 2,
}

/** Same name as DECIMALS, different id -- and nobody has finished it. */
export const DECIMALS_TWO: TopicListItem = {
  ...DECIMALS,
  _id: oid('64b000000000000000000a30'),
  topic_id: DECIMALS_TWO_ID,
  sessions: 1,
  unique_students: 1,
  students_finished: 0,
  students_mastered: 0,
  students_on_plan: 0,
  students_removed: 1,
  students_ever_finished: 0,
  // Nobody finished it, so there is no median. Null, not zero.
  median_sessions_to_finish: null,
}

export const ANGLES: TopicListItem = {
  ...DECIMALS,
  _id: oid('64b000000000000000000a40'),
  topic_id: ANGLES_ID,
  name: 'Angles',
  sessions: 2,
  unique_students: 1,
  students_finished: 1,
  students_mastered: 1,
  students_on_plan: 0,
  students_removed: 0,
  students_ever_finished: 1,
  median_sessions_to_finish: 1,
}

/**
 * Most worked first, as models/topic.py's LIST_SORT returns them -- 9, 4, 2, 1 sessions.
 *
 * The handlers slice this array as given rather than sorting it, so this order *is* the
 * API's order as far as these tests are concerned. The session-count tie that the real
 * sort has to break is covered on the Python side, in tests/test_routes.py.
 */
export const TOPICS: TopicListItem[] = [FRACTIONS, DECIMALS, ANGLES, DECIMALS_TWO]

export const FRACTIONS_DETAIL: TopicDetail = {
  ...FRACTIONS,
  instructors: [
    { name: DANA, sessions: 6 },
    { name: MARCUS, sessions: 3 },
  ],
}

/** The unstaffed case: a topic no instructor was ever recorded on. */
export const DECIMALS_TWO_DETAIL: TopicDetail = {
  ...DECIMALS_TWO,
  instructors: [],
}

export const METRICS: Metrics = {
  // Anthony's 3/14 session, the newest in this fixture -- what the date presets anchor on.
  latest_session_date: day('2026-03-14'),
  total_students: 3,
  total_instructors: 2,
  total_dwp_reports: 4,
  total_attendance_records: 3,
  avg_dwp_per_student: 1.33,
  avg_attendance_per_student: 1,
}
