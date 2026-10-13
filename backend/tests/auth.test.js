import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { db } from '../src/config/database.js';
import { createGoogleOAuthService } from '../src/services/google-oauth.service.js';
import { createSessionService } from '../src/services/session.service.js';
import { listenApp, CookieJar, parseSignedCookieValue } from './helpers/test-app.js';
import { testConfig, createTestHarness, testSub } from './helpers/fixtures.js';

// Harness compartido (Fase 3): Google simulado, fixtures de BD y limpieza.
const harness = createTestHarness({ db });
const { fakeGoogle } = harness;
let baseUrl;

before(async () => {
  ({ baseUrl } = await harness.start());
});

after(async () => {
  await harness.stop();
});

describe('GET /api/v1/auth/google/login', () => {
  test('redirige a Google con PKCE S256 y fija la cookie oauth_tx', async () => {
    const localJar = new CookieJar();
    const response = await fetch(`${baseUrl}/api/v1/auth/google/login`, { redirect: 'manual' });
    localJar.absorb(response);

    assert.equal(response.status, 302);

    const location = new URL(response.headers.get('location'));
    assert.equal(`${location.origin}${location.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(location.searchParams.get('response_type'), 'code');
    assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(location.searchParams.get('client_id'), testConfig.GOOGLE_CLIENT_ID);
    assert.equal(location.searchParams.get('redirect_uri'), testConfig.GOOGLE_REDIRECT_URI);
    assert.ok(location.searchParams.get('scope').includes('openid'));
    assert.ok(location.searchParams.get('prompt'), 'select_account');

    const state = location.searchParams.get('state');
    assert.ok(state && state.length >= 16, 'state aleatorio presente');

    const setCookie = response.headers
      .getSetCookie()
      .find((header) => header.startsWith('denuncias_oauth_tx='));
    assert.ok(setCookie, 'cookie oauth_tx presente');
    assert.ok(/httponly/i.test(setCookie));
    assert.ok(/samesite=lax/i.test(setCookie));
    assert.ok(/path=\/api\/v1\/auth/i.test(setCookie));
    assert.ok(!/secure/i.test(setCookie), 'sin Secure en desarrollo');

    // El estado de la cookie coincide con el de la URL y el desafio PKCE
    // corresponde al verificador almacenado.
    const transaction = parseSignedCookieValue(localJar.get('denuncias_oauth_tx'));
    assert.equal(transaction.state, state);
    assert.ok(transaction.codeVerifier.length >= 43);
    const challenge = location.searchParams.get('code_challenge');
    assert.equal(fakeGoogle.computeCodeChallenge(transaction.codeVerifier), challenge);
  });

  test('responde 503 OAUTH_NOT_CONFIGURED sin credenciales', async () => {
    const unconfiguredApp = createApp({
      db,
      config: testConfig,
      google: createGoogleOAuthService({
        config: {
          ...testConfig,
          GOOGLE_CLIENT_ID: '',
          GOOGLE_CLIENT_SECRET: '',
          GOOGLE_REDIRECT_URI: '',
        },
      }),
    });
    const { server: localServer, baseUrl: localBaseUrl } = await listenApp(unconfiguredApp);

    try {
      const response = await fetch(`${localBaseUrl}/api/v1/auth/google/login`, {
        redirect: 'manual',
      });
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.error.code, 'OAUTH_NOT_CONFIGURED');
    } finally {
      await new Promise((resolve) => localServer.close(resolve));
    }
  });
});

describe('GET /api/v1/auth/google/callback', () => {
  test('crea el ciudadano, fija la sesion y redirige al frontend', async () => {
    const sub = testSub();
    const { jar: localJar, callbackResponse } = await harness.loginThroughGoogle({ sub });

    assert.equal(callbackResponse.status, 302);
    const location = new URL(callbackResponse.headers.get('location'));
    assert.equal(location.origin, testConfig.FRONTEND_ORIGIN);
    assert.equal(location.pathname, '/auth/callback');
    assert.equal(location.searchParams.get('status'), 'success');

    assert.ok(localJar.has('denuncias_session'), 'cookie de sesion emitida');
    assert.ok(!localJar.has('denuncias_oauth_tx'), 'cookie temporal limpiada');

    const sessionCookie = callbackResponse.headers
      .getSetCookie()
      .find((header) => header.startsWith('denuncias_session='));
    assert.ok(/httponly/i.test(sessionCookie));
    assert.ok(/samesite=lax/i.test(sessionCookie));
    assert.ok(/path=\//i.test(sessionCookie));

    // El verificador PKCE viajo intacto al intercambio.
    const lastCall = fakeGoogle.exchangeCalls[fakeGoogle.exchangeCalls.length - 1];
    assert.equal(lastCall.code, 'mock-auth-code');
    assert.ok(lastCall.codeVerifier.length >= 43);

    // Persistencia correcta en la base de datos.
    assert.equal(await harness.countIdentities(sub), 1);

    // /me refleja el primer acceso pendiente de alias.
    const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: localJar.header() },
    });
    assert.equal(meResponse.status, 200);
    const me = await meResponse.json();
    assert.equal(me.userType, 'CITIZEN');
    assert.equal(me.alias, null);
    assert.equal(me.requiresAlias, true);
    assert.deepEqual(me.roles, []);
    assert.equal(me.adminLocked, false);
    assert.ok(me.id);

    // Sin PII en la respuesta.
    const serialized = JSON.stringify(me);
    assert.ok(!serialized.includes('mock@example.com'));
    assert.ok(!serialized.includes(sub));
  });

  test('rechaza un state manipulado sin crear usuario ni sesion', async () => {
    const sub = testSub();
    const localJar = new CookieJar();

    fakeGoogle.profile = { sub, email: 'mock@example.com', emailVerified: true };
    const loginResponse = await fetch(`${baseUrl}/api/v1/auth/google/login`, { redirect: 'manual' });
    localJar.absorb(loginResponse);

    const response = await fetch(
      `${baseUrl}/api/v1/auth/google/callback?code=mock-auth-code&state=estado-falsificado`,
      { redirect: 'manual', headers: { Cookie: localJar.header() } }
    );
    localJar.absorb(response);

    assert.equal(response.status, 302);
    const location = new URL(response.headers.get('location'));
    assert.equal(location.searchParams.get('status'), 'error');
    assert.equal(location.searchParams.get('reason'), 'state_invalid');

    assert.ok(!localJar.has('denuncias_session'));
    assert.equal(await harness.countIdentities(sub), 0);
  });

  test('rechaza el callback sin cookie de transaccion', async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/auth/google/callback?code=mock-auth-code&state=algo`,
      { redirect: 'manual' }
    );
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get('location'));
    assert.equal(location.searchParams.get('status'), 'error');
    assert.equal(location.searchParams.get('reason'), 'state_invalid');
  });

  test('reutiliza la misma cuenta en un segundo login con el mismo sub', async () => {
    const sub = testSub();
    const first = await harness.loginThroughGoogle({ sub });
    const second = await harness.loginThroughGoogle({ sub });

    const firstMe = await (
      await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: first.jar.header() } })
    ).json();
    const secondMe = await (
      await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: second.jar.header() } })
    ).json();

    assert.equal(firstMe.id, secondMe.id);
    assert.equal(await harness.countIdentities(sub), 1);
  });

  test('bloquea el login de una cuenta suspendida', async () => {
    const sub = testSub('suspended');
    await harness.createFixtureUser({ userType: 'CITIZEN', status: 'SUSPENDED', sub });

    const { jar: localJar, callbackResponse } = await harness.loginThroughGoogle({ sub });
    localJar.absorb(callbackResponse);

    const location = new URL(callbackResponse.headers.get('location'));
    assert.equal(location.searchParams.get('status'), 'error');
    assert.equal(location.searchParams.get('reason'), 'account_blocked');
    assert.ok(!localJar.has('denuncias_session'));
  });

  test('redirige con error si el intercambio de codigo falla', async () => {
    const sub = testSub();
    const { callbackResponse } = await harness.loginThroughGoogle({ sub, code: 'mock-invalid-grant' });

    const location = new URL(callbackResponse.headers.get('location'));
    assert.equal(location.searchParams.get('status'), 'error');
    assert.equal(location.searchParams.get('reason'), 'token_exchange');
    assert.equal(await harness.countIdentities(sub), 0);
  });
});

