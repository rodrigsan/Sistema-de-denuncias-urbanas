import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api.js'
import { encodePlusCode } from '../../lib/pluscode.js'
import { complaintFormSchema, validateSchema } from '../../lib/validation.js'
import { CERCADO_BOUNDS } from '../../lib/constants.js'

// Code-splitting: Leaflet (~150 kB) solo se carga cuando se usa el mapa.
const LocationPicker = lazy(() =>
  import('./LocationPicker.jsx').then((module) => ({ default: module.LocationPicker })),
)

const INPUT_CLASSES =
  'w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-slate-400 focus:border-marine-700 focus:outline-none focus:ring-2 focus:ring-marine-700/20'
const ERROR_CLASSES = 'mt-1.5 text-xs font-medium text-state-danger'
const BLOCK_HEADING_CLASSES =
  'flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-ink'

/** Orden de recorrido para el auto-scroll al primer campo con error. */
const ERROR_ORDER = ['title', 'description', 'categoryId', 'subcategoryId', 'location']

/**
 * Formulario de denuncia compartido entre creacion (POST /complaints) y
 * edicion en ventana de gracia (PUT /complaints/:id).
 *
 * Estructura por bloques (maqueta visual):
 *   1. Datos: titulo (tipografia de encabezado), descripcion y
 *      categoria/subcategoria jerarquicas en 2 columnas.
 *   2. Evidencias (slot opcional): la pagina inyecta los recolectores de
 *      fotografias y video; en modo edicion se omite el bloque.
 *   3. Ubicacion: encabezado con boton "Obtener mi ubicacion", mapa Leaflet
 *      limitado a Cercado y campos obligatorios de Coordenadas y Plus Code.
 *   4. Accion final: boton de envio destacado y centrado al final.
 *
 * - LOCATION_MISMATCH (backend): resalta en rojo Coordenadas/Plus Code,
 *   muestra la sugerencia del servidor y BLOQUEA el envio hasta corregir.
 * - Auto-scroll suave (scrollIntoView, block: 'center') al primer campo con
 *   error de validacion Zod o a la ubicacion si falta marcar el incidente.
 */
