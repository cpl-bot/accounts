import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { UploadModal } from '@/components/ap/upload-modal'

describe('UploadModal', () => {
  it('uploads a single file and shows it as done', async () => {
    render(<UploadModal open onClose={() => {}} />)

    const file = new File(['pdf-bytes'], 'invoice.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    const user = userEvent.setup()
    await user.upload(input, file)

    expect(await screen.findByText('invoice.pdf')).toBeInTheDocument()
  })
})
