'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, Edit, Trash2, Loader2, CheckCircle, X,
  Phone, Repeat, Send, Users, Clock,
  Briefcase, AlertTriangle, ClipboardList, User,
  FileText, AlertCircle, MessageCircle
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { formatFechaLocalLarga, hoyLocal, calcularSiguienteFechaRecurrencia } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { useRealtimeRefresh } from '@/lib/hooks/useRealtimeRefresh'

// ── Tipos ────────────────────────────────────────────────────
interface Tarea {
  id: string
  titulo: string
  tipo: string
  descripcion: string | null
  persona_id: string
  poliza_id: string | null
  siniestro_id: string | null
  fecha_vencimiento: string
  hora_vencimiento: string | null
  prioridad: string
  estado: string
  recurrencia: string
  nota_cierre: string | null
  created_at: string
  persona: { id: string; apellido: string; nombre: string | null; razon_social: string | null; whatsapp: string | null; telefono: string | null; email: string | null }
  poliza: { id: string; numero_poliza: string; compania: { nombre: string } | null; ramo: { nombre: string } | null } | null
  siniestro: { id: string; numero_caso: string; estado: string } | null
}

// ── Constantes ───────────────────────────────────────────────
const TIPOS_TAREA: Record<string, { label: string; icon: React.ReactNode }> = {
  LLAMADA_SEGUIMIENTO:    { label: 'Llamada de seguimiento',  icon: <Phone className="h-4 w-4 text-blue-500" /> },
  GESTION_RENOVACION:     { label: 'Gestión de renovación',   icon: <Repeat className="h-4 w-4 text-emerald-500" /> },
  TRAMITE_SINIESTRO:      { label: 'Trámite de siniestro',    icon: <AlertTriangle className="h-4 w-4 text-amber-500" /> },
  GESTION_COBRANZA:       { label: 'Gestión de cobranza',     icon: <Briefcase className="h-4 w-4 text-violet-500" /> },
  ENVIO_DOCUMENTACION:    { label: 'Envío de documentación',  icon: <Send className="h-4 w-4 text-cyan-500" /> },
  REUNION_CLIENTE:        { label: 'Reunión con cliente',     icon: <Users className="h-4 w-4 text-indigo-500" /> },
  ALERTA_VENCIMIENTO:     { label: 'Alerta de vencimiento',   icon: <Clock className="h-4 w-4 text-orange-500" /> },
  TAREA_GENERAL:          { label: 'Tarea general',           icon: <ClipboardList className="h-4 w-4 text-slate-400" /> },
}

function prioridadBadge(p: string) {
  const map: Record<string, { label: string; color: string }> = {
    CRITICA: { label: 'Crítica', color: 'bg-red-50 text-red-700 border-red-200' },
    ALTA:    { label: 'Alta',    color: 'bg-orange-50 text-orange-700 border-orange-200' },
    MEDIA:   { label: 'Media',   color: 'bg-amber-50 text-amber-700 border-amber-200' },
    BAJA:    { label: 'Baja',    color: 'bg-slate-100 text-slate-600 border-slate-200' },
  }
  return map[p] ?? map.BAJA
}

