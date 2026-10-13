import { Link } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { MunicipalEmblem } from '../brand/MunicipalEmblem.jsx'
import { GoogleIcon } from '../brand/GoogleIcon.jsx'
import { useAuth } from '../../hooks/useAuth.js'

const NAV_LINKS = [
  { label: 'Inicio', href: '/#inicio' },
  { label: 'Qué denunciar', href: '/#que-denunciar' },
  { label: 'Cómo funciona', href: '/#como-funciona' },
]

/**
 * Barra de navegacion principal. Visibilidad por estado de sesion:
 *
 * - SIN sesion (user === null): logo/nombre, enlaces ancla y unicamente el
 *   boton "Continuar con Google" en la esquina superior derecha.
 * - CON sesion (user !== null): el boton de Google desaparece; la esquina
 *   superior derecha muestra el chip del usuario (iniciales/alias) junto al
 *   toggle del menu lateral (hamburguesa), unico punto de apertura del
 *   SidebarDrawer. El cierre de sesion vive exclusivamente en el pie del
 *   menu lateral.
 */
export function Navbar({ onOpenDrawer }) {
  const { user, loading, loginWithGoogle } = useAuth()

  const alias = user?.alias ?? user?.profile?.alias

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4">
        <Link
          to="/"
          className="flex items-center gap-2.5"
          aria-label="Denuncias Cercado - Inicio"
        >
          <MunicipalEmblem size={36} />
          <span className="hidden flex-col leading-tight min-[420px]:flex">
            <span className="text-sm font-bold text-marine-950">Denuncias Cercado</span>
            <span className="text-[11px] text-ink-soft">Municipio de Cercado · Cochabamba</span>
          </span>
        </Link>

        <nav aria-label="Navegación principal" className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-ink-soft transition-colors hover:text-marine-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-700"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {loading ? (
            <span
              className="h-9 w-28 animate-pulse rounded-lg bg-slate-200"
              aria-hidden="true"
            />
          ) : user ? (
            <>
              <span
                className="hidden max-w-32 truncate items-center gap-2 rounded-full bg-marine-950 py-1.5 pl-1.5 pr-4 text-xs font-semibold text-white sm:flex"
                title={alias ?? 'Ciudadano'}
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-marine-700 uppercase">
                  {(alias ?? '?').slice(0, 1)}
                </span>
                {alias ?? 'Ciudadano'}
              </span>
              <button
                type="button"
                onClick={onOpenDrawer}
                className="inline-flex items-center justify-center rounded-lg p-2 text-ink transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-700"
                aria-label="Abrir menú lateral"
              >
                <Menu size={22} aria-hidden="true" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void loginWithGoogle()}
              className="inline-flex items-center gap-2 rounded-lg bg-marine-700 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-marine-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-950"
            >
              <GoogleIcon size={16} />
              <span>Continuar con Google</span>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
