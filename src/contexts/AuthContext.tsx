'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import type { Usuario } from '@/types/database'

interface AuthContextType {
  usuario: Usuario | null
  loading: boolean
  isAdmin: boolean
  hasAccessTo: (modulo: string) => boolean
  logout: () => Promise<void>
  refetch: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  usuario: null,
  loading: true,
  isAdmin: false,
  hasAccessTo: () => false,
  logout: async () => {},
  refetch: async () => {},
})

const ADMIN_ONLY = new Set(['facturacion', 'configuracion', 'usuarios', 'eliminar', 'importar'])

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const json = await res.json()
        if (json.ok) {
          // SaaS-managed: si el panel suspendió el servicio mientras el PAS
          // tenía sesión abierta, /me lo reporta y forzamos redirect. En
          // APPLIANCE `servicio.estado` es siempre ACTIVO y este branch no se
          // ejecuta.
          if (json.servicio?.estado === 'SUSPENDIDO') {
            setUsuario(null)
            if (typeof window !== 'undefined' && window.location.pathname !== '/suspendido') {
              window.location.href = '/suspendido'
            }
            return
          }
          setUsuario(json.usuario)
          return
        }
      }
      // 401/sesión inválida: si estamos dentro del CRM, limpiar la sesión
      // (vía logout que también limpia cookies del lado del server) y redirigir
      // a /login. Esto evita que el usuario quede con pantalla en blanco si
      // tiene cookies viejas o vencidas.
      setUsuario(null)
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/crm')) {
        try { await fetch('/api/auth/logout', { method: 'POST' }) } catch { /* ignore */ }
        const volver = encodeURIComponent(window.location.pathname + window.location.search)
        window.location.href = `/login?volver=${volver}&motivo=sesion_expirada`
      }
    } catch {
      setUsuario(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  const isAdmin = usuario?.rol === 'ADMIN'

  const hasAccessTo = useCallback((modulo: string): boolean => {
    if (!usuario) return false
    if (usuario.rol === 'ADMIN') return true
    return !ADMIN_ONLY.has(modulo)
  }, [usuario])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUsuario(null)
    window.location.href = '/login'
  }, [])

  return (
    <AuthContext.Provider value={{ usuario, loading, isAdmin, hasAccessTo, logout, refetch: fetchUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
