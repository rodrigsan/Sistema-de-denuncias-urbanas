import crypto from 'node:crypto';
import { AppError } from '../utils/errors.js';

/**
 * Repositorio de denuncias (Fase 4). Todo el SQL vive aqui y usa parametros.
 * Toda mutacion de estado se ejecuta dentro de una transaccion con
 * SELECT ... FOR UPDATE sobre la fila de complaints.
 *
 * Convencion de filas: alias camelCase con comillas dobles; `dbNow` viaja en
 * cada carga para que la aritmetica de gracia use el reloj de PostgreSQL.
 */
const PUBLIC_CODE_PREFIX = 'DEN-';
const PUBLIC_CODE_RANDOM_LENGTH = 8;
const PUBLIC_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const PUBLIC_CODE_MAX_ATTEMPTS = 5;

const COMPLAINT_SELECT = `
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
         c.location_verified_at AS "locationVerifiedAt",
         c.location_verification_method AS "locationVerificationMethod",
         c.grace_remaining_seconds AS "graceRemainingSeconds",
         c.grace_running_since AS "graceRunningSince",
         c.citizen_user_id AS "citizenUserId",
         c.formalized_at AS "formalizedAt",
         c.deleted_at AS "deletedAt",
         c.deletion_reason AS "deletionReason",
         c.created_at AS "createdAt",
         now() AS "dbNow"
    FROM complaints c
    JOIN categories cat ON cat.id = c.category_id
    JOIN subcategories sub ON sub.id = c.subcategory_id
   WHERE c.id = $1
     AND c.deleted_at IS NULL
`;

function generatePublicCode() {
  const bytes = crypto.randomBytes(PUBLIC_CODE_RANDOM_LENGTH);
  let body = '';
  for (const byte of bytes) body += PUBLIC_CODE_ALPHABET[byte % 32];
  return `${PUBLIC_CODE_PREFIX}${body}`;
}

