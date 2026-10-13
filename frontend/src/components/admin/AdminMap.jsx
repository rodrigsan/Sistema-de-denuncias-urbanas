import { useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { CircleDot, MapPin } from 'lucide-react'
import { COCHABAMBA_CENTER, statusMeta } from '../../lib/constants.js'
import { formatDateTime } from '../../lib/utils.js'

const CERCADO_BOUNDS = [
  [-17.52, -66.3],
  [-17.25, -66.02],
]

/**
 * Crea un icono de marcador circular con el color indicado (RF-91 a RF-96).
 * Rojo (#DC2626) para denuncias sin resolver; verde (#16A34A) para resueltas.
 */
function createMarkerIcon(color) {
  return L.divIcon({
    className: 'admin-map-marker',
    html: `<div style="background-color:${color};width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.35);"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -12],
  })
}

const RED_ICON = createMarkerIcon('#DC2626')
const GREEN_ICON = createMarkerIcon('#16A34A')

function isResolved(complaint) {
  return complaint.status === 'RESOLVED'
}

/**
 * Mapa administrativo interactivo (RF-91 a RF-97):
 *
 * - Renderiza todas las denuncias con ubicacion como marcadores.
 * - Conmutador de filtros: "No resueltas" (rojo) y "Resueltas" (verde).
 * - Popup informativo (RF-97): codigo publico, titulo, categoria, estado,
 *   fecha y unidad asignada. Excluye PII (sin alias ni correo).
 *
 * @param {Array} complaints Denuncias con { id, publicCode, title, status,
 *   category, location, createdAt, assignedUnit }.
 * @param {string} detailPathBase Ruta base para enlaces de popup (ej. "/moderacion").
 */
export function AdminMap({ complaints, detailPathBase = '' }) {
  const [showUnresolved, setShowUnresolved] = useState(true)
  const [showResolved, setShowResolved] = useState(true)

  const visible = complaints.filter((complaint) => {
    if (isResolved(complaint)) return showResolved
    return showUnresolved
  })

  const unresolvedCount = complaints.filter((c) => !isResolved(c)).length
  const resolvedCount = complaints.filter((c) => isResolved(c)).length

  return (
    <section aria-label="Mapa administrativo de denuncias" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-bold text-ink">
          <MapPin size={16} className="text-marine-700" aria-hidden="true" />
          Mapa de denuncias
        </p>
        <div className="flex gap-2" role="group" aria-label="Filtros del mapa">
          <button
            type="button"
            onClick={() => setShowUnresolved((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition-colors ${
              showUnresolved
                ? 'bg-state-danger/10 text-state-danger ring-state-danger/30'
                : 'bg-slate-50 text-slate-400 ring-slate-200'
            }`}
            aria-pressed={showUnresolved}
          >
            <CircleDot size={12} aria-hidden="true" style={{ color: '#DC2626' }} />
            No resueltas ({unresolvedCount})
          </button>
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition-colors ${
              showResolved
                ? 'bg-state-success/10 text-state-success ring-state-success/30'
                : 'bg-slate-50 text-slate-400 ring-slate-200'
            }`}
            aria-pressed={showResolved}
          >
            <CircleDot size={12} aria-hidden="true" style={{ color: '#16A34A' }} />
            Resueltas ({resolvedCount})
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
        <MapContainer
          center={[COCHABAMBA_CENTER.latitude, COCHABAMBA_CENTER.longitude]}
          zoom={12}
          minZoom={11}
          maxBounds={CERCADO_BOUNDS}
          maxBoundsViscosity={0.8}
          className="h-80 w-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {visible.map((complaint) => (
            <Marker
              key={complaint.id}
              position={[complaint.location.latitude, complaint.location.longitude]}
              icon={isResolved(complaint) ? GREEN_ICON : RED_ICON}
            >
              <Popup>
                <div className="min-w-44 space-y-1">
                  <p className="font-mono text-[10px] font-bold tracking-wider text-slate-500">
                    {complaint.publicCode}
                  </p>
                  <p className="text-xs font-semibold">{complaint.title}</p>
                  <p className="text-[10px] text-slate-600">
                    {complaint.category?.name ?? '—'}
                  </p>
                  <p className="text-[10px]">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        isResolved(complaint) ? 'bg-green-600' : 'bg-red-600'
                      }`}
                      aria-hidden="true"
                    />{' '}
                    <span className="font-medium">{statusMeta(complaint.status).label}</span>
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {formatDateTime(complaint.createdAt)}
                  </p>
                  {complaint.assignedUnit?.name && (
                    <p className="text-[10px] text-slate-600">
                      Unidad: <strong>{complaint.assignedUnit.name}</strong>
                    </p>
                  )}
                  {detailPathBase && (
                    <a
                      href={`${detailPathBase}/${complaint.id}`}
                      className="mt-1 inline-block text-[10px] font-semibold text-blue-700 underline"
                    >
                      Ver detalle →
                    </a>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </section>
  )
}
