import { useState } from 'react'
import { CircleCheck, TriangleAlert, X } from 'lucide-react'
import { apiFetch, apiErrorMessage } from '../../lib/api.js'
import { StatusBadge } from '../complaints/StatusBadge.jsx'
import { formatDateTime } from '../../lib/utils.js'

const INPUT_CLASSES =
  'w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-slate-400 focus:border-marine-700 focus:outline-none focus:ring-2 focus:ring-marine-700/20'

/**
 * Modal de revision del Moderador (operaciones atomicas):
 *
 * - Aprobacion: seleccion de unidad municipal (sugeridas por assignment_rules
 *   con correccion manual) -> POST /moderation/complaints/:id/approve.
 * - Rechazo: motivo obligatorio -> POST /moderation/complaints/:id/reject.
 *
 * Los errores del backend se muestran con mensajes accionables.
 */
export function ReviewModal({ complaint, onClose, onDone }) {
  const [mode, setMode] = useState('approve')
  const [selectedUnitId, setSelectedUnitId] = useState(
    complaint.suggestedUnits?.[0]?.id ?? '',
  )
  const [rejectionReason, setRejectionReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  if (!complaint) return null

  const handleApprove = async () => {
    if (!selectedUnitId || submitting) return
    setSubmitting(true)
    setError(null)

    const response = await apiFetch(`/moderation/complaints/${complaint.id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ municipalUnitId: selectedUnitId }),
    })
    setSubmitting(false)

    if (response.ok) {
      onDone(complaint.id, 'APPROVED')
      onClose()
      return
    }
    setError(apiErrorMessage(response.data))
  }

  const handleReject = async () => {
    if (rejectionReason.trim().length < 5 || submitting) return
    setSubmitting(true)
    setError(null)

    const response = await apiFetch(`/moderation/complaints/${complaint.id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ rejectionReason: rejectionReason.trim() }),
    })
    setSubmitting(false)

    if (response.ok) {
      onDone(complaint.id, 'REJECTED')
      onClose()
      return
    }
    setError(apiErrorMessage(response.data))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-marine-950/70"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Revisión de ${complaint.publicCode}`}
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex items-center gap-3">
            <StatusBadge status={complaint.status} />
            <span className="font-mono text-[11px] font-bold tracking-wider text-ink-soft">
              {complaint.publicCode}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-ink-soft transition-colors hover:bg-slate-100"
            aria-label="Cerrar"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div>
            <h3 className="text-lg font-bold text-ink">{complaint.title}</h3>
            <p className="mt-0.5 text-xs text-ink-soft">
              {complaint.category?.name} · {complaint.subcategory?.name} ·{' '}
              {formatDateTime(complaint.formalizedAt)}
            </p>
            <p className="mt-0.5 text-xs text-ink-soft">
              Vecino: <strong>{complaint.citizenAlias ?? '—'}</strong>
            </p>
          </div>

          <p className="text-sm leading-relaxed text-ink">{complaint.description}</p>

          {complaint.evidence?.length > 0 && (
            <p className="text-xs text-ink-soft">
              Evidencias adjuntas: {complaint.evidence.length} archivo(s)
            </p>
          )}

          <div className="flex gap-2" role="tablist" aria-label="Acciones de revisión">
            <button
              type="button"
              onClick={() => setMode('approve')}
              role="tab"
              aria-selected={mode === 'approve'}
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-bold transition-colors ${
                mode === 'approve'
                  ? 'bg-state-success text-white'
                  : 'bg-state-success/10 text-state-success hover:bg-state-success/20'
              }`}
            >
              <CircleCheck size={16} className="mr-1.5 inline" aria-hidden="true" />
              Aprobar
            </button>
            <button
              type="button"
              onClick={() => setMode('reject')}
              role="tab"
              aria-selected={mode === 'reject'}
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-bold transition-colors ${
                mode === 'reject'
                  ? 'bg-state-danger text-white'
                  : 'bg-state-danger/10 text-state-danger hover:bg-state-danger/20'
              }`}
            >
              <TriangleAlert size={16} className="mr-1.5 inline" aria-hidden="true" />
              Rechazar
            </button>
          </div>

          {mode === 'approve' && (
            <div className="rounded-xl border border-state-success/30 bg-state-success/5 p-4">
              <label htmlFor="unit-select" className="mb-1.5 block text-sm font-semibold text-ink">
                Unidad municipal responsable <span className="text-state-danger">*</span>
              </label>
              <select
                id="unit-select"
                value={selectedUnitId}
                onChange={(event) => setSelectedUnitId(event.target.value)}
                className={INPUT_CLASSES}
              >
                {complaint.suggestedUnits?.length > 0 ? (
                  complaint.suggestedUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name} (prioridad {unit.priority})
                    </option>
                  ))
                ) : (
                  <option value="">No hay unidades sugeridas</option>
                )}
              </select>
              <p className="mt-1.5 text-[11px] text-ink-soft">
                Las unidades sugeridas provienen de las reglas de asignación; puedes corregir la
                selección si corresponde.
              </p>
              <button
                type="button"
                onClick={() => void handleApprove()}
                disabled={!selectedUnitId || submitting}
                className="mt-3 w-full rounded-lg bg-state-success px-4 py-2.5 text-sm font-bold text-white transition-colors hover:green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Aprobando…' : 'Confirmar aprobación y asignación'}
              </button>
            </div>
          )}

          {mode === 'reject' && (
            <div className="rounded-xl border border-state-danger/30 bg-state-danger/5 p-4">
              <label htmlFor="reject-reason" className="mb-1.5 block text-sm font-semibold text-ink">
                Motivo de rechazo <span className="text-state-danger">*</span>
              </label>
              <textarea
                id="reject-reason"
                rows={3}
                value={rejectionReason}
                maxLength={2000}
                onChange={(event) => setRejectionReason(event.target.value)}
                placeholder="Explica por qué se rechaza esta denuncia (mínimo 5 caracteres)."
                className={INPUT_CLASSES}
              />
              <p className="mt-1 text-[11px] text-ink-soft">
                El motivo será visible para el ciudadano en su bandeja.
              </p>
              <button
                type="button"
                onClick={() => void handleReject()}
                disabled={rejectionReason.trim().length < 5 || submitting}
                className="mt-3 w-full rounded-lg bg-state-danger px-4 py-2.5 text-sm font-bold text-white transition-colors hover:red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Rechazando…' : 'Confirmar rechazo'}
              </button>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-state-danger/10 px-4 py-3 text-sm font-medium text-state-danger ring-1 ring-state-danger/30"
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
