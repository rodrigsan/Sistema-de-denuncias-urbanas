import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import {
  RequireSession,
  RequireCitizen,
  RequireModerator,
  RequireLiaison,
} from '../components/routing/RouteGuards.jsx'

// Mock del hook useAuth: cada test controla el estado de sesion.
vi.mock('../hooks/useAuth.js', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '../hooks/useAuth.js'

function renderWithRouter(initialRoute, children) {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/" element={<div data-testid="home">Home</div>} />
        <Route path="/auth/alias" element={<div data-testid="alias">Alias</div>} />
        <Route path="/protected" element={children} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireSession', () => {
  beforeEach(() => {
    cleanup()
  })

  it('redirige al inicio sin sesion', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: false })
    renderWithRouter('/protected', <RequireSession><div>Protegido</div></RequireSession>)
    expect(screen.getByTestId('home')).toBeInTheDocument()
    expect(screen.queryByText('Protegido')).not.toBeInTheDocument()
  })

  it('renderiza el contenido con sesion activa', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'u1', userType: 'CITIZEN', roles: [], requiresAlias: false },
      loading: false,
    })
    renderWithRouter('/protected', <RequireSession><div>Protegido</div></RequireSession>)
    expect(screen.getByText('Protegido')).toBeInTheDocument()
  })

  it('muestra loader mientras carga', () => {
    vi.mocked(useAuth).mockReturnValue({ user: null, loading: true })
    renderWithRouter('/protected', <RequireSession><div>Protegido</div></RequireSession>)
    expect(screen.queryByText('Protegido')).not.toBeInTheDocument()
  })
})

describe('RequireCitizen', () => {
  beforeEach(() => {
    cleanup()
  })

  it('redirige al inicio para ADMIN', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'a1', userType: 'ADMIN', roles: ['MODERATOR'], requiresAlias: false },
      loading: false,
    })
    renderWithRouter('/protected', <RequireCitizen><div>Ciudadano</div></RequireCitizen>)
    expect(screen.getByTestId('home')).toBeInTheDocument()
    expect(screen.queryByText('Ciudadano')).not.toBeInTheDocument()
  })

  it('redirige a /auth/alias si requiere alias', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'c1', userType: 'CITIZEN', roles: [], requiresAlias: true },
      loading: false,
    })
    renderWithRouter('/protected', <RequireCitizen><div>Ciudadano</div></RequireCitizen>)
    expect(screen.getByTestId('alias')).toBeInTheDocument()
  })

  it('renderiza para ciudadano con alias', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'c1', userType: 'CITIZEN', roles: [], requiresAlias: false },
      loading: false,
    })
    renderWithRouter('/protected', <RequireCitizen><div>Ciudadano</div></RequireCitizen>)
    expect(screen.getByText('Ciudadano')).toBeInTheDocument()
  })
})

describe('RequireModerator', () => {
  beforeEach(() => {
    cleanup()
  })

  it('redirige al inicio sin el rol MODERATOR', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'c1', userType: 'CITIZEN', roles: [], requiresAlias: false },
      loading: false,
    })
    renderWithRouter('/protected', <RequireModerator><div>Moderador</div></RequireModerator>)
    expect(screen.getByTestId('home')).toBeInTheDocument()
    expect(screen.queryByText('Moderador')).not.toBeInTheDocument()
  })

  it('redirige al inicio con solo rol TECHNICAL_LIAISON', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 't1', userType: 'ADMIN', roles: ['TECHNICAL_LIAISON'], requiresAlias: false },
      loading: false,
    })
    renderWithRouter('/protected', <RequireModerator><div>Moderador</div></RequireModerator>)
    expect(screen.getByTestId('home')).toBeInTheDocument()
  })

  it('renderiza el contenido con el rol MODERATOR', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'm1', userType: 'ADMIN', roles: ['MODERATOR'], requiresAlias: false },
      loading: false,
    })
    renderWithRouter('/protected', <RequireModerator><div>Moderador</div></RequireModerator>)
    expect(screen.getByText('Moderador')).toBeInTheDocument()
  })
})

describe('RequireLiaison', () => {
  beforeEach(() => {
    cleanup()
  })

  it('redirige al inicio sin el rol TECHNICAL_LIAISON', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'm1', userType: 'ADMIN', roles: ['MODERATOR'], requiresAlias: false },
      loading: false,
    })
    renderWithRouter('/protected', <RequireLiaison><div>Enlace</div></RequireLiaison>)
    expect(screen.getByTestId('home')).toBeInTheDocument()
    expect(screen.queryByText('Enlace')).not.toBeInTheDocument()
  })

  it('renderiza el contenido con el rol TECHNICAL_LIAISON', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 't1', userType: 'ADMIN', roles: ['TECHNICAL_LIAISON'], requiresAlias: false },
      loading: false,
    })
    renderWithRouter('/protected', <RequireLiaison><div>Enlace</div></RequireLiaison>)
    expect(screen.getByText('Enlace')).toBeInTheDocument()
  })

  it('renderiza con ambos roles (MODERATOR + TECHNICAL_LIAISON)', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: 'mt1',
        userType: 'ADMIN',
        roles: ['MODERATOR', 'TECHNICAL_LIAISON'],
        requiresAlias: false,
      },
      loading: false,
    })
    renderWithRouter('/protected', <RequireLiaison><div>Enlace</div></RequireLiaison>)
    expect(screen.getByText('Enlace')).toBeInTheDocument()
  })
})
