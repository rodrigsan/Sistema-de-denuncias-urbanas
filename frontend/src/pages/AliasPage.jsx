import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { BadgeCheck, ShieldCheck } from 'lucide-react'
import { apiFetch, apiErrorMessage } from '../lib/api.js'
import { aliasSchema, validateSchema } from '../lib/validation.js'
import { useAuth } from '../hooks/useAuth.js'

/**
 * Pantalla de seleccion de alias (primer acceso del ciudadano).
 * El alias es el seudonimo publico con el que se firman sus denuncias:
 * no puede cambiarse despues, y los datos de identidad permanecen privados.
 */
export function AliasPage() {
  const { user, loading, refresh } = useAuth()
  const navigate = useNavigate()

  const [alias, setAlias] = useState('')
  const [fieldError, setFieldError] = useState(null)
  const [serverError, setServerError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState(null)

  if (!loading && user && !user.requiresAlias) {
    return <Navigate to="/mis-denuncias" replace />
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return

    const result = validateSchema(aliasSchema, alias)
    if (!result.ok) {
      setFieldError(result.fieldErrors[''] ?? 'Alias invalido.')
      return
    }

    setFieldError(null)
    setServerError(null)
    setSubmitting(true)

    const response = await apiFetch('/auth/alias', {
      method: 'POST',
      body: JSON.stringify({ alias: result.data }),
    })
    setSubmitting(false)

    if (response.ok) {
      setCreated(response.data)
      void refresh()
      return
    }
    if (response.status === 422) {
      const detail = response.data?.error?.details?.[0]
      setFieldError(detail?.message ?? apiErrorMessage(response.data))
      return
    }
    setServerError(apiErrorMessage(response.data))
  }

  if (created) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <div className="rounded-2xl border border-state-success/40 bg-state-success/5 p-8 text-center">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-state-success text-white">
            <BadgeCheck size={28} aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-xl font-bold text-ink">Tu alias quedó registrado</h1>
          <p className="mt-2 text-sm text-ink-soft">
            Desde ahora tus denuncias se firmarán como{' '}
            <strong className="text-ink">{created.alias}</strong>. Guarda tu código administrativo:
            lo usarás para el seguimiento.
          </p>
          <p className="mt-3 inline-block rounded-lg bg-marine-950 px-4 py-2 font-mono text-lg font-bold tracking-widest text-white">
            {created.administrativeCode}
          </p>
          <p className="mt-4 text-[11px] leading-relaxed text-ink-soft">
            El alias no puede cambiarse después de establecerse. Tu cuenta de Google y tu correo
            permanecen privados.
          </p>
          <button
            type="button"
            onClick={() => navigate('/denuncias/nueva')}
            className="mt-6 inline-flex rounded-lg bg-marine-700 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-marine-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-950"
          >
            Crear mi primera denuncia
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Elige tu alias</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Es el nombre público con el que aparecerán tus denuncias. Puedes usar un apodo: no
          necesitas datos reales y el alias <strong>no podrá cambiarse</strong> después.
        </p>

        <form onSubmit={(event) => void handleSubmit(event)} noValidate className="mt-6 space-y-4">
          <div>
            <label htmlFor="alias-input" className="mb-1.5 block text-sm font-semibold text-ink">
              Alias <span className="text-state-danger" aria-hidden="true">*</span>
            </label>
            <input
              id="alias-input"
              type="text"
              value={alias}
              maxLength={60}
              onChange={(event) => setAlias(event.target.value)}
              placeholder="Ej.: Vecino de la Laguna"
              className={`w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
                fieldError
                  ? 'border-state-danger focus:ring-state-danger/20'
                  : 'border-slate-300 focus:border-marine-700 focus:ring-marine-700/20'
              }`}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={fieldError ? 'alias-error' : undefined}
            />
            {fieldError && (
              <p id="alias-error" className="mt-1.5 text-xs font-medium text-state-danger">
                {fieldError}
              </p>
            )}
            <p className="mt-1.5 text-[11px] text-ink-soft">Entre 3 y 60 caracteres.</p>
          </div>

          {serverError && (
            <p role="alert" className="rounded-lg bg-state-danger/10 px-3 py-2 text-xs font-medium text-state-danger ring-1 ring-state-danger/30">
              {serverError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-marine-700 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-marine-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-950 disabled:cursor-wait disabled:opacity-60"
          >
            {submitting ? 'Registrando…' : 'Confirmar alias'}
          </button>
        </form>

        <p className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-ink-soft">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-state-success" aria-hidden="true" />
          Tu correo y tu cuenta de Google nunca se muestran en las denuncias ni ante funcionarios
          municipales.
        </p>
      </div>
    </div>
  )
}
