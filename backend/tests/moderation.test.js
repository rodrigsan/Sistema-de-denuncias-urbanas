import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/config/database.js';
import { createTestHarness, testSub, plusCodeFor } from './helpers/fixtures.js';

const harness = createTestHarness({ db });
let baseUrl;
let baches; // categoria/subcategoria con reglas de asignacion sembradas
let seguridad; // categoria/subcategoria distinta para filtros
let moderator;
let moderatorId;
let obrasPublicas;

// Denuncias compartidas de la bandeja (formalized_at inyectado en minutos).
const inboxComplaints = [];
let seguridadComplaint;
let deletedComplaint;
let windowFrom;
let windowTo;

before(async () => {
  ({ baseUrl } = await harness.start());

  // Catalogo: BACHES_PAVIMENTO (tiene reglas: OBRAS_PUBLICAS 10, SUBALCALDIA 20)
  const { rows: bachesRows } = await db.query(
    `SELECT c.id AS "categoryId", s.id AS "subcategoryId"
       FROM categories c
       JOIN subcategories s ON s.category_id = c.id
      WHERE s.code = 'BACHES_PAVIMENTO'
      LIMIT 1`
  );
  baches = bachesRows[0];

  const { rows: seguridadRows } = await db.query(
    `SELECT c.id AS "categoryId", s.id AS "subcategoryId"
       FROM categories c
       JOIN subcategories s ON s.category_id = c.id
      WHERE c.code = 'SEGURIDAD'
      LIMIT 1`
  );
  seguridad = seguridadRows[0];

  const { rows: unitRows } = await db.query(
    `SELECT id, code FROM municipal_units WHERE code = 'OBRAS_PUBLICAS' LIMIT 1`
  );
  obrasPublicas = unitRows[0];

  moderator = await harness.loginModerator();
  moderatorId = (await (await fetchAs(moderator.jar, '/api/v1/auth/me')).json()).id;

  // 5 denuncias de BACHES por 5 ciudadanos distintos, formalizadas.
  const minutesAgo = [35, 28, 21, 14, 7];
  for (let i = 0; i < minutesAgo.length; i += 1) {
    const citizen = await harness.loginCitizenWithAlias({ alias: `Vecino Moderado ${i + 1}` });
    const complaint = await harness.createFormalizedComplaint(citizen.jar, complaintPayload(baches, {
      latitude: -17.3895,
      longitude: -66.1568 + i * 0.00005,
    }));
    await db.query(
      `UPDATE complaints SET formalized_at = now() - make_interval(mins => $2::int) WHERE id = $1`,
      [complaint.id, minutesAgo[i]]
    );
    inboxComplaints.push(complaint);
  }

  // 1 denuncia de otra categoria (SEGURIDAD) para filtros.
  const seguridadCitizen = await harness.loginCitizenWithAlias({ alias: 'Vecino Seguridad' });
  seguridadComplaint = await harness.createFormalizedComplaint(seguridadCitizen.jar, complaintPayload(seguridad, {
    latitude: -17.3892,
    longitude: -66.1558,
  }));
  await db.query(
    `UPDATE complaints SET formalized_at = now() - make_interval(mins => 30) WHERE id = $1`,
    [seguridadComplaint.id]
  );

  // 1 denuncia formalizada y ocultada: no debe aparecer en la bandeja.
  // (El borrado ciudadano por API solo ocurre en ventana de gracia; aqui se
  // simula con UPDATE directo el estado relevante para el inbox: una
  // denuncia PENDING_REVIEW con deleted_at, que debe quedar excluida.)
  const borrableCitizen = await harness.loginCitizenWithAlias({ alias: 'Vecino Borrable' });
  deletedComplaint = await harness.createFormalizedComplaint(borrableCitizen.jar, complaintPayload(baches, {
    latitude: -17.3890,
    longitude: -66.1560,
  }));
  await db.query(
    `UPDATE complaints
        SET formalized_at = now() - make_interval(mins => 25),
            deleted_at = now(),
            deletion_reason = 'OCULTADA_EN_PRUEBA'
      WHERE id = $1`,
    [deletedComplaint.id]
  );

  windowFrom = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  windowTo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
});

after(async () => {
  await harness.stop();
});

