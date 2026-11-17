import { Router } from 'express';
import { createReportsController } from '../controllers/reports.controller.js';
import { createRequireAuth } from '../middlewares/require-auth.js';
import { requireRole } from '../middlewares/require-role.js';
import { validateReportsQuery } from '../validators/reports.validators.js';
import { asyncHandler } from '../utils/async-handler.js';

/**
 * Rutas de reportes montadas bajo /api/v1/reports (MVP).
 *
 * RBAC: requireAuth (sesión válida) + requireRole('MODERATOR', 'TECHNICAL_LIAISON').
 * Los ciudadanos no pueden acceder a este módulo.
 */
export function createReportsRouter({ usersRepository, reportsService, csrfOrigin }) {
  const router = Router();

  const controller = createReportsController({ reportsService });
  const requireAuth = createRequireAuth({ usersRepository });
  const requireModeratorOrLiaison = requireRole('MODERATOR', 'TECHNICAL_LIAISON');

  router.get(
    '/summary',
    requireAuth,
    requireModeratorOrLiaison,
    validateReportsQuery,
    asyncHandler(controller.getSummary),
  );

  router.get(
    '/heatmap',
    requireAuth,
    requireModeratorOrLiaison,
    validateReportsQuery,
    asyncHandler(controller.getHeatmap),
  );

  router.get(
    '/categories',
    requireAuth,
    requireModeratorOrLiaison,
    validateReportsQuery,
    asyncHandler(controller.getCategories),
  );

  router.get(
    '/timeline',
    requireAuth,
    requireModeratorOrLiaison,
    validateReportsQuery,
    asyncHandler(controller.getTimeline),
  );

  return router;
}
