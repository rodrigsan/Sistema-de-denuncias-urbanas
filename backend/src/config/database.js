import pg from 'pg';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

// El pool se crea una sola vez. La cadena de conexion nunca se registra en logs.
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (error) => {
  // Solo se registra el codigo del error, sin credenciales ni cadena de conexion.
  logger.error('Error inesperado en un cliente inactivo de PostgreSQL', {
    code: error?.code,
  });
});

/**
 * Acceso a datos centralizado. Fase 1 expone consultas minimas y verificacion de
 * conectividad; los repositorios de dominio se agregaran en fases posteriores.
 */
export const db = {
  /**
   * Ejecuta una consulta parametrizada. Nunca interpolar entradas del usuario.
   */
  query(text, params) {
    return pool.query(text, params);
  },

  /**
   * Comprueba la conectividad con PostgreSQL mediante una consulta minima.
   * @returns {Promise<boolean>}
   */
  async check() {
    const { rows } = await pool.query('SELECT 1 AS ok');
    return rows[0]?.ok === 1;
  },

  /**
   * Ejecuta fn dentro de una transaccion PostgreSQL con BEGIN/COMMIT/ROLLBACK.
   *
   * @param {(client: import('pg').PoolClient) => Promise<unknown>} fn
   */
  async transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logger.error('Error al revertir la transaccion.', { code: rollbackError?.code });
      }
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Cierra ordenadamente el pool de conexiones.
   */
  async close() {
    await pool.end();
  },
};
