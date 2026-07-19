'use client'

import { AlertTriangle, X, RefreshCw, AlertCircle } from 'lucide-react'

interface CampoComparado {
  campo: string
  label: string
  valor_tuyo: any
  valor_actual: any
}

interface Props {
  /** Datos que el usuario tiene en pantalla (form actual) */
  valoresTuyos: Record<string, any>
  /** Estado actual del registro en la DB (del response 409) */
  registroActual: Record<string, any>
  /** Mapeo campo → label legible (ej: { telefono: 'Teléfono', email: 'Email' }) */
  labels: Record<string, string>
  /** Campos a comparar — los que no estén acá se ignoran */
  campos: string[]
  onCerrar: () => void
  /** El usuario decide recargar la página con los datos actuales */
  onRecargar: () => void
  /** El usuario decide sobreescribir igual (force overwrite) */
  onSobreescribir: () => void
}

function formatearValor(v: any): string {
  if (v === null || v === undefined || v === '') return '(vacío)'
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/**
 * Modal que se muestra cuando el backend devuelve 409 (NEG_CONFLICTO_CONCURRENCIA)
 * porque otro usuario modificó el registro entre nuestra carga y nuestro save.
 *
 * Muestra side-by-side: lo que vos tenés cargado vs lo que está en la DB ahora.
 * El usuario decide:
 *   - "Recargar": descartar tus cambios y traer los datos frescos
 *   - "Guardar igual": forzar el guardado con tus cambios (sobreescribe lo
 *     del otro usuario)
 */
export function ModalConflictoEdicion({
  valoresTuyos,
  registroActual,
  labels,
  campos,
  onCerrar,
  onRecargar,
  onSobreescribir,
}: Props) {
  // Comparar los campos que cambiaron entre lo tuyo y lo actual de la DB
  const comparados: CampoComparado[] = campos
    .map((campo) => ({
      campo,
      label: labels[campo] ?? campo,
      valor_tuyo: valoresTuyos[campo],
      valor_actual: registroActual[campo],
    }))
    .filter((c) => {
      const t = c.valor_tuyo === '' || c.valor_tuyo === undefined ? null : c.valor_tuyo
      const a = c.valor_actual === '' || c.valor_actual === undefined ? null : c.valor_actual
      return JSON.stringify(t) !== JSON.stringify(a)
    })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl border border-amber-200 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-amber-100 bg-amber-50">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <h3 className="text-sm font-semibold text-slate-800">
              Otro usuario modificó esta ficha
            </h3>
          </div>
          <button onClick={onCerrar} className="text-slate-500 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          <p className="text-sm text-slate-700 mb-4">
            Mientras editabas, otra persona guardó cambios en esta ficha. Tenés dos opciones:
          </p>

          <ul className="text-xs text-slate-600 mb-5 space-y-1">
            <li>
              <strong>Recargar</strong> — descartás tus cambios y traés los datos actualizados.
              Después podés volver a aplicar tus cambios sobre la versión nueva.
            </li>
            <li>
              <strong>Guardar igual</strong> — tus cambios sobreescriben los del otro usuario.
              Usar con cuidado: si el otro cambió campos distintos a los tuyos, los vas a perder.
            </li>
          </ul>

          {comparados.length > 0 ? (
            <div className="border border-slate-200 rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Campo</th>
                    <th className="px-3 py-2 text-left font-medium text-blue-700">Lo tuyo (en pantalla)</th>
                    <th className="px-3 py-2 text-left font-medium text-amber-700">Lo actual (en la DB)</th>
                  </tr>
                </thead>
                <tbody>
                  {comparados.map((c) => (
                    <tr key={c.campo} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-medium text-slate-700">{c.label}</td>
                      <td className="px-3 py-2 text-slate-600 font-mono">{formatearValor(c.valor_tuyo)}</td>
                      <td className="px-3 py-2 text-slate-600 font-mono">{formatearValor(c.valor_actual)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              No detectamos diferencias visibles, pero el registro fue modificado.
              Probá recargar para asegurarte de tener la versión más reciente.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3 bg-slate-50 border-t border-slate-200 rounded-b-lg">
          <button
            onClick={onCerrar}
            className="h-8 px-3 text-xs font-medium text-slate-600 hover:text-slate-800"
          >
            Cancelar
          </button>
          <div className="flex gap-2">
            <button
              onClick={onSobreescribir}
              className="h-8 px-3 text-xs font-medium text-amber-700 hover:bg-amber-50 rounded-md border border-amber-300 flex items-center gap-1.5"
            >
              Guardar igual (sobreescribir)
            </button>
            <button
              onClick={onRecargar}
              className="h-8 px-3 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md flex items-center gap-1.5"
            >
              <RefreshCw className="h-3 w-3" /> Recargar y empezar de nuevo
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
