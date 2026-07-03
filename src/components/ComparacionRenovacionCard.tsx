'use client'

// ============================================================
// Componente que muestra el resultado del comparador IA entre
// una póliza renovada y su origen. Aparece en la ficha de póliza
// solo cuando es RENOVACION (tiene poliza_origen_id).
//
// Estados:
//   - Sin comparación → botón "Analizar cambios con IA" que abre
//     modal para elegir cuál PDF de la póliza origen comparar.
//   - Procesando → spinner + mensaje.
//   - Completada → lista de cambios agrupados por categoría, con
//     badges de severidad + tipo material/cosmético.
//   - Fallida → mensaje + botón "Reintentar".
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { formatFechaLocalLarga } from '@/lib/utils'
import {
  Sparkles, Loader2, RefreshCw, AlertTriangle, CheckCircle2, X, ArrowRight, FileText,
} from 'lucide-react'

interface CambioDetectado {
  categoria: string
  campo: string
  antes: string | null
  ahora: string | null
  tipo: 'material' | 'cosmético'
  severidad: 'alta' | 'media' | 'baja'
  descripcion: string
}

interface ComparacionIA {
  poliza_origen_id: string
  archivo_viejo_id: string
  archivo_nuevo_id: string
  estado: 'PROCESANDO' | 'COMPLETADA' | 'FALLIDA'
  cambios?: CambioDetectado[]
  resumen?: string
  error?: string | null
  tokens_usados?: number
  costo_usd?: number
  duracion_ms?: number
  creado_en: string
  completado_en?: string
}

interface ArchivoOrigen {
  id: string
  nombre: string
  ruta: string
  categoria: string
  created_at: string
}

interface Props {
  polizaId: string
  polizaOrigenId: string | null
  comparacionIa: ComparacionIA | null
  onCambio?: () => void
}

const COLORES_SEVERIDAD: Record<string, string> = {
  alta: 'bg-red-50 text-red-700 border-red-200',
  media: 'bg-amber-50 text-amber-700 border-amber-200',
  baja: 'bg-slate-50 text-slate-600 border-slate-200',
}

const LABEL_SEVERIDAD: Record<string, string> = {
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
}

