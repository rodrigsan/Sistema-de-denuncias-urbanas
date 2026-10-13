# Backend — Plataforma Web de Denuncias Ciudadanas

Backend del proyecto de denuncias ciudadanas del Municipio de Cercado (Cochabamba).
Esta entrega cubre la **Fase 1 (esqueleto verificable)** y la **Fase 2
(Google OAuth + PKCE, sesiones y alias de ciudadano)** descritas en
`docs/04-especificacion-backend-inicial.md`.

## Alcance

### Fase 1
- Proyecto Node.js con módulos ES (`"type": "module"`).
- Lectura y validación de variables de entorno.
- Conexión a PostgreSQL (PostGIS) mediante `pg` y consultas parametrizadas.
- Endpoints de salud: `GET /api/v1/health` y `GET /api/v1/health/ready`.
- Manejo centralizado de errores, CORS restringido y límite de peticiones.
- Cierre ordenado del servidor y del pool de conexiones.
- Pruebas automatizadas con el runner nativo de Node.

### Fase 2
- Flujo **Google OAuth 2.0 (Authorization Code + PKCE `S256`)** gestionado en backend.
- Sesión con **cookie firmada** `HttpOnly`, `SameSite=Lax`, `Secure` en producción;
  solo contiene `userId`: roles y suspensiones se consultan en cada petición.
- Vinculación de identidad por `provider_subject` (el `sub` de Google), nunca por correo.
- Creación de ciudadano en transacción PostgreSQL en el primer acceso.
- Flujo de alias de ciudadano con `administrative_code` único generado en servidor.
- Cierre de sesión y protección CSRF por verificación de `Origin`.
- Documentación del flujo en `docs/oauth-flow.md` (requisito de la sección 7).

### Fase 3
- `GET /api/v1/categories` (autenticado): árbol de categorías activas con sus
  subcategorías activas agrupadas y ordenadas por `sort_order`.
- `GET /api/v1/municipal-units` (autenticado): unidades municipales activas,
  ordenadas por nombre; solo `id`, `code` y `name` (las descripciones del seed
  son notas operativas de moderación).
- `GET /api/v1/citizens/me` (autenticado): perfil propio del ciudadano (alias,
  `administrative_code`, tipo y fecha de registro) con minimización estricta;
  `404 CITIZEN_PROFILE_NOT_FOUND` si no existe perfil.
- Salvaguardas de inmutabilidad del alias verificadas por regresión: `409` al
  segundo intento y ausencia de rutas de modificación.

### Fase 4
- `POST /api/v1/complaints` (autenticado, ciudadano con alias): crea la
  denuncia en `GRACE_PERIOD` con ventana efectiva de 180 segundos.
- Coherencia coordenadas ↔ Plus Code validada en servidor (`open-location-code`):
  el par almacenado siempre es coherente (`MATCH`/`CORRECTED`/`SERVER_RECALCULATED`);
  discrepancia MANUAL → `422 LOCATION_MISMATCH` con detalle accionable.
- Máquina de estados de gracia con sesiones de edición: pausa (`start`),
  guardar (`PUT`), cancelar, y formalización automática al agotarse el tiempo
  efectivo (transición a `PENDING_REVIEW` + historial + cooldown de 60 min).
- Sesiones de edición huérfanas cerradas con `TIMEOUT` tras 10 minutos y
  barrido periódico en `server.js` (desactivable).
- `DELETE` con soft-delete (`deleted_at` + `deletion_reason`), sin cooldown.
- Evidencias: 3 fotos ≤5 MB y 1 video ≤50 MB/≤30 s; magic bytes verificados;
  metadatos en `media_assets` + tarea `PENDING` en `media_processing_jobs`;
  archivos en `storage/` privado, nunca publicados; binarios jamás en PostgreSQL.
- Documentación de la máquina de estados en `docs/complaints-grace.md`.

### Fase 5
- Bandeja de moderación `GET /api/v1/moderation/complaints`: paginada
  (`page`/`limit`), FIFO por `formalized_at`, filtrable por categoría,
  subcategoría y rango de fechas; incluye unidades sugeridas por
  `assignment_rules` ordenadas por prioridad.
- Aprobación y asignación de unidad municipal en una sola transacción con
  `FOR UPDATE` (`moderation_reviews` + `complaint_assignments` + historial),
  rechazo con motivo obligatorio (el CHECK de la BD lo refuerza).
