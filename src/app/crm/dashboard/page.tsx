'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Users, FileText, AlertTriangle, Clock, ArrowRight, Loader2,
  TrendingUp, TrendingDown, Minus, CalendarCheck, XCircle,
  ClipboardList, Shield, CheckCircle2, AlertOctagon, RefreshCw,
  StickyNote, Plus, Edit2, Palette, Trash2, User, Users as UsersIcon,
  Building2, Layers, ShieldCheck, CreditCard,
  CalendarDays, Activity, Percent, Hourglass, LineChart as LineChartIcon
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { formatFechaLocal, formatMoneda, hoyLocal } from '@/lib/utils'
import { getEstadoBadge } from '@/lib/siniestros-config'
import { obtenerIdsPersonas, filtrarPorPersonas, tieneAccesoTotal, aplicarFiltroCartera } from '@/lib/cartera-filter'
import {
  ResponsiveContainer, XAxis, YAxis, Tooltip,
  PieChart, Pie, Cell, Legend, BarChart, Bar, CartesianGrid,
  AreaChart, Area
} from 'recharts'
import { apiCall } from '@/lib/api-client'
import { logger } from '@/lib/errores/logger'
import { toast } from '@/lib/toast'
import { graficoVisible } from '@/lib/dashboard-graficos'
import { useRealtimeRefresh } from '@/lib/hooks/useRealtimeRefresh'

// ── Helpers ──────────────────────────────────────────────────
function primerDiaMes(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
}

function ultimoDiaMes(date: Date): string {
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
}

function mesAnterior(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1)
}

function nombreMesCorto(idx: number): string {
  return ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][idx]
}

function nombrePersona(p: { apellido: string; nombre: string | null; razon_social: string | null } | null) {
  if (!p) return '—'
  return [p.apellido, p.nombre].filter(Boolean).join(', ') || p.razon_social || '—'
}

function diasAtraso(fecha: string): number {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  // Soporta ambos: DATE puro 'YYYY-MM-DD' (interpretarlo en TZ local para no
  // shiftear medio día) y TIMESTAMP con 'T' (parseo nativo respeta el offset).
  let f: Date
  if (fecha.includes('T')) {
    f = new Date(fecha)
  } else {
    const [a, m, d] = fecha.split('-').map(Number)
    f = new Date(a, m - 1, d)
  }
  f.setHours(0, 0, 0, 0)
  return Math.floor((hoy.getTime() - f.getTime()) / 86400000)
}

function fechaRelativa(fecha: string): string {
  const dias = diasAtraso(fecha)
  if (dias === 0) return 'Hoy'
  if (dias === 1) return 'Hace 1 día'
  if (dias < 7) return `Hace ${dias} días`
  return formatFechaLocal(fecha)
}

function rotacionPostit(id: string): number {
  const num = parseInt(id.replace(/-/g, '').slice(0, 8), 16)
  return (num % 5) - 2
}

// Paleta de gradientes — cada chart embebe sus stops via `<defs>{gradientStops(...)}</defs>`
// inline. Los IDs son únicos para que no colisionen entre charts en la misma página.
const GRADIENTES = {
  blue:    { id: 'grad-blue',    from: '#1e40af', to: '#60a5fa' },
  emerald: { id: 'grad-emerald', from: '#047857', to: '#34d399' },
  amber:   { id: 'grad-amber',   from: '#b45309', to: '#fbbf24' },
  violet:  { id: 'grad-violet',  from: '#6d28d9', to: '#a78bfa' },
  rose:    { id: 'grad-rose',    from: '#9f1239', to: '#fb7185' },
  cyan:    { id: 'grad-cyan',    from: '#0e7490', to: '#22d3ee' },
  indigo:  { id: 'grad-indigo',  from: '#3730a3', to: '#818cf8' },
  fuchsia: { id: 'grad-fuchsia', from: '#86198f', to: '#e879f9' },
  navy:    { id: 'grad-navy',    from: '#0f172a', to: '#334155' },
  slate:   { id: 'grad-slate',   from: '#475569', to: '#94a3b8' },
} as const

type GradKey = keyof typeof GRADIENTES

// Helper que devuelve los `<linearGradient>` para meter directo dentro de
// un `<defs>` inline del chart. NO se puede envolver en un componente custom
// porque recharts solo procesa sus propios componentes como hijos: cualquier
// wrapper queda fuera del SVG y los `fill="url(#xxx)"` no resuelven.
function gradientStops(keys: GradKey[], horizontal?: boolean) {
  return keys.map((k) => {
    const g = GRADIENTES[k]
    const coords = horizontal
      ? { x1: '0%', y1: '0%', x2: '100%', y2: '0%' }
      : { x1: '0%', y1: '0%', x2: '0%', y2: '100%' }
    return (
      <linearGradient key={k} id={g.id} {...coords}>
        <stop offset="0%" stopColor={g.from} stopOpacity={0.95} />
        <stop offset="100%" stopColor={g.to} stopOpacity={0.85} />
      </linearGradient>
    )
  })
}

