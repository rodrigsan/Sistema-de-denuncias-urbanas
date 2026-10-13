import crypto from 'node:crypto';

/**
 * Estado temporal del flujo OAuth: `state` y `code_verifier` (PKCE) viven en
 * una cookie HttpOnly firmada con expiracion corta y path restringido a
 * /api/v1/auth. El navegador nunca puede leerlos con JavaScript.
 *
 * Nota: la cookie usa SameSite=Lax (no Strict) porque el callback llega como
 * navegacion top-level desde accounts.google.com; con Strict el navegador no
 * la enviaria y el flujo se romperia.
 */
const OAUTH_TX_COOKIE_NAME = 'denuncias_oauth_tx';
const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos
const OAUTH_TX_COOKIE_PATH = '/api/v1/auth';

export function createOAuthStateService({ config, stateTtlMs = DEFAULT_STATE_TTL_MS } = {}) {
  function createTransaction() {
    return {
      // 22 caracteres base64url. RFC 7636: code_verifier de 43 caracteres.
      state: crypto.randomBytes(16).toString('base64url'),
      codeVerifier: crypto.randomBytes(32).toString('base64url'),
      exp: Date.now() + stateTtlMs,
    };
  }

  function serialize(transaction) {
    return JSON.stringify(transaction);
  }

  function parse(rawValue) {
    if (typeof rawValue !== 'string' || rawValue.length === 0) return null;

    let payload;
    try {
      payload = JSON.parse(rawValue);
    } catch {
      return null;
    }

    if (typeof payload?.state !== 'string' || payload.state.length === 0) return null;
    if (typeof payload?.codeVerifier !== 'string' || payload.codeVerifier.length < 43) return null;
    if (!Number.isInteger(payload?.exp) || payload.exp < Date.now()) return null;

    return { state: payload.state, codeVerifier: payload.codeVerifier };
  }

  /**
   * Comparacion del `state` en tiempo constante para evitar ataques de timing.
   */
  function stateMatches(transaction, candidate) {
    const expected = Buffer.from(transaction.state, 'utf8');
    const received = Buffer.from(String(candidate ?? ''), 'utf8');
    if (expected.length === 0 || expected.length !== received.length) return false;
    return crypto.timingSafeEqual(expected, received);
  }

  function cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: Boolean(config?.isProduction),
      path: OAUTH_TX_COOKIE_PATH,
      maxAge: stateTtlMs,
    };
  }

  function clear(response) {
    response.clearCookie(OAUTH_TX_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      secure: Boolean(config?.isProduction),
      path: OAUTH_TX_COOKIE_PATH,
    });
  }

  return {
    cookieName: OAUTH_TX_COOKIE_NAME,
    createTransaction,
    serialize,
    parse,
    stateMatches,
    cookieOptions,
    clear,
  };
}
