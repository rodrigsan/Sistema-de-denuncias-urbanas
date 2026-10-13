import { Link } from 'react-router-dom'
import { FileQuestion } from 'lucide-react'

export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-marine-950 text-white">
        <FileQuestion size={30} aria-hidden="true" />
      </span>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-ink">Página no encontrada</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        La dirección que buscas no existe o fue movida.
      </p>
      <Link
        to="/"
        className="mt-8 inline-flex rounded-lg bg-marine-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-marine-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-marine-950"
      >
        Volver al inicio
      </Link>
    </div>
  )
}
