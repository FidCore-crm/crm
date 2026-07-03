'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, Save, Loader2, AlertCircle, CheckCircle,
  Car, Home, Heart, Package, Plus, Trash2
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { validarPatente } from '@/lib/importacion/validators'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { apiCall } from '@/lib/api-client'
import BuscadorPersona from '@/components/BuscadorPersona'
import { ModalConflictoEdicion } from '@/components/ModalConflictoEdicion'
import { tipoRenderForm } from '@/lib/tipos-riesgo'
import { CamposBienAseguradoDinamico, validarCamposDinamicos } from '@/components/CamposBienAseguradoDinamico'
import { opcionesRefacturacion } from '@/lib/refacturaciones'
import { opcionesMedioPago } from '@/lib/medios-pago'
import { vigenciaTextoDesdeFechas } from '@/lib/vigencia'

interface Catalogo { id: string; nombre: string; metadata?: Record<string, any> | null }

interface FormPoliza {
  persona_id: string; compania_id: string; ramo_id: string; cobertura_id: string
  numero_poliza: string
  fecha_inicio: string; fecha_fin: string
  refacturacion: string
  medio_pago: string
  suma_asegurada: string
  moneda: string
  mostrar_suma_asegurada_portal: boolean
  observaciones: string; notas: string
}

interface FormRiesgo {
  patente: string; marca: string; modelo: string; anio: string
  motor: string; chasis: string; color: string; uso: string
  calle: string; numero: string; localidad: string; provincia: string
  tipo_construccion: string; superficie: string; medidas_seguridad: string[]
  capital_asegurado: string; beneficiarios: string
  descripcion: string
  detalle_dinamico: Record<string, any>
}

const ICONOS: Record<string, React.ReactNode> = {
  automotor: <Car className="h-4 w-4" />,
  hogar:     <Home className="h-4 w-4" />,
  vida:      <Heart className="h-4 w-4" />,
  generico:  <Package className="h-4 w-4" />,
}

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

