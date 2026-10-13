import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/config/database.js';
import { createTestHarness, plusCodeFor, buildJpegBuffer } from './helpers/fixtures.js';

const harness = createTestHarness({ db });
let baseUrl;
let baches;
let moderator;
let obrasPublicas;
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

  const { rows: unitRows } = await db.query(
    `SELECT id, code FROM municipal_units WHERE code = 'OBRAS_PUBLICAS' LIMIT 1`
  );
  obrasPublicas = unitRows[0];

  moderator = await harness.loginModerator();
  liaison = await harness.loginLiaison({ unitCodes: ['OBRAS_PUBLICAS'] });
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

async function getMyId(jar) {
  const me = await (await fetchAs(jar, '/api/v1/auth/me')).json();
  return me.id;
}

/** Formaliza una denuncia del ciudadano y limpia el cooldown (solo pruebas). */
async function formalizeOwn(jar, payload) {
  const complaint = await harness.createFormalizedComplaint(jar, payload);
  await harness.clearSubmissionCooldown(await getMyId(jar));
  return complaint;
}

/** Lleva una denuncia formalizada hasta RESOLVED con evidencia de solucion. */
async function resolveComplaint(complaintId, { withSolutionEvidence = false } = {}) {
  await fetchAs(moderator.jar, `/api/v1/moderation/complaints/${complaintId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ municipalUnitId: obrasPublicas.id }),
  });

  await fetchAs(liaison.jar, `/api/v1/technical/complaints/${complaintId}/start-process`, {
    method: 'POST',
  });

  const solutionResponse = await fetchAs(
    liaison.jar,
    `/api/v1/technical/complaints/${complaintId}/submit-solution`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'Se repavimento el tramo afectado con mezcla asfaltica.',
      }),
    }
  );
  const solution = await solutionResponse.json();

  if (withSolutionEvidence) {
    const form = new FormData();
    form.append('file', new Blob([buildJpegBuffer(1024)], { type: 'image/jpeg' }), 'obra.jpg');
    await fetch(`${baseUrl}/api/v1/technical/solutions/${solution.id}/evidence`, {
      method: 'POST',
      headers: { Cookie: liaison.jar.header() },
      body: form,
    });
  }

  await fetchAs(moderator.jar, `/api/v1/moderation/solutions/${solution.id}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'APPROVE' }),
  });

  return solution.id;
}

describe('RBAC de Mis Denuncias', () => {
  test('responde 401 sin sesion', async () => {
    const response = await fetch(`${baseUrl}/api/v1/citizens/complaints`);
    assert.equal(response.status, 401);
  });

  test('responde 403 para una cuenta ADMIN', async () => {
    const response = await fetchAs(moderator.jar, '/api/v1/citizens/complaints');
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'FORBIDDEN');
  });
});

