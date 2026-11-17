import path from 'node:path'
import { AppError } from './errors.js'

/**
 * Utilidad anti-path-traversal para rutas de almacenamiento de evidencias.
 *
 * Garantiza que toda ruta construida a partir de un `storageKey` (que incluye
 * IDs de denuncia/solución y una extensión) resuelva estrictamente dentro del
 * directorio raíz de almacenamiento. Si el resultado escapa del directorio
 * (ej. `../../../etc/passwd`), se rechaza con HTTP 403 PATH_TRAVERSAL_DENIED.
 *
 * Uso:
 *   const safePath = resolveStoragePath(config.STORAGE_DIRECTORY, storageKey)
 */

/**
 * Resuelve y valida que la ruta final quede dentro del directorio raíz.
 *
 * @param {string} storageRoot Directorio raíz de almacenamiento (ej. ./storage).
 * @param {string} storageKey Clave relativa (ej. "complaints/<id>/<uuid>.jpg").
 * @returns {string} Ruta absoluta segura.
 * @throws {AppError} 403 PATH_TRAVERSAL_DENIED si la clave intenta escapar.
 */
export function resolveStoragePath(storageRoot, storageKey) {
  const resolvedRoot = path.resolve(storageRoot)
  const resolvedPath = path.resolve(storageRoot, storageKey)

  if (!resolvedPath.startsWith(resolvedRoot + path.sep) && resolvedPath !== resolvedRoot) {
    throw new AppError(
      403,
      'PATH_TRAVERSAL_DENIED',
      'Ruta de archivo no permitida por razones de seguridad.'
    )
  }

  return resolvedPath
}

/**
 * Valida que un storageKey no contenga componentes de escape.
 * Lanza 403 si contiene "..", rutas absolutas o nulos de bytes.
 *
 * @param {string} storageKey Clave a validar.
 * @throws {AppError} 403 si el formato es sospechoso.
 */
export function validateStorageKey(storageKey) {
  if (
    typeof storageKey !== 'string' ||
    storageKey.length === 0 ||
    storageKey.includes('..') ||
    storageKey.includes('\0') ||
    path.isAbsolute(storageKey) ||
    /^[a-zA-Z]:/.test(storageKey)
  ) {
    throw new AppError(
      403,
      'PATH_TRAVERSAL_DENIED',
      'Ruta de archivo no permitida por razones de seguridad.'
    )
  }
  return storageKey
}
