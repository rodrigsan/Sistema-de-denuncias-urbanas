import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/config/database.js';
import { createTestHarness, plusCodeFor } from './helpers/fixtures.js';

const harness = createTestHarness({ db });
let baseUrl;
let catalog;

before(async () => {
  ({ baseUrl } = await harness.start());

  const { rows } = await db.query(
    `SELECT c.id AS "categoryId", s.id AS "subcategoryId"
       FROM categories c
       JOIN subcategories s ON s.category_id = c.id
      WHERE c.active = TRUE AND s.active = TRUE
      LIMIT 1`
  );
  catalog = rows[0];
});

after(async () => {
  await harness.stop();
});

function validComplaintPayload(overrides = {}) {
  const latitude = -17.3895;
  const longitude = -66.1568;
  return {
    title: 'Bache peligroso en la avenida',
    description: 'Hay un bache grande que daña los vehiculos cada noche.',
    categoryId: catalog.categoryId,
    subcategoryId: catalog.subcategoryId,
    latitude,
    longitude,
    plusCode: plusCodeFor(latitude, longitude),
    plusCodeSource: 'MANUAL',
    ...overrides,
  };
}

async function fetchAs(jar, pathName, options = {}) {
  return fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: { Cookie: jar.header(), ...(options.headers ?? {}) },
  });
}

async function createComplaint(jar) {
  const response = await fetchAs(jar, '/api/v1/complaints', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validComplaintPayload()),
  });
  assert.equal(response.status, 201);
  return (await response.json()).id;
}

async function getGraceRow(complaintId) {
  const { rows } = await db.query(
    `SELECT status,
            grace_remaining_seconds AS "graceRemainingSeconds",
            grace_running_since AS "graceRunningSince",
            formalized_at AS "formalizedAt"
       FROM complaints WHERE id = $1`,
    [complaintId]
  );
  return rows[0];
}

async function getOpenSession(complaintId) {
  const { rows } = await db.query(
    `SELECT id, started_at, ended_at, end_reason
       FROM complaint_grace_sessions
      WHERE complaint_id = $1 AND ended_at IS NULL`,
    [complaintId]
  );
  return rows[0] ?? null;
}

async function getSessions(complaintId) {
  const { rows } = await db.query(
    `SELECT end_reason, ended_at
       FROM complaint_grace_sessions
      WHERE complaint_id = $1 AND ended_at IS NOT NULL
      ORDER BY ended_at`,
    [complaintId]
  );
  return rows;
}

async function getStatusHistory(complaintId) {
  const { rows } = await db.query(
    `SELECT previous_status, new_status, changed_by_user_id, reason
       FROM complaint_status_history WHERE complaint_id = $1`,
    [complaintId]
  );
  return rows;
}

async function expireComplaint(complaintId) {
  await db.query(
    `UPDATE complaints
        SET grace_remaining_seconds = 5,
            grace_running_since = now() - interval '10 seconds'
      WHERE id = $1`,
    [complaintId]
  );
}

describe('contador efectivo', () => {
  test('corre desde 180 y el calculo usa el reloj de PostgreSQL', async () => {
    const { jar } = await harness.loginCitizenWithAlias();
    const complaintId = await createComplaint(jar);

    const fresh = await (await fetchAs(jar, `/api/v1/complaints/${complaintId}`)).json();
    assert.equal(fresh.grace.state, 'RUNNING');
    assert.ok(
      fresh.grace.remainingSeconds <= 180 && fresh.grace.remainingSeconds >= 179,
      `remaining inesperado: ${fresh.grace.remainingSeconds}`
    );

    // Determinista: retroceder el reloj 30 segundos debe restar exactamente 30.
    await db.query(
      `UPDATE complaints SET grace_running_since = now() - interval '30 seconds' WHERE id = $1`,
      [complaintId]
    );
    const advanced = await (await fetchAs(jar, `/api/v1/complaints/${complaintId}`)).json();
    assert.equal(advanced.grace.remainingSeconds, 150);
    assert.equal(advanced.grace.state, 'RUNNING');
  });
});

