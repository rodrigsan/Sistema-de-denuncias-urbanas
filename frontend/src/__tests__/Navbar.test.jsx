import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Navbar } from '../components/layout/Navbar.jsx'

vi.mock('../hooks/useAuth.js', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '../hooks/useAuth.js'

describe('Navbar', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('oculta el menú hamburguesa mientras no haya sesión', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: false,
      loginWithGoogle: vi.fn(),
    })

    render(
      <MemoryRouter>
        <Navbar onOpenDrawer={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: 'Abrir menú lateral' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continuar con Google/ })).toBeInTheDocument()
  })

  it('muestra el menú hamburguesa con sesión autenticada', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { userType: 'CITIZEN', alias: 'Vecino' },
      loading: false,
      loginWithGoogle: vi.fn(),
    })

    render(
      <MemoryRouter>
        <Navbar onOpenDrawer={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: 'Abrir menú lateral' })).toBeInTheDocument()
  })
})
