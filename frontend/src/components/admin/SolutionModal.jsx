import { useState } from 'react'
import { CheckCircle2, FileVideo, ImageIcon, X } from 'lucide-react'
import { apiFetch, apiErrorMessage, apiUpload } from '../../lib/api.js'
import { EVIDENCE_LIMITS } from '../../lib/constants.js'
import { formatFileSize } from '../../lib/utils.js'
import { validateEvidenceFile } from '../../lib/validation.js'

const INPUT_CLASSES =
  'w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-slate-400 focus:border-marine-700 focus:outline-none focus:ring-2 focus:ring-marine-700/20'

/**
 * Modal del Enlace Tecnico para registrar una solucion:
 * 1. Descripcion obligatoria (10-5000) -> POST /technical/complaints/:id/submit-solution
 * 2. Evidencias de solucion (multipart, hasta 3 fotos y 1 video)
 *    -> POST /technical/solutions/:solutionId/evidence
 */
export function SolutionModal({ complaint, onClose, onDone }) {
  const [step, setStep] = useState('form')
  const [description, setDescription] = useState('')
  const [solutionId, setSolutionId] = useState(null)
  const [files, setFiles] = useState([])
  const [notice, setNotice] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadResults, setUploadResults] = useState([])
  const [error, setError] = useState(null)

  if (!complaint) return null

  const handleSubmit = async () => {
    if (description.trim().length < 10 || submitting) return
    setSubmitting(true)
    setError(null)

    const response = await apiFetch(`/technical/complaints/${complaint.id}/submit-solution`, {
      method: 'POST',
      body: JSON.stringify({ description: description.trim() }),
    })
    setSubmitting(false)

    if (response.status === 201) {
      setSolutionId(response.data.id)
      setStep('evidence')
      return
    }
    setError(apiErrorMessage(response.data))
  }

  const addFiles = async (incoming) => {
    setNotice(null)
    const next = [...files]
    const errors = []

    for (const file of incoming) {
      const counts = { images: next.filter((e) => !e.file.type.startsWith('video/')).length, videos: next.filter((e) => e.file.type.startsWith('video/')).length }
      const result = await validateEvidenceFile(file, counts)
      if (result.error) {
        errors.push(`${file.name}: ${result.error}`)
        continue
      }
      next.push({ id: crypto.randomUUID(), file, durationSeconds: result.durationSeconds })
    }
    if (errors.length > 0) setNotice(errors[0])
    setFiles(next)
  }

  const uploadAll = async () => {
    if (uploading || files.length === 0) return
    setUploading(true)
    setError(null)
    const results = []

    for (const entry of files) {
      const formData = new FormData()
      formData.append('file', entry.file)
      if (entry.durationSeconds) {
        formData.append('duration_seconds', String(Math.max(1, entry.durationSeconds)))
      }
      const response = await apiUpload(`/technical/solutions/${solutionId}/evidence`, formData)
      results.push({ id: entry.id, name: entry.file.name, ok: response.ok, message: response.ok ? 'Subida' : apiErrorMessage(response.data) })
    }

    setUploadResults(results)
    setUploading(false)
  }

  const finish = () => {
    onDone(complaint.id, 'SOLUTION_SUBMITTED')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-marine-950/70" onClick={step === 'form' ? onClose : undefined} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Registrar solución"
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-ink">
            <CheckCircle2 size={18} className="text-state-success" aria-hidden="true" />
            {step === 'form' ? 'Registrar solución' : 'Evidencias de la solución'}
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
          {step === 'form' && (
            <>
              <p className="text-xs text-ink-soft">
                Denuncia <span className="font-mono font-semibold">{complaint.publicCode}</span>
                {' · '}
                {complaint.title}
              </p>

              <div>
                <label htmlFor="solution-desc" className="mb-1.5 block text-sm font-semibold text-ink">
                  Descripción del trabajo realizado <span className="text-state-danger">*</span>
                </label>
                <textarea
                  id="solution-desc"
                  rows={4}
                  value={description}
                  maxLength={5000}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Describe la reparación, mantenimiento o gestión realizada (mín. 10 caracteres)."
                  className={INPUT_CLASSES}
                />
                <p className="mt-1 text-right text-[11px] text-ink-soft">{description.length}/5000</p>
              </div>

              {error && (
                <p role="alert" className="rounded-lg bg-state-danger/10 px-4 py-3 text-sm font-medium text-state-danger ring-1 ring-state-danger/30">
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={description.trim().length < 10 || submitting}
                className="w-full rounded-lg bg-state-success px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Registrando…' : 'Registrar solución y continuar con evidencias'}
              </button>
            </>
          )}

          {step === 'evidence' && (
            <>
              <p className="text-xs text-ink-soft">
                Solución registrada. Adjunta evidencias del trabajo realizado (opcional pero
                recomendado). Máximo {EVIDENCE_LIMITS.maxImages} fotos y 1 video.
              </p>

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  void addFiles([...e.dataTransfer.files])
                }}
                className="rounded-xl border-2 border-dashed border-slate-300 bg-surface px-4 py-6 text-center transition-colors hover:border-marine-700"
              >
                <p className="text-sm text-ink">
                  Arrastra archivos o{' '}
                  <label className="cursor-pointer font-semibold text-marine-700 underline underline-offset-2">
                    selecciónalos
                    <input
                      type="file"
                      multiple
                      accept={[...EVIDENCE_LIMITS.imageTypes, ...EVIDENCE_LIMITS.videoTypes].join(',')}
                      className="sr-only"
                      onChange={(e) => {
                        void addFiles([...e.target.files])
                        e.target.value = ''
                      }}
                    />
                  </label>
                </p>
                <p className="mt-1 text-[11px] text-ink-soft">
                  JPG, PNG, HEIC ≤ {EVIDENCE_LIMITS.maxImageMb} MB · MP4, MOV ≤{' '}
                  {EVIDENCE_LIMITS.maxVideoMb} MB y {EVIDENCE_LIMITS.maxVideoSeconds} s
                </p>
              </div>

              {notice && (
                <p role="alert" className="rounded-lg bg-state-danger/10 px-3 py-2 text-xs font-medium text-state-danger">
                  {notice}
                </p>
              )}

              {files.length > 0 && (
                <ul className="space-y-2">
                  {files.map((entry) => (
                    <li key={entry.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded bg-marine-950 text-white">
                        {entry.file.type.startsWith('video/') ? <FileVideo size={14} aria-hidden="true" /> : <ImageIcon size={14} aria-hidden="true" />}
                      </span>
                      <span className="flex-1 truncate">{entry.file.name}</span>
                      <span className="text-ink-soft">{formatFileSize(entry.file.size)}</span>
                      <button
                        type="button"
                        onClick={() => setFiles((c) => c.filter((e) => e.id !== entry.id))}
                        className="text-state-danger hover:underline"
                      >
                        Quitar
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {uploadResults.length > 0 && (
                <ul className="space-y-1">
                  {uploadResults.map((r) => (
                    <li key={r.id} className={`text-xs ${r.ok ? 'text-state-success' : 'text-state-danger'}`}>
                      {r.ok ? '✓' : '✗'} {r.name}: {r.message}
                    </li>
                  ))}
                </ul>
              )}

              {error && (
                <p role="alert" className="rounded-lg bg-state-danger/10 px-4 py-3 text-sm font-medium text-state-danger ring-1 ring-state-danger/30">
                  {error}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => void uploadAll()}
                  disabled={uploading || files.length === 0}
                  className="flex-1 rounded-lg bg-marine-700 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-marine-600 disabled:opacity-50"
                >
                  {uploading ? 'Subiendo…' : `Subir ${files.length} archivo(s)`}
                </button>
                <button
                  type="button"
                  onClick={finish}
                  className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-ink-soft transition-colors hover:bg-slate-100"
                >
                  {uploadResults.length > 0 ? 'Finalizar' : 'Sin evidencias'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
