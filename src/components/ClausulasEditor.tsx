'use client'

/**
 * Editor de la key `clausulas` del `detalle_tecnico` de un riesgo.
 *
 * `clausulas` es un array `{ label, valor }[]` que la IA extrae al leer el PDF
 * (regla 10.b del prompt SYSTEM_POLIZA — condiciones particulares del contrato:
 * coberturas adicionales, bonificaciones, franquicias específicas, extensiones
 * de cobertura, sublímites, cláusulas especiales). La regla de v1.0.155 es que
 * los textos van TEXTUAL del PDF (sin reformular). Por eso el editor es de
 * **solo lectura + eliminar**: preservamos literalidad pero permitimos que el
 * PAS descarte filas que no le aportan (aprovechar espacio, información no
 * relevante para la operación diaria, etc.).
 *
 * NOTA sobre el nombre "clausulas" de la key JSONB: se mantiene por retrocompat
 * con pólizas ya cargadas. La UI visible al PAS habla de "Condiciones
 * particulares" — término correcto en el rubro (ver v1.0.166).
 *
 * La key está reservada en `KEYS_RESERVADAS` de `detalle-tecnico-extras.ts` —
 * NO aparece en la subsección "Datos adicionales".
 */

import { X } from 'lucide-react'

export interface Clausula {
  label: string
  valor: string
}

interface Props {
  valor: Clausula[] | null | undefined
  onChange: (nuevo: Clausula[]) => void
}

/**
 * Valida que `valor` es un array de objetos con la forma esperada.
 * Tolera datos legacy o corruptos devolviendo `false`.
 */
export function esClausulasValido(v: unknown): v is Clausula[] {
  return (
    Array.isArray(v) &&
    v.every(
      (x) =>
        x &&
        typeof x === 'object' &&
        'label' in x &&
        'valor' in x &&
        typeof (x as any).label === 'string' &&
        typeof (x as any).valor === 'string',
    )
  )
}

export function ClausulasEditor({ valor, onChange }: Props) {
  const filas: Clausula[] = esClausulasValido(valor) ? valor : []

  const eliminarFila = (i: number) => {
    const copia = filas.slice()
    copia.splice(i, 1)
    onChange(copia)
  }

  if (filas.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
          Condiciones particulares
        </span>
        <span className="text-2xs text-slate-500 italic">
          Cargadas textualmente del PDF · usá la X para descartar filas que no necesites
        </span>
      </div>

      <ul className="flex flex-col divide-y divide-slate-100 border border-slate-200 rounded overflow-hidden">
        {filas.map((c, i) => (
          <li
            key={i}
            className="flex items-start gap-2 px-2.5 py-2 bg-white hover:bg-slate-50"
          >
            <div className="flex-1 min-w-0">
              <div className="text-2xs font-semibold text-slate-600 uppercase tracking-wide break-words">
                {c.label}
              </div>
              <div className="text-xs text-slate-700 font-mono mt-0.5 break-words whitespace-pre-wrap">
                {c.valor}
              </div>
            </div>
            <button
              type="button"
              onClick={() => eliminarFila(i)}
              className="p-1 rounded hover:bg-red-50 text-red-600 hover:text-red-700 shrink-0 mt-0.5"
              title="Eliminar esta fila"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