function complaintPayload(catalog, { latitude = -17.3895, longitude = -66.1568 } = {}) {
  return {
    title: 'Bache peligroso en la avenida principal',
    description: 'El bache provoca daños a los vehiculos que transitan cada dia.',
    categoryId: catalog.categoryId,
    subcategoryId: catalog.subcategoryId,
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

function inboxQuery(extra = {}) {
  const params = new URLSearchParams({
    formalizedFrom: windowFrom,
    formalizedTo: windowTo,
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])),
  });
  return params.toString();
}

async function fetchInbox(jar, extra = {}) {
  return fetchAs(jar, `/api/v1/moderation/complaints?${inboxQuery(extra)}`);
}

async function fetchReviewRows(complaintId) {
  const { rows } = await db.query(
    `SELECT decision, selected_unit_id AS "selectedUnitId", moderator_user_id AS "moderatorUserId",
            rejection_reason AS "rejectionReason"
       FROM moderation_reviews WHERE complaint_id = $1`,
    [complaintId]
  );
  return rows;
}

async function fetchAssignmentRows(complaintId) {
  const { rows } = await db.query(
    `SELECT municipal_unit_id AS "municipalUnitId", assigned_by_user_id AS "assignedByUserId",
            ended_at AS "endedAt"
       FROM complaint_assignments WHERE complaint_id = $1`,
    [complaintId]
  );
  return rows;
}

async function fetchHistoryRows(complaintId) {
  const { rows } = await db.query(
    `SELECT previous_status AS "previousStatus", new_status AS "newStatus",
            changed_by_user_id AS "changedByUserId", reason
       FROM complaint_status_history
      WHERE complaint_id = $1
      ORDER BY created_at`,
    [complaintId]
  );
  return rows;
}

describe('RBAC del modulo de moderacion', () => {
  test('las rutas exigen sesion (401)', async () => {
    const response = await fetch(`${baseUrl}/api/v1/moderation/complaints`);
    assert.equal(response.status, 401);
  });

  test('un ciudadano sin rol recibe 403', async () => {
    const citizen = await harness.loginCitizenWithAlias();
    const response = await fetchAs(citizen.jar, '/api/v1/moderation/complaints');
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'FORBIDDEN');
  });

  test('un ADMIN sin roles recibe 403', async () => {
    const sub = testSub('admin');
    await harness.createFixtureUser({ userType: 'ADMIN', sub });
    const { jar } = await harness.loginThroughGoogle({ sub });
    const response = await fetchAs(jar, '/api/v1/moderation/complaints');
    assert.equal(response.status, 403);
  });

  test('un TECHNICAL_LIAISON no es MODERATOR (403)', async () => {
    const sub = testSub('enlace');
    await harness.createFixtureUser({ userType: 'ADMIN', sub, roles: ['TECHNICAL_LIAISON'] });
    const { jar } = await harness.loginThroughGoogle({ sub });
    const response = await fetchAs(jar, '/api/v1/moderation/complaints');
    assert.equal(response.status, 403);
  });

  test('un SUPERADMIN no consulta contenido de denuncias (403)', async () => {
    const sub = testSub('super');
    await harness.createFixtureUser({ userType: 'ADMIN', sub, roles: ['SUPERADMIN'] });
    const { jar } = await harness.loginThroughGoogle({ sub });
    const response = await fetchAs(jar, '/api/v1/moderation/complaints');
    assert.equal(response.status, 403);
  });
});

