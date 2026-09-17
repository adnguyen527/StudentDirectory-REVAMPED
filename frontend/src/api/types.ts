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
  /**
   * Sessions with a recorded page count, which is exactly the finalized ones -- the two
   * are the same thing in this data. It is the denominator for pages per session:
   * dividing by `sessions` folds in reports nobody ever completed and understates the
   * rate. Same field, same reason, as StudentInstructor.
   *
   * Optional because the `instructors` collection only grew it when the roster started
   * showing that column; a document built before that rebuild has none, and
   * pagesPerSession answers such a row with the same dash it gives an under-five pair.
   */
  finalized_sessions?: number
  pages_completed: number
}

/**
 * One topic an instructor taught, ranked most-taught first then alphabetically.
 *
 * The other side of `TopicInstructor` below -- the same (instructor, topic) pairs read from
 * the instructor rather than from the topic, which a live test holds to pair for pair.
 *
 * ⚠️ `topic_id` is not decoration. A session's topics are named by
 * `build_topics.canonical_name`, and names are not unique: 87 of 103 instructors have a name
 * appearing twice or more in their own list, one of them three times at 59, 26 and 8
 * sessions. Rendered without the id those read as one row repeated with contradictory
 * numbers.
 *
 * ⚠️ `sessions` does not total. A session covers several topics, so these add to about 1.73
 * times the sessions the instructor actually taught. Read each row on its own.
 */
export interface InstructorTopic {
  topic_id: string
  name: string
  sessions: number
}

/** The detail document: the base plus the three arrays the list projection drops. */
export interface InstructorDetail extends InstructorBase {
  /** Every distinct day taught, oldest first. Up to 209 in the current data. */
  days_taught: ExtDate[]
  /** Sorted by sessions, so [0] is who they taught most. Up to 304 entries. */
  students: InstructorRosterEntry[]
  /**
   * What they taught most. A median of 126 entries and up to 504.
   *
   * Optional for the reason `finalized_sessions` above is: the collection only grew this
   * when build_instructors.py learned to write it, so a document from before that rebuild
   * simply has none. Absent and empty are different answers and the card says so separately
   * -- telling a stale document "no topics recorded" would be wrong rather than missing.
   */
  topics?: InstructorTopic[]
}

/** Wrapped in an object rather than returned bare, so stats can be added beside it. */
export interface InstructorDetailResponse {
  instructor: InstructorDetail
}

/** routes/metrics.py -- all-time counts across the collections. */
export interface Metrics {
  /**
   * The newest session anywhere in the data, which is what the date filter's presets
   * count back from -- "the last 30 days" has to mean the last 30 days of the data. The
   * imported data ends well before today, so a window off the calendar matches nobody.
   * Null on an empty database.
   */
  latest_session_date: ExtDate | null
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
  pages_per_session: number
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
  /** Beside the median, not instead of it. Program-wide the mean days to finish is 26.7
   *  against a median of 13, with a 393-day tail -- a mean alone describes almost nobody. */
  mean_sessions_to_finish: number | null
  /** Elapsed days from first sight to the finishing session. A different question from
   *  sessions: a topic can take four sessions spread over two months. Median 13 across the
   *  9,189 finished (student, topic) pairs; 662 topics carry one. */
  median_days_to_finish: number | null
  /**
   * What a session carrying this topic does to its page count, against the student's own
   * pace -- 0.70x to 2.23x across the 283 topics that qualify.
   *
   * ⚠️ A comparison, never an attribution: the numerator is the *whole session's* pages.
   * A session carries 2.17 topics on average, so a per-topic share does not exist.
   *
   * Null below the builder's 50-session threshold, where the figure would be noise.
   */
  session_pages_ratio: number | null
  /** Finalized sessions the ratio rests on, kept even when the ratio is null so the page
   *  can say what it is worth -- or why there is none. */
  session_pages_ratio_basis: number
  /**
   * ⚠️ The line a topic's ratio is read against, and it is **not 1.0**: a session's pages
   * count once for every topic on it, so centered on 1.0 some 223 of 283 topics read as
   * speeding students up. 1.21 on the current data, with half the topics each side.
   *
   * Program-wide and identical on every document -- see build_topics.py for why it is
   * denormalised rather than served separately.
   */
  session_pages_ratio_median: number | null
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

/** The center names the two list routes can be filtered by -- routes/metrics.py. */
export interface CentersResponse {
  centers: string[]
}

/**
 * What a selection of centers adds up to, all-time.
 *
 * ⚠️ Every figure here is counted from `dwp_reports`, not summed from the built student and
 * instructor aggregates. Co-taught sessions credit each instructor the full page count, so
 * adding up instructor pages overshoots a center's real total by about ten percent -- 168,623
 * against the 153,360 pages actually recorded. models/center.py carries the long version.
 */
export interface CenterTotals {
  sessions: number
  /** Distinct students, counted by (account_id, student_name) -- an account is a household. */
  students: number
  /** Distinct instructors. One who works at two of the selected centers counts once. */
  instructors: number
  pages_completed: number
  /** Reports still not finalized: the only figure here a manager can act on today. */
  unfinalized: number
  /** Distinct days with a session, which is not the session count -- a day can hold two. */
  days: number
  first_session: ExtDate | null
  last_session: ExtDate | null
}

export interface CenterMetricsResponse {
  /** The selection these totals answer, echoed back with blank values dropped. */
  centers: string[]
  totals: CenterTotals
}

/**
 * A report as the list route returns it.
 *
 * The profile's shape minus student_notes, which /api/reports does not send -- reading one
 * child's notes on their own profile and paging through 3,594 of them are different acts,
 * and models/dwp_report.py's LIST_PROJECTION is where that is decided. `Omit` rather than a
 * hand-written twin so a field added to DwpReport arrives here too.
 *
 * student_key is derived by the route rather than stored: dwp_reports is raw source data
 * and carries account_id and student_name alone -- routes/reports.py, _with_student_key.
 */
export type ReportListItem = Omit<DwpReport, 'student_notes'> & {
  student_name: string
  account_id: string
  student_key: string
}

/**
 * One report, whole -- everything /api/reports/<id> returns.
 *
 * The list's row plus student_notes and the fields nothing else renders. The percentages
 * are measured over all 29,382 reports and are the point of writing them down: this page
 * shows every field whether or not it has a value, so a row that is always empty is the
 * data saying so rather than a bug. Two of them are empty in *every* report today.
 */
export interface ReportDetail extends ReportListItem {
  /** Staff commentary about a named child. 12.2%. Served here, withheld by the list. */
  student_notes: string | null

