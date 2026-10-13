import { Router } from 'express';
import { createHealthController } from '../controllers/health.controller.js';

/**
 * Rutas de salud montadas bajo /api/v1/health.
 * @param {{ db: { check: () => Promise<boolean> } }} dependencies
 */
export function createHealthRouter({ db }) {
  const router = Router();
  const controller = createHealthController({ db });

  router.get('/', controller.getHealth);
  router.get('/ready', controller.getReady);

  return router;
}
