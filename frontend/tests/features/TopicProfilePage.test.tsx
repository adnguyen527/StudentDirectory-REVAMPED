import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { currentLocation, renderApp } from '../support/renderApp'
import { DANA, DECIMALS_TWO_ID, FRACTIONS_DETAIL, FRACTIONS_ID } from '../support/sampleData'
import { server } from '../support/server'

/** A ranked instructor list of `count`, sessions descending so the order is checkable. */
function manyInstructors(count: number) {
  return {
    instructors: Array.from({ length: count }, (_, i) => ({
      name: `Instructor ${String(i).padStart(2, '0')}`,
      sessions: count - i,
    })),
  }
}

/** The card with this heading, once the page has finished loading into it. */
async function card(title: RegExp) {
  const heading = await screen.findByRole('heading', { name: title })
  return heading.closest('section') as HTMLElement
}

describe('topic profile page', () => {
  it('leads with the topic, its id and the names it no longer goes by', async () => {
    renderApp(`/topics/${FRACTIONS_ID}`)

    expect(await screen.findByRole('heading', { name: 'Fractions', level: 1 })).toBeInTheDocument()
    expect(screen.getByText(FRACTIONS_ID)).toBeInTheDocument()
    // Someone who knows the old name needs to see they are in the right place.
    expect(screen.getByText(/Halves and Quarters/)).toBeInTheDocument()
  })

  it('names the browser tab id first, since names are not unique', async () => {
    // ⚠️ 90 names are carried by more than one topic and four are called "Patterns -
    // Number Patterns", so a tab titled by name alone can name two different topics the
    // same thing. The id leads because the front of the string is what a narrow tab keeps.
    renderApp(`/topics/${FRACTIONS_ID}`)

    await screen.findByRole('heading', { name: 'Fractions', level: 1 })
    await waitFor(() => expect(document.title).toBe(`${FRACTIONS_ID} Fractions · Sigma`))
  })

  it('separates finishing it now from ever having finished it', async () => {
    // A topic finished and later handed back counts in students_ever_finished while
    // sitting on someone's plan. The two disagreeing is expected, so it is spelled out.
    server.use(
      http.get('/api/topics/:topicId', () =>
        HttpResponse.json({
          topic: { ...FRACTIONS_DETAIL, students_finished: 2, students_ever_finished: 5 },
        }),
      ),
    )
    renderApp(`/topics/${FRACTIONS_ID}`)

    expect(await screen.findByText(/3 finished it once, then got it back/)).toBeInTheDocument()
  })

  it('breaks the students down into states that add up', async () => {
    renderApp(`/topics/${FRACTIONS_ID}`)

    const states = await card(/Where students stand/)
    expect(within(states).getByText('Mastered')).toBeInTheDocument()
    expect(within(states).getByText('Still on the plan')).toBeInTheDocument()
    expect(within(states).getByText('Came off the plan unfinished')).toBeInTheDocument()
  })

  it('shows mastery as a fraction of the students who finished', async () => {
    // The count is still readable as the denominator; the numerator says how many of
    // them got past Completed. FRACTIONS is 1 of 2.
    renderApp(`/topics/${FRACTIONS_ID}`)

    const states = await card(/Where students stand/)
    expect(within(states).getByText('1 / 2')).toBeInTheDocument()
  })

  it('shows a dash rather than a fraction when nobody has finished', async () => {
    // 111 real topics have nobody in that row, and 0/0 is not a number.
    renderApp(`/topics/${DECIMALS_TWO_ID}`)

    const states = await card(/Where students stand/)
    expect(within(states).getByText('—')).toBeInTheDocument()
  })

  it('ranks the instructors and links each one onward', async () => {
    const { user } = renderApp(`/topics/${FRACTIONS_ID}`)

    const taught = await card(/Taught most by/)
    expect(within(taught).getByRole('link', { name: DANA })).toBeInTheDocument()

    await user.click(within(taught).getByRole('link', { name: DANA }))
    await waitFor(() => expect(currentLocation()).toBe('/instructors/Dana%20Reyes'))
  })

  it('pages the instructor ranking ten at a time', async () => {
    // The median topic has 17 instructors and the widest 82, so this card is the long one
    // on the page. The whole ranked list arrives in the detail response, so paging it
    // costs no request.
    server.use(
      http.get('/api/topics/:topicId', () =>
        HttpResponse.json({ topic: { ...FRACTIONS_DETAIL, ...manyInstructors(12) } }),
      ),
    )
    const { user } = renderApp(`/topics/${FRACTIONS_ID}`)

    const taught = await card(/Taught most by/)
    expect(await within(taught).findByText('1–10 of 12')).toBeInTheDocument()
    expect(within(taught).getByRole('button', { name: /previous/i })).toBeDisabled()
    expect(within(taught).getAllByRole('row')).toHaveLength(11) // header + 10

    await user.click(within(taught).getByRole('button', { name: /next/i }))

    expect(await within(taught).findByText('11–12 of 12')).toBeInTheDocument()
    expect(within(taught).getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('keeps the ranking descending across a page boundary', async () => {
    server.use(
      http.get('/api/topics/:topicId', () =>
        HttpResponse.json({ topic: { ...FRACTIONS_DETAIL, ...manyInstructors(12) } }),
      ),
    )
    const { user } = renderApp(`/topics/${FRACTIONS_ID}`)

    const taught = await card(/Taught most by/)
    await within(taught).findByText('1–10 of 12')
    // Sessions run 12 down to 1, so page two continues at 2 rather than restarting.
    await user.click(within(taught).getByRole('button', { name: /next/i }))

    await within(taught).findByText('11–12 of 12')
    expect(within(taught).getByRole('link', { name: 'Instructor 10' })).toBeInTheDocument()
    expect(within(taught).queryByRole('link', { name: 'Instructor 00' })).not.toBeInTheDocument()
  })

  it('shows every instructor without a pager fuss when there are ten or fewer', async () => {
    // The count still reads; the controls do not appear, because there is nowhere to go.
    renderApp(`/topics/${FRACTIONS_ID}`)

    const taught = await card(/Taught most by/)
    expect(await within(taught).findByText('1–2 of 2')).toBeInTheDocument()
    expect(within(taught).queryByRole('button', { name: /next/i })).not.toBeInTheDocument()
    expect(within(taught).queryByRole('button', { name: /previous/i })).not.toBeInTheDocument()
  })

  it('says so when no instructor was ever recorded', async () => {
    renderApp(`/topics/${DECIMALS_TWO_ID}`)

    expect(await screen.findByText(/No instructor was recorded/)).toBeInTheDocument()
  })

  it('shows a dash, not a zero, when nobody has finished it', async () => {
    renderApp(`/topics/${DECIMALS_TWO_ID}`)

    expect(await screen.findByText(/nobody has finished it/)).toBeInTheDocument()
  })

  it('names the stats that are not built yet rather than faking them', async () => {
    renderApp(`/topics/${FRACTIONS_ID}`)

    const pending = await card(/Time to finish and page pace/)
    expect(within(pending).getByText(/Not available yet/)).toBeInTheDocument()
  })

  it('offers a way back for an unknown topic', async () => {
    const { user } = renderApp('/topics/T-999')

    expect(await screen.findByRole('heading', { name: /Topic not found/ })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /back to all topics/i }))

    await waitFor(() => expect(currentLocation()).toBe('/topics'))
  })

  it('reports a failed request as an error, not an empty topic', async () => {
    server.use(
      http.get('/api/topics/:topicId', () =>
        HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      ),
    )
    renderApp(`/topics/${FRACTIONS_ID}`)

    expect(await screen.findByRole('alert')).toHaveTextContent('Error 401')
  })
})
