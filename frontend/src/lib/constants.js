/**
 * Constantes del modulo ciudadano. Reflejan los contratos del backend
 * (limites de evidencia en src/config/env.js del backend y estados de
 * complaints en el esquema SQL).
 */

// Limites de evidencia (espejo de EVIDENCE_* del backend).
export const EVIDENCE_LIMITS = {
  maxImages: 3,
  maxVideos: 1,
  maxImageMb: 5,
  maxVideoMb: 50,
  maxVideoSeconds: 30,
  imageTypes: ['image/jpeg', 'image/png', 'image/heic', 'image/heif'],
  videoTypes: ['video/mp4', 'video/quicktime'],
}

// Limites geograficos: Provincia Cercado (Cochabamba).
export const CERCADO_BOUNDS = {
  south: -17.52,
  west: -66.3,
  north: -17.25,
  east: -66.02,
}

export const COCHABAMBA_CENTER = { latitude: -17.3936, longitude: -66.157 }

export const GRACE_TOTAL_SECONDS = 180

export function isWithinCercado(latitude, longitude) {
  return (
    latitude >= CERCADO_BOUNDS.south &&
    latitude <= CERCADO_BOUNDS.north &&
    longitude >= CERCADO_BOUNDS.west &&
    longitude <= CERCADO_BOUNDS.east
  )
}

/**
 * Metadatos de estado para badges: etiqueta + tono semantico.
 * Ambar: pendientes (gracia y revision) · Naranja: en proceso ·
 * Verde: resuelta · Rojo: rechazada.
 */
export const COMPLAINT_STATUS = {
  GRACE_PERIOD: { label: 'En ventana de gracia', tone: 'caution' },
  PENDING_REVIEW: { label: 'Pendiente de revisión', tone: 'caution' },
  ASSIGNED: { label: 'Asignada a unidad', tone: 'warning' },
  IN_PROGRESS: { label: 'En atención', tone: 'warning' },
  SOLUTION_SUBMITTED: { label: 'Solución propuesta', tone: 'warning' },
  RESOLVED: { label: 'Resuelta', tone: 'success' },
  REJECTED: { label: 'Rechazada', tone: 'danger' },
}

export function statusMeta(status) {
  return (
    COMPLAINT_STATUS[status] ?? {
      label: status ?? 'Estado desconocido',
      tone: 'caution',
    }
  )
}
