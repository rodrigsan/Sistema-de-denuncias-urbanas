import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { db } from '../src/config/database.js';

after(async () => {
  await db.close();
});

test('la consulta SELECT 1 confirma la conectividad con PostgreSQL', async () => {
  const { rows } = await db.query('SELECT 1 AS ok');
  assert.equal(rows[0].ok, 1);
});

test('db.check detecta la base de datos disponible', async () => {
  assert.equal(await db.check(), true);
});

test('los catalogos sembrados existen en la base de desarrollo', async () => {
  // Consulta parametrizada de solo lectura: comprueba que las migraciones
  // se ejecutaron y que no se altera el esquema.
  const { rows } = await db.query(
    'SELECT count(*)::int AS total FROM categories WHERE active = $1',
    [true]
  );
  assert.ok(rows[0].total >= 5);
});

test('la consulta parametrizada no interpola entradas del usuario', async () => {
  const inyeccion = "1'; DROP TABLE users; --";
  const { rows } = await db.query('SELECT $1::text AS eco', [inyeccion]);
  assert.equal(rows[0].eco, inyeccion);
});

test('GET /api/v1/health/ready responde 503 si la base no esta disponible', async () => {
  const baseCaida = {
    async check() {
      const error = new Error('connection refused');
      error.code = 'ECONNREFUSED';
      throw error;
    },
    query() {
      throw new Error('no disponible');
    },
    async close() {},
  };

  const app = createApp({ db: baseCaida });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/v1/health/ready`
    );
    assert.equal(response.status, 503);

    const body = await response.json();
    assert.deepEqual(body, { status: 'unavailable', database: 'disconnected' });

    // No se filtra el error tecnico original.
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes('ECONNREFUSED'));
    assert.ok(!serialized.includes('connection refused'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
