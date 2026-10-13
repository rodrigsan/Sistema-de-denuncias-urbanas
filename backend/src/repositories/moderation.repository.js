/**
 * Repositorio de moderacion (Fase 5). Todo el SQL vive aqui, parametrizado.
 *
 * Privacidad: la unica tabla de identidad que se consulta es
 * citizen_profiles (alias). Jamas se une con auth_identities: el correo
 * privado y la cuenta de Google del ciudadano no pueden filtrarse.
 *
 * Las operaciones mutantes reciben un cliente transaccionado del lock de la
 * denuncia (complaints.repository.withComplaintLock) o de withTransaction,
 * garantizando atomicidad con FOR UPDATE.
 */
const INBOX_COMPLAINT_SELECT = `
  SELECT c.id,
         c.public_code AS "publicCode",
         c.status,
         c.title,
         c.description,
         c.category_id AS "categoryId",
         cat.code AS "categoryCode",
         cat.name AS "categoryName",
         c.subcategory_id AS "subcategoryId",
         sub.code AS "subcategoryCode",
         sub.name AS "subcategoryName",
         ST_Y(c.location::geometry) AS latitude,
         ST_X(c.location::geometry) AS longitude,
         c.plus_code AS "plusCode",
         c.plus_code_source AS "plusCodeSource",
         c.location_verification_method AS "locationVerificationMethod",
         cp.alias AS "citizenAlias",
         c.formalized_at AS "formalizedAt",
         c.created_at AS "createdAt"
    FROM complaints c
    JOIN categories cat ON cat.id = c.category_id
    JOIN subcategories sub ON sub.id = c.subcategory_id
    LEFT JOIN citizen_profiles cp ON cp.user_id = c.citizen_user_id
   WHERE c.status = 'PENDING_REVIEW'
     AND c.deleted_at IS NULL
`;

