import { z } from 'zod';
import { AppError } from '../utils/errors.js';

/**
 * Validadores de la Fase 2 con Zod. El alias no es unico (solo el codigo
 * administrativo lo es); debe ser legible, sin caracteres de control.
 */
const aliasSchema = z
  .string({
    required_error: 'El alias es requerido.',
    invalid_type_error: 'El alias debe ser texto.',
  })
  .trim()
  .min(3, 'El alias debe tener al menos 3 caracteres.')
  .max(60, 'El alias debe tener como maximo 60 caracteres.')
  .regex(
    /^[\p{L}\p{N}][\p{L}\p{N} .,\-_]*$/u,
    'El alias solo permite letras, numeros, espacios, punto, coma, guion y guion bajo.'
  )
  .refine((value) => !/\s{2,}/.test(value), 'No use espacios consecutivos.');

export const setAliasBodySchema = z.object({
  alias: aliasSchema,
});

/**
 * Middleware que valida req.body contra un esquema Zod y deja el resultado
 * normalizado en req.validatedBody. Los errores son accionables (422).
 */
export function validateBody(schema) {
  return function validateBodyMiddleware(req, res, next) {
    const result = schema.safeParse(req.body ?? {});

    if (!result.success) {
      const error = new AppError(422, 'VALIDATION_ERROR', 'Datos de entrada invalidos.');
      error.details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return next(error);
    }

    req.validatedBody = result.data;
    return next();
  };
}
