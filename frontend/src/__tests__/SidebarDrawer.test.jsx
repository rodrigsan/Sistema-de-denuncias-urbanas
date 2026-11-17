import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { SidebarDrawer } from '../components/layout/SidebarDrawer.jsx'

vi.mock('../hooks/useAuth.js', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '../hooks/useAuth.js'

describe('SidebarDrawer', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  function renderDrawer({ logout = vi.fn(), onClose = vi.fn() } = {}) {
    vi.mocked(useAuth).mockReturnValue({
      user: { userType: 'CITIZEN', alias: 'Vecino', roles: [] },
      profile: null,
      loading: false,
      loginWithGoogle: vi.fn(),
      logout,
    })

    render(
      <MemoryRouter>
        <SidebarDrawer open onClose={onClose} />
      </MemoryRouter>,
    )

    return { logout, onClose }
  }

  it('pide confirmación antes de cerrar sesión y permite cancelar', () => {
    const { logout } = renderDrawer()

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      '¿Estás seguro de que deseas cerrar sesión?',
    )
    expect(logout).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(logout).not.toHaveBeenCalled()
  })

  it('cierra la sesión al confirmar', async () => {
    const logout = vi.fn().mockResolvedValue(undefined)
    const { onClose } = renderDrawer({ logout })

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cerrar sesión' }))

    await waitFor(() => {
      expect(logout).toHaveBeenCalledOnce()
      expect(onClose).toHaveBeenCalledOnce()
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('muestra el error de cierre de sesión si la petición falla', async () => {
    const logout = vi.fn().mockRejectedValue(new Error('No se pudo cerrar sesión'))
    renderDrawer({ logout })

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cerrar sesión' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cerrar sesión')
  })
})
