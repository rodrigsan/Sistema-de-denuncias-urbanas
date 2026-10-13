import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/config/database.js';
import { createTestHarness, testSub, plusCodeFor } from './helpers/fixtures.js';

const harness = createTestHarness({ db });
let baseUrl;
let baches;
let moderator;
let liaison;

before(async () => {
  ({ baseUrl } = await harness.start());

  const { rows: catalogRows } = await db.query(
    `SELECT c.id AS "categoryId", s.id AS "subcategoryId"
       FROM categories c
       JOIN subcategories s ON s.category_id = c.id
      WHERE s.code = 'BACHES_PAVIMENTO'
      LIMIT 1`
  );
  baches = catalogRows[0];

  moderator = await harness.loginModerator();
  liaison = await harness.loginLiaison({ unitCodes: ['OBRAS_PUBLICAS'] });
});

after(async () => {
  await harness.stop();
});

function complaintPayload({ latitude = -17.3895, longitude = -66.1568 } = {}) {
  return {
    title: 'Denuncia con contenido abusivo',
    description: 'Descripcion de una denuncia utilizada para probar infracciones.',
    categoryId: baches.categoryId,
    subcategoryId: baches.subcategoryId,
    latitude,
    longitude,
    plusCode: plusCodeFor(latitude, longitude),
    plusCodeSource: 'MANUAL',
  };
}

async function fetchAs(jar, pathName, options = {}) {
  return fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: { Cookie: jar.header(), ...(options.headers ?? {}) },
  });
}

async function getMyId(jar) {
  const me = await (await fetchAs(jar, '/api/v1/auth/me')).json();
  return me.id;
}

async function suspendCitizen(jar, complaintId, description = 'Contenido fraudulento reiterado.') {
  return fetchAs(moderator.jar, '/api/v1/moderation/violations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ complaintId, description }),
  });
}

/** Ciudadano con una denuncia formalizada, listo para ser sancionado. */
async function createViolableCitizen() {
  const citizen = await harness.loginCitizenWithAlias({ alias: 'Vecino Sancionable' });
  const complaint = await harness.createFormalizedComplaint(citizen.jar, complaintPayload());
  await harness.clearSubmissionCooldown(await getMyId(citizen.jar));
  return { citizen, complaint };
}

describe('RBAC de infracciones', () => {
  test('responde 401 sin sesion', async () => {
    const response = await fetch(`${baseUrl}/api/v1/moderation/violations`, { method: 'POST' });
    assert.equal(response.status, 401);
  });

  test('responde 403 para ciudadanos y enlaces tecnicos', async () => {
    const citizen = await harness.loginCitizenWithAlias();
    const asCitizen = await fetchAs(citizen.jar, '/api/v1/moderation/violations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ complaintId: '00000000-0000-0000-0000-000000000000', description: 'x'.repeat(10) }),
    });
    assert.equal(asCitizen.status, 403);

    const asLiaison = await fetchAs(liaison.jar, '/api/v1/moderation/violations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ complaintId: '00000000-0000-0000-0000-000000000000', description: 'x'.repeat(10) }),
    });
    assert.equal(asLiaison.status, 403);
  });

  test('valida descripcion y existencia de la denuncia', async () => {
    const { complaint } = await createViolableCitizen();

    const noDescription = await suspendCitizen(moderator.jar, complaint.id, '   ');
    assert.equal(noDescription.status, 422);

    const missing = await fetchAs(moderator.jar, '/api/v1/moderation/violations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        complaintId: '00000000-0000-0000-0000-000000000000',
        description: 'Denuncia inexistente para la prueba.',
      }),
    });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'COMPLAINT_NOT_FOUND');
  });
});

