import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { formatNumber } from '../api/bson'
import { MIN_SEARCH_LENGTH, searchInstructors, searchStudents } from '../api/endpoints'
import type { InstructorsResponse, StudentsResponse } from '../api/types'
import { useApi } from '../hooks/useApi'
import { CloseIcon, SearchIcon } from '../shell/Icons'
import './GlobalSearch.css'

const DEBOUNCE_MS = 250

/**
 * Per group, not overall.
 *
 * Four rather than five so both groups fit the dropdown without scrolling -- at five,
 * the students group alone filled it and the instructors heading fell below the fold,
 * which hides the very thing the grouping exists to show. The group's own count and its
 * "see all" carry the rest.
 */
const GROUP_LIMIT = 4

/**
 * The persistent top-bar search: students and instructors in one dropdown, grouped.
 *
 * Grouped rather than merged because a name can match both -- there are instructors and
 * students called Smith -- and a flat list would leave no way to tell which kind of thing
 * a row is, or where clicking it goes.
 *
 * A student row navigates by student_key rather than name, because 17 students share a
 * name with someone and the key carries the account. An instructor row navigates by name,
 * because a name is all the source data carries.
 */
export function GlobalSearch() {
  const [input, setInput] = useState('')
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // Debounced: one request per pause in typing, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setTerm(input.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [input])

  const ready = term.length >= MIN_SEARCH_LENGTH

  // Two requests, deliberately not awaited together: the groups render independently, so
  // whichever answers first is on screen while the other is still coming.
  // Below the minimum the server answers 400, so don't ask -- resolving null keeps the
  // hook's shape without spending a request to be told what we already know.
  const students = useApi<StudentsResponse | null>(
    (signal) => (ready ? searchStudents(term, GROUP_LIMIT, signal) : Promise.resolve(null)),
    [term, ready],
  )
  const instructors = useApi<InstructorsResponse | null>(
    (signal) => (ready ? searchInstructors(term, GROUP_LIMIT, signal) : Promise.resolve(null)),
    [term, ready],
  )

  // Click-away and Escape both close it; a dropdown that survives a click elsewhere sits
  // over whatever the user was actually reaching for.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function go(path: string) {
    setOpen(false)
    setInput('')
    navigate(path)
  }

  const studentRows = students.data?.students ?? []
  const instructorRows = instructors.data?.instructors ?? []
  const studentTotal = students.data?.page.total ?? 0
  const instructorTotal = instructors.data?.page.total ?? 0

  const loading = ready && (students.loading || instructors.loading)
  // Only fails if both do. One list still being useful beats blanking the dropdown
  // because the other endpoint had a bad moment.
  const error = students.error && instructors.error ? students.error : null
  const nothing =
    ready && !loading && !error && studentRows.length === 0 && instructorRows.length === 0

  /**
   * Enter, the "see all" path.
   *
   * Now that results span two kinds, one destination cannot serve both -- so it goes to
   * whichever group actually matched, and to students when both did or when nothing has
   * loaded yet. Each group's own footer is the way to the other list.
   */
  function seeAll(value: string) {
    const query = `?query=${encodeURIComponent(value)}`
    const instructorsOnly = studentRows.length === 0 && instructorRows.length > 0
    go(instructorsOnly ? `/instructors${query}` : `/students${query}`)
  }

  return (
    <div className="search" ref={containerRef}>
      <SearchIcon className="search-icon" />
      <input
        ref={box}
        className="search-input"
        type="search"
        value={input}
        placeholder="Search students and instructors…"
        aria-label="Search students and instructors"
        onChange={(event) => {
          setInput(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          // Works before the debounced results have landed, which is the point of it.
          if (event.key === 'Enter' && input.trim().length >= MIN_SEARCH_LENGTH) {
            seeAll(input.trim())
          }
        }}
      />
      {/* Clears the term and puts the dropdown away with it -- results for a query that
          is no longer in the box would outlive their question. Focus goes back to the
          field, which this button is about to disappear from. */}
      {input && (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          onClick={() => {
            setInput('')
            setOpen(false)
            box.current?.focus()
          }}
        >
          <CloseIcon />
        </button>
      )}

      {open && input.trim().length > 0 && (
        <div className="search-results">
          {!ready && (
            <p className="search-hint">Keep typing — at least {MIN_SEARCH_LENGTH} characters.</p>
          )}
          {loading && <p className="search-hint">Searching…</p>}
          {error && <p className="search-hint search-hint-error">{error.displayMessage}</p>}
          {nothing && <p className="search-hint">Nothing matches “{term}”.</p>}

          {studentRows.length > 0 && (
            <section className="search-group" aria-label="Students">
              <h3 className="search-group-title">
                Students <span className="search-group-count">{formatNumber(studentTotal)}</span>
              </h3>
              {studentRows.map((student) => (
                <button
                  key={student.student_key}
                  type="button"
                  className="search-result"
                  onClick={() => go(`/students/${encodeURIComponent(student.student_key)}`)}
                >
                  <span className="search-result-name">{student.student_name}</span>
                  <span className="search-result-meta">
                    {student.centers[0]?.name ?? 'No center'} ·{' '}
                    {formatNumber(student.total_sessions)} sessions
                  </span>
                </button>
              ))}
              {studentTotal > studentRows.length && (
                <button
                  type="button"
                  className="search-more"
                  onClick={() => go(`/students?query=${encodeURIComponent(term)}`)}
                >
                  See all {formatNumber(studentTotal)} students
                </button>
              )}
            </section>
          )}

          {instructorRows.length > 0 && (
            <section className="search-group" aria-label="Instructors">
              <h3 className="search-group-title">
                Instructors{' '}
                <span className="search-group-count">{formatNumber(instructorTotal)}</span>
              </h3>
              {instructorRows.map((instructor) => (
                <button
                  key={instructor.instructor_name}
                  type="button"
                  className="search-result"
                  onClick={() =>
                    go(`/instructors/${encodeURIComponent(instructor.instructor_name)}`)
                  }
                >
                  <span className="search-result-name">{instructor.instructor_name}</span>
                  <span className="search-result-meta">
                    {instructor.centers[0]?.name ?? 'No center'} ·{' '}
                    {formatNumber(instructor.total_sessions_taught)} sessions ·{' '}
                    {formatNumber(instructor.unique_students)} students
                  </span>
                </button>
              ))}
              {instructorTotal > instructorRows.length && (
                <button
                  type="button"
                  className="search-more"
                  onClick={() => go(`/instructors?query=${encodeURIComponent(term)}`)}
                >
                  See all {formatNumber(instructorTotal)} instructors
                </button>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
