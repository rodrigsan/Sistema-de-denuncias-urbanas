import { z } from 'zod';
import { paginationQuerySchema } from './common.validators.js';

/**
 * Validadores del modulo del Enlace Tecnico/Supervisor (Fase 6).
 */
export const technicalComplaintsQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum(['ASSIGNED', 'IN_PROGRESS', 'SOLUTION_SUBMITTED', 'RESOLVED'], {
      invalid_type_error: 'status no es un estado tecnico valido.',
    })
    .optional(),
});

export const submitSolutionBodySchema = z.object({
  description: z
    .string({ required_error: 'La descripcion de la solucion es requerida.' })
    .trim()
    .min(10, 'La descripcion de la solucion debe tener al menos 10 caracteres.')
    .max(5000, 'La descripcion admite como maximo 5000 caracteres.'),
});
