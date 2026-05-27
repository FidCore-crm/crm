'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Filter, TrendingDown, Clock, DollarSign, Percent } from 'lucide-react'
import { formatMoneda } from '@/lib/utils'
import { apiCall } from '@/lib/api-client'

type Etapa = { nombre: string; cantidad: number; valor: number | null }

type EmbudoResponse = {
  etapas: Etapa[]
  tasas: {
    leads_to_contactados: number
    contactados_to_ops: number
    ops_to_cotiz: number
    cotiz_to_ganadas: number
    global: number
  }
  metricas: {
    ciclo_promedio_dias: number
    valor_promedio_ganada: number
    tasa_perdida_por_etapa: { ops: number; cotizaciones: number }
  }
  razones_perdida_top5: { razon: string; cantidad: number }[]
}

type PeriodoKey = 'mes' | '30d' | '90d' | 'anio' | 'custom'

function rangoFechas(p: PeriodoKey): { desde: string; hasta: string } {
  const hoy = new Date()
  const hasta = new Date(hoy)
  let desde = new Date(hoy)
  if (p === 'mes') {
    desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  } else if (p === '30d') {
    desde.setDate(desde.getDate() - 30)
  } else if (p === '90d') {
    desde.setDate(desde.getDate() - 90)
  } else if (p === 'anio') {
    desde = new Date(hoy.getFullYear(), 0, 1)
  }
  return { desde: desde.toISOString().slice(0, 10), hasta: hasta.toISOString().slice(0, 10) }
}

const ETAPA_COLORS = [
  'bg-blue-100 border-blue-300 text-blue-800',
  'bg-cyan-100 border-cyan-300 text-cyan-800',
  'bg-violet-100 border-violet-300 text-violet-800',
  'bg-orange-100 border-orange-300 text-orange-800',
  'bg-emerald-100 border-emerald-300 text-emerald-800',
]

