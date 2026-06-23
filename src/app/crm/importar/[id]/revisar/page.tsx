'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  Loader2,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import {
  validarDNI,
  validarEmail,
  validarFecha,
  validarMonto,
} from '@/lib/importacion/validators'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { TIPOS_RIESGO, obtenerTipoRiesgo } from '@/lib/tipos-riesgo'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type TipoProblema =
  | 'DNI_INVALIDO'
  | 'DNI_FALTANTE'
  | 'EMAIL_INVALIDO'
  | 'FECHA_INVALIDA'
  | 'MONTO_INVALIDO'
  | 'DUPLICADO_EN_CRM'
  | 'DUPLICADO_EN_ARCHIVO'
  | 'DATOS_FALTANTES'
  | 'COMPANIA_NO_RECONOCIDA'
  | 'RAMO_NO_RECONOCIDO'
  | 'COBERTURA_NO_RECONOCIDA'
  | 'RIESGO_INCOMPLETO'
  | 'INCONSISTENCIA_LOGICA'
  | 'OTROS'

type TipoEntidad = 'PERSONA' | 'POLIZA' | 'RIESGO'
type AccionResolucion =
  | 'ACEPTAR_PROPUESTA'
  | 'EDITAR'
  | 'IGNORAR_REGISTRO'
  | 'ACTUALIZAR_EXISTENTE'
  | 'CREAR_NUEVO'

interface EntidadPersonaDudoso {
  apellido?: string
  nombre?: string
  dni_cuil?: string | null
  [extra: string]: unknown
}
interface EntidadPolizaDudoso {
  numero_poliza?: string
  [extra: string]: unknown
}
interface EntidadRiesgoDudoso {
  tipo_riesgo?: string
  descripcion_corta?: string
  [extra: string]: unknown
}

interface Dudoso {
  id: string
  importacion_id: string
  lote_id?: string | null
  numero_fila_archivo: number
  archivo_origen?: string | null
  tipo_entidad: TipoEntidad
  tipo_problema: TipoProblema
  descripcion_problema: string
  datos_originales: {
    entidades?: {
      persona?: EntidadPersonaDudoso
      poliza?: EntidadPolizaDudoso
      riesgo?: EntidadRiesgoDudoso
    }
    campo?: string | string[]
    valor_original?: unknown
    match_existente?: Record<string, unknown> | null
  }
  datos_propuestos?: Record<string, unknown> | null
  sugerencia_ia?: string | null
  estado_resolucion: 'PENDIENTE' | 'RESUELTO' | 'IGNORADO'
}

