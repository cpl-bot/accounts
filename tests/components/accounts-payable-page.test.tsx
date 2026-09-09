import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AccountsPayablePage from '@/app/(app)/accounts-payable/page'

describe('AccountsPayablePage', () => {
  it('loads bills and drafts and renders the merged table', async () => {
    render(<AccountsPayablePage />)

    expect(await screen.findByText('BioShield Medical')).toBeInTheDocument()
    // A validated-with-errors draft should show up as Needs Review.
    expect(screen.getAllByText('Needs Review').length).toBeGreaterThan(0)
  })
})