describe('suspension de 168 horas', () => {
  test('registra infraccion y suspension exacta, y bloquea al ciudadano', async () => {
    const { citizen, complaint } = await createViolableCitizen();
    const moderatorId = await getMyId(moderator.jar);

    const response = await suspendCitizen(moderator.jar, complaint.id);
    assert.equal(response.status, 201);
    const body = await response.json();

    const { rows: violationRows } = await db.query(
      `SELECT citizen_user_id AS "citizenUserId", complaint_id AS "complaintId",
              moderator_user_id AS "moderatorUserId", description
         FROM violations WHERE id = $1`,
      [body.violationId]
    );
    assert.equal(violationRows[0].complaintId, complaint.id);
    assert.equal(violationRows[0].moderatorUserId, moderatorId);

    const { rows: suspensionRows } = await db.query(
      `SELECT status, started_at, ends_at,
              extract(epoch FROM (ends_at - started_at)) / 3600 AS hours
         FROM suspensions WHERE id = $1`,
      [body.suspension.id]
    );
    assert.equal(suspensionRows[0].status, 'ACTIVE');
    assert.equal(Number(suspensionRows[0].hours), 168, 'exactamente 168 horas');

    const { rows: userRows } = await db.query(
      'SELECT status FROM users WHERE id = $1',
      [await getMyId(citizen.jar)]
    );
    assert.equal(userRows[0].status, 'SUSPENDED');

    // Escrituras bloqueadas con 403, lecturas permitidas con 200.
    const create = await fetchAs(citizen.jar, '/api/v1/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(complaintPayload({ longitude: -66.1566 })),
    });
    assert.equal(create.status, 403);
    assert.equal((await create.json()).error.code, 'ACCOUNT_SUSPENDED');

    const list = await fetchAs(citizen.jar, '/api/v1/citizens/complaints?page=1&limit=10');
    assert.equal(list.status, 200);
    const listBody = await list.json();
    assert.ok(listBody.complaints.some((item) => item.id === complaint.id));

    const startEdit = await fetchAs(
      citizen.jar,
      `/api/v1/complaints/${complaint.id}/edit-session/start`,
      { method: 'PUT' }
    );
    assert.equal(startEdit.status, 403);

    const me = await (await fetchAs(citizen.jar, '/api/v1/auth/me')).json();
    assert.equal(me.suspended, true);

    // Nuevo login mientras la suspension esta vigente: bloqueado.
    const relogin = await harness.loginThroughGoogle({ sub: citizen.sub });
    const redirect = new URL(relogin.callbackResponse.headers.get('location'));
    assert.equal(redirect.searchParams.get('reason'), 'account_blocked');
  });

  test('no permite una segunda suspension activa (409)', async () => {
    const { citizen, complaint } = await createViolableCitizen();

    const first = await suspendCitizen(moderator.jar, complaint.id);
    assert.equal(first.status, 201);

    const second = await suspendCitizen(moderator.jar, complaint.id, 'Segunda infraccion.');
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error.code, 'CITIZEN_ALREADY_SUSPENDED');

    const { rows } = await db.query(
      'SELECT count(*)::int AS total FROM suspensions WHERE citizen_user_id = $1',
      [await getMyId(citizen.jar)]
    );
    assert.equal(rows[0].total, 1);
  });

  test('tras 168 h simuladas: login reactiva, completa la suspension y permite crear', async () => {
    const { citizen, complaint } = await createViolableCitizen();
    const citizenId = await getMyId(citizen.jar);

    const suspension = (await (await suspendCitizen(moderator.jar, complaint.id)).json()).suspension;

    // Simular el paso de las 168 horas respetando el CHECK de duracion exacta.
    await db.transaction(async (client) => {
      await client.query(
        `UPDATE suspensions
            SET started_at = now() - interval '169 hours',
                ends_at = now() - interval '1 hour'
          WHERE id = $1`,
        [suspension.id]
      );
    });

    const relogin = await harness.loginThroughGoogle({ sub: citizen.sub });
    const redirect = new URL(relogin.callbackResponse.headers.get('location'));
    assert.equal(redirect.searchParams.get('status'), 'success', 'el login vuelve a funcionar');

    const { rows: userRows } = await db.query('SELECT status FROM users WHERE id = $1', [citizenId]);
    assert.equal(userRows[0].status, 'ACTIVE');

    const { rows: suspensionRows } = await db.query(
      'SELECT status FROM suspensions WHERE id = $1',
      [suspension.id]
    );
    assert.equal(suspensionRows[0].status, 'COMPLETED');

    // Y puede volver a operar (cooldown limpio por fixture de pruebas).
    await harness.clearSubmissionCooldown(citizenId);
    const create = await fetchAs(relogin.jar, '/api/v1/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(complaintPayload({ longitude: -66.1565 })),
    });
    assert.equal(create.status, 201);
  });

  test('una suspension manual (sin fila) permanece bloqueada', async () => {
    const sub = testSub('manual');
    await harness.createFixtureUser({ userType: 'CITIZEN', status: 'SUSPENDED', sub });

    // El resolver solo reactiva suspensiones con fila cumplida: una cuenta
    // SUSPENDED sin fila de suspension sigue bloqueada en el login.
    const login = await harness.loginThroughGoogle({ sub });
    const redirect = new URL(login.callbackResponse.headers.get('location'));
    assert.equal(redirect.searchParams.get('status'), 'error');
    assert.equal(redirect.searchParams.get('reason'), 'account_blocked');
    assert.ok(!login.jar.has('denuncias_session'), 'sin cookie de sesion');
  });
});
