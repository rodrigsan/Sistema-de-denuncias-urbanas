/**
 * Franja institucional superior: identidad municipal y referencia nacional
 * con un detalle tricolor (bandera de Bolivia en CSS puro).
 */
export function TopBar() {
  return (
    <div className="bg-marine-950 text-slate-200">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-1.5 text-[11px] sm:text-xs">
        <p className="truncate">
          Gobierno Autónomo Municipal de Cercado — Cochabamba · Estado Plurinacional de Bolivia
        </p>
        <span
          aria-hidden="true"
          className="hidden h-3 w-6 shrink-0 overflow-hidden rounded-[2px] ring-1 ring-white/30 sm:flex sm:flex-col"
        >
          <span className="h-1/3 w-full bg-state-success" />
          <span className="h-1/3 w-full bg-state-caution" />
          <span className="h-1/3 w-full bg-state-danger" />
        </span>
      </div>
    </div>
  )
}
