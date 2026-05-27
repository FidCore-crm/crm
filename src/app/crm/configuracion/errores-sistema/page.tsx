'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, AlertTriangle, RefreshCw, X, Filter, Archive, ChevronDown,
  Lightbulb, Info,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { apiCall } from '@/lib/api-client'
import { obtenerDefinicionPorCodigo, type DefinicionError } from '@/lib/errores/codigos'
import type { ErrorSistema } from '@/types/database'

interface ResumenResponse {
  errores: ErrorSistema[]
  modulos: string[]
  codigos: string[]
  total: number
}

function fechaCorta(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function colorPorCategoria(categoria: string | undefined): string {
  switch (categoria) {
    case 'Sesión': return 'bg-blue-50 text-blue-700 border-blue-200'
    case 'Permisos': return 'bg-yellow-50 text-yellow-700 border-yellow-200'
    case 'Validación': return 'bg-slate-50 text-slate-700 border-slate-200'
    case 'Base de datos': return 'bg-orange-50 text-orange-700 border-orange-200'
    case 'Correos': return 'bg-purple-50 text-purple-700 border-purple-200'
    case 'Servicios externos': return 'bg-purple-50 text-purple-700 border-purple-200'
    case 'Almacenamiento': return 'bg-amber-50 text-amber-700 border-amber-200'
    case 'Operación inválida': return 'bg-indigo-50 text-indigo-700 border-indigo-200'
    case 'Sistema': return 'bg-red-50 text-red-700 border-red-200'
    default: return 'bg-slate-50 text-slate-700 border-slate-200'
  }
}

interface ErrorEnriquecido extends ErrorSistema {
  definicion: DefinicionError | null
}

function enriquecer(e: ErrorSistema): ErrorEnriquecido {
  return { ...e, definicion: obtenerDefinicionPorCodigo(e.codigo) }
}

export default function ErroresSistemaPage() {
  const router = useRouter()
  const { isAdmin, loading: authLoading } = useAuth()

  const [cargando, setCargando] = useState(true)
  const [errores, setErrores] = useState<ErrorEnriquecido[]>([])
  const [modulosDisponibles, setModulosDisponibles] = useState<string[]>([])
  const [codigosDisponibles, setCodigosDisponibles] = useState<string[]>([])

  const [filtroModulo, setFiltroModulo] = useState<string>('')
  const [filtroCodigo, setFiltroCodigo] = useState<string>('')
  const [filtroDesde, setFiltroDesde] = useState<string>('')
  const [filtroHasta, setFiltroHasta] = useState<string>('')
  const [incluirArchivados, setIncluirArchivados] = useState(false)

  const [seleccionado, setSeleccionado] = useState<ErrorEnriquecido | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const params = new URLSearchParams()
    if (filtroModulo) params.set('modulo', filtroModulo)
    if (filtroCodigo) params.set('codigo', filtroCodigo)
    if (filtroDesde) params.set('desde', new Date(filtroDesde).toISOString())
    if (filtroHasta) params.set('hasta', new Date(filtroHasta).toISOString())
    if (incluirArchivados) params.set('incluir_archivados', 'true')

    const r = await apiCall<ResumenResponse>(`/api/errores-sistema?${params.toString()}`, undefined, { mostrar_toast_en_error: false })
    if (r.ok && r.data) {
      setErrores(r.data.errores.map(enriquecer))
      setModulosDisponibles(r.data.modulos)
      setCodigosDisponibles(r.data.codigos)
    }
    setCargando(false)
  }, [filtroModulo, filtroCodigo, filtroDesde, filtroHasta, incluirArchivados])

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      router.push('/crm/configuracion')
      return
    }
    if (!authLoading && isAdmin) {
      cargar()
    }
  }, [authLoading, isAdmin, cargar, router])

  if (authLoading || !isAdmin) {
    return (
      <div className="flex items-center justify-center p-6">
        <RefreshCw className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/crm/configuracion')}
            className="text-slate-500 hover:text-slate-700"
            title="Volver"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Errores del sistema
            </h1>
            <p className="text-xs text-slate-500">
              Errores críticos persistidos con agregación y retención automática.
            </p>
          </div>
        </div>
        <button
          onClick={cargar}
          disabled={cargando}
          className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${cargando ? 'animate-spin' : ''}`} />
          Refrescar
        </button>
      </div>

      {/* Filtros */}
      <div className="rounded border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-2 mb-2">
          <Filter className="h-3 w-3 text-slate-400" />
          <span className="text-xs font-medium text-slate-600">Filtros</span>
        </div>
        <div className="grid grid-cols-5 gap-2">
          <div>
            <label className="block text-2xs text-slate-500 mb-1">Módulo</label>
            <select
              value={filtroModulo}
              onChange={(e) => setFiltroModulo(e.target.value)}
              className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
            >
              <option value="">Todos</option>
              {modulosDisponibles.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-2xs text-slate-500 mb-1">Código</label>
            <select
              value={filtroCodigo}
              onChange={(e) => setFiltroCodigo(e.target.value)}
              className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
            >
              <option value="">Todos</option>
              {codigosDisponibles.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-2xs text-slate-500 mb-1">Desde</label>
            <input
              type="datetime-local"
              value={filtroDesde}
              onChange={(e) => setFiltroDesde(e.target.value)}
              className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
            />
          </div>
          <div>
            <label className="block text-2xs text-slate-500 mb-1">Hasta</label>
            <input
              type="datetime-local"
              value={filtroHasta}
              onChange={(e) => setFiltroHasta(e.target.value)}
              className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={incluirArchivados}
                onChange={(e) => setIncluirArchivados(e.target.checked)}
              />
              Incluir archivados
            </label>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="rounded border border-slate-200 bg-white overflow-hidden">
        {cargando ? (
          <div className="p-8 text-center text-xs text-slate-400">
            <RefreshCw className="h-4 w-4 animate-spin inline mr-2" /> Cargando…
          </div>
        ) : errores.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            Sin errores para los filtros aplicados.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left font-medium text-slate-600 px-3 py-2">Última</th>
                <th className="text-left font-medium text-slate-600 px-3 py-2">Categoría</th>
                <th className="text-left font-medium text-slate-600 px-3 py-2">Mensaje</th>
                <th className="text-left font-medium text-slate-600 px-3 py-2">Módulo</th>
                <th className="text-right font-medium text-slate-600 px-3 py-2">Contador</th>
              </tr>
            </thead>
            <tbody>
              {errores.map((e) => {
                const mensaje = e.definicion?.mensaje_humano ?? e.mensaje
                const categoria = e.definicion?.categoria_humana ?? 'Sistema'
                return (
                  <tr
                    key={e.id}
                    onClick={() => setSeleccionado(e)}
                    className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                      {fechaCorta(e.ultima_aparicion)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-block rounded border px-1.5 py-0.5 text-2xs ${colorPorCategoria(categoria)}`}>
                        {categoria}
                      </span>
                      {e.archivado && (
                        <Archive className="inline h-3 w-3 text-slate-300 ml-1" />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-slate-800 truncate max-w-md">{mensaje}</div>
                      <div className="text-2xs text-slate-400 font-mono mt-0.5">{e.codigo}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{e.modulo || '—'}</td>
                    <td className="px-3 py-2 text-right">
                      {e.contador > 1 ? (
                        <span className="inline-block rounded bg-red-50 text-red-700 border border-red-200 px-1.5 py-0.5 font-mono text-2xs">
                          ×{e.contador}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal de detalle */}
      {seleccionado && (
        <ModalDetalle
          error={seleccionado}
          onClose={() => setSeleccionado(null)}
        />
      )}
    </div>
  )
}

// ===========================================================================
// Modal con tabs Resumen / Detalle técnico
// ===========================================================================

function ModalDetalle({
  error,
  onClose,
}: {
  error: ErrorEnriquecido
  onClose: () => void
}) {
  const [tab, setTab] = useState<'resumen' | 'tecnico'>('resumen')
  const categoria = error.definicion?.categoria_humana ?? 'Sistema'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded shadow-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            <span className={`rounded border px-2 py-0.5 text-xs ${colorPorCategoria(categoria)}`}>
              {categoria}
            </span>
            <span className="font-mono text-2xs text-slate-400">{error.codigo}</span>
            {error.archivado && (
              <span className="rounded bg-slate-100 text-slate-500 border border-slate-200 px-1.5 py-0.5 text-2xs">
                ARCHIVADO
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-slate-200 px-4">
          <div className="flex gap-4">
            <button
              onClick={() => setTab('resumen')}
              className={`py-2 text-xs font-medium border-b-2 transition-colors ${
                tab === 'resumen'
                  ? 'border-blue-500 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Resumen
            </button>
            <button
              onClick={() => setTab('tecnico')}
              className={`py-2 text-xs font-medium border-b-2 transition-colors ${
                tab === 'tecnico'
                  ? 'border-blue-500 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              Detalle técnico
            </button>
          </div>
        </div>

        {/* Contenido */}
        <div className="p-4 space-y-3 text-xs">
          {tab === 'resumen' ? (
            <ResumenTab error={error} />
          ) : (
            <TecnicoTab error={error} />
          )}
        </div>
      </div>
    </div>
  )
}

function ResumenTab({ error }: { error: ErrorEnriquecido }) {
  const mensaje = error.definicion?.mensaje_humano ?? error.mensaje
  const sugerencia = error.definicion?.sugerencia

  return (
    <>
      {/* Mensaje humano */}
      <div className="rounded border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-start gap-2">
          <Info className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
          <div>
            <div className="text-2xs font-medium text-slate-500 uppercase tracking-wide mb-1">
              Qué pasó
            </div>
            <div className="text-sm text-slate-800">{mensaje}</div>
          </div>
        </div>
      </div>

      {/* Sugerencia */}
      {sugerencia && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start gap-2">
            <Lightbulb className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <div className="text-2xs font-medium text-amber-700 uppercase tracking-wide mb-1">
                Sugerencia
              </div>
              <div className="text-sm text-amber-900">{sugerencia}</div>
            </div>
          </div>
        </div>
      )}

      {/* Metadatos */}
      <div className="grid grid-cols-3 gap-3">
        <DetalleRow label="Contador" value={String(error.contador)} />
        <DetalleRow label="Primera aparición" value={fechaCorta(error.primera_aparicion)} />
        <DetalleRow label="Última aparición" value={fechaCorta(error.ultima_aparicion)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <DetalleRow label="Módulo" value={error.modulo} />
        <DetalleRow label="Método" value={error.metodo} />
      </div>
      <DetalleRow label="Endpoint" value={error.endpoint} mono />
      {error.archivado && (
        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-slate-500">
          Este error fue archivado por la política de retención — el detalle
          técnico (stack trace, contexto, request) fue eliminado pero la
          metadata queda para análisis de tendencias.
        </div>
      )}
    </>
  )
}

function TecnicoTab({ error }: { error: ErrorEnriquecido }) {
  if (error.archivado) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 p-3 text-slate-500">
        Este error fue archivado — el detalle técnico (stack trace, contexto,
        request) fue eliminado por la política de retención.
      </div>
    )
  }

  return (
    <>
      <DetalleRow label="Mensaje técnico" value={error.mensaje} />
      {error.correlation_id && (
        <DetalleRow label="Correlation ID" value={error.correlation_id} mono />
      )}
      {error.stack_trace && (
        <DetalleBloque label="Stack trace" contenido={error.stack_trace} abiertoInicial />
      )}
      {error.contexto_extra && (
        <DetalleBloque
          label="Contexto extra"
          contenido={JSON.stringify(error.contexto_extra, null, 2)}
        />
      )}
      {error.request_body && (
        <DetalleBloque
          label="Request body"
          contenido={JSON.stringify(error.request_body, null, 2)}
        />
      )}
      {error.request_headers && (
        <DetalleBloque
          label="Request headers"
          contenido={JSON.stringify(error.request_headers, null, 2)}
        />
      )}
    </>
  )
}

function DetalleRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
}) {
  return (
    <div>
      <div className="text-2xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-slate-800 ${mono ? 'font-mono' : ''}`}>{value || '—'}</div>
    </div>
  )
}

function DetalleBloque({
  label,
  contenido,
  abiertoInicial,
}: {
  label: string
  contenido: string
  abiertoInicial?: boolean
}) {
  const [abierto, setAbierto] = useState(abiertoInicial ?? false)
  return (
    <div className="rounded border border-slate-200">
      <button
        onClick={() => setAbierto(!abierto)}
        className="w-full flex items-center justify-between px-3 py-2 text-2xs font-medium text-slate-600 hover:bg-slate-50"
      >
        <span className="uppercase tracking-wide">{label}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <pre className="px-3 py-2 text-2xs text-slate-700 bg-slate-50 overflow-x-auto whitespace-pre-wrap border-t border-slate-200 font-mono">
          {contenido}
        </pre>
      )}
    </div>
  )
}
