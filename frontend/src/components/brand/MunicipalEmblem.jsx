import { Landmark } from 'lucide-react'

/**
 * Emblema institucional (placeholder hasta contar con el logo oficial del
 * Municipio). Aislar el activo aqui permite reemplazarlo sin tocar layouts.
 */
export function MunicipalEmblem({ size = 40, className = '' }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-marine-950 text-white ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Landmark size={Math.round(size * 0.55)} strokeWidth={1.75} />
    </span>
  )
}