  /** On 100% of reports, and shown nowhere else in the app. */
  sessions_this_month: number | null
  last_punch_of_day: boolean | null
  needs_primary_deck_update: boolean | null
  needs_secondary_deck_update: boolean | null

  /** 94.7% and 95.1%. */
  finalized_date: ExtDate | null
  center_orgs: string[]

  /** The digital reward system: 9.0% carry a card, 3.3% a star count, 1.0% a session's. */
  card_level: string | null
  stars_current: number | null
  stars_max: number | null
  session_stars_added: number | null

  /** 1.0%. ⚠️ secondary_deck_next_page is null in all 29,382 -- kept so it appears if the
   *  source ever starts writing it, but nothing is designed around it. */
  primary_deck_next_page: string | null
  secondary_deck_next_page: string | null

  /** ⚠️ Null in all 29,382 reports. As secondary_deck_next_page. */
  internet_rating: string | null

  /** 17.4% carry the two flags, 13.0% a description, and under 1.5% either time figure. */
  schoolwork_completed: boolean | null
  schoolwork_checked: boolean | null
  schoolwork_description: string | null
  schoolwork_start_time: string | null
  schoolwork_duration_min: number | null

  /** 161 reports, 0.5% -- the rarest fields in the collection. */
  student_goal1: string | null
  student_goal2: string | null
  student_goal3: string | null
}

export interface ReportDetailResponse {
  report: ReportDetail
}

export type StudentsResponse = Paged<'students', StudentListItem>
export type InstructorsResponse = Paged<'instructors', InstructorListItem>
export type TopicsResponse = Paged<'topics', TopicListItem>
export type ReportsResponse = Paged<'reports', ReportListItem>

/* --- Chart data ------------------------------------------------------------------- */

export interface CenterCountRow {
  center: string
  count: number
}

/**
 * How a filtered list divides across centers -- models/distribution.py.
 *
 * ⚠️ `total` and `counted` are different numbers and both are wanted. `total` is the rows
 * the list would show; `counted` is the sum of the bars. They are equal on students, where
 * a student belongs to exactly one center, and `counted` is larger on instructors, where 11
 * of 103 work at two or more and appear under each. One person, two bars -- the page has to
 * label that rather than let the arithmetic look broken.
 */
export interface DistributionResponse {
  /** The selection these figures answer, echoed back with blank values dropped. */
  centers: string[]
  total: number
  counted: number
  /** Rows carrying no center at all. 0 on both collections today, reported rather than assumed. */
  no_center: number
  distribution: CenterCountRow[]
}

/**
 * One time bucket -- models/trends.py.
 *
 * Which figures are present depends on the route: /api/reports/trends carries `sessions`
 * alone, /api/instructors/trends adds `students` and `pages_completed`, and
 * /api/home/trends adds `unfinalized` as well. Optional here rather than three near-identical
 * interfaces, because the shape of a bucket is the same question answered at three widths.
 *
 * ⚠️ `students` is distinct *within* a bucket and does NOT sum across them -- someone who
 * came in February and in March is counted in both. That is what a trend line means, and it
 * is wrong for anyone totalling the column.
 *
 * There is deliberately no `finalized`: it is `sessions - unfinalized`, and two figures that
 * must sum to a third are two figures that can disagree.
 */
export interface TrendBucket {
  /** '2025-09-17', '2025-W38' or '2025-09'. Fixed width, so it sorts chronologically. */
  key: string
  start: ExtDate
  /** The bucket's last day at midnight -- inclusive, as every date bound here is. */
  end: ExtDate
  /** The window covers only part of this bucket, so the bar is short because the window is. */
  partial: boolean
  sessions: number
  students?: number
  pages_completed?: number
  unfinalized?: number
}

export interface TrendsResponse {
  interval: 'day' | 'week' | 'month'
  /** Null on an empty collection: there is no anchor to measure back from, and today is not one. */
  range: { start: ExtDate; end: ExtDate } | null
  centers?: string[]
  instructors?: string[]
  buckets: TrendBucket[]
}

/** One data-quality check and how many reports currently fail it -- models/quality.py. */
export interface QualityCheck {
  key: string
  count: number
}

/**
 * A natural key more than one stored document shares -- the rows an import can no longer
 * update, because `_upsert` refuses to guess which one a source row means.
 */
export interface AmbiguousKey {
  account_id: string
  student_name: string
  date: ExtDate
  session_start: ExtDate | null
  documents: number
}

/**
 * What is missing or contradictory in the reports right now.
 *
 * ⚠️ Current state, not an import audit. These say what is wrong with the collection today,
 * which is what can be acted on; what a given import run skipped is not recorded anywhere.
 * Counts only -- every row behind these numbers is about a named child.
 */
export interface QualityResponse {
  centers: string[]
  total: number
  checks: QualityCheck[]
  ambiguous_keys: AmbiguousKey[]
}
