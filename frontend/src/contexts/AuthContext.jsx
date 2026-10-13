import { useCallback, useEffect, useMemo, useState } from 'react'
import { API_URL, apiErrorMessage, apiFetch } from '../lib/api.js'
import { AuthContext } from './auth-context.js'

/**
 * Contexto global de sesion (Fase 7 - Parte 1).
 *
 * - Al montar consulta GET /api/v1/auth/me y mantiene el usuario
 *   (id, userType, alias, requiresAlias, roles, adminLocked, suspended).
 * - Si es ciudadano, consulta ademas /citizens/me para el perfil
 *   (alias y codigo administrativo) usado por el menu lateral.
 * - loginWithGoogle: comprueba primero el endpoint OAuth con redirect manual;
 *   si el backend responde 503 (credenciales de Google sin configurar)
 *   muestra un mensaje amable, y si hay redireccion inicia la navegacion real.
 * - logout: POST /auth/logout y limpieza de estado.
 */
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(null)

  const refresh = useCallback(async () => {
    // Todo el ajuste de estado ocurre tras los await: nada de setState
    // sincrono dentro del efecto de montaje.
    const me = await apiFetch('/auth/me')

    if (me.ok) {
      setUser(me.data)
      setProfile(null)
      if (me.data.userType === 'CITIZEN') {
        const citizen = await apiFetch('/citizens/me')
        setProfile(citizen.ok ? citizen.data : null)
      }
    } else {
      setUser(null)
      setProfile(null)
    }

    setLoading(false)
    return me.ok ? me.data : null
  }, [])

  // Carga inicial de sesion: sincroniza React con el backend (sistema
  // externo). Los setState ocurren tras los await; la regla
  // set-state-in-effect no distingue asincronia interprocedural.
  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect -- carga inicial de sesion
    void refresh()
  }, [refresh])

  const loginWithGoogle = useCallback(async () => {
    setAuthError(null)
    // redirect: 'manual' evita seguir a Google con fetch (CORS) y permite
    // detectar el 503 OAUTH_NOT_CONFIGURED con un mensaje amable.
    const probe = await apiFetch('/auth/google/login', { redirect: 'manual' })
    if (probe.status === 0 || (probe.status >= 300 && probe.status < 400)) {
      window.location.href = `${API_URL}/auth/google/login`
      return
    }
    setAuthError(apiErrorMessage(probe.data))
  }, [])

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' })
    setUser(null)
    setProfile(null)
  }, [])

  const value = useMemo(
    () => ({ user, profile, loading, authError, setAuthError, loginWithGoogle, logout, refresh }),
    [user, profile, loading, authError, loginWithGoogle, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
