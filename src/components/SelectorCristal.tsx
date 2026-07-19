'use client'

// ============================================================================
// SelectorCristal.tsx — Selector visual multi-select de cristales rotos.
//
// Muestra un SVG de auto (vista superior — mismo estilo que SelectorRueda)
// con 7 cristales clickeables: parabrisas, luneta trasera, 4 cristales
// laterales y techo solar. El asegurado toca cada cristal roto; los
// seleccionados se pintan en rojo con líneas de fractura.
//
// Al costado (o debajo) del dibujo aparece la lista textual de cristales
// a reponer que queda registrada en la denuncia.
//
// Props:
//   - value: string[]           → array de cristales seleccionados
//   - onChange: (v[]) => void   → callback al toggle
//   - error?: boolean           → borde rojo si hay error de validación
//   - disabled?: boolean        → modo solo-lectura (para ficha)
//
// Values posibles (mismos labels que la matriz de siniestros-catalogo.ts):
//   'Parabrisas' | 'Luneta trasera' |
//   'Cristal lateral delantero izquierdo' | 'Cristal lateral delantero derecho' |
//   'Cristal lateral trasero izquierdo'   | 'Cristal lateral trasero derecho'   |
//   'Techo solar corredizo'
// ============================================================================

export type ValorCristal =
  | 'Parabrisas'
  | 'Luneta trasera'
  | 'Cristal lateral delantero izquierdo'
  | 'Cristal lateral delantero derecho'
  | 'Cristal lateral trasero izquierdo'
  | 'Cristal lateral trasero derecho'
  | 'Techo solar corredizo'

interface Props {
  value: string[] | string | null
  onChange: (valores: string[]) => void
  error?: boolean
  disabled?: boolean
}

interface Cristal {
  key: ValorCristal
  path: string
  labelCorto: string
  labelPos: { x: number; y: number; anchor: 'start' | 'end' | 'middle' }
  /** Coordenadas del "centro" del cristal para pintar la fractura. */
  centro: { x: number; y: number }
}

// Cristales del auto — mismas coordenadas que las ventanas de SelectorRueda
// para que el asegurado los reconozca visualmente. viewBox 400x600.
const CRISTALES: Cristal[] = [
  {
    key: 'Parabrisas',
    path: 'M 72 118 Q 150 100 228 118 L 222 175 Q 150 165 78 175 Z',
    labelCorto: 'Parabrisas',
    labelPos: { x: 150, y: 92, anchor: 'middle' },
    centro: { x: 150, y: 145 },
  },
  {
    key: 'Cristal lateral delantero izquierdo',
    // Ventana lateral delantera izquierda extendida para hacer área clickeable más grande
    path: 'M 50 188 L 72 188 L 72 302 L 50 302 Z',
    labelCorto: 'Del. izq.',
    labelPos: { x: 8, y: 250, anchor: 'start' },
    centro: { x: 61, y: 245 },
  },
  {
    key: 'Cristal lateral delantero derecho',
    path: 'M 250 188 L 228 188 L 228 302 L 250 302 Z',
    labelCorto: 'Del. der.',
    labelPos: { x: 292, y: 250, anchor: 'start' },
    centro: { x: 239, y: 245 },
  },
  {
    key: 'Techo solar corredizo',
    // Óvalo al centro del techo entre el divisor
    path: 'M 118 260 L 182 260 Q 190 300 182 340 L 118 340 Q 110 300 118 260 Z',
    labelCorto: 'Techo solar',
    labelPos: { x: 150, y: 305, anchor: 'middle' },
    centro: { x: 150, y: 300 },
  },
  {
    key: 'Cristal lateral trasero izquierdo',
    path: 'M 50 308 L 72 308 L 72 407 L 50 407 Z',
    labelCorto: 'Tras. izq.',
    labelPos: { x: 8, y: 360, anchor: 'start' },
    centro: { x: 61, y: 357 },
  },
  {
    key: 'Cristal lateral trasero derecho',
    path: 'M 250 308 L 228 308 L 228 407 L 250 407 Z',
    labelCorto: 'Tras. der.',
    labelPos: { x: 292, y: 360, anchor: 'start' },
    centro: { x: 239, y: 357 },
  },
  {
    key: 'Luneta trasera',
    path: 'M 72 425 Q 150 445 228 425 L 222 470 Q 150 460 78 470 Z',
    labelCorto: 'Luneta',
    labelPos: { x: 150, y: 500, anchor: 'middle' },
    centro: { x: 150, y: 450 },
  },
]

