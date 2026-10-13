/**
 * Extrae la sesion de la cookie firmada (cookie-parser) y la deja en
 * req.session = { userId, iat } | null. Ningun dato de rol o estado viaja en
 * la cookie: se consulta a PostgreSQL en cada peticion autenticada.
 */
export function createLoadSession({ sessionService }) {
  return function loadSession(req, res, next) {
    const raw = req.signedCookies?.[sessionService.cookieName];
    req.session = sessionService.parse(raw);
    next();
  };
}
