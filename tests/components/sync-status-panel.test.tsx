import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { SyncStatusPanel } from '@/components/layout/sync-status-panel'
import { useSettings } from '@/lib/api/hooks'
import { demoSettings, demoSyncRunList, demoSyncStatus } from '@/lib/api/demo-fixtures'
import { server } from '../msw/server'

const API = '/api/talai'

describe('SyncStatusPanel', () => {
  it('shows "Last synced" when every scope last succeeded', async () => {
    render(<SyncStatusPanel />)

    expect(await screen.findByText(/last synced/i)).toBeInTheDocument()
  })

  it('shows a partial-sync summary and the error detail when a scope failed', async () => {
    server.use(
      http.get(`${API}/sync/status`, () => {
        const status = demoSyncStatus()
        const vouchers = status.scopes.find((s) => s.scope === 'vouchers')!
        vouchers.status = 'failed'
        vouchers.error = 'Tally connection refused'
        return HttpResponse.json(status)
      }),
    )

    render(<SyncStatusPanel />)

    const summary = await screen.findByText(/partial sync — 1 of 4 failed/i)
    expect(summary).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(summary)

    expect(await screen.findByText(/tally connection refused/i)).toBeInTheDocument()
  })

  it('shows "Never synced" when no scope has ever run', async () => {
    server.use(
      http.get(`${API}/sync/status`, () => {
        const status = demoSyncStatus()
        status.scopes.forEach((s) => {
          s.status = null
          s.last_run_at = null
          s.last_finished_at = null
          s.last_success_at = null
          s.error = null
        })
        return HttpResponse.json(status)
      }),
    )

    render(<SyncStatusPanel />)

    expect(await screen.findByText(/never synced/i)).toBeInTheDocument()
  })

  it('clicking "Sync now" posts to sync/pull and surfaces a failed scope from the result', async () => {
    let pullRequests = 0
    let statusRequests = 0
    server.use(
      http.post(`${API}/sync/pull`, async () => {
        pullRequests += 1
        const runs = demoSyncRunList()
        const bills = runs.items.find((r) => r.scope === 'bills')!
        bills.status = 'failed'
        bills.error = 'Bills window pull failed'
        return HttpResponse.json(runs)
      }),
      http.get(`${API}/sync/status`, () => {
        statusRequests += 1
        return HttpResponse.json(demoSyncStatus())
      }),
    )

    render(<SyncStatusPanel />)
    await screen.findByText(/last synced/i)
    expect(statusRequests).toBe(1)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /sync now/i }))

    expect(await screen.findByText(/bills failed: bills window pull failed/i)).toBeInTheDocument()
    expect(pullRequests).toBe(1)
    expect(statusRequests).toBe(2)
  })

  it('tells every other mounted data hook to refetch once a pull completes', async () => {
    let settingsRequests = 0
    server.use(
      http.get(`${API}/settings`, () => {
        settingsRequests += 1
        return HttpResponse.json(demoSettings())
      }),
    )
    function SettingsProbe() {
      const { data } = useSettings()
      return <span>{data ? 'settings loaded' : 'settings loading'}</span>
    }

    render(
      <>
        <SyncStatusPanel />
        <SettingsProbe />
      </>,
    )
    await screen.findByText(/last synced/i)
    await screen.findByText('settings loaded')
    expect(settingsRequests).toBe(1)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /sync now/i }))

    await screen.findByRole('button', { name: /sync now/i })
    await vi.waitFor(() => expect(settingsRequests).toBe(2))
  })
})
