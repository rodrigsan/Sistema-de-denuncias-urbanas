# Bitácora Técnica — Automatización QA, BDD y Jenkins

**Proyecto:** Sistema de Denuncias Ciudadanas — Municipio de Cercado, Cochabamba  
**Objetivo:** Automatización de pruebas de calidad usando BDD, Cucumber y Jenkins  
**Sistema operativo:** Windows 10  
**Estado:** Etapa 2.2 — Ejecución exitosa de Jenkins y documentación actualizada  
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
- Validación de Jenkins completada exitosamente.
- Commit asociado: `1cbc00d515536c60839796a4d049c1563d86276e`.
- Mensaje del commit: "Configure Jenkins test credentials and add QA documentation."
- Primera ejecución del pipeline: `Finished: SUCCESS`.
- Resultado de Cucumber en Jenkins: 1 scenario (1 passed), 7 steps (7 passed).
- Reporte `cucumber.json` archivado como artefacto del build.

---

## 5. Resultado de la primera ejecución exitosa de Jenkins

El pipeline de Jenkins se ejecutó correctamente y finalizó con estado **SUCCESS**. Esto significa que todas las etapas del pipeline completaron su ejecución sin errores y que el resultado global del build fue exitoso.

**Detalle de la ejecución:**
- Commit asociado: `1cbc00d515536c60839796a4d049c1563d86276e`
- Mensaje del commit: "Configure Jenkins test credentials and add QA documentation."
- Estado final: `Finished: SUCCESS`

**Etapas ejecutadas por Jenkins y lo que comprobó cada una:**

| Etapa | Qué verificó |
|-------|--------------|
| **Checkout** | Descarga correcta del código fuente desde el repositorio GitHub (`https://github.com/rodrigsan/Sistema-de-denuncias-urbanas`) en la rama configurada. |
| **Instalación de dependencias Backend** | Ejecución correcta de `npm ci` dentro de `backend/`, instalando todas las dependencias listadas en `package-lock.json`, incluyendo `@cucumber/cucumber` y `@cucumber/pretty-formatter`. |
| **Ejecución BDD Cucumber** | Ejecución de `npm run test:bdd` dentro de `backend/`. Inyectó `SESSION_SECRET` desde credencial de Jenkins y estableció `DATABASE_URL` como valor de prueba. Cucumber leyó y ejecutó el escenario Gherkin correctamente. |
| **Archivado de reportes** | Archivo `backend/bdd/reports/cucumber.json` guardado como artefacto del build para consulta posterior. |

**Resultado de Cucumber en Jenkins:**
- 1 scenario (1 passed)
- 7 steps (7 passed)
- Reporte JSON generado en `backend/bdd/reports/cucumber.json` con estado `passed` en todos los pasos.

El estado **SUCCESS** confirma que el pipeline completo funcionó de extremo a extremo: el código se descargó, las dependencias se instalaron, las pruebas BDD se ejecutaron y el reporte se archivó sin errores.

---

## 6. Estructura de archivos

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

## 7. Configuración del pipeline

Cada etapa del `Jenkinsfile`:

| Etapa | Descripción |
|-------|-------------|
| **Checkout** | Descarga el código fuente desde el repositorio GitHub configurado. |
| **Instalación de dependencias Backend** | Ejecuta `npm ci` dentro de `backend/` para instalar dependencias de forma reproducible usando `package-lock.json`. |
| **Ejecución BDD Cucumber** | Ejecuta `npm run test:bdd` dentro de `backend/`. Inyecta `SESSION_SECRET` desde credencial de Jenkins y establece `DATABASE_URL` como valor de prueba. |
| **Archivado de reportes** | Guarda `backend/bdd/reports/cucumber.json` y `backend/bdd/reports/cucumber.html` como artefactos del build para consulta posterior. |
| **Acciones posteriores** | En caso de fallo, imprime mensaje indicando que se revise la etapa fallida. Siempre imprime mensaje de finalización. |

---

## 8. Problemas encontrados y soluciones

| Problema | Causa | Solución aplicada | Estado |
|----------|-------|-------------------|--------|
| Cucumber no inicia en Jenkins | Faltan variables `DATABASE_URL` y `SESSION_SECRET` requeridas por `loadEnv()` en `env.js` | Añadir `withCredentials` para `SESSION_SECRET` y `set DATABASE_URL=...` como valor de prueba en el paso `bat` | Resuelto (Jenkins ejecutó SUCCESS) |
| Aviso de Git durante ejecución | El repositorio puede mostrar advertencias de configuración de Git (ej. user.email/user.name) | Git funciona correctamente para checkout; las advertencias no impiden la ejecución | Informativo, no bloqueante |

