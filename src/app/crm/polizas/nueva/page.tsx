'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft, Save, Loader2, AlertCircle, CheckCircle,
  Car, Home, Heart, Package, Sparkles, Pencil, Plus, Trash2
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { hoyLocal, mensajeErrorAmigable } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import ModalUploadPDF from '@/components/agente-pdf/ModalUploadPDF'
import { useModuloIAPDF } from '@/lib/hooks/useModuloIAPDF'
import { registrarEventoBitacora } from '@/lib/bitacora-poliza'
import { validarPatente } from '@/lib/importacion/validators'
import BuscadorPersona from '@/components/BuscadorPersona'
import { tipoRenderForm } from '@/lib/tipos-riesgo'
import { CamposBienAseguradoDinamico, validarCamposDinamicos } from '@/components/CamposBienAseguradoDinamico'
import { opcionesRefacturacion } from '@/lib/refacturaciones'
import { opcionesMedioPago } from '@/lib/medios-pago'
import { vigenciaTextoDesdeFechas } from '@/lib/vigencia'

interface Catalogo { id: string; nombre: string; metadata?: Record<string,any> | null }

interface FormPoliza {
  persona_id: string; compania_id: string; ramo_id: string; cobertura_id: string
  numero_poliza: string
  fecha_inicio: string; fecha_fin: string
  refacturacion: string
  medio_pago: string
  suma_asegurada: string
  moneda: string
  mostrar_suma_asegurada_portal: boolean
  observaciones: string
}

interface FormRiesgo {
  patente: string; marca: string; modelo: string; anio: string
  motor: string; chasis: string; color: string; uso: string
  calle: string; numero: string; localidad: string; provincia: string
  tipo_construccion: string; superficie: string; medidas_seguridad: string[]
  capital_asegurado: string; beneficiarios: string
  descripcion: string
  /** Bucket genérico para los tipos de riesgo con render dinámico
   *  (RC, incendio, robo, ART, agropecuario, transporte, embarcación). */
  detalle_dinamico: Record<string, any>
}

const POLIZA_INICIAL: FormPoliza = {
  persona_id: '', compania_id: '', ramo_id: '', cobertura_id: '',
  numero_poliza: '',
  fecha_inicio: hoyLocal(), fecha_fin: '',
  refacturacion: '',
  medio_pago: '',
  suma_asegurada: '',
  moneda: 'ARS',
  mostrar_suma_asegurada_portal: false,
  observaciones: '',
}

const RIESGO_INICIAL: FormRiesgo = {
  patente: '', marca: '', modelo: '', anio: '', motor: '', chasis: '', color: '', uso: 'PARTICULAR',
  calle: '', numero: '', localidad: '', provincia: 'Buenos Aires',
  tipo_construccion: 'MAMPOSTERIA', superficie: '', medidas_seguridad: [],
  capital_asegurado: '', beneficiarios: '',
  descripcion: '',
  detalle_dinamico: {},
}

const ICONOS: Record<string, React.ReactNode> = {
  automotor: <Car    className="h-4 w-4" />,
  hogar:     <Home   className="h-4 w-4" />,
  vida:      <Heart  className="h-4 w-4" />,
  generico:  <Package className="h-4 w-4" />,
}

function Campo({ label, required, error, col=1, children }: {
  label: string; required?: boolean; error?: string; col?: 1|2; children: React.ReactNode
}) {
  return (
    <div className={col===2 ? 'col-span-2' : ''}>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <span className="flex items-center gap-1 text-xs text-red-500 mt-0.5"><AlertCircle className="h-3 w-3"/>{error}</span>}
    </div>
  )
}

export default function NuevaPolizaPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Cargando...</div>}>
      <NuevaPolizaContent />
    </Suspense>
  )
}

