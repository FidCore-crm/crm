'use client'

/**
 * Ícono "Inbox" en el navbar al lado de la campana.
 * Muestra solo las notificaciones de tipo LEAD_WEB_NUEVO — el resto va a la
 * campana general. Self-contained: estado, Realtime y broadcast propios.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Inbox, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { getSupabaseClient } from '@/lib/supabase/client'
import { apiCall } from '@/lib/api-client'
import { emitirBroadcastMensajesWeb, useBroadcastMensajesWeb } from '@/lib/broadcast-mensajes-web'
import { logger } from '@/lib/errores/logger'

interface MensajeWeb {
  id: string
  tipo: string
  prioridad: string
  titulo: string
  mensaje: string
  url: string | null
  leida: boolean
  created_at: string
}

interface ContadoresMensajes {
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

const TIPO = 'LEAD_WEB_NUEVO'

export function MensajesWebNavbar() {
  const router = useRouter()
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  const [contadores, setContadores] = useState<ContadoresMensajes>({
    total_no_leidas: 0,
    criticas: 0,
    advertencias: 0,
    informativas: 0,
  })
  const [mensajes, setMensajes] = useState<MensajeWeb[]>([])
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
        modulo: 'mensajes-web',
        mensaje: 'cargarContadores falló',
        contexto: { error: String(err) },
      })
    }
  }, [])

  const cargarMensajes = useCallback(async () => {
    setCargando(true)
    try {
      const res = await fetch(`/api/notificaciones?tipo=${TIPO}&limite=15`)
      const json = await res.json()
      if (json.ok) {
        setMensajes(json.data ?? [])
        if (json.resumen) setContadores(json.resumen)
      }
    } catch (err) {
      logger.warn({
        modulo: 'mensajes-web',
        mensaje: 'cargarMensajes falló',
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
      if (abiertoRef.current) cargarMensajes()
    }

    const canalUsuario = supabase
      .channel(`mensajes-web-user-${usuario.id}`)
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
      .channel('mensajes-web-global')
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
  }, [usuario, cargarContadores, cargarMensajes, supabase])

  // Cross-tab
  useBroadcastMensajesWeb(useCallback(() => {
    cargarContadores()
    if (abiertoRef.current) cargarMensajes()
  }, [cargarContadores, cargarMensajes]))

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
    if (abriendo) cargarMensajes()
  }

  const marcarTodasLeidas = async () => {
    // Tomamos solo los IDs visibles del tipo LEAD_WEB_NUEVO para no tocar las
    // notificaciones de la campana general.
    const ids = mensajes.filter((m) => !m.leida).map((m) => m.id)
    if (ids.length === 0) return
    await apiCall('/api/notificaciones', { method: 'PATCH', body: { ids } }, { mostrar_toast_en_error: false })
    cargarMensajes()
    cargarContadores()
    emitirBroadcastMensajesWeb({ tipo: 'todas-leidas' })
  }

  const clickMensaje = async (m: MensajeWeb) => {
    if (!m.leida) {
      await apiCall('/api/notificaciones', { method: 'PATCH', body: { ids: [m.id] } }, { mostrar_toast_en_error: false })
      emitirBroadcastMensajesWeb({ tipo: 'marcada-leida', id: m.id })
    }
    setAbierto(false)
    cargarContadores()
    if (m.url) router.push(m.url)
  }

  if (!usuario) return null

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={togglePanel}
        aria-label="Mensajes recibidos desde la web"
        className="relative flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
      >
        <Inbox className="h-4 w-4" />
        {contadores.total_no_leidas > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center h-3.5 min-w-3.5 px-0.5 rounded-full bg-emerald-500 text-white text-2xs font-bold leading-none">
            {contadores.total_no_leidas > 99 ? '99+' : contadores.total_no_leidas}
          </span>
        )}
      </button>

      {abierto && (
        <div className="absolute right-0 top-full mt-1 w-[400px] bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-slate-500" />
              <span className="text-sm font-semibold text-slate-700">Mensajes web</span>
              {contadores.total_no_leidas > 0 && (
                <span className="text-xs text-slate-500">({contadores.total_no_leidas} nuevos)</span>
              )}
            </div>
            {contadores.total_no_leidas > 0 && (
              <button
                type="button"
                onClick={marcarTodasLeidas}
                className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
              >
                Marcar todos como leídos
              </button>
            )}
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {cargando && (
              <div className="flex items-center justify-center py-8 text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}
            {!cargando && mensajes.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                Todavía no llegaron mensajes desde la web.
                <div className="mt-1 text-xs text-slate-400">
                  Configurá el formulario en{' '}
                  <button
                    type="button"
                    onClick={() => { setAbierto(false); router.push('/crm/configuracion/leads-web') }}
                    className="text-blue-600 hover:underline"
                  >
                    Configuración › Leads desde web
                  </button>
                </div>
              </div>
            )}
            {!cargando && mensajes.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => clickMensaje(m)}
                className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors ${!m.leida ? 'bg-emerald-50/40' : ''}`}
              >
                <div className="flex items-start gap-2">
                  <Inbox className={`h-4 w-4 mt-0.5 flex-shrink-0 ${!m.leida ? 'text-emerald-600' : 'text-slate-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className={`text-sm truncate ${!m.leida ? 'font-semibold text-slate-800' : 'text-slate-700'}`}>
                        {m.titulo}
                      </div>
                      <div className="text-2xs text-slate-400 flex-shrink-0">{tiempoRelativo(m.created_at)}</div>
                    </div>
                    {m.mensaje && (
                      <div className="text-xs text-slate-600 mt-0.5 line-clamp-2">{m.mensaje}</div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {mensajes.length > 0 && (
            <div className="px-4 py-2 border-t border-slate-100 bg-slate-50">
              <button
                type="button"
                onClick={() => { setAbierto(false); router.push('/crm/comercial/leads?fuente=WEB') }}
                className="w-full text-xs text-blue-600 hover:text-blue-700 hover:underline"
              >
                Ver todos los leads web →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
