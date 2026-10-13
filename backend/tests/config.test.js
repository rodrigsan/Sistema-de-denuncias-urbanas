import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from '../src/config/env.js';

test('loadEnv falla si faltan variables requeridas', () => {
  assert.throws(() => loadEnv({}), /DATABASE_URL/);
});

test('el mensaje de error no incluye valores de variables', () => {
  assert.throws(
    () => loadEnv({ DATABASE_URL: 'postgresql://user:supersecreto@localhost/db', SESSION_SECRET: '' }),
    (error) => {
      assert.ok(error.message.includes('SESSION_SECRET'));
      assert.ok(!error.message.includes('supersecreto'));
      return true;
    }
  );
});

test('loadEnv aplica valores por defecto seguros con configuracion valida', () => {
  const config = loadEnv({
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    SESSION_SECRET: 'x'.repeat(40),
    PORT: '4000',
  });

  assert.equal(config.PORT, 4000);
  assert.equal(config.NODE_ENV, 'development');
  assert.equal(config.SESSION_COOKIE_NAME, 'denuncias_session');
  assert.equal(config.FRONTEND_ORIGIN, 'http://localhost:5173');
});

test('loadEnv rechaza un PORT invalido', () => {
  assert.throws(
    () =>
      loadEnv({
        DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
        SESSION_SECRET: 'x'.repeat(40),
        PORT: 'no-es-un-puerto',
      }),
    /PORT/
  );
});

test('loadEnv rechaza el secreto de ejemplo en produccion', () => {
  assert.throws(
    () =>
      loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
        SESSION_SECRET: 'REEMPLAZAR_POR_UN_SECRETO_LARGO_ALEATORIO',
      }),
    /SESSION_SECRET/
  );
});

test('loadEnv exige credenciales de Google en produccion', () => {
  assert.throws(
    () =>
      loadEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
        SESSION_SECRET: 'secreto-largo-distinto-del-ejemplo',
      }),
    /GOOGLE_CLIENT_ID/
  );
});

test('loadEnv aplica valores por defecto de sesion y limites', () => {
  const config = loadEnv({
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    SESSION_SECRET: 'x'.repeat(40),
  });

  assert.equal(config.SESSION_TTL_SECONDS, 28800);
  assert.equal(config.GENERAL_RATE_LIMIT_MAX, 100);
  assert.equal(config.AUTH_RATE_LIMIT_MAX, 10);
});

test('loadEnv rechaza SESSION_TTL_SECONDS invalido', () => {
  assert.throws(
    () =>
      loadEnv({
        DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
        SESSION_SECRET: 'x'.repeat(40),
        SESSION_TTL_SECONDS: 'no-es-un-numero',
      }),
    /SESSION_TTL_SECONDS/
  );
});
