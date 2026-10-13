import { z } from 'zod'
import { EVIDENCE_LIMITS } from './constants.js'

/**
 * Validaciones del lado cliente (espejo de las reglas del backend; el
 * servidor siempre revalida y es la fuente de verdad).
 */
export const aliasSchema = z.string().trim()
  .min(3, 'El alias debe tener al menos 3 caracteres.')
  .max(60, 'El alias admite como máximo 60 caracteres.')

export const complaintFormSchema = z.object({
  title: z.string().trim()
    .min(3, 'El título debe tener al menos 3 caracteres.')
    .max(180, 'El título admite como máximo 180 caracteres.'),
  description: z.string().trim()
    .min(10, 'La descripción debe tener al menos 10 caracteres.')
    .max(5000, 'La descripción admite como máximo 5000 caracteres.'),
  categoryId: z.string().min(1, 'Selecciona una categoría.'),
  subcategoryId: z.string().min(1, 'Selecciona una subcategoría.'),
  latitude: z.number({ error: 'Ubica el incidente en el mapa.' }),
  longitude: z.number({ error: 'Ubica el incidente en el mapa.' }),
})

/** Valida un esquema y devuelve { ok, data, fieldErrors }. */
export function validateSchema(schema, values) {
  const result = schema.safeParse(values)
  if (result.success) return { ok: true, data: result.data, fieldErrors: null }
  const fieldErrors = {}
  for (const issue of result.error.issues) {
    const key = issue.path[0] ?? '_form'
    if (!fieldErrors[key]) fieldErrors[key] = issue.message
  }
  return { ok: false, data: null, fieldErrors }
}

/**
 * Duracion real de un video leida del contenedor en el navegador
 * (metadata). Devuelve segundos; rechaza si no se puede leer.
 */
export function readVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      const duration = video.duration
      if (Number.isFinite(duration)) {
        resolve(duration)
      } else {
        reject(new Error('No se pudo determinar la duración del video.'))
      }
    }
    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('El navegador no puede leer este video (formato no soportado).'))
    }
    video.src = url
  })
}

/** Extension amigable por tipo MIME. */
export function extensionFor(mimeType) {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/heic' || mimeType === 'image/heif') return 'heic'
  if (mimeType === 'video/mp4') return 'mp4'
  if (mimeType === 'video/quicktime') return 'mov'
  return 'bin'
}

/**
 * Validacion de un archivo de evidencia contra los limites del backend.
 * Devuelve { error, durationSeconds }: error es un mensaje accionable o
 * null; durationSeconds (solo videos) se lee del contenedor en el navegador
 * porque el backend exige la duracion declarada (duration_seconds).
 */
export async function validateEvidenceFile(file, existingCounts) {
  const isImage = EVIDENCE_LIMITS.imageTypes.includes(file.type)
  const isVideo = EVIDENCE_LIMITS.videoTypes.includes(file.type)

  if (!isImage && !isVideo) {
    return { error: 'Tipo no permitido. Usa JPG, PNG, HEIC/HEIF, MP4 o MOV.' }
  }
  if (isImage) {
    if (existingCounts.images >= EVIDENCE_LIMITS.maxImages) {
      return { error: `Se permiten como máximo ${EVIDENCE_LIMITS.maxImages} fotografías.` }
    }
    if (file.size > EVIDENCE_LIMITS.maxImageMb * 1024 * 1024) {
      return { error: `La fotografía supera los ${EVIDENCE_LIMITS.maxImageMb} MB.` }
    }
    return { error: null, durationSeconds: null }
  }

  if (existingCounts.videos >= EVIDENCE_LIMITS.maxVideos) {
    return { error: 'Se permite un solo video por denuncia.' }
  }
  if (file.size > EVIDENCE_LIMITS.maxVideoMb * 1024 * 1024) {
    return { error: `El video supera los ${EVIDENCE_LIMITS.maxVideoMb} MB.` }
  }
  try {
    const duration = await readVideoDuration(file)
    if (duration > EVIDENCE_LIMITS.maxVideoSeconds + 0.5) {
      return { error: `El video supera los ${EVIDENCE_LIMITS.maxVideoSeconds} segundos.` }
    }
    return { error: null, durationSeconds: Math.round(duration) }
  } catch {
    return { error: 'No se pudo leer el video: usa MP4 o MOV con duración detectable.' }
  }
}