interface Catalogo {
  id: string
  nombre: string
  metadata?: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LABEL_TIPO_PROBLEMA: Record<TipoProblema, string> = {
  DNI_INVALIDO: 'DNI inválido',
  DNI_FALTANTE: 'DNI faltante',
  EMAIL_INVALIDO: 'Email inválido',
  FECHA_INVALIDA: 'Fecha inválida',
  MONTO_INVALIDO: 'Monto inválido',
  DUPLICADO_EN_CRM: 'Duplicado en CRM',
  DUPLICADO_EN_ARCHIVO: 'Duplicado en archivo',
  DATOS_FALTANTES: 'Datos faltantes',
  COMPANIA_NO_RECONOCIDA: 'Compañía no reconocida',
  RAMO_NO_RECONOCIDO: 'Ramo no reconocido',
  COBERTURA_NO_RECONOCIDA: 'Cobertura no reconocida',
  RIESGO_INCOMPLETO: 'Riesgo incompleto',
  INCONSISTENCIA_LOGICA: 'Inconsistencia',
  OTROS: 'Otros',
}

function colorTipo(t: TipoProblema): string {
  if (t === 'DNI_INVALIDO' || t === 'DNI_FALTANTE' || t === 'EMAIL_INVALIDO' || t === 'FECHA_INVALIDA' || t === 'MONTO_INVALIDO' || t === 'DATOS_FALTANTES' || t === 'RIESGO_INCOMPLETO') {
    return 'bg-red-50 text-red-700 border-red-200'
  }
  if (t === 'DUPLICADO_EN_CRM' || t === 'DUPLICADO_EN_ARCHIVO') {
    return 'bg-amber-50 text-amber-700 border-amber-200'
  }
  if (t === 'INCONSISTENCIA_LOGICA' || t === 'COMPANIA_NO_RECONOCIDA' || t === 'RAMO_NO_RECONOCIDO' || t === 'COBERTURA_NO_RECONOCIDA') {
    return 'bg-blue-50 text-blue-700 border-blue-200'
  }
  return 'bg-slate-100 text-slate-700 border-slate-200'
}

function tituloEntidad(d: Dudoso): string {
  const ent = d.datos_originales?.entidades || {}
  if (d.tipo_entidad === 'PERSONA' && ent.persona) {
    const p = ent.persona
    const nom = [p.apellido, p.nombre].filter(Boolean).join(' ').trim()
    return nom ? `Cliente: ${nom}` : `Cliente (DNI ${p.dni_cuil ?? '—'})`
  }
  if (d.tipo_entidad === 'POLIZA' && ent.poliza) {
    return `Póliza ${ent.poliza.numero_poliza ?? '—'}`
  }
  if (d.tipo_entidad === 'RIESGO' && ent.riesgo) {
    const tr = ent.riesgo.tipo_riesgo
      ? obtenerTipoRiesgo(ent.riesgo.tipo_riesgo).label
      : ''
    return `Riesgo ${tr} ${ent.riesgo.descripcion_corta ?? ''}`.trim()
  }
  return d.tipo_entidad
}

function DlItem({ k, v }: { k: string; v: unknown }) {
  if (v === null || v === undefined || v === '') return null
  // El valor de `tipo_riesgo` es un identificador interno ('automotor', etc).
  // Mostramos el label legible del catálogo TIPOS_RIESGO.
  const display =
    k === 'tipo_riesgo' && typeof v === 'string'
      ? obtenerTipoRiesgo(v).label
      : String(v)
  return (
    <div className="flex gap-2 text-xs">
      <dt className="text-slate-500 min-w-[120px]">{k}</dt>
      <dd className="font-mono text-slate-800 break-all">{display}</dd>
    </div>
  )
}

function DlEntidad({ titulo, obj }: { titulo: string; obj: Record<string, unknown> | null | undefined }) {
  if (!obj || typeof obj !== 'object') return null
  const keys = Object.keys(obj).filter((k) => obj[k] !== null && obj[k] !== undefined && obj[k] !== '')
  if (keys.length === 0) return null
  return (
    <div className="border border-slate-200 rounded-md p-3 bg-slate-50">
      <div className="text-2xs uppercase tracking-wide text-slate-500 mb-2 font-semibold">{titulo}</div>
      <dl className="space-y-1">
        {keys.map((k) => (
          <DlItem key={k} k={k} v={obj[k]} />
        ))}
      </dl>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function RevisarDudososPage() {
  const router = useRouter()
  const params = useParams()
  const id = (params?.id as string) || ''

  const supabase = useMemo(() => getSupabaseClient(), [])

  const [loading, setLoading] = useState(true)
  const [errorGral, setErrorGral] = useState('')
  const [dudosos, setDudosos] = useState<Dudoso[]>([])
  const [totalesPorTipo, setTotalesPorTipo] = useState<Record<string, number>>({})
  const [filtroTipo, setFiltroTipo] = useState<TipoProblema | null>(null)
  const [pagina, setPagina] = useState(1)
  const [totalPaginado, setTotalPaginado] = useState(0)
  const porPagina = 10
  const [expandidoId, setExpandidoId] = useState<string | null>(null)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [restantes, setRestantes] = useState(0)
  const [totalInicial, setTotalInicial] = useState(0)
  const [cancelando, setCancelando] = useState(false)
  const [showPanelMasivo, setShowPanelMasivo] = useState(false)
  const [modalMasivo, setModalMasivo] = useState<null | {
    titulo: string
    descripcion: string
    accion: AccionResolucion
    count: number
  }>(null)

  // Catálogos para dropdowns
  const [companias, setCompanias] = useState<Catalogo[]>([])
  const [ramos, setRamos] = useState<Catalogo[]>([])
  const [coberturas, setCoberturas] = useState<Catalogo[]>([])

  // Cargar catálogos
  useEffect(() => {
    let cancel = false
    async function cargar() {
      const { data: tipos } = await supabase.from('tipo_catalogo').select('id, codigo')
      if (!tipos || cancel) return
      type TipoRow = { id: number; codigo: string }
      const tComp = (tipos as TipoRow[]).find((t) => t.codigo === 'COMPANIA')
      const tRamo = (tipos as TipoRow[]).find((t) => t.codigo === 'RAMO')
      const tCob = (tipos as TipoRow[]).find((t) => t.codigo === 'COBERTURA')
      const [{ data: comps }, { data: rams }, { data: cobs }] = await Promise.all([
        tComp
          ? supabase.from('catalogos').select('id, nombre, metadata').eq('tipo_id', tComp.id).eq('activo', true).order('nombre')
          : Promise.resolve({ data: [] }),
        tRamo
          ? supabase.from('catalogos').select('id, nombre, metadata').eq('tipo_id', tRamo.id).eq('activo', true).order('nombre')
          : Promise.resolve({ data: [] }),
        tCob
          ? supabase.from('catalogos').select('id, nombre, metadata').eq('tipo_id', tCob.id).eq('activo', true).order('nombre')
          : Promise.resolve({ data: [] }),
      ])
      if (cancel) return
      setCompanias((comps ?? []) as unknown as Catalogo[])
      setRamos((rams ?? []) as unknown as Catalogo[])
      setCoberturas((cobs ?? []) as unknown as Catalogo[])
    }
    cargar()
    return () => {
      cancel = true
    }
  }, [supabase])

  // Cargar estado general
  const cargarEstado = useCallback(async () => {
    type EstadoResp = { registros?: { dudosos?: number; resueltos?: number; pendientes_revision?: number } }
    const r = await apiCall<EstadoResp>(`/api/importar/${id}/estado`, { cache: 'no-store' }, { mostrar_toast_en_error: false })
    if (!r.ok || !r.data) {
      setErrorGral(r.error?.mensaje || 'Error cargando estado')
      return
    }
    const regs = r.data.registros || {}
    const dud = regs.dudosos ?? 0
    const res_ = regs.resueltos ?? 0
    const pend = regs.pendientes_revision ?? dud - res_
    setTotalInicial(Math.max(dud, dud + res_) || dud + res_ || 0)
    setRestantes(pend)
  }, [id])

  // Cargar lista de dudosos
  const cargarLista = useCallback(
    async (opts?: { pagina?: number; tipo?: TipoProblema | null }) => {
      setLoading(true)
      const pag = opts?.pagina ?? pagina
      const tipo = opts?.tipo !== undefined ? opts.tipo : filtroTipo
      const params_ = new URLSearchParams({
        estado_resolucion: 'PENDIENTE',
        pagina: String(pag),
        por_pagina: String(porPagina),
      })
      if (tipo) params_.set('tipo_problema', tipo)
      type DudososResp = {
        dudosos?: Dudoso[]
        totales_por_tipo?: Record<string, number>
        total?: number
      }
      const r = await apiCall<DudososResp>(`/api/importar/${id}/dudosos?${params_.toString()}`, {
        cache: 'no-store',
      }, { mostrar_toast_en_error: false })
      if (r.ok && r.data) {
        setDudosos(r.data.dudosos || [])
        setTotalesPorTipo(r.data.totales_por_tipo || {})
        setTotalPaginado(r.data.total || 0)
      } else {
        setErrorGral(r.error?.mensaje || 'Error cargando dudosos')
      }
      setLoading(false)
    },
    [id, pagina, filtroTipo]
  )

  useEffect(() => {
    if (!id) return
    cargarEstado()
    cargarLista({ pagina: 1, tipo: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Cambiar filtro
  const cambiarFiltro = (t: TipoProblema | null) => {
    setFiltroTipo(t)
    setPagina(1)
    setExpandidoId(null)
    cargarLista({ pagina: 1, tipo: t })
  }

  // Cambiar página
  const cambiarPagina = (p: number) => {
    setPagina(p)
    setExpandidoId(null)
    cargarLista({ pagina: p })
  }

  // Resolver un dudoso individual
  const resolverDudoso = useCallback(
    async (
      dudoso: Dudoso,
      accion: AccionResolucion,
      datos?: Record<string, unknown> | null,
      opts?: { siguiente?: boolean }
    ) => {
      setResolvingId(dudoso.id)
      const r = await apiCall(`/api/importar/${id}/dudosos/${dudoso.id}/resolver`, {
        method: 'POST',
        body: { accion, datos },
      })
      if (r.ok) {
        toast.exito('Resuelto')
        const idxActual = dudosos.findIndex((d) => d.id === dudoso.id)
        const siguienteId =
          opts?.siguiente && idxActual >= 0 && idxActual + 1 < dudosos.length
            ? dudosos[idxActual + 1].id
            : null
        await Promise.all([cargarEstado(), cargarLista()])
        setExpandidoId(siguienteId)
      }
      setResolvingId(null)
    },
    [id, dudosos, cargarEstado, cargarLista]
  )

  // Acciones masivas
  const ejecutarMasivo = useCallback(
    async (accion: AccionResolucion, datos?: Record<string, unknown> | null) => {
      const r = await apiCall<{ actualizados: number }>(`/api/importar/${id}/dudosos/aplicar-masivo`, {
        method: 'POST',
        body: {
          tipo_problema: filtroTipo ?? undefined,
          accion,
          datos,
        },
      })
      if (r.ok) {
        toast.exito(`${r.data?.actualizados ?? 0} registros actualizados`)
        setModalMasivo(null)
        await Promise.all([cargarEstado(), cargarLista({ pagina: 1 })])
        setPagina(1)
      }
    },
    [id, filtroTipo, cargarEstado, cargarLista]
  )

  // Cancelar importación
  const cancelar = async () => {
    if (!confirm('¿Cancelar la importación? Esta acción no se puede deshacer.')) return
    setCancelando(true)
    const r = await apiCall(`/api/importar/${id}/cancelar`, { method: 'POST' })
    if (r.ok) {
      router.push('/crm/importar')
    } else {
      setCancelando(false)
    }
  }

  // Total resueltos para progreso
  const resueltos = Math.max(0, totalInicial - restantes)
  const pct = totalInicial > 0 ? Math.round((resueltos / totalInicial) * 100) : 0

  const tiposDisponibles = useMemo(() => {
    return (Object.keys(totalesPorTipo) as TipoProblema[]).filter(
      (k) => totalesPorTipo[k] > 0
    )
  }, [totalesPorTipo])

  const totalTodos = useMemo(
    () => Object.values(totalesPorTipo).reduce((a, b) => a + b, 0),
    [totalesPorTipo]
  )

  const hayPropuestasIA = useMemo(
    () => dudosos.some((d) => d.datos_propuestos != null),
    [dudosos]
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (restantes === 0 && !loading) {
    const hubo = totalInicial > 0
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <div className="bg-green-50 border border-green-300 rounded-lg p-8 text-center">
          <CheckCircle2 className="w-16 h-16 text-green-600 mx-auto mb-4" />
          <h1 className="text-2xl font-semibold text-green-900 mb-2">
            {hubo
              ? 'Todos los registros dudosos resueltos'
              : 'No hay registros para revisar'}
          </h1>
          <p className="text-green-700 mb-6">
            {hubo
              ? `${totalInicial} registros procesados correctamente.`
              : 'Todos los registros pasaron las validaciones. Podés continuar directamente con la importación.'}
          </p>
          <button
            className="btn-primary text-base px-6 py-3"
            onClick={() => router.push(`/crm/importar/${id}/confirmar`)}
          >
            Continuar con la importación
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Revisión de registros dudosos
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            El sistema marcó {restantes} registros que requieren tu decisión.
          </p>
        </div>
        <button
          className="btn-danger text-sm flex items-center gap-1"
          onClick={cancelar}
          disabled={cancelando}
        >
          {cancelando && <Loader2 className="w-4 h-4 animate-spin" />}
          <X className="w-4 h-4" /> Cancelar importación
        </button>
      </div>

      {/* Progreso sticky */}
      <div className="sticky top-0 bg-white z-20 pb-4 pt-2 border-b border-slate-200 mb-4">
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-slate-900">
              {resueltos} de {totalInicial} resueltos ({pct}%)
            </div>
            <div className="text-sm text-slate-600">
              Faltan: <span className="font-semibold text-slate-900">{restantes}</span>
            </div>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden mb-3">
            <div
              className="bg-green-500 h-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <button
            className="btn-primary w-full text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={restantes > 0}
            onClick={() => router.push(`/crm/importar/${id}/confirmar`)}
          >
            Continuar con la importación
          </button>
        </div>
      </div>

      {errorGral && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 mb-4 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {errorGral}
        </div>
      )}

      {/* Tabs de filtro */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => cambiarFiltro(null)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
            filtroTipo === null
              ? 'bg-navy-900 text-white border-navy-900'
              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
          }`}
          style={filtroTipo === null ? { backgroundColor: '#0A1628' } : undefined}
        >
          Todos ({totalTodos})
        </button>
        {tiposDisponibles.map((t) => (
          <button
            key={t}
            onClick={() => cambiarFiltro(t)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
              filtroTipo === t
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {LABEL_TIPO_PROBLEMA[t]} ({totalesPorTipo[t]})
          </button>
        ))}
      </div>

      {/* Panel de acciones masivas */}
      <div className="mb-4 border border-slate-200 rounded-md bg-slate-50">
        <button
          onClick={() => setShowPanelMasivo((s) => !s)}
          className="w-full flex items-center justify-between p-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          <span className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            Acciones masivas
          </span>
          {showPanelMasivo ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        {showPanelMasivo && (
          <div className="p-3 border-t border-slate-200 space-y-2">
            {hayPropuestasIA && (
              <button
                className="btn-secondary text-xs w-full text-left"
                onClick={() =>
                  setModalMasivo({
                    titulo: 'Aceptar todas las propuestas de IA',
                    descripcion: `Se aplicarán las propuestas del sistema a todos los dudosos${
                      filtroTipo ? ` del tipo "${LABEL_TIPO_PROBLEMA[filtroTipo]}"` : ''
                    }.`,
                    accion: 'ACEPTAR_PROPUESTA',
                    count: dudosos.filter((d) => d.datos_propuestos != null).length,
                  })
                }
              >
                Aceptar todas las propuestas de IA
              </button>
            )}
            {filtroTipo && (
              <button
                className="btn-secondary text-xs w-full text-left"
                onClick={() =>
                  setModalMasivo({
                    titulo: `Ignorar todos los "${LABEL_TIPO_PROBLEMA[filtroTipo]}"`,
                    descripcion: 'Estos registros no se importarán.',
                    accion: 'IGNORAR_REGISTRO',
                    count: totalesPorTipo[filtroTipo] || 0,
                  })
                }
              >
                Ignorar todos los "{LABEL_TIPO_PROBLEMA[filtroTipo]}"
              </button>
            )}
            {filtroTipo === 'DUPLICADO_EN_CRM' && (
              <button
                className="btn-secondary text-xs w-full text-left"
                onClick={() =>
                  setModalMasivo({
                    titulo: 'Actualizar todos los duplicados',
                    descripcion: 'Se actualizarán los registros existentes con los datos nuevos del archivo.',
                    accion: 'ACTUALIZAR_EXISTENTE',
                    count: totalesPorTipo['DUPLICADO_EN_CRM'] || 0,
                  })
                }
              >
                Actualizar todos los duplicados con datos nuevos
              </button>
            )}
            {!filtroTipo && !hayPropuestasIA && (
              <p className="text-xs text-slate-500 italic">
                Seleccioná un filtro para ver acciones masivas específicas.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando…
        </div>
      ) : dudosos.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          No hay registros pendientes con este filtro.
        </div>
      ) : (
        <div className="space-y-3">
          {dudosos.map((d) => (
            <CardDudoso
              key={d.id}
              dudoso={d}
              expandido={expandidoId === d.id}
              onToggle={() => setExpandidoId(expandidoId === d.id ? null : d.id)}
              onResolver={(accion, datos, opts) => resolverDudoso(d, accion, datos, opts)}
              resolving={resolvingId === d.id}
              companias={companias}
              ramos={ramos}
              coberturas={coberturas}
            />
          ))}
        </div>
      )}

      {/* Paginación */}
      {totalPaginado > porPagina && (
        <div className="flex items-center justify-between mt-6">
          <button
            className="btn-secondary text-xs"
            disabled={pagina <= 1}
            onClick={() => cambiarPagina(pagina - 1)}
          >
            Anterior
          </button>
          <span className="text-xs text-slate-600">
            Página {pagina} de {Math.ceil(totalPaginado / porPagina)}
          </span>
          <button
            className="btn-secondary text-xs"
            disabled={pagina >= Math.ceil(totalPaginado / porPagina)}
            onClick={() => cambiarPagina(pagina + 1)}
          >
            Siguiente
          </button>
        </div>
      )}

      {/* Modal masivo */}
      {modalMasivo && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">
              {modalMasivo.titulo}
            </h2>
            <p className="text-sm text-slate-600 mb-4">{modalMasivo.descripcion}</p>
            <p className="text-sm text-slate-700 mb-4">
              Se aplicará a <strong>{modalMasivo.count}</strong> registros.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary text-xs" onClick={() => setModalMasivo(null)}>
                Cancelar
              </button>
              <button
                className="btn-primary text-xs"
                onClick={() => ejecutarMasivo(modalMasivo.accion)}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ---------------------------------------------------------------------------
// Card por dudoso
// ---------------------------------------------------------------------------

interface CardProps {
  dudoso: Dudoso
  expandido: boolean
  onToggle: () => void
  onResolver: (
    accion: AccionResolucion,
    datos?: Record<string, unknown> | null,
    opts?: { siguiente?: boolean }
  ) => void
  resolving: boolean
  companias: Catalogo[]
  ramos: Catalogo[]
  coberturas: Catalogo[]
}

function CardDudoso({
  dudoso,
  expandido,
  onToggle,
  onResolver,
  resolving,
  companias,
  ramos,
  coberturas,
}: CardProps) {
  const ent = dudoso.datos_originales?.entidades || {}

  return (
    <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full text-left p-4 hover:bg-slate-50 flex items-start gap-3"
      >
        <div className="mt-0.5">
          {expandido ? (
            <ChevronDown className="w-4 h-4 text-slate-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className={`text-2xs px-2 py-0.5 rounded border font-medium ${colorTipo(
                dudoso.tipo_problema
              )}`}
            >
              {LABEL_TIPO_PROBLEMA[dudoso.tipo_problema]}
            </span>
            <span className="text-2xs text-slate-500">
              Fila {dudoso.numero_fila_archivo}
              {dudoso.archivo_origen ? ` · ${dudoso.archivo_origen}` : ''}
            </span>
          </div>
          <div className="text-sm font-medium text-slate-900">{tituloEntidad(dudoso)}</div>
          <div className="text-xs text-slate-600 mt-0.5">{dudoso.descripcion_problema}</div>
          {dudoso.sugerencia_ia && (
            <div className="text-xs text-slate-500 italic mt-1 flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> {dudoso.sugerencia_ia}
            </div>
          )}
        </div>
      </button>

      {/* Expandido */}
      {expandido && (
        <div className="border-t border-slate-200 p-4 bg-slate-50 space-y-4">
          {/* Datos originales */}
          <div>
            <div className="text-xs font-semibold text-slate-700 mb-2">
              Datos originales del archivo
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              <DlEntidad titulo="Persona" obj={ent.persona} />
              <DlEntidad titulo="Póliza" obj={ent.poliza} />
              <DlEntidad titulo="Riesgo" obj={ent.riesgo} />
            </div>
          </div>

          {/* Propuesta */}
          {dudoso.datos_propuestos && (
            <div>
              <div className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Propuesta del sistema
              </div>
              <pre className="text-2xs bg-white border border-slate-200 rounded p-2 overflow-auto font-mono text-slate-800">
                {JSON.stringify(dudoso.datos_propuestos, null, 2)}
              </pre>
            </div>
          )}

          {/* UI específica por tipo */}
          <ResolutorPorTipo
            dudoso={dudoso}
            onResolver={onResolver}
            resolving={resolving}
            onCancelar={onToggle}
            companias={companias}
            ramos={ramos}
            coberturas={coberturas}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Resolutor por tipo
// ---------------------------------------------------------------------------

interface ResolutorProps {
  dudoso: Dudoso
  onResolver: (
    accion: AccionResolucion,
    datos?: Record<string, unknown> | null,
    opts?: { siguiente?: boolean }
  ) => void
  onCancelar: () => void
  resolving: boolean
  companias: Catalogo[]
  ramos: Catalogo[]
  coberturas: Catalogo[]
}

function ResolutorPorTipo(props: ResolutorProps) {
  const { dudoso } = props
  switch (dudoso.tipo_problema) {
    case 'DNI_INVALIDO':
    case 'DNI_FALTANTE':
      return <ResolutorDNI {...props} />
    case 'EMAIL_INVALIDO':
      return <ResolutorEmail {...props} />
    case 'FECHA_INVALIDA':
      return <ResolutorFecha {...props} />
    case 'MONTO_INVALIDO':
      return <ResolutorMonto {...props} />
    case 'DUPLICADO_EN_CRM':
      return <ResolutorDuplicadoCRM {...props} />
    case 'DUPLICADO_EN_ARCHIVO':
      return <ResolutorDuplicadoArchivo {...props} />
    case 'DATOS_FALTANTES':
      return <ResolutorDatosFaltantes {...props} />
    case 'COMPANIA_NO_RECONOCIDA':
      return <ResolutorCatalogo {...props} tipo="compania" />
    case 'RAMO_NO_RECONOCIDO':
      return <ResolutorCatalogo {...props} tipo="ramo" />
    case 'COBERTURA_NO_RECONOCIDA':
      return <ResolutorCatalogo {...props} tipo="cobertura" />
    case 'RIESGO_INCOMPLETO':
      return <ResolutorRiesgo {...props} />
    case 'INCONSISTENCIA_LOGICA':
    case 'OTROS':
    default:
      return <ResolutorGenerico {...props} />
  }
}

// Footer común ---------------------------------------------------------------

function FooterAcciones({
  aplicar,
  onCancelar,
  resolving,
  valido,
}: {
  aplicar: (siguiente: boolean) => void
  onCancelar: () => void
  resolving: boolean
  valido: boolean
}) {
  return (
    <div className="flex gap-2 pt-3 border-t border-slate-200">
      <button
        className="btn-primary text-xs disabled:opacity-50"
        disabled={!valido || resolving}
        onClick={() => aplicar(true)}
      >
        {resolving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Aplicar y siguiente'}
      </button>
      <button
        className="btn-secondary text-xs disabled:opacity-50"
        disabled={!valido || resolving}
        onClick={() => aplicar(false)}
      >
        Aplicar y volver
      </button>
      <button
        className="btn-secondary text-xs ml-auto"
        onClick={onCancelar}
        disabled={resolving}
      >
        Cancelar
      </button>
    </div>
  )
}

// RadioOption helper
function RadioOption({
  checked,
  onChange,
  label,
  hint,
  children,
}: {
  checked: boolean
  onChange: () => void
  label: string
  hint?: string
  children?: React.ReactNode
}) {
  return (
    <label className="flex items-start gap-2 p-2 rounded hover:bg-white cursor-pointer">
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="mt-0.5"
      />
      <div className="flex-1">
        <div className="text-xs font-medium text-slate-800">{label}</div>
        {hint && <div className="text-2xs text-slate-500">{hint}</div>}
        {checked && children && <div className="mt-2">{children}</div>}
      </div>
    </label>
  )
}

// Resolutor DNI --------------------------------------------------------------

function ResolutorDNI({ dudoso, onResolver, onCancelar, resolving }: ResolutorProps) {
  const [opt, setOpt] = useState<'editar' | 'ignorar' | 'placeholder'>('editar')
  const [valor, setValor] = useState(
    String(dudoso.datos_originales?.entidades?.persona?.dni_cuil ?? '')
  )
  const validacion = useMemo(() => validarDNI(valor), [valor])
  const valido =
    opt === 'editar' ? validacion.valido : true

  const aplicar = (siguiente: boolean) => {
    if (opt === 'editar') {
      onResolver('EDITAR', { dni_cuil: validacion.normalizado }, { siguiente })
    } else if (opt === 'ignorar') {
      onResolver('IGNORAR_REGISTRO', undefined, { siguiente })
    } else {
      onResolver(
        'EDITAR',
        { dni_cuil: `SIN-DNI-${Date.now()}` },
        { siguiente }
      )
    }
  }

  useKeyboardShortcuts({ onEnter: valido && !resolving ? () => aplicar(true) : undefined, onEsc: onCancelar })

  return (
    <div className="space-y-2">
      <RadioOption
        checked={opt === 'editar'}
        onChange={() => setOpt('editar')}
        label="Editar manualmente"
      >
        <div className="flex items-center gap-2">
          <input
            type="text"
            className="form-input text-xs py-1 w-48"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="DNI"
            autoFocus
          />
          {validacion.valido ? (
            <CheckCircle2 className="w-4 h-4 text-green-600" />
          ) : (
            <XCircle className="w-4 h-4 text-red-500" />
          )}
          {!validacion.valido && validacion.motivo && (
            <span className="text-2xs text-red-600">{validacion.motivo}</span>
          )}
        </div>
      </RadioOption>
      <RadioOption
        checked={opt === 'ignorar'}
        onChange={() => setOpt('ignorar')}
        label="Ignorar este registro"
        hint="No se importará"
      />
      <RadioOption
        checked={opt === 'placeholder'}
        onChange={() => setOpt('placeholder')}
        label="Importar con DNI placeholder (no recomendado)"
        hint="Se asignará un identificador único temporal"
      />
      <FooterAcciones aplicar={aplicar} onCancelar={onCancelar} resolving={resolving} valido={valido} />
    </div>
  )
}

// Resolutor Email ------------------------------------------------------------

function ResolutorEmail({ dudoso, onResolver, onCancelar, resolving }: ResolutorProps) {
  const original = String(dudoso.datos_originales?.entidades?.persona?.email ?? '')
  const [opt, setOpt] = useState<'editar' | 'vacio' | 'aceptar'>('editar')
  const [valor, setValor] = useState(original)
  const validacion = useMemo(() => validarEmail(valor), [valor])
  const valido = opt === 'editar' ? validacion.valido : true

  const aplicar = (siguiente: boolean) => {
    if (opt === 'editar') onResolver('EDITAR', { email: validacion.normalizado }, { siguiente })
    else if (opt === 'vacio') onResolver('EDITAR', { email: null }, { siguiente })
    else onResolver('EDITAR', { email: original }, { siguiente })
  }

  useKeyboardShortcuts({ onEnter: valido && !resolving ? () => aplicar(true) : undefined, onEsc: onCancelar })

  return (
    <div className="space-y-2">
      <RadioOption checked={opt === 'editar'} onChange={() => setOpt('editar')} label="Editar email">
        <div className="flex items-center gap-2">
          <input
            type="email"
            className="form-input text-xs py-1 w-72"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            autoFocus
          />
          {validacion.valido ? (
            <CheckCircle2 className="w-4 h-4 text-green-600" />
          ) : (
            <XCircle className="w-4 h-4 text-red-500" />
          )}
        </div>
      </RadioOption>
      <RadioOption checked={opt === 'vacio'} onChange={() => setOpt('vacio')} label="Dejar vacío" />
      <RadioOption
        checked={opt === 'aceptar'}
        onChange={() => setOpt('aceptar')}
        label="Aceptar como está"
        hint="Se importará con el valor original"
      />
      <FooterAcciones aplicar={aplicar} onCancelar={onCancelar} resolving={resolving} valido={valido} />
    </div>
  )
}

// Resolutor Fecha ------------------------------------------------------------

function ResolutorFecha({ dudoso, onResolver, onCancelar, resolving }: ResolutorProps) {
  const campoRaw = dudoso.datos_originales?.campo
  const campo: string = Array.isArray(campoRaw) ? (campoRaw[0] ?? 'fecha') : (campoRaw || 'fecha')
  const [opt, setOpt] = useState<'editar' | 'vacio' | 'ignorar'>('editar')
  const [valor, setValor] = useState('')
  const validacion = useMemo(() => validarFecha(valor), [valor])
  const valido = opt === 'editar' ? validacion.valido : true

  const aplicar = (siguiente: boolean) => {
    if (opt === 'editar')
      onResolver('EDITAR', { [campo]: validacion.fecha_iso }, { siguiente })
    else if (opt === 'vacio') onResolver('EDITAR', { [campo]: null }, { siguiente })
    else onResolver('IGNORAR_REGISTRO', undefined, { siguiente })
  }

  useKeyboardShortcuts({ onEnter: valido && !resolving ? () => aplicar(true) : undefined, onEsc: onCancelar })

  return (
    <div className="space-y-2">
      <RadioOption checked={opt === 'editar'} onChange={() => setOpt('editar')} label={`Editar ${campo}`}>
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="form-input text-xs py-1"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            autoFocus
          />
          {validacion.valido && <CheckCircle2 className="w-4 h-4 text-green-600" />}
        </div>
      </RadioOption>
      <RadioOption checked={opt === 'vacio'} onChange={() => setOpt('vacio')} label="Dejar vacío" />
      <RadioOption checked={opt === 'ignorar'} onChange={() => setOpt('ignorar')} label="Ignorar registro" />
      <FooterAcciones aplicar={aplicar} onCancelar={onCancelar} resolving={resolving} valido={valido} />
    </div>
  )
}

// Resolutor Monto ------------------------------------------------------------

function ResolutorMonto({ dudoso, onResolver, onCancelar, resolving }: ResolutorProps) {
  const campoRaw = dudoso.datos_originales?.campo
  const campo: string = Array.isArray(campoRaw) ? (campoRaw[0] ?? 'monto') : (campoRaw || 'monto')
  const [opt, setOpt] = useState<'editar' | 'cero' | 'ignorar'>('editar')
  const [valor, setValor] = useState('')
  const validacion = useMemo(() => validarMonto(valor), [valor])
  const valido = opt === 'editar' ? validacion.valido : true

  const aplicar = (siguiente: boolean) => {
    if (opt === 'editar') onResolver('EDITAR', { [campo]: validacion.valor }, { siguiente })
    else if (opt === 'cero') onResolver('EDITAR', { [campo]: 0 }, { siguiente })
    else onResolver('IGNORAR_REGISTRO', undefined, { siguiente })
  }

  useKeyboardShortcuts({ onEnter: valido && !resolving ? () => aplicar(true) : undefined, onEsc: onCancelar })

  return (
    <div className="space-y-2">
      <RadioOption checked={opt === 'editar'} onChange={() => setOpt('editar')} label={`Editar ${campo}`}>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            className="form-input text-xs py-1 w-40"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder="0.00"
            autoFocus
          />
          {validacion.valido && <CheckCircle2 className="w-4 h-4 text-green-600" />}
        </div>
      </RadioOption>
      <RadioOption checked={opt === 'cero'} onChange={() => setOpt('cero')} label="Aceptar como 0" />
      <RadioOption checked={opt === 'ignorar'} onChange={() => setOpt('ignorar')} label="Ignorar registro" />
      <FooterAcciones aplicar={aplicar} onCancelar={onCancelar} resolving={resolving} valido={valido} />
    </div>
  )
}

// Resolutor Duplicado CRM -----------------------------------------------------

function ResolutorDuplicadoCRM({ dudoso, onResolver, onCancelar, resolving }: ResolutorProps) {
  const [opt, setOpt] = useState<'actualizar' | 'mantener' | 'crear'>('actualizar')
  const existente = dudoso.datos_originales?.match_existente
  const nuevo = dudoso.datos_originales?.entidades?.persona ||
    dudoso.datos_originales?.entidades?.poliza ||
    dudoso.datos_originales?.entidades?.riesgo

  const aplicar = (siguiente: boolean) => {
    if (opt === 'actualizar') onResolver('ACTUALIZAR_EXISTENTE', undefined, { siguiente })
    else if (opt === 'mantener') onResolver('IGNORAR_REGISTRO', undefined, { siguiente })
    else onResolver('CREAR_NUEVO', undefined, { siguiente })
  }

  useKeyboardShortcuts({ onEnter: !resolving ? () => aplicar(true) : undefined, onEsc: onCancelar })

  return (
    <div className="space-y-2">
      <div className="grid md:grid-cols-2 gap-3 mb-2">
        <DlEntidad titulo="Nuevo (del archivo)" obj={nuevo} />
        {existente ? (
          <DlEntidad titulo="Existente en CRM" obj={existente} />
        ) : (
          <div className="border border-slate-200 rounded-md p-3 bg-white text-xs text-slate-500 italic">
            Datos del existente no disponibles
          </div>
        )}
      </div>
      <RadioOption
        checked={opt === 'actualizar'}
        onChange={() => setOpt('actualizar')}
        label="Actualizar el existente con datos nuevos"
      />
      <RadioOption
        checked={opt === 'mantener'}
        onChange={() => setOpt('mantener')}
        label="Mantener el existente (ignorar el nuevo)"
      />
      <RadioOption
        checked={opt === 'crear'}
        onChange={() => setOpt('crear')}
        label="Crear como nuevo registro (forzar)"
      />
      <FooterAcciones aplicar={aplicar} onCancelar={onCancelar} resolving={resolving} valido={true} />
    </div>
  )
}

// Resolutor Duplicado Archivo ------------------------------------------------

function ResolutorDuplicadoArchivo({ dudoso, onResolver, onCancelar, resolving }: ResolutorProps) {
  const [opt, setOpt] = useState<'combinar' | 'todos' | 'ignorar'>('combinar')

  const aplicar = (siguiente: boolean) => {
    if (opt === 'combinar') onResolver('EDITAR', {}, { siguiente })
    else if (opt === 'todos') onResolver('CREAR_NUEVO', undefined, { siguiente })
    else onResolver('IGNORAR_REGISTRO', undefined, { siguiente })
  }

  useKeyboardShortcuts({ onEnter: !resolving ? () => aplicar(true) : undefined, onEsc: onCancelar })

  return (
    <div className="space-y-2">
      <RadioOption checked={opt === 'combinar'} onChange={() => setOpt('combinar')} label="Combinar (mantener solo este)" />
      <RadioOption checked={opt === 'todos'} onChange={() => setOpt('todos')} label="Importar todos como independientes" />
      <RadioOption checked={opt === 'ignorar'} onChange={() => setOpt('ignorar')} label="Ignorar este" />
      <FooterAcciones aplicar={aplicar} onCancelar={onCancelar} resolving={resolving} valido={true} />
    </div>
  )
}

// Resolutor Datos Faltantes --------------------------------------------------

function ResolutorDatosFaltantes({ dudoso, onResolver, onCancelar, resolving }: ResolutorProps) {
  const campos: string[] = useMemo(() => {
    const c = dudoso.datos_originales?.campo
    if (Array.isArray(c)) return c
    if (typeof c === 'string') return [c]
    // Inferir desde descripción si incluye "faltan: a, b, c"
    const m = dudoso.descripcion_problema.match(/faltan[:\s]+([^.]+)/i)
    if (m) return m[1].split(/[,;]/).map((s) => s.trim()).filter(Boolean)
    return []
  }, [dudoso])

  const [opt, setOpt] = useState<'completar' | 'ignorar'>('completar')
  const [valores, setValores] = useState<Record<string, string>>({})
  const valido = opt === 'ignorar' || campos.every((c) => (valores[c] ?? '').trim() !== '')

  const aplicar = (siguiente: boolean) => {
    if (opt === 'completar') onResolver('EDITAR', valores, { siguiente })
    else onResolver('IGNORAR_REGISTRO', undefined, { siguiente })
  }

  useKeyboardShortcuts({ onEnter: valido && !resolving ? () => aplicar(true) : undefined, onEsc: onCancelar })

  return (
    <div className="space-y-2">
      <RadioOption checked={opt === 'completar'} onChange={() => setOpt('completar')} label="Completar manualmente">
        <div className="space-y-2">
          {campos.length === 0 && (
            <p className="text-2xs text-slate-500 italic">
              No se pudieron inferir los campos faltantes. Usá "Ignorar registro".
            </p>
          )}
          {campos.map((c) => (
            <div key={c} className="flex items-center gap-2">
              <label className="text-xs text-slate-600 min-w-[120px]">{c}</label>
              <input
                type="text"
                className="form-input text-xs py-1 flex-1"
                value={valores[c] ?? ''}
                onChange={(e) => setValores({ ...valores, [c]: e.target.value })}
              />
            </div>
          ))}
        </div>
      </RadioOption>
      <RadioOption checked={opt === 'ignorar'} onChange={() => setOpt('ignorar')} label="Ignorar registro" />
      <FooterAcciones aplicar={aplicar} onCancelar={onCancelar} resolving={resolving} valido={valido} />
    </div>
  )
}

// Resolutor Catálogo (Compañía/Ramo) -----------------------------------------

function ResolutorCatalogo({
  dudoso,
  onResolver,
  onCancelar,
  resolving,
  companias,
  ramos,
  coberturas,
  tipo,
}: ResolutorProps & { tipo: 'compania' | 'ramo' | 'cobertura' }) {
  const lista = tipo === 'compania' ? companias : tipo === 'ramo' ? ramos : coberturas
  const etiqueta = tipo === 'compania' ? 'compañía' : tipo === 'ramo' ? 'ramo' : 'cobertura'
  const original = String(dudoso.datos_originales?.valor_original ?? '')
  const [opt, setOpt] = useState<'mapear' | 'crear' | 'ignorar'>('mapear')
  const [catalogoId, setCatalogoId] = useState('')
  const [nombreNuevo, setNombreNuevo] = useState(original)
  // Solo aplica cuando se crea un ramo nuevo: el PAS elige qué tipo de riesgo
  // controla el formulario de carga de pólizas/siniestros para este ramo.
  const [tipoRiesgo, setTipoRiesgo] = useState<string>('generico')

  const valido =
    opt === 'mapear' ? catalogoId !== '' : opt === 'crear' ? nombreNuevo.trim() !== '' : true

  const aplicar = (siguiente: boolean) => {
    if (opt === 'mapear') {
      onResolver('EDITAR', { [`${tipo}_id`]: catalogoId }, { siguiente })
    } else if (opt === 'crear') {
      const payload: Record<string, unknown> = {
        crear_nuevo: true,
        nombre: nombreNuevo.trim(),
        tipo,
      }
      if (tipo === 'ramo') payload.tipo_riesgo = tipoRiesgo
      onResolver('EDITAR', payload, { siguiente })
    } else {
      onResolver('IGNORAR_REGISTRO', undefined, { siguiente })
    }
  }

  useKeyboardShortcuts({ onEnter: valido && !resolving ? () => aplicar(true) : undefined, onEsc: onCancelar })

  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-600">
        Nombre recibido: <span className="font-mono font-medium text-slate-900">{original}</span>
      </div>
      <RadioOption checked={opt === 'mapear'} onChange={() => setOpt('mapear')} label="Mapear a existente">
        <select
          className="form-input text-xs py-1"
          value={catalogoId}
          onChange={(e) => setCatalogoId(e.target.value)}
        >
          <option value="">— Seleccionar —</option>
          {lista.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </RadioOption>
      <RadioOption
        checked={opt === 'crear'}
        onChange={() => setOpt('crear')}
        label={`Crear nueva ${etiqueta}`}
      >
        <div className="space-y-2">
          <input
            type="text"
            className="form-input text-xs py-1 w-72"
            value={nombreNuevo}
            onChange={(e) => setNombreNuevo(e.target.value)}
          />
          {tipo === 'ramo' && (
            <div className="flex items-center gap-2">
              <label className="text-2xs text-slate-600 min-w-[110px]">Tipo de riesgo:</label>
              <select
                className="form-input text-xs py-1 flex-1 max-w-[280px]"
                value={tipoRiesgo}
                onChange={(e) => setTipoRiesgo(e.target.value)}
              >
                {TIPOS_RIESGO.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.emoji} {t.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {tipo === 'ramo' && (
            <p className="text-2xs text-slate-500">
              El tipo de riesgo define qué campos pide el formulario de pólizas/siniestros para este ramo.
            </p>
          )}
        </div>
      </RadioOption>
      <RadioOption
        checked={opt === 'ignorar'}
        onChange={() => setOpt('ignorar')}
        label={`Ignorar registros con esta ${etiqueta}`}
      />
      <FooterAcciones aplicar={aplicar} onCancelar={onCancelar} resolving={resolving} valido={valido} />
    </div>
  )
}

// Resolutor Riesgo -----------------------------------------------------------

function ResolutorRiesgo({ dudoso, onResolver, onCancelar, resolving }: ResolutorProps) {
  const [opt, setOpt] = useState<'completar' | 'generico' | 'ignorar'>('completar')
  const [valores, setValores] = useState<Record<string, string>>({})
  const [descripcion, setDescripcion] = useState('')

  const campos: string[] = useMemo(() => {
    const c = dudoso.datos_originales?.campo
    if (Array.isArray(c)) return c
    if (typeof c === 'string') return [c]
    return []
  }, [dudoso])

  const valido =
    opt === 'completar'
      ? campos.length > 0 && campos.every((c) => (valores[c] ?? '').trim() !== '')
      : opt === 'generico'
      ? descripcion.trim() !== ''
      : true

  const aplicar = (siguiente: boolean) => {
    if (opt === 'completar') onResolver('EDITAR', { detalle_tecnico: valores }, { siguiente })
    else if (opt === 'generico')
      onResolver('EDITAR', { tipo_riesgo: 'GENERICO', descripcion_corta: descripcion }, { siguiente })
    else onResolver('IGNORAR_REGISTRO', undefined, { siguiente })
  }

  useKeyboardShortcuts({ onEnter: valido && !resolving ? () => aplicar(true) : undefined, onEsc: onCancelar })

  return (
    <div className="space-y-2">
      <RadioOption checked={opt === 'completar'} onChange={() => setOpt('completar')} label="Completar manualmente">
        {campos.length === 0 && (
          <p className="text-2xs text-slate-500 italic">Campos faltantes no detectados.</p>
        )}
        <div className="space-y-2">
          {campos.map((c) => (
            <div key={c} className="flex items-center gap-2">
              <label className="text-xs text-slate-600 min-w-[120px]">{c}</label>
              <input
                type="text"
                className="form-input text-xs py-1 flex-1"
                value={valores[c] ?? ''}
                onChange={(e) => setValores({ ...valores, [c]: e.target.value })}
              />
            </div>
          ))}
        </div>
      </RadioOption>
      <RadioOption
        checked={opt === 'generico'}
        onChange={() => setOpt('generico')}
        label="Crear riesgo genérico con descripción libre"
      >
        <input
          type="text"
          className="form-input text-xs py-1 w-full"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Descripción del riesgo"
        />
      </RadioOption>
      <RadioOption checked={opt === 'ignorar'} onChange={() => setOpt('ignorar')} label="Ignorar póliza" />
      <FooterAcciones aplicar={aplicar} onCancelar={onCancelar} resolving={resolving} valido={valido} />
    </div>
  )
}

// Resolutor Genérico ---------------------------------------------------------

function ResolutorGenerico({ dudoso, onResolver, onCancelar, resolving }: ResolutorProps) {
  const [opt, setOpt] = useState<'corregir' | 'ignorar'>('corregir')
  const [json, setJson] = useState('{}')
  let valido = true
  if (opt === 'corregir') {
    try {
      JSON.parse(json)
    } catch {
      valido = false
    }
  }

  const aplicar = (siguiente: boolean) => {
    if (opt === 'corregir') {
      try {
        onResolver('EDITAR', JSON.parse(json), { siguiente })
      } catch {
        /* ignore */
      }
    } else {
      onResolver('IGNORAR_REGISTRO', undefined, { siguiente })
    }
  }

  useKeyboardShortcuts({ onEnter: valido && !resolving ? () => aplicar(true) : undefined, onEsc: onCancelar })

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 text-xs text-slate-600 bg-white border border-slate-200 rounded p-2">
        <Info className="w-4 h-4 mt-0.5" /> {dudoso.descripcion_problema}
      </div>
      <RadioOption checked={opt === 'corregir'} onChange={() => setOpt('corregir')} label="Aceptar y corregir manualmente (JSON)">
        <textarea
          className="form-input text-2xs font-mono py-1 w-full min-h-[120px]"
          value={json}
          onChange={(e) => setJson(e.target.value)}
        />
      </RadioOption>
      <RadioOption checked={opt === 'ignorar'} onChange={() => setOpt('ignorar')} label="Ignorar registro" />
      <FooterAcciones aplicar={aplicar} onCancelar={onCancelar} resolving={resolving} valido={valido} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hook atajos de teclado
// ---------------------------------------------------------------------------

function useKeyboardShortcuts({
  onEnter,
  onEsc,
}: {
  onEnter?: () => void
  onEsc?: () => void
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Evitar interceptar enter dentro de textareas
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (e.key === 'Enter' && onEnter && tag !== 'textarea') {
        e.preventDefault()
        onEnter()
      } else if (e.key === 'Escape' && onEsc) {
        e.preventDefault()
        onEsc()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onEnter, onEsc])
}
