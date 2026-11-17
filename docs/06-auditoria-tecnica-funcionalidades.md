# Auditoría Técnica de Funcionalidades

## Procesamiento Multimedia, Duplicados Geoespaciales y Máquina de Estados

**Proyecto:** Plataforma Web de Denuncias Ciudadanas para la Gestión de Incidencias Urbananas del Municipio de Cercado, Cochabamba

**Fecha:** 10 de noviembre de 2026

**Tipo de auditoría:** Solo lectura (sin modificaciones)

---

## A. Resumen Ejecutivo

Tras una auditoría exhaustiva de solo lectura del proyecto `proyecto_denuncias`, el estado real de implementación es el siguiente:

| Funcionalidad | Estado | Observación |
|---|---|---|
| **Procesamiento de imágenes** | Parcialmente implementado | Validación de formatos y tamaño, pero **sin procesamiento real** (no hay Sharp, no se eliminan metadatos EXIF/GPS). |
| **Procesamiento de videos** | No implementado | **Worker no existe**. Las tareas quedan en estado `PENDING` perpetuo. No hay FFmpeg ni Sharp instalados. |
| **Detección geoespacial de duplicados** | Implementado y conectado | Funciona con PostGIS `ST_DWithin`. |
| **Presentación de duplicados al moderador** | Implementado y conectado | Modal `DuplicateCandidates.jsx` con interfaz funcional. |
| **Agrupamiento de denuncias** | Implementado y conectado | Funcionalidad de creación de grupos con confirmación automática. |
| **Prevención automática de duplicados** | **No implementado** | El sistema identifica candidatos pero **NO previene** la creación. |
| **Máquina de estados formal** | Parcialmente implementada | Estados definidos y transiciones validadas, pero **sin tabla centralizada** ni motor formal. |
| **Ventana de gracia 180 segundos** | Implementado y conectado | Contador efectivo con pausa/reanudación. |

---

## B. Procesamiento Multimedia

### 1.1. Imágenes

| Aspecto | Estado | Evidencia |
|---|---|---|
| Dependencia Sharp | **No instalada** | `backend/package.json` no incluye Sharp. |
| Dependencia FFmpeg | **No instalada** | No existe en `package.json`. |
| Validación de tipo MIME | **Implementado** | `backend/src/middlewares/evidence-upload.js` líneas 249-261: valida MIME y extensiones permitidas (JPEG, PNG, HEIC, HEIF). |
| Validación de magic bytes | **Implementado** | `backend/src/middlewares/evidence-upload.js` líneas 67-92: verifica signatures reales del archivo (JPEG: `0xff 0xd8 0xff`, PNG: `0x89 0x50 0x4e 0x47`). |
| Eliminación de EXIF/GPS | **No implementado** | No hay código que manipule metadatos. Solo se guarda el archivo raw. |
| Redimensionado | **No implementado** | No hay procesamiento de imágenes. |
| Archivo original conservado | **Sí** | El archivo se guarda sin transformaciones. |
| Validación posterior al procesamiento | **No** | No hay verificación del archivo procesado. |
| Manejo de fallos | **Parcial** | Si falla el storage, se marca como `FAILED`, pero no hay retry/async processing. |

**Evidencias de archivos:**

- `backend/src/middlewares/evidence-upload.js` (líneas 1-320)
- `backend/src/repositories/media.repository.js`
- `backend/src/services/complaints.service.js` (función `addEvidence`)

### 1.2. Videos

| Aspecto | Estado | Evidencia |
|---|---|---|
| Dependencia FFmpeg | **No instalada** | No existe. |
| Recodificación/transformación | **No implementado** | No hay código. |
| Eliminación de metadatos | **No implementado** | No hay código. |
| Worker/procesador | **No implementado** | Tabla `media_processing_jobs` existe pero **no hay consumidor**. |
| Cola de trabajos | **Estructura sin consumidor** | `media_processing_jobs` con estados `PENDING`, `PROCESSING`, `SUCCEEDED`, `FAILED`. |

**Evidencias:**

- `database/001_initial_schema.sql` líneas 241-252: tabla `media_processing_jobs`
- `backend/src/repositories/media.repository.js` líneas 62-67: inserta tarea `PENDING`
- Comentario en `evidence-upload.js` línea 19: "el contenedor real lo verificara el worker de procesamiento"

