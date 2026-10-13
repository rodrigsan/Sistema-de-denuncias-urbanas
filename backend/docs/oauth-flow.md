# Flujo de Google OAuth 2.0 + PKCE y sesion (Fase 2)

Documentacion previa a la implementacion exigida por la seccion 7 de
`docs/04-especificacion-backend-inicial.md`. Describe inicio, callback,
validacion de `state`, intercambio de codigo, verificacion de identidad,
creacion/vinculacion por `provider_subject`, cierre de sesion y comportamiento
ante cuentas sin rol administrativo.

## 1. Actores y secretos

| Elemento | Donde vive | Observaciones |
| --- | --- | --- |
| `SESSION_SECRET` | variable de entorno | Firma HMAC de las cookies de sesion y de la transaccion OAuth. Obligatorio; en produccion no puede ser el valor de ejemplo. |
| `GOOGLE_CLIENT_ID/SECRET` | variable de entorno | Obligatorios en produccion. En desarrollo pueden estar vacios: `/auth/google/login` responde `503 OAUTH_NOT_CONFIGURED`. |
| `state` y `code_verifier` | cookie `denuncias_oauth_tx` (HttpOnly, firmada, 10 min, `Path=/api/v1/auth`) | El navegador nunca los lee; expiran solos. |
| Cookie de sesion `denuncias_session` | HttpOnly, firmada, `SameSite=Lax`, `Secure` en produccion, `Path=/`, TTL 8 h | Solo contiene `{ userId, iat }`. Roles y estado se consultan en PostgreSQL en cada peticion. |
| Tokens de Google | Solo en memoria durante el callback | No se persisten ni se registran en logs (reglas 7 y 12 de la seccion 6). |

## 2. Inicio de sesion — `GET /api/v1/auth/google/login`

1. Si falta la configuracion de Google → `503 { error: { code: "OAUTH_NOT_CONFIGURED" } }`.
2. Genera `state` (16 bytes base64url) y `code_verifier` (32 bytes base64url,
   43 caracteres, rango RFC 7636) con `node:crypto`.
3. `code_challenge = base64url(sha256(code_verifier))` (metodo `S256`).
4. Fija la cookie `denuncias_oauth_tx` con `{ state, codeVerifier, exp }` firmada,
   `HttpOnly`, `SameSite=Lax`, `Secure` en produccion, `Path=/api/v1/auth`, `Max-Age=600`.
   - **Por que Lax y no Strict:** el callback llega como navegacion top-level desde
     `accounts.google.com`; con `Strict` el navegador no enviaria la cookie y el
     flujo se romperia. Lax si la envia en navegaciones GET top-level.
5. Redirige `302` al endpoint de autorizacion con `response_type=code`,
   `scope=openid email profile`, `state`, `code_challenge`, `code_challenge_method=S256`
   y `prompt=select_account`. No se pide `offline_access` (no hay refresh token).

## 3. Callback — `GET /api/v1/auth/google/callback`

1. Si Google reporta `error` (ej. usuario cancelo) → limpia la cookie temporal y
   redirige al frontend con `status=error&reason=google_error`.
2. Valida `code` y `state` presentes; si faltan → `reason=missing_params`.
3. Lee y verifica la cookie `denuncias_oauth_tx` (firma y expiracion). Si es
   invalida → `reason=state_invalid`. **Sin cookie valida no hay flujo.**
4. Compara el `state` recibido con el almacenado usando `crypto.timingSafeEqual`
   (tiempo constante). Desajuste → `reason=state_invalid`; no se crea nada.
5. Intercambia el codigo en `https://oauth2.googleapis.com/token` enviando
   `code_verifier`, `redirect_uri`, `client_id` y `client_secret`. Fallo →
   `reason=token_exchange` (detalle tecnico solo al log, sin tokens).
6. Obtiene el perfil en `https://openidconnect.googleapis.com/v1/userinfo` con el
   `access_token`. Fallo → `reason=profile_failed`.