// Tooltip estilizado compartido — fondo blanco, sombra, sin border duro.
const TOOLTIP_STYLE: React.CSSProperties = {
  fontSize: 12,
  borderRadius: 8,
  border: '1px solid rgba(226, 232, 240, 0.8)',
  boxShadow: '0 8px 24px -8px rgba(15, 23, 42, 0.18)',
  padding: '8px 12px',
  background: 'rgba(255, 255, 255, 0.98)',
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

const POSTIT_COLORES: Record<string, string> = {
  amarillo: '#FFF9B0',
  rosa: '#FFD0E0',
  verde: '#C5F5C5',
  azul: '#C5E0F5',
  naranja: '#FFD8B0',
}

// ── Interfaces ───────────────────────────────────────────────
interface KPIData {
  clientesAsegurados: number
  clientesTendencia: number
  polizasVigentes: number
  polizasTendencia: number
  vencenEsteMes: number
  vencenEstaSemana: number
  siniestrosAbiertos: number
  siniestrosTendencia: number
  siniestrosMas30: number
  polizasNuevas: number
  polizasNuevasTendencia: number
  bajas: number
  bajasTendencia: number
  canceladas: number
  anuladas: number
}

interface TareaPendiente {
  id: string
  titulo: string
  prioridad: string
  fecha_vencimiento: string
  persona: { apellido: string; nombre: string | null; razon_social: string | null } | null
}

interface PolizaPorVencer {
  id: string
  numero_poliza: string
  dias_restantes: number
  asegurado: { apellido: string; nombre: string | null; razon_social: string | null } | null
  compania: { nombre: string } | null
  tiene_renovacion: boolean
}

interface SiniestroInactivo {
  id: string
  numero_caso: string
  estado: string
  persona: { apellido: string; nombre: string | null; razon_social: string | null } | null
  dias_sin_movimiento: number
}

interface RenovacionMes {
  id: string
  numero_poliza: string
  fecha_fin: string
  asegurado: { apellido: string; nombre: string | null; razon_social: string | null } | null
  compania: { nombre: string } | null
  ramo: { nombre: string } | null
  cobertura: { nombre: string } | null
  tiene_renovacion: boolean
}

interface PostitData {
  id: string
  usuario_id: string
  texto: string
  color: string
  compartido: boolean
  created_at: string
  updated_at: string
  usuario: { nombre: string; apellido: string } | null
}

// ── Componente principal ─────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter()
  const supabase = getSupabaseClient()
  const { usuario, isAdmin, loading: authLoading } = useAuth()
  const hoy = hoyLocal()
  const ahora = new Date()

  type TabId = 'inicio' | 'analisis' | 'renovaciones'
  const [tabActiva, setTabActiva] = useState<TabId>('inicio')

  const tabs: { id: TabId; label: string }[] = isAdmin
    ? [{ id: 'inicio', label: 'Inicio' }, { id: 'analisis', label: 'Análisis de cartera' }, { id: 'renovaciones', label: 'Renovaciones del mes' }]
    : [{ id: 'inicio', label: 'Inicio' }, { id: 'renovaciones', label: 'Renovaciones del mes' }]

  // ── Estado de IDs de personas (para filtro de cartera) ──
  const [idsPersonas, setIdsPersonas] = useState<string[] | null>(null)
  const [idsPersonasCargados, setIdsPersonasCargados] = useState(false)

  // Contador que se incrementa cada vez que Realtime detecta cambios en las
  // tablas del dashboard. Los useEffect que cargan KPIs / panel de acción /
  // renovaciones lo usan como dependencia extra para refetchear.
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    if (!usuario) return
    async function cargar() {
      const ids = await obtenerIdsPersonas(supabase, usuario)
      setIdsPersonas(ids)
      setIdsPersonasCargados(true)
    }
    cargar()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario])

  // ── PESTAÑA INICIO: KPIs ──
  const [kpis, setKpis] = useState<KPIData | null>(null)
  const [cargandoKpis, setCargandoKpis] = useState(true)

  // ── PESTAÑA INICIO: Panel de acción ──
  const [tareasPendientes, setTareasPendientes] = useState<TareaPendiente[]>([])
  const [polizasPorVencer, setPolizasPorVencer] = useState<PolizaPorVencer[]>([])
  const [siniestrosInactivos, setSiniestrosInactivos] = useState<SiniestroInactivo[]>([])
  const [cargandoAccion, setCargandoAccion] = useState(true)

  // ── PESTAÑA INICIO: Post-it ──
  const [postits, setPostits] = useState<PostitData[]>([])
  const [cargandoPostits, setCargandoPostits] = useState(true)
  const [creandoPostit, setCreandoPostit] = useState(false)
  const [editandoPostitId, setEditandoPostitId] = useState<string | null>(null)
  const [postitTexto, setPostitTexto] = useState('')
  const [postitColor, setPostitColor] = useState('amarillo')
  const [postitCompartido, setPostitCompartido] = useState(false)
  const [guardandoPostit, setGuardandoPostit] = useState(false)
  const [eliminandoPostitId, setEliminandoPostitId] = useState<string | null>(null)
  const [colorPickerPostitId, setColorPickerPostitId] = useState<string | null>(null)

  // ── PESTAÑA ANÁLISIS: Gráficos ──
  const [chartEvolucion, setChartEvolucion] = useState<{ mes: string; cantidad: number }[]>([])
  const [chartCompanias, setChartCompanias] = useState<{ name: string; value: number }[]>([])
  const [chartRamos, setChartRamos] = useState<{ name: string; value: number }[]>([])
  const [chartSiniestralidad, setChartSiniestralidad] = useState<{ name: string; abiertos: number; cerrados: number }[]>([])
  const [chartFacturacion, setChartFacturacion] = useState<{ mes: string; actual: number; anterior: number }[]>([])
  const [totalFactActual, setTotalFactActual] = useState(0)
  const [totalFactAnterior, setTotalFactAnterior] = useState(0)
  // ── Charts nuevos (v1.0.49) ──
  const [chartCobertura, setChartCobertura] = useState<{ name: string; value: number }[]>([])
  const [chartMedioPago, setChartMedioPago] = useState<{ name: string; value: number }[]>([])
  const [chartAntiguedad, setChartAntiguedad] = useState<{ name: string; value: number }[]>([])
  const [chartTasaSiniestralidad, setChartTasaSiniestralidad] = useState<{ name: string; value: number }[]>([])
  const [chartTiempoResolucion, setChartTiempoResolucion] = useState<{ name: string; value: number }[]>([])
  // Lista de IDs de gráficos visibles (null = todos, [] = ninguno, [...] = explícito)
  const [graficosVisibles, setGraficosVisibles] = useState<string[] | null>(null)
  const [cargandoCharts, setCargandoCharts] = useState(true)
  const [chartsLoaded, setChartsLoaded] = useState(false)

  // ── PESTAÑA RENOVACIONES ──
  const [renovacionesMes, setRenovacionesMes] = useState<RenovacionMes[]>([])
  const [cargandoRenovaciones, setCargandoRenovaciones] = useState(true)
  const [renovacionesLoaded, setRenovacionesLoaded] = useState(false)

  const [fechaCapitalizada, setFechaCapitalizada] = useState('')
  useEffect(() => {
    const f = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    setFechaCapitalizada(f.charAt(0).toUpperCase() + f.slice(1))
  }, [])

  // ── Cargar KPIs (pestaña Inicio, al montar) ──
  useEffect(() => {
    if (!idsPersonasCargados) return
    async function cargarKpis() {
      try {
      const inicioMes = primerDiaMes(ahora)
      const finMes = ultimoDiaMes(ahora)
      const mesAnt = mesAnterior(ahora)
      const inicioMesAnt = primerDiaMes(mesAnt)
      const finMesAnt = ultimoDiaMes(mesAnt)

      const en7 = new Date(); en7.setDate(en7.getDate() + 7)
      const en7str = `${en7.getFullYear()}-${String(en7.getMonth() + 1).padStart(2, '0')}-${String(en7.getDate()).padStart(2, '0')}`

      const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30)
      const hace30str = `${hace30.getFullYear()}-${String(hace30.getMonth() + 1).padStart(2, '0')}-${String(hace30.getDate()).padStart(2, '0')}`

      // Build queries with cartera filter
      let qClientes = supabase.from('polizas').select('asegurado_id').eq('estado', 'VIGENTE')
      let qClientesInicio = supabase.from('polizas').select('asegurado_id').lte('fecha_inicio', inicioMes).gte('fecha_fin', inicioMes).not('estado', 'in', '("CANCELADA","ANULADA")')
      let qVigentes = supabase.from('polizas').select('id', { count: 'exact', head: true }).eq('estado', 'VIGENTE')
      let qVigentesInicio = supabase.from('polizas').select('id', { count: 'exact', head: true }).lte('fecha_inicio', inicioMes).gte('fecha_fin', inicioMes).not('estado', 'in', '("CANCELADA","ANULADA")')
      // "Vencen este mes" = rolling 30 días desde hoy (no mes calendario).
      // Antes usaba inicioMes/finMes y cuando hoy era fin de mes daba 0 mientras
      // "esta semana" mostraba pólizas de los primeros días del mes siguiente.
      const en30 = new Date(); en30.setDate(en30.getDate() + 30)
      const en30str = `${en30.getFullYear()}-${String(en30.getMonth() + 1).padStart(2, '0')}-${String(en30.getDate()).padStart(2, '0')}`
      let qVencenMes = supabase.from('polizas').select('id', { count: 'exact', head: true }).eq('estado', 'VIGENTE').gte('fecha_fin', hoy).lte('fecha_fin', en30str)
      let qVencenSemana = supabase.from('polizas').select('id', { count: 'exact', head: true }).eq('estado', 'VIGENTE').gte('fecha_fin', hoy).lte('fecha_fin', en7str)
      let qSiniestros = supabase.from('siniestros').select('id', { count: 'exact', head: true }).not('estado', 'in', '("FINALIZADO","RECHAZADO")').is('deleted_at', null)
      let qSiniestrosAnt = supabase.from('siniestros').select('id', { count: 'exact', head: true }).not('estado', 'in', '("FINALIZADO","RECHAZADO")').is('deleted_at', null).lte('fecha_denuncia', finMesAnt)
      let qSiniestros30 = supabase.from('siniestros').select('id', { count: 'exact', head: true }).not('estado', 'in', '("FINALIZADO","RECHAZADO")').is('deleted_at', null).lte('fecha_denuncia', hace30str)
      let qPolNuevas = supabase.from('polizas').select('id', { count: 'exact', head: true }).gte('created_at', inicioMes).lte('created_at', finMes + 'T23:59:59').is('poliza_origen_id', null)
      let qPolNuevasAnt = supabase.from('polizas').select('id', { count: 'exact', head: true }).gte('created_at', inicioMesAnt).lte('created_at', finMesAnt + 'T23:59:59').is('poliza_origen_id', null)
      let qBajas = supabase.from('polizas').select('id', { count: 'exact', head: true }).in('estado', ['CANCELADA', 'ANULADA']).gte('fecha_baja', inicioMes).lte('fecha_baja', finMes)
      let qBajasAnt = supabase.from('polizas').select('id', { count: 'exact', head: true }).in('estado', ['CANCELADA', 'ANULADA']).gte('fecha_baja', inicioMesAnt).lte('fecha_baja', finMesAnt)
      let qCanceladas = supabase.from('polizas').select('id', { count: 'exact', head: true }).eq('estado', 'CANCELADA').gte('fecha_baja', inicioMes).lte('fecha_baja', finMes)
      let qAnuladas = supabase.from('polizas').select('id', { count: 'exact', head: true }).eq('estado', 'ANULADA').gte('fecha_baja', inicioMes).lte('fecha_baja', finMes)

      // Apply cartera filter
      if (idsPersonas !== null) {
        qClientes = filtrarPorPersonas(qClientes, idsPersonas, 'asegurado_id')
        qClientesInicio = filtrarPorPersonas(qClientesInicio, idsPersonas, 'asegurado_id')
        qVigentes = filtrarPorPersonas(qVigentes, idsPersonas, 'asegurado_id')
        qVigentesInicio = filtrarPorPersonas(qVigentesInicio, idsPersonas, 'asegurado_id')
        qVencenMes = filtrarPorPersonas(qVencenMes, idsPersonas, 'asegurado_id')
        qVencenSemana = filtrarPorPersonas(qVencenSemana, idsPersonas, 'asegurado_id')
        qSiniestros = filtrarPorPersonas(qSiniestros, idsPersonas, 'persona_id')
        qSiniestrosAnt = filtrarPorPersonas(qSiniestrosAnt, idsPersonas, 'persona_id')
        qSiniestros30 = filtrarPorPersonas(qSiniestros30, idsPersonas, 'persona_id')
        qPolNuevas = filtrarPorPersonas(qPolNuevas, idsPersonas, 'asegurado_id')
        qPolNuevasAnt = filtrarPorPersonas(qPolNuevasAnt, idsPersonas, 'asegurado_id')
        qBajas = filtrarPorPersonas(qBajas, idsPersonas, 'asegurado_id')
        qBajasAnt = filtrarPorPersonas(qBajasAnt, idsPersonas, 'asegurado_id')
        qCanceladas = filtrarPorPersonas(qCanceladas, idsPersonas, 'asegurado_id')
        qAnuladas = filtrarPorPersonas(qAnuladas, idsPersonas, 'asegurado_id')
      }

      const [
        { data: clientesActuales },
        { data: clientesInicioMes },
        { count: vigentesAhora },
        { count: vigentesInicioMesCount },
        { count: vencenMes },
        { count: vencenSemana },
        { count: siniestrosAb },
        { count: siniestrosAbAnt },
        { count: siniestrosMas30 },
        { count: polNuevas },
        { count: polNuevasAnt },
        { count: bajasMes },
        { count: bajasAnt },
        { count: canceladasMes },
        { count: anuladasMes },
      ] = await Promise.all([
        qClientes, qClientesInicio, qVigentes, qVigentesInicio, qVencenMes, qVencenSemana,
        qSiniestros, qSiniestrosAnt, qSiniestros30,
        qPolNuevas, qPolNuevasAnt, qBajas, qBajasAnt, qCanceladas, qAnuladas,
      ])

      const clientesUnicos = new Set((clientesActuales ?? []).map((p: any) => p.asegurado_id)).size
      const clientesInicioUnicos = new Set((clientesInicioMes ?? []).map((p: any) => p.asegurado_id)).size

      setKpis({
        clientesAsegurados: clientesUnicos,
        clientesTendencia: clientesUnicos - clientesInicioUnicos,
        polizasVigentes: vigentesAhora ?? 0,
        polizasTendencia: (vigentesAhora ?? 0) - (vigentesInicioMesCount ?? 0),
        vencenEsteMes: vencenMes ?? 0,
        vencenEstaSemana: vencenSemana ?? 0,
        siniestrosAbiertos: siniestrosAb ?? 0,
        siniestrosTendencia: (siniestrosAb ?? 0) - (siniestrosAbAnt ?? 0),
        siniestrosMas30: siniestrosMas30 ?? 0,
        polizasNuevas: polNuevas ?? 0,
        polizasNuevasTendencia: (polNuevas ?? 0) - (polNuevasAnt ?? 0),
        bajas: bajasMes ?? 0,
        bajasTendencia: (bajasMes ?? 0) - (bajasAnt ?? 0),
        canceladas: canceladasMes ?? 0,
        anuladas: anuladasMes ?? 0,
      })
      } catch (err) {
        // Si Supabase falla, no dejar el dashboard con spinners infinitos:
        // avisamos al PAS y los KPIs quedan en 0 (con un dato real abajo,
        // o se vuelve a intentar al refrescar).
        toast.error('No se pudieron cargar los KPIs del dashboard. Refrescá la página.')
      } finally {
        setCargandoKpis(false)
      }
    }
    cargarKpis()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsPersonasCargados, refreshTick])

  // ── Cargar panel de acción (pestaña Inicio, al montar) ──
  useEffect(() => {
    if (!idsPersonasCargados) return
    async function cargarAccion() {
      // Tareas pendientes
      let qTareas = supabase
        .from('tareas')
        .select('id, titulo, prioridad, fecha_vencimiento, persona:personas!tareas_persona_id_fkey (apellido, nombre, razon_social)')
        .in('estado', ['PENDIENTE', 'EN_PROCESO'])
        .lte('fecha_vencimiento', hoy)
        .order('fecha_vencimiento', { ascending: true })
        .limit(5)
      if (usuario && !tieneAccesoTotal(usuario)) {
        qTareas = aplicarFiltroCartera(qTareas, usuario)
      }
      const { data: tareas } = await qTareas
      setTareasPendientes((tareas ?? []) as unknown as TareaPendiente[])

      // Pólizas por vencer (próximos 7 días)
      const en7 = new Date(); en7.setDate(en7.getDate() + 7)
      const en7str = `${en7.getFullYear()}-${String(en7.getMonth() + 1).padStart(2, '0')}-${String(en7.getDate()).padStart(2, '0')}`

      let qPolVencer = supabase
        .from('polizas')
        .select('id, numero_poliza, fecha_fin, asegurado:personas!asegurado_id (apellido, nombre, razon_social), compania:catalogos!compania_id (nombre)')
        .eq('estado', 'VIGENTE')
        .gte('fecha_fin', hoy)
        .lte('fecha_fin', en7str)
        .order('fecha_fin', { ascending: true })
        .limit(5)
      qPolVencer = filtrarPorPersonas(qPolVencer, idsPersonas, 'asegurado_id')

      const { data: polVencer } = await qPolVencer

      if (polVencer && polVencer.length > 0) {
        const ids = polVencer.map((p: any) => p.id)
        // Solo cuentan como "tiene renovación" las hijas con estado activo —
        // las CANCELADA/ANULADA fueron eliminadas en el flujo de baja, pero por
        // las dudas las excluimos explícitamente (mismo criterio que el cron).
        const { data: conRen } = await supabase
          .from('polizas')
          .select('poliza_origen_id')
          .in('poliza_origen_id', ids)
          .in('estado', ['RENOVADA', 'VIGENTE', 'PROGRAMADA'])
        const idsConRen = new Set((conRen ?? []).map((r: any) => r.poliza_origen_id))

        setPolizasPorVencer(polVencer.map((p: any) => {
          const dias = diasAtraso(p.fecha_fin)
          return { ...p, dias_restantes: -dias, tiene_renovacion: idsConRen.has(p.id) }
        }) as PolizaPorVencer[])
      } else {
        setPolizasPorVencer([])
      }

      // Siniestros sin movimiento (>15 días)
      let qSinMov = supabase
        .from('siniestros')
        .select('id, numero_caso, estado, fecha_ultimo_movimiento, persona:personas!persona_id (apellido, nombre, razon_social)')
        .not('estado', 'in', '("FINALIZADO","RECHAZADO")')
        .is('deleted_at', null)
        .order('fecha_ultimo_movimiento', { ascending: true })
        .limit(20)
      qSinMov = filtrarPorPersonas(qSinMov, idsPersonas, 'persona_id')

      const { data: sinMovimiento } = await qSinMov

      const sinMov = (sinMovimiento ?? [])
        .map((s: any) => ({ ...s, dias_sin_movimiento: diasAtraso(s.fecha_ultimo_movimiento) }))
        .filter((s: any) => s.dias_sin_movimiento >= 15)
        .slice(0, 5)

      setSiniestrosInactivos(sinMov as SiniestroInactivo[])
      setCargandoAccion(false)
    }
    cargarAccion()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsPersonasCargados, refreshTick])

  // ── Cargar post-it (pestaña Inicio, al montar) ──
  const cargarPostits = useCallback(async () => {
    setCargandoPostits(true)
    const r = await apiCall<PostitData[]>('/api/postits', {}, { mostrar_toast_en_error: false })
    if (r.ok) setPostits((r.data as PostitData[] | undefined) ?? [])
    setCargandoPostits(false)
  }, [])

  useEffect(() => { cargarPostits() }, [cargarPostits])

  // ── Cargar gráficos (lazy, solo cuando se abre pestaña Análisis) ──
  // Solo se ejecuta para usuarios admin: la pestaña en sí ya está oculta
  // para no-admin pero defendemos el fetch para que ningún path expuesto
  // por URL pueda traer datos sin pasar por el filtro de cartera.
  useEffect(() => {
    if (tabActiva !== 'analisis' || chartsLoaded) return
    if (!isAdmin || !idsPersonasCargados) return
    async function cargarCharts() {
      setCargandoCharts(true)

      // Cargar config de qué gráficos están visibles (preferencia del PAS).
      // No bloqueante: si falla, todos quedan visibles (comportamiento default).
      apiCall<{ visibles: string[] | null }>('/api/configuracion/dashboard-graficos', {}, { mostrar_toast_en_error: false })
        .then((r) => {
          if (r.ok && r.data) setGraficosVisibles(r.data.visibles)
          else if (!r.ok) {
            logger.warn({
              modulo: 'dashboard',
              mensaje: 'No se pudo cargar preferencia de gráficos visibles — se usa default',
              contexto: { error: r.error?.mensaje },
            })
          }
        })
        .catch((err) => {
          logger.warn({
            modulo: 'dashboard',
            mensaje: 'Falló carga de preferencia de gráficos',
            contexto: { error: String(err) },
          })
        })

      // Evolución de cartera (últimos 12 meses) — saldo neto al cierre de
      // cada mes: (pólizas creadas hasta fin de mes) − (canceladas + anuladas
      // hasta fin de mes). Refleja el tamaño REAL de la cartera mes a mes,
      // basado en cuándo se cargó cada póliza al CRM y cuándo se dio de baja
      // — no en los rangos de vigencia (que daban una curva poco intuitiva).
      // Excluye RENOVADA (estado sombra) para no duplicar con la VIGENTE de
      // la cadena.
      const evolucion: { mes: string; cantidad: number }[] = []
      let qTodas = supabase
        .from('polizas')
        .select('created_at, fecha_baja, estado')
        .neq('estado', 'RENOVADA')
      qTodas = filtrarPorPersonas(qTodas, idsPersonas, 'asegurado_id')
      const { data: todasPolizas, error: errPolizas } = await qTodas
      if (errPolizas) {
        // El chart "Evolución de cartera" se muestra vacío si falla — el resto
        // del dashboard sigue armándose. Loggeamos para diagnóstico.
        logger.error({
          modulo: 'dashboard',
          mensaje: 'Falló carga de pólizas para chart evolución',
          contexto: { error: errPolizas.message },
        })
      }

      const polizas = (todasPolizas ?? []) as Array<{
        created_at: string
        fecha_baja: string | null
        estado: string
      }>

      for (let i = 11; i >= 0; i--) {
        const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1)
        const ultimo = ultimoDiaMes(d) // 'YYYY-MM-DD' inclusive

        let altas = 0
        let bajas = 0
        for (const p of polizas) {
          const createdDia = (p.created_at || '').slice(0, 10)
          if (createdDia && createdDia <= ultimo) altas++

          const esBaja = p.estado === 'CANCELADA' || p.estado === 'ANULADA'
          const fbDia = (p.fecha_baja || '').slice(0, 10)
          if (esBaja && fbDia && fbDia <= ultimo) bajas++
        }

        evolucion.push({
          mes: nombreMesCorto(d.getMonth()),
          cantidad: Math.max(0, altas - bajas),
        })
      }
      setChartEvolucion(evolucion)

      // Distribución por compañía — todas las pólizas que tuviste alguna vez
      // como cartera real. Excluye solo RENOVADA (estado temporal de la sombra
      // que duplicaría con la VIGENTE de la cadena). Incluye NO_VIGENTE,
      // CANCELADA y ANULADA porque forman parte del histórico del PAS.
      // Muestra TODAS las compañías (sin agrupador "Otras") porque el chart
      // ahora es bar horizontal con altura dinámica.
      let qVig = supabase
        .from('polizas')
        .select('compania:catalogos!compania_id (nombre)')
        .neq('estado', 'RENOVADA')
      qVig = filtrarPorPersonas(qVig, idsPersonas, 'asegurado_id')
      const { data: vigentes } = await qVig

      const compMap = new Map<string, number>()
      for (const p of (vigentes ?? []) as any[]) {
        const nombre = p.compania?.nombre ?? 'Sin compañía'
        compMap.set(nombre, (compMap.get(nombre) ?? 0) + 1)
      }
      const compArr = Array.from(compMap.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
      setChartCompanias(compArr)

      // Distribución por ramo — misma lógica: histórico completo, sin RENOVADA.
      let qVigR = supabase
        .from('polizas')
        .select('ramo:catalogos!ramo_id (nombre)')
        .neq('estado', 'RENOVADA')
      qVigR = filtrarPorPersonas(qVigR, idsPersonas, 'asegurado_id')
      const { data: vigRamos } = await qVigR

      const ramoMap = new Map<string, number>()
      for (const p of (vigRamos ?? []) as any[]) {
        const nombre = p.ramo?.nombre ?? 'Sin ramo'
        ramoMap.set(nombre, (ramoMap.get(nombre) ?? 0) + 1)
      }
      setChartRamos(
        Array.from(ramoMap.entries())
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
      )

      // Siniestralidad por compañía (últimos 12 meses) — soft-delete + cartera
      const hace12 = new Date(ahora.getFullYear(), ahora.getMonth() - 12, 1)
      const hace12str = primerDiaMes(hace12)

      let qSin = supabase
        .from('siniestros')
        .select('estado, poliza:polizas!poliza_id (compania:catalogos!compania_id (nombre))')
        .is('deleted_at', null)
        .gte('fecha_denuncia', hace12str)
      qSin = filtrarPorPersonas(qSin, idsPersonas, 'persona_id')
      const { data: sinCompania } = await qSin

      const sinMap = new Map<string, { abiertos: number; cerrados: number }>()
      for (const s of (sinCompania ?? []) as any[]) {
        const nombre = s.poliza?.compania?.nombre ?? 'Sin compañía'
        if (!sinMap.has(nombre)) sinMap.set(nombre, { abiertos: 0, cerrados: 0 })
        const entry = sinMap.get(nombre)!
        if (s.estado === 'FINALIZADO') entry.cerrados++
        else if (s.estado !== 'RECHAZADO') entry.abiertos++
      }
      setChartSiniestralidad(
        Array.from(sinMap.entries())
          .map(([name, v]) => ({ name, ...v }))
          .filter(c => c.abiertos > 0 || c.cerrados > 0)
          .sort((a, b) => (b.abiertos + b.cerrados) - (a.abiertos + a.cerrados))
      )

      // Facturación anual comparativa
      const anioActual = ahora.getFullYear()
      const anioAnterior = anioActual - 1

      const [{ data: factActual }, { data: factAnterior }] = await Promise.all([
        supabase.from('facturacion').select('mes, monto').eq('anio', anioActual),
        supabase.from('facturacion').select('mes, monto').eq('anio', anioAnterior),
      ])

      const mapActual = new Map<number, number>()
      const mapAnterior = new Map<number, number>()
      for (const r of (factActual ?? []) as any[]) {
        mapActual.set(r.mes, (mapActual.get(r.mes) ?? 0) + r.monto)
      }
      for (const r of (factAnterior ?? []) as any[]) {
        mapAnterior.set(r.mes, (mapAnterior.get(r.mes) ?? 0) + r.monto)
      }

      const factData: { mes: string; actual: number; anterior: number }[] = []
      let totAct = 0, totAnt = 0
      for (let i = 1; i <= 12; i++) {
        const a = mapActual.get(i) ?? 0
        const b = mapAnterior.get(i) ?? 0
        totAct += a
        totAnt += b
        factData.push({ mes: nombreMesCorto(i - 1), actual: a, anterior: b })
      }
      setChartFacturacion(factData)
      setTotalFactActual(totAct)
      setTotalFactAnterior(totAnt)

      // ═════════════════════════════════════════════════════════════════
      // GRÁFICOS NUEVOS (v1.0.49) — corren en paralelo para reducir latencia.
      // Cada uno respeta el filtro de cartera del usuario.
      // ═════════════════════════════════════════════════════════════════

      // Helper: cartera "viva" = sin RENOVADA (estado sombra).
      const baseCartera = () => {
        let q = supabase.from('polizas').select('*, compania:catalogos!compania_id(nombre), ramo:catalogos!ramo_id(nombre), cobertura:catalogos!cobertura_id(nombre), asegurado:personas!asegurado_id(id, apellido, nombre, razon_social, created_at)').neq('estado', 'RENOVADA')
        return filtrarPorPersonas(q, idsPersonas, 'asegurado_id')
      }

      // Query principal: trae todas las pólizas vivas con joins (reutilizada por varios gráficos).
      const { data: cartera } = await baseCartera()
      const polizasCartera = (cartera ?? []) as any[]
      const polizasVigentesAhora = polizasCartera.filter((p) => p.estado === 'VIGENTE')

      // ── Distribución por cobertura (sobre pólizas vivas) ──
      {
        const m = new Map<string, number>()
        for (const p of polizasCartera) {
          const nom = p.cobertura?.nombre ?? 'Sin cobertura'
          m.set(nom, (m.get(nom) ?? 0) + 1)
        }
        setChartCobertura(
          Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
        )
      }

      // ── Distribución por medio de pago (sobre pólizas vivas) ──
      {
        const LABELS: Record<string, string> = {
          EFECTIVO: 'Efectivo',
          DEBITO_CUENTA: 'Débito en cuenta',
          TARJETA_CREDITO: 'Tarjeta de crédito',
        }
        const m = new Map<string, number>()
        for (const p of polizasCartera) {
          const k = p.medio_pago ?? 'SIN_DATO'
          const nom = LABELS[k] ?? (k === 'SIN_DATO' ? 'Sin cargar' : k)
          m.set(nom, (m.get(nom) ?? 0) + 1)
        }
        setChartMedioPago(
          Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
        )
      }

      // ── Antigüedad de la cartera (basada en created_at del asegurado) ──
      {
        const buckets = { '< 1 año': 0, '1-3 años': 0, '3-5 años': 0, '> 5 años': 0 }
        const vistos = new Set<string>()
        for (const p of polizasVigentesAhora) {
          if (!p.asegurado?.id || !p.asegurado?.created_at) continue
          if (vistos.has(p.asegurado.id)) continue
          vistos.add(p.asegurado.id)
          const created = new Date(p.asegurado.created_at)
          const diasDif = (ahora.getTime() - created.getTime()) / 86400000
          const aniosDif = diasDif / 365.25
          if (aniosDif < 1) buckets['< 1 año']++
          else if (aniosDif < 3) buckets['1-3 años']++
          else if (aniosDif < 5) buckets['3-5 años']++
          else buckets['> 5 años']++
        }
        setChartAntiguedad(
          Object.entries(buckets).map(([name, value]) => ({ name, value })),
        )
      }

      // ── Tasa de siniestralidad por compañía (% pólizas con siniestro en 12m) ──
      // Reutiliza sinCompania que ya trajimos arriba, más una query de pólizas
      // por compañía para el denominador.
      {
        const polizasPorComp = new Map<string, number>()
        for (const p of polizasCartera) {
          const nom = p.compania?.nombre ?? 'Sin compañía'
          polizasPorComp.set(nom, (polizasPorComp.get(nom) ?? 0) + 1)
        }
        // Set de poliza_ids con al menos un siniestro en 12 meses
        let qSinIds = supabase
          .from('siniestros')
          .select('poliza:polizas!poliza_id(id, compania:catalogos!compania_id(nombre))')
          .is('deleted_at', null)
          .gte('fecha_denuncia', hace12str)
        qSinIds = filtrarPorPersonas(qSinIds, idsPersonas, 'persona_id')
        const { data: sinRows } = await qSinIds
        const polizasConSiniestro = new Map<string, Set<string>>()
        for (const s of (sinRows ?? []) as any[]) {
          const nom = s.poliza?.compania?.nombre ?? 'Sin compañía'
          const pid = s.poliza?.id
          if (!pid) continue
          if (!polizasConSiniestro.has(nom)) polizasConSiniestro.set(nom, new Set())
          polizasConSiniestro.get(nom)!.add(pid)
        }
        const data: { name: string; value: number }[] = []
        for (const [nom, total] of Array.from(polizasPorComp.entries())) {
          const conSin = polizasConSiniestro.get(nom)?.size ?? 0
          const tasa = total > 0 ? Math.round((conSin / total) * 1000) / 10 : 0
          if (tasa > 0) data.push({ name: nom, value: tasa })
        }
        setChartTasaSiniestralidad(data.sort((a, b) => b.value - a.value))
      }

      // ── Tiempo promedio de resolución de siniestros (FINALIZADO, por compañía) ──
      {
        let qResol = supabase
          .from('siniestros')
          .select('fecha_denuncia, fecha_cierre, estado, poliza:polizas!poliza_id(compania:catalogos!compania_id(nombre))')
          .is('deleted_at', null)
          .eq('estado', 'FINALIZADO')
          .not('fecha_cierre', 'is', null)
          .gte('fecha_denuncia', hace12str)
        qResol = filtrarPorPersonas(qResol, idsPersonas, 'persona_id')
        const { data: resolRows } = await qResol
        const acum = new Map<string, { dias: number; n: number }>()
        for (const r of (resolRows ?? []) as any[]) {
          const nom = r.poliza?.compania?.nombre ?? 'Sin compañía'
          const fd = new Date(r.fecha_denuncia)
          const fc = new Date(r.fecha_cierre)
          const dias = Math.max(0, Math.round((fc.getTime() - fd.getTime()) / 86400000))
          const e = acum.get(nom) ?? { dias: 0, n: 0 }
          e.dias += dias
          e.n++
          acum.set(nom, e)
        }
        setChartTiempoResolucion(
          Array.from(acum.entries())
            .map(([name, v]) => ({ name, value: Math.round(v.dias / v.n) }))
            .sort((a, b) => b.value - a.value),
        )
      }

      setCargandoCharts(false)
      setChartsLoaded(true)
    }
    cargarCharts()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabActiva, idsPersonasCargados, isAdmin])

  // ── Cargar renovaciones (lazy, solo cuando se abre pestaña) ──
  useEffect(() => {
    if (tabActiva !== 'renovaciones' || renovacionesLoaded || !idsPersonasCargados) return
    async function cargarRenovaciones() {
      setCargandoRenovaciones(true)
      const inicioMes = primerDiaMes(ahora)
      const finMes = ultimoDiaMes(ahora)

      let qRen = supabase
        .from('polizas')
        .select(`
          id, numero_poliza, fecha_fin,
          asegurado:personas!asegurado_id (apellido, nombre, razon_social),
          compania:catalogos!compania_id (nombre),
          ramo:catalogos!ramo_id (nombre),
          cobertura:catalogos!cobertura_id (nombre)
        `)
        .eq('estado', 'VIGENTE')
        .gte('fecha_fin', inicioMes)
        .lte('fecha_fin', finMes)
        .order('fecha_fin', { ascending: true })

      qRen = filtrarPorPersonas(qRen, idsPersonas, 'asegurado_id')

      const { data: renMes, error: errRen } = await qRen
      if (errRen) {
        logger.error({
          modulo: 'dashboard',
          mensaje: 'Falló carga de renovaciones del mes',
          contexto: { error: errRen.message },
        })
      }

      if (renMes && renMes.length > 0) {
        const ids = renMes.map((p: any) => p.id)
        const { data: conRen, error: errConRen } = await supabase
          .from('polizas')
          .select('poliza_origen_id')
          .in('poliza_origen_id', ids)
          .in('estado', ['RENOVADA', 'VIGENTE', 'PROGRAMADA'])
        if (errConRen) {
          // Si falla el chequeo de "ya renovada", tratamos todas como "sin
          // renovación" — se prefiere sobre-alertar antes que ocultar riesgo.
          logger.warn({
            modulo: 'dashboard',
            mensaje: 'Falló chequeo de renovaciones ya iniciadas — se muestran todas como pendientes',
            contexto: { error: errConRen.message },
          })
        }
        const idsConRen = new Set((conRen ?? []).map((r: any) => r.poliza_origen_id))

        setRenovacionesMes(renMes.map((p: any) => ({
          ...p,
          tiene_renovacion: idsConRen.has(p.id),
        })) as RenovacionMes[])
      } else {
        setRenovacionesMes([])
      }
      setCargandoRenovaciones(false)
      setRenovacionesLoaded(true)
    }
    cargarRenovaciones()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabActiva, idsPersonasCargados, refreshTick])

  // Realtime: cualquier cambio en las tablas clave del dashboard incrementa el
  // tick y refetchea KPIs, panel de acción y renovaciones del mes.
  useRealtimeRefresh({
    tablas: ['polizas', 'siniestros', 'tareas', 'personas', 'notificaciones'],
    onCambio: () => {
      setRefreshTick(t => t + 1)
      // Invalidamos los lazy loaders para que refetcheen cuando el usuario
      // vuelva a la pestaña — sino con Realtime más un renovacionesLoaded=true
      // nos quedaríamos con data vieja.
      setRenovacionesLoaded(false)
      setChartsLoaded(false)
    },
  })

  // ── Post-it handlers ──
  async function guardarPostit() {
    if (!postitTexto.trim() || guardandoPostit) return
    setGuardandoPostit(true)

    if (editandoPostitId) {
      await apiCall(`/api/postits/${editandoPostitId}`, {
        method: 'PATCH',
        body: { texto: postitTexto, color: postitColor, compartido: postitCompartido },
      })
    } else {
      await apiCall('/api/postits', {
        method: 'POST',
        body: { texto: postitTexto, color: postitColor, compartido: postitCompartido },
      })
    }

    setCreandoPostit(false)
    setEditandoPostitId(null)
    setPostitTexto('')
    setPostitColor('amarillo')
    setPostitCompartido(false)
    setGuardandoPostit(false)
    cargarPostits()
  }

  function iniciarEdicion(p: PostitData) {
    setEditandoPostitId(p.id)
    setPostitTexto(p.texto)
    setPostitColor(p.color)
    setPostitCompartido(p.compartido)
    setCreandoPostit(true)
  }

  async function eliminarPostit(id: string) {
    await apiCall(`/api/postits/${id}`, { method: 'DELETE' })
    setEliminandoPostitId(null)
    cargarPostits()
  }

  async function cambiarColorPostit(id: string, color: string) {
    await apiCall(`/api/postits/${id}`, {
      method: 'PATCH',
      body: { color },
    })
    setColorPickerPostitId(null)
    cargarPostits()
  }

  async function toggleCompartidoPostit(p: PostitData) {
    await apiCall(`/api/postits/${p.id}`, {
      method: 'PATCH',
      body: { compartido: !p.compartido },
    })
    cargarPostits()
  }

  function cancelarPostit() {
    setCreandoPostit(false)
    setEditandoPostitId(null)
    setPostitTexto('')
    setPostitColor('amarillo')
    setPostitCompartido(false)
  }

  // ── Render ──
  if (authLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  const anioActual = ahora.getFullYear()
  const anioAnterior = anioActual - 1
  const diffFact = totalFactActual - totalFactAnterior
  const pctFact = totalFactAnterior > 0 ? ((diffFact / totalFactAnterior) * 100).toFixed(1) : null

  return (
    <div className="flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Dashboard</h1>
          <p className="text-xs text-slate-500 mt-0.5">Resumen ejecutivo de tu cartera</p>
        </div>
        <span className="text-xs text-slate-500 font-mono">{fechaCapitalizada}</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTabActiva(t.id)}
            className={`px-4 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
              tabActiva === t.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════ */}
      {/* PESTAÑA: INICIO                                        */}
      {/* ═══════════════════════════════════════════════════════ */}
      {tabActiva === 'inicio' && (
        <>
          {/* KPIs */}
          {cargandoKpis ? (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="kpi-card animate-pulse">
                  <div className="h-3 bg-slate-200 rounded w-24 mb-2" />
                  <div className="h-6 bg-slate-200 rounded w-16 mb-1" />
                  <div className="h-2.5 bg-slate-100 rounded w-32" />
                </div>
              ))}
            </div>
          ) : kpis && (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
              <KPICard
                icono={<Users className="h-4 w-4 text-blue-500" />}
                label="Clientes asegurados"
                valor={kpis.clientesAsegurados}
                tendencia={kpis.clientesTendencia}
                sub={`${kpis.clientesTendencia >= 0 ? '+' : ''}${kpis.clientesTendencia} este mes`}
                onClick={() => router.push('/crm/personas')}
              />
              <KPICard
                icono={<FileText className="h-4 w-4 text-emerald-500" />}
                label="Pólizas vigentes"
                valor={kpis.polizasVigentes}
                tendencia={kpis.polizasTendencia}
                sub={`${kpis.polizasTendencia >= 0 ? '+' : ''}${kpis.polizasTendencia} nuevas este mes`}
                onClick={() => router.push('/crm/polizas')}
              />
              <KPICard
                icono={<Clock className="h-4 w-4 text-amber-500" />}
                label="Vencen en 30 días"
                valor={kpis.vencenEsteMes}
                sub={kpis.vencenEstaSemana > 0 ? `${kpis.vencenEstaSemana} esta semana` : 'Ninguna esta semana'}
                badge={kpis.vencenEstaSemana > 0 ? { text: `${kpis.vencenEstaSemana} urgentes`, color: 'bg-red-50 text-red-700' } : undefined}
                onClick={() => router.push('/crm/renovaciones')}
              />
              <KPICard
                icono={<AlertTriangle className="h-4 w-4 text-red-500" />}
                label="Siniestros abiertos"
                valor={kpis.siniestrosAbiertos}
                tendencia={kpis.siniestrosTendencia}
                sub={kpis.siniestrosMas30 > 0 ? `${kpis.siniestrosMas30} con más de 30 días` : 'Todos recientes'}
                badge={kpis.siniestrosMas30 > 0 ? { text: `${kpis.siniestrosMas30} antiguos`, color: 'bg-amber-50 text-amber-700' } : undefined}
                onClick={() => router.push('/crm/siniestros')}
              />
              <KPICard
                icono={<TrendingUp className="h-4 w-4 text-violet-500" />}
                label="Pólizas nuevas este mes"
                valor={kpis.polizasNuevas}
                tendencia={kpis.polizasNuevasTendencia}
                sub="Producción nueva"
                onClick={() => router.push('/crm/polizas')}
              />
              <KPICard
                icono={<XCircle className="h-4 w-4 text-slate-400" />}
                label="Bajas este mes"
                valor={kpis.bajas}
                tendencia={kpis.bajasTendencia}
                invertirColor
                sub={`${kpis.canceladas} canceladas, ${kpis.anuladas} anuladas`}
                onClick={() => router.push('/crm/polizas')}
              />
            </div>
          )}

          {/* Post-it: Notas rápidas */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                <StickyNote className="h-4 w-4 text-amber-500" />
                Notas rápidas
              </h2>
              {!creandoPostit && (
                <button
                  onClick={() => { cancelarPostit(); setCreandoPostit(true) }}
                  className="btn-primary text-xs px-3 py-1 flex items-center gap-1"
                >
                  <Plus className="h-3.5 w-3.5" /> Nueva nota
                </button>
              )}
            </div>

            <div className="bg-amber-50/30 border border-amber-100 rounded-lg p-5" style={{ minHeight: 280 }}>
              {cargandoPostits ? (
                <div className="flex items-center justify-center h-[200px] text-slate-400 text-xs gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Cargando notas...
                </div>
              ) : (
                <div className="flex flex-wrap gap-4">
                  {/* Formulario de nuevo/editar post-it */}
                  {creandoPostit && (
                    <div
                      className="rounded-lg p-4 shadow-md flex flex-col gap-2"
                      style={{ width: 240, minHeight: 240, backgroundColor: POSTIT_COLORES[postitColor] }}
                    >
                      <textarea
                        value={postitTexto}
                        onChange={e => setPostitTexto(e.target.value)}
                        maxLength={500}
                        placeholder="Escribí tu nota..."
                        className="flex-1 bg-transparent border-none outline-none resize-none font-postit text-2xl leading-tight text-slate-800 placeholder-slate-400"
                        autoFocus
                        rows={5}
                      />
                      <div className="text-2xs text-slate-400 text-right">{postitTexto.length}/500</div>
                      <div className="flex items-center gap-1.5">
                        {Object.entries(POSTIT_COLORES).map(([c, hex]) => (
                          <button
                            key={c}
                            onClick={() => setPostitColor(c)}
                            className={`w-5 h-5 rounded-full border-2 ${postitColor === c ? 'border-slate-600' : 'border-transparent'}`}
                            style={{ backgroundColor: hex }}
                          />
                        ))}
                      </div>
                      <label className="flex items-center gap-1.5 text-2xs text-slate-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={postitCompartido}
                          onChange={e => setPostitCompartido(e.target.checked)}
                          className="rounded text-blue-600"
                        />
                        Compartido con todos
                      </label>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={guardarPostit}
                          disabled={!postitTexto.trim() || guardandoPostit}
                          className="btn-primary text-2xs px-2.5 py-1 disabled:opacity-50"
                        >
                          {guardandoPostit ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Guardar'}
                        </button>
                        <button onClick={cancelarPostit} className="text-2xs text-slate-500 hover:text-slate-700 px-2 py-1">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Post-it existentes */}
                  {postits.length === 0 && !creandoPostit && (
                    <div className="flex flex-col items-center justify-center w-full py-8 text-slate-400">
                      <StickyNote className="h-8 w-8 text-slate-200 mb-1" />
                      <span className="text-xs">No hay notas. Hacé clic en &quot;Nueva nota&quot; para empezar.</span>
                    </div>
                  )}

                  {postits.map(p => {
                    const esMio = p.usuario_id === usuario?.id
                    const rot = rotacionPostit(p.id)
                    return (
                      <div
                        key={p.id}
                        className="group relative rounded-lg p-4 shadow-md transition-shadow hover:shadow-lg flex flex-col"
                        style={{
                          width: 240,
                          minHeight: 240,
                          backgroundColor: POSTIT_COLORES[p.color] ?? POSTIT_COLORES.amarillo,
                          transform: `rotate(${rot}deg)`,
                        }}
                      >
                        {/* Ícono compartido/personal */}
                        <div className="flex justify-end mb-1">
                          {p.compartido
                            ? <UsersIcon className="h-3.5 w-3.5 text-slate-400" />
                            : <User className="h-3.5 w-3.5 text-slate-400" />
                          }
                        </div>

                        {/* Botones hover (solo del creador) */}
                        {esMio && (
                          <div className="absolute top-1 left-1 right-7 hidden group-hover:flex items-center gap-0.5 z-10">
                            <button onClick={() => iniciarEdicion(p)} className="p-1 rounded hover:bg-black/10" title="Editar">
                              <Edit2 className="h-3.5 w-3.5 text-slate-600" />
                            </button>
                            <div className="relative">
                              <button onClick={() => setColorPickerPostitId(colorPickerPostitId === p.id ? null : p.id)} className="p-1 rounded hover:bg-black/10" title="Cambiar color">
                                <Palette className="h-3.5 w-3.5 text-slate-600" />
                              </button>
                              {colorPickerPostitId === p.id && (
                                <div className="absolute top-7 left-0 bg-white rounded-lg shadow-lg border border-slate-200 p-1.5 flex gap-1 z-20">
                                  {Object.entries(POSTIT_COLORES).map(([c, hex]) => (
                                    <button
                                      key={c}
                                      onClick={() => cambiarColorPostit(p.id, c)}
                                      className={`w-5 h-5 rounded-full border-2 ${p.color === c ? 'border-slate-600' : 'border-slate-200'}`}
                                      style={{ backgroundColor: hex }}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                            <button onClick={() => toggleCompartidoPostit(p)} className="p-1 rounded hover:bg-black/10" title={p.compartido ? 'Hacer personal' : 'Compartir'}>
                              {p.compartido
                                ? <User className="h-3.5 w-3.5 text-slate-600" />
                                : <UsersIcon className="h-3.5 w-3.5 text-slate-600" />
                              }
                            </button>
                            <button onClick={() => setEliminandoPostitId(p.id)} className="p-1 rounded hover:bg-black/10" title="Eliminar">
                              <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            </button>
                          </div>
                        )}

                        {/* Confirmación de eliminar */}
                        {eliminandoPostitId === p.id && (
                          <div className="absolute inset-0 bg-white/90 rounded-lg flex flex-col items-center justify-center gap-2 z-20 p-4">
                            <span className="text-xs text-slate-700 text-center font-medium">¿Eliminar nota?</span>
                            <div className="flex items-center gap-2">
                              <button onClick={() => eliminarPostit(p.id)} className="btn-danger text-2xs px-2.5 py-1">Sí</button>
                              <button onClick={() => setEliminandoPostitId(null)} className="text-2xs text-slate-500 hover:text-slate-700 px-2 py-1">No</button>
                            </div>
                          </div>
                        )}

                        {/* Texto manuscrito tipo nota real */}
                        <p className="flex-1 font-postit text-2xl leading-tight text-slate-800 whitespace-pre-wrap break-words">{p.texto}</p>

                        {/* Footer */}
                        <div className="flex items-end justify-between mt-2">
                          <span className="text-2xs text-slate-500">{fechaRelativa(p.created_at)}</span>
                          {p.compartido && p.usuario_id !== usuario?.id && p.usuario && (
                            <span className="text-2xs text-slate-500 italic">— {p.usuario.nombre}</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Agenda del día */}
          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
              <CalendarCheck className="h-4 w-4 text-blue-500" />
              Agenda del día
              <span className="font-normal text-slate-500 ml-1">— {fechaCapitalizada}</span>
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {/* Tareas pendientes */}
              <AccionCard
                titulo="Tareas pendientes"
                color="blue"
                icono={<ClipboardList className="h-3.5 w-3.5" />}
                cargando={cargandoAccion}
                vacio={tareasPendientes.length === 0}
                vacioTexto="Sin tareas pendientes para hoy"
                vacioIcono={<CheckCircle2 className="h-8 w-8 text-slate-200" />}
                footer={{ label: 'Ver todas las tareas', href: '/crm/tareas' }}
              >
                {tareasPendientes.map(t => {
                  const dias = diasAtraso(t.fecha_vencimiento)
                  return (
                    <div
                      key={t.id}
                      onClick={() => router.push(`/crm/tareas/${t.id}`)}
                      className="flex items-start gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-800 truncate">{t.titulo}</p>
                        <p className="text-2xs text-slate-500 truncate">{nombrePersona(t.persona)}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {dias > 0 && (
                          <span className="text-2xs text-red-600 font-medium">hace {dias}d</span>
                        )}
                        <span className={`text-2xs px-1.5 py-0.5 rounded border font-medium ${
                          t.prioridad === 'CRITICA' ? 'bg-red-50 text-red-700 border-red-200' :
                          t.prioridad === 'ALTA' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                          t.prioridad === 'MEDIA' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                          'bg-slate-50 text-slate-600 border-slate-200'
                        }`}>
                          {t.prioridad === 'CRITICA' ? 'Crítica' : t.prioridad === 'ALTA' ? 'Alta' : t.prioridad === 'MEDIA' ? 'Media' : 'Baja'}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </AccionCard>

              {/* Pólizas por vencer */}
              <AccionCard
                titulo="Pólizas por vencer"
                color="orange"
                icono={<Clock className="h-3.5 w-3.5" />}
                cargando={cargandoAccion}
                vacio={polizasPorVencer.length === 0}
                vacioTexto="Sin pólizas por vencer esta semana"
                vacioIcono={<Shield className="h-8 w-8 text-slate-200" />}
                footer={{ label: 'Ver renovaciones', href: '/crm/renovaciones' }}
              >
                {polizasPorVencer.map(p => (
                  <div
                    key={p.id}
                    onClick={() => router.push(`/crm/renovaciones/${p.id}`)}
                    className="flex items-start gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono font-medium text-slate-800">{p.numero_poliza}</p>
                      <p className="text-2xs text-slate-500 truncate">
                        {nombrePersona(p.asegurado)} · {p.compania?.nombre ?? '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`text-2xs font-semibold ${p.dias_restantes <= 3 ? 'text-red-600' : 'text-orange-600'}`}>
                        {p.dias_restantes}d
                      </span>
                      {p.tiene_renovacion ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <AlertOctagon className="h-3.5 w-3.5 text-red-400" />
                      )}
                    </div>
                  </div>
                ))}
              </AccionCard>

              {/* Siniestros sin movimiento */}
              <AccionCard
                titulo="Siniestros sin movimiento"
                color="red"
                icono={<AlertTriangle className="h-3.5 w-3.5" />}
                cargando={cargandoAccion}
                vacio={siniestrosInactivos.length === 0}
                vacioTexto="Todos los siniestros tienen movimiento reciente"
                vacioIcono={<Shield className="h-8 w-8 text-slate-200" />}
                footer={{ label: 'Ver siniestros', href: '/crm/siniestros' }}
              >
                {siniestrosInactivos.map(s => {
                  const badge = getEstadoBadge(s.estado)
                  return (
                    <div
                      key={s.id}
                      onClick={() => router.push(`/crm/siniestros/${s.id}`)}
                      className="flex items-start gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono font-medium text-slate-800">{s.numero_caso}</p>
                        <p className="text-2xs text-slate-500 truncate">{nombrePersona(s.persona)}</p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`text-2xs font-medium ${s.dias_sin_movimiento >= 30 ? 'text-red-600' : 'text-amber-600'}`}>
                          {s.dias_sin_movimiento}d
                        </span>
                        <span className={`text-2xs px-1.5 py-0.5 rounded border font-medium ${badge.color}`}>
                          {badge.label}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </AccionCard>
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* PESTAÑA: ANÁLISIS DE CARTERA (solo admin)              */}
      {/* ═══════════════════════════════════════════════════════ */}
      {tabActiva === 'analisis' && isAdmin && (
        <>
          {cargandoCharts ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white border border-slate-200 rounded p-4 h-64 animate-pulse">
                  <div className="h-3 bg-slate-200 rounded w-40 mb-4" />
                  <div className="h-full bg-slate-50 rounded" />
                </div>
              ))}
            </div>
          ) : (() => {
            // Helpers visuales para evitar repetir JSX:
            const SinDatos = ({ h = 220 }: { h?: number }) => (
              <div className="flex items-center justify-center text-xs text-slate-400" style={{ height: h }}>Sin datos</div>
            )
            // Altura dinámica para bar charts horizontales: 36 px por fila + 60 base.
            const heightBarH = (n: number) => Math.max(220, Math.min(600, n * 36 + 60))
            const Vis = (id: string) => graficoVisible(id, graficosVisibles)

            // Si todo está apagado, mostrar mensaje guía
            const algunoVisible = [
              'evolucion','distribucion_compania','distribucion_ramo','distribucion_cobertura',
              'distribucion_medio_pago',
              'antiguedad_cartera',
              'siniestralidad_compania','tasa_siniestralidad_compania','tiempo_resolucion_siniestros',
              'facturacion_anual',
            ].some(Vis)

            if (!algunoVisible) {
              return (
                <div className="bg-white border border-slate-200 rounded p-8 text-center">
                  <BarChart className="h-10 w-10 text-slate-200 mx-auto mb-2" />
                  <p className="text-sm text-slate-600 font-medium">No hay gráficos habilitados</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Activá los gráficos que querés ver desde{' '}
                    <a href="/crm/configuracion/dashboard" className="text-blue-600 hover:underline">Configuración → Panel de Análisis</a>.
                  </p>
                </div>
              )
            }

            return (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">

                  {/* ── Cartera ───────────────────────────────────────── */}
                  {Vis('evolucion') && (
                    <ChartCard
                      icono={<LineChartIcon className="h-3.5 w-3.5" />}
                      titulo="Evolución de cartera (últimos 12 meses)"
                      tono="blue"
                      badge={chartEvolucion.length > 0 ? chartEvolucion[chartEvolucion.length - 1].cantidad : undefined}
                    >
                      <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={chartEvolucion} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="grad-evol-area" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.32} />
                              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                          <XAxis dataKey="mes" tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                          <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v, 'Pólizas']} cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '3 3' }} />
                          <Area type="monotone" dataKey="cantidad" stroke="#1e40af" strokeWidth={2.5} fill="url(#grad-evol-area)" dot={{ r: 3, fill: '#1e40af' }} activeDot={{ r: 6, fill: '#1e40af', stroke: '#fff', strokeWidth: 2 }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </ChartCard>
                  )}

                  {Vis('distribucion_compania') && (
                    <ChartCard
                      icono={<Building2 className="h-3.5 w-3.5" />}
                      titulo="Distribución por compañía"
                      tono="blue"
                      badge={chartCompanias.length}
                    >
                      {chartCompanias.length === 0 ? <SinDatos /> : (
                        <ResponsiveContainer width="100%" height={heightBarH(chartCompanias.length)}>
                          <BarChart data={chartCompanias} layout="vertical" margin={{ left: 0 }}>
                            <defs>{gradientStops(['blue'], true)}</defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" allowDecimals={false} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="#475569" width={140} tickLine={false} axisLine={false} />
                            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(59, 130, 246, 0.06)' }} />
                            <Bar dataKey="value" fill="url(#grad-blue)" radius={[0, 6, 6, 0]} barSize={16} name="Pólizas" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </ChartCard>
                  )}

                  {Vis('distribucion_ramo') && (
                    <ChartCard
                      icono={<Layers className="h-3.5 w-3.5" />}
                      titulo="Distribución por ramo"
                      tono="emerald"
                      badge={chartRamos.length}
                    >
                      {chartRamos.length === 0 ? <SinDatos /> : (
                        <ResponsiveContainer width="100%" height={heightBarH(chartRamos.length)}>
                          <BarChart data={chartRamos} layout="vertical" margin={{ left: 0 }}>
                            <defs>{gradientStops(['emerald'], true)}</defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" allowDecimals={false} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="#475569" width={140} tickLine={false} axisLine={false} />
                            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(16, 185, 129, 0.06)' }} />
                            <Bar dataKey="value" fill="url(#grad-emerald)" radius={[0, 6, 6, 0]} barSize={16} name="Pólizas" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </ChartCard>
                  )}

                  {Vis('distribucion_cobertura') && (
                    <ChartCard
                      icono={<ShieldCheck className="h-3.5 w-3.5" />}
                      titulo="Distribución por cobertura"
                      tono="violet"
                      badge={chartCobertura.length}
                    >
                      {chartCobertura.length === 0 ? <SinDatos /> : (
                        <ResponsiveContainer width="100%" height={heightBarH(chartCobertura.length)}>
                          <BarChart data={chartCobertura} layout="vertical" margin={{ left: 0 }}>
                            <defs>{gradientStops(['violet'], true)}</defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" allowDecimals={false} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="#475569" width={140} tickLine={false} axisLine={false} />
                            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(139, 92, 246, 0.06)' }} />
                            <Bar dataKey="value" fill="url(#grad-violet)" radius={[0, 6, 6, 0]} barSize={16} name="Pólizas" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </ChartCard>
                  )}

                  {Vis('distribucion_medio_pago') && (
                    <ChartCard
                      icono={<CreditCard className="h-3.5 w-3.5" />}
                      titulo="Distribución por medio de pago"
                      tono="cyan"
                    >
                      {chartMedioPago.length === 0 ? <SinDatos /> : (
                        <DonutCard data={chartMedioPago} colors={['#0e7490', '#06b6d4', '#67e8f9', '#cffafe']} />
                      )}
                    </ChartCard>
                  )}


                  {/* ── Clientes ──────────────────────────────────────── */}
                  {Vis('antiguedad_cartera') && (
                    <ChartCard
                      icono={<CalendarDays className="h-3.5 w-3.5" />}
                      titulo="Antigüedad de la cartera"
                      tono="fuchsia"
                    >
                      {chartAntiguedad.every(d => d.value === 0) ? <SinDatos /> : (
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart data={chartAntiguedad} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                            <defs>{gradientStops(['fuchsia'])}</defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#475569" tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                            <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" allowDecimals={false} tickLine={false} axisLine={false} />
                            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v, 'Clientes']} cursor={{ fill: 'rgba(217, 70, 239, 0.06)' }} />
                            <Bar dataKey="value" fill="url(#grad-fuchsia)" radius={[8, 8, 0, 0]} barSize={42} name="Clientes" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </ChartCard>
                  )}

                  {/* ── Siniestros ────────────────────────────────────── */}
                  {Vis('siniestralidad_compania') && (
                    <ChartCard
                      icono={<Activity className="h-3.5 w-3.5" />}
                      titulo="Siniestralidad por compañía (12 meses)"
                      tono="rose"
                    >
                      {chartSiniestralidad.length === 0 ? <SinDatos /> : (
                        <ResponsiveContainer width="100%" height={240}>
                          <BarChart data={chartSiniestralidad} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                            <defs>{gradientStops(['rose', 'emerald'])}</defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="#475569" interval={0} angle={-20} textAnchor="end" height={50} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                            <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(244, 63, 94, 0.06)' }} />
                            <Bar dataKey="abiertos" fill="url(#grad-rose)" radius={[6, 6, 0, 0]} barSize={16} name="Abiertos" />
                            <Bar dataKey="cerrados" fill="url(#grad-emerald)" radius={[6, 6, 0, 0]} barSize={16} name="Cerrados" />
                            <Legend iconSize={8} formatter={(v: string) => <span className="text-2xs text-slate-600">{v}</span>} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </ChartCard>
                  )}

                  {Vis('tasa_siniestralidad_compania') && (
                    <ChartCard
                      icono={<Percent className="h-3.5 w-3.5" />}
                      titulo="Tasa de siniestralidad por compañía"
                      tono="rose"
                    >
                      <p className="text-2xs text-slate-500 -mt-2 mb-2">% de pólizas con al menos un siniestro en los últimos 12 meses</p>
                      {chartTasaSiniestralidad.length === 0 ? <SinDatos /> : (
                        <ResponsiveContainer width="100%" height={heightBarH(chartTasaSiniestralidad.length)}>
                          <BarChart data={chartTasaSiniestralidad} layout="vertical" margin={{ left: 0 }}>
                            <defs>{gradientStops(['rose'], true)}</defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={(v: number) => `${v}%`} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="#475569" width={140} tickLine={false} axisLine={false} />
                            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v}%`, 'Tasa']} cursor={{ fill: 'rgba(244, 63, 94, 0.06)' }} />
                            <Bar dataKey="value" fill="url(#grad-rose)" radius={[0, 6, 6, 0]} barSize={16} name="Tasa" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </ChartCard>
                  )}

                  {Vis('tiempo_resolucion_siniestros') && (
                    <ChartCard
                      icono={<Hourglass className="h-3.5 w-3.5" />}
                      titulo="Tiempo promedio de resolución"
                      tono="violet"
                    >
                      <p className="text-2xs text-slate-500 -mt-2 mb-2">Días promedio entre denuncia y cierre (FINALIZADOS, últimos 12 meses)</p>
                      {chartTiempoResolucion.length === 0 ? <SinDatos /> : (
                        <ResponsiveContainer width="100%" height={heightBarH(chartTiempoResolucion.length)}>
                          <BarChart data={chartTiempoResolucion} layout="vertical" margin={{ left: 0 }}>
                            <defs>{gradientStops(['violet'], true)}</defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                            <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="#475569" width={140} tickLine={false} axisLine={false} />
                            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v} días`, 'Promedio']} cursor={{ fill: 'rgba(139, 92, 246, 0.06)' }} />
                            <Bar dataKey="value" fill="url(#grad-violet)" radius={[0, 6, 6, 0]} barSize={16} name="Días" />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </ChartCard>
                  )}
                </div>

                {/* ── Comercial / Facturación ─────────────────────────── */}
                {Vis('facturacion_anual') && (
                  <ChartCard
                    icono={<TrendingUp className="h-3.5 w-3.5" />}
                    titulo="Facturación anual comparativa"
                    tono="navy"
                    fullWidth
                  >
                    {chartFacturacion.every(d => d.actual === 0 && d.anterior === 0) ? (
                      <div className="flex flex-col items-center justify-center h-[280px] text-slate-400">
                        <TrendingUp className="h-8 w-8 text-slate-200 mb-2" />
                        <span className="text-xs">No hay datos de facturación cargados.</span>
                        <span className="text-2xs mt-1">Cargá tus facturaciones desde el módulo de Facturación.</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-4 mb-3 text-2xs text-slate-500">
                          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: `linear-gradient(180deg, ${GRADIENTES.navy.from}, ${GRADIENTES.navy.to})` }} /> {anioActual}</span>
                          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: `linear-gradient(180deg, ${GRADIENTES.slate.from}, ${GRADIENTES.slate.to})` }} /> {anioAnterior}</span>
                        </div>
                        <ResponsiveContainer width="100%" height={280}>
                          <BarChart data={chartFacturacion} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                            <defs>{gradientStops(['navy', 'slate'])}</defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis dataKey="mes" tick={{ fontSize: 11 }} stroke="#475569" tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                            <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tickLine={false} axisLine={false} />
                            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [formatMoneda(v), name === 'actual' ? anioActual : anioAnterior]} cursor={{ fill: 'rgba(30, 58, 95, 0.05)' }} />
                            <Bar dataKey="actual" fill="url(#grad-navy)" radius={[6, 6, 0, 0]} barSize={16} name={String(anioActual)} />
                            <Bar dataKey="anterior" fill="url(#grad-slate)" radius={[6, 6, 0, 0]} barSize={16} name={String(anioAnterior)} />
                          </BarChart>
                        </ResponsiveContainer>
                        <div className="mt-3 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                          <span>Total {anioActual}: <strong>{formatMoneda(totalFactActual)}</strong></span>
                          <span>Total {anioAnterior}: <strong>{formatMoneda(totalFactAnterior)}</strong></span>
                          <span>
                            Diferencia:{' '}
                            <strong className={diffFact >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                              {diffFact >= 0 ? '+' : ''}{formatMoneda(diffFact)}
                              {pctFact && ` (${diffFact >= 0 ? '+' : ''}${pctFact}%)`}
                            </strong>
                          </span>
                        </div>
                      </>
                    )}
                  </ChartCard>
                )}
              </>
            )
          })()}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* PESTAÑA: RENOVACIONES DEL MES                          */}
      {/* ═══════════════════════════════════════════════════════ */}
      {tabActiva === 'renovaciones' && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
            <RefreshCw className="h-4 w-4 text-violet-500" />
            Renovaciones de {MESES[ahora.getMonth()]}
          </h2>
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            {cargandoRenovaciones ? (
              <div className="flex items-center justify-center py-8 text-slate-400 text-xs gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando renovaciones...
              </div>
            ) : renovacionesMes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                <Shield className="h-8 w-8 text-slate-200 mb-1" />
                <span className="text-xs">No hay pólizas que venzan este mes</span>
              </div>
            ) : (
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Vencimiento</th>
                    <th>Nº Póliza</th>
                    <th>Asegurado</th>
                    <th>Compañía</th>
                    <th>Ramo</th>
                    <th>Cobertura</th>
                    <th>Estado renovación</th>
                  </tr>
                </thead>
                <tbody>
                  {renovacionesMes.map(p => {
                    const vencida = p.fecha_fin.split('T')[0] < hoy
                    return (
                      <tr
                        key={p.id}
                        className={`cursor-pointer ${vencida ? 'bg-red-50/40' : ''}`}
                        onClick={() => router.push(`/crm/renovaciones/${p.id}`)}
                      >
                        <td className="font-mono text-xs text-slate-600">{formatFechaLocal(p.fecha_fin)}</td>
                        <td className="font-mono text-xs font-medium text-slate-800">{p.numero_poliza}</td>
                        <td className="text-xs text-slate-700">{nombrePersona(p.asegurado)}</td>
                        <td className="text-xs text-slate-600">{p.compania?.nombre ?? '—'}</td>
                        <td className="text-xs text-slate-600">{p.ramo?.nombre ?? '—'}</td>
                        <td className="text-xs text-slate-600">{p.cobertura?.nombre ?? '—'}</td>
                        <td>
                          {p.tiene_renovacion ? (
                            <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded border font-medium bg-emerald-50 text-emerald-700 border-emerald-200">
                              <CheckCircle2 className="h-3 w-3" /> Renovada
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded border font-medium bg-red-50 text-red-700 border-red-200">
                              <AlertOctagon className="h-3 w-3" /> Pendiente
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Donut con total al centro + leyenda lateral ─────────────
function DonutCard({ data, colors }: { data: { name: string; value: number }[]; colors: string[] }) {
  const total = data.reduce((a, b) => a + b.value, 0)
  return (
    <div className="flex items-center gap-3">
      <div className="relative" style={{ width: 150, height: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={48} outerRadius={70} paddingAngle={3} dataKey="value" stroke="#fff" strokeWidth={2}>
              {data.map((_, i) => (
                <Cell key={i} fill={colors[i % colors.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-base font-bold text-slate-800 leading-none">{total}</span>
          <span className="text-2xs text-slate-500 mt-0.5">Total</span>
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5 max-h-[150px] overflow-y-auto">
        {data.map((d, i) => {
          const pct = total > 0 ? Math.round((d.value / total) * 100) : 0
          return (
            <div key={d.name} className="flex items-center gap-2 text-2xs">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: colors[i % colors.length] }} />
              <span className="text-slate-700 truncate flex-1">{d.name}</span>
              <span className="text-slate-500 tabular-nums shrink-0">{d.value} · {pct}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Card de gráfico con header colorido ─────────────────────
function ChartCard({
  icono, titulo, badge, tono = 'blue', fullWidth, children,
}: {
  icono: React.ReactNode
  titulo: string
  badge?: string | number
  tono?: GradKey
  fullWidth?: boolean
  children: React.ReactNode
}) {
  const g = GRADIENTES[tono]
  return (
    <div
      className={`bg-white border border-slate-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow ${fullWidth ? 'lg:col-span-2' : ''}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="flex items-center justify-center h-7 w-7 rounded-md shrink-0 text-white"
            style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})` }}
          >
            {icono}
          </div>
          <h3 className="text-xs font-semibold text-slate-700 truncate">{titulo}</h3>
        </div>
        {badge !== undefined && (
          <span className="text-2xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-700 shrink-0">
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

// ── KPI Card con tendencia ──────────────────────────────────
function KPICard({
  icono, label, valor, tendencia, invertirColor, sub, badge, onClick
}: {
  icono: React.ReactNode
  label: string
  valor: number
  tendencia?: number
  invertirColor?: boolean
  sub?: string
  badge?: { text: string; color: string }
  onClick?: () => void
}) {
  let tendenciaColor = 'text-slate-400'
  let TendenciaIcono = Minus
  if (tendencia !== undefined && tendencia !== 0) {
    if (tendencia > 0) {
      tendenciaColor = invertirColor ? 'text-red-500' : 'text-emerald-500'
      TendenciaIcono = TrendingUp
    } else {
      tendenciaColor = invertirColor ? 'text-emerald-500' : 'text-red-500'
      TendenciaIcono = TrendingDown
    }
  }

  return (
    <button
      onClick={onClick}
      className="kpi-card text-left hover:border-slate-300 transition-colors cursor-pointer w-full"
    >
      <div className="flex items-center justify-between">
        <span className="kpi-label">{label}</span>
        {icono}
      </div>
      <div className="flex items-center gap-2">
        <span className="kpi-value">{valor.toLocaleString('es-AR')}</span>
        {tendencia !== undefined && (
          <span className={`flex items-center gap-0.5 text-2xs font-medium ${tendenciaColor}`}>
            <TendenciaIcono className="h-3 w-3" />
            {Math.abs(tendencia)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {sub && <span className="kpi-sub">{sub}</span>}
        {badge && (
          <span className={`text-2xs px-1.5 py-0.5 rounded font-medium ${badge.color}`}>
            {badge.text}
          </span>
        )}
      </div>
    </button>
  )
}

// ── Card de acción diaria ───────────────────────────────────
function AccionCard({
  titulo, color, icono, cargando, vacio, vacioTexto, vacioIcono, footer, children
}: {
  titulo: string
  color: 'blue' | 'orange' | 'red'
  icono: React.ReactNode
  cargando: boolean
  vacio: boolean
  vacioTexto: string
  vacioIcono: React.ReactNode
  footer: { label: string; href: string }
  children: React.ReactNode
}) {
  const router = useRouter()
  const headerColors = {
    blue: 'bg-blue-600 text-white',
    orange: 'bg-orange-500 text-white',
    red: 'bg-red-500 text-white',
  }

  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden flex flex-col">
      <div className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold ${headerColors[color]}`}>
        {icono}
        {titulo}
      </div>
      <div className="flex-1 min-h-0">
        {cargando ? (
          <div className="flex items-center justify-center py-8 text-slate-400 text-xs gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : vacio ? (
          <div className="flex flex-col items-center justify-center py-8 gap-1">
            {vacioIcono}
            <span className="text-2xs text-slate-400">{vacioTexto}</span>
          </div>
        ) : (
          children
        )}
      </div>
      <div className="border-t border-slate-100 px-3 py-1.5">
        <button
          onClick={() => router.push(footer.href)}
          className="text-2xs text-blue-600 hover:text-blue-800 flex items-center gap-0.5 transition-colors"
        >
          {footer.label} <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