export function ComplaintForm({
  initial,
  submitLabel,
  submitting,
  onSubmit,
  onCancel,
  locationError = null,
  onLocationInteract,
  evidenceSlot = null,
}) {
  const [categories, setCategories] = useState([])
  const [loadingCategories, setLoadingCategories] = useState(true)

  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '')
  const [subcategoryId, setSubcategoryId] = useState(initial?.subcategoryId ?? '')
  const [location, setLocation] = useState(
    initial?.location ? { ...initial.location, source: 'MANUAL' } : null,
  )
  const [fieldErrors, setFieldErrors] = useState({})

  const titleRef = useRef(null)
  const descriptionRef = useRef(null)
  const categoryRef = useRef(null)
  const subcategoryRef = useRef(null)
  const locationRef = useRef(null)

  const plusCode = location ? encodePlusCode(location.latitude, location.longitude) : null
  const mismatch = locationError

  useEffect(() => {
    let cancelled = false
    const loadCategories = async () => {
      const response = await apiFetch('/categories')
      if (cancelled) return
      if (response.ok) setCategories(response.data.categories)
      setLoadingCategories(false)
    }
    void loadCategories()
    return () => {
      cancelled = true
    }
  }, [])

  const scrollToField = (key) => {
    const fieldRefs = {
      title: titleRef,
      description: descriptionRef,
      categoryId: categoryRef,
      subcategoryId: subcategoryRef,
      location: locationRef,
    }
    requestAnimationFrame(() => {
      fieldRefs[key]?.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  const handleLocationChange = (next) => {
    setLocation(next)
    onLocationInteract?.()
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (submitting) return

    const values = {
      title,
      description,
      categoryId,
      subcategoryId,
      latitude: location?.latitude,
      longitude: location?.longitude,
    }
    const result = validateSchema(complaintFormSchema, values)

    if (!result.ok) {
      const errors = { ...result.fieldErrors }
      if (!location && errors.latitude) {
        errors.location = errors.latitude
        delete errors.latitude
        delete errors.longitude
      }
      setFieldErrors(errors)
      const first = ERROR_ORDER.find((key) => errors[key])
      if (first) scrollToField(first)
      return
    }

    // LOCATION_MISMATCH sin corregir: no se permite el envio.
    if (mismatch) {
      scrollToField('location')
      return
    }

    setFieldErrors({})
    onSubmit({
      ...result.data,
      plusCode,
      plusCodeSource: location.source === 'AUTOMATIC' ? 'AUTOMATIC' : 'MANUAL',
    })
  }

  const selectedCategory = categories.find((category) => category.id === categoryId)
  const locationIssue = Boolean(fieldErrors.location) || Boolean(mismatch)

  const subcategorySelect = loadingCategories ? (
    <select disabled className={`${INPUT_CLASSES} animate-pulse`} aria-label="Subcategoría">
      <option>Cargando…</option>
    </select>
  ) : (
    <select
      required
      value={subcategoryId}
      onChange={(event) => setSubcategoryId(event.target.value)}
      disabled={!categoryId}
      className={INPUT_CLASSES}
      aria-label="Subcategoría"
    >
      <option value="">Primero elige una categoría</option>
      {selectedCategory?.subcategories.map((subcategory) => (
        <option key={subcategory.id} value={subcategory.id}>
          {subcategory.name}
        </option>
      ))}
    </select>
  )

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-8">
      {/* Bloque 1 · Datos del incidente */}
      <section aria-labelledby="block-data" className="space-y-6">
        <h2 id="block-data" className={BLOCK_HEADING_CLASSES}>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-marine-950 text-[11px] font-bold text-white">1</span>
          Datos del incidente
        </h2>

        <div ref={titleRef}>
          <label htmlFor="complaint-title" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Título <span className="text-state-danger" aria-hidden="true">*</span>
          </label>
          <input
            id="complaint-title"
            type="text"
            value={title}
            maxLength={180}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ej. Bache profundo en Av. Ballivián"
            className={`w-full border-0 border-b-2 bg-transparent px-0 py-2 text-xl font-semibold text-ink placeholder:font-normal placeholder:text-slate-400 focus:border-marine-700 focus:outline-none focus:ring-0 sm:text-2xl ${
              fieldErrors.title ? 'border-state-danger' : 'border-slate-300'
            }`}
            aria-invalid={Boolean(fieldErrors.title)}
          />
          <div className="mt-1 flex justify-between">
            {fieldErrors.title ? <p className={ERROR_CLASSES}>{fieldErrors.title}</p> : <span />}
            <p className="text-[11px] text-ink-soft">{title.length}/180</p>
          </div>
        </div>

        <div ref={descriptionRef}>
          <label htmlFor="complaint-description" className="mb-1.5 block text-sm font-semibold text-ink">
            Descripción <span className="text-state-danger" aria-hidden="true">*</span>
          </label>
          <textarea
            id="complaint-description"
            rows={5}
            value={description}
            maxLength={5000}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Describe el problema y cualquier referencia visual útil."
            className={INPUT_CLASSES}
            aria-invalid={Boolean(fieldErrors.description)}
          />
          <div className="mt-1 flex justify-between">
            {fieldErrors.description ? (
              <p className={ERROR_CLASSES}>{fieldErrors.description}</p>
            ) : (
              <span />
            )}
            <p className="text-[11px] text-ink-soft">{description.length}/5000</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div ref={categoryRef}>
            <label htmlFor="complaint-category" className="mb-1.5 block text-sm font-semibold text-ink">
              Categoría <span className="text-state-danger" aria-hidden="true">*</span>
            </label>
            {loadingCategories ? (
              <select disabled className={`${INPUT_CLASSES} animate-pulse`} aria-label="Categoría">
                <option>Cargando…</option>
              </select>
            ) : (
              <select
                id="complaint-category"
                required
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value)
                  setSubcategoryId('')
                }}
                className={INPUT_CLASSES}
              >
                <option value="">Selecciona una categoría</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            )}
            {fieldErrors.categoryId && <p className={ERROR_CLASSES}>{fieldErrors.categoryId}</p>}
          </div>

          <div ref={subcategoryRef}>
            <label htmlFor="complaint-subcategory" className="mb-1.5 block text-sm font-semibold text-ink">
              Subcategoría <span className="text-state-danger" aria-hidden="true">*</span>
            </label>
            {subcategorySelect}
            {fieldErrors.subcategoryId && (
              <p className={ERROR_CLASSES}>{fieldErrors.subcategoryId}</p>
            )}
          </div>
        </div>
      </section>

      {/* Bloque 2 · Evidencias (slot de la pagina; se omite en edicion) */}
      {evidenceSlot && (
        <section aria-labelledby="block-evidence" className="space-y-5">
          <h2 id="block-evidence" className={BLOCK_HEADING_CLASSES}>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-marine-950 text-[11px] font-bold text-white">2</span>
            Evidencias
          </h2>
          {evidenceSlot}
        </section>
      )}

      {/* Bloque 3 · Ubicacion del incidente (al final, antes de la accion) */}
      <section aria-labelledby="block-location" className="space-y-4">
        <h2 id="block-location" className={BLOCK_HEADING_CLASSES}>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-marine-950 text-[11px] font-bold text-white">3</span>
          Ubicación del incidente <span className="text-state-danger" aria-hidden="true">*</span>
        </h2>

        <fieldset
          ref={locationRef}
          className={`rounded-xl border p-4 transition-colors ${
            locationIssue ? 'border-state-danger/60 bg-state-danger/5' : 'border-slate-200'
          }`}
        >
          <Suspense
            fallback={
              <div className="h-64 w-full animate-pulse rounded-xl bg-slate-200/70 sm:h-72" aria-hidden="true" />
            }
          >
            <LocationPicker value={location} onChange={handleLocationChange} />
          </Suspense>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="complaint-coords" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                Coordenadas <span className="text-state-danger" aria-hidden="true">*</span>
              </label>
              <input
                id="complaint-coords"
                type="text"
                readOnly
                value={location ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : ''}
                placeholder="-17.39358, -66.14521"
                className={`w-full rounded-lg border px-3 py-2.5 font-mono text-xs text-ink placeholder:text-slate-400 focus:outline-none ${
                  locationIssue ? 'border-state-danger bg-white' : 'border-slate-200 bg-surface'
                }`}
              />
              <p className="mt-1 text-[10px] text-ink-soft">
                Límite provincial: Lat {CERCADO_BOUNDS.south} a {CERCADO_BOUNDS.north} · Lng{' '}
                {CERCADO_BOUNDS.west} a {CERCADO_BOUNDS.east}
              </p>
            </div>
            <div>
              <label htmlFor="complaint-pluscode" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                Plus Code <span className="text-state-danger" aria-hidden="true">*</span>
              </label>
              <input
                id="complaint-pluscode"
                type="text"
                readOnly
                value={plusCode ?? ''}
                placeholder="85FC4843+3M"
                className={`w-full rounded-lg border px-3 py-2.5 font-mono text-xs tracking-wide text-ink placeholder:text-slate-400 focus:outline-none ${
                  locationIssue ? 'border-state-danger bg-white' : 'border-slate-200 bg-surface'
                }`}
              />
              <p className="mt-1 text-[10px] text-ink-soft">
                Código de ubicación global derivado de tus coordenadas.
              </p>
            </div>
          </div>

          {fieldErrors.location && <p className={`${ERROR_CLASSES} mt-3`}>{fieldErrors.location}</p>}

          {mismatch && (
            <div
              role="alert"
              className="mt-3 rounded-lg bg-state-danger/10 px-3 py-2.5 text-xs leading-relaxed text-state-danger ring-1 ring-state-danger/40"
            >
              <p className="font-bold">Las coordenadas no coinciden con el Plus Code.</p>
              <p className="mt-1">{mismatch.message}</p>
              {mismatch.suggestedPlusCode && (
                <p className="mt-1">
                  Plus Code sugerido para tus coordenadas:{' '}
                  <span className="font-mono font-bold">{mismatch.suggestedPlusCode}</span>. Mueve el
                  pin (o usa «Obtener mi ubicación») y vuelve a intentar: el envío permanece
                  bloqueado hasta que coincidan.
                </p>
              )}
            </div>
          )}
        </fieldset>
      </section>

      {/* Bloque 4 · Accion final */}
      <section aria-label="Acción" className="flex flex-col items-center gap-3 border-t border-slate-200 pt-5">
        <button
          type="submit"
          disabled={submitting || Boolean(mismatch)}
          title={mismatch ? 'Corrige la ubicación antes de enviar.' : undefined}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-marine-700 px-6 py-3.5 text-sm font-bold text-white shadow-md transition-colors hover:bg-marine-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-950 disabled:cursor-not-allowed disabled:opacity-60 sm:w-80"
        >
          {submitting ? 'Enviando…' : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="text-sm font-semibold text-ink-soft underline underline-offset-4 transition-colors hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-700 disabled:opacity-60"
          >
            Cancelar edición
          </button>
        )}
      </section>
    </form>
  )
}
