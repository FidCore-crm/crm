'use client'

// ============================================================
// Modal simple que muestra el histórico del análisis de cambios
// IA de una renovación. Se abre desde un link discreto en la
// ficha de póliza. Sin polling, sin auto-refresh — solo lectura
// del resultado ya persistido en polizas.comparacion_ia.
// ============================================================

import { useMemo } from 'react'
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

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-blue-50 to-white">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-slate-800">Análisis de cambios vs. póliza anterior</h3>
          </div>
          <button onClick={onCerrar} className="text-slate-400 hover:text-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-3">
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

              <p className="text-xs text-slate-600">
                <span className="font-semibold text-slate-800">{materiales.length}</span>{' '}
                cambio{materiales.length !== 1 ? 's' : ''} material{materiales.length !== 1 ? 'es' : ''}
                {cosmeticos.length > 0 && `, ${cosmeticos.length} cosmético${cosmeticos.length !== 1 ? 's' : ''} ocultos`}
              </p>

              {porCategoria.length === 0 && (
                <p className="text-xs text-slate-500 italic">Sin cambios materiales.</p>
              )}

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
            </>
          )}

          <div className="text-2xs text-slate-400 pt-2 border-t border-slate-100">
            Análisis IA
            {comparacion.duracion_ms ? ` · ${Math.round(comparacion.duracion_ms / 1000)}s` : ''}
            {comparacion.costo_usd ? ` · US$${comparacion.costo_usd.toFixed(3)}` : ''}
            {comparacion.completado_en ? ` · ${formatFechaLocalLarga(comparacion.completado_en.slice(0, 10))}` : ''}
          </div>
        </div>

        <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end">
          <button onClick={onCerrar} className="btn-secondary text-sm">Cerrar</button>
        </div>
      </div>
    </div>
  )
}
