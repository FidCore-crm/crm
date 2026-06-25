// Validadores técnicos puros (sin IA) para el importador de cartera.
// Todos retornan { valido, ... } sin lanzar excepciones.

export function validarDNI(
  dni: string | number | null | undefined
): { valido: boolean; normalizado?: string; motivo?: string } {
  if (dni === null || dni === undefined || dni === '') {
    return { valido: false, motivo: 'DNI vacío' }
  }
  const raw = String(dni).replace(/[\s.\-]/g, '')
  if (!/^\d+$/.test(raw)) {
    return { valido: false, motivo: 'DNI contiene caracteres no numéricos' }
  }
  if (raw.length < 7 || raw.length > 8) {
    return { valido: false, motivo: `DNI debe tener 7 u 8 dígitos (tiene ${raw.length})` }
  }
  return { valido: true, normalizado: raw }
}

const PREFIJOS_CUIT_VALIDOS = ['20', '23', '24', '25', '26', '27', '30', '33', '34']
const MULTIPLICADORES_CUIT = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

export function validarCUIT(
  cuit: string | number | null | undefined
): { valido: boolean; normalizado?: string; motivo?: string } {
  if (cuit === null || cuit === undefined || cuit === '') {
    return { valido: false, motivo: 'CUIT vacío' }
  }
  const raw = String(cuit).replace(/[\s.\-]/g, '')
  if (!/^\d{11}$/.test(raw)) {
    return { valido: false, motivo: 'CUIT debe tener 11 dígitos' }
  }
  const prefijo = raw.slice(0, 2)
  if (!PREFIJOS_CUIT_VALIDOS.includes(prefijo)) {
    return { valido: false, motivo: `Prefijo de CUIT inválido (${prefijo})` }
  }
  let suma = 0
  for (let i = 0; i < 10; i++) {
    suma += parseInt(raw[i], 10) * MULTIPLICADORES_CUIT[i]
  }
  const resto = suma % 11
  let digitoCalculado = 11 - resto
  if (digitoCalculado === 11) digitoCalculado = 0
  if (digitoCalculado === 10) {
    return { valido: false, motivo: 'CUIT con dígito verificador inválido' }
  }
  if (digitoCalculado !== parseInt(raw[10], 10)) {
    return { valido: false, motivo: 'Dígito verificador incorrecto' }
  }
  const normalizado = `${raw.slice(0, 2)}-${raw.slice(2, 10)}-${raw.slice(10)}`
  return { valido: true, normalizado }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validarEmail(
  email: string | null | undefined
): { valido: boolean; normalizado?: string } {
  if (!email) return { valido: false }
  const limpio = String(email).trim().toLowerCase()
  if (limpio.length === 0 || limpio.length > 254) return { valido: false }
  if (!EMAIL_REGEX.test(limpio)) return { valido: false }
  return { valido: true, normalizado: limpio }
}

export function validarTelefono(
  tel: string | null | undefined
): { valido: boolean; normalizado?: string } {
  if (!tel) return { valido: false }
  const digitos = String(tel).replace(/\D/g, '')
  if (digitos.length === 0) return { valido: false }

  let normalizado = digitos
  if (normalizado.startsWith('54')) {
    // dejarlo tal cual
  } else if (normalizado.startsWith('0')) {
    normalizado = '54' + normalizado.slice(1)
  }

  if (normalizado.length < 8 || normalizado.length > 15) {
    return { valido: false }
  }
  return { valido: true, normalizado: `+${normalizado}` }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function fechaIsoDesdeYMD(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100) return null
  if (m < 1 || m > 12) return null
  if (d < 1 || d > 31) return null
  // Validación real del día (ej: 31 de febrero)
  const check = new Date(Date.UTC(y, m - 1, d))
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d
  ) {
    return null
  }
  return `${y}-${pad2(m)}-${pad2(d)}`
}

function normalizarAnio2Digitos(yy: number): number {
  return yy >= 50 ? 1900 + yy : 2000 + yy
}

export function validarFecha(
  fecha: unknown
): { valido: boolean; fecha_iso?: string; motivo?: string } {
  if (fecha === null || fecha === undefined || fecha === '') {
    return { valido: false, motivo: 'Fecha vacía' }
  }

  // Date object
  if (fecha instanceof Date) {
    if (isNaN(fecha.getTime())) return { valido: false, motivo: 'Date inválido' }
    const iso = fechaIsoDesdeYMD(fecha.getFullYear(), fecha.getMonth() + 1, fecha.getDate())
    if (!iso) return { valido: false, motivo: 'Fecha fuera de rango' }
    return { valido: true, fecha_iso: iso }
  }

  // Número (Excel serial)
  if (typeof fecha === 'number') {
    if (fecha >= 1 && fecha < 60000) {
      const ms = Date.UTC(1899, 11, 30) + fecha * 86400000
      const d = new Date(ms)
      const iso = fechaIsoDesdeYMD(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
      if (!iso) return { valido: false, motivo: 'Fecha fuera de rango' }
      return { valido: true, fecha_iso: iso }
    }
    return { valido: false, motivo: 'Número fuera de rango serial Excel' }
  }

  if (typeof fecha !== 'string') {
    return { valido: false, motivo: 'Tipo no soportado' }
  }

  const texto = fecha.trim()
  if (texto.length === 0) return { valido: false, motivo: 'Fecha vacía' }

  // ISO YYYY-MM-DD (con tolerancia a tiempo extra)
  const mIso = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (mIso) {
    const iso = fechaIsoDesdeYMD(parseInt(mIso[1], 10), parseInt(mIso[2], 10), parseInt(mIso[3], 10))
    if (iso) return { valido: true, fecha_iso: iso }
  }

  // YYYY/MM/DD
  const mSlashIso = texto.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
  if (mSlashIso) {
    const iso = fechaIsoDesdeYMD(
      parseInt(mSlashIso[1], 10),
      parseInt(mSlashIso[2], 10),
      parseInt(mSlashIso[3], 10)
    )
    if (iso) return { valido: true, fecha_iso: iso }
  }

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
  const mDmy = texto.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2}|\d{4})$/)
  if (mDmy) {
    const d = parseInt(mDmy[1], 10)
    const m = parseInt(mDmy[2], 10)
    let y = parseInt(mDmy[3], 10)
    if (mDmy[3].length === 2) y = normalizarAnio2Digitos(y)
    const iso = fechaIsoDesdeYMD(y, m, d)
    if (iso) return { valido: true, fecha_iso: iso }
  }

  return { valido: false, motivo: 'Formato de fecha no reconocido' }
}

