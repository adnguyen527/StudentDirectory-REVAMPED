/** Named calls for the routes this app uses. Query-string spelling lives here only. */

import { request } from './client'
import type {
  AttendanceResponse,
  CentersResponse,
  InstructorDetailResponse,
  InstructorsResponse,
  Metrics,
  StudentDetailResponse,
  StudentsResponse,
  TopicDetailResponse,
  TopicsResponse,
} from './types'

/** routes/pagination.py: DEFAULT_LIMIT. Matched so the pager's arithmetic is the API's. */
export const PAGE_SIZE = 50

/** The server refuses a search under this length -- routes/students.py, search_students. */
export const MIN_SEARCH_LENGTH = 2

export function getMetrics(signal?: AbortSignal) {
  return request<Metrics>('/metrics', undefined, signal)
}

export interface ListParams {
  limit?: number
  offset?: number
  /** Substring match on the name, case-insensitive. */
  query?: string
  /**
   * Centers to keep, as repeated `?center=` params. Several are a union, and they narrow
   * *with* `query` rather than replacing it. Empty means no center filter at all.
   */
  centers?: string[]
  /**
   * The column to order by, from the API's own allowlist -- an unknown one is a 400, not
   * an ignored parameter. Omitted means the list's resting order.
   */
  sort?: string
  direction?: 'asc' | 'desc'
  /**
   * Column bounds, already in the API's own spelling -- `sessions_min`,
   * `last_session_from` and their pairs. Passed through rather than translated, which is
   * what keeps the URL and the request identical; see features/ranges.ts.
   */
  ranges?: Record<string, string>
}

/** `centers` is sent as repeated `center` keys -- see buildQuery in client.ts. */
function listQuery({ centers, ranges, ...rest }: ListParams) {
  return { ...rest, ...ranges, center: centers }
}

export function listStudents(params: ListParams = {}, signal?: AbortSignal) {
  return request<StudentsResponse>('/students', listQuery(params), signal)
}

export function listInstructors(params: ListParams = {}, signal?: AbortSignal) {
  return request<InstructorsResponse>('/instructors', listQuery(params), signal)
}

/**
 * The topic list.
 *
 * `query` matches the current name, the names it no longer goes by, and the topic id --
 * models/topic.py, _search_criteria. There is no dedicated searchTopics(): the page's own
 * filter bar drives this same `?query=`, and /topics/search exists for a typeahead that
 * does not exist yet.
 */
export function listTopics(params: ListParams = {}, signal?: AbortSignal) {
  return request<TopicsResponse>('/topics', listQuery(params), signal)
}

/** The center names the filter offers. Served rather than hard-coded, so a new center
 *  appears in the checkboxes without a release. */
export function listCenters(signal?: AbortSignal) {
  return request<CentersResponse>('/centers', undefined, signal)
}

/**
 * One topic, with the instructors who taught it most.
 *
 * The id is the key and is URL-safe as stored ('PK-3121-00'), but it is encoded anyway --
 * nothing guarantees the source keeps it that way.
 */
export function getTopic(topicId: string, signal?: AbortSignal) {
  return request<TopicDetailResponse>(
    `/topics/${encodeURIComponent(topicId)}`,
    undefined,
    signal,
  )
}

/**
 * One instructor, with their roster and every day taught.
 *
 * The name is the key -- it is all the source data carries -- so it travels in the path.
 * Small next to the student detail: ~10 KB typical, and the largest roster in the data is
 * 304 students.
 */
export function getInstructor(instructorName: string, signal?: AbortSignal) {
  return request<InstructorDetailResponse>(
    `/instructors/${encodeURIComponent(instructorName)}`,
    undefined,
    signal,
  )
}

/**
 * One student, with every session.
 *
 * Deliberately not paged by the API, which is what lets the profile page be frontend-
 * only. The heaviest student in the current data is 149 sessions / ~229 KB.
 */
export function getStudent(studentKey: string, signal?: AbortSignal) {
  return request<StudentDetailResponse>(
    `/students/${encodeURIComponent(studentKey)}`,
    undefined,
    signal,
  )
}

/**
 * Sessions attended in a period. Both bounds are required and inclusive, 'YYYY-MM-DD'.
 *
 * The route refuses to default the window on purpose -- "this month" would silently
 * return nothing whenever the imported data lags the calendar, which reads as a broken
 * endpoint rather than an empty month. The caller names the period it means.
 */
export function getStudentAttendance(
  studentKey: string,
  start: string,
  end: string,
  signal?: AbortSignal,
) {
  return request<AttendanceResponse>(
    `/students/${encodeURIComponent(studentKey)}/attendance`,
    { start, end },
    signal,
  )
}

/**
 * The top-bar search. `q`, not `query` -- /students/search takes the short spelling.
 *
 * A small limit on purpose: the dropdown shows the first handful and reads the real
 * count off page.total, rather than pulling rows it will not draw.
 */
export function searchStudents(q: string, limit = 10, signal?: AbortSignal) {
  return request<StudentsResponse>('/students/search', { q, limit }, signal)
}

/** The same, over instructors. Same `q` spelling, same envelope, same 2-character floor. */
export function searchInstructors(q: string, limit = 10, signal?: AbortSignal) {
  return request<InstructorsResponse>('/instructors/search', { q, limit }, signal)
}
