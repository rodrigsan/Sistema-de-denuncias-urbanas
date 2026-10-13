/**
 * Error de aplicacion controlado. Los errores operacionales pueden exponer un
 * mensaje seguro al cliente; los no operacionales se convierten en un mensaje
 * generico en el manejador central de errores.
 */
export class AppError extends Error {
  /**
   * @param {number} statusCode Codigo HTTP.
   * @param {string} code Codigo de negocio estable.
   * @param {string} message Mensaje seguro para el cliente.
   */
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace?.(this, AppError);
  }
}

export function isAppError(error) {
  return error instanceof AppError || error?.isOperational === true;
}