describe('bandeja de moderacion', () => {
  test('pagina con orden FIFO por formalized_at y total correcto', async () => {
    const response = await fetchInbox(moderator.jar, { page: 1, limit: 2, categoryId: baches.categoryId });
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.pagination.page, 1);
    assert.equal(body.pagination.limit, 2);
    assert.equal(body.pagination.total, 5);
    assert.deepEqual(
      body.complaints.map((c) => c.id),
      [inboxComplaints[0].id, inboxComplaints[1].id]
    );
  });

  test('la paginacion recorre todas las denuncias del rango (ambas categorias)', async () => {
    const all = await (await fetchInbox(moderator.jar, { limit: 100 })).json();
    assert.equal(all.pagination.total, 6);
    assert.deepEqual(
      all.complaints.map((c) => c.id),
      [
        inboxComplaints[0].id,
        seguridadComplaint.id,
        inboxComplaints[1].id,
        inboxComplaints[2].id,
        inboxComplaints[3].id,
        inboxComplaints[4].id,
      ]
    );
  });

  test('filtra por categoria', async () => {
    const body = await (await fetchInbox(moderator.jar, { limit: 100, categoryId: seguridad.categoryId })).json();
    assert.equal(body.pagination.total, 1);
    assert.equal(body.complaints[0].id, seguridadComplaint.id);
  });

  test('filtra por rango de fechas de formalizacion', async () => {
    const from16 = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    const to16 = new Date(Date.now() - 16 * 60 * 1000).toISOString();

    const newer = await (
      await fetchInbox(moderator.jar, { limit: 100, categoryId: baches.categoryId, formalizedFrom: from16 })
    ).json();
    // formalized_at >= now-16min: solo las de 14 y 7 minutos.
    assert.deepEqual(
      newer.complaints.map((c) => c.id),
      [inboxComplaints[3].id, inboxComplaints[4].id]
    );

    const older = await (
      await fetchInbox(moderator.jar, { limit: 100, categoryId: baches.categoryId, formalizedTo: to16 })
    ).json();
    // formalized_at <= now-16min: las de 35, 28 y 21 minutos.
    assert.deepEqual(
      older.complaints.map((c) => c.id),
      [inboxComplaints[0].id, inboxComplaints[1].id, inboxComplaints[2].id]
    );
  });

  test('incluye las unidades sugeridas por assignment_rules ordenadas por prioridad', async () => {
    const body = await (await fetchInbox(moderator.jar, { limit: 1, categoryId: baches.categoryId })).json();
    const item = body.complaints[0];

    assert.deepEqual(
      item.suggestedUnits.map((unit) => unit.code),
      ['OBRAS_PUBLICAS', 'SUBALCALDIA_DISTRITO']
    );
    assert.deepEqual(
      item.suggestedUnits.map((unit) => unit.priority),
      [10, 20]
    );
  });

  test('excluye las denuncias borradas por el ciudadano', async () => {
    const body = await (await fetchInbox(moderator.jar, { limit: 100, categoryId: baches.categoryId })).json();
    const ids = body.complaints.map((c) => c.id);
    assert.ok(!ids.includes(deletedComplaint.id));
    assert.equal(body.pagination.total, 5);
  });

  test('minimizacion estricta: sin email, cuenta Google ni codigo administrativo', async () => {
    const text = await (await fetchInbox(moderator.jar, { limit: 100 })).text();

    assert.ok(!text.includes('email'), 'sin campos de email');
    assert.ok(!text.includes('@'), 'sin correos');
    assert.ok(!text.includes('test-sub'), 'sin subs de Google');
    assert.ok(!text.includes('administrativeCode'), 'sin codigo administrativo');
    assert.ok(!text.includes('provider'), 'sin datos de proveedor de identidad');

    const body = JSON.parse(text);
    const item = body.complaints[0];
    assert.deepEqual(
      Object.keys(item).sort(),
      [
        'category',
        'citizenAlias',
        'createdAt',
        'description',
        'evidence',
        'formalizedAt',
        'id',
        'location',
        'locationVerificationMethod',
        'plusCode',
        'plusCodeSource',
        'publicCode',
        'status',
        'subcategory',
        'suggestedUnits',
        'title',
      ]
    );
    assert.ok(item.citizenAlias.startsWith('Vecino'), 'el alias es visible para el moderador');
  });
});

