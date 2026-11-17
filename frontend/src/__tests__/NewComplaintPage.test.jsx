import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { NewComplaintPage } from '../pages/NewComplaintPage.jsx'

vi.mock('../lib/api.js', () => ({
  apiFetch: vi.fn(),
}))

vi.mock('../components/complaints/ComplaintForm.jsx', () => ({
  ComplaintForm: () => <form aria-label="Formulario de denuncia" />,
}))

vi.mock('../components/complaints/EvidenceUploader.jsx', () => ({
  EvidenceUploader: () => null,
}))

import { apiFetch } from '../lib/api.js'

describe('NewComplaintPage', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('permite salir del bloqueo por cooldown sin recargar la página', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      data: {
        inCooldown: true,
        secondsRemaining: 901,
        message: 'Debes esperar antes de crear una nueva denuncia.',
      },
    })

    render(
      <MemoryRouter initialEntries={['/denuncias/nueva']}>
        <Routes>
          <Route path="/denuncias/nueva" element={<NewComplaintPage />} />
          <Route path="/mis-denuncias" element={<div data-testid="my-complaints">Mis denuncias</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Entendido' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Recargar página' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }))

    expect(await screen.findByTestId('my-complaints')).toBeInTheDocument()
  })
})
