'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Save, Loader2, AlertCircle, CheckCircle } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { actualizarConOptimistic } from '@/lib/optimistic-update'
import { ModalConflictoEdicion } from '@/components/ModalConflictoEdicion'
import { BannerError } from '@/components/BannerError'
import { PresenciaEnFicha } from '@/components/PresenciaEnFicha'
import { mensajeErrorAmigable } from '@/lib/utils'

// ── Tipos ────────────────────────────────────────────────────
interface PersonaOption { id: string; nombre: string }
interface PolizaOption  { id: string; numero_poliza: string; asegurado_id: string }
interface SiniestroOption { id: string; numero_caso: string; persona_id: string }

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

export default function EditarTareaPage() {
  const router   = useRouter()
  const params   = useParams()
  const id       = params.id as string
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  const [titulo,      setTitulo]      = useState('')
  const [tipo,        setTipo]        = useState('TAREA_GENERAL')
  const [prioridad,   setPrioridad]   = useState('MEDIA')
  const [descripcion, setDescripcion] = useState('')
  const [estado,      setEstado]      = useState('PENDIENTE')

  const [personaId,    setPersonaId]    = useState('')
  const [polizaId,     setPolizaId]     = useState('')
  const [siniestroId,  setSiniestroId]  = useState('')

  const [fechaVenc,    setFechaVenc]    = useState('')
  const [horaVenc,     setHoraVenc]     = useState('')
  const [recurrencia,  setRecurrencia]  = useState('NINGUNA')

  const [personas,    setPersonas]    = useState<PersonaOption[]>([])
  const [polizas,     setPolizas]     = useState<PolizaOption[]>([])
  const [siniestros,  setSiniestros]  = useState<SiniestroOption[]>([])

  const [cargando,  setCargando]  = useState(true)
  const [errores,   setErrores]   = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)
  const [updatedAtInicial, setUpdatedAtInicial] = useState<string | null>(null)
  const [conflicto, setConflicto] = useState<{ registro_actual: any } | null>(null)
  const [exito,     setExito]     = useState(false)
  const [errorGral, setErrorGral] = useState('')

  // ── Cargar datos ───────────────────────────────────────
  useEffect(() => {
    async function cargar() {
      const [{ data: tarea }, { data: pers }, { data: pols }, { data: sins }] = await Promise.all([
        supabase.from('tareas').select('*').eq('id', id).single(),
        supabase.from('personas').select('id, apellido, nombre, razon_social').order('apellido').limit(500),
        supabase.from('polizas').select('id, numero_poliza, asegurado_id').order('numero_poliza'),
        supabase.from('siniestros').select('id, numero_caso, persona_id').order('numero_caso'),
      ])

      setPersonas(((pers ?? []) as any[]).map(p => ({
        id: p.id,
        nombre: [p.apellido, p.nombre].filter(Boolean).join(', ') || p.razon_social || p.id
      })))
      setPolizas((pols ?? []) as unknown as PolizaOption[])
      setSiniestros((sins ?? []) as unknown as SiniestroOption[])

      if (tarea) {
        // Verificar acceso por cartera
        if (!tieneAccesoTotal(usuario) && tarea.usuario_id && tarea.usuario_id !== usuario?.id) {
          router.replace('/crm/tareas')
          return
        }

        setTitulo(tarea.titulo)
        setTipo(tarea.tipo)
        setPrioridad(tarea.prioridad)
        setDescripcion(tarea.descripcion ?? '')
        setEstado(tarea.estado)
        setPersonaId(tarea.persona_id)
        setPolizaId(tarea.poliza_id ?? '')
        setSiniestroId(tarea.siniestro_id ?? '')
        setFechaVenc(tarea.fecha_vencimiento)
        setHoraVenc(tarea.hora_vencimiento ?? '')
        setRecurrencia(tarea.recurrencia)
        setUpdatedAtInicial((tarea as any).updated_at ?? null)
      }
      setCargando(false)
    }
    cargar()
  }, [supabase, id, usuario, router])

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
  const guardar = async (forzar: boolean = false) => {
    if (!validar()) return
    setGuardando(true); setErrorGral('')
    try {
      const r = await actualizarConOptimistic({
        tabla: 'tareas',
        id: id as string,
        updated_at_inicial: updatedAtInicial,
        forzar,
        cambios: {
          titulo:            titulo.trim(),
          tipo,
          prioridad,
          descripcion:       descripcion.trim() || null,
          estado,
          persona_id:        personaId,
          poliza_id:         polizaId || null,
          siniestro_id:      siniestroId || null,
          fecha_vencimiento: fechaVenc,
          hora_vencimiento:  horaVenc || null,
          recurrencia,
        },
      })
      if (r.conflicto) {
        setConflicto({ registro_actual: r.registro_actual })
        return
      }
      if (!r.ok) throw new Error(r.error || 'Error al guardar')
      // Sincronizar updated_at fresco (v1.0.140) para evitar falso conflicto
      // si el usuario vuelve a guardar sin recargar la ficha.
      if (r.registro_actualizado?.updated_at) {
        setUpdatedAtInicial(r.registro_actualizado.updated_at)
      }
      setExito(true)
      setTimeout(() => router.push('/crm/tareas'), 1200)
    } catch (err: any) {
      setErrorGral(mensajeErrorAmigable(err, 'No se pudo guardar la tarea'))
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return (
    <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
      <Loader2 className="h-4 w-4 animate-spin" /> Cargando tarea...
    </div>
  )

  if (exito) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
        <CheckCircle className="h-6 w-6 text-green-600" />
      </div>
      <p className="text-sm font-medium text-slate-700">Tarea actualizada</p>
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
            <h1 className="text-lg font-semibold text-slate-800">Editar Tarea</h1>
            <p className="text-xs text-slate-500">Modificá los datos de la tarea</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PresenciaEnFicha tipoEntidad="tarea" entidadId={id} modo="editando" />
          <button onClick={() => guardar()} disabled={guardando} className="btn-primary px-5">
            {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            {guardando ? 'Guardando...' : 'Guardar Cambios'}
          </button>
        </div>
      </div>

      <BannerError mensaje={errorGral} onCerrar={() => setErrorGral('')} />

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
          <Campo label="Estado">
            <select className="form-input" value={estado} onChange={e => setEstado(e.target.value)}>
              <option value="PENDIENTE">Pendiente</option>
              <option value="EN_PROCESO">En proceso</option>
              <option value="COMPLETADA">Completada</option>
              <option value="CANCELADA">Cancelada</option>
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
        </div>
      </div>

      {/* Botones */}
      <div className="flex items-center justify-between pb-4">
        <button onClick={() => router.back()} className="btn-secondary">
          <ArrowLeft className="h-3 w-3" /> Cancelar
        </button>
        <button onClick={() => guardar()} disabled={guardando} className="btn-primary px-6">
          {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {guardando ? 'Guardando...' : 'Guardar Cambios'}
        </button>
      </div>

      {conflicto && (
        <ModalConflictoEdicion
          valoresTuyos={{
            titulo, tipo, prioridad, descripcion, estado,
            persona_id: personaId, poliza_id: polizaId, siniestro_id: siniestroId,
            fecha_vencimiento: fechaVenc, hora_vencimiento: horaVenc, recurrencia,
          }}
          registroActual={conflicto.registro_actual}
          labels={{
            titulo: 'Título',
            tipo: 'Tipo',
            prioridad: 'Prioridad',
            descripcion: 'Descripción',
            estado: 'Estado',
            persona_id: 'Cliente',
            poliza_id: 'Póliza',
            siniestro_id: 'Siniestro',
            fecha_vencimiento: 'Vencimiento',
            hora_vencimiento: 'Hora',
            recurrencia: 'Recurrencia',
          }}
          campos={[
            'titulo', 'tipo', 'prioridad', 'descripcion', 'estado',
            'persona_id', 'poliza_id', 'siniestro_id',
            'fecha_vencimiento', 'hora_vencimiento', 'recurrencia',
          ]}
          onCerrar={() => setConflicto(null)}
          onRecargar={() => {
            setConflicto(null)
            window.location.reload()
          }}
          onSobreescribir={() => {
            setConflicto(null)
            guardar(true)
          }}
        />
      )}
    </div>
  )
}
