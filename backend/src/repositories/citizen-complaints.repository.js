/**
 * Repositorio de "Mis Denuncias" (Fase 6). Consultas de solo lectura,
 * parametrizadas y EXCLUSIVAMENTE del ciudadano autenticado.
 *
 * Privacidad: una sola consulta con LEFT JOIN LATERAL para el motivo de
 * rechazo, la unidad asignada y la solucion aprobada. No se consulta ninguna
 * tabla de identidad (sin email, sin provider_subject) y no se incluye
 * evidencia multimedia alguna: la respuesta del ciudadano solo contiene
 * texto y estado (la evidencia de la solucion es inalcanzable ademas por el
 * CHECK de media_assets: purpose='SOLUTION_EVIDENCE' exige complaint_id NULL).
 */
const MY_COMPLAINTS_SELECT = `
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
         rejection.rejection_reason AS "rejectionReason",
         unit.id AS "assignedUnitId",
         unit.code AS "assignedUnitCode",
         unit.name AS "assignedUnitName",
         assignment.assigned_at AS "assignedAt",
         solution.id AS "solutionId",
         solution.description AS "solutionDescription",
         solution.submitted_at AS "solutionSubmittedAt",
         solution.reviewed_at AS "solutionReviewedAt"
    FROM complaints c
    JOIN categories cat ON cat.id = c.category_id
    JOIN subcategories sub ON sub.id = c.subcategory_id
    LEFT JOIN LATERAL (
      SELECT mr.rejection_reason
        FROM moderation_reviews mr
       WHERE mr.complaint_id = c.id
         AND mr.decision = 'REJECTED'
       ORDER BY mr.created_at DESC
       LIMIT 1
    ) rejection ON TRUE
    LEFT JOIN LATERAL (
      SELECT ca.municipal_unit_id, ca.assigned_at
        FROM complaint_assignments ca
       WHERE ca.complaint_id = c.id
         AND ca.ended_at IS NULL
       LIMIT 1
    ) assignment ON TRUE
    LEFT JOIN municipal_units unit ON unit.id = assignment.municipal_unit_id
    LEFT JOIN LATERAL (
      SELECT cs.id, cs.description, cs.submitted_at, cs.reviewed_at
        FROM complaint_solutions cs
       WHERE cs.complaint_id = c.id
         AND cs.status = 'APPROVED'
       ORDER BY cs.submitted_at DESC
       LIMIT 1
    ) solution ON TRUE
   WHERE c.citizen_user_id = $1
     AND c.deleted_at IS NULL
`;

export function createCitizenComplaintsRepository({ db }) {
  async function findOwnComplaints({ citizenUserId, status, limit, offset }) {
    const params = [citizenUserId];
    let where = '';
    if (status) {
      params.push(status);
      where = ` AND c.status = $${params.length}`;
    }
    params.push(limit);
    const limitPlaceholder = `$${params.length}`;
    params.push(offset);
    const offsetPlaceholder = `$${params.length}`;

    const { rows } = await db.query(
      `${MY_COMPLAINTS_SELECT}${where}
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
      params
    );
    return rows;
  }

  async function countOwnComplaints({ citizenUserId, status }) {
    const params = [citizenUserId];
    let where = '';
    if (status) {
      params.push(status);
      where = ` AND c.status = $${params.length}`;
    }
    const { rows } = await db.query(
      `SELECT count(*)::int AS total
         FROM complaints c
        WHERE c.citizen_user_id = $1
          AND c.deleted_at IS NULL${where}`,
      params
    );
    return rows[0].total;
  }

  return { findOwnComplaints, countOwnComplaints };
}
