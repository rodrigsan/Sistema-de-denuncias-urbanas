import crypto from 'node:crypto';
import { AppError } from '../utils/errors.js';

/**
 * Repositorio de usuarios e identidades. Toda la logica de acceso a datos de
 * la Fase 2 vive aqui y usa exclusivamente consultas parametrizadas.
 *
 * Vinculo de identidad: UNIQUE (provider, provider_subject). El correo se
 * guarda como dato privado (email_private) y nunca se expone por la API.
 */
const ADMIN_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const ADMIN_CODE_PREFIX = 'CER-';
const ADMIN_CODE_RANDOM_LENGTH = 8;
const ADMIN_CODE_MAX_ATTEMPTS = 5;

const USER_SESSION_SELECT = `
  SELECT u.id,
         u.user_type AS "userType",
         u.status,
         cp.alias,
         COALESCE((
           SELECT json_agg(r.code ORDER BY r.code)
             FROM user_roles ur
             JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = u.id AND ur.revoked_at IS NULL
         ), '[]'::json) AS roles
    FROM users u
    LEFT JOIN citizen_profiles cp ON cp.user_id = u.id
`;

function normalizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    userType: row.userType,
    status: row.status,
    alias: row.alias ?? null,
    roles: Array.isArray(row.roles) ? row.roles : [],
  };
}

function randomAdministrativeCode() {
  const bytes = crypto.randomBytes(ADMIN_CODE_RANDOM_LENGTH);
  let code = '';
  for (const byte of bytes) {
    code += ADMIN_CODE_ALPHABET[byte % 32];
  }
  return `${ADMIN_CODE_PREFIX}${code}`;
}

