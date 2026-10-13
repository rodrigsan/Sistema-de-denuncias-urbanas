# 04. Especificación inicial del backend
## Plataforma Web de Denuncias Ciudadanas — Municipio de Cercado, Cochabamba

**Versión:** 0.1  
**Estado:** propuesta inicial para implementar en entorno local con OpenCode.  
**Prerequisito:** las migraciones SQL `001_initial_schema.sql` y `002_seed_catalogs.sql` se ejecutaron en PostgreSQL sin errores. Esto confirma la ejecución en ese entorno, pero todavía deben probarse las reglas de negocio mediante pruebas automatizadas.

## 1. Objetivo de esta etapa

Construir primero una base de backend segura y comprobable. No implementar todas las funciones de la plataforma de una sola vez. En esta etapa se debe crear el proyecto, conectarlo a PostgreSQL, establecer validación, manejo de errores, autenticación preparada para Google OAuth y controles de autorización. Los módulos de denuncias, medios y flujos administrativos se implementarán por etapas posteriores.

## 2. Tecnologías

- Node.js en versión LTS compatible con las dependencias seleccionadas.
- JavaScript con módulos ES (`"type": "module"`).
- Express.
- PostgreSQL con PostGIS, usando `pg` y consultas parametrizadas.
- Validación de entrada con una biblioteca como Zod.
- Variables de entorno con `dotenv` en desarrollo.
- Pruebas automatizadas con Node test runner o Vitest; elegir una opción y mantenerla consistente.
- ESLint y Prettier, si no generan complejidad innecesaria.

No introducir TypeScript, ORM, Redis, colas externas ni otros servicios sin justificarlo y pedir aprobación antes de cambiar decisiones arquitectónicas.

## 3. Estructura inicial propuesta

```text
backend/
  package.json
  .env.example
  .gitignore
  README.md
  src/
    app.js
    server.js
    config/
      env.js
      database.js
    routes/
      health.routes.js
      auth.routes.js
    controllers/
      health.controller.js
      auth.controller.js
    services/
    repositories/
    middlewares/
      error-handler.js
      not-found.js
      require-auth.js
      require-role.js
      rate-limit.js
    validators/
    utils/
  tests/
    health.test.js
    database.test.js
```

Separar `app.js` (configuración de Express, exportable para pruebas) de `server.js` (inicio del servidor). No colocar todas las reglas de negocio en controladores ni concentrar el proyecto en un único archivo.

## 4. Variables de entorno

