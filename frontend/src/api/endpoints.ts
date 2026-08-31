/** Named calls for the routes this app uses. Query-string spelling lives here only. */

import { request } from './client'
import type {
  AttendanceResponse,
  InstructorDetailResponse,
  InstructorsResponse,
  Metrics,
  StudentDetailResponse,
  StudentsResponse,
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
}

export function listStudents(params: ListParams = {}, signal?: AbortSignal) {
  return request<StudentsResponse>('/students', { ...params }, signal)
}

export function listInstructors(params: ListParams = {}, signal?: AbortSignal) {
  return request<InstructorsResponse>('/instructors', { ...params }, signal)
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
