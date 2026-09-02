/**
 * The API's response shapes.
 *
 * These mirror what the ingestion scripts actually write (ingestion/build_students.py,
 * ingestion/build_instructors.py) as narrowed by each model's LIST_PROJECTION. Keeping
 * them honest is the point: a field renamed on the Python side should fail to compile
 * here rather than render blank.
 */

import type { ExtDate, ExtOid } from './bson'

/** Where a page sits in the whole result -- routes/pagination.py, envelope(). */
export interface Page {
  limit: number
  offset: number
  /** Every match, not just this page, so a pager can be sized on the first request. */
  total: number
  returned: number
}

/** The list envelope: rows under a collection-named key, plus the page. */
export type Paged<K extends string, T> = { [P in K]: T[] } & { page: Page }

/** A center and how many of this student's (or instructor's) sessions were there. */
export interface CenterCount {
  name: string
  sessions: number
}

/**
 * The student fields both routes return.
 *
 * models/student.py's LIST_PROJECTION drops dwp_report_ids, topics and instructors --
 * the three arrays that grow per session. Everything else is common to the list and the
 * detail response, so it is declared once here and the two shapes below differ only by
 * what the projection removes.
 */
export interface StudentBase {
  _id: ExtOid
  student_key: string
  /** A household, not a person: siblings share one. */
  account_id: string
  student_name: string
  /** Sorted by session count, so [0] is where they mostly attend. */
  centers: CenterCount[]
  total_sessions: number
  last_session_date: ExtDate | null
  last_assessment: ExtDate | null
  total_pages_completed: number
  total_unique_topics_mastered: number
  total_unique_topics_completed: number
  /** What a parent means by "finished" -- mastered or completed. Show this one. */
  total_unique_topics_finished: number
  /** Times a topic was put back on the plan after coming off it. */
  total_topic_reassignments: number
  total_topics_on_plan: number
  total_topics_removed: number
  last_modified: ExtDate
}

/** A student as the list routes return them -- the projected arrays are absent. */
export type StudentListItem = StudentBase

/**
 * Where a topic stands on the *last* assignment only.
 *
 * This is the honest answer to "what is this student working on now". The
 * total_unique_* counts above mean *ever*, so a topic mastered and later reassigned is
 * counted there while sitting at `on_plan` here. The two disagreeing is expected.
 */
export type TopicState = 'finished' | 'on_plan' | 'removed'

/** Status is a ladder, not three labels: Mastered implies Completed implies Worked On. */
export type TopicStatus = 'Worked On' | 'Completed' | 'Mastered'

/** One topic's whole history for one student -- ingestion/build_students.py. */
export interface Topic {
  id: string
  name: string
  /** Where it stands now. */
  status: TopicStatus
  state: TopicState
  /** Times worked through, which is not the same as times assigned. */
  sessions: number
  times_worked_on: number
  times_completed: number
  times_mastered: number
  /** Times it was put on the plan. Greater than 1 means it came back. */
  times_assigned: number
  last_assignment_started: ExtDate | null
  first_seen: ExtDate
  last_seen: ExtDate
}

/**
 * One instructor's share of a student's work.
 *
 * `pages_completed` is attributed per instructor per session, so summing it across a
 * co-taught roster comes to more than the student's own total_pages_completed. Read each
 * row on its own; do not add them up.
 */
export interface StudentInstructor {
  name: string
  sessions: number
  /**
   * Sessions with a recorded page count, which is exactly the finalized ones -- the two
   * are the same thing in this data. It is the denominator for pages per session:
   * dividing by `sessions` folds in reports nobody ever completed and understates the
   * rate on 23.7% of the rows the profile shows it for.
   */
  finalized_sessions: number
  pages_completed: number
}

/** A topic as a single session recorded it -- no history, just that day's status. */
export interface SessionTopic {
  id: string
  name: string
  status: TopicStatus
}

/**
 * One session's report, as the detail route returns it.
 *
 * Only the fields worth rendering are declared. models/dwp_report.py's PRIVATE_FIELDS
 * already withholds row_hash, lead_id and the internal note columns, and the rest --
 * card_level, stars_*, student_goal*, schoolwork_* -- are populated on under a fifth of
 * rows and would be dead columns on almost every student.
 */
export interface DwpReport {
  _id: ExtOid
  date: ExtDate
  session_start: ExtDate | null
  session_end: ExtDate | null
  centers: string[]
  instructors: string[]
  delivery_method: string | null
  finalized: boolean
  pages_completed: number | null
  session_page_goal: number | null
  mathlete_score: number | null
  topics: SessionTopic[] | null
  session_summary_notes: string | null
  /** Staff commentary about a named child. Populated on 12% of rows. */
  student_notes: string | null
  assessment: string | null
}

/** The detail document: the base plus the three arrays the list projection drops. */
export interface StudentDetail extends StudentBase {
  topics: Topic[]
  instructors: StudentInstructor[]
  dwp_report_ids: ExtOid[]
}

export interface StudentDetailResponse {
  student: StudentDetail
  stats: { total_dwp_reports: number }
  /** Every session, newest first. Not paged -- see the profile page for why. */
  dwp_reports: DwpReport[]
}

/**
 * The instructor fields both routes return.
 *
 * models/instructor.py ships neither days_taught nor students in a list -- with them a
 * page of 50 is 942 KB against 21 KB. Nothing stores a count of them either: the list
 * derives both with $size at query time, which is why they sit on the list item below
 * rather than here, and why the detail counts the arrays it already has.
 *
 * Keyed on instructor_name, because a name is all the source data carries. Two people
 * sharing a name merge into one document and nothing here can tell them apart.
 */