describe('POST /api/v1/auth/alias', () => {
  async function postAlias(localJar, alias, extraHeaders = {}) {
    return fetch(`${baseUrl}/api/v1/auth/alias`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: localJar.header(),
        ...extraHeaders,
      },
      body: JSON.stringify({ alias }),
    });
  }

  test('establece el alias y genera un codigo administrativo unico', async () => {
    const sub = testSub();
    const { jar: localJar } = await harness.loginThroughGoogle({ sub });

    const response = await postAlias(localJar, '  Vecino de Cercado  ');
    assert.equal(response.status, 201);

    const body = await response.json();
    assert.equal(body.alias, 'Vecino de Cercado');
    assert.match(body.administrativeCode, /^CER-[0-9A-HJKMNP-TV-Z]{8}$/);

    const me = await (
      await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: localJar.header() } })
    ).json();
    assert.equal(me.alias, 'Vecino de Cercado');
    assert.equal(me.requiresAlias, false);
  });

  test('rechaza un alias invalido con detalle accionable', async () => {
    const sub = testSub();
    const { jar: localJar } = await harness.loginThroughGoogle({ sub });

    const response = await postAlias(localJar, 'ab');
    assert.equal(response.status, 422);

    const body = await response.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(body.error.details) && body.error.details.length > 0);
    assert.ok(!JSON.stringify(body).includes('mock@example.com'));
  });

  test('rechaza un segundo alias con 409', async () => {
    const sub = testSub();
    const { jar: localJar } = await harness.loginThroughGoogle({ sub });

    const first = await postAlias(localJar, 'Primer Alias');
    assert.equal(first.status, 201);

    const second = await postAlias(localJar, 'Segundo Alias');
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error.code, 'ALIAS_ALREADY_SET');
  });

  test('rechaza con 403 si un ADMIN intenta fijar alias', async () => {
    const sub = testSub('admin');
    await harness.createFixtureUser({ userType: 'ADMIN', sub, roles: ['MODERATOR'] });
    const { jar: localJar } = await harness.loginThroughGoogle({ sub });

    const response = await postAlias(localJar, 'Admin Alias');
    assert.equal(response.status, 403);
  });

  test('responde 403 CSRF cuando el Origin no es el autorizado', async () => {
    const sub = testSub();
    const { jar: localJar } = await harness.loginThroughGoogle({ sub });

    const response = await postAlias(localJar, 'Vecino Validado', {
      Origin: 'https://evil.example',
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'CSRF_CHECK_FAILED');
  });
});

describe('GET /api/v1/auth/me', () => {
  test('expone los roles activos de un administrador', async () => {
    const sub = testSub('admin');
    await harness.createFixtureUser({ userType: 'ADMIN', sub, roles: ['MODERATOR', 'TECHNICAL_LIAISON'] });

    const { jar: localJar } = await harness.loginThroughGoogle({ sub });
    const response = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: localJar.header() },
    });

    const body = await response.json();
    assert.equal(body.userType, 'ADMIN');
    assert.deepEqual(body.roles, ['MODERATOR', 'TECHNICAL_LIAISON']);
    assert.equal(body.adminLocked, false);
    assert.equal(body.requiresAlias, false);
    assert.equal(body.alias, null);
  });

  test('marca adminLocked para un ADMIN sin roles activos', async () => {
    const sub = testSub('admin');
    await harness.createFixtureUser({ userType: 'ADMIN', sub });

    const { jar: localJar } = await harness.loginThroughGoogle({ sub });
    const body = await (
      await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: localJar.header() } })
    ).json();

    assert.deepEqual(body.roles, []);
    assert.equal(body.adminLocked, true);
  });

  test('devuelve 401 con una cookie de sesion manipulada', async () => {
    const sub = testSub();
    const { jar: localJar } = await harness.loginThroughGoogle({ sub });

    const raw = localJar.get('denuncias_session');
    localJar.setRaw('denuncias_session', `${raw}x`);

    const response = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: localJar.header() },
    });
    assert.equal(response.status, 401);
  });

  test('devuelve 401 sin cookie de sesion', async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/me`);
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error.code, 'UNAUTHENTICATED');
  });
});

describe('POST /api/v1/auth/logout', () => {
  test('limpia la cookie de sesion', async () => {
    const sub = testSub();
    const { jar: localJar } = await harness.loginThroughGoogle({ sub });

    const response = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { Cookie: localJar.header() },
    });
    assert.equal(response.status, 204);

    const setCookie = response.headers
      .getSetCookie()
      .find((header) => header.startsWith('denuncias_session='));
    assert.ok(/expires=thu, 01 jan 1970/i.test(setCookie));

    localJar.absorb(response);
    assert.ok(!localJar.has('denuncias_session'));

    const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: localJar.header() },
    });
    assert.equal(meResponse.status, 401);
  });
});

describe('session.service', () => {
  test('usa HttpOnly, SameSite=Lax y Secure solo en produccion', () => {
    const devOptions = createSessionService({
      config: { ...testConfig, isProduction: false },
    }).cookieOptions();
    assert.equal(devOptions.httpOnly, true);
    assert.equal(devOptions.sameSite, 'lax');
    assert.equal(devOptions.secure, false);
    assert.equal(devOptions.path, '/');

    const prodOptions = createSessionService({
      config: { ...testConfig, isProduction: true },
    }).cookieOptions();
    assert.equal(prodOptions.secure, true);
  });

  test('parse rechaza sesiones expiradas o malformadas', () => {
    const service = createSessionService({
      config: { ...testConfig, SESSION_TTL_SECONDS: 60 },
    });

    const expiredIat = Math.floor(Date.now() / 1000) - 120;
    assert.equal(service.parse(JSON.stringify({ userId: 'uuid', iat: expiredIat })), null);
    assert.equal(service.parse('no-es-json'), null);
    assert.equal(service.parse(JSON.stringify({ userId: 123, iat: 1 })), null);
    assert.equal(service.parse(JSON.stringify({ userId: 'uuid' })), null);

    const validIat = Math.floor(Date.now() / 1000);
    const parsed = service.parse(JSON.stringify({ userId: 'uuid', iat: validIat }));
    assert.equal(parsed.userId, 'uuid');
  });
});
