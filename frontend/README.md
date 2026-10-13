# Frontend — Denuncias Ciudadanas (Municipio de Cercado)

Cliente web de la plataforma de denuncias ciudadanas. **Fase 7 — Parte 1**:
estructura base, sistema de diseño, layout con menú lateral y página de inicio.

## Tecnologías

- React 19 + Vite (JavaScript, módulos ES)
- React Router para navegación
- Tailwind CSS v4 (plugin `@tailwindcss/vite`, tokens `@theme`)
- lucide-react para iconografía (los iconos de marca se embeben como SVG)
- oxlint como linter
- Cliente HTTP nativo (`fetch`) con `credentials: 'include'` siempre

## Puesta en marcha

```powershell
cd frontend
npm install
copy .env.example .env   # ya incluye VITE_API_URL=http://localhost:3001/api/v1
npm run dev               # http://localhost:5173
```

Requiere el backend corriendo en `http://localhost:3001` (backend/.env ya
autoriza este origen en CORS).

## Scripts

| Script | Descripción |
| --- | --- |
| `npm run dev` | Servidor de desarrollo (5173) |
| `npm run build` | Build de producción |
| `npm run preview` | Previsualiza el build |
| `npm run lint` | Análisis estático (oxlint) |

## Estructura

```text
src/
  lib/api.js              # cliente HTTP (credentials: 'include', envelope de errores)
  contexts/AuthContext.jsx # sesión global (/auth/me + /citizens/me + login/logout)
  components/layout/       # TopBar, Navbar, SidebarDrawer, Footer, PublicLayout
  components/brand/        # MunicipalEmblem (placeholder) y GoogleIcon (SVG)
  components/ui/           # primitivas (SectionHeading)
  pages/                  # LandingPage, AuthCallbackPage, ComingSoonPage, NotFoundPage
```

## Paleta institucional

| Token | Valor | Uso |
| --- | --- | --- |
| `marine-950` | `#0F172A` | TopBar, footer, fondos de contraste |
| `marine-700` | `#1E3A8A` | Primario: CTA, enlaces, acentos |
| `surface` | `#F8FAFC` | Fondo de página |
| `ink` | `#1E293B` | Texto principal |
| `state-success` | `#16A34A` | Resuelta / éxito |
| `state-warning` | `#EA580C` | En proceso / asignada |
| `state-caution` | `#D97706` | Pendiente / gracia / advertencias |
| `state-danger` | `#DC2626` | Rechazada / infracción / error |

## Notas

- El login usa navegación completa a `GET /api/v1/auth/google/login`; el
  backend redirige de vuelta a `/auth/callback?status=...`.
- Sin credenciales de Google en el backend, el botón muestra el mensaje
  `OAUTH_NOT_CONFIGURED` de forma amable (no rompe la UI).
- Las rutas `/mis-denuncias`, `/denuncias/nueva`, `/moderacion` y `/tecnico`
  son marcadores del módulo correspondiente (Parte 2).
