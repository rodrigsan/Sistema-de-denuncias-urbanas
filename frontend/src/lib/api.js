/**
 * Cliente HTTP del frontend (fetch nativo).
 *
 * Regla de integracion con el backend: TODAS las peticiones envian
 * credentials: 'include' para que la cookie HttpOnly de sesion viaje en
 * cada request (mismo sitio localhost:5173 <-> localhost:3001).
 *
 * Nunca lanza por respuestas 4xx/5xx: devuelve { ok, status, data } con el
 * envelope normalizado del backend ({ error: { code, message, details? } }).
 */
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1'

export async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    ...options,
  })

  const data = await response.json().catch(() => null)
  return { ok: response.ok, status: response.status, data }
}

export function apiErrorMessage(data) {
  return data?.error?.message ?? 'Ocurrio un error inesperado. Intente nuevamente.'
}

/**
 * Subida multipart (evidencias). El navegador fija el Content-Type con el
 * boundary; credentials viaja igual que en apiFetch.
 */
export async function apiUpload(path, formData) {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    method: 'POST',
    body: formData,
  })
  const data = await response.json().catch(() => null)
  return { ok: response.ok, status: response.status, data }
}
