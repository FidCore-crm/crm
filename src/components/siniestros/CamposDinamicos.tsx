'use client'

// ============================================================================
// CamposDinamicos.tsx — Renderer único de bloques + campos de un siniestro.
//
// Renderea la matriz definida en siniestros-catalogo.ts para una combinación
// (tipo_riesgo, tipo_siniestro). Usado por:
//   - src/app/denuncia/page.tsx (formulario público)
//   - src/app/crm/siniestros/nuevo/page.tsx (alta manual)
//   - src/components/EditarSiniestroModal.tsx (edición post-carga)
//   - src/app/crm/siniestros/[id]/page.tsx (ficha, modo solo lectura)
//
// Lo que resuelve:
//   - Formularios coherentes entre los 3 lugares.
//   - Campos que varían según el tipo elegido (granizo ≠ accidente).
//   - Toggles inteligentes (hubo_tercero muestra/oculta sub-campos).
//   - Testigos como array dinámico (hasta 3).
//   - SelectorRueda para robo_ruedas.
//
// Estado: se maneja como un objeto plano donde cada key es el "path" del campo.
// Formato:
//   valores.vehiculo_estacionado         → boolean
//   valores.conductor.nombre             → string
//   valores.tercero.nombre               → string
//   valores.tercero.categoria            → string
//   valores.testigos = [ { nombre, dni, telefono }, ... ]
//   valores.rueda_robada                 → string
//   (campos custom del tipo van al primer nivel: valores.objetos_robados, etc.)
// ============================================================================

import { useMemo } from 'react'
import { camposDeSiniestro, CAMPOS_POR_BLOQUE, CampoEspecifico, BloqueId } from '@/lib/siniestros-catalogo'
import { SelectorRueda } from '@/components/SelectorRueda'
import { SelectorCristal } from '@/components/SelectorCristal'

// ────────────────────────────────────────────────────────────
// Tipos del componente
// ────────────────────────────────────────────────────────────

/**
 * Los toggles Sí/No pueden venir como boolean (registros viejos con checkbox)
 * o como string 'Sí'/'No' (a partir de v1.0.134 el catálogo usa `tipo: 'radio'`
 * para forzar respuesta explícita). Helper `esSi()` normaliza ambos formatos.
 */
type ToggleSiNo = boolean | 'Sí' | 'No' | 'si' | 'no' | ''

export function esSi(valor: unknown): boolean {
  if (valor === true) return true
  if (typeof valor === 'string') {
    const v = valor.toLowerCase().trim()
    return v === 'sí' || v === 'si' || v === 'true'
  }
  return false
}

export interface ValoresDinamicos {
  vehiculo_estacionado?: ToggleSiNo
  otra_persona_conduce?: ToggleSiNo | 'El asegurado' | 'Otra persona'
  conductor?: {
    nombre?: string
    apellido?: string
    dni?: string
    telefono?: string
    relacion?: string
    registro?: string
  }
  hubo_tercero?: ToggleSiNo
  tercero_fuga?: boolean
  motivo_sin_datos_tercero?: string
  tercero?: {
    categoria?: string
    nombre?: string
    dni?: string
    telefono?: string
    compania?: string
    poliza?: string
    patente?: string
    marca?: string
    modelo?: string
    anio?: string
    danos?: string
  }
  hubo_testigos?: ToggleSiNo
  testigos?: Array<{ nombre?: string; dni?: string; telefono?: string }>
  hubo_lesionados?: string
  detalle_lesiones?: string
  danos_propios?: string
  /** Array de ruedas seleccionadas. Legacy: puede venir como string simple de datos viejos. */
  rueda_robada?: string[] | string
  marca_ruedas?: string
  medida_ruedas?: string
  tipo_llanta?: string
  /** Radio Sí/No — el asegurado indica si el vehículo sufrió daños (v1.0.149). */
  sufrio_danos_propios?: string
  /** Array de cristales rotos (multi-select del SelectorCristal, v1.0.149). */
  cristales_rotos?: string[] | string
  /** Campos específicos del tipo elegido (keys planas). */
  [k: string]: unknown
}

interface Props {
  tipoRiesgo: string | null | undefined
  tipoSiniestro: string | null | undefined
  valores: ValoresDinamicos
  onChange: (nuevo: ValoresDinamicos) => void
  errores?: Record<string, string>
  modo?: 'edicion' | 'lectura'
}

const MAX_TESTIGOS = 3

