# Seguimiento, atención técnica y suspensiones (Fase 6)

Documentación de la última fase del backend. Fuente de verdad del esquema:
`database/001_initial_schema.sql` (`complaint_solutions`, `violations`,
`suspensions`, `admin_unit_memberships`, `complaint_status_history`).

## 1. Mis Denuncias (`GET /api/v1/citizens/complaints`)

- Solo del ciudadano autenticado (`citizen_user_id`), borradas excluidas,
  orden `created_at DESC`, paginación `page`/`limit` y filtro `status`.
- Una sola consulta con `LEFT JOIN LATERAL` para: motivo del último rechazo,
  unidad de la asignación activa y última solución `APPROVED`.
- **Privacidad estricta**: sin evidencias multimedia (ni del ciudadano ni de
  la unidad técnica), sin email/cuenta Google/código administrativo. La
  evidencia de solución es además **estructuralmente inalcanzable** por las
  vistas de denuncia: el CHECK de `media_assets` exige
  `purpose='SOLUTION_EVIDENCE' <=> complaint_id IS NULL`, y todas las
  consultas por denuncia filtran por `complaint_id`.
- Cuentas ADMIN reciben `403 FORBIDDEN`.

## 2. Enlace Técnico/Supervisor (`/api/v1/technical`)

- RBAC: `requireAuth + requireRole('TECHNICAL_LIAISON')`; alcance por
  membresías activas (`admin_unit_memberships.active_until IS NULL`) — las
  denuncias de otras unidades responden `404` (minimización de existencia).
- **Sin datos del ciudadano** (ni alias): el enlace atiende el problema.
- Bandeja: asignaciones activas en estados `ASSIGNED/IN_PROGRESS/
  SOLUTION_SUBMITTED` (filtro opcional, incl. `RESOLVED` histórico), FIFO por
  `assigned_at`, con `latestSolution` (estado, descripción y comentario de
  devolución) y metadatos de evidencia de la denuncia.
- `start-process`: `ASSIGNED → IN_PROGRESS` (`TECHNICAL_WORK_STARTED`).
- `submit-solution`: **estricto desde `IN_PROGRESS`**; inserta
  `complaint_solutions (SUBMITTED)` y transiciona a `SOLUTION_SUBMITTED`
  (`SOLUTION_SUBMITTED_BY_TECHNICAL`) en una transacción con `FOR UPDATE`.
- Evidencias de solución: `POST /technical/solutions/:solutionId/evidence`
  (multipart, streaming, magic bytes, límites configurables) →
  `media_assets (purpose='SOLUTION_EVIDENCE', solution_id, complaint_id NULL)`
  + job `PENDING`; solo mientras la solución esté `SUBMITTED` (`409
  SOLUTION_NOT_EDITABLE` después). Archivos privados, nunca servidos.

## 3. Verificación del Moderador (`POST /moderation/solutions/:id/verify`)

- `APPROVE`: solución → `APPROVED` (reviewed_by/at pareados); denuncia
  `SOLUTION_SUBMITTED → RESOLVED` con `resolved_at = now()`; la asignación
  **permanece activa** (trazabilidad; los listados filtran por estado).
- `RETURN`: solución → `RETURNED` con comentario **obligatorio** (Zod);
  denuncia `SOLUTION_SUBMITTED → IN_PROGRESS` para que el enlace corrija y
  pueda registrar una **nueva** solución (la tabla permite N filas).
- Guarda por `status='SUBMITTED'` → `409 SOLUTION_ALREADY_VERIFIED`.

## 4. Infracciones y suspensiones (`POST /moderation/violations`)

- Body `{ complaintId, description }`: el Moderador sanciona al **autor de la
  denuncia** (las vistas nunca exponen ids internos de usuarios).
- Transacción con `FOR UPDATE`: `violations` + `suspensions` (exactamente
  168 h: `now()` es constante en la tx y satisface el CHECK) +
  `users.status='SUSPENDED'`. `23505` del UNIQUE parcial → `409
  CITIZEN_ALREADY_SUSPENDED` (carrera segura entre moderadores).
- Efectos de la suspensión (req.user.suspended):
  - Bloqueadas (403 ACCOUNT_SUSPENDED): crear/editar/cancelar/borrar
    denuncias y subir evidencias.
  - Permitidas: lecturas (`/citizens/complaints`, detalle) y logout.
  - Login bloqueado mientras la suspensión está vigente.
- **Expiración perezosa (168 h)**: en el login y en cada petición con sesión,
  si la suspensión ACTIVE ya cumplió → `status='COMPLETED'` + usuario
  reactivado en una transacción. Una cuenta SUSPENDED **sin** fila de
  suspensión (suspensión manual) permanece bloqueada.

## 5. Puerto por defecto

`PORT=3001` en `env.js`/`.env.example`/`.env` (y `GOOGLE_REDIRECT_URI`
actualizado) para evitar el conflicto con otros servicios locales en 3000.

## 6. Notas de seguridad

- `/auth/me` expone `suspended` para que el frontend muestre el estado.
- El cooldown de 60 min tras formalizar se mantiene (Fase 4); las pruebas lo
  limpian por fixture para simular el paso del tiempo.
- `notifications` queda fuera de alcance (aún no hay endpoints de lectura).