export default function ComparacionRenovacionCard({
  polizaId,
  polizaOrigenId,
  comparacionIa,
  onCambio,
}: Props) {
  const supabase = getSupabaseClient()
  const [mostrarCosmeticos, setMostrarCosmeticos] = useState(false)
  const [modalAbierto, setModalAbierto] = useState(false)
  const [archivosOrigen, setArchivosOrigen] = useState<ArchivoOrigen[]>([])
  const [archivoElegido, setArchivoElegido] = useState<string | null>(null)
  const [iniciando, setIniciando] = useState(false)
  const [cargandoArchivos, setCargandoArchivos] = useState(false)

  // Polling suave mientras está PROCESANDO — 3s de intervalo hasta que cambia
  // el estado. Si el PAS deja la pestaña abierta, la card se actualiza sola.
  useEffect(() => {
    if (comparacionIa?.estado !== 'PROCESANDO' || !onCambio) return
    const interval = setInterval(() => onCambio(), 3000)
    return () => clearInterval(interval)
  }, [comparacionIa?.estado, onCambio])

  const cargarArchivosOrigen = useCallback(async () => {
    if (!polizaOrigenId) return
    setCargandoArchivos(true)
    const { data } = await supabase
      .from('poliza_archivos')
      .select('id, nombre, ruta, categoria, created_at')
      .eq('poliza_id', polizaOrigenId)
      .in('categoria', ['documentacion', 'documentacion_renovada'])
      .order('created_at', { ascending: false })
    setArchivosOrigen((data || []) as ArchivoOrigen[])
    setCargandoArchivos(false)
  }, [polizaOrigenId, supabase])

  const abrirModal = () => {
    setModalAbierto(true)
    void cargarArchivosOrigen()
  }

  const iniciarComparacion = async () => {
    if (!archivoElegido) {
      toast.error('Elegí un archivo antes de comparar')
      return
    }
    setIniciando(true)
    const res = await apiCall(`/api/polizas/${polizaId}/comparar-renovacion`, {
      method: 'POST',
      body: { archivo_viejo_id: archivoElegido },
    })
    setIniciando(false)
    if (res.ok) {
      toast.exito('Comparación iniciada. Te avisamos cuando termine.')
      setModalAbierto(false)
      setArchivoElegido(null)
      onCambio?.()
    }
  }

  // Derivados (calculamos ANTES del early return para no llamar hooks
  // condicionalmente — regla de hooks de React).
  const cambios = comparacionIa?.cambios || []
  const materiales = cambios.filter(c => c.tipo === 'material')
  const cosmeticos = cambios.filter(c => c.tipo === 'cosmético')
  const cambiosMostrados = mostrarCosmeticos ? cambios : materiales

  const materialesPorCategoria = useMemo(() => {
    const map = new Map<string, CambioDetectado[]>()
    for (const c of cambiosMostrados) {
      const key = c.categoria || 'Otros'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(c)
    }
    return Array.from(map.entries())
  }, [cambiosMostrados])

  // No mostrar la card si esta póliza NO es una renovación.
  if (!polizaOrigenId) return null

  return (
    <div id="comparacion-ia" className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-white flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-800">
            Análisis de cambios con IA
          </h3>
        </div>
        {comparacionIa?.estado === 'COMPLETADA' && (
          <span className="text-2xs text-slate-500 font-mono">
            {formatFechaLocalLarga((comparacionIa.completado_en || comparacionIa.creado_en).slice(0, 10))}
          </span>
        )}
      </div>

      <div className="p-4">
        {!comparacionIa && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-slate-600">
              Compará esta renovación con la póliza anterior para detectar cambios en coberturas,
              sublímites, montos y adicionales que a veces las compañías modifican sin avisar.
            </p>
            <button
              onClick={abrirModal}
              className="btn-primary text-sm"
            >
              <Sparkles className="h-4 w-4" /> Analizar cambios con IA
            </button>
          </div>
        )}

        {comparacionIa?.estado === 'PROCESANDO' && (
          <div className="flex items-center gap-3 py-2">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            <div>
              <p className="text-sm font-medium text-slate-800">Analizando cambios…</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Puede tardar unos minutos. Te avisamos por notificación cuando termine.
              </p>
            </div>
          </div>
        )}

        {comparacionIa?.estado === 'FALLIDA' && (
          <div className="flex items-start gap-3 border border-red-200 bg-red-50 rounded p-3">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-900">No se pudo completar el análisis</p>
              <p className="text-xs text-red-700 mt-0.5">
                {comparacionIa.error || 'Error desconocido'}
              </p>
              <button
                onClick={abrirModal}
                className="mt-2 text-xs text-red-700 underline hover:text-red-900"
              >
                Reintentar
              </button>
            </div>
          </div>
        )}

        {comparacionIa?.estado === 'COMPLETADA' && (
          <div className="flex flex-col gap-3">
            {/* Resumen */}
            <div className={`border rounded p-3 flex items-start gap-2 ${
              materiales.length === 0
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}>
              {materiales.length === 0 ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              )}
              <p className="text-sm">{comparacionIa.resumen || 'Análisis completado'}</p>
            </div>

            {/* Contadores */}
            <div className="flex items-center gap-4 text-xs">
              <span className="inline-flex items-center gap-1 text-slate-600">
                <span className="font-semibold text-slate-800">{materiales.length}</span>
                cambio{materiales.length !== 1 ? 's' : ''} material{materiales.length !== 1 ? 'es' : ''}
              </span>
              {cosmeticos.length > 0 && (
                <button
                  onClick={() => setMostrarCosmeticos(v => !v)}
                  className="text-slate-500 hover:text-slate-800 underline"
                >
                  {mostrarCosmeticos ? 'Ocultar' : 'Ver'} {cosmeticos.length} cambio{cosmeticos.length !== 1 ? 's' : ''} cosmético{cosmeticos.length !== 1 ? 's' : ''}
                </button>
              )}
            </div>

            {/* Cambios agrupados por categoría */}
            {materialesPorCategoria.length === 0 && (
              <p className="text-xs text-slate-500 italic">Sin cambios que mostrar.</p>
            )}

            {materialesPorCategoria.map(([categoria, items]) => (
              <div key={categoria} className="border border-slate-200 rounded overflow-hidden">
                <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200">
                  <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">{categoria}</p>
                </div>
                <ul className="divide-y divide-slate-100">
                  {items.map((c, i) => (
                    <li key={i} className="px-3 py-2.5 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-slate-800">{c.campo}</span>
                          {c.tipo === 'cosmético' && (
                            <span className="text-2xs text-slate-400 italic">(cosmético)</span>
                          )}
                        </div>
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-medium border ${COLORES_SEVERIDAD[c.severidad] || COLORES_SEVERIDAD.baja}`}>
                          {LABEL_SEVERIDAD[c.severidad] || 'Baja'}
                        </span>
                      </div>
                      {(c.antes || c.ahora) && (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-slate-500 line-through">{c.antes || '—'}</span>
                          <ArrowRight className="h-3 w-3 text-slate-400" />
                          <span className="text-slate-800 font-medium">{c.ahora || '—'}</span>
                        </div>
                      )}
                      <p className="text-xs text-slate-600 leading-relaxed">{c.descripcion}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="flex items-center justify-between border-t border-slate-100 pt-2 mt-1 text-2xs text-slate-400">
              <span>
                Análisis IA · {comparacionIa.duracion_ms ? `${Math.round(comparacionIa.duracion_ms / 1000)}s` : ''}
                {comparacionIa.costo_usd ? ` · US$${comparacionIa.costo_usd.toFixed(3)}` : ''}
              </span>
              <button
                onClick={abrirModal}
                className="text-slate-500 hover:text-slate-800 underline inline-flex items-center gap-1"
              >
                <RefreshCw className="h-3 w-3" /> Reanalizar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal para elegir PDF de la póliza origen */}
      {modalAbierto && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">
                Elegí el PDF de la póliza anterior
              </h3>
              <button onClick={() => setModalAbierto(false)} className="text-slate-400 hover:text-slate-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <p className="text-xs text-slate-600 mb-3">
                Seleccioná el PDF de la póliza vigente contra el que querés comparar esta renovación.
                Vamos a recordar tu elección para que la próxima renovación se compare sola.
              </p>
              {cargandoArchivos ? (
                <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
                  <Loader2 className="h-4 w-4 animate-spin" /> Cargando archivos…
                </div>
              ) : archivosOrigen.length === 0 ? (
                <div className="border border-slate-200 rounded p-4 text-sm text-slate-500 text-center">
                  La póliza anterior no tiene ningún PDF cargado. No hay con qué comparar.
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {archivosOrigen.map(a => (
                    <li key={a.id}>
                      <label className={`flex items-center gap-3 border rounded p-2.5 cursor-pointer hover:bg-slate-50 ${
                        archivoElegido === a.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200'
                      }`}>
                        <input
                          type="radio"
                          name="archivo"
                          value={a.id}
                          checked={archivoElegido === a.id}
                          onChange={() => setArchivoElegido(a.id)}
                          className="shrink-0"
                        />
                        <FileText className="h-4 w-4 text-slate-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-800 truncate">{a.nombre}</p>
                          <p className="text-2xs text-slate-500 mt-0.5">
                            {a.categoria === 'documentacion_renovada' ? 'Renovación pendiente' : 'Documentación'}
                            {' · '}
                            {formatFechaLocalLarga(a.created_at.slice(0, 10))}
                          </p>
                        </div>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
              <button onClick={() => setModalAbierto(false)} className="btn-secondary text-sm">
                Cancelar
              </button>
              <button
                onClick={iniciarComparacion}
                disabled={!archivoElegido || iniciando}
                className="btn-primary text-sm"
              >
                {iniciando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Comparar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
