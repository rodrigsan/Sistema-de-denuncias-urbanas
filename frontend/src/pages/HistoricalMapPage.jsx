import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { HeatLayer } from 'leaflet.heat'
import { ArrowLeft, MapPin, Clock, Loader2 } from 'lucide-react'
import { apiFetch } from '../lib/api.js'
import { CERCADO_BOUNDS, COCHABAMBA_CENTER } from '../lib/constants.js'

/**
 * Capa de calor Leaflet. Renderiza puntos de densidad sin PII.
 */
function HeatmapLayer({ points }) {
  const map = useMap()

  useEffect(() => {
    if (!map || points.length === 0) return

    const heatLayer = new HeatLayer(
      points.map((p) => [p.latitude, p.longitude, 1]),
      {
        radius: 22,
        blur: 14,
        maxZoom: 17,
        max: 1.0,
        gradient: {
          0.2: '#10b981', // verde: densidad baja
          0.5: '#eab308', // amarillo: densidad intermedia
          0.8: '#f97316', // naranja: densidad elevada
          1.0: '#dc2626', // rojo: concentración elevada
        },
      },
    )
    heatLayer.addTo(map)

    return () => {
      map.removeLayer(heatLayer)
    }
  }, [map, points])

  return null
}

/**
 * Ajusta el viewport del mapa para que quede visible toda la extensión
 * de Cercado al montar el componente.
 */
function FitBoundsMap() {
  const map = useMap()

  useEffect(() => {
    if (!map) return
    const bounds = [
      [CERCADO_BOUNDS.south, CERCADO_BOUNDS.west],
      [CERCADO_BOUNDS.north, CERCADO_BOUNDS.east],
    ]
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 })
  }, [map])

  return null
}

/**
 * Página independiente: Mapa Histórico de Denuncias.
 *
 * Ruta: /moderacion/mapa-historico
 * Acceso: MODERATOR y TECHNICAL_LIAISON.
 *
 * Muestra análisis territorial de denuncias históricas con:
 * - Filtros de fecha, categoría, subcategoría y estado.
 * - Mapa de calor ocupando la mayor parte de la página.
 * - Indicadores estadísticos, gráfico de categorías y evolución temporal.
 */