Crear `.env.example` con nombres, valores ficticios y comentarios, nunca secretos reales:

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://USUARIO:CONTRASENA@localhost:5432/denuncias_cercado
FRONTEND_ORIGIN=http://localhost:5173
SESSION_COOKIE_NAME=denuncias_session
SESSION_SECRET=REEMPLAZAR_POR_UN_SECRETO_LARGO_ALEATORIO
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/v1/auth/google/callback
```

El código debe comprobar las variables requeridas al arrancar y fallar con un mensaje claro sin imprimir contraseñas, tokens ni secretos. Agregar `.env` a `.gitignore`. No inventar credenciales de Google; OAuth se configurará cuando el usuario tenga las credenciales del proyecto.

## 5. Primeros endpoints

### `GET /api/v1/health`

Respuesta prevista:

```json
{
  "status": "ok",
  "service": "denuncias-cercado-api"
}
```

No incluir información sensible del servidor, rutas locales, variables de entorno ni detalles internos.

### `GET /api/v1/health/ready`

Comprueba la conexión a PostgreSQL con una consulta mínima (`SELECT 1`). Respuesta de éxito:

```json
{
  "status": "ready",
  "database": "connected"
}
```

Si la base de datos no está disponible, responder con estado HTTP `503` y un mensaje genérico. Registrar el detalle técnico en los logs del servidor, sin credenciales.

### `GET /api/v1/auth/me`

En esta etapa debe devolver `401` si no hay una sesión válida. No debe aceptar un identificador de usuario proporcionado por el cliente como prueba de identidad. La implementación completa de Google OAuth se hará en una etapa posterior.

## 6. Reglas obligatorias de seguridad

1. No guardar contraseñas de Google ni pedir al usuario que las proporcione a la plataforma.
2. Nunca considerar un correo electrónico como identificador estable de la identidad Google; usar el `sub` verificado por Google.
3. No aceptar desde el frontend roles, permisos, estado de suspensión o identidad de ciudadano como datos confiables.
4. Todas las consultas SQL deben usar parámetros; prohibido interpolar entradas del usuario en SQL.
5. Los errores enviados al cliente no deben exponer stack traces, SQL, rutas del sistema ni secretos.
6. Configurar CORS para el origen frontend autorizado, no con comodín en producción.
7. No guardar tokens de acceso o secretos en `localStorage`.
8. Los datos personales de la identidad deben mantenerse separados de los datos visibles de la denuncia.
9. Los permisos deben validarse en el backend en cada operación protegida.
10. No implementar un acceso público que otorgue automáticamente el rol `SUPERADMIN`.
11. No publicar ni servir archivos multimedia desde un bucket público.
12. No registrar en logs el contenido completo de denuncias, tokens OAuth, cookies de sesión, correos de ciudadanos o URLs firmadas de almacenamiento.

## 7. Sesión y autenticación: requisitos para la siguiente etapa

La autenticación será Google OAuth Authorization Code con PKCE, gestionada en backend. La sesión deberá usar una cookie `HttpOnly`, `Secure` en HTTPS, `SameSite` apropiado y protección CSRF donde corresponda. El secreto de sesión no debe ser un valor por defecto en producción. Evitar almacenar tokens OAuth en el navegador.

Antes de implementar OAuth, documentar el flujo de inicio, callback, validación de `state`, intercambio de código, verificación de identidad, creación/vinculación por `provider_subject`, cierre de sesión y comportamiento ante cuentas sin rol administrativo. No simular autenticación con un usuario fijo en un entorno accesible públicamente.

## 8. Base de datos

- Usar el esquema y nombres de tablas de las migraciones ya ejecutadas como fuente inicial.
- Mantener consultas en repositorios o módulos de acceso a datos separados.
- No modificar automáticamente las migraciones aplicadas. Los cambios posteriores deben ser nuevas migraciones numeradas.
- No ejecutar `DROP`, truncados ni reinicializaciones sobre una base que contenga datos que se deban conservar.
- En el arranque, comprobar conectividad; no mostrar la cadena `DATABASE_URL` en errores o logs.
- Añadir pruebas de integración contra una base de desarrollo aislada.

## 9. Orden de implementación

### Fase 1 — Esqueleto verificable
- Inicializar el proyecto Node.js.
- Crear estructura de carpetas y scripts `dev`, `start`, `test`, `lint`.
- Implementar lectura y validación de configuración.
- Implementar conexión PostgreSQL y cierre ordenado del pool.
- Crear los endpoints de salud.
- Añadir manejo centralizado de errores, CORS restringido y límites básicos de peticiones.
- Crear pruebas para salud y conectividad.

### Fase 2 — Autenticación
- Implementar Google OAuth con `state` y PKCE.
- Implementar sesión segura y cierre de sesión.
- Vincular identidad por `provider_subject`.
- Resolver el primer acceso de ciudadano y el flujo de selección de alias.
- Bloquear acceso administrativo si la cuenta no tiene roles asignados.

### Fase 3 — Catálogos y perfil
- Endpoint autenticado para consultar categorías y subcategorías activas.
- Endpoint para consultar el perfil propio sin exponer datos privados innecesarios.
- No permitir cambiar el alias después de establecerlo.

### Fase 4 — Denuncias en borrador/gracia
- Crear denuncia con validación de categoría, subcategoría, coordenadas y Plus Code.
- Validar coherencia de coordenadas y Plus Code en servidor. Si no coincide, rechazar la operación con un error de validación accionable; no permitir confirmar una ubicación incoherente.
- Aplicar ventana efectiva de 3 minutos, incluyendo pausa durante ediciones.
- Validar evidencia y registrar tareas de procesamiento sin hacer públicos los archivos.
- Formalizar automáticamente la denuncia cuando expire el tiempo efectivo.

### Fase 5 — Moderación y gestión municipal
- Bandeja de denuncias pendientes.
- Aprobar y asignar unidad municipal en una sola transacción.
- Rechazar con motivo obligatorio.
- Propuestas de duplicados y agrupación sujetas a decisión de Moderador.
- Aplicar RBAC a todas las rutas.

### Fase 6 — Seguimiento y resolución
- Vista de ciudadano limitada a sus propias denuncias.
- Vista administrativa según rol y asignación.
- Registrar progreso, solución propuesta, evidencia privada y verificación del Moderador.
- Aplicar cooldown de 60 minutos desde la formalización.
- Aplicar suspensiones de 168 horas sin superposición.

## 10. Pruebas mínimas de aceptación para la Fase 1

- El servidor inicia con configuración válida.
- El servidor no inicia si faltan variables requeridas.
- `GET /api/v1/health` devuelve `200`.
- `GET /api/v1/health/ready` devuelve `200` cuando PostgreSQL está disponible.
- `GET /api/v1/health/ready` devuelve `503` cuando la base no está disponible.
- `GET /api/v1/auth/me` devuelve `401` sin sesión.
- Ninguna respuesta de error revela secretos, stack traces o detalles internos.
- Las pruebas no requieren datos reales de ciudadanos ni credenciales reales de Google.

## 11. Instrucción para OpenCode

Implementa **solamente la Fase 1** de este documento. Antes de editar, inspecciona el repositorio y sus archivos existentes. Si ya hay estructura o decisiones previas, no las sobrescribas sin explicarlo. No implementes todavía OAuth completo, denuncias, procesamiento de medios ni paneles administrativos. Usa JavaScript y Express, respeta las migraciones SQL existentes y no cambies el esquema de base de datos. Añade pruebas, ejecuta los scripts disponibles y entrega un resumen de archivos creados, comandos ejecutados, resultados de pruebas y cualquier limitación. Si una decisión importante no está especificada, pregunta antes de elegir una alternativa que afecte la arquitectura.

## 12. Criterio para considerar terminada esta etapa

La Fase 1 está terminada cuando el proyecto puede instalar dependencias, arrancar, responder a los endpoints de salud, detectar la disponibilidad de PostgreSQL y pasar las pruebas automatizadas sin exponer secretos. No considerar terminada una prueba que no se haya ejecutado realmente.
