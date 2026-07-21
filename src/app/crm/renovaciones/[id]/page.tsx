'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, Save, Loader2, AlertCircle, CheckCircle,
  Car, Home, Heart, Package, Plus, Trash2, Sparkles, X,
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { formatFecha, getPolizaBadgeColor, getLabelEstado } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { registrarEventoBitacora } from '@/lib/bitacora-poliza'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import GestorArchivos from '@/components/GestorArchivos'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { mensajeErrorAmigable } from '@/lib/utils'
import { validarPatente } from '@/lib/importacion/validators'
import { EstadoCarga } from '@/components/EstadoCarga'
import { tipoRenderForm, obtenerTipoRiesgo } from '@/lib/tipos-riesgo'
import { CamposBienAseguradoDinamico, validarCamposDinamicos } from '@/components/CamposBienAseguradoDinamico'
import { CoberturasDesglosadasEditor, type CoberturaDesglosada } from '@/components/CoberturasDesglosadasEditor'
import { keysExtrasDeDetalle, labelHumanoDeKey, valorAString } from '@/lib/detalle-tecnico-extras'
import { opcionesRefacturacion } from '@/lib/refacturaciones'
import { opcionesMedioPago } from '@/lib/medios-pago'
import { vigenciaTextoDesdeFechas } from '@/lib/vigencia'

interface Catalogo { id: string; nombre: string; metadata?: Record<string,any> | null }

interface PolizaOrigen {
  id: string
  numero_poliza: string
  fecha_inicio: string
  fecha_fin: string
  estado: string
  suma_asegurada: number | null
  moneda: string
  mostrar_suma_asegurada_portal: boolean
  asegurado: { id: string; apellido: string; nombre: string | null; razon_social: string | null }
  compania: { id: string; nombre: string } | null
  ramo: { id: string; nombre: string; metadata: Record<string,any> | null } | null
  cobertura: { id: string; nombre: string; metadata: Record<string,any> | null } | null
  refacturacion: string | null
  medio_pago: string | null
  riesgos: { id: string; tipo_riesgo: string; detalle_tecnico: Record<string,any>; suma_asegurada: number | null }[]
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
  automotor: <Car    className="h-4 w-4" />,
  hogar:     <Home   className="h-4 w-4" />,
  vida:      <Heart  className="h-4 w-4" />,
  generico:  <Package className="h-4 w-4" />,
}