### 1.3. Resultado Procesamiento Multimedia

| Funcionalidad | Estado | Evidencia |
|---|---|---|
| Procesamiento de imágenes | **No implementado** | Solo validación y almacenamiento. |
| Eliminación de metadatos de imágenes | **No implementado** | No hay código de manipulación. |
| Procesamiento de videos | **No implementado** | Worker no existe. |
| Eliminación de metadatos de videos | **No implementado** | No hay código. |

---

## C. Detección de Denuncias Duplicadas

### Flujo Completo

1. **Creación de denuncia:** `POST /api/v1/complaints` → `complaints.service.js:107`
2. **Formalización:** Ventana de gracia expira → estado `PENDING_REVIEW`
3. **Moderador accede a bandeja:** `GET /api/v1/moderation/complaints` → `moderation.routes.js:34`
4. **Moderador abre modal de duplicados:** `DuplicateCandidates.jsx` → llama a `GET /api/v1/moderation/complaints/:id/duplicate-candidates`

### Consulta PostGIS

**Archivo:** `backend/src/repositories/moderation.repository.js` líneas 164-196

```sql
SELECT c.id, c.public_code, c.title, c.status, c.subcategory_id,
       sub.code AS subcategoryCode, sub.name AS subcategoryName,
       c.created_at, c.formalized_at, cp.alias AS citizenAlias,
       ST_Distance(c.location, ref.location) AS distanceMeters
FROM complaints c
JOIN subcategories sub ON sub.id = c.subcategory_id
LEFT JOIN citizen_profiles cp ON cp.user_id = c.citizen_user_id
CROSS JOIN (
    SELECT location, subcategory_id
    FROM complaints
    WHERE id = $1 AND deleted_at IS NULL
) ref
WHERE c.id <> $1
  AND c.deleted_at IS NULL
  AND c.status <> 'REJECTED'
  AND c.subcategory_id = ref.subcategory_id
  AND ST_DWithin(c.location, ref.location, $2)
ORDER BY ST_Distance(c.location, ref.location) ASC, c.id ASC
LIMIT $3
```

**Parámetros:**

- Radio: `config.DUPLICATE_SEARCH_RADIUS_METERS` = **100 metros** (línea 25 del `env.js`)
- Igualdad: **misma subcategoría** (`c.subcategory_id = ref.subcategory_id`)
- Exclusión: estado `REJECTED`, denuncias borradas

### Estados de duplicados

**Tabla:** `duplicate_proposals` (líneas 288-307 del schema)

| Estado | Descripción |
|---|---|
| `PENDING` | Propuesta creada, pendiente de resolución |
| `CONFIRMED_GROUP` | Denuncias agrupadas en incidente |
| `NOT_DUPLICATE` | Rechazada como duplicado |
| `DISMISSED` | Descartada sin decisión |

### Resultado Detección Geoespacial

| Funcionalidad | Estado | Evidencia |
|---|---|---|
| Detección geoespacial | **Implementado** | `ST_DWithin` en `moderation.repository.js:164-196`. Radio configurable 100m. |
| Presentación de duplicados | **Implementado** | `DuplicateCandidates.jsx` muestra candidatos con distancia. |
| Agrupamiento de denuncias | **Implementado** | `createGroup()` crea grupos y confirma propuestas. |
| Prevención automática de duplicados | **No implementado** | El moderador debe proponer manualmente. |

---

## D. Máquina de Estados y Ciclo de Vida

### Estados de denuncias

**Archivo:** `database/001_initial_schema.sql` línea 140-142

```sql
CHECK (status IN ('GRACE_PERIOD', 'PENDING_REVIEW', 'REJECTED',
                  'ASSIGNED', 'IN_PROGRESS', 'SOLUTION_SUBMITTED', 'RESOLVED'))
```

**También en:** `frontend/src/lib/constants.js` líneas 44-52

| Estado | Descripción | Componente Frontend |
|---|---|---|
| `GRACE_PERIOD` | Ventana de gracia (180s) | `GraceCountdown.jsx` |
| `PENDING_REVIEW` | Pendiente de moderador | `StatusBadge.jsx` |
| `ASSIGNED` | Asignada a unidad municipal | `StatusBadge.jsx` |
| `IN_PROGRESS` | En atención técnica | `StatusBadge.jsx` |
| `SOLUTION_SUBMITTED` | Solución propuesta | `StatusBadge.jsx` |
| `RESOLVED` | Resuelta | `StatusBadge.jsx` |
| `REJECTED` | Rechazada | `StatusBadge.jsx` |