function estadoBadge(e: string) {
  const map: Record<string, { label: string; color: string }> = {
    PENDIENTE:  { label: 'Pendiente',  color: 'bg-blue-50 text-blue-700 border-blue-200' },
    EN_PROCESO: { label: 'En proceso', color: 'bg-amber-50 text-amber-700 border-amber-200' },
    COMPLETADA: { label: 'Completada', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    CANCELADA:  { label: 'Cancelada',  color: 'bg-slate-100 text-slate-600 border-slate-200' },
  }
  return map[e] ?? map.PENDIENTE
}

function recurrenciaLabel(r: string) {
  const map: Record<string, string> = {
    NINGUNA:  'Sin recurrencia',
    DIARIA:   'Diaria',
    SEMANAL:  'Semanal',
    MENSUAL:  'Mensual',
    ANUAL:    'Anual',
  }
  return map[r] ?? r
}

function nombrePersona(p: Tarea['persona']) {
  return [p?.apellido, p?.nombre].filter(Boolean).join(', ') || p?.razon_social || '—'
}

// ── Página ───────────────────────────────────────────────────
export default function FichaTareaPage() {
  const router   = useRouter()
  const params   = useParams()
  const id       = params.id as string
  const supabase = getSupabaseClient()

  const [tarea,    setTarea]    = useState<Tarea | null>(null)
  const [cargando, setCargando] = useState(true)

  // Modal completar
  const [showModal,   setShowModal]   = useState(false)
  const [notaCierre,  setNotaCierre]  = useState('')
  const [completando, setCompletando] = useState(false)

  // silencioso=true evita el flash del spinner cuando el refresh viene de
  // Realtime o de una acción del usuario que ya actualizó los datos.
  const cargar = useCallback(async (silencioso: boolean = false) => {
    if (!silencioso) setCargando(true)
    const { data } = await supabase
      .from('tareas')
      .select(`
        id, titulo, tipo, descripcion, persona_id, poliza_id, siniestro_id,
        fecha_vencimiento, hora_vencimiento, prioridad, estado, recurrencia,
        nota_cierre, created_at,
        persona:personas!tareas_persona_id_fkey (id, apellido, nombre, razon_social, whatsapp, telefono, email),
        poliza:polizas!tareas_poliza_id_fkey (id, numero_poliza, compania:catalogos!compania_id (nombre), ramo:catalogos!ramo_id (nombre)),
        siniestro:siniestros!tareas_siniestro_id_fkey (id, numero_caso, estado)
      `)
      .eq('id', id)
      .single()
    if (data) setTarea(data as unknown as Tarea)
    setCargando(false)
  }, [supabase, id])

  useEffect(() => { cargar() }, [cargar])

  // Realtime: cambios en ESTA tarea se reflejan al instante. Filtrado por id
  // para no re-cargar la ficha ante cambios de otras tareas del sistema.
  useRealtimeRefresh({ tablas: ['tareas'], filter: `id=eq.${id}`, onCambio: () => cargar(true) })

  const completarTarea = async () => {
    if (!tarea) return
    setCompletando(true)
    try {
      const { error } = await supabase.from('tareas').update({
        estado: 'COMPLETADA',
        nota_cierre: notaCierre.trim() || null,
      }).eq('id', tarea.id)
      if (error) throw error

      if (tarea.recurrencia !== 'NINGUNA') {
        const nuevaFecha = calcularSiguienteFechaRecurrencia(tarea.fecha_vencimiento, tarea.recurrencia)
        await supabase.from('tareas').insert({
          titulo:            tarea.titulo,
          tipo:              tarea.tipo,
          descripcion:       tarea.descripcion,
          persona_id:        tarea.persona_id,
          poliza_id:         tarea.poliza_id,
          siniestro_id:      tarea.siniestro_id,
          fecha_vencimiento: nuevaFecha,
          hora_vencimiento:  tarea.hora_vencimiento,
          prioridad:         tarea.prioridad,
          estado:            'PENDIENTE',
          recurrencia:       tarea.recurrencia,
        })
      }

      setShowModal(false)
      setNotaCierre('')
      cargar(true)
    } catch (err: any) {
      toast.error(err?.message ?? 'No se pudo completar la tarea')
    } finally {
      setCompletando(false)
    }
  }

  const eliminarTarea = async () => {
    if (!confirm('¿Eliminar esta tarea?')) return
    const { error } = await supabase.from('tareas').delete().eq('id', id)
    if (!error) router.push('/crm/tareas')
  }

  if (cargando) return (
    <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
      <Loader2 className="h-4 w-4 animate-spin" /> Cargando tarea...
    </div>
  )

  if (!tarea) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <AlertCircle className="h-8 w-8 text-slate-300" />
      <span className="text-slate-400 text-sm">Tarea no encontrada</span>
      <button onClick={() => router.push('/crm/tareas')} className="btn-secondary">
        <ArrowLeft className="h-3 w-3" /> Volver al listado
      </button>
    </div>
  )

  const tipo    = TIPOS_TAREA[tarea.tipo] ?? TIPOS_TAREA.TAREA_GENERAL
  const pBadge  = prioridadBadge(tarea.prioridad)
  const eBadge  = estadoBadge(tarea.estado)
  const hoy     = hoyLocal()
  const vencida = tarea.fecha_vencimiento <= hoy && ['PENDIENTE', 'EN_PROCESO'].includes(tarea.estado)
  const puedeCompletar = ['PENDIENTE', 'EN_PROCESO'].includes(tarea.estado)

  return (
    <div className="flex flex-col gap-3 max-w-5xl">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <button onClick={() => router.push('/crm/tareas')}
            className="btn-secondary h-7 w-7 p-0 flex items-center justify-center mt-0.5"
            title="Volver">
            <ArrowLeft className="h-3 w-3" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-slate-800">{tarea.titulo}</h1>
              <span className={`text-2xs font-semibold px-2 py-0.5 rounded border ${pBadge.color}`}>
                {pBadge.label}
              </span>
              <span className={`text-2xs font-semibold px-2 py-0.5 rounded border ${eBadge.color}`}>
                {eBadge.label}
              </span>
            </div>
            <p className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
              {tipo.icon}
              {tipo.label}
              {tarea.recurrencia !== 'NINGUNA' && (
                <span className="flex items-center gap-1 text-slate-400">
                  · <Repeat className="h-3 w-3" /> {recurrenciaLabel(tarea.recurrencia)}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {puedeCompletar && (
            <button onClick={() => { setShowModal(true); setNotaCierre('') }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors">
              <CheckCircle className="h-3 w-3" /> Completar
            </button>
          )}
          <button onClick={() => router.push(`/crm/tareas/${id}/editar`)} className="btn-primary">
            <Edit className="h-3 w-3" /> Editar
          </button>
          <button onClick={eliminarTarea}
            className="btn-secondary text-red-600 hover:text-red-700 hover:border-red-300">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* ── Nota de cierre (si completada) ───────────────────── */}
      {tarea.estado === 'COMPLETADA' && tarea.nota_cierre && (
        <div className="flex items-start gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700">
          <CheckCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">Tarea completada</span>
            <p className="mt-1 text-2xs opacity-80">{tarea.nota_cierre}</p>
          </div>
        </div>
      )}

      {tarea.estado === 'COMPLETADA' && !tarea.nota_cierre && (
        <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <CheckCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="font-semibold">Tarea completada</span>
        </div>
      )}

      {/* ── Alerta vencida ───────────────────────────────────── */}
      {vencida && (
        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="font-semibold">Esta tarea está vencida</span>
        </div>
      )}

      {/* ── Layout 2 columnas ───────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">

        {/* ── Columna izquierda: detalle ─────────────────────── */}
        <div className="col-span-1 flex flex-col gap-2">

          {/* Tipo y fecha */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Detalle</h3>
            </div>
            <div className="p-3 flex flex-col gap-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Tipo</span>
                <span className="text-slate-700 font-medium flex items-center gap-1">{tipo.icon} {tipo.label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Prioridad</span>
                <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${pBadge.color}`}>{pBadge.label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Vencimiento</span>
                <span className={`font-medium ${vencida ? 'text-red-600' : 'text-slate-700'}`}>
                  {formatFechaLocalLarga(tarea.fecha_vencimiento)}
                  {tarea.hora_vencimiento && <span className="text-slate-400 ml-1">{tarea.hora_vencimiento.substring(0, 5)}</span>}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Recurrencia</span>
                <span className="text-slate-700 font-medium flex items-center gap-1">
                  {tarea.recurrencia !== 'NINGUNA' && <Repeat className="h-3 w-3 text-slate-400" />}
                  {recurrenciaLabel(tarea.recurrencia)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Estado</span>
                <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${eBadge.color}`}>{eBadge.label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Creada</span>
                <span className="text-slate-700 font-medium">{formatFechaLocalLarga(tarea.created_at)}</span>
              </div>
            </div>
          </div>

          {/* Descripción */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Descripcion</h3>
            </div>
            <div className="p-3">
              {tarea.descripcion ? (
                <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{tarea.descripcion}</p>
              ) : (
                <span className="text-xs text-slate-400">Sin descripcion</span>
              )}
            </div>
          </div>
        </div>

        {/* ── Columna derecha: vinculaciones ─────────────────── */}
        <div className="col-span-2 flex flex-col gap-2">

          {/* Cliente */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Cliente vinculado</h3>
            </div>
            <div className="p-3 flex flex-col gap-1.5">
              <button onClick={() => router.push(`/crm/personas/${tarea.persona?.id}`)}
                className="flex items-center gap-1.5 text-blue-600 hover:underline text-xs font-medium text-left">
                <User className="h-3 w-3" />
                {nombrePersona(tarea.persona)}
              </button>
              {tarea.persona?.telefono && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Phone className="h-3 w-3 text-slate-400" />
                  <span className="font-mono">{tarea.persona.telefono}</span>
                </div>
              )}
              {tarea.persona?.whatsapp && (
                <div className="flex items-center gap-1.5 text-xs text-green-600">
                  <MessageCircle className="h-3 w-3 text-green-500" />
                  <span className="font-mono">{tarea.persona.whatsapp}</span>
                </div>
              )}
              {tarea.persona?.email && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500 truncate">
                  <span className="text-slate-400">@</span>
                  <span>{tarea.persona.email}</span>
                </div>
              )}
            </div>
          </div>

          {/* Poliza */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Poliza vinculada</h3>
            </div>
            <div className="p-3">
              {tarea.poliza ? (
                <div className="flex flex-col gap-1.5">
                  <button onClick={() => router.push(`/crm/polizas/${tarea.poliza!.id}`)}
                    className="flex items-center gap-1.5 text-blue-600 hover:underline text-xs font-medium text-left">
                    <FileText className="h-3 w-3" />
                    <span className="font-mono">{tarea.poliza.numero_poliza}</span>
                  </button>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    {tarea.poliza.compania && <span>{(tarea.poliza.compania as any).nombre}</span>}
                    {tarea.poliza.ramo && <span>· {(tarea.poliza.ramo as any).nombre}</span>}
                  </div>
                </div>
              ) : (
                <span className="text-xs text-slate-400">Sin poliza vinculada</span>
              )}
            </div>
          </div>

          {/* Siniestro */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Siniestro vinculado</h3>
            </div>
            <div className="p-3">
              {tarea.siniestro ? (
                <div className="flex flex-col gap-1.5">
                  <button onClick={() => router.push(`/crm/siniestros/${tarea.siniestro!.id}`)}
                    className="flex items-center gap-1.5 text-blue-600 hover:underline text-xs font-medium text-left">
                    <AlertTriangle className="h-3 w-3" />
                    <span className="font-mono">{tarea.siniestro.numero_caso}</span>
                  </button>
                  <span className="text-xs text-slate-500">Estado: {tarea.siniestro.estado?.replace(/_/g, ' ') ?? '—'}</span>
                </div>
              ) : (
                <span className="text-xs text-slate-400">Sin siniestro vinculado</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Modal completar ──────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 rounded-t-lg border-b border-slate-200 bg-emerald-50">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-600" />
                <h3 className="text-sm font-semibold text-emerald-800">Completar tarea</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-xs text-slate-600">
                <span className="font-medium">{tarea.titulo}</span>
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">¿Que paso? (opcional)</label>
                <textarea className="form-input w-full resize-none text-xs" rows={3}
                  value={notaCierre} onChange={e => setNotaCierre(e.target.value)}
                  placeholder="Deja una nota sobre como se resolvio..." />
              </div>
              {tarea.recurrencia !== 'NINGUNA' && (
                <div className="flex items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700">
                  <Repeat className="h-3 w-3" />
                  Se creara automaticamente la siguiente tarea ({tarea.recurrencia.toLowerCase()})
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg">
              <button onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
              <button onClick={completarTarea} disabled={completando}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50">
                {completando ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
                {completando ? 'Guardando...' : 'Completar'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
