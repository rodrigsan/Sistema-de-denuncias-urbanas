import { useState } from 'react'
import { Copy, FilePlus2, X } from 'lucide-react'
import { apiFetch, apiErrorMessage } from '../../lib/api.js'
import { formatDateTime } from '../../lib/utils.js'

/**
 * Modulo de candidatos a duplicados del Moderador:
 * - Consulta denuncias cercanas (misma subcategoria + radio PostGIS).
 * - Permite proponer un duplicado y resolverlo (CONFIRMED_GROUP con titulo,
 *   NOT_DUPLICATE, DISMISSED).
 * - Permite crear un grupo ad-hoc con la denuncia actual y una candidata.
 */
export function DuplicateCandidates({ complaint, onClose, onDone }) {
  const [candidates, setCandidates] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [proposals, setProposals] = useState({})
  const [groupTitle, setGroupTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!complaint) return null

  const loadCandidates = async () => {
    setLoading(true)
    setError(null)
    const response = await apiFetch(`/moderation/complaints/${complaint.id}/duplicate-candidates`)
    setLoading(false)
    if (response.ok) {
      setCandidates(response.data.candidates)
    } else {
      setError(apiErrorMessage(response.data))
    }
  }

  const propose = async (candidateId) => {
    setSubmitting(true)
    setError(null)
    const response = await apiFetch(`/moderation/complaints/${complaint.id}/duplicate-proposals`, {
      method: 'POST',
      body: JSON.stringify({ candidateComplaintId: candidateId }),
    })
    setSubmitting(false)
    if (response.status === 201) {
      setProposals((current) => ({ ...current, [candidateId]: response.data }))
    } else {
      setError(apiErrorMessage(response.data))
    }
  }

  const resolveProposal = async (proposalId, decision, title) => {
    setSubmitting(true)
    setError(null)
    const response = await apiFetch(`/moderation/duplicate-proposals/${proposalId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ decision, ...(title ? { title } : {}) }),
    })
    setSubmitting(false)
    if (response.ok) {
      onDone(complaint.id, 'GROUPED')
      onClose()
      return
    }
    setError(apiErrorMessage(response.data))
  }

  const createGroup = async (candidateId) => {
    if (groupTitle.trim().length < 3 || submitting) return
    setSubmitting(true)
    setError(null)
    const response = await apiFetch('/moderation/groups', {
      method: 'POST',
      body: JSON.stringify({
        title: groupTitle.trim(),
        complaintIds: [complaint.id, candidateId],
      }),
    })
    setSubmitting(false)
    if (response.status === 201) {
      onDone(complaint.id, 'GROUPED')
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
        aria-label="Candidatos a duplicado"
        className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-ink">
            <Copy size={18} className="text-marine-700" aria-hidden="true" />
            Duplicados de {complaint.publicCode}
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
          {candidates === null && !loading && (
            <div className="text-center">
              <p className="text-sm text-ink-soft">
                Busca denuncias cercanas (misma subcategoría, radio de 100 m) que podrían
                referirse al mismo problema.
              </p>
              <button
                type="button"
                onClick={() => void loadCandidates()}
                className="mt-4 rounded-lg bg-marine-700 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-marine-600"
              >
                Buscar candidatas
              </button>
            </div>
          )}

          {loading && (
            <p className="text-center text-sm text-ink-soft">Buscando…</p>
          )}

          {candidates?.length === 0 && (
            <p className="text-center text-sm text-ink-soft">
              No se encontraron denuncias cercanas con la misma subcategoría.
            </p>
          )}

          {candidates?.length > 0 && (
            <>
              <div className="space-y-3">
                {candidates.map((candidate) => {
                  const proposal = proposals[candidate.id]
                  return (
                    <article
                      key={candidate.id}
                      className="rounded-xl border border-slate-200 bg-surface p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-[10px] font-bold tracking-wider text-ink-soft">
                            {candidate.publicCode}
                          </p>
                          <p className="mt-0.5 text-sm font-semibold text-ink">{candidate.title}</p>
                          <p className="text-[11px] text-ink-soft">
                            {candidate.subcategory?.name} · {candidate.citizenAlias} ·{' '}
                            {formatDateTime(candidate.createdAt)}
                          </p>
                          <p className="mt-1 text-xs font-semibold text-marine-700">
                            Distancia: ~{candidate.distanceMeters} m
                          </p>
                        </div>
                      </div>

                      {proposal ? (
                        <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                          <p className="text-[11px] font-semibold text-state-caution">
                            Propuesta creada ({proposal.status})
                          </p>
                          {proposal.status === 'PENDING' && (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => setGroupTitle(`Duplicado: ${complaint.title}`)}
                                disabled={submitting}
                                className="text-[11px] font-semibold text-marine-700 underline underline-offset-2"
                              >
                                Usar título para grupo
                              </button>
                              <input
                                type="text"
                                value={groupTitle}
                                onChange={(e) => setGroupTitle(e.target.value)}
                                placeholder="Título del grupo (mín. 3)"
                                className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                                maxLength={180}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  void resolveProposal(proposal.id, 'CONFIRMED_GROUP', groupTitle)
                                }
                                disabled={groupTitle.trim().length < 3 || submitting}
                                className="rounded-lg bg-state-success px-3 py-1.5 text-[11px] font-bold text-white hover:bg-green-700 disabled:opacity-50"
                              >
                                Confirmar grupo
                              </button>
                              <button
                                type="button"
                                onClick={() => void resolveProposal(proposal.id, 'NOT_DUPLICATE')}
                                disabled={submitting}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-semibold text-ink-soft hover:bg-slate-100"
                              >
                                No es duplicado
                              </button>
                              <button
                                type="button"
                                onClick={() => void resolveProposal(proposal.id, 'DISMISSED')}
                                disabled={submitting}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-semibold text-ink-soft hover:bg-slate-100"
                              >
                                Descartar
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void propose(candidate.id)}
                          disabled={submitting}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-marine-700 px-3 py-1.5 text-[11px] font-semibold text-marine-700 transition-colors hover:bg-marine-700/10"
                        >
                          <FilePlus2 size={12} aria-hidden="true" />
                          Proponer duplicado
                        </button>
                      )}
                    </article>
                  )
                })}
              </div>

              <div className="border-t border-slate-200 pt-4">
                <p className="text-xs font-semibold text-ink-soft">
                  Agrupación directa (sin propuesta previa)
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={groupTitle}
                    onChange={(e) => setGroupTitle(e.target.value)}
                    placeholder="Título del grupo (mín. 3)"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs"
                    maxLength={180}
                  />
                  {candidates.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => void createGroup(candidate.id)}
                      disabled={groupTitle.trim().length < 3 || submitting}
                      className="rounded-lg bg-marine-950 px-3 py-2 text-[10px] font-semibold text-white hover:bg-marine-800 disabled:opacity-50"
                    >
                      Agrupar con {candidate.publicCode}
                    </button>
                  ))}
                </div>
              </div>
            </>
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
