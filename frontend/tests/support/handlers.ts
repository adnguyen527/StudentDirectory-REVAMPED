import { HttpResponse, http } from 'msw'

import type { TopicDetail, TopicListItem } from '../../src/api/types'

import {
  ANTHONY_ATTENDANCE,
  ANTHONY_DETAIL,
  ANTHONY_REPORTS,
  DANA_DETAIL,
  DECIMALS_TWO_DETAIL,
  FRACTIONS_DETAIL,
  INSTRUCTORS,
  METRICS,
  STUDENTS,
  TOPICS,
} from './sampleData'

/**
 * The API, faked at the network boundary.
 *
 * These reimplement the routes' actual rules rather than always answering 200 with a
 * fixed body: paging with the real envelope, the two-character search floor that returns
 * 400, and 404 for an unknown key. A handler that always succeeds would let the UI's
 * error and empty paths rot untested, which is where the interesting bugs live.
 *
 * Individual tests override any of these with server.use(...) to force a specific case.
 */

const DEFAULT_LIMIT = 50
const MIN_SEARCH_LENGTH = 2

/** routes/pagination.py, envelope() -- rows under a key, plus where they sit. */
function envelope<K extends string, T>(key: K, rows: T[], url: URL) {
  const limit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT)
  const offset = Number(url.searchParams.get('offset') ?? 0)
  const page = rows.slice(offset, offset + limit)
  return {
    [key]: page,
    page: { limit, offset, total: rows.length, returned: page.length },
  }
}

function matching<T>(rows: T[], query: string | null, name: (row: T) => string) {
  if (!query) return rows
  const needle = query.toLowerCase()
  return rows.filter((row) => name(row).toLowerCase().includes(needle))
}

const studentName = (s: { student_name: string }) => s.student_name
const instructorName = (i: { instructor_name: string }) => i.instructor_name

/**
 * models/topic.py, _search_criteria: the current name, the names it no longer goes by,
 * and the id. Reimplemented rather than reduced to a name match, because a fake that is
 * easier than the real route lets the page pass tests it would fail in the browser.
 */
function matchingTopics(rows: TopicListItem[], query: string | null) {
  if (!query) return rows
  const needle = query.toLowerCase()
  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(needle) ||
      row.topic_id.toLowerCase().includes(needle) ||
      row.also_known_as.some((name) => name.toLowerCase().includes(needle)),
  )
}

/** The detail route answers for these ids and 404s for anything else. */
const TOPIC_DETAILS: Record<string, TopicDetail> = {
  [FRACTIONS_DETAIL.topic_id]: FRACTIONS_DETAIL,
  [DECIMALS_TWO_DETAIL.topic_id]: DECIMALS_TWO_DETAIL,
}

export const handlers = [
  http.get('/api/health', () => HttpResponse.json({ status: 'ok', message: 'Backend is running' })),

  http.get('/api/metrics', () => HttpResponse.json(METRICS)),

  // --- Students ---

  http.get('/api/students', ({ request }) => {
    const url = new URL(request.url)
    const rows = matching(STUDENTS, url.searchParams.get('query'), studentName)
    return HttpResponse.json(envelope('students', rows, url))
  }),

  http.get('/api/students/search', ({ request }) => {
    const url = new URL(request.url)
    const q = url.searchParams.get('q') ?? ''
    if (q.length < MIN_SEARCH_LENGTH) {
      return HttpResponse.json({ error: 'Query must be at least 2 characters' }, { status: 400 })
    }
    return HttpResponse.json(envelope('students', matching(STUDENTS, q, studentName), url))
  }),

  http.get('/api/students/:studentKey/attendance', ({ request, params }) => {
    const url = new URL(request.url)
    const start = url.searchParams.get('start')
    const end = url.searchParams.get('end')
    if (!start || !end) {
      return HttpResponse.json(
        { error: 'start and end are required, as YYYY-MM-DD' },
        { status: 400 },
      )
    }
    if (start > end) {
      return HttpResponse.json({ error: 'start must not be after end' }, { status: 400 })
    }
    if (params.studentKey !== ANTHONY_DETAIL.student_key) {
      return HttpResponse.json({ error: 'Student not found' }, { status: 404 })
    }
    return HttpResponse.json({ ...ANTHONY_ATTENDANCE, period: { start, end } })
  }),

  http.get('/api/students/:studentKey', ({ params }) => {
    if (params.studentKey !== ANTHONY_DETAIL.student_key) {
      return HttpResponse.json({ error: 'Student not found' }, { status: 404 })
    }
    return HttpResponse.json({
      student: ANTHONY_DETAIL,
      stats: { total_dwp_reports: ANTHONY_REPORTS.length },
      dwp_reports: ANTHONY_REPORTS,
    })
  }),

  // --- Instructors ---

  http.get('/api/instructors', ({ request }) => {
    const url = new URL(request.url)
    const rows = matching(INSTRUCTORS, url.searchParams.get('query'), instructorName)
    return HttpResponse.json(envelope('instructors', rows, url))
  }),

  http.get('/api/instructors/search', ({ request }) => {
    const url = new URL(request.url)
    const q = url.searchParams.get('q') ?? ''
    if (q.length < MIN_SEARCH_LENGTH) {
      return HttpResponse.json({ error: 'Query must be at least 2 characters' }, { status: 400 })
    }
    return HttpResponse.json(envelope('instructors', matching(INSTRUCTORS, q, instructorName), url))
  }),

  http.get('/api/instructors/:instructorName', ({ params }) => {
    if (params.instructorName !== DANA_DETAIL.instructor_name) {
      return HttpResponse.json({ error: 'Instructor not found' }, { status: 404 })
    }
    return HttpResponse.json({ instructor: DANA_DETAIL })
  }),

  // --- Topics ---

  http.get('/api/topics', ({ request }) => {
    const url = new URL(request.url)
    const rows = matchingTopics(TOPICS, url.searchParams.get('query'))
    return HttpResponse.json(envelope('topics', rows, url))
  }),

  http.get('/api/topics/search', ({ request }) => {
    const url = new URL(request.url)
    const q = url.searchParams.get('q') ?? ''
    if (q.length < MIN_SEARCH_LENGTH) {
      return HttpResponse.json({ error: 'Query must be at least 2 characters' }, { status: 400 })
    }
    return HttpResponse.json(envelope('topics', matchingTopics(TOPICS, q), url))
  }),

  http.get('/api/topics/:topicId', ({ params }) => {
    const detail = TOPIC_DETAILS[String(params.topicId)]
    if (!detail) {
      return HttpResponse.json({ error: 'Topic not found' }, { status: 404 })
    }
    return HttpResponse.json({ topic: detail })
  }),
]