// ────────────────────────────────────────────────────────────
// Helpers de mutación
// ────────────────────────────────────────────────────────────

function setNivel1(valores: ValoresDinamicos, key: string, valor: unknown): ValoresDinamicos {
  return { ...valores, [key]: valor }
}

function setNivel2(
  valores: ValoresDinamicos,
  grupo: string,
  key: string,
  valor: unknown,
): ValoresDinamicos {
  const grupoActual = (valores[grupo] as Record<string, unknown> | undefined) ?? {}
  return { ...valores, [grupo]: { ...grupoActual, [key]: valor } }
}

// ────────────────────────────────────────────────────────────
// Componente principal
// ────────────────────────────────────────────────────────────

export function CamposDinamicos({
  tipoRiesgo,
  tipoSiniestro,
  valores,
  onChange,
  errores,
  modo = 'edicion',
}: Props) {
  const disabled = modo === 'lectura'
  const { bloques, campos } = useMemo(
    () => camposDeSiniestro(tipoRiesgo, tipoSiniestro),
    [tipoRiesgo, tipoSiniestro],
  )

  if (bloques.length === 0 && campos.length === 0) {
    // No hay campos que renderear para este tipo — se maneja todo con los
    // campos estructurales del form principal (fecha, hora, lugar, relato).
    return null
  }

  return (
    <div className="flex flex-col gap-6">
      {bloques.map(bloqueId => (
        <BloqueRender
          key={bloqueId}
          bloqueId={bloqueId}
          valores={valores}
          onChange={onChange}
          errores={errores}
          disabled={disabled}
        />
      ))}

      {/* Campos específicos del tipo (no forman bloque, van al primer nivel) */}
      {campos.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {campos.map(campo => (
            <CampoInput
              key={campo.key}
              campo={campo}
              valor={valores[campo.key]}
              onChange={v => onChange(setNivel1(valores, campo.key, v))}
              error={errores?.[campo.key]}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Sub-componente: renderea un bloque completo (conductor, tercero, etc.)
// ────────────────────────────────────────────────────────────

interface BloqueProps {
  bloqueId: BloqueId
  valores: ValoresDinamicos
  onChange: (nuevo: ValoresDinamicos) => void
  errores?: Record<string, string>
  disabled: boolean
}

function BloqueRender({ bloqueId, valores, onChange, errores, disabled }: BloqueProps) {
  // ─ Casos especiales ─
  if (bloqueId === 'selector_rueda') {
    return <BloqueSelectorRueda valores={valores} onChange={onChange} errores={errores} disabled={disabled} />
  }
  if (bloqueId === 'selector_cristal') {
    return <BloqueSelectorCristal valores={valores} onChange={onChange} errores={errores} disabled={disabled} />
  }
  if (bloqueId === 'testigos') {
    return <BloqueTestigos valores={valores} onChange={onChange} errores={errores} disabled={disabled} />
  }
  if (bloqueId === 'vehiculo_estacionado') {
    // Solo un checkbox, sin card
    const campos = CAMPOS_POR_BLOQUE.vehiculo_estacionado
    return (
      <div>
        {campos.map(c => (
          <CampoInput
            key={c.key}
            campo={c}
            valor={valores[c.key]}
            onChange={v => onChange(setNivel1(valores, c.key, v))}
            error={errores?.[c.key]}
            disabled={disabled}
          />
        ))}
      </div>
    )
  }
  if (bloqueId === 'danos_propios') {
    // v1.0.149: primero el radio Sí/No obligatorio. Si es "Sí", aparece el
    // textarea. Si es "No", el textarea no se pinta — la respuesta explícita
    // queda registrada y la ficha muestra "NO sufrió daños" en vez de tratar
    // el campo como bypaseado.
    const [preguntaSufrio, textareaDanos] = CAMPOS_POR_BLOQUE.danos_propios
    const respuesta = valores.sufrio_danos_propios as string | undefined
    const activo = respuesta === 'Sí' || respuesta === 'si'
    return (
      <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50">
        <div className="text-sm font-semibold text-slate-700 mb-3">Daños del vehículo asegurado</div>
        <CampoInput
          campo={preguntaSufrio}
          valor={valores.sufrio_danos_propios}
          onChange={v => onChange(setNivel1(valores, 'sufrio_danos_propios', v))}
          error={errores?.sufrio_danos_propios}
          disabled={disabled}
        />
        {activo && (
          <div className="mt-3">
            <CampoInput
              campo={textareaDanos}
              valor={valores.danos_propios}
              onChange={v => onChange(setNivel1(valores, 'danos_propios', v))}
              error={errores?.danos_propios}
              disabled={disabled}
            />
          </div>
        )}
      </div>
    )
  }

  // ─ Bloques con toggle (conductor, tercero, lesionados) ─
  const campos = CAMPOS_POR_BLOQUE[bloqueId]
  const primerCampo = campos[0]
  const toggleKey = primerCampo?.key
  const toggleTipo = primerCampo?.tipo

  // Determina si el bloque está "activo" (mostrar sub-campos o no).
  // Los toggles ahora usan radio 'Sí'/'No' — usamos esSi() para normalizar
  // valores legacy (boolean) y nuevos (string).
  let activo = true
  if (bloqueId === 'conductor') {
    // 'Otra persona' significa que conducía alguien distinto al asegurado.
    const v = valores.otra_persona_conduce
    activo = v === 'Otra persona' || v === true
  } else if (bloqueId === 'tercero') {
    activo = esSi(valores.hubo_tercero)
  } else if (bloqueId === 'lesionados') {
    activo = valores.hubo_lesionados !== undefined && valores.hubo_lesionados !== '' && valores.hubo_lesionados !== 'No'
  }

  const camposActivos = activo ? campos.slice(1) : []
  const tituloBloque: Record<BloqueId, string> = {
    conductor: 'Conductor',
    tercero: 'Datos del tercero',
    lesionados: 'Lesionados',
    testigos: 'Testigos',
    vehiculo_estacionado: '',
    danos_propios: '',
    selector_rueda: '',
    selector_cristal: '',
  }

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50">
      {tituloBloque[bloqueId] && (
        <div className="text-sm font-semibold text-slate-700 mb-3">{tituloBloque[bloqueId]}</div>
      )}

      {/* Toggle inicial */}
      {toggleKey && toggleTipo && (
        <div className="mb-3">
          <CampoInput
            campo={primerCampo}
            valor={
              // El toggle del bloque puede vivir en primer nivel (hubo_tercero, otra_persona_conduce)
              // o dentro del grupo (hubo_lesionados en lesionados).
              bloqueId === 'lesionados' ? valores.hubo_lesionados : valores[toggleKey]
            }
            onChange={v => {
              if (bloqueId === 'lesionados') {
                onChange(setNivel1(valores, 'hubo_lesionados', v))
              } else {
                onChange(setNivel1(valores, toggleKey, v))
              }
            }}
            error={errores?.[toggleKey]}
            disabled={disabled}
          />
        </div>
      )}

      {/* Campos del bloque cuando el toggle está activo */}
      {activo && camposActivos.length > 0 && (
        <>
          {/* Checkbox especial "tercero_fuga" antes de los datos del tercero */}
          {bloqueId === 'tercero' && camposActivos.some(c => c.key === 'tercero_fuga') && (
            <div className="mb-3">
              {(() => {
                const cf = camposActivos.find(c => c.key === 'tercero_fuga')!
                return (
                  <CampoInput
                    campo={cf}
                    valor={valores.tercero_fuga}
                    onChange={v => onChange(setNivel1(valores, 'tercero_fuga', v))}
                    error={errores?.tercero_fuga}
                    disabled={disabled}
                  />
                )
              })()}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {camposActivos
              .filter(c => c.key !== 'tercero_fuga')
              .map(campo => {
                // Los campos del bloque tercero/conductor van al grupo anidado.
                // Los del bloque lesionados (excepto el toggle) van al primer nivel.
                let valor: unknown
                let onCampoChange: (v: unknown) => void
                if (bloqueId === 'conductor') {
                  valor = valores.conductor?.[campo.key as keyof NonNullable<ValoresDinamicos['conductor']>]
                  onCampoChange = v => onChange(setNivel2(valores, 'conductor', campo.key, v))
                } else if (bloqueId === 'tercero') {
                  valor = valores.tercero?.[campo.key as keyof NonNullable<ValoresDinamicos['tercero']>]
                  onCampoChange = v => onChange(setNivel2(valores, 'tercero', campo.key, v))
                } else {
                  // lesionados
                  valor = valores[campo.key]
                  onCampoChange = v => onChange(setNivel1(valores, campo.key, v))
                }
                return (
                  <CampoInput
                    key={campo.key}
                    campo={campo}
                    valor={valor}
                    onChange={onCampoChange}
                    error={errores?.[campo.key]}
                    disabled={disabled}
                  />
                )
              })}
          </div>
        </>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Bloque especial: selector visual de rueda + campos asociados
// ────────────────────────────────────────────────────────────

function BloqueSelectorRueda({ valores, onChange, errores, disabled }: Omit<BloqueProps, 'bloqueId'>) {
  const campos = CAMPOS_POR_BLOQUE.selector_rueda
  const [rueda, marca, medida, llanta] = campos

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50">
      <div className="text-sm font-semibold text-slate-700 mb-3">
        {rueda.label} {rueda.requerido && <span className="text-red-600">*</span>}
      </div>
      {rueda.ayuda && <p className="text-xs text-slate-600 mb-3">{rueda.ayuda}</p>}

      <SelectorRueda
        value={(valores.rueda_robada as string[] | string | null) ?? null}
        onChange={v => onChange(setNivel1(valores, 'rueda_robada', v))}
        error={Boolean(errores?.rueda_robada)}
        disabled={disabled}
      />

      {errores?.rueda_robada && (
        <p className="text-xs text-red-600 text-center mt-2">{errores.rueda_robada}</p>
      )}

      <div className="grid grid-cols-2 gap-3 mt-4">
        {[marca, medida, llanta].map(c => (
          <CampoInput
            key={c.key}
            campo={c}
            valor={valores[c.key]}
            onChange={v => onChange(setNivel1(valores, c.key, v))}
            error={errores?.[c.key]}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Bloque especial: selector visual de cristales rotos
// ────────────────────────────────────────────────────────────

function BloqueSelectorCristal({ valores, onChange, errores, disabled }: Omit<BloqueProps, 'bloqueId'>) {
  const [cristales] = CAMPOS_POR_BLOQUE.selector_cristal

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50">
      <div className="text-sm font-semibold text-slate-700 mb-3">
        {cristales.label} {cristales.requerido && <span className="text-red-600">*</span>}
      </div>
      {cristales.ayuda && <p className="text-xs text-slate-600 mb-3">{cristales.ayuda}</p>}

      <SelectorCristal
        value={(valores.cristales_rotos as string[] | string | null) ?? null}
        onChange={v => onChange(setNivel1(valores, 'cristales_rotos', v))}
        error={Boolean(errores?.cristales_rotos)}
        disabled={disabled}
      />

      {errores?.cristales_rotos && (
        <p className="text-xs text-red-600 text-center mt-2">{errores.cristales_rotos}</p>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Bloque especial: testigos (array dinámico de hasta 3)
// ────────────────────────────────────────────────────────────

function BloqueTestigos({ valores, onChange, errores, disabled }: Omit<BloqueProps, 'bloqueId'>) {
  const camposTestigo = CAMPOS_POR_BLOQUE.testigos.slice(1) // el primero es el toggle "hubo_testigos"
  const activo = Boolean(valores.hubo_testigos)
  const testigos = valores.testigos ?? []

  const agregarTestigo = () => {
    if (testigos.length >= MAX_TESTIGOS) return
    onChange(setNivel1(valores, 'testigos', [...testigos, { nombre: '', dni: '', telefono: '' }]))
  }

  const quitarTestigo = (idx: number) => {
    onChange(setNivel1(valores, 'testigos', testigos.filter((_, i) => i !== idx)))
  }

  const updateTestigo = (idx: number, key: string, valor: unknown) => {
    const nuevo = testigos.map((t, i) => (i === idx ? { ...t, [key]: valor } : t))
    onChange(setNivel1(valores, 'testigos', nuevo))
  }

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/50">
      <div className="text-sm font-semibold text-slate-700 mb-3">Testigos</div>

      <div className="mb-3">
        <CampoInput
          campo={CAMPOS_POR_BLOQUE.testigos[0]}
          valor={valores.hubo_testigos}
          onChange={v => {
            onChange(setNivel1(valores, 'hubo_testigos', v))
            if (v && testigos.length === 0) {
              // Al activar por primera vez, agregar un testigo vacío para editar
              onChange(setNivel1({ ...valores, hubo_testigos: true as unknown as boolean }, 'testigos', [{ nombre: '', dni: '', telefono: '' }]))
            }
          }}
          error={errores?.hubo_testigos}
          disabled={disabled}
        />
      </div>

      {activo && (
        <div className="flex flex-col gap-3">
          {testigos.map((testigo, idx) => (
            <div key={idx} className="border border-slate-200 rounded p-3 bg-white">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-600">Testigo {idx + 1}</span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => quitarTestigo(idx)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Quitar
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {camposTestigo.map(c => (
                  <CampoInput
                    key={c.key}
                    campo={c}
                    valor={testigo[c.key as keyof typeof testigo] ?? ''}
                    onChange={v => updateTestigo(idx, c.key, v)}
                    error={errores?.[`testigos.${idx}.${c.key}`]}
                    disabled={disabled}
                  />
                ))}
              </div>
            </div>
          ))}
          {!disabled && testigos.length < MAX_TESTIGOS && (
            <button
              type="button"
              onClick={agregarTestigo}
              className="text-xs text-blue-600 hover:underline self-start"
            >
              + Agregar otro testigo
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Widget individual: input, textarea, select, checkbox, radio
// ────────────────────────────────────────────────────────────

interface CampoInputProps {
  campo: CampoEspecifico
  valor: unknown
  onChange: (valor: unknown) => void
  error?: string
  disabled?: boolean
}

function CampoInput({ campo, valor, onChange, error, disabled }: CampoInputProps) {
  const opciones = Array.isArray(campo.opciones)
    ? campo.opciones
    : typeof campo.opciones === 'string'
      ? campo.opciones.split(',').map(s => s.trim())
      : []

  const anchoCol = campo.ancho === 'mitad' ? '' : 'col-span-2'
  const inputClass = `form-input w-full ${error ? 'ring-2 ring-red-500/40' : ''}`

  const idField = `campo-${campo.key}`

  if (campo.tipo === 'checkbox') {
    return (
      <label htmlFor={idField} className={`${anchoCol} flex items-start gap-2 cursor-pointer`}>
        <input
          id={idField}
          type="checkbox"
          checked={Boolean(valor)}
          onChange={e => onChange(e.target.checked)}
          disabled={disabled}
          className="mt-0.5"
        />
        <div className="flex flex-col">
          <span className="text-sm text-slate-700">{campo.label}</span>
          {campo.ayuda && <span className="text-xs text-slate-600">{campo.ayuda}</span>}
        </div>
      </label>
    )
  }

  const label = (
    <label htmlFor={idField} className="block text-xs font-medium text-slate-600 mb-1">
      {campo.label} {campo.requerido && <span className="text-red-600">*</span>}
    </label>
  )

  const ayuda = campo.ayuda && <p className="text-2xs text-slate-600 mt-1">{campo.ayuda}</p>
  const errorMsg = error && <p className="text-2xs text-red-600 mt-1">{error}</p>

  if (campo.tipo === 'textarea') {
    return (
      <div className={anchoCol}>
        {label}
        <textarea
          id={idField}
          value={typeof valor === 'string' ? valor : ''}
          onChange={e => onChange(e.target.value)}
          placeholder={campo.placeholder}
          disabled={disabled}
          rows={3}
          className={inputClass}
        />
        {ayuda}
        {errorMsg}
      </div>
    )
  }

  if (campo.tipo === 'select') {
    return (
      <div className={anchoCol}>
        {label}
        <select
          id={idField}
          value={typeof valor === 'string' ? valor : ''}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          className={inputClass}
        >
          <option value="">— Elegí —</option>
          {opciones.map(o => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {ayuda}
        {errorMsg}
      </div>
    )
  }

  if (campo.tipo === 'radio') {
    return (
      <div className={anchoCol}>
        {label}
        <div className="flex flex-wrap gap-3">
          {opciones.map(o => (
            <label key={o} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name={idField}
                value={o}
                checked={valor === o}
                onChange={() => onChange(o)}
                disabled={disabled}
              />
              <span className="text-sm text-slate-700">{o}</span>
            </label>
          ))}
        </div>
        {ayuda}
        {errorMsg}
      </div>
    )
  }

  // text | number | date
  return (
    <div className={anchoCol}>
      {label}
      <input
        id={idField}
        type={campo.tipo}
        value={typeof valor === 'string' || typeof valor === 'number' ? String(valor) : ''}
        onChange={e => onChange(e.target.value)}
        placeholder={campo.placeholder}
        disabled={disabled}
        className={inputClass}
      />
      {ayuda}
      {errorMsg}
    </div>
  )
}
