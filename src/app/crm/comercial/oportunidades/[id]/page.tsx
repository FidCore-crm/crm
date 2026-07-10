'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, Loader2, AlertCircle, Plus, Trash2, X, Edit,
  Phone, Mail, MessageCircle, Users, StickyNote, FileText,
  ExternalLink, RefreshCw, Shield
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { formatFechaLocalLarga, hoyLocal, formatMoneda, nowLocalDatetimeInput } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal, puedeEliminar } from '@/lib/cartera-filter'
import { useRealtimeRefresh } from '@/lib/hooks/useRealtimeRefresh'

// ── Tipos ──────────────────────────────────────────────
interface OportunidadData {
  id: string
  persona_id: string
  tipo: string
  fuente: string
  descripcion: string | null
  estado: string
  motivo_perdida: string | null
  fecha_proximo_contacto: string | null
  notas: string | null
  monto_estimado: number | null
  probabilidad_cierre: number | null
  fecha_estimada_cierre: string | null
  created_at: string
  updated_at: string
  persona: { id: string; apellido: string; nombre: string | null; dni_cuil: string; telefono: string | null; email: string | null }
}

interface PolizaVigente {
  id: string
  numero_poliza: string
  compania: { nombre: string } | null
  ramo: { nombre: string } | null
}

interface Interaccion {
  id: string; tipo: string; descripcion: string; fecha: string; created_at: string
}

interface CotizacionResumen {
  id: string; numero_cotizacion: string; estado: string; created_at: string
}

