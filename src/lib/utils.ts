import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Funciones de fecha local (sin conversión de zona horaria) ──

// Devuelve la fecha de hoy en formato YYYY-MM-DD en hora local
export function hoyLocal(): string {
  const hoy = new Date()
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`
}

// Devuelve la fecha de hoy en formato YYYY-MM-DD forzando zona horaria Argentina.
// Útil en server-side donde TZ del SO puede ser UTC: evita que el cron transicione
// pólizas un día antes de tiempo entre 21:00 y 23:59 ARG.
export function hoyAR(): string {
  // en-CA produce YYYY-MM-DD nativamente
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

// Devuelve "ahora" en el formato que espera un <input type="datetime-local">
// (`YYYY-MM-DDTHH:mm`) en TZ local, sin pasar por ISO/UTC. Útil como `max`
// para impedir registrar interacciones con fecha futura sin que la TZ del
// servidor adelante o atrase la cota.
export function nowLocalDatetimeInput(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Sanitiza un término de búsqueda para usarlo dentro de filtros de Supabase
// que terminan generando consultas PostgREST `ilike` o `or()`. Hace dos cosas:
//
//   1. Reemplaza por espacio los separadores que PostgREST interpreta como
//      delimitadores cuando se inyectan dentro de `.or()`: coma y paréntesis.
//      Si el PAS busca "Pérez, Juan", la coma rompe el parse del filtro.
//
//   2. Escapa los wildcards de `ilike` (`%`, `_`, `\`) para que se traten
//      como caracteres literales y no como comodines (un `_` suelto matchea
//      cualquier carácter individual y confunde resultados).
//
// Devuelve string vacío si el input es nullish.
// Normaliza un término de búsqueda para usarlo contra columnas `*_norm` de
// Postgres (apellido_norm/nombre_norm/razon_social_norm en personas y leads;
// ver migración 053). Espeja la transformación que hace la DB:
// `lower(unaccent(...))`. Garantiza que tipear "Pérez" o "perez" matchee la
// fila con apellido="Perez". También escapa wildcards `%`/`_` y los
// separadores `,()` que PostgREST interpreta como sintaxis del filtro.
export function sanitizarBusquedaNormalizada(valor: string | null | undefined): string {
  if (!valor) return ''
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[,()]/g, ' ')
    .replace(/[\\%_]/g, c => `\\${c}`)
    .toLowerCase()
    .trim()
}

// Calcula la fecha del siguiente evento de una tarea recurrente, sin drift de TZ
// y respetando el último día del mes cuando el día origen no existe en el destino
// (ej: 31/01 con MENSUAL → 28/02 o 29/02 según año bisiesto).
export type Recurrencia = 'NINGUNA' | 'DIARIA' | 'SEMANAL' | 'MENSUAL' | 'ANUAL'

export function calcularSiguienteFechaRecurrencia(fecha: string, recurrencia: string): string {
  const [anio, mes, dia] = fecha.split('T')[0].split('-').map(Number)
  if (recurrencia === 'DIARIA' || recurrencia === 'SEMANAL') {
    const d = new Date(anio, mes - 1, dia)
    d.setDate(d.getDate() + (recurrencia === 'DIARIA' ? 1 : 7))
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  if (recurrencia === 'MENSUAL') {
    const totalMeses = (mes - 1) + 1
    const nuevoAnio = anio + Math.floor(totalMeses / 12)
    const nuevoMes = (totalMeses % 12) + 1
    const ultimoDiaMes = new Date(nuevoAnio, nuevoMes, 0).getDate()
    const nuevoDia = Math.min(dia, ultimoDiaMes)
    return `${nuevoAnio}-${String(nuevoMes).padStart(2, '0')}-${String(nuevoDia).padStart(2, '0')}`
  }
  if (recurrencia === 'ANUAL') {
    // 29/02 + 1 año en año no bisiesto → 28/02
    const ultimoDiaMes = new Date(anio + 1, mes, 0).getDate()
    const nuevoDia = Math.min(dia, ultimoDiaMes)
    return `${anio + 1}-${String(mes).padStart(2, '0')}-${String(nuevoDia).padStart(2, '0')}`
  }
  return fecha
}

// Formatea una fecha YYYY-MM-DD a DD/MM/YY sin conversión de zona horaria
export function formatFechaLocal(f: string | null | undefined): string {
  if (!f) return '—'
  const [anio, mes, dia] = f.split('T')[0].split('-')
  return `${dia}/${mes}/${anio.slice(2)}`
}

// Formatea una fecha YYYY-MM-DD a DD/MM/YYYY sin conversión de zona horaria
export function formatFechaLocalLarga(f: string | null | undefined): string {
  if (!f) return '—'
  const [anio, mes, dia] = f.split('T')[0].split('-')
  return `${dia}/${mes}/${anio}`
}

// Compara si una fecha YYYY-MM-DD ya venció respecto a hoy local
export function estaVencida(fecha: string | null | undefined): boolean {
  if (!fecha) return false
  return fecha.split('T')[0] < hoyLocal()
}

// Calcula días hasta el vencimiento (negativo si ya venció)
export function diasHastaVencimiento(fecha: string | null | undefined): number {
  if (!fecha) return 0
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const [anio, mes, dia] = fecha.split('T')[0].split('-').map(Number)
  const fechaObj = new Date(anio, mes - 1, dia)
  return Math.ceil((fechaObj.getTime() - hoy.getTime()) / 86400000)
}

// Alias legacy — usa formatFechaLocalLarga internamente
export function formatFecha(fecha: string | null | undefined): string {
  return formatFechaLocalLarga(fecha)
}

// Formatear moneda en pesos argentinos
export function formatMoneda(monto: number | null | undefined, moneda = 'ARS'): string {
  if (monto === null || monto === undefined) return '—'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(monto)
}

// Nombre completo de una persona
export function nombreCompleto(apellido: string, nombre: string | null, razonSocial: string | null): string {
  if (razonSocial) return razonSocial
  return `${apellido}${nombre ? ', ' + nombre : ''}`
}

// Badge class según estado
export function getBadgeClase(estado: string): string {
  const mapa: Record<string, string> = {
    PROGRAMADA: 'badge-programada',
    RENOVADA: 'badge-renovada',
    VIGENTE: 'badge-vigente',
    NO_VIGENTE: 'badge-no-vigente',
    CANCELADA: 'badge-cancelada',
    ANULADA: 'badge-anulada',
    PROSPECTO: 'badge-prospecto',
    ACTIVO: 'badge-activo',
    INACTIVO: 'badge-inactivo',
    DENUNCIADO: 'badge-abierto',
    EN_TRAMITE: 'badge-abierto',
    INSPECCION: 'badge-suspendida',
    LIQUIDACION: 'badge-emitida',
    REPARACION: 'badge-emitida',
    FINALIZADO: 'badge-cerrado',
    RECHAZADO: 'badge-cancelada',
  }
  return mapa[estado] ?? 'badge-inactivo'
}

// Tooltip explicativo para los badges de estado.
// Devuelve string vacío si no hay tooltip definido — el caller puede ocultar
// el atributo `title` cuando esto pasa.
export function getTooltipEstado(estado: string): string {
  const mapa: Record<string, string> = {
    // Personas
    ACTIVO: 'Cliente con pólizas vigentes',
    INACTIVO: 'Cliente sin pólizas activas',
    BLOQUEADO: 'Cliente bloqueado manualmente (ej. fraude / falta de pago)',
    PROSPECTO: 'Lead aún no convertido a cliente',
    // Pólizas
    PROGRAMADA: 'Póliza emitida a la espera del inicio de vigencia',
    RENOVADA: 'Póliza renovada a la espera del inicio de vigencia',
    VIGENTE: 'Póliza vigente y dentro del período de cobertura',
    NO_VIGENTE: 'Póliza con vigencia vencida',
    CANCELADA: 'Póliza dada de baja por solicitud del cliente',
    ANULADA: 'Póliza dada de baja por decisión de la compañía',
    // Siniestros
    DENUNCIADO: 'Siniestro denunciado, sin gestión aún',
    EN_TRAMITE: 'En gestión administrativa con la compañía',
    INSPECCION: 'En inspección',
    LIQUIDACION: 'En proceso de liquidación',
    REPARACION: 'En reparación',
    FINALIZADO: 'Siniestro cerrado',
    RECHAZADO: 'Siniestro rechazado por la compañía',
  }
  return mapa[estado] ?? ''
}

// Label legible de estado
export function getLabelEstado(estado: string): string {
  const mapa: Record<string, string> = {
    PROGRAMADA: 'Programada',
    RENOVADA: 'Renovada',
    VIGENTE: 'Vigente',
    NO_VIGENTE: 'No Vigente',
    CANCELADA: 'Cancelada',
    ANULADA: 'Anulada',
    PROSPECTO: 'Prospecto',
    ACTIVO: 'Asegurado',
    INACTIVO: 'Inactivo',
    BLOQUEADO: 'Bloqueado',
    DENUNCIADO: 'Denunciado',
    EN_TRAMITE: 'En Trámite',
    INSPECCION: 'En Inspección',
    LIQUIDACION: 'Liquidación',
    REPARACION: 'En Reparación',
    FINALIZADO: 'Finalizado',
    RECHAZADO: 'Rechazado',
  }
  return mapa[estado] ?? estado
}

// Colores de badge inline para estados de pólizas
export function getPolizaBadgeColor(estado: string): string {
  const mapa: Record<string, string> = {
    PROGRAMADA:  'bg-blue-50 text-blue-700 border-blue-200',
    RENOVADA:    'bg-violet-50 text-violet-700 border-violet-200',
    VIGENTE:     'bg-emerald-50 text-emerald-700 border-emerald-200',
    // Gris tenue — histórica normal. La póliza venció pero fue renovada,
    // no requiere gestión.
    NO_VIGENTE:  'bg-slate-100 text-slate-600 border-slate-200',
    CANCELADA:   'bg-amber-50 text-amber-700 border-amber-200',
    ANULADA:     'bg-red-50 text-red-700 border-red-200',
    // Estado efectivo especial: la póliza venció Y no tiene renovación
    // creada. El PAS tiene que gestionar. Rojo para llamar la atención.
    VENCIDA:     'bg-red-50 text-red-700 border-red-200',
  }
  return mapa[estado] ?? 'bg-slate-100 text-slate-600 border-slate-200'
}

/**
 * Devuelve el estado "efectivo" de una póliza para el badge de la UI.
 *
 * Solo distingue una situación adicional al estado técnico de DB:
 *   "VENCIDA" = venció Y no tiene renovación creada. Requiere gestión.
 *
 * Casos:
 *   estado=VIGENTE, fecha_fin<hoy, sin hija activa → "VENCIDA" (rojo)
 *   estado=VIGENTE, fecha_fin<hoy, con hija activa → "VIGENTE" (dejamos que
 *      el cron la mueva a NO_VIGENTE cuando la renovación se active)
 *   estado=NO_VIGENTE, sin hija activa → "VENCIDA" (rojo — el cron la movió
 *      pero conceptualmente sigue siendo "venció sin renovar")
 *   estado=NO_VIGENTE, con hija activa → "NO_VIGENTE" (gris tenue — histórica)
 *   resto → estado original
 *
 * "VENCIDA" NO es un estado real en DB, es solo un valor efectivo UI.
 */
export function getEstadoEfectivoPoliza(
  estado: string,
  fechaFin: string | null | undefined,
  tieneRenovacionActiva?: boolean,
): string {
  const hoy = hoyAR()
  const soloFecha = fechaFin ? String(fechaFin).slice(0, 10) : ''

  // VIGENTE con fecha pasada sin renovación → "Vencida" (compensa el cron)
  if (estado === 'VIGENTE' && soloFecha && soloFecha < hoy && !tieneRenovacionActiva) {
    return 'VENCIDA'
  }
  // NO_VIGENTE sin renovación → "Vencida" (el cron ya la movió pero
  // conceptualmente sigue siendo una que venció y no se gestionó)
  if (estado === 'NO_VIGENTE' && !tieneRenovacionActiva) {
    return 'VENCIDA'
  }
  return estado
}

// Label para el estado efectivo "VENCIDA" (no vive en getLabelEstado porque
// no es un estado real en DB).
export function getLabelEstadoEfectivo(estadoEfectivo: string): string {
  if (estadoEfectivo === 'VENCIDA') return 'Vencida'
  return getLabelEstado(estadoEfectivo)
}

// =============================================================================
// Helper para frontend: traducir errores técnicos a mensajes legibles
// =============================================================================
//
// Los mensajes crudos de Postgres ("duplicate key value violates unique
// constraint \"polizas_numero_poliza_key\"") no se entienden por un PAS no
// técnico y filtran nombres de columnas/constraints internos. Esta función
// los mapea a frases en español que cualquiera entiende.
//
// Vive en utils.ts (no en lib/errores) para no arrastrar la cadena de imports
// server-side (`comunicaciones-sender` → `nodemailer`) al bundle del browser.
//
// Uso típico en frontend:
//   } catch (err) {
//     toast.error(mensajeErrorAmigable(err, 'No se pudo guardar la póliza'))
//   }

const _PATRONES_POSTGRES: Array<{ regex: RegExp; mensaje: string }> = [
  { regex: /duplicate key.*unique/i, mensaje: 'Ya existe un registro con esos datos.' },
  { regex: /violates foreign key/i, mensaje: 'Faltan datos relacionados o el registro vinculado no existe.' },
  { regex: /violates not-null/i, mensaje: 'Faltan datos obligatorios.' },
  { regex: /violates check constraint/i, mensaje: 'Los datos cargados no cumplen las validaciones.' },
  { regex: /permission denied|new row violates row-level security/i, mensaje: 'No tenés permisos para realizar esta acción.' },
  { regex: /value too long/i, mensaje: 'Algún campo excede el largo permitido.' },
  { regex: /invalid input syntax/i, mensaje: 'Algún campo tiene un formato inválido.' },
  { regex: /failed to fetch|networkerror|network error/i, mensaje: 'No se pudo conectar con el servidor. Revisá tu conexión.' },
]

export function mensajeErrorAmigable(err: unknown, fallback: string = 'Ocurrió un error inesperado'): string {
  const raw = (err as any)?.message || String(err) || ''
  for (const { regex, mensaje } of _PATRONES_POSTGRES) {
    if (regex.test(raw)) return mensaje
  }
  return fallback
}
