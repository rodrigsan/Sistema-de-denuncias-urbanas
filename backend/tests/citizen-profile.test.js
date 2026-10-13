import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/config/database.js';
import { createTestHarness, testSub } from './helpers/fixtures.js';

const harness = createTestHarness({ db });
let baseUrl;

before(async () => {
  ({ baseUrl } = await harness.start());
});

after(async () => {
  await harness.stop();
});

async function setAlias(localJar, alias) {
  return fetch(`${baseUrl}/api/v1/auth/alias`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: localJar.header() },
    body: JSON.stringify({ alias }),
  });
}

async function fetchMyProfile(localJar) {
  return fetch(`${baseUrl}/api/v1/citizens/me`, { headers: { Cookie: localJar.header() } });
}

describe('GET /api/v1/citizens/me', () => {
  test('responde 401 sin sesion', async () => {
    const response = await fetch(`${baseUrl}/api/v1/citizens/me`);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
  });

  test('responde 404 para un ciudadano que todavia no fijo alias', async () => {
    const sub = testSub();
    const { jar } = await harness.loginThroughGoogle({ sub });

    const response = await fetchMyProfile(jar);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'CITIZEN_PROFILE_NOT_FOUND');
  });

  test('responde 404 para una cuenta ADMIN', async () => {
    const sub = testSub('admin');
    await harness.createFixtureUser({ userType: 'ADMIN', sub, roles: ['MODERATOR'] });
    const { jar } = await harness.loginThroughGoogle({ sub });

    const response = await fetchMyProfile(jar);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'CITIZEN_PROFILE_NOT_FOUND');
  });

  test('devuelve el perfil del ciudadano con minimizacion estricta', async () => {
    const sub = testSub();
    const { jar } = await harness.loginThroughGoogle({ sub });

    const aliasResponse = await setAlias(jar, 'Perfil de Prueba');
    assert.equal(aliasResponse.status, 201);

    const response = await fetchMyProfile(jar);
    assert.equal(response.status, 200);
    const body = await response.json();

    // Conjunto exacto de claves: nada de email, provider_subject ni roles.
    assert.deepEqual(Object.keys(body).sort(), [
      'administrativeCode',
      'alias',
      'createdAt',
      'id',
      'userType',
    ]);

    assert.equal(body.userType, 'CITIZEN');
    assert.equal(body.alias, 'Perfil de Prueba');
    assert.match(body.administrativeCode, /^CER-[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.ok(!Number.isNaN(Date.parse(body.createdAt)), 'createdAt en ISO-8601');

    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes('mock@example.com'));
    assert.ok(!serialized.includes(sub));
    assert.ok(!serialized.includes('roles'));
    assert.ok(!serialized.includes('provider'));
  });

  test('mantiene coherencia con /api/v1/auth/me', async () => {
    const sub = testSub();
    const { jar } = await harness.loginThroughGoogle({ sub });

    assert.equal((await setAlias(jar, 'Coherente CBBA')).status, 201);

    const me = await (
      await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: jar.header() } })
    ).json();
    const profile = await (await fetchMyProfile(jar)).json();

    assert.equal(me.requiresAlias, false);
    assert.equal(me.alias, profile.alias);
    assert.equal(me.id, profile.id);
  });
});

describe('inmutabilidad del alias', () => {
  test('un segundo POST /alias responde 409 y no altera la base de datos', async () => {
    const sub = testSub();
    const { jar } = await harness.loginThroughGoogle({ sub });

    const first = await setAlias(jar, 'Alias Original');
    assert.equal(first.status, 201);
    const original = await first.json();

    const second = await setAlias(jar, 'Alias Hackeado');
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error.code, 'ALIAS_ALREADY_SET');

    // El perfil sigue intacto.
    const profile = await (await fetchMyProfile(jar)).json();
    assert.equal(profile.alias, 'Alias Original');
    assert.equal(profile.administrativeCode, original.administrativeCode);

    // Verificacion directa en la base de datos.
    const { rows } = await db.query(
      'SELECT alias, administrative_code FROM citizen_profiles WHERE user_id = $1',
      [profile.id]
    );
    assert.equal(rows[0].alias, 'Alias Original');
    assert.equal(rows[0].administrative_code, original.administrativeCode);
  });

  test('no existe ruta de modificacion del alias (PUT responde 404)', async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/alias`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias: 'Intento' }),
    });
    assert.equal(response.status, 404);
  });
});
