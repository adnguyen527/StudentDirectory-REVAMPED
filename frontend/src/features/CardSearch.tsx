import { useRef } from 'react'

import { CloseIcon, SearchIcon } from '../shell/Icons'
import './ListFilter.css'

interface CardSearchProps {
  value: string
  onChange: (value: string) => void
  /** What the box matches, in the user's terms. */
  placeholder: string
  /** Names the box for a screen reader, where the placeholder alone would not. */
  label: string
}

/**
 * A search box over rows a card already holds.
 *
 * The local sibling of ListFilter, and the same relationship useCardRange has to useRange:
 * identical box, different owner of the term. ListFilter puts the term in the URL because
 * a list page's filter is a request and ought to be linkable; a profile card is filtering
 * an array that arrived with the page, so there is nothing to link to and nothing to fetch.
 *
 * No debounce for the same reason. ListFilter waits 250ms so typing does not fire a request
 * per keystroke; here each keystroke is an array filter over at most a few dozen rows.
 */
export function CardSearch({ value, onChange, placeholder, label }: CardSearchProps) {
  const input = useRef<HTMLInputElement>(null)

  // The button is only rendered while there is something to clear, so clicking it removes
  // the element that had focus. Handing focus back to the field is what keeps a keyboard
  // user where they were rather than at the top of the document.
  function clear() {
    onChange('')
    input.current?.focus()
  }

  return (
    <div className="list-filter">
      <SearchIcon className="list-filter-icon" />
      <input
        ref={input}
        type="search"
        className="list-filter-input"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          onClick={clear}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  )
}
