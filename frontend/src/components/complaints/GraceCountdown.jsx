import { Pencil, Timer } from 'lucide-react'
import { useGraceTimer } from '../../hooks/useGraceTimer.js'
import { GRACE_TOTAL_SECONDS } from '../../lib/constants.js'
import { formatSeconds } from '../../lib/utils.js'

/**
 * Contador en vivo de la ventana de gracia (180 segundos efectivos).
 * Re-montar con key al refrescar la denuncia resincroniza el valor.
 * onExpire debe refrescar la denuncia (el backend formaliza en el siguiente
 * acceso) y la vista pasa a "Denuncia formalizada".
 */
export function GraceCountdown({ grace, onExpire }) {
  const seconds = useGraceTimer({
    remainingSeconds: grace.remainingSeconds,
    state: grace.state,
    onExpire,
  })

  const paused = grace.state === 'PAUSED_FOR_EDIT'
  const danger = !paused && seconds <= 30
  const progress = Math.max(0, Math.min(100, (seconds / GRACE_TOTAL_SECONDS) * 100))

  return (
    <div className="rounded-xl border border-state-caution/40 bg-state-caution/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          {paused ? (
            <>
              <Pencil size={16} className="text-marine-700" aria-hidden="true" />
              Edición en curso — tiempo congelado
            </>
          ) : (
            <>
              <Timer size={16} className="text-state-caution" aria-hidden="true" />
              Tiempo de gracia restante
            </>
          )}
        </p>
        <p
          className={`font-mono text-3xl font-bold tabular-nums ${
            danger ? 'text-state-danger' : 'text-state-caution'
          }`}
          aria-live="polite"
        >
          {formatSeconds(seconds)}
        </p>
      </div>

      <div
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={GRACE_TOTAL_SECONDS}
        aria-valuenow={seconds}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${danger ? 'bg-state-danger' : 'bg-state-caution'}`}
          style={{ width: `${paused ? (seconds / GRACE_TOTAL_SECONDS) * 100 : progress}%` }}
        />
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
        {paused
          ? 'El contador está pausado mientras editas. Se reanudará al guardar o cancelar.'
          : 'Podrás editar o eliminar libremente tu denuncia hasta que el contador llegue a 00:00.'}
      </p>
    </div>
  )
}