function NuevaPolizaContent() {
  const router   = useRouter()
  const params   = useSearchParams()
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()
  const { activo: moduloIAActivo, isLoading: moduloLoading } = useModuloIAPDF()

  const fromCotizacionId = params.get('from_cotizacion')
  // Si venimos de una cotización, saltamos el selector de modo directamente al form manual
  const [modoSeleccion, setModoSeleccion] = useState<'manual' | null>(fromCotizacionId ? 'manual' : null)
  const [modalPDFAbierto, setModalPDFAbierto] = useState(false)
  const [poliza,     setPoliza]     = useState<FormPoliza>({ ...POLIZA_INICIAL, persona_id: params.get('persona_id') ?? '' })
  // Multi-riesgo: una póliza puede tener N riesgos (flotas).
  const [riesgos, setRiesgos] = useState<FormRiesgo[]>([{ ...RIESGO_INICIAL }])
  const [indiceActivo, setIndiceActivo] = useState(0)
  const riesgo = riesgos[indiceActivo] ?? RIESGO_INICIAL
  const [errores,    setErrores]    = useState<Record<string,string>>({})
  const [avisos,     setAvisos]     = useState<Record<string,string>>({})
  const [guardando,  setGuardando]  = useState(false)
  const [exito,      setExito]      = useState(false)
  const [errorGral,  setErrorGral]  = useState('')
  const [companias,      setCompanias]      = useState<Catalogo[]>([])
  const [ramos,          setRamos]          = useState<Catalogo[]>([])
  const [coberturas,     setCoberturas]     = useState<Catalogo[]>([])
  const [tipoRiesgo, setTipoRiesgo] = useState('generico')
  // Mapea el tipo elegido en el ramo (puede ser uno de los 7 nuevos) al
  // render del formulario que ya existe (automotor/hogar/vida/generico).
  // Ver `src/lib/tipos-riesgo.ts::tipoRenderForm`.
  const renderTipo = tipoRenderForm(tipoRiesgo)
  const [ramoNombre, setRamoNombre] = useState('')
  const [cotizacionOrigen, setCotizacionOrigen] = useState<string | null>(null)

  // Cargar catálogos — usa los tipos COMPANIA y RAMO del schema original
  useEffect(() => {
    async function cargar() {
      const { data: tipos } = await supabase
        .from('tipo_catalogo')
        .select('id, codigo')

      if (!tipos) return

      const tipoComp   = tipos.find((t:any) => t.codigo === 'COMPANIA')
      const tipoRamo   = tipos.find((t:any) => t.codigo === 'RAMO')
      const tipoCobert = tipos.find((t:any) => t.codigo === 'COBERTURA')

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
      // El BuscadorPersona resuelve la cartera por sí mismo: si llegó persona_id por
      // query string pero la persona es ajena al usuario, el componente limpia el value.
    }
    cargar()
  }, [supabase, usuario])

  // Pre-cargar datos desde cotización ganada
  useEffect(() => {
    if (!fromCotizacionId || companias.length === 0 || ramos.length === 0) return
    async function cargarCotizacion() {
      const [{ data: cot }, { data: opts }] = await Promise.all([
        supabase.from('cotizaciones').select(`
          id, numero_cotizacion, persona_id, lead_id, ramo_id, datos_riesgo,
          compania_ganadora_id, estado, usuario_id,
          lead:leads!lead_id (persona_id)
        `).eq('id', fromCotizacionId).single(),
        supabase.from('cotizacion_companias').select('compania_id, cobertura_id, precio, seleccionada')
          .eq('cotizacion_id', fromCotizacionId).eq('seleccionada', true).limit(1),
      ])
      if (!cot || (cot as any).estado !== 'GANADA') return
      const cotData = cot as any
      // Control de acceso: usuarios PROPIA solo pueden usar cotizaciones propias
      // o sin dueño asignado para crear pólizas.
      if (usuario && !tieneAccesoTotal(usuario) && cotData.usuario_id != null && cotData.usuario_id !== usuario.id) {
        return
      }
      // Resolver persona_id: directo o a través del lead convertido
      const personaId = cotData.persona_id ?? cotData.lead?.persona_id ?? ''
      const ganadora = (opts ?? [])[0] as any

      setCotizacionOrigen(cotData.numero_cotizacion)
      setPoliza(p => ({
        ...p,
        persona_id: personaId,
        compania_id: cotData.compania_ganadora_id ?? '',
        ramo_id: cotData.ramo_id ?? '',
        cobertura_id: ganadora?.cobertura_id ?? '',
      }))

      // Pre-fill primer riesgo desde datos_riesgo de la cotización
      const dr = cotData.datos_riesgo ?? {}
      setRiesgos(prev => prev.map((r, i) => i === 0 ? {
        ...r,
        patente: dr.patente ?? '', marca: dr.marca ?? '', modelo: dr.modelo ?? '', anio: dr.anio ?? '',
        motor: dr.motor ?? '', chasis: dr.chasis ?? '', color: dr.color ?? '', uso: dr.uso ?? 'PARTICULAR',
        calle: dr.calle ?? '', numero: dr.numero ?? '', localidad: dr.localidad ?? '', provincia: dr.provincia ?? 'Buenos Aires',
        tipo_construccion: dr.tipo_construccion ?? 'MAMPOSTERIA', superficie: dr.superficie ?? '',
        medidas_seguridad: dr.medidas_seguridad ?? [],
        capital_asegurado: dr.capital_asegurado ?? '', beneficiarios: dr.beneficiarios ?? '',
        descripcion: dr.descripcion ?? '',
      } : r))
    }
    cargarCotizacion()
  }, [fromCotizacionId, supabase, companias.length, ramos.length, usuario])

  // Cuando cambia el ramo, leer tipo_riesgo del metadata y resetear cobertura
  useEffect(() => {
    const r = ramos.find(r => r.id === poliza.ramo_id)
    setRamoNombre(r?.nombre ?? '')
    setTipoRiesgo(r?.metadata?.tipo_riesgo ?? 'generico')
    setPoliza(p => ({ ...p, cobertura_id: '' }))
  }, [poliza.ramo_id, ramos])

  // Filtrar coberturas por ramo seleccionado
  const coberturasFiltradas = poliza.ramo_id
    ? coberturas.filter(c => {
        const ramoIds = (c.metadata ?? {}).ramo_ids as string[] | undefined
        return ramoIds && ramoIds.includes(poliza.ramo_id)
      })
    : []

  const setP = (k: keyof FormPoliza, v: string | boolean) => {
    setPoliza(p => ({ ...p, [k]: v }))
    setErrores(e => ({ ...e, [k]: '' }))
  }
  const setR = (k: keyof FormRiesgo, v: any) => {
    setRiesgos(prev => prev.map((r, i) => i === indiceActivo ? { ...r, [k]: v } : r))
    setErrores(e => ({ ...e, [`r_${k}`]: '' }))
  }

  const agregarRiesgo = () => {
    setRiesgos(prev => [...prev, { ...RIESGO_INICIAL }])
    setIndiceActivo(riesgos.length)
    setErrores({}); setAvisos({})
  }

  const eliminarRiesgo = (idx: number) => {
    if (riesgos.length <= 1) return
    setRiesgos(prev => prev.filter((_, i) => i !== idx))
    if (indiceActivo >= idx) setIndiceActivo(Math.max(0, indiceActivo - 1))
  }

  const validar = () => {
    const e: Record<string,string> = {}
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
    // Validar TODOS los riesgos. Si alguno falla, salta a esa tab.
    for (let i = 0; i < riesgos.length; i++) {
      const r = riesgos[i]
      const errR: Record<string,string> = {}
      if (renderTipo === 'automotor') {
        if (!r.patente.trim()) errR.r_patente = 'La patente es obligatoria'
        else if (r.patente.trim().length >= 6) {
          const resPatente = validarPatente(r.patente)
          if (!resPatente.valido) a.r_patente = 'Formato de patente no reconocido (esperado: ABC123 o AB123CD)'
        }
        if (!r.marca.trim())   errR.r_marca   = 'La marca es obligatoria'
        if (!r.modelo.trim())  errR.r_modelo  = 'El modelo es obligatorio'
        if (!r.anio.trim())    errR.r_anio    = 'El año es obligatorio'
      } else if (renderTipo === 'hogar') {
        if (!r.calle.trim())     errR.r_calle     = 'La calle es obligatoria'
        if (!r.localidad.trim()) errR.r_localidad = 'La localidad es obligatoria'
      } else if (renderTipo === 'dinamico') {
        Object.assign(errR, validarCamposDinamicos(tipoRiesgo, r.detalle_dinamico))
      }
      if (Object.keys(errR).length > 0) {
        Object.assign(e, errR)
        if (i !== indiceActivo) setIndiceActivo(i)
        break
      }
    }
    setErrores(e)
    setAvisos(a)
    return Object.keys(e).length === 0
  }

  const guardar = async () => {
    if (!validar()) return
    setGuardando(true); setErrorGral('')
    try {
      // Chequeo de duplicado: no permitir mismo numero_poliza en la misma compañía.
      // Está permitido que dos compañías usen el mismo número.
      const { data: existente } = await supabase
        .from('polizas')
        .select('id')
        .eq('compania_id', poliza.compania_id)
        .eq('numero_poliza', poliza.numero_poliza.trim())
        .maybeSingle()
      if (existente) {
        setErrores(e => ({ ...e, numero_poliza: 'Ya existe una póliza con este número en esta compañía' }))
        setGuardando(false)
        return
      }

      // Calcular estado automáticamente
      const esFutura = poliza.fecha_inicio > hoyLocal()
      // Por ahora, al crear desde este formulario no se asigna poliza_origen_id
      // (la renovación se maneja desde la ficha de la póliza)
      const estadoCalculado = esFutura ? 'PROGRAMADA' : 'VIGENTE'

      const { data: polizaData, error: pErr } = await supabase
        .from('polizas')
        .insert({
          asegurado_id:      poliza.persona_id,
          compania_id:       poliza.compania_id,
          ramo_id:           poliza.ramo_id,
          cobertura_id:      poliza.cobertura_id || null,
          numero_poliza:     poliza.numero_poliza.trim(),
          fecha_inicio:      poliza.fecha_inicio,
          fecha_fin:         poliza.fecha_fin,
          refacturacion:     poliza.refacturacion || null,
          medio_pago:        poliza.medio_pago || null,
          suma_asegurada:    poliza.suma_asegurada ? parseFloat(poliza.suma_asegurada) : null,
          moneda:            poliza.moneda || 'ARS',
          mostrar_suma_asegurada_portal: poliza.mostrar_suma_asegurada_portal,
          estado:            estadoCalculado,
          observaciones:     poliza.observaciones || null,
        })
        .select('id').single()
      if (pErr) throw new Error(pErr.message)

      const detalleDe = (r: FormRiesgo): Record<string,any> => {
        if (renderTipo === 'automotor') {
          return { patente: r.patente.toUpperCase().replace(/\s/g,''), marca: r.marca, modelo: r.modelo, anio: r.anio, motor: r.motor||null, chasis: r.chasis||null, color: r.color||null, uso: r.uso }
        }
        if (renderTipo === 'hogar') {
          return { calle: r.calle, numero: r.numero||null, localidad: r.localidad, provincia: r.provincia, tipo_construccion: r.tipo_construccion, superficie: r.superficie||null, medidas_seguridad: r.medidas_seguridad }
        }
        if (renderTipo === 'vida') {
          return { capital_asegurado: r.capital_asegurado||null, beneficiarios: r.beneficiarios||null }
        }
        if (renderTipo === 'dinamico') {
          return { ...r.detalle_dinamico }
        }
        return { descripcion: r.descripcion||null }
      }

      const polizaId = (polizaData as any).id

      // Registrar creación en bitácora
      await registrarEventoBitacora(supabase, {
        poliza_id: polizaId,
        tipo_evento: 'CREACION',
        estado_nuevo: estadoCalculado,
        usuario_id: usuario?.id || null,
      })

      // Insertar TODOS los riesgos del formulario, con numero_item consecutivo
      // para respetar UNIQUE(poliza_id, numero_item).
      const filasRiesgos = riesgos.map((r, i) => ({
        poliza_id:       polizaId,
        tipo_riesgo:     tipoRiesgo.toUpperCase(),
        detalle_tecnico: detalleDe(r),
        numero_item:     i + 1,
      }))
      const { error: rErr } = await supabase.from('riesgos').insert(filasRiesgos)
      if (rErr) {
        await supabase.from('polizas').delete().eq('id', polizaId)
        throw new Error(rErr.message)
      }

      // Si viene de una cotización, vincular la póliza generada
      if (fromCotizacionId) {
        await supabase.from('cotizaciones').update({ poliza_generada_id: polizaId }).eq('id', fromCotizacionId)
      }

      setExito(true)
      setTimeout(() => router.push(`/crm/personas/${poliza.persona_id}`), 1200)
    } catch(err: any) {
      if (err.message?.includes('uq_poliza_compania_numero')) {
        setErrorGral('Ya existe una póliza con ese número para la compañía seleccionada.')
      } else {
        setErrorGral(mensajeErrorAmigable(err, 'No se pudo crear la póliza'))
      }
    } finally {
      setGuardando(false)
    }
  }

  if (exito) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
        <CheckCircle className="h-6 w-6 text-green-600" />
      </div>
      <p className="text-sm font-medium text-slate-700">¡Póliza guardada!</p>
      <p className="text-xs text-slate-500">Redirigiendo a la ficha...</p>
    </div>
  )

  const ic = (k: string) => `form-input ${errores[k] ? 'border-red-300' : ''}`

  // ────────────────────────────────────────────────────────────
  // Si el módulo IA está activo y todavía no eligió modo, mostrar
  // selector inicial "manual" vs "desde PDF".
  // ────────────────────────────────────────────────────────────
  if (modoSeleccion === null && !moduloLoading && moduloIAActivo) {
    return (
      <div className="flex flex-col gap-4 max-w-3xl">
        <div className="flex items-center gap-2">
          <button onClick={() => router.back()} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center" title="Volver">
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Nueva Póliza</h1>
            <p className="text-xs text-slate-500">¿Cómo querés cargarla?</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mt-2">
          <button
            onClick={() => setModoSeleccion('manual')}
            className="bg-white border border-slate-200 hover:border-blue-400 hover:shadow-md rounded-lg p-6 text-left flex flex-col gap-3 transition-all"
          >
            <div className="h-12 w-12 rounded bg-slate-100 flex items-center justify-center">
              <Pencil className="h-6 w-6 text-slate-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Cargar manualmente</h2>
              <p className="text-xs text-slate-500 mt-1">
                Formulario tradicional paso a paso. Vos ingresás todos los datos.
              </p>
            </div>
          </button>

          <button
            onClick={() => setModalPDFAbierto(true)}
            className="bg-white border border-blue-200 hover:border-blue-400 hover:shadow-md rounded-lg p-6 text-left flex flex-col gap-3 transition-all relative overflow-hidden"
          >
            <div className="absolute top-2 right-2 text-2xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
              IA
            </div>
            <div className="h-12 w-12 rounded bg-blue-50 flex items-center justify-center">
              <Sparkles className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Cargar desde PDF</h2>
              <p className="text-xs text-slate-500 mt-1">
                Subí el PDF de la compañía y el sistema extrae los datos automáticamente.
              </p>
            </div>
          </button>
        </div>

        <ModalUploadPDF
          abierto={modalPDFAbierto}
          onCerrar={() => setModalPDFAbierto(false)}
          tipo_operacion="POLIZA_NUEVA"
          persona_preseleccionada_id={params.get('persona_id') || undefined}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => router.back()} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center" title="Volver">
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Nueva Póliza</h1>
            <p className="text-xs text-slate-500">Registrá una póliza para un asegurado</p>
          </div>
        </div>
        <button onClick={guardar} disabled={guardando} className="btn-primary px-5">
          {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <Save className="h-3.5 w-3.5"/>}
          {guardando ? 'Guardando...' : 'Guardar Póliza'}
        </button>
      </div>

      {errorGral && (
        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0"/>{errorGral}
        </div>
      )}

      {cotizacionOrigen && (
        <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <CheckCircle className="h-3.5 w-3.5 shrink-0"/>
          Datos pre-cargados desde cotización <span className="font-mono font-semibold">{cotizacionOrigen}</span>. Completá los datos faltantes y guardá.
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
              {companias.length === 0
                ? <option disabled>⚠ Sin compañías — cargalas en Configuración</option>
                : companias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)
              }
            </select>
          </Campo>
          <Campo label="Ramo" required error={errores.ramo_id}>
            <select className={ic('ramo_id')} value={poliza.ramo_id} onChange={e => setP('ramo_id', e.target.value)}>
              <option value="">— Seleccioná —</option>
              {ramos.length === 0
                ? <option disabled>⚠ Sin ramos — cargalos en Configuración</option>
                : ramos.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)
              }
            </select>
          </Campo>
          <Campo label="Cobertura" col={2}>
            <select className="form-input" value={poliza.cobertura_id} onChange={e => setP('cobertura_id', e.target.value)}
              disabled={!poliza.ramo_id}>
              <option value="">
                {!poliza.ramo_id ? 'Seleccioná un ramo primero' : '— Seleccioná —'}
              </option>
              {poliza.ramo_id && coberturasFiltradas.length === 0
                ? <option disabled>⚠ Sin coberturas para este ramo — configuralas en Catálogos</option>
                : coberturasFiltradas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)
              }
            </select>
            {(() => {
              if (!poliza.cobertura_id || !poliza.compania_id) return null
              const cob = coberturas.find(c => c.id === poliza.cobertura_id)
              const eq = (cob?.metadata?.equivalencias as { compania_id: string; nombre_comercial: string }[] | undefined)
                ?.find(e => e.compania_id === poliza.compania_id)
              const comp = companias.find(c => c.id === poliza.compania_id)
              if (!eq || !comp) return null
              return (
                <p className="text-2xs text-blue-600 mt-1">
                  En {comp.nombre} esta cobertura se llama <span className="font-semibold">{eq.nombre_comercial}</span>
                </p>
              )
            })()}
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
            <input className={`${ic('numero_poliza')} font-mono`} value={poliza.numero_poliza} onChange={e => setP('numero_poliza', e.target.value)} placeholder="12345678"/>
          </Campo>
          <Campo label="Fecha de inicio de vigencia" required error={errores.fecha_inicio}>
            <input type="date" className={ic('fecha_inicio')} value={poliza.fecha_inicio} onChange={e => setP('fecha_inicio', e.target.value)}/>
          </Campo>
          <Campo label="Fecha de fin de vigencia" required error={errores.fecha_fin}>
            <input type="date" className={ic('fecha_fin')} value={poliza.fecha_fin} onChange={e => setP('fecha_fin', e.target.value)}/>
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
              {riesgos.length > 1 ? `Riesgos (${riesgos.length}) — ${ramoNombre}` : `Datos del Riesgo — ${ramoNombre}`}
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

          {riesgos.length > 1 && (
            <div className="px-4 pt-3 flex flex-wrap gap-1.5 border-b border-slate-100 pb-3">
              {riesgos.map((r, i) => {
                const activo = i === indiceActivo
                const label = renderTipo === 'automotor' && r.patente
                  ? r.patente
                  : renderTipo === 'hogar' && r.calle
                    ? `${r.calle}${r.numero ? ' ' + r.numero : ''}`
                    : `Riesgo ${i + 1}`
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
                <input className={`${ic('r_patente')} font-mono uppercase`} value={riesgo.patente} onChange={e => setR('patente', e.target.value.toUpperCase())} placeholder="ABC123" maxLength={8}/>
                {!errores.r_patente && avisos.r_patente && (
                  <p className="text-2xs text-amber-600 mt-0.5 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{avisos.r_patente}</p>
                )}
              </Campo>
              <Campo label="Uso">
                <select className="form-input" value={riesgo.uso} onChange={e => setR('uso', e.target.value)}>
                  <option value="PARTICULAR">Particular</option>
                  <option value="COMERCIAL">Comercial</option>
                  <option value="TAXI">Taxi / Remis</option>
                  <option value="TRANSPORTE">Transporte</option>
                </select>
              </Campo>
              <Campo label="Marca" required error={errores.r_marca}>
                <input className={ic('r_marca')} value={riesgo.marca} onChange={e => setR('marca', e.target.value)} placeholder="Ford, Toyota..."/>
              </Campo>
              <Campo label="Modelo" required error={errores.r_modelo}>
                <input className={ic('r_modelo')} value={riesgo.modelo} onChange={e => setR('modelo', e.target.value)} placeholder="Focus, Hilux..."/>
              </Campo>
              <Campo label="Año" required error={errores.r_anio}>
                <input className={`${ic('r_anio')} font-mono`} value={riesgo.anio} onChange={e => setR('anio', e.target.value.replace(/\D/g,'').slice(0,4))} placeholder="2020" maxLength={4} inputMode="numeric"/>
              </Campo>
              <Campo label="Color">
                <input className="form-input" value={riesgo.color} onChange={e => setR('color', e.target.value)} placeholder="Blanco, Negro..."/>
              </Campo>
              <Campo label="Nro. Motor">
                <input className="form-input font-mono" value={riesgo.motor} onChange={e => setR('motor', e.target.value.toUpperCase())} placeholder="Número de motor"/>
              </Campo>
              <Campo label="Nro. Chasis">
                <input className="form-input font-mono" value={riesgo.chasis} onChange={e => setR('chasis', e.target.value.toUpperCase())} placeholder="Número de chasis"/>
              </Campo>
            </>)}

            {renderTipo === 'hogar' && (<>
              <Campo label="Calle" required error={errores.r_calle} col={2}>
                <input className={ic('r_calle')} value={riesgo.calle} onChange={e => setR('calle', e.target.value)} placeholder="Av. Rivadavia"/>
              </Campo>
              <Campo label="Número">
                <input className="form-input font-mono" value={riesgo.numero} onChange={e => setR('numero', e.target.value)} placeholder="1234"/>
              </Campo>
              <Campo label="Localidad" required error={errores.r_localidad}>
                <input className={ic('r_localidad')} value={riesgo.localidad} onChange={e => setR('localidad', e.target.value)} placeholder="Castelar"/>
              </Campo>
              <Campo label="Provincia">
                <input className="form-input" value={riesgo.provincia} onChange={e => setR('provincia', e.target.value)} placeholder="Buenos Aires"/>
              </Campo>
              <Campo label="Tipo de construcción">
                <select className="form-input" value={riesgo.tipo_construccion} onChange={e => setR('tipo_construccion', e.target.value)}>
                  <option value="MAMPOSTERIA">Mampostería</option>
                  <option value="MADERA">Madera</option>
                  <option value="MIXTA">Mixta</option>
                  <option value="PREFABRICADA">Prefabricada</option>
                </select>
              </Campo>
              <Campo label="Superficie (m²)">
                <input className="form-input font-mono" value={riesgo.superficie} onChange={e => setR('superficie', e.target.value.replace(/\D/g,''))} placeholder="120" inputMode="numeric"/>
              </Campo>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Medidas de Seguridad</label>
                <div className="flex flex-wrap gap-3">
                  {['Alarma','Rejas','Portero eléctrico','Cámara','Guardia','Caja fuerte'].map(m => (
                    <label key={m} className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                      <input type="checkbox" checked={riesgo.medidas_seguridad.includes(m)}
                        onChange={e => setR('medidas_seguridad', e.target.checked ? [...riesgo.medidas_seguridad, m] : riesgo.medidas_seguridad.filter(x => x!==m))}
                        className="rounded border-slate-300"/>
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
                  <input className="form-input font-mono rounded-l-none flex-1" value={riesgo.capital_asegurado} onChange={e => setR('capital_asegurado', e.target.value.replace(/[^\d.]/g,''))} placeholder="1000000" inputMode="decimal"/>
                </div>
              </Campo>
              <Campo label="Beneficiarios" col={2}>
                <input className="form-input" value={riesgo.beneficiarios} onChange={e => setR('beneficiarios', e.target.value)} placeholder="Nombre y parentesco"/>
              </Campo>
            </>)}

            {renderTipo === 'dinamico' && (
              <div className="col-span-2">
                <CamposBienAseguradoDinamico
                  tipoRiesgo={tipoRiesgo}
                  valores={riesgo.detalle_dinamico}
                  onChange={(nuevo) => setR('detalle_dinamico' as any, nuevo as any)}
                  errores={errores}
                />
              </div>
            )}

            {renderTipo === 'generico' && (
              <Campo label="Descripción del riesgo" col={2}>
                <textarea className="form-input w-full resize-none" rows={3} value={riesgo.descripcion} onChange={e => setR('descripcion', e.target.value)} placeholder="Describí el bien o riesgo asegurado..."/>
              </Campo>
            )}
          </div>
        </div>
      )}

      {/* Observaciones */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Observaciones</h3>
        </div>
        <div className="p-4">
          <textarea className="form-input w-full resize-none" rows={2} value={poliza.observaciones} onChange={e => setP('observaciones', e.target.value)} placeholder="Notas internas..."/>
        </div>
      </div>

      <div className="flex items-center justify-between pb-4">
        <button onClick={() => router.back()} className="btn-secondary">
          <ArrowLeft className="h-3.5 w-3.5"/> Cancelar
        </button>
        <button onClick={guardar} disabled={guardando} className="btn-primary px-6">
          {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <Save className="h-3.5 w-3.5"/>}
          {guardando ? 'Guardando...' : 'Guardar Póliza'}
        </button>
      </div>
    </div>
  )
}
