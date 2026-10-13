import { AppError } from '../utils/errors.js';

/**
 * Exige que el usuario autenticado tenga al menos uno de los roles indicados.
 * Los roles siempre se resuelven en el backend; nunca se aceptan del cliente.
 *
 * @param {...string} allowedRoles
 */
export function requireRole(...allowedRoles) {
  return function requireRoleMiddleware(req, res, next) {
    if (!req.user) {
      return next(new AppError(401, 'UNAUTHENTICATED', 'No hay una sesion valida.'));
    }

    const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [];
    const hasRole = allowedRoles.some((role) => userRoles.includes(role));

    if (!hasRole) {
      return next(
        new AppError(403, 'FORBIDDEN', 'No tiene permisos para realizar esta operacion.')
      );
    }

    return next();
  };
}