7. **Identidad:** el `sub` de Google (`provider_subject`). El correo nunca es
   identificador; solo se guarda en `auth_identities.email_private` si
   `email_verified=true` (y jamas se expone ni se loguea).
8. Resolucion de cuenta:
   - Si existe identidad `(google, sub)` → se reutiliza la cuenta.
   - Si no existe → transaccion PostgreSQL: `INSERT users (CITIZEN, ACTIVE)` +
     `INSERT auth_identities`. Ante carrera (`23505` por `UNIQUE (provider,
     provider_subject)`) se reconsulta de forma idempotente.
   - Si `users.status != 'ACTIVE'` (SUSPENDED/DISABLED) → `reason=account_blocked`,
     sin sesion.
9. Exito: limpia `denuncias_oauth_tx`, emite `denuncias_session` con `{ userId,
   iat }` y redirige `302` a `${FRONTEND_ORIGIN}/auth/callback?status=success`.

Los `reason` posibles son genericos y no filtran detalles: `google_error`,
`missing_params`, `state_invalid`, `token_exchange`, `profile_failed`,
`account_creation_failed`, `account_blocked`.

## 4. Primer acceso de ciudadano y alias

- La cookie de sesion no contiene roles ni alias. `GET /api/v1/auth/me` consulta
  PostgreSQL y devuelve `requiresAlias: true` cuando el usuario es `CITIZEN` y
  aun no tiene fila en `citizen_profiles`.
- `POST /api/v1/auth/alias` (autenticado, validado con Zod, protegido por CSRF
  de Origin) inserta `citizen_profiles`: el **alias no es unico**; el
  `administrative_code` si (`CER-` + 8 caracteres Crockford base32 generados en
  servidor, con reintentos ante colision).
- Un segundo intento responde `409 ALIAS_ALREADY_SET`: el alias no se puede
  cambiar despues de establecerse (regla que la Fase 3 mantiene).

## 5. Cuentas administrativas sin roles

- `/me` devuelve `roles` (activos: `revoked_at IS NULL`) y `adminLocked: true`
  cuando el usuario es `ADMIN` y no tiene ningun rol activo.
- Ninguna ruta publica otorga `SUPERADMIN`. Las rutas administrativas de fases
  posteriores exigiran `requireRole(...)` en el backend, jamas datos del cliente.
- Un `ADMIN` no puede fijar alias (`403`): `citizen_profiles` es solo de ciudadanos.

## 6. Cierre de sesion — `POST /api/v1/auth/logout`

- Requiere el mismo `Path`, `SameSite` y `Secure` usados al emitirla; responde
  `204` y expira la cookie (`Expires=Thu, 01 Jan 1970`).
- Al no haber estado server-side, la expiracion de la cookie es la destruccion
  completa: no quedan artefactos del lado del servidor.

## 7. Protecciones activas

- Cookies `HttpOnly` + firmadas (HMAC-SHA256 via cookie-parser con `SESSION_SECRET`).
- `SameSite=Lax` + verificacion de `Origin` en metodos mutantes (CSRF).
- Rate limit especifico de autenticacion (`AUTH_RATE_LIMIT_MAX`, 10/15 min por defecto).
- Todas las consultas SQL con parametros; ninguna entrada interpolada.
- Errores al cliente genericos; detalle tecnico solo en logs del servidor.
- Nunca se registran en logs: tokens OAuth, cookies, correos, `state`/verificadores.

## 8. Consideraciones de despliegue en produccion

- La cookie exige HTTPS para `Secure`; el proxy debe reenviar correctamente.
- Si frontend y API estan en sitios distintos (no mismo registrable), la cookie
  necesitara `SameSite=None; Secure` y un `Domain` comun, o servir API y SPA
  bajo el mismo sitio. En desarrollo `localhost:3000` y `localhost:5173` son el
  mismo sitio, por lo que `Lax` funciona.
- Rotar `SESSION_SECRET` invalida todas las sesiones de una sola vez.