### Transiciones permitidas

**Archivo:** `backend/src/services/complaints.service.js`

| Desde | Hacia | Condición | Evidencia |
|---|---|---|---|
| `GRACE_PERIOD` | `PENDING_REVIEW` | Expiración gracia automática | `formalizeLocked()` línea 347 |
| `PENDING_REVIEW` | `ASSIGNED` | Aprobación con unidad | `approve()` línea 144 |
| `PENDING_REVIEW` | `REJECTED` | Rechazo con motivo | `reject()` línea 203 |
| `ASSIGNED` | `IN_PROGRESS` | Inicio de atención | `startProcess()` línea 130 |
| `IN_PROGRESS` | `SOLUTION_SUBMITTED` | Registro de solución | `submitSolution()` línea 187 |
| `SOLUTION_SUBMITTED` | `RESOLVED` | Verificación APPROVE | `verifySolution()` línea 488 |
| `SOLUTION_SUBMITTED` | `IN_PROGRESS` | Verificación RETURN | `verifySolution()` línea 535 |

### Historial de estados

**Archivo:** `database/001_initial_schema.sql` líneas 187-196

Tabla `complaint_status_history` registra: `previous_status`, `new_status`, `changed_by_user_id`, `reason`

**Evidencia de uso:**

- `backend/src/repositories/complaints.repository.js` línea 246-268: función `setStatusAndHistory()`

### Ventana de gracia 180 segundos

**Configuración:**

- `GRACE_TOTAL_SECONDS = 180` → `grace.service.js:16`
- Variable de entorno `GRACE_TOTAL_SECONDS` con default 180 → `env.js:25`

**Cálculo efectivo:**

- `grace.service.js` línea 26-33: `computeEffectiveRemaining()`
- Usa `grace_running_since + grace_remaining_seconds`
- Paused cuando `grace_running_since` es NULL

**Barrido de expiración:**

- `server.js` línea 44: `setInterval` cada 30 segundos
- `grace.service.js` línea 91: `sweepExpired()`
- `complaints.repository.js` línea 404-444: lógica del barrido

**Evidencia de pruebas:**

- `backend/tests/grace-period.test.js`: 10 pruebas verificando contador, pausa, formalización

### Resultado Máquina de Estados

| Funcionalidad | Estado | Evidencia |
|---|---|---|
| Estados definidos | **Implementado** | CHECK constraint en SQL + constantes frontend |
| Transiciones permitidas | **Implementado** | Validación explícita en cada servicio. |
| Tabla de estados/transiciones | **No existe** | Solo historial en `complaint_status_history`. |
| Validación transiciones | **Implementado** | Cada endpoint verifica estado previo. |
| Registro quién cambió | **Implementado** | `changed_by_user_id` en historial. |
| Historial completo | **Implementado** | `complaint_status_history`. |
| Pruebas de transiciones | **Implementado** | Tests en `complaints.test.js`, `moderation.test.js`, `technical-liaison.test.js`. |
| Ventana de gracia 180s | **Implementado** | Contador efectivo con pausa. |
| Procesamiento automático | **Implementado** | Barrido en `server.js`. |

---

## E. Pruebas Automatizadas

### Backend (136 pruebas)

| Archivo | Pruebas | Áreas cubiertas |
|---|---|---|
| `tests/auth.test.js` | 20 | OAuth PKCE, alias, sesión, suspensiones |
| `tests/complaints.test.js` | 22 | Creación, Plus Code, evidencias, borrado |
| `tests/grace-period.test.js` | 10 | Contador 180s, pausa, formalización, cooldown |
| `tests/moderation.test.js` | 24 | Bandeja, aprobación, duplicados, sanciones |
| `tests/technical-liaison.test.js` | 11 | Bandeja técnica, soluciones, evidencias |
| `tests/suspensions.test.js` | 7 | 168h, reactivación, login bloqueado |
| `tests/citizen-tracking.test.js` | 7 | Mis denuncias, privacidad |
| `tests/catalogs.test.js` | 10 | Categorías, unidades |
| `tests/citizen-profile.test.js` | 7 | Alias |
| `tests/config.test.js` | 8 | Variables de entorno |
| `tests/database.test.js` | 5 | Conectividad |
| `tests/health.test.js` | 5 | Liveness/Readiness |

