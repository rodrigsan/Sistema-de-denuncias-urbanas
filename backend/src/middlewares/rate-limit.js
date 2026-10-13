import rateLimit from 'express-rate-limit';

const TOO_MANY_REQUESTS_MESSAGE = {
  error: {
    code: 'TOO_MANY_REQUESTS',
    message: 'Demasiadas peticiones. Intente nuevamente mas tarde.',
  },
};

/**
 * Limite general para todas las rutas. Los limites provienen de la
 * configuracion para que las pruebas no los disparen accidentalmente.
 */
export function createGeneralRateLimiter({ config }) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: config.GENERAL_RATE_LIMIT_MAX ?? 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: TOO_MANY_REQUESTS_MESSAGE,
  });
}

/**
 * Limite mas estricto para las rutas de autenticacion (mitigacion de fuerza
 * bruta sobre el flujo OAuth).
 */
export function createAuthRateLimiter({ config }) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.AUTH_RATE_LIMIT_MAX ?? 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: TOO_MANY_REQUESTS_MESSAGE,
  });
}