export function createComplaintsRepository({ db }) {
  async function loadByIdForUpdate(client, complaintId) {
    const { rows } = await client.query(`${COMPLAINT_SELECT} FOR UPDATE OF c`, [complaintId]);
    return rows[0] ?? null;
  }

  /**
   * Transaccion con bloqueo pesimista de la denuncia. El callback recibe
   * (complaint | null, client). ROLLBACK garantizado ante excepciones.
   *
   * @param {string} complaintId
   * @param {(complaint: object|null, client: import('pg').PoolClient) => Promise<*>} callback
   */
  async function withComplaintLock(complaintId, callback) {
    return db.transaction(async (client) => {
      const complaint = await loadByIdForUpdate(client, complaintId);
      return callback(complaint, client);
    });
  }

  /**
   * Par categoria/subcategoria activo y coherente (la subcategoria debe
   * pertenecer a la categoria).
   */
  async function findActiveCategorySubcategory(categoryId, subcategoryId, client = null) {
    const runner = client ?? db;
    const { rows } = await runner.query(
      `SELECT c.id AS "categoryId",
              c.code AS "categoryCode",
              c.name AS "categoryName",
              s.id AS "subcategoryId",
              s.code AS "subcategoryCode",
              s.name AS "subcategoryName"
         FROM categories c
         JOIN subcategories s ON s.category_id = c.id
        WHERE c.id = $1
          AND s.id = $2
          AND c.active = TRUE
          AND s.active = TRUE
        LIMIT 1`,
      [categoryId, subcategoryId]
    );
    return rows[0] ?? null;
  }

  /**
   * Cooldown actual del ciudadano (registro escrito al formalizar).
   */
  async function getSubmissionLimit(citizenUserId) {
    const { rows } = await db.query(
      `SELECT next_allowed_at AS "nextAllowedAt", now() AS "dbNow"
         FROM citizen_submission_limits
        WHERE citizen_user_id = $1`,
      [citizenUserId]
    );
    return rows[0] ?? null;
  }

  /**
   * Crea la denuncia en gracia. Reintenta ante colision de public_code.
   */
  async function createComplaint({
    citizenUserId,
    title,
    description,
    categoryId,
    subcategoryId,
    latitude,
    longitude,
    plusCode,
    plusCodeSource,
    verificationMethod,
    graceSeconds,
  }) {
    return db.transaction(async (client) => {
      for (let attempt = 0; attempt < PUBLIC_CODE_MAX_ATTEMPTS; attempt += 1) {
        const publicCode = generatePublicCode();
        try {
          const { rows } = await client.query(
            `INSERT INTO complaints (
               public_code, citizen_user_id, title, description,
               category_id, subcategory_id, location, plus_code, plus_code_source,
               location_verified_at, location_verification_method,
               status, grace_remaining_seconds, grace_running_since
             ) VALUES (
               $1, $2, $3, $4,
               $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography, $9, $10,
               now(), $11,
               'GRACE_PERIOD', $12, now()
             )
             RETURNING id, public_code AS "publicCode", created_at AS "createdAt"`,
            [
              publicCode,
              citizenUserId,
              title,
              description,
              categoryId,
              subcategoryId,
              longitude,
              latitude,
              plusCode,
              plusCodeSource,
              verificationMethod,
              graceSeconds,
            ]
          );
          return rows[0];
        } catch (error) {
          if (error.code === '23505' && String(error.constraint ?? '').includes('public_code')) {
            continue;
          }
          throw error;
        }
      }
      throw new AppError(
        500,
        'PUBLIC_CODE_GENERATION_FAILED',
        'No se pudo generar un codigo publico unico.'
      );
    });
  }

  async function updateComplaintFields(
    client,
    complaintId,
    {
      title,
      description,
      categoryId,
      subcategoryId,
      latitude,
      longitude,
      plusCode,
      plusCodeSource,
      verificationMethod,
    }
  ) {
    await client.query(
      `UPDATE complaints
          SET title = $2,
              description = $3,
              category_id = $4,
              subcategory_id = $5,
              location = ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
              plus_code = $8,
              plus_code_source = $9,
              location_verified_at = now(),
              location_verification_method = $10
        WHERE id = $1`,
      [
        complaintId,
        title,
        description,
        categoryId,
        subcategoryId,
        longitude,
        latitude,
        plusCode,
        plusCodeSource,
        verificationMethod,
      ]
    );
  }

  /**
   * Transicion de estado con registro de historial en la MISMA transaccion.
   * Guarda por estado previo: si otra transicion gano la carrera devuelve
   * false sin escribir nada. Debe ejecutarse con la fila bloqueada.
   * markResolvedAt fija ademas complaints.resolved_at (verificacion
   * de soluciones: SOLUTION_SUBMITTED -> RESOLVED).
   */
  async function setStatusAndHistory(
    client,
    { complaintId, previousStatus, newStatus, changedByUserId, reason, markResolvedAt = false }
  ) {
    const { rows } = await client.query(
      `UPDATE complaints
          SET status = $3${markResolvedAt ? ', resolved_at = now()' : ''}
        WHERE id = $1
          AND status = $2
          AND deleted_at IS NULL
       RETURNING id`,
      [complaintId, previousStatus, newStatus]
    );
    if (rows.length === 0) return false;

    await client.query(
      `INSERT INTO complaint_status_history (
         complaint_id, previous_status, new_status, changed_by_user_id, reason
       ) VALUES ($1, $2, $3, $4, $5)`,
      [complaintId, previousStatus, newStatus, changedByUserId, reason]
    );
    return true;
  }

  // ---- Motor de gracia: primitivas sobre cliente transaccionado ----

  async function pauseClock(client, complaintId, remainingSeconds) {
    await client.query(
      `UPDATE complaints
          SET grace_remaining_seconds = $2,
              grace_running_since = NULL
        WHERE id = $1`,
      [complaintId, remainingSeconds]
    );
  }

  async function resumeClock(client, complaintId) {
    await client.query(
      `UPDATE complaints
          SET grace_running_since = now()
        WHERE id = $1
          AND grace_running_since IS NULL`,
      [complaintId]
    );
  }

  async function findOpenEditSession(client, complaintId) {
    const { rows } = await client.query(
      `SELECT id, started_at AS "startedAt"
         FROM complaint_grace_sessions
        WHERE complaint_id = $1
          AND ended_at IS NULL
        LIMIT 1`,
      [complaintId]
    );
    return rows[0] ?? null;
  }

  async function insertEditSession(client, complaintId) {
    const { rows } = await client.query(
      `INSERT INTO complaint_grace_sessions (complaint_id)
       VALUES ($1)
       RETURNING id`,
      [complaintId]
    );
    return rows[0];
  }

  async function closeOpenEditSession(client, complaintId, endReason) {
    const { rows } = await client.query(
      `UPDATE complaint_grace_sessions
          SET ended_at = now(), end_reason = $2
        WHERE complaint_id = $1
          AND ended_at IS NULL
       RETURNING id`,
      [complaintId, endReason]
    );
    return rows[0] ?? null;
  }

  /**
   * Cierra una sesion de edicion huerfana (abierta hace mas de staleMinutes)
   * con end_reason TIMEOUT y devuelve true si cerro una.
   */
  async function closeStaleEditSession(client, complaintId, staleMinutes) {
    const { rows } = await client.query(
      `UPDATE complaint_grace_sessions
          SET ended_at = now(), end_reason = 'TIMEOUT'
        WHERE complaint_id = $1
          AND ended_at IS NULL
          AND started_at < now() - make_interval(mins => $2::int)
       RETURNING id`,
      [complaintId, staleMinutes]
    );
    return rows.length > 0;
  }

  /**
   * Formaliza la denuncia ya bloqueada: transicion de estado, cierre de
   * sesion, historial y cooldown de 60 minutos en una sola transaccion.
   */
  async function formalizeLocked(client, complaint, cooldownMinutes) {
    const { rows } = await client.query(
      `UPDATE complaints
          SET status = 'PENDING_REVIEW',
              formalized_at = now(),
              grace_remaining_seconds = 0,
              grace_running_since = NULL
        WHERE id = $1
          AND status = 'GRACE_PERIOD'
       RETURNING id`,
      [complaint.id]
    );
    if (rows.length === 0) return false; // otro request formalizo antes (idempotente)

    await closeOpenEditSession(client, complaint.id, 'FORMALIZED');

    await client.query(
      `INSERT INTO complaint_status_history (
         complaint_id, previous_status, new_status, changed_by_user_id, reason
       ) VALUES ($1, 'GRACE_PERIOD', 'PENDING_REVIEW', NULL, 'GRACE_PERIOD_EXPIRED')`,
      [complaint.id]
    );

    await client.query(
      `INSERT INTO citizen_submission_limits (
         citizen_user_id, next_allowed_at, last_formalized_complaint_id
       ) VALUES ($1, now() + make_interval(mins => $2::int), $3)
       ON CONFLICT (citizen_user_id) DO UPDATE
         SET next_allowed_at = now() + make_interval(mins => $2::int),
             last_formalized_complaint_id = $3,
             updated_at = now()`,
      [complaint.citizenUserId, cooldownMinutes, complaint.id]
    );

    return true;
  }

  /**
   * Borrado suave del ciudadano: oculta la denuncia, congela la gracia y
   * guarda la traza minima. El cooldown NO se toca.
   */
  async function softDelete(client, complaintId, deletionReason) {
    await client.query(
      `UPDATE complaints
          SET deleted_at = now(),
              deletion_reason = $2,
              grace_running_since = NULL
        WHERE id = $1`,
      [complaintId, deletionReason]
    );
  }

  /**
   * Barrido por lotes (temporizador de server.js): cierra sesiones huerfanas,
   * reanuda sus relojes y formaliza las expiradas. SKIP LOCKED evita pisar
   * transacciones en curso.
   */
  async function sweepExpired({ staleMinutes, cooldownMinutes, limit = 100 }) {
    return db.transaction(async (client) => {
      const { rows: staleSessions } = await client.query(
        `UPDATE complaint_grace_sessions
            SET ended_at = now(), end_reason = 'TIMEOUT'
          WHERE ended_at IS NULL
            AND started_at < now() - make_interval(mins => $1::int)
         RETURNING complaint_id`,
        [staleMinutes]
      );

      if (staleSessions.length > 0) {
        await client.query(
          `UPDATE complaints
              SET grace_running_since = now()
            WHERE id = ANY($1::uuid[])
              AND grace_running_since IS NULL`,
          [staleSessions.map((row) => row.complaint_id)]
        );
      }

      const { rows: expired } = await client.query(
        `SELECT c.id, c.citizen_user_id AS "citizenUserId"
           FROM complaints c
          WHERE c.status = 'GRACE_PERIOD'
            AND c.deleted_at IS NULL
            AND c.grace_running_since IS NOT NULL
            AND now() - c.grace_running_since >= make_interval(secs => c.grace_remaining_seconds)
          ORDER BY c.created_at
          LIMIT $1
            FOR UPDATE SKIP LOCKED`,
        [limit]
      );

      let formalizedCount = 0;
      for (const row of expired) {
        const done = await formalizeLocked(client, row, cooldownMinutes);
        if (done) formalizedCount += 1;
      }
      return { formalizedCount, staleSessions: staleSessions.length };
    });
  }

  return {
    withComplaintLock,
    findActiveCategorySubcategory,
    getSubmissionLimit,
    createComplaint,
    updateComplaintFields,
    setStatusAndHistory,
    pauseClock,
    resumeClock,
    findOpenEditSession,
    insertEditSession,
    closeOpenEditSession,
    closeStaleEditSession,
    formalizeLocked,
    softDelete,
    sweepExpired,
  };
}
