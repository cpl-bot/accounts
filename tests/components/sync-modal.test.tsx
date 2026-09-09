import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SyncModal } from '@/components/ap/sync-modal'

describe('SyncModal', () => {
  it('pushes the selection and shows per-record results, including a dry-run notice', async () => {
    render(<SyncModal open onClose={() => {}} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /sync selected/i }))

    expect(await screen.findByText('Sync Results')).toBeInTheDocument()
    expect(screen.getByText(/dry run/i)).toBeInTheDocument()
    expect(screen.getByText(/1 committed, 0 failed/i)).toBeInTheDocument()
    expect(screen.getByText(/PB-2026-0041/)).toBeInTheDocument()
  })
})