export default function EditarPolizaPage() {
  const router   = useRouter()
  const params   = useParams()
  const id       = params.id as string
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  const [poliza,    setPoliza]    = useState<FormPoliza | null>(null)
  const [updatedAtInicial, setUpdatedAtInicial] = useState<string | null>(null)
  const [conflicto, setConflicto] = useState<{ registro_actual: any } | null>(null)
  // Soporte multi-riesgo (flotas): cada póliza puede tener N riesgos.
  // Cada item tiene id (null si recién creado), datos del form, tipo, y flag eliminado
  // (los marcados se borran al guardar pero se mantienen en state para poder revertir).
  type RiesgoItem = { id: string | null; tipo: string; datos: FormRiesgo; eliminado: boolean }
  const [riesgos, setRiesgos] = useState<RiesgoItem[]>([])
  const [indiceActivo, setIndiceActivo] = useState(0)
  const [errores,   setErrores]   = useState<Record<string, string>>({})
  const [avisos,    setAvisos]    = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)
  const [exito,     setExito]     = useState(false)
  const [errorGral, setErrorGral] = useState('')
  const [cargando,  setCargando]  = useState(true)

  const [companias,      setCompanias]      = useState<Catalogo[]>([])
  const [ramos,          setRamos]          = useState<Catalogo[]>([])
  const [coberturas,     setCoberturas]     = useState<Catalogo[]>([])
  const [tipoRiesgo,     setTipoRiesgo]     = useState('generico')
  // Render del form de póliza: mapea los 7 tipos a los 4 renders existentes.
  const renderTipo = tipoRenderForm(tipoRiesgo)
  const [ramoNombre,     setRamoNombre]     = useState('')

  // Cargar catálogos
  useEffect(() => {
    async function cargarCatalogos() {
      const { data: tipos } = await supabase.from('tipo_catalogo').select('id, codigo')
      if (!tipos) return

      const tipoComp   = tipos.find((t: any) => t.codigo === 'COMPANIA')
      const tipoRamo   = tipos.find((t: any) => t.codigo === 'RAMO')
      const tipoCobert = tipos.find((t: any) => t.codigo === 'COBERTURA')

      const [{ data: comps }, { data: rams }, { data: cobs }] = await Promise.all([
        tipoComp
          ? supabase.from('catalogos').select('id,nombre,metadata').eq('tipo_id', tipoComp.id).eq('activo', true).order('nombre')
          : Promise.resolve({ data: [] }),
        tipoRamo
          ? supabase.from('catalogos').select('id,nombre,metadata').eq('tipo_id', tipoRamo.id).eq('activo', true).order('nombre')
          : Promise.resolve({ data: [] }),
        tipoCobert
          ? supabase.from('catalogos').select('id,nombre,metadata').eq('tipo_id', tipoCobert.id).eq('activo', true).order('nombre')
          : Promise.resolve({ data: [] }),
      ])

      setCompanias((comps ?? []) as Catalogo[])
      setRamos((rams ?? []) as Catalogo[])
      setCoberturas((cobs ?? []) as Catalogo[])
    }
    cargarCatalogos()
  }, [supabase, usuario])

  // Cargar póliza existente
  const cargarPoliza = useCallback(async () => {
    setCargando(true)
    const { data: pol } = await supabase.from('polizas').select(`
      id, numero_poliza, asegurado_id, compania_id, ramo_id, cobertura_id,
      fecha_inicio, fecha_fin, refacturacion, medio_pago, suma_asegurada, moneda, mostrar_suma_asegurada_portal,
      observaciones, notas, updated_at,
      ramo:catalogos!ramo_id (id, nombre, metadata),
      riesgos (id, tipo_riesgo, detalle_tecnico)
    `).eq('id', id).single()

    if (pol) {
      // Verificar acceso por cartera
      const p = pol as any
      if (usuario && !tieneAccesoTotal(usuario) && p.asegurado_id) {
        const { data: persona } = await supabase.from('personas').select('usuario_id').eq('id', p.asegurado_id).single()
        if (persona && (persona as any).usuario_id && (persona as any).usuario_id !== usuario.id) {
          router.push('/crm/polizas')
          return
        }
      }
      setPoliza({
        persona_id: p.asegurado_id ?? '',
        compania_id: p.compania_id ?? '',
        ramo_id: p.ramo_id ?? '',
        cobertura_id: p.cobertura_id ?? '',
        numero_poliza: p.numero_poliza ?? '',
        fecha_inicio: p.fecha_inicio ?? '',
        fecha_fin: p.fecha_fin ?? '',
        refacturacion: p.refacturacion ?? '',
        medio_pago: p.medio_pago ?? '',
        suma_asegurada: p.suma_asegurada != null ? String(p.suma_asegurada) : '',
        moneda: p.moneda ?? 'ARS',
        mostrar_suma_asegurada_portal: p.mostrar_suma_asegurada_portal ?? false,
        observaciones: p.observaciones ?? '',
        notas: p.notas ?? '',
      })
      setUpdatedAtInicial(p.updated_at ?? null)

      const tipo = p.ramo?.metadata?.tipo_riesgo ?? 'generico'
      setTipoRiesgo(tipo)
      setRamoNombre(p.ramo?.nombre ?? '')

      // Cargar TODOS los riesgos (multi-riesgo / flotas)
      const str = (v: any) => (v == null ? '' : String(v))
      const aFormRiesgo = (dt: any): FormRiesgo => ({
        patente: str(dt?.patente), marca: str(dt?.marca), modelo: str(dt?.modelo),
        anio: str(dt?.anio), motor: str(dt?.motor), chasis: str(dt?.chasis),
        color: str(dt?.color), uso: str(dt?.uso) || 'PARTICULAR',
        calle: str(dt?.calle), numero: str(dt?.numero), localidad: str(dt?.localidad),
        provincia: str(dt?.provincia) || 'Buenos Aires',
        tipo_construccion: str(dt?.tipo_construccion) || 'MAMPOSTERIA',
        superficie: str(dt?.superficie),
        medidas_seguridad: Array.isArray(dt?.medidas_seguridad) ? dt.medidas_seguridad : [],
        capital_asegurado: str(dt?.capital_asegurado), beneficiarios: str(dt?.beneficiarios),
        descripcion: str(dt?.descripcion),
        // El bucket dinámico se pre-carga con el detalle completo del JSONB.
        // Si el tipo de riesgo es uno con render dinámico, el componente sabe
        // qué claves dibujar; el resto de las claves quedan persistidas sin
        // pisarse para evitar perder datos cruzados.
        detalle_dinamico: (dt && typeof dt === 'object') ? { ...dt } : {},
      })
      const RIESGO_VACIO_DATOS: FormRiesgo = {
        patente: '', marca: '', modelo: '', anio: '', motor: '', chasis: '', color: '', uso: 'PARTICULAR',
        calle: '', numero: '', localidad: '', provincia: 'Buenos Aires',
        tipo_construccion: 'MAMPOSTERIA', superficie: '', medidas_seguridad: [],
        capital_asegurado: '', beneficiarios: '', descripcion: '',
        detalle_dinamico: {},
      }
      const lista: RiesgoItem[] = (p.riesgos ?? []).map((r: any) => ({
        id: r.id,
        tipo: typeof r.tipo_riesgo === 'string' ? r.tipo_riesgo.toLowerCase() : tipo,
        datos: aFormRiesgo(r.detalle_tecnico ?? {}),
        eliminado: false,
      }))
      // Si la póliza no tenía riesgos cargados, arrancar con uno vacío del tipo del ramo.
      if (lista.length === 0) {
        lista.push({ id: null, tipo, datos: { ...RIESGO_VACIO_DATOS }, eliminado: false })
      }
      setRiesgos(lista)
      setIndiceActivo(0)
    }
    setCargando(false)
  }, [supabase, id, usuario, router])

  useEffect(() => { cargarPoliza() }, [cargarPoliza])

  // Cuando cambia el ramo, actualizar tipo riesgo
  useEffect(() => {
    if (!poliza) return
    const r = ramos.find(r => r.id === poliza.ramo_id)
    setRamoNombre(r?.nombre ?? '')
    setTipoRiesgo(r?.metadata?.tipo_riesgo ?? 'generico')
  }, [poliza?.ramo_id, ramos])

  // Filtrar coberturas por ramo
  const coberturasFiltradas = poliza?.ramo_id
    ? coberturas.filter(c => {
        const ramoIds = (c.metadata ?? {}).ramo_ids as string[] | undefined
        return ramoIds && ramoIds.includes(poliza.ramo_id)
      })
    : []

  const setP = (k: keyof FormPoliza, v: string | boolean) => {
    setPoliza(p => p ? { ...p, [k]: v } : p)
    setErrores(e => ({ ...e, [k]: '' }))
  }

  // Riesgo activo (el que se está editando en este momento)
  const riesgoActivo = riesgos[indiceActivo]
  const datosRiesgo = riesgoActivo?.datos ?? null

  const setR = (k: keyof FormRiesgo, v: any) => {
    setRiesgos(prev => prev.map((r, i) => i === indiceActivo ? { ...r, datos: { ...r.datos, [k]: v } } : r))
    setErrores(e => ({ ...e, [`r_${k}`]: '' }))
  }

  const RIESGO_VACIO: FormRiesgo = {
    patente: '', marca: '', modelo: '', anio: '', motor: '', chasis: '', color: '', uso: 'PARTICULAR',
    calle: '', numero: '', localidad: '', provincia: 'Buenos Aires',
    tipo_construccion: 'MAMPOSTERIA', superficie: '', medidas_seguridad: [],
    capital_asegurado: '', beneficiarios: '', descripcion: '',
    detalle_dinamico: {},
  }

  const agregarRiesgo = () => {
    setRiesgos(prev => [...prev, { id: null, tipo: tipoRiesgo, datos: { ...RIESGO_VACIO }, eliminado: false }])
    setIndiceActivo(riesgos.length) // el recién agregado
    setErrores({})
  }

  const eliminarRiesgo = (idx: number) => {
    const visibles = riesgos.filter(r => !r.eliminado)
    if (visibles.length <= 1) return // siempre dejamos al menos uno
    setRiesgos(prev => prev.map((r, i) => i === idx ? { ...r, eliminado: true } : r))
    // Mover el activo al primer riesgo no eliminado
    const proximo = riesgos.findIndex((r, i) => i !== idx && !r.eliminado)
    if (proximo >= 0) setIndiceActivo(proximo)
  }

  const validar = () => {
    if (!poliza) return false
    const e: Record<string, string> = {}
    if (!poliza.persona_id)           e.persona_id    = 'Seleccioná el asegurado'
    if (!poliza.compania_id)          e.compania_id   = 'Seleccioná la compañía'
    if (!poliza.ramo_id)              e.ramo_id       = 'Seleccioná el ramo'
    if (!poliza.numero_poliza.trim()) e.numero_poliza = 'El número de póliza es obligatorio'
    if (!poliza.fecha_inicio)         e.fecha_inicio  = 'Fecha de inicio obligatoria'
    if (!poliza.fecha_fin)            e.fecha_fin     = 'Fecha de fin de vigencia obligatoria'
    if (poliza.fecha_inicio && poliza.fecha_fin && poliza.fecha_fin <= poliza.fecha_inicio) {
      e.fecha_fin = 'La fecha de fin debe ser posterior a la fecha de inicio'
    }
    const a: Record<string,string> = {}

    // Validar TODOS los riesgos no eliminados. Si alguno falla, mostramos el error
    // del primero en fallar y cambiamos el activo a ese.
    const visibles = riesgos.map((r, i) => ({ ...r, _idx: i })).filter(r => !r.eliminado)
    for (const r of visibles) {
      const datos = r.datos
      const errR: Record<string, string> = {}
      if (renderTipo === 'automotor') {
        if (!datos.patente.trim()) errR.r_patente = 'La patente es obligatoria'
        else if (datos.patente.trim().length >= 6) {
          const resPatente = validarPatente(datos.patente)
          if (!resPatente.valido) a.r_patente = 'Formato de patente no reconocido (esperado: ABC123 o AB123CD)'
        }
        if (!datos.marca.trim())   errR.r_marca   = 'La marca es obligatoria'
        if (!datos.modelo.trim())  errR.r_modelo  = 'El modelo es obligatorio'
        if (!datos.anio.trim())    errR.r_anio    = 'El año es obligatorio'
      } else if (renderTipo === 'hogar') {
        if (!datos.calle.trim())     errR.r_calle     = 'La calle es obligatoria'
        if (!datos.localidad.trim()) errR.r_localidad = 'La localidad es obligatoria'
      } else if (renderTipo === 'dinamico') {
        Object.assign(errR, validarCamposDinamicos(tipoRiesgo, datos.detalle_dinamico))
      }
      if (Object.keys(errR).length > 0) {
        Object.assign(e, errR)
        // Saltar al riesgo que tiene errores
        if (r._idx !== indiceActivo) setIndiceActivo(r._idx)
        break
      }
    }

    setErrores(e)
    setAvisos(a)
    return Object.keys(e).length === 0
  }

  const detalleDe = (tipo: string, datos: FormRiesgo): Record<string, any> => {
    // Base: preservamos las keys "extras" que estaban en el detalle_tecnico
    // original y que este form NO edita (típicamente `observaciones` que
    // agrega la IA al importar/procesar PDF, más cualquier otro campo suelto
    // que las compañías incluyen). Sin este merge, al guardar la póliza se
    // pierde toda esa información.
    const base = datos.detalle_dinamico && typeof datos.detalle_dinamico === 'object'
      ? { ...datos.detalle_dinamico }
      : {}

    // Los campos del form pisan los del base — el form es la fuente de verdad
    // para las keys que sí edita.
    if (tipo === 'automotor') {
      return {
        ...base,
        patente: datos.patente.toUpperCase().replace(/\s/g, ''),
        marca: datos.marca,
        modelo: datos.modelo,
        anio: datos.anio,
        motor: datos.motor || null,
        chasis: datos.chasis || null,
        color: datos.color || null,
        uso: datos.uso,
      }
    }
    if (tipo === 'hogar') {
      return {
        ...base,
        calle: datos.calle,
        numero: datos.numero || null,
        localidad: datos.localidad,
        provincia: datos.provincia,
        tipo_construccion: datos.tipo_construccion,
        superficie: datos.superficie || null,
        medidas_seguridad: datos.medidas_seguridad,
      }
    }
    if (tipo === 'vida') {
      return {
        ...base,
        capital_asegurado: datos.capital_asegurado || null,
        beneficiarios: datos.beneficiarios || null,
      }
    }
    if (tipo === 'dinamico') {
      return { ...datos.detalle_dinamico }
    }
    // Genérico: preserva TODO el base + agrega/pisa descripcion si vino del form.
    return {
      ...base,
      descripcion: datos.descripcion || null,
    }
  }

  const guardar = async (forzar: boolean = false) => {
    if (!poliza || !validar()) return
    setGuardando(true); setErrorGral('')
    try {
      // Chequeo de duplicado: no permitir mismo numero_poliza en la misma compañía
      // (excluyendo la propia póliza). Está permitido que dos compañías usen el mismo número.
      const { data: existente } = await supabase
        .from('polizas')
        .select('id')
        .eq('compania_id', poliza.compania_id)
        .eq('numero_poliza', poliza.numero_poliza.trim())
        .neq('id', id)
        .maybeSingle()
      if (existente) {
        setErrores(e => ({ ...e, numero_poliza: 'Ya existe una póliza con este número en esta compañía' }))
        setGuardando(false)
        return
      }

      // Construir array de riesgos a enviar al endpoint:
      //  - Items con id + eliminado=true → DELETE en backend.
      //  - Items con id + no eliminado  → UPDATE.
      //  - Items sin id + no eliminado  → INSERT.
      //  - Items sin id + eliminado     → se descartan acá (no llegaron a persistirse).
      const riesgosPayload = riesgos
        .filter(r => !(r.eliminado && !r.id))
        .map(r => ({
          id: r.id ?? undefined,
          tipo_riesgo: tipoRiesgo.toUpperCase(),
          detalle_tecnico: detalleDe(renderTipo, r.datos),
          _eliminado: r.eliminado || undefined,
        }))

      const body: Record<string, any> = {
        asegurado_id:     poliza.persona_id,
        compania_id:      poliza.compania_id,
        ramo_id:          poliza.ramo_id,
        cobertura_id:     poliza.cobertura_id || null,
        numero_poliza:    poliza.numero_poliza.trim(),
        fecha_inicio:     poliza.fecha_inicio,
        fecha_fin:        poliza.fecha_fin,
        refacturacion:    poliza.refacturacion || null,
        medio_pago:       poliza.medio_pago || null,
        suma_asegurada:   poliza.suma_asegurada ? parseFloat(poliza.suma_asegurada) : null,
        moneda:           poliza.moneda || 'ARS',
        mostrar_suma_asegurada_portal: poliza.mostrar_suma_asegurada_portal,
        observaciones:    poliza.observaciones || null,
        notas:            poliza.notas || null,
        riesgos: riesgosPayload,
      }
      // Optimistic concurrency check (#81)
      if (updatedAtInicial && !forzar) body.if_match_updated_at = updatedAtInicial
      if (forzar) body.force_overwrite = true

      const r = await apiCall(`/api/polizas/${id}`, {
        method: 'PATCH',
        body,
      }, { mostrar_toast_en_error: false })

      if (!r.ok) {
        const err = r.error as any
        // Conflicto de concurrencia (#81)
        if (err?.codigo === 'ERR_NEG_004' && err?.registro_actual) {
          setConflicto({ registro_actual: err.registro_actual })
          return
        }
        const msg = err?.mensaje || 'Error al guardar'
        // Detalle específico para violación del UNIQUE compuesto compañía+nro
        // (defensa por si pasa por una carrera entre nuestro chequeo previo y el INSERT).
        if ((err?.detalle ?? '').includes('uq_poliza_compania_numero')) {
          setErrores(e => ({ ...e, numero_poliza: 'Ya existe una póliza con este número en esta compañía' }))
        } else {
          setErrorGral(msg)
        }
        return
      }

      setExito(true)
      setTimeout(() => router.push(`/crm/polizas/${id}`), 1200)
    } catch (err: any) {
      setErrorGral(`Error: ${err?.message ?? 'desconocido'}`)
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) return (
    <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
      <Loader2 className="h-4 w-4 animate-spin" /> Cargando póliza...
    </div>
  )

  if (!poliza || !datosRiesgo) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <span className="text-slate-400 text-sm">Póliza no encontrada</span>
      <button onClick={() => router.push('/crm/polizas')} className="btn-secondary">
        <ArrowLeft className="h-3 w-3" /> Volver al listado
      </button>
    </div>
  )

  if (exito) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
        <CheckCircle className="h-6 w-6 text-green-600" />
      </div>
      <p className="text-sm font-medium text-slate-700">Póliza actualizada</p>
      <p className="text-xs text-slate-500">Redirigiendo a la ficha...</p>
    </div>
  )

  const ic = (k: string) => `form-input ${errores[k] ? 'border-red-300' : ''}`

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => router.push(`/crm/polizas/${id}`)} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center" title="Volver">
            <ArrowLeft className="h-3 w-3" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Editar Póliza</h1>
            <p className="text-xs text-slate-500 font-mono">{poliza.numero_poliza}</p>
          </div>
        </div>
        <button onClick={() => guardar()} disabled={guardando} className="btn-primary px-5">
          {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {guardando ? 'Guardando...' : 'Guardar Cambios'}
        </button>
      </div>

      {errorGral && (
        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />{errorGral}
        </div>
      )}

      {/* Asegurado y Cobertura */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Asegurado y Cobertura</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Campo label="Asegurado" required error={errores.persona_id} col={2}>
            <BuscadorPersona
              value={poliza.persona_id}
              onChange={(id) => setP('persona_id', id)}
              invalido={!!errores.persona_id}
            />
          </Campo>
          <Campo label="Compañía" required error={errores.compania_id}>
            <select className={ic('compania_id')} value={poliza.compania_id} onChange={e => setP('compania_id', e.target.value)}>
              <option value="">— Seleccioná —</option>
              {companias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Ramo" required error={errores.ramo_id}>
            <select className={ic('ramo_id')} value={poliza.ramo_id} onChange={e => setP('ramo_id', e.target.value)}>
              <option value="">— Seleccioná —</option>
              {ramos.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Cobertura" col={2}>
            <select className="form-input" value={poliza.cobertura_id} onChange={e => setP('cobertura_id', e.target.value)}
              disabled={!poliza.ramo_id}>
              <option value="">
                {!poliza.ramo_id ? 'Seleccioná un ramo primero' : '— Seleccioná —'}
              </option>
              {poliza.ramo_id && coberturasFiltradas.length === 0
                ? <option disabled>Sin coberturas para este ramo</option>
                : coberturasFiltradas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)
              }
            </select>
          </Campo>
        </div>
      </div>

      {/* Datos de la póliza */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Datos de la Póliza</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Campo label="Número de Póliza" required error={errores.numero_poliza} col={2}>
            <input className={`${ic('numero_poliza')} font-mono`} value={poliza.numero_poliza} onChange={e => setP('numero_poliza', e.target.value)} placeholder="12345678" />
          </Campo>
          <Campo label="Fecha de inicio de vigencia" required error={errores.fecha_inicio}>
            <input type="date" className={ic('fecha_inicio')} value={poliza.fecha_inicio} onChange={e => setP('fecha_inicio', e.target.value)} />
          </Campo>
          <Campo label="Fecha de fin de vigencia" required error={errores.fecha_fin}>
            <input type="date" className={ic('fecha_fin')} value={poliza.fecha_fin} onChange={e => setP('fecha_fin', e.target.value)} />
          </Campo>
          <Campo label="Refacturación">
            <select className="form-input" value={poliza.refacturacion} onChange={e => setP('refacturacion', e.target.value)}>
              <option value="">— Seleccioná —</option>
              {opcionesRefacturacion().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Campo>
          <Campo label="Medio de pago">
            <select className="form-input" value={poliza.medio_pago} onChange={e => setP('medio_pago', e.target.value)}>
              <option value="">— Seleccioná —</option>
              {opcionesMedioPago().map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
            </select>
          </Campo>
          <Campo label="Vigencia">
            <div className="form-input bg-slate-50 text-slate-600 flex items-center">
              {poliza.fecha_inicio && poliza.fecha_fin
                ? vigenciaTextoDesdeFechas(poliza.fecha_inicio, poliza.fecha_fin)
                : <span className="text-slate-400">Se calcula con las fechas</span>}
            </div>
          </Campo>
          <Campo label="Suma asegurada">
            <div className="flex gap-1">
              <select className="form-input rounded-r-none w-20" value={poliza.moneda} onChange={e => setP('moneda', e.target.value)}>
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
              </select>
              <input className="form-input font-mono rounded-l-none flex-1"
                value={poliza.suma_asegurada}
                onChange={e => setP('suma_asegurada', e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="0" inputMode="decimal"/>
            </div>
          </Campo>
          <Campo label="Mostrar en el portal del asegurado" col={2}>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox"
                checked={poliza.mostrar_suma_asegurada_portal}
                onChange={e => setP('mostrar_suma_asegurada_portal', e.target.checked)}
                className="mt-0.5"/>
              <span className="text-xs text-slate-600 leading-tight">
                Permitir que el asegurado vea la suma asegurada en el portal.
                <span className="block text-slate-400 mt-0.5">
                  Recomendado para sumas fijas (hogar, robo de bien no registrable, etc.).
                  Dejar destildado si la suma varía mes a mes (típico en auto).
                </span>
              </span>
            </label>
          </Campo>
        </div>
      </div>

      {/* Riesgo dinámico (con soporte multi-riesgo / flotas) */}
      {poliza.ramo_id && (
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
            {ICONOS[tipoRiesgo] ?? ICONOS.generico}
            <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              {riesgos.filter(r => !r.eliminado).length > 1
                ? `Riesgos (${riesgos.filter(r => !r.eliminado).length}) — ${ramoNombre}`
                : `Datos del Riesgo — ${ramoNombre}`}
            </h3>
            <button
              type="button"
              onClick={agregarRiesgo}
              className="ml-auto btn-secondary text-xs flex items-center gap-1"
              title="Agregar otro riesgo a esta póliza (flotas, múltiples bienes, etc.)"
            >
              <Plus className="h-3 w-3" /> Agregar riesgo
            </button>
          </div>

          {/* Tabs de riesgos cuando hay más de uno */}
          {riesgos.filter(r => !r.eliminado).length > 1 && (
            <div className="px-4 pt-3 flex flex-wrap gap-1.5 border-b border-slate-100 pb-3">
              {riesgos.map((r, i) => {
                if (r.eliminado) return null
                const visiblesAntes = riesgos.slice(0, i).filter(x => !x.eliminado).length
                const numero = visiblesAntes + 1
                const activo = i === indiceActivo
                const label = renderTipo === 'automotor' && r.datos.patente
                  ? r.datos.patente
                  : renderTipo === 'hogar' && r.datos.calle
                    ? `${r.datos.calle} ${r.datos.numero}`.trim()
                    : `Riesgo ${numero}`
                return (
                  <div key={i} className={`flex items-center gap-1 rounded border ${activo ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                    <button
                      type="button"
                      onClick={() => setIndiceActivo(i)}
                      className={`px-2 py-1 text-xs font-medium ${activo ? 'text-blue-700' : 'text-slate-600'}`}
                    >
                      {label}
                    </button>
                    <button
                      type="button"
                      onClick={() => eliminarRiesgo(i)}
                      className="px-1.5 py-1 text-slate-400 hover:text-red-600"
                      title="Eliminar este riesgo"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <div className="p-4 grid grid-cols-2 gap-3">

            {renderTipo === 'automotor' && (<>
              <Campo label="Patente" required error={errores.r_patente}>
                <input className={`${ic('r_patente')} font-mono uppercase`} value={datosRiesgo.patente} onChange={e => setR('patente', e.target.value.toUpperCase())} placeholder="ABC123" maxLength={8} />
                {!errores.r_patente && avisos.r_patente && (
                  <p className="text-2xs text-amber-600 mt-0.5 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{avisos.r_patente}</p>
                )}
              </Campo>
              <Campo label="Uso">
                <select className="form-input" value={datosRiesgo.uso} onChange={e => setR('uso', e.target.value)}>
                  <option value="PARTICULAR">Particular</option>
                  <option value="COMERCIAL">Comercial</option>
                  <option value="TAXI">Taxi / Remis</option>
                  <option value="TRANSPORTE">Transporte</option>
                </select>
              </Campo>
              <Campo label="Marca" required error={errores.r_marca}>
                <input className={ic('r_marca')} value={datosRiesgo.marca} onChange={e => setR('marca', e.target.value)} placeholder="Ford, Toyota..." />
              </Campo>
              <Campo label="Modelo" required error={errores.r_modelo}>
                <input className={ic('r_modelo')} value={datosRiesgo.modelo} onChange={e => setR('modelo', e.target.value)} placeholder="Focus, Hilux..." />
              </Campo>
              <Campo label="Año" required error={errores.r_anio}>
                <input className={`${ic('r_anio')} font-mono`} value={datosRiesgo.anio} onChange={e => setR('anio', e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="2020" maxLength={4} inputMode="numeric" />
              </Campo>
              <Campo label="Color">
                <input className="form-input" value={datosRiesgo.color} onChange={e => setR('color', e.target.value)} placeholder="Blanco, Negro..." />
              </Campo>
              <Campo label="Nro. Motor">
                <input className="form-input font-mono" value={datosRiesgo.motor} onChange={e => setR('motor', e.target.value.toUpperCase())} placeholder="Número de motor" />
              </Campo>
              <Campo label="Nro. Chasis">
                <input className="form-input font-mono" value={datosRiesgo.chasis} onChange={e => setR('chasis', e.target.value.toUpperCase())} placeholder="Número de chasis" />
              </Campo>
            </>)}

            {renderTipo === 'hogar' && (<>
              <Campo label="Calle" required error={errores.r_calle} col={2}>
                <input className={ic('r_calle')} value={datosRiesgo.calle} onChange={e => setR('calle', e.target.value)} placeholder="Av. Rivadavia" />
              </Campo>
              <Campo label="Número">
                <input className="form-input font-mono" value={datosRiesgo.numero} onChange={e => setR('numero', e.target.value)} placeholder="1234" />
              </Campo>
              <Campo label="Localidad" required error={errores.r_localidad}>
                <input className={ic('r_localidad')} value={datosRiesgo.localidad} onChange={e => setR('localidad', e.target.value)} placeholder="Castelar" />
              </Campo>
              <Campo label="Provincia">
                <input className="form-input" value={datosRiesgo.provincia} onChange={e => setR('provincia', e.target.value)} placeholder="Buenos Aires" />
              </Campo>
              <Campo label="Tipo de construcción">
                <select className="form-input" value={datosRiesgo.tipo_construccion} onChange={e => setR('tipo_construccion', e.target.value)}>
                  <option value="MAMPOSTERIA">Mampostería</option>
                  <option value="MADERA">Madera</option>
                  <option value="MIXTA">Mixta</option>
                  <option value="PREFABRICADA">Prefabricada</option>
                </select>
              </Campo>
              <Campo label="Superficie (m2)">
                <input className="form-input font-mono" value={datosRiesgo.superficie} onChange={e => setR('superficie', e.target.value.replace(/\D/g, ''))} placeholder="120" inputMode="numeric" />
              </Campo>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Medidas de Seguridad</label>
                <div className="flex flex-wrap gap-3">
                  {['Alarma', 'Rejas', 'Portero eléctrico', 'Cámara', 'Guardia', 'Caja fuerte'].map(m => (
                    <label key={m} className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                      <input type="checkbox" checked={datosRiesgo.medidas_seguridad.includes(m)}
                        onChange={e => setR('medidas_seguridad', e.target.checked ? [...datosRiesgo.medidas_seguridad, m] : datosRiesgo.medidas_seguridad.filter(x => x !== m))}
                        className="rounded border-slate-300" />
                      {m}
                    </label>
                  ))}
                </div>
              </div>
            </>)}

            {renderTipo === 'vida' && (<>
              <Campo label="Capital asegurado">
                <div className="flex gap-1">
                  <span className="flex items-center px-2 bg-slate-100 border border-slate-300 rounded-l text-xs text-slate-500 border-r-0">$</span>
                  <input className="form-input font-mono rounded-l-none flex-1" value={datosRiesgo.capital_asegurado} onChange={e => setR('capital_asegurado', e.target.value.replace(/[^\d.]/g, ''))} placeholder="1000000" inputMode="decimal" />
                </div>
              </Campo>
              <Campo label="Beneficiarios" col={2}>
                <input className="form-input" value={datosRiesgo.beneficiarios} onChange={e => setR('beneficiarios', e.target.value)} placeholder="Nombre y parentesco" />
              </Campo>
            </>)}

            {renderTipo === 'dinamico' && (
              <div className="col-span-2">
                <CamposBienAseguradoDinamico
                  tipoRiesgo={tipoRiesgo}
                  valores={datosRiesgo.detalle_dinamico}
                  onChange={(nuevo) => setR('detalle_dinamico' as any, nuevo as any)}
                  errores={errores}
                />
              </div>
            )}

            {renderTipo === 'generico' && (
              <Campo label="Descripción del riesgo" col={2}>
                <textarea className="form-input w-full resize-none" rows={3} value={datosRiesgo.descripcion} onChange={e => setR('descripcion', e.target.value)} placeholder="Describí el bien o riesgo asegurado..." />
              </Campo>
            )}
          </div>
        </div>
      )}

      {/* Observaciones y Notas */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Observaciones y Notas</h3>
        </div>
        <div className="p-4 grid grid-cols-1 gap-3">
          <Campo label="Observaciones">
            <textarea className="form-input w-full resize-none" rows={2} value={poliza.observaciones} onChange={e => setP('observaciones', e.target.value)} placeholder="Observaciones de la póliza..." />
          </Campo>
          <Campo label="Notas internas">
            <textarea className="form-input w-full resize-none" rows={2} value={poliza.notas} onChange={e => setP('notas', e.target.value)} placeholder="Notas internas..." />
          </Campo>
        </div>
      </div>

      <div className="flex items-center justify-between pb-4">
        <button onClick={() => router.push(`/crm/polizas/${id}`)} className="btn-secondary">
          <ArrowLeft className="h-3 w-3" /> Cancelar
        </button>
        <button onClick={() => guardar()} disabled={guardando} className="btn-primary px-6">
          {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {guardando ? 'Guardando...' : 'Guardar Cambios'}
        </button>
      </div>

      {conflicto && poliza && (
        <ModalConflictoEdicion
          valoresTuyos={poliza as any}
          registroActual={conflicto.registro_actual}
          labels={{
            asegurado_id: 'Asegurado',
            persona_id: 'Asegurado',
            compania_id: 'Compañía',
            ramo_id: 'Ramo',
            cobertura_id: 'Cobertura',
            numero_poliza: 'N° de póliza',
            fecha_inicio: 'Vigencia desde',
            fecha_fin: 'Vigencia hasta',
            refacturacion: 'Refacturación',
            medio_pago: 'Medio de pago',
            observaciones: 'Observaciones',
            notas: 'Notas',
          }}
          campos={[
            'asegurado_id', 'compania_id', 'ramo_id', 'cobertura_id', 'numero_poliza',
            'fecha_inicio', 'fecha_fin', 'refacturacion', 'medio_pago',
            'observaciones', 'notas',
          ]}
          onCerrar={() => setConflicto(null)}
          onRecargar={() => {
            setConflicto(null)
            cargarPoliza()
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
