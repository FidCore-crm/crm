'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Loader2, CheckCircle, Bell,
  FileX, ClipboardX, AlertTriangle, AlertOctagon,
  FileQuestion, Clock, Target, CalendarClock, CalendarX
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import type { ConfiguracionNotificacion } from '@/types/database'

type TipoNotif = ConfiguracionNotificacion['tipo']

interface TipoConfig {
  tipo: TipoNotif
  icon: any
  iconColor: string
  titulo: string
  descripcion: string
  prioridad: 'CRÍTICA' | 'ADVERTENCIA'
  prioridadColor: string
  tieneUmbral: boolean
  umbralLabel?: string
}

const TIPOS: TipoConfig[] = [
  {
    tipo: 'POLIZA_VENCIDA',
    icon: FileX,
    iconColor: 'text-red-500',
    titulo: 'Póliza vencida sin renovar',
    descripcion: 'Alerta cuando una póliza pasa a NO VIGENTE y no tiene renovación creada',
    prioridad: 'CRÍTICA',
    prioridadColor: 'bg-red-100 text-red-700 border-red-200',
    tieneUmbral: false,
  },
  {
    tipo: 'TAREA_HOY',
    icon: CalendarClock,
    iconColor: 'text-blue-500',
    titulo: 'Tarea para hoy',
    descripcion: 'Aviso proactivo el mismo día que una tarea vence (antes solo llegaba la notificación cuando el día ya pasó).',
    prioridad: 'ADVERTENCIA',
    prioridadColor: 'bg-amber-100 text-amber-700 border-amber-200',
    tieneUmbral: false,
  },
  {
    tipo: 'TAREA_VENCIDA',
    icon: ClipboardX,
    iconColor: 'text-orange-500',
    titulo: 'Tarea vencida sin completar',
    descripcion: 'Alerta cuando una tarea pasa su fecha de vencimiento sin ser completada',
    prioridad: 'ADVERTENCIA',
    prioridadColor: 'bg-amber-100 text-amber-700 border-amber-200',
    tieneUmbral: false,
  },
  {
    tipo: 'SINIESTRO_30_DIAS',
    icon: AlertTriangle,
    iconColor: 'text-amber-500',
    titulo: 'Siniestro abierto demasiado tiempo',
    descripcion: 'Alerta cuando un siniestro lleva abierto más de X días',
    prioridad: 'ADVERTENCIA',
    prioridadColor: 'bg-amber-100 text-amber-700 border-amber-200',
    tieneUmbral: true,
    umbralLabel: 'Alertar después de',
  },
  {
    tipo: 'SINIESTRO_60_DIAS',
    icon: AlertOctagon,
    iconColor: 'text-red-500',
    titulo: 'Siniestro abierto demasiado tiempo (crítico)',
    descripcion: 'Alerta crítica cuando un siniestro lleva abierto más de X días',
    prioridad: 'CRÍTICA',
    prioridadColor: 'bg-red-100 text-red-700 border-red-200',
    tieneUmbral: true,
    umbralLabel: 'Alertar después de',
  },
  {
    tipo: 'COTIZACION_SIN_RESPUESTA',
    icon: FileQuestion,
    iconColor: 'text-blue-500',
    titulo: 'Cotización enviada sin respuesta',
    descripcion: 'Alerta cuando una cotización fue enviada y no tuvo respuesta en X días',
    prioridad: 'ADVERTENCIA',
    prioridadColor: 'bg-amber-100 text-amber-700 border-amber-200',
    tieneUmbral: true,
    umbralLabel: 'Alertar después de',
  },
  {
    tipo: 'COTIZACION_SIN_SEGUIMIENTO',
    icon: Clock,
    iconColor: 'text-blue-500',
    titulo: 'Cotización en proceso sin seguimiento',
    descripcion: 'Alerta cuando una cotización está en proceso y no tuvo actividad en X días',
    prioridad: 'ADVERTENCIA',
    prioridadColor: 'bg-amber-100 text-amber-700 border-amber-200',
    tieneUmbral: true,
    umbralLabel: 'Alertar después de',
  },
  {
    tipo: 'COTIZACION_VENCIENDO_PRONTO',
    icon: CalendarClock,
    iconColor: 'text-amber-500',
    titulo: 'Cotización por vencer pronto',
    descripcion: 'Alerta cuando una cotización ENVIADA o EN_PROCESO se acerca a su fecha de vencimiento (X días antes)',
    prioridad: 'ADVERTENCIA',
    prioridadColor: 'bg-amber-100 text-amber-700 border-amber-200',
    tieneUmbral: true,
    umbralLabel: 'Avisar X días antes',
  },
  {
    tipo: 'COTIZACION_VENCIDA',
    icon: CalendarX,
    iconColor: 'text-red-500',
    titulo: 'Cotización vencida',
    descripcion: 'Alerta cuando una cotización ENVIADA o EN_PROCESO supera su fecha de vencimiento sin haberse cerrado',
    prioridad: 'ADVERTENCIA',
    prioridadColor: 'bg-amber-100 text-amber-700 border-amber-200',
    tieneUmbral: false,
  },
  {
    tipo: 'OPORTUNIDAD_ESTANCADA',
    icon: Target,
    iconColor: 'text-violet-500',
    titulo: 'Oportunidad estancada',
    descripcion: 'Alerta cuando una oportunidad lleva más de X días sin movimiento o se pasó la fecha de próximo contacto',
    prioridad: 'ADVERTENCIA',
    prioridadColor: 'bg-amber-100 text-amber-700 border-amber-200',
    tieneUmbral: true,
    umbralLabel: 'Alertar después de',
  },
]

