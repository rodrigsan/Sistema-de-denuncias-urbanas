import { useEffect } from 'react'
import { NavLink } from 'react-router-dom'
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

const BASE_LINK_CLASSES =
  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-700'
const ACTIVE_LINK_CLASSES = 'bg-marine-950 text-white hover:bg-marine-950'

/**
 * Menu lateral (Sidebar Drawer).
 *
 * Solo es accesible para usuarios autenticados: el toggle (hamburguesa) del
 * Navbar se renderiza unicamente cuando hay sesion activa.
 *
 * - Encabezado con informacion del usuario: alias, avatar de iniciales y
 *   codigo administrativo (perfil ciudadano).
 * - Enlaces principales y secciones administrativas segun el rol
 *   (MODERATOR / TECHNICAL_LIAISON).
 * - Pie con soporte y cierre de sesion: "Cerrar sesion" se muestra
 *   unicamente para el usuario autenticado (la rama con el boton de Google
 *   queda como resguardo defensivo si el estado cambiara con el menu abierto).
 * - Cierre al hacer clic en el overlay o presionar ESC; bloquea el scroll
 *   del fondo mientras esta abierto.
 */
export function SidebarDrawer({ open, onClose }) {
  const { user, profile, loading, loginWithGoogle, logout } = useAuth()

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

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
              <NavLink to="/denuncias/nueva" className={({ isActive }) => `${BASE_LINK_CLASSES} ${isActive ? ACTIVE_LINK_CLASSES : ''}`} onClick={onClose}>
                <FilePlus2 size={18} aria-hidden="true" />
                Crear denuncia
              </NavLink>
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
                onClose()
                void logout()
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
    </>
  )
}
