'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Save, Loader2, AlertCircle, CheckCircle } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { mensajeErrorAmigable } from '@/lib/utils'

// ── Tipos ────────────────────────────────────────────────────
interface PersonaOption { id: string; nombre: string; usuario_id: string | null }
interface PolizaOption  { id: string; numero_poliza: string; asegurado_id: string }
interface SiniestroOption { id: string; numero_caso: string; persona_id: string }
interface OportunidadOption { id: string; descripcion: string | null; persona_id: string; tipo: string }
interface CotizacionOption { id: string; numero_cotizacion: string; persona_id: string | null }
interface LeadOption { id: string; nombre: string; apellido: string }

const TIPOS_TAREA = [
  { value: 'LLAMADA_SEGUIMIENTO',  label: 'Llamada de seguimiento' },
  { value: 'GESTION_RENOVACION',   label: 'Gestión de renovación' },
  { value: 'TRAMITE_SINIESTRO',    label: 'Trámite de siniestro' },
  { value: 'GESTION_COBRANZA',     label: 'Gestión de cobranza' },
  { value: 'ENVIO_DOCUMENTACION',  label: 'Envío de documentación' },
  { value: 'REUNION_CLIENTE',      label: 'Reunión con cliente' },
  { value: 'ALERTA_VENCIMIENTO',   label: 'Alerta de vencimiento' },
  { value: 'TAREA_GENERAL',        label: 'Tarea general' },
]

function Campo({ label, required, error, col = 1, children }: {
  label: string; required?: boolean; error?: string; col?: 1 | 2; children: React.ReactNode
}) {
  return (
    <div className={col === 2 ? 'col-span-2' : ''}>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <span className="flex items-center gap-1 text-xs text-red-500 mt-0.5"><AlertCircle className="h-3 w-3" />{error}</span>}
    </div>
  )
}

export default function NuevaTareaPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Cargando...</div>}>
      <NuevaTareaContent />
    </Suspense>
  )
}

