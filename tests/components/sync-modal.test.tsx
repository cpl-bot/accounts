import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import { SyncModal } from '@/components/ap/sync-modal'
import { demoSyncRun } from '@/lib/api/demo-fixtures'
import { server } from '../msw/server'

describe('SyncModal', () => {
  // The default posture (TALLY_WRITE_ENABLED off) returns every item as
  // `status: 'validated', dry_run: true` — a success, not a failure.
  it('renders a dry-run push as a dry run rather than a failure', async () => {
    render(<SyncModal open onClose={() => {}} draftIds={['draft-1']} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /sync selected/i }))

    expect(await screen.findByText('Sync Results')).toBeInTheDocument()
    expect(screen.getByText(/dry run — nothing was written to tally/i)).toBeInTheDocument()
    expect(screen.getByText('Validated (dry run)')).toBeInTheDocument()
    expect(screen.getByText('draft-1')).toBeInTheDocument()
    expect(screen.getByText(/0 committed, 1 validated \(dry run\), 0 failed/i)).toBeInTheDocument()
    expect(screen.queryByText(/failed:/i)).not.toBeInTheDocument()
  })

  it('shows committed vouchers and per-item validation errors when writes are enabled', async () => {
    server.use(
      http.post('/api/talai/sync/push', () =>
        HttpResponse.json({
          run: { ...demoSyncRun(), records_changed: 1 },
          results: [
            {
              draft_id: 'draft-ok',
              status: 'committed',
              voucher_number: 'PB-2026-0041',
              dry_run: false,
              errors: [],
            },
            {
              draft_id: 'draft-bad',
              status: 'failed',
              voucher_number: null,
              dry_run: false,
              errors: [
                {
                  code: 'LEDGER_NOT_FOUND',
                  field: 'party.ledger_name',
                  message: 'Ledger "Ghost Vendor" was not found in Tally.',
                  severity: 'error',
                  details: null,
                },
              ],
            },
          ],
        }),
      ),
    )

    render(<SyncModal open onClose={() => {}} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /sync selected/i }))

    expect(await screen.findByText('Sync Results')).toBeInTheDocument()
    expect(screen.getByText(/PB-2026-0041/)).toBeInTheDocument()
    expect(
      screen.getByText('Ledger "Ghost Vendor" was not found in Tally.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/1 committed, 0 validated \(dry run\), 1 failed/i)).toBeInTheDocument()
    expect(screen.queryByText(/nothing was written to tally/i)).not.toBeInTheDocument()
  })

  it("surfaces a failed run's error", async () => {
    server.use(
      http.post('/api/talai/sync/push', () =>
        HttpResponse.json({
          run: { ...demoSyncRun(), status: 'failed', error: 'Tally is unreachable' },
          results: [],
        }),
      ),
    )

    render(<SyncModal open onClose={() => {}} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /sync selected/i }))

    expect(await screen.findByText(/Tally is unreachable/)).toBeInTheDocument()
    expect(screen.getByText(/no queued records were found to sync/i)).toBeInTheDocument()
  })
})