export function createModerationRepository({ db }) {
  /** Transaccion generica para operaciones de moderacion multi-tabla. */
  async function withTransaction(callback) {
    return db.transaction(callback);
  }

  function buildInboxFilters(filters, params) {
    const conditions = [];
    if (filters.categoryId) {
      params.push(filters.categoryId);
      conditions.push(`c.category_id = $${params.length}`);
    }
    if (filters.subcategoryId) {
      params.push(filters.subcategoryId);
      conditions.push(`c.subcategory_id = $${params.length}`);
    }
    if (filters.formalizedFrom) {
      params.push(filters.formalizedFrom);
      conditions.push(`c.formalized_at >= $${params.length}`);
    }
    if (filters.formalizedTo) {
      params.push(filters.formalizedTo);
      conditions.push(`c.formalized_at <= $${params.length}`);
    }
    return conditions;
  }

  /** Pagina de la bandeja (orden FIFO por formalized_at). */
  async function findPendingReviewComplaints({ filters, limit, offset }) {
    const params = [];
    const conditions = buildInboxFilters(filters, params);
    const where = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
    params.push(limit);
    const limitPlaceholder = `$${params.length}`;
    params.push(offset);
    const offsetPlaceholder = `$${params.length}`;

    const { rows } = await db.query(
      `${INBOX_COMPLAINT_SELECT}${where}
        ORDER BY c.formalized_at ASC, c.id ASC
        LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      params
    );
    return rows;
  }

  /** Total de la bandeja con los mismos filtros. */
  async function countPendingReviewComplaints({ filters }) {
    const params = [];
    const conditions = buildInboxFilters(filters, params);
    const where = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT count(*)::int AS total
         FROM complaints c
        WHERE c.status = 'PENDING_REVIEW'
          AND c.deleted_at IS NULL${where}`,
      params
    );
    return rows[0].total;
  }

  /**
   * Unidades sugeridas por assignment_rules activas para un lote de
   * subcategorias, ordenadas por prioridad (join con unidades activas).
   */
  async function findSuggestedUnitsForSubcategories(subcategoryIds) {
    const { rows } = await db.query(
      `SELECT r.subcategory_id AS "subcategoryId",
              mu.id,
              mu.code,
              mu.name,
              r.priority
         FROM assignment_rules r
         JOIN municipal_units mu ON mu.id = r.municipal_unit_id
        WHERE r.subcategory_id = ANY($1::uuid[])
          AND r.active = TRUE
          AND mu.active = TRUE
        ORDER BY r.priority ASC, mu.name ASC`,
      [subcategoryIds]
    );
    return rows;
  }

  async function findActiveMunicipalUnitById(unitId, client = null) {
    const runner = client ?? db;
    const { rows } = await runner.query(
      `SELECT id, code, name
         FROM municipal_units
        WHERE id = $1
          AND active = TRUE`,
      [unitId]
    );
    return rows[0] ?? null;
  }

  /**
   * Denuncia visible para moderacion por id (borradas = inexistentes).
   */
  async function findComplaintForModerationById(complaintId, client = null) {
    const runner = client ?? db;
    const { rows } = await runner.query(
      `SELECT id, public_code AS "publicCode", status
         FROM complaints
        WHERE id = $1
          AND deleted_at IS NULL`,
      [complaintId]
    );
    return rows[0] ?? null;
  }

  async function findCitizenAlias(citizenUserId, client = null) {
    const runner = client ?? db;
    const { rows } = await runner.query(
      'SELECT alias FROM citizen_profiles WHERE user_id = $1',
      [citizenUserId]
    );
    return rows[0]?.alias ?? null;
  }

  /**
   * Candidatas a duplicado: misma subcategoría dentro del radio (PostGIS,
   * ST_DWithin sobre GEOGRAPHY en metros), cualquier estado salvo REJECTED,
   * no borradas. Orden por distancia ascendente.
   */
  async function findDuplicateCandidates({ complaintId, radiusMeters, limit = 20 }) {
    const { rows } = await db.query(
      `SELECT c.id,
              c.public_code AS "publicCode",
              c.title,
              c.status,
              c.subcategory_id AS "subcategoryId",
              sub.code AS "subcategoryCode",
              sub.name AS "subcategoryName",
              c.created_at AS "createdAt",
              c.formalized_at AS "formalizedAt",
              cp.alias AS "citizenAlias",
              ST_Distance(c.location, ref.location) AS "distanceMeters"
         FROM complaints c
         JOIN subcategories sub ON sub.id = c.subcategory_id
         LEFT JOIN citizen_profiles cp ON cp.user_id = c.citizen_user_id
         CROSS JOIN (
           SELECT location, subcategory_id
             FROM complaints
            WHERE id = $1
              AND deleted_at IS NULL
         ) ref
        WHERE c.id <> $1
          AND c.deleted_at IS NULL
          AND c.status <> 'REJECTED'
          AND c.subcategory_id = ref.subcategory_id
          AND ST_DWithin(c.location, ref.location, $2)
        ORDER BY ST_Distance(c.location, ref.location) ASC, c.id ASC
        LIMIT $3`,
      [complaintId, radiusMeters, limit]
    );
    return rows;
  }

  async function insertModerationReview(
    client,
    { complaintId, moderatorUserId, decision, selectedUnitId = null, rejectionReason = null }
  ) {
    const { rows } = await client.query(
      `INSERT INTO moderation_reviews (
         complaint_id, moderator_user_id, decision, rejection_reason, selected_unit_id
       ) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at AS "createdAt"`,
      [complaintId, moderatorUserId, decision, rejectionReason, selectedUnitId]
    );
    return rows[0];
  }

  async function insertComplaintAssignment(
    client,
    { complaintId, municipalUnitId, assignedByUserId }
  ) {
    const { rows } = await client.query(
      `INSERT INTO complaint_assignments (
         complaint_id, municipal_unit_id, assigned_by_user_id
       ) VALUES ($1, $2, $3)
       RETURNING id, assigned_at AS "assignedAt"`,
      [complaintId, municipalUnitId, assignedByUserId]
    );
    return rows[0];
  }

  // ---- Propuestas de duplicados ----

  async function insertDuplicateProposal(client, { complaintId, candidateComplaintId }) {
    const { rows } = await client.query(
      `INSERT INTO duplicate_proposals (complaint_id, candidate_complaint_id)
       VALUES ($1, $2)
       RETURNING id, status, created_at AS "createdAt"`,
      [complaintId, candidateComplaintId]
    );
    return rows[0];
  }

  async function listDuplicateProposals({ status } = {}) {
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE p.status = $1`;
    }
    const { rows } = await db.query(
      `SELECT p.id,
              p.status,
              p.created_at AS "createdAt",
              p.reviewed_at AS "reviewedAt",
              p.reviewed_by_user_id AS "reviewedByUserId",
              p.complaint_id AS "complaintId",
              p.candidate_complaint_id AS "candidateComplaintId",
              a.public_code AS "complaintPublicCode",
              a.title AS "complaintTitle",
              a.status AS "complaintStatus",
              b.public_code AS "candidatePublicCode",
              b.title AS "candidateTitle",
              b.status AS "candidateStatus"
         FROM duplicate_proposals p
         JOIN complaints a ON a.id = p.complaint_id
         JOIN complaints b ON b.id = p.candidate_complaint_id
         ${where}
        ORDER BY p.created_at DESC
        LIMIT 100`,
      params
    );
    return rows;
  }

  /** Bloquea una propuesta (FOR UPDATE) y delega en el callback. */
  async function withProposalLock(proposalId, callback) {
    return db.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id,
                complaint_id AS "complaintId",
                candidate_complaint_id AS "candidateComplaintId",
                status
           FROM duplicate_proposals
          WHERE id = $1
            FOR UPDATE`,
        [proposalId]
      );
      return callback(rows[0] ?? null, client);
    });
  }

  /**
   * Resuelve una propuesta PENDING. Guarda por estado: devuelve false si ya
   * fue resuelta por otra transaccion.
   */
  async function resolveDuplicateProposal(client, { proposalId, status, reviewedByUserId }) {
    const { rows } = await client.query(
      `UPDATE duplicate_proposals
          SET status = $2,
              reviewed_by_user_id = $3,
              reviewed_at = now()
        WHERE id = $1
          AND status = 'PENDING'
       RETURNING id`,
      [proposalId, status, reviewedByUserId]
    );
    return rows.length > 0;
  }

  // ---- Grupos ----

  async function insertComplaintGroup(client, { title, createdByUserId }) {
    const { rows } = await client.query(
      `INSERT INTO complaint_groups (title, created_by_user_id)
       VALUES ($1, $2)
       RETURNING id, created_at AS "createdAt"`,
      [title, createdByUserId]
    );
    return rows[0];
  }

  async function insertGroupMembers(client, { groupId, complaintIds, addedByUserId }) {
    const { rows } = await client.query(
      `INSERT INTO complaint_group_members (group_id, complaint_id, added_by_user_id)
       SELECT $1, unnest($2::uuid[]), $3
       RETURNING complaint_id AS "complaintId"`,
      [groupId, complaintIds, addedByUserId]
    );
    return rows.map((row) => row.complaintId);
  }

  /** Membresias en grupos ABIERTOS (closed_at IS NULL) para un lote. */
  async function findOpenGroupMemberships(complaintIds, client = null) {
    const runner = client ?? db;
    const { rows } = await runner.query(
      `SELECT cgm.complaint_id AS "complaintId",
              g.id AS "groupId",
              g.title
         FROM complaint_group_members cgm
         JOIN complaint_groups g ON g.id = cgm.group_id
        WHERE cgm.complaint_id = ANY($1::uuid[])
          AND g.closed_at IS NULL`,
      [complaintIds]
    );
    return rows;
  }

  /**
   * Auto-confirma las propuestas PENDING cuyos extremos pertenezcan ambos
   * al conjunto agrupado (los pares internos del grupo).
   */
  async function confirmProposalsBetweenPairs(client, { complaintIds, reviewedByUserId }) {
    const { rows } = await client.query(
      `UPDATE duplicate_proposals
          SET status = 'CONFIRMED_GROUP',
              reviewed_by_user_id = $2,
              reviewed_at = now()
        WHERE status = 'PENDING'
          AND complaint_id = ANY($1::uuid[])
          AND candidate_complaint_id = ANY($1::uuid[])
       RETURNING id`,
      [complaintIds, reviewedByUserId]
    );
    return rows;
  }

  // ---- Verificacion de soluciones (Fase 6) ----

  /**
   * Solucion por id (campos de flujo). Ejecutable dentro de transaccion.
   */
  async function findSolutionById(solutionId, client = null) {
    const runner = client ?? db;
    const { rows } = await runner.query(
      `SELECT id,
              complaint_id AS "complaintId",
              status,
              submitted_by_user_id AS "submittedByUserId"
         FROM complaint_solutions
        WHERE id = $1`,
      [solutionId]
    );
    return rows[0] ?? null;
  }

  /**
   * Resuelve una solucion SUBMITTED: APPROVED (sin comentario) o RETURNED
   * (con comentario obligatorio). Guarda por estado: false si ya fue revisada.
   * El CHECK pareado (reviewed_at/reviewed_by) se satisface escribiendo ambos.
   */
  async function setSolutionResolution(
    client,
    { solutionId, status, reviewedByUserId, reviewComment = null }
  ) {
    const { rows } = await client.query(
      `UPDATE complaint_solutions
          SET status = $2,
              reviewed_by_user_id = $3,
              reviewed_at = now(),
              review_comment = $4
        WHERE id = $1
          AND status = 'SUBMITTED'
       RETURNING id, reviewed_at AS "reviewedAt"`,
      [solutionId, status, reviewedByUserId, reviewComment]
    );
    return rows[0] ?? null;
  }

  // ---- Infracciones y suspensiones (Fase 6) ----

  /**
   * Suspension ACTIVA vigente del ciudadano (para el guard de no duplicar).
   */
  async function findActiveSuspensionByCitizen(citizenUserId, client = null) {
    const runner = client ?? db;
    const { rows } = await runner.query(
      `SELECT id, status, started_at AS "startedAt", ends_at AS "endsAt"
         FROM suspensions
        WHERE citizen_user_id = $1
          AND status = 'ACTIVE'
        LIMIT 1`,
      [citizenUserId]
    );
    return rows[0] ?? null;
  }

  async function insertViolation(
    client,
    { citizenUserId, complaintId, moderatorUserId, description }
  ) {
    const { rows } = await client.query(
      `INSERT INTO violations (
         citizen_user_id, complaint_id, moderator_user_id, description
       ) VALUES ($1, $2, $3, $4)
       RETURNING id, created_at AS "createdAt"`,
      [citizenUserId, complaintId, moderatorUserId, description]
    );
    return rows[0];
  }

  /**
   * Suspension de exactamente 168 horas: now() es constante dentro de la
   * transaccion, por lo que el CHECK (ends_at = started_at + 168 h) se
   * satisface de forma natural. El UNIQUE parcial bloquea superposiciones.
   */
  async function insertSuspension(client, { citizenUserId, violationId, createdByUserId }) {
    const { rows } = await client.query(
      `INSERT INTO suspensions (
         citizen_user_id, violation_id, started_at, ends_at, created_by_user_id
       ) VALUES (
         $1, $2, now(), now() + interval '168 hours', $3
       )
       RETURNING id,
                 status,
                 started_at AS "startedAt",
                 ends_at AS "endsAt"`,
      [citizenUserId, violationId, createdByUserId]
    );
    return rows[0];
  }

  async function markCitizenSuspended(client, citizenUserId) {
    await client.query(
      `UPDATE users SET status = 'SUSPENDED' WHERE id = $1 AND status = 'ACTIVE'`,
      [citizenUserId]
    );
  }

  return {
    withTransaction,
    findPendingReviewComplaints,
    countPendingReviewComplaints,
    findSuggestedUnitsForSubcategories,
    findActiveMunicipalUnitById,
    findComplaintForModerationById,
    findCitizenAlias,
    findDuplicateCandidates,
    insertModerationReview,
    insertComplaintAssignment,
    insertDuplicateProposal,
    listDuplicateProposals,
    withProposalLock,
    resolveDuplicateProposal,
    insertComplaintGroup,
    insertGroupMembers,
    findOpenGroupMemberships,
    confirmProposalsBetweenPairs,
    findSolutionById,
    setSolutionResolution,
    findActiveSuspensionByCitizen,
    insertViolation,
    insertSuspension,
    markCitizenSuspended,
  };
}
