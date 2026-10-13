import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FilePlus2, FileVideo, ImageIcon, Timer } from 'lucide-react'
import { apiFetch } from '../lib/api.js'
import { ComplaintForm } from '../components/complaints/ComplaintForm.jsx'
import { EvidenceUploader } from '../components/complaints/EvidenceUploader.jsx'

/**
 * Creacion de denuncia: tras el alta se navega al detalle con el contador de
 * gracia en vivo y la cola de evidencias pendientes (navigation state) para
 * subirlas contra la denuncia ya creada. Evidencias en dos bloques
 * independientes: fotografias (hasta 3) y video opcional (1).
 */
export function NewComplaintPage() {
  const navigate = useNavigate()
  const [photoFiles, setPhotoFiles] = useState([])
  const [videoFiles, setVideoFiles] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)
  const [locationError, setLocationError] = useState(null)

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

    setFormError(response.data?.error?.message ?? 'No se pudo crear la denuncia. Intenta nuevamente.')
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-ink">
          <FilePlus2 size={24} className="text-marine-700" aria-hidden="true" />
          Crear una denuncia
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Describe el incidente y ubícalo en el mapa. Al enviarla tendrás una{' '}
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

      {formError && (
        <div
          role="alert"
          className={`mt-6 rounded-xl px-5 py-4 ring-1 ${
            formError.startsWith('__COOLDOWN__')
              ? 'border-2 border-state-caution/50 bg-state-caution/10 text-state-caution'
              : 'bg-state-danger/10 text-state-danger ring-state-danger/30'
          }`}
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
          ) : (
            <p className="text-sm font-medium">{formError}</p>
          )}
        </div>
      )}
    </div>
  )
}
