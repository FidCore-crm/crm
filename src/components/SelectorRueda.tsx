'use client'

// ============================================================================
// SelectorRueda.tsx — Selector visual multi-select de ruedas para siniestros
// de "robo de ruedas".
//
// Muestra un SVG de auto en vista superior con 4 ruedas clickeables + rueda
// de auxilio separada. El PAS/asegurado tocá cada rueda que le robaron; las
// seleccionadas quedan en rojo con una X blanca, las demás en gris.
//
// Se usa desde los 3 formularios de siniestro cuando el tipo es ROBO_RUEDAS.
//
// Props:
//   - value: string[]           → array de keys de ruedas seleccionadas
//   - onChange: (v[]) => void   → callback al toggle. Emite el array completo.
//   - error?: boolean           → borde rojo si hay error de validación
//   - disabled?: boolean        → modo solo-lectura (para ficha)
//
// Retrocompatibilidad:
//   Antes value era `string | null` (una sola rueda). Si el caller pasa un
//   string simple, se trata como array de 1 elemento. Data persistida vieja
//   con `rueda_robada: "Delantera izquierda"` se sigue leyendo correctamente.
//
// Values posibles (mismos labels que la matriz de siniestros-catalogo.ts):
//   'Delantera izquierda' | 'Delantera derecha' |
//   'Trasera izquierda'   | 'Trasera derecha'   |
//   'Auxilio'
// ============================================================================

export type ValorRueda =
  | 'Delantera izquierda'
  | 'Delantera derecha'
  | 'Trasera izquierda'
  | 'Trasera derecha'
  | 'Auxilio'

interface Props {
  /** Array de ruedas seleccionadas. Acepta string simple (legacy) para retrocompat. */
  value: string[] | string | null
  /** Recibe el array completo actualizado. */
  onChange: (valores: string[]) => void
  error?: boolean
  disabled?: boolean
}

interface Rueda {
  key: ValorRueda
  cx: number
  cy: number
  rx: number
  ry: number
  label: string
  labelPos: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'aux'
}

// Ruedas del auto — vista superior, viewBox 400x600
const RUEDAS: Rueda[] = [
  { key: 'Delantera izquierda', cx: 65,  cy: 155, rx: 24, ry: 42, label: 'Del. izq.', labelPos: 'top-left' },
  { key: 'Delantera derecha',   cx: 235, cy: 155, rx: 24, ry: 42, label: 'Del. der.', labelPos: 'top-right' },
  { key: 'Trasera izquierda',   cx: 65,  cy: 445, rx: 24, ry: 42, label: 'Tras. izq.', labelPos: 'bottom-left' },
  { key: 'Trasera derecha',     cx: 235, cy: 445, rx: 24, ry: 42, label: 'Tras. der.', labelPos: 'bottom-right' },
  { key: 'Auxilio',             cx: 355, cy: 300, rx: 32, ry: 32, label: 'Auxilio',   labelPos: 'aux' },
]

function normalizarValor(v: string[] | string | null): Set<string> {
  if (Array.isArray(v)) return new Set(v)
  if (typeof v === 'string' && v) return new Set([v])
  return new Set()
}

