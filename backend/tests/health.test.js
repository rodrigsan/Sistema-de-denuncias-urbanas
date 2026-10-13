import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { db } from '../src/config/database.js';
import { env } from '../src/config/env.js';

let server;
let baseUrl;

before(async () => {
  const app = createApp({ db, config: env });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});

describe('GET /api/v1/health', () => {
  test('devuelve 200 con el estado del servicio', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.deepEqual(body, { status: 'ok', service: 'denuncias-cercado-api' });
  });

  test('no expone la cabecera X-Powered-By', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(response.headers.get('x-powered-by'), null);
  });
});

describe('GET /api/v1/health/ready', () => {
  test('devuelve 200 cuando PostgreSQL esta disponible', async () => {
    const response = await fetch(`${baseUrl}/api/v1/health/ready`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.deepEqual(body, { status: 'ready', database: 'connected' });
  });
});

describe('GET /api/v1/auth/me', () => {
  test('devuelve 401 sin sesion valida', async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/me`);
    assert.equal(response.status, 401);

    const body = await response.json();
    assert.equal(body.error.code, 'UNAUTHENTICATED');
  });
});

describe('manejo de errores', () => {
  test('una ruta inexistente responde 404 sin detalles internos', async () => {
    const response = await fetch(`${baseUrl}/api/v1/ruta-inexistente`);
    assert.equal(response.status, 404);

    const body = await response.json();
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.equal(body.error.message, 'Recurso no encontrado.');

    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes('stack'));
    assert.ok(!/\.js:\d+/.test(serialized));
  });
});
