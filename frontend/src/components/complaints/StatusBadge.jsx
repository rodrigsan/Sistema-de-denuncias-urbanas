import { statusMeta } from '../../lib/constants.js'

const TONE_CLASSES = {
  caution: 'bg-state-caution/10 text-state-caution ring-state-caution/30',
  warning: 'bg-state-warning/10 text-state-warning ring-state-warning/30',
  success: 'bg-state-success/10 text-state-success ring-state-success/30',
  danger: 'bg-state-danger/10 text-state-danger ring-state-danger/30',
}

/**
 * Badge de estado con la semantica institucional: ambar (pendiente), naranja
 * (en proceso), verde (resuelta), rojo (rechazada).
 */
export function StatusBadge({ status }) {
  const meta = statusMeta(status)
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ring-1 ${TONE_CLASSES[meta.tone]}`}
    >
      {meta.label}
    </span>
  )
}
