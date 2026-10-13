/**
 * Repositorio del Enlace Tecnico/Supervisor (Fase 6).
 *
 * Alcance: denuncias con asignacion ACTIVA dentro de las unidades de las
 * membresias activas del enlace (admin_unit_memberships.active_until IS NULL).
 * Minimizacion: no se consulta citizen_profiles (sin alias ni datos del
 * ciudadano); el enlace atiende el problema, no a la persona.
 */
const ASSIGNED_COMPLAINT_SELECT = `
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
         c.created_at AS "createdAt",
         c.formalized_at AS "formalizedAt",
         mu.id AS "assignedUnitId",
         mu.code AS "assignedUnitCode",
         mu.name AS "assignedUnitName",
         ca.assigned_at AS "assignedAt"
    FROM complaint_assignments ca
    JOIN complaints c ON c.id = ca.complaint_id
    JOIN municipal_units mu ON mu.id = ca.municipal_unit_id
    JOIN categories cat ON cat.id = c.category_id
    JOIN subcategories sub ON sub.id = c.subcategory_id
   WHERE ca.ended_at IS NULL
     AND ca.municipal_unit_id = ANY($1::uuid[])
     AND c.status = ANY($2::varchar[])
     AND c.deleted_at IS NULL
`;

export function createTechnicalRepository({ db }) {
  /** Unidades de membresias activas del enlace (unidades activas). */
  async function findActiveUnitMemberships(userId) {
    const { rows } = await db.query(
      `SELECT m.municipal_unit_id AS id,
              mu.code,
              mu.name
         FROM admin_unit_memberships m
         JOIN municipal_units mu ON mu.id = m.municipal_unit_id
        WHERE m.user_id = $1
          AND m.active_until IS NULL
          AND mu.active = TRUE`,
      [userId]
    );
    return rows;
  }

  /** Pagina de denuncias asignadas a las unidades indicadas (FIFO por asignacion). */
  async function findAssignedComplaints({ unitIds, statuses, limit, offset }) {
    const params = [unitIds, statuses];
    params.push(limit);
    const limitPlaceholder = `$${params.length}`;
    params.push(offset);
    const offsetPlaceholder = `$${params.length}`;

    const { rows } = await db.query(
      `${ASSIGNED_COMPLAINT_SELECT}
        ORDER BY ca.assigned_at ASC, c.id ASC
        LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      params
    );
    return rows;
  }

  async function countAssignedComplaints({ unitIds, statuses }) {
    const { rows } = await db.query(
      `SELECT count(*)::int AS total
         FROM complaint_assignments ca
         JOIN complaints c ON c.id = ca.complaint_id
        WHERE ca.ended_at IS NULL
          AND ca.municipal_unit_id = ANY($1::uuid[])
          AND c.status = ANY($2::varchar[])
          AND c.deleted_at IS NULL`,
      [unitIds, statuses]
    );
    return rows[0].total;
  }

  /**
   * Ultima solucion por denuncia (DISTINCT ON) para el lote indicado.
   */
  async function findLatestSolutionsByComplaintIds(complaintIds) {
    if (complaintIds.length === 0) return {};
    const { rows } = await db.query(
      `SELECT DISTINCT ON (complaint_id)
              complaint_id AS "complaintId",
              id,
              status,
              description,
              submitted_at AS "submittedAt",
              reviewed_at AS "reviewedAt",
              review_comment AS "reviewComment"
         FROM complaint_solutions
        WHERE complaint_id = ANY($1::uuid[])
        ORDER BY complaint_id, submitted_at DESC, id DESC`,
      [complaintIds]
    );

    const map = {};
    for (const row of rows) {
      const { complaintId, ...rest } = row;
      map[complaintId] = rest;
    }
    return map;
  }

  /**
   * Asignacion activa de la denuncia dentro de las unidades del enlace.
   * Null => la denuncia no existe para este enlace (404 por minimizacion).
   */
  async function findActiveAssignmentInUnits(complaintId, unitIds, client = null) {
    const runner = client ?? db;
    const { rows } = await runner.query(
      `SELECT ca.municipal_unit_id AS "municipalUnitId"
         FROM complaint_assignments ca
        WHERE ca.complaint_id = $1
          AND ca.ended_at IS NULL
          AND ca.municipal_unit_id = ANY($2::uuid[])
        LIMIT 1`,
      [complaintId, unitIds]
    );
    return rows[0] ?? null;
  }

  /**
   * Unidad de la asignacion activa de una denuncia (para vistas de respuesta).
   */
  async function findActiveAssignmentUnit(complaintId, client = null) {
    const runner = client ?? db;
    const { rows } = await runner.query(
      `SELECT mu.id,
              mu.code,
              mu.name,
              ca.assigned_at AS "assignedAt"
         FROM complaint_assignments ca
         JOIN municipal_units mu ON mu.id = ca.municipal_unit_id
        WHERE ca.complaint_id = $1
          AND ca.ended_at IS NULL
        LIMIT 1`,
      [complaintId]
    );
    return rows[0] ?? null;
  }

  /**
   * Registra la solucion (status SUBMITTED por defecto de la tabla).
   */
  async function insertComplaintSolution(client, { complaintId, submittedByUserId, description }) {
    const { rows } = await client.query(
      `INSERT INTO complaint_solutions (
         complaint_id, submitted_by_user_id, description
       ) VALUES ($1, $2, $3)
       RETURNING id,
                 status,
                 submitted_at AS "submittedAt"`,
      [complaintId, submittedByUserId, description]
    );
    return rows[0];
  }

  return {
    findActiveUnitMemberships,
    findAssignedComplaints,
    countAssignedComplaints,
    findLatestSolutionsByComplaintIds,
    findActiveAssignmentInUnits,
    findActiveAssignmentUnit,
    insertComplaintSolution,
  };
}
