# Bitácora Técnica — Automatización QA, BDD y Jenkins

**Proyecto:** Sistema de Denuncias Ciudadanas — Municipio de Cercado, Cochabamba  
**Objetivo:** Automatización de pruebas de calidad usando BDD, Cucumber y Jenkins  
**Sistema operativo:** Windows 10  
**Estado:** Etapa 2.2 — Variables de entorno resueltas y documentación creada  
**Fecha:** 18 de noviembre de 2026

---

## 1. Información general

| Campo | Valor |
|-------|-------|
| Nombre del proyecto | Sistema de Denuncias Ciudadanas — Municipio de Cercado |
| Objetivo de la automatización | Automatizar pruebas de calidad del backend usando BDD, Cucumber y Jenkins, sin modificar funcionalidades existentes. |
| Stack tecnológico | React + Vite (frontend), Node.js + Express (backend), PostgreSQL + PostGIS (base de datos), Leaflet/React-Leaflet (mapas). |
| Herramientas de QA | Cucumber (JavaScript), Gherkin, Vitest (existente), node:test (existente). |
| Herramienta de CI/CD | Jenkins (instalado localmente en Windows 10). |
| Repositorio | GitHub público: https://github.com/rodrigsan/Sistema-de-denuncias-urbanas |

---

## 2. Arquitectura de testing

El proyecto sigue una arquitectura cliente-servidor con separación clara de responsabilidades:

- **Proyecto React + Vite (frontend):** Interfaz de usuario para ciudadanos y moderadores. Consume la API del backend mediante `fetch` con cookies de sesión (`credentials: 'include'`). Las pruebas existentes usan Vitest con Testing Library y jsdom.
- **Backend Node.js + Express:** API REST con arquitectura capas fina (controlador → servicio → repositorio). Toda la lógica de acceso a datos usa consultas SQL parametrizadas con `pg` sobre PostgreSQL + PostGIS.
- **PostgreSQL + PostGIS:** Base de datos relacional con soporte geoespacial para coordenadas de denuncias. Esquema definido en `database/001_initial_schema.sql` y datos iniciales en `002_seed_catalogs.sql`.
- **Cucumber:** Ejecuta escenarios Gherkin en Node.js. Permite escribir pruebas en lenguaje natural que sean legibles para desarrolladores y no desarrolladores.
- **Gherkin:** Lenguaje estructurado para escribir escenarios con palabras clave `Given`, `When`, `Then`, `And`.
- **Jenkins:** Servidor de integración continua que ejecuta el pipeline automáticamente: descarga código, instala dependencias, ejecuta pruebas y archive reportes.
- **GitHub:** Repositorio remoto donde se almacena el código fuente y desde donde Jenkins hace checkout.
- **Reportes JSON:** Cucumber genera `backend/bdd/reports/cucumber.json` con el resultado de cada escenario, listo para ser consumido por Jenkins o herramientas de reporte HTML.

Cada herramienta tiene un propósito definido: Cucumber ejecuta los escenarios, Gherkin los describe, Jenkins los programa, y los reportes JSON evidencian los resultados.

---

## 3. Estrategia BDD

**BDD (Behavior Driven Development)** es una metodología de desarrollo de software que fomenta la colaboración entre desarrolladores, testers y stakeholders no técnicos. Se centra en el comportamiento del sistema desde la perspectiva del usuario.

**Gherkin** es el lenguaje utilizado por Cucumber para escribir escenarios de prueba en formato legible. Sus palabras clave principales son:

| Palabra clave | Propósito |
|---------------|-----------|
| `Feature` | Describe una funcionalidad del sistema. |
| `Scenario` | Describe un caso de uso específico dentro de una característica. |
| `Given` | Establece el contexto inicial o precondiciones. |
| `When` | Describe la acción que ejecuta el usuario o el sistema. |
| `Then` | Declara el resultado esperado tras la acción. |
| `And` | Añade pasos adicionales a `Given`, `When` o `Then`. |

**Step Definitions** son funciones de JavaScript que implementan la lógica detrás de cada paso de Gherkin. Conectan el lenguaje natural con el código real de la aplicación.

Se comenzó con pruebas BDD de **API** (no de navegador) porque:
- Son más rápidas y estables que las pruebas de interfaz gráfica.
- No requieren instalar Playwright ni navegadores en Jenkins.
- El backend ya tiene todos los endpoints implementados y probables.
- Permiten validar toda la lógica de negocio sin depender del frontend.

El primer escenario verifica el endpoint de salud (`GET /api/v1/health`) porque:
- Es el endpoint más simple y estable del sistema.
- No requiere autenticación ni datos de prueba complejos.
- Permite validar que Cucumber puede iniciar el servidor, hacer una petición real y verificar la respuesta.
- Sirve como prueba de concepto antes de agregar escenarios más complejos.

---

## 4. Historial de etapas

### Etapa 1 — Configuración inicial de Cucumber