### Frontend (73 pruebas)

| Archivo | Pruebas | Áreas cubiertas |
|---|---|---|
| `__tests__/validation.test.js` | 27 | Validaciones formularios |
| `__tests__/utils.test.js` | 14 | Utils de formato |
| `__tests__/pluscode.test.js` | 5 | Generación Plus Code |
| `__tests__/StatusBadge.test.jsx` | 8 | Renderizado estados |
| `__tests__/GraceCountdown.test.jsx` | 8 | Contador gracia |
| `__tests__/RouteGuards.test.jsx` | 11 | Guards de ruta/RBAC |

---

## F. Matriz Final de Verificación

| Funcionalidad | Estado | Evidencia encontrada | Limitaciones |
|---|---|---|---|
| Procesamiento de imágenes | Parcialmente implementado | Validación MIME/magic bytes en `evidence-upload.js`. Guarda en storage sin procesar. | No hay Sharp. No se eliminan metadatos EXIF/GPS. |
| Eliminación de metadatos de imágenes | No implementado | Tabla `media_assets` incluye `processing_status`, pero el worker no procesa. | No existe código de manipulación de metadatos. |
| Procesamiento de videos | No implementado | Tabla `media_processing_jobs` existe. Archivos se guardan como está. | No hay FFmpeg. No hay worker que consuma tareas `PENDING`. |
| Eliminación de metadatos de videos | No implementado | Mismo caso que imágenes. | Worker no implementado. |
| Detección geoespacial | Implementado | `ST_DWithin` en `moderation.repository.js:164-196`. Radio configurable 100m. | Sólo detección, no prevención. |
| Presentación de duplicados al moderador | Implementado | `DuplicateCandidates.jsx`, `GET /api/v1/moderation/complaints/:id/duplicate-candidates`. | UI funcional. |
| Agrupamiento de denuncias | Implementado | `createGroup()`, tabla `complaint_groups`, auto-confirmación propuestas. | Requiere intervención manual inicial. |
| Prevención automática de duplicados | No implementado | El moderador propondrá manualmente. | No hay bloqueo automático en creación. |
| Estados de denuncias | Implementado | 7 estados definidos en SQL + frontend. | No hay tabla centralizada de estados. |
| Validación de transiciones | Implementado | Cada endpoint verifica estado previo explícitamente. | No hay motor formal/MDA. |
| Máquina de estados formal | Parcialmente implementada | Transiciones explícitas. Sin FSM formal. | Sin tabla de transiciones ni validación centralizada. |
| Ventana de gracia de 180 segundos | Implementado | `GRACE_TOTAL_SECONDS=180`. Contador efectivo. Barrido `setInterval`. | Correcto. |

---

## G. Recomendaciones para la Documentación Académica

| Funcionalidad | Recomendación Documental |
|---|---|
| Procesamiento de imágenes | **Parcialmente implementado**. Validación de formatos y tamaños sí existe, pero no hay procesamiento real de medios. |
| Eliminación de metadatos de imágenes | **Pendiente / No implementado**. Debe mencionarse como funcionalidad prevista. |
| Procesamiento de videos | **Preparado pero no conectado**. La tabla `media_processing_jobs` existe con estados `PENDING`, pero el worker que consuma estas tareas no ha sido implementado. |
| Eliminación de metadatos de videos | **No implementado**. |
| Detección geoespacial de duplicados | **Implementada y funcional**. Detección usando PostGIS `ST_DWithin` con radio de 100m. |
| Presentación de duplicados | **Implementada y funcional**. Modal con interfaz de usuario. |
| Agrupamiento de denuncias | **Implementado**. Funcionalidad completa de creación de grupos. |
| Prevención automática de duplicados | **No implementado**. Debe mencionarse como funcionalidad pendiente. |
| Estados de denuncias | **Implementado**. 7 estados definidos con transiciones explícitas. |
| Validación de transiciones | **Implementado**. Verificación explícita en cada operación. |
| Máquina de estados formal | **Parcialmente implementada** (sin FSM formal). Se recomienda describir como "motor de estados implícito". |
| Ventana de gracia 180 segundos | **Implementada y funcional**. Contador efectivo con pausa y reanudación. |

