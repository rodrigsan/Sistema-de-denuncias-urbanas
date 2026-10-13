import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  BadgeCheck,
  FileVideo,
  ImageIcon,
  MapPin,
  Pencil,
  Plus,
  TriangleAlert,
  Trash2,
} from 'lucide-react'
import { apiFetch, apiErrorMessage } from '../lib/api.js'
import { formatDateTime } from '../lib/utils.js'
import { ComplaintForm } from '../components/complaints/ComplaintForm.jsx'
import { EvidenceUploadPanel } from '../components/complaints/EvidenceUploadPanel.jsx'
import { EvidenceUploader } from '../components/complaints/EvidenceUploader.jsx'
import { GraceCountdown } from '../components/complaints/GraceCountdown.jsx'
import { StatusBadge } from '../components/complaints/StatusBadge.jsx'

/**
 * Detalle de la denuncia propia:
 *
 * - En GRACE_PERIOD: contador en vivo (180 s efectivos del servidor), botones
 *   de editar (pausa el reloj via edit-session/start), eliminar (soft delete)
 *   y panel de evidencias; al llegar a 0 se refresca y el backend formaliza
 *   en el siguiente acceso, mostrando "Denuncia formalizada".
 * - Fuera de gracia: vista de solo lectura con estado, unidad y evidencias.
 */
