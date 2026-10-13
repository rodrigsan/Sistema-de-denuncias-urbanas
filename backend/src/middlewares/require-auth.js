import { AppError } from '../utils/errors.js';
import { asyncHandler } from '../utils/async-handler.js';

/**
 * Exige una sesion valida y resuelve el usuario desde PostgreSQL en cada
 * peticion: tipo, estado, alias y roles activos. La identidad jamas se acepta
 * del cliente.
 *
 * Estados de cuenta (Fase 6):
 * - DISABLED: la sesion se trata como invalida (401).
 * - SUSPENDED: resolucion perezosa de la suspension de 168 h; si ya cumplio,
 *   se reactiva y continua como activo; si sigue vigente, la peticion pasa con
 *   req.user.suspended = true y son las operaciones de escritura las que
 *   responden 403 ACCOUNT_SUSPENDED. Las lecturas (Mis denuncias) y el cierre
 *   de sesion permanecen permitidos.
 *
 * @param {{ usersRepository: object }} dependencies
 */
export function createRequireAuth({ usersRepository }) {
  return asyncHandler(async function requireAuth(req, res, next) {
    if (!req.session?.userId) {
      throw new AppError(401, 'UNAUTHENTICATED', 'No hay una sesion valida.');
    }

    const data = await usersRepository.findSessionData(req.session.userId);
    if (!data) {
      // El usuario fue eliminado mientras la cookie seguia vigente.
      throw new AppError(401, 'UNAUTHENTICATED', 'No hay una sesion valida.');
    }

    if (data.status === 'DISABLED') {
      throw new AppError(401, 'UNAUTHENTICATED', 'No hay una sesion valida.');
    }

    let suspended = false;
    if (data.status === 'SUSPENDED') {
      const reactivated = await usersRepository.resolveExpiredSuspension(data.id);
      suspended = !reactivated;
    }

    req.user = {
      id: data.id,
      userType: data.userType,
      alias: data.alias,
      roles: data.roles,
      requiresAlias: data.userType === 'CITIZEN' && !data.alias,
      suspended,
    };

    next();
  });
}
