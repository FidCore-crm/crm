'use client'

import { useState, useEffect, useId, cloneElement, isValidElement, Suspense, type ReactElement } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Save, Loader2, AlertCircle, CheckCircle, Car, Home, Heart, Package, Users, Plus, X } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { hoyLocal, mensajeErrorAmigable } from '@/lib/utils'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import BuscadorPersona from '@/components/BuscadorPersona'
import { construirDetalleSiniestro, MAX_TESTIGOS, type TestigoData } from '@/lib/siniestros-tipos'
import { obtenerIdsPersonas } from '@/lib/cartera-filter'
import { tipoRenderForm } from '@/lib/tipos-riesgo'
import {
  tiposDeSiniestroPorRamo,
  obtenerConfigTipoSiniestro,
  CATEGORIAS_TERCERO,
} from '@/lib/siniestros-catalogo'
import { CamposDinamicos, type ValoresDinamicos } from '@/components/siniestros/CamposDinamicos'

// ── Tipos ────────────────────────────────────────────────────
interface CampoSiniestro {
  key: string; label: string; tipo: 'text' | 'textarea' | 'select' | 'date'
  requerido: boolean; placeholder?: string; opciones?: string
}

interface Poliza {
  id: string; numero_poliza: string; asegurado_id: string
  ramo: { nombre: string; metadata: Record<string, any> | null } | null
  riesgos: { tipo_riesgo: string; detalle_tecnico: Record<string, any> }[]
}


const ICONOS_RAMO: Record<string, React.ReactNode> = {
  automotor: <Car    className="h-3.5 w-3.5 text-blue-500" />,
  hogar:     <Home   className="h-3.5 w-3.5 text-amber-500" />,
  vida:      <Heart  className="h-3.5 w-3.5 text-rose-500" />,
  generico:  <Package className="h-3.5 w-3.5 text-slate-400" />,
}

// Genera un id único y lo inyecta tanto en el `<label htmlFor>` como en el
// children (input/select/textarea) vía cloneElement. Cumple WCAG 2.1 A.
function Campo({ label, required, error, col = 1, children }: {
  label: string; required?: boolean; error?: string; col?: 1 | 2; children: React.ReactNode
}) {
  const id = useId()
  const errorId = `${id}-error`
  const childWithId = isValidElement(children)
    ? cloneElement(children as ReactElement<any>, {
        id,
        'aria-invalid': !!error,
        'aria-describedby': error ? errorId : undefined,
      })
    : children
  return (
    <div className={col === 2 ? 'sm:col-span-2' : ''}>
      <label htmlFor={id} className="block text-xs font-medium text-slate-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {childWithId}
      {error && <span id={errorId} className="flex items-center gap-1 text-xs text-red-500 mt-0.5"><AlertCircle className="h-3 w-3" />{error}</span>}
    </div>
  )
}

function Toggle({ value, onChange, labelSi = 'Sí', labelNo = 'No' }: {
  value: boolean; onChange: (v: boolean) => void; labelSi?: string; labelNo?: string
}) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => onChange(false)}
        className={`px-2.5 py-1 text-xs rounded-l border transition-colors ${!value ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
        {labelNo}
      </button>
      <button type="button" onClick={() => onChange(true)}
        className={`px-2.5 py-1 text-xs rounded-r border border-l-0 transition-colors ${value ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
        {labelSi}
      </button>
    </div>
  )
}

export default function NuevoSiniestroPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Cargando...</div>}>
      <NuevoSiniestroContent />
    </Suspense>
  )
}