**Archivos creados:**
- `backend/bdd/features/health.feature` — Escenario Gherkin del health check.
- `backend/bdd/step-definitions/health.steps.js` — Step definitions que consumen la API mediante `fetch`.
- `backend/bdd/support/server.js` — Gestor de ciclo de vida del servidor Express (inicia/detiene en puerto efímero).
- `backend/bdd/cucumber.js` — Configuración de Cucumber con reporte JSON.
- `backend/bdd/reports/` — Directorio para reportes generados.

**Dependencias instaladas:**
- `@cucumber/cucumber` ^13.3.0
- `@cucumber/pretty-formatter` ^4.3.0

**Escenario implementado:** `GET /api/v1/health` debe responder con código 200, estado "ok" y nombre del servicio "denuncias-cercado-api".

**Comando de ejecución:** `npm run test:bdd` desde `backend/`.

**Resultado:** 1 escenario aprobado, 7 pasos aprobados.

### Etapa 2 — Preparación de Jenkins

**Cambios realizados:**
- Se creó `Jenkinsfile` en la raíz del repositorio, compatible con Windows 10 usando `bat`.
- El pipeline ejecuta `npm ci` en `backend/` para instalación reproducible.
- El pipeline ejecuta `npm run test:bdd` para correr Cucumber.
- El pipeline archivea `backend/bdd/reports/cucumber.json` como evidencia.
- Uso de `bat` en lugar de `sh` para compatibilidad con Windows 10.

### Etapa 2.1 — Diagnóstico de variables de entorno

**Hallazgos:**
- Jenkins descargó correctamente el repositorio desde GitHub.
- `npm ci` instaló correctamente las dependencias en `backend/`.
- Cucumber no pudo iniciar porque faltaban las variables `DATABASE_URL` y `SESSION_SECRET`.
- `loadEnv()` en `backend/src/config/env.js` valida que `DATABASE_URL` y `SESSION_SECRET` no sean undefined ni cadenas vacías (líneas 61-63).
- El health check **no necesita conexión real a PostgreSQL**: el endpoint `/api/v1/health` solo devuelve `{ status: 'ok', service: 'denuncias-cercado-api' }` sin tocar la base de datos. Sin embargo, `loadEnv()` se ejecuta al importar el módulo `env`, por lo que las variables deben estar definidas aunque no se usen en este escenario.

### Etapa 2.2 — Solución de variables de entorno

**Cambios realizados:**
- Modificación del `Jenkinsfile` para envolver el paso de ejecución de Cucumber con `withCredentials`.
- Inyección de `SESSION_SECRET` desde credencial de tipo Secret text en Jenkins (ID: `jenkins-session-secret`).
- `DATABASE_URL` se establece como valor de prueba no vacío directamente en el paso `bat` (no es un secreto, no es producción, solo satisface la validación de `loadEnv()`).
- Se mantuvo `NODE_ENV=testing`.
- Se mantuvieron `npm ci` y `npm run test:bdd`.
- Se mantuvo el archivado de `backend/bdd/reports/cucumber.json`.
- Se mantuvo compatibilidad con Windows 10 usando `bat`.

**Archivos modificados:**
- `Jenkinsfile` — Añadido `withCredentials` para `SESSION_SECRET` y `set DATABASE_URL=...` en el paso de ejecución BDD.

**Gestión de credenciales:**
- `SESSION_SECRET` se configura en Jenkins → Manage Jenkins → Credentials como Secret text con ID `jenkins-session-secret`.
- `DATABASE_URL` se define como valor de prueba no sensible directamente en el pipeline, sin almacenar como credencial.

**Pasos manuales realizados en Jenkins:**
- Crear credencial `jenkins-session-secret` (Secret text) en Jenkins.
- Crear el pipeline apuntando al repositorio GitHub y al `Jenkinsfile` en la raíz.
- Ejecutar "Build Now".

**Resultado de la ejecución:**
- Validación de Jenkins pendiente (no se ha ejecutado Build Now exitosamente todavía debido a la falta de credenciales configuradas).

---

## 5. Estructura de archivos

```
proyecto_denuncias/
├── Jenkinsfile                              # Pipeline de CI para Windows 10
├── docs/
│   └── QA-BDD-JENKINS.md                    # Esta bitácora
├── backend/
│   ├── package.json                         # Incluye script test:bdd y dependencias Cucumber
│   ├── bdd/
│   │   ├── features/
│   │   │   └── health.feature               # Escenario Gherkin
│   │   ├── step-definitions/
│   │   │   └── health.steps.js              # Pasos de Cucumber
│   │   ├── support/
│   │   │   └── server.js                    # Ciclo de vida del servidor Express
│   │   ├── cucumber.js                      # Configuración de Cucumber
│   │   └── reports/
│   │       └── cucumber.json                # Reporte JSON generado
│   ├── src/
│   │   └── config/env.js                    # Validación de variables de entorno
│   └── tests/                               # Pruebas existentes (node:test) — no modificadas
└── frontend/
    └── ...                                  # Sin cambios en esta etapa
```

---

## 6. Configuración del pipeline

Cada etapa del `Jenkinsfile`:

| Etapa | Descripción |
|-------|-------------|
| **Checkout** | Descarga el código fuente desde el repositorio GitHub configurado. |
| **Instalación de dependencias Backend** | Ejecuta `npm ci` dentro de `backend/` para instalar dependencias de forma reproducible usando `package-lock.json`. |
| **Ejecución BDD Cucumber** | Ejecuta `npm run test:bdd` dentro de `backend/`. Inyecta `SESSION_SECRET` desde credencial de Jenkins y establece `DATABASE_URL` como valor de prueba. |
| **Archivado de reportes** | Guarda `backend/bdd/reports/cucumber.json` como artefacto del build para consulta posterior. |
| **Acciones posteriores** | En caso de fallo, imprime mensaje indicando que se revise la etapa fallida. Siempre imprime mensaje de finalización. |

---

## 7. Problemas encontrados y soluciones

| Problema | Causa | Solución aplicada | Estado |
|----------|-------|-------------------|--------|
| Cucumber no inicia en Jenkins | Faltan variables `DATABASE_URL` y `SESSION_SECRET` requeridas por `loadEnv()` en `env.js` | Añadir `withCredentials` para `SESSION_SECRET` y `set DATABASE_URL=...` como valor de prueba en el paso `bat` | Pendiente de validación en Jenkins |
| Aviso de Git durante ejecución | El repositorio puede mostrar advertencias de configuración de Git (ej. user.email/user.name) | Git funciona correctamente para checkout; las advertencias no impiden la ejecución | Informativo, no bloqueante |

---

## 8. Evidencias

| Evidencia | Detalle |
|-----------|---------|
| Comando ejecutado localmente | `npm run test:bdd` desde `backend/` |
| Resultado de Cucumber local | 1 scenario passed, 7 steps passed |
| Ruta del reporte JSON | `backend/bdd/reports/cucumber.json` |
| Contenido del reporte JSON | Estado `passed` en todos los pasos, con duraciones y ubicaciones de step definitions |
| Resultado de Jenkins | Pendiente de ejecución (Build Now no ejecutado todavía) |
| Evidencias pendientes | Captura de consola de Jenkins, captura del reporte HTML generado, confirmación de SUCCESS en pipeline |

---

## 9. Glosario

| Término | Definición |
|---------|------------|
| BDD | Behavior Driven Development. Metodología que describe el comportamiento del sistema en lenguaje natural para colaboración entre equipos. |
| QA | Quality Assurance. Aseguramiento de la calidad del software mediante pruebas y procesos. |
| Gherkin | Lenguaje estructurado para escribir escenarios de prueba con palabras clave Given/When/Then. |
| Feature | Archivo `.feature` que describe una funcionalidad con uno o más escenarios. |
| Scenario | Caso de uso específico dentro de una característica. |
| Step Definition | Función de código que implementa la lógica de un paso de Gherkin. |
| Cucumber | Herramienta que ejecuta escenarios Gherkin en varios lenguajes, incluido JavaScript. |
| Pipeline | Secuencia de etapas automatizadas en Jenkins (checkout, build, test, deploy). |
| Jenkinsfile | Archivo que define el pipeline de Jenkins como código. |
| Checkout | Descarga del código fuente desde el repositorio de control de versiones. |
| npm ci | Instalación limpia y reproducible de dependencias usando `package-lock.json`. |
| Credential | Secreto almacenado de forma segura en Jenkins (ej. contraseña, API key, session secret). |
| CI | Continuous Integration. Práctica de integrar y probar cambios de código de forma automática y frecuente. |

---

## 10. Próximas actividades

### Completadas
- [x] Etapa 1: Configuración inicial de Cucumber con escenario de health check.
- [x] Etapa 2: Preparación de Jenkins con Jenkinsfile compatible con Windows 10.
- [x] Etapa 2.1: Diagnóstico de variables de entorno (`DATABASE_URL`, `SESSION_SECRET`).
- [x] Etapa 2.2: Solución de variables de entorno en Jenkinsfile y creación de esta bitácora.

### Planificadas (pendientes de aprobación)
- [ ] Ejecutar "Build Now" en Jenkins y validar SUCCESS del pipeline.
- [ ] Agregar más escenarios BDD (creación de denuncias, moderación, reportes históricos, control de acceso).
- [ ] Implementar step definitions para los nuevos escenarios.
- [ ] Configurar reporte HTML de Cucumber para publicación en Jenkins.
- [ ] Considerar Playwright para pruebas de navegador en una segunda iteración.

---

## Regla de mantenimiento

Esta bitácora (`docs/QA-BDD-JENKINS.md`) es el documento oficial de la automatización de calidad. Cada cambio relevante en Cucumber, escenarios BDD, step definitions, Jenkinsfile, configuración de Jenkins, reportes o dependencias de testing debe registrarse aquí en la misma etapa del cambio, incluyendo: fecha, etapa, descripción, motivo técnico, archivos afectados, pruebas ejecutadas, resultado real y problemas pendientes. No se registrarán secretos, contraseñas ni tokens.

---

**Estado actual:** Etapa 2.2 completada. Jenkinsfile modificado y documentación creada. Pendiente: ejecutar Build Now en Jenkins para validar SUCCESS del pipeline.