export function SelectorRueda({ value, onChange, error, disabled }: Props) {
  const seleccionadas = normalizarValor(value)
  const total = seleccionadas.size

  const colorSel = '#dc2626'         // rojo-600
  const colorNormal = '#0f172a'      // slate-900
  const colorCarroceria = '#e2e8f0'  // slate-200
  const colorSombra = '#cbd5e1'      // slate-300
  const colorBorde = '#64748b'       // slate-500
  const colorVidrio = '#bae6fd'      // sky-200
  const colorTexto = '#475569'       // slate-600

  const toggle = (key: ValorRueda) => {
    if (disabled) return
    const nueva = new Set(seleccionadas)
    if (nueva.has(key)) nueva.delete(key)
    else nueva.add(key)
    onChange(Array.from(nueva))
  }

  const labelSeleccion = total === 0
    ? null
    : total === 1
      ? Array.from(seleccionadas).join('')
      : `${total} ruedas: ${Array.from(seleccionadas).join(', ')}`

  return (
    <div className={`inline-block ${error ? 'ring-2 ring-red-500/40 rounded-lg p-1' : ''}`}>
      <svg
        viewBox="0 0 400 600"
        className="w-full max-w-[320px] mx-auto block select-none"
        style={{ height: 'auto' }}
        role="group"
        aria-label="Seleccionar ruedas robadas"
      >
        {/* Sombra debajo del auto para dar profundidad */}
        <ellipse cx={150} cy={555} rx={130} ry={12} fill={colorSombra} opacity={0.5} />

        {/* Carrocería principal (forma más orgánica con curvas) */}
        <path
          d="
            M 55 100
            Q 45 90 60 78
            Q 100 62 150 60
            Q 200 62 240 78
            Q 255 90 245 100
            L 250 400
            Q 255 490 240 510
            Q 200 528 150 530
            Q 100 528 60 510
            Q 45 490 50 400
            Z
          "
          fill={colorCarroceria}
          stroke={colorBorde}
          strokeWidth={2}
        />

        {/* Parabrisas delantero (más curvado) */}
        <path
          d="M 72 118 Q 150 100 228 118 L 222 175 Q 150 165 78 175 Z"
          fill={colorVidrio}
          stroke={colorBorde}
          strokeWidth={1.5}
        />

        {/* Faros delanteros */}
        <ellipse cx={80}  cy={82} rx={16} ry={7} fill="#fef3c7" stroke={colorBorde} strokeWidth={1} />
        <ellipse cx={220} cy={82} rx={16} ry={7} fill="#fef3c7" stroke={colorBorde} strokeWidth={1} />

        {/* Techo (área central) */}
        <rect
          x={72}
          y={183}
          width={156}
          height={234}
          rx={6}
          ry={6}
          fill="#f8fafc"
          stroke={colorBorde}
          strokeWidth={1}
        />

        {/* Divisor central del techo (línea entre asientos) */}
        <line x1={150} y1={190} x2={150} y2={410} stroke={colorBorde} strokeWidth={1} strokeDasharray="4 4" />

        {/* Ventanas laterales delanteras */}
        <path d="M 60 190 L 70 190 L 70 300 L 60 300 Z" fill={colorVidrio} stroke={colorBorde} strokeWidth={1} />
        <path d="M 240 190 L 230 190 L 230 300 L 240 300 Z" fill={colorVidrio} stroke={colorBorde} strokeWidth={1} />
        {/* Ventanas laterales traseras */}
        <path d="M 60 310 L 70 310 L 70 405 L 60 405 Z" fill={colorVidrio} stroke={colorBorde} strokeWidth={1} />
        <path d="M 240 310 L 230 310 L 230 405 L 240 405 Z" fill={colorVidrio} stroke={colorBorde} strokeWidth={1} />

        {/* Manijas de puerta */}
        <rect x={54} y={260} width={5} height={12} rx={2} fill={colorBorde} />
        <rect x={241} y={260} width={5} height={12} rx={2} fill={colorBorde} />

        {/* Luneta trasera */}
        <path d="M 72 425 Q 150 445 228 425 L 222 470 Q 150 460 78 470 Z" fill={colorVidrio} stroke={colorBorde} strokeWidth={1.5} />

        {/* Faros traseros (más rojos) */}
        <ellipse cx={80}  cy={506} rx={18} ry={7} fill="#fecaca" stroke="#dc2626" strokeWidth={1} />
        <ellipse cx={220} cy={506} rx={18} ry={7} fill="#fecaca" stroke="#dc2626" strokeWidth={1} />

        {/* Espejos retrovisores */}
        <path d="M 30 150 Q 25 155 30 175 L 42 175 L 42 155 Z" fill={colorCarroceria} stroke={colorBorde} strokeWidth={1} />
        <path d="M 270 150 Q 275 155 270 175 L 258 175 L 258 155 Z" fill={colorCarroceria} stroke={colorBorde} strokeWidth={1} />

        {/* Ruedas — clickeables */}
        {RUEDAS.map(rueda => {
          const sel = seleccionadas.has(rueda.key)
          return (
            <g key={rueda.key}>
              {/* Neumático */}
              <ellipse
                cx={rueda.cx}
                cy={rueda.cy}
                rx={rueda.rx}
                ry={rueda.ry}
                fill={sel ? colorSel : colorNormal}
                stroke={sel ? '#7f1d1d' : '#020617'}
                strokeWidth={2.5}
                onClick={() => toggle(rueda.key)}
                onKeyDown={e => {
                  if (disabled) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggle(rueda.key)
                  }
                }}
                tabIndex={disabled ? -1 : 0}
                role="button"
                aria-label={`${rueda.label}${sel ? ' — seleccionada' : ''}`}
                aria-pressed={sel}
                style={{
                  cursor: disabled ? 'default' : 'pointer',
                  transition: 'fill 150ms, stroke 150ms, filter 150ms',
                  filter: sel ? 'drop-shadow(0 0 6px rgba(220, 38, 38, 0.5))' : 'none',
                  outline: 'none',
                }}
              />
              {/* Rin interior (círculo gris claro) — solo si no está seleccionada */}
              {!sel && rueda.key !== 'Auxilio' && (
                <ellipse
                  cx={rueda.cx}
                  cy={rueda.cy}
                  rx={rueda.rx * 0.5}
                  ry={rueda.ry * 0.6}
                  fill="#94a3b8"
                  pointerEvents="none"
                />
              )}
              {/* Rin del auxilio (círculo) */}
              {!sel && rueda.key === 'Auxilio' && (
                <circle cx={rueda.cx} cy={rueda.cy} r={rueda.rx * 0.55} fill="#94a3b8" pointerEvents="none" />
              )}
              {/* X blanca sobre las ruedas seleccionadas */}
              {sel && (
                <g pointerEvents="none">
                  <line
                    x1={rueda.cx - rueda.rx * 0.5}
                    y1={rueda.cy - rueda.ry * 0.4}
                    x2={rueda.cx + rueda.rx * 0.5}
                    y2={rueda.cy + rueda.ry * 0.4}
                    stroke="#ffffff"
                    strokeWidth={3.5}
                    strokeLinecap="round"
                  />
                  <line
                    x1={rueda.cx + rueda.rx * 0.5}
                    y1={rueda.cy - rueda.ry * 0.4}
                    x2={rueda.cx - rueda.rx * 0.5}
                    y2={rueda.cy + rueda.ry * 0.4}
                    stroke="#ffffff"
                    strokeWidth={3.5}
                    strokeLinecap="round"
                  />
                </g>
              )}
            </g>
          )
        })}

        {/* Labels de las ruedas */}
        {RUEDAS.map(rueda => {
          let textX = rueda.cx
          let textY = rueda.cy
          let anchor: 'start' | 'end' | 'middle' = 'middle'
          const sel = seleccionadas.has(rueda.key)

          switch (rueda.labelPos) {
            case 'top-left':
            case 'bottom-left':
              textX = 8
              textY = rueda.cy + 5
              anchor = 'start'
              break
            case 'top-right':
            case 'bottom-right':
              textX = 290
              textY = rueda.cy + 5
              anchor = 'start'
              break
            case 'aux':
              textX = 355
              textY = rueda.cy + rueda.ry + 22
              anchor = 'middle'
              break
          }

          return (
            <text
              key={`label-${rueda.key}`}
              x={textX}
              y={textY}
              fontSize={14}
              fontWeight={sel ? 700 : 500}
              fill={sel ? colorSel : colorTexto}
              textAnchor={anchor}
              style={{ userSelect: 'none' }}
            >
              {rueda.label}
            </text>
          )
        })}

        {/* Círculo alrededor de "Auxilio" para separarlo visualmente */}
        <circle
          cx={355}
          cy={300}
          r={46}
          fill="none"
          stroke={colorBorde}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      </svg>

      {/* Feedback textual debajo del SVG */}
      <div className="text-center mt-2 text-xs text-slate-600 px-2">
        {labelSeleccion ? (
          <>
            <strong className="text-red-600">{labelSeleccion}</strong>
          </>
        ) : (
          <span className="text-slate-400 italic">Tocá una o varias ruedas robadas</span>
        )}
      </div>
    </div>
  )
}