---

## 9. Evidencias

| Evidencia | Detalle |
|-----------|---------|
| Comando ejecutado localmente | `npm run test:bdd` desde `backend/` |
| Resultado de Cucumber local | 1 scenario passed, 7 steps passed |
| Ruta del reporte JSON | `backend/bdd/reports/cucumber.json` |
| Ruta del reporte HTML | `backend/bdd/reports/cucumber.html` |
| Contenido del reporte JSON | Estado `passed` en todos los pasos, con duraciones y ubicaciones de step definitions |
| Contenido del reporte HTML | Reporte HTML de Cucumber con detalles de ejecución, generado junto al JSON en la misma corrida |
| Resultado de Jenkins | `Finished: SUCCESS` (Build Now ejecutado correctamente en la primera ejecución) |
| Evidencias pendientes | Captura de consola de Jenkins, captura del reporte HTML generado |

### Formatos de reporte generados

Se generan dos reportes simultáneamente en cada ejecución de Cucumber:

| Formato | Ruta | Propósito |
|---------|------|-----------|
| **JSON** | `backend/bdd/reports/cucumber.json` | Estructura de datos legible por máquina. Contiene el resultado de cada escenario y paso con duraciones y ubicaciones de step definitions. Útil para integración con herramientas de CI y procesamiento automático. |
| **HTML** | `backend/bdd/reports/cucumber.html` | Reporte visual legible por humanos. Muestra los resultados de ejecución de forma amigable para revisión manual. Generado en la misma corrida que el JSON. |

**Archivado en Jenkins:** Ambos archivos se conservan como artefactos del build mediante `archiveArtifacts` en el stage 'Archivar reportes Cucumber' del Jenkinsfile. Están disponibles para descarga desde la interfaz de Jenkins.

**Nota:** El reporte HTML se entrega como archivo artefacto descargable. Para visualizarlo directamente dentro de la interfaz de Jenkins (sin descarga) se utiliza el plugin **HTML Publisher**, que ya está instalado en este entorno.

### Publicación del reporte HTML mediante HTML Publisher

**¿Qué es HTML Publisher?**
Es un plugin de Jenkins que permite publicar reportes HTML generados durante la ejecución de un pipeline, haciendo que estén disponibles directamente en la interfaz de Jenkins (pestaña de reporte) sin necesidad de descargar el archivo manualmente.

**¿Por qué se utiliza?**
Permite que cualquier miembro del equipo abra el reporte HTML de Cucumber desde Jenkins y vea los resultados de la ejecución de forma visual, navegando por los escenarios y pasos ejecutados, sin tener que descargar el archivo y abrirlo en un navegador externo.

**Diferencia entre archivar y publicar un reporte:**

| Acción | Qué hace | Cómo se accede |
|--------|----------|----------------|
| **Archivar** (`archiveArtifacts`) | Guarda el archivo como artefacto del build para descarga posterior. | Desde la página del build, sección de artefactos, descarga manual. |
| **Publicar** (`publishHTML`) | Integra el reporte HTML en la interfaz de Jenkins como una pestaña dedicada. | Directamente desde el menú del build, sin descargar. |

**Configuración utilizada en el Jenkinsfile:**

```groovy
stage('Publicar reporte HTML') {
    steps {
        publishHTML(target: [
            allowMissing: false,
            alwaysLinkToLastBuild: true,
            keepAll: true,
            reportDir: 'backend/bdd/reports',
            reportFiles: 'cucumber.html',
            reportName: 'Reporte HTML Cucumber'
        ])
    }
}
```

**Ubicación del archivo HTML:**
`backend/bdd/reports/cucumber.html`

**Resultado de las pruebas locales:**
El reporte HTML se genera correctamente junto al JSON en cada ejecución de `npm run test:bdd`, con contenido válido y no vacío (aproximadamente 951 KB).

**Estado de la publicación en Jenkins:**
Pendiente de validación. El stage `Publicar reporte HTML` está configurado en el Jenkinsfile, pero el usuario debe ejecutar "Build Now" en Jenkins para confirmar que el plugin HTML Publisher publica el reporte correctamente.

---

## 10. Diferencia entre prueba BDD, unitaria e integración

Estos tres tipos de pruebas tienen propósitos distintos y no son equivalentes:

| Tipo de prueba | Qué valida | Alcance | Ejemplo en este proyecto |
|----------------|------------|---------|--------------------------|
| **Prueba unitaria** | Una unidad aislada de código (función, método, clase) | Muy reducido, sin dependencias externas | Probar que una función de utilidad formatea correctamente una fecha. |
| **Prueba de integración** | La interacción entre varios componentes o módulos | Medio, puede incluir base de datos o servicios reales | Probar que el endpoint `/api/v1/health` responde correctamente cuando el servidor Express está iniciado. |
| **Prueba BDD** | El comportamiento del sistema desde la perspectiva del usuario, descrito en lenguaje natural | Alto, describe flujos completos de negocio | Probar que un moderador puede aprobar una denuncia y que esta cambia su estado a "Asignada". |

**No son equivalentes:** Una prueba unitaria no reemplaza a una prueba de integración, y ninguna de las dos reemplaza a una prueba BDD. Cada una detecta problemas en diferentes niveles del sistema y se complementan entre sí.

---

## 11. Glosario

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

## 12. Próximas actividades

### Completadas
- [x] Etapa 1: Configuración inicial de Cucumber con escenario de health check.
- [x] Etapa 2: Preparación de Jenkins con Jenkinsfile compatible con Windows 10.
- [x] Etapa 2.1: Diagnóstico de variables de entorno (`DATABASE_URL`, `SESSION_SECRET`).
- [x] Etapa 2.2: Solución de variables de entorno en Jenkinsfile y creación de esta bitácora.
- [x] Ejecutar "Build Now" en Jenkins y validar SUCCESS del pipeline.
- [x] Demostración controlada de fallo de una prueba BDD (cambio temporal de expectativa HTTP 200 a 404).
- [x] Restaurar y volver a ejecutar el escenario health esperando HTTP 200; confirmar que vuelve a pasar.

### Planificadas (pendientes de aprobación)
- [ ] Ejecutar "Build Now" en Jenkins y validar que HTML Publisher publique el reporte correctamente.
- [ ] Agregar más escenarios BDD (creación de denuncias, moderación, reportes históricos, control de acceso).
- [ ] Implementar step definitions para los nuevos escenarios.
- [ ] Considerar Playwright para pruebas de navegador en una segunda iteración.

---

## 13. Experimento controlado "Hazlo fallar"

Se realizó una demostración educativa de fallo intencional en una prueba BDD para validar que el mecanismo de aserción detecta correctamente discrepancias entre el resultado esperado y el real.

**Escenario utilizado:** Check the health endpoint and receive ok status.

**Archivo Gherkin:** `backend/bdd/features/health.feature`.

**Archivo de implementación:** `backend/bdd/step-definitions/health.steps.js`.

**Valor esperado original:** HTTP 200.

**Valor esperado modificado temporalmente:** HTTP 404.

**Respuesta real del servidor:** HTTP 200 (sin cambios en el servidor).

**Resultado observado:**
```
200 !== 404
1 scenario (1 failed)
7 steps (4 passed, 2 skipped, 1 failed)
```

**Mecanismo de detección:** La prueba falló mediante `assert.equal(response.status, statusCode)` en el step definition, comparando `response.status` (200, valor real del servidor) contra `statusCode` (404, valor esperado modificado en el escenario Gherkin).

**Conclusión del experimento:** La prueba BDD detectó correctamente la discrepancia. El servidor no fue modificado; el cambio se realizó únicamente en la expectativa del escenario Gherkin.

**Aprendizaje:** Este experimento confirma que una prueba BDD actúa como un contrato ejecutable: si la expectativa definida en el archivo `.feature` no coincide con el comportamiento real del sistema, la prueba falla de forma visible y determinista. Esto valida que Cucumber está funcionando correctamente como herramienta de verificación de comportamiento.

**Restauración del escenario:** Completada. El escenario `health.feature` fue restaurado a `Then the response code is 200`. La ejecución posterior de Cucumber devolvió:

```
1 scenario (1 passed)
7 steps (7 passed)
```

Esto confirma que, una vez restaurada la expectativa original (HTTP 200), el escenario vuelve a pasar correctamente, validando que el servidor mantiene su comportamiento real y que el mecanismo de aserción de Cucumber funciona en ambos sentidos (detecta fallos cuando hay discrepancia y pasa cuando hay coincidencia).

---

## 14. Estado de avance de las cinco fases del proyecto

**FASE 1. Diagnóstico y preparación:**
- Revisión de los fallos de pruebas existentes: realizada en auditorías anteriores.
- Verificación de scripts npm: realizada.
- Revisión de configuración Git: realizada.
- Preparación de una base de datos exclusiva para testing: pendiente.
**Estado general: parcial.**

**FASE 2. BDD con Cucumber:**
- Instalación de Cucumber para JavaScript: completada.
- Creación de archivos `.feature`: completada para el escenario inicial.
- Implementación de Step Definitions: completada para el escenario inicial.
- Ejecución y verificación: completada, incluyendo ejecución exitosa y fallo intencional local.
**Estado general: implementación inicial completada.** Aclarar que solo existe un escenario funcional y que falta ampliar la cobertura BDD.

**FASE 3. Automatización con Playwright:**
- Navegación automatizada: pendiente.
- Simulación de acciones de ciudadano: pendiente.
- Simulación de acciones de moderador: pendiente.
- Verificación de resultados en la interfaz: pendiente.
**Estado general: pendiente.** Playwright todavía no está implementado.

**FASE 4. Integración con Jenkins:**
- Jenkinsfile creado: completado.
- Repositorio GitHub configurado: completado.
- Instalación automática de dependencias backend: completada.
- Ejecución automatizada de BDD: completada.
- Ejecución automatizada de pruebas generales de backend y frontend: pendiente.
**Estado general: parcial.**

**FASE 5. Reportes y presentación:**
- Reporte JSON de Cucumber: generado.
- Archivado del JSON en Jenkins: completado.
- Demostración local de ejecución exitosa y fallida: realizada.
- Reporte HTML: pendiente.
- Publicación del reporte HTML en Jenkins: pendiente.
- Evidencias y preparación para presentación: parcial.

---

## 15. Primera demostración esperada - elementos verificados

1. **GitHub entrega el código a Jenkins:** completado.
2. **Jenkins inicia el pipeline:** completado.
3. **Cucumber ejecuta escenarios Gherkin:** completado.
4. **Se observan resultados exitosos y fallidos:** demostrado localmente (ejecución exitosa con SUCCESS y fallo intencional con HTTP 404).
5. **Reporte HTML consultable desde Jenkins:** pendiente.

---

## 16. Hoja de ruta priorizada

**Prioridad 1:**
- Restaurar y volver a ejecutar el escenario health esperando HTTP 200.
- Confirmar que vuelve a pasar.
- Documentar el experimento completo.

**Prioridad 2:**
- Inspeccionar rutas y autenticación reales del backend.
- Diseñar uno o dos escenarios BDD adicionales de bajo riesgo.
- No inventar endpoints ni utilizar datos de producción.

**Prioridad 3:** [COMPLETADA]
- Generar un reporte HTML de Cucumber: completado.
- Publicarlo como artefacto consultable en Jenkins: configurado en Jenkinsfile, pendiente de validación con "Build Now".

**Prioridad 4:**
- Evaluar la incorporación de Playwright para automatizar la interfaz.

**Prioridad 5:**
- Evaluar la ejecución de pruebas generales de backend y frontend en Jenkins, teniendo en cuenta los fallos y limitaciones ya identificados.

---

## Regla de mantenimiento

Esta bitácora (`docs/QA-BDD-JENKINS.md`) es el documento oficial de la automatización de calidad. Cada cambio relevante en Cucumber, escenarios BDD, step definitions, Jenkinsfile, configuración de Jenkins, reportes o dependencias de testing debe registrarse aquí en la misma etapa del cambio, incluyendo: fecha, etapa, descripción, motivo técnico, archivos afectados, pruebas ejecutadas, resultado real y problemas pendientes. No se registrarán secretos, contraseñas ni tokens.

---

**Estado actual:** Etapa 2.3 completada. Reporte HTML de Cucumber configurado para generación y publicación en Jenkins (pendiente de validación con "Build Now"). Jenkinsfile incluye stage `Publicar reporte HTML` con plugin HTML Publisher. Ambos reportes (JSON y HTML) se generan localmente con éxito. Reporte JSON archivado. Experimento de fallo controlado documentado. Hoja de ruta priorizada definida (prioridades 1 a 5). Bitácora actualizada.
