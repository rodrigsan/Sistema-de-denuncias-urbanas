import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, FileText, Play, Wrench } from 'lucide-react'
import { apiFetch } from '../lib/api.js'
import { formatDateTime } from '../lib/utils.js'
import { statusMeta } from '../lib/constants.js'
import { StatusBadge } from '../components/complaints/StatusBadge.jsx'
import { AdminMap } from '../components/admin/AdminMap.jsx'
import { SolutionModal } from '../components/admin/SolutionModal.jsx'

const PAGE_SIZE = 10

/**
 * Bandeja del Enlace Tecnico/Supervisor: denuncias asignadas a sus unidades
 * activas con inicio de atencion, registro de soluciones y evidencias
 * tecnicas. Minimizacion: sin datos del ciudadano.
 */
export function TechnicalPage() {
  const [data, setData] = useState({ complaints: [], pagination: { page: 1, limit: PAGE_SIZE, total: 0 } })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)
  const [actionError, setActionError] = useState(null)

  const load = useCallback(async () => {
    const response = await apiFetch(`/technical/complaints?page=${page}&limit=${PAGE_SIZE}`)
    if (response.ok) {
      setData(response.data)
      setError(null)
    } else {
      setError('No se pudieron cargar las denuncias asignadas.')
    }
    setLoading(false)
  }, [page])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect -- carga de datos
    void load()
  }, [load])

  const totalPages = Math.max(1, Math.ceil(data.pagination.total / PAGE_SIZE))

  const startProcess = async (complaintId) => {
    setActionError(null)
    const response = await apiFetch(`/technical/complaints/${complaintId}/start-process`, {
      method: 'POST',
    })
    if (response.ok) {
      void load()
    } else {
      setActionError(response.data?.error?.message ?? 'No se pudo iniciar la atención.')
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-ink">
          <Wrench size={24} className="text-marine-700" aria-hidden="true" />
          Atención Técnica
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {data.pagination.total} denuncia(s) asignada(s) a tus unidades · FIFO por asignación
        </p>
      </div>

      {actionError && (
        <p role="alert" className="mb-4 rounded-lg bg-state-danger/10 px-4 py-3 text-sm font-medium text-state-danger ring-1 ring-state-danger/30">
          {actionError}
        </p>
      )}

      {loading ? (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl bg-slate-200/70" />
          ))}
        </div>
      ) : error ? (
        <p role="alert" className="rounded-lg bg-state-danger/10 px-4 py-3 text-sm font-medium text-state-danger ring-1 ring-state-danger/30">
          {error}
        </p>
      ) : data.complaints.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-16 text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-marine-950 text-white">
            <Wrench size={26} aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-lg font-bold text-ink">Sin denuncias asignadas</h2>
          <p className="mt-2 max-w-sm text-sm text-ink-soft">
            Cuando el Moderador apruebe y asigne una denuncia a una de tus unidades, aparecerá aquí.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-3">
            <ul className="space-y-3">
              {data.complaints.map((complaint) => (
                <li key={complaint.id}>
                  <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <StatusBadge status={complaint.status} />
                        <span className="font-mono text-[11px] font-bold tracking-wider text-ink-soft">
                          {complaint.publicCode}
                        </span>
                      </div>
                      <span className="text-[11px] text-ink-soft">
                        Asignada: {formatDateTime(complaint.assignedUnit?.assignedAt)}
                      </span>
                    </div>

                    <h3 className="mt-2 text-base font-bold text-ink">{complaint.title}</h3>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {complaint.category?.name} · {complaint.subcategory?.name}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      Unidad: <strong>{complaint.assignedUnit?.name ?? '—'}</strong>
                    </p>

                    <p className="mt-2 line-clamp-2 text-sm text-ink">{complaint.description}</p>

                    {complaint.latestSolution && (
                      <div
                        className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                          complaint.latestSolution.status === 'RETURNED'
                            ? 'bg-state-danger/10 text-state-danger ring-1 ring-state-danger/30'
                            : 'bg-state-caution/10 text-state-caution ring-1 ring-state-caution/30'
                        }`}
                      >
                        <p className="font-semibold">
                          Última solución: {statusMeta(complaint.latestSolution.status)?.label ?? complaint.latestSolution.status}
                        </p>
                        <p className="mt-0.5 line-clamp-2">{complaint.latestSolution.description}</p>
                        {complaint.latestSolution.reviewComment && (
                          <p className="mt-1 font-medium">
                            Comentario del Moderador: {complaint.latestSolution.reviewComment}
                          </p>
                        )}
                      </div>
                    )}

                    {complaint.evidence?.length > 0 && (
                      <p className="mt-2 text-[11px] text-ink-soft">
                        Evidencias del ciudadano: {complaint.evidence.length} archivo(s)
                      </p>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      {complaint.status === 'ASSIGNED' && (
                        <button
                          type="button"
                          onClick={() => void startProcess(complaint.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-marine-700 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-marine-600"
                        >
                          <Play size={12} aria-hidden="true" />
                          Iniciar atención
                        </button>
                      )}
                      {complaint.status === 'IN_PROGRESS' && (
                        <button
                          type="button"
                          onClick={() => setSelected(complaint)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-state-success px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-green-700"
                        >
                          <FileText size={12} aria-hidden="true" />
                          Registrar solución
                        </button>
                      )}
                      {complaint.status === 'SOLUTION_SUBMITTED' && (
                        <p className="text-xs font-semibold text-state-caution">
                          Solución enviada — en espera de verificación del Moderador
                        </p>
                      )}
                    </div>
                  </article>
                </li>
              ))}
            </ul>

            {totalPages > 1 && (
              <nav className="flex items-center justify-center gap-3" aria-label="Paginación">
                <button
                  type="button"
                  onClick={() => setPage((c) => Math.max(1, c - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-ink hover:bg-slate-100 disabled:opacity-40"
                >
                  <ChevronLeft size={14} aria-hidden="true" /> Anterior
                </button>
                <p className="text-xs font-medium text-ink-soft">
                  Página {page} de {totalPages}
                </p>
                <button
                  type="button"
                  onClick={() => setPage((c) => Math.min(totalPages, c + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-ink hover:bg-slate-100 disabled:opacity-40"
                >
                  Siguiente <ChevronRight size={14} aria-hidden="true" />
                </button>
              </nav>
            )}
          </div>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <AdminMap complaints={data.complaints} detailPathBase="/tecnico" />
          </div>
        </div>
      )}

      {selected && (
        <SolutionModal
          complaint={selected}
          onClose={() => setSelected(null)}
          onDone={() => void load()}
        />
      )}
    </div>
  )
}
