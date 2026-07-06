'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft, ChevronRight, X, Plus, CheckCircle, Edit,
  FileText, ClipboardList, AlertTriangle, Loader2, Repeat,
  CalendarDays, Eye, List, Target, Sparkles as SparklesIcon,
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { hoyLocal, calcularSiguienteFechaRecurrencia, getEstadoEfectivoPoliza } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { obtenerIdsPersonas, filtrarPorPersonas, obtenerIdsPapelera, excluirPersonasEnPapelera } from '@/lib/cartera-filter'
import { toast } from '@/lib/toast'
import { apiCall } from '@/lib/api-client'
import { EstadoCarga } from '@/components/EstadoCarga'
import EventoModal, { type Evento } from '@/components/EventoModal'

// ── Tipos ─────────────��──────────────────────────────────────
interface TareaCal {
  id: string
  titulo: string
  tipo: string
  fecha_vencimiento: string
  hora_vencimiento: string | null
  prioridad: string
  estado: string
  recurrencia: string
  descripcion: string | null
  persona_id: string
  poliza_id: string | null
  siniestro_id: string | null
  nota_cierre: string | null
  persona: { id: string; apellido: string; nombre: string | null; razon_social: string | null }
}

interface PolizaCal {
  id: string
  numero_poliza: string
  fecha_fin: string
  estado: string
  tiene_renovacion_activa: boolean
  asegurado: { id: string; apellido: string; nombre: string | null; razon_social: string | null }
  compania: { id: string; nombre: string } | null
  ramo: { id: string; nombre: string } | null
}

interface OportunidadCal {
  id: string
  tipo: string
  estado: string
  fecha_proximo_contacto: string
  persona: { id: string; apellido: string; nombre: string | null; razon_social: string | null }
}

interface Catalogo { id: string; nombre: string }

// ── Helpers ───────────────────���──────────────────────────────
function nombrePersona(p: { apellido: string; nombre: string | null; razon_social: string | null }) {
  return [p?.apellido, p?.nombre].filter(Boolean).join(', ') || p?.razon_social || '—'
}

