import { createApp } from './app.js';
import { env } from './config/env.js';
import { db } from './config/database.js';
import { logger } from './utils/logger.js';
import { createComplaintsRepository } from './repositories/complaints.repository.js';
import { createGraceService } from './services/grace.service.js';

const app = createApp({ db, config: env });

// Se comprueba la conectividad al arrancar, pero un fallo no impide escuchar:
// el endpoint /api/v1/health/ready reportara el estado real (503).
async function reportStartupConnectivity() {
  try {
    await db.check();
    logger.info('Conexion con PostgreSQL verificada al iniciar.');
  } catch (error) {
    logger.warn('No se pudo verificar la conexion con PostgreSQL al iniciar.', {
      code: error?.code,
    });
  }
}

// Barrido periodico de la ventana de gracia: cierra sesiones de edicion
// huerfanas (TIMEOUT tras 10 minutos) y formaliza las denuncias expiradas
// aunque nadie las consulte. Desactivable con GRACE_SWEEP_ENABLED=false.
const graceService = createGraceService({
  complaintsRepository: createComplaintsRepository({ db }),
});
let graceSweepTimer = null;

function startGraceSweep() {
  if (!env.GRACE_SWEEP_ENABLED) {
    logger.warn('Barrido periodico de la ventana de gracia desactivado.');
    return;
  }
  graceSweepTimer = setInterval(() => {
    graceService
      .sweepExpired()
      .then((result) => {
        if (result.formalizedCount > 0 || result.staleSessions > 0) {
          logger.info('Barrido de gracia completado.', {
            formalizadas: result.formalizedCount,
            sesionesCerradas: result.staleSessions,
          });
        }
      })
      .catch((error) => {
        logger.warn('El barrido periodico de la ventana de gracia fallo.', {
          code: error?.code,
        });
      });
  }, graceService.GRACE_SWEEP_INTERVAL_MS);
  graceSweepTimer.unref?.();
}

const server = app.listen(env.PORT, () => {
  logger.info('Servidor HTTP iniciado.', {
    port: env.PORT,
    environment: env.NODE_ENV,
  });
  void reportStartupConnectivity();
  startGraceSweep();
});

/**
 * Cierre ordenado: detiene el temporizador, deja de aceptar conexiones y
 * cierra el pool de PostgreSQL.
 */
async function shutdown(signal) {
  logger.info('Cerrando servidor.', { signal });
  if (graceSweepTimer) {
    clearInterval(graceSweepTimer);
    graceSweepTimer = null;
  }
  server.close(async () => {
    try {
      await db.close();
      logger.info('Cierre ordenado completado.');
      process.exit(0);
    } catch (error) {
      logger.error('Error durante el cierre del pool de PostgreSQL.', {
        code: error?.code,
      });
      process.exit(1);
    }
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
