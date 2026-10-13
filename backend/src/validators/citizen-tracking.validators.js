import { z } from 'zod';
import { paginationQuerySchema } from './common.validators.js';

/**
 * Validadores del modulo "Mis Denuncias" (Fase 6).
 */
export const myComplaintsQuerySchema = paginationQuerySchema.extend({
  status: z
    .enum(
      [
        'GRACE_PERIOD',
        'PENDING_REVIEW',
        'REJECTED',
        'ASSIGNED',
        'IN_PROGRESS',
        'SOLUTION_SUBMITTED',
        'RESOLVED',
      ],
      { invalid_type_error: 'status no es un estado valido.' }
    )
    .optional(),
});
