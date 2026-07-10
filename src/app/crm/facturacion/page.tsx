'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  DollarSign, Plus, Pencil, Trash2, X, BarChart3,
  TrendingUp, Calendar, Building2
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { formatMoneda } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { toast } from '@/lib/toast'
import { EstadoCarga } from '@/components/EstadoCarga'
import { useRealtimeRefresh } from '@/lib/hooks/useRealtimeRefresh'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from 'recharts'

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
]
const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

interface Registro {
  id: string
  compania_id: string
  mes: number
  anio: number
  monto: number
  notas: string | null
  compania_nombre: string
}

interface Compania {
  id: string
  nombre: string
}

export default function FacturacionPage() {
  const router = useRouter()
  const supabase = getSupabaseClient()
  const { isAdmin, loading: authLoading } = useAuth()

  // Solo admin puede acceder a facturación
  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.replace('/crm/personas')
    }
  }, [authLoading, isAdmin, router])

  const anioActual = new Date().getFullYear()
  const mesActual = new Date().getMonth() + 1

  const [registros, setRegistros] = useState<Registro[]>([])
  const [companias, setCompanias] = useState<Compania[]>([])
  const [aniosDisponibles, setAniosDisponibles] = useState<number[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<{ codigo?: string; mensaje: string } | null>(null)
  // Set de IDs en proceso de borrado, para deshabilitar el botón mientras corre.
  const [eliminandoIds, setEliminandoIds] = useState<Set<string>>(new Set())

  const [filtroAnio, setFiltroAnio] = useState(anioActual)
  const [filtroCompania, setFiltroCompania] = useState('')

  const [kpis, setKpis] = useState({ totalAnio: 0, totalMes: 0, promedioMensual: 0, companiasActivas: 0 })

  // Modal
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [formCompania, setFormCompania] = useState('')
  const [formMes, setFormMes] = useState(mesActual)
  const [formAnio, setFormAnio] = useState(anioActual)
  const [formMonto, setFormMonto] = useState('')
  const [formNotas, setFormNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [errorModal, setErrorModal] = useState('')

  // Cargar compañías
  useEffect(() => {
    async function cargar() {
      const { data: tipos } = await supabase.from('tipo_catalogo').select('id, codigo')
      if (!tipos) return
      const tipoComp = tipos.find((t: any) => t.codigo === 'COMPANIA')
      if (!tipoComp) return
      const { data: comps } = await supabase
        .from('catalogos')
        .select('id, nombre')
        .eq('tipo_id', tipoComp.id)
        .eq('activo', true)
        .order('nombre')
      setCompanias((comps ?? []) as Compania[])
    }
    cargar()
  }, [supabase])

  // Cargar años disponibles
  useEffect(() => {
    async function cargarAnios() {
      const { data } = await supabase
        .from('facturacion')
        .select('anio')
      const anios = new Set<number>([anioActual])
      ;(data ?? []).forEach((r: any) => anios.add(r.anio))
      setAniosDisponibles(Array.from(anios).sort((a, b) => b - a))
    }
    cargarAnios()
  }, [supabase, anioActual])

  // Cargar registros y KPIs
  const cargarDatos = useCallback(async () => {
    setCargando(true)
    setErrorCarga(null)

    // Registros del año seleccionado
    let query = supabase
      .from('facturacion')
      .select('id, compania_id, mes, anio, monto, notas, compania:catalogos!compania_id(nombre)')
      .eq('anio', filtroAnio)

    if (filtroCompania) {
      query = query.eq('compania_id', filtroCompania)
    }

    query = query.order('mes', { ascending: false })

    const { data, error } = await query
    if (error) {
      setErrorCarga({ mensaje: error.message ?? 'No se pudo cargar la facturación.' })
      setCargando(false)
      return
    }
    const mapped = (data ?? []).map((r: any) => ({
      id: r.id,
      compania_id: r.compania_id,
      mes: r.mes,
      anio: r.anio,
      monto: Number(r.monto),
      notas: r.notas,
      compania_nombre: r.compania?.nombre ?? '—',
    }))
    // Ordenar: mes DESC, luego compañía ASC
    mapped.sort((a: Registro, b: Registro) => {
      if (b.mes !== a.mes) return b.mes - a.mes
      return a.compania_nombre.localeCompare(b.compania_nombre)
    })
    setRegistros(mapped)

    // KPIs — alineados con el año filtrado en pantalla y con el filtro de
    // compañía si está activo (antes los KPIs ignoraban el filtro de
    // compañía y mostraban siempre el global, lo cual era inconsistente
    // con la tabla y confundía al PAS).
    let qKpi = supabase
      .from('facturacion')
      .select('mes, monto, compania_id')
      .eq('anio', filtroAnio)
    if (filtroCompania) qKpi = qKpi.eq('compania_id', filtroCompania)
    const { data: kpiData } = await qKpi

    const registrosAnio = (kpiData ?? []) as any[]
    const totalAnio = registrosAnio.reduce((s: number, r: any) => s + Number(r.monto), 0)
    const totalMes = registrosAnio
      .filter((r: any) => r.mes === mesActual)
      .reduce((s: number, r: any) => s + Number(r.monto), 0)
    const mesesConRegistro = new Set(registrosAnio.map((r: any) => r.mes)).size
    const promedioMensual = mesesConRegistro > 0 ? totalAnio / mesesConRegistro : 0
    const companiasActivas = new Set(registrosAnio.map((r: any) => r.compania_id)).size

    setKpis({ totalAnio, totalMes, promedioMensual, companiasActivas })
    setCargando(false)
  }, [supabase, filtroAnio, filtroCompania, mesActual])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  // Realtime: la facturación es admin-only pero multi-admin; cambios se ven al instante.
  useRealtimeRefresh({
    tablas: ['facturacion'],
    onCambio: cargarDatos,
  })

  // Datos del gráfico
  const datosGrafico = MESES_CORTOS.map((nombre, i) => {
    const mesNum = i + 1
    const total = registros
      .filter(r => r.mes === mesNum)
      .reduce((s, r) => s + r.monto, 0)
    return { mes: nombre, monto: total }
  })

  // Abrir modal nuevo
  const abrirModalNuevo = () => {
    setEditandoId(null)
    setFormCompania(companias.length > 0 ? '' : '')
    setFormMes(mesActual)
    setFormAnio(anioActual)
    setFormMonto('')
    setFormNotas('')
    setErrorModal('')
    setModalAbierto(true)
  }

  // Abrir modal edición
  const abrirModalEdicion = (r: Registro) => {
    setEditandoId(r.id)
    setFormCompania(r.compania_id)
    setFormMes(r.mes)
    setFormAnio(r.anio)
    setFormMonto(r.monto.toString())
    setFormNotas(r.notas ?? '')
    setErrorModal('')
    setModalAbierto(true)
  }

  // Guardar
  const guardar = async () => {
    if (!formCompania || !formMonto) return
    setGuardando(true)
    setErrorModal('')

    const monto = parseFloat(formMonto)
    if (isNaN(monto) || monto < 0) {
      setErrorModal('El monto debe ser un número positivo.')
      setGuardando(false)
      return
    }

    if (editandoId) {
      // UPDATE
      const { error } = await supabase
        .from('facturacion')
        .update({ monto, notas: formNotas || null })
        .eq('id', editandoId)
      if (error) {
        setErrorModal('Error al guardar: ' + error.message)
        setGuardando(false)
        return
      }
    } else {
      // Verificar duplicado
      const { data: existente } = await supabase
        .from('facturacion')
        .select('id')
        .eq('compania_id', formCompania)
        .eq('mes', formMes)
        .eq('anio', formAnio)
        .limit(1)

      if (existente && existente.length > 0) {
        const compNombre = companias.find(c => c.id === formCompania)?.nombre ?? ''
        setErrorModal(`Ya existe un registro para ${compNombre} en ${MESES[formMes - 1]} ${formAnio}. Editá el existente.`)
        setGuardando(false)
        return
      }

      // INSERT
      const { error } = await supabase
        .from('facturacion')
        .insert({ compania_id: formCompania, mes: formMes, anio: formAnio, monto, notas: formNotas || null })
      if (error) {
        setErrorModal('Error al guardar: ' + error.message)
        setGuardando(false)
        return
      }
    }

    setGuardando(false)
    setModalAbierto(false)
    // Refrescar años disponibles también
    const { data: aniosData } = await supabase.from('facturacion').select('anio')
    const anios = new Set<number>([anioActual])
    ;(aniosData ?? []).forEach((r: any) => anios.add(r.anio))
    setAniosDisponibles(Array.from(anios).sort((a, b) => b - a))
    cargarDatos()
  }

  // Eliminar
  const eliminar = async (r: Registro) => {
    if (eliminandoIds.has(r.id)) return
    if (!confirm(`¿Eliminar el registro de ${r.compania_nombre} - ${MESES[r.mes - 1]} ${r.anio}?`)) return
    setEliminandoIds(prev => new Set(prev).add(r.id))
    try {
      const { error } = await supabase.from('facturacion').delete().eq('id', r.id)
      if (error) {
        toast.error({ codigo: 'ERR_DB_ESCRITURA', mensaje: 'No se pudo eliminar el registro' })
        return
      }
      toast.exito('Registro eliminado')
      await cargarDatos()
    } catch (err) {
      toast.error('Error inesperado al eliminar')
    } finally {
      setEliminandoIds(prev => {
        const n = new Set(prev)
        n.delete(r.id)
        return n
      })
    }
  }

  const tooltipFormatter = (value: number) => formatMoneda(value)

  return (
    <div className="flex flex-col gap-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Facturación</h1>
          <p className="text-xs text-slate-500">Control de facturación mensual por compañía</p>
        </div>
      </div>

      {/* KPIs — reflejan los filtros activos (año + compañía) */}
      <div className="grid grid-cols-4 gap-2">
        <div className="kpi-card bg-emerald-50 border border-emerald-200">
          <span className="kpi-label flex items-center gap-1">
            <DollarSign className="h-3 w-3 text-emerald-600"/> Total facturado {filtroAnio}
          </span>
          <span className="kpi-value text-emerald-700">{formatMoneda(kpis.totalAnio)}</span>
          <span className="kpi-sub">{filtroCompania ? 'compañía filtrada' : 'todas las compañías'}</span>
        </div>
        <div className="kpi-card bg-blue-50 border border-blue-200">
          <span className="kpi-label flex items-center gap-1">
            <Calendar className="h-3 w-3 text-blue-600"/> Facturado en {MESES[mesActual - 1]}
          </span>
          <span className="kpi-value text-blue-700">{formatMoneda(kpis.totalMes)}</span>
          <span className="kpi-sub">{MESES[mesActual - 1]} {filtroAnio}</span>
        </div>
        <div className="kpi-card bg-amber-50 border border-amber-200">
          <span className="kpi-label flex items-center gap-1">
            <TrendingUp className="h-3 w-3 text-amber-600"/> Promedio mensual
          </span>
          <span className="kpi-value text-amber-700">{formatMoneda(kpis.promedioMensual)}</span>
          <span className="kpi-sub">meses con registros en {filtroAnio}</span>
        </div>
        <div className="kpi-card bg-slate-50 border border-slate-200">
          <span className="kpi-label flex items-center gap-1">
            <Building2 className="h-3 w-3 text-slate-600"/> Compañías activas
          </span>
          <span className="kpi-value text-slate-700">{kpis.companiasActivas}</span>
          <span className="kpi-sub">con facturación en {filtroAnio}</span>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded p-2 flex items-center gap-2">
        <select className="form-input" value={filtroAnio} onChange={e => setFiltroAnio(Number(e.target.value))}>
          {aniosDisponibles.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="form-input" value={filtroCompania} onChange={e => setFiltroCompania(e.target.value)}>
          <option value="">Todas las compañías</option>
          {companias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <button onClick={abrirModalNuevo} className="btn-primary ml-auto">
          <Plus className="h-3 w-3"/> Cargar facturación
        </button>
      </div>

      {/* Gráfico */}
      <div className="bg-white border border-slate-200 rounded p-4">
        <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-1.5">
          <BarChart3 className="h-3.5 w-3.5 text-slate-500"/> Facturación mensual {filtroAnio}
        </h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={datosGrafico} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickFormatter={(v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v.toString()}
            />
            <Tooltip
              formatter={tooltipFormatter}
              labelFormatter={(label: string) => `Mes: ${label}`}
              contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}
            />
            <Bar dataKey="monto" fill="#0f2a4a" radius={[3, 3, 0, 0]} name="Facturado" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Tabla */}
      <EstadoCarga
        loading={cargando}
        error={errorCarga}
        empty={!cargando && !errorCarga && registros.length === 0}
        emptyMensaje={`No hay facturación registrada para ${filtroAnio}. Hacé clic en "Cargar facturación" para empezar.`}
        onReintentar={cargarDatos}
      >
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <table className="crm-table">
          <thead>
            <tr>
              <th>Mes</th>
              <th>Compañía</th>
              <th className="text-right">Monto</th>
              <th>Notas</th>
              <th style={{ width: 80 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {registros.map(r => (
              <tr key={r.id}>
                <td className="text-xs text-slate-700 font-medium">{MESES[r.mes - 1]}</td>
                <td className="text-xs text-slate-600">{r.compania_nombre}</td>
                <td className="text-right font-mono text-xs text-slate-700 font-semibold">{formatMoneda(r.monto)}</td>
                <td className="text-xs text-slate-500 max-w-48 truncate" title={r.notas ?? ''}>{r.notas ?? '—'}</td>
                <td>
                  <div className="flex items-center gap-0.5">
                    <button onClick={() => abrirModalEdicion(r)}
                      className="btn-tabla-accion" title="Editar">
                      <Pencil />
                    </button>
                    <button onClick={() => eliminar(r)}
                      disabled={eliminandoIds.has(r.id)}
                      className="btn-tabla-accion-danger disabled:opacity-40 disabled:cursor-not-allowed"
                      title={eliminandoIds.has(r.id) ? 'Eliminando…' : 'Eliminar'}>
                      <Trash2 />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </EstadoCarga>

      {/* Modal */}
      {modalAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-800">
                {editandoId ? 'Editar facturación' : 'Cargar facturación'}
              </h3>
              <button onClick={() => setModalAbierto(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4"/>
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              {/* Compañía */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Compañía *</label>
                <select className="form-input w-full" value={formCompania}
                  onChange={e => setFormCompania(e.target.value)} disabled={!!editandoId}>
                  <option value="">Seleccionar compañía...</option>
                  {companias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              {/* Mes */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Mes *</label>
                <select className="form-input w-full" value={formMes}
                  onChange={e => setFormMes(Number(e.target.value))} disabled={!!editandoId}>
                  {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
              {/* Año — rango amplio para permitir histórico y planificación */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Año *</label>
                <select className="form-input w-full" value={formAnio}
                  onChange={e => setFormAnio(Number(e.target.value))} disabled={!!editandoId}>
                  {Array.from({ length: 8 }, (_, i) => anioActual + 1 - i).map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
              {/* Monto */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Monto *</label>
                <input type="number" className="form-input w-full font-mono" placeholder="$0.00"
                  min="0" step="0.01" value={formMonto}
                  onChange={e => setFormMonto(e.target.value)} />
              </div>
              {/* Notas */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notas</label>
                <textarea className="form-input w-full" rows={2} placeholder="Observaciones opcionales..."
                  value={formNotas} onChange={e => setFormNotas(e.target.value)} />
              </div>
              {/* Error */}
              {errorModal && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{errorModal}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-200">
              <button onClick={() => setModalAbierto(false)} className="btn-secondary">Cancelar</button>
              <button onClick={guardar} className="btn-primary" disabled={guardando || !formCompania || !formMonto}>
                {guardando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
