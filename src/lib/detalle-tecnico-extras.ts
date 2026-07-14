/**
 * Helpers para tratar las "keys extras" del detalle_tecnico de un riesgo:
 * aquellas que NO forman parte del schema hardcodeado del render tipo
 * (automotor / hogar / vida / generico / dinamico) del form de póliza.
 *
 * Origen típico de las keys extras:
 *   - El agente IA de PDFs las agrega cuando encuentra info en el PDF que no
 *     matchea con campos "core" (ej: combustible, combustible_adicional,
 *     accesorios en autos; sublímites, cláusulas en integrales).
 *   - Data legacy importada con nombres no estándar.
 *
 * El editor / form de renovación los muestra en una sección aparte
 * "Datos adicionales" y permite editarlos o eliminarlos, para no obligar al
 * PAS a moverlos a texto libre solo por no tener input dedicado.
 */

export type RenderTipoRiesgo = 'automotor' | 'hogar' | 'vida' | 'generico' | 'dinamico'

/**
 * Keys que el form YA edita para cada render tipo. Todo lo que no esté acá
 * (más las de meta como `observaciones` y `descripcion` que tienen su propio
 * textarea) queda como "extra" y va a la sección editable.
 *
 * Mantener sincronizado con los inputs del JSX del form de edición
 * (src/app/crm/polizas/[id]/editar/page.tsx) y del form de renovación
 * (src/app/crm/renovaciones/[id]/page.tsx).
 */
const KEYS_CORE_POR_RENDER: Record<RenderTipoRiesgo, string[]> = {
  automotor: ['patente', 'marca', 'modelo', 'anio', 'motor', 'chasis', 'color', 'uso'],
  hogar:     ['calle', 'numero', 'localidad', 'provincia', 'tipo_construccion', 'superficie', 'medidas_seguridad'],
  vida:      ['capital_asegurado', 'beneficiarios'],
  generico:  ['descripcion'],
  dinamico:  [], // el CamposBienAseguradoDinamico maneja las keys de la definición del tipo
}

/**
 * Keys "reservadas" — nunca aparecen como "extras" aunque no estén en el
 * schema hardcodeado. Motivo: tienen su propio input en el form
 * (`observaciones` = textarea de "Observaciones del bien asegurado").
 */
const KEYS_RESERVADAS = new Set(['observaciones'])

/**
 * Aliases de nombre humano para keys frecuentes que la IA suele generar.
 * Si una key no está acá cae al fallback (title-case + reemplazo de _ por
 * espacio), que sirve para el 90% de casos.
 */
const ALIAS_LABEL: Record<string, string> = {
  combustible:              'Combustible',
  combustible_adicional:    'Combustible adicional',
  accesorios:               'Accesorios instalados',
  gnc:                      'GNC',
  sublimites:               'Sublímites',
  clausulas:                'Cláusulas específicas',
  clausulas_particulares:   'Cláusulas particulares',
  franquicia:               'Franquicia',
  franquicia_texto:         'Franquicia',
  extras:                   'Extras',
  observaciones_adicionales: 'Observaciones adicionales',
  numero_hijos:             'Número de hijos',
  actividad:                'Actividad',
  ocupacion:                'Ocupación',
}

/**
 * Devuelve las keys "extras" ordenadas alfabéticamente:
 * las que están en el JSONB pero NO son core del render tipo y NO son
 * keys reservadas (observaciones).
 *
 * `keysCoreExtra` permite pasar keys adicionales a considerar como "core".
 * Uso principal: para `renderTipo='dinamico'`, el form usa
 * `CamposBienAseguradoDinamico` que renderea los `campos_poliza` definidos
 * en el tipo del catálogo (`tipos-riesgo.ts`). Esas keys ya tienen input
 * propio; si no las excluimos, aparecen duplicadas como "extras" y editar
 * el extra pisa el JSONB → el input core queda vacío. El caller debe
 * pasar `obtenerTipoRiesgo(tipoRiesgo).campos_poliza.map(c => c.key)`.
 */
export function keysExtrasDeDetalle(
  detalle: Record<string, any> | null | undefined,
  renderTipo: RenderTipoRiesgo,
  keysCoreExtra?: string[],
): string[] {
  if (!detalle || typeof detalle !== 'object') return []
  const core = new Set([
    ...(KEYS_CORE_POR_RENDER[renderTipo] ?? []),
    ...(keysCoreExtra ?? []),
  ])
  return Object.keys(detalle)
    .filter((k) => !core.has(k) && !KEYS_RESERVADAS.has(k))
    .filter((k) => {
      const v = detalle[k]
      // Ocultamos valores nulos/vacíos — no aportan y ensucian la UI.
      if (v == null || v === '') return false
      if (Array.isArray(v) && v.length === 0) return false
      return true
    })
    .sort()
}

/**
 * Convierte una key snake_case a un label humano usando aliases o fallback.
 */
export function labelHumanoDeKey(key: string): string {
  if (ALIAS_LABEL[key]) return ALIAS_LABEL[key]
  return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')
}

/**
 * Devuelve un valor imprimible para mostrar en el input.
 * Arrays los junta con coma; objetos los serializa.
 */
export function valorAString(v: unknown): string {
  if (v == null) return ''
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