- Detección de duplicados con PostGIS (`ST_DWithin`, radio configurable) y
  ciclo de vida de propuestas (`PENDING`/`CONFIRMED_GROUP`/`NOT_DUPLICATE`/
  `DISMISSED`); grupos con auto-confirmación de propuestas entre sus pares.
- RBAC estricto (`requireAuth` + `requireRole('MODERATOR')`) en todas las
  rutas; SUPERADMIN sin acceso al contenido de denuncias.
- Privacidad: el moderador ve únicamente el alias del ciudadano; nunca el
  correo privado, la cuenta Google ni el código administrativo.

### Fase 6
- `GET /api/v1/citizens/complaints` ("Mis Denuncias"): paginado, filtrable por
  estado y **exclusivamente** del ciudadano; incluye motivo de rechazo, unidad
  asignada y descripción de la solución aprobada; **sin evidencias multimedia
  ni PII** (la evidencia de solución es inalcanzable por el CHECK del esquema).
- Módulo Enlace Técnico (`/api/v1/technical`, rol `TECHNICAL_LIAISON`): bandeja
  por membresías activas de unidad (sin datos del ciudadano), `start-process`
  (`ASSIGNED→IN_PROGRESS`), `submit-solution` (estricto desde `IN_PROGRESS`) y
  evidencias privadas de solución (`SOLUTION_EVIDENCE`) con tarea `PENDING`.
- Verificación del Moderador (`POST /moderation/solutions/:id/verify`):
  `APPROVE` → denuncia `RESOLVED` con `resolved_at`; `RETURN` con comentario
  obligatorio → denuncia `IN_PROGRESS` para reintentos.
- Infracciones y suspensiones (`POST /moderation/violations`): 168 horas
  exactas en una transacción; sin superposición (UNIQUE parcial); bloqueo de
  escrituras con `403 ACCOUNT_SUSPENDED` manteniendo las lecturas propias;
  **expiración perezosa** en login y sesión.
- Puerto por defecto `3001` (evita conflicto con otros servicios locales).

**Fuera de alcance (documentado):** worker real de procesamiento de medios,
notificaciones y entrega firmada de archivos.

## Requisitos

- Node.js LTS (probado con Node 24).
- PostgreSQL con PostGIS y las migraciones `database/001_initial_schema.sql` y
  `database/002_seed_catalogs.sql` ya aplicadas.

## Puesta en marcha

```bash
cd backend
npm install
cp .env.example .env   # en Windows: copy .env.example .env
# Editar .env con la DATABASE_URL real y un SESSION_SECRET propio
npm run dev            # o: npm start
```

El servidor no arranca si faltan `DATABASE_URL` o `SESSION_SECRET`, y el mensaje
de error nunca imprime los valores de las variables.

## Scripts

| Script | Descripción |
| --- | --- |
| `npm run dev` | Servidor en modo observación. |
| `npm start` | Servidor en modo normal. |
| `npm test` | Pruebas automatizadas (`node --test`). |
| `npm run lint` | Análisis estático con ESLint. |

## Endpoints

