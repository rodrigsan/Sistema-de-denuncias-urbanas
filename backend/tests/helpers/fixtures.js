import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import OpenLocationCodeModule from 'open-location-code';
import { env } from '../../src/config/env.js';
import { createApp } from '../../src/app.js';
import { createGoogleOAuthService } from '../../src/services/google-oauth.service.js';
import { CookieJar, parseSignedCookieValue, listenApp } from './test-app.js';

const OpenLocationCode = OpenLocationCodeModule.OpenLocationCode ?? OpenLocationCodeModule;
const olc = new OpenLocationCode();

/**
 * Prefijo unico por PROCESO de prueba: node --test ejecuta los archivos de
 * pruebas en paralelo contra la misma base, de modo que el barrido de cada
 * archivo solo debe tocar usuarios que el mismo creo.
 */
const RUN_PREFIX = `test-sub-${crypto.randomUUID()}`;

/** `sub` de prueba unico, asociado a este proceso (opcionalmente etiquetado). */
export function testSub(label = '') {
  const suffix = label ? `${label}-` : '';
  return `${RUN_PREFIX}-${suffix}${crypto.randomUUID()}`;
}

/** Plus Code completo (10 digitos) para unas coordenadas. */
export function plusCodeFor(latitude, longitude) {
  return olc.encode(latitude, longitude);
}

// Directorio de almacenamiento temporal por proceso de prueba: nunca se
// escribe en backend/storage.
const testStorageDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'denuncias-evidence-'));

// Configuracion de prueba: credenciales ficticias de Google, limites altos de
// rate limit y limites de evidencia diminutos para pruebas rapidas.
export const testConfig = {
  ...env,
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_REDIRECT_URI: 'http://127.0.0.1:3000/api/v1/auth/google/callback',
  GENERAL_RATE_LIMIT_MAX: 100000,
  AUTH_RATE_LIMIT_MAX: 100000,
  STORAGE_DIRECTORY: testStorageDirectory,
  EVIDENCE_MAX_IMAGES: 3,
  EVIDENCE_MAX_IMAGE_MB: 1,
  EVIDENCE_MAX_VIDEOS: 1,
  EVIDENCE_MAX_VIDEO_MB: 1,
  EVIDENCE_MAX_VIDEO_SECONDS: 30,
};

/** Buffers con magic bytes reales para las pruebas de evidencia. */
export function buildJpegBuffer(sizeBytes = 512) {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  return Buffer.concat([
    header,
    Buffer.alloc(Math.max(0, sizeBytes - header.length), 0xab),
  ]);
}

export function buildPngBuffer(sizeBytes = 512) {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    header,
    Buffer.alloc(Math.max(0, sizeBytes - header.length), 0xcd),
  ]);
}

export function buildMp4Buffer(sizeBytes = 512) {
  const header = Buffer.alloc(16);
  header.write('ftyp', 4, 'ascii');
  header.write('isom', 8, 'ascii');
  return Buffer.concat([
    header,
    Buffer.alloc(Math.max(0, sizeBytes - header.length), 0x3c),
  ]);
}

export function buildTextBuffer(sizeBytes = 128) {
  return Buffer.alloc(Math.max(16, sizeBytes), 0x41);
}

/**
 * Doble del servicio de Google: misma interfaz, pero exchangeCode y
 * fetchProfile son controlados por la prueba. buildAuthorizationUrl y
 * computeCodeChallenge usan la implementacion real (logica pura).
 */
export function createFakeGoogle(realService = createGoogleOAuthService({ config: testConfig })) {
  const fake = {
    profile: { sub: 'test-sub-default', email: 'mock@example.com', emailVerified: true },
    exchangeCalls: [],
    isConfigured: () => true,
    buildAuthorizationUrl: realService.buildAuthorizationUrl,
    computeCodeChallenge: realService.computeCodeChallenge,
    async exchangeCode({ code, codeVerifier }) {
      fake.exchangeCalls.push({ code, codeVerifier });
      if (code === 'mock-invalid-grant') {
        throw Object.assign(new Error('invalid_grant'), {
          code: 'GOOGLE_TOKEN_EXCHANGE_FAILED',
        });
      }
      return { accessToken: 'mock-access-token' };
    },
    async fetchProfile() {
      return { ...fake.profile };
    },
  };
  return fake;
}

