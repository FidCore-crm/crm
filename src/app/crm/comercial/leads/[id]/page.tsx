'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, Edit, Loader2, AlertCircle, Plus, Trash2, X,
  Phone, Mail, MessageCircle, Users, StickyNote, FileText,
  UserCheck, XCircle, RotateCcw, ChevronRight, ExternalLink, CheckCircle
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { formatFechaLocalLarga, nowLocalDatetimeInput } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { apiCall } from '@/lib/api-client'
import { emitirBroadcastMensajesWeb } from '@/lib/broadcast-mensajes-web'
import { useRealtimeRefresh } from '@/lib/hooks/useRealtimeRefresh'

interface LeadData {
  id: string
  nombre: string
  apellido: string
  dni: string | null
  telefono: string | null
  email: string | null
  empresa: string | null
  cargo: string | null
  fuente: string
  canal: string | null
  nivel_interes: string
  productos_interes: string | null
  estado: string
  motivo_descarte: string | null
  notas: string | null
  created_at: string
}

interface Interaccion {
  id: string
  tipo: string
  descripcion: string
  fecha: string
  created_at: string
}

interface CotizacionResumen {
  id: string
  numero_cotizacion: string
  estado: string
  created_at: string
}

const ESTADO_BADGE: Record<string, { label: string; color: string }> = {
  NUEVO:      { label: 'Nuevo',      color: 'bg-blue-50 text-blue-700 border-blue-200' },
  CONTACTADO: { label: 'Contactado', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  CONVERTIDO: { label: 'Convertido', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  DESCARTADO: { label: 'Descartado', color: 'bg-red-50 text-red-700 border-red-200' },
}

const FUENTE_BADGE: Record<string, string> = {
  REFERIDO: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  WEB: 'bg-blue-50 text-blue-700 border-blue-200',
  REDES_SOCIALES: 'bg-violet-50 text-violet-700 border-violet-200',
  LLAMADA_ENTRANTE: 'bg-orange-50 text-orange-700 border-orange-200',
  EVENTO: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  OTRO: 'bg-slate-100 text-slate-600 border-slate-200',
}

const FUENTE_LABEL: Record<string, string> = {
  REFERIDO: 'Referido', WEB: 'Web', REDES_SOCIALES: 'Redes Sociales',
  LLAMADA_ENTRANTE: 'Llamada Entrante', EVENTO: 'Evento', OTRO: 'Otro',
}

const INTERES_BADGE: Record<string, string> = {
  ALTO: 'bg-red-50 text-red-700 border-red-200',
  MEDIO: 'bg-amber-50 text-amber-700 border-amber-200',
  BAJO: 'bg-slate-100 text-slate-600 border-slate-200',
}

const CANAL_LABEL: Record<string, string> = {
  WHATSAPP: 'WhatsApp', TELEFONO: 'Teléfono', EMAIL: 'Email', PRESENCIAL: 'Presencial',
}

const TIPO_INTERACCION_ICON: Record<string, React.ReactNode> = {
  LLAMADA:  <Phone className="h-3.5 w-3.5 text-blue-500"/>,
  EMAIL:    <Mail className="h-3.5 w-3.5 text-amber-500"/>,
  WHATSAPP: <MessageCircle className="h-3.5 w-3.5 text-green-500"/>,
  REUNION:  <Users className="h-3.5 w-3.5 text-violet-500"/>,
  NOTA:     <StickyNote className="h-3.5 w-3.5 text-slate-500"/>,
}

const TIPO_INTERACCION_LABEL: Record<string, string> = {
  LLAMADA: 'Llamada', EMAIL: 'Email', WHATSAPP: 'WhatsApp', REUNION: 'Reunión', NOTA: 'Nota',
}

const COT_ESTADO_BADGE: Record<string, { label: string; color: string }> = {
  BORRADOR:   { label: 'Borrador',   color: 'bg-slate-100 text-slate-600 border-slate-200' },
  ENVIADA:    { label: 'Enviada',    color: 'bg-blue-50 text-blue-700 border-blue-200' },
  EN_PROCESO: { label: 'En proceso', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  GANADA:     { label: 'Ganada',     color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PERDIDA:    { label: 'Perdida',    color: 'bg-red-50 text-red-700 border-red-200' },
}

function formatTimestamp(f: string) {
  return new Date(f).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function formatHora(f: string) {
  return new Date(f).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}
function diasDesde(fecha: string): string {
  const diff = Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000)
  if (diff === 0) return 'Hoy'
  if (diff === 1) return 'Hace 1 día'
  return `Hace ${diff} días`
}

export default function FichaLeadPage() {
  const router   = useRouter()
  const { id }   = useParams<{ id: string }>()
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  const [lead,          setLead]          = useState<LeadData | null>(null)
  const [interacciones, setInteracciones] = useState<Interaccion[]>([])
  const [cotizaciones,  setCotizaciones]  = useState<CotizacionResumen[]>([])
  const [tareasAsociadas, setTareasAsociadas] = useState<{id:string;titulo:string;estado:string;fecha_vencimiento:string}[]>([])
  // `personaConvertida.deleted_at` se usa para mostrar la variante del
  // banner cuando el cliente derivado de la conversión está en papelera.
  const [personaConvertida, setPersonaConvertida] = useState<{ deleted_at: string | null } | null>(null)
  const [cargando,      setCargando]      = useState(true)

  // Form nueva interacción
  const [mostrarFormInt,  setMostrarFormInt]  = useState(false)
  const [intTipo,         setIntTipo]         = useState('LLAMADA')
  const [intFecha,        setIntFecha]        = useState('')
  const [intDescripcion,  setIntDescripcion]  = useState('')
  const [guardandoInt,    setGuardandoInt]    = useState(false)

  // Modal conversión
  const [modalConversion,  setModalConversion]  = useState(false)
  const [convDni,          setConvDni]          = useState('')
  const [convLocalidad,    setConvLocalidad]    = useState('')
  const [convProvincia,    setConvProvincia]    = useState('')
  const [guardandoConv,    setGuardandoConv]    = useState(false)
  const [errorConv,        setErrorConv]        = useState('')

  // Modal descarte
  const [modalDescarte,    setModalDescarte]    = useState(false)
  const [descarteMotivo,   setDescarteMotivo]   = useState('')
  const [descarteObs,      setDescarteObs]      = useState('')
  const [guardandoDesc,    setGuardandoDesc]    = useState(false)

  // `max` del datetime-local de nueva interacción: no se pueden registrar
  // interacciones futuras (distorsionan el timeline). Lo calculamos una vez
  // al renderizar para que el input rechace fechas adelantadas.
  const maxFechaInteraccion = nowLocalDatetimeInput()

  const cargarDatos = useCallback(async () => {
    if (!usuario) return

    // Primero traemos solo la metadata mínima del lead para validar
    // acceso. Si el usuario no tiene permiso (PROPIA + lead ajeno),
    // redirigimos antes de cargar interacciones/cotizaciones/tareas
    // y evitamos leakear data por unos ms.
    const { data: l } = await supabase
      .from('leads')
      .select('*')
      .eq('id', id)
      .single()

    if (!l) {
      setCargando(false)
      return
    }

    const leadData = l as unknown as LeadData & { usuario_id: string | null }
    if (!tieneAccesoTotal(usuario) && leadData.usuario_id !== null && leadData.usuario_id !== usuario.id) {
      router.replace('/crm/comercial/leads')
      return
    }

    setLead(leadData)
    setConvDni(leadData.dni ?? '')

    const personaConvertidaId = (leadData as any).persona_id as string | null
    const [{ data: ints }, { data: cots }, { data: tareasData }, persConvRes] = await Promise.all([
      supabase.from('interacciones').select('*').eq('lead_id', id).order('fecha', { ascending: false }),
      supabase.from('cotizaciones').select('id, numero_cotizacion, estado, created_at').eq('lead_id', id).order('created_at', { ascending: false }),
      supabase.from('tareas').select('id, titulo, estado, fecha_vencimiento').eq('lead_id', id).order('fecha_vencimiento'),
      personaConvertidaId
        ? supabase.from('personas').select('deleted_at').eq('id', personaConvertidaId).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    setInteracciones((ints ?? []) as unknown as Interaccion[])
    setCotizaciones((cots ?? []) as unknown as CotizacionResumen[])
    setTareasAsociadas((tareasData ?? []) as any[])
    setPersonaConvertida((persConvRes?.data ?? null) as { deleted_at: string | null } | null)
    setCargando(false)

    // Auto-marcar como leídas las notificaciones LEAD_WEB_NUEVO de este lead
    // (comportamiento tipo Gmail: abrir la ficha "consume" la notificación).
    // Fire-and-forget — si falla no afecta la carga.
    apiCall(
      '/api/notificaciones',
      {
        method: 'PATCH',
        body: { entidad_tipo: 'lead', entidad_id: id, tipo: 'LEAD_WEB_NUEVO' },
      },
      { mostrar_toast_en_error: false },
    ).then(() => {
      emitirBroadcastMensajesWeb({ tipo: 'marcada-leida', id })
    }).catch(() => {})
  }, [supabase, id, usuario, router])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  // Realtime: ESTE lead + sus interacciones. Filtrado por id/lead_id.
  useRealtimeRefresh({
    tablas: ['leads'],
    filter: `id=eq.${id}`,
    onCambio: cargarDatos,
  })
  useRealtimeRefresh({
    tablas: ['interacciones'],
    filter: `lead_id=eq.${id}`,
    onCambio: cargarDatos,
  })

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
      lead_id: id,
      tipo: intTipo,
      descripcion: intDescripcion.trim(),
      fecha: new Date(intFecha).toISOString(),
    })

    // Auto-cambiar a CONTACTADO si todavía está NUEVO. Hacemos el chequeo
    // en la cláusula WHERE (atómico) en lugar de leer el state local +
    // UPDATE: dos clics rápidos sobre "Guardar interacción" antes ejecutaban
    // dos UPDATEs (idempotentes, pero ruidosos). Acá Postgres garantiza que
    // sólo se actualiza la fila si todavía está en NUEVO.
    await supabase.from('leads')
      .update({ estado: 'CONTACTADO' })
      .eq('id', id)
      .eq('estado', 'NUEVO')

    setMostrarFormInt(false)
    setGuardandoInt(false)
    cargarDatos()
  }

  const eliminarInteraccion = async (intId: string) => {
    if (!confirm('¿Eliminar esta interacción?')) return
    await supabase.from('interacciones').delete().eq('id', intId)
    cargarDatos()
  }

  // Conversión a cliente
  const convertir = async () => {
    if (!lead) return
    setGuardandoConv(true)
    setErrorConv('')

    try {
      // 1. Crear persona via API (incluye validación, normalización, bitácora).
      const r = await apiCall<{ id: string }>('/api/personas', {
        method: 'POST',
        body: {
          tipo_persona: 'FISICA',
          nombre: lead.nombre,
          apellido: lead.apellido,
          dni_cuil: (convDni || lead.dni || ''),
          telefono: lead.telefono,
          email: lead.email,
          estado: 'ACTIVO',
          origen: 'LEAD',
          localidad: convLocalidad || null,
          provincia: convProvincia || null,
          acepta_marketing: true,
          canal_preferido: lead.canal ?? 'WHATSAPP',
          usuario_id: (lead as any).usuario_id ?? usuario?.id ?? null,
        },
      }, { mostrar_toast_en_error: false })
      if (!r.ok || !r.data?.id) {
        throw new Error(r.error?.mensaje ?? 'Error al crear persona')
      }

      const personaId = r.data.id

      // 2. Transferir cotizaciones al nuevo cliente.
      // El CHECK `cotizaciones_origen_check` exige mutua exclusión entre
      // persona_id y lead_id, así que limpiamos lead_id en el mismo UPDATE.
      const { error: errCot } = await supabase
        .from('cotizaciones')
        .update({ persona_id: personaId, lead_id: null })
        .eq('lead_id', id)
      if (errCot) throw new Error(`No se pudieron transferir las cotizaciones: ${errCot.message}`)

      // 3. Migrar interacciones (historial) al nuevo cliente.
      // El CHECK `interacciones_origen_check` (migración 035) exige
      // que solo uno de lead_id/oportunidad_id/persona_id esté seteado.
      const { error: errInt } = await supabase
        .from('interacciones')
        .update({ persona_id: personaId, lead_id: null })
        .eq('lead_id', id)
      if (errInt) throw new Error(`No se pudo migrar el historial: ${errInt.message}`)

      // 4. Migrar tareas vinculadas al lead → cliente. El campo persona_id
      // es NOT NULL en tareas, así que sobreescribimos al cliente nuevo y
      // limpiamos lead_id (FK con SET NULL) para no dejar referencia
      // colgada al lead CONVERTIDO.
      const { error: errTar } = await supabase
        .from('tareas')
        .update({ persona_id: personaId, lead_id: null })
        .eq('lead_id', id)
      if (errTar) throw new Error(`No se pudieron migrar las tareas: ${errTar.message}`)

      // 5. Marcar lead como CONVERTIDO (NO eliminarlo — preserva el rastro).
      const { error: errLead } = await supabase.from('leads').update({
        estado: 'CONVERTIDO',
        persona_id: personaId,
        fecha_conversion: new Date().toISOString(),
      }).eq('id', id)
      if (errLead) throw new Error(`No se pudo marcar el lead como convertido: ${errLead.message}`)

      // 6. Navegar a la ficha del nuevo cliente
      router.push(`/crm/personas/${personaId}`)
    } catch (err: any) {
      setErrorConv(err.message ?? 'Error en la conversión')
      setGuardandoConv(false)
    }
  }

  // Descarte
  const descartar = async () => {
    if (!descarteMotivo) return
    setGuardandoDesc(true)
    await supabase.from('leads').update({
      estado: 'DESCARTADO',
      motivo_descarte: descarteMotivo + (descarteObs ? ` — ${descarteObs}` : ''),
    }).eq('id', id)
    setModalDescarte(false)
    setGuardandoDesc(false)
    cargarDatos()
  }

  // Reactivar
  const reactivar = async () => {
    await supabase.from('leads').update({
      estado: 'NUEVO',
      motivo_descarte: null,
    }).eq('id', id)
    cargarDatos()
  }

  if (cargando) return (
    <div className="flex items-center justify-center py-20 text-slate-500 text-sm gap-2">
      <Loader2 className="h-4 w-4 animate-spin"/> Cargando ficha del lead...
    </div>
  )

  if (!lead) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <AlertCircle className="h-8 w-8 text-slate-300"/>
      <span className="text-sm text-slate-500">Lead no encontrado</span>
      <button onClick={() => router.push('/crm/comercial/leads')} className="btn-secondary">
        <ArrowLeft className="h-3 w-3"/> Volver al listado
      </button>
    </div>
  )

  const eb = ESTADO_BADGE[lead.estado] ?? ESTADO_BADGE.NUEVO
  const puedeAccionar = lead.estado === 'NUEVO' || lead.estado === 'CONTACTADO'

  return (
    <div className="flex flex-col gap-3 max-w-5xl">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <button onClick={() => router.push('/crm/comercial/leads')}
            className="btn-secondary h-7 w-7 p-0 flex items-center justify-center mt-0.5"
            title="Volver">
            <ArrowLeft className="h-3 w-3"/>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-slate-800">{lead.apellido}, {lead.nombre}</h1>
              <span className={`text-2xs font-semibold px-2 py-0.5 rounded border ${eb.color}`}>{eb.label}</span>
              <span className={`text-2xs font-semibold px-2 py-0.5 rounded border ${INTERES_BADGE[lead.nivel_interes]}`}>
                Interés {lead.nivel_interes.toLowerCase()}
              </span>
            </div>
            <p className="text-xs text-slate-600">
              {lead.empresa ? `${lead.cargo ? lead.cargo + ' en ' : ''}${lead.empresa}` : 'Lead'}
              {' · '}Ingresó el {formatFechaLocalLarga(lead.created_at)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => router.push(`/crm/comercial/leads/${id}/editar`)} className="btn-secondary">
            <Edit className="h-3 w-3"/> Editar
          </button>
          <button onClick={() => router.push(`/crm/comercial/cotizaciones/nueva?lead_id=${id}`)} className="btn-primary">
            <FileText className="h-3 w-3"/> Crear cotización
          </button>
          {puedeAccionar && (
            <>
              <button onClick={() => { setErrorConv(''); setModalConversion(true) }}
                className="btn-primary bg-emerald-600 hover:bg-emerald-700 border-emerald-600">
                <UserCheck className="h-3 w-3"/> Convertir en cliente
              </button>
              <button onClick={() => { setDescarteMotivo(''); setDescarteObs(''); setModalDescarte(true) }}
                className="btn-secondary text-red-600 border-red-200 hover:bg-red-50">
                <XCircle className="h-3 w-3"/> Descartar
              </button>
            </>
          )}
          {lead.estado === 'DESCARTADO' && (
            <button onClick={reactivar} className="btn-secondary">
              <RotateCcw className="h-3 w-3"/> Reactivar
            </button>
          )}
        </div>
      </div>

      {/* Banner de lead convertido — variante según estado del cliente */}
      {lead.estado === 'CONVERTIDO' && (lead as any).persona_id && (() => {
        const enPapelera = !!personaConvertida?.deleted_at
        return (
          <div className={`rounded px-4 py-2.5 flex items-center justify-between border ${
            enPapelera
              ? 'bg-amber-50 border-amber-300'
              : 'bg-emerald-50 border-emerald-200'
          }`}>
            <div className={`flex items-center gap-2 text-sm ${enPapelera ? 'text-amber-800' : 'text-emerald-700'}`}>
              {enPapelera ? <Trash2 className="h-4 w-4 text-amber-600"/> : <CheckCircle className="h-4 w-4 text-emerald-500"/>}
              <span>
                {enPapelera ? (
                  <>
                    El cliente derivado de este lead está en la papelera
                    {personaConvertida?.deleted_at && (
                      <> desde el {formatFechaLocalLarga(personaConvertida.deleted_at)}</>
                    )}.
                    Revisá la ficha para restaurarlo o esperá la purga definitiva.
                  </>
                ) : (
                  <>
                    Este lead fue convertido a cliente
                    {(lead as any).fecha_conversion && (
                      <> el {formatFechaLocalLarga((lead as any).fecha_conversion)}</>
                    )}
                  </>
                )}
              </span>
            </div>
            <button
              onClick={() => router.push(`/crm/personas/${(lead as any).persona_id}`)}
              className={`text-xs font-semibold flex items-center gap-1 hover:underline ${
                enPapelera ? 'text-amber-800 hover:text-amber-900' : 'text-emerald-700 hover:text-emerald-900'
              }`}
            >
              Ver cliente <ChevronRight className="h-3 w-3"/>
            </button>
          </div>
        )
      })()}

      <div className="grid grid-cols-3 gap-3">

        {/* SIDEBAR */}
        <div className="col-span-1 flex flex-col gap-2">

          {/* Info del lead */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-600 uppercase tracking-wide">Información del lead</h3>
            </div>
            <div className="p-3 flex flex-col gap-2 text-xs">
              <div>
                <p className="text-2xs text-slate-600">Nombre completo</p>
                <p className="text-slate-700 font-medium">{lead.nombre} {lead.apellido}</p>
              </div>
              {lead.dni && (
                <div>
                  <p className="text-2xs text-slate-600">DNI</p>
                  <p className="text-slate-700 font-mono">{lead.dni}</p>
                </div>
              )}
              {lead.telefono && (
                <div>
                  <p className="text-2xs text-slate-600">Teléfono</p>
                  <a href={`tel:${lead.telefono}`} className="text-blue-600 hover:underline font-mono">{lead.telefono}</a>
                </div>
              )}
              {lead.email && (
                <div>
                  <p className="text-2xs text-slate-600">Email</p>
                  <a href={`mailto:${lead.email}`} className="text-blue-600 hover:underline">{lead.email}</a>
                </div>
              )}
              {(lead.empresa || lead.cargo) && (
                <div>
                  <p className="text-2xs text-slate-600">Empresa / Cargo</p>
                  <p className="text-slate-700">{[lead.cargo, lead.empresa].filter(Boolean).join(' en ')}</p>
                </div>
              )}

              <div className="border-t border-slate-100 pt-2 mt-1"/>

              <div>
                <p className="text-2xs text-slate-600 mb-1">Fuente</p>
                <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${FUENTE_BADGE[lead.fuente]}`}>
                  {FUENTE_LABEL[lead.fuente] ?? lead.fuente}
                </span>
              </div>
              {lead.canal && (
                <div>
                  <p className="text-2xs text-slate-600">Canal</p>
                  <p className="text-slate-700">{CANAL_LABEL[lead.canal] ?? lead.canal}</p>
                </div>
              )}
              <div>
                <p className="text-2xs text-slate-600 mb-1">Nivel de interés</p>
                <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${INTERES_BADGE[lead.nivel_interes]}`}>
                  {lead.nivel_interes}
                </span>
              </div>
              {lead.productos_interes && (
                <div>
                  <p className="text-2xs text-slate-600">Productos de interés</p>
                  <p className="text-slate-700">{lead.productos_interes}</p>
                </div>
              )}

              <div className="border-t border-slate-100 pt-2 mt-1"/>

              <div>
                <p className="text-2xs text-slate-600">Fecha de ingreso</p>
                <p className="text-slate-700">{formatFechaLocalLarga(lead.created_at)}</p>
                <p className="text-2xs text-slate-600">{diasDesde(lead.created_at)}</p>
              </div>

              {lead.motivo_descarte && (
                <div className="bg-red-50 border border-red-200 rounded p-2 mt-1">
                  <p className="text-2xs text-red-500 font-semibold">Motivo de descarte</p>
                  <p className="text-xs text-red-700">{lead.motivo_descarte}</p>
                </div>
              )}
            </div>
          </div>

          {/* Notas */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-600 uppercase tracking-wide">Notas</h3>
            </div>
            <div className="p-3">
              <p className="text-xs text-slate-600 leading-relaxed">{lead.notas ?? 'Sin notas'}</p>
            </div>
          </div>

          {/* Cotizaciones */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-600 uppercase tracking-wide">Cotizaciones</h3>
            </div>
            <div className="p-3">
              {cotizaciones.length === 0 ? (
                <div className="text-center py-3">
                  <p className="text-xs text-slate-600 mb-2">Sin cotizaciones</p>
                  <button onClick={() => router.push(`/crm/comercial/cotizaciones/nueva?lead_id=${id}`)}
                    className="text-xs text-blue-600 hover:underline">Crear cotización</button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {cotizaciones.map(c => {
                    const cb = COT_ESTADO_BADGE[c.estado] ?? COT_ESTADO_BADGE.BORRADOR
                    return (
                      <button key={c.id}
                        onClick={() => router.push(`/crm/comercial/cotizaciones/${c.id}`)}
                        className="flex items-center justify-between px-2 py-1.5 rounded border border-slate-100 hover:bg-slate-50 transition-colors text-left w-full">
                        <div>
                          <span className="font-mono text-xs font-semibold text-slate-700">{c.numero_cotizacion}</span>
                          <p className="text-2xs text-slate-600">{formatTimestamp(c.created_at)}</p>
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
              <h3 className="text-2xs font-semibold text-slate-600 uppercase tracking-wide">Tareas</h3>
            </div>
            <div className="p-3">
              {tareasAsociadas.length === 0 ? (
                <div className="text-center py-3">
                  <p className="text-xs text-slate-600 mb-2">Sin tareas</p>
                  <button onClick={() => router.push(`/crm/tareas/nueva?lead_id=${id}`)}
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
                  <button onClick={() => router.push(`/crm/tareas/nueva?lead_id=${id}`)}
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
              <h3 className="text-2xs font-semibold text-slate-600 uppercase tracking-wide">
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
                    <label className="text-2xs text-slate-600 mb-1 block">Tipo *</label>
                    <select className="form-input w-full" value={intTipo} onChange={e => setIntTipo(e.target.value)}>
                      <option value="LLAMADA">Llamada</option>
                      <option value="EMAIL">Email</option>
                      <option value="WHATSAPP">WhatsApp</option>
                      <option value="REUNION">Reunión</option>
                      <option value="NOTA">Nota</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-2xs text-slate-600 mb-1 block">Fecha y hora *</label>
                    <input
                      type="datetime-local"
                      className="form-input w-full"
                      value={intFecha}
                      max={maxFechaInteraccion}
                      onChange={e => setIntFecha(e.target.value)}
                    />
                  </div>
                </div>
                <div className="mb-2">
                  <label className="text-2xs text-slate-600 mb-1 block">Descripción *</label>
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
                <p className="text-xs text-slate-600 text-center py-8">
                  No hay interacciones registradas. Registrá el primer contacto con este lead.
                </p>
              ) : interacciones.map(int => (
                <div key={int.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 border bg-slate-50 border-slate-200">
                      {TIPO_INTERACCION_ICON[int.tipo] ?? <StickyNote className="h-3.5 w-3.5 text-slate-500"/>}
                    </div>
                    <div className="w-px flex-1 bg-slate-100 mt-1"/>
                  </div>
                  <div className="flex-1 pb-4 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-700">
                          {TIPO_INTERACCION_LABEL[int.tipo] ?? int.tipo}
                        </span>
                        <span className="text-2xs text-slate-600">
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

      {/* MODAL CONVERSIÓN */}
      {modalConversion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-800">Convertir lead en cliente</h3>
              <button onClick={() => setModalConversion(false)} className="text-slate-500 hover:text-slate-600">
                <X className="h-4 w-4"/>
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-xs text-slate-600">Se creará un nuevo cliente con estos datos. El lead quedará marcado como convertido y se preservará su historial.</p>

              <div className="bg-slate-50 border border-slate-200 rounded p-3 flex flex-col gap-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-600">Nombre</span>
                  <span className="text-slate-700 font-medium">{lead.nombre} {lead.apellido}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">DNI</span>
                  <span className="text-slate-700 font-mono">{lead.dni || 'Sin DNI — se puede completar abajo'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Teléfono</span>
                  <span className="text-slate-700">{lead.telefono ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Email</span>
                  <span className="text-slate-700">{lead.email ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Origen</span>
                  <span className="text-slate-700">LEAD</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Estado</span>
                  <span className="text-emerald-700 font-medium">ACTIVO</span>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">DNI / CUIL</label>
                <input className="form-input w-full font-mono" value={convDni}
                  onChange={e => setConvDni(e.target.value)} placeholder="12345678"/>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Localidad</label>
                  <input className="form-input w-full" value={convLocalidad}
                    onChange={e => setConvLocalidad(e.target.value)} placeholder="Castelar"/>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 mb-1 block">Provincia</label>
                  <input className="form-input w-full" value={convProvincia}
                    onChange={e => setConvProvincia(e.target.value)} placeholder="Buenos Aires"/>
                </div>
              </div>

              {errorConv && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{errorConv}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-200">
              <button onClick={() => setModalConversion(false)} className="btn-secondary">Cancelar</button>
              <button onClick={convertir} disabled={guardandoConv}
                className="btn-primary bg-emerald-600 hover:bg-emerald-700 border-emerald-600">
                {guardandoConv ? <Loader2 className="h-3 w-3 animate-spin"/> : <UserCheck className="h-3 w-3"/>}
                {guardandoConv ? 'Convirtiendo...' : 'Confirmar conversión'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DESCARTE */}
      {modalDescarte && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-800">Descartar lead</h3>
              <button onClick={() => setModalDescarte(false)} className="text-slate-500 hover:text-slate-600">
                <X className="h-4 w-4"/>
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Motivo de descarte *</label>
                <select className="form-input w-full" value={descarteMotivo}
                  onChange={e => setDescarteMotivo(e.target.value)}>
                  <option value="">Seleccionar motivo...</option>
                  <option value="No le interesa">No le interesa</option>
                  <option value="No contesta">No contesta</option>
                  <option value="Presupuesto insuficiente">Presupuesto insuficiente</option>
                  <option value="Ya tiene seguro con otro productor">Ya tiene seguro con otro productor</option>
                  <option value="Datos inválidos">Datos inválidos</option>
                  <option value="Otro">Otro</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 mb-1 block">Observaciones</label>
                <textarea className="form-input w-full resize-none" rows={2} value={descarteObs}
                  onChange={e => setDescarteObs(e.target.value)} placeholder="Detalles adicionales..."/>
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-200">
              <button onClick={() => setModalDescarte(false)} className="btn-secondary">Cancelar</button>
              <button onClick={descartar} disabled={guardandoDesc || !descarteMotivo} className="btn-danger">
                {guardandoDesc ? <Loader2 className="h-3 w-3 animate-spin"/> : <XCircle className="h-3 w-3"/>}
                {guardandoDesc ? 'Descartando...' : 'Confirmar descarte'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
