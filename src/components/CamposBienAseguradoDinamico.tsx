'use client'

/**
 * Renderea dinámicamente los campos del bien asegurado (campos_poliza) que
 * define el tipo de riesgo del catálogo. Se usa en todos los formularios de
 * carga de póliza/cotización donde el tipo NO tiene UI hardcoded
 * (automotor / hogar / vida son los que sí la tienen — el resto pasa por acá).
 *
 * Acepta un objeto plano de valores (lo que termina en `riesgos.detalle_tecnico`)
 * y emite un objeto plano modificado al cambiar cualquier input. La validación
 * de campos requeridos la hace el form padre llamando a `validarCamposDinamicos`.
 */

import { obtenerTipoRiesgo, type CampoPoliza } from '@/lib/tipos-riesgo'

interface Props {
  tipoRiesgo: string | null | undefined
  valores: Record<string, any>
  onChange: (nuevo: Record<string, any>) => void
  errores?: Record<string, string>
}

export function CamposBienAseguradoDinamico({ tipoRiesgo, valores, onChange, errores }: Props) {
  const tipo = obtenerTipoRiesgo(tipoRiesgo)
  const campos = tipo.campos_poliza

  if (campos.length === 0) {
    return (
      <p className="text-xs text-slate-600 italic px-1">
        Este tipo de bien no tiene campos definidos. Cargá una descripción en las observaciones de la póliza.
      </p>
    )
  }

  const setCampo = (key: string, valor: any) => {
    onChange({ ...valores, [key]: valor })
  }

  const claseInput = (key: string) =>
    `form-input ${errores?.[`r_${key}`] ? 'border-red-300' : ''}`

  return (
    <div className="grid grid-cols-2 gap-3">
      {campos.map((c: CampoPoliza) => {
        const col = c.ancho === 'completo' ? 'col-span-2' : ''
        const error = errores?.[`r_${c.key}`]
        return (
          <div key={c.key} className={col}>
            <label className="text-xs text-slate-600 mb-0.5 block">
              {c.label}
              {c.requerido && <span className="text-red-500 ml-0.5">*</span>}
            </label>

            {c.tipo === 'textarea' ? (
              <textarea
                className={claseInput(c.key)}
                rows={3}
                value={valores[c.key] ?? ''}
                onChange={e => setCampo(c.key, e.target.value)}
                placeholder={c.placeholder}
              />
            ) : c.tipo === 'select' ? (
              <select
                className={claseInput(c.key)}
                value={valores[c.key] ?? ''}
                onChange={e => setCampo(c.key, e.target.value)}
              >
                <option value="">— Seleccioná —</option>
                {(c.opciones ?? []).map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : c.tipo === 'number' ? (
              <input
                type="number"
                className={claseInput(c.key)}
                value={valores[c.key] ?? ''}
                onChange={e => setCampo(c.key, e.target.value)}
                placeholder={c.placeholder}
                step="any"
              />
            ) : c.tipo === 'date' ? (
              <input
                type="date"
                className={claseInput(c.key)}
                value={valores[c.key] ?? ''}
                onChange={e => setCampo(c.key, e.target.value)}
              />
            ) : (
              <input
                type="text"
                className={claseInput(c.key)}
                value={valores[c.key] ?? ''}
                onChange={e => setCampo(c.key, e.target.value)}
                placeholder={c.placeholder}
              />
            )}

            {error && <p className="text-2xs text-red-500 mt-0.5">{error}</p>}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Valida los campos requeridos del tipo de riesgo contra los valores actuales.
 * Devuelve un map de `r_<key> → mensaje` para mergear con el state de errores
 * del form padre. La key tiene prefijo `r_` para no chocar con errores de
 * la póliza (compania_id, fecha_inicio, etc.).
 */
export function validarCamposDinamicos(
  tipoRiesgo: string | null | undefined,
  valores: Record<string, any>,
): Record<string, string> {
  const tipo = obtenerTipoRiesgo(tipoRiesgo)
  const errores: Record<string, string> = {}
  for (const c of tipo.campos_poliza) {
    if (!c.requerido) continue
    const v = valores[c.key]
    if (v === undefined || v === null || String(v).trim() === '') {
      errores[`r_${c.key}`] = `${c.label} es obligatorio`
    }
  }
  return errores
}
