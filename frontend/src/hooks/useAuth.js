import { useContext } from 'react'
import { AuthContext } from '../contexts/auth-context.js'

/**
 * Hook de acceso al contexto de sesion.
 * (Separado del archivo del provider para mantener el fast-refresh limpio.)
 */
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth debe usarse dentro de AuthProvider')
  }
  return context
}