export default function EmbudoTab() {
  const [periodo, setPeriodo] = useState<PeriodoKey>('90d')
  const initialRange = useMemo(() => rangoFechas('90d'), [])
  const [desde, setDesde] = useState(initialRange.desde)
  const [hasta, setHasta] = useState(initialRange.hasta)
  const [origen, setOrigen] = useState('')
  const [data, setData] = useState<EmbudoResponse | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    const params = new URLSearchParams()
    params.set('desde', desde)
    params.set('hasta', hasta)
    if (origen) params.set('origen', origen)
    const r = await apiCall<EmbudoResponse>(`/api/comercial/embudo?${params.toString()}`, {
      credentials: 'include',
    }, { mostrar_toast_en_error: false })
    if (r.ok && r.data) {
      setData(r.data)
    } else {
      setError(r.error?.mensaje ?? 'Error al cargar embudo')
      setData(null)
    }
    setCargando(false)
  }, [desde, hasta, origen])

  useEffect(() => { cargar() }, [cargar])

  const cambiarPeriodo = (p: PeriodoKey) => {
    setPeriodo(p)
    if (p !== 'custom') {
      const r = rangoFechas(p)
      setDesde(r.desde)
      setHasta(r.hasta)
    }
  }

  // Ancho proporcional del embudo (basado en la primera etapa no-cero)
  const maxCantidad = data
    ? Math.max(...data.etapas.map(e => e.cantidad), 1)
    : 1

  const tasasEntre = data
    ? [
        data.tasas.leads_to_contactados,
        data.tasas.contactados_to_ops,
        data.tasas.ops_to_cotiz,
        data.tasas.cotiz_to_ganadas,
      ]
    : []

  return (
    <div className="flex flex-col gap-3">
      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded p-2 flex items-center gap-2 flex-wrap">
        <Filter className="h-3 w-3 text-slate-400" />
        <span className="text-xs font-semibold text-slate-600">Período:</span>
        {([
          { k: 'mes', label: 'Este mes' },
          { k: '30d', label: 'Últimos 30d' },
          { k: '90d', label: 'Últimos 90d' },
          { k: 'anio', label: 'Año actual' },
          { k: 'custom', label: 'Personalizado' },
        ] as { k: PeriodoKey; label: string }[]).map(p => (
          <button
            key={p.k}
            onClick={() => cambiarPeriodo(p.k)}
            className={`text-2xs font-semibold px-2 py-1 rounded border transition-colors ${
              periodo === p.k
                ? 'bg-slate-800 text-white border-slate-800'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {p.label}
          </button>
        ))}
        {periodo === 'custom' && (
          <>
            <input
              type="date"
              className="form-input text-xs"
              value={desde}
              onChange={e => setDesde(e.target.value)}
            />
            <span className="text-xs text-slate-400">a</span>
            <input
              type="date"
              className="form-input text-xs"
              value={hasta}
              onChange={e => setHasta(e.target.value)}
            />
          </>
        )}
        <div className="flex-1" />
        <span className="text-xs font-semibold text-slate-600">Origen:</span>
        <select
          className="form-input text-xs"
          value={origen}
          onChange={e => setOrigen(e.target.value)}
        >
          <option value="">Todos</option>
          <option value="REFERIDO">Referido</option>
          <option value="WEB">Web</option>
          <option value="REDES_SOCIALES">Redes sociales</option>
          <option value="LLAMADA_ENTRANTE">Llamada entrante</option>
          <option value="EVENTO">Evento</option>
          <option value="MANUAL">Manual</option>
          <option value="AUTOMATICA">Automática</option>
          <option value="OTRO">Otro</option>
        </select>
      </div>

      {cargando ? (
        <div className="bg-white border border-slate-200 rounded p-10 text-center text-xs text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
          Calculando embudo...
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded p-4 text-xs text-red-700">
          {error}
        </div>
      ) : data ? (
        <>
          {/* Embudo visual */}
          <div className="bg-white border border-slate-200 rounded p-4">
            <h2 className="text-xs font-semibold text-slate-700 mb-3">Embudo de conversión</h2>
            <div className="flex flex-col items-center gap-1">
              {data.etapas.map((etapa, i) => {
                const widthPct = Math.max(20, (etapa.cantidad / maxCantidad) * 100)
                const color = ETAPA_COLORS[i] ?? ETAPA_COLORS[0]
                return (
                  <div key={etapa.nombre} className="w-full flex flex-col items-center">
                    <div
                      className={`border rounded px-3 py-2 flex items-center justify-between gap-4 ${color}`}
                      style={{ width: `${widthPct}%`, minWidth: '240px' }}
                    >
                      <span className="text-xs font-semibold">{etapa.nombre}</span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm font-bold">{etapa.cantidad}</span>
                        {etapa.valor !== null && etapa.valor > 0 && (
                          <span className="font-mono text-2xs opacity-80">
                            {formatMoneda(etapa.valor, 'ARS')}
                          </span>
                        )}
                      </div>
                    </div>
                    {i < data.etapas.length - 1 && (
                      <div className="text-2xs text-slate-500 py-0.5 flex items-center gap-1">
                        <TrendingDown className="h-3 w-3" />
                        tasa: <span className="font-mono font-semibold">{tasasEntre[i]}%</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Métricas */}
          <div className="grid grid-cols-4 gap-2">
            <div className="kpi-card bg-emerald-50 border border-emerald-200">
              <span className="kpi-label flex items-center gap-1">
                <Percent className="h-3 w-3 text-emerald-600" /> Conversión global
              </span>
              <span className="kpi-value text-emerald-700">{data.tasas.global}%</span>
              <span className="kpi-sub">leads → ganadas</span>
            </div>
            <div className="kpi-card bg-blue-50 border border-blue-200">
              <span className="kpi-label flex items-center gap-1">
                <Clock className="h-3 w-3 text-blue-600" /> Ciclo de venta
              </span>
              <span className="kpi-value text-blue-700">
                {data.metricas.ciclo_promedio_dias}
                <span className="text-xs font-normal"> días</span>
              </span>
              <span className="kpi-sub">promedio hasta cerrar</span>
            </div>
            <div className="kpi-card bg-violet-50 border border-violet-200">
              <span className="kpi-label flex items-center gap-1">
                <DollarSign className="h-3 w-3 text-violet-600" /> Valor promedio
              </span>
              <span className="kpi-value text-violet-700">
                {formatMoneda(data.metricas.valor_promedio_ganada, 'ARS')}
              </span>
              <span className="kpi-sub">por venta ganada</span>
            </div>
            <div className="kpi-card bg-red-50 border border-red-200">
              <span className="kpi-label flex items-center gap-1">
                <TrendingDown className="h-3 w-3 text-red-600" /> Tasa de pérdida
              </span>
              <span className="kpi-value text-red-700 text-base">
                {data.metricas.tasa_perdida_por_etapa.ops}%
                <span className="text-2xs font-normal text-slate-500"> ops</span>
                {' / '}
                {data.metricas.tasa_perdida_por_etapa.cotizaciones}%
                <span className="text-2xs font-normal text-slate-500"> cotiz</span>
              </span>
              <span className="kpi-sub">por etapa</span>
            </div>
          </div>

          {/* Razones de pérdida */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-200 bg-slate-50">
              <h3 className="text-xs font-semibold text-slate-700">Top 5 razones de pérdida</h3>
            </div>
            {data.razones_perdida_top5.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No hay pérdidas registradas en el período
              </div>
            ) : (
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Razón</th>
                    <th style={{ width: 120 }}>Cantidad</th>
                    <th style={{ width: 200 }}>Distribución</th>
                  </tr>
                </thead>
                <tbody>
                  {data.razones_perdida_top5.map((r, i) => {
                    const max = data.razones_perdida_top5[0]?.cantidad ?? 1
                    const pct = (r.cantidad / max) * 100
                    return (
                      <tr key={i}>
                        <td className="text-xs text-slate-700">{r.razon}</td>
                        <td className="font-mono text-xs text-slate-700">{r.cantidad}</td>
                        <td>
                          <div className="w-full bg-slate-100 rounded h-2">
                            <div
                              className="bg-red-400 h-2 rounded"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
