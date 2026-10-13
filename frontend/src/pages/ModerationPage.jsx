import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Gavel, Inbox, LayoutDashboard } from 'lucide-react'
import { apiFetch } from '../lib/api.js'
import { formatDateTime } from '../lib/utils.js'
import { AdminMap } from '../components/admin/AdminMap.jsx'
import { ReviewModal } from '../components/admin/ReviewModal.jsx'
import { ViolationModal } from '../components/admin/ViolationModal.jsx'
import { DuplicateCandidates } from '../components/admin/DuplicateCandidates.jsx'

const PAGE_SIZE = 10

/**
 * Bandeja del Moderador: denuncias PENDING_REVIEW en orden FIFO por
 * formalizacion, con mapa administrativo, revision atomica
 * (aprobar con unidad / rechazar con motivo), gestion de duplicados y
 * sancion de infracciones (168 h). PII minimizada: solo el alias.
 */
export function ModerationPage() {
  const [data, setData] = useState({ complaints: [], pagination: { page: 1, limit: PAGE_SIZE, total: 0 } })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)
  const [modalKind, setModalKind] = useState(null)

  const load = useCallback(async () => {
    const response = await apiFetch(`/moderation/complaints?page=${page}&limit=${PAGE_SIZE}`)
    if (response.ok) {
      setData(response.data)
      setError(null)
    } else {
      setError('No se pudieron cargar las denuncias.')
    }
    setLoading(false)
  }, [page])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect -- carga de datos
    void load()
  }, [load])

  const totalPages = Math.max(1, Math.ceil(data.pagination.total / PAGE_SIZE))

  const openModal = (complaint, kind) => {
    setSelected(complaint)
    setModalKind(kind)
  }

  const closeModal = () => {
    setSelected(null)
    setModalKind(null)
  }

  const handleDone = () => {
    void load()
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-ink">
            <LayoutDashboard size={24} className="text-marine-700" aria-hidden="true" />
            Bandeja de Moderación
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {data.pagination.total} denuncia(s) pendiente(s) de revisión · orden FIFO
          </p>
        </div>
      </div>

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
            <Inbox size={26} aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-lg font-bold text-ink">Sin denuncias pendientes</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Cuando un ciudadano formalice una denuncia, aparecerá aquí para su revisión.
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
                      <span className="font-mono text-[11px] font-bold tracking-wider text-ink-soft">
                        {complaint.publicCode}
                      </span>
                      <span className="text-[11px] text-ink-soft">
                        {formatDateTime(complaint.formalizedAt)}
                      </span>
                    </div>

                    <h3 className="mt-2 text-base font-bold text-ink">{complaint.title}</h3>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {complaint.category?.name} · {complaint.subcategory?.name}
                    </p>
                    <p className="mt-1 text-xs text-ink-soft">
                      Vecino: <strong>{complaint.citizenAlias ?? '—'}</strong>
                    </p>
                    <p className="mt-2 line-clamp-2 text-sm text-ink">{complaint.description}</p>

                    {complaint.suggestedUnits?.length > 0 && (
                      <p className="mt-2 text-[11px] text-ink-soft">
                        Sugeridas:{' '}
                        {complaint.suggestedUnits.map((u) => u.name).join(' · ')}
                      </p>
                    )}

                    {complaint.evidence?.length > 0 && (
                      <p className="mt-1 text-[11px] text-ink-soft">
                        Evidencias: {complaint.evidence.length} archivo(s)
                      </p>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openModal(complaint, 'review')}
                        className="rounded-lg bg-marine-700 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-marine-600"
                      >
                        Revisar
                      </button>
                      <button
                        type="button"
                        onClick={() => openModal(complaint, 'duplicates')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-ink-soft transition-colors hover:bg-slate-100"
                      >
                        <Copy size={12} aria-hidden="true" />
                        Duplicados
                      </button>
                      <button
                        type="button"
                        onClick={() => openModal(complaint, 'violation')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-state-danger/40 px-3 py-2 text-xs font-semibold text-state-danger transition-colors hover:bg-state-danger/10"
                      >
                        <Gavel size={12} aria-hidden="true" />
                        Sanción
                      </button>
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
            <AdminMap complaints={data.complaints} detailPathBase="/moderacion" />
          </div>
        </div>
      )}

      {modalKind === 'review' && selected && (
        <ReviewModal complaint={selected} onClose={closeModal} onDone={handleDone} />
      )}
      {modalKind === 'duplicates' && selected && (
        <DuplicateCandidates complaint={selected} onClose={closeModal} onDone={handleDone} />
      )}
      {modalKind === 'violation' && selected && (
        <ViolationModal complaint={selected} onClose={closeModal} onDone={handleDone} />
      )}
    </div>
  )
}