function normalizarValor(v: string[] | string | null): Set<string> {
  if (Array.isArray(v)) return new Set(v)
  if (typeof v === 'string' && v) return new Set([v])
  return new Set()
}

export function SelectorCristal({ value, onChange, error, disabled }: Props) {
  const seleccionados = normalizarValor(value)

  const colorSel = '#dc2626'         // rojo-600
  const colorCarroceria = '#e2e8f0'  // slate-200
  const colorSombra = '#cbd5e1'      // slate-300
  const colorBorde = '#64748b'       // slate-500
  const colorVidrio = '#bae6fd'      // sky-200
  const colorTexto = '#475569'       // slate-600
  const colorNormal = '#0f172a'      // slate-900

  const toggle = (key: ValorCristal) => {
    if (disabled) return
    const nueva = new Set(seleccionados)
    if (nueva.has(key)) nueva.delete(key)
    else nueva.add(key)
    onChange(Array.from(nueva))
  }

  const lista = Array.from(seleccionados)

  return (
    <div className={`${error ? 'ring-2 ring-red-500/40 rounded-lg p-1' : ''}`}>
      <div className="flex flex-col md:flex-row gap-4 items-start">
        {/* SVG del auto */}
        <div className="flex-shrink-0 mx-auto">
          <svg
            viewBox="0 0 400 600"
            className="w-full max-w-[320px] mx-auto block select-none"
            style={{ height: 'auto' }}
            role="group"
            aria-label="Seleccionar cristales rotos"
          >
            {/* Sombra debajo del auto */}
            <ellipse cx={150} cy={555} rx={130} ry={12} fill={colorSombra} opacity={0.5} />

            {/* Carrocería */}
            <path
              d="M 55 100 Q 45 90 60 78 Q 100 62 150 60 Q 200 62 240 78 Q 255 90 245 100 L 250 400 Q 255 490 240 510 Q 200 528 150 530 Q 100 528 60 510 Q 45 490 50 400 Z"
              fill={colorCarroceria}
              stroke={colorBorde}
              strokeWidth={2}
            />

            {/* Faros delanteros */}
            <ellipse cx={80}  cy={82} rx={16} ry={7} fill="#fef3c7" stroke={colorBorde} strokeWidth={1} />
            <ellipse cx={220} cy={82} rx={16} ry={7} fill="#fef3c7" stroke={colorBorde} strokeWidth={1} />

            {/* Techo (área central para dar contexto) */}
            <rect x={72} y={183} width={156} height={234} rx={6} ry={6} fill="#f8fafc" stroke={colorBorde} strokeWidth={1} />

            {/* Divisor central del techo (línea entre asientos) */}
            <line x1={150} y1={190} x2={150} y2={410} stroke={colorBorde} strokeWidth={1} strokeDasharray="4 4" />

            {/* Manijas de puerta */}
            <rect x={44} y={260} width={5} height={12} rx={2} fill={colorBorde} />
            <rect x={251} y={260} width={5} height={12} rx={2} fill={colorBorde} />

            {/* Faros traseros (más rojos) */}
            <ellipse cx={80}  cy={506} rx={18} ry={7} fill="#fecaca" stroke="#dc2626" strokeWidth={1} />
            <ellipse cx={220} cy={506} rx={18} ry={7} fill="#fecaca" stroke="#dc2626" strokeWidth={1} />

            {/* Espejos retrovisores */}
            <path d="M 30 150 Q 25 155 30 175 L 42 175 L 42 155 Z" fill={colorCarroceria} stroke={colorBorde} strokeWidth={1} />
            <path d="M 270 150 Q 275 155 270 175 L 258 175 L 258 155 Z" fill={colorCarroceria} stroke={colorBorde} strokeWidth={1} />

            {/* Ruedas — solo decorativas, no clickeables acá */}
            <ellipse cx={65}  cy={155} rx={24} ry={42} fill={colorNormal} stroke="#020617" strokeWidth={2} />
            <ellipse cx={235} cy={155} rx={24} ry={42} fill={colorNormal} stroke="#020617" strokeWidth={2} />
            <ellipse cx={65}  cy={445} rx={24} ry={42} fill={colorNormal} stroke="#020617" strokeWidth={2} />
            <ellipse cx={235} cy={445} rx={24} ry={42} fill={colorNormal} stroke="#020617" strokeWidth={2} />
            {/* Rines */}
            <ellipse cx={65}  cy={155} rx={12} ry={25} fill="#94a3b8" pointerEvents="none" />
            <ellipse cx={235} cy={155} rx={12} ry={25} fill="#94a3b8" pointerEvents="none" />
            <ellipse cx={65}  cy={445} rx={12} ry={25} fill="#94a3b8" pointerEvents="none" />
            <ellipse cx={235} cy={445} rx={12} ry={25} fill="#94a3b8" pointerEvents="none" />

            {/* CRISTALES clickeables */}
            {CRISTALES.map(cr => {
              const sel = seleccionados.has(cr.key)
              return (
                <g key={cr.key}>
                  <path
                    d={cr.path}
                    fill={sel ? colorSel : colorVidrio}
                    stroke={sel ? '#7f1d1d' : colorBorde}
                    strokeWidth={sel ? 2.5 : 1.5}
                    onClick={() => toggle(cr.key)}
                    onKeyDown={e => {
                      if (disabled) return
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggle(cr.key)
                      }
                    }}
                    tabIndex={disabled ? -1 : 0}
                    role="button"
                    aria-label={`${cr.labelCorto}${sel ? ' — seleccionado' : ''}`}
                    aria-pressed={sel}
                    style={{
                      cursor: disabled ? 'default' : 'pointer',
                      transition: 'fill 150ms, stroke 150ms, filter 150ms',
                      filter: sel ? 'drop-shadow(0 0 6px rgba(220, 38, 38, 0.55))' : 'none',
                      outline: 'none',
                    }}
                  />
                  {/* Fractura estrellada sobre el cristal seleccionado */}
                  {sel && (
                    <g pointerEvents="none" stroke="#ffffff" strokeWidth={1.8} strokeLinecap="round">
                      <line x1={cr.centro.x - 12} y1={cr.centro.y - 10} x2={cr.centro.x + 12} y2={cr.centro.y + 10} />
                      <line x1={cr.centro.x + 12} y1={cr.centro.y - 10} x2={cr.centro.x - 12} y2={cr.centro.y + 10} />
                      <line x1={cr.centro.x} y1={cr.centro.y - 14} x2={cr.centro.x} y2={cr.centro.y + 14} />
                      <line x1={cr.centro.x - 14} y1={cr.centro.y} x2={cr.centro.x + 14} y2={cr.centro.y} />
                      <circle cx={cr.centro.x} cy={cr.centro.y} r={2} fill="#ffffff" stroke="none" />
                    </g>
                  )}
                </g>
              )
            })}

            {/* Labels de los cristales */}
            {CRISTALES.map(cr => {
              const sel = seleccionados.has(cr.key)
              return (
                <text
                  key={`label-${cr.key}`}
                  x={cr.labelPos.x}
                  y={cr.labelPos.y}
                  fontSize={13}
                  fontWeight={sel ? 700 : 500}
                  fill={sel ? colorSel : colorTexto}
                  textAnchor={cr.labelPos.anchor}
                  style={{ userSelect: 'none' }}
                >
                  {cr.labelCorto}
                </text>
              )
            })}
          </svg>
        </div>

        {/* Lista de cristales a reponer */}
        <div className="flex-1 min-w-0 w-full">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2">
              Cristales a reponer
            </h4>
            {lista.length === 0 ? (
              <p className="text-xs italic text-slate-500">
                Tocá cada cristal roto en el dibujo del auto.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {lista.map(c => (
                  <li key={c} className="flex items-center gap-2 text-sm text-slate-800">
                    <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
