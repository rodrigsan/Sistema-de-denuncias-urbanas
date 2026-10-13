import { useEffect, useRef, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIconUrl from 'leaflet/dist/images/marker-icon.png'
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png'
import { Crosshair, MapPin, TriangleAlert } from 'lucide-react'
import { CERCADO_BOUNDS, COCHABAMBA_CENTER, isWithinCercado } from '../../lib/constants.js'

// Los assets por defecto de Leaflet no resuelven con bundlers: se fijan aqui.
L.Icon.Default.mergeOptions({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2xUrl,
  shadowUrl: markerShadowUrl,
})

const CERCADO_RECTANGLE = [
  [CERCADO_BOUNDS.south, CERCADO_BOUNDS.west],
  [CERCADO_BOUNDS.north, CERCADO_BOUNDS.east],
]

/** Click en el mapa -> nueva posicion del pin (dentro de los limites visibles). */
function MapClickCapture({ onPick }) {
  useMapEvents({
    click(event) {
      onPick({ latitude: event.latlng.lat, longitude: event.latlng.lng, source: 'MANUAL' })
    },
  })
  return null
}

/** Vuela el mapa hasta un objetivo marcado por su nonce (geolocalizacion). */
function MapFlyer({ target }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.flyTo([target.latitude, target.longitude], Math.max(map.getZoom(), 15), {
      duration: 0.8,
    })
  }, [target, map])
  return null
}

/**
 * Selector de ubicacion con mapa Leaflet.
 *
 * - Centrado en Cochabamba; maxBounds estrictos de la Provincia Cercado que
 *   impiden arrastrar el pin/la vista a municipios colindantes.
 * - Pin arrastrable y click para mover; Plus Code y coordenadas informan al
 *   formulario via onChange.
 * - "Obtener mi ubicacion" con la Geolocation API del navegador: si la
 *   posicion queda fuera de Cercado se advierte y NO se mueve el pin.
 */
export function LocationPicker({ value, onChange }) {
  const [geoWarning, setGeoWarning] = useState(null)
  const [locating, setLocating] = useState(false)
  const [flyTarget, setFlyTarget] = useState(null)
  const nonce = useRef(0)

  const position = value ? [value.latitude, value.longitude] : null

  const pick = ({ latitude, longitude, source }) => {
    if (!isWithinCercado(latitude, longitude)) return
    setGeoWarning(null)
    onChange({ latitude, longitude, source })
  }

  const requestGeolocation = () => {
    if (!navigator.geolocation) {
      setGeoWarning('Tu navegador no soporta la geolocalización.')
      return
    }
    setLocating(true)
    setGeoWarning(null)
    navigator.geolocation.getCurrentPosition(
      (result) => {
        setLocating(false)
        const { latitude, longitude } = result.coords
        if (!isWithinCercado(latitude, longitude)) {
          setGeoWarning(
            'Tu ubicación actual está fuera de los límites de la Provincia Cercado; no se movió el pin.',
          )
          return
        }
        nonce.current += 1
        setFlyTarget({ latitude, longitude, nonce: nonce.current })
        pick({ latitude, longitude, source: 'AUTOMATIC' })
      },
      () => {
        setLocating(false)
        setGeoWarning('No se pudo obtener tu ubicación. Ubica el pin manualmente.')
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-ink-soft">
          <MapPin size={14} className="text-marine-700" aria-hidden="true" />
          Toca el mapa o arrastra el pin para marcar el incidente
        </p>
        <button
          type="button"
          onClick={requestGeolocation}
          disabled={locating}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-700 disabled:cursor-wait disabled:opacity-60"
        >
          <Crosshair size={14} className={locating ? 'animate-pulse' : ''} aria-hidden="true" />
          {locating ? 'Obteniendo…' : 'Obtener mi ubicación'}
        </button>
      </div>

      <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
        <MapContainer
          center={[COCHABAMBA_CENTER.latitude, COCHABAMBA_CENTER.longitude]}
          zoom={13}
          minZoom={11}
          maxBounds={CERCADO_RECTANGLE}
          maxBoundsViscosity={1.0}
          className="h-64 w-full sm:h-72"
          attributionControl
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapClickCapture onPick={pick} />
          <MapFlyer target={flyTarget} />
          {position && (
            <Marker
              position={position}
              draggable
              autoPan
              eventHandlers={{
                dragend: (event) => {
                  const latlng = event.target.getLatLng()
                  pick({ latitude: latlng.lat, longitude: latlng.lng, source: 'MANUAL' })
                },
              }}
            />
          )}
        </MapContainer>
      </div>

      {geoWarning && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-state-caution/10 px-3 py-2 text-xs font-medium text-state-caution ring-1 ring-state-caution/30"
        >
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {geoWarning}
        </p>
      )}
    </div>
  )
}
