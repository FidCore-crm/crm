// ============================================================
// CONFIGURACIÓN CENTRAL DE SINIESTROS
// Para agregar un ramo nuevo: solo editá este archivo.
// Los formularios y listados se adaptan automáticamente.
// ============================================================

export type TipoRiesgo = 'automotor' | 'moto' | 'hogar' | 'vida' | 'generico'

// ── Estados del trámite ──────────────────────────────────────
export const ESTADOS_SINIESTRO = [
  { value: 'DENUNCIADO',   label: 'Denunciado',    color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 'EN_TRAMITE',   label: 'En Trámite',    color: 'bg-sky-50 text-sky-700 border-sky-200' },
  { value: 'INSPECCION',   label: 'En Inspección', color: 'bg-violet-50 text-violet-700 border-violet-200' },
  { value: 'LIQUIDACION',  label: 'Liquidación',   color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'REPARACION',   label: 'En Reparación', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  { value: 'FINALIZADO',   label: 'Finalizado',    color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 'RECHAZADO',    label: 'Rechazado',     color: 'bg-red-50 text-red-700 border-red-200' },
] as const

export type EstadoSiniestro = typeof ESTADOS_SINIESTRO[number]['value']

// ── Tipos de siniestro (unificados) ───────────────────────────
// Lista única usada en TODOS los formularios (CRM + denuncia pública).
// Si se elige OTRO se muestra un campo "Especificar" libre.
export const TIPOS_SINIESTRO = [
  { value: 'ACCIDENTE_TRANSITO',  label: 'Accidente de tránsito' },
  { value: 'ROBO',                label: 'Robo' },
  { value: 'INCENDIO',            label: 'Incendio' },
  { value: 'GRANIZO',             label: 'Granizo' },
  { value: 'ROTURA_CRISTALES',    label: 'Rotura de Cristales, Parabrisas o Luneta' },
  { value: 'ROTURA_CERRADURAS',   label: 'Rotura de Cerraduras' },
  { value: 'RC_TERCEROS',         label: 'Responsabilidad Civil' },
  { value: 'DAÑOS',               label: 'Daños' },
  { value: 'OTRO',                label: 'Otro' },
] as const

// Compatibilidad retro: la firma vieja TIPOS_POR_RAMO se mantiene devolviendo
// la lista unificada para cualquier ramo. Así código que la importa sigue
// andando sin romperse.
export const TIPOS_POR_RAMO: Record<TipoRiesgo, { value: string; label: string }[]> = {
  automotor: [...TIPOS_SINIESTRO],
  moto:      [...TIPOS_SINIESTRO],
  hogar:     [...TIPOS_SINIESTRO],
  vida:      [...TIPOS_SINIESTRO],
  generico:  [...TIPOS_SINIESTRO],
}

// Fallback para tipos genéricos (mismo)
export const TIPOS_GENERICOS = [...TIPOS_SINIESTRO]

// ── Campos extra por tipo de riesgo ─────────────────────────
// Cada entrada define qué campos adicionales mostrar en el formulario
export interface CampoExtra {
  key:         string
  label:       string
  tipo:        'text' | 'textarea' | 'select' | 'date'
  opciones?:   { value: string; label: string }[]
  placeholder?: string
  requerido?:  boolean
}

const CAMPOS_AUTOMOTOR: CampoExtra[] = [
  { key: 'lugar_hecho',     label: 'Lugar del hecho',        tipo: 'text',     placeholder: 'Av. Rivadavia y Carabobo', requerido: true },
  { key: 'terceros',        label: 'Datos del tercero',      tipo: 'textarea', placeholder: 'Nombre, DNI, patente, compañía del tercero...' },
  { key: 'lesionados',      label: '¿Hay lesionados?',       tipo: 'select',   opciones: [{value:'NO',label:'No'},{value:'SI_LEVE',label:'Sí - Leves'},{value:'SI_GRAVE',label:'Sí - Graves'}] },
  { key: 'acta_policial',   label: 'Nro. Acta Policial',     tipo: 'text',     placeholder: 'Opcional' },
  { key: 'taller',          label: 'Taller de reparación',   tipo: 'text',     placeholder: 'Nombre y dirección del taller' },
]

export const CAMPOS_POR_RAMO: Record<TipoRiesgo, CampoExtra[]> = {
  automotor: CAMPOS_AUTOMOTOR,
  moto:      CAMPOS_AUTOMOTOR,
  hogar: [
    { key: 'descripcion_daños', label: 'Descripción de los daños', tipo: 'textarea', placeholder: 'Detallá los daños en la propiedad...', requerido: true },
    { key: 'ambiente_afectado', label: 'Ambiente afectado',         tipo: 'text',     placeholder: 'Cocina, baño, living...' },
    { key: 'causa',             label: 'Causa del siniestro',       tipo: 'text',     placeholder: 'Cañería rota, cortocircuito...' },
    { key: 'acta_policial',     label: 'Nro. Acta Policial',        tipo: 'text',     placeholder: 'Solo en caso de robo' },
  ],
  vida: [
    { key: 'prestador',       label: 'Prestador / Sanatorio',  tipo: 'text',     placeholder: 'Nombre del sanatorio o médico', requerido: true },
    { key: 'diagnostico',     label: 'Diagnóstico',            tipo: 'textarea', placeholder: 'Descripción del diagnóstico médico' },
    { key: 'fecha_internacion', label: 'Fecha de internación', tipo: 'date' },
    { key: 'beneficiario',    label: 'Beneficiario que cobra', tipo: 'text',     placeholder: 'Nombre del beneficiario' },
  ],
  generico: [
    { key: 'descripcion_daños', label: 'Descripción del siniestro', tipo: 'textarea', placeholder: 'Describí en detalle qué ocurrió...', requerido: true },
    { key: 'lugar_hecho',       label: 'Lugar del hecho',           tipo: 'text',     placeholder: 'Dirección o lugar donde ocurrió' },
    { key: 'acta_policial',     label: 'Nro. Acta Policial',        tipo: 'text',     placeholder: 'Opcional' },
  ],
}

// ── Helper: obtener estado badge ─────────────────────────────
export function getEstadoBadge(estado: string) {
  return ESTADOS_SINIESTRO.find(e => e.value === estado) ?? ESTADOS_SINIESTRO[0]
}

// ── Helper: extraer bien afectado del JSONB del riesgo ───────
export function getBienAfectado(tipoRiesgo: string, detalleTecnico: Record<string, any> | null): string {
  if (!detalleTecnico) return '—'
  switch (tipoRiesgo?.toLowerCase()) {
    case 'automotor':
    case 'moto':      return detalleTecnico.patente ?? '—'
    case 'hogar':     return [detalleTecnico.calle, detalleTecnico.numero].filter(Boolean).join(' ') || '—'
    case 'vida':      return detalleTecnico.beneficiarios ?? '—'
    default:          return detalleTecnico.descripcion ?? '—'
  }
}
