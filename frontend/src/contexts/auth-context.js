import { createContext } from 'react'

/**
 * Contexto global de sesion. Vive en un archivo separado del provider para
 * mantener el fast-refresh limpio (regla only-export-components).
 */
export const AuthContext = createContext(null)
