import { useNavigate } from 'react-router-dom'
import {
  Ban,
  ClipboardCheck,
  FilePen,
  FilePlus2,
  Lightbulb,
  MapPin,
  Plus,
  Recycle,
  Road,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Trees,
  TriangleAlert,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth.js'
import { SectionHeading } from '../components/ui/SectionHeading.jsx'
import { GoogleIcon } from '../components/brand/GoogleIcon.jsx'

/* Categorias urbanas (RF-13): textos del catalogo sembrado en el backend. */
const CATEGORIES = [
  {
    icon: Road,
    title: 'Vialidad y Calles',
    description: 'Baches, pavimento, señalización, semáforos, aceras y rampas.',
  },
  {
    icon: Lightbulb,
    title: 'Servicios Básicos e Iluminación',
    description: 'Alumbrado público, fugas de agua y alcantarillado.',
  },
  {
    icon: Trees,
    title: 'Espacios Públicos y Áreas Verdes',
    description: 'Parques, plazas, árboles peligrosos y áreas recreativas.',
  },
  {
    icon: Recycle,
    title: 'Gestión Ambiental y Aseo Urbano',
    description: 'Botaderos clandestinos, recolección de residuos y escombros.',
  },
  {
    icon: ShieldCheck,
    title: 'Seguridad',
    description: 'Cámaras municipales dañadas y lotes baldíos abandonados.',
  },
]

/* RF-14: lo que esta plataforma NO gestiona. */
const EXCLUSIONS = [
  {
    icon: Siren,
    title: 'Emergencias',
    text: 'En una emergencia llama inmediatamente al 911 o a Bomberos. Esta plataforma no atiende casos de riesgo inmediato.',
  },
  {
    icon: ShieldAlert,
    title: 'Delitos y denuncias policiales',
    text: 'Los delitos y faltas se denuncian ante la Policía Boliviana. Aquí no se gestionan casos de esa naturaleza.',
  },
  {
    icon: Ban,
    title: 'Infracciones y asuntos no municipales',
    text: 'Las infracciones de tránsito, multas y temas fuera de la competencia municipal deben canalizarse a las instancias correspondientes.',
  },
]

/* RF-15: flujo de 3 pasos. El paso 1 usa el "G" oficial en SVG inline
   (lucide-react ya no incluye iconos de marca). */
const STEPS = [
  {
    icon: null,
    title: 'Identifícate con Google',
    text: 'Ingresa con tu cuenta de Google en un solo clic. Tus datos de identidad permanecen privados y separados del contenido de tus denuncias.',
  },
  {
    icon: FilePen,
    title: 'Describe el problema y ubícalo',
    text: 'Cuenta qué ocurre, elige la categoría y marca la ubicación exacta del incidente o su Plus Code.',
  },
  {
    icon: ClipboardCheck,
    title: 'Haz seguimiento',
    text: 'Con tu alias y el código público de la denuncia, sigue su estado desde la revisión municipal hasta la solución.',
  },
]

export function LandingPage() {
  const navigate = useNavigate()
  const { user, loading, authError, loginWithGoogle } = useAuth()

  const isAdminUser =
    user?.userType === 'ADMIN' ||
    user?.roles?.includes('MODERATOR') ||
    user?.roles?.includes('TECHNICAL_LIAISON')

  const startComplaint = () => {
    if (!user) {
      void loginWithGoogle()
      return
    }
    if (isAdminUser) {
      // Usuarios administrativos no crean denuncias: redirigir a su panel.
      if (user.roles?.includes('MODERATOR')) {
        navigate('/moderacion')
        return
      }
      navigate('/tecnico')
      return
    }
    navigate('/denuncias/nueva')
  }

  return (
    <>
      {/* Hero */}
      <section id="inicio" className="relative overflow-hidden bg-marine-950 text-white">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-br from-marine-950 via-marine-800 to-marine-700 opacity-90"
        />
        <div className="relative mx-auto max-w-4xl px-4 py-20 text-center sm:py-28">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold tracking-wide text-slate-200 ring-1 ring-white/20">
            <MapPin size={14} aria-hidden="true" />
            Municipio de Cercado · Cochabamba, Bolivia
          </p>
          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl">
            Reporta problemas de tu ciudad
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-200 sm:text-lg">
            Plataforma oficial de denuncias ciudadanas del Municipio de Cercado: reporta baches,
            fallas de alumbrado, áreas verdes abandonadas y otros incidentes urbanos, y realiza el
            seguimiento de su atención hasta la solución.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={startComplaint}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3.5 text-sm font-bold text-marine-950 shadow-lg transition-transform hover:scale-[1.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:cursor-wait disabled:opacity-70"
            >
              <Plus size={18} aria-hidden="true" />
              {isAdminUser ? 'Ir a mi panel' : 'Crear una denuncia'}
            </button>
            <a
              href="#como-funciona"
              className="rounded-lg border border-white/30 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              Ver cómo funciona
            </a>
          </div>

          {authError && (
            <p
              role="alert"
              className="mx-auto mt-5 max-w-md rounded-lg bg-state-caution/15 px-4 py-3 text-xs font-medium text-amber-200 ring-1 ring-state-caution/40"
            >
              {authError}
            </p>
          )}

          <p className="mt-6 text-[11px] text-slate-400">
            Tu cuenta de Google se usa solo para verificar tu identidad: el municipio nunca verá tu
            correo y tus denuncias se firman con un alias que tú eliges.
          </p>
        </div>
      </section>

      {/* RF-13: que si denunciar */}
      <section id="que-denunciar" className="mx-auto max-w-7xl px-4 py-16 sm:py-20">
        <SectionHeading
          eyebrow="Qué sí denunciar"
          title="Incidentes urbanos de competencia municipal"
          description="Puedes reportar cualquier problema del espacio público que corresponda al Municipio. Estas son las categorías de atención:"
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {CATEGORIES.map(({ icon: Icon, title, description }) => (
            <article
              key={title}
              className="group rounded-xl border border-slate-200 bg-white p-5 transition-all hover:-translate-y-1 hover:border-marine-700 hover:shadow-lg focus-within:border-marine-700"
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-marine-950 text-white transition-colors group-hover:bg-marine-700">
                <Icon size={22} aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-sm font-bold text-ink">{title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{description}</p>
            </article>
          ))}
        </div>
      </section>

      {/* RF-14: que NO es esta plataforma */}
      <section aria-labelledby="exclusions-title" className="bg-slate-100/70">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:py-20">
          <div className="rounded-2xl border-2 border-state-caution/50 bg-state-caution/5 p-6 sm:p-10">
            <div className="flex items-start gap-4">
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-state-caution text-white">
                <TriangleAlert size={24} aria-hidden="true" />
              </span>
              <div>
                <h2 id="exclusions-title" className="text-xl font-bold text-ink sm:text-2xl">
                  Qué NO es esta plataforma
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                  Esta plataforma <strong>solo gestiona problemas de competencia municipal</strong>.
                  Para los siguientes casos, acude a los canales correctos:
                </p>
              </div>
            </div>

            <ul className="mt-8 grid gap-4 sm:grid-cols-3">
              {EXCLUSIONS.map(({ icon: Icon, title, text }) => (
                <li key={title} className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Icon size={18} className="shrink-0 text-state-danger" aria-hidden="true" />
                    {title}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-ink-soft">{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* RF-15: como funciona */}
      <section id="como-funciona" className="mx-auto max-w-7xl px-4 py-16 sm:py-20">
        <SectionHeading
          eyebrow="Cómo funciona"
          title="De tu reporte a la solución, en 3 pasos"
          description="El proceso es simple, transparente y respeta tu privacidad en cada etapa."
        />
        <ol className="mt-10 grid gap-6 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }, index) => (
            <li key={title} className="relative rounded-xl border border-slate-200 bg-white p-6">
              <span className="absolute -top-3 left-6 inline-flex h-7 w-7 items-center justify-center rounded-full bg-marine-700 text-xs font-bold text-white">
                {index + 1}
              </span>
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-marine-950 text-white">
                {Icon ? (
                  <Icon size={24} aria-hidden="true" />
                ) : (
                  <GoogleIcon size={24} />
                )}
              </span>
              <h3 className="mt-4 text-base font-bold text-ink">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{text}</p>
            </li>
          ))}
        </ol>

        <div className="mt-12 text-center">
          <button
            type="button"
            onClick={startComplaint}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-marine-700 px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-marine-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-950 disabled:cursor-wait disabled:opacity-70"
          >
            <FilePlus2 size={18} aria-hidden="true" />
            Crear mi primera denuncia
          </button>
        </div>
      </section>
    </>
  )
}
