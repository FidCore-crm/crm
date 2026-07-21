'use client'

/**
 * Editor de la key `coberturas_desglosadas` del `detalle_tecnico` de un riesgo.
 *
 * Se usa en pólizas con múltiples sub-coberturas cada una con su propia suma
 * asegurada (típico integrales: hogar, comercio, consorcio). El agente IA la
 * puebla al leer el PDF; este componente le permite al PAS editar, agregar o
 * eliminar filas.
 *
 * La key vive dentro del JSONB `riesgos.detalle_tecnico` — no hay migración
 * de DB. Está reservada en `KEYS_RESERVADAS` de `detalle-tecnico-extras.ts`
 * para que NO aparezca duplicada en la subsección "Datos adicionales".
 */

import { Plus, X } from 'lucide-react'

export interface CoberturaDesglosada {
  cobertura: string
  suma_asegurada: number | null
  notas?: string | null
}

interface Props {
  valor: CoberturaDesglosada[] | null | undefined
  onChange: (nuevo: CoberturaDesglosada[]) => void
  moneda?: string | null // Para el prefijo del input (ARS $, USD US$). Default ARS.
}

/**
 * Verifica que `valor` es un array de objetos con la forma esperada.
 * Se usa antes de renderizar para tolerar datos legacy o corruptos.
 */
export function esCoberturasDesglosadasValido(v: unknown): v is CoberturaDesglosada[] {
  return (
    Array.isArray(v) &&
    v.every(
      (x) =>
        x &&
        typeof x === 'object' &&
        'cobertura' in x &&
        typeof (x as any).cobertura === 'string',
    )
  )
}

export function CoberturasDesglosadasEditor({ valor, onChange, moneda }: Props) {
  const filas: CoberturaDesglosada[] = esCoberturasDesglosadasValido(valor) ? valor : []
  const simbolo = moneda === 'USD' ? 'US$' : '$'

  const agregarFila = () => {
    onChange([...filas, { cobertura: '', suma_asegurada: null, notas: null }])
  }

  const editarFila = (i: number, patch: Partial<CoberturaDesglosada>) => {
    const copia = filas.slice()
    copia[i] = { ...copia[i], ...patch }
    onChange(copia)
  }

  const eliminarFila = (i: number) => {
    const copia = filas.slice()
    copia.splice(i, 1)
    onChange(copia)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
          Coberturas contratadas y sumas aseguradas
        </span>
        <button
          type="button"
          onClick={agregarFila}
          className="text-xs px-2.5 py-1 border border-blue-200 bg-blue-50 rounded hover:bg-blue-100 hover:border-blue-300 flex items-center gap-1 text-blue-700 font-medium"
        >
          <Plus className="h-3.5 w-3.5" />
          Agregar cobertura
        </button>
      </div>

      {filas.length === 0 ? (
        <p className="text-xs text-slate-600 italic px-1">
          Sin coberturas cargadas. Útil para pólizas integrales (hogar, comercio) con múltiples sub-coberturas.
        </p>
      ) : (
        <div className="border border-slate-200 rounded overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-2 py-1.5 font-semibold text-slate-700 w-2/5">Cobertura</th>
                <th className="text-left px-2 py-1.5 font-semibold text-slate-700 w-1/5">Suma asegurada</th>
                <th className="text-left px-2 py-1.5 font-semibold text-slate-700">Notas (opcional)</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={i} className="border-t border-slate-100 first:border-t-0">
                  <td className="px-1 py-1">
                    <input
                      type="text"
                      className="form-input h-8 text-xs w-full"
                      value={f.cobertura ?? ''}
                      onChange={(e) => editarFila(i, { cobertura: e.target.value })}
                      placeholder="Incendio edificio"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-600 text-xs pointer-events-none">
                        {simbolo}
                      </span>
                      <input
                        type="number"
                        className="form-input h-8 text-xs w-full pl-8 font-mono"
                        value={f.suma_asegurada ?? ''}
                        onChange={(e) =>
                          editarFila(i, {
                            suma_asegurada: e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                        placeholder="0"
                        step="any"
                        min="0"
                      />
                    </div>
                  </td>
                  <td className="px-1 py-1">
                    <input
                      type="text"
                      className="form-input h-8 text-xs w-full"
                      value={f.notas ?? ''}
                      onChange={(e) => editarFila(i, { notas: e.target.value || null })}
                      placeholder="Franquicia 5%, a prorrata..."
                    />
                  </td>
                  <td className="px-1 py-1 text-center">
                    <button
                      type="button"
                      onClick={() => eliminarFila(i)}
                      className="p-1 rounded hover:bg-red-50 text-red-600 hover:text-red-700"
                      title="Eliminar fila"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
