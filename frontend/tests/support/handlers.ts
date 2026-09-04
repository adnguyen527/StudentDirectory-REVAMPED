import { HttpResponse, http } from 'msw'

import type { ReportDetail, TopicDetail, TopicListItem } from '../../src/api/types'

import {
  ANTHONY_ATTENDANCE,
  ANTHONY_DETAIL,
  ANTHONY_REPORTS,
  BARE_REPORT,
  DANA_DETAIL,
  DECIMALS_TWO_DETAIL,
  FRACTIONS_DETAIL,
  INSTRUCTORS,
  METRICS,
  REPORTS,
  RICH_REPORT,
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

/**
 * routes/students.py and routes/instructors.py: repeated `?center=`, matched against
 * `centers.name` with $in. A union, so an instructor at two centers answers either -- and
 * is returned once when both are ticked, which is the case the real data has 11 of.
 */
function atCenters<T extends { centers: { name: string }[] }>(rows: T[], url: URL) {
  const wanted = url.searchParams.getAll('center')
  if (wanted.length === 0) return rows
  return rows.filter((row) => row.centers.some((c) => wanted.includes(c.name)))
}

/**
 * The same union over `dwp_reports`, where a center is a bare string rather than a
 * {name, sessions} pair -- models/dwp_report.py, CENTER_FIELD. One report can name more
 * than one center, so this union is not a partition either.
 */
function atCenterNames<T extends { centers: string[] }>(rows: T[], url: URL) {
  const wanted = url.searchParams.getAll('center')
  if (wanted.length === 0) return rows
  return rows.filter((row) => row.centers.some((name) => wanted.includes(name)))
}

/**
 * routes/sorting.py and models/sorting.py, reimplemented here for the same reason the
 * search rules are: a fake that sorts more forgivingly than the API lets a header pass a
 * test it would fail in the browser.
 *
 * Each entry maps the URL's column name to the field it orders by and the direction that
 * column reads first -- names A-Z, counts and dates largest-first.
 */
type SortSpec = Record<string, readonly [field: string, first: 'asc' | 'desc']>

const STUDENT_SORTS: SortSpec = {
  name: ['student_name', 'asc'],
  sessions: ['total_sessions', 'desc'],
  finished: ['total_unique_topics_finished', 'desc'],
  on_plan: ['total_topics_on_plan', 'desc'],
  last_session: ['last_session_date', 'desc'],
}

const INSTRUCTOR_SORTS: SortSpec = {
  name: ['instructor_name', 'asc'],
  sessions: ['total_sessions_taught', 'desc'],
  students: ['unique_students', 'desc'],
  days: ['total_days_taught', 'desc'],
  unfinalized: ['unfinalized_sessions', 'desc'],
  last_session: ['last_session_date', 'desc'],
}

// Two columns only: pages and mathlete score are null on unfinalized reports and are not
// sortable on the real route either -- models/dwp_report.py says why.
const REPORT_SORTS: SortSpec = {
  date: ['date', 'desc'],
  student: ['student_name', 'asc'],
}

const TOPIC_SORTS: SortSpec = {
  name: ['name', 'asc'],
  sessions: ['sessions', 'desc'],
  students: ['unique_students', 'desc'],
  finished: ['students_finished', 'desc'],
  on_plan: ['students_on_plan', 'desc'],
  removed: ['students_removed', 'desc'],
  median: ['median_sessions_to_finish', 'desc'],
  reassigned: ['total_reassignments', 'desc'],
}

/** A BSON date compares as its ISO string; everything else compares as itself. */
function comparable(value: unknown): string | number {
  if (value !== null && typeof value === 'object' && '$date' in value) {
    return String((value as { $date: string }).$date)
  }
  return value as string | number
}

function compare(a: string | number, b: string | number) {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

/**
 * Rows in the asked-for order, or null when the column is not one -- which the caller
 * answers with the 400 routes/sorting.py answers, since there is no correct list to serve
 * for a column nobody has.
 *
 * Two properties are worth more than the ordering itself: the tie-break is appended to
 * every sort and always ascending, so a paged sort cannot repeat or drop a row; and a
 * missing value sorts last whichever way the column runs, so an ascending Median does not
 * open with the topics that have no median at all.
 */
function sorted<T>(
  rows: T[],
  url: URL,
  spec: SortSpec,
  tieBreak: string,
) {
  const key = url.searchParams.get('sort')
  if (!key) return rows

  const column = spec[key]
  if (!column) return null

  const asked = url.searchParams.get('direction')
  if (asked !== null && asked !== '' && asked !== 'asc' && asked !== 'desc') return null

  const [field, first] = column
  const direction = asked === 'asc' || asked === 'desc' ? asked : first
  const sign = direction === 'asc' ? 1 : -1

  // The row types are interfaces, which carry no index signature -- reading a field by
  // a name held in a variable needs the cast.
  const field_of = (row: T) => (row as Record<string, unknown>)[field]
  const tie_of = (row: T) => (row as Record<string, unknown>)[tieBreak]

  return [...rows].sort((a, b) => {
    const left = field_of(a)
    const right = field_of(b)
    const leftMissing = left === null || left === undefined
    const rightMissing = right === null || right === undefined
    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1
    if (!leftMissing) {
      const order = compare(comparable(left), comparable(right))
      if (order !== 0) return order * sign
    }
    return compare(comparable(tie_of(a)), comparable(tie_of(b)))
  })
}

/**
 * routes/filtering.py: `?<column>_min=` / `_max` on counts, `_from` / `_to` on dates.
 *
 * Both ends inclusive, and a bounded column drops the rows whose value is null -- topics
 * nobody has finished have no median, and no range matches one. Reimplemented rather than
 * waved through so the page cannot pass a test the API would fail.
 */
type RangeSpec = Record<string, readonly [field: string, kind: 'number' | 'date']>

const STUDENT_RANGES: RangeSpec = {
  sessions: ['total_sessions', 'number'],
  finished: ['total_unique_topics_finished', 'number'],
  on_plan: ['total_topics_on_plan', 'number'],
  last_session: ['last_session_date', 'date'],
}

const INSTRUCTOR_RANGES: RangeSpec = {
  sessions: ['total_sessions_taught', 'number'],
  unfinalized: ['unfinalized_sessions', 'number'],
  last_session: ['last_session_date', 'date'],
}

const TOPIC_RANGES: RangeSpec = {
  sessions: ['sessions', 'number'],
  students: ['unique_students', 'number'],
  finished: ['students_finished', 'number'],
  on_plan: ['students_on_plan', 'number'],
  removed: ['students_removed', 'number'],
  median: ['median_sessions_to_finish', 'number'],
  reassigned: ['total_reassignments', 'number'],
}

const REPORT_RANGES: RangeSpec = {
  date: ['date', 'date'],
}

/** A row's value as something comparable to a bound of the same kind. */
function bounded(value: unknown, kind: 'number' | 'date') {
  if (value === null || value === undefined) return null
  if (kind === 'date') {
    const iso = comparable(value)
    return typeof iso === 'string' ? iso.slice(0, 10) : null
  }
  return value as number
}

function withinRanges<T>(rows: T[], url: URL, spec: RangeSpec) {
  let kept = rows
  for (const [column, [field, kind]] of Object.entries(spec)) {
    const [lowKey, highKey] =
      kind === 'number' ? [`${column}_min`, `${column}_max`] : [`${column}_from`, `${column}_to`]
    const low = url.searchParams.get(lowKey)
    const high = url.searchParams.get(highKey)
    if (!low && !high) continue

    kept = kept.filter((row) => {
      const value = bounded((row as Record<string, unknown>)[field], kind)
      // Null satisfies neither end, so a bounded column excludes the rows without a value.
      if (value === null) return false
      if (low && value < (kind === 'number' ? Number(low) : low)) return false
      if (high && value > (kind === 'number' ? Number(high) : high)) return false
      return true
    })
  }
  return kept
}

const BAD_SORT = HttpResponse.json(
  { error: 'sort must be one of: name, sessions' },
  { status: 400 },
)

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

/** As TOPIC_DETAILS. The rich one carries every sparse field, the bare one none of them. */
const REPORT_DETAILS: Record<string, ReportDetail> = {
  [RICH_REPORT._id.$oid]: RICH_REPORT,
  [BARE_REPORT._id.$oid]: BARE_REPORT,
}

/** The detail route answers for these ids and 404s for anything else. */
const TOPIC_DETAILS: Record<string, TopicDetail> = {
  [FRACTIONS_DETAIL.topic_id]: FRACTIONS_DETAIL,
  [DECIMALS_TWO_DETAIL.topic_id]: DECIMALS_TWO_DETAIL,
}

export const handlers = [
  http.get('/api/health', () => HttpResponse.json({ status: 'ok', message: 'Backend is running' })),

  http.get('/api/metrics', () => HttpResponse.json(METRICS)),

  // routes/metrics.py: the union across both collections, sorted.
  http.get('/api/centers', () => HttpResponse.json({ centers: ['Eastside', 'Westside'] })),

  // --- Students ---

  http.get('/api/students', ({ request }) => {
    const url = new URL(request.url)
    const rows = withinRanges(
      atCenters(matching(STUDENTS, url.searchParams.get('query'), studentName), url),
      url,
      STUDENT_RANGES,
    )
    const ordered = sorted(rows, url, STUDENT_SORTS, 'student_key')
    if (!ordered) return BAD_SORT
    return HttpResponse.json(envelope('students', ordered, url))
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
    const rows = withinRanges(
      atCenters(matching(INSTRUCTORS, url.searchParams.get('query'), instructorName), url),
      url,
      INSTRUCTOR_RANGES,
    )
    const ordered = sorted(rows, url, INSTRUCTOR_SORTS, 'instructor_name')
    if (!ordered) return BAD_SORT
    return HttpResponse.json(envelope('instructors', ordered, url))
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
    const rows = withinRanges(
      matchingTopics(TOPICS, url.searchParams.get('query')),
      url,
      TOPIC_RANGES,
    )
    const ordered = sorted(rows, url, TOPIC_SORTS, 'topic_id')
    if (!ordered) return BAD_SORT
    return HttpResponse.json(envelope('topics', ordered, url))
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

  // --- Reports ---

  // The tie-break is _id -- read off the $oid, since the field itself is an object and
  // would compare as "[object Object]". models/dwp_report.py: date alone is not a total
  // order on this collection.
  http.get('/api/reports', ({ request }) => {
    const url = new URL(request.url)
    const rows = withinRanges(
      atCenterNames(matching(REPORTS, url.searchParams.get('query'), studentName), url),
      url,
      REPORT_RANGES,
    )
    const ordered = sorted(
      rows.map((row) => ({ ...row, _tie: row._id.$oid })),
      url,
      REPORT_SORTS,
      '_tie',
    )
    if (!ordered) return BAD_SORT
    return HttpResponse.json(
      envelope('reports', ordered.map(({ _tie: _drop, ...row }) => row), url),
    )
  }),

  http.get('/api/reports/:reportId', ({ params }) => {
    const detail = REPORT_DETAILS[String(params.reportId)]
    if (!detail) {
      return HttpResponse.json({ error: 'Report not found' }, { status: 404 })
    }
    return HttpResponse.json({ report: detail })
  }),
]
