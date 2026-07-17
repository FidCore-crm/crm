'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Save, Loader2, AlertCircle, CheckCircle, Lock } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { hoyLocal } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { actualizarConOptimistic } from '@/lib/optimistic-update'
import { ModalConflictoEdicion } from '@/components/ModalConflictoEdicion'
import { BannerError } from '@/components/BannerError'
import { PresenciaEnFicha } from '@/components/PresenciaEnFicha'

function Campo({ label, required, error, children }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-slate-600">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && (
        <span className="flex items-center gap-1 text-xs text-red-500">
          <AlertCircle className="h-3 w-3"/> {error}
        </span>
      )}
    </div>
  )
}

export default function EditarOportunidadPage() {
  const router   = useRouter()
  const { id }   = useParams<{ id: string }>()
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  const [tipo,          setTipo]          = useState('')
  const [descripcion,   setDescripcion]   = useState('')
  const [fechaContacto, setFechaContacto] = useState('')
  const [notas,         setNotas]         = useState('')
  const [montoEstimado,        setMontoEstimado]        = useState('')
  const [probabilidadCierre,   setProbabilidadCierre]   = useState('')
  const [fechaEstimadaCierre,  setFechaEstimadaCierre]  = useState('')
  const [estado,        setEstado]        = useState('')
  const [personaNombre, setPersonaNombre] = useState('')

  const [cargando,  setCargando]  = useState(true)
  const [errores,   setErrores]   = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)
  const [exito,     setExito]     = useState(false)
  const [errorGral, setErrorGral] = useState('')
  const [updatedAtInicial, setUpdatedAtInicial] = useState<string | null>(null)
  const [conflicto, setConflicto] = useState<{ registro_actual: any } | null>(null)

  useEffect(() => {
    async function cargar() {
      const { data } = await supabase
        .from('oportunidades')
        .select('*, persona:personas!persona_id(apellido, nombre, dni_cuil)')
        .eq('id', id)
        .single()
      if (data) {
        const d = data as any
        setTipo(d.tipo)
        setDescripcion(d.descripcion ?? '')
        setFechaContacto(d.fecha_proximo_contacto ?? '')
        setNotas(d.notas ?? '')
        setMontoEstimado(d.monto_estimado != null ? String(d.monto_estimado) : '')
        setProbabilidadCierre(d.probabilidad_cierre != null ? String(d.probabilidad_cierre) : '')
        setFechaEstimadaCierre(d.fecha_estimada_cierre ?? '')
        setEstado(d.estado)
        setPersonaNombre(d.persona ? `${d.persona.apellido}, ${d.persona.nombre ?? ''} — ${d.persona.dni_cuil}` : '—')
        setUpdatedAtInicial(d.updated_at ?? null)

        // Access check
        if (usuario && !tieneAccesoTotal(usuario) && d.usuario_id && d.usuario_id !== usuario.id) {
          router.push('/crm/comercial/oportunidades')
          return
        }
      }
      setCargando(false)
    }
    cargar()
  }, [supabase, id, usuario, router])

  const cerrada = estado === 'GANADA' || estado === 'PERDIDA'

  const validar = (): boolean => {
    const e: Record<string, string> = {}
    if (!descripcion.trim()) e.descripcion = 'La descripcion es obligatoria'
    if (montoEstimado !== '') {
      const m = Number(montoEstimado)
      if (Number.isNaN(m) || m < 0) e.monto_estimado = 'Debe ser un número mayor o igual a 0'
    }
    if (probabilidadCierre !== '') {
      const p = Number(probabilidadCierre)
      if (Number.isNaN(p) || p < 0 || p > 100) e.probabilidad_cierre = 'Debe ser un número entre 0 y 100'
    }
    setErrores(e)
    return Object.keys(e).length === 0
  }

  const guardar = async (forzar: boolean = false) => {
    // Defensa en profundidad: la UI desactiva inputs y oculta el botón
    // cuando la oportunidad está cerrada, pero un usuario que manipule el
    // state vía DevTools podría disparar el UPDATE igual. Bloqueamos acá.
    if (cerrada) return
    if (!validar()) return
    setGuardando(true)
    setErrorGral('')

    // Optimistic concurrency: si la oportunidad cambió (incluyendo pasar a
    // GANADA/PERDIDA), el updated_at no matchea y devolvemos conflicto.
    const r = await actualizarConOptimistic({
      tabla: 'oportunidades',
      id: id as string,
      updated_at_inicial: updatedAtInicial,
      forzar,
      cambios: {
        tipo,
        descripcion: descripcion.trim(),
        fecha_proximo_contacto: fechaContacto || null,
        notas: notas.trim() || null,
        monto_estimado: montoEstimado ? Number(montoEstimado) : null,
        probabilidad_cierre: probabilidadCierre !== '' ? Number(probabilidadCierre) : null,
        fecha_estimada_cierre: fechaEstimadaCierre || null,
      },
    })

    if (r.conflicto) {
      setConflicto({ registro_actual: r.registro_actual })
      setGuardando(false)
      return
    }
    if (!r.ok) {
      setErrorGral(`Error al guardar: ${r.error}`)
      setGuardando(false)
      return
    }

    // Sincronizar updated_at fresco (v1.0.140).
    if (r.registro_actualizado?.updated_at) {
      setUpdatedAtInicial(r.registro_actualizado.updated_at)
    }
    setExito(true)
    setGuardando(false)
    setTimeout(() => router.push(`/crm/comercial/oportunidades/${id}`), 1000)
  }

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin"/> Cargando...
      </div>
    )
  }

  if (exito) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <CheckCircle className="h-6 w-6 text-green-600"/>
        </div>
        <p className="text-sm font-medium text-slate-700">Cambios guardados</p>
        <p className="text-xs text-slate-500">Redirigiendo a la ficha...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => router.push(`/crm/comercial/oportunidades/${id}`)} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center" title="Volver">
            <ArrowLeft className="h-3 w-3"/>
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Editar oportunidad</h1>
            <p className="text-xs text-slate-500">Cliente: {personaNombre}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PresenciaEnFicha tipoEntidad="oportunidad" entidadId={id} modo="editando" />
          {!cerrada && (
            <button onClick={() => guardar()} disabled={guardando} className="btn-primary">
              {guardando ? <Loader2 className="h-3 w-3 animate-spin"/> : <Save className="h-3 w-3"/>}
              {guardando ? 'Guardando...' : 'Guardar cambios'}
            </button>
          )}
        </div>
      </div>

      {cerrada && (
        <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <Lock className="h-3.5 w-3.5 shrink-0"/>
          Esta oportunidad esta cerrada ({estado}) y no se puede editar.
        </div>
      )}

      <BannerError mensaje={errorGral} onCerrar={() => setErrorGral('')} />

      {/* Oportunidad */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Oportunidad</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Campo label="Tipo" required>
            <select className="form-input" value={tipo} onChange={e => setTipo(e.target.value)} disabled={cerrada}>
              <option value="CROSS_SELL">Cross-sell</option>
              <option value="RECUPERACION">Recuperacion</option>
              <option value="NUEVA_VENTA">Nueva venta</option>
            </select>
          </Campo>
          <Campo label="Fecha de proximo contacto">
            <input type="date" className="form-input" value={fechaContacto}
              min={hoyLocal()}
              onChange={e => setFechaContacto(e.target.value)} disabled={cerrada}/>
          </Campo>
          <div className="col-span-2">
            <Campo label="Descripcion" required error={errores.descripcion}>
              <textarea className={`form-input w-full resize-none ${errores.descripcion ? 'border-red-300' : ''}`}
                rows={3} value={descripcion}
                onChange={e => { setDescripcion(e.target.value); setErrores(er => ({ ...er, descripcion: '' })) }}
                placeholder="Ej: Ofrecer seguro de hogar, tiene solo automotor"
                disabled={cerrada}/>
            </Campo>
          </div>
        </div>
      </div>

      {/* Estimación de valor */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Estimación de valor</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Campo label="Monto estimado" error={errores.monto_estimado}>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">$</span>
              <input type="number" min={0} step="0.01"
                className={`form-input w-full pl-5 ${errores.monto_estimado ? 'border-red-300' : ''}`}
                value={montoEstimado}
                onChange={e => { setMontoEstimado(e.target.value); setErrores(er => ({ ...er, monto_estimado: '' })) }}
                placeholder="0.00"
                disabled={cerrada}/>
            </div>
            <span className="text-2xs text-slate-500 mt-0.5">Valor anual estimado de la prima si se cierra la venta</span>
          </Campo>
          <Campo label="Probabilidad de cierre" error={errores.probabilidad_cierre}>
            <div className="relative">
              <input type="number" min={0} max={100} step={1}
                className={`form-input w-full pr-6 ${errores.probabilidad_cierre ? 'border-red-300' : ''}`}
                value={probabilidadCierre}
                onChange={e => { setProbabilidadCierre(e.target.value); setErrores(er => ({ ...er, probabilidad_cierre: '' })) }}
                placeholder="50"
                disabled={cerrada}/>
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">%</span>
            </div>
            <span className="text-2xs text-slate-500 mt-0.5">¿Qué tan probable es que esta oportunidad se cierre?</span>
          </Campo>
          <Campo label="Fecha estimada de cierre">
            <input type="date" className="form-input" value={fechaEstimadaCierre}
              min={hoyLocal()}
              onChange={e => setFechaEstimadaCierre(e.target.value)} disabled={cerrada}/>
          </Campo>
        </div>
      </div>

      {/* Notas */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Notas</h3>
        </div>
        <div className="p-4">
          <textarea className="form-input w-full resize-none" rows={3} value={notas}
            onChange={e => setNotas(e.target.value)} placeholder="Observaciones adicionales..."
            disabled={cerrada}/>
        </div>
      </div>

      {/* Botones finales */}
      <div className="flex items-center justify-between pb-4">
        <button onClick={() => router.push(`/crm/comercial/oportunidades/${id}`)} className="btn-secondary">
          <ArrowLeft className="h-3 w-3"/> Cancelar
        </button>
        {!cerrada && (
          <button onClick={() => guardar()} disabled={guardando} className="btn-primary px-6">
            {guardando ? <Loader2 className="h-3 w-3 animate-spin"/> : <Save className="h-3 w-3"/>}
            {guardando ? 'Guardando...' : 'Guardar cambios'}
          </button>
        )}
      </div>

      {conflicto && (
        <ModalConflictoEdicion
          valoresTuyos={{
            tipo, descripcion, fecha_proximo_contacto: fechaContacto, notas,
            monto_estimado: montoEstimado ? Number(montoEstimado) : null,
            probabilidad_cierre: probabilidadCierre !== '' ? Number(probabilidadCierre) : null,
            fecha_estimada_cierre: fechaEstimadaCierre || null,
            estado,
          }}
          registroActual={conflicto.registro_actual}
          labels={{
            tipo: 'Tipo',
            descripcion: 'Descripción',
            fecha_proximo_contacto: 'Próximo contacto',
            notas: 'Notas',
            monto_estimado: 'Monto estimado',
            probabilidad_cierre: 'Probabilidad %',
            fecha_estimada_cierre: 'Fecha estimada cierre',
            estado: 'Estado',
          }}
          campos={[
            'tipo', 'descripcion', 'fecha_proximo_contacto', 'notas',
            'monto_estimado', 'probabilidad_cierre', 'fecha_estimada_cierre', 'estado',
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
