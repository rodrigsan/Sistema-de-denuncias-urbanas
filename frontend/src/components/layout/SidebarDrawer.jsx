import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  ClipboardList,
  FilePlus2,
  Home,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  ShieldCheck,
  Wrench,
  X,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth.js'
import { GoogleIcon } from '../brand/GoogleIcon.jsx'
import { CreateComplaintAction } from '../complaints/CreateComplaintAction.jsx'

const BASE_LINK_CLASSES =
  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-700'
const ACTIVE_LINK_CLASSES = 'bg-marine-950 text-white hover:bg-marine-950'

/**
 * Estados de verificación de restricciones para el sidebar.
 * - loading: consultas pendientes. Bloquear preventivamente.
 * - error: alguna consulta falló. Bloquear y mostrar reintento.
 * - grace: existe al menos una denuncia en GRACE_PERIOD. Bloquear creación.
 * - cooldown: no hay gracia, pero hay cooldown activo. Bloquear creación.
 * - inactive: no hay restricciones activas. Permitir creación (sujeto a cooldown).
 */
const VERIFICATION_STATUS = {
  LOADING: 'loading',
  ERROR: 'error',
  GRACE: 'grace',
  COOLDOWN: 'cooldown',
  INACTIVE: 'inactive',
}

export function SidebarDrawer({ open, onClose }) {
  const { user, profile, loading, loginWithGoogle, logout } = useAuth()
  const navigate = useNavigate()
  const [logoutConfirmationOpen, setLogoutConfirmationOpen] = useState(false)
  const [logoutPending, setLogoutPending] = useState(false)
  const [logoutError, setLogoutError] = useState(null)
  const [verificationStatus, setVerificationStatus] = useState(VERIFICATION_STATUS.LOADING)
  const [hasActiveGrace, setHasActiveGrace] = useState(null) // null hasta que terminen las consultas
  const [cooldownData, setCooldownData] = useState(null)

  // AbortController para prevenir actualizaciones de estado obsoleto
  const abortControllerRef = { current: null }

  useEffect(() => {
    // Crear controlador de abortado al montar
    abortControllerRef.current = new AbortController()
    return () => {
      // Limpiar al desmontar componente o cerrar drawer
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (logoutConfirmationOpen) {
          setLogoutConfirmationOpen(false)
          setLogoutError(null)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
      // Abortar cualquier consulta pendiente al cerrar el drawer
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
        abortControllerRef.current = null
      }
    }
  }, [open, onClose])

  // Consultar estado del cooldown y gracia al montar el drawer
  useEffect(() => {
    if (!open) return undefined
    // Abortar cualquier consulta anterior
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    abortControllerRef.current = new AbortController()

    void (async () => {
      try {
        // Consultar cooldown status
        const cooldownResponse = await apiFetch('/auth/cooldown-status', {
          credentials: 'include',
          signal: abortControllerRef.current.signal,
        })
        setCooldownData(cooldownResponse.ok ? cooldownResponse.data : null)

        // Consultar lista de denuncias para detectar período de gracia activo
        const complaintsResponse = await apiFetch('/citizens/complaints', {
          credentials: 'include',
          signal: abortControllerRef.current.signal,
        })
        if (complaintsResponse.ok && complaintsResponse.data) {
          setHasActiveGrace(complaintsResponse.data.complaints.some((c) => c.status === 'GRACE_PERIOD'))
        } else {
          setHasActiveGrace(false)
        }

        // Determinar estado final basado en ambas respuestas
        if (setVerificationStatus) {
          if (hasActiveGrace) {
            setVerificationStatus(VERIFICATION_STATUS.GRACE)
          } else if (cooldownData?.inCooldown === true) {
            setVerificationStatus(VERIFICATION_STATUS.COOLDOWN)
          } else {
            setVerificationStatus(VERIFICATION_STATUS.INACTIVE)
          }
        }
      } catch (error) {
        // Error en la consulta: conservar bloqueo preventivo
        // No establecer hasActiveGrace = false ni inCooldown = null aquí,
        // para mantener el bloqueo mientras el usuario intenta recuperar
        if (setVerificationStatus) {
          setVerificationStatus(VERIFICATION_STATUS.ERROR)
        }
      } finally {
        // No limpiar cooldownData aquí para que el usuario vea el estado persisted
      }
    })()
  }, [open])

  const confirmLogout = async () => {
    setLogoutPending(true)
    setLogoutError(null)
    try {
      await logout()
      setLogoutConfirmationOpen(false)
      onClose()
      navigate('/', { replace: true })
    } catch (error) {
      setLogoutError(
        error instanceof Error ? error.message : 'No se pudo cerrar sesión. Intenta nuevamente.',
      )
    } finally {
      setLogoutPending(false)
    }
  }

  const alias = user?.alias ?? profile?.alias
  const initials =
    (alias ?? user?.userType ?? '??')
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'

  const isModerator = Array.isArray(user?.roles) && user.roles.includes('MODERATOR')
  const isLiaison = Array.isArray(user?.roles) && user.roles.includes('TECHNICAL_LIAISON')
  const isAdminUser = user?.userType === 'ADMIN' || isModerator || isLiaison

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden={!open}
        className={`fixed inset-0 z-40 bg-marine-950/60 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Menú lateral"
        aria-hidden={!open}
        className={`fixed top-0 left-0 z-50 flex h-full w-72 max-w-[85vw] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-start justify-between gap-2 bg-marine-950 p-4 text-white">
          {loading ? (
            <div className="h-14 w-full animate-pulse rounded-lg bg-white/10" aria-hidden="true" />
          ) : user ? (
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-marine-700 text-sm font-bold uppercase">
                {initials}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" title={alias ?? 'Ciudadano'}>
                  {alias ?? (user.userType === 'CITIZEN' ? 'Ciudadano sin alias' : 'Cuenta institucional')}
                </p>
                {profile?.administrativeCode ? (
                  <p className="mt-0.5 font-mono text-[11px] tracking-wide text-slate-300">
                    {profile.administrativeCode}
                  </p>
                ) : (
                  <p className="mt-0.5 text-[11px] text-slate-300">
                    {user.userType === 'ADMIN' ? user.roles.join(' · ') : 'Tu identidad permanece privada'}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold">Bienvenido/a</p>
              <p className="mt-0.5 text-[11px] text-slate-300">
                Inicia sesión para gestionar tus denuncias
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            aria-label="Cerrar menú"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Menú" className="flex-1 space-y-1 overflow-y-auto p-3">
          <NavLink to="/" end className={({ isActive }) => `${BASE_LINK_CLASSES} ${isActive ? ACTIVE_LINK_CLASSES : ''}`} onClick={onClose}>
            <Home size={18} aria-hidden="true" />
            Inicio
          </NavLink>

          {!isAdminUser && (
            <>
              <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                Ciudadano
              </p>
              <NavLink to="/mis-denuncias" className={({ isActive }) => `${BASE_LINK_CLASSES} ${isActive ? ACTIVE_LINK_CLASSES : ''}`} onClick={onClose}>
                <ClipboardList size={18} aria-hidden="true" />
                Mis denuncias
              </NavLink>
              <CreateComplaintAction
                verificationStatus={verificationStatus}
                hasActiveGrace={hasActiveGrace}
                cooldownData={cooldownData}
                onAllowed={() => {
                  onClose()
                  navigate('/denuncias/nueva')
                }}
                className={`${BASE_LINK_CLASSES} w-full`}
              >
                <FilePlus2 size={18} aria-hidden="true" />
                Crear denuncia
              </CreateComplaintAction>
            </>
          )}

          {(isModerator || isLiaison) && (
            <>
              <p className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                Gestión municipal
              </p>
              {isModerator && (
                <NavLink to="/moderacion" className={({ isActive }) => `${BASE_LINK_CLASSES} ${isActive ? ACTIVE_LINK_CLASSES : ''}`} onClick={onClose}>
                  <LayoutDashboard size={18} aria-hidden="true" />
                  Bandeja de moderación
                </NavLink>
              )}
              {isLiaison && (
                <NavLink to="/tecnico" className={({ isActive }) => `${BASE_LINK_CLASSES} ${isActive ? ACTIVE_LINK_CLASSES : ''}`} onClick={onClose}>
                  <Wrench size={18} aria-hidden="true" />
                  Atención técnica
                </NavLink>
              )}
            </>
          )}
        </nav>

        <div className="space-y-2 border-t border-slate-200 p-3">
          <a
            href="mailto:soporte.denuncias@cercado.gob.bo"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium text-ink-soft transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-700"
          >
            <LifeBuoy size={16} aria-hidden="true" />
            Soporte y ayuda
          </a>

          {loading ? (
            <span className="block h-9 w-full animate-pulse rounded-lg bg-slate-200" aria-hidden="true" />
          ) : user ? (
            <button
              type="button"
              onClick={() => {
                setLogoutError(null)
                setLogoutConfirmationOpen(true)
              }}
              className="flex w-full items-center gap-3 rounded-lg bg-state-danger/10 px-3 py-2.5 text-sm font-semibold text-state-danger transition-colors hover:bg-state-danger/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-state-danger"
            >
              <LogOut size={18} aria-hidden="true" />
              Cerrar sesión
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void loginWithGoogle()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-marine-700 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-marine-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-950"
            >
              <GoogleIcon size={16} />
              Continuar con Google
            </button>
          )}

          <p className="flex items-center gap-2 px-3 text-[10px] text-ink-soft">
            <ShieldCheck size={12} aria-hidden="true" />
            Tus datos de identidad permanecen privados
          </p>
        </div>
      </aside>

      {logoutConfirmationOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-marine-950/60 p-4">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="logout-confirmation-title"
            aria-describedby="logout-confirmation-description"
            className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl"
          >
            <h2 id="logout-confirmation-title" className="text-xl font-bold text-ink">
              ¿Cerrar sesión?
            </h2>
            <p id="logout-confirmation-description" className="mt-3 text-sm text-ink-soft">
              ¿Estás seguro de que deseas cerrar sesión?
            </p>
            {logoutError && (
              <p role="alert" className="mt-3 text-sm font-medium text-state-danger">
                {logoutError}
              </p>
            )}
            <div className="mt-5 flex justify-center gap-3">
              <button
                type="button"
                autoFocus
                disabled={logoutPending}
                onClick={() => {
                  setLogoutConfirmationOpen(false)
                  setLogoutError(null)
                }}
                className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={logoutPending}
                onClick={() => void confirmLogout()}
                className="rounded-lg bg-state-danger px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-state-danger disabled:cursor-wait disabled:opacity-60"
              >
                {logoutPending ? 'Cerrando sesión…' : 'Sí, cerrar sesión'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}