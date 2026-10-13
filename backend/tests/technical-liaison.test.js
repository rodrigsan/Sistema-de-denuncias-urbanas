import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/config/database.js';
import {
  createTestHarness,
  testConfig,
  plusCodeFor,
  buildJpegBuffer,
} from './helpers/fixtures.js';

const harness = createTestHarness({ db });
let baseUrl;
let baches;
let moderator;
let obrasPublicas;
let subalcaldia;
let liaisonObras;
let liaisonSubalcaldia;
let liaisonSinUnidad;

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

  const { rows: unitRows } = await db.query(
    `SELECT id, code FROM municipal_units
      WHERE code IN ('OBRAS_PUBLICAS', 'SUBALCALDIA_DISTRITO')`
  );
  obrasPublicas = unitRows.find((unit) => unit.code === 'OBRAS_PUBLICAS');
  subalcaldia = unitRows.find((unit) => unit.code === 'SUBALCALDIA_DISTRITO');

  moderator = await harness.loginModerator();
  liaisonObras = await harness.loginLiaison({ unitCodes: ['OBRAS_PUBLICAS'] });
  liaisonSubalcaldia = await harness.loginLiaison({ unitCodes: ['SUBALCALDIA_DISTRITO'] });
  liaisonSinUnidad = await harness.loginLiaison({ unitCodes: [] });
});

after(async () => {
  await harness.stop();
});

function complaintPayload({ latitude = -17.3895, longitude = -66.1568 } = {}) {
  return {
    title: 'Bache peligroso en la avenida',
    description: 'El bache provoca daños a los vehiculos que transitan cada dia.',
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

/** Formaliza una denuncia y la aprueba hacia la unidad indicada. */
async function createAssignedComplaint(unitId) {
  const citizen = await harness.loginCitizenWithAlias();
  const complaint = await harness.createFormalizedComplaint(citizen.jar, complaintPayload());
  const response = await fetchAs(moderator.jar, `/api/v1/moderation/complaints/${complaint.id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ municipalUnitId: unitId }),
  });
  assert.equal(response.status, 200, 'la denuncia debe quedar asignada');
  return complaint;
}

async function startProcess(jar, complaintId) {
  return fetchAs(jar, `/api/v1/technical/complaints/${complaintId}/start-process`, {
    method: 'POST',
  });
}

async function submitSolution(jar, complaintId, description) {
  return fetchAs(jar, `/api/v1/technical/complaints/${complaintId}/submit-solution`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
}

async function uploadSolutionEvidence(jar, solutionId, buffer, mimeType, filename) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  return fetch(`${baseUrl}/api/v1/technical/solutions/${solutionId}/evidence`, {
    method: 'POST',
    headers: { Cookie: jar.header() },
    body: form,
  });
}

async function getMyId(jar) {
  const me = await (await fetchAs(jar, '/api/v1/auth/me')).json();
  return me.id;
}

describe('RBAC tecnico', () => {
  test('responde 401 sin sesion', async () => {
    const response = await fetch(`${baseUrl}/api/v1/technical/complaints`);
    assert.equal(response.status, 401);
  });

  test('responde 403 para un ciudadano', async () => {
    const citizen = await harness.loginCitizenWithAlias();
    const response = await fetchAs(citizen.jar, '/api/v1/technical/complaints');
    assert.equal(response.status, 403);
  });

  test('responde 403 para un MODERATOR (roles separados)', async () => {
    const response = await fetchAs(moderator.jar, '/api/v1/technical/complaints');
    assert.equal(response.status, 403);
  });

  test('un enlace sin membresias ve una bandeja vacia', async () => {
    const response = await fetchAs(liaisonSinUnidad.jar, '/api/v1/technical/complaints');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.complaints, []);
    assert.equal(body.pagination.total, 0);
  });
});

describe('bandeja tecnica', () => {
  test('solo lista denuncias asignadas a sus unidades, sin datos del ciudadano', async () => {
    const assignedObras = await createAssignedComplaint(obrasPublicas.id);
    await createAssignedComplaint(subalcaldia.id);

    const response = await fetchAs(liaisonObras.jar, '/api/v1/technical/complaints?page=1&limit=10');
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.ok(body.complaints.some((item) => item.id === assignedObras.id));
    assert.ok(body.complaints.every((item) => item.assignedUnit.code === 'OBRAS_PUBLICAS'));

    const other = await fetchAs(liaisonSubalcaldia.jar, '/api/v1/technical/complaints?page=1&limit=10');
    const otherBody = await other.json();
    assert.ok(otherBody.complaints.length > 0);
    assert.ok(otherBody.complaints.every((item) => item.assignedUnit.code === 'SUBALCALDIA_DISTRITO'));

    // Minimizacion: sin alias ni datos del ciudadano.
    const text = JSON.stringify(body);
    assert.ok(!text.includes('citizenAlias'), 'sin alias del ciudadano');
    assert.ok(!text.includes('Vecino'), 'sin datos del ciudadano');
    assert.ok(!text.includes('@'), 'sin correos');

    const item = body.complaints[0];
    assert.deepEqual(
      Object.keys(item).sort(),
      [
        'assignedUnit',
        'category',
        'createdAt',
        'description',
        'evidence',
        'formalizedAt',
        'id',
        'latestSolution',
        'location',
        'plusCode',
        'publicCode',
        'status',
        'subcategory',
        'title',
      ]
    );
  });
});

describe('atencion y soluciones', () => {
  test('start-process mueve ASSIGNED a IN_PROGRESS con historial', async () => {
    const complaint = await createAssignedComplaint(obrasPublicas.id);
    const liaisonId = await getMyId(liaisonObras.jar);

    const response = await startProcess(liaisonObras.jar, complaint.id);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'IN_PROGRESS');
    assert.equal(body.assignedUnit.code, 'OBRAS_PUBLICAS');

    const { rows: history } = await db.query(
      `SELECT previous_status AS "previousStatus", new_status AS "newStatus",
              changed_by_user_id AS "changedByUserId", reason
         FROM complaint_status_history
        WHERE complaint_id = $1
          AND reason = 'TECHNICAL_WORK_STARTED'`,
      [complaint.id]
    );
    assert.equal(history.length, 1);
    assert.equal(history[0].previousStatus, 'ASSIGNED');
    assert.equal(history[0].newStatus, 'IN_PROGRESS');
    assert.equal(history[0].changedByUserId, liaisonId);
  });

  test('start-process de otra unidad responde 404 y doble inicio 409', async () => {
    const complaint = await createAssignedComplaint(obrasPublicas.id);

    const foreign = await startProcess(liaisonSubalcaldia.jar, complaint.id);
    assert.equal(foreign.status, 404);

    const first = await startProcess(liaisonObras.jar, complaint.id);
    assert.equal(first.status, 200);

    const second = await startProcess(liaisonObras.jar, complaint.id);
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error.code, 'COMPLAINT_NOT_ASSIGNABLE');
  });

  test('submit-solution exige IN_PROGRESS y valida la descripcion', async () => {
    const complaint = await createAssignedComplaint(obrasPublicas.id);

    const tooEarly = await submitSolution(
      liaisonObras.jar,
      complaint.id,
      'Se realizo la reparacion completa del tramo dañado.'
    );
    assert.equal(tooEarly.status, 409);
    assert.equal((await tooEarly.json()).error.code, 'COMPLAINT_NOT_IN_PROGRESS');

    await startProcess(liaisonObras.jar, complaint.id);

    const invalid = await submitSolution(liaisonObras.jar, complaint.id, 'corta');
    assert.equal(invalid.status, 422);

    const success = await submitSolution(
      liaisonObras.jar,
      complaint.id,
      'Se realizo la reparacion completa del tramo dañado con mezcla asfaltica.'
    );
    assert.equal(success.status, 201);
    const solution = await success.json();
    assert.equal(solution.status, 'SUBMITTED');
    assert.equal(solution.complaint.status, 'SOLUTION_SUBMITTED');

    const { rows: solutionRows } = await db.query(
      `SELECT status, submitted_by_user_id AS "submittedByUserId"
         FROM complaint_solutions WHERE id = $1`,
      [solution.id]
    );
    assert.equal(solutionRows[0].status, 'SUBMITTED');
    assert.equal(solutionRows[0].submittedByUserId, await getMyId(liaisonObras.jar));
  });

  test('evidencias de solucion: privadas, limitadas y con job PENDING', async () => {
    const complaint = await createAssignedComplaint(obrasPublicas.id);
    await startProcess(liaisonObras.jar, complaint.id);
    const solution = await (
      await submitSolution(
        liaisonObras.jar,
        complaint.id,
        'Se repavimento completamente la via afectada.'
      )
    ).json();

    const first = await uploadSolutionEvidence(
      liaisonObras.jar,
      solution.id,
      buildJpegBuffer(2048),
      'image/jpeg',
      'obra.jpg'
    );
    assert.equal(first.status, 201);
    const evidence = await first.json();
    assert.equal(evidence.processingStatus, 'PENDING');
    assert.ok(!JSON.stringify(evidence).includes('storageKey'));

    const { rows: mediaRows } = await db.query(
      `SELECT complaint_id, solution_id, purpose, storage_key, processing_status
         FROM media_assets WHERE id = $1`,
      [evidence.id]
    );
    assert.equal(mediaRows[0].purpose, 'SOLUTION_EVIDENCE');
    assert.equal(mediaRows[0].solution_id, solution.id);
    assert.equal(mediaRows[0].complaint_id, null, 'CHECK: sin complaint_id');
    assert.ok(fs.existsSync(path.join(testConfig.STORAGE_DIRECTORY, mediaRows[0].storage_key)));

    const { rows: jobRows } = await db.query(
      `SELECT status FROM media_processing_jobs WHERE media_asset_id = $1`,
      [evidence.id]
    );
    assert.equal(jobRows[0].status, 'PENDING');

    // Limite de imagenes por solucion (config de prueba: 3).
    for (let i = 0; i < 2; i += 1) {
      const upload = await uploadSolutionEvidence(
        liaisonObras.jar,
        solution.id,
        buildJpegBuffer(512),
        'image/jpeg',
        `obra-${i}.jpg`
      );
      assert.equal(upload.status, 201);
    }
    const fourth = await uploadSolutionEvidence(
      liaisonObras.jar,
      solution.id,
      buildJpegBuffer(512),
      'image/jpeg',
      'obra-3.jpg'
    );
    assert.equal(fourth.status, 422);
    assert.equal((await fourth.json()).error.code, 'EVIDENCE_LIMIT_REACHED');
  });

  test('RETURN devuelve la denuncia a IN_PROGRESS y el comentario es visible', async () => {
    const complaint = await createAssignedComplaint(obrasPublicas.id);
    await startProcess(liaisonObras.jar, complaint.id);
    const solution = await (
      await submitSolution(liaisonObras.jar, complaint.id, 'Se relleno el bache con material.')
    ).json();

    // Antes de devolver: la evidencia es aceptada.
    const before = await uploadSolutionEvidence(
      liaisonObras.jar,
      solution.id,
      buildJpegBuffer(512),
      'image/jpeg',
      'obra.jpg'
    );
    assert.equal(before.status, 201);

    const returned = await fetchAs(moderator.jar, `/api/v1/moderation/solutions/${solution.id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision: 'RETURN',
        reviewComment: 'La foto no muestra la reparacion completa del tramo.',
      }),
    });
    assert.equal(returned.status, 200);
    const returnedBody = await returned.json();
    assert.equal(returnedBody.solutionStatus, 'RETURNED');
    assert.equal(returnedBody.complaintStatus, 'IN_PROGRESS');

    // Tras la devolucion no se admiten mas evidencias en esa solucion.
    const after = await uploadSolutionEvidence(
      liaisonObras.jar,
      solution.id,
      buildJpegBuffer(512),
      'image/jpeg',
      'obra-tarde.jpg'
    );
    assert.equal(after.status, 409);
    assert.equal((await after.json()).error.code, 'SOLUTION_NOT_EDITABLE');

    // El enlace ve el comentario en su bandeja (latestSolution).
    const list = await (
      await fetchAs(liaisonObras.jar, '/api/v1/technical/complaints?page=1&limit=20')
    ).json();
    const item = list.complaints.find((entry) => entry.id === complaint.id);
    assert.equal(item.status, 'IN_PROGRESS');
    assert.equal(item.latestSolution.id, solution.id);
    assert.equal(item.latestSolution.status, 'RETURNED');
    assert.equal(item.latestSolution.reviewComment, 'La foto no muestra la reparacion completa del tramo.');

    // Reintento: nueva solucion desde IN_PROGRESS y aprobacion final.
    const secondSolution = await (
      await submitSolution(
        liaisonObras.jar,
        complaint.id,
        'Se repavimento el tramo completo con mezcla asfaltica nueva.'
      )
    ).json();
    assert.equal(secondSolution.status, 'SUBMITTED');

    const approved = await fetchAs(moderator.jar, `/api/v1/moderation/solutions/${secondSolution.id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'APPROVE' }),
    });
    assert.equal(approved.status, 200);
    const approvedBody = await approved.json();
    assert.equal(approvedBody.complaintStatus, 'RESOLVED');

    const { rows: resolvedRow } = await db.query(
      'SELECT status, resolved_at FROM complaints WHERE id = $1',
      [complaint.id]
    );
    assert.equal(resolvedRow[0].status, 'RESOLVED');
    assert.ok(resolvedRow[0].resolved_at, 'resolved_at registrado');

    // Doble verificacion: 409.
    const again = await fetchAs(moderator.jar, `/api/v1/moderation/solutions/${secondSolution.id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'APPROVE' }),
    });
    assert.equal(again.status, 409);
    assert.equal((await again.json()).error.code, 'SOLUTION_ALREADY_VERIFIED');
  });

  test('verify sin comentario en RETURN es invalido', async () => {
    const complaint = await createAssignedComplaint(obrasPublicas.id);
    await startProcess(liaisonObras.jar, complaint.id);
    const solution = await (
      await submitSolution(liaisonObras.jar, complaint.id, 'Solucion registrada para revision.')
    ).json();

    const response = await fetchAs(moderator.jar, `/api/v1/moderation/solutions/${solution.id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'RETURN' }),
    });
    assert.equal(response.status, 422);

    const missing = await fetch(`${baseUrl}/api/v1/moderation/solutions/00000000-0000-0000-0000-000000000000/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: moderator.jar.header() },
      body: JSON.stringify({ decision: 'APPROVE' }),
    });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'SOLUTION_NOT_FOUND');
  });
});
