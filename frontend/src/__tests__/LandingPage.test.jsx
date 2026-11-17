import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LandingPage } from '../pages/LandingPage.jsx'

vi.mock('../hooks/useAuth.js', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '../hooks/useAuth.js'

describe('LandingPage', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('muestra la opción de primera denuncia a visitantes sin sesión', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: false,
      authError: null,
      loginWithGoogle: vi.fn(),
    })

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: 'Crear mi primera denuncia' })).toBeInTheDocument()
  })

  it('oculta la opción de primera denuncia cuando hay una sesión activa', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { userType: 'CITIZEN', roles: [] },
      loading: false,
      authError: null,
      loginWithGoogle: vi.fn(),
    })

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: 'Crear mi primera denuncia' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Crear una denuncia' })).toBeInTheDocument()
  })
})
