'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Save, Loader2, AlertCircle, CheckCircle, Search, Shield } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { sanitizarBusquedaNormalizada, hoyLocal } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal } from '@/lib/cartera-filter'

interface PersonaBusqueda {
  id: string
  apellido: string
  nombre: string | null
  dni_cuil: string
}

interface PersonaResumen {
  polizas_vigentes: number
  ramos: string[]
  ultima_poliza: string | null
}

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

export default function NuevaOportunidadPageWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20 text-slate-500 text-sm gap-2"><Loader2 className="h-4 w-4 animate-spin"/> Cargando...</div>}>
      <NuevaOportunidadPage/>
    </Suspense>
  )
}

function NuevaOportunidadPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const supabase     = getSupabaseClient()
  const searchRef    = useRef<NodeJS.Timeout>()
  const { usuario }  = useAuth()

  const [personaId,     setPersonaId]     = useState(searchParams.get('persona_id') ?? '')
  const [personaNombre, setPersonaNombre] = useState('')
  const [tipo,          setTipo]          = useState('NUEVA_VENTA')
  const [descripcion,   setDescripcion]   = useState('')
  const [fechaContacto, setFechaContacto] = useState('')
  const [notas,         setNotas]         = useState('')
  const [montoEstimado,        setMontoEstimado]        = useState('')
  const [probabilidadCierre,   setProbabilidadCierre]   = useState('50')
  const [fechaEstimadaCierre,  setFechaEstimadaCierre]  = useState('')

  const [busquedaPersona,  setBusquedaPersona]  = useState('')
  const [resultadosPersona, setResultadosPersona] = useState<PersonaBusqueda[]>([])
  const [buscando,          setBuscando]          = useState(false)
  const [mostrarDropdown,   setMostrarDropdown]   = useState(false)
  const [resumen,           setResumen]           = useState<PersonaResumen | null>(null)

  const [errores,   setErrores]   = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)
  const [exito,     setExito]     = useState(false)
  const [errorGral, setErrorGral] = useState('')

  // Pre-cargar persona si viene por query param
  useEffect(() => {
    const pid = searchParams.get('persona_id')
    if (!pid) return
    async function cargar() {
      // Excluimos personas en papelera: el PAS no debería poder abrir
      // "nueva oportunidad" desde un link viejo apuntando a un cliente
      // ya eliminado.
      const { data } = await supabase
        .from('personas')
        .select('id, apellido, nombre, dni_cuil')
        .eq('id', pid)
        .is('deleted_at', null)
        .single()
      if (data) {
        const p = data as any
        setPersonaId(p.id)
        setPersonaNombre(`${p.apellido}, ${p.nombre ?? ''} — ${p.dni_cuil}`)
        setBusquedaPersona(`${p.apellido}, ${p.nombre ?? ''}`)
        cargarResumen(p.id)
      }
    }
    cargar()
    // cargarResumen se define más abajo pero es una función estable (no cambia
    // entre renders). Solo queremos correr al montar / cambiar searchParams.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, searchParams])

  // Buscar personas
  useEffect(() => {
    clearTimeout(searchRef.current)
    if (!busquedaPersona || busquedaPersona.length < 2) {
      setResultadosPersona([])
      setMostrarDropdown(false)
      return
    }
    searchRef.current = setTimeout(async () => {
      setBuscando(true)
      const safeBusq = sanitizarBusquedaNormalizada(busquedaPersona)
      if (!safeBusq) {
        setResultadosPersona([])
        setMostrarDropdown(false)
        setBuscando(false)
        return
      }
      let qPersonas = supabase
        .from('personas')
        .select('id, apellido, nombre, dni_cuil')
        .is('deleted_at', null)
        .or(`apellido_norm.ilike.%${safeBusq}%,nombre_norm.ilike.%${safeBusq}%,dni_cuil.ilike.%${safeBusq}%`)
        .eq('estado', 'ACTIVO')
        .limit(10)
      if (usuario && !tieneAccesoTotal(usuario)) {
        qPersonas = qPersonas.eq("usuario_id", usuario.id)
      }
      const { data } = await qPersonas
      setResultadosPersona((data ?? []) as PersonaBusqueda[])
      setMostrarDropdown(true)
      setBuscando(false)
    }, 350)
  }, [busquedaPersona, supabase, usuario])

  const cargarResumen = async (pid: string) => {
    const { data: pols } = await supabase
      .from('polizas')
      .select('id, numero_poliza, estado, ramo:catalogos!ramo_id(nombre)')
      .eq('asegurado_id', pid)
      .order('created_at', { ascending: false })

    const polsList = (pols ?? []) as any[]
    const vigentes = polsList.filter(p => p.estado === 'VIGENTE')
    const ramosSet = new Set(vigentes.map(p => p.ramo?.nombre).filter(Boolean))
    const ramos = Array.from(ramosSet) as string[]
    setResumen({
      polizas_vigentes: vigentes.length,
      ramos,
      ultima_poliza: polsList[0]?.numero_poliza ?? null,
    })
  }

  const seleccionarPersona = (p: PersonaBusqueda) => {
    setPersonaId(p.id)
    setPersonaNombre(`${p.apellido}, ${p.nombre ?? ''} — ${p.dni_cuil}`)
    setBusquedaPersona(`${p.apellido}, ${p.nombre ?? ''}`)
    setMostrarDropdown(false)
    setErrores(e => ({ ...e, persona: '' }))
    cargarResumen(p.id)
  }

  const validar = (): boolean => {
    const e: Record<string, string> = {}
    if (!personaId)           e.persona     = 'Seleccioná un cliente'
    if (!descripcion.trim())  e.descripcion = 'La descripción es obligatoria'
    // Aunque los inputs tienen min/max, validamos también en el submit por
    // si el navegador acepta valores fuera de rango (paste, autofill o
    // tampering). La DB tiene CHECK probabilidad_cierre BETWEEN 0 AND 100,
    // pero un error de constraint da feedback opaco al PAS.
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

  const guardar = async () => {
    if (!validar()) return
    setGuardando(true)
    setErrorGral('')

    const { data, error } = await supabase
      .from('oportunidades')
      .insert({
        persona_id: personaId,
        tipo,
        fuente: 'MANUAL',
        estado: 'DETECTADA',
        descripcion: descripcion.trim(),
        fecha_proximo_contacto: fechaContacto || null,
        notas: notas.trim() || null,
        monto_estimado: montoEstimado ? Number(montoEstimado) : null,
        probabilidad_cierre: probabilidadCierre !== '' ? Number(probabilidadCierre) : null,
        fecha_estimada_cierre: fechaEstimadaCierre || null,
        usuario_id: usuario?.id ?? null,
      })
      .select('id')
      .single()

    if (error) {
      setErrorGral(`Error al guardar: ${error.message}`)
      setGuardando(false)
      return
    }

    setExito(true)
    setGuardando(false)
    setTimeout(() => router.push(`/crm/comercial/oportunidades/${(data as any).id}`), 1000)
  }

  if (exito) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <CheckCircle className="h-6 w-6 text-green-600"/>
        </div>
        <p className="text-sm font-medium text-slate-700">Oportunidad creada</p>
        <p className="text-xs text-slate-600">Redirigiendo a la ficha...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/crm/comercial/oportunidades')} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center" title="Volver">
            <ArrowLeft className="h-3 w-3"/>
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Nueva oportunidad</h1>
            <p className="text-xs text-slate-600">Registrar oportunidad de venta manual</p>
          </div>
        </div>
        <button onClick={guardar} disabled={guardando} className="btn-primary">
          {guardando ? <Loader2 className="h-3 w-3 animate-spin"/> : <Save className="h-3 w-3"/>}
          {guardando ? 'Guardando...' : 'Guardar oportunidad'}
        </button>
      </div>

      {errorGral && (
        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0"/> {errorGral}
        </div>
      )}

      {/* Cliente */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Cliente</h3>
        </div>
        <div className="p-4">
          <Campo label="Cliente" required error={errores.persona}>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500"/>
              <input className={`form-input w-full pl-7 ${errores.persona ? 'border-red-300' : ''}`}
                value={busquedaPersona}
                onChange={e => { setBusquedaPersona(e.target.value); if (personaId) { setPersonaId(''); setResumen(null) } }}
                placeholder="Buscar por nombre, apellido o DNI..."
              />
              {buscando && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-slate-500"/>}
              {mostrarDropdown && resultadosPersona.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded shadow-lg max-h-48 overflow-y-auto">
                  {resultadosPersona.map(p => (
                    <button key={p.id} onClick={() => seleccionarPersona(p)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 border-b border-slate-50 last:border-0">
                      <span className="font-medium text-slate-700">{p.apellido}, {p.nombre ?? ''}</span>
                      <span className="text-slate-500 ml-2 font-mono">{p.dni_cuil}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Campo>

          {personaId && resumen && (
            <div className="mt-3 bg-blue-50 border border-blue-200 rounded p-3 flex items-center gap-3">
              <Shield className="h-4 w-4 text-blue-500 shrink-0"/>
              <div className="text-xs text-blue-700">
                <p className="font-medium">{personaNombre}</p>
                <p className="text-blue-500 mt-0.5">
                  {resumen.polizas_vigentes} póliza{resumen.polizas_vigentes !== 1 ? 's' : ''} vigente{resumen.polizas_vigentes !== 1 ? 's' : ''}
                  {resumen.ramos.length > 0 && ` · Ramos: ${resumen.ramos.join(', ')}`}
                  {resumen.ultima_poliza && ` · Última: ${resumen.ultima_poliza}`}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Oportunidad */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Oportunidad</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Campo label="Tipo" required>
            <select className="form-input" value={tipo} onChange={e => setTipo(e.target.value)}>
              <option value="CROSS_SELL">Cross-sell</option>
              <option value="RECUPERACION">Recuperación</option>
              <option value="NUEVA_VENTA">Nueva venta</option>
            </select>
          </Campo>
          <Campo label="Fecha de próximo contacto">
            <input type="date" className="form-input" value={fechaContacto}
              min={hoyLocal()}
              onChange={e => setFechaContacto(e.target.value)}/>
          </Campo>
          <div className="col-span-2">
            <Campo label="Descripción" required error={errores.descripcion}>
              <textarea className={`form-input w-full resize-none ${errores.descripcion ? 'border-red-300' : ''}`}
                rows={3} value={descripcion} onChange={e => { setDescripcion(e.target.value); setErrores(er => ({ ...er, descripcion: '' })) }}
                placeholder="Ej: Ofrecer seguro de hogar, tiene solo automotor"/>
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
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">$</span>
              <input type="number" min={0} step="0.01"
                className={`form-input w-full pl-5 ${errores.monto_estimado ? 'border-red-300' : ''}`}
                value={montoEstimado}
                onChange={e => { setMontoEstimado(e.target.value); setErrores(er => ({ ...er, monto_estimado: '' })) }}
                placeholder="0.00"/>
            </div>
            <span className="text-2xs text-slate-600 mt-0.5">Valor anual estimado de la prima si se cierra la venta</span>
          </Campo>
          <Campo label="Probabilidad de cierre" error={errores.probabilidad_cierre}>
            <div className="relative">
              <input type="number" min={0} max={100} step={1}
                className={`form-input w-full pr-6 ${errores.probabilidad_cierre ? 'border-red-300' : ''}`}
                value={probabilidadCierre}
                onChange={e => { setProbabilidadCierre(e.target.value); setErrores(er => ({ ...er, probabilidad_cierre: '' })) }}
                placeholder="50"/>
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">%</span>
            </div>
            <span className="text-2xs text-slate-600 mt-0.5">¿Qué tan probable es que esta oportunidad se cierre?</span>
          </Campo>
          <Campo label="Fecha estimada de cierre">
            <input type="date" className="form-input" value={fechaEstimadaCierre}
              min={hoyLocal()}
              onChange={e => setFechaEstimadaCierre(e.target.value)}/>
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
            onChange={e => setNotas(e.target.value)} placeholder="Observaciones adicionales..."/>
        </div>
      </div>

      {/* Botones finales */}
      <div className="flex items-center justify-between pb-4">
        <button onClick={() => router.push('/crm/comercial/oportunidades')} className="btn-secondary">
          <ArrowLeft className="h-3 w-3"/> Cancelar
        </button>
        <button onClick={guardar} disabled={guardando} className="btn-primary px-6">
          {guardando ? <Loader2 className="h-3 w-3 animate-spin"/> : <Save className="h-3 w-3"/>}
          {guardando ? 'Guardando...' : 'Guardar oportunidad'}
        </button>
      </div>
    </div>
  )
}