export function ComplaintDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()

  const [complaint, setComplaint] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [locationError, setLocationError] = useState(null)

  const [pendingEvidence, setPendingEvidence] = useState(location.state?.pendingEvidence ?? [])
  const [photoExtra, setPhotoExtra] = useState([])
  const [videoExtra, setVideoExtra] = useState([])

  const load = useCallback(async () => {
    const response = await apiFetch(`/complaints/${id}`)
    if (response.ok) {
      setComplaint(response.data)
      setNotFound(false)
      if (response.data.status !== 'GRACE_PERIOD') setEditing(false)
    } else if (response.status === 404) {
      setNotFound(true)
    } else {
      setActionError('No se pudo cargar la denuncia. Intenta nuevamente.')
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect -- carga de datos del modulo
    void load()
  }, [load])

  const inGrace = complaint?.status === 'GRACE_PERIOD'

  const startEditing = async () => {
    setActionError(null)
    const response = await apiFetch(`/complaints/${id}/edit-session/start`, { method: 'PUT' })
    if (response.ok) {
      setComplaint(response.data)
      setEditing(true)
    } else {
      setActionError(apiErrorMessage(response.data))
    }
  }

  const saveEdition = async (payload) => {
    setSubmitting(true)
    setActionError(null)
    setLocationError(null)
    const response = await apiFetch(`/complaints/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
    setSubmitting(false)
    if (response.ok) {
      setComplaint(response.data)
      setEditing(false)
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
      setActionError(
        response.data?.error?.details?.[0]?.message ?? apiErrorMessage(response.data),
      )
      return
    }
    setActionError(apiErrorMessage(response.data))
  }

  const cancelEdition = async () => {
    setActionError(null)
    const response = await apiFetch(`/complaints/${id}/edit-session/cancel`, { method: 'POST' })
    if (response.ok) {
      setComplaint(response.data)
      setEditing(false)
    } else {
      setActionError(apiErrorMessage(response.data))
    }
  }

  const removeComplaint = async () => {
    setSubmitting(true)
    const response = await apiFetch(`/complaints/${id}`, { method: 'DELETE' })
    setSubmitting(false)
    if (response.status === 204) {
      navigate('/mis-denuncias')
      return
    }
    setActionError(apiErrorMessage(response.data))
  }

  const consumeUploaded = (entryId) => {
    setPendingEvidence((current) => current.filter((entry) => entry.id !== entryId))
    setPhotoExtra((current) => current.filter((entry) => entry.id !== entryId))
    setVideoExtra((current) => current.filter((entry) => entry.id !== entryId))
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="h-64 animate-pulse rounded-2xl bg-slate-200/70" aria-hidden="true" />
      </div>
    )
  }

  if (notFound || !complaint) {
    return (
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-2xl font-bold text-ink">Denuncia no encontrada</h1>
        <p className="mt-3 text-sm text-ink-soft">
          No existe, fue eliminada o no te pertenece.
        </p>
        <Link
          to="/mis-denuncias"
          className="mt-8 inline-flex rounded-lg bg-marine-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-marine-600"
        >
          Volver a mis denuncias
        </Link>
      </div>
    )
  }

  const justFormalized = complaint.status === 'PENDING_REVIEW' && complaint.grace?.remainingSeconds === 0

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link
        to="/mis-denuncias"
        className="text-xs font-semibold text-marine-700 transition-colors hover:text-marine-950"
      >
        ← Volver a mis denuncias
      </Link>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusBadge status={complaint.status} />
          <span className="font-mono text-[11px] font-semibold tracking-wider text-ink-soft">
            {complaint.publicCode}
          </span>
        </div>
        <span className="text-xs text-ink-soft">{formatDateTime(complaint.createdAt)}</span>
      </div>

      {justFormalized && (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-state-success/10 px-4 py-3 text-sm font-semibold text-state-success ring-1 ring-state-success/30">
          <BadgeCheck size={18} aria-hidden="true" />
          ¡Denuncia formalizada! Entró en revisión municipal y ya no puede editarse.
        </p>
      )}

      {inGrace && (
        <div className="mt-4 space-y-4">
          <GraceCountdown
            key={`${complaint.grace.remainingSeconds}-${complaint.grace.state}`}
            grace={complaint.grace}
            onExpire={() => void load()}
          />

          {!editing && (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void startEditing()}
                className="inline-flex items-center gap-2 rounded-lg bg-marine-700 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-marine-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-950"
              >
                <Pencil size={16} aria-hidden="true" />
                Editar
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-state-danger/40 px-4 py-2.5 text-sm font-bold text-state-danger transition-colors hover:bg-state-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-state-danger"
              >
                <Trash2 size={16} aria-hidden="true" />
                Eliminar
              </button>
            </div>
          )}

          {confirmingDelete && (
            <div className="rounded-xl border border-state-danger/40 bg-state-danger/5 p-4">
              <p className="flex items-start gap-2 text-sm font-medium text-ink">
                <TriangleAlert size={18} className="mt-0.5 shrink-0 text-state-danger" aria-hidden="true" />
                ¿Eliminar tu denuncia dentro de la ventana de gracia? Esta acción no se puede
                deshacer y no activa el tiempo de espera para crear una nueva.
              </p>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => void removeComplaint()}
                  disabled={submitting}
                  className="rounded-lg bg-state-danger px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-state-danger disabled:cursor-wait disabled:opacity-60"
                >
                  {submitting ? 'Eliminando…' : 'Sí, eliminar'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:bg-slate-100"
                >
                  Conservar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {actionError && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-state-danger/10 px-4 py-3 text-sm font-medium text-state-danger ring-1 ring-state-danger/30"
        >
          {actionError}
        </p>
      )}

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {editing ? (
          <ComplaintForm
            initial={complaint}
            submitLabel="Guardar cambios"
            submitting={submitting}
            locationError={locationError}
            onLocationInteract={() => setLocationError(null)}
            onSubmit={(payload) => void saveEdition(payload)}
            onCancel={() => void cancelEdition()}
          />
        ) : (
          <div className="space-y-5">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-ink">{complaint.title}</h1>
              <p className="mt-1 text-xs text-ink-soft">
                {complaint.category.name} · {complaint.subcategory.name}
              </p>
            </div>

            <p className="text-sm leading-relaxed text-ink">{complaint.description}</p>

            <div className="flex items-start gap-2 rounded-lg bg-surface px-3 py-2.5 text-xs text-ink-soft ring-1 ring-slate-200">
              <MapPin size={14} className="mt-0.5 shrink-0 text-marine-700" aria-hidden="true" />
              <span>
                Lat/Lng{' '}
                <span className="font-mono">
                  {complaint.location.latitude.toFixed(5)}, {complaint.location.longitude.toFixed(5)}
                </span>{' '}
                · Plus Code <span className="font-mono">{complaint.plusCode}</span>
              </span>
            </div>

            <EvidenceUploadPanel
              complaintId={complaint.id}
              evidence={complaint.evidence ?? []}
              pending={[
                ...pendingEvidence,
                ...photoExtra,
                ...videoExtra,
              ].filter(
                (entry, index, all) =>
                  all.findIndex((candidate) => candidate.id === entry.id) === index,
              )}
              onConsumed={consumeUploaded}
              onUploaded={() => void load()}
              canDelete={inGrace}
            />

            {inGrace && (
              <div className="space-y-4">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                  <Plus size={12} className="text-marine-700" aria-hidden="true" />
                  Agregar más evidencias (dentro de la gracia)
                </p>
                <div>
                  <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink">
                    <ImageIcon size={13} className="text-marine-700" aria-hidden="true" />
                    Fotografías (hasta 3 en total)
                  </p>
                  <EvidenceUploader
                    kind="IMAGE"
                    files={photoExtra}
                    onChange={setPhotoExtra}
                    existingCounts={{
                      images: (complaint.evidence ?? []).filter((item) => item.mediaType === 'IMAGE').length,
                      videos: 0,
                    }}
                  />
                </div>
                <div>
                  <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink">
                    <FileVideo size={13} className="text-marine-700" aria-hidden="true" />
                    Video (1 en total)
                  </p>
                  <EvidenceUploader
                    kind="VIDEO"
                    files={videoExtra}
                    onChange={setVideoExtra}
                    existingCounts={{
                      images: 0,
                      videos: (complaint.evidence ?? []).filter((item) => item.mediaType === 'VIDEO').length,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
