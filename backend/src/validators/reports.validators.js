import { z } from 'zod';
import { AppError } from '../utils/errors.js';

/**
 * Validador de consultas para endpoints de reportes (Fase MVP).
 *
 * Filtros soportados: periodFrom, periodTo, categoryId, subcategoryId, status.
 * Todos los parámetros son opcionales. Las fechas se validan como strings
 * ISO 8601 y se pasan tal cual a PostgreSQL para comparación con created_at.
 */
export const reportsQuerySchema = z.object({
  periodFrom: z
    .string()
    .optional()
    .refine(
      (val) => !val || !isNaN(Date.parse(val)),
      { message: 'periodFrom debe ser una fecha válida.' },
    ),
  periodTo: z
    .string()
    .optional()
    .refine(
      (val) => !val || !isNaN(Date.parse(val)),
      { message: 'periodTo debe ser una fecha válida.' },
    ),
  categoryId: z.string().uuid({ message: 'categoryId debe ser un UUID válido.' }).optional(),
  subcategoryId: z
    .string()
    .uuid({ message: 'subcategoryId debe ser un UUID válido.' })
    .optional(),
  status: z
    .enum([
      'GRACE_PERIOD',
      'PENDING_REVIEW',
      'ASSIGNED',
      'IN_PROGRESS',
      'SOLUTION_SUBMITTED',
      'RESOLVED',
      'REJECTED',
    ])
    .optional(),
  granularity: z.enum(['day', 'week', 'month']).optional().default('day'),
});

export function validateReportsQuery(req, res, next) {
  const result = reportsQuerySchema.safeParse(req.query ?? {});
  if (!result.success) {
    const error = new AppError(422, 'VALIDATION_ERROR', 'Parámetros de consulta inválidos.');
    error.details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return next(error);
  }
  req.validatedQuery = result.data;
  return next();
}
