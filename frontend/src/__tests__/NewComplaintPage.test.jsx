import { cleanup, render, screen } from '@testing-library/react'
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

  it('muestra bloqueo por cooldown sin recargar la página', async () => {
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

    // Verifica que se muestra el bloqueo por cooldown
    expect(await screen.findByText('Período de espera activo')).toBeInTheDocument()

    // Verifica que se muestra el tiempo restante (901 segundos ≈ 16 minutos)
    expect(await screen.findByText(/Tiempo restante: 16 min/)).toBeInTheDocument()

    // Verifica que se muestra el mensaje de espera
    expect(await screen.findByText('Debes esperar antes de crear una nueva denuncia.')).toBeInTheDocument()

    // Verifica que NO se muestra el formulario de creación (bloqueado por cooldown)
    expect(screen.queryByRole('button', { name: 'Crear denuncia' })).not.toBeInTheDocument()

    // Verifica que el componente permanece montado (no hay recarga de página)
    expect(screen.getByText('Período de espera activo')).toBeInTheDocument()
  })
})
