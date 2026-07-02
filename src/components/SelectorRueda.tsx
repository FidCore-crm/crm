'use client'

// ============================================================================
// SelectorRueda.tsx — Selector visual de rueda para siniestros de "robo de ruedas".
//
// Muestra un SVG de auto en vista superior con 4 ruedas clickeables + rueda
// de auxilio separada. Al hacer click, la rueda seleccionada se pinta con
// color rojo (indicando "esta es la que falta") y las demás quedan en gris.
//
// Se usa desde los 3 formularios de siniestro cuando el tipo es ROBO_RUEDAS.
//
// Props:
//   - value: string | null      → key de la rueda seleccionada
//   - onChange: (v) => void     → callback cuando el usuario elige
//   - error?: boolean           → marca el borde con rojo si hay error de validación
//   - disabled?: boolean        → modo solo-lectura (para ficha)
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
  value: string | null
  onChange: (valor: ValorRueda) => void
  error?: boolean
  disabled?: boolean
}

interface Rueda {
  key: ValorRueda
  /** Coordenadas del centro del elipse en el viewBox del SVG */
  cx: number
  cy: number
  rx: number
  ry: number
  label: string
  /** Posición del label debajo del SVG */
  labelPos: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'aux'
}

// Ruedas del auto — vista superior, viewBox 400x600
const RUEDAS: Rueda[] = [
  { key: 'Delantera izquierda', cx: 60, cy: 130, rx: 22, ry: 40, label: 'Del. izq.', labelPos: 'top-left' },
  { key: 'Delantera derecha', cx: 240, cy: 130, rx: 22, ry: 40, label: 'Del. der.', labelPos: 'top-right' },
  { key: 'Trasera izquierda', cx: 60, cy: 420, rx: 22, ry: 40, label: 'Tras. izq.', labelPos: 'bottom-left' },
  { key: 'Trasera derecha', cx: 240, cy: 420, rx: 22, ry: 40, label: 'Tras. der.', labelPos: 'bottom-right' },
  // Auxilio: separada, a la derecha del auto
  { key: 'Auxilio', cx: 355, cy: 275, rx: 30, ry: 30, label: 'Auxilio', labelPos: 'aux' },
]

