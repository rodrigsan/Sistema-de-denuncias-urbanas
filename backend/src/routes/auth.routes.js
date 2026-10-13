import { Router } from 'express';
import { createAuthController } from '../controllers/auth.controller.js';
import { createRequireAuth } from '../middlewares/require-auth.js';
import { validateBody, setAliasBodySchema } from '../validators/auth.validators.js';

/**
 * Rutas de autenticacion montadas bajo /api/v1/auth.
 *
 * - /google/login y /google/callback: flujo OAuth con rate limit propio.
 * - /me y /alias: requieren sesion valida (require-auth).
 * - /alias y /logout: metodos mutantes protegidos por CSRF de Origin.
 */
export function createAuthRouter({
  config,
  google,
  sessionService,
  oauthStateService,
  usersRepository,
  csrfOrigin,
  authRateLimiter,
}) {
  const router = Router();

  const controller = createAuthController({
    config,
    google,
    sessionService,
    oauthStateService,
    usersRepository,
  });

  const requireAuth = createRequireAuth({ usersRepository });

  router.get('/google/login', authRateLimiter, controller.googleLogin);
  router.get('/google/callback', authRateLimiter, controller.googleCallback);

  router.get('/me', requireAuth, controller.me);
  router.post(
    '/alias',
    requireAuth,
    csrfOrigin,
    validateBody(setAliasBodySchema),
    controller.setAlias
  );
  router.post('/logout', csrfOrigin, controller.logout);

  return router;
}
