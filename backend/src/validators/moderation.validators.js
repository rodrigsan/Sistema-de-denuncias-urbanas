import { z } from 'zod';
import { paginationQuerySchema } from './common.validators.js';

/**
 * Validadores del modulo de moderacion (Fase 5). El estado de las denuncias
 * y la pertenencia a grupos se resuelven en servidor (servicio/repositorio).
 */
export const moderationInboxQuerySchema = paginationQuerySchema.extend({
  categoryId: z.string().uuid('categoryId debe ser un UUID valido.').optional(),
  subcategoryId: z.string().uuid('subcategoryId debe ser un UUID valido.').optional(),
  formalizedFrom: z.coerce.date({ invalid_type_error: 'formalizedFrom debe ser una fecha ISO.' }).optional(),
  formalizedTo: z.coerce.date({ invalid_type_error: 'formalizedTo debe ser una fecha ISO.' }).optional(),
});

export const listDuplicateProposalsQuerySchema = z.object({
  status: z
    .enum(['PENDING', 'CONFIRMED_GROUP', 'NOT_DUPLICATE', 'DISMISSED'])
    .optional(),
});

export const approveComplaintBodySchema = z.object({
  municipalUnitId: z
    .string({ required_error: 'municipalUnitId es requerido.' })
    .uuid('municipalUnitId debe ser un UUID valido.'),
});

export const rejectComplaintBodySchema = z.object({
  rejectionReason: z
    .string({ required_error: 'El motivo de rechazo es obligatorio.' })
    .trim()
    .min(5, 'El motivo de rechazo debe tener al menos 5 caracteres.')
    .max(2000, 'El motivo de rechazo admite como maximo 2000 caracteres.'),
});

export const duplicateProposalBodySchema = z.object({
  candidateComplaintId: z
    .string({ required_error: 'candidateComplaintId es requerido.' })
    .uuid('candidateComplaintId debe ser un UUID valido.'),
});

export const resolveProposalBodySchema = z
  .object({
    decision: z.enum(['NOT_DUPLICATE', 'DISMISSED', 'CONFIRMED_GROUP'], {
      required_error: 'decision es requerida.',
      invalid_type_error: 'decision debe ser NOT_DUPLICATE, DISMISSED o CONFIRMED_GROUP.',
    }),
    title: z.string().trim().min(3, 'El titulo debe tener al menos 3 caracteres.').max(180).optional(),
  })
  .refine((data) => data.decision !== 'CONFIRMED_GROUP' || Boolean(data.title), {
    message: 'El titulo del grupo es requerido para CONFIRMED_GROUP.',
    path: ['title'],
  });

export const createGroupBodySchema = z
  .object({
    title: z
      .string({ required_error: 'El titulo del grupo es requerido.' })
      .trim()
      .min(3, 'El titulo debe tener al menos 3 caracteres.')
      .max(180, 'El titulo admite como maximo 180 caracteres.'),
    complaintIds: z
      .array(z.string().uuid('Cada denuncia debe ser un UUID valido.'), {
        required_error: 'complaintIds es requerido.',
        invalid_type_error: 'complaintIds debe ser un arreglo.',
      })
      .min(2, 'Se requieren al menos 2 denuncias para agrupar.')
      .max(20, 'Un grupo admite como maximo 20 denuncias.')
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Las denuncias del grupo deben ser unicas.',
      }),
  });

export const verifySolutionBodySchema = z
  .object({
    decision: z.enum(['APPROVE', 'RETURN'], {
      required_error: 'decision es requerida.',
      invalid_type_error: 'decision debe ser APPROVE o RETURN.',
    }),
    reviewComment: z
      .string()
      .trim()
      .min(5, 'El comentario debe tener al menos 5 caracteres.')
      .max(2000, 'El comentario admite como maximo 2000 caracteres.')
      .optional(),
  })
  .refine((data) => data.decision !== 'RETURN' || Boolean(data.reviewComment), {
    message: 'El comentario es obligatorio para devolver una solucion.',
    path: ['reviewComment'],
  });

export const createViolationBodySchema = z.object({
  complaintId: z
    .string({ required_error: 'complaintId es requerido.' })
    .uuid('complaintId debe ser un UUID valido.'),
  description: z
    .string({ required_error: 'La descripcion de la infraccion es requerida.' })
    .trim()
    .min(5, 'La descripcion debe tener al menos 5 caracteres.')
    .max(2000, 'La descripcion admite como maximo 2000 caracteres.'),
});
