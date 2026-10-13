import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/config/database.js';
import {
  createTestHarness,
  testConfig,
  testSub,
  plusCodeFor,
  buildJpegBuffer,
  buildPngBuffer,
  buildMp4Buffer,
  buildTextBuffer,
} from './helpers/fixtures.js';

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

async function uploadEvidence(jar, complaintId, buffer, mimeType, filename, durationSeconds) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  if (durationSeconds !== undefined) {
    form.append('duration_seconds', String(durationSeconds));
  }
  return fetch(`${baseUrl}/api/v1/complaints/${complaintId}/evidence`, {
    method: 'POST',
    headers: { Cookie: jar.header() },
    body: form,
  });
}

async function getComplaintDbRow(complaintId) {
  const { rows } = await db.query(
    `SELECT id, public_code, status, title, description, plus_code, plus_code_source,
            location_verification_method AS "locationVerificationMethod",
            grace_remaining_seconds AS "graceRemainingSeconds",
            grace_running_since AS "graceRunningSince",
            deleted_at AS "deletedAt", deletion_reason AS "deletionReason",
            ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude
       FROM complaints WHERE id = $1`,
    [complaintId]
  );
  return rows[0] ?? null;
}

async function getMyId(jar) {
  const me = await (await fetchAs(jar, '/api/v1/auth/me')).json();
  return me.id;
}

describe('autorizacion basica', () => {
  test('todas las rutas de denuncias responden 401 sin sesion', async () => {
    const paths = [
      ['/api/v1/complaints', { method: 'POST' }],
      ['/api/v1/complaints/00000000-0000-0000-0000-000000000000', { method: 'GET' }],
      ['/api/v1/complaints/00000000-0000-0000-0000-000000000000/edit-session/start', { method: 'PUT' }],
      ['/api/v1/complaints/00000000-0000-0000-0000-000000000000', { method: 'DELETE' }],
    ];
    for (const [pathName, options] of paths) {
      const response = await fetch(`${baseUrl}${pathName}`, { ...options });
      assert.equal(response.status, 401, `${options.method} ${pathName}`);
    }
  });

  test('un ciudadano sin alias recibe 409 ALIAS_REQUIRED', async () => {
    const sub = testSub();
    const { jar } = await harness.loginThroughGoogle({ sub });

    const response = await fetchAs(jar, '/api/v1/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validComplaintPayload()),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'ALIAS_REQUIRED');
  });

  test('una cuenta ADMIN recibe 403 al crear denuncias', async () => {
    const sub = testSub('admin');
    await harness.createFixtureUser({ userType: 'ADMIN', sub, roles: ['MODERATOR'] });
    const { jar } = await harness.loginThroughGoogle({ sub });

    const response = await fetchAs(jar, '/api/v1/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validComplaintPayload()),
    });
    assert.equal(response.status, 403);
  });
});

describe('POST /api/v1/complaints', () => {
  test('crea la denuncia en gracia con verificacion MATCH', async () => {
    const { jar } = await harness.loginCitizenWithAlias();
    const payload = validComplaintPayload();

    const response = await fetchAs(jar, '/api/v1/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 201);

    const body = await response.json();
    assert.match(body.publicCode, /^DEN-[0-9A-HJKMNP-TV-Z]{8}$/);
    assert.equal(body.status, 'GRACE_PERIOD');
    assert.equal(body.locationVerificationMethod, 'MATCH');
    assert.deepEqual(body.grace, { remainingSeconds: 180, state: 'RUNNING' });
    assert.deepEqual(body.evidence, []);

    // Coherencia con la base de datos.
    const row = await getComplaintDbRow(body.id);
    assert.ok(row);
    assert.equal(row.status, 'GRACE_PERIOD');
    assert.equal(row.graceRemainingSeconds, 180);
    assert.ok(row.graceRunningSince);
    assert.equal(row.locationVerificationMethod, 'MATCH');
    assert.ok(Math.abs(row.latitude - payload.latitude) < 1e-6);
    assert.ok(Math.abs(row.longitude - payload.longitude) < 1e-6);
    assert.equal(row.plus_code, payload.plusCode);

    // Minimizacion: sin PII de identidad.
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes('mock@example.com'));
    assert.ok(!serialized.includes('test-sub-'));
    assert.ok(!serialized.includes('storageKey'));
  });

  test('rechaza cada rama invalida del esquema con 422', async () => {
    const { jar } = await harness.loginCitizenWithAlias();
    const cases = [
      { title: 'ab' },
      { description: 'corta' },
      { latitude: 200 },
      { longitude: -500 },
      { plusCode: '8FVC9G8F' },
      { categoryId: 'no-es-uuid' },
      { subcategoryId: 'tampoco-uuid' },
    ];
    for (const overrides of cases) {
      const response = await fetchAs(jar, '/api/v1/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validComplaintPayload(overrides)),
      });
      assert.equal(response.status, 422, `overrides: ${JSON.stringify(overrides)}`);
      const body = await response.json();
      assert.equal(body.error.code, 'VALIDATION_ERROR');
    }
  });

  test('rechaza pares categoria/subcategoria incoherentes con 422', async () => {
    const { jar } = await harness.loginCitizenWithAlias();
    const { rows } = await db.query(
      `SELECT s.id AS "subcategoryId"
         FROM subcategories s
        WHERE s.active = TRUE
          AND s.category_id <> $1
        LIMIT 1`,
      [catalog.categoryId]
    );
    assert.ok(rows.length > 0, 'debe existir una subcategoria ajena para la prueba');

    const response = await fetchAs(jar, '/api/v1/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validComplaintPayload({ subcategoryId: rows[0].subcategoryId })),
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'INVALID_SUBCATEGORY');
  });

  test('rechaza un Plus Code con sintaxis invalida', async () => {
    const { jar } = await harness.loginCitizenWithAlias();
    const response = await fetchAs(jar, '/api/v1/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validComplaintPayload({ plusCode: '8FVC9G8F5W' })),
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'INVALID_PLUS_CODE');
  });

  test('LOCATION_MISMATCH: discrepancia MANUAL sin correccion', async () => {
    const { jar } = await harness.loginCitizenWithAlias();
    const citizenId = await getMyId(jar);
    const latitude = -17.3895;
    const longitude = -66.1568;
    const farPlusCode = plusCodeFor(-17.55, -66.35);

    const response = await fetchAs(jar, '/api/v1/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        validComplaintPayload({ latitude, longitude, plusCode: farPlusCode })
      ),
    });
    assert.equal(response.status, 422);

    const body = await response.json();
    assert.equal(body.error.code, 'LOCATION_MISMATCH');
    const detail = body.error.details[0];
    assert.equal(detail.suggestedPlusCode, plusCodeFor(latitude, longitude));
    assert.ok(detail.distanceMeters > 1000);
    assert.ok(detail.toleranceMeters > 0);

    // Ninguna fila debe crearse.
    const { rows } = await db.query(
      'SELECT count(*)::int AS total FROM complaints WHERE citizen_user_id = $1',
      [citizenId]
    );
    assert.equal(rows[0].total, 0);
  });

  test('source AUTOMATIC recalcula el Plus Code en servidor', async () => {
    const { jar } = await harness.loginCitizenWithAlias();
    const latitude = -17.3895;
    const longitude = -66.1568;

    const response = await fetchAs(jar, '/api/v1/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        validComplaintPayload({
          latitude,
          longitude,
          plusCode: plusCodeFor(-17.55, -66.35),
          plusCodeSource: 'AUTOMATIC',
        })
      ),
    });
    assert.equal(response.status, 201);

    const body = await response.json();
    assert.equal(body.locationVerificationMethod, 'SERVER_RECALCULATED');
    assert.equal(body.plusCode, plusCodeFor(latitude, longitude));
  });

  test('acceptServerPlusCode acepta el codigo sugerido tras discrepancia', async () => {
    const { jar } = await harness.loginCitizenWithAlias();
    const latitude = -17.3895;
    const longitude = -66.1568;

    const response = await fetchAs(jar, '/api/v1/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        validComplaintPayload({
          latitude,
          longitude,
          plusCode: plusCodeFor(-17.55, -66.35),
          acceptServerPlusCode: true,
        })
      ),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.locationVerificationMethod, 'SERVER_RECALCULATED');
    assert.equal(body.plusCode, plusCodeFor(latitude, longitude));
  });
});

describe('GET /api/v1/complaints/:id', () => {
  test('el dueño ve su denuncia; nadie mas', async () => {
    const { jar } = await harness.loginCitizenWithAlias();
    const created = await (
      await fetchAs(jar, '/api/v1/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validComplaintPayload()),
      })
    ).json();

    const ownerResponse = await fetchAs(jar, `/api/v1/complaints/${created.id}`);
    assert.equal(ownerResponse.status, 200);
    const body = await ownerResponse.json();
    assert.equal(body.id, created.id);
    assert.ok(Array.isArray(body.evidence));

    // Otro ciudadano: 404 (minimizacion de existencia).
    const other = await harness.loginCitizenWithAlias();
    const otherResponse = await fetchAs(other.jar, `/api/v1/complaints/${created.id}`);
    assert.equal(otherResponse.status, 404);
    assert.equal((await otherResponse.json()).error.code, 'COMPLAINT_NOT_FOUND');

    // Admin: tambien 404 en Fase 4 (sin rutas administrativas).
    const adminSub = `test-sub-admin-${crypto.randomUUID()}`;
    await harness.createFixtureUser({ userType: 'ADMIN', sub: adminSub, roles: ['MODERATOR'] });
    const admin = await harness.loginThroughGoogle({ sub: adminSub });
    const adminResponse = await fetchAs(admin.jar, `/api/v1/complaints/${created.id}`);
    assert.equal(adminResponse.status, 404);

    // Id inexistente: 404.
    const missing = await fetchAs(jar, `/api/v1/complaints/${crypto.randomUUID()}`);
    assert.equal(missing.status, 404);
  });
});

