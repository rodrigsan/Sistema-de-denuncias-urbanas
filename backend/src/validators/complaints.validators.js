import { z } from 'zod';

/**
 * Validadores de denuncias (Fase 4). La coherencia Plus Code y la validez de
 * catalogos se resuelven en servidor (servicios/repositorio), no aqui.
 */
const locationSchema = z.object({
  latitude: z
    .number({ invalid_type_error: 'latitude debe ser un numero.' })
    .min(-90, 'La latitud debe estar entre -90 y 90.')
    .max(90, 'La latitud debe estar entre -90 y 90.'),
  longitude: z
    .number({ invalid_type_error: 'longitude debe ser un numero.' })
    .min(-180, 'La longitud debe estar entre -180 y 180.')
    .max(180, 'La longitud debe estar entre -180 y 180.'),
  plusCode: z
    .string({ required_error: 'plusCode es requerido.' })
    .trim()
    .min(9, 'El Plus Code es demasiado corto.')
    .max(32, 'El Plus Code debe tener como maximo 32 caracteres.'),
  plusCodeSource: z.enum(['MANUAL', 'AUTOMATIC']).default('MANUAL'),
  acceptServerPlusCode: z.boolean().optional().default(false),
});

const contentSchema = z.object({
  title: z
    .string({ required_error: 'El titulo es requerido.' })
    .trim()
    .min(3, 'El titulo debe tener al menos 3 caracteres.')
    .max(180, 'El titulo debe tener como maximo 180 caracteres.'),
  description: z
    .string({ required_error: 'La descripcion es requerida.' })
    .trim()
    .min(10, 'La descripcion debe tener al menos 10 caracteres.')
    .max(5000, 'La descripcion debe tener como maximo 5000 caracteres.'),
  categoryId: z.string({ required_error: 'categoryId es requerido.' }).uuid('categoryId debe ser un UUID valido.'),
  subcategoryId: z
    .string({ required_error: 'subcategoryId es requerido.' })
    .uuid('subcategoryId debe ser un UUID valido.'),
});

export const createComplaintBodySchema = contentSchema.merge(locationSchema);

// PUT reemplaza el borrador completo: mismo esquema.
export const updateComplaintBodySchema = createComplaintBodySchema;

export const deleteComplaintBodySchema = z.object({
  deletionReason: z
    .string()
    .trim()
    .min(3, 'El motivo debe tener al menos 3 caracteres.')
    .max(100, 'El motivo debe tener como maximo 100 caracteres.')
    .optional(),
});

export const DEFAULT_DELETION_REASON = 'CITIZEN_CANCELLED';
