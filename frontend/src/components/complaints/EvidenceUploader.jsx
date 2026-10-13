import { useRef, useState } from 'react'
import { FileVideo, ImageIcon, Trash2, UploadCloud } from 'lucide-react'
import { EVIDENCE_LIMITS } from '../../lib/constants.js'
import { formatFileSize } from '../../lib/utils.js'
import { validateEvidenceFile } from '../../lib/validation.js'

/**
 * Recolector drag-and-drop de evidencias POR TIPO:
 * kind='IMAGE'  -> bloque exclusivo de fotografias (hasta 3: JPG, PNG, HEIC <= 5 MB).
 * kind='VIDEO'  -> bloque exclusivo de video opcional (1: MP4, MOV <= 50 MB y <= 30 s).
 *
 * Valida en cliente los mismos limites del backend (la duracion del video se
 * lee del contenedor en el navegador) y expone la cola via onChange.
 * existingCounts (opcional) suma las evidencias ya subidas al servidor: se
 * usa en la vista de detalle para "agregar mas" durante la gracia.
 */
export function EvidenceUploader({ kind, files, onChange, existingCounts, disabled = false }) {
  const [dragOver, setDragOver] = useState(false)
  const [notice, setNotice] = useState(null)
  const inputRef = useRef(null)

  const isImage = kind === 'IMAGE'
  const typeList = isImage ? EVIDENCE_LIMITS.imageTypes : EVIDENCE_LIMITS.videoTypes
  const maxCount = isImage ? EVIDENCE_LIMITS.maxImages : EVIDENCE_LIMITS.maxVideos
  const maxMb = isImage ? EVIDENCE_LIMITS.maxImageMb : EVIDENCE_LIMITS.maxVideoMb
  const baseCount = isImage ? (existingCounts?.images ?? 0) : (existingCounts?.videos ?? 0)
  const full = baseCount + files.length >= maxCount

  const addFiles = async (incoming) => {
    setNotice(null)
    const next = [...files]
    const errors = []

    for (const file of incoming) {
      if (!typeList.includes(file.type)) {
        errors.push(
          `${file.name}: este bloque acepta solo ${isImage ? 'fotografías (JPG, PNG, HEIC)' : 'videos (MP4, MOV)'}.`,
        )
        continue
      }
      const counts = {
        images: (existingCounts?.images ?? 0) + countFiles(next).images,
        videos: (existingCounts?.videos ?? 0) + countFiles(next).videos,
      }
      const result = await validateEvidenceFile(file, counts)
      if (result.error) {
        errors.push(`${file.name}: ${result.error}`)
        continue
      }
      next.push({ id: crypto.randomUUID(), file, durationSeconds: result.durationSeconds })
    }

    if (errors.length > 0) setNotice(errors[0])
    onChange(next)
  }

  const removeFile = (id) => onChange(files.filter((entry) => entry.id !== id))

  return (
    <div className="space-y-3">
      <div
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled && !full) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragOver(false)
          if (disabled || full) return
          void addFiles([...event.dataTransfer.files])
        }}
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors ${
          disabled || full
            ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
            : dragOver
              ? 'border-marine-700 bg-marine-700/5'
              : 'border-slate-300 bg-surface hover:border-marine-700'
        }`}
      >
        <UploadCloud
          size={26}
          aria-hidden="true"
          className={disabled || full ? 'text-slate-300' : 'text-marine-700'}
        />
        {full ? (
          <p className="mt-3 text-xs font-medium text-slate-400">
            {isImage
              ? `Ya registraste el máximo de ${maxCount} fotografías.`
              : 'Ya registraste el video permitido.'}
          </p>
        ) : (
          <>
            <p className="mt-3 text-sm font-medium text-ink">
              Arrastra aquí {isImage ? 'tus fotografías' : 'tu video'} o{' '}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="font-semibold text-marine-700 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-700"
              >
                selecciónalos
              </button>
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-soft">
              {isImage
                ? `Hasta ${maxCount} fotos (JPG, PNG, HEIC ≤ ${maxMb} MB cada una).`
                : `Solo 1 video (MP4, MOV ≤ ${maxMb} MB y ${EVIDENCE_LIMITS.maxVideoSeconds} segundos).`}
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple={isImage}
              accept={typeList.join(',')}
              className="sr-only"
              onChange={(event) => {
                void addFiles([...event.target.files])
                event.target.value = ''
              }}
            />
          </>
        )}
      </div>

      {notice && (
        <p
          role="alert"
          className="rounded-lg bg-state-danger/10 px-3 py-2 text-xs font-medium text-state-danger ring-1 ring-state-danger/30"
        >
          {notice}
        </p>
      )}

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
            >
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-marine-950 text-white">
                {isImage ? <ImageIcon size={18} aria-hidden="true" /> : <FileVideo size={18} aria-hidden="true" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{entry.file.name}</p>
                <p className="text-[11px] text-ink-soft">
                  {formatFileSize(entry.file.size)}
                  {entry.durationSeconds ? ` · ${entry.durationSeconds} s` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeFile(entry.id)}
                className="rounded-lg p-2 text-ink-soft transition-colors hover:bg-state-danger/10 hover:text-state-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-state-danger"
                aria-label={`Quitar ${entry.file.name}`}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function countFiles(files) {
  const counts = { images: 0, videos: 0 }
  for (const entry of files) {
    if (entry.file.type.startsWith('video/')) counts.videos += 1
    else counts.images += 1
  }
  return counts
}
