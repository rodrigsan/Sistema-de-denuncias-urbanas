import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, CircleAlert, FileVideo, ImageIcon, Loader2, Trash2 } from 'lucide-react'
import { apiErrorMessage, apiFetch, apiUpload } from '../../lib/api.js'
import { formatFileSize } from '../../lib/utils.js'
import { extensionFor } from '../../lib/validation.js'

/**
 * Panel de evidencias de la denuncia (vista de detalle).
 *
 * - Lista las evidencias registradas (metadatos del backend; los archivos
 *   originales nunca se descargan ni se exponen desde esta vista).
 * - Sube en secuencia la cola pendiente (los adjuntos del alta llegan via
 *   navigation state; los agregados durante la gracia, via el recolector)
 *   contra POST /api/v1/complaints/:id/evidence, enviando duration_seconds
 *   en los videos.
 * - onConsumed(id) elimina de la cola un archivo subido; onUploaded()
 *   refresca la denuncia para actualizar la lista de evidencias.
 */
export function EvidenceUploadPanel({ complaintId, evidence, pending, onConsumed, onUploaded, canDelete = false }) {
  const [statuses, setStatuses] = useState({})
  const processedRef = useRef(new Set())
  const [runningId, setRunningId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [deleteError, setDeleteError] = useState(null)

  useEffect(() => {
    const anyRunning = runningId !== null
    const next = pending.find(
      (entry) => !processedRef.current.has(entry.id) && !statuses[entry.id],
    )
    if (anyRunning || !next) return undefined

    let cancelled = false
    const upload = async () => {
      // eslint-disable-next-line react/set-state-in-effect -- cola de subidas secuencial
      setRunningId(next.id)
      setStatuses((current) => ({ ...current, [next.id]: { status: 'subiendo' } }))

      const formData = new FormData()
      formData.append('file', next.file, `evidencia.${extensionFor(next.file.type)}`)
      if (next.durationSeconds) {
        formData.append('duration_seconds', String(Math.max(1, next.durationSeconds)))
      }

      const response = await apiUpload(`/complaints/${complaintId}/evidence`, formData)
      if (cancelled) return

      if (response.ok) {
        processedRef.current.add(next.id)
        setStatuses((current) => ({ ...current, [next.id]: { status: 'listo' } }))
        onConsumed?.(next.id)
        onUploaded?.()
      } else {
        setStatuses((current) => ({
          ...current,
          [next.id]: { status: 'error', serverError: apiErrorMessage(response.data) },
        }))
      }
      setRunningId(null)
    }

    void upload()
    return () => {
      cancelled = true
    }
  }, [pending, runningId, statuses, complaintId, onConsumed, onUploaded])

  const retry = (id) => {
    setStatuses((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  const removeEvidence = async (evidenceId) => {
    setDeletingId(evidenceId)
    setDeleteError(null)
    const response = await apiFetch(`/complaints/${complaintId}/evidence/${evidenceId}`, {
      method: 'DELETE',
    })
    setDeletingId(null)
    if (response.status === 204) {
      onUploaded?.()
      return
    }
    setDeleteError(apiErrorMessage(response.data))
  }

  if (evidence.length === 0 && pending.length === 0) return null

  return (
    <section aria-label="Evidencias de la denuncia" className="space-y-3">
      <h3 className="text-sm font-bold text-ink">Evidencias</h3>

      {evidence.length > 0 && (
        <ul className="space-y-2">
          {evidence.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
            >
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-marine-950 text-white">
                {item.mediaType === 'VIDEO' ? (
                  <FileVideo size={18} aria-hidden="true" />
                ) : (
                  <ImageIcon size={18} aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">
                  {item.mediaType === 'VIDEO' ? 'Video' : 'Fotografía'} · {item.mimeType}
                </p>
                <p className="text-[11px] text-ink-soft">{formatFileSize(item.sizeBytes)}</p>
              </div>
              <span className="rounded-full bg-state-caution/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-state-caution ring-1 ring-state-caution/30">
                {item.processingStatus === 'READY' ? 'Lista' : 'En revisión'}
              </span>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => void removeEvidence(item.id)}
                  disabled={deletingId === item.id}
                  className="rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-state-danger/10 hover:text-state-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-state-danger disabled:opacity-50"
                  aria-label={`Eliminar ${item.mediaType === 'VIDEO' ? 'video' : 'fotografía'}`}
                >
                  {deletingId === item.id ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 size={14} aria-hidden="true" />
                  )}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {deleteError && (
        <p role="alert" className="rounded-lg bg-state-danger/10 px-3 py-2 text-xs font-medium text-state-danger ring-1 ring-state-danger/30">
          {deleteError}
        </p>
      )}

      {pending.length > 0 && (
        <ul className="space-y-2" aria-label="Evidencias pendientes de subida">
          {pending.map((entry) => {
            const state = statuses[entry.id]
            return (
              <li
                key={entry.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-surface px-3 py-2"
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-marine-700 text-white">
                  {entry.file.type.startsWith('video/') ? (
                    <FileVideo size={18} aria-hidden="true" />
                  ) : (
                    <ImageIcon size={18} aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{entry.file.name}</p>
                  <p className="text-[11px] text-ink-soft">
                    {formatFileSize(entry.file.size)}
                    {state?.serverError ? ` · ${state.serverError}` : ''}
                  </p>
                </div>
                {state?.status === 'listo' && (
                  <CheckCircle2 size={18} className="text-state-success" aria-label="Subida completada" />
                )}
                {state?.status === 'subiendo' && (
                  <Loader2 size={18} className="animate-spin text-marine-700" aria-label="Subiendo" />
                )}
                {state?.status === 'error' ? (
                  <span className="inline-flex items-center gap-2">
                    <CircleAlert size={18} className="text-state-danger" aria-label="Error de subida" />
                    <button
                      type="button"
                      onClick={() => retry(entry.id)}
                      className="text-xs font-semibold text-marine-700 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-700"
                    >
                      Reintentar
                    </button>
                  </span>
                ) : (
                  !state && <span className="text-[11px] text-ink-soft">En cola</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