function NuevoSiniestroContent() {
  const router   = useRouter()
  const params   = useSearchParams()
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  // ── Estado principal ───────────────────────────────────
  const [polizaId,      setPolizaId]      = useState(params.get('poliza_id') ?? '')
  const [personaId,     setPersonaId]     = useState(params.get('persona_id') ?? '')
  const [fechaOcurrencia, setFechaOcurrencia] = useState('')
  const [fechaDenuncia,  setFechaDenuncia]  = useState(hoyLocal())
  const [tipoSiniestro,  setTipoSiniestro]  = useState('')
  const [tipoOtroDescripcion, setTipoOtroDescripcion] = useState('')
  const [montoEstimado, setMontoEstimado] = useState('')
  const [descripcion,   setDescripcion]   = useState('')
  const [detalleExtra,  setDetalleExtra]  = useState<Record<string, string>>({})

  // ── Campos comunes ─────────────────────────────────────
  const [horaSiniestro,    setHoraSiniestro]    = useState('')
  const [lugarCalle,       setLugarCalle]       = useState('')
  const [lugarLocalidad,   setLugarLocalidad]   = useState('')
  const [denunciaPolicial, setDenunciaPolicial] = useState(false)
  const [actaPolicial,     setActaPolicial]     = useState('')
  const [vehiculoEstacionado, setVehiculoEstacionado] = useState(false)

  // ── Valores para bloques que renderiza CamposDinamicos (para tipos no-accidente) ──
  const [valoresDinamicos, setValoresDinamicos] = useState<ValoresDinamicos>({})

  // ── Conductor (automotor/moto) ─────────────────────────
  const [otraPersonaConduce, setOtraPersonaConduce] = useState(false)
  const [conductorNombre,    setConductorNombre]    = useState('')
  const [conductorDni,       setConductorDni]       = useState('')
  const [conductorTelefono,  setConductorTelefono]  = useState('')
  const [conductorRelacion,  setConductorRelacion]  = useState('')
  const [conductorRegistro,  setConductorRegistro]  = useState('')
  const [danosPropios,       setDanosPropios]       = useState('')
  const [huboLesionados,     setHuboLesionados]     = useState(false)
  const [detalleLesiones,    setDetalleLesiones]    = useState('')

  // ── Tercero (automotor/moto) ───────────────────────────
  const [huboTercero,         setHuboTercero]         = useState(false)
  const [terceroFuga,         setTerceroFuga]         = useState(false)
  const [terceroNombre,       setTerceroNombre]       = useState('')
  const [terceroDni,          setTerceroDni]          = useState('')
  const [terceroTelefono,     setTerceroTelefono]     = useState('')
  const [terceroCompania,     setTerceroCompania]     = useState('')
  const [terceroPoliza,       setTerceroPoliza]       = useState('')
  const [terceroTipoVehiculo, setTerceroTipoVehiculo] = useState('')
  const [terceroPatente,      setTerceroPatente]      = useState('')
  const [terceroMarca,        setTerceroMarca]        = useState('')
  const [terceroModelo,       setTerceroModelo]       = useState('')
  const [terceroAnio,         setTerceroAnio]         = useState('')
  const [terceroDanos,        setTerceroDanos]        = useState('')

  // ── Testigos (cualquier ramo) ──────────────────────────
  const [huboTestigos, setHuboTestigos] = useState(false)
  const [testigos, setTestigos] = useState<TestigoData[]>([{ nombre: '', telefono: '' }])

  // ── Hogar ──────────────────────────────────────────────
  const [tipoVivienda,  setTipoVivienda]  = useState('')
  const [quePasoHogar,  setQuePasoHogar]  = useState('')

  // ── Datos auxiliares ───────────────────────────────────
  const [polizas,    setPolizas]    = useState<Poliza[]>([])
  const [polizaInfo, setPolizaInfo] = useState<Poliza | null>(null)
  const [camposDB,   setCamposDB]   = useState<CampoSiniestro[]>([])
  const [tipoRiesgo, setTipoRiesgo] = useState('')

  const [errores,   setErrores]   = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState(false)
  const [exito,     setExito]     = useState(false)
  const [errorGral, setErrorGral] = useState('')

  // Mapeo: los 7 tipos del catálogo más los legacy ('moto', 'auto') caen
  // en los layouts existentes (automotor/hogar/vida/generico).
  const renderTipo = tipoRiesgo === 'moto'
    ? 'automotor'
    : tipoRenderForm(tipoRiesgo)
  const esAutomotor = renderTipo === 'automotor'
  const esHogar     = renderTipo === 'hogar'

  // Lista de tipos de siniestro válidos para el ramo actual (viene de la matriz).
  // Reemplaza a TIPOS_SINIESTRO_BASE que era la misma lista para todos los ramos.
  const tiposValidos = tiposDeSiniestroPorRamo(tipoRiesgo)
  const configTipo = obtenerConfigTipoSiniestro(tipoRiesgo, tipoSiniestro)

  // ACCIDENTE_TRANSITO usa el bloque automotor hardcoded (más detallado).
  // Otros tipos (ROBO_RUEDAS, GRANIZO, ROTURA_CRISTALES...) usan CamposDinamicos.
  const usarBloqueAutomotorHardcoded = esAutomotor && tipoSiniestro === 'ACCIDENTE_TRANSITO'
  const usarCamposDinamicos = tipoSiniestro && tipoSiniestro !== 'ACCIDENTE_TRANSITO' && configTipo !== null && (configTipo.bloques.length > 0 || configTipo.campos.length > 0)

  // ── Cargar pólizas vigentes (filtradas por cartera) ────
  useEffect(() => {
    async function cargar() {
      if (!usuario) return
      const idsPersonas = await obtenerIdsPersonas(supabase, usuario)
      let q = supabase.from('polizas').select(`
        id, numero_poliza, asegurado_id,
        ramo:catalogos!ramo_id (nombre, metadata),
        riesgos (tipo_riesgo, detalle_tecnico)
      `).eq('estado', 'VIGENTE')
      if (idsPersonas !== null) {
        if (idsPersonas.length === 0) {
          setPolizas([])
          return
        }
        q = q.in('asegurado_id', idsPersonas)
      }
      const { data: pols } = await q.order('numero_poliza')
      setPolizas((pols ?? []) as unknown as Poliza[])
    }
    cargar()
  }, [supabase, usuario])

  // ── Resolver póliza seleccionada ───────────────────────
  useEffect(() => {
    if (!polizaId) { setPolizaInfo(null); setCamposDB([]); setTipoRiesgo(''); return }
    const p = polizas.find(p => p.id === polizaId) ?? null
    setPolizaInfo(p)
    if (p) {
      setPersonaId(p.asegurado_id)
      const meta = (p.ramo as any)?.metadata
      setTipoRiesgo(meta?.tipo_riesgo ?? '')
      setCamposDB(meta?.campos_siniestro ?? [])
      setTipoSiniestro('')
      setDetalleExtra({})
    }
  }, [polizaId, polizas])

  const setDetalle = (key: string, val: string) => setDetalleExtra(d => ({ ...d, [key]: val }))

  // ── Validar ────────────────────────────────────────────
  const validar = () => {
    const e: Record<string, string> = {}
    if (!personaId)           e.persona_id      = 'Seleccioná el asegurado'
    if (!polizaId)            e.poliza_id       = 'Seleccioná la póliza'
    if (!fechaOcurrencia)     e.fecha_ocurrencia = 'La fecha del siniestro es obligatoria'
    if (!fechaDenuncia)       e.fecha_denuncia  = 'La fecha de denuncia es obligatoria'
    if (!tipoSiniestro)       e.tipo_siniestro = 'Seleccioná el tipo'
    if (tipoSiniestro === 'OTRO' && !tipoOtroDescripcion.trim())
      e.tipo_otro = 'Especificá qué tipo de siniestro es'
    if (!descripcion.trim())  e.descripcion    = 'El relato de los hechos es obligatorio'

    // Coherencia de fechas
    const hoy = hoyLocal()
    if (fechaOcurrencia && fechaOcurrencia > hoy) {
      e.fecha_ocurrencia = 'La fecha de ocurrencia no puede ser futura'
    }
    if (fechaDenuncia && fechaDenuncia > hoy) {
      e.fecha_denuncia = 'La fecha de denuncia no puede ser futura'
    }
    if (fechaOcurrencia && fechaDenuncia && fechaOcurrencia > fechaDenuncia) {
      e.fecha_ocurrencia = 'Debe ser anterior o igual a la fecha de denuncia'
    }

    // Monto >= 0
    if (montoEstimado) {
      const m = parseFloat(montoEstimado)
      if (isNaN(m) || m < 0) e.monto_estimado = 'El monto no puede ser negativo'
    }

    camposDB.filter(c => c.requerido).forEach(c => {
      if (!detalleExtra[c.key]?.trim()) e[`extra_${c.key}`] = `${c.label} es obligatorio`
    })
    setErrores(e)
    return Object.keys(e).length === 0
  }

  // ── beforeunload: avisa si hay datos sin guardar ───────
  const hayDatosSinGuardar = !!(
    personaId || polizaId || tipoSiniestro || descripcion.trim() || montoEstimado ||
    Object.values(detalleExtra).some(v => v && v.trim()) ||
    horaSiniestro || lugarCalle || lugarLocalidad ||
    conductorNombre || terceroNombre ||
    (huboTestigos && testigos.some(t => t.nombre || t.telefono))
  )
  useEffect(() => {
    if (!hayDatosSinGuardar || exito || guardando) return
    const handler = (ev: BeforeUnloadEvent) => {
      ev.preventDefault()
      ev.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hayDatosSinGuardar, exito, guardando])

  const cancelar = () => {
    if (hayDatosSinGuardar) {
      if (!confirm('Hay datos sin guardar. ¿Querés salir igual?')) return
    }
    router.back()
  }

  // ── Guardar ────────────────────────────────────────────
  const guardar = async () => {
    if (!validar()) return
    setGuardando(true); setErrorGral('')
    try {
      const detalle = construirDetalleSiniestro({
        tipo_riesgo: tipoRiesgo,
        tipo_otro_descripcion: tipoSiniestro === 'OTRO' ? tipoOtroDescripcion : undefined,
        denuncia_policial: denunciaPolicial,
        acta_policial: actaPolicial,
        // Campos automotor solo si el tipo es ACCIDENTE_TRANSITO (bloque hardcoded).
        vehiculo_estacionado: usarBloqueAutomotorHardcoded ? vehiculoEstacionado : undefined,
        otra_persona_conduce: usarBloqueAutomotorHardcoded && !vehiculoEstacionado ? otraPersonaConduce : undefined,
        conductor: usarBloqueAutomotorHardcoded && !vehiculoEstacionado && otraPersonaConduce ? {
          nombre: conductorNombre, dni: conductorDni, telefono: conductorTelefono,
          relacion: conductorRelacion, registro: conductorRegistro,
        } : undefined,
        danos_propios: usarBloqueAutomotorHardcoded ? danosPropios : undefined,
        hubo_lesionados: usarBloqueAutomotorHardcoded ? huboLesionados : undefined,
        detalle_lesiones: usarBloqueAutomotorHardcoded && huboLesionados ? detalleLesiones : undefined,
        hubo_tercero: usarBloqueAutomotorHardcoded ? huboTercero : undefined,
        tercero_fuga: usarBloqueAutomotorHardcoded && huboTercero ? terceroFuga : undefined,
        tercero: usarBloqueAutomotorHardcoded && huboTercero && !terceroFuga ? {
          nombre: terceroNombre, dni: terceroDni, telefono: terceroTelefono,
          compania: terceroCompania, poliza: terceroPoliza,
          categoria: terceroTipoVehiculo, tipo_vehiculo: terceroTipoVehiculo,
          patente: terceroPatente,
          marca: terceroMarca, modelo: terceroModelo, anio: terceroAnio,
          danos: terceroDanos,
        } : undefined,
        hubo_testigos: usarBloqueAutomotorHardcoded ? huboTestigos : undefined,
        testigos: usarBloqueAutomotorHardcoded && huboTestigos ? testigos : undefined,
        tipo_vivienda: esHogar ? tipoVivienda : undefined,
        que_paso: esHogar ? quePasoHogar : undefined,
        // Campos que vienen del bloque CamposDinamicos (para tipos no accidente).
        // Se serializan como strings para respetar el shape esperado por construirDetalleSiniestro.
        extra: usarCamposDinamicos
          ? { ...detalleExtra, ...(Object.fromEntries(Object.entries(valoresDinamicos).map(([k, v]) => [k, v == null ? '' : String(v)])) as Record<string, string>) }
          : detalleExtra,
      })

      const r = await apiCall<{ siniestro: { id: string } }>('/api/siniestros/crear', {
        method: 'POST',
        body: {
          persona_id:          personaId,
          poliza_id:           polizaId,
          fecha_ocurrencia:    fechaOcurrencia,
          fecha_denuncia:      fechaDenuncia,
          tipo_siniestro:      tipoSiniestro,
          monto_estimado:      montoEstimado ? parseFloat(montoEstimado) : null,
          descripcion:         descripcion.trim(),
          detalle_siniestro:   detalle,
          hora_siniestro:      horaSiniestro || null,
          lugar_siniestro:     lugarCalle.trim() || null,
          localidad_siniestro: lugarLocalidad.trim() || null,
          tercero_nombre:      usarBloqueAutomotorHardcoded && huboTercero && !terceroFuga ? (terceroNombre.trim() || null) : null,
          tercero_dni:         usarBloqueAutomotorHardcoded && huboTercero && !terceroFuga ? (terceroDni.trim() || null) : null,
          tercero_telefono:    usarBloqueAutomotorHardcoded && huboTercero && !terceroFuga ? (terceroTelefono.trim() || null) : null,
          tercero_patente:     usarBloqueAutomotorHardcoded && huboTercero && !terceroFuga ? (terceroPatente.trim().toUpperCase() || null) : null,
        },
      }, { mostrar_toast_en_error: false })
      if (!r.ok) {
        setErrorGral(r.error?.mensaje ?? 'Error al crear el siniestro')
      } else {
        const siniestroId = (r.data as { siniestro?: { id: string } } | undefined)?.siniestro?.id
        setExito(true)
        toast.exito('Siniestro creado correctamente')
        if (siniestroId) setTimeout(() => router.push(`/crm/siniestros/${siniestroId}`), 1200)
      }
    } catch (err: any) {
      setErrorGral(mensajeErrorAmigable(err, 'No se pudo crear el siniestro'))
    } finally {
      setGuardando(false)
    }
  }

  if (exito) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
        <CheckCircle className="h-6 w-6 text-green-600" />
      </div>
      <p className="text-sm font-medium text-slate-700">¡Siniestro registrado!</p>
      <p className="text-xs text-slate-500">Redirigiendo a la ficha del siniestro...</p>
    </div>
  )

  const ic = (k: string) => `form-input ${errores[k] ? 'border-red-300' : ''}`
  const riesgo = polizaInfo?.riesgos?.[0]

  return (
    <div className="flex flex-col gap-4 max-w-3xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={cancelar} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center" title="Volver">
            <ArrowLeft className="h-3.5 w-3.5" /></button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Nuevo Siniestro</h1>
            <p className="text-xs text-slate-500">Registrá un siniestro vinculado a una póliza</p>
          </div>
        </div>
        <button onClick={guardar} disabled={guardando} className="btn-primary px-5">
          {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {guardando ? 'Guardando...' : 'Registrar Siniestro'}
        </button>
      </div>

      {errorGral && (
        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />{errorGral}
        </div>
      )}

      {/* ── Asegurado y Póliza ──────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Asegurado y Póliza</h3>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Asegurado<span className="text-red-500 ml-0.5">*</span>
            </label>
            <BuscadorPersona
              value={personaId}
              onChange={(id) => { setPersonaId(id); setPolizaId('') }}
              invalido={!!errores.persona_id}
              placeholder="Buscar por apellido, DNI/CUIT o razón social..."
            />
            {errores.persona_id && (
              <span className="flex items-center gap-1 text-xs text-red-500 mt-0.5">
                <AlertCircle className="h-3 w-3" />{errores.persona_id}
              </span>
            )}
          </div>
          <Campo label="Póliza vinculada" required error={errores.poliza_id} col={2}>
            <select className={ic('poliza_id')} value={polizaId} onChange={e => setPolizaId(e.target.value)}>
              <option value="">— Seleccioná la póliza —</option>
              {polizas
                .filter(p => !personaId || p.asegurado_id === personaId)
                .map(p => (
                  <option key={p.id} value={p.id}>
                    {p.numero_poliza} — {(p.ramo as any)?.nombre ?? 'Sin ramo'}
                  </option>
                ))}
            </select>
          </Campo>
          {personaId && !polizas.some(p => p.asegurado_id === personaId) && (
            <div className="sm:col-span-2 flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              Esta persona no tiene pólizas vigentes. Cargá o reactivá una póliza antes de denunciar el siniestro.
            </div>
          )}

          {polizaInfo && riesgo && (
            <div className="sm:col-span-2 flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span>{ICONOS_RAMO[tipoRiesgo] ?? ICONOS_RAMO.generico}</span>
              <span className="font-medium">Bien asegurado:</span>
              <span className="font-mono">
                {riesgo.detalle_tecnico?.patente
                  ?? [riesgo.detalle_tecnico?.calle, riesgo.detalle_tecnico?.numero].filter(Boolean).join(' ')
                  ?? riesgo.detalle_tecnico?.descripcion ?? '—'}
              </span>
              <span className="ml-auto text-slate-400">{(polizaInfo.ramo as any)?.nombre}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Datos del Siniestro ─────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Datos del Siniestro</h3>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2 flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-600">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            El número de caso se genera automáticamente al guardar.
          </div>
          <Campo label="Fecha del siniestro" required error={errores.fecha_ocurrencia}>
            <input type="date" className={ic('fecha_ocurrencia')} value={fechaOcurrencia}
              onChange={e => setFechaOcurrencia(e.target.value)} />
          </Campo>
          <Campo label="Fecha de denuncia" required error={errores.fecha_denuncia}>
            <input type="date" className={ic('fecha_denuncia')} value={fechaDenuncia}
              onChange={e => setFechaDenuncia(e.target.value)} />
          </Campo>
          <Campo label="Tipo de siniestro" required error={errores.tipo_siniestro} col={2}>
            <select
              className={ic('tipo_siniestro')}
              value={tipoSiniestro}
              onChange={e => {
                setTipoSiniestro(e.target.value)
                setValoresDinamicos({}) // resetea al cambiar de tipo
              }}
              disabled={!tipoRiesgo}
            >
              <option value="">
                {tipoRiesgo ? '— Seleccioná el tipo —' : 'Primero elegí una póliza'}
              </option>
              {tiposValidos.map(t => (
                <option key={t.value} value={t.value}>
                  {t.icono ? `${t.icono} ${t.label}` : t.label}
                </option>
              ))}
            </select>
          </Campo>
          {tipoSiniestro === 'OTRO' && (
            <Campo label="Especificá el tipo" required error={errores.tipo_otro} col={2}>
              <input
                className={ic('tipo_otro')}
                value={tipoOtroDescripcion}
                onChange={e => setTipoOtroDescripcion(e.target.value)}
                placeholder="Ej: Choque con animal en ruta"
              />
            </Campo>
          )}
          <Campo label="Monto estimado del daño">
            <div className="flex gap-1">
              <span className="flex items-center px-2 bg-slate-100 border border-slate-300 rounded-l text-xs text-slate-500 border-r-0">$</span>
              <input className="form-input font-mono rounded-l-none flex-1" value={montoEstimado}
                onChange={e => setMontoEstimado(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="0" inputMode="decimal" />
            </div>
          </Campo>
          <Campo label="Hora del siniestro">
            <input type="time" className="form-input" value={horaSiniestro}
              onChange={e => setHoraSiniestro(e.target.value)} />
          </Campo>
          <Campo label="Relato de los hechos" required error={errores.descripcion} col={2}>
            <textarea className={`${ic('descripcion')} w-full resize-none`} rows={3}
              value={descripcion} onChange={e => setDescripcion(e.target.value)}
              placeholder="Relatá brevemente cómo ocurrió el siniestro..." />
          </Campo>
        </div>
      </div>

      {/* ── Lugar del hecho ─────────────────────────────────── */}
      {polizaId && (
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
            <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Lugar del hecho</h3>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="Calle y número" col={2}>
              <input className="form-input" value={lugarCalle}
                onChange={e => setLugarCalle(e.target.value)} placeholder="Ej: Av. Corrientes 1234" />
            </Campo>
            <Campo label="Localidad">
              <input className="form-input" value={lugarLocalidad}
                onChange={e => setLugarLocalidad(e.target.value)} placeholder="Ej: CABA" />
            </Campo>
            <Campo label="¿Hubo denuncia policial?">
              <Toggle value={denunciaPolicial} onChange={setDenunciaPolicial} />
            </Campo>
            {denunciaPolicial && (
              <Campo label="Número de acta policial" col={2}>
                <input className="form-input" value={actaPolicial}
                  onChange={e => setActaPolicial(e.target.value)} placeholder="Ej: 12345/2026" />
              </Campo>
            )}
          </div>
        </div>
      )}

      {/* ── Datos del conductor (automotor/moto — solo para ACCIDENTE_TRANSITO) ────────────── */}
      {polizaId && usarBloqueAutomotorHardcoded && (
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
            <Car className="h-3.5 w-3.5 text-blue-500" />
            <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Datos del conductor</h3>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="¿El vehículo estaba estacionado?" col={2}>
              <Toggle value={vehiculoEstacionado} onChange={setVehiculoEstacionado} />
            </Campo>

            {!vehiculoEstacionado && (
              <Campo label="¿Quién conducía?" col={2}>
                <Toggle value={otraPersonaConduce} onChange={setOtraPersonaConduce}
                  labelSi="Otra persona" labelNo="El asegurado" />
              </Campo>
            )}

            {!vehiculoEstacionado && otraPersonaConduce && (<>
              <Campo label="Nombre y apellido">
                <input className="form-input" value={conductorNombre}
                  onChange={e => setConductorNombre(e.target.value)} />
              </Campo>
              <Campo label="DNI">
                <input className="form-input font-mono" value={conductorDni}
                  onChange={e => setConductorDni(e.target.value)} />
              </Campo>
              <Campo label="Teléfono">
                <input className="form-input" value={conductorTelefono}
                  onChange={e => setConductorTelefono(e.target.value)} />
              </Campo>
              <Campo label="Relación con el asegurado">
                <input className="form-input" value={conductorRelacion}
                  onChange={e => setConductorRelacion(e.target.value)} placeholder="Ej: Hijo, cónyuge, empleado" />
              </Campo>
              <Campo label="Nro. registro de conducir" col={2}>
                <input className="form-input font-mono" value={conductorRegistro}
                  onChange={e => setConductorRegistro(e.target.value)} />
              </Campo>
            </>)}

            <Campo label="Daños propios del vehículo" col={2}>
              <textarea className="form-input w-full resize-none" rows={2} value={danosPropios}
                onChange={e => setDanosPropios(e.target.value)}
                placeholder="Describí los daños del vehículo asegurado..." />
            </Campo>

            <Campo label="¿Hubo lesionados?" col={2}>
              <Toggle value={huboLesionados} onChange={setHuboLesionados} />
            </Campo>
            {huboLesionados && (
              <Campo label="Detalle de lesiones" col={2}>
                <textarea className="form-input w-full resize-none" rows={2} value={detalleLesiones}
                  onChange={e => setDetalleLesiones(e.target.value)}
                  placeholder="Describí las lesiones sufridas..." />
              </Campo>
            )}
          </div>
        </div>
      )}

      {/* ── Datos del tercero (automotor/moto — solo para ACCIDENTE_TRANSITO) ──────────────── */}
      {polizaId && usarBloqueAutomotorHardcoded && (
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
            <Car className="h-3.5 w-3.5 text-amber-500" />
            <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Datos del tercero</h3>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="¿Hubo otra persona o vehículo involucrado?" col={2}>
              <Toggle value={huboTercero} onChange={v => { setHuboTercero(v); if (!v) setTerceroFuga(false) }} />
            </Campo>

            {huboTercero && (<>
              <div className="sm:col-span-2">
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={terceroFuga} onChange={e => setTerceroFuga(e.target.checked)}
                    className="rounded border-slate-300" />
                  No cuento con los datos (se dio a la fuga)
                </label>
              </div>

              {!terceroFuga && (<>
                <Campo label="Nombre y apellido del tercero">
                  <input className="form-input" value={terceroNombre}
                    onChange={e => setTerceroNombre(e.target.value)} />
                </Campo>
                <Campo label="DNI">
                  <input className="form-input font-mono" value={terceroDni}
                    onChange={e => setTerceroDni(e.target.value)} />
                </Campo>
                <Campo label="Teléfono">
                  <input className="form-input" value={terceroTelefono}
                    onChange={e => setTerceroTelefono(e.target.value)} />
                </Campo>
                <Campo label="Compañía aseguradora">
                  <input className="form-input" value={terceroCompania}
                    onChange={e => setTerceroCompania(e.target.value)} />
                </Campo>
                <Campo label="Nro. póliza del tercero">
                  <input className="form-input font-mono" value={terceroPoliza}
                    onChange={e => setTerceroPoliza(e.target.value)} />
                </Campo>
                <Campo label="¿Qué era el tercero?">
                  <select className="form-input" value={terceroTipoVehiculo}
                    onChange={e => setTerceroTipoVehiculo(e.target.value)}>
                    <option value="">— Seleccioná —</option>
                    {CATEGORIAS_TERCERO.map(c => (
                      <option key={c.value} value={c.label}>{c.label}</option>
                    ))}
                  </select>
                </Campo>
                <Campo label="Patente">
                  <input className="form-input font-mono uppercase" value={terceroPatente}
                    onChange={e => setTerceroPatente(e.target.value)} />
                </Campo>
                <Campo label="Marca">
                  <input className="form-input" value={terceroMarca}
                    onChange={e => setTerceroMarca(e.target.value)} />
                </Campo>
                <Campo label="Modelo">
                  <input className="form-input" value={terceroModelo}
                    onChange={e => setTerceroModelo(e.target.value)} />
                </Campo>
                <Campo label="Año">
                  <input className="form-input font-mono" value={terceroAnio}
                    onChange={e => setTerceroAnio(e.target.value.replace(/\D/g, ''))} maxLength={4} />
                </Campo>
                <Campo label="Descripción de daños del tercero" col={2}>
                  <textarea className="form-input w-full resize-none" rows={2} value={terceroDanos}
                    onChange={e => setTerceroDanos(e.target.value)}
                    placeholder="Describí los daños del vehículo/persona tercero..." />
                </Campo>
              </>)}
            </>)}
          </div>
        </div>
      )}

      {/* ── Testigos (cualquier ramo) ───────────────────────── */}
      {polizaId && (
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-violet-500" />
            <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Testigos</h3>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="¿Hubo testigos?" col={2}>
              <Toggle value={huboTestigos} onChange={v => {
                setHuboTestigos(v)
                if (!v) setTestigos([{ nombre: '', telefono: '' }])
              }} />
            </Campo>
            {huboTestigos && testigos.map((t, idx) => (
              <div key={idx} className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                <Campo label={`Testigo ${idx + 1} — Nombre y apellido`}>
                  <input
                    className="form-input"
                    value={t.nombre}
                    onChange={e => setTestigos(arr => arr.map((x, i) => i === idx ? { ...x, nombre: e.target.value } : x))}
                  />
                </Campo>
                <Campo label="Teléfono">
                  <input
                    className="form-input"
                    value={t.telefono}
                    onChange={e => setTestigos(arr => arr.map((x, i) => i === idx ? { ...x, telefono: e.target.value } : x))}
                  />
                </Campo>
                {testigos.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setTestigos(arr => arr.filter((_, i) => i !== idx))}
                    className="btn-secondary h-8 w-8 p-0 flex items-center justify-center text-red-500 hover:bg-red-50"
                    title="Quitar testigo"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {huboTestigos && testigos.length < MAX_TESTIGOS && (
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setTestigos(arr => [...arr, { nombre: '', telefono: '' }])}
                  className="btn-secondary text-xs"
                >
                  <Plus className="h-3 w-3" /> Agregar otro testigo
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Datos específicos hogar ─────────────────────────── */}
      {polizaId && esHogar && (
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
            <Home className="h-3.5 w-3.5 text-amber-500" />
            <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Datos del inmueble</h3>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="Tipo de vivienda">
              <select className="form-input" value={tipoVivienda} onChange={e => setTipoVivienda(e.target.value)}>
                <option value="">— Seleccioná —</option>
                <option value="casa">Casa</option>
                <option value="departamento">Departamento</option>
                <option value="ph">PH</option>
                <option value="duplex">Dúplex</option>
              </select>
            </Campo>
            <Campo label="¿Qué pasó?">
              <select className="form-input" value={quePasoHogar} onChange={e => setQuePasoHogar(e.target.value)}>
                <option value="">— Seleccioná —</option>
                <option value="incendio">Incendio</option>
                <option value="robo_hurto">Robo / Hurto</option>
                <option value="filtracion_agua">Filtración de agua</option>
                <option value="granizo">Granizo</option>
                <option value="vendaval">Vendaval</option>
                <option value="danos_electronicos">Daños a equipos electrónicos</option>
                <option value="responsabilidad_civil">Responsabilidad civil</option>
                <option value="otro">Otro</option>
              </select>
            </Campo>
          </div>
        </div>
      )}

      {/* ── Campos específicos configurados por el productor ── */}
      {polizaId && camposDB.length > 0 && (
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
            {ICONOS_RAMO[tipoRiesgo] ?? ICONOS_RAMO.generico}
            <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Datos Específicos — {(polizaInfo?.ramo as any)?.nombre}
            </h3>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {camposDB.map(campo => (
              <Campo
                key={campo.key}
                label={campo.label}
                required={campo.requerido}
                error={errores[`extra_${campo.key}`]}
                col={campo.tipo === 'textarea' ? 2 : 1}
              >
                {campo.tipo === 'textarea' ? (
                  <textarea className={`${ic(`extra_${campo.key}`)} w-full resize-none`} rows={3}
                    value={detalleExtra[campo.key] ?? ''}
                    onChange={e => setDetalle(campo.key, e.target.value)}
                    placeholder={campo.placeholder} />
                ) : campo.tipo === 'select' ? (
                  <select className={ic(`extra_${campo.key}`)}
                    value={detalleExtra[campo.key] ?? ''}
                    onChange={e => setDetalle(campo.key, e.target.value)}>
                    <option value="">— Seleccioná —</option>
                    {campo.opciones?.split(',').map(o => o.trim()).filter(Boolean).map(o => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : campo.tipo === 'date' ? (
                  <input type="date" className={ic(`extra_${campo.key}`)}
                    value={detalleExtra[campo.key] ?? ''}
                    onChange={e => setDetalle(campo.key, e.target.value)} />
                ) : (
                  <input className={ic(`extra_${campo.key}`)}
                    value={detalleExtra[campo.key] ?? ''}
                    onChange={e => setDetalle(campo.key, e.target.value)}
                    placeholder={campo.placeholder} />
                )}
              </Campo>
            ))}
          </div>
        </div>
      )}

      {polizaId && camposDB.length === 0 && polizaInfo && !esAutomotor && !esHogar && !usarCamposDinamicos && (
        <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          Este ramo no tiene campos específicos configurados. Podés agregarlos en
          <button onClick={() => router.push('/crm/configuracion/catalogos')} className="underline font-medium ml-1">
            Configuración → Catálogos → Ramos
          </button>
        </div>
      )}

      {/* ── Campos específicos del tipo de siniestro (para tipos no cubiertos por bloques hardcoded) ── */}
      {polizaId && usarCamposDinamicos && configTipo && (
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
            <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              {configTipo.icono} Datos de {configTipo.label.toLowerCase()}
            </h3>
          </div>
          <div className="p-4">
            <CamposDinamicos
              tipoRiesgo={tipoRiesgo}
              tipoSiniestro={tipoSiniestro}
              valores={valoresDinamicos}
              onChange={setValoresDinamicos}
              errores={errores}
            />
          </div>
        </div>
      )}

      {/* Botones */}
      <div className="flex items-center justify-between pb-4">
        <button onClick={() => router.back()} className="btn-secondary">
          <ArrowLeft className="h-3.5 w-3.5" /> Cancelar
        </button>
        <button onClick={guardar} disabled={guardando} className="btn-primary px-6">
          {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {guardando ? 'Guardando...' : 'Registrar Siniestro'}
        </button>
      </div>
    </div>
  )
}
