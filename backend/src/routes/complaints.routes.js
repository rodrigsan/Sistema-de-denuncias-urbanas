import { Router } from 'express';
import { createComplaintsController } from '../controllers/complaints.controller.js';
import { createRequireAuth } from '../middlewares/require-auth.js';
import { createEvidenceUpload } from '../middlewares/evidence-upload.js';
import { validateBody } from '../validators/auth.validators.js';
import {
  createComplaintBodySchema,
  updateComplaintBodySchema,
  deleteComplaintBodySchema,
} from '../validators/complaints.validators.js';
import { asyncHandler } from '../utils/async-handler.js';

/**
 * Rutas de denuncias montadas bajo /api/v1/complaints (Fase 4).
 *
 * - Todas exigen sesion (requireAuth); la propiedad se verifica por denuncia.
 * - Metodos mutantes protegidos por CSRF de Origin.
 * - PUT /:id exige sesion de edicion previa (maquina de estados de gracia).
 */
export function createComplaintsRouter({
  usersRepository,
  complaintsService,
  config,
  csrfOrigin,
}) {
  const router = Router();

  const controller = createComplaintsController({ complaintsService });
  const requireAuth = createRequireAuth({ usersRepository });
  const evidenceUpload = createEvidenceUpload({ config });

  router.post(
    '/',
    requireAuth,
    csrfOrigin,
    validateBody(createComplaintBodySchema),
    asyncHandler(controller.createComplaint)
  );

  router.get('/:id', requireAuth, asyncHandler(controller.getComplaint));

  router.put(
    '/:id/edit-session/start',
    requireAuth,
    csrfOrigin,
    asyncHandler(controller.startEditSession)
  );

  router.put(
    '/:id',
    requireAuth,
    csrfOrigin,
    validateBody(updateComplaintBodySchema),
    asyncHandler(controller.updateComplaint)
  );

  router.post(
    '/:id/edit-session/cancel',
    requireAuth,
    csrfOrigin,
    asyncHandler(controller.cancelEditSession)
  );

  router.delete(
    '/:id',
    requireAuth,
    csrfOrigin,
    validateBody(deleteComplaintBodySchema),
    asyncHandler(controller.deleteComplaint)
  );

  router.post(
    '/:id/evidence',
    requireAuth,
    csrfOrigin,
    evidenceUpload,
    asyncHandler(controller.addEvidence)
  );

  router.delete(
    '/:id/evidence/:evidenceId',
    requireAuth,
    csrfOrigin,
    asyncHandler(controller.deleteEvidence)
  );

  return router;
}
