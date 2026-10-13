import crypto from 'node:crypto';

/**
 * Cliente de Google OAuth 2.0 (Authorization Code + PKCE).
 *
 * La identidad es el `sub` verificado por Google; el correo nunca se usa como
 * identificador estable. Los tokens de Google viven solo en memoria durante
 * el callback: no se persisten ni se registran en logs. El cliente HTTP se
 * inyecta para que las pruebas puedan simular a Google.
 */
const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const SCOPE = 'openid email profile';
const HTTP_TIMEOUT_MS = 5000;

export function createGoogleOAuthService({ config, http = globalThis.fetch } = {}) {
  function isConfigured() {
    return Boolean(
      config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_REDIRECT_URI
    );
  }

  /**
   * S256: base64url(sha256(code_verifier)), segun RFC 7636.
   */
  function computeCodeChallenge(codeVerifier) {
    return crypto.createHash('sha256').update(codeVerifier, 'utf8').digest('base64url');
  }

  function buildAuthorizationUrl({ state, codeChallenge }) {
    const params = new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      redirect_uri: config.GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
  }

  async function exchangeCode({ code, codeVerifier }) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.GOOGLE_REDIRECT_URI,
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      code_verifier: codeVerifier,
    });

    let response;
    try {
      response = await http(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (error) {
      throw Object.assign(new Error('No se pudo contactar el endpoint de tokens de Google.'), {
        code: 'GOOGLE_REQUEST_FAILED',
        cause: error?.code,
      });
    }

    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.access_token) {
      throw Object.assign(new Error('El intercambio del codigo de autorizacion fallo.'), {
        code: 'GOOGLE_TOKEN_EXCHANGE_FAILED',
      });
    }

    return { accessToken: data.access_token };
  }

  async function fetchProfile({ accessToken }) {
    let response;
    try {
      response = await http(USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (error) {
      throw Object.assign(new Error('No se pudo contactar el endpoint de perfil de Google.'), {
        code: 'GOOGLE_REQUEST_FAILED',
        cause: error?.code,
      });
    }

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw Object.assign(new Error('La obtencion del perfil de Google fallo.'), {
        code: 'GOOGLE_PROFILE_FAILED',
      });
    }

    // Regla de seguridad: sin `sub` verificado no hay identidad.
    if (!data?.sub) {
      throw Object.assign(
        new Error('La respuesta de Google no contiene un identificador estable.'),
        { code: 'GOOGLE_PROFILE_INVALID' }
      );
    }

    return {
      sub: String(data.sub),
      email: data.email && data.email_verified ? String(data.email) : null,
      emailVerified: Boolean(data.email_verified),
    };
  }

  return { isConfigured, computeCodeChallenge, buildAuthorizationUrl, exchangeCode, fetchProfile };
}