| Método | Ruta | Respuesta |
| --- | --- | --- |
| GET | `/api/v1/health` | `200 { status: "ok", service: "denuncias-cercado-api" }` |
| GET | `/api/v1/health/ready` | `200 { status: "ready", database: "connected" }` o `503` si la base no responde |
| GET | `/api/v1/auth/google/login` | `302` a Google con PKCE, o `503 OAUTH_NOT_CONFIGURED` sin credenciales |
| GET | `/api/v1/auth/google/callback` | `302` al frontend con cookie de sesión (éxito) o con `reason` de error |
| GET | `/api/v1/auth/me` | `200` con datos del usuario autenticado, o `401` sin sesión |
| POST | `/api/v1/auth/alias` | `201` con alias y código administrativo; `422`/`409`/`403` según el caso |
| POST | `/api/v1/auth/logout` | `204` y expiración de la cookie de sesión |
| GET | `/api/v1/categories` | `200` árbol de categorías/subcategorías activas; `401` sin sesión |
| GET | `/api/v1/municipal-units` | `200` unidades municipales activas; `401` sin sesión |
| GET | `/api/v1/citizens/me` | `200` perfil del ciudadano; `404 CITIZEN_PROFILE_NOT_FOUND` sin perfil; `401` sin sesión |
| POST | `/api/v1/complaints` | `201` denuncia en gracia; `422`/`409`/`429` según validación, estado o cooldown |
| GET | `/api/v1/complaints/:id` | `200` para el dueño (con estado de gracia efectivo); `404` para terceros o borradas |
| PUT | `/api/v1/complaints/:id/edit-session/start` | `200` reloj pausado; idempotente; `409` si ya formalizada |
| PUT | `/api/v1/complaints/:id` | `200` cambios guardados y reloj reanudado; `409 EDIT_SESSION_NOT_OPEN`/`COMPLAINT_FORMALIZED` |
| POST | `/api/v1/complaints/:id/edit-session/cancel` | `200` reloj reanudado (sesión `CANCELLED`); `409` sin sesión abierta |
| DELETE | `/api/v1/complaints/:id` | `204` soft-delete con traza mínima, sin cooldown; `409` si ya formalizada |
| POST | `/api/v1/complaints/:id/evidence` | `201` metadatos + tarea `PENDING`; `422` por tipo/firma/tamaño/límite/duración |
| GET | `/api/v1/moderation/complaints` | `200` bandeja paginada FIFO con sugerencias (solo MODERATOR) |
| POST | `/api/v1/moderation/complaints/:id/approve` | `200` denuncia `ASSIGNED` con unidad asignada; `409`/`422` |
| POST | `/api/v1/moderation/complaints/:id/reject` | `200` denuncia `REJECTED` con motivo registrado; `422` sin motivo |
| GET | `/api/v1/moderation/complaints/:id/duplicate-candidates` | `200` candidatas por cercanía (solo MODERATOR) |
| POST | `/api/v1/moderation/complaints/:id/duplicate-proposals` | `201` propuesta `PENDING`; `409` si el par ya existe |
| GET | `/api/v1/moderation/duplicate-proposals` | `200` propuestas con filtro `status` |
| POST | `/api/v1/moderation/duplicate-proposals/:id/resolve` | `200` resuelta (`NOT_DUPLICATE`/`DISMISSED`/`CONFIRMED_GROUP`) |
| POST | `/api/v1/moderation/groups` | `201` grupo con miembros; auto-confirma propuestas entre pares |
| GET | `/api/v1/citizens/complaints` | `200` "Mis Denuncias" del ciudadano (paginado, filtro `status`); sin evidencias ni PII |
| GET | `/api/v1/technical/complaints` | `200` bandeja del Enlace Técnico por unidad (rol `TECHNICAL_LIAISON`) |
| POST | `/api/v1/technical/complaints/:id/start-process` | `200` `ASSIGNED→IN_PROGRESS` con historial |
| POST | `/api/v1/technical/complaints/:id/submit-solution` | `201` solución `SUBMITTED`; denuncia `SOLUTION_SUBMITTED`; `409` si no está `IN_PROGRESS` |
| POST | `/api/v1/technical/solutions/:solutionId/evidence` | `201` evidencia privada de solución + tarea `PENDING`; `409` tras revisión |
| POST | `/api/v1/moderation/solutions/:id/verify` | `200` `APPROVE`→`RESOLVED` / `RETURN`→`IN_PROGRESS` con comentario obligatorio |
| POST | `/api/v1/moderation/violations` | `201` infracción + suspensión de 168 h; `409` si ya hay una activa |

Ejemplo de `GET /api/v1/auth/me`:

```json
{
  "id": "uuid-interno",
  "userType": "CITIZEN",
  "alias": null,
  "requiresAlias": true,
  "roles": [],
  "adminLocked": false
}
```

## Seguridad aplicada

- Sin secretos ni credenciales reales en el repositorio (`.env` está en `.gitignore`).
- Las respuestas de error no exponen stack traces, SQL, rutas del sistema ni secretos.
- CORS restringido al origen del frontend autorizado.
- Todas las consultas usan parámetros.
- Cookies `HttpOnly` firmadas con HMAC; `state` comparado en tiempo constante.
- Tokens de Google nunca se persisten ni se registran en logs.
- No se implementa ningún acceso que otorgue rol `SUPERADMIN`.
- La identidad es el `sub` verificado de Google (`provider_subject`), nunca el correo.