export function SelectorRueda({ value, onChange, error, disabled }: Props) {
  const colorSeleccionada = '#dc2626' // rojo-600
  const colorRuedaNormal = '#334155' // slate-700
  const colorRuedaHover = '#0f172a' // slate-900
  const colorCarroceria = '#e2e8f0' // slate-200
  const colorBordeCarroceria = '#94a3b8' // slate-400
  const colorTexto = '#475569' // slate-600

  return (
    <div className={`inline-block ${error ? 'ring-2 ring-red-500/40 rounded-lg p-1' : ''}`}>
      <svg
        viewBox="0 0 400 600"
        className="w-full max-w-[280px] mx-auto block select-none"
        style={{ height: 'auto' }}
        role="group"
        aria-label="Seleccionar rueda robada"
      >
        {/* Carrocería del auto (vista superior) */}
        <rect
          x={40}
          y={70}
          width={220}
          height={470}
          rx={40}
          ry={40}
          fill={colorCarroceria}
          stroke={colorBordeCarroceria}
          strokeWidth={2}
        />

        {/* Parabrisas delantero */}
        <path
          d="M 60 115 Q 150 90 240 115 L 235 175 Q 150 165 65 175 Z"
          fill="#cbd5e1"
          stroke={colorBordeCarroceria}
          strokeWidth={1.5}
        />

        {/* Luneta trasera */}
        <path
          d="M 60 495 Q 150 520 240 495 L 235 435 Q 150 445 65 435 Z"
          fill="#cbd5e1"
          stroke={colorBordeCarroceria}
          strokeWidth={1.5}
        />

        {/* Techo */}
        <rect
          x={65}
          y={180}
          width={170}
          height={250}
          rx={4}
          ry={4}
          fill="#f1f5f9"
          stroke={colorBordeCarroceria}
          strokeWidth={1}
        />

        {/* Divisor central del techo */}
        <line x1={150} y1={185} x2={150} y2={425} stroke={colorBordeCarroceria} strokeWidth={1} strokeDasharray="4 4" />

        {/* Espejos */}
        <ellipse cx={35} cy={170} rx={8} ry={12} fill={colorCarroceria} stroke={colorBordeCarroceria} strokeWidth={1} />
        <ellipse cx={265} cy={170} rx={8} ry={12} fill={colorCarroceria} stroke={colorBordeCarroceria} strokeWidth={1} />

        {/* Ruedas */}
        {RUEDAS.map(rueda => {
          const seleccionada = value === rueda.key
          return (
            <g key={rueda.key}>
              <ellipse
                cx={rueda.cx}
                cy={rueda.cy}
                rx={rueda.rx}
                ry={rueda.ry}
                fill={seleccionada ? colorSeleccionada : colorRuedaNormal}
                stroke={seleccionada ? '#7f1d1d' : '#1e293b'}
                strokeWidth={2}
                onClick={() => !disabled && onChange(rueda.key)}
                onKeyDown={e => {
                  if (disabled) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onChange(rueda.key)
                  }
                }}
                tabIndex={disabled ? -1 : 0}
                role="button"
                aria-label={rueda.label}
                aria-pressed={seleccionada}
                style={{
                  cursor: disabled ? 'default' : 'pointer',
                  transition: 'fill 150ms, stroke 150ms, filter 150ms',
                  filter: seleccionada ? 'drop-shadow(0 0 6px rgba(220, 38, 38, 0.5))' : 'none',
                  outline: 'none',
                }}
                onMouseEnter={e => {
                  if (!disabled && !seleccionada) {
                    e.currentTarget.setAttribute('fill', colorRuedaHover)
                  }
                }}
                onMouseLeave={e => {
                  if (!disabled && !seleccionada) {
                    e.currentTarget.setAttribute('fill', colorRuedaNormal)
                  }
                }}
              />
              {/* X sobre la rueda seleccionada para reforzar "esta falta" */}
              {seleccionada && (
                <g pointerEvents="none">
                  <line
                    x1={rueda.cx - rueda.rx * 0.5}
                    y1={rueda.cy - rueda.ry * 0.4}
                    x2={rueda.cx + rueda.rx * 0.5}
                    y2={rueda.cy + rueda.ry * 0.4}
                    stroke="#ffffff"
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                  <line
                    x1={rueda.cx + rueda.rx * 0.5}
                    y1={rueda.cy - rueda.ry * 0.4}
                    x2={rueda.cx - rueda.rx * 0.5}
                    y2={rueda.cy + rueda.ry * 0.4}
                    stroke="#ffffff"
                    strokeWidth={3}
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
          const seleccionada = value === rueda.key
          const dx = 32

          switch (rueda.labelPos) {
            case 'top-left':
              textX = 10
              textY = rueda.cy + 5
              anchor = 'start'
              break
            case 'top-right':
              textX = 290
              textY = rueda.cy + 5
              anchor = 'start'
              break
            case 'bottom-left':
              textX = 10
              textY = rueda.cy + 5
              anchor = 'start'
              break
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
              fontWeight={seleccionada ? 700 : 500}
              fill={seleccionada ? colorSeleccionada : colorTexto}
              textAnchor={anchor}
              style={{ userSelect: 'none' }}
            >
              {rueda.label}
            </text>
          )
        })}

        {/* Indicador visual: círculo alrededor de "Auxilio" para separarlo visualmente */}
        <circle
          cx={355}
          cy={275}
          r={44}
          fill="none"
          stroke={colorBordeCarroceria}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      </svg>

      {/* Feedback textual debajo del SVG */}
      <div className="text-center mt-2 text-xs text-slate-600">
        {value ? (
          <>
            Rueda seleccionada: <strong className="text-red-600">{value}</strong>
          </>
        ) : (
          <span className="text-slate-400 italic">Tocá la rueda que falta</span>
        )}
      </div>
    </div>
  )
}
