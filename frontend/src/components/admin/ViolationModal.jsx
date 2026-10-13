import { useState } from 'react'
import { Gavel, X } from 'lucide-react'
import { apiFetch, apiErrorMessage } from '../../lib/api.js'

const INPUT_CLASSES =
  'w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-slate-400 focus:border-marine-700 focus:outline-none focus:ring-2 focus:ring-marine-700/20'

/**
 * Modal de sancion del Moderador: registra una infraccion sobre el autor de
 * la denuncia y lo suspende por exactamente 168 horas en una transaccion
 * atomica (POST /moderation/violations).
 */
export function ViolationModal({ complaint, onClose, onDone }) {
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  if (!complaint) return null

  const handleSubmit = async () => {
    if (description.trim().length < 5 || submitting) return
    setSubmitting(true)
    setError(null)

    const response = await apiFetch('/moderation/violations', {
      method: 'POST',
      body: JSON.stringify({
        complaintId: complaint.id,
        description: description.trim(),
      }),
    })
    setSubmitting(false)

    if (response.status === 201) {
      onDone(complaint.id, 'SUSPENDED')
      onClose()
      return
    }
    setError(apiErrorMessage(response.data))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-marine-950/70" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Aplicar sanción al ciudadano"
        className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-ink">
            <Gavel size={18} className="text-state-danger" aria-hidden="true" />
            Sanción: suspensión de 168 horas
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-ink-soft hover:bg-slate-100"
            aria-label="Cerrar"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <p className="rounded-lg bg-state-danger/10 px-3 py-2 text-xs leading-relaxed text-state-danger ring-1 ring-state-danger/30">
            Se aplicará al autor de la denuncia <strong className="font-mono">{complaint.publicCode}</strong>{' '}
            ({complaint.citizenAlias ?? '—'}). El ciudadano quedará suspendido por 168 horas y no
            podrá crear ni gestionar denuncias durante ese período.
          </p>

          <div>
            <label htmlFor="violation-desc" className="mb-1.5 block text-sm font-semibold text-ink">
              Descripción de la infracción <span className="text-state-danger">*</span>
            </label>
            <textarea
              id="violation-desc"
              rows={3}
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe la infracción cometida (contenido fraudulento, abuso reiterado, etc.)."
              className={INPUT_CLASSES}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-state-danger/10 px-4 py-3 text-sm font-medium text-state-danger ring-1 ring-state-danger/30">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={description.trim().length < 5 || submitting}
              className="flex-1 rounded-lg bg-state-danger px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Aplicando…' : 'Aplicar sanción'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
