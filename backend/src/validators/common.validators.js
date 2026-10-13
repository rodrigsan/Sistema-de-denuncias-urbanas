import { z } from 'zod';
import { AppError } from '../utils/errors.js';

/**
 * Validadores comunes reutilizables (query strings y paginacion).
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number({ invalid_type_error: 'page debe ser un numero.' })
    .int('page debe ser entero.')
    .min(1, 'page debe ser >= 1.')
    .default(1),
  limit: z.coerce.number({ invalid_type_error: 'limit debe ser un numero.' })
    .int('limit debe ser entero.')
    .min(1, 'limit debe ser >= 1.')
    .max(100, 'limit admite como maximo 100.')
    .default(20),
});

/**
 * Middleware que valida req.query contra un esquema Zod y deja el resultado
 * normalizado en req.validatedQuery. Analogio a validateBody.
 */
export function validateQuery(schema) {
  return function validateQueryMiddleware(req, res, next) {
    const result = schema.safeParse(req.query ?? {});

    if (!result.success) {
      const error = new AppError(422, 'VALIDATION_ERROR', 'Parametros de consulta invalidos.');
      error.details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return next(error);
    }

    req.validatedQuery = result.data;
    return next();
  };
}