// Estado default de un riesgo — se comparte entre el estado inicial, el
// helper para agregar riesgos nuevos y el fallback de índice fuera de rango.
// Fuera del componente para que la referencia sea estable entre renders.
const RIESGO_VACIO: FormRiesgo = {
  patente: '', marca: '', modelo: '', anio: '', motor: '', chasis: '', color: '', uso: 'PARTICULAR',
  calle: '', numero: '', localidad: '', provincia: 'Buenos Aires',
  tipo_construccion: 'MAMPOSTERIA', superficie: '', medidas_seguridad: [],
  capital_asegurado: '', beneficiarios: '',
  descripcion: '',
  detalle_dinamico: {},
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

function nombreCompleto(a: PolizaOrigen['asegurado']) {
  if (a.razon_social) return a.razon_social
  return [a.apellido, a.nombre].filter(Boolean).join(', ')
}

export default function RenovarPolizaPage() {
  const router = useRouter()
  const params = useParams()
  const id     = params.id as string
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  const [origen,    setOrigen]    = useState<PolizaOrigen | null>(null)
  const [cargando,  setCargando]  = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [exito,     setExito]     = useState(false)
  const [errorGral, setErrorGral] = useState('')
  const [errores,   setErrores]   = useState<Record<string,string>>({})
  const [avisos,    setAvisos]    = useState<Record<string,string>>({})

  // Form nueva póliza
  const [numeroPoliza,  setNumeroPoliza]  = useState('')
  const [companiaId,    setCompaniaId]    = useState('')
  const [coberturaId,   setCoberturaId]   = useState('')
  const [fechaInicio,   setFechaInicio]   = useState('')
  const [fechaFin,      setFechaFin]      = useState('')
  const [sumaAsegurada, setSumaAsegurada] = useState('')
  const [moneda, setMoneda] = useState('ARS')
  const [mostrarSumaPortal, setMostrarSumaPortal] = useState(false)
  const [refacturacion, setRefacturacion] = useState('')
  const [medioPago, setMedioPago] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [notas, setNotas] = useState('')

  // Catálogos
  const [companias,      setCompanias]      = useState<Catalogo[]>([])
  const [coberturas,     setCoberturas]     = useState<Catalogo[]>([])

  // Riesgos (soporte flotas mixtas: cada riesgo conserva su propio tipo).
  // tipoRiesgoRamo es el default que viene del ramo del origen — se usa para
  // riesgos nuevos agregados manualmente. Los riesgos copiados del origen
  // mantienen su tipo individual en `tiposPorRiesgo`.
  const [tipoRiesgoRamo, setTipoRiesgoRamo] = useState('generico')
  const [riesgos, setRiesgos] = useState<FormRiesgo[]>([{ ...RIESGO_VACIO }])
  const [tiposPorRiesgo, setTiposPorRiesgo] = useState<string[]>(['generico'])
  const [indiceActivo, setIndiceActivo] = useState(0)
  // Acceso al riesgo activo + su tipo (cada riesgo tiene su propio tipo en flotas mixtas)
  const riesgo = riesgos[indiceActivo] ?? RIESGO_VACIO
  const tipoRiesgo = tiposPorRiesgo[indiceActivo] ?? tipoRiesgoRamo
  // Render del form: los 7 tipos del catálogo mapean a 4 layouts existentes.
  const renderTipo = tipoRenderForm(tipoRiesgo)


  // Snapshot de archivos en documentacion_renovada/ de la origen al abrir el form.
  // Si el PAS sube archivos y luego cancela sin guardar, eliminamos los que no
  // estaban en este snapshot — así no quedan huérfanos en disco.
  const [archivosSnapshot, setArchivosSnapshot] = useState<Set<string>>(new Set())

  const cargar = useCallback(async () => {
    setCargando(true)

    const { data: tipos } = await supabase.from('tipo_catalogo').select('id, codigo')
    const tipoComp   = tipos?.find((t:any) => t.codigo === 'COMPANIA')
    const tipoCobert = tipos?.find((t:any) => t.codigo === 'COBERTURA')

    const [{ data: pol }, { data: comps }, { data: cobs }] = await Promise.all([
      supabase.from('polizas').select(`
        id, numero_poliza, fecha_inicio, fecha_fin, estado, suma_asegurada, moneda, mostrar_suma_asegurada_portal, refacturacion, medio_pago,
        asegurado:personas!asegurado_id (id, apellido, nombre, razon_social),
        compania:catalogos!compania_id (id, nombre),
        ramo:catalogos!ramo_id (id, nombre, metadata),
        cobertura:catalogos!cobertura_id (id, nombre, metadata),
        riesgos (id, tipo_riesgo, detalle_tecnico, suma_asegurada)
      `).eq('id', id).single(),
      tipoComp ? supabase.from('catalogos').select('id,nombre,metadata').eq('tipo_id', tipoComp.id).eq('activo', true).order('nombre') : Promise.resolve({ data: [] }),
      tipoCobert ? supabase.from('catalogos').select('id,nombre,metadata').eq('tipo_id', tipoCobert.id).eq('activo', true).order('nombre') : Promise.resolve({ data: [] }),
    ])

    if (pol) {
      const p = pol as unknown as PolizaOrigen

      // Bloquear renovación de pólizas que no admiten ser renovadas (canceladas/anuladas).
      // Las CANCELADA/ANULADA no son válidas para renovar — el PAS debe rehabilitarlas primero.
      if (['CANCELADA', 'ANULADA'].includes(p.estado)) {
        toast.error({ mensaje: `No se puede renovar una póliza ${p.estado}. Rehabilitala primero.` })
        router.replace(`/crm/polizas/${p.id}`)
        return
      }

      // Bloquear si esta póliza ya tiene una renovación activa (RENOVADA latente o VIGENTE).
      const { data: hijaExistente } = await supabase
        .from('polizas')
        .select('id, numero_poliza, estado')
        .eq('poliza_origen_id', p.id)
        .in('estado', ['RENOVADA', 'VIGENTE', 'PROGRAMADA'])
        .limit(1)
        .maybeSingle()
      if (hijaExistente) {
        toast.error({
          mensaje: `Esta póliza ya tiene una renovación (${(hijaExistente as any).numero_poliza}). No se puede crear otra.`,
        })
        router.replace(`/crm/polizas/${(hijaExistente as any).id}`)
        return
      }

      // Verificar acceso por cartera
      if (!tieneAccesoTotal(usuario)) {
        const { data: asegurado } = await supabase
          .from('personas')
          .select('usuario_id')
          .eq('id', p.asegurado.id)
          .single()
        if (asegurado && asegurado.usuario_id && asegurado.usuario_id !== usuario?.id) {
          router.replace('/crm/renovaciones')
          return
        }
      }

      setOrigen(p)

      // Precargar datos
      setCompaniaId(p.compania?.id ?? '')
      setCoberturaId(p.cobertura?.id ?? '')
      setSumaAsegurada(p.suma_asegurada ? String(p.suma_asegurada) : '')
      setMoneda(p.moneda ?? 'ARS')
      setMostrarSumaPortal(p.mostrar_suma_asegurada_portal ?? false)
      setRefacturacion(p.refacturacion ?? '')
      setMedioPago((p as any).medio_pago ?? '')

      // Riesgos — copiamos TODOS los del origen, conservando el tipo de cada uno
      // (soporte flotas mixtas: una flota puede tener autos y motos).
      const tipoRamoOrigen = p.ramo?.metadata?.tipo_riesgo ?? 'generico'
      setTipoRiesgoRamo(tipoRamoOrigen)
      const str = (v: any) => (v == null ? '' : String(v))
      const aFormRiesgo = (dt: any): FormRiesgo => ({
        patente: str(dt?.patente), marca: str(dt?.marca), modelo: str(dt?.modelo),
        anio: str(dt?.anio), motor: str(dt?.motor), chasis: str(dt?.chasis),
        color: str(dt?.color), uso: str(dt?.uso) || 'PARTICULAR',
        calle: str(dt?.calle), numero: str(dt?.numero),
        localidad: str(dt?.localidad), provincia: str(dt?.provincia) || 'Buenos Aires',
        tipo_construccion: str(dt?.tipo_construccion) || 'MAMPOSTERIA',
        superficie: str(dt?.superficie),
        medidas_seguridad: Array.isArray(dt?.medidas_seguridad) ? dt.medidas_seguridad : [],
        capital_asegurado: str(dt?.capital_asegurado), beneficiarios: str(dt?.beneficiarios),
        descripcion: str(dt?.descripcion),
        detalle_dinamico: (dt && typeof dt === 'object') ? { ...dt } : {},
      })
      const riesgosOrigen = (p.riesgos ?? [])
      const lista = riesgosOrigen.map(r => aFormRiesgo(r.detalle_tecnico))
      const tipos = riesgosOrigen.map(r =>
        (r.tipo_riesgo ?? '').toLowerCase() || tipoRamoOrigen
      )
      setRiesgos(lista.length > 0 ? lista : [{ ...RIESGO_VACIO }])
      setTiposPorRiesgo(tipos.length > 0 ? tipos : [tipoRamoOrigen])
      setIndiceActivo(0)

      // Snapshot de archivos pre-existentes en documentacion_renovada/ de la origen
      // (de algún intento previo). Los que se suban DESPUÉS quedan marcados como
      // "agregados en esta sesión" y se borran si el PAS cancela sin guardar.
      const { data: archivosPrevios } = await supabase
        .from('poliza_archivos')
        .select('id')
        .eq('poliza_id', p.id)
        .eq('categoria', 'documentacion_renovada')
      setArchivosSnapshot(new Set((archivosPrevios ?? []).map((a: any) => a.id)))
    }

    setCompanias((comps ?? []) as Catalogo[])
    setCoberturas((cobs ?? []) as Catalogo[])
    setCargando(false)
  }, [supabase, id, usuario, router])

  useEffect(() => { cargar() }, [cargar])

  // Si el usuario tocó manualmente fecha_fin, no la sobreescribimos.
  // (Por compatibilidad con onChange existente; ya no hay auto-cálculo.)
  const [fechaFinTocada, setFechaFinTocada] = useState(false)
  void fechaFinTocada

  // Coberturas filtradas por ramo
  const coberturasFiltradas = origen?.ramo?.id
    ? coberturas.filter(c => {
        const ramoIds = (c.metadata ?? {}).ramo_ids as string[] | undefined
        return ramoIds && ramoIds.includes(origen.ramo!.id)
      })
    : []

  const setR = (k: keyof FormRiesgo, v: any) => {
    setRiesgos(prev => prev.map((r, i) => i === indiceActivo ? { ...r, [k]: v } : r))
    setErrores(e => ({ ...e, [`r_${k}`]: '' }))
  }

  const agregarRiesgo = () => {
    setRiesgos(prev => [...prev, { ...RIESGO_VACIO }])
    setTiposPorRiesgo(prev => [...prev, tipoRiesgoRamo])
    setIndiceActivo(riesgos.length)
    setErrores({})
  }

  const eliminarRiesgo = (idx: number) => {
    if (riesgos.length <= 1) return
    setRiesgos(prev => prev.filter((_, i) => i !== idx))
    setTiposPorRiesgo(prev => prev.filter((_, i) => i !== idx))
    if (indiceActivo >= idx) setIndiceActivo(Math.max(0, indiceActivo - 1))
  }

  // Cancelar el form y limpiar los archivos que el PAS subió en esta sesión.
  // Los archivos previos del snapshot quedan intactos.
  const cancelarYLimpiar = async () => {
    if (!origen) { router.back(); return }

    // Buscar archivos actuales en documentacion_renovada/ de la origen.
    const { data: archivosActuales } = await supabase
      .from('poliza_archivos')
      .select('id')
      .eq('poliza_id', origen.id)
      .eq('categoria', 'documentacion_renovada')

    const idsNuevos = (archivosActuales ?? [])
      .map((a: any) => a.id)
      .filter((id: string) => !archivosSnapshot.has(id))

    if (idsNuevos.length > 0) {
      const ok = window.confirm(
        `Subiste ${idsNuevos.length} archivo(s) en este intento. ¿Querés descartarlos al salir?\n\n` +
        `Aceptar = se eliminan.\n` +
        `Cancelar = quedan en disco para el próximo intento de renovación.`,
      )
      if (ok) {
        // Eliminar uno por uno via el endpoint con ownership
        for (const id of idsNuevos) {
          await apiCall('/api/storage/delete', {
            method: 'DELETE',
            body: { archivo_id: id, tabla: 'poliza_archivos' },
          }, { mostrar_toast_en_error: false })
        }
      }
    }

    router.back()
  }

  const validar = () => {
    const e: Record<string,string> = {}
    if (!numeroPoliza.trim()) e.numero_poliza = 'El número de póliza es obligatorio'
    if (!fechaInicio)         e.fecha_inicio  = 'Fecha de inicio obligatoria'
    if (!fechaFin)            e.fecha_fin     = 'Fecha de fin obligatoria'
    if (fechaInicio && fechaFin && fechaFin <= fechaInicio) {
      e.fecha_fin = 'La fecha de fin debe ser posterior a la fecha de inicio'
    }
    // No-solapamiento con la póliza origen: la renovación arranca cuando termina la actual.
    if (fechaInicio && origen?.fecha_fin && fechaInicio < origen.fecha_fin) {
      e.fecha_inicio = `La renovación no puede arrancar antes del fin de la póliza original (${origen.fecha_fin})`
    }
    // Validar todos los riesgos según el tipo individual de cada uno (flotas mixtas).
    const a: Record<string,string> = {}
    for (let i = 0; i < riesgos.length; i++) {
      const r = riesgos[i]
      const tipoIndividual = tiposPorRiesgo[i] ?? tipoRiesgoRamo
      const renderIndividual = tipoRenderForm(tipoIndividual)
      const errR: Record<string,string> = {}
      if (renderIndividual === 'automotor') {
        if (!r.patente.trim()) errR.r_patente = 'La patente es obligatoria'
        else if (r.patente.trim().length >= 6) {
          const resPatente = validarPatente(r.patente)
          if (!resPatente.valido) a.r_patente = 'Formato de patente no reconocido (esperado: ABC123 o AB123CD)'
        }
        if (!r.marca.trim())   errR.r_marca   = 'La marca es obligatoria'
        if (!r.modelo.trim())  errR.r_modelo  = 'El modelo es obligatorio'
        if (!r.anio.trim())    errR.r_anio    = 'El año es obligatorio'
      } else if (renderIndividual === 'hogar') {
        if (!r.calle.trim())     errR.r_calle     = 'La calle es obligatoria'
        if (!r.localidad.trim()) errR.r_localidad = 'La localidad es obligatoria'
      } else if (renderIndividual === 'dinamico') {
        Object.assign(errR, validarCamposDinamicos(tipoIndividual, r.detalle_dinamico))
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
    if (!validar() || !origen) return
    setGuardando(true); setErrorGral('')
    try {
      // Chequeo de duplicado: no permitir mismo numero_poliza en la misma compañía.
      // Está permitido que dos compañías usen el mismo número.
      if (companiaId) {
        const { data: existente } = await supabase
          .from('polizas')
          .select('id')
          .eq('compania_id', companiaId)
          .eq('numero_poliza', numeroPoliza.trim())
          .maybeSingle()
        if (existente) {
          setErrores(e => ({ ...e, numero_poliza: 'Ya existe una póliza con este número en esta compañía' }))
          setGuardando(false)
          return
        }
      }

      // Siempre insertamos como RENOVADA latente. Después delegamos la activación
      // al endpoint /activar-renovacion, que internamente decide si corresponde
      // pasarla a VIGENTE (idempotente, mismo helper que usa el cron).
      const { data: nuevaData, error: pErr } = await supabase
        .from('polizas')
        .insert({
          asegurado_id:     origen.asegurado.id,
          compania_id:      companiaId || null,
          ramo_id:          origen.ramo?.id || null,
          cobertura_id:     coberturaId || null,
          numero_poliza:    numeroPoliza.trim(),
          fecha_inicio:     fechaInicio,
          fecha_fin:        fechaFin,
          suma_asegurada:   parseFloat(sumaAsegurada) || null,
          moneda:           moneda || 'ARS',
          mostrar_suma_asegurada_portal: mostrarSumaPortal,
          refacturacion:    refacturacion || null,
          medio_pago:       medioPago || null,
          estado:           'RENOVADA',
          poliza_origen_id: origen.id,
          observaciones:    observaciones || null,
          notas:            notas || null,
        })
        .select('id').single()

      if (pErr) throw new Error(pErr.message)
      const nuevaId = (nuevaData as any).id

      // 2) Crear riesgos ANTES de tocar la origen — si falla, rollback limpio.
      // Cada riesgo conserva su tipo individual (soporte flotas mixtas).
      const detalleDe = (r: FormRiesgo, tipo: string): Record<string,any> => {
        // Base con las keys extras heredadas de la póliza origen (típicamente
        // `observaciones` que la IA agregó al importar/procesar PDF, más
        // cualquier otro campo suelto). Sin este merge, la renovación pierde
        // toda esa información al reconstruir el detalle_tecnico desde cero.
        const base = r.detalle_dinamico && typeof r.detalle_dinamico === 'object'
          ? { ...r.detalle_dinamico }
          : {}
        if (tipo === 'automotor') {
          return { ...base, patente: r.patente.toUpperCase().replace(/\s/g,''), marca: r.marca, modelo: r.modelo, anio: r.anio, motor: r.motor||null, chasis: r.chasis||null, color: r.color||null, uso: r.uso }
        }
        if (tipo === 'hogar') {
          return { ...base, calle: r.calle, numero: r.numero||null, localidad: r.localidad, provincia: r.provincia, tipo_construccion: r.tipo_construccion, superficie: r.superficie||null, medidas_seguridad: r.medidas_seguridad }
        }
        if (tipo === 'vida') {
          return { ...base, capital_asegurado: r.capital_asegurado||null, beneficiarios: r.beneficiarios||null }
        }
        if (tipo === 'dinamico') {
          return { ...r.detalle_dinamico }
        }
        return { ...base, descripcion: r.descripcion||null }
      }

      const filasRiesgos = riesgos.map((r, i) => {
        const tipoIndividual = tiposPorRiesgo[i] ?? tipoRiesgoRamo
        const renderIndividual = tipoRenderForm(tipoIndividual)
        return {
          poliza_id:       nuevaId,
          // En DB guardamos el tipo original (puede ser nuevo: integrales,
          // personas, etc.). El detalle_tecnico usa el render compatible.
          tipo_riesgo:     tipoIndividual.toUpperCase(),
          detalle_tecnico: detalleDe(r, renderIndividual),
          numero_item:     i + 1, // respeta UNIQUE(poliza_id, numero_item)
        }
      })

      const { error: rErr } = await supabase.from('riesgos').insert(filasRiesgos)
      if (rErr) {
        // Rollback: la póliza nueva NO debe quedar sin riesgos, y aún no escribimos
        // bitácora ni tocamos la origen — el rollback es seguro.
        await supabase.from('polizas').delete().eq('id', nuevaId)
        throw new Error(rErr.message)
      }

      // 3) Bitácora — solo después de confirmar que póliza+riesgo se crearon
      await registrarEventoBitacora(supabase, {
        poliza_id: origen.id,
        tipo_evento: 'RENOVACION_CREADA',
        estado_anterior: null,
        estado_nuevo: null,
        motivo: `Renovación creada con número ${numeroPoliza.trim()}`,
        observaciones: `Nueva póliza id ${nuevaId}`,
        usuario_id: usuario?.id || null,
      })
      await registrarEventoBitacora(supabase, {
        poliza_id: nuevaId,
        tipo_evento: 'CREACION',
        estado_nuevo: 'RENOVADA',
        motivo: `Renovación de póliza ${origen.numero_poliza}`,
        usuario_id: usuario?.id || null,
      })

      // 4) Activar inmediatamente si corresponde (fecha_inicio <= hoy en AR).
      // El endpoint usa activarRenovadaSiCorresponde que es idempotente: si la fecha
      // es futura, no hace nada y la póliza queda RENOVADA esperando al cron.
      const r = await apiCall(`/api/polizas/${nuevaId}/activar-renovacion`, {
        method: 'POST',
      }, { mostrar_toast_en_error: false })
      if (!r.ok) {
        toast.warning('La renovación se creó pero falló la activación automática. Revisá la póliza nueva y los archivos.')
      }

      setExito(true)
      toast.exito('Renovación creada correctamente')
      setTimeout(() => router.push(`/crm/polizas/${nuevaId}`), 1200)
    } catch(err: any) {
      if (err.message?.includes('uq_poliza_compania_numero')) {
        setErrorGral('Ya existe una póliza con ese número para la compañía seleccionada.')
      } else {
        setErrorGral(mensajeErrorAmigable(err, 'No se pudo crear la renovación'))
      }
    } finally {
      setGuardando(false)
    }
  }

  const ic = (k: string) => `form-input ${errores[k] ? 'border-red-300' : ''}`

  if (cargando) return (
    <EstadoCarga loading={true} error={null} empty={false}>
      <div />
    </EstadoCarga>
  )

  if (!origen) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <span className="text-slate-500 text-sm">Póliza no encontrada</span>
      <button onClick={() => router.push('/crm/renovaciones')} className="btn-secondary">
        <ArrowLeft className="h-3 w-3" /> Volver
      </button>
    </div>
  )

  if (exito) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
        <CheckCircle className="h-6 w-6 text-green-600" />
      </div>
      <p className="text-sm font-medium text-slate-700">Renovación guardada</p>
      <p className="text-xs text-slate-600">Redirigiendo a la nueva póliza...</p>
    </div>
  )

  const ramoNombre = origen.ramo?.nombre ?? '—'

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => router.back()} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center" title="Volver">
            <ArrowLeft className="h-3 w-3" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Renovar Póliza</h1>
            <p className="text-xs text-slate-600">Póliza actual: <span className="font-mono font-semibold">{origen.numero_poliza}</span></p>
          </div>
        </div>
        <button onClick={guardar} disabled={guardando} className="btn-primary px-5">
          {guardando ? <Loader2 className="h-3 w-3 animate-spin"/> : <Save className="h-3 w-3"/>}
          {guardando ? 'Guardando...' : 'Confirmar Renovación'}
        </button>
      </div>

      {errorGral && (
        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0"/>{errorGral}
        </div>
      )}

      {/* Sección 1 — Referencia */}
      <div className="bg-slate-50 border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-200">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Póliza actual (referencia)</h3>
        </div>
        <div className="p-4 grid grid-cols-3 gap-3 text-xs">
          <div>
            <span className="text-slate-600">Cliente</span>
            <p className="text-slate-700 font-medium">{nombreCompleto(origen.asegurado)}</p>
          </div>
          <div>
            <span className="text-slate-600">Compañía</span>
            <p className="text-slate-700 font-medium">{origen.compania?.nombre ?? '—'}</p>
          </div>
          <div>
            <span className="text-slate-600">Ramo / Cobertura</span>
            <p className="text-slate-700 font-medium">{ramoNombre}{origen.cobertura ? ` · ${origen.cobertura.nombre}` : ''}</p>
          </div>
          <div>
            <span className="text-slate-600">Vigencia anterior</span>
            <p className="text-slate-700 font-medium">{formatFecha(origen.fecha_inicio)} → {formatFecha(origen.fecha_fin)}</p>
          </div>
          <div>
            <span className="text-slate-600">Estado</span>
            <p><span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${getPolizaBadgeColor(origen.estado)}`}>{getLabelEstado(origen.estado)}</span></p>
          </div>
        </div>
      </div>

      {/* Sección 2 — Nueva póliza */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Nueva póliza</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Campo label="Número de póliza nuevo" required error={errores.numero_poliza} col={2}>
            <input className={`${ic('numero_poliza')} font-mono`} value={numeroPoliza}
              onChange={e => { setNumeroPoliza(e.target.value); setErrores(er => ({...er, numero_poliza: ''})) }}
              placeholder="Número de la nueva póliza"/>
          </Campo>
          <Campo label="Compañía">
            <select className="form-input" value={companiaId} onChange={e => setCompaniaId(e.target.value)}>
              <option value="">— Seleccioná —</option>
              {companias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Ramo">
            <input className="form-input bg-slate-50" value={ramoNombre} readOnly />
          </Campo>
          <Campo label="Cobertura" col={2}>
            <select className="form-input" value={coberturaId} onChange={e => setCoberturaId(e.target.value)}>
              <option value="">— Seleccioná —</option>
              {coberturasFiltradas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Fecha de inicio" required error={errores.fecha_inicio}>
            <input type="date" className={ic('fecha_inicio')} value={fechaInicio}
              onChange={e => { setFechaInicio(e.target.value); setErrores(er => ({...er, fecha_inicio: ''})) }}/>
          </Campo>
          <Campo label="Fecha de fin" required error={errores.fecha_fin}>
            <input type="date" className={ic('fecha_fin')} value={fechaFin}
              onChange={e => { setFechaFin(e.target.value); setFechaFinTocada(true); setErrores(er => ({...er, fecha_fin: ''})) }}/>
          </Campo>
          <Campo label="Refacturación">
            <select className="form-input" value={refacturacion} onChange={e => setRefacturacion(e.target.value)}>
              <option value="">— Seleccioná —</option>
              {opcionesRefacturacion().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Campo>
          <Campo label="Medio de pago">
            <select className="form-input" value={medioPago} onChange={e => setMedioPago(e.target.value)}>
              <option value="">— Seleccioná —</option>
              {opcionesMedioPago().map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
            </select>
          </Campo>
          <Campo label="Vigencia">
            <div className="form-input bg-slate-50 text-slate-600 flex items-center">
              {fechaInicio && fechaFin
                ? vigenciaTextoDesdeFechas(fechaInicio, fechaFin)
                : <span className="text-slate-500">Se calcula con las fechas</span>}
            </div>
          </Campo>
          <Campo label="Suma asegurada">
            <div className="flex gap-1">
              <select className="form-input rounded-r-none w-20" value={moneda} onChange={e => setMoneda(e.target.value)}>
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
              </select>
              <input className="form-input font-mono rounded-l-none flex-1" value={sumaAsegurada}
                onChange={e => setSumaAsegurada(e.target.value.replace(/[^\d.]/g,''))}
                placeholder="0" inputMode="decimal"/>
            </div>
          </Campo>
          <Campo label="Mostrar en el portal del asegurado" col={2}>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox"
                checked={mostrarSumaPortal}
                onChange={e => setMostrarSumaPortal(e.target.checked)}
                className="mt-0.5"/>
              <span className="text-xs text-slate-600 leading-tight">
                Permitir que el asegurado vea la suma asegurada en el portal.
                <span className="block text-slate-500 mt-0.5">
                  Recomendado para sumas fijas (hogar, robo de bien no registrable, etc.).
                  Dejar destildado si la suma varía mes a mes (típico en auto).
                </span>
              </span>
            </label>
          </Campo>
        </div>
      </div>

      {/* Sección 3 — Datos del riesgo (con soporte multi-riesgo / flotas) */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
          {ICONOS[tipoRiesgo] ?? ICONOS.generico}
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            {riesgos.length > 1 ? `Bienes asegurados (${riesgos.length}) — ${ramoNombre}` : `Datos del Bien Asegurado — ${ramoNombre}`}
          </h3>
          <button
            type="button"
            onClick={agregarRiesgo}
            className="ml-auto btn-secondary text-xs flex items-center gap-1"
            title="Agregar otro bien (flotas, múltiples bienes, etc.)"
          >
            <Plus className="h-3 w-3" /> Agregar bien
          </button>
        </div>

        {riesgos.length > 1 && (
          <div className="px-4 pt-3 flex flex-wrap gap-1.5 border-b border-slate-100 pb-3">
            {riesgos.map((r, i) => {
              const activo = i === indiceActivo
              const tipoIndividual = tiposPorRiesgo[i] ?? tipoRiesgoRamo
              const renderIndividual = tipoRenderForm(tipoIndividual)
              const label = renderIndividual === 'automotor' && r.patente
                ? r.patente
                : renderIndividual === 'hogar' && r.calle
                  ? `${r.calle}${r.numero ? ' ' + r.numero : ''}`
                  : `Bien ${i + 1}`
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
                    className="px-1.5 py-1 text-slate-500 hover:text-red-600"
                    title="Eliminar este bien"
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
            <Campo label="Superficie (m2)">
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
            {/* Capital asegurado se carga en "Suma asegurada" arriba (evita duplicar). */}
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
            <Campo label="Descripción del bien asegurado" col={2}>
              <textarea className="form-input w-full resize-none" rows={3} value={riesgo.descripcion} onChange={e => setR('descripcion', e.target.value)} placeholder="Describí el bien asegurado..."/>
            </Campo>
          )}

          {/* Observaciones libres del bien asegurado — Se preserva desde la
              póliza origen (mergeado en detalleDe) y se puede editar acá.
              Se guarda en detalle_tecnico.observaciones del riesgo. */}
          <Campo label="Observaciones del bien asegurado" col={2}>
            <textarea
              className="form-input w-full resize-none"
              rows={3}
              value={riesgo.detalle_dinamico?.observaciones ?? ''}
              onChange={e => setR('detalle_dinamico', { ...(riesgo.detalle_dinamico ?? {}), observaciones: e.target.value })}
              placeholder="Info libre sobre el bien (sublímites, cláusulas específicas, condiciones particulares que no encajan en los campos)..."
            />
          </Campo>

          {/* Coberturas desglosadas — se preserva desde la póliza origen y se
              puede ajustar en la renovación (típico integrales donde las sumas
              se actualizan año a año). Se guarda en detalle_tecnico.
              coberturas_desglosadas del riesgo. */}
          <div className="col-span-2">
            <CoberturasDesglosadasEditor
              valor={riesgo.detalle_dinamico?.coberturas_desglosadas}
              onChange={(nuevo: CoberturaDesglosada[]) => {
                const dt = { ...(riesgo.detalle_dinamico ?? {}) }
                if (nuevo.length === 0) {
                  delete dt.coberturas_desglosadas
                } else {
                  dt.coberturas_desglosadas = nuevo
                }
                setR('detalle_dinamico', dt)
              }}
              moneda={moneda}
            />
          </div>

          {/* Datos adicionales — keys que la IA agregó y no están en el schema
              hardcodeado del render tipo. Ver detalle-tecnico-extras.ts. */}
          {(() => {
            // En render 'dinamico' hay que excluir las keys ya renderizadas
            // por CamposBienAseguradoDinamico, sino aparecen duplicadas
            // (bug: editar el extra pisa el JSONB y borra el input core).
            const keysCoreDinamicas = renderTipo === 'dinamico'
              ? obtenerTipoRiesgo(tipoRiesgo).campos_poliza.map(c => c.key)
              : undefined
            const extras = keysExtrasDeDetalle(riesgo.detalle_dinamico, renderTipo as any, keysCoreDinamicas)
            if (extras.length === 0) return null
            return (
              <div className="col-span-2 pt-3 mt-1 border-t border-slate-100">
                <div className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                  Datos adicionales
                  <span className="text-2xs text-slate-500 font-normal">
                    · cargados por el agente IA o importados
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {extras.map((k) => (
                    <div key={k}>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        {labelHumanoDeKey(k)}
                      </label>
                      <div className="flex gap-1.5">
                        <input
                          className="form-input flex-1"
                          value={valorAString(riesgo.detalle_dinamico?.[k])}
                          onChange={(e) => setR('detalle_dinamico', {
                            ...(riesgo.detalle_dinamico ?? {}),
                            [k]: e.target.value,
                          })}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const nuevo = { ...(riesgo.detalle_dinamico ?? {}) }
                            delete nuevo[k]
                            setR('detalle_dinamico', nuevo)
                          }}
                          title="Eliminar este campo del bien asegurado"
                          className="btn-tabla-accion-danger shrink-0"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      {/* Sección 4 — Documentación de la renovación */}
      <GestorArchivos
        polizaId={id}
        numeroPoliza={origen.numero_poliza}
        categoria="documentacion_renovada"
        titulo="Documentación de la renovación"
      />

      {/* Observaciones y Notas */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Observaciones y Notas</h3>
        </div>
        <div className="p-4 grid grid-cols-1 gap-3">
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <label className="text-xs text-slate-700 font-medium">Observaciones</label>
              <span className="text-2xs text-emerald-700 font-medium">Visible en el portal del asegurado</span>
            </div>
            <textarea
              className="form-input w-full resize-none"
              rows={2}
              value={observaciones}
              onChange={e => setObservaciones(e.target.value)}
              placeholder="Info que puede ver el cliente en su portal..."
            />
          </div>
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <label className="text-xs text-slate-700 font-medium">Notas internas</label>
              <span className="text-2xs text-slate-600 font-medium">Uso interno · no se comparte con el asegurado</span>
            </div>
            <textarea
              className="form-input w-full resize-none"
              rows={2}
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Comentarios privados sobre la renovación..."
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pb-4">
        <button onClick={cancelarYLimpiar} className="btn-secondary">
          <ArrowLeft className="h-3 w-3"/> Cancelar
        </button>
        <button onClick={guardar} disabled={guardando} className="btn-primary px-6">
          {guardando ? <Loader2 className="h-3 w-3 animate-spin"/> : <Save className="h-3 w-3"/>}
          {guardando ? 'Guardando...' : 'Confirmar Renovación'}
        </button>
      </div>
    </div>
  )
}
