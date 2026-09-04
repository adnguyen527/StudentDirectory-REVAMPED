import { useEffect } from 'react'

/** The wordmark, kept last so the distinguishing part survives a narrow tab. */
const SUFFIX = 'Sigma'

/**
 * Names the browser tab for the page currently open.
 *
 * Every page had the same title, which made a row of tabs and a history menu useless --
 * and the history entries are the worse half, since Back is where you go to find the
 * student you were reading five minutes ago.
 *
 * `null` while a detail page is still loading: it leaves the previous title in place for
 * the moment it takes to arrive rather than flashing "Sigma" between two real names.
 */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (title === null) return
    document.title = title === SUFFIX ? SUFFIX : `${title} · ${SUFFIX}`
  }, [title])
}