export function validarMonto(
  m: unknown
): { valido: boolean; valor?: number; motivo?: string } {
  if (m === null || m === undefined || m === '') {
    return { valido: false, motivo: 'Monto vacío' }
  }
  if (typeof m === 'number') {
    if (isNaN(m) || !isFinite(m) || m < 0) return { valido: false, motivo: 'Monto inválido' }
    return { valido: true, valor: m }
  }
  if (typeof m !== 'string') return { valido: false, motivo: 'Tipo no soportado' }

  let limpio = m.trim().replace(/[\$\s]/g, '').replace(/[a-zA-Z]/g, '')
  if (limpio.length === 0) return { valido: false, motivo: 'Monto vacío' }

  const tieneNegativo = limpio.startsWith('-')
  if (tieneNegativo) limpio = limpio.slice(1)

  const tienePunto = limpio.includes('.')
  const tieneComa = limpio.includes(',')

  let normalizado: string
  if (tienePunto && tieneComa) {
    // El último separador es el decimal
    const ultimoPunto = limpio.lastIndexOf('.')
    const ultimaComa = limpio.lastIndexOf(',')
    if (ultimaComa > ultimoPunto) {
      // Coma decimal, punto miles
      normalizado = limpio.replace(/\./g, '').replace(',', '.')
    } else {
      // Punto decimal, coma miles
      normalizado = limpio.replace(/,/g, '')
    }
  } else if (tieneComa) {
    // Solo coma → decimal argentino
    normalizado = limpio.replace(/\./g, '').replace(',', '.')
  } else if (tienePunto) {
    // Solo punto: detectar si es miles o decimal
    const partes = limpio.split('.')
    if (partes.length > 2) {
      // Múltiples puntos → miles: 1.234.567
      normalizado = limpio.replace(/\./g, '')
    } else {
      // Un solo punto: mirar dígitos después
      const decimales = partes[1].length
      if (decimales === 3 && partes[0].length >= 1 && /^\d+$/.test(partes[0])) {
        // Ambiguo: 1.234 podría ser 1234 (miles) o 1.234 (decimal).
        // Regla: si el entero tiene 1-3 dígitos, lo tratamos como miles.
        normalizado = limpio.replace('.', '')
      } else {
        normalizado = limpio
      }
    }
  } else {
    normalizado = limpio
  }

  const valor = parseFloat(normalizado)
  if (isNaN(valor) || !isFinite(valor)) {
    return { valido: false, motivo: 'No se pudo parsear como número' }
  }
  if (valor < 0) return { valido: false, motivo: 'Monto negativo' }
  return { valido: true, valor }
}

const PATENTE_AUTO_VIEJA = /^[A-Z]{3}\d{3}$/
const PATENTE_AUTO_NUEVA = /^[A-Z]{2}\d{3}[A-Z]{2}$/
const PATENTE_MOTO_VIEJA = /^\d{3}[A-Z]{3}$/
const PATENTE_MOTO_NUEVA = /^[A-Z]\d{3}[A-Z]{3}$/

export function validarPatente(
  p: string | null | undefined
): {
  valido: boolean
  normalizado?: string
  tipo?: 'AUTO_VIEJA' | 'AUTO_NUEVA' | 'MOTO_VIEJA' | 'MOTO_NUEVA'
} {
  if (!p) return { valido: false }
  const limpio = String(p).replace(/[\s\-]/g, '').toUpperCase()
  if (PATENTE_AUTO_NUEVA.test(limpio)) {
    return { valido: true, normalizado: limpio, tipo: 'AUTO_NUEVA' }
  }
  if (PATENTE_AUTO_VIEJA.test(limpio)) {
    return { valido: true, normalizado: limpio, tipo: 'AUTO_VIEJA' }
  }
  if (PATENTE_MOTO_NUEVA.test(limpio)) {
    return { valido: true, normalizado: limpio, tipo: 'MOTO_NUEVA' }
  }
  if (PATENTE_MOTO_VIEJA.test(limpio)) {
    return { valido: true, normalizado: limpio, tipo: 'MOTO_VIEJA' }
  }
  return { valido: false }
}