describe('aprobacion y asignacion atomicas', () => {
  async function createPendingComplaint() {
    const citizen = await harness.loginCitizenWithAlias();
    return harness.createFormalizedComplaint(citizen.jar, complaintPayload(baches));
  }

  test('aprueba y asigna en una sola transaccion con historial', async () => {
    const complaint = await createPendingComplaint();

    const response = await fetchAs(moderator.jar, `/api/v1/moderation/complaints/${complaint.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ municipalUnitId: obrasPublicas.id }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'ASSIGNED');
    assert.equal(body.assignedUnit.code, 'OBRAS_PUBLICAS');

    const reviews = await fetchReviewRows(complaint.id);
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].decision, 'APPROVED');
    assert.equal(reviews[0].selectedUnitId, obrasPublicas.id);
    assert.equal(reviews[0].moderatorUserId, moderatorId);

    const assignments = await fetchAssignmentRows(complaint.id);
    assert.equal(assignments.length, 1);
    assert.equal(assignments[0].municipalUnitId, obrasPublicas.id);
    assert.equal(assignments[0].assignedByUserId, moderatorId);
    assert.equal(assignments[0].endedAt, null);

    const history = await fetchHistoryRows(complaint.id);
    const moderationEntry = history.find((h) => h.reason === 'MODERATION_APPROVED');
    assert.ok(moderationEntry);
    assert.equal(moderationEntry.previousStatus, 'PENDING_REVIEW');
    assert.equal(moderationEntry.newStatus, 'ASSIGNED');
    assert.equal(moderationEntry.changedByUserId, moderatorId);
  });

  test('la doble aprobacion responde 409 sin duplicar filas', async () => {
    const complaint = await createPendingComplaint();

    const first = await fetchAs(moderator.jar, `/api/v1/moderation/complaints/${complaint.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ municipalUnitId: obrasPublicas.id }),
    });
    assert.equal(first.status, 200);

    const second = await fetchAs(moderator.jar, `/api/v1/moderation/complaints/${complaint.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ municipalUnitId: obrasPublicas.id }),
    });
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error.code, 'COMPLAINT_NOT_REVIEWABLE');

    assert.equal((await fetchReviewRows(complaint.id)).length, 1);
    assert.equal((await fetchAssignmentRows(complaint.id)).length, 1);
  });

  test('rechaza una unidad municipal invalida con 422', async () => {
    const complaint = await createPendingComplaint();
    const response = await fetchAs(moderator.jar, `/api/v1/moderation/complaints/${complaint.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ municipalUnitId: '00000000-0000-0000-0000-000000000000' }),
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'INVALID_MUNICIPAL_UNIT');
  });

  test('no permite aprobar una denuncia que sigue en ventana de gracia', async () => {
    const citizen = await harness.loginCitizenWithAlias();
    const created = await (
      await fetchAs(citizen.jar, '/api/v1/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(complaintPayload(baches)),
      })
    ).json();

    const response = await fetchAs(moderator.jar, `/api/v1/moderation/complaints/${created.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ municipalUnitId: obrasPublicas.id }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'COMPLAINT_NOT_REVIEWABLE');
  });
});

describe('rechazo con motivo obligatorio', () => {
  async function createPendingComplaint() {
    const citizen = await harness.loginCitizenWithAlias();
    return harness.createFormalizedComplaint(citizen.jar, complaintPayload(baches));
  }

  test('sin motivo responde 422', async () => {
    const complaint = await createPendingComplaint();
    const response = await fetchAs(moderator.jar, `/api/v1/moderation/complaints/${complaint.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 422);
  });

  test('un motivo en blanco responde 422', async () => {
    const complaint = await createPendingComplaint();
    const response = await fetchAs(moderator.jar, `/api/v1/moderation/complaints/${complaint.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejectionReason: '     ' }),
    });
    assert.equal(response.status, 422);
  });

  test('rechaza con motivo, registra revision e historial', async () => {
    const complaint = await createPendingComplaint();

    const response = await fetchAs(moderator.jar, `/api/v1/moderation/complaints/${complaint.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rejectionReason: 'La foto no corresponde a la direccion indicada.' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'REJECTED');

    const reviews = await fetchReviewRows(complaint.id);
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].decision, 'REJECTED');
    assert.equal(reviews[0].rejectionReason, 'La foto no corresponde a la direccion indicada.');
    assert.equal(reviews[0].selectedUnitId, null);
    assert.equal(reviews[0].moderatorUserId, moderatorId);

    const history = await fetchHistoryRows(complaint.id);
    const rejection = history.find((h) => h.reason === 'MODERATION_REJECTED');
    assert.ok(rejection);
    assert.equal(rejection.newStatus, 'REJECTED');
    assert.equal(rejection.changedByUserId, moderatorId);

    // Y ya no puede aprobarse.
    const approveAfter = await fetchAs(moderator.jar, `/api/v1/moderation/complaints/${complaint.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ municipalUnitId: obrasPublicas.id }),
    });
    assert.equal(approveAfter.status, 409);
  });
});

describe('duplicados y grupos', () => {
  test('candidatas por cercania geografica y misma subcategoria', async () => {
    const citizenA = await harness.loginCitizenWithAlias({ alias: 'Vecino Punto A' });
    const citizenB = await harness.loginCitizenWithAlias({ alias: 'Vecino Punto B' });
    const citizenC = await harness.loginCitizenWithAlias({ alias: 'Vecino Punto C' });
    const citizenD = await harness.loginCitizenWithAlias({ alias: 'Vecino Punto D' });

    const a = await harness.createFormalizedComplaint(citizenA.jar, complaintPayload(baches, {
      latitude: -17.3895, longitude: -66.1568,
    }));
    // ~53 m del punto A: dentro del radio.
    const b = await harness.createFormalizedComplaint(citizenB.jar, complaintPayload(baches, {
      latitude: -17.3895, longitude: -66.1563,
    }));
    // Kilometros de distancia: fuera del radio.
    const c = await harness.createFormalizedComplaint(citizenC.jar, complaintPayload(baches, {
      latitude: -17.4500, longitude: -66.2500,
    }));
    // Cerca de A pero de otra subcategoria: excluida.
    const d = await harness.createFormalizedComplaint(citizenD.jar, complaintPayload(seguridad, {
      latitude: -17.3895, longitude: -66.1563,
    }));

    const response = await fetchAs(moderator.jar, `/api/v1/moderation/complaints/${a.id}/duplicate-candidates`);
    assert.equal(response.status, 200);
    const body = await response.json();

    const ids = body.candidates.map((candidate) => candidate.id);
    assert.ok(ids.includes(b.id), 'la denuncia cercana aparece');
    assert.ok(!ids.includes(c.id), 'la lejana queda fuera');
    assert.ok(!ids.includes(d.id), 'la de otra subcategoria queda fuera');

    const near = body.candidates.find((candidate) => candidate.id === b.id);
    assert.ok(near.distanceMeters > 0 && near.distanceMeters <= 100);
    assert.equal(near.citizenAlias, 'Vecino Punto B');
  });

  test('propone duplicados con unicidad de par y auto-propuesta bloqueada', async () => {
    const citizenA = await harness.loginCitizenWithAlias();
    const citizenB = await harness.loginCitizenWithAlias();
    const a = await harness.createFormalizedComplaint(citizenA.jar, complaintPayload(baches));
    const b = await harness.createFormalizedComplaint(citizenB.jar, complaintPayload(baches, {
      latitude: -17.3895, longitude: -66.1563,
    }));

    const propose = (payload) =>
      fetchAs(moderator.jar, `/api/v1/moderation/complaints/${a.id}/duplicate-proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

    const first = await propose({ candidateComplaintId: b.id });
    assert.equal(first.status, 201);
    const proposal = await first.json();
    assert.equal(proposal.status, 'PENDING');

    const second = await propose({ candidateComplaintId: b.id });
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error.code, 'DUPLICATE_PROPOSAL_EXISTS');

    const self = await propose({ candidateComplaintId: a.id });
    assert.equal(self.status, 422);
    assert.equal((await self.json()).error.code, 'INVALID_DUPLICATE_CANDIDATE');

    // Listado con filtro PENDING.
    const listResponse = await fetchAs(moderator.jar, '/api/v1/moderation/duplicate-proposals?status=PENDING');
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    const found = list.proposals.find((item) => item.id === proposal.id);
    assert.ok(found, 'la propuesta aparece en el listado');
    assert.equal(found.complaint.id, a.id);
    assert.equal(found.candidate.id, b.id);

    // Resolucion NOT_DUPLICATE y no-reprocesabilidad.
    const resolveResponse = await fetchAs(moderator.jar, `/api/v1/moderation/duplicate-proposals/${proposal.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'NOT_DUPLICATE' }),
    });
    assert.equal(resolveResponse.status, 200);
    assert.equal((await resolveResponse.json()).status, 'NOT_DUPLICATE');

    const { rows: proposalRows } = await db.query(
      `SELECT status, reviewed_by_user_id AS "reviewedByUserId", reviewed_at AS "reviewedAt"
         FROM duplicate_proposals WHERE id = $1`,
      [proposal.id]
    );
    assert.equal(proposalRows[0].status, 'NOT_DUPLICATE');
    assert.equal(proposalRows[0].reviewedByUserId, moderatorId);
    assert.ok(proposalRows[0].reviewedAt);

    const resolveAgain = await fetchAs(moderator.jar, `/api/v1/moderation/duplicate-proposals/${proposal.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'NOT_DUPLICATE' }),
    });
    assert.equal(resolveAgain.status, 409);
    assert.equal((await resolveAgain.json()).error.code, 'PROPOSAL_ALREADY_RESOLVED');
  });

  test('resolver CONFIRMED_GROUP exige titulo y crea grupo con miembros', async () => {
    const citizenA = await harness.loginCitizenWithAlias();
    const citizenB = await harness.loginCitizenWithAlias();
    const a = await harness.createFormalizedComplaint(citizenA.jar, complaintPayload(baches));
    const b = await harness.createFormalizedComplaint(citizenB.jar, complaintPayload(baches, {
      latitude: -17.3895, longitude: -66.1563,
    }));

    const propose = await fetchAs(moderator.jar, `/api/v1/moderation/complaints/${a.id}/duplicate-proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateComplaintId: b.id }),
    });
    const proposal = await propose.json();

    const missingTitle = await fetchAs(moderator.jar, `/api/v1/moderation/duplicate-proposals/${proposal.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'CONFIRMED_GROUP' }),
    });
    assert.equal(missingTitle.status, 422, 'CONFIRMED_GROUP sin titulo es invalido');

    const confirm = await fetchAs(moderator.jar, `/api/v1/moderation/duplicate-proposals/${proposal.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'CONFIRMED_GROUP', title: 'Baches en la avenida principal' }),
    });
    assert.equal(confirm.status, 200);
    const confirmed = await confirm.json();
    assert.equal(confirmed.status, 'CONFIRMED_GROUP');
    assert.equal(confirmed.group.title, 'Baches en la avenida principal');

    const { rows: members } = await db.query(
      `SELECT complaint_id AS "complaintId", group_id AS "groupId"
         FROM complaint_group_members
        WHERE group_id = $1`,
      [confirmed.group.id]
    );
    assert.deepEqual(
      members.map((m) => m.complaintId).sort(),
      [a.id, b.id].sort()
    );

    const { rows: proposalRows } = await db.query(
      'SELECT status FROM duplicate_proposals WHERE id = $1',
      [proposal.id]
    );
    assert.equal(proposalRows[0].status, 'CONFIRMED_GROUP');
  });

  test('POST /groups agrupa, auto-confirma propuestas y evita grupos abiertos solapados', async () => {
    const citizenA = await harness.loginCitizenWithAlias();
    const citizenB = await harness.loginCitizenWithAlias();
    const a = await harness.createFormalizedComplaint(citizenA.jar, complaintPayload(baches));
    const b = await harness.createFormalizedComplaint(citizenB.jar, complaintPayload(baches, {
      latitude: -17.3895, longitude: -66.1563,
    }));

    // Propuesta pendiente entre ambas: debe auto-confirmarse al agrupar.
    const propose = await fetchAs(moderator.jar, `/api/v1/moderation/complaints/${a.id}/duplicate-proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateComplaintId: b.id }),
    });
    const proposal = await propose.json();

    const groupResponse = await fetchAs(moderator.jar, '/api/v1/moderation/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Grupo de baches avenida',
        complaintIds: [a.id, b.id],
      }),
    });
    assert.equal(groupResponse.status, 201);
    const { group, confirmedProposals } = await groupResponse.json();
    assert.deepEqual(group.complaintIds.sort(), [a.id, b.id].sort());
    assert.equal(confirmedProposals, 1);

    const { rows: proposalRows } = await db.query(
      'SELECT status FROM duplicate_proposals WHERE id = $1',
      [proposal.id]
    );
    assert.equal(proposalRows[0].status, 'CONFIRMED_GROUP');

    // Re-agrupar una denuncia ya en un grupo abierto: 409.
    const citizenE = await harness.loginCitizenWithAlias();
    const e = await harness.createFormalizedComplaint(citizenE.jar, complaintPayload(baches));
    const overlap = await fetchAs(moderator.jar, '/api/v1/moderation/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Grupo solapado',
        complaintIds: [a.id, e.id],
      }),
    });
    assert.equal(overlap.status, 409);
    assert.equal((await overlap.json()).error.code, 'COMPLAINT_ALREADY_GROUPED');
  });

  test('grupos con menos de 2 denuncias o ids repetidos son invalidos', async () => {
    const single = await fetchAs(moderator.jar, '/api/v1/moderation/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Grupo de una', complaintIds: ['00000000-0000-0000-0000-000000000001'] }),
    });
    assert.equal(single.status, 422);

    const citizen = await harness.loginCitizenWithAlias();
    const complaint = await harness.createFormalizedComplaint(citizen.jar, complaintPayload(baches));
    const repeated = await fetchAs(moderator.jar, '/api/v1/moderation/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Grupo repetido',
        complaintIds: [complaint.id, complaint.id],
      }),
    });
    assert.equal(repeated.status, 422);
  });
});
