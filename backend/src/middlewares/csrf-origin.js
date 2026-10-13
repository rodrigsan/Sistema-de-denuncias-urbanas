import { AppError } from '../utils/errors.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Proteccion CSRF complementaria a SameSite=Lax: para metodos mutantes, si el
 * navegador envia Origin y no coincide con el frontend autorizado, se rechaza
 * con 403. Las peticiones sin Origin (clientes no navegador) pasan.
 */
export function createCsrfOrigin({ config }) {
  return function csrfOrigin(req, res, next) {
    if (!MUTATING_METHODS.has(req.method)) return next();

    const origin = req.headers.origin;
    if (!origin) return next();
    if (origin === config.FRONTEND_ORIGIN) return next();

    return next(
      new AppError(403, 'CSRF_CHECK_FAILED', 'Origen no autorizado para esta operacion.')
    );
  };
}