describe('pausa y reanudacion', () => {
  test('start pausa el reloj, congela el valor y abre sesion de edicion', async () => {
    const { jar } = await harness.loginCitizenWithAlias();
    const complaintId = await createComplaint(jar);

    const startResponse = await fetchAs(
      jar,
      `/api/v1/complaints/${complaintId}/edit-session/start`,
      { method: 'PUT' }
    );
    assert.equal(startResponse.status, 200);
    const body = await startResponse.json();
    assert.equal(body.grace.state, 'PAUSED_FOR_EDIT');
    assert.ok(body.grace.remainingSeconds <= 180 && body.grace.remainingSeconds >= 179);

    const openSession = await getOpenSession(complaintId);
    assert.ok(openSession, 'la sesion de edicion queda abierta');

    const row = await getGraceRow(complaintId);
    assert.equal(row.graceRunningSince, null, 'el reloj se congela');

    // Prueba de congelamiento: mientras esta pausada, el valor no decrece.
    await db.query(
      'UPDATE complaints SET grace_remaining_seconds = 100 WHERE id = $1',
      [complaintId]
    );
    const pausedGet = await (await fetchAs(jar, `/api/v1/complaints/${complaintId}`)).json();
    assert.equal(pausedGet.grace.remainingSeconds, 100);
    assert.equal(pausedGet.grace.state, 'PAUSED_FOR_EDIT');

    const pausedAgain = await (await fetchAs(jar, `/api/v1/complaints/${complaintId}`)).json();
    assert.equal(pausedAgain.grace.remainingSeconds, 100, 'congelado entre lecturas');
  });

  test('cancel cierra la sesion CANCELLED y reanuda el reloj', async () => {
    const { jar } = await harness.loginCitizenWithAlias();
    const complaintId = await createComplaint(jar);

    await fetchAs(jar, `/api/v1/complaints/${complaintId}/edit-session/start`, {
      method: 'PUT',
    });

    const cancelResponse = await fetchAs(
      jar,
      `/api/v1/complaints/${complaintId}/edit-session/cancel`,
      { method: 'POST' }
    );
    assert.equal(cancelResponse.status, 200);
    const body = await cancelResponse.json();
    assert.equal(body.grace.state, 'RUNNING');

    const sessions = await getSessions(complaintId);
    assert.ok(sessions.some((s) => s.end_reason === 'CANCELLED'));

    const row = await getGraceRow(complaintId);
    assert.ok(row.graceRunningSince, 'el reloj reanuda');

    // Determinista: tras reanudar, retroceder 30s resta 30 del valor congelado.
    await db.query(
      `UPDATE complaints SET grace_running_since = now() - interval '30 seconds' WHERE id = $1`,
      [complaintId]
    );
    const resumed = await (await fetchAs(jar, `/api/v1/complaints/${complaintId}`)).json();
    assert.equal(resumed.grace.remainingSeconds, 150);
  });

  test('PUT sin sesion abierta responde 409 EDIT_SESSION_NOT_OPEN', async () => {
    const { jar } = await harness.loginCitizenWithAlias();
    const complaintId = await createComplaint(jar);

    const response = await fetchAs(jar, `/api/v1/complaints/${complaintId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validComplaintPayload({ title: 'Intento directo' })),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'EDIT_SESSION_NOT_OPEN');
  });

  test('PUT con sesion abierta guarda cambios, marca CORRECTED y reanuda', async () => {
    const { jar } = await harness.loginCitizenWithAlias();
    const complaintId = await createComplaint(jar);

    await fetchAs(jar, `/api/v1/complaints/${complaintId}/edit-session/start`, {
      method: 'PUT',
    });

    const newLatitude = -17.3921;
    const newLongitude = -66.1499;
    const saveResponse = await fetchAs(jar, `/api/v1/complaints/${complaintId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        validComplaintPayload({
          title: 'Titulo corregido por el vecino',
          description: 'Descripcion corregida tras revisar la ubicacion exacta.',
          latitude: newLatitude,
          longitude: newLongitude,
          plusCode: plusCodeFor(newLatitude, newLongitude),
        })
      ),
    });
    assert.equal(saveResponse.status, 200);

    const body = await saveResponse.json();
    assert.equal(body.title, 'Titulo corregido por el vecino');
    assert.equal(body.locationVerificationMethod, 'CORRECTED');
    assert.equal(body.grace.state, 'RUNNING');

    const sessions = await getSessions(complaintId);
    assert.ok(sessions.some((s) => s.end_reason === 'SAVED'));

    const row = await getGraceRow(complaintId);
    assert.ok(row.graceRunningSince, 'el reloj reanuda tras guardar');
  });

  test('doble start es idempotente: una sola sesion abierta', async () => {
    const { jar } = await harness.loginCitizenWithAlias();
    const complaintId = await createComplaint(jar);

    const first = await fetchAs(jar, `/api/v1/complaints/${complaintId}/edit-session/start`, {
      method: 'PUT',
    });
    const second = await fetchAs(jar, `/api/v1/complaints/${complaintId}/edit-session/start`, {
      method: 'PUT',
    });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);

    const { rows } = await db.query(
      `SELECT count(*)::int AS total FROM complaint_grace_sessions
        WHERE complaint_id = $1`,
      [complaintId]
    );
    assert.equal(rows[0].total, 1);
  });
});

