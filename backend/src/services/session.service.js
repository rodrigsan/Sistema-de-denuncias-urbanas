/**
 * Servicio de sesion con cookie firmada (HMAC via cookie-parser).
 *
 * La cookie solo contiene { userId, iat }: roles, alias y estado de la cuenta
 * se consultan a PostgreSQL en cada peticion autenticada, de modo que una
 * revocacion de rol o una suspension aplican de inmediato. La cookie es
 * HttpOnly, SameSite=Lax y Secure en produccion.
 */
const DEFAULT_TTL_SECONDS = 28800; // 8 horas

export function createSessionService({ config }) {
  const ttlSeconds = config.SESSION_TTL_SECONDS ?? DEFAULT_TTL_SECONDS;
  const cookieName = config.SESSION_COOKIE_NAME;

  function parse(rawValue) {
    if (typeof rawValue !== 'string' || rawValue.length === 0) return null;

    let payload;
    try {
      payload = JSON.parse(rawValue);
    } catch {
      return null;
    }

    if (typeof payload?.userId !== 'string' || payload.userId.length === 0) return null;
    if (!Number.isInteger(payload?.iat) || payload.iat <= 0) return null;

    const expiresAtMs = (payload.iat + ttlSeconds) * 1000;
    if (Date.now() > expiresAtMs) return null;

    return { userId: payload.userId, iat: payload.iat };
  }

  function cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: Boolean(config.isProduction),
      path: '/',
      maxAge: ttlSeconds * 1000,
    };
  }

  function issue(response, userId) {
    const payload = JSON.stringify({ userId, iat: Math.floor(Date.now() / 1000) });
    response.cookie(cookieName, payload, { signed: true, ...cookieOptions() });
  }

  function clear(response) {
    response.clearCookie(cookieName, {
      httpOnly: true,
      sameSite: 'lax',
      secure: Boolean(config.isProduction),
      path: '/',
    });
  }

  return { cookieName, ttlSeconds, parse, cookieOptions, issue, clear };
}
