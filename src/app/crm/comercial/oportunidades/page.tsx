'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Search, X, Target, Trophy, XCircle, Lightbulb,
  Trash2, Loader2, MessageSquare, ChevronDown, ChevronUp,
  UserMinus, Ban, Repeat, CheckCircle, DollarSign
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { formatFechaLocalLarga, hoyLocal, formatMoneda, sanitizarBusquedaNormalizada } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { filtrarPorPersonas, puedeEliminar, obtenerIdsPersonas, obtenerIdsPapelera, excluirPersonasEnPapelera } from '@/lib/cartera-filter'
import { toast } from '@/lib/toast'
import { EstadoCarga } from '@/components/EstadoCarga'
import { useRealtimeRefresh } from '@/lib/hooks/useRealtimeRefresh'

// Formato compacto para mostrar montos grandes en cards estrechas (KPIs).
// Ej: 1234567 → "$1,2 M". Mantiene consistencia visual con los otros KPIs
// de la grilla sin desbordar.
function formatMonedaCompacta(monto: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(monto)
}

// ── Tipos ──────────────────────────────────────────────
interface Oportunidad {
  id: string
  persona_id: string
  tipo: string
  fuente: string
  descripcion: string | null
  estado: string
  fecha_proximo_contacto: string | null
  monto_estimado: number | null
  probabilidad_cierre: number | null
  created_at: string
  updated_at: string
  persona: { id: string; apellido: string; nombre: string | null; dni_cuil: string }
}

interface DeteccionSinPoliza {
  id: string; apellido: string; nombre: string | null; dni_cuil: string
  ultima_poliza: { numero_poliza: string; fecha_fin: string; compania: { nombre: string } | null; ramo: { nombre: string } | null } | null
}

interface DeteccionCancelacion {
  poliza_id: string; numero_poliza: string; fecha_baja: string; motivo_baja: string | null
  persona: { id: string; apellido: string; nombre: string | null }
  compania: { nombre: string } | null; ramo: { nombre: string } | null
}

interface DeteccionCrossSell {
  persona: { id: string; apellido: string; nombre: string | null }
  poliza_id: string; numero_poliza: string
  compania: { nombre: string } | null; ramo: { nombre: string; metadata: any } | null
  sugerencia: string
}

// ── Constantes ─────────────────────────────────────────
const TIPO_BADGE: Record<string, { label: string; color: string }> = {
  CROSS_SELL:   { label: 'Cross-sell',    color: 'bg-violet-50 text-violet-700 border-violet-200' },
  RECUPERACION: { label: 'Recuperación',  color: 'bg-orange-50 text-orange-700 border-orange-200' },
  NUEVA_VENTA:  { label: 'Nueva venta',   color: 'bg-blue-50 text-blue-700 border-blue-200' },
}

