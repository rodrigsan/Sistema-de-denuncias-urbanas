import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MyComplaintsPage } from '../pages/MyComplaintsPage.jsx'

vi.mock('../lib/api.js', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from '../lib/api.js'

describe('MyComplaintsPage', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renderiza y permite abrir una denuncia activa durante el período de gracia', async () => {
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path.startsWith('/citizens/complaints')) {
        return Promise.resolve({
          ok: true,
          data: {
            complaints: [
              {
                id: 'complaint-1',
                status: 'GRACE_PERIOD',
                publicCode: 'DEN-TEST',
                title: 'Bache en la calle',
                category: { name: 'Vías' },
                subcategory: { name: 'Baches' },
                createdAt: '2026-11-17T12:00:00.000Z',
              },
            ],
            pagination: { page: 1, limit: 8, total: 1 },
          },
        })
      }

      return Promise.resolve({ ok: true, data: { inCooldown: false } })
    })

    render(
      <MemoryRouter initialEntries={['/mis-denuncias']}>
        <Routes>
          <Route path="/mis-denuncias" element={<MyComplaintsPage />} />
          <Route path="/mis-denuncias/:id" element={<div>Detalle de denuncia</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('No puedes crear otra denuncia: tienes una denuncia en período de gracia activa'))
      .toBeInTheDocument()
    expect(screen.getAllByText('En ventana de gracia')).toHaveLength(2)
    expect(screen.queryByRole('link', { name: /crear denuncia/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /DEN-TEST/ }))

    await waitFor(() => {
      expect(screen.getByText('Detalle de denuncia')).toBeInTheDocument()
    })
  })
})