---

## H. Evidencias Técnicas

### Dependencias multimedia

**Archivo:** `backend/package.json`

```json
"dependencies": {
    "busboy": "^1.6.0",
    "cookie-parser": "^1.4.7",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.2",
    "express-rate-limit": "^7.4.1",
    "open-location-code": "^1.0.3",
    "pg": "^8.13.1",
    "zod": "^3.24.1"
}
```

**No hay Sharp ni FFmpeg.**

### Columnas geográficas

**Archivo:** `database/001_initial_schema.sql` línea 133

```sql
location GEOGRAPHY(POINT, 4326) NOT NULL
```

Usa **GEOGRAPHY** con SRID 4326 (WGS84).

### Índices espaciales

**Archivo:** `database/001_initial_schema.sql` línea 163

```sql
CREATE INDEX idx_complaints_location ON complaints USING GIST(location);
```

### Funciones PostGIS utilizadas

1. `ST_DWithin(geom1, geom2, radius)` - Línea 190 de `moderation.repository.js`
2. `ST_Distance(geom1, geom2)` - Línea 176 de `moderation.repository.js`
3. `ST_SetSRID(ST_MakePoint(x, y), 4326)::geography` - Líneas 161 y 218 de `complaints.repository.js`
4. `ST_Y(geom)` - Línea 29 de `complaints.repository.js`
5. `ST_X(geom)` - Línea 30 de `complaints.repository.js`

### Funciones clave

| Archivo | Función | Propósito |
|---|---|---|
| `complaints.repository.js` | `createComplaint()` | Creación con ubicación geográfica |
| `grace.service.js` | `computeEffectiveRemaining()` | Cálculo contador efectivo 180s |
| `moderation.service.js` | `listDuplicateCandidates()` | Búsqueda duplicados geoespaciales |
| `technical.service.js` | `submitSolution()` | Registro solución (transición IN_PROGRESS → SOLUTION_SUBMITTED) |
| `technical.service.js` | `verifySolution()` | Verificación (APPROVE → RESOLVED / RETURN → IN_PROGRESS) |

### Ruta de archivos

```
backend/
├── src/
│   ├── routes/
│   │   ├── complaints.routes.js
│   │   ├── moderation.routes.js
│   │   └── technical.routes.js
│   ├── controllers/
│   │   ├── complaints.controller.js
│   │   ├── moderation.controller.js
│   │   └── technical.controller.js
│   ├── services/
│   │   ├── complaints.service.js
│   │   ├── grace.service.js
│   │   ├── moderation.service.js
│   │   └── technical.service.js
│   ├── repositories/
│   │   ├── complaints.repository.js
│   │   ├── moderation.repository.js
│   │   ├── media.repository.js
│   │   └── technical.repository.js
│   ├── middlewares/
│   │   └── evidence-upload.js
│   └── config/
│       └── env.js

frontend/src/
├── components/admin/
│   ├── DuplicateCandidates.jsx
│   ├── ReviewModal.jsx
│   └── SolutionModal.jsx
├── components/complaints/
│   ├── GraceCountdown.jsx
│   └── StatusBadge.jsx
└── lib/
    └── constants.js
```

---

## I. Conclusión

El proyecto implementa correctamente la detección geoespacial de duplicados y el ciclo de vida completo de una denuncia con una ventana de gracia funcional de 180 segundos. Sin embargo, **el procesamiento multimedia no se ha implementado realmente**: aunque el sistema valida formatos y almacena archivos, **carece de Sharp y FFmpeg** para manipular imágenes y videos (eliminación de metadatos EXIF/GPS, redimensionado, recodificación). Además, **el worker que procesa las tareas de video no existe**, dejando las tareas en estado `PENDING` perpetuo.

Para la documentación académica, se recomienda:

1. Describir el procesamiento multimedia como **parcialmente implementado** (solo validación de entrada).
2. Mencionar el worker de videos como **funcionalidad prevista pero no conectada**.
3. Mantener la descripción de duplicados y agrupamiento como **implementados y funcionales**.
4. Especificar que la máquina de estados es **implícita** (validaciones explícitas) y no un **autómata finito formal** (sin tabla de transiciones).