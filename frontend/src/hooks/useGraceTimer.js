import { useEffect, useState } from 'react'

/**
 * Contador en vivo de la ventana de gracia (tiempo efectivo del servidor).
 *
 * - RUNNING: cuenta atras local desde remainingSeconds (ajuste con el reloj
 *   del cliente; el servidor sigue siendo la fuente de verdad en cada
 *   refresco). Al llegar a 0 dispara onExpire (que refresca la denuncia y
 *   confirma la formalizacion perezosa del backend).
 * - PAUSED_FOR_EDIT: congelado; devuelve el valor persistido.
 *
 * El componente que lo usa debe re-montarse con key al refrescar los datos
 * del servidor para que el contador se resincronice.
 */
export function useGraceTimer({ remainingSeconds, state, onExpire }) {
  const [left, setLeft] = useState(remainingSeconds)

  useEffect(() => {
    if (state !== 'RUNNING' || remainingSeconds <= 0) return undefined

    const deadline = Date.now() + remainingSeconds * 1000
    const intervalId = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setLeft(remaining)
      if (remaining <= 0) {
        clearInterval(intervalId)
        onExpire?.()
      }
    }, 250)

    return () => clearInterval(intervalId)
  }, [state, remainingSeconds, onExpire])

  if (state !== 'RUNNING') return remainingSeconds
  return left
}
