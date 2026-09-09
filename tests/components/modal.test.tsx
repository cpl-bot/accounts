import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from '@/components/ui/modal'

describe('Modal', () => {
  it('moves focus into the dialog and sets aria-labelledby to the title', () => {
    render(
      <Modal open onClose={() => {}} title="Sync Financial Data">
        <button>Inner action</button>
      </Modal>,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-labelledby')
    expect(document.activeElement).not.toBe(document.body)
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('calls onClose when Escape is pressed', async () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Bulk Upload Bills">
        <button>Inner action</button>
      </Modal>,
    )

    const user = userEvent.setup()
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Hidden">
        <p>content</p>
      </Modal>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