export function HistoricalMapPage() {
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filtros
  const [filters, setFilters] = useState({
    periodFrom: '',
    periodTo: '',
    categoryId: '',
    subcategoryId: '',
    status: '',
    granularity: 'day',
  })

  // Datos
  const [summary, setSummary] = useState(null)
  const [heatmapPoints, setHeatmapPoints] = useState([])
  const [categories, setCategories] = useState([])
  const [timeline, setTimeline] = useState([])
  const [catalogCategories, setCatalogCategories] = useState([])

  // Cargar catálogo de categorías para los selects de filtro
  const loadCatalog = useCallback(async () => {
    try {
      const res = await apiFetch('/categories')
      if (res.ok) {
        setCatalogCategories(
          Array.isArray(res.data?.categories) ? res.data.categories : [],
        )
      }
    } catch {
      // No bloquear la página si falla el catálogo de filtros
    }
  }, [])

  // Cargar datos del reporte histórico
  const loadReport = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filters.periodFrom) params.set('periodFrom', filters.periodFrom)
      if (filters.periodTo) params.set('periodTo', filters.periodTo)
      if (filters.categoryId) params.set('categoryId', filters.categoryId)
      if (filters.subcategoryId) params.set('subcategoryId', filters.subcategoryId)
      if (filters.status) params.set('status', filters.status)
      if (filters.granularity) params.set('granularity', filters.granularity)

      const [summaryRes, heatmapRes, categoriesRes, timelineRes] = await Promise.all([
        apiFetch(`/reports/summary?${params}`),
        apiFetch(`/reports/heatmap?${params}`),
        apiFetch(`/reports/categories?${params}`),
        apiFetch(`/reports/timeline?${params}`),
      ])

      if (!summaryRes.ok) throw new Error('No se pudieron cargar las estadísticas.')
      if (!heatmapRes.ok) throw new Error('No se pudieron cargar los datos del mapa de calor.')
      if (!categoriesRes.ok) throw new Error('No se pudieron cargar las categorías.')
      if (!timelineRes.ok) throw new Error('No se pudo cargar la evolución temporal.')

      setSummary(summaryRes.data)
      setHeatmapPoints(
        Array.isArray(heatmapRes.data?.points) ? heatmapRes.data.points : [],
      )
      setCategories(Array.isArray(categoriesRes.data) ? categoriesRes.data : [])
      setTimeline(Array.isArray(timelineRes.data) ? timelineRes.data : [])
    } catch (err) {
      setError(err.message ?? 'Error al cargar el reporte histórico.')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  useEffect(() => {
    void loadReport()
  }, [loadReport])

  const maxCategory =
    categories.length > 0 ? Math.max(...categories.map((c) => c.total)) : 0

  const maxTimeline =
    timeline.length > 0 ? Math.max(...timeline.map((t) => t.total)) : 0

  const pendingCount =
    summary?.total - summary?.resolved || 0

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* Encabezado */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => navigate('/moderacion', { replace: true })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-700"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Volver a la bandeja
          </button>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold tracking-tight text-ink">
            <MapPin size={24} className="text-marine-700" aria-hidden="true" />
            Mapa Histórico de Denuncias
          </h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            Análisis territorial de incidencias urbanas · Provincia de Cercado, Cochabamba
          </p>
        </div>
      </div>

      {/* Mensaje de error */}
      {error && (
        <div role="alert" className="mb-4 rounded-lg bg-state-danger/10 px-4 py-3 text-sm font-medium text-state-danger ring-1 ring-state-danger/30">
          {error}
        </div>
      )}

      {/* Filtros */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <p className="text-xs font-semibold text-ink-soft uppercase tracking-wider">
          Filtros de consulta
        </p>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <div>
            <label className="block text-[10px] text-ink-soft mb-1">Fecha desde</label>
            <input
              type="date"
              value={filters.periodFrom}
              onChange={(e) =>
                setFilters((f) => ({ ...f, periodFrom: e.target.value }))
              }
              className="w-full rounded border border-slate-300 px-2.5 py-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-marine-700"
            />
          </div>
          <div>
            <label className="block text-[10px] text-ink-soft mb-1">Fecha hasta</label>
            <input
              type="date"
              value={filters.periodTo}
              onChange={(e) => setFilters((f) => ({ ...f, periodTo: e.target.value }))}
              className="w-full rounded border border-slate-300 px-2.5 py-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-marine-700"
            />
          </div>
          <div>
            <label className="block text-[10px] text-ink-soft mb-1">Categoría</label>
            <select
              value={filters.categoryId}
              onChange={(e) =>
                setFilters((f) => ({ ...f, categoryId: e.target.value, subcategoryId: '' }))
              }
              className="w-full rounded border border-slate-300 px-2.5 py-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-marine-700"
            >
              <option value="">Todas</option>
              {catalogCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-ink-soft mb-1">Subcategoría</label>
            <select
              value={filters.subcategoryId}
              onChange={(e) =>
                setFilters((f) => ({ ...f, subcategoryId: e.target.value }))
              }
              className="w-full rounded border border-slate-300 px-2.5 py-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-marine-700"
            >
              <option value="">Todas</option>
              {catalogCategories.flatMap((cat) =>
                cat.subcategories.map((sub) => (
                  <option key={sub.id} value={sub.id}>
                    {sub.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-ink-soft mb-1">Estado</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              className="w-full rounded border border-slate-300 px-2.5 py-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-marine-700"
            >
              <option value="">Todos</option>
              <option value="GRACE_PERIOD">En ventana de gracia</option>
              <option value="PENDING_REVIEW">Pendiente de revisión</option>
              <option value="ASSIGNED">Asignada a unidad</option>
              <option value="IN_PROGRESS">En atención</option>
              <option value="SOLUTION_SUBMITTED">Solución propuesta</option>
              <option value="RESOLVED">Resuelta</option>
              <option value="REJECTED">Rechazada</option>
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void loadReport()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-marine-700 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-marine-600 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Aplicar filtros
          </button>
          <button
            type="button"
            onClick={() => {
              setFilters({
                periodFrom: '',
                periodTo: '',
                categoryId: '',
                subcategoryId: '',
                status: '',
                granularity: 'day',
              })
              void loadReport()
            }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      {/* Mapa principal — ocupa la mayor parte de la página */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">
            <MapPin size={16} className="text-marine-700 mr-2" aria-hidden="true" />
            Mapa de calor — densidad histórica de denuncias
          </p>
          <span className="text-[10px] text-slate-500">
            Provincia de Cercado — Cochabamba
          </span>
        </div>
        <div className="h-[70vh] min-h-[500px] w-full">
          {loading && !summary ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 size={24} className="animate-spin text-marine-700" aria-hidden="true" />
              <span className="ml-2 text-sm text-ink-soft">Cargando mapa histórico…</span>
            </div>
          ) : (
            <MapContainer
              center={[COCHABAMBA_CENTER.latitude, COCHABAMBA_CENTER.longitude]}
              zoom={11}
              minZoom={10}
              maxBounds={[
                [CERCADO_BOUNDS.south, CERCADO_BOUNDS.west],
                [CERCADO_BOUNDS.north, CERCADO_BOUNDS.east],
              ]}
              maxBoundsViscosity={1.0}
              className="h-full w-full"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <HeatmapLayer points={heatmapPoints} />
              <FitBoundsMap />
            </MapContainer>
          )}
        </div>
        <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-t border-slate-100 text-[10px]">
          <div className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true"></span>
            <span>Baja</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-yellow-500" aria-hidden="true"></span>
            <span>Intermedia</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true"></span>
            <span>Alta</span>
          </div>
          <span className="text-slate-400">
            {heatmapPoints.length} punto(s) de datos
          </span>
        </div>
      </div>

      {/* Indicadores estadísticos */}
      {summary && (
        <div className="mb-6 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold">
              Total denuncias
            </p>
            <p className="text-2xl font-bold text-ink">{summary.total}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold">
              Resueltas
            </p>
            <p className="text-2xl font-bold text-state-success">{summary.resolved}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold">
              Pendientes / en proceso
            </p>
            <p className="text-2xl font-bold text-state-caution">{pendingCount}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-[10px] text-ink-soft uppercase tracking-wider font-semibold">
              Porcentaje de resolución
            </p>
            <p className="text-2xl font-bold text-ink">{summary.percentage}%</p>
          </div>
        </div>
      )}

      {/* Sección inferior: categorías y evolución temporal */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Gráfico de categorías */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold text-ink-soft uppercase tracking-wider">
              Categorías con más denuncias
            </p>
            <span className="text-[10px] text-slate-500">
              {summary?.categories ?? 0} categoría(s)
            </span>
          </div>
          {categories.length > 0 ? (
            <div className="space-y-2">
              {categories.map((cat) => {
                const pct = maxCategory > 0 ? Math.round((cat.total / maxCategory) * 100) : 0
                return (
                  <div key={cat.categoryId + '-' + (cat.subcategoryId ?? 'cat')} className="space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-ink-soft truncate max-w-[140px]">
                        {cat.subcategoryName ? `${cat.categoryName} › ${cat.subcategoryName}` : cat.categoryName}
                      </span>
                      <span className="font-semibold text-ink">{cat.total}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-marine-700"
                        style={{ width: `${pct}%` }}
                      ></div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-500 text-center py-4">
              No hay datos de categorías para los filtros seleccionados.
            </p>
          )}
        </div>

        {/* Evolución temporal */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-marine-700" aria-hidden="true" />
              <p className="text-xs font-semibold text-ink-soft uppercase tracking-wider">
                Evolución temporal
              </p>
            </div>
            <select
              value={filters.granularity}
              onChange={(e) => setFilters((f) => ({ ...f, granularity: e.target.value }))}
              className="rounded border border-slate-300 px-2 py-1 text-[10px] focus:outline-none focus:ring-1 focus:ring-marine-700"
            >
              <option value="day">Por día</option>
              <option value="week">Por semana</option>
              <option value="month">Por mes</option>
            </select>
          </div>
          {timeline.length > 0 ? (
            <div className="flex items-end gap-1 h-48">
              {timeline.map((point, i) => {
                const pct = maxTimeline > 0 ? (point.total / maxTimeline) * 100 : 0
                return (
                  <div
                    key={i}
                    className="flex flex-col items-center gap-1 w-full"
                    style={{ flex: 1 }}
                  >
                    <div
                      className="w-full rounded-t-full bg-marine-700"
                      style={{ height: `${pct}%` }}
                    ></div>
                    <span className="text-[10px] text-slate-500">
                      {new Date(point.period).toLocaleDateString('es-BO', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                    <span className="text-[10px] font-semibold text-ink">{point.total}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-500 text-center py-4">
              No hay datos de evolución temporal para los filtros seleccionados.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