describe('GET /api/v1/citizens/complaints', () => {
  test('lista solo las denuncias propias, en orden DESC y con total', async () => {
    const citizen = await harness.loginCitizenWithAlias({ alias: 'Vecino Seguidor' });
    const other = await harness.loginCitizenWithAlias({ alias: 'Vecino Ajeno' });
    const otherComplaint = await formalizeOwn(other.jar, complaintPayload());

    const own = [];
    const minutesAgo = [10, 5, 1];
    for (let i = 0; i < minutesAgo.length; i += 1) {
      const complaint = await formalizeOwn(citizen.jar, complaintPayload({
        longitude: -66.1568 + i * 0.00005,
      }));
      await db.query(
        `UPDATE complaints SET created_at = now() - make_interval(mins => $2::int) WHERE id = $1`,
        [complaint.id, minutesAgo[i]]
      );
      own.push(complaint);
    }

    const response = await fetchAs(citizen.jar, '/api/v1/citizens/complaints?page=1&limit=10');
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.pagination.total, 3);
    const ids = body.complaints.map((item) => item.id);
    assert.deepEqual(ids, [own[2].id, own[1].id, own[0].id]);
    assert.ok(!ids.includes(otherComplaint.id), 'no expone denuncias ajenas');
  });

  test('filtra por estado y excluye las borradas', async () => {
    const citizen = await harness.loginCitizenWithAlias({ alias: 'Vecino Filtro' });
    const kept = await formalizeOwn(citizen.jar, complaintPayload());

    // En ventana de gracia (no formalizada).
    const draft = await (
      await fetchAs(citizen.jar, '/api/v1/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(complaintPayload({ longitude: -66.1567 })),
      })
    ).json();
    const hidden = await (
      await fetchAs(citizen.jar, '/api/v1/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(complaintPayload({ longitude: -66.1566 })),
      })
    ).json();
    await fetchAs(citizen.jar, `/api/v1/complaints/${hidden.id}`, { method: 'DELETE' });

    const all = await (
      await fetchAs(citizen.jar, '/api/v1/citizens/complaints?page=1&limit=20')
    ).json();
    const allIds = all.complaints.map((item) => item.id);
    assert.ok(allIds.includes(kept.id));
    assert.ok(allIds.includes(draft.id), 'las denuncias en gracia tambien son visibles');
    assert.ok(!allIds.includes(hidden.id), 'las borradas quedan ocultas');

    const graceOnly = await (
      await fetchAs(citizen.jar, '/api/v1/citizens/complaints?page=1&limit=20&status=GRACE_PERIOD')
    ).json();
    assert.equal(graceOnly.pagination.total, 1);
    assert.equal(graceOnly.complaints[0].id, draft.id);
  });

  test('minimizacion estricta: sin evidencias ni PII, con claves exactas', async () => {
    const citizen = await harness.loginCitizenWithAlias({ alias: 'Vecino Minimo' });
    const complaint = await formalizeOwn(citizen.jar, complaintPayload());

    const text = await (
      await fetchAs(citizen.jar, '/api/v1/citizens/complaints?page=1&limit=10')
    ).text();
    assert.ok(!text.includes('evidence'), 'sin arrays de evidencia');
    assert.ok(!text.includes('media'), 'sin metadatos multimedia');
    assert.ok(!text.includes('@'), 'sin correos');
    assert.ok(!text.includes('test-sub'), 'sin subs de Google');
    assert.ok(!text.includes('administrativeCode'), 'sin codigo administrativo');

    const body = JSON.parse(text);
    const item = body.complaints.find((entry) => entry.id === complaint.id);
    assert.ok(item);
    assert.deepEqual(
      Object.keys(item).sort(),
      [
        'assignedUnit',
        'category',
        'createdAt',
        'description',
        'formalizedAt',
        'id',
        'location',
        'plusCode',
        'publicCode',
        'rejectionReason',
        'solution',
        'status',
        'subcategory',
        'title',
      ]
    );
  });

  test('expone el motivo de rechazo y la unidad asignada cuando aplican', async () => {
    const citizenA = await harness.loginCitizenWithAlias({ alias: 'Vecino Rechazado' });
    const rejected = await formalizeOwn(citizenA.jar, complaintPayload());
    await fetchAs(moderator.jar, `/api/v1/moderation/complaints/${rejected.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejectionReason: 'La direccion no corresponde a la foto.' }),
    });

    const citizenB = await harness.loginCitizenWithAlias({ alias: 'Vecino Asignado' });
    const assigned = await formalizeOwn(citizenB.jar, complaintPayload());
    await fetchAs(moderator.jar, `/api/v1/moderation/complaints/${assigned.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ municipalUnitId: obrasPublicas.id }),
    });

    const listA = await (
      await fetchAs(citizenA.jar, '/api/v1/citizens/complaints?page=1&limit=10')
    ).json();
    const rejectedItem = listA.complaints.find((item) => item.id === rejected.id);
    assert.equal(rejectedItem.status, 'REJECTED');
    assert.equal(rejectedItem.rejectionReason, 'La direccion no corresponde a la foto.');

    const listB = await (
      await fetchAs(citizenB.jar, '/api/v1/citizens/complaints?page=1&limit=10')
    ).json();
    const assignedItem = listB.complaints.find((item) => item.id === assigned.id);
    assert.equal(assignedItem.status, 'ASSIGNED');
    assert.equal(assignedItem.assignedUnit.code, 'OBRAS_PUBLICAS');
    assert.ok(assignedItem.assignedUnit.assignedAt);
  });

  test('flujo de punta a punta: la solucion aprobada es visible para el ciudadano', async () => {
    const citizen = await harness.loginCitizenWithAlias({ alias: 'Vecino Resuelto' });
    const complaint = await formalizeOwn(citizen.jar, complaintPayload());
    const solutionId = await resolveComplaint(complaint.id, { withSolutionEvidence: true });

    const list = await (
      await fetchAs(citizen.jar, '/api/v1/citizens/complaints?page=1&limit=10')
    ).json();
    const item = list.complaints.find((entry) => entry.id === complaint.id);

    assert.equal(item.status, 'RESOLVED');
    assert.equal(item.solution.description, 'Se repavimento el tramo afectado con mezcla asfaltica.');
    assert.ok(item.solution.submittedAt);
    assert.ok(item.solution.reviewedAt);
    assert.equal(item.assignedUnit.code, 'OBRAS_PUBLICAS');

    // Privacidad rigurosa: la evidencia de la solucion existe en la BD...
    const { rows: mediaRows } = await db.query(
      'SELECT id FROM media_assets WHERE solution_id = $1',
      [solutionId]
    );
    assert.equal(mediaRows.length, 1, 'la evidencia de solucion existe en la base');
    // ...pero es invisible en todas las vistas del ciudadano.
    const listText = JSON.stringify(list);
    assert.ok(!listText.includes(mediaRows[0].id), 'sin id de evidencia de solucion');
    const detail = await fetchAs(citizen.jar, `/api/v1/complaints/${complaint.id}`);
    const detailText = await detail.text();
    assert.ok(!detailText.includes(mediaRows[0].id), 'el detalle tampoco la expone');
  });
});