const FUENTE_BADGE: Record<string, { label: string; color: string }> = {
  AUTOMATICA: { label: 'Automática', color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  MANUAL:     { label: 'Manual',     color: 'bg-slate-100 text-slate-600 border-slate-200' },
}

const ESTADO_BADGE: Record<string, { label: string; color: string }> = {
  DETECTADA:   { label: 'Detectada',   color: 'bg-slate-100 text-slate-600 border-slate-200' },
  CONTACTADO:  { label: 'Contactado',  color: 'bg-amber-50 text-amber-700 border-amber-200' },
  NEGOCIACION: { label: 'Negociación', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  GANADA:      { label: 'Ganada',      color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PERDIDA:     { label: 'Perdida',     color: 'bg-red-50 text-red-700 border-red-200' },
}

function diasDesde(fecha: string): number {
  return Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000)
}

function diasDesdeLabel(fecha: string): string {
  const d = diasDesde(fecha)
  if (d === 0) return 'hoy'
  if (d === 1) return 'hace 1 día'
  return `hace ${d} días`
}

function proximoContactoLabel(fecha: string | null) {
  if (!fecha) return { text: '—', color: '' }
  const hoy = hoyLocal()
  const f = fecha.split('T')[0]
  if (f < hoy) {
    const d = diasDesde(fecha)
    return { text: `Vencido hace ${d}d`, color: 'text-red-600 font-semibold' }
  }
  if (f === hoy) return { text: 'Hoy', color: 'text-amber-600 font-semibold' }
  return { text: formatFechaLocalLarga(fecha), color: '' }
}

function nombrePersona(p: { apellido: string; nombre: string | null }) {
  return [p.apellido, p.nombre].filter(Boolean).join(', ')
}

export default function OportunidadesPage() {
  const router    = useRouter()
  const supabase  = getSupabaseClient()
  const searchRef = useRef<NodeJS.Timeout>()
  const { usuario } = useAuth()

  const [tab, setTab] = useState<'mis' | 'detectadas'>('mis')

  // Tab 1 state
  const [oportunidades, setOportunidades] = useState<Oportunidad[]>([])
  const [cargando,      setCargando]      = useState(true)
  const [errorCarga,    setErrorCarga]    = useState<{ codigo?: string; mensaje: string } | null>(null)
  const [total,         setTotal]         = useState(0)
  const [pagina,        setPagina]        = useState(0)
  const POR_PAGINA = 25

  const [busqueda,         setBusqueda]         = useState('')
  const [busquedaDebounce, setBusquedaDebounce] = useState('')
  const [filtroEstado,     setFiltroEstado]     = useState('')
  const [filtroTipo,       setFiltroTipo]       = useState('')
  const [filtroFuente,     setFiltroFuente]     = useState('')

  const [kpis, setKpis] = useState({ activas: 0, negociacion: 0, ganadasMes: 0, perdidasMes: 0, detectadas: 0, pipelineActivo: 0 })

  // IDs de personas accesibles (excluye papelera). null = acceso total.
  // papeleraIds se aplica adicionalmente para cubrir el caso TOTAL, donde
  // idsPersonas=null no filtra papelera por sí solo.
  const [idsPersonas, setIdsPersonas] = useState<string[] | null>(null)
  const [papeleraIds, setPapeleraIds] = useState<string[]>([])
  const [idsPersonasCargados, setIdsPersonasCargados] = useState(false)

  useEffect(() => {
    if (!usuario) return
    Promise.all([
      obtenerIdsPersonas(supabase, usuario),
      obtenerIdsPapelera(supabase),
    ]).then(([ids, papelera]) => {
      setIdsPersonas(ids)
      setPapeleraIds(papelera)
      setIdsPersonasCargados(true)
    })
  }, [supabase, usuario])

  // Tab 2 state
  const [sinPoliza,       setSinPoliza]       = useState<DeteccionSinPoliza[]>([])
  const [cancelaciones,   setCancelaciones]   = useState<DeteccionCancelacion[]>([])
  const [crossSell,       setCrossSell]       = useState<DeteccionCrossSell[]>([])
  const [cargandoDet,     setCargandoDet]     = useState(false)
  const [verTodosSP,      setVerTodosSP]      = useState(false)
  const [verTodosCanc,    setVerTodosCanc]    = useState(false)
  const [verTodosCS,      setVerTodosCS]      = useState(false)
  const [creandoOp,       setCreandoOp]       = useState<string | null>(null)
  // Bumpea para forzar el re-fetch de KPIs después de crear/eliminar oportunidades.
  const [kpisVersion,     setKpisVersion]     = useState(0)

  useEffect(() => {
    clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => { setBusquedaDebounce(busqueda); setPagina(0) }, 350)
  }, [busqueda])

  // KPIs
  useEffect(() => {
    if (!idsPersonasCargados) return
    async function cargarKpis() {
      const primerDiaMes = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`
      const buildKpi = (q: any) => excluirPersonasEnPapelera(filtrarPorPersonas(q, idsPersonas, 'persona_id'), papeleraIds, 'persona_id')
      const [act, neg, gan, per] = await Promise.all([
        buildKpi(supabase.from('oportunidades').select('id', { count: 'exact', head: true }).not('estado', 'in', '("GANADA","PERDIDA")')),
        buildKpi(supabase.from('oportunidades').select('id', { count: 'exact', head: true }).eq('estado', 'NEGOCIACION')),
        buildKpi(supabase.from('oportunidades').select('id', { count: 'exact', head: true }).eq('estado', 'GANADA').gte('updated_at', primerDiaMes)),
        buildKpi(supabase.from('oportunidades').select('id', { count: 'exact', head: true }).eq('estado', 'PERDIDA').gte('updated_at', primerDiaMes)),
      ])
      // Pipeline activo: sum of monto_estimado * probabilidad_cierre/100 for DETECTADA/CONTACTADO/NEGOCIACION
      const { data: pipelineData } = await buildKpi(
        supabase.from('oportunidades').select('monto_estimado, probabilidad_cierre').in('estado', ['DETECTADA', 'CONTACTADO', 'NEGOCIACION'])
      )
      const pipelineActivo = ((pipelineData ?? []) as any[]).reduce((acc, o) => {
        const m = Number(o.monto_estimado ?? 0)
        const p = Number(o.probabilidad_cierre ?? 0)
        return acc + (m * p / 100)
      }, 0)
      setKpis(k => ({ ...k, activas: act.count ?? 0, negociacion: neg.count ?? 0, ganadasMes: gan.count ?? 0, perdidasMes: per.count ?? 0, pipelineActivo }))
    }
    cargarKpis()
  }, [supabase, idsPersonas, papeleraIds, idsPersonasCargados, kpisVersion])

  // Cargar oportunidades (Tab 1)
  const cargarOportunidades = useCallback(async (silencioso: boolean = false) => {
    if (!idsPersonasCargados) return
    if (!silencioso) setCargando(true)
    setErrorCarga(null)

    let personaIds: string[] = []
    const safeBusq = sanitizarBusquedaNormalizada(busquedaDebounce)
    if (safeBusq) {
      const { data: pers } = await supabase
        .from('personas')
        .select('id')
        .is('deleted_at', null)
        .or(`apellido_norm.ilike.%${safeBusq}%,nombre_norm.ilike.%${safeBusq}%,dni_cuil.ilike.%${safeBusq}%`)
      personaIds = (pers ?? []).map((p: any) => p.id)
    }

    let query = excluirPersonasEnPapelera(
      filtrarPorPersonas(supabase
        .from('oportunidades')
        .select(`
          id, persona_id, tipo, fuente, descripcion, estado,
          fecha_proximo_contacto, monto_estimado, probabilidad_cierre, created_at, updated_at,
          persona:personas!persona_id (id, apellido, nombre, dni_cuil)
        `, { count: 'exact' }), idsPersonas, 'persona_id'),
      papeleraIds, 'persona_id'
    )

    if (filtroEstado) query = query.eq('estado', filtroEstado)
    if (filtroTipo)   query = query.eq('tipo', filtroTipo)
    if (filtroFuente) query = query.eq('fuente', filtroFuente)

    if (safeBusq) {
      if (personaIds.length > 0) {
        query = query.in('persona_id', personaIds)
      } else {
        // No hay matches, forzar vacío
        query = query.eq('persona_id', '00000000-0000-0000-0000-000000000000')
      }
    }

    query = query
      .order('created_at', { ascending: false })
      .range(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA - 1)

    const { data, count, error } = await query
    if (error) {
      setErrorCarga({ mensaje: error.message ?? 'No se pudieron cargar las oportunidades.' })
    } else {
      setOportunidades((data ?? []) as unknown as Oportunidad[])
      setTotal(count ?? 0)
    }
    setCargando(false)
  }, [supabase, filtroEstado, filtroTipo, filtroFuente, busquedaDebounce, pagina, idsPersonas, papeleraIds, idsPersonasCargados])

  useEffect(() => { cargarOportunidades() }, [cargarOportunidades])

  // Realtime: cualquier cambio en oportunidades refresca listado + KPIs
  // (kpisVersion se bumpea para que el useEffect de KPIs también corra).
  useRealtimeRefresh({
    tablas: ['oportunidades'],
    onCambio: () => { cargarOportunidades(true); setKpisVersion(v => v + 1) },
  })

  // Cargar detecciones (Tab 2)
  const cargarDetecciones = useCallback(async () => {
    setCargandoDet(true)

    // Get persona IDs accessible by this user for filtering detecciones
    const idsPersonasAccesibles = await obtenerIdsPersonas(supabase, usuario)

    // IDs de personas con oportunidad activa por tipo
    const { data: opsActivas } = await excluirPersonasEnPapelera(
      filtrarPorPersonas(supabase
        .from('oportunidades')
        .select('persona_id, tipo')
        .not('estado', 'in', '("GANADA","PERDIDA")'), idsPersonasAccesibles, 'persona_id'),
      papeleraIds, 'persona_id'
    )

    const opsActivasList = (opsActivas ?? []) as { persona_id: string; tipo: string }[]
    const recuperacionIds = new Set(opsActivasList.filter(o => o.tipo === 'RECUPERACION').map(o => o.persona_id))
    const crossSellIds = new Set(opsActivasList.filter(o => o.tipo === 'CROSS_SELL').map(o => o.persona_id))

    // 1. Clientes sin póliza vigente (que tuvieron póliza alguna vez).
    // Excluimos personas en papelera explícitamente: para PROPIA, los IDs
    // accesibles ya las excluyen; pero para TOTAL (idsPersonasAccesibles
    // null) ningún filtro de cartera aplica y tendríamos que filtrar acá.
    let qPersonasActivas = supabase
      .from('personas')
      .select('id, apellido, nombre, dni_cuil')
      .eq('estado', 'ACTIVO')
      .is('deleted_at', null)
    if (idsPersonasAccesibles !== null) {
      if (idsPersonasAccesibles.length > 0) {
        qPersonasActivas = qPersonasActivas.in('id', idsPersonasAccesibles)
      } else {
        qPersonasActivas = qPersonasActivas.in('id', ['00000000-0000-0000-0000-000000000000'])
      }
    }
    const { data: personasActivas } = await qPersonasActivas

    const personasActivasList = (personasActivas ?? []) as { id: string; apellido: string; nombre: string | null; dni_cuil: string }[]

    let sinPolizaResult: DeteccionSinPoliza[] = []
    if (personasActivasList.length > 0) {
      const pIds = personasActivasList.map(p => p.id)

      // Pólizas vigentes por persona
      const { data: polVigentes } = await supabase
        .from('polizas')
        .select('asegurado_id')
        .eq('estado', 'VIGENTE')
        .in('asegurado_id', pIds)
      const conVigenteSet = new Set((polVigentes ?? []).map((p: any) => p.asegurado_id))

      // Personas sin vigente
      const sinVigente = personasActivasList.filter(p => !conVigenteSet.has(p.id) && !recuperacionIds.has(p.id))

      // Última póliza de TODAS las personas sin vigente en una sola query
      // (antes hacíamos un query por persona — N+1). Tomamos la primera por
      // asegurado_id, ya ordenado fecha_fin DESC.
      if (sinVigente.length > 0) {
        const sinVigenteIds = sinVigente.map(p => p.id)
        const { data: todasPolizas } = await supabase
          .from('polizas')
          .select('asegurado_id, numero_poliza, fecha_fin, compania:catalogos!compania_id(nombre), ramo:catalogos!ramo_id(nombre)')
          .in('asegurado_id', sinVigenteIds)
          .order('fecha_fin', { ascending: false })

        const ultimaPorPersona = new Map<string, any>()
        for (const pol of (todasPolizas ?? []) as any[]) {
          if (!ultimaPorPersona.has(pol.asegurado_id)) {
            ultimaPorPersona.set(pol.asegurado_id, pol)
          }
        }

        for (const persona of sinVigente) {
          const ult = ultimaPorPersona.get(persona.id)
          if (ult) {
            sinPolizaResult.push({
              ...persona,
              ultima_poliza: {
                numero_poliza: ult.numero_poliza,
                fecha_fin: ult.fecha_fin,
                compania: ult.compania,
                ramo: ult.ramo,
              } as any,
            })
          }
        }
      }
      sinPolizaResult.sort((a, b) => (b.ultima_poliza?.fecha_fin ?? '').localeCompare(a.ultima_poliza?.fecha_fin ?? ''))
      sinPolizaResult = sinPolizaResult.slice(0, 20)
    }
    setSinPoliza(sinPolizaResult)

    // 2. Cancelaciones recientes (últimos 6 meses)
    const hace6m = new Date()
    hace6m.setMonth(hace6m.getMonth() - 6)
    const hace6mStr = hace6m.toISOString().split('T')[0]

    let qCanceladas = supabase
      .from('polizas')
      .select(`
        id, numero_poliza, fecha_baja, motivo_baja, asegurado_id,
        persona:personas!asegurado_id (id, apellido, nombre),
        compania:catalogos!compania_id (nombre),
        ramo:catalogos!ramo_id (nombre)
      `)
      .in('estado', ['CANCELADA', 'ANULADA'])
      .gte('fecha_baja', hace6mStr)
      .order('fecha_baja', { ascending: false })
      .limit(30)
    // Excluimos pólizas de personas en papelera (TOTAL ve todo si no
    // filtramos; PROPIA ya estaría limitado por su scope).
    if (papeleraIds.length > 0) {
      qCanceladas = qCanceladas.not('asegurado_id', 'in', `(${papeleraIds.join(',')})`)
    }
    const { data: polCanceladas } = await qCanceladas

    // En vez de un COUNT por persona (N+1), traemos en una sola query los
    // asegurado_id que tienen al menos una póliza VIGENTE entre todos los
    // candidatos, y filtramos en JS.
    const cancResult: DeteccionCancelacion[] = []
    const candidatos = ((polCanceladas ?? []) as any[]).filter(pol => {
      const personaId = pol.persona?.id
      return personaId && !recuperacionIds.has(personaId)
    })

    let personaIdsConVigente = new Set<string>()
    if (candidatos.length > 0) {
      const candidatosPersonaIds = Array.from(new Set(candidatos.map(p => p.persona.id)))
      const { data: vigentes } = await supabase
        .from('polizas')
        .select('asegurado_id')
        .eq('estado', 'VIGENTE')
        .in('asegurado_id', candidatosPersonaIds)
      personaIdsConVigente = new Set((vigentes ?? []).map((v: any) => v.asegurado_id))
    }

    for (const pol of candidatos) {
      if (personaIdsConVigente.has(pol.persona.id)) continue
      cancResult.push({
        poliza_id: pol.id,
        numero_poliza: pol.numero_poliza,
        fecha_baja: pol.fecha_baja,
        motivo_baja: pol.motivo_baja,
        persona: pol.persona,
        compania: pol.compania,
        ramo: pol.ramo,
      })
      if (cancResult.length >= 20) break
    }
    setCancelaciones(cancResult)

    // 3. Cross-sell (1 sola póliza vigente)
    let qVigentesAll = supabase
      .from('polizas')
      .select(`
        id, numero_poliza, asegurado_id,
        persona:personas!asegurado_id (id, apellido, nombre),
        compania:catalogos!compania_id (nombre),
        ramo:catalogos!ramo_id (nombre, metadata)
      `)
      .eq('estado', 'VIGENTE')
    if (papeleraIds.length > 0) {
      qVigentesAll = qVigentesAll.not('asegurado_id', 'in', `(${papeleraIds.join(',')})`)
    }
    const { data: polVigentesAll } = await qVigentesAll

    // Agrupar por persona
    const porPersona: Record<string, any[]> = {}
    for (const pol of (polVigentesAll ?? []) as any[]) {
      const pid = pol.asegurado_id
      if (!porPersona[pid]) porPersona[pid] = []
      porPersona[pid].push(pol)
    }

    const csResult: DeteccionCrossSell[] = []
    for (const [pid, pols] of Object.entries(porPersona)) {
      if (pols.length !== 1) continue
      if (crossSellIds.has(pid)) continue
      const pol = pols[0]
      const tipoRiesgo = (pol.ramo?.metadata as any)?.tipo_riesgo ?? ''
      let sugerencia = 'Ofrecer producto complementario'
      if (tipoRiesgo === 'automotor') sugerencia = 'Ofrecer seguro de hogar'
      else if (tipoRiesgo === 'hogar') sugerencia = 'Ofrecer seguro de automotor'

      csResult.push({
        persona: pol.persona,
        poliza_id: pol.id,
        numero_poliza: pol.numero_poliza,
        compania: pol.compania,
        ramo: pol.ramo,
        sugerencia,
      })
      if (csResult.length >= 20) break
    }
    setCrossSell(csResult)

    // KPI detectadas
    setKpis(k => ({ ...k, detectadas: sinPolizaResult.length + cancResult.length + csResult.length }))

    setCargandoDet(false)
  }, [supabase, usuario, papeleraIds])

  useEffect(() => {
    if (tab === 'detectadas' && idsPersonasCargados) cargarDetecciones()
  }, [tab, cargarDetecciones, idsPersonasCargados])

  // Crear oportunidad desde detección
  const crearOportunidad = async (personaId: string, tipo: string, descripcion: string) => {
    setCreandoOp(personaId + tipo)
    const { error } = await supabase.from('oportunidades').insert({
      persona_id: personaId,
      tipo,
      fuente: 'AUTOMATICA',
      estado: 'DETECTADA',
      descripcion,
      usuario_id: usuario?.id ?? null,
    })
    setCreandoOp(null)
    if (error) {
      toast.error({ mensaje: `No se pudo crear la oportunidad: ${error.message}` })
      return
    }
    toast.exito('Oportunidad creada')
    // Refrescar todo: detecciones, listado de "Mis oportunidades" y KPIs.
    setKpisVersion(v => v + 1)
    await Promise.all([cargarDetecciones(), cargarOportunidades()])
  }

  const eliminar = async (e: React.MouseEvent, op: Oportunidad) => {
    e.stopPropagation()
    if (!confirm('¿Eliminar esta oportunidad y todas sus interacciones?')) return
    // FK interacciones.oportunidad_id tiene ON DELETE CASCADE.
    const { error } = await supabase.from('oportunidades').delete().eq('id', op.id)
    if (error) {
      toast.error({ mensaje: `No se pudo eliminar: ${error.message}` })
      return
    }
    toast.exito('Oportunidad eliminada')
    setKpisVersion(v => v + 1)
    cargarOportunidades()
  }

  const limpiarFiltros = () => { setBusqueda(''); setFiltroEstado(''); setFiltroTipo(''); setFiltroFuente(''); setPagina(0) }
  const hayFiltros = busqueda || filtroEstado || filtroTipo || filtroFuente

  return (
    <div className="flex flex-col gap-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Oportunidades de venta</h1>
          <p className="text-xs text-slate-600">Detectá y gestioná oportunidades en tu cartera</p>
        </div>
        <button onClick={() => router.push('/crm/comercial/oportunidades/nueva')} className="btn-primary">
          <Plus className="h-3.5 w-3.5"/> Nueva oportunidad
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-6 gap-2">
        <div className="kpi-card bg-blue-50 border border-blue-200">
          <span className="kpi-label flex items-center gap-1"><Target className="h-3 w-3 text-blue-600"/> Activas</span>
          <span className="kpi-value text-blue-700">{kpis.activas}</span>
          <span className="kpi-sub">en seguimiento</span>
        </div>
        <div className="kpi-card bg-emerald-50 border border-emerald-200">
          <span className="kpi-label flex items-center gap-1"><DollarSign className="h-3 w-3 text-emerald-600"/> Pipeline activo</span>
          <span className="kpi-value text-emerald-700" title={formatMoneda(kpis.pipelineActivo)}>
            {formatMonedaCompacta(kpis.pipelineActivo)}
          </span>
          <span className="kpi-sub">valor esperado</span>
        </div>
        <div className="kpi-card bg-amber-50 border border-amber-200">
          <span className="kpi-label flex items-center gap-1"><MessageSquare className="h-3 w-3 text-amber-600"/> En negociación</span>
          <span className="kpi-value text-amber-700">{kpis.negociacion}</span>
          <span className="kpi-sub">avanzando</span>
        </div>
        <div className="kpi-card bg-emerald-50 border border-emerald-200">
          <span className="kpi-label flex items-center gap-1"><Trophy className="h-3 w-3 text-emerald-600"/> Ganadas este mes</span>
          <span className="kpi-value text-emerald-700">{kpis.ganadasMes}</span>
          <span className="kpi-sub">convertidas en venta</span>
        </div>
        <div className="kpi-card bg-red-50 border border-red-200">
          <span className="kpi-label flex items-center gap-1"><XCircle className="h-3 w-3 text-red-600"/> Perdidas este mes</span>
          <span className="kpi-value text-red-700">{kpis.perdidasMes}</span>
          <span className="kpi-sub">no avanzaron</span>
        </div>
        <div className="kpi-card bg-violet-50 border border-violet-200">
          <span className="kpi-label flex items-center gap-1"><Lightbulb className="h-3 w-3 text-violet-600"/> Detectadas</span>
          <span className="kpi-value text-violet-700">{kpis.detectadas}</span>
          <span className="kpi-sub">sugerencias del sistema</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded w-fit">
        <button onClick={() => setTab('mis')}
          className={`px-3 py-1.5 text-xs rounded transition-all ${tab === 'mis' ? 'bg-white shadow-sm font-medium text-slate-700' : 'text-slate-600 hover:text-slate-700'}`}>
          Mis oportunidades
        </button>
        <button onClick={() => setTab('detectadas')}
          className={`px-3 py-1.5 text-xs rounded transition-all flex items-center gap-1.5 ${tab === 'detectadas' ? 'bg-white shadow-sm font-medium text-slate-700' : 'text-slate-600 hover:text-slate-700'}`}>
          Oportunidades detectadas
          {kpis.detectadas > 0 && (
            <span className="flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-violet-500 text-white text-2xs font-bold leading-none">
              {kpis.detectadas}
            </span>
          )}
        </button>
      </div>

      {/* TAB 1: Mis oportunidades */}
      {tab === 'mis' && (
        <>
          {/* Filtros */}
          <div className="bg-white border border-slate-200 rounded p-2 flex items-center gap-2">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500"/>
              <input className="search-input w-full pl-6" placeholder="Buscar por nombre del cliente..."
                value={busqueda} onChange={e => setBusqueda(e.target.value)}/>
            </div>
            <select className="form-input" value={filtroEstado} onChange={e => { setFiltroEstado(e.target.value); setPagina(0) }}>
              <option value="">Todos los estados</option>
              <option value="DETECTADA">Detectada</option>
              <option value="CONTACTADO">Contactado</option>
              <option value="NEGOCIACION">Negociación</option>
              <option value="GANADA">Ganada</option>
              <option value="PERDIDA">Perdida</option>
            </select>
            <select className="form-input" value={filtroTipo} onChange={e => { setFiltroTipo(e.target.value); setPagina(0) }}>
              <option value="">Todos los tipos</option>
              <option value="CROSS_SELL">Cross-sell</option>
              <option value="RECUPERACION">Recuperación</option>
              <option value="NUEVA_VENTA">Nueva venta</option>
            </select>
            <select className="form-input" value={filtroFuente} onChange={e => { setFiltroFuente(e.target.value); setPagina(0) }}>
              <option value="">Todas las fuentes</option>
              <option value="AUTOMATICA">Automática</option>
              <option value="MANUAL">Manual</option>
            </select>
            {hayFiltros && (
              <button onClick={limpiarFiltros} className="btn-secondary flex items-center gap-1">
                <X className="h-3.5 w-3.5"/> Limpiar
              </button>
            )}
          </div>

          {/* Tabla */}
          <EstadoCarga
            loading={cargando}
            error={errorCarga}
            empty={!cargando && !errorCarga && oportunidades.length === 0}
            emptyMensaje={hayFiltros ? 'No hay oportunidades con esos filtros.' : 'No hay oportunidades registradas. Revisá la pestaña "Oportunidades detectadas" para ver sugerencias del sistema.'}
            onReintentar={cargarOportunidades}
          >
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Tipo</th>
                  <th>Fuente</th>
                  <th>Estado</th>
                  <th className="text-right">Monto</th>
                  <th>Próximo contacto</th>
                  <th>Antigüedad</th>
                  <th style={{ width: 50 }}>Acc.</th>
                </tr>
              </thead>
              <tbody>
                {oportunidades.map(op => {
                  const tb = TIPO_BADGE[op.tipo] ?? TIPO_BADGE.NUEVA_VENTA
                  const fb = FUENTE_BADGE[op.fuente] ?? FUENTE_BADGE.MANUAL
                  const eb = ESTADO_BADGE[op.estado] ?? ESTADO_BADGE.DETECTADA
                  const pc = proximoContactoLabel(op.fecha_proximo_contacto)
                  const antiguedad = diasDesde(op.created_at)
                  const estancada = antiguedad > 15 && !['GANADA', 'PERDIDA'].includes(op.estado)
                  const cerrada = op.estado === 'GANADA' || op.estado === 'PERDIDA'

                  return (
                    <tr key={op.id} className={`cursor-pointer hover:bg-slate-50 ${cerrada ? 'opacity-55' : ''}`}
                      onClick={() => router.push(`/crm/comercial/oportunidades/${op.id}`)}>
                      <td>
                        <span className="text-xs font-medium text-slate-700">{nombrePersona(op.persona)}</span>
                        <p className="text-2xs text-slate-600 font-mono">{op.persona.dni_cuil}</p>
                      </td>
                      <td><span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${tb.color}`}>{tb.label}</span></td>
                      <td><span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${fb.color}`}>{fb.label}</span></td>
                      <td><span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${eb.color}`}>{eb.label}</span></td>
                      <td className="text-right font-mono text-xs text-slate-700">
                        {op.monto_estimado != null ? formatMoneda(op.monto_estimado) : <span className="text-slate-300">—</span>}
                      </td>
                      <td><span className={`text-xs ${pc.color}`}>{pc.text}</span></td>
                      <td>
                        <span className="text-xs text-slate-600">{diasDesdeLabel(op.created_at)}</span>
                        {estancada && (
                          <span className="ml-1 text-2xs font-semibold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">Estancada</span>
                        )}
                      </td>
                      <td>
                        {puedeEliminar(usuario) && (
                        <button onClick={(e) => eliminar(e, op)}
                          className="btn-tabla-accion-danger" title="Eliminar">
                          <Trash2 />
                        </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </EstadoCarga>

          {/* Paginación */}
          {Math.ceil(total / POR_PAGINA) > 1 && (
            <div className="flex items-center justify-between text-xs text-slate-600 pb-2">
              <span>Mostrando {pagina * POR_PAGINA + 1}–{Math.min((pagina + 1) * POR_PAGINA, total)} de {total}</span>
              <div className="flex gap-1">
                <button onClick={() => setPagina(p => Math.max(0, p - 1))} disabled={pagina === 0} className="btn-secondary px-3">← Anterior</button>
                <button onClick={() => setPagina(p => Math.min(Math.ceil(total / POR_PAGINA) - 1, p + 1))} disabled={pagina >= Math.ceil(total / POR_PAGINA) - 1} className="btn-secondary px-3">Siguiente →</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* TAB 2: Oportunidades detectadas */}
      {tab === 'detectadas' && (
        <div className="flex flex-col gap-3">
          {cargandoDet ? (
            <div className="flex items-center justify-center py-16 text-slate-500 text-xs gap-2">
              <Loader2 className="h-4 w-4 animate-spin"/> Analizando cartera...
            </div>
          ) : (
            <>
              {/* Sin póliza vigente */}
              <DeteccionCard
                icon={<UserMinus className="h-4 w-4 text-orange-500"/>}
                titulo="Clientes sin póliza vigente"
                subtitulo="Clientes activos que tuvieron póliza pero ya no tienen ninguna vigente"
                items={sinPoliza}
                verTodos={verTodosSP}
                onToggleVerTodos={() => setVerTodosSP(v => !v)}
                renderItem={(item) => (
                  <div className="flex items-center justify-between py-2 px-3 border-b border-slate-50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <button onClick={() => router.push(`/crm/personas/${item.id}`)}
                        className="text-xs font-medium text-blue-600 hover:underline">{nombrePersona(item)}</button>
                      {item.ultima_poliza && (
                        <p className="text-2xs text-slate-600">
                          <span className="font-mono">{item.ultima_poliza.numero_poliza}</span>
                          {' · '}{item.ultima_poliza.compania?.nombre} · {item.ultima_poliza.ramo?.nombre}
                          {' · '}Venció {diasDesdeLabel(item.ultima_poliza.fecha_fin)}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => crearOportunidad(item.id, 'RECUPERACION', `Recuperar cliente — última póliza: ${item.ultima_poliza?.numero_poliza ?? 'N/A'}`)}
                      disabled={creandoOp === item.id + 'RECUPERACION'}
                      className="btn-primary text-2xs py-1 px-2 shrink-0 ml-2">
                      {creandoOp === item.id + 'RECUPERACION' ? <Loader2 className="h-3 w-3 animate-spin"/> : <Plus className="h-3 w-3"/>}
                      Crear oportunidad
                    </button>
                  </div>
                )}
              />

              {/* Cancelaciones recientes */}
              <DeteccionCard
                icon={<Ban className="h-4 w-4 text-red-500"/>}
                titulo="Cancelaciones recientes"
                subtitulo="Pólizas canceladas o anuladas en los últimos 6 meses sin reemplazo"
                items={cancelaciones}
                verTodos={verTodosCanc}
                onToggleVerTodos={() => setVerTodosCanc(v => !v)}
                renderItem={(item) => (
                  <div className="flex items-center justify-between py-2 px-3 border-b border-slate-50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <button onClick={() => router.push(`/crm/personas/${item.persona.id}`)}
                        className="text-xs font-medium text-blue-600 hover:underline">{nombrePersona(item.persona)}</button>
                      <p className="text-2xs text-slate-600">
                        <span className="font-mono">{item.numero_poliza}</span>
                        {' · '}{item.compania?.nombre} · {item.ramo?.nombre}
                        {item.motivo_baja && ` · ${item.motivo_baja}`}
                        {' · '}Cancelada {diasDesdeLabel(item.fecha_baja)}
                      </p>
                    </div>
                    <button
                      onClick={() => crearOportunidad(item.persona.id, 'RECUPERACION', `Recuperar — póliza ${item.numero_poliza} cancelada`)}
                      disabled={creandoOp === item.persona.id + 'RECUPERACION'}
                      className="btn-primary text-2xs py-1 px-2 shrink-0 ml-2">
                      {creandoOp === item.persona.id + 'RECUPERACION' ? <Loader2 className="h-3 w-3 animate-spin"/> : <Plus className="h-3 w-3"/>}
                      Crear oportunidad
                    </button>
                  </div>
                )}
              />

              {/* Cross-sell */}
              <DeteccionCard
                icon={<Repeat className="h-4 w-4 text-violet-500"/>}
                titulo="Venta cruzada (Cross-sell)"
                subtitulo="Clientes con una sola póliza vigente — oportunidad de ampliar cobertura"
                items={crossSell}
                verTodos={verTodosCS}
                onToggleVerTodos={() => setVerTodosCS(v => !v)}
                renderItem={(item) => (
                  <div className="flex items-center justify-between py-2 px-3 border-b border-slate-50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <button onClick={() => router.push(`/crm/personas/${item.persona.id}`)}
                        className="text-xs font-medium text-blue-600 hover:underline">{nombrePersona(item.persona)}</button>
                      <p className="text-2xs text-slate-600">
                        <span className="font-mono">{item.numero_poliza}</span>
                        {' · '}{item.compania?.nombre} · {item.ramo?.nombre}
                      </p>
                      <p className="text-2xs text-violet-600 font-medium mt-0.5">{item.sugerencia}</p>
                    </div>
                    <button
                      onClick={() => crearOportunidad(item.persona.id, 'CROSS_SELL', item.sugerencia)}
                      disabled={creandoOp === item.persona.id + 'CROSS_SELL'}
                      className="btn-primary text-2xs py-1 px-2 shrink-0 ml-2">
                      {creandoOp === item.persona.id + 'CROSS_SELL' ? <Loader2 className="h-3 w-3 animate-spin"/> : <Plus className="h-3 w-3"/>}
                      Crear oportunidad
                    </button>
                  </div>
                )}
              />

              {sinPoliza.length === 0 && cancelaciones.length === 0 && crossSell.length === 0 && (
                <div className="flex flex-col items-center py-16 gap-2 text-slate-500">
                  <CheckCircle className="h-8 w-8 text-emerald-300"/>
                  <p className="text-xs">No se detectaron oportunidades nuevas. Tu cartera está bien cubierta.</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Componente reutilizable para cards de detección ────
function DeteccionCard<T>({ icon, titulo, subtitulo, items, verTodos, onToggleVerTodos, renderItem }: {
  icon: React.ReactNode
  titulo: string
  subtitulo: string
  items: T[]
  verTodos: boolean
  onToggleVerTodos: () => void
  renderItem: (item: T) => React.ReactNode
}) {
  if (items.length === 0) return null
  const visibles = verTodos ? items : items.slice(0, 10)

  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <h3 className="text-xs font-semibold text-slate-700">{titulo}</h3>
            <p className="text-2xs text-slate-600">{subtitulo}</p>
          </div>
        </div>
        <span className="text-2xs text-slate-600 font-mono">{items.length} encontrados</span>
      </div>
      <div>
        {visibles.map((item, i) => <div key={i}>{renderItem(item)}</div>)}
      </div>
      {items.length > 10 && (
        <button onClick={onToggleVerTodos}
          className="w-full py-2 text-2xs text-blue-600 hover:bg-blue-50 transition-colors flex items-center justify-center gap-1 border-t border-slate-100">
          {verTodos ? <><ChevronUp className="h-3 w-3"/> Mostrar menos</> : <><ChevronDown className="h-3 w-3"/> Ver todos ({items.length})</>}
        </button>
      )}
    </div>
  )
}