export interface InstructorBase {
  _id: ExtOid
  instructor_name: string
  total_sessions_taught: number
  /** Sessions shared with another instructor. A subset of total_sessions_taught. */
  co_taught_sessions: number
  /** Sessions taught whose report was never completed. */
  unfinalized_sessions: number
  /**
   * Attributed per instructor per session, so a co-taught session's pages count for each
   * of them. Summing this across instructors exceeds the true total -- do not.
   */
  total_pages_completed: number
  last_session_date: ExtDate | null
  centers: CenterCount[]
  last_modified: ExtDate
}

/**
 * An instructor as the list routes return them: the arrays are absent, and in their place
 * two counts the server derived from them. The detail shape has it the other way round.
 */
export type InstructorListItem = InstructorBase & {
  unique_students: number
  total_days_taught: number
}

/**
 * One student on an instructor's roster.
 *
 * Carries student_key, so a roster row links straight to that student's profile without
 * a lookup.
 */
export interface InstructorRosterEntry {
  student_key: string
  student_name: string
  account_id: string
  sessions: number
  pages_completed: number
}

/** The detail document: the base plus the two arrays the list projection drops. */
export interface InstructorDetail extends InstructorBase {
  /** Every distinct day taught, oldest first. Up to 209 in the current data. */
  days_taught: ExtDate[]
  /** Sorted by sessions, so [0] is who they taught most. Up to 304 entries. */
  students: InstructorRosterEntry[]
}

/** Wrapped in an object rather than returned bare, so stats can be added beside it. */
export interface InstructorDetailResponse {
  instructor: InstructorDetail
}

/** routes/metrics.py -- all-time counts across the collections. */
export interface Metrics {
  total_students: number
  total_instructors: number
  total_dwp_reports: number
  total_attendance_records: number
  avg_dwp_per_student: number
  avg_attendance_per_student: number
}

/** One day the student attended. A day is not a session -- see AttendanceTotals. */
export interface AttendanceVisit {
  _id: ExtOid
  date: ExtDate
  centers: string[]
  instructors: string[]
  delivery_methods: string[]
  sessions: number
  sessions_timed: number
  minutes_present: number | null
  pages_completed: number | null
  first_session_start: ExtDate | null
  last_session_end: ExtDate | null
}

/**
 * Sessions and days are different numbers, and both are reported.
 *
 * Families prepay a set number of sessions, so a day carrying two draws down two. 70
 * student-days in the current data do. Showing only one of these invites the reader to
 * assume it is the other.
 */
export interface AttendanceTotals {
  sessions: number
  days: number
}

export interface AttendanceMonth {
  /** 'YYYY-MM'. */
  month: string
  sessions: number
  days: number
}

export interface AttendanceResponse {
  student: { student_key: string; student_name: string; account_id: string }
  /** Echoed back as 'YYYY-MM-DD' strings, the same format the request sent. */
  period: { start: string; end: string }
  totals: AttendanceTotals
  /** A list, not a keyed object, so iteration order is guaranteed. */
  by_month: AttendanceMonth[]
  visits: AttendanceVisit[]
}

/**
 * The program-wide topic rollup -- ingestion/build_topics.py.
 *
 * Not to be confused with `Topic` above, which is one topic's history for one *student*.
 * These are the same curriculum items counted across everybody, and the two shapes share
 * no fields: this one is keyed on `topic_id` and counts students, that one is keyed on
 * `id` and counts sessions.
 *
 * models/topic.py's LIST_PROJECTION drops `instructors` -- 82 on the widest topic. The
 * list shows no instructor column, so nothing stands in for it there; the detail view
 * counts the array when it needs a total.
 */
export interface TopicRollupBase {
  _id: ExtOid
  topic_id: string
  /** Settled by a rule when the source spells one topic more than one way: most recently
   *  used, then most sessions, then alphabetical. */
  name: string
  /** The names not chosen. Searchable, so an old name still finds the topic. */
  also_known_as: string[]
  /** Times worked through, across every student. */
  sessions: number
  times_worked_on: number
  times_completed: number
  times_mastered: number
  unique_students: number
  /** Per (student, topic) pair and mutually exclusive -- these three sum to
   *  unique_students, because `state` reads a student's last assignment only. */
  students_finished: number
  students_on_plan: number
  students_removed: number
  /**
   * Of the students in `students_finished`, how many now sit at Mastered rather than
   * stopping at Completed. Always <= students_finished, because it is counted inside that
   * group rather than off the status across everybody. The difference between the two is
   * exactly the students who completed a topic without mastering it.
   *
   * Not `times_mastered`, which counts sessions rather than students.
   */
  students_mastered: number
  /** Ever completed or mastered, even if the topic was later handed back. Can exceed
   *  students_finished, which is a "now" question. */
  students_ever_finished: number
  total_reassignments: number
  /** Null when nobody has finished it -- an answer, not a missing field. */
  median_sessions_to_finish: number | null
  first_taught: ExtDate | null
  last_taught: ExtDate | null
  last_modified: ExtDate
}

/** A topic as the list route returns it -- the projected array is absent. */
export type TopicListItem = TopicRollupBase

/**
 * One instructor's share of a topic, ranked most-taught first.
 *
 * A co-taught session credits each instructor the whole entry, so summing `sessions`
 * across this list exceeds the topic's own `sessions`. Read each row on its own.
 */
export interface TopicInstructor {
  name: string
  sessions: number
}

/** The detail document: the base plus the array the list projection drops. */
export interface TopicDetail extends TopicRollupBase {
  instructors: TopicInstructor[]
}

export interface TopicDetailResponse {
  topic: TopicDetail
}

export type StudentsResponse = Paged<'students', StudentListItem>
export type InstructorsResponse = Paged<'instructors', InstructorListItem>
export type TopicsResponse = Paged<'topics', TopicListItem>
