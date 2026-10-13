import { Router } from 'express';
import { createModerationController } from '../controllers/moderation.controller.js';
import { createRequireAuth } from '../middlewares/require-auth.js';
import { requireRole } from '../middlewares/require-role.js';
import { validateBody } from '../validators/auth.validators.js';
import { validateQuery } from '../validators/common.validators.js';
import {
  moderationInboxQuerySchema,
  listDuplicateProposalsQuerySchema,
  approveComplaintBodySchema,
  rejectComplaintBodySchema,
  duplicateProposalBodySchema,
  resolveProposalBodySchema,
  createGroupBodySchema,
  verifySolutionBodySchema,
  createViolationBodySchema,
} from '../validators/moderation.validators.js';
import { asyncHandler } from '../utils/async-handler.js';

/**
 * Rutas de moderacion montadas bajo /api/v1/moderation (Fase 5).
 *
 * RBAC estricto en TODAS las rutas: requireAuth (sesion valida, roles
 * recargados desde PostgreSQL en cada peticion) + requireRole('MODERATOR').
 * Los metodos mutantes ademas llevan CSRF de Origin.
 */
export function createModerationRouter({ usersRepository, moderationService, csrfOrigin }) {
  const router = Router();

  const controller = createModerationController({ moderationService });
  const requireAuth = createRequireAuth({ usersRepository });
  const requireModerator = requireRole('MODERATOR');

  router.get(
    '/complaints',
    requireAuth,
    requireModerator,
    validateQuery(moderationInboxQuerySchema),
    asyncHandler(controller.listInbox)
  );

  router.get(
    '/complaints/:id/duplicate-candidates',
    requireAuth,
    requireModerator,
    asyncHandler(controller.listDuplicateCandidates)
  );

  router.post(
    '/complaints/:id/approve',
    requireAuth,
    requireModerator,
    csrfOrigin,
    validateBody(approveComplaintBodySchema),
    asyncHandler(controller.approve)
  );

  router.post(
    '/complaints/:id/reject',
    requireAuth,
    requireModerator,
    csrfOrigin,
    validateBody(rejectComplaintBodySchema),
    asyncHandler(controller.reject)
  );

  router.post(
    '/complaints/:id/duplicate-proposals',
    requireAuth,
    requireModerator,
    csrfOrigin,
    validateBody(duplicateProposalBodySchema),
    asyncHandler(controller.proposeDuplicate)
  );

  router.get(
    '/duplicate-proposals',
    requireAuth,
    requireModerator,
    validateQuery(listDuplicateProposalsQuerySchema),
    asyncHandler(controller.listProposals)
  );

  router.post(
    '/duplicate-proposals/:id/resolve',
    requireAuth,
    requireModerator,
    csrfOrigin,
    validateBody(resolveProposalBodySchema),
    asyncHandler(controller.resolveProposal)
  );

  router.post(
    '/groups',
    requireAuth,
    requireModerator,
    csrfOrigin,
    validateBody(createGroupBodySchema),
    asyncHandler(controller.createGroup)
  );

  router.post(
    '/solutions/:id/verify',
    requireAuth,
    requireModerator,
    csrfOrigin,
    validateBody(verifySolutionBodySchema),
    asyncHandler(controller.verifySolution)
  );

  router.post(
    '/violations',
    requireAuth,
    requireModerator,
    csrfOrigin,
    validateBody(createViolationBodySchema),
    asyncHandler(controller.createViolation)
  );

  return router;
}
