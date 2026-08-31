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
 * A student as the list routes return them.
 *
 * models/student.py projects out dwp_report_ids, topics and instructors -- the three
 * arrays that grow per session -- so they are absent here by design, not by oversight.
 * The detail route is what carries them.
 */
export interface StudentListItem {
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
  total_topic_reassignments: number
  total_topics_on_plan: number
  total_topics_removed: number
  last_modified: ExtDate
}

/**
 * An instructor as the list routes return them.
 *
 * models/instructor.py projects out days_taught and students; total_days_taught and
 * unique_students say the same thing in one number each.
 */
export interface InstructorListItem {
  _id: ExtOid
  instructor_name: string
  total_sessions_taught: number
  co_taught_sessions: number
  /** Sessions taught whose report was never completed -- a follow-up list. */
  unfinalized_sessions: number
  total_pages_completed: number
  total_days_taught: number
  last_session_date: ExtDate | null
  unique_students: number
  centers: CenterCount[]
  last_modified: ExtDate
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

export type StudentsResponse = Paged<'students', StudentListItem>
export type InstructorsResponse = Paged<'instructors', InstructorListItem>
