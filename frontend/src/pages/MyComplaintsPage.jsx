import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, FilePlus2, Inbox } from 'lucide-react'
import { apiFetch } from '../lib/api.js'
import { COMPLAINT_STATUS } from '../lib/constants.js'
import { formatDateTime } from '../lib/utils.js'
import { StatusBadge } from '../components/complaints/StatusBadge.jsx'

const PAGE_SIZE = 8

const FILTERS = [
  { value: '', label: 'Todas' },
  ...Object.entries(COMPLAINT_STATUS).map(([value, meta]) => ({ value, label: meta.label })),
]

/**
 * "Mis denuncias": listado paginado y filtrable por estado del ciudadano
 * autenticado (GET /citizens/complaints). Muestra motivo de rechazo y
 * descripcion de la solucion cuando aplican; sin evidencias multimedia.
 */
export function MyComplaintsPage() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ complaints: [], pagination: { page: 1, limit: PAGE_SIZE, total: 0 } })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) })
    if (statusFilter) params.set('status', statusFilter)

    const response = await apiFetch(`/citizens/complaints?${params}`)
    if (response.ok) {
      setData(response.data)
      setError(null)
    } else {
      setError('No se pudieron cargar tus denuncias. Intenta nuevamente.')
    }
    setLoading(false)
  }, [page, statusFilter])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect -- carga de datos del modulo
    void load()
  }, [load])

  const totalPages = Math.max(1, Math.ceil(data.pagination.total / PAGE_SIZE))

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Mis denuncias</h1>
        <Link
          to="/denuncias/nueva"
          className="inline-flex items-center gap-2 rounded-lg bg-marine-700 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-marine-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-950"
        >
          <FilePlus2 size={16} aria-hidden="true" />
          Crear denuncia
        </Link>
      </div>

      <div className="mb-5 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrar por estado">
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            onClick={() => {
              setStatusFilter(filter.value)
              setPage(1)
            }}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-700 ${
              statusFilter === filter.value
                ? 'bg-marine-950 text-white'
                : 'bg-white text-ink-soft ring-1 ring-slate-200 hover:bg-slate-100'
            }`}
            aria-pressed={statusFilter === filter.value}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-32 animate-pulse rounded-xl bg-slate-200/70" />
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
          <h2 className="mt-4 text-lg font-bold text-ink">
            {statusFilter ? 'No hay denuncias con ese estado' : 'Aún no tienes denuncias'}
          </h2>
          <p className="mt-2 max-w-sm text-sm text-ink-soft">
            {statusFilter
              ? 'Prueba con otro filtro o revisa todas tus denuncias.'
              : 'Reporta el primer incidente urbano de tu barrio; te acompañaremos durante todo el proceso.'}
          </p>
          {!statusFilter && (
            <Link
              to="/denuncias/nueva"
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-marine-700 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-marine-600"
            >
              <FilePlus2 size={16} aria-hidden="true" />
              Crear mi primera denuncia
            </Link>
          )}
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {data.complaints.map((complaint) => (
              <li key={complaint.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/mis-denuncias/${complaint.id}`)}
                  className="w-full rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-marine-700 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-700"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <StatusBadge status={complaint.status} />
                    <span className="font-mono text-[11px] font-semibold tracking-wider text-ink-soft">
                      {complaint.publicCode}
                    </span>
                  </div>
                  <h3 className="mt-2.5 text-base font-bold text-ink">{complaint.title}</h3>
                  <p className="mt-1 text-xs text-ink-soft">
                    {complaint.category.name} · {complaint.subcategory.name} ·{' '}
                    {formatDateTime(complaint.createdAt)}
                  </p>

                  {complaint.rejectionReason && (
                    <p className="mt-3 rounded-lg bg-state-danger/10 px-3 py-2 text-xs font-medium text-state-danger ring-1 ring-state-danger/30">
                      Rechazada: {complaint.rejectionReason}
                    </p>
                  )}
                  {complaint.assignedUnit && complaint.status !== 'RESOLVED' && (
                    <p className="mt-3 text-xs text-ink-soft">
                      Unidad responsable: <strong className="text-ink">{complaint.assignedUnit.name}</strong>
                    </p>
                  )}
                  {complaint.solution && (
                    <p className="mt-3 rounded-lg bg-state-success/10 px-3 py-2 text-xs text-ink ring-1 ring-state-success/30">
                      <strong className="font-semibold text-state-success">Solución municipal:</strong>{' '}
                      {complaint.solution.description}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <nav className="mt-6 flex items-center justify-center gap-3" aria-label="Paginación">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft size={14} aria-hidden="true" />
                Anterior
              </button>
              <p className="text-xs font-medium text-ink-soft">
                Página {page} de {totalPages} · {data.pagination.total} en total
              </p>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Siguiente
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}
