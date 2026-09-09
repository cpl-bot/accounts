import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ConnectionForm } from '@/components/configuration/connection-form'

describe('ConnectionForm', () => {
  it('loads current settings and lets the user test the connection', async () => {
    render(<ConnectionForm />)

    const hostInput = await screen.findByPlaceholderText('192.168.1.24')
    await waitFor(() => expect(hostInput).toHaveValue('192.168.1.24'))

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /test connection/i }))

    expect(await screen.findByText(/reachable/i)).toBeInTheDocument()
  })

  it('saves settings and shows a confirmation', async () => {
    render(<ConnectionForm />)
    await screen.findByPlaceholderText('192.168.1.24')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(await screen.findByText('Saved.')).toBeInTheDocument()
  })

  it('shows the write-enabled flag as read-only, controlled by the middleware', async () => {
    render(<ConnectionForm />)
    await screen.findByPlaceholderText('192.168.1.24')
    expect(screen.getByText('Disabled')).toBeInTheDocument()
    expect(screen.getByText(/TALLY_WRITE_ENABLED/)).toBeInTheDocument()
  })
})
