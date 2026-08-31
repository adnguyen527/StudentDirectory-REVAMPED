import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { formatNumber } from '../api/bson'
import { MIN_SEARCH_LENGTH, searchStudents } from '../api/endpoints'
import type { StudentsResponse } from '../api/types'
import { useApi } from '../hooks/useApi'
import { SearchIcon } from '../shell/Icons'
import './GlobalSearch.css'

const DEBOUNCE_MS = 250
const DROPDOWN_LIMIT = 10

/**
 * The persistent top-bar search, answering the README's open question the way the layout
 * reference implies: results in a dropdown, no page of its own.
 *
 * Picking a result goes to the students list filtered by that name. Once the student
 * profile page exists this should navigate to /students/<student_key> instead -- the
 * account_id shown on each row is what disambiguates the 17 students who share a name
 * with someone.
 */
export function GlobalSearch() {
  const [input, setInput] = useState('')
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  // Debounced: one request per pause in typing, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setTerm(input.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [input])

  const ready = term.length >= MIN_SEARCH_LENGTH
  const { data, loading, error } = useApi<StudentsResponse | null>(
    // Below the minimum the server answers 400, so don't ask -- resolving null keeps the
    // hook's shape without spending a request to be told what we already know.
    (signal) => (ready ? searchStudents(term, DROPDOWN_LIMIT, signal) : Promise.resolve(null)),
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

  function choose(name: string) {
    setOpen(false)
    setInput('')
    navigate(`/students?query=${encodeURIComponent(name)}`)
  }

  const results = data?.students ?? []
  const total = data?.page.total ?? 0
  const more = total - results.length

  return (
    <div className="search" ref={containerRef}>
      <SearchIcon className="search-icon" />
      <input
        className="search-input"
        type="search"
        value={input}
        placeholder="Search students…"
        aria-label="Search students"
        onChange={(event) => {
          setInput(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          // Enter takes the whole term to the list rather than picking a row -- that is
          // the "see all" path, and it works before the debounced results have landed.
          if (event.key === 'Enter' && input.trim().length >= MIN_SEARCH_LENGTH) {
            choose(input.trim())
          }
        }}
      />

      {open && input.trim().length > 0 && (
        <div className="search-results" role="listbox">
          {!ready && (
            <p className="search-hint">Keep typing — at least {MIN_SEARCH_LENGTH} characters.</p>
          )}
          {ready && loading && <p className="search-hint">Searching…</p>}
          {ready && error && <p className="search-hint search-hint-error">{error.displayMessage}</p>}
          {ready && !loading && !error && results.length === 0 && (
            <p className="search-hint">No students match “{term}”.</p>
          )}

          {results.map((student) => (
            <button
              key={student.student_key}
              type="button"
              className="search-result"
              onClick={() => choose(student.student_name)}
            >
              <span className="search-result-name">{student.student_name}</span>
              <span className="search-result-meta">
                {student.centers[0]?.name ?? 'No center'} · {formatNumber(student.total_sessions)}{' '}
                sessions
              </span>
            </button>
          ))}

          {more > 0 && (
            <p className="search-hint search-hint-more">
              {formatNumber(more)} more — press Enter or pick one to see the full list.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
