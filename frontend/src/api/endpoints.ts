/** Named calls for the routes this app uses. Query-string spelling lives here only. */

import { request } from './client'
import type { InstructorsResponse, Metrics, StudentsResponse } from './types'

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
 * The top-bar search. `q`, not `query` -- /students/search takes the short spelling.
 *
 * A small limit on purpose: the dropdown shows the first handful and reads the real
 * count off page.total, rather than pulling rows it will not draw.
 */
export function searchStudents(q: string, limit = 10, signal?: AbortSignal) {
  return request<StudentsResponse>('/students/search', { q, limit }, signal)
}