export function createUsersRepository({ db }) {
  /**
   * Busca la cuenta vinculada a una identidad externa. Nunca por correo.
   */
  async function findByIdentity(provider, providerSubject) {
    const { rows } = await db.query(
      `${USER_SESSION_SELECT}
        JOIN auth_identities ai ON ai.user_id = u.id
       WHERE ai.provider = $1 AND ai.provider_subject = $2
       LIMIT 1`,
      [provider, providerSubject]
    );
    return normalizeUser(rows[0]);
  }

  /**
   * Carga los datos de sesion de un usuario por id interno: tipo, estado,
   * alias y roles activos. Se consulta en cada peticion autenticada.
   */
  async function findSessionData(userId) {
    const { rows } = await db.query(`${USER_SESSION_SELECT} WHERE u.id = $1 LIMIT 1`, [userId]);
    return normalizeUser(rows[0]);
  }

  /**
   * Perfil del ciudadano propio: alias, codigo administrativo y fecha de
   * registro de la cuenta. JOIN con citizen_profiles: si no existe fila
   * devuelve null y el caller responde 404. Nunca incluye email,
   * provider_subject ni roles (esos viven en /auth/me).
   */
  async function findCitizenProfile(userId) {
    const { rows } = await db.query(
      `SELECT u.id,
              u.user_type AS "userType",
              u.created_at AS "createdAt",
              cp.alias,
              cp.administrative_code AS "administrativeCode"
         FROM users u
         JOIN citizen_profiles cp ON cp.user_id = u.id
        WHERE u.id = $1
        LIMIT 1`,
      [userId]
    );
    if (!rows[0]) return null;
    return {
      id: rows[0].id,
      userType: rows[0].userType,
      alias: rows[0].alias,
      administrativeCode: rows[0].administrativeCode,
      createdAt: rows[0].createdAt,
    };
  }

  /**
   * Crea un ciudadano y su identidad dentro de una transaccion. Si dos
   * callbacks concurrentes violan UNIQUE (provider, provider_subject), el
   * error 23505 se propaga y el invocador reconsulta de forma idempotente.
   */
  async function createCitizenWithIdentity({ provider, providerSubject, email, emailVerifiedAt }) {
    return db.transaction(async (client) => {
      const { rows: userRows } = await client.query(
        "INSERT INTO users (user_type, status) VALUES ('CITIZEN', 'ACTIVE') RETURNING id"
      );
      const userId = userRows[0].id;

      await client.query(
        `INSERT INTO auth_identities (user_id, provider, provider_subject, email_private, email_verified_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, provider, providerSubject, email ?? null, emailVerifiedAt ?? null]
      );

      return { userId };
    });
  }

  /**
   * Guarda el correo verificado solo si no habia uno verificado antes.
   */
  async function updateVerifiedEmailIfMissing({ userId, email }) {
    if (!email) return;
    await db.query(
      `UPDATE auth_identities
          SET email_private = $2, email_verified_at = now()
        WHERE user_id = $1 AND email_verified_at IS NULL`,
      [userId, email]
    );
  }

  /**
   * Inserta el perfil del ciudadano con alias (no unico) y un codigo
   * administrativo unico generado en el servidor. Reintenta ante colisiones
   * de codigo; el conflicto de PK (alias ya establecido) se propaga al caller.
   */
  async function insertCitizenProfile({ userId, alias }) {
    for (let attempt = 0; attempt < ADMIN_CODE_MAX_ATTEMPTS; attempt += 1) {
      const administrativeCode = randomAdministrativeCode();
      try {
        const { rows } = await db.query(
          `INSERT INTO citizen_profiles (user_id, alias, administrative_code)
           VALUES ($1, $2, $3)
           RETURNING user_id, alias, administrative_code`,
          [userId, alias, administrativeCode]
        );
        return rows[0];
      } catch (error) {
        const isCodeCollision =
          error.code === '23505' &&
          String(error.constraint ?? '').includes('administrative_code');
        if (isCodeCollision) continue;
        throw error;
      }
    }
    throw new AppError(
      500,
      'ADMIN_CODE_GENERATION_FAILED',
      'No se pudo generar un codigo administrativo unico.'
    );
  }

  /**
   * Suspension activa del ciudadano (si existe).
   */
  async function findActiveSuspension(citizenUserId) {
    const { rows } = await db.query(
      `SELECT id,
              status,
              started_at AS "startedAt",
              ends_at AS "endsAt"
         FROM suspensions
        WHERE citizen_user_id = $1
          AND status = 'ACTIVE'
        LIMIT 1`,
      [citizenUserId]
    );
    return rows[0] ?? null;
  }

  /**
   * Expiracion perezosa de suspensiones: si el ciudadano tiene una suspension
   * ACTIVE cuya vigencia (168 horas) ya cumplio, se marca COMPLETED y se
   * reactiva la cuenta en una sola transaccion. Devuelve true si, al terminar,
   * el ciudadano puede operar de nuevo. Una cuenta SUSPENDED sin fila de
   * suspension (suspension manual) permanece bloqueada.
   *
   * El reloj es el de PostgreSQL (now()): inmune a desvios app/BD.
   */
  async function resolveExpiredSuspension(citizenUserId) {
    const suspension = await findActiveSuspension(citizenUserId);
    if (!suspension) return false;

    return db.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id
           FROM suspensions
          WHERE id = $1
            AND status = 'ACTIVE'
            AND ends_at <= now()
            FOR UPDATE`,
        [suspension.id]
      );
      if (rows.length === 0) return false; // vigente: la suspension sigue activa

      const { rows: completed } = await client.query(
        `UPDATE suspensions
            SET status = 'COMPLETED'
          WHERE id = $1
            AND status = 'ACTIVE'
         RETURNING id`,
        [suspension.id]
      );
      // Otra peticion la completo antes: el usuario ya queda reactivo.
      if (completed.length === 0) return true;

      await client.query(
        `UPDATE users
            SET status = 'ACTIVE'
          WHERE id = $1
            AND status = 'SUSPENDED'`,
        [citizenUserId]
      );
      return true;
    });
  }

  return {
    findByIdentity,
    findSessionData,
    findCitizenProfile,
    createCitizenWithIdentity,
    updateVerifiedEmailIfMissing,
    insertCitizenProfile,
    findActiveSuspension,
    resolveExpiredSuspension,
  };
}
