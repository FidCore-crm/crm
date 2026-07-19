'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, BarChart3, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import {
  GRAFICOS_DASHBOARD,
  agruparPorCategoria,
  todosLosIds,
} from '@/lib/dashboard-graficos'

/**
 * Configuración: qué gráficos del panel "Análisis de cartera" están visibles.
 *
 * - Default: todos visibles (`visibles === null` en DB).
 * - El PAS puede tildar/destildar gráficos individualmente.
 * - Botones "Habilitar todos" / "Ocultar todos" para acción masiva.
 *
 * Solo admin.
 */
export default function ConfigDashboardGraficosPage() {
  const { usuario } = useAuth()
  const isAdmin = usuario?.rol === 'ADMIN'

  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [errorGral, setErrorGral] = useState('')
  // Estado local: ids visibles. `null` significa "default = todos".
  // Internamente lo manejamos siempre como Set para edición simple.
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())

  const grupos = agruparPorCategoria()
  const totalGraficos = GRAFICOS_DASHBOARD.length
  const visibles = seleccion.size

  useEffect(() => {
    if (!isAdmin) return
    async function cargar() {
      setCargando(true)
      const r = await apiCall<{ visibles: string[] | null }>(
        '/api/configuracion/dashboard-graficos',
        {},
        { mostrar_toast_en_error: false },
      )
      if (r.ok && r.data) {
        const vis = r.data.visibles
        // null en DB → todos visibles
        if (vis === null) {
          setSeleccion(new Set(todosLosIds()))
        } else {
          setSeleccion(new Set(vis))
        }
      } else {
        setErrorGral(r.error?.mensaje || 'Error cargando configuración')
        // Default optimista: todos visibles
        setSeleccion(new Set(todosLosIds()))
      }
      setCargando(false)
    }
    cargar()
  }, [isAdmin])

  function toggle(id: string) {
    setSeleccion((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleCategoria(ids: string[]) {
    setSeleccion((prev) => {
      const next = new Set(prev)
      const algunoApagado = ids.some((id) => !next.has(id))
      if (algunoApagado) ids.forEach((id) => next.add(id))
      else ids.forEach((id) => next.delete(id))
      return next
    })
  }

  function habilitarTodos() {
    setSeleccion(new Set(todosLosIds()))
  }

  function ocultarTodos() {
    setSeleccion(new Set())
  }

  async function guardar() {
    setGuardando(true)
    setErrorGral('')
    const ids = todosLosIds()
    const todosTildados = ids.every((id) => seleccion.has(id))
    // Si están todos tildados, lo guardamos como `null` (semántica "default")
    // para que reset/migración futuro funcione coherente.
    const payload = todosTildados ? null : Array.from(seleccion)
    const r = await apiCall(
      '/api/configuracion/dashboard-graficos',
      { method: 'PATCH', body: { visibles: payload } },
      { mostrar_toast_en_error: false },
    )
    if (r.ok) {
      toast.exito('Configuración guardada')
    } else {
      const msg = r.error?.mensaje || 'Error guardando'
      setErrorGral(msg)
      toast.error(msg)
    }
    setGuardando(false)
  }

  if (!isAdmin) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded p-4 text-xs text-amber-700 flex items-center gap-2">
        <AlertCircle className="h-4 w-4 shrink-0" />
        Esta pantalla es solo para administradores.
      </div>
    )
  }

  if (cargando) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500 mx-auto" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-600 mb-1">
            <Link href="/crm/configuracion" className="hover:text-slate-700 flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" />
              Volver a Configuración
            </Link>
          </div>
          <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-blue-600" />
            Gráficos del panel de Análisis
          </h1>
          <p className="text-xs text-slate-600 mt-1">
            Elegí qué gráficos querés ver en el dashboard de análisis de cartera.
            Los apagados no se cargan ni se muestran.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={habilitarTodos} className="btn-secondary text-xs">
            Habilitar todos
          </button>
          <button onClick={ocultarTodos} className="btn-secondary text-xs">
            Ocultar todos
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
          >
            {guardando ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <CheckCircle className="h-3 w-3" />
            )}
            Guardar
          </button>
        </div>
      </div>

      {errorGral && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" /> {errorGral}
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-800">
        <strong className="font-semibold">{visibles}</strong> de{' '}
        <strong className="font-semibold">{totalGraficos}</strong> gráficos habilitados.
      </div>

      {/* Grupos por categoría */}
      <div className="space-y-3">
        {grupos.map((g) => {
          const idsGrupo = g.graficos.map((x) => x.id)
          const tildadosGrupo = idsGrupo.filter((id) => seleccion.has(id)).length
          return (
            <div key={g.categoria} className="bg-white border border-slate-200 rounded">
              <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                  {g.label}
                </h3>
                <div className="flex items-center gap-3">
                  <span className="text-2xs text-slate-600">
                    {tildadosGrupo} / {idsGrupo.length}
                  </span>
                  <button
                    onClick={() => toggleCategoria(idsGrupo)}
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    Alternar todos
                  </button>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {g.graficos.map((graf) => {
                  const tildado = seleccion.has(graf.id)
                  return (
                    <label
                      key={graf.id}
                      className="flex items-start gap-3 px-4 py-2.5 hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={tildado}
                        onChange={() => toggle(graf.id)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${tildado ? 'text-slate-800' : 'text-slate-500'}`}>
                          {graf.nombre}
                        </p>
                        <p className={`text-xs ${tildado ? 'text-slate-600' : 'text-slate-500'}`}>
                          {graf.descripcion}
                        </p>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