describe('formalizacion automatica', () => {
  test('al expirar el tiempo efectivo, el proximo acceso formaliza', async () => {
    const { jar } = await harness.loginCitizenWithAlias();
    const complaintId = await createComplaint(jar);
    await expireComplaint(complaintId);

    const response = await fetchAs(jar, `/api/v1/complaints/${complaintId}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'PENDING_REVIEW');
    assert.deepEqual(body.grace, { remainingSeconds: 0, state: 'FORMALIZED' });

    const row = await getGraceRow(complaintId);
    assert.ok(row.formalizedAt, 'formalized_at registrado');
    assert.equal(row.graceRunningSince, null);
    assert.equal(row.graceRemainingSeconds, 0);

    const history = await getStatusHistory(complaintId);
    assert.equal(history.length, 1);
    assert.equal(history[0].previous_status, 'GRACE_PERIOD');
    assert.equal(history[0].new_status, 'PENDING_REVIEW');
    assert.equal(history[0].changed_by_user_id, null); // accion del sistema
    assert.equal(history[0].reason, 'GRACE_PERIOD_EXPIRED');
  });

  test('tras formalizar, todas las operaciones de gracia quedan bloqueadas', async () => {
    const { jar } = await harness.loginCitizenWithAlias();
    const complaintId = await createComplaint(jar);
    await expireComplaint(complaintId);
    await fetchAs(jar, `/api/v1/complaints/${complaintId}`); // formaliza

    const startResponse = await fetchAs(
      jar,
      `/api/v1/complaints/${complaintId}/edit-session/start`,
      { method: 'PUT' }
    );
    assert.equal(startResponse.status, 409);
    assert.equal((await startResponse.json()).error.code, 'COMPLAINT_FORMALIZED');

    const putResponse = await fetchAs(jar, `/api/v1/complaints/${complaintId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validComplaintPayload()),
    });
    assert.equal(putResponse.status, 409);

    const cancelResponse = await fetchAs(
      jar,
      `/api/v1/complaints/${complaintId}/edit-session/cancel`,
      { method: 'POST' }
    );
    assert.equal(cancelResponse.status, 409);

    const deleteResponse = await fetchAs(jar, `/api/v1/complaints/${complaintId}`, {
      method: 'DELETE',
    });
    assert.equal(deleteResponse.status, 409);
  });

  test('una sesion de edicion huerfana se cierra con TIMEOUT tras 10 minutos', async () => {
    const { jar } = await harness.loginCitizenWithAlias();
    const complaintId = await createComplaint(jar);

    await fetchAs(jar, `/api/v1/complaints/${complaintId}/edit-session/start`, {
      method: 'PUT',
    });

    // Simular que la sesion quedo abierta hace 11 minutos.
    await db.query(
      `UPDATE complaint_grace_sessions
          SET started_at = now() - interval '11 minutes'
        WHERE complaint_id = $1 AND ended_at IS NULL`,
      [complaintId]
    );

    const response = await fetchAs(jar, `/api/v1/complaints/${complaintId}`);
    const body = await response.json();
    assert.equal(body.grace.state, 'RUNNING', 'el reloj se reanuda tras el barrido');

    const openSession = await getOpenSession(complaintId);
    assert.equal(openSession, null, 'la sesion huerfana se cierra');

    const sessions = await getSessions(complaintId);
    assert.ok(sessions.some((s) => s.end_reason === 'TIMEOUT'));

    const row = await getGraceRow(complaintId);
    assert.ok(row.graceRunningSince, 'el reloj vuelve a correr');

    // Y sigue contando: retroceder 30 segundos resta 30.
    await db.query(
      `UPDATE complaints SET grace_running_since = now() - interval '30 seconds' WHERE id = $1`,
      [complaintId]
    );
    const advanced = await (await fetchAs(jar, `/api/v1/complaints/${complaintId}`)).json();
    assert.ok(advanced.grace.remainingSeconds <= 150, 'el tiempo se descuenta tras reanudar');
  });

  test('la formalizacion activa el cooldown de 60 minutos para nuevas denuncias', async () => {
    const { jar } = await harness.loginCitizenWithAlias();
    const complaintId = await createComplaint(jar);
    await expireComplaint(complaintId);
    await fetchAs(jar, `/api/v1/complaints/${complaintId}`); // formaliza

    const me = await (await fetchAs(jar, '/api/v1/auth/me')).json();

    const { rows: limits } = await db.query(
      `SELECT next_allowed_at AS "nextAllowedAt",
              last_formalized_complaint_id AS "lastFormalizedComplaintId"
         FROM citizen_submission_limits WHERE citizen_user_id = $1`,
      [me.id]
    );
    assert.ok(limits[0].nextAllowedAt, 'cooldown registrado');
    assert.equal(limits[0].lastFormalizedComplaintId, complaintId);

    const nextResponse = await fetchAs(jar, '/api/v1/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validComplaintPayload()),
    });
    assert.equal(nextResponse.status, 429);
    const errorBody = await nextResponse.json();
    assert.equal(errorBody.error.code, 'SUBMISSION_COOLDOWN');
    const secondsRemaining = errorBody.error.details[0].secondsRemaining;
    assert.ok(secondsRemaining > 3500 && secondsRemaining <= 3600, `cooldown: ${secondsRemaining}`);
  });
});
