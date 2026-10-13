import { Router } from 'express';
import { createTechnicalController } from '../controllers/technical.controller.js';
import { createRequireAuth } from '../middlewares/require-auth.js';
import { requireRole } from '../middlewares/require-role.js';
import { createEvidenceUpload } from '../middlewares/evidence-upload.js';
import { validateBody } from '../validators/auth.validators.js';
import { validateQuery } from '../validators/common.validators.js';
import {
  technicalComplaintsQuerySchema,
  submitSolutionBodySchema,
} from '../validators/technical.validators.js';
import { asyncHandler } from '../utils/async-handler.js';

/**
 * Rutas del Enlace Tecnico/Supervisor montadas bajo /api/v1/technical.
 *
 * RBAC estricto: requireAuth + requireRole('TECHNICAL_LIAISON') en todas;
 * el alcance se limita ademas a las unidades de sus membresias activas
 * (minimizacion: denuncias de otras unidades responden 404).
 */
export function createTechnicalRouter({
  usersRepository,
  technicalService,
  config,
  csrfOrigin,
}) {
  const router = Router();

  const controller = createTechnicalController({ technicalService });
  const requireAuth = createRequireAuth({ usersRepository });
  const requireLiaison = requireRole('TECHNICAL_LIAISON');
  const evidenceUpload = createEvidenceUpload({ config });

  router.get(
    '/complaints',
    requireAuth,
    requireLiaison,
    validateQuery(technicalComplaintsQuerySchema),
    asyncHandler(controller.listAssignedComplaints)
  );

  router.post(
    '/complaints/:id/start-process',
    requireAuth,
    requireLiaison,
    csrfOrigin,
    asyncHandler(controller.startProcess)
  );

  router.post(
    '/complaints/:id/submit-solution',
    requireAuth,
    requireLiaison,
    csrfOrigin,
    validateBody(submitSolutionBodySchema),
    asyncHandler(controller.submitSolution)
  );

  router.post(
    '/solutions/:solutionId/evidence',
    requireAuth,
    requireLiaison,
    csrfOrigin,
    evidenceUpload,
    asyncHandler(controller.addSolutionEvidence)
  );

  return router;
}
