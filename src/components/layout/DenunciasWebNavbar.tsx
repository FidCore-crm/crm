'use client'

/**
 * Ícono "Siren" en el navbar al lado de la campana + del Inbox verde.
 * Muestra solo las notificaciones tipo SINIESTRO_DENUNCIA_PUBLICA — el resto
 * queda en la campana general. Self-contained: estado, Realtime y broadcast
 * propios.
 *
 * Filtro de cartera: el endpoint `/api/notificaciones` ya aplica el filtro
 * según rol/acceso_cartera. Un usuario PROPIA solo ve las suyas + globales;
 * admin y TOTAL ven todas. Ver navbar.tsx para el patrón espejo.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Siren, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { getSupabaseClient } from '@/lib/supabase/client'
import { apiCall } from '@/lib/api-client'
import { emitirBroadcastDenunciasWeb, useBroadcastDenunciasWeb } from '@/lib/broadcast-denuncias-web'
import { logger } from '@/lib/errores/logger'

interface Denuncia {
  id: string
  tipo: string
  prioridad: string
  titulo: string
  mensaje: string
  url: string | null
  leida: boolean
  created_at: string
}

interface ContadoresDenuncias {
  total_no_leidas: number
  criticas: number
  advertencias: number
  informativas: number
}

function tiempoRelativo(fechaStr: string): string {
  const ahora = Date.now()
  const fecha = new Date(fechaStr).getTime()
  const diff = ahora - fecha
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `Hace ${mins < 1 ? 1 : mins} min`
  const horas = Math.floor(mins / 60)
  if (horas < 24) return `Hace ${horas}h`
  const dias = Math.floor(horas / 24)
  if (dias < 7) return `Hace ${dias}d`
  const [y, m, d] = fechaStr.split('T')[0].split('-')
  return `${d}/${m}/${y}`
}

const TIPO = 'SINIESTRO_DENUNCIA_PUBLICA'

export function DenunciasWebNavbar() {
  const router = useRouter()
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  const [contadores, setContadores] = useState<ContadoresDenuncias>({
    total_no_leidas: 0,
    criticas: 0,
    advertencias: 0,
    informativas: 0,
  })
  const [denuncias, setDenuncias] = useState<Denuncia[]>([])
  const [abierto, setAbierto] = useState(false)
  const [cargando, setCargando] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const abiertoRef = useRef(false)
  useEffect(() => { abiertoRef.current = abierto }, [abierto])

  const cargarContadores = useCallback(async () => {
    try {
      const res = await fetch(`/api/notificaciones?leida=false&tipo=${TIPO}&limite=1`)
      const json = await res.json()
      if (json.ok && json.resumen) setContadores(json.resumen)
    } catch (err) {
      logger.warn({
        modulo: 'denuncias-web',
        mensaje: 'cargarContadores falló',
        contexto: { error: String(err) },
      })
    }
  }, [])

  const cargarDenuncias = useCallback(async () => {
    setCargando(true)
    try {
      const res = await fetch(`/api/notificaciones?tipo=${TIPO}&limite=15`)
      const json = await res.json()
      if (json.ok) {
        setDenuncias(json.data ?? [])
        if (json.resumen) setContadores(json.resumen)
      }
    } catch (err) {
      logger.warn({
        modulo: 'denuncias-web',
        mensaje: 'cargarDenuncias falló',
        contexto: { error: String(err) },
      })
    }
    setCargando(false)
  }, [])

  // Realtime + carga inicial + focus
  useEffect(() => {
    if (!usuario) return
    cargarContadores()

    const onFocus = () => cargarContadores()
    window.addEventListener('focus', onFocus)

    const handler = () => {
      cargarContadores()
      if (abiertoRef.current) cargarDenuncias()
    }

    const canalUsuario = supabase
      .channel(`denuncias-web-user-${usuario.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notificaciones',
          filter: `usuario_id=eq.${usuario.id}`,
        },
        handler,
      )
      .subscribe()

    const canalGlobal = supabase
      .channel('denuncias-web-global')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notificaciones',
          filter: 'usuario_id=is.null',
        },
        handler,
      )
      .subscribe()

    return () => {
      window.removeEventListener('focus', onFocus)
      supabase.removeChannel(canalUsuario)
      supabase.removeChannel(canalGlobal)
    }
  }, [usuario, cargarContadores, cargarDenuncias, supabase])

  // Cross-tab
  useBroadcastDenunciasWeb(useCallback(() => {
    cargarContadores()
    if (abiertoRef.current) cargarDenuncias()
  }, [cargarContadores, cargarDenuncias]))

  // Click outside
  useEffect(() => {
    if (!abierto) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setAbierto(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [abierto])

  const togglePanel = () => {
    const abriendo = !abierto
    setAbierto(abriendo)
    if (abriendo) cargarDenuncias()
  }

  const marcarTodasLeidas = async () => {
    // Solo IDs visibles de este tipo, para no afectar campana ni Inbox.
    const ids = denuncias.filter((d) => !d.leida).map((d) => d.id)
    if (ids.length === 0) return
    await apiCall('/api/notificaciones', { method: 'PATCH', body: { ids } }, { mostrar_toast_en_error: false })
    cargarDenuncias()
    cargarContadores()
    emitirBroadcastDenunciasWeb({ tipo: 'todas-leidas' })
  }

  const clickDenuncia = async (d: Denuncia) => {
    if (!d.leida) {
      await apiCall('/api/notificaciones', { method: 'PATCH', body: { ids: [d.id] } }, { mostrar_toast_en_error: false })
      emitirBroadcastDenunciasWeb({ tipo: 'marcada-leida', id: d.id })
    }
    setAbierto(false)
    cargarContadores()
    if (d.url) router.push(d.url)
  }

  if (!usuario) return null

  const hayCriticas = contadores.criticas > 0

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={togglePanel}
        aria-label="Denuncias recibidas por el asegurado"
        className="relative flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
      >
        <Siren className={`h-4 w-4 ${hayCriticas ? 'text-red-600' : ''}`} />
        {contadores.total_no_leidas > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 flex items-center justify-center h-3.5 min-w-3.5 px-0.5 rounded-full bg-red-500 text-white text-2xs font-bold leading-none ${hayCriticas ? 'animate-pulse' : ''}`}
          >
            {contadores.total_no_leidas > 99 ? '99+' : contadores.total_no_leidas}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 top-full mt-1 w-[400px] bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50">
            <div className="flex items-center gap-2">
              <Siren className="h-4 w-4 text-red-500" />
              <span className="text-sm font-semibold text-slate-700">Denuncias recibidas</span>
              {contadores.total_no_leidas > 0 && (
                <span className="text-xs text-slate-500">({contadores.total_no_leidas} nuevas)</span>
              )}
            </div>
            {contadores.total_no_leidas > 0 && (
              <button
                type="button"
                onClick={marcarTodasLeidas}
                className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
              >
                Marcar todas como leídas
              </button>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {cargando && (
              <div className="flex items-center justify-center py-8 text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}
            {!cargando && denuncias.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                No hay denuncias recibidas por el asegurado.
                <div className="mt-1 text-xs text-slate-400">
                  Cuando un cliente cargue una denuncia por el formulario o
                  desde el portal, aparecerá acá.
                </div>
              </div>
            )}
            {!cargando && denuncias.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => clickDenuncia(d)}
                className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors ${!d.leida ? 'bg-red-50/40' : ''}`}
              >
                <div className="flex items-start gap-2">
                  <Siren className={`h-4 w-4 mt-0.5 flex-shrink-0 ${!d.leida ? 'text-red-600' : 'text-slate-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className={`text-sm truncate ${!d.leida ? 'font-semibold text-slate-800' : 'text-slate-700'}`}>
                        {d.titulo}
                      </div>
                      <div className="text-2xs text-slate-400 flex-shrink-0">{tiempoRelativo(d.created_at)}</div>
                    </div>
                    {d.mensaje && (
                      <div className="text-xs text-slate-600 mt-0.5 line-clamp-2">{d.mensaje}</div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {denuncias.length > 0 && (
            <div className="px-4 py-2 border-t border-slate-100 bg-slate-50">
              <button
                type="button"
                onClick={() => { setAbierto(false); router.push('/crm/siniestros?denuncias_pendientes=1') }}
                className="w-full text-xs text-blue-600 hover:text-blue-700 hover:underline"
              >
                Ver denuncias pendientes →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