describe('evidencias', () => {
  let citizen;

  before(async () => {
    citizen = await harness.loginCitizenWithAlias();
    const created = await (
      await fetchAs(citizen.jar, '/api/v1/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validComplaintPayload()),
      })
    ).json();
    citizen.complaintId = created.id;
  });

  test('registra una imagen valida con tarea PENDING y archivo en storage', async () => {
    const response = await uploadEvidence(
      citizen.jar,
      citizen.complaintId,
      buildJpegBuffer(2048),
      'image/jpeg',
      'foto.jpg'
    );
    assert.equal(response.status, 201);

    const body = await response.json();
    assert.equal(body.mediaType, 'IMAGE');
    assert.equal(body.mimeType, 'image/jpeg');
    assert.equal(body.sizeBytes, 2048);
    assert.equal(body.processingStatus, 'PENDING');
    assert.ok(!JSON.stringify(body).includes('storageKey'));

    const { rows: assets } = await db.query(
      'SELECT id, storage_key, processing_status FROM media_assets WHERE id = $1',
      [body.id]
    );
    assert.equal(assets[0].processing_status, 'PENDING');

    const { rows: jobs } = await db.query(
      'SELECT status FROM media_processing_jobs WHERE media_asset_id = $1',
      [body.id]
    );
    assert.equal(jobs[0].status, 'PENDING');

    const storedPath = path.join(testConfig.STORAGE_DIRECTORY, assets[0].storage_key);
    assert.ok(fs.existsSync(storedPath), 'el archivo debe existir en storage');

    const listed = await (
      await fetchAs(citizen.jar, `/api/v1/complaints/${citizen.complaintId}`)
    ).json();
    assert.equal(listed.evidence.length, 1);
    assert.equal(listed.evidence[0].mediaType, 'IMAGE');
  });

  test('aplica el limite de 3 imagenes por denuncia', async () => {
    for (let i = 0; i < 2; i += 1) {
      const response = await uploadEvidence(
        citizen.jar,
        citizen.complaintId,
        buildPngBuffer(512),
        'image/png',
        `foto-${i}.png`
      );
      assert.equal(response.status, 201);
    }

    const fourth = await uploadEvidence(
      citizen.jar,
      citizen.complaintId,
      buildJpegBuffer(512),
      'image/jpeg',
      'cuarta.jpg'
    );
    assert.equal(fourth.status, 422);
    assert.equal((await fourth.json()).error.code, 'EVIDENCE_LIMIT_REACHED');
  });

  test('aplica el limite de 1 video por denuncia', async () => {
    const first = await uploadEvidence(
      citizen.jar,
      citizen.complaintId,
      buildMp4Buffer(4096),
      'video/mp4',
      'video.mp4',
      12
    );
    assert.equal(first.status, 201);

    const second = await uploadEvidence(
      citizen.jar,
      citizen.complaintId,
      buildMp4Buffer(4096),
      'video/mp4',
      'video2.mp4',
      10
    );
    assert.equal(second.status, 422);
    assert.equal((await second.json()).error.code, 'EVIDENCE_LIMIT_REACHED');
  });

  test('rechaza tipos no permitidos', async () => {
    const response = await uploadEvidence(
      citizen.jar,
      citizen.complaintId,
      buildTextBuffer(),
      'text/plain',
      'nota.txt'
    );
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'EVIDENCE_INVALID_TYPE');
  });

  test('rechaza contenido que no coincide con el tipo declarado', async () => {
    const response = await uploadEvidence(
      citizen.jar,
      citizen.complaintId,
      buildTextBuffer(),
      'image/jpeg',
      'falso.jpg'
    );
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'EVIDENCE_SIGNATURE_MISMATCH');
  });

  test('rechaza archivos que superan el limite de tamaño', async () => {
    const response = await uploadEvidence(
      citizen.jar,
      citizen.complaintId,
      buildJpegBuffer(Math.ceil(1.2 * 1024 * 1024)),
      'image/jpeg',
      'grande.jpg'
    );
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'EVIDENCE_TOO_LARGE');
  });

  test('exige duracion declarada del video y valida su maximo', async () => {
    const withoutDuration = await uploadEvidence(
      citizen.jar,
      citizen.complaintId,
      buildMp4Buffer(2048),
      'video/quicktime',
      'video.mov'
    );
    assert.equal(withoutDuration.status, 422);
    assert.equal((await withoutDuration.json()).error.code, 'EVIDENCE_DURATION_REQUIRED');

    const tooLong = await uploadEvidence(
      citizen.jar,
      citizen.complaintId,
      buildMp4Buffer(2048),
      'video/quicktime',
      'video.mov',
      45
    );
    assert.equal(tooLong.status, 422);
    assert.equal((await tooLong.json()).error.code, 'EVIDENCE_DURATION_EXCEEDED');
  });

  test('rechaza evidencia sobre una denuncia formalizada con 409', async () => {
    const fresh = await harness.loginCitizenWithAlias();
    const created = await (
      await fetchAs(fresh.jar, '/api/v1/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validComplaintPayload()),
      })
    ).json();

    await db.query(
      `UPDATE complaints
          SET grace_remaining_seconds = 5,
              grace_running_since = now() - interval '10 seconds'
        WHERE id = $1`,
      [created.id]
    );
    // Cualquier acceso dispara la formalizacion perezosa.
    await fetchAs(fresh.jar, `/api/v1/complaints/${created.id}`);

    const response = await uploadEvidence(
      fresh.jar,
      created.id,
      buildJpegBuffer(512),
      'image/jpeg',
      'foto.jpg'
    );
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'COMPLAINT_FORMALIZED');
  });

  test('rechaza evidencia sobre una denuncia borrada con 404', async () => {
    const fresh = await harness.loginCitizenWithAlias();
    const created = await (
      await fetchAs(fresh.jar, '/api/v1/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validComplaintPayload()),
      })
    ).json();

    const deleted = await fetchAs(fresh.jar, `/api/v1/complaints/${created.id}`, {
      method: 'DELETE',
    });
    assert.equal(deleted.status, 204);

    const response = await uploadEvidence(
      fresh.jar,
      created.id,
      buildJpegBuffer(512),
      'image/jpeg',
      'foto.jpg'
    );
    assert.equal(response.status, 404);
  });
});

