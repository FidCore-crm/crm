'use client'

// ============================================================
// Panel lateral (drawer) que muestra el histórico del análisis
// de cambios IA de una renovación. Se abre desde un link discreto
// en la ficha de póliza. Sin polling, sin auto-refresh — solo
// lectura del resultado ya persistido en polizas.comparacion_ia.
//
// v1.0.75 — rediseñado como drawer lateral tras que el modal
// centrado con height fija seguía cortando el contenido en
// pantallas medianas. El drawer siempre tiene h-screen y usa
// flex-col con overflow-y-auto en el body — scroll garantizado
// sin depender de min-h-0 / max-h-[N vh] tricks.
// ============================================================

import { useMemo, useEffect } from 'react'
import { X, Sparkles, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react'
import { formatFechaLocalLarga } from '@/lib/utils'

interface CambioComparacion {
  categoria: string
  campo: string
  antes: string | null
  ahora: string | null
  tipo: 'material' | 'cosmético'
  severidad?: 'alta' | 'media' | 'baja'
  descripcion: string
}

export interface ComparacionIaHistorico {
  poliza_origen_id: string
  archivo_viejo_id: string
  archivo_nuevo_id?: string
  estado: 'PROCESANDO' | 'COMPLETADA' | 'FALLIDA'
  cambios?: CambioComparacion[]
  resumen?: string
  error?: string | null
  costo_usd?: number
  duracion_ms?: number
  completado_en?: string
  modo?: 'pdf_nativo' | 'texto_plano'
}

interface Props {
  comparacion: ComparacionIaHistorico
  onCerrar: () => void
}

export default function AnalisisRenovacionModal({ comparacion, onCerrar }: Props) {
  const cambios = comparacion.cambios || []
  const materiales = cambios.filter(c => c.tipo === 'material')
  const cosmeticos = cambios.filter(c => c.tipo === 'cosmético')

  const porCategoria = useMemo(() => {
    const map = new Map<string, CambioComparacion[]>()
    for (const c of materiales) {
      const key = c.categoria || 'Otros'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(c)
    }
    return Array.from(map.entries())
  }, [materiales])

  // Cerrar con Escape (accesibilidad)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCerrar])

  return (
    <div className="fixed inset-0 z-50">
      {/* Overlay clickeable para cerrar */}
      <div
        className="absolute inset-0 bg-slate-900/40"
        onClick={onCerrar}
        aria-hidden="true"
      />

      {/* Drawer lateral derecho — h-screen garantiza altura completa,
          overflow-y-auto en el body permite scroll siempre. */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Análisis de cambios vs. póliza anterior"
        className="absolute right-0 top-0 h-screen w-full sm:w-[540px] bg-white shadow-2xl border-l border-slate-200 flex flex-col"
      >
        {/* Header sticky */}
        <header className="shrink-0 px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-blue-50 to-white">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="h-4 w-4 text-blue-600 shrink-0" />
            <h3 className="text-sm font-semibold text-slate-800 truncate">
              Análisis de cambios vs. póliza anterior
            </h3>
            {comparacion.modo === 'texto_plano' && (
              <span
                className="text-2xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 shrink-0"
                title="Los PDFs eran muy extensos para procesar con layout. Se analizaron en modo texto plano — puede haber pequeños errores en tablas con muchas columnas."
              >
                Modo texto plano
              </span>
            )}
          </div>
          <button
            onClick={onCerrar}
            className="text-slate-400 hover:text-slate-800 shrink-0"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Body con scroll natural */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {comparacion.estado === 'FALLIDA' && (
            <div className="border border-red-200 bg-red-50 rounded p-3 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-900">No se pudo completar el análisis</p>
                <p className="text-xs text-red-700 mt-0.5">{comparacion.error || 'Error desconocido'}</p>
              </div>
            </div>
          )}

          {comparacion.estado === 'COMPLETADA' && (
            <>
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

              {/* Contadores */}
              <p className="text-xs text-slate-600">
                <span className="font-semibold text-slate-800">{materiales.length}</span>{' '}
                cambio{materiales.length !== 1 ? 's' : ''} material{materiales.length !== 1 ? 'es' : ''}
                {cosmeticos.length > 0 && `, ${cosmeticos.length} cosmético${cosmeticos.length !== 1 ? 's' : ''} ocultos`}
              </p>

              {porCategoria.length === 0 && (
                <p className="text-xs text-slate-500 italic">Sin cambios materiales.</p>
              )}

              {/* Grupos por categoría */}
              {porCategoria.map(([categoria, items]) => (
                <div key={categoria} className="border border-slate-200 rounded overflow-hidden">
                  <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200">
                    <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide">{categoria}</p>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {items.map((c, i) => (
                      <li key={i} className="px-3 py-2.5 flex flex-col gap-1">
                        <span className="text-xs font-medium text-slate-800">{c.campo}</span>
                        {(c.antes || c.ahora) && (
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-slate-500 line-through break-words">{c.antes || '—'}</span>
                            <ArrowRight className="h-3 w-3 text-slate-400 shrink-0" />
                            <span className="text-slate-800 font-medium break-words">{c.ahora || '—'}</span>
                          </div>
                        )}
                        <p className="text-xs text-slate-600 leading-relaxed">{c.descripcion}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}

          {/* Footer discreto — costo/tiempo */}
          <div className="text-2xs text-slate-400 pt-2 border-t border-slate-100">
            Análisis IA
            {comparacion.duracion_ms ? ` · ${Math.round(comparacion.duracion_ms / 1000)}s` : ''}
            {comparacion.costo_usd ? ` · US$${comparacion.costo_usd.toFixed(3)}` : ''}
            {comparacion.completado_en ? ` · ${formatFechaLocalLarga(comparacion.completado_en.slice(0, 10))}` : ''}
          </div>
        </div>

        {/* Footer sticky con acción de cerrar */}
        <footer className="shrink-0 px-4 py-3 border-t border-slate-200 flex items-center justify-end bg-white">
          <button onClick={onCerrar} className="btn-secondary text-sm">Cerrar</button>
        </footer>
      </aside>
    </div>
  )
}
