'use client'

// ============================================================
// Card que muestra el análisis de cambios entre la póliza anterior
// y la renovación, DENTRO del wizard de revisión del agente PDF
// (/crm/agente-pdf/[id]/revisar). Se muestra antes del botón de
// aprobar para que el PAS tenga la info al tomar la decisión.
//
// UX explícitamente sin badges de severidad — el PAS pidió que el
// diff se muestre limpio, no con etiquetas alta/media/baja.
// ============================================================

import { useMemo, useState } from 'react'
import {
  Sparkles, Loader2, AlertTriangle, CheckCircle2, ArrowRight, FileText, X,
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { formatFechaLocalLarga } from '@/lib/utils'
import type { ComparacionResultado, CambioComparacion } from '@/lib/hooks/useAgentePDFPolling'

interface ArchivoOrigen {
  id: string
  nombre: string
  ruta: string
  categoria: string
  created_at: string
}

interface Props {
  procesamientoId: string
  polizaOrigenId: string | null
  comparacion: ComparacionResultado | null
  estadoProcesamiento: string  // PENDIENTE / PROCESANDO / EXTRAIDO / ...
  onCambio?: () => void
}

export default function ComparacionEnRevision({
  procesamientoId,
  polizaOrigenId,
  comparacion,
  estadoProcesamiento,
  onCambio,
}: Props) {
  const supabase = getSupabaseClient()
  const [mostrarCosmeticos, setMostrarCosmeticos] = useState(false)
  const [modalAbierto, setModalAbierto] = useState(false)
  const [archivosOrigen, setArchivosOrigen] = useState<ArchivoOrigen[]>([])
  const [archivoElegido, setArchivoElegido] = useState<string | null>(null)
  const [cargandoArchivos, setCargandoArchivos] = useState(false)
  const [ejecutando, setEjecutando] = useState(false)

  const cambios: CambioComparacion[] = comparacion?.cambios || []
  const materiales = cambios.filter(c => c.tipo === 'material')
  const cosmeticos = cambios.filter(c => c.tipo === 'cosmético')
  const cambiosMostrados = mostrarCosmeticos ? cambios : materiales

  const porCategoria = useMemo(() => {
    const map = new Map<string, CambioComparacion[]>()
    for (const c of cambiosMostrados) {
      const key = c.categoria || 'Otros'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(c)
    }
    return Array.from(map.entries())
  }, [cambiosMostrados])

  const abrirModal = async () => {
    if (!polizaOrigenId) return
    setModalAbierto(true)
    setCargandoArchivos(true)
    const { data } = await supabase
      .from('poliza_archivos')
      .select('id, nombre, ruta, categoria, created_at')
      .eq('poliza_id', polizaOrigenId)
      .in('categoria', ['documentacion', 'documentacion_renovada'])
      .order('created_at', { ascending: false })
    setArchivosOrigen((data || []) as ArchivoOrigen[])
    setCargandoArchivos(false)
  }

  const ejecutar = async () => {
    if (!archivoElegido) {
      toast.error('Elegí un archivo antes de comparar')
      return
    }
    setEjecutando(true)
    const res = await apiCall(`/api/agente-pdf/${procesamientoId}/comparar-manual`, {
      method: 'POST',
      body: { archivo_viejo_id: archivoElegido },
    })
    setEjecutando(false)
    if (res.ok) {
      toast.exito('Análisis completado')
      setModalAbierto(false)
      setArchivoElegido(null)
      onCambio?.()
    }
  }

  // Solo tiene sentido en renovaciones con póliza origen. Si no hay origen,
  // no mostramos nada.
  if (!polizaOrigenId) return null

  const procesando = estadoProcesamiento === 'PENDIENTE' || estadoProcesamiento === 'PROCESANDO'

  // Mientras el procesamiento está corriendo (extracción + comparación en
  // paralelo), no tenemos resultado todavía. Mostramos placeholder discreto.
  if (procesando && !comparacion) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-2.5">
        <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
        <p className="text-xs text-slate-600">
          <span className="font-medium text-slate-800">Analizando cambios con la póliza anterior…</span>{' '}
          El resultado va a aparecer acá cuando termine.
        </p>
      </div>
    )
  }

  // Sin comparación y sin procesamiento activo: la póliza origen no tenía
  // archivo principal marcado. Ofrecemos al PAS elegir cuál PDF usar.
  if (!comparacion) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-white flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-800">Análisis de cambios</h3>
        </div>
        <div className="p-4 flex flex-col gap-2">
          <p className="text-xs text-slate-600">
            La póliza anterior no tiene un PDF marcado como referencia. Elegí uno de los archivos
            cargados para comparar con esta renovación.
          </p>
          <button onClick={abrirModal} className="btn-primary text-sm self-start">
            <Sparkles className="h-4 w-4" /> Elegir PDF anterior y comparar
          </button>
        </div>

        {modalAbierto && (
          <ModalElegirArchivo
            cargando={cargandoArchivos}
            archivos={archivosOrigen}
            elegido={archivoElegido}
            onElegir={setArchivoElegido}
            onCancelar={() => setModalAbierto(false)}
            onComparar={ejecutar}
            ejecutando={ejecutando}
          />
        )}
      </div>
    )
  }

  // FALLIDA
  if (comparacion.estado === 'FALLIDA') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2.5">
        <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-red-900">No se pudo comparar con la póliza anterior</p>
          <p className="text-xs text-red-700 mt-0.5">{comparacion.error || 'Error desconocido'}</p>
          <button onClick={abrirModal} className="mt-2 text-xs text-red-700 underline">
            Reintentar con otro PDF
          </button>
        </div>

        {modalAbierto && (
          <ModalElegirArchivo
            cargando={cargandoArchivos}
            archivos={archivosOrigen}
            elegido={archivoElegido}
            onElegir={setArchivoElegido}
            onCancelar={() => setModalAbierto(false)}
            onComparar={ejecutar}
            ejecutando={ejecutando}
          />
        )}
      </div>
    )
  }

  // COMPLETADA
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-white flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-blue-600" />
        <h3 className="text-sm font-semibold text-slate-800">Análisis de cambios vs. póliza anterior</h3>
      </div>

      <div className="p-4 flex flex-col gap-3">
        {/* Resumen */}
        <div className={`border rounded p-3 flex items-start gap-2 ${
          materiales.length === 0
            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
            : 'bg-amber-50 border-amber-200 text-amber-900'
        }`}>
          {materiales.length === 0 ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          )}
          <p className="text-sm">{comparacion.resumen || 'Análisis completado'}</p>
        </div>

        {/* Contadores + toggle cosméticos */}
        <div className="flex items-center gap-4 text-xs">
          <span className="text-slate-600">
            <span className="font-semibold text-slate-800">{materiales.length}</span>{' '}
            cambio{materiales.length !== 1 ? 's' : ''} material{materiales.length !== 1 ? 'es' : ''}
          </span>
          {cosmeticos.length > 0 && (
            <button
              onClick={() => setMostrarCosmeticos(v => !v)}
              className="text-slate-500 hover:text-slate-800 underline"
            >
              {mostrarCosmeticos ? 'Ocultar' : 'Ver'} {cosmeticos.length} cosmético{cosmeticos.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>

        {/* Lista de cambios agrupados por categoría — SIN badges de severidad */}
        {porCategoria.length === 0 && (
          <p className="text-xs text-slate-500 italic">Sin cambios que mostrar.</p>
        )}

        {porCategoria.map(([categoria, items]) => (
          <div key={categoria} className="border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200">
              <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">{categoria}</p>
            </div>
            <ul className="divide-y divide-slate-100">
              {items.map((c, i) => (
                <li key={i} className="px-3 py-2.5 flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-slate-800">{c.campo}</span>
                    {c.tipo === 'cosmético' && (
                      <span className="text-2xs text-slate-400 italic">cosmético</span>
                    )}
                  </div>
                  {(c.antes || c.ahora) && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500 line-through">{c.antes || '—'}</span>
                      <ArrowRight className="h-3 w-3 text-slate-400 shrink-0" />
                      <span className="text-slate-800 font-medium">{c.ahora || '—'}</span>
                    </div>
                  )}
                  <p className="text-xs text-slate-600 leading-relaxed">{c.descripcion}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* Footer discreto con costo/tiempo */}
        <div className="text-2xs text-slate-400 pt-1 border-t border-slate-100">
          Análisis IA
          {comparacion.duracion_ms ? ` · ${Math.round(comparacion.duracion_ms / 1000)}s` : ''}
          {comparacion.costo_usd ? ` · US$${comparacion.costo_usd.toFixed(3)}` : ''}
          {comparacion.completado_en ? ` · ${formatFechaLocalLarga(comparacion.completado_en.slice(0, 10))}` : ''}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Modal auxiliar para elegir cuál PDF de la póliza origen usar
// ─────────────────────────────────────────────────────────────
function ModalElegirArchivo({
  cargando,
  archivos,
  elegido,
  onElegir,
  onCancelar,
  onComparar,
  ejecutando,
}: {
  cargando: boolean
  archivos: ArchivoOrigen[]
  elegido: string | null
  onElegir: (id: string) => void
  onCancelar: () => void
  onComparar: () => void
  ejecutando: boolean
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col" style={{ height: '80vh' }}>
        <div className="shrink-0 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Elegí el PDF de la póliza anterior</h3>
          <button onClick={onCancelar} className="text-slate-400 hover:text-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 min-h-0">
          <p className="text-xs text-slate-600 mb-3">
            Vamos a recordar tu elección — la próxima renovación se compara sola.
          </p>
          {cargando ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando archivos…
            </div>
          ) : archivos.length === 0 ? (
            <div className="border border-slate-200 rounded p-4 text-sm text-slate-500 text-center">
              La póliza anterior no tiene ningún PDF cargado.
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {archivos.map(a => (
                <li key={a.id}>
                  <label className={`flex items-center gap-3 border rounded p-2.5 cursor-pointer hover:bg-slate-50 ${
                    elegido === a.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200'
                  }`}>
                    <input
                      type="radio"
                      name="archivo"
                      value={a.id}
                      checked={elegido === a.id}
                      onChange={() => onElegir(a.id)}
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
        <div className="shrink-0 px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
          <button onClick={onCancelar} className="btn-secondary text-sm">Cancelar</button>
          <button
            onClick={onComparar}
            disabled={!elegido || ejecutando}
            className="btn-primary text-sm"
          >
            {ejecutando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {ejecutando ? 'Comparando…' : 'Comparar'}
          </button>
        </div>
      </div>
    </div>
  )
}

