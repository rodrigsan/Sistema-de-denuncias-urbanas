/**
 * Envuelve un handler async para que las promesas rechazadas lleguen al
 * manejador central de errores (Express 4 no las captura automaticamente).
 *
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<unknown>} handler
 */
export function asyncHandler(handler) {
  return function wrapped(request, response, next) {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}
