import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { currentLocation, renderApp } from '../support/renderApp'
import { ANTHONY_KEY, BARE_REPORT, RICH_REPORT } from '../support/sampleData'
import { server } from '../support/server'

const RICH = `/reports/${RICH_REPORT._id.$oid}`
const BARE = `/reports/${BARE_REPORT._id.$oid}`

/** The label/value pairs in the Session details card, as the page lays them out. */
function field(label: string) {
  const cell = screen.getByText(label).closest('.report-field')
  if (!cell) throw new Error(`no field labelled ${label}`)
  return cell
}

function fieldLabels() {
  return [...document.querySelectorAll('.report-field-label')].map((el) => el.textContent)
}

describe('report detail page', () => {
  it('names the session by its student, date and place', async () => {
    renderApp(RICH)

    expect(await screen.findByRole('heading', { name: 'Anthony Nguyen' })).toBeInTheDocument()
    // Scoped to the header: the center and the delivery method appear here as the summary
    // and again in Session details as the record, which is the intended duplication.
    const header = within(document.querySelector('.page-header') as HTMLElement)
    expect(header.getByText('Mar 14, 2026')).toBeInTheDocument()
    expect(header.getByText('5:53 PM – 6:53 PM')).toBeInTheDocument()
    expect(header.getByText('Westside')).toBeInTheDocument()
    expect(header.getByText('In-Center')).toBeInTheDocument()
  })

  it('shows the session figures as tiles', async () => {
    renderApp(RICH)

    await screen.findByRole('heading', { name: 'Anthony Nguyen' })
    // Pages completed against the goal set for the session.
    expect(screen.getByText('7 / 9')).toBeInTheDocument()
    expect(screen.getByText('88')).toBeInTheDocument()
    // Session length is derived: 5:53 PM to 6:53 PM.
    expect(screen.getByText('60 min')).toBeInTheDocument()
  })

  it('shows the staff notes the list route withholds', async () => {
    // ⚠️ The deliberate difference between DETAIL_PROJECTION and LIST_PROJECTION. One
    // report opened on purpose is the act the student's own profile already allows.
    renderApp(RICH)

    expect(await screen.findByText('Student notes')).toBeInTheDocument()
    expect(screen.getByText('Prefers worked examples first.')).toBeInTheDocument()
  })

  it('links the topics it worked to their own pages', async () => {
    renderApp(RICH)

    const link = await screen.findByRole('link', { name: 'PK-1000-00' })
    expect(link).toHaveAttribute('href', '/topics/PK-1000-00')
    expect(screen.getByText('Distributive Property')).toBeInTheDocument()
    expect(screen.getByText('Mastered')).toBeInTheDocument()
  })

  it('renders a boolean as an answer, never as a blank', async () => {
    // ⚠️ The rule the whole page turns on. needs_*_deck_update and last_punch_of_day are
    // on 100% of reports and usually false; a false gone blank would read as "we don't
    // know" rather than "no".
    renderApp(RICH)

    await screen.findByRole('heading', { name: 'Anthony Nguyen' })
    expect(within(field('Primary deck needs update')).getByText('Yes')).toBeInTheDocument()
    expect(within(field('Secondary deck needs update')).getByText('No')).toBeInTheDocument()
    expect(within(field('Schoolwork checked')).getByText('No')).toBeInTheDocument()
  })

  it('shows the sparse fields when the report has them', async () => {
    renderApp(RICH)

    await screen.findByRole('heading', { name: 'Anthony Nguyen' })
    expect(within(field('Card level')).getByText('Level 3')).toBeInTheDocument()
    expect(within(field('Stars on card')).getByText('4 / 10')).toBeInTheDocument()
    expect(within(field('Schoolwork')).getByText('Unit 2 review packet')).toBeInTheDocument()
    expect(within(field('Goal 1')).getByText('Finish the fractions deck')).toBeInTheDocument()
  })

  it('renders every section for a report that has none of them', async () => {
    // ⚠️ The point of the fixed layout. This is the 7% whose row the list's expander
    // leaves inert -- no topics, no summary, no assessment, none of the sparse fields.
    // The page must be the same page, not a shorter one.
    renderApp(BARE)

    expect(await screen.findByRole('heading', { name: 'Chloe Tan' })).toBeInTheDocument()
    // By role: "Topics worked" is also a stat tile's label, and the card is the section.
    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Topics worked' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Session details' })).toBeInTheDocument()
    expect(screen.getByText('Card level')).toBeInTheDocument()
    expect(screen.getByText('Goal 1')).toBeInTheDocument()
  })

  it('lays the fields out in the same order whether or not they are filled in', async () => {
    renderApp(RICH)
    await screen.findByRole('heading', { name: 'Anthony Nguyen' })
    const rich = fieldLabels()

    renderApp(BARE)
    await screen.findByRole('heading', { name: 'Chloe Tan' })
    // Two renders in one document, so read the second page's labels off the tail.
    expect(fieldLabels().slice(rich.length)).toEqual(rich)
  })

  it('says a missing value is missing rather than dropping its row', async () => {
    renderApp(BARE)

    await screen.findByRole('heading', { name: 'Chloe Tan' })
    expect(within(field('Card level')).getByText('—')).toBeInTheDocument()
    expect(within(field('Goal 1')).getByText('—')).toBeInTheDocument()
    // An empty note keeps its label and dashes, exactly as an empty field does -- one
    // spelling of "nothing here" across both cards.
    expect(screen.getByText('Session summary')).toBeInTheDocument()
    expect(screen.getByText('Assessment')).toBeInTheDocument()
    // The topics card keeps a sentence instead: it is a whole card body with a table in
    // it, not a labelled slot, and a dash in an empty table would say less.
    expect(screen.getByText('No topics recorded on this session.')).toBeInTheDocument()
  })

  it('keeps a field that is empty in every report in the data', async () => {
    // internet_rating is null on all 29,382. Rendered anyway, so it lights up if the
    // source ever starts writing it -- and reads as empty rather than as absent today.
    renderApp(RICH)

    await screen.findByRole('heading', { name: 'Anthony Nguyen' })
    expect(within(field('Internet rating')).getByText('—')).toBeInTheDocument()
  })

  it('reads the month counter as the position it is, not as a total', async () => {
    // ⚠️ sessions_this_month is this session's own place in its calendar month, counted up
    // to and including itself, per student rather than per household. The old label,
    // "Sessions this month", claimed the opposite of what the number means.
    renderApp(RICH)

    await screen.findByRole('heading', { name: 'Anthony Nguyen' })
    expect(within(field('Session of the month')).getByText('6th')).toBeInTheDocument()
    expect(screen.queryByText('Sessions this month')).not.toBeInTheDocument()
  })

  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    // ⚠️ The teens are the reason this is a function and not a lookup on the last digit.
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    // The highest the real data reaches.
    [25, '25th'],
  ])('suffixes %i as %s', async (count, expected) => {
    server.use(
      http.get('/api/reports/:reportId', () =>
        HttpResponse.json({ report: { ...RICH_REPORT, sessions_this_month: count } }),
      ),
    )
    renderApp(RICH)

    await screen.findByRole('heading', { name: 'Anthony Nguyen' })
    expect(within(field('Session of the month')).getByText(expected)).toBeInTheDocument()
  })

  it('dashes the month counter when the report has none', async () => {
    renderApp(BARE)

    await screen.findByRole('heading', { name: 'Chloe Tan' })
    expect(within(field('Session of the month')).getByText('—')).toBeInTheDocument()
  })

  it('opens the student from the heading', async () => {
    const { user } = renderApp(RICH)

    await user.click(await screen.findByRole('link', { name: 'Anthony Nguyen' }))

    await waitFor(() => {
      expect(currentLocation()).toBe(`/students/${encodeURIComponent(ANTHONY_KEY)}`)
    })
  })

  it('goes back to the list', async () => {
    const { user } = renderApp(RICH)

    await user.click(await screen.findByRole('link', { name: /all reports/i }))

    await waitFor(() => expect(currentLocation()).toBe('/reports'))
  })

  it('says so when there is no such report, and offers the way back', async () => {
    // A mistyped id is a 404 from the API rather than a 500 -- find_by_id absorbs the
    // InvalidId -- so the page has a not-found state to render rather than an error.
    const { user } = renderApp('/reports/not-an-oid')

    expect(await screen.findByText('Report not found')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /back to all reports/i }))
    await waitFor(() => expect(currentLocation()).toBe('/reports'))
  })
})
