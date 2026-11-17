import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreateComplaintAction } from '../components/complaints/CreateComplaintAction.jsx'

vi.mock('../lib/api.js', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from '../lib/api.js'

describe('CreateComplaintAction', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('muestra el tiempo restante y no navega si el usuario está en cooldown', async () => {
    const onAllowed = vi.fn()
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      data: { inCooldown: true, secondsRemaining: 901 },
    })

    render(
      <CreateComplaintAction onAllowed={onAllowed}>
        Crear denuncia
      </CreateComplaintAction>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Crear denuncia' }))

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText(/aproximadamente 16 minutos/)).toBeInTheDocument()
    expect(onAllowed).not.toHaveBeenCalled()
  })

  it('continúa a la creación cuando el cooldown ya expiró', async () => {
    const onAllowed = vi.fn()
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      data: { inCooldown: false, secondsRemaining: 0 },
    })

    render(
      <CreateComplaintAction onAllowed={onAllowed}>
        Crear denuncia
      </CreateComplaintAction>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Crear denuncia' }))

    await vi.waitFor(() => expect(onAllowed).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
