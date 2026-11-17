import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '../contexts/AuthContext.jsx'
import { useAuth } from '../hooks/useAuth.js'

vi.mock('../lib/api.js', () => ({
  API_URL: 'http://localhost/api/v1',
  apiErrorMessage: vi.fn(() => 'No se pudo cerrar sesión'),
  apiFetch: vi.fn(),
}))

import { apiFetch } from '../lib/api.js'

function AuthState() {
  const { user, logout } = useAuth()

  return (
    <>
      <p>{user?.alias ?? 'Sin sesión'}</p>
      <button type="button" onClick={() => void logout().catch(() => {})}>
        Cerrar
      </button>
    </>
  )
}

describe('AuthProvider logout', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('limpia los datos del usuario aunque falle la petición al servidor', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path === '/auth/me') {
        return { ok: true, data: { alias: 'Vecino', userType: 'CITIZEN' } }
      }
      if (path === '/citizens/me') {
        return { ok: true, data: { administrativeCode: 'ABC-123' } }
      }
      return { ok: false, data: null }
    })

    render(
      <AuthProvider>
        <AuthState />
      </AuthProvider>,
    )

    expect(await screen.findByText('Vecino')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))

    await waitFor(() => expect(screen.getByText('Sin sesión')).toBeInTheDocument())
    expect(apiFetch).toHaveBeenCalledWith('/auth/logout', { method: 'POST' })
  })
})
