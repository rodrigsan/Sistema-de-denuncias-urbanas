import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth.js'

export function PageLoader({ label = 'Cargando…' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-24 text-center">
      <Loader2 size={28} className="animate-spin text-marine-700" aria-hidden="true" />
      <p className="text-sm text-ink-soft">{label}</p>
    </div>
  )
}

/**
 * Rutas que exigen sesion iniciada (cualquier tipo de usuario).
 */
export function RequireSession({ children }) {
  const { user, loading } = useAuth()

  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/" replace />
  return children
}

/**
 * Rutas exclusivas de ciudadanos con alias establecido:
 * sin sesion -> inicio; ADMIN o sin alias -> redirigido a su lugar correcto.
 */
export function RequireCitizen({ children }) {
  const { user, loading } = useAuth()

  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/" replace />
  if (user.userType !== 'CITIZEN') return <Navigate to="/" replace />
  if (user.requiresAlias) return <Navigate to="/auth/alias" replace />
  return children
}

/** Rutas exclusivas del rol MODERATOR. */
export function RequireModerator({ children }) {
  const { user, loading } = useAuth()

  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/" replace />
  if (!user.roles?.includes('MODERATOR')) return <Navigate to="/" replace />
  return children
}

/** Rutas exclusivas del rol TECHNICAL_LIAISON. */
export function RequireLiaison({ children }) {
  const { user, loading } = useAuth()

  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/" replace />
  if (!user.roles?.includes('TECHNICAL_LIAISON')) return <Navigate to="/" replace />
  return children
}