/**
 * Arreglo de pruebas compartido por las suites de Fase 2 y Fase 3: servidor
 * con Google simulado, fixtures de usuarios en BD con registro de limpieza
 * FK-safe y login de flujo completo. Todos los subs de prueba usan el
 * prefijo 'test-sub-' para poder barrerlos en stop().
 */
export function createTestHarness({ db }) {
  const createdUserIds = new Set();
  const fakeGoogle = createFakeGoogle();
  let server = null;
  let baseUrl = null;

  async function start() {
    const app = createApp({ db, config: testConfig, google: fakeGoogle });
    ({ server, baseUrl } = await listenApp(app));
    return { server, baseUrl };
  }

  async function stop() {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }

    // Barrido por prefijo de ESTE proceso (los archivos corren en paralelo).
    const { rows } = await db.query(
      'SELECT user_id FROM auth_identities WHERE provider_subject LIKE $1',
      [`${RUN_PREFIX}-%`]
    );
    for (const row of rows) createdUserIds.add(row.user_id);

    if (createdUserIds.size > 0) {
      const ids = [...createdUserIds];

      // Cadena de denuncias (FK RESTRICT exige orden): sesiones, historial,
      // jobs, assets, cooldowns y finalmente las denuncias.
      const { rows: complaintRows } = await db.query(
        'SELECT id FROM complaints WHERE citizen_user_id = ANY($1::uuid[])',
        [ids]
      );
      const complaintIds = complaintRows.map((row) => row.id);

      if (complaintIds.length > 0) {
        await db.query('DELETE FROM complaint_grace_sessions WHERE complaint_id = ANY($1::uuid[])', [complaintIds]);
        await db.query('DELETE FROM complaint_status_history WHERE complaint_id = ANY($1::uuid[])', [complaintIds]);
        await db.query(
          `DELETE FROM media_processing_jobs
            WHERE media_asset_id IN (
              SELECT id FROM media_assets
               WHERE complaint_id = ANY($1::uuid[])
                  OR solution_id IN (SELECT id FROM complaint_solutions WHERE complaint_id = ANY($1::uuid[]))
            )`,
          [complaintIds]
        );
        await db.query(
          `DELETE FROM media_assets
            WHERE complaint_id = ANY($1::uuid[])
               OR solution_id IN (SELECT id FROM complaint_solutions WHERE complaint_id = ANY($1::uuid[]))`,
          [complaintIds]
        );
        // Fase 5: tablas de moderacion que referencian denuncias (FK RESTRICT).
        await db.query('DELETE FROM complaint_group_members WHERE complaint_id = ANY($1::uuid[])', [complaintIds]);
        await db.query(
          `DELETE FROM duplicate_proposals
            WHERE complaint_id = ANY($1::uuid[])
               OR candidate_complaint_id = ANY($1::uuid[])`,
          [complaintIds]
        );
        await db.query('DELETE FROM moderation_reviews WHERE complaint_id = ANY($1::uuid[])', [complaintIds]);
        await db.query('DELETE FROM complaint_assignments WHERE complaint_id = ANY($1::uuid[])', [complaintIds]);
        // Fase 6: soluciones de las denuncias (antes de borrar denuncias).
        await db.query('DELETE FROM complaint_solutions WHERE complaint_id = ANY($1::uuid[])', [complaintIds]);
      }

      // Fase 6: suspensiones -> infracciones (FK RESTRICT) antes de usuarios/denuncias.
      await db.query('DELETE FROM suspensions WHERE citizen_user_id = ANY($1::uuid[])', [ids]);
      await db.query(
        `DELETE FROM violations
          WHERE citizen_user_id = ANY($1::uuid[])
             OR moderator_user_id = ANY($1::uuid[])`,
        [ids]
      );

      await db.query('DELETE FROM citizen_submission_limits WHERE citizen_user_id = ANY($1::uuid[])', [ids]);

      if (complaintIds.length > 0) {
        await db.query('DELETE FROM complaints WHERE id = ANY($1::uuid[])', [complaintIds]);
      }

      // Los grupos referencian a su creador (moderador de fixture).
      await db.query('DELETE FROM complaint_groups WHERE created_by_user_id = ANY($1::uuid[])', [ids]);

      // Membresias de los enlaces tecnicos de fixture.
      await db.query('DELETE FROM admin_unit_memberships WHERE user_id = ANY($1::uuid[])', [ids]);

      await db.query('DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])', [ids]);
      await db.query('DELETE FROM citizen_profiles WHERE user_id = ANY($1::uuid[])', [ids]);
      await db.query('DELETE FROM auth_identities WHERE user_id = ANY($1::uuid[])', [ids]);
      await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
      createdUserIds.clear();
    }

    await db.close();
  }

  /**
   * Fixture directa en BD: usuario con estado/tipo dados, identidad opcional
   * y roles activos. Registra el id para la limpieza final.
   */
  async function createFixtureUser({ userType, status = 'ACTIVE', sub = null, roles = [] }) {
    const { userId } = await db.transaction(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO users (user_type, status) VALUES ($1, $2) RETURNING id',
        [userType, status]
      );
      const id = rows[0].id;

      if (sub) {
        await client.query(
          "INSERT INTO auth_identities (user_id, provider, provider_subject) VALUES ($1, 'google', $2)",
          [id, sub]
        );
      }

      for (const roleCode of roles) {
        await client.query(
          'INSERT INTO user_roles (user_id, role_id) SELECT $1, r.id FROM roles r WHERE r.code = $2',
          [id, roleCode]
        );
      }

      return { userId: id };
    });

    createdUserIds.add(userId);
    return userId;
  }

  async function countIdentities(providerSubject) {
    const { rows } = await db.query(
      'SELECT count(*)::int AS total FROM auth_identities WHERE provider_subject = $1',
      [providerSubject]
    );
    return rows[0].total;
  }

  /**
   * Ejecuta el flujo completo de login con un `sub` controlado por la
   * prueba: pide /google/login, extrae el state de la cookie firmada y llama
   * al callback con un codigo mock.
   */
  async function loginThroughGoogle({
    sub,
    email = 'mock@example.com',
    emailVerified = true,
    code = 'mock-auth-code',
  } = {}) {
    assert.ok(baseUrl, 'el harness debe iniciarse con start()');
    const localJar = new CookieJar();

    fakeGoogle.profile = { sub, email, emailVerified };

    const loginResponse = await fetch(`${baseUrl}/api/v1/auth/google/login`, {
      redirect: 'manual',
    });
    localJar.absorb(loginResponse);

    const transaction = parseSignedCookieValue(localJar.get('denuncias_oauth_tx'));
    assert.ok(transaction, 'la cookie oauth_tx debe existir tras el login');

    const callbackUrl = `${baseUrl}/api/v1/auth/google/callback?code=${encodeURIComponent(
      code
    )}&state=${encodeURIComponent(transaction.state)}`;

    const callbackResponse = await fetch(callbackUrl, {
      redirect: 'manual',
      headers: { Cookie: localJar.header() },
    });
    localJar.absorb(callbackResponse);

    return { jar: localJar, loginResponse, callbackResponse, transaction };
  }

  /**
   * Login completo + alias establecido: devuelve un ciudadano listo para
   * operar denuncias.
   */
  async function loginCitizenWithAlias({ alias } = {}) {
    assert.ok(baseUrl, 'el harness debe iniciarse con start()');
    const sub = testSub();
    const { jar } = await loginThroughGoogle({ sub });

    const aliasResponse = await fetch(`${baseUrl}/api/v1/auth/alias`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: jar.header() },
      body: JSON.stringify({ alias: (alias ?? `Vecino ${crypto.randomUUID()}`).slice(0, 60) }),
    });
    assert.equal(aliasResponse.status, 201, 'el alias debe establecerse');

    return { jar, sub };
  }

  /**
   * POST /api/v1/complaints con la cookie indicada.
   */
  async function createComplaintViaApi(jar, payload) {
    return fetch(`${baseUrl}/api/v1/complaints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: jar.header() },
      body: JSON.stringify(payload),
    });
  }

  /**
   * Login de un administrador con los roles indicados (fixture + flujo OAuth
   * simulado). Para Fase 5: moderadores.
   */
  async function loginModerator({ roles = ['MODERATOR'] } = {}) {
    const sub = testSub('moderator');
    await createFixtureUser({ userType: 'ADMIN', sub, roles });
    const { jar } = await loginThroughGoogle({ sub });
    return { jar, sub };
  }

  /**
   * Crea una denuncia con el payload indicado y la formaliza por la via real:
   * expira la ventana de gracia por SQL y el siguiente acceso del ciudadano
   * dispara la formalizacion perezosa (status PENDING_REVIEW).
   */
  async function createFormalizedComplaint(jar, payload) {
    assert.ok(baseUrl, 'el harness debe iniciarse con start()');

    const createdResponse = await fetch(`${baseUrl}/api/v1/complaints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: jar.header() },
      body: JSON.stringify(payload),
    });
    assert.equal(createdResponse.status, 201, 'la denuncia debe crearse');
    const created = await createdResponse.json();

    await db.query(
      `UPDATE complaints
          SET grace_remaining_seconds = 5,
              grace_running_since = now() - interval '10 seconds'
        WHERE id = $1`,
      [created.id]
    );

    const getResponse = await fetch(`${baseUrl}/api/v1/complaints/${created.id}`, {
      headers: { Cookie: jar.header() },
    });
    assert.equal(getResponse.status, 200);
    const complaint = await getResponse.json();
    assert.equal(complaint.status, 'PENDING_REVIEW', 'la denuncia debe formalizarse');
    return complaint;
  }

  /**
   * Limpia el cooldown de 60 minutos del ciudadano (solo pruebas: simula que
   * el plazo ya paso). El comportamiento de produccion no se altera.
   */
  async function clearSubmissionCooldown(citizenUserId) {
    await db.query('DELETE FROM citizen_submission_limits WHERE citizen_user_id = $1', [
      citizenUserId,
    ]);
  }

  /**
   * Login de un Enlace Tecnico con membresias activas en las unidades
   * indicadas (por codigo de unidad).
   */
  async function loginLiaison({ unitCodes = [] } = {}) {
    const sub = testSub('enlace');
    const userId = await createFixtureUser({
      userType: 'ADMIN',
      sub,
      roles: ['TECHNICAL_LIAISON'],
    });
    for (const unitCode of unitCodes) {
      await db.query(
        `INSERT INTO admin_unit_memberships (user_id, municipal_unit_id)
         SELECT $1, mu.id FROM municipal_units mu WHERE mu.code = $2`,
        [userId, unitCode]
      );
    }
    const { jar } = await loginThroughGoogle({ sub });
    return { jar, sub };
  }

  return {
    start,
    stop,
    createFixtureUser,
    countIdentities,
    loginThroughGoogle,
    loginCitizenWithAlias,
    loginModerator,
    loginLiaison,
    createFormalizedComplaint,
    createComplaintViaApi,
    clearSubmissionCooldown,
    fakeGoogle,
  };
}