function fechaLocal(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

function primerDiaMes(anio: number, mes: number): number {
  const d = new Date(anio, mes, 1).getDay()
  return d === 0 ? 6 : d - 1 // Lunes = 0
}

function diasEnMes(anio: number, mes: number): number {
  return new Date(anio, mes + 1, 0).getDate()
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const DIAS_SEMANA = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa', 'Do']

function prioridadBadge(p: string) {
  const map: Record<string, { label: string; color: string }> = {
    CRITICA: { label: 'Critica', color: 'bg-red-50 text-red-700 border-red-200' },
    ALTA:    { label: 'Alta',    color: 'bg-orange-50 text-orange-700 border-orange-200' },
    MEDIA:   { label: 'Media',   color: 'bg-amber-50 text-amber-700 border-amber-200' },
    BAJA:    { label: 'Baja',    color: 'bg-slate-100 text-slate-600 border-slate-200' },
  }
  return map[p] ?? map.BAJA
}

function diaSemanaLabel(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-').map(Number)
  const d = new Date(anio, mes - 1, dia)
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
}

// ── Colores de eventos ──────────────────────────────────────
// v1.0.76 — 3 tipos = 3 colores. La urgencia (vencida / hoy / futura)
// deja de codificarse con color: para tareas COMPLETADAS/CANCELADAS
// atenuamos con opacity+línea tachada; para el resto se usa el mismo
// color base según tipo de evento. Colores bien contrastados entre sí:
//   Tareas       → azul
//   Vencimientos → naranja
//   Oportunidades → violeta
function tareaColor(t: TareaCal, _hoy: string): string {
  if (t.estado === 'COMPLETADA' || t.estado === 'CANCELADA')
    return 'bg-slate-100 text-slate-500'
  return 'bg-blue-100 text-blue-700 border border-blue-300'
}

function polizaColor(p: PolizaCal, hoy: string): string {
  // Vencida sin renovar (mismo criterio que en /crm/renovaciones y /crm/polizas):
  // no está "cerrada" hasta que el PAS la renueve, cancele o anule.
  // Se pinta en rojo para llamar la atención — es gestión pendiente, no evento futuro.
  const efectivo = getEstadoEfectivoPoliza(p.estado, p.fecha_fin, p.tiene_renovacion_activa)
  if (efectivo === 'VENCIDA') return 'bg-red-100 text-red-700 border border-red-300'
  return 'bg-orange-100 text-orange-700 border border-orange-300'
  void hoy
}

function oportunidadColor(): string {
  return 'bg-violet-100 text-violet-700 border border-violet-300'
}

function eventoColor(e: EventoCal): string {
  if (e.estado === 'COMPLETADO' || e.estado === 'CANCELADO')
    return 'bg-slate-100 text-slate-500'
  return 'bg-emerald-100 text-emerald-700 border border-emerald-300'
}

interface EventoCal {
  id: string
  titulo: string
  descripcion: string | null
  fecha: string
  hora_inicio: string | null
  hora_fin: string | null
  categoria: string | null
  recurrencia: 'NINGUNA' | 'DIARIA' | 'SEMANAL' | 'MENSUAL' | 'ANUAL'
  estado: 'PROGRAMADO' | 'COMPLETADO' | 'CANCELADO'
  compartido: boolean
  usuario_id: string
}

// ── Componente ──────────────���────────────────────────────────
export default function CalendarioPage() {
  const router   = useRouter()
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()
  const hoy      = hoyLocal()

  const hoyParts = hoy.split('-').map(Number)
  const [anio, setAnio] = useState(hoyParts[0])
  const [mes, setMes]   = useState(hoyParts[1] - 1) // 0-indexed

  const [tareas,        setTareas]        = useState<TareaCal[]>([])
  const [polizas,       setPolizas]       = useState<PolizaCal[]>([])
  const [oportunidades, setOportunidades] = useState<OportunidadCal[]>([])
  const [eventos,       setEventos]       = useState<EventoCal[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<{ codigo?: string; mensaje: string } | null>(null)

  const [vista, setVista]           = useState<'calendario' | 'lista'>('calendario')
  const [diaSeleccionado, setDiaSeleccionado] = useState<string | null>(null)

  const [mostrarTareas,        setMostrarTareas]        = useState(true)
  const [mostrarPolizas,       setMostrarPolizas]       = useState(true)
  const [mostrarOportunidades, setMostrarOportunidades] = useState(true)
  const [mostrarEventos,       setMostrarEventos]       = useState(true)
  const [filtroCompania, setFiltroCompania] = useState('')
  const [companias,      setCompanias]      = useState<Catalogo[]>([])

  // Modal completar
  const [modalTarea,  setModalTarea]  = useState<TareaCal | null>(null)
  const [notaCierre,  setNotaCierre]  = useState('')
  const [completando, setCompletando] = useState(false)

  // Modal evento (crear/editar)
  const [modalEvento, setModalEvento] = useState<{ abierto: boolean; evento: Evento | null; fechaInicial?: string }>({
    abierto: false, evento: null,
  })

  // ── Cargar catálogos ───────────────────────────────────
  useEffect(() => {
    async function cargar() {
      const { data: tipos } = await supabase.from('tipo_catalogo').select('id, codigo')
      if (!tipos) return
      const tipoComp = tipos.find((t: any) => t.codigo === 'COMPANIA')
      if (tipoComp) {
        const { data } = await supabase.from('catalogos').select('id,nombre').eq('tipo_id', tipoComp.id).eq('activo', true).order('nombre')
        setCompanias((data ?? []) as Catalogo[])
      }
    }
    cargar()
  }, [supabase])

  // ── Cargar datos del mes ─────────��─────────────────────
  const cargarDatos = useCallback(async () => {
    setCargando(true)
    setErrorCarga(null)
    const primerDia = fechaLocal(anio, mes, 1)
    const ultimoDia = fechaLocal(anio, mes, diasEnMes(anio, mes))

    // Para vista lista: próximos 30 días desde hoy
    const en30 = new Date()
    en30.setDate(en30.getDate() + 30)
    const en30str = `${en30.getFullYear()}-${String(en30.getMonth() + 1).padStart(2, '0')}-${String(en30.getDate()).padStart(2, '0')}`

    // Rango amplio: cubrir tanto el mes del calendario como los próximos 30 días
    const rangoInicio = primerDia < hoy ? primerDia : hoy
    const rangoFin = ultimoDia > en30str ? ultimoDia : en30str

    // Obtener IDs de personas para filtro de cartera + IDs de papelera.
    // Para usuarios con acceso TOTAL, obtenerIdsPersonas devuelve null
    // (sin filtro) — pero hay que excluir explícitamente a las personas en
    // papelera para que sus eventos no aparezcan en el calendario.
    const [idsPersonas, papeleraIds] = await Promise.all([
      obtenerIdsPersonas(supabase, usuario),
      obtenerIdsPapelera(supabase),
    ])

    // Solo traemos tareas activas: COMPLETADA/CANCELADA no se muestran en
    // el calendario y filtrarlas server-side reduce bandwidth.
    let queryTareas = supabase
      .from('tareas')
      .select(`
        id, titulo, tipo, fecha_vencimiento, hora_vencimiento,
        prioridad, estado, recurrencia, descripcion,
        persona_id, poliza_id, siniestro_id, nota_cierre,
        persona:personas!tareas_persona_id_fkey (id, apellido, nombre, razon_social)
      `)
      .in('estado', ['PENDIENTE', 'EN_PROCESO'])
      .gte('fecha_vencimiento', rangoInicio)
      .lte('fecha_vencimiento', rangoFin)
      .order('fecha_vencimiento')

    // Filtrado por persona excluye papelera automáticamente (PROPIA);
    // para TOTAL/admin agregamos exclusión explícita de papelera.
    queryTareas = excluirPersonasEnPapelera(
      filtrarPorPersonas(queryTareas, idsPersonas, 'persona_id'),
      papeleraIds,
      'persona_id',
    )

    // Incluimos NO_VIGENTE porque el criterio del CRM es: una póliza que
    // venció y NO se renovó sigue siendo gestión pendiente ("Vencida"). Solo
    // desaparece del calendario cuando aparece una hija RENOVADA/VIGENTE que
    // la reemplaza — igual que en el listado de renovaciones y en el helper
    // getEstadoEfectivoPoliza. Ver [[patron_estado_efectivo_poliza]].
    let queryPolizas = supabase
      .from('polizas')
      .select(`
        id, numero_poliza, fecha_fin, estado,
        asegurado:personas!asegurado_id (id, apellido, nombre, razon_social),
        compania:catalogos!compania_id (id, nombre),
        ramo:catalogos!ramo_id (id, nombre)
      `)
      .gte('fecha_fin', rangoInicio)
      .lte('fecha_fin', rangoFin)
      .in('estado', ['VIGENTE', 'PROGRAMADA', 'RENOVADA', 'NO_VIGENTE'])
      .order('fecha_fin')

    queryPolizas = excluirPersonasEnPapelera(
      filtrarPorPersonas(queryPolizas, idsPersonas, 'asegurado_id'),
      papeleraIds,
      'asegurado_id',
    )

    if (filtroCompania) {
      queryPolizas = queryPolizas.eq('compania_id', filtroCompania)
    }

    let queryOps = supabase
      .from('oportunidades')
      .select(`
        id, tipo, estado, fecha_proximo_contacto,
        persona:personas!persona_id (id, apellido, nombre, razon_social)
      `)
      .not('estado', 'in', '("GANADA","PERDIDA")')
      .not('fecha_proximo_contacto', 'is', null)
      .gte('fecha_proximo_contacto', rangoInicio)
      .lte('fecha_proximo_contacto', rangoFin)
      .order('fecha_proximo_contacto')

    queryOps = excluirPersonasEnPapelera(
      filtrarPorPersonas(queryOps, idsPersonas, 'persona_id'),
      papeleraIds,
      'persona_id',
    )

    // idsConRenovacion: pólizas origen que tienen al menos una hija en
    // estado ACTIVO (RENOVADA latente, o VIGENTE/PROGRAMADA ya activada).
    // Se usa para distinguir "No Vigente histórica" (con hija activa → no
    // se muestra en el calendario) de "Vencida" (sin renovación → se muestra
    // en rojo como gestión pendiente). Mismo criterio que en /crm/renovaciones.
    const queryRenov = supabase
      .from('polizas')
      .select('poliza_origen_id')
      .not('poliza_origen_id', 'is', null)
      .in('estado', ['RENOVADA', 'VIGENTE', 'PROGRAMADA'])

    const [resT, resP, resO, resEv, resRen] = await Promise.all([
      queryTareas,
      queryPolizas,
      queryOps,
      apiCall<{ eventos: EventoCal[] }>(
        `/api/eventos?desde=${rangoInicio}&hasta=${rangoFin}`,
        undefined,
        { mostrar_toast_en_error: false },
      ),
      queryRenov,
    ])
    const erroresQ = [resT.error, resP.error, resO.error].filter(Boolean)
    if (erroresQ.length > 0) {
      setErrorCarga({ mensaje: erroresQ[0]?.message ?? 'No se pudo cargar el calendario.' })
      setCargando(false)
      return
    }

    const idsConRenovacion = new Set<string>(
      ((resRen.data ?? []) as Array<{ poliza_origen_id: string | null }>)
        .map((r) => r.poliza_origen_id)
        .filter((v): v is string => !!v),
    )

    // Filtrar: NO_VIGENTE con renovación activa → históricas, no aparecen.
    // NO_VIGENTE sin renovación (o VIGENTE con fecha_fin pasada sin renovación)
    // aparecen como "Vencida" (gestión pendiente).
    const polizasRaw = (resP.data ?? []) as unknown as Array<Omit<PolizaCal, 'tiene_renovacion_activa'>>
    const polizasFiltradas: PolizaCal[] = polizasRaw
      .map((p) => ({ ...p, tiene_renovacion_activa: idsConRenovacion.has(p.id) }))
      .filter((p) => !(p.estado === 'NO_VIGENTE' && p.tiene_renovacion_activa))

    setTareas((resT.data ?? []) as unknown as TareaCal[])
    setPolizas(polizasFiltradas)
    setOportunidades((resO.data ?? []) as unknown as OportunidadCal[])
    setEventos(resEv.ok && resEv.data ? resEv.data.eventos : [])
    setCargando(false)
  }, [supabase, anio, mes, filtroCompania, hoy, usuario])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  // ── Navegación de mes ───────���──────────────────────────
  const mesAnterior = () => {
    if (mes === 0) { setMes(11); setAnio(a => a - 1) }
    else setMes(m => m - 1)
  }
  const mesSiguiente = () => {
    if (mes === 11) { setMes(0); setAnio(a => a + 1) }
    else setMes(m => m + 1)
  }
  const irAHoy = () => { setAnio(hoyParts[0]); setMes(hoyParts[1] - 1) }

  // ── Eventos por día ─────────────────────────────────────
  const eventosDelDia = (fecha: string) => {
    const tareasDelDia  = mostrarTareas  ? tareas.filter(t => t.fecha_vencimiento.split('T')[0] === fecha) : []
    const polizasDelDia = mostrarPolizas ? polizas.filter(p => p.fecha_fin.split('T')[0] === fecha) : []
    const opsDelDia     = mostrarOportunidades ? oportunidades.filter(o => o.fecha_proximo_contacto.split('T')[0] === fecha) : []
    const evsDelDia     = mostrarEventos ? eventos.filter(e => e.fecha === fecha) : []
    return {
      tareasDelDia, polizasDelDia, opsDelDia, evsDelDia,
      total: tareasDelDia.length + polizasDelDia.length + opsDelDia.length + evsDelDia.length,
    }
  }

  // ── KPIs resumen ───────────────────────────────────────
  const primerDiaMesStr = fechaLocal(anio, mes, 1)
  const ultimoDiaMesStr = fechaLocal(anio, mes, diasEnMes(anio, mes))
  const tareasMes   = tareas.filter(t => {
    const f = t.fecha_vencimiento.split('T')[0]
    return f >= primerDiaMesStr && f <= ultimoDiaMesStr && ['PENDIENTE', 'EN_PROCESO'].includes(t.estado)
  }).length
  const polizasMes  = polizas.filter(p => {
    const f = p.fecha_fin.split('T')[0]
    return f >= primerDiaMesStr && f <= ultimoDiaMesStr
  }).length

  // Días con más de 3 eventos
  const conteosDia: Record<string, number> = {}
  tareas.forEach(t => {
    const f = t.fecha_vencimiento.split('T')[0]
    if (f >= primerDiaMesStr && f <= ultimoDiaMesStr) conteosDia[f] = (conteosDia[f] ?? 0) + 1
  })
  polizas.forEach(p => {
    const f = p.fecha_fin.split('T')[0]
    if (f >= primerDiaMesStr && f <= ultimoDiaMesStr) conteosDia[f] = (conteosDia[f] ?? 0) + 1
  })
  const diasCriticos = Object.values(conteosDia).filter(c => c > 3).length

  // ── Completar tarea ────────────────────────────────────
  const completarTarea = async () => {
    if (!modalTarea) return
    setCompletando(true)
    try {
      const { error } = await supabase.from('tareas').update({
        estado: 'COMPLETADA',
        nota_cierre: notaCierre.trim() || null,
      }).eq('id', modalTarea.id)
      if (error) throw error

      if (modalTarea.recurrencia !== 'NINGUNA') {
        const nuevaFecha = calcularSiguienteFechaRecurrencia(modalTarea.fecha_vencimiento, modalTarea.recurrencia)
        await supabase.from('tareas').insert({
          titulo:            modalTarea.titulo,
          tipo:              modalTarea.tipo,
          descripcion:       modalTarea.descripcion,
          persona_id:        modalTarea.persona_id,
          poliza_id:         modalTarea.poliza_id,
          siniestro_id:      modalTarea.siniestro_id,
          fecha_vencimiento: nuevaFecha,
          hora_vencimiento:  modalTarea.hora_vencimiento,
          prioridad:         modalTarea.prioridad,
          estado:            'PENDIENTE',
          recurrencia:       modalTarea.recurrencia,
        })
      }

      setModalTarea(null)
      setNotaCierre('')
      cargarDatos()
    } catch (err: any) {
      toast.error(err?.message ?? 'No se pudo completar la tarea')
    } finally {
      setCompletando(false)
    }
  }

  // ── Grilla del calendario ──────────────────────────────
  const celdas: Array<{ fecha: string; dia: number; esMesActual: boolean }> = []
  const primerDiaSemana = primerDiaMes(anio, mes)
  const totalDias       = diasEnMes(anio, mes)

  // Días del mes anterior
  const mesAntAnio = mes === 0 ? anio - 1 : anio
  const mesAntMes  = mes === 0 ? 11 : mes - 1
  const diasMesAnt = diasEnMes(mesAntAnio, mesAntMes)
  for (let i = primerDiaSemana - 1; i >= 0; i--) {
    const d = diasMesAnt - i
    celdas.push({ fecha: fechaLocal(mesAntAnio, mesAntMes, d), dia: d, esMesActual: false })
  }

  // Días del mes actual
  for (let d = 1; d <= totalDias; d++) {
    celdas.push({ fecha: fechaLocal(anio, mes, d), dia: d, esMesActual: true })
  }

  // Días del mes siguiente
  const mesSigAnio = mes === 11 ? anio + 1 : anio
  const mesSigMes  = mes === 11 ? 0 : mes + 1
  const celdasFaltantes = 42 - celdas.length // 6 filas
  for (let d = 1; d <= celdasFaltantes; d++) {
    celdas.push({ fecha: fechaLocal(mesSigAnio, mesSigMes, d), dia: d, esMesActual: false })
  }

  // ── Vista Lista: próximos 30 días ──────────────────────
  const eventosLista = () => {
    const en30 = new Date()
    en30.setDate(en30.getDate() + 30)
    const en30str = `${en30.getFullYear()}-${String(en30.getMonth() + 1).padStart(2, '0')}-${String(en30.getDate()).padStart(2, '0')}`

    const fechasSet = new Set<string>()
    if (mostrarTareas) {
      tareas.forEach(t => {
        const f = t.fecha_vencimiento.split('T')[0]
        if (f >= hoy && f <= en30str) fechasSet.add(f)
      })
    }
    if (mostrarPolizas) {
      polizas.forEach(p => {
        const f = p.fecha_fin.split('T')[0]
        if (f >= hoy && f <= en30str) fechasSet.add(f)
      })
    }
    if (mostrarOportunidades) {
      oportunidades.forEach(o => {
        const f = o.fecha_proximo_contacto.split('T')[0]
        if (f >= hoy && f <= en30str) fechasSet.add(f)
      })
    }
    if (mostrarEventos) {
      eventos.forEach(e => {
        if (e.fecha >= hoy && e.fecha <= en30str) fechasSet.add(e.fecha)
      })
    }

    return Array.from(fechasSet).sort().map(fecha => ({
      fecha,
      tareas:  mostrarTareas  ? tareas.filter(t => t.fecha_vencimiento.split('T')[0] === fecha) : [],
      polizas: mostrarPolizas ? polizas.filter(p => p.fecha_fin.split('T')[0] === fecha) : [],
      oportunidades: mostrarOportunidades ? oportunidades.filter(o => o.fecha_proximo_contacto.split('T')[0] === fecha) : [],
      eventos: mostrarEventos ? eventos.filter(e => e.fecha === fecha) : [],
    }))
  }

  // ── Drawer data ────────────────────────────────────────
  const drawerData = diaSeleccionado ? eventosDelDia(diaSeleccionado) : null

  return (
    <div className="flex flex-col gap-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Calendario</h1>
          <p className="text-xs text-slate-500">Tareas y vencimientos de polizas</p>
        </div>
      </div>

      {/* Resumen del mes */}
      <div className="bg-white border border-slate-200 rounded p-2 flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-xs text-slate-600">
          <ClipboardList className="h-3 w-3 text-blue-500" />
          <span className="font-medium">{tareasMes}</span> tareas pendientes
        </div>
        <div className="h-3 w-px bg-slate-200" />
        <div className="flex items-center gap-1.5 text-xs text-slate-600">
          <FileText className="h-3 w-3 text-emerald-500" />
          <span className="font-medium">{polizasMes}</span> polizas vencen
        </div>
        <div className="h-3 w-px bg-slate-200" />
        <div className="flex items-center gap-1.5 text-xs text-slate-600">
          <AlertTriangle className="h-3 w-3 text-amber-500" />
          <span className="font-medium">{diasCriticos}</span> dias criticos
        </div>
      </div>

      {/* Controles */}
      <div className="bg-white border border-slate-200 rounded p-2 flex items-center gap-2">
        <button onClick={mesAnterior} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center" title="Anterior">
          <ChevronLeft className="h-3.5 w-3.5" /></button>
        <span className="text-xs font-semibold text-slate-700 min-w-32 text-center">
          {MESES[mes]} {anio}
        </span>
        <button onClick={mesSiguiente} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center" title="Siguiente">
          <ChevronRight className="h-3.5 w-3.5" /></button>
        <button onClick={irAHoy} className="btn-secondary text-xs px-2">Hoy</button>

        <div className="h-4 w-px bg-slate-200 mx-1" />

        <button
          onClick={() => setMostrarTareas(v => !v)}
          className={`text-xs px-2 py-1 rounded border transition-colors ${mostrarTareas ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-slate-400 border-slate-200'}`}
        >
          Tareas
        </button>
        <button
          onClick={() => setMostrarPolizas(v => !v)}
          className={`text-xs px-2 py-1 rounded border transition-colors ${mostrarPolizas ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-white text-slate-400 border-slate-200'}`}
        >
          Polizas
        </button>
        <button
          onClick={() => setMostrarOportunidades(v => !v)}
          className={`text-xs px-2 py-1 rounded border transition-colors ${mostrarOportunidades ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-white text-slate-400 border-slate-200'}`}
        >
          Oportunidades
        </button>
        <button
          onClick={() => setMostrarEventos(v => !v)}
          className={`text-xs px-2 py-1 rounded border transition-colors ${mostrarEventos ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-slate-400 border-slate-200'}`}
        >
          Eventos
        </button>

        <select className="form-input" value={filtroCompania} onChange={e => setFiltroCompania(e.target.value)}>
          <option value="">Todas las companias</option>
          {companias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>

        <button
          onClick={() => setModalEvento({ abierto: true, evento: null, fechaInicial: hoy })}
          className="btn-primary text-xs px-2.5"
          title="Crear un evento independiente"
        >
          <Plus className="h-3.5 w-3.5" /> Nuevo evento
        </button>

        <div className="ml-auto flex items-center gap-0.5 bg-slate-100 p-0.5 rounded">
          <button
            onClick={() => setVista('calendario')}
            className={`px-2 py-1 text-xs rounded transition-all ${vista === 'calendario' ? 'bg-white shadow-sm font-medium text-slate-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <CalendarDays className="h-3.5 w-3.5 inline mr-1" />Calendario
          </button>
          <button
            onClick={() => setVista('lista')}
            className={`px-2 py-1 text-xs rounded transition-all ${vista === 'lista' ? 'bg-white shadow-sm font-medium text-slate-700' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <List className="h-3.5 w-3.5 inline mr-1" />Lista
          </button>
        </div>
      </div>

      <EstadoCarga
        loading={cargando}
        error={errorCarga}
        empty={false}
        onReintentar={cargarDatos}
      >
      {vista === 'calendario' ? (
        /* ── Vista Calendario ──────────────────────────────── */
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          {/* Header días */}
          <div className="grid grid-cols-7 border-b border-slate-200">
            {DIAS_SEMANA.map(d => (
              <div key={d} className="text-center text-2xs font-semibold text-slate-500 uppercase py-1.5 border-r border-slate-200 last:border-r-0">
                {d}
              </div>
            ))}
          </div>

          {/* Celdas */}
          <div className="grid grid-cols-7">
            {celdas.map((celda, i) => {
              const { tareasDelDia, polizasDelDia, opsDelDia, evsDelDia, total: totalEventos } = eventosDelDia(celda.fecha)
              const esHoy = celda.fecha === hoy
              const eventosDia = [
                ...tareasDelDia.map(t => ({
                  tipo: 'tarea' as const,
                  label: t.titulo,
                  color: tareaColor(t, hoy),
                  tachado: t.estado === 'COMPLETADA' || t.estado === 'CANCELADA',
                })),
                ...polizasDelDia.map(p => ({
                  tipo: 'poliza' as const,
                  label: `${p.numero_poliza} - ${nombrePersona(p.asegurado)}`,
                  color: polizaColor(p, hoy),
                  tachado: false,
                })),
                ...opsDelDia.map(o => ({
                  tipo: 'oportunidad' as const,
                  label: `Contacto: ${nombrePersona(o.persona)}`,
                  color: oportunidadColor(),
                  tachado: false,
                })),
                ...evsDelDia.map(e => ({
                  tipo: 'evento' as const,
                  label: e.titulo,
                  color: eventoColor(e),
                  tachado: e.estado === 'COMPLETADO' || e.estado === 'CANCELADO',
                })),
              ]
              const visible = eventosDia.slice(0, 3)
              const extra   = eventosDia.length - 3

              return (
                <div
                  key={i}
                  onClick={() => setDiaSeleccionado(celda.fecha)}
                  className={`min-h-24 p-1 border-r border-b border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors ${
                    !celda.esMesActual ? 'opacity-40' : ''
                  } ${diaSeleccionado === celda.fecha ? 'bg-blue-50/50' : ''}`}
                >
                  <div className="flex items-start justify-between mb-0.5">
                    <span className={`text-xs font-medium leading-none ${
                      esHoy
                        ? 'bg-blue-600 text-white rounded-full h-5 w-5 flex items-center justify-center'
                        : 'text-slate-600'
                    }`}>
                      {celda.dia}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {visible.map((ev, j) => (
                      <div
                        key={j}
                        className={`text-2xs px-1 py-0.5 rounded truncate ${ev.color} ${ev.tachado ? 'line-through' : ''}`}
                      >
                        {ev.label}
                      </div>
                    ))}
                    {extra > 0 && (
                      <span className="text-2xs text-slate-500 font-medium px-1">+{extra} mas</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* ── Vista Lista ───────────���───────────────────────── */
        <div className="flex flex-col gap-2">
          {eventosLista().length === 0 ? (
            <div className="bg-white border border-slate-200 rounded p-8 text-center text-xs text-slate-500">
              No hay eventos en los proximos 30 dias
            </div>
          ) : eventosLista().map(grupo => (
            <div key={grupo.fecha} className="bg-white border border-slate-200 rounded overflow-hidden">
              <div className="px-3 py-1.5 border-b border-slate-100 bg-slate-50">
                <span className="text-xs font-semibold text-slate-700 capitalize">
                  {diaSemanaLabel(grupo.fecha)}
                </span>
                {grupo.fecha === hoy && (
                  <span className="ml-2 text-2xs font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">Hoy</span>
                )}
              </div>
              <div className="divide-y divide-slate-50">
                {grupo.tareas.map(t => (
                  <div
                    key={`t-${t.id}`}
                    onClick={() => router.push(`/crm/tareas/${t.id}`)}
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      t.estado === 'COMPLETADA' ? 'bg-slate-300' : 'bg-blue-500'
                    }`} />
                    <span className="text-2xs font-semibold text-blue-700 bg-blue-100 border border-blue-300 px-1.5 py-0.5 rounded shrink-0">
                      Tarea
                    </span>
                    <span className={`text-xs flex-1 truncate ${
                      t.estado === 'COMPLETADA' ? 'text-slate-400 line-through' : 'text-slate-700'
                    }`}>
                      {t.titulo}
                    </span>
                    <span className="text-2xs text-slate-500 truncate max-w-32">
                      {nombrePersona(t.persona)}
                    </span>
                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${prioridadBadge(t.prioridad).color}`}>
                      {prioridadBadge(t.prioridad).label}
                    </span>
                  </div>
                ))}
                {grupo.polizas.map(p => {
                  // Sub-tipo de evento — el color base es siempre naranja
                  // (todos son vencimientos/eventos de póliza). Solo cambia
                  // el label textual según el estado de la póliza.
                  let tipoEvento = 'Vencimiento póliza'
                  if (p.estado === 'PROGRAMADA') tipoEvento = 'Inicio póliza'
                  else if (p.estado === 'RENOVADA') tipoEvento = 'Activación renovación'
                  return (
                    <div
                      key={`p-${p.id}`}
                      onClick={() => router.push(`/crm/polizas/${p.id}`)}
                      className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-orange-500" />
                      <span className="text-2xs font-semibold px-1.5 py-0.5 rounded border shrink-0 text-orange-700 bg-orange-100 border-orange-300">
                        {tipoEvento}
                      </span>
                      <span className="text-xs text-slate-700 flex-1 truncate font-mono">
                        {p.numero_poliza}
                      </span>
                      <span className="text-2xs text-slate-500 truncate max-w-32">
                        {nombrePersona(p.asegurado)}
                      </span>
                      {p.compania && (
                        <span className="text-2xs text-slate-500 truncate max-w-32">{p.compania.nombre}</span>
                      )}
                    </div>
                  )
                })}
                {(grupo as any).oportunidades?.map((o: OportunidadCal) => (
                  <div
                    key={`o-${o.id}`}
                    onClick={() => router.push(`/crm/comercial/oportunidades/${o.id}`)}
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-violet-500" />
                    <span className="text-xs text-slate-700 flex-1">
                      Contactar: {nombrePersona(o.persona)}
                    </span>
                    <span className="text-2xs text-violet-600 font-medium">{o.tipo.replace(/_/g, ' ')}</span>
                  </div>
                ))}
                {(grupo as any).eventos?.map((e: EventoCal) => (
                  <div
                    key={`e-${e.id}`}
                    onClick={() => setModalEvento({ abierto: true, evento: e, fechaInicial: e.fecha })}
                    className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      e.estado === 'COMPLETADO' || e.estado === 'CANCELADO' ? 'bg-slate-300' : 'bg-emerald-500'
                    }`} />
                    <span className="text-2xs font-semibold text-emerald-700 bg-emerald-100 border border-emerald-300 px-1.5 py-0.5 rounded shrink-0">
                      Evento
                    </span>
                    <span className={`text-xs flex-1 truncate ${
                      e.estado === 'COMPLETADO' || e.estado === 'CANCELADO' ? 'text-slate-400 line-through' : 'text-slate-700'
                    }`}>
                      {e.titulo}
                    </span>
                    {(e.hora_inicio || e.hora_fin) && (
                      <span className="text-2xs text-slate-500 font-mono shrink-0">
                        {e.hora_inicio?.slice(0, 5)}{e.hora_inicio && e.hora_fin ? '–' : ''}{e.hora_fin?.slice(0, 5)}
                      </span>
                    )}
                    {e.categoria && (
                      <span className="text-2xs text-emerald-600 font-medium truncate max-w-24">{e.categoria}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      </EstadoCarga>

      {/* ── Drawer lateral ──────────────────────────────────── */}
      {diaSeleccionado && (
        <div className="fixed inset-0 z-40" onClick={() => setDiaSeleccionado(null)}>
          <div className="absolute inset-0 bg-black/20" />
          <div
            className="absolute right-0 top-0 h-full w-96 bg-white shadow-xl border-l border-slate-200 flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header drawer */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
              <div>
                <h3 className="text-sm font-semibold text-slate-700 capitalize">
                  {diaSemanaLabel(diaSeleccionado)}
                </h3>
                {diaSeleccionado === hoy && (
                  <span className="text-2xs font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">Hoy</span>
                )}
              </div>
              <button onClick={() => setDiaSeleccionado(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content drawer */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
              {drawerData && drawerData.total === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-500">
                  <CalendarDays className="h-8 w-8 text-slate-300" />
                  <p className="text-xs">Sin eventos para este dia</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => router.push(`/crm/tareas/nueva?fecha=${diaSeleccionado}`)}
                      className="btn-secondary"
                    >
                      <Plus className="h-3.5 w-3.5" /> Tarea
                    </button>
                    <button
                      onClick={() => setModalEvento({ abierto: true, evento: null, fechaInicial: diaSeleccionado })}
                      className="btn-primary"
                    >
                      <Plus className="h-3.5 w-3.5" /> Evento
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Tareas */}
                  {drawerData && drawerData.tareasDelDia.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-1">
                        <ClipboardList className="h-3.5 w-3.5" /> Tareas ({drawerData.tareasDelDia.length})
                      </h4>
                      <div className="flex flex-col gap-1.5">
                        {drawerData.tareasDelDia.map(t => {
                          const pBadge = prioridadBadge(t.prioridad)
                          return (
                            <div key={t.id}
                              onClick={() => router.push(`/crm/tareas/${t.id}`)}
                              className={`rounded border border-slate-200 p-2.5 cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all ${tareaColor(t, hoy)}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className={`text-xs font-medium ${t.estado === 'COMPLETADA' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                                    {t.titulo}
                                  </p>
                                  <p className="text-2xs text-slate-500 mt-0.5">
                                    Tarea · {nombrePersona(t.persona)}
                                  </p>
                                </div>
                                <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border shrink-0 ${pBadge.color}`}>
                                  {pBadge.label}
                                </span>
                              </div>
                              {['PENDIENTE', 'EN_PROCESO'].includes(t.estado) && (
                                <div className="flex items-center gap-1 mt-2" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    onClick={() => { setModalTarea(t); setNotaCierre('') }}
                                    className="btn-tabla-accion-success"
                                    title="Completar"
                                  >
                                    <CheckCircle />
                                  </button>
                                  <button
                                    onClick={() => router.push(`/crm/tareas/${t.id}/editar`)}
                                    className="btn-tabla-accion"
                                    title="Editar"
                                  >
                                    <Edit />
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Polizas */}
                  {drawerData && drawerData.polizasDelDia.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-1">
                        <FileText className="h-3.5 w-3.5" /> Polizas ({drawerData.polizasDelDia.length})
                      </h4>
                      <div className="flex flex-col gap-1.5">
                        {drawerData.polizasDelDia.map(p => {
                          // Tipo de evento según el estado efectivo de la póliza.
                          // El día del drawer siempre coincide con fecha_fin.
                          // - VIGENTE con fecha_fin >= hoy → "Vencimiento" (naranja).
                          // - NO_VIGENTE sin renovación / VIGENTE con fecha_fin < hoy sin renovación → "Vencida" (rojo).
                          // - PROGRAMADA → "Inicio (programada)" (azul).
                          // - RENOVADA → "Activación de renovación" (verde).
                          const efectivo = getEstadoEfectivoPoliza(p.estado, p.fecha_fin, p.tiene_renovacion_activa)
                          let tipoEvento = 'Vencimiento'
                          let tipoEventoColor = 'text-orange-700 bg-orange-50 border-orange-200'
                          if (efectivo === 'VENCIDA') {
                            tipoEvento = 'Vencida'
                            tipoEventoColor = 'text-red-700 bg-red-50 border-red-200'
                          } else if (p.estado === 'PROGRAMADA') {
                            tipoEvento = 'Inicio (programada)'
                            tipoEventoColor = 'text-blue-700 bg-blue-50 border-blue-200'
                          } else if (p.estado === 'RENOVADA') {
                            tipoEvento = 'Activación de renovación'
                            tipoEventoColor = 'text-emerald-700 bg-emerald-50 border-emerald-200'
                          }
                          return (
                            <div key={p.id}
                              onClick={() => router.push(`/crm/polizas/${p.id}`)}
                              className={`rounded border border-slate-200 p-2.5 cursor-pointer hover:border-blue-300 hover:shadow-sm transition-all ${polizaColor(p, hoy)}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${tipoEventoColor}`}>
                                      {tipoEvento}
                                    </span>
                                  </div>
                                  <p className="text-xs font-medium text-slate-800 font-mono">
                                    Póliza {p.numero_poliza}
                                  </p>
                                  <p className="text-2xs text-slate-600 mt-0.5">
                                    {nombrePersona(p.asegurado)}
                                  </p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    {p.compania && <span className="text-2xs text-slate-500">{p.compania.nombre}</span>}
                                    {p.ramo && <span className="text-2xs text-slate-500">· {p.ramo.nombre}</span>}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Oportunidades */}
                  {drawerData && drawerData.opsDelDia && drawerData.opsDelDia.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-1">
                        <Target className="h-3.5 w-3.5" /> Contactos ({drawerData.opsDelDia.length})
                      </h4>
                      <div className="flex flex-col gap-1.5">
                        {drawerData.opsDelDia.map(o => (
                          <div key={o.id}
                            onClick={() => router.push(`/crm/comercial/oportunidades/${o.id}`)}
                            className="rounded border border-violet-200 p-2.5 bg-violet-50 cursor-pointer hover:border-violet-400 hover:shadow-sm transition-all">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-2xs font-semibold px-1.5 py-0.5 rounded border text-violet-700 bg-white border-violet-300">
                                    Contacto comercial
                                  </span>
                                </div>
                                <p className="text-xs font-medium text-violet-800">
                                  {nombrePersona(o.persona)}
                                </p>
                                <p className="text-2xs text-violet-600 mt-0.5">
                                  Oportunidad: {o.tipo.replace(/_/g, ' ')}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Eventos independientes */}
                  {drawerData && drawerData.evsDelDia && drawerData.evsDelDia.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5" /> Eventos ({drawerData.evsDelDia.length})
                      </h4>
                      <div className="flex flex-col gap-1.5">
                        {drawerData.evsDelDia.map(e => (
                          <div key={e.id}
                            onClick={() => setModalEvento({ abierto: true, evento: e, fechaInicial: e.fecha })}
                            className={`rounded border p-2.5 cursor-pointer hover:shadow-sm transition-all ${
                              e.estado === 'COMPLETADO' || e.estado === 'CANCELADO'
                                ? 'bg-slate-50 border-slate-200'
                                : 'bg-emerald-50 border-emerald-200 hover:border-emerald-400'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                  {e.categoria && (
                                    <span className="text-2xs font-semibold px-1.5 py-0.5 rounded border text-emerald-700 bg-white border-emerald-300">
                                      {e.categoria}
                                    </span>
                                  )}
                                  {e.compartido && (
                                    <span className="text-2xs text-slate-500 flex items-center gap-0.5" title="Compartido con el equipo">
                                      Equipo
                                    </span>
                                  )}
                                  {e.recurrencia !== 'NINGUNA' && (
                                    <span className="text-2xs text-slate-500 flex items-center gap-0.5" title={`Recurrente: ${e.recurrencia.toLowerCase()}`}>
                                      <Repeat className="h-3 w-3" />
                                    </span>
                                  )}
                                </div>
                                <p className={`text-xs font-medium ${
                                  e.estado === 'COMPLETADO' || e.estado === 'CANCELADO'
                                    ? 'line-through text-slate-400'
                                    : 'text-emerald-900'
                                }`}>
                                  {e.titulo}
                                </p>
                                {(e.hora_inicio || e.hora_fin) && (
                                  <p className="text-2xs text-slate-500 mt-0.5">
                                    {e.hora_inicio && e.hora_inicio.slice(0, 5)}
                                    {e.hora_inicio && e.hora_fin && ' – '}
                                    {e.hora_fin && e.hora_fin.slice(0, 5)}
                                  </p>
                                )}
                                {e.descripcion && (
                                  <p className="text-2xs text-slate-600 mt-1 line-clamp-2">{e.descripcion}</p>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Botones de creación */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => router.push(`/crm/tareas/nueva?fecha=${diaSeleccionado}`)}
                      className="btn-secondary flex-1 justify-center"
                    >
                      <Plus className="h-3.5 w-3.5" /> Nueva tarea
                    </button>
                    <button
                      onClick={() => setModalEvento({ abierto: true, evento: null, fechaInicial: diaSeleccionado })}
                      className="btn-secondary flex-1 justify-center"
                    >
                      <Plus className="h-3.5 w-3.5" /> Nuevo evento
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal completar tarea ───────────────────────────── */}
      {modalTarea && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setModalTarea(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 rounded-t-lg border-b border-slate-200 bg-emerald-50">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-600" />
                <h3 className="text-sm font-semibold text-emerald-800">Completar tarea</h3>
              </div>
              <button onClick={() => setModalTarea(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-xs text-slate-600">
                <span className="font-medium">{modalTarea.titulo}</span>
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">¿Que paso? (opcional)</label>
                <textarea className="form-input w-full resize-none text-xs" rows={3}
                  value={notaCierre} onChange={e => setNotaCierre(e.target.value)}
                  placeholder="Deja una nota sobre como se resolvio..." />
              </div>
              {modalTarea.recurrencia !== 'NINGUNA' && (
                <div className="flex items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-700">
                  <Repeat className="h-3 w-3" />
                  Se creara automaticamente la siguiente tarea ({modalTarea.recurrencia.toLowerCase()})
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg">
              <button onClick={() => setModalTarea(null)} className="btn-secondary">Cancelar</button>
              <button onClick={completarTarea} disabled={completando}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50">
                {completando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                {completando ? 'Guardando...' : 'Completar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal crear/editar evento ───────────────────────── */}
      {modalEvento.abierto && (
        <EventoModal
          evento={modalEvento.evento}
          fechaInicial={modalEvento.fechaInicial}
          onCerrar={() => setModalEvento({ abierto: false, evento: null })}
          onGuardado={() => cargarDatos()}
        />
      )}
    </div>
  )
}
