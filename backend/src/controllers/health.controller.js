import { logger } from '../utils/logger.js';

const SERVICE_NAME = 'denuncias-cercado-api';

/**
 * Controladores de salud. Reciben la dependencia de base de datos por
 * inyeccion para poder probar el caso de indisponibilidad sin una base real.
 */
export function createHealthController({ db }) {
  return {
    /**
     * GET /api/v1/health
     *Respuesta liviana de liveness. No expone informacion del servidor.
     */
    getHealth(req, res) {
      res.status(200).json({
        status: 'ok',
        service: SERVICE_NAME,
      });
    },

    /**
     * GET /api/v1/health/ready
     * Comprueba la conectividad con PostgreSQL con una consulta minima.
     */
    async getReady(req, res) {
      try {
        await db.check();
        res.status(200).json({
          status: 'ready',
          database: 'connected',
        });
      } catch (error) {
        // Detalle tecnico solo en el servidor; al cliente un mensaje generico.
        logger.error('Fallo la verificacion de disponibilidad de PostgreSQL', {
          code: error?.code,
        });
        res.status(503).json({
          status: 'unavailable',
          database: 'disconnected',
        });
      }
    },
  };
}
