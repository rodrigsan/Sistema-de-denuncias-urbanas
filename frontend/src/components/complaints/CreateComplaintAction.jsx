import { useState } from 'react'
import { Timer } from 'lucide-react'
import { apiFetch } from '../../lib/api.js'

export function CreateComplaintAction({
  children,
  className,
  disabled = false,
  checkCooldown = true,
  onAllowed,
  hasActiveGrace,
}) {
  const [checking, setChecking] = useState(false)
  const [dialog, setDialog] = useState(null)

  const handleClick = async () => {
    // Si hay gracia activa, bloquear y mostrar mensaje específico
    if (hasActiveGrace) {
      setDialog({ error: 'No puedes crear otra denuncia: tienes una denuncia en período de gracia activa. Regresa al detalle de tu denuncia actual.' })
      return
    }

    if (!checkCooldown) {
      onAllowed()
      return
    }

    setChecking(true)
    try {
      const response = await apiFetch('/auth/cooldown-status')
      if (!response.ok || typeof response.data?.inCooldown !== 'boolean') {
        setDialog({ error: 'No se pudo verificar el período de espera. Intenta nuevamente.' })
        return
      }

      if (response.data.inCooldown) {
        setDialog({ secondsRemaining: response.data.secondsRemaining })
        return
      }

      onAllowed()
    } catch {
      setDialog({ error: 'No se pudo verificar el período de espera. Intenta nuevamente.' })
    } finally {
      setChecking(false)
    }
  }

  const minutesRemaining = Math.ceil((dialog?.secondsRemaining ?? 0) / 60)

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={disabled || checking}
        className={className}
      >
        {checking ? 'Verificando…' : children}
      </button>

      {dialog && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-marine-950/60 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDialog(null)
          }}
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="submission-cooldown-title"
            aria-describedby="submission-cooldown-description"
            className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl"
          >
            <Timer size={40} className="mx-auto mb-3 text-state-caution" aria-hidden="true" />
            <h2 id="submission-cooldown-title" className="text-xl font-bold text-ink">
              {dialog.error ? 'No se pudo verificar' : 'Período de espera activo'}
            </h2>
            <p id="submission-cooldown-description" className="mt-3 text-sm text-ink-soft">
              {dialog.error
                ? dialog.error
                : `Debes esperar aproximadamente ${minutesRemaining} ${minutesRemaining === 1 ? 'minuto' : 'minutos'} para poder enviar otra denuncia.`}
            </p>
            {dialog.secondsRemaining !== undefined && (
              <p className="mt-3 font-semibold text-ink">
                Tiempo restante: {minutesRemaining} {minutesRemaining === 1 ? 'minuto' : 'minutos'}
              </p>
            )}
            <button
              type="button"
              onClick={() => setDialog(null)}
              className="mt-5 rounded-lg bg-marine-700 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-marine-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-950"
            >
              Entendido
            </button>
          </section>
        </div>
      )}
    </>
  )
}