import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Pager } from '../../src/shell/Pager'

/**
 * The Pager holds no page number of its own -- it derives everything from the envelope
 * the API returned, so it cannot disagree with what was actually served. These pin the
 * boundaries, which is where that arithmetic goes wrong.
 */
function page(over: Partial<{ limit: number; offset: number; total: number; returned: number }>) {
  return { limit: 25, offset: 0, total: 149, returned: 25, ...over }
}

describe('Pager', () => {
  it('counts from one on the first page, not zero', () => {
    render(<Pager page={page({})} onChange={vi.fn()} />)
    expect(screen.getByText('1–25 of 149')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled()
  })

  it('ends exactly on the total and disables Next on a short last page', () => {
    // 149 rows at 25 leaves 24 on the last page -- the case that reveals a pager which
    // assumes every page is full.
    render(<Pager page={page({ offset: 125, returned: 24 })} onChange={vi.fn()} />)
    expect(screen.getByText('126–149 of 149')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /previous/i })).toBeEnabled()
  })

  it('disables Next when one full page is all there is', () => {
    render(<Pager page={page({ total: 25, returned: 25 })} onChange={vi.fn()} />)
    expect(screen.getByText('1–25 of 25')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('says no results rather than "1–0 of 0"', () => {
    render(<Pager page={page({ total: 0, returned: 0 })} onChange={vi.fn()} />)
    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
  })

  it('advances by the limit the server actually used', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Pager page={page({ limit: 10, offset: 20, returned: 10, total: 100 })} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(onChange).toHaveBeenCalledWith(30)
  })

  it('clamps Previous at zero rather than sending a negative offset', async () => {
    // The API answers 400 on a negative offset, so this must never be sent.
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Pager page={page({ limit: 25, offset: 10, returned: 10, total: 40 })} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /previous/i }))
    expect(onChange).toHaveBeenCalledWith(0)
  })
})