function NuevaTareaContent() {
  const router   = useRouter()
  const params   = useSearchParams()
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  const [titulo,      setTitulo]      = useState('')
  const [tipo,        setTipo]        = useState('TAREA_GENERAL')
  const [prioridad,   setPrioridad]   = useState('MEDIA')
  const [descripcion, setDescripcion] = useState('')

  const [personaId,      setPersonaId]      = useState(params.get('persona_id') ?? '')
  const [polizaId,       setPolizaId]       = useState('')
  const [siniestroId,    setSiniestroId]    = useState('')
  const [oportunidadId,  setOportunidadId]  = useState(params.get('oportunidad_id') ?? '')
  const [cotizacionId,   setCotizacionId]   = useState(params.get('cotizacion_id') ?? '')
  const [leadId,         setLeadId]         = useState(params.get('lead_id') ?? '')

  const [fechaVenc,    setFechaVenc]    = useState(params.get('fecha') ?? '')
  const [horaVenc,     setHoraVenc]     = useState('')
  const [recurrencia,  setRecurrencia]  = useState('NINGUNA')

  const [personas,      setPersonas]      = useState<PersonaOption[]>([])
  const [polizas,       setPolizas]       = useState<PolizaOption[]>([])
  const [siniestros,    setSiniestros]    = useState<SiniestroOption[]>([])
  const [oportunidadesOpt, setOportunidadesOpt] = useState<OportunidadOption[]>([])
  const [cotizacionesOpt,  setCotizacionesOpt]  = useState<CotizacionOption[]>([])
  const [leadsOpt,         setLeadsOpt]         = useState<LeadOption[]>([])

  const [errores,   setErrores]   = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)
  const [exito,     setExito]     = useState(false)
  const [errorGral, setErrorGral] = useState('')

  // ── Cargar datos ───────────────────────────────────────
  useEffect(() => {
    async function cargar() {
      let persQuery = supabase
        .from('personas')
        .select('id, apellido, nombre, razon_social, usuario_id')
        .is('deleted_at', null)
        .order('apellido')
        .limit(500)
      if (usuario && !tieneAccesoTotal(usuario)) {
        persQuery = persQuery.eq('usuario_id', usuario.id)
      }
      const [{ data: pers }, { data: pols }, { data: sins }] = await Promise.all([
        persQuery,
        supabase.from('polizas').select('id, numero_poliza, asegurado_id').order('numero_poliza'),
        supabase.from('siniestros').select('id, numero_caso, persona_id').order('numero_caso'),
      ])
      setPersonas(((pers ?? []) as any[]).map(p => ({
        id: p.id,
        nombre: [p.apellido, p.nombre].filter(Boolean).join(', ') || p.razon_social || p.id,
        usuario_id: p.usuario_id ?? null
      })))
      setPolizas((pols ?? []) as unknown as PolizaOption[])
      setSiniestros((sins ?? []) as unknown as SiniestroOption[])

      // Commercial entities
      const [{ data: ops }, { data: cots }, { data: lds }] = await Promise.all([
        supabase.from('oportunidades').select('id, descripcion, persona_id, tipo').not('estado', 'in', '("GANADA","PERDIDA")').order('created_at', { ascending: false }).limit(200),
        supabase.from('cotizaciones').select('id, numero_cotizacion, persona_id').not('estado', 'in', '("GANADA","PERDIDA")').order('created_at', { ascending: false }).limit(200),
        supabase.from('leads').select('id, nombre, apellido').in('estado', ['NUEVO', 'CONTACTADO']).order('created_at', { ascending: false }).limit(200),
      ])
      setOportunidadesOpt((ops ?? []) as unknown as OportunidadOption[])
      setCotizacionesOpt((cots ?? []) as unknown as CotizacionOption[])
      setLeadsOpt((lds ?? []) as unknown as LeadOption[])
    }
    cargar()
  }, [supabase, usuario])

  // ── Validar ────────────────────────────────────────────
  const validar = () => {
    const e: Record<string, string> = {}
    if (!titulo.trim())   e.titulo    = 'El título es obligatorio'
    if (!personaId)       e.persona   = 'Seleccioná el cliente'
    if (!fechaVenc)       e.fecha     = 'La fecha de vencimiento es obligatoria'
    setErrores(e)
    return Object.keys(e).length === 0
  }

  // ── Guardar ────────────────────────────────────────────
  const guardar = async () => {
    if (!validar()) return
    setGuardando(true); setErrorGral('')
    try {
      const selectedPersona = personas.find(p => p.id === personaId)
      const { error } = await supabase.from('tareas').insert({
        titulo:            titulo.trim(),
        tipo,
        prioridad,
        descripcion:       descripcion.trim() || null,
        persona_id:        personaId,
        poliza_id:         polizaId || null,
        siniestro_id:      siniestroId || null,
        oportunidad_id:    oportunidadId || null,
        cotizacion_id:     cotizacionId || null,
        lead_id:           leadId || null,
        fecha_vencimiento: fechaVenc,
        hora_vencimiento:  horaVenc || null,
        recurrencia,
        usuario_id:        selectedPersona?.usuario_id ?? usuario?.id ?? null,
      })
      if (error) throw new Error(error.message)
      setExito(true)
      setTimeout(() => router.push('/crm/tareas'), 1200)
    } catch (err: any) {
      setErrorGral(mensajeErrorAmigable(err, 'No se pudo crear la tarea'))
    } finally {
      setGuardando(false)
    }
  }

  if (exito) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
        <CheckCircle className="h-6 w-6 text-green-600" />
      </div>
      <p className="text-sm font-medium text-slate-700">Tarea creada</p>
      <p className="text-xs text-slate-500">Redirigiendo al listado...</p>
    </div>
  )

  const ic = (k: string) => `form-input ${errores[k] ? 'border-red-300' : ''}`

  return (
    <div className="flex flex-col gap-4 max-w-3xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => router.back()} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center" title="Volver">
            <ArrowLeft className="h-3 w-3" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Nueva Tarea</h1>
            <p className="text-xs text-slate-500">Creá una tarea o recordatorio</p>
          </div>
        </div>
        <button onClick={guardar} disabled={guardando} className="btn-primary px-5">
          {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {guardando ? 'Guardando...' : 'Crear Tarea'}
        </button>
      </div>

      {errorGral && (
        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />{errorGral}
        </div>
      )}

      {/* Sección: Tarea */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Tarea</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Campo label="Título" required error={errores.titulo} col={2}>
            <input className={ic('titulo')} value={titulo}
              onChange={e => setTitulo(e.target.value)} placeholder="Ej: Llamar al cliente por renovación" />
          </Campo>
          <Campo label="Tipo de tarea">
            <select className="form-input" value={tipo} onChange={e => setTipo(e.target.value)}>
              {TIPOS_TAREA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Campo>
          <Campo label="Prioridad">
            <select className="form-input" value={prioridad} onChange={e => setPrioridad(e.target.value)}>
              <option value="CRITICA">Crítica</option>
              <option value="ALTA">Alta</option>
              <option value="MEDIA">Media</option>
              <option value="BAJA">Baja</option>
            </select>
          </Campo>
          <Campo label="Descripción" col={2}>
            <textarea className="form-input w-full resize-none" rows={3}
              value={descripcion} onChange={e => setDescripcion(e.target.value)}
              placeholder="Detalles opcionales de la tarea..." />
          </Campo>
        </div>
      </div>

      {/* Sección: Vinculación */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Vinculación</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Campo label="Cliente" required error={errores.persona} col={2}>
            <select className={ic('persona')} value={personaId}
              onChange={e => { setPersonaId(e.target.value); setPolizaId(''); setSiniestroId('') }}>
              <option value="">— Seleccioná el cliente —</option>
              {personas.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Póliza vinculada (opcional)">
            <select className="form-input" value={polizaId} onChange={e => setPolizaId(e.target.value)}>
              <option value="">— Sin póliza —</option>
              {polizas
                .filter(p => !personaId || p.asegurado_id === personaId)
                .map(p => <option key={p.id} value={p.id}>{p.numero_poliza}</option>)}
            </select>
          </Campo>
          <Campo label="Siniestro vinculado (opcional)">
            <select className="form-input" value={siniestroId} onChange={e => setSiniestroId(e.target.value)}>
              <option value="">— Sin siniestro —</option>
              {siniestros
                .filter(s => !personaId || s.persona_id === personaId)
                .map(s => <option key={s.id} value={s.id}>{s.numero_caso}</option>)}
            </select>
          </Campo>
          <Campo label="Oportunidad vinculada (opcional)">
            <select className="form-input" value={oportunidadId} onChange={e => setOportunidadId(e.target.value)}>
              <option value="">— Sin oportunidad —</option>
              {oportunidadesOpt
                .filter(o => !personaId || o.persona_id === personaId)
                .map(o => <option key={o.id} value={o.id}>{o.tipo.replace(/_/g, ' ')} — {(o.descripcion ?? '').slice(0, 40)}</option>)}
            </select>
          </Campo>
          <Campo label="Cotizacion vinculada (opcional)">
            <select className="form-input" value={cotizacionId} onChange={e => setCotizacionId(e.target.value)}>
              <option value="">— Sin cotizacion —</option>
              {cotizacionesOpt
                .filter(c => !personaId || c.persona_id === personaId)
                .map(c => <option key={c.id} value={c.id}>{c.numero_cotizacion}</option>)}
            </select>
          </Campo>
          <Campo label="Lead vinculado (opcional)">
            <select className="form-input" value={leadId} onChange={e => setLeadId(e.target.value)}>
              <option value="">— Sin lead —</option>
              {leadsOpt.map(l => <option key={l.id} value={l.id}>{l.apellido}, {l.nombre}</option>)}
            </select>
          </Campo>
        </div>
      </div>

      {/* Sección: Fecha y recurrencia */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Fecha y recurrencia</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Campo label="Fecha de vencimiento" required error={errores.fecha}>
            <input type="date" className={ic('fecha')} value={fechaVenc}
              onChange={e => setFechaVenc(e.target.value)} />
          </Campo>
          <Campo label="Hora (opcional)">
            <input type="time" className="form-input" value={horaVenc}
              onChange={e => setHoraVenc(e.target.value)} />
          </Campo>
          <Campo label="Recurrencia">
            <select className="form-input" value={recurrencia} onChange={e => setRecurrencia(e.target.value)}>
              <option value="NINGUNA">Sin recurrencia</option>
              <option value="DIARIA">Diaria</option>
              <option value="SEMANAL">Semanal</option>
              <option value="MENSUAL">Mensual</option>
              <option value="ANUAL">Anual</option>
            </select>
          </Campo>
          {recurrencia !== 'NINGUNA' && (
            <div className="col-span-2 text-2xs text-slate-500 bg-blue-50 border border-blue-100 rounded px-2.5 py-1.5">
              Cada vez que completes esta tarea, se creará automáticamente la siguiente
              instancia con la misma frecuencia. Borrala manualmente cuando ya no la necesites.
            </div>
          )}
        </div>
      </div>

      {/* Botones */}
      <div className="flex items-center justify-between pb-4">
        <button onClick={() => router.back()} className="btn-secondary">
          <ArrowLeft className="h-3 w-3" /> Cancelar
        </button>
        <button onClick={guardar} disabled={guardando} className="btn-primary px-6">
          {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {guardando ? 'Guardando...' : 'Crear Tarea'}
        </button>
      </div>
    </div>
  )
}