export default function NotificacionesConfigPage() {
  const router = useRouter()
  const supabase = getSupabaseClient()
  const { isAdmin, loading: authLoading } = useAuth()

  useEffect(() => {
    if (!authLoading && !isAdmin) router.replace('/crm/dashboard')
  }, [authLoading, isAdmin, router])

  const [cargando, setCargando] = useState(true)
  const [switchGeneral, setSwitchGeneral] = useState(true)
  const [configs, setConfigs] = useState<Map<TipoNotif, ConfiguracionNotificacion>>(new Map())
  const [guardados, setGuardados] = useState<Map<string, boolean>>(new Map())
  const [errores, setErrores] = useState<Map<string, string>>(new Map())

  // Debounce timers
  const timers = useRef<Map<string, NodeJS.Timeout>>(new Map())

  // ── Cargar datos ──
  useEffect(() => {
    async function cargar() {
      const [{ data: configGeneral }, { data: configNotifs }] = await Promise.all([
        supabase.from('configuracion').select('notificaciones_activas').limit(1).single(),
        supabase.from('configuracion_notificaciones').select('*'),
      ])

      if (configGeneral) {
        setSwitchGeneral(configGeneral.notificaciones_activas ?? true)
      }

      if (configNotifs) {
        const mapa = new Map<TipoNotif, ConfiguracionNotificacion>()
        for (const c of configNotifs as any[]) {
          mapa.set(c.tipo as TipoNotif, c as ConfiguracionNotificacion)
        }
        setConfigs(mapa)
      }

      setCargando(false)
    }
    cargar()
  }, [supabase])

  // ── Feedback visual ──
  const mostrarGuardado = useCallback((key: string) => {
    setGuardados(prev => { const n = new Map(prev); n.set(key, true); return n })
    setTimeout(() => {
      setGuardados(prev => { const n = new Map(prev); n.delete(key); return n })
    }, 2000)
  }, [])

  const setError = useCallback((key: string, msg: string) => {
    setErrores(prev => { const n = new Map(prev); n.set(key, msg); return n })
  }, [])

  const clearError = useCallback((key: string) => {
    setErrores(prev => { const n = new Map(prev); n.delete(key); return n })
  }, [])

  // ── Switch general ──
  const toggleGeneral = async (valor: boolean) => {
    setSwitchGeneral(valor)
    const { error } = await supabase
      .from('configuracion')
      .update({ notificaciones_activas: valor })
      .not('id', 'is', null)
    if (!error) mostrarGuardado('general')
  }

  // ── Toggle tipo individual ──
  const toggleTipo = async (tipo: TipoNotif, valor: boolean) => {
    setConfigs(prev => {
      const n = new Map(prev)
      const existing = n.get(tipo)
      if (existing) n.set(tipo, { ...existing, activa: valor })
      return n
    })

    const { error } = await supabase
      .from('configuracion_notificaciones')
      .update({ activa: valor })
      .eq('tipo', tipo)
    if (!error) mostrarGuardado(tipo)
  }

  // ── Cambiar umbral con debounce ──
  const cambiarUmbral = (tipo: TipoNotif, valor: number) => {
    clearError(`${tipo}_umbral`)

    // Validación cruzada siniestros
    if (tipo === 'SINIESTRO_60_DIAS') {
      const umbral30 = configs.get('SINIESTRO_30_DIAS')?.umbral_dias ?? 30
      if (valor <= umbral30) {
        setError(`${tipo}_umbral`, `Este umbral debe ser mayor que el de la advertencia (${umbral30} días)`)
        // Actualizar UI pero no guardar
        setConfigs(prev => {
          const n = new Map(prev)
          const existing = n.get(tipo)
          if (existing) n.set(tipo, { ...existing, umbral_dias: valor })
          return n
        })
        return
      }
    }
    if (tipo === 'SINIESTRO_30_DIAS') {
      const umbral60 = configs.get('SINIESTRO_60_DIAS')?.umbral_dias ?? 60
      if (valor >= umbral60) {
        setError(`${tipo}_umbral`, `Este umbral debe ser menor que el de la alerta crítica (${umbral60} días)`)
        setConfigs(prev => {
          const n = new Map(prev)
          const existing = n.get(tipo)
          if (existing) n.set(tipo, { ...existing, umbral_dias: valor })
          return n
        })
        return
      }
    }

    setConfigs(prev => {
      const n = new Map(prev)
      const existing = n.get(tipo)
      if (existing) n.set(tipo, { ...existing, umbral_dias: valor })
      return n
    })

    const timerKey = `${tipo}_umbral`
    const existing = timers.current.get(timerKey)
    if (existing) clearTimeout(existing)

    timers.current.set(timerKey, setTimeout(async () => {
      if (valor < 1 || valor > 365) return
      const { error } = await supabase
        .from('configuracion_notificaciones')
        .update({ umbral_dias: valor })
        .eq('tipo', tipo)
      if (!error) mostrarGuardado(timerKey)
    }, 500))
  }

  // ── Cambiar antispam con debounce ──
  const cambiarAntispam = (tipo: TipoNotif, valor: number) => {
    setConfigs(prev => {
      const n = new Map(prev)
      const existing = n.get(tipo)
      if (existing) n.set(tipo, { ...existing, antispam_dias: valor })
      return n
    })

    const timerKey = `${tipo}_antispam`
    const existing = timers.current.get(timerKey)
    if (existing) clearTimeout(existing)

    timers.current.set(timerKey, setTimeout(async () => {
      if (valor < 1 || valor > 30) return
      const { error } = await supabase
        .from('configuracion_notificaciones')
        .update({ antispam_dias: valor })
        .eq('tipo', tipo)
      if (!error) mostrarGuardado(timerKey)
    }, 500))
  }

  if (cargando) return (
    <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
      <Loader2 className="h-4 w-4 animate-spin" /> Cargando configuración...
    </div>
  )

  return (
    <div className="flex flex-col gap-4 max-w-6xl">

      {/* Header */}
      <div className="flex items-center gap-2">
        <button onClick={() => router.push('/crm/configuracion')} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center" title="Volver">
          <ArrowLeft className="h-3 w-3" />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Configuración de notificaciones</h1>
          <p className="text-xs text-slate-500">Configurá qué alertas genera el sistema, cada cuánto tiempo y con qué frecuencia se repiten.</p>
        </div>
      </div>

      {/* Switch general */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-blue-50 shrink-0">
              <Bell className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-slate-800">Sistema de notificaciones</h3>
              <p className="text-xs text-slate-500">Activar o desactivar todas las notificaciones automáticas del sistema</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {guardados.has('general') && (
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
            )}
            <button
              onClick={() => toggleGeneral(!switchGeneral)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                switchGeneral ? 'bg-blue-600' : 'bg-slate-300'
              }`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                switchGeneral ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`} />
            </button>
          </div>
        </div>
        {!switchGeneral && (
          <div className="px-4 pb-3">
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Las notificaciones automáticas están desactivadas. No se generarán alertas.
            </p>
          </div>
        )}
      </div>

      {/* Configuración por tipo */}
      <div className={`flex flex-col gap-3 transition-opacity ${!switchGeneral ? 'opacity-50 pointer-events-none' : ''}`}>
        {TIPOS.map(tc => {
          const config = configs.get(tc.tipo)
          const activa = config?.activa ?? true
          const umbral = config?.umbral_dias ?? null
          const antispam = config?.antispam_dias ?? 3
          const Icon = tc.icon

          return (
            <div key={tc.tipo} className={`bg-white border border-slate-200 rounded overflow-hidden transition-opacity ${!activa ? 'opacity-50' : ''}`}>
              <div className="p-4">
                {/* Top row: icon + title + switch */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-slate-50 shrink-0">
                      <Icon className={`h-4 w-4 ${tc.iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-slate-800">{tc.titulo}</h3>
                        <span className={`text-2xs font-medium px-1.5 py-0.5 rounded border ${tc.prioridadColor}`}>
                          {tc.prioridad}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{tc.descripcion}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {guardados.has(tc.tipo) && (
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                    )}
                    <button
                      onClick={() => toggleTipo(tc.tipo, !activa)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        activa ? 'bg-blue-600' : 'bg-slate-300'
                      }`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                        activa ? 'translate-x-[18px]' : 'translate-x-[3px]'
                      }`} />
                    </button>
                  </div>
                </div>

                {/* Bottom row: umbral + antispam */}
                <div className="flex items-center gap-4 mt-3 ml-11">
                  {/* Umbral */}
                  <div className="flex items-center gap-2">
                    {tc.tieneUmbral ? (
                      <>
                        <label className="text-xs text-slate-500 whitespace-nowrap">{tc.umbralLabel}</label>
                        <input
                          type="number"
                          min={1}
                          max={365}
                          disabled={!activa}
                          value={umbral ?? ''}
                          onChange={e => {
                            const v = parseInt(e.target.value)
                            if (!isNaN(v)) cambiarUmbral(tc.tipo, v)
                          }}
                          className="form-input w-16 text-center font-mono"
                        />
                        <span className="text-xs text-slate-500">días</span>
                        {guardados.has(`${tc.tipo}_umbral`) && (
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">Al vencer</span>
                    )}
                  </div>

                  <div className="h-4 w-px bg-slate-200" />

                  {/* Anti-spam */}
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-500 whitespace-nowrap">No repetir en</label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      disabled={!activa}
                      value={antispam}
                      onChange={e => {
                        const v = parseInt(e.target.value)
                        if (!isNaN(v)) cambiarAntispam(tc.tipo, v)
                      }}
                      className="form-input w-16 text-center font-mono"
                    />
                    <span className="text-xs text-slate-500">días</span>
                    {guardados.has(`${tc.tipo}_antispam`) && (
                      <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                    )}
                  </div>
                </div>

                {/* Error de validación */}
                {errores.has(`${tc.tipo}_umbral`) && (
                  <p className="text-xs text-red-600 mt-2 ml-11">{errores.get(`${tc.tipo}_umbral`)}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
