import { isAppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Manejador centralizado de errores.
 *
 * Nunca expone stack traces, SQL, rutas del sistema ni secretos. El detalle
 * tecnico se registra en el servidor, sin datos sensibles. Los errores de
 * validacion incluyen `details` accionables; los 5xx solo un mensaje generico.
 */
// eslint-disable-next-line no-unused-vars -- Express identifica el error handler por su aridad (4 argumentos).
export function errorHandler(error, req, res, next) {
  const operational = isAppError(error);
  const statusCode = operational && error.statusCode ? error.statusCode : 500;

  if (statusCode >= 500) {
    // Los AppError son fallos operacionales previstos (ej. 503 de configuracion):
    // se registran como advertencia. Los inesperados se registran como error.
    logger[operational ? 'warn' : 'error'](
      'Respuesta con error del servidor durante el procesamiento de la peticion',
      {
        code: error?.code,
        name: error?.name,
        constraint: error?.constraint,
        statusCode,
      }
    );
  }

  // Los AppError llevan mensajes seguros para el cliente; los errores
  // inesperados reciben un mensaje generico sin stack, SQL ni secretos.
  const code = operational && error.code ? error.code : 'INTERNAL_ERROR';
  const message = operational ? error.message : 'Error interno del servidor.';

  const body = {
    error: {
      code,
      message,
    },
  };

  if (isAppError(error) && Array.isArray(error.details)) {
    body.error.details = error.details;
  }

  res.status(statusCode).json(body);
}