// ── Constantes ─────────────────────────────────────────
const TIPO_BADGE: Record<string, { label: string; color: string }> = {
  CROSS_SELL:   { label: 'Cross-sell',   color: 'bg-violet-50 text-violet-700 border-violet-200' },
  RECUPERACION: { label: 'Recuperación', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  NUEVA_VENTA:  { label: 'Nueva venta',  color: 'bg-blue-50 text-blue-700 border-blue-200' },
}
const FUENTE_BADGE: Record<string, { label: string; color: string }> = {
  AUTOMATICA: { label: 'Automática', color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  MANUAL:     { label: 'Manual',     color: 'bg-slate-100 text-slate-600 border-slate-200' },
}
const ESTADO_BADGE: Record<string, { label: string; color: string }> = {
  DETECTADA:   { label: 'Detectada',   color: 'bg-slate-100 text-slate-600 border-slate-200' },
  CONTACTADO:  { label: 'Contactado',  color: 'bg-amber-50 text-amber-700 border-amber-200' },
  NEGOCIACION: { label: 'Negociación', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  GANADA:      { label: 'Ganada',      color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PERDIDA:     { label: 'Perdida',     color: 'bg-red-50 text-red-700 border-red-200' },
}
const COT_ESTADO_BADGE: Record<string, { label: string; color: string }> = {
  BORRADOR:   { label: 'Borrador',   color: 'bg-slate-100 text-slate-600 border-slate-200' },
  ENVIADA:    { label: 'Enviada',    color: 'bg-blue-50 text-blue-700 border-blue-200' },
  EN_PROCESO: { label: 'En proceso', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  GANADA:     { label: 'Ganada',     color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PERDIDA:    { label: 'Perdida',    color: 'bg-red-50 text-red-700 border-red-200' },
}
const TIPO_INT_ICON: Record<string, React.ReactNode> = {
  LLAMADA:  <Phone className="h-3.5 w-3.5 text-blue-500"/>,
  EMAIL:    <Mail className="h-3.5 w-3.5 text-amber-500"/>,
  WHATSAPP: <MessageCircle className="h-3.5 w-3.5 text-green-500"/>,
  REUNION:  <Users className="h-3.5 w-3.5 text-violet-500"/>,
  NOTA:     <StickyNote className="h-3.5 w-3.5 text-slate-400"/>,
}
const TIPO_INT_LABEL: Record<string, string> = {
  LLAMADA: 'Llamada', EMAIL: 'Email', WHATSAPP: 'WhatsApp', REUNION: 'Reunión', NOTA: 'Nota',
}

const TRANSICIONES: Record<string, string[]> = {
  DETECTADA:   ['CONTACTADO', 'PERDIDA'],
  CONTACTADO:  ['NEGOCIACION', 'PERDIDA'],
  NEGOCIACION: ['GANADA', 'PERDIDA'],
}

function formatTimestamp(f: string) {
  return new Date(f).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function formatHora(f: string) {
  return new Date(f).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}
function diasDesde(fecha: string): string {
  const d = Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000)
  if (d === 0) return 'Hoy'
  if (d === 1) return 'Hace 1 día'
  return `Hace ${d} días`
}
function proximoContactoLabel(fecha: string | null) {
  if (!fecha) return { text: '—', color: '' }
  const hoy = hoyLocal()
  const f = fecha.split('T')[0]
  if (f < hoy) {
    const d = Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000)
    return { text: `Vencido hace ${d}d`, color: 'text-red-600 font-semibold' }
  }
  if (f === hoy) return { text: 'Hoy', color: 'text-amber-600 font-semibold' }
  return { text: formatFechaLocalLarga(fecha), color: '' }
}

export default function FichaOportunidadPage() {
  const router   = useRouter()
  const { id }   = useParams<{ id: string }>()
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  const [op,             setOp]             = useState<OportunidadData | null>(null)
  const [polizas,        setPolizas]        = useState<PolizaVigente[]>([])
  const [interacciones,  setInteracciones]  = useState<Interaccion[]>([])
  const [cotizaciones,   setCotizaciones]   = useState<CotizacionResumen[]>([])
  const [tareasAsociadas, setTareasAsociadas] = useState<{id:string;titulo:string;estado:string;fecha_vencimiento:string}[]>([])
  const [cargando,       setCargando]       = useState(true)

  // Form nueva interacción
  const [mostrarFormInt, setMostrarFormInt] = useState(false)
  const [intTipo,        setIntTipo]        = useState('LLAMADA')
  const [intFecha,       setIntFecha]       = useState('')
  const [intDescripcion, setIntDescripcion] = useState('')
  const [guardandoInt,   setGuardandoInt]   = useState(false)

  // Modal cambio estado
  const [modalEstado,       setModalEstado]       = useState(false)
  const [nuevoEstado,       setNuevoEstado]       = useState('')
  const [motivoPerdida,     setMotivoPerdida]     = useState('')
  const [guardandoEstado,   setGuardandoEstado]   = useState(false)

  const cargarDatos = useCallback(async () => {
    const [{ data: opData }, { data: ints }, { data: cots }] = await Promise.all([
      supabase.from('oportunidades').select(`
        id, persona_id, tipo, fuente, descripcion, estado, motivo_perdida,
        fecha_proximo_contacto, notas, monto_estimado, probabilidad_cierre, fecha_estimada_cierre,
        created_at, updated_at,
        persona:personas!persona_id (id, apellido, nombre, dni_cuil, telefono, email)
      `).eq('id', id).single(),
      supabase.from('interacciones').select('*').eq('oportunidad_id', id).order('fecha', { ascending: false }),
      supabase.from('cotizaciones').select('id, numero_cotizacion, estado, created_at').eq('oportunidad_id', id).order('created_at', { ascending: false }),
    ])

    if (opData) {
      const o = opData as unknown as OportunidadData
      setOp(o)
      // Cargar pólizas vigentes del cliente
      const { data: pols } = await supabase
        .from('polizas')
        .select('id, numero_poliza, compania:catalogos!compania_id(nombre), ramo:catalogos!ramo_id(nombre)')
        .eq('asegurado_id', o.persona_id)
        .eq('estado', 'VIGENTE')
        .order('fecha_fin', { ascending: false })
      setPolizas((pols ?? []) as unknown as PolizaVigente[])
    }
    setInteracciones((ints ?? []) as unknown as Interaccion[])
    setCotizaciones((cots ?? []) as unknown as CotizacionResumen[])
    // Load associated tasks
    const { data: tareasData } = await supabase.from('tareas').select('id, titulo, estado, fecha_vencimiento').eq('oportunidad_id', id).order('fecha_vencimiento')
    setTareasAsociadas((tareasData ?? []) as any[])
    setCargando(false)
  }, [supabase, id])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  // Realtime: cambios en ESTA oportunidad y sus relaciones (interacciones,
  // cotizaciones). Filtrado por oportunidad_id para no re-cargar la ficha ante
  // cambios de otras oportunidades del sistema.
  useRealtimeRefresh({
    tablas: ['oportunidades'],
    filter: `id=eq.${id}`,
    onCambio: cargarDatos,
  })
  useRealtimeRefresh({
    tablas: ['interacciones', 'cotizaciones'],
    filter: `oportunidad_id=eq.${id}`,
    onCambio: cargarDatos,
  })

  // Access check
  useEffect(() => {
    if (!op || !usuario) return
    if (!tieneAccesoTotal(usuario) && (op as any).usuario_id !== null && (op as any).usuario_id !== usuario.id) {
      router.push('/crm/comercial/oportunidades')
    }
  }, [op, usuario, router])

  // Nueva interacción
  const abrirFormInteraccion = () => {
    const now = new Date()
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
    setIntFecha(now.toISOString().slice(0, 16))
    setIntTipo('LLAMADA')
    setIntDescripcion('')
    setMostrarFormInt(true)
  }

  const guardarInteraccion = async () => {
    if (!intDescripcion.trim()) return
    setGuardandoInt(true)
    await supabase.from('interacciones').insert({
      oportunidad_id: id,
      tipo: intTipo,
      descripcion: intDescripcion.trim(),
      fecha: new Date(intFecha).toISOString(),
    })
    // Auto-cambiar a CONTACTADO si todavía está DETECTADA. Hacemos el chequeo
    // en la cláusula WHERE (atómico) en lugar de leer el state local +
    // UPDATE: evita que dos clics rápidos hagan UPDATEs duplicados, y más
    // importante, impide retroceder el estado si entre el load y el submit
    // otro usuario ya avanzó la oportunidad a CONTACTADO/NEGOCIACION.
    await supabase.from('oportunidades')
      .update({ estado: 'CONTACTADO' })
      .eq('id', id)
      .eq('estado', 'DETECTADA')
    setMostrarFormInt(false)
    setGuardandoInt(false)
    cargarDatos()
  }

  const eliminarInteraccion = async (intId: string) => {
    if (!confirm('¿Eliminar esta interacción?')) return
    await supabase.from('interacciones').delete().eq('id', intId)
    cargarDatos()
  }

  // Cambiar estado
  const cambiarEstado = async () => {
    if (!nuevoEstado) return
    if (nuevoEstado === 'PERDIDA' && !motivoPerdida) return
    setGuardandoEstado(true)
    await supabase.from('oportunidades').update({
      estado: nuevoEstado,
      motivo_perdida: nuevoEstado === 'PERDIDA' ? motivoPerdida : null,
    }).eq('id', id)
    setModalEstado(false)
    setGuardandoEstado(false)
    cargarDatos()
  }

  // Eliminar oportunidad
  const eliminarOportunidad = async () => {
    if (!confirm('¿Eliminar esta oportunidad y todas sus interacciones?')) return
    // FK interacciones.oportunidad_id tiene ON DELETE CASCADE.
    await supabase.from('oportunidades').delete().eq('id', id)
    router.push('/crm/comercial/oportunidades')
  }

  if (cargando) return (
    <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
      <Loader2 className="h-4 w-4 animate-spin"/> Cargando oportunidad...
    </div>
  )

  if (!op) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <AlertCircle className="h-8 w-8 text-slate-300"/>
      <span className="text-sm text-slate-400">Oportunidad no encontrada</span>
      <button onClick={() => router.push('/crm/comercial/oportunidades')} className="btn-secondary">
        <ArrowLeft className="h-3 w-3"/> Volver al listado
      </button>
    </div>
  )

  const tb = TIPO_BADGE[op.tipo] ?? TIPO_BADGE.NUEVA_VENTA
  const fb = FUENTE_BADGE[op.fuente] ?? FUENTE_BADGE.MANUAL
  const eb = ESTADO_BADGE[op.estado] ?? ESTADO_BADGE.DETECTADA
  const pc = proximoContactoLabel(op.fecha_proximo_contacto)
  const puedeAccionar = !['GANADA', 'PERDIDA'].includes(op.estado)
  const transicionesValidas = TRANSICIONES[op.estado] ?? []

  return (
    <div className="flex flex-col gap-3 max-w-5xl">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <button onClick={() => router.push('/crm/comercial/oportunidades')}
            className="btn-secondary h-7 w-7 p-0 flex items-center justify-center mt-0.5"
            title="Volver">
            <ArrowLeft className="h-3 w-3"/>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-slate-800">Oportunidad — {tb.label}</h1>
              <span className={`text-2xs font-semibold px-2 py-0.5 rounded border ${eb.color}`}>{eb.label}</span>
              <span className={`text-2xs font-semibold px-2 py-0.5 rounded border ${fb.color}`}>{fb.label}</span>
            </div>
            <p className="text-xs text-slate-500">
              Cliente: {op.persona.apellido}, {op.persona.nombre ?? ''} · Creada {diasDesde(op.created_at).toLowerCase()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {puedeAccionar && (
            <button onClick={() => router.push(`/crm/comercial/oportunidades/${id}/editar`)}
              className="btn-secondary">
              <Edit className="h-3 w-3"/> Editar
            </button>
          )}
          <button onClick={() => router.push(`/crm/comercial/cotizaciones/nueva?oportunidad_id=${id}&persona_id=${op.persona_id}`)}
            className="btn-primary">
            <FileText className="h-3 w-3"/> Crear cotización
          </button>
          {puedeAccionar && transicionesValidas.length > 0 && (
            <button
              onClick={() => {
                // No pre-seleccionar para evitar avances accidentales si
                // el PAS abre el modal por error y hace clic en Confirmar.
                setNuevoEstado('')
                setMotivoPerdida('')
                setModalEstado(true)
              }}
              className="btn-secondary">
              <RefreshCw className="h-3 w-3"/> Cambiar estado
            </button>
          )}
          {puedeEliminar(usuario) && (
          <button onClick={eliminarOportunidad}
            className="btn-secondary text-red-600 border-red-200 hover:bg-red-50">
            <Trash2 className="h-3 w-3"/> Eliminar
          </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">

        {/* SIDEBAR */}
        <div className="col-span-1 flex flex-col gap-2">

          {/* Cliente */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Cliente</h3>
            </div>
            <div className="p-3 flex flex-col gap-2 text-xs">
              <button onClick={() => router.push(`/crm/personas/${op.persona.id}`)}
                className="text-blue-600 hover:underline font-medium text-left">
                {op.persona.apellido}, {op.persona.nombre ?? ''}
              </button>
              <p className="text-slate-500 font-mono">{op.persona.dni_cuil}</p>
              {op.persona.telefono && (
                <a href={`tel:${op.persona.telefono}`} className="text-blue-600 hover:underline font-mono">{op.persona.telefono}</a>
              )}
              {op.persona.email && (
                <a href={`mailto:${op.persona.email}`} className="text-blue-600 hover:underline">{op.persona.email}</a>
              )}

              {polizas.length > 0 && (
                <>
                  <div className="border-t border-slate-100 pt-2 mt-1"/>
                  <p className="text-2xs text-slate-400 font-semibold uppercase">Pólizas vigentes</p>
                  {polizas.map(p => (
                    <button key={p.id} onClick={() => router.push(`/crm/polizas/${p.id}`)}
                      className="flex items-center gap-1.5 text-left hover:bg-slate-50 rounded px-1 py-0.5 -mx-1 transition-colors">
                      <Shield className="h-3 w-3 text-emerald-500 shrink-0"/>
                      <div>
                        <span className="font-mono text-2xs font-semibold text-slate-700">{p.numero_poliza}</span>
                        <p className="text-2xs text-slate-500">{p.compania?.nombre} · {p.ramo?.nombre}</p>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Detalle de la oportunidad */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Detalle de la oportunidad</h3>
            </div>
            <div className="p-3 flex flex-col gap-2 text-xs">
              <div>
                <p className="text-2xs text-slate-500 mb-1">Tipo</p>
                <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${tb.color}`}>{tb.label}</span>
              </div>
              <div>
                <p className="text-2xs text-slate-500 mb-1">Fuente</p>
                <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${fb.color}`}>{fb.label}</span>
              </div>
              {op.descripcion && (
                <div>
                  <p className="text-2xs text-slate-500">Descripción</p>
                  <p className="text-slate-700">{op.descripcion}</p>
                </div>
              )}
              <div>
                <p className="text-2xs text-slate-500">Próximo contacto</p>
                <p className={`${pc.color || 'text-slate-700'}`}>{pc.text}</p>
              </div>
              {op.notas && (
                <div>
                  <p className="text-2xs text-slate-500">Notas</p>
                  <p className="text-slate-700">{op.notas}</p>
                </div>
              )}
              <div className="border-t border-slate-100 pt-2 mt-1"/>
              <div>
                <p className="text-2xs text-slate-500">Creada</p>
                <p className="text-slate-700">{formatFechaLocalLarga(op.created_at)} · {diasDesde(op.created_at)}</p>
              </div>
              {op.motivo_perdida && (
                <div className="bg-red-50 border border-red-200 rounded p-2 mt-1">
                  <p className="text-2xs text-red-500 font-semibold">Motivo de pérdida</p>
                  <p className="text-xs text-red-700">{op.motivo_perdida}</p>
                </div>
              )}
            </div>
          </div>

          {/* Estimación */}
          {(() => {
            const tieneDatos = op.monto_estimado != null || op.probabilidad_cierre != null || op.fecha_estimada_cierre
            const prob = op.probabilidad_cierre ?? 0
            const valorEsperado = op.monto_estimado != null && op.probabilidad_cierre != null
              ? op.monto_estimado * (op.probabilidad_cierre / 100)
              : null
            let diasRestantesLabel: { text: string; color: string } = { text: '—', color: 'text-slate-700' }
            if (op.fecha_estimada_cierre) {
              const hoy = hoyLocal()
              const f = op.fecha_estimada_cierre.split('T')[0]
              const diff = Math.floor((new Date(f).getTime() - new Date(hoy).getTime()) / 86400000)
              if (diff < 0) diasRestantesLabel = { text: `Vencida hace ${-diff}d`, color: 'text-red-600 font-semibold' }
              else if (diff === 0) diasRestantesLabel = { text: 'Hoy', color: 'text-amber-600 font-semibold' }
              else diasRestantesLabel = { text: `En ${diff}d`, color: 'text-slate-700' }
            }
            return (
              <div className="bg-white border border-slate-200 rounded overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
                  <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Estimación</h3>
                </div>
                <div className="p-3 flex flex-col gap-2 text-xs">
                  {!tieneDatos ? (
                    <p className="text-2xs text-slate-500 italic text-center py-2">Sin datos de estimación</p>
                  ) : (
                    <>
                      <div>
                        <p className="text-2xs text-slate-500">Monto estimado</p>
                        <p className="text-sm font-semibold text-slate-800">
                          {op.monto_estimado != null ? formatMoneda(op.monto_estimado) : '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-2xs text-slate-500 mb-1">Probabilidad</p>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-slate-100 rounded overflow-hidden">
                            <div className="h-full bg-blue-500 transition-all" style={{ width: `${prob}%` }}/>
                          </div>
                          <span className="text-xs font-mono font-semibold text-slate-700">{op.probabilidad_cierre ?? 0}%</span>
                        </div>
                      </div>
                      <div>
                        <p className="text-2xs text-slate-500">Fecha estimada de cierre</p>
                        <p className="text-slate-700">
                          {op.fecha_estimada_cierre ? formatFechaLocalLarga(op.fecha_estimada_cierre) : '—'}
                          {op.fecha_estimada_cierre && <span className={`ml-1.5 ${diasRestantesLabel.color}`}>· {diasRestantesLabel.text}</span>}
                        </p>
                      </div>
                      {valorEsperado != null && (
                        <div className="border-t border-slate-100 pt-2 mt-1">
                          <p className="text-2xs text-slate-500">Valor esperado</p>
                          <p className="text-sm font-semibold text-emerald-700">{formatMoneda(valorEsperado)}</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })()}

          {/* Cotizaciones */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Cotizaciones</h3>
            </div>
            <div className="p-3">
              {cotizaciones.length === 0 ? (
                <div className="text-center py-3">
                  <p className="text-xs text-slate-500 mb-2">Sin cotizaciones</p>
                  <button onClick={() => router.push(`/crm/comercial/cotizaciones/nueva?oportunidad_id=${id}&persona_id=${op.persona_id}`)}
                    className="text-xs text-blue-600 hover:underline">Crear cotización</button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {cotizaciones.map(c => {
                    const cb = COT_ESTADO_BADGE[c.estado] ?? COT_ESTADO_BADGE.BORRADOR
                    return (
                      <button key={c.id} onClick={() => router.push(`/crm/comercial/cotizaciones/${c.id}`)}
                        className="flex items-center justify-between px-2 py-1.5 rounded border border-slate-100 hover:bg-slate-50 transition-colors text-left w-full">
                        <div>
                          <span className="font-mono text-xs font-semibold text-slate-700">{c.numero_cotizacion}</span>
                          <p className="text-2xs text-slate-500">{formatTimestamp(c.created_at)}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${cb.color}`}>{cb.label}</span>
                          <ExternalLink className="h-3 w-3 text-slate-300"/>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          {/* Tareas */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Tareas</h3>
            </div>
            <div className="p-3">
              {tareasAsociadas.length === 0 ? (
                <div className="text-center py-3">
                  <p className="text-xs text-slate-500 mb-2">Sin tareas</p>
                  <button onClick={() => router.push(`/crm/tareas/nueva?persona_id=${op.persona_id}&oportunidad_id=${id}`)}
                    className="text-xs text-blue-600 hover:underline">+ Nueva tarea</button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {tareasAsociadas.map(t => {
                    const estadoColor: Record<string,string> = {
                      PENDIENTE: 'bg-blue-50 text-blue-700 border-blue-200',
                      EN_PROCESO: 'bg-amber-50 text-amber-700 border-amber-200',
                      COMPLETADA: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                      CANCELADA: 'bg-slate-100 text-slate-600 border-slate-200',
                    }
                    return (
                      <button key={t.id} onClick={() => router.push(`/crm/tareas/${t.id}`)}
                        className="flex items-center justify-between px-2 py-1.5 rounded border border-slate-100 hover:bg-slate-50 transition-colors text-left w-full">
                        <span className="text-xs text-slate-700 truncate flex-1">{t.titulo}</span>
                        <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ml-1 ${estadoColor[t.estado] ?? ''}`}>{t.estado}</span>
                      </button>
                    )
                  })}
                  <button onClick={() => router.push(`/crm/tareas/nueva?persona_id=${op.persona_id}&oportunidad_id=${id}`)}
                    className="text-xs text-blue-600 hover:underline mt-1">+ Nueva tarea</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* CONTENIDO PRINCIPAL — Timeline */}
        <div className="col-span-2 flex flex-col gap-2">

          <div className="bg-white border border-slate-200 rounded overflow-hidden flex flex-col">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">
                Historial de interacciones
              </h3>
              {!mostrarFormInt && (
                <button onClick={abrirFormInteraccion} className="btn-primary text-2xs py-1 px-2">
                  <Plus className="h-3 w-3"/> Nueva interacción
                </button>
              )}
            </div>

            {/* Form nueva interacción */}
            {mostrarFormInt && (
              <div className="p-3 border-b border-slate-100 bg-blue-50/30">
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="text-2xs text-slate-500 mb-1 block">Tipo *</label>
                    <select className="form-input w-full" value={intTipo} onChange={e => setIntTipo(e.target.value)}>
                      <option value="LLAMADA">Llamada</option>
                      <option value="EMAIL">Email</option>
                      <option value="WHATSAPP">WhatsApp</option>
                      <option value="REUNION">Reunión</option>
                      <option value="NOTA">Nota</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-2xs text-slate-500 mb-1 block">Fecha y hora *</label>
                    <input
                      type="datetime-local"
                      className="form-input w-full"
                      value={intFecha}
                      max={nowLocalDatetimeInput()}
                      onChange={e => setIntFecha(e.target.value)}
                    />
                  </div>
                </div>
                <div className="mb-2">
                  <label className="text-2xs text-slate-500 mb-1 block">Descripción *</label>
                  <textarea className="form-input w-full resize-none text-xs" rows={3} value={intDescripcion}
                    onChange={e => setIntDescripcion(e.target.value)}
                    placeholder="Qué se habló, qué se acordó..."/>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setMostrarFormInt(false)} className="btn-secondary text-xs">Cancelar</button>
                  <button onClick={guardarInteraccion} disabled={guardandoInt || !intDescripcion.trim()}
                    className="btn-primary text-xs">
                    {guardandoInt ? <Loader2 className="h-3 w-3 animate-spin"/> : null}
                    Guardar
                  </button>
                </div>
              </div>
            )}

            {/* Lista de interacciones */}
            <div className="p-3 flex flex-col gap-0 overflow-y-auto max-h-[600px]">
              {interacciones.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">
                  No hay interacciones. Registrá el primer contacto con este cliente.
                </p>
              ) : interacciones.map(int => (
                <div key={int.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 border bg-slate-50 border-slate-200">
                      {TIPO_INT_ICON[int.tipo] ?? <StickyNote className="h-3.5 w-3.5 text-slate-400"/>}
                    </div>
                    <div className="w-px flex-1 bg-slate-100 mt-1"/>
                  </div>
                  <div className="flex-1 pb-4 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-700">
                          {TIPO_INT_LABEL[int.tipo] ?? int.tipo}
                        </span>
                        <span className="text-2xs text-slate-500">
                          {formatTimestamp(int.fecha)} · {formatHora(int.fecha)}
                        </span>
                      </div>
                      <button onClick={() => eliminarInteraccion(int.id)}
                        className="h-5 w-5 flex items-center justify-center rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 className="h-2.5 w-2.5"/>
                      </button>
                    </div>
                    <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded px-3 py-2 leading-relaxed">
                      {int.descripcion}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* MODAL CAMBIO DE ESTADO */}
      {modalEstado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-800">Actualizar estado</h3>
              <button onClick={() => setModalEstado(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4"/>
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <div>
                <p className="text-xs text-slate-500 mb-1">Estado actual</p>
                <span className={`text-2xs font-semibold px-2 py-0.5 rounded border ${eb.color}`}>{eb.label}</span>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Nuevo estado *</label>
                <select className="form-input w-full" value={nuevoEstado} onChange={e => setNuevoEstado(e.target.value)}>
                  <option value="">Seleccionar nuevo estado...</option>
                  {transicionesValidas.map(e => {
                    const badge = ESTADO_BADGE[e]
                    return <option key={e} value={e}>{badge?.label ?? e}</option>
                  })}
                </select>
              </div>

              {nuevoEstado === 'PERDIDA' && (
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Motivo de pérdida *</label>
                  <select className="form-input w-full" value={motivoPerdida} onChange={e => setMotivoPerdida(e.target.value)}>
                    <option value="">Seleccionar motivo...</option>
                    <option value="No le interesa">No le interesa</option>
                    <option value="Precio">Precio</option>
                    <option value="Ya contrató con otro">Ya contrató con otro</option>
                    <option value="No contesta">No contesta</option>
                    <option value="Otro">Otro</option>
                  </select>
                </div>
              )}

              {nuevoEstado === 'GANADA' && (
                <div className="bg-emerald-50 border border-emerald-200 rounded p-3 text-xs text-emerald-700">
                  Ahora podés crear la póliza desde el módulo de Pólizas para este cliente.
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-200">
              <button onClick={() => setModalEstado(false)} className="btn-secondary">Cancelar</button>
              <button onClick={cambiarEstado}
                disabled={guardandoEstado || !nuevoEstado || (nuevoEstado === 'PERDIDA' && !motivoPerdida)}
                className="btn-primary">
                {guardandoEstado ? <Loader2 className="h-3 w-3 animate-spin"/> : <RefreshCw className="h-3 w-3"/>}
                {guardandoEstado ? 'Guardando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
