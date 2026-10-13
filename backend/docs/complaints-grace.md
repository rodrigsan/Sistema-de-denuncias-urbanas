# Denuncias en borrador: ventana de gracia, ubicacion y evidencias (Fase 4)

Documentacion de la maquina de estados implementada en la Fase 4. Fuente de
verdad del esquema: `database/001_initial_schema.sql` (tablas `complaints`,
`complaint_grace_sessions`, `citizen_submission_limits`,
`complaint_status_history`, `media_assets`, `media_processing_jobs`).

## 1. Ventana efectiva de gracia (180 segundos)

- `complaints.grace_remaining_seconds`: tiempo efectivo persistente (0..180).
- `complaints.grace_running_since`: instante desde el que el reloj corre.
  `NULL` significa pausado (sesion de edicion abierta).
- El reloj de referencia es `now()` de **PostgreSQL**, leido en la misma
  consulta que bloquea la fila (`SELECT ... FOR UPDATE OF c`), lo que elimina
  desvios app/BD y hace el calculo determinista.

**Tiempo efectivo restante** (`grace.service.js`):

```
efectivo = status != GRACE_PERIOD           ? 0
         : grace_running_since IS NULL      ? grace_remaining_seconds        (pausado)
         : max(0, grace_remaining_seconds - floor(now() - grace_running_since))
```

## 2. Transiciones

| Evento | Efecto |
|---|---|
| `POST /complaints` | status `GRACE_PERIOD`, remaining 180, reloj `now()` |
| `PUT /:id/edit-session/start` | Congela el reloj (remaining -= transcurrido; running_since = NULL) y abre fila en `complaint_grace_sessions`. Idempotente: si ya hay sesion abierta, responde 200 sin cambios. |
| `PUT /:id` (guardar) | Exige sesion abierta (si no: `409 EDIT_SESSION_NOT_OPEN`). Aplica cambios, cierra sesion `SAVED`, reanuda el reloj. |
| `POST /:id/edit-session/cancel` | Cierra sesion `CANCELLED` y reanuda el reloj. Sin sesion abierta: `409`. |
| `DELETE /:id` | Solo en `GRACE_PERIOD`. Soft delete: `deleted_at`, `deletion_reason` (<=100), reloj congelado, sesion cerrada `CANCELLED`. **No activa el cooldown.** Tras expirar el tiempo efectivo: `409 COMPLAINT_FORMALIZED`. |
| Expiracion | Cualquier acceso (o el barrido periodico) formaliza si efectivo <= 0. |

Toda mutacion corre en una transaccion con `FOR UPDATE`; una peticion no
autorizada (no dueño) nunca muta estado (`404` sin efectos).

## 3. Formalizacion automatica

En una sola transaccion (idempotente por guarda `status = 'GRACE_PERIOD'`):

1. `status: GRACE_PERIOD -> PENDING_REVIEW`, `formalized_at = now()`,
   `grace_remaining_seconds = 0`, `grace_running_since = NULL`.
2. Sesion abierta (si la hubiera) cerrada con `FORMALIZED`.
3. `complaint_status_history`: `GRACE_PERIOD -> PENDING_REVIEW`,
   `changed_by_user_id = NULL` (sistema), `reason = 'GRACE_PERIOD_EXPIRED'`.
4. `citizen_submission_limits` (UPSERT): `next_allowed_at = now() + 60 min`,
   `last_formalized_complaint_id = <id>`. `POST /complaints` aplica el
   cooldown: `429 SUBMISSION_COOLDOWN` con `secondsRemaining`.

**Sesiones huerfanas:** una sesion abierta mas de 10 minutos se cierra con
`end_reason = 'TIMEOUT'` y el reloj se reanuda; garantiza que toda denuncia
termina formalizandose. El **barrido periodico** de `server.js` (cada 30 s,
`FOR UPDATE SKIP LOCKED`, desactivable con `GRACE_SWEEP_ENABLED=false`)
formaliza las expiradas aunque nadie las consulte.

## 4. Ubicacion y Plus Code (`plus-code.service.js`)

- Solo Plus Codes **completos** (`open-location-code`: `isValid` + `isFull`).
- Coherente = coordenadas dentro de la celda decodificada **o** a
  `radioCelda + 100 m` (Haversine) del centro. El par almacenado siempre es
  coherente.
- `location_verification_method` (derivado en servidor):
  - `MATCH`: par coherente tal cual se envio.
  - `CORRECTED`: un `PUT` cambia una ubicacion ya verificada y el nuevo par
    es coherente.
  - `SERVER_RECALCULATED`: el servidor recalculo el Plus Code desde las
    coordenadas (`plusCodeSource = AUTOMATIC` con desajuste, o
    `acceptServerPlusCode = true` tras un 422).
- Discrepancia MANUAL sin correccion: `422 LOCATION_MISMATCH` con detalle
  accionable (`suggestedPlusCode`, centro del codigo enviado, distancia y
  tolerancia). **Ninguna fila se crea.**

## 5. Evidencias (`media.repository` + `evidence-upload.js`)

- multipart/form-data, campo `file`, un archivo por peticion.
- Permitidos (defaults configurables por env): 3 imagenes JPG/PNG/HEIC/HEIF
  <=5 MB; 1 video MP4/MOV <=50 MB con `duration_seconds` declarado 1..30.
- Defensa: streaming a disco con limite duro, magic bytes verificados contra
  el MIME declarado, tamaño medido por el servidor, conteo por tipo en la
  misma transaccion de la denuncia.
- Exito: `media_assets (processing_status = 'PENDING')` +
  `media_processing_jobs (status = 'PENDING')`; el archivo se mueve a
  `STORAGE_DIRECTORY` (privado, gitignored, sin ruta de descarga: regla 11).
  La respuesta nunca incluye `storage_key`.
- La duracion del video es una compuerta declarada; el worker futuro verificara
  el contenedor real y podra marcar el asset `FAILED`.

## 6. Codigos y minimizacion

- `public_code`: `DEN-` + 8 caracteres Crockford base32 generados en servidor
  (reintentos ante colision). No enumerable.
- Respuestas sin email, `provider_subject`, `storage_key` ni datos de terceros.
- No-dueños reciben `404` (no se revela la existencia de denuncias ajenas).
- Borradas: `404` incluso para el dueño; la traza es minima (`deleted_at` +
  `deletion_reason`).
