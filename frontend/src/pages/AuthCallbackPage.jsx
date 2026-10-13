import { useEffect, useRef } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CircleCheckBig, TriangleAlert } from 'lucide-react'
import { useAuth } from '../hooks/useAuth.js'

const REASON_MESSAGES = {
  state_invalid: 'La sesión de autenticación expiró o no es válida. Intenta iniciar sesión nuevamente.',
  google_error: 'No se pudo completar la autenticación con Google. Intenta nuevamente.',
  missing_params: 'La respuesta de autenticación está incompleta. Intenta iniciar sesión nuevamente.',
  token_exchange: 'No pudimos verificar tu identidad con Google. Intenta nuevamente.',
  profile_failed: 'No pudimos obtener tu perfil de Google. Intenta nuevamente.',
  account_creation_failed: 'No se pudo crear tu cuenta. Contacta a soporte si el problema persiste.',
  account_blocked: 'Tu cuenta no está activa en este momento. Contacta a soporte municipal.',
}

/**
 * Cierre del flujo OAuth: el backend redirige aqui con ?status=success|error
 * (&reason=...). Refresca la sesion y redirige al inicio; en error muestra
 * un mensaje accionable derivado directamente de la URL.
 */
export function AuthCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const handled = useRef(false)

  const status = searchParams.get('status')
  const reason = searchParams.get('reason')
  const errorReason = status === 'success' ? null : (reason ?? 'unknown')

  useEffect(() => {
    if (status !== 'success' || handled.current) return
    handled.current = true
    void refresh().then(() => navigate('/', { replace: true }))
  }, [status, navigate, refresh])

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      {errorReason ? (
        <>
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-state-danger/10 text-state-danger">
            <TriangleAlert size={28} aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-2xl font-bold text-ink">No pudimos iniciar tu sesión</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            {REASON_MESSAGES[errorReason] ??
              'Ocurrió un problema inesperado durante la autenticación. Intenta nuevamente.'}
          </p>
          <Link
            to="/"
            className="mt-8 inline-flex rounded-lg bg-marine-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-marine-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-950"
          >
            Volver al inicio
          </Link>
        </>
      ) : (
        <>
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-state-success/10 text-state-success">
            <CircleCheckBig size={28} aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-2xl font-bold text-ink">Iniciando sesión…</h1>
          <p className="mt-3 text-sm text-ink-soft">Estamos verificando tu identidad.</p>
        </>
      )}
    </div>
  )
}
