import { MunicipalEmblem } from '../brand/MunicipalEmblem.jsx'

// Fuera del render: la fecha no es una funcion pura y no debe evaluarse
// en cada renderizado.
const CURRENT_YEAR = new Date().getFullYear()

/**
 * Pie institucional: informacion del municipio, contacto y avisos de
 * privacidad. Los enlaces legales son anclas por ahora (documentos pendientes).
 */
export function Footer() {
  const year = CURRENT_YEAR

  return (
    <footer className="mt-16 bg-marine-950 text-slate-300">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <div className="flex items-center gap-3">
            <MunicipalEmblem size={36} />
            <div className="leading-tight">
              <p className="text-sm font-bold text-white">Denuncias Cercado</p>
              <p className="text-[11px] text-slate-400">Municipio de Cercado · Cochabamba</p>
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-slate-400">
            Plataforma ciudadana para reportar problemas urbanos de competencia municipal y
            realizar su seguimiento de principio a fin.
          </p>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-white">Plataforma</h3>
          <ul className="mt-3 space-y-2 text-xs">
            <li><a className="transition-colors hover:text-white" href="/#que-denunciar">Qué denunciar</a></li>
            <li><a className="transition-colors hover:text-white" href="/#como-funciona">Cómo funciona</a></li>
            <li><a className="transition-colors hover:text-white" href="/#inicio">Crear una denuncia</a></li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-white">Contacto municipal</h3>
          <ul className="mt-3 space-y-2 text-xs text-slate-400">
            <li>Atención al ciudadano: (591) 4-000-0000</li>
            <li>Correo: contacto@cercado.gob.bo</li>
            <li>Cochabamba, Bolivia</li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-white">Legal</h3>
          <ul className="mt-3 space-y-2 text-xs">
            <li><a className="transition-colors hover:text-white" href="#">Aviso de privacidad</a></li>
            <li><a className="transition-colors hover:text-white" href="#">Términos de uso</a></li>
            <li><a className="transition-colors hover:text-white" href="#">Tratamiento de datos</a></li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-4 text-[11px] text-slate-500 sm:flex-row">
          <p>© {year} Gobierno Autónomo Municipal de Cercado — Cochabamba, Bolivia</p>
          <p>Tus datos de identidad están separados del contenido de tus denuncias.</p>
        </div>
      </div>
    </footer>
  )
}
