# Módulo de moderación (Fase 5)

Documentación del flujo de moderación y gestión municipal. Fuente de verdad
del esquema: `database/001_initial_schema.sql` (`moderation_reviews`,
`complaint_assignments`, `assignment_rules`, `duplicate_proposals`,
`complaint_groups`, `complaint_group_members`, `complaint_status_history`).

## 1. RBAC

- Toda ruta de `/api/v1/moderation` exige `requireAuth` (sesión válida; roles
  recargados desde PostgreSQL en cada petición) **y** `requireRole('MODERATOR')`.
- Roles sembrados: `MODERATOR` (revisa y decide), `TECHNICAL_LIAISON` (fases
  posteriores) y `SUPERADMIN` (**sin acceso al contenido de denuncias**: no
  posee el rol MODERATOR y el backend no se lo otorga por defecto).
- Los roles jamás se aceptan del cliente; un `ADMIN` sin roles
  (`adminLocked`) recibe `403`.

## 2. Bandeja (`GET /moderation/complaints`)

- Estado `PENDING_REVIEW`, excluye borradas (`deleted_at IS NULL`).
- Orden FIFO por `formalized_at ASC` (evita inanición de denuncias antiguas).
- Paginación `page`/`limit` (default 20, máx 100) + `pagination.total`.
- Filtros: `categoryId`, `subcategoryId`, `formalizedFrom`, `formalizedTo`.
- Por cada denuncia incluye `suggestedUnits`: unidades activas con regla
  `assignment_rules` activa para su subcategoría, ordenadas por `priority`.

## 3. Aprobación / rechazo atómicos

Ambos corren en **una transacción** con `SELECT ... FOR UPDATE` sobre la
denuncia y guarda de estado `status = 'PENDING_REVIEW'`:

```
approve: INSERT moderation_reviews(APPROVED, selected_unit_id)
       + INSERT complaint_assignments(municipal_unit_id, assigned_by)
       + UPDATE complaints -> ASSIGNED
       + INSERT complaint_status_history(PENDING_REVIEW -> ASSIGNED,
         changed_by = moderador, reason = 'MODERATION_APPROVED')

reject:  INSERT moderation_reviews(REJECTED, rejection_reason)
       + UPDATE complaints -> REJECTED
       + INSERT complaint_status_history(..., reason = 'MODERATION_REJECTED')
```

Refuerzos a nivel de base de datos:
- CHECK de `moderation_reviews`: APPROVED exige unidad y niega motivo;
  REJECTED exige motivo no vacío y niega unidad.
- `uq_complaint_active_assignment`: máximo una asignación activa por denuncia.
- La doble aprobación pierde la carrera bajo `FOR UPDATE` → `409
  COMPLAINT_NOT_REVIEWABLE`.

## 4. Duplicados

- `GET /moderation/complaints/:id/duplicate-candidates`: misma subcategoría y
  dentro del radio (`ST_DWithin` sobre `GEOGRAPHY` en metros,
  `DUPLICATE_SEARCH_RADIUS_METERS`, default 100), cualquier estado salvo
  `REJECTED` y borradas; orden por distancia ascendente, límite 20.
- `POST /moderation/complaints/:id/duplicate-proposals`: crea propuesta
  `PENDING` (par único por `uq_duplicate_pair`; auto-propuesta bloqueada).
- `POST /moderation/duplicate-proposals/:id/resolve`:
  - `NOT_DUPLICATE` / `DISMISSED`: cierra la propuesta (`reviewed_by/at`).
  - `CONFIRMED_GROUP` (título obligatorio): crea grupo + miembros + cierra la
    propuesta en la misma transacción.
- `POST /moderation/groups`: agrupación ad-hoc de 2..20 denuncias;
  auto-confirma propuestas `PENDING` entre pares del grupo.
- Invariante de servicio: una denuncia no pertenece a dos grupos **abiertos**
  (`409 COMPLAINT_ALREADY_GROUPED`).

## 5. Privacidad (regla 8 de la sección 6)

- El moderador ve únicamente el alias del ciudadano (`citizen_profiles.alias`).
- Nunca: `auth_identities.email_private`, `provider_subject`,
  `administrative_code`, tokens ni claves de almacenamiento.
- Los archivos de evidencia no se sirven: solo metadatos en la bandeja.
- Las respuestas de error no exponen SQL, stack traces ni detalles internos.
