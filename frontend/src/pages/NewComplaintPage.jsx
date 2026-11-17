import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FilePlus2, FileVideo, ImageIcon, Timer, Loader2 } from 'lucide-react'
import { apiFetch } from '../lib/api.js'
import { ComplaintForm } from '../components/complaints/ComplaintForm.jsx'
import { EvidenceUploader } from '../components/complaints/EvidenceUploader.jsx'

export function NewComplaintPage() {
  const navigate = useNavigate()
  const [photoFiles, setPhotoFiles] = useState([])
  const [videoFiles, setVideoFiles] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)
  const [locationError, setLocationError] = useState(null)
  const [secondsRemaining, setSecondsRemaining] = useState(0)
  const [verificationStatus, setVerificationStatus] = useState('loading')
  const [retryPending, setRetryPending] = useState(false)

  /**
   * Estados de verificación (explicitos y diferenciados):
   * - loading: consultas pendientes, formulario bloqueado.
   * - error: alguna consulta falló, formulario bloqueado, muestra reintento.
   * - active: existe una denuncia en período de gracia. Bloquear creación.
   * - cooldown: no existe gracia, pero hay cooldown activo (segundosRemaining > 0). Bloquear creación.
   * - inactive: ambas consultas terminaron correctamente y no existe ninguna restricción. Permitir creación.
   */

  useEffect(() => {
    // Consultar ambas restricciones al montar: gracia y cooldown
    void (async () => {
      try {
        const [complaintsResponse, cooldownResponse] = await Promise.all([
          apiFetch('/citizens/complaints', { credentials: 'include' }),
          apiFetch('/auth/cooldown-status', { credentials: 'include' }),
        ])

        // Detectar gracia activa: alguna denuncia con status === 'GRACE_PERIOD'
        const hasGrace = complaintsResponse.ok
          && complaintsResponse.data
          && complaintsResponse.data.complaints
          && complaintsResponse.data.complaints.some((c) => c.status === 'GRACE_PERIOD')

        // Detectar cooldown activo
        const cooldownData = cooldownResponse.ok ? cooldownResponse.data : null
        let inCooldownNow = false
        let cooldownSeconds = 0
        if (cooldownData?.inCooldown === true) {
          inCooldownNow = true
          cooldownSeconds = cooldownData.secondsRemaining ?? 0
        }

        if (hasGrace) {
          setVerificationStatus('active')
          setSecondsRemaining(0)
        } else if (inCooldownNow) {
          setVerificationStatus('cooldown')
          setSecondsRemaining(cooldownSeconds)
        } else {
          setVerificationStatus('inactive')
          setSecondsRemaining(0)
        }
      } catch (err) {
        // Error en alguna consulta: conservar bloqueo preventivo, no habilitar crear
        setVerificationStatus('error')
      } finally {
        // Note: NO setCooldownLoading aquí, manejamos loading con verificationStatus
      }
    })()
  }, [])

  // Función para reintentar ambas consultas (sin recargar página)
  const retryVerification = async () => {
    setRetryPending(true)
    setVerificationStatus('error')
    setSecondsRemaining(0)
    try {
      const [complaintsResponse, cooldownResponse] = await Promise.all([
        apiFetch('/citizens/complaints', { credentials: 'include' }),
        apiFetch('/auth/cooldown-status', { credentials: 'include' }),
      ])

      // Detectar gracia activa
      const hasGrace = complaintsResponse.ok
        && complaintsResponse.data
        && complaintsResponse.data.complaints
        && complaintsResponse.data.complaints.some((c) => c.status === 'GRACE_PERIOD')

      // Detectar cooldown activo
      const cooldownData = cooldownResponse.ok ? cooldownResponse.data : null
      let inCooldownNow = false
      let cooldownSeconds = 0
      if (cooldownData?.inCooldown === true) {
        inCooldownNow = true
        cooldownSeconds = cooldownData.secondsRemaining ?? 0
      }

      if (hasGrace) {
        setVerificationStatus('active')
        setSecondsRemaining(0)
      } else if (inCooldownNow) {
        setVerificationStatus('cooldown')
        setSecondsRemaining(cooldownSeconds)
      } else {
        setVerificationStatus('inactive')
        setSecondsRemaining(0)
      }
    } catch (err) {
      // Error en reintento: conservar bloqueo
      setVerificationStatus('error')
    } finally {
      setRetryPending(false)
    }
  }

  // Actualizar tiempo restante del cooldown periódicamente mientras esté activo
  useEffect(() => {
    if (verificationStatus === 'cooldown' && secondsRemaining > 0) {
      const interval = setInterval(() => {
        setSecondsRemaining(prev => {
          const next = prev - 60
          if (next <= 0) {
            clearInterval(interval)
            // Cuando llega a cero, volver a consultar ambos endpoints antes de habilitar
            void retryVerification()
            return 0
          }
          return next
        })
      }, 60000)
      return () => clearInterval(interval)
    }
  }, [verificationStatus, secondsRemaining])

  const handleSubmit = async (payload) => {
    setSubmitting(true)
    setFormError(null)
    setLocationError(null)

    const response = await apiFetch('/complaints', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    setSubmitting(false)

    if (response.ok) {
      navigate(`/mis-denuncias/${response.data.id}`, {
        state: { pendingEvidence: [...photoFiles, ...videoFiles] },
      })
      return
    }

    if (response.status === 429) {
      const seconds = response.data?.error?.details?.[0]?.secondsRemaining
      const minutes = Math.ceil((seconds ?? 3600) / 60)
      setFormError(
        `__COOLDOWN__Debes esperar ${minutes} minutos (hasta ${new Date(Date.now() + (seconds ?? 3600) * 1000).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}) desde tu última denuncia formalizada antes de crear una nueva.`,
      )
      // Actualizar tiempo restante localmente tras error del backend
      if (seconds !== undefined) {
        setSecondsRemaining(seconds)
      }
      return
    }
    if (response.status === 422) {
      const mismatch = response.data?.error?.details?.find((detail) => detail.path === 'plusCode')
      if (mismatch) {
        setLocationError({
          message: mismatch.message,
          suggestedPlusCode: mismatch.suggestedPlusCode,
        })
        return
      }
      setFormError(response.data?.error?.details?.[0]?.message ?? 'Revisa los datos del formulario.')
      return
    }

    if (response.status === 409) {
      const code = response.data?.error?.code
      if (code === 'ACTIVE_GRACE_PERIOD_EXISTS') {
        setFormError(
          `__GRACE__${response.data?.error?.message ?? 'Tienes una denuncia en período de gracia activa.'}`,
        )
        return
      }
      setFormError(apiErrorMessage(response.data))
      return
    }

    setFormError(response.data?.error?.message ?? 'No se pudo crear la denuncia. Intenta nuevamente.')
  }

  // Estados de UI
  const isVerificationLoading = verificationStatus === 'loading'
  const isVerificationError = verificationStatus === 'error'

  // El formulario solo puede mostrarse cuando verificationStatus === 'inactive'
  // (ambas consultas terminaron correctamente y no hay restricciones)
  const canShowForm = verificationStatus === 'inactive'

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      {/* Mostrar estado de verificación mientras se cargan las restricciones */}
      {isVerificationLoading && (
        <p className="mb-6 inline-flex items-center gap-2 rounded-lg bg-state-caution/10 px-4 py-2.5 text-sm font-bold text-state-caution">
          <Loader2 size={16} className="text-marine-700 animate-spin" aria-hidden="true" />
          <span>Verificando restricciones. Por favor, espere...</span>
        </p>
      )}

      {/* Error: bloquear creación y mostrar reintento */}
      {isVerificationError && !retryPending && (
        <div className="mb-6 rounded-xl px-5 py-4 bg-state-caution/10">
          <p className="text-sm font-medium text-state-caution">
            <FilePlus2 size={16} className="text-slate-400 mr-2" aria-hidden="true" />
            <span>Error al verificar restricciones. No puedes crear una denuncia mientras persista el error.</span>
          </p>
          <p className="text-xs text-slate-500 mt-1">
            <button
              onClick={() => {
                retryVerification()
              }}
              className="underline text-state-primary hover:text-state-primary/90"
            >
              Reintentar verificación
            </button>
            Vuelve a consultar el estado de gracia y cooldown.
          </p>
        </div>
      )}

      {/* Gracia activa: bloquear creación */}
      {verificationStatus === 'active' && (
        <div className="mb-6 rounded-xl px-5 py-4 bg-state-caution/10">
          <p className="text-sm font-medium text-state-caution">
            <FilePlus2 size={16} className="text-slate-400 mr-2" aria-hidden="true" />
            <span>No puedes crear otra denuncia: tienes una denuncia en período de gracia activa</span>
          </p>
          <p className="text-xs text-state-caution/80 mt-1">
            Ve a "Mis denuncias" para editarla, agregar evidencias, eliminarla o esperar a que se formalice.
          </p>
          <button
            onClick={() => navigate('/mis-denuncias', { replace: true })}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-marine-700 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-marine-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-950"
          >
            <FilePlus2 size={16} aria-hidden="true" />
            Ir a Mis denuncias
          </button>
        </div>
      )}

      {/* Cooldown activo: bloquear creación */}
      {verificationStatus === 'cooldown' && secondsRemaining > 0 && (
        <div className="mb-6 rounded-xl px-5 py-4 bg-state-caution/10">
          <p className="text-sm font-medium text-state-caution">
            <Timer size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>Período de espera activo</span>
            <span className="text-xs text-slate-500 ml-2">· Tiempo restante: {Math.ceil(secondsRemaining / 60)} min</span>
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Debes esperar antes de crear una nueva denuncia.
          </p>
        </div>
      )}

      {/* Mostrar formulario cuando no hay restricciones (solo cuando inactive) */}
      {canShowForm && (
        <>,
          <div className="mb-6">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-ink">
              <FilePlus2 size={24} className="text-marine-700" aria-hidden="true" />
              Crear una denuncia
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              Describe el incidente y ubícalo en el mapa. Al enviarla tendrás una
              <strong>ventana de gracia de 3 minutos</strong> para editarla, agregar evidencias o
              eliminarla libremente.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <ComplaintForm
              submitLabel="Crear denuncia"
              submitting={submitting}
              locationError={locationError}
              onLocationInteract={() => setLocationError(null)}
              onSubmit={(payload) => void handleSubmit(payload)}
              evidenceSlot={
                <>
                  <p className="text-xs leading-relaxed text-ink-soft">
                    Se subirán apenas se registre la denuncia, dentro de tu ventana de gracia. Nunca se
                    publican: solo el personal municipal autorizado puede revisarlas.
                  </p>
                  <div>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
                      <ImageIcon size={15} className="text-marine-700" aria-hidden="true" />
                      Fotografías (hasta 3)
                    </h3>
                    <EvidenceUploader kind="IMAGE" files={photoFiles} onChange={setPhotoFiles} />
                  </div>
                  <div>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
                      <FileVideo size={15} className="text-marine-700" aria-hidden="true" />
                      Video (opcional, 1)
                    </h3>
                    <EvidenceUploader kind="VIDEO" files={videoFiles} onChange={setVideoFiles} />
                  </div>
                </>
              }
            />
          </div>
        </>
      )}

      {formError && (
        <div
          role="alert"
          className={formError.startsWith('__COOLDOWN__') || formError.startsWith('__GRACE__')
            ? 'mt-6 rounded-xl px-5 py-4 ring-1 border-2 border-state-caution/50 bg-state-caution/10 text-state-caution'
            : 'mt-6 rounded-xl px-5 py-4 ring-1 bg-state-danger/10 text-state-danger ring-state-danger/30'}
        >
          {formError.startsWith('__COOLDOWN__') ? (
            <div className="flex items-start gap-3">
              <Timer size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-bold">Período de espera activo</p>
                <p className="mt-1 text-sm leading-relaxed">{formError.replace('__COOLDOWN__', '')}</p>
                <p className="mt-2 text-xs text-state-caution/80">
                  El límite evita el envío masivo de denuncias. Podrás crear la siguiente cuando expire el contador.
                </p>
              </div>
            </div>
          ) : formError.startsWith('__GRACE__') ? (
            <div className="flex items-start gap-3">
              <Timer size={20} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-bold">Denuncia en ventana de gracia activa</p>
                <p className="mt-1 text-sm leading-relaxed">{formError.replace('__GRACE__', '')}</p>
                <p className="mt-2 text-xs text-state-caution/80">
                  Ve a "Mis denuncias" para editarla, agregar evidencias, eliminarla o esperar a que se formalice.
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm font-medium">{formError}</p>
          )}
        </div>
      )}
    </div>
  )
}