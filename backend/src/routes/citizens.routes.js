import { Router } from 'express';
import { createCitizensController } from '../controllers/citizens.controller.js';
import { createRequireAuth } from '../middlewares/require-auth.js';
import { validateQuery } from '../validators/common.validators.js';
import { myComplaintsQuerySchema } from '../validators/citizen-tracking.validators.js';
import { asyncHandler } from '../utils/async-handler.js';

/**
 * Rutas del ciudadano: perfil propio (Fase 3) y "Mis Denuncias" (Fase 6).
 * Toda la logica de acceso a datos vive en repositorios/servicios.
 */
export function createCitizensRouter({ usersRepository, citizenTrackingService }) {
  const router = Router();

  const controller = createCitizensController({
    usersRepository,
    citizenTrackingService,
  });
  const requireAuth = createRequireAuth({ usersRepository });

  router.get('/me', requireAuth, asyncHandler(controller.getMyProfile));
  router.get(
    '/complaints',
    requireAuth,
    validateQuery(myComplaintsQuerySchema),
    asyncHandler(controller.listMyComplaints)
  );

  return router;
}