describe('DELETE /api/v1/complaints/:id', () => {
  test('borrado suave con traza minima y sin cooldown', async () => {
    const fresh = await harness.loginCitizenWithAlias();
    const created = await (
      await fetchAs(fresh.jar, '/api/v1/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validComplaintPayload()),
      })
    ).json();

    // Sesion de edicion abierta para verificar que tambien se cierra.
    await fetchAs(fresh.jar, `/api/v1/complaints/${created.id}/edit-session/start`, {
      method: 'PUT',
    });

    const response = await fetchAs(fresh.jar, `/api/v1/complaints/${created.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletionReason: 'Me equivoque de direccion' }),
    });
    assert.equal(response.status, 204);

    const { rows: raw } = await db.query(
      `SELECT deleted_at, deletion_reason, status, grace_running_since
         FROM complaints WHERE id = $1`,
      [created.id]
    );
    assert.ok(raw[0].deleted_at);
    assert.equal(raw[0].deletion_reason, 'Me equivoque de direccion');
    assert.equal(raw[0].status, 'GRACE_PERIOD'); // no se formaliza al borrar
    assert.equal(raw[0].grace_running_since, null); // reloj congelado

    const { rows: sessions } = await db.query(
      `SELECT end_reason FROM complaint_grace_sessions
        WHERE complaint_id = $1 AND ended_at IS NOT NULL`,
      [created.id]
    );
    assert.ok(sessions.some((s) => s.end_reason === 'CANCELLED'));

    // Minimizacion: ya no es visible ni para el dueño.
    const getResponse = await fetchAs(fresh.jar, `/api/v1/complaints/${created.id}`);
    assert.equal(getResponse.status, 404);

    // Sin cooldown: puede crear una nueva denuncia de inmediato.
    const newComplaint = await fetchAs(fresh.jar, '/api/v1/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validComplaintPayload()),
    });
    assert.equal(newComplaint.status, 201, 'DELETE no debe activar el cooldown');
  });

  test('rechaza con 409 eliminar una denuncia ya formalizada', async () => {
    const fresh = await harness.loginCitizenWithAlias();
    const created = await (
      await fetchAs(fresh.jar, '/api/v1/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validComplaintPayload()),
      })
    ).json();

    await db.query(
      `UPDATE complaints
          SET grace_remaining_seconds = 5,
              grace_running_since = now() - interval '10 seconds'
        WHERE id = $1`,
      [created.id]
    );
    await fetchAs(fresh.jar, `/api/v1/complaints/${created.id}`); // formaliza

    const response = await fetchAs(fresh.jar, `/api/v1/complaints/${created.id}`, {
      method: 'DELETE',
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'COMPLAINT_FORMALIZED');
  });
});
