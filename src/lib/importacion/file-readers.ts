import * as XLSX from 'xlsx'
import type { CeldaValor, FilaOriginal } from '@/lib/importacion/types'

export interface ResultadoLectura {
  filas: FilaOriginal[]
  headers_detectados: string[]
  fila_header_index: number
  hojas_detectadas?: Array<{ nombre: string; filas: number }>
  total_filas: number
  metadata: {
    mime_type: string
    size_bytes: number
    paginas?: number
    encoding?: string
    requiere_ocr?: boolean
  }
  advertencias: string[]
}

const MAX_SIZE_BYTES = 50 * 1024 * 1024

function esExcel(nombre: string, mime: string): boolean {
  const n = nombre.toLowerCase()
  if (n.endsWith('.xlsx') || n.endsWith('.xls') || n.endsWith('.xlsm')) return true
  if (/spreadsheet|excel/i.test(mime)) return true
  return false
}

function esCsv(nombre: string, mime: string): boolean {
  const n = nombre.toLowerCase()
  if (n.endsWith('.csv') || n.endsWith('.tsv') || n.endsWith('.txt')) return true
  if (/text\/csv|text\/plain/i.test(mime)) return true
  return false
}

function esPdf(nombre: string, mime: string): boolean {
  return nombre.toLowerCase().endsWith('.pdf') || /application\/pdf/i.test(mime)
}

function limpiarHeader(valor: CeldaValor, indice: number): string {
  if (valor === null || valor === undefined) return `Columna_${indice + 1}`
  // eslint-disable-next-line no-control-regex
  let s = String(valor).replace(/[\x00-\x1F\x7F]/g, '').trim()
  s = s.replace(/\s+/g, ' ')
  if (s.length === 0) return `Columna_${indice + 1}`
  return s
}

function celdaEsContenido(c: CeldaValor): boolean {
  if (c === null || c === undefined) return false
  if (typeof c === 'string') return c.trim().length > 0
  return true
}

function detectarFilaHeader(filas: FilaOriginal[]): number {
  const maxScan = Math.min(30, filas.length)
  let mejorIdx = -1
  let mejorScore = -1

  for (let i = 0; i < maxScan; i++) {
    const fila = filas[i] || []
    if (fila.length === 0) continue

    const conContenido = fila.filter(celdaEsContenido)
    // Descartar filas con muy poco contenido (títulos sueltos tipo "CLIENTES",
    // avisos de una sola celda, etc.). Una fila de headers de verdad trae al
    // menos 3 columnas con valores.
    if (conContenido.length < 3) continue

    const stringsCortos = conContenido.filter((c) => {
      if (typeof c !== 'string') return false
      const s = c.trim()
      if (s.length === 0 || s.length > 40) return false
      if (/^-?\d+([.,]\d+)?$/.test(s)) return false
      return true
    })
    const ratioStrings = stringsCortos.length / conContenido.length

    // En vez de mirar sólo la fila inmediatamente siguiente, miramos una
    // ventana de las próximas 5 filas. Eso tolera filas de ejemplo / warning
    // entre el header real y los datos (como el modelo del CRM, que tiene una
    // fila de ejemplos en ámbar), y también archivos de compañías con separadores
    // o subtotales intermedios.
    const ventana = filas.slice(i + 1, i + 6)
    if (ventana.length === 0) continue
    const filasConContenido = ventana.filter((f) =>
      (f || []).some(celdaEsContenido),
    ).length
    const ratioFilasPosteriores = filasConContenido / ventana.length

    // Criterios de header:
    //   - Mayoría de celdas son strings cortos (típico de headers), o
    //   - Al menos 5 strings cortos en absoluto (header "ancho" aunque tenga
    //     algunas celdas numéricas o vacías).
    //   - Y hay al menos una fila con contenido después.
    const pareceHeader =
      (ratioStrings >= 0.6 || stringsCortos.length >= 5) &&
      ratioFilasPosteriores > 0

    if (pareceHeader) {
      // Score prioriza cantidad absoluta de headers (una fila con 20 strings
      // cortos es "más header" que una con 3), pero también premia continuidad
      // de datos posteriores.
      const score =
        stringsCortos.length * 2 +
        ratioStrings * 3 +
        ratioFilasPosteriores * 2
      if (score > mejorScore) {
        mejorScore = score
        mejorIdx = i
      }
    }
  }

  if (mejorIdx !== -1) return mejorIdx

  for (let i = 0; i < filas.length; i++) {
    if ((filas[i] || []).some(celdaEsContenido)) return i
  }
  return 0
}

// Parser CSV mínimo que respeta comillas dobles con escape ""
function parsearCsv(texto: string, separador: string): FilaOriginal[] {
  const filas: FilaOriginal[] = []
  let campo = ''
  let fila: string[] = []
  let inQuotes = false

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]

    if (inQuotes) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        campo += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === separador) {
      fila.push(campo)
      campo = ''
      continue
    }
    if (ch === '\n') {
      fila.push(campo)
      campo = ''
      filas.push(fila)
      fila = []
      continue
    }
    if (ch === '\r') {
      continue
    }
    campo += ch
  }

  if (campo.length > 0 || fila.length > 0) {
    fila.push(campo)
    filas.push(fila)
  }

  return filas.filter((f) => f.length > 0 && f.some((c) => String(c).trim().length > 0))
}

function detectarSeparadorCsv(primeraLinea: string): string {
  const candidatos: Array<{ sep: string; count: number }> = [
    { sep: ',', count: 0 },
    { sep: ';', count: 0 },
    { sep: '\t', count: 0 },
  ]
  let inQuotes = false
  for (let i = 0; i < primeraLinea.length; i++) {
    const ch = primeraLinea[i]
    if (ch === '"') inQuotes = !inQuotes
    if (inQuotes) continue
    for (const c of candidatos) if (c.sep === ch) c.count++
  }
  candidatos.sort((a, b) => b.count - a.count)
  return candidatos[0].count > 0 ? candidatos[0].sep : ','
}

function decodificarBuffer(buffer: Buffer): { texto: string; encoding: string } {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return { texto: buffer.slice(3).toString('utf8'), encoding: 'utf-8-bom' }
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { texto: buffer.slice(2).toString('utf16le'), encoding: 'utf-16le' }
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    // UTF-16 BE: swap bytes
    const swapped = Buffer.alloc(buffer.length - 2)
    for (let i = 2; i < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1]
      swapped[i - 1] = buffer[i]
    }
    return { texto: swapped.toString('utf16le'), encoding: 'utf-16be' }
  }
  return { texto: buffer.toString('utf8'), encoding: 'utf-8' }
}

async function leerExcel(
  buffer: Buffer,
  mimeType: string,
  opciones?: { hoja_preferida?: string; fila_header_override?: number }
): Promise<ResultadoLectura> {
  const advertencias: string[] = []
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellText: false })
  } catch (e) {
    const msg = (e as { message?: string })?.message || 'error desconocido'
    throw new Error('Archivo corrupto o inválido: ' + msg)
  }

  const nombresHojas = wb.SheetNames
  if (nombresHojas.length === 0) {
    throw new Error('El archivo Excel no tiene hojas')
  }

  const hojasDetectadas = nombresHojas.map((nombre) => {
    const ws = wb.Sheets[nombre]
    const filas = XLSX.utils.sheet_to_json<CeldaValor[]>(ws, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    })
    return { nombre, filas: filas.length }
  })

  let hojaElegida = nombresHojas[0]
  if (opciones?.hoja_preferida && nombresHojas.includes(opciones.hoja_preferida)) {
    hojaElegida = opciones.hoja_preferida
  }

  const ws = wb.Sheets[hojaElegida]
  const filasTotal: FilaOriginal[] = XLSX.utils.sheet_to_json<CeldaValor[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  })

  if (filasTotal.length === 0) {
    advertencias.push('El archivo no contiene filas de datos')
  }

  const filaHeaderIndex =
    opciones?.fila_header_override !== undefined
      ? opciones.fila_header_override
      : detectarFilaHeader(filasTotal)

  const filaHeader = filasTotal[filaHeaderIndex] || []
  const headers = filaHeader.map((v: CeldaValor, i: number) => limpiarHeader(v, i))
  const filasDatos = filasTotal.slice(filaHeaderIndex + 1)

  if (filasDatos.length === 0 && filasTotal.length > 0) {
    advertencias.push('No se detectaron filas de datos después del header')
  }

  return {
    filas: filasDatos,
    headers_detectados: headers,
    fila_header_index: filaHeaderIndex,
    hojas_detectadas: nombresHojas.length > 1 ? hojasDetectadas : undefined,
    total_filas: filasDatos.length,
    metadata: { mime_type: mimeType, size_bytes: buffer.length },
    advertencias,
  }
}

async function leerCsvBuffer(
  buffer: Buffer,
  mimeType: string,
  opciones?: { fila_header_override?: number }
): Promise<ResultadoLectura> {
  const advertencias: string[] = []
  const { texto, encoding } = decodificarBuffer(buffer)

  if (/Ã±|Ã³|Ã¡|Ã©|Ãº|Ã/i.test(texto)) {
    advertencias.push('Posible problema de encoding: el archivo parece estar en latin1')
  }

  const primeraLinea = (texto.split(/\r?\n/).find((l) => l.trim().length > 0) || '')
  const separador = detectarSeparadorCsv(primeraLinea)

  const filasTotal = parsearCsv(texto, separador)

  if (filasTotal.length === 0) {
    advertencias.push('El archivo no contiene filas de datos')
  }

  const filaHeaderIndex =
    opciones?.fila_header_override !== undefined
      ? opciones.fila_header_override
      : detectarFilaHeader(filasTotal)

  const filaHeader = filasTotal[filaHeaderIndex] || []
  const headers = filaHeader.map((v: CeldaValor, i: number) => limpiarHeader(v, i))
  const filasDatos = filasTotal.slice(filaHeaderIndex + 1)

  return {
    filas: filasDatos,
    headers_detectados: headers,
    fila_header_index: filaHeaderIndex,
    total_filas: filasDatos.length,
    metadata: { mime_type: mimeType, size_bytes: buffer.length, encoding },
    advertencias,
  }
}

async function leerPdfStub(buffer: Buffer, mimeType: string): Promise<ResultadoLectura> {
  return {
    filas: [],
    headers_detectados: [],
    fila_header_index: 0,
    total_filas: 0,
    metadata: {
      mime_type: mimeType,
      size_bytes: buffer.length,
      requiere_ocr: true,
    },
    advertencias: ['Lectura de PDF aún no implementada en Paso 1. Próximamente.'],
  }
}

export interface InfoHoja {
  nombre: string
  total_filas_raw: number
  fila_header_index: number
  columnas_detectadas: number
  filas_datos: number
  es_datos: boolean
  motivo_skip?: string
}

const REGEX_NOMBRE_INSTRUCCIONES =
  /^\s*(instruc|ayuda|gu[ií]a|readme|info|leer|notas?|reglas?|resumen|cover|portada|leeme|leéme)/i

/**
 * Inspecciona un .xlsx y devuelve metadata por solapa, clasificando cada una
 * como "datos" o no según nombre + estructura detectada. Usado para expandir
 * archivos multi-solapa en múltiples archivos virtuales al iniciar el análisis.
 */
export function listarHojasXlsx(buffer: Buffer): InfoHoja[] {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellText: false })
  } catch {
    return []
  }

  const info: InfoHoja[] = []
  for (const nombre of wb.SheetNames) {
    const ws = wb.Sheets[nombre]
    const filasTotal: FilaOriginal[] = XLSX.utils.sheet_to_json<CeldaValor[]>(ws, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    })

    const headerIdx = detectarFilaHeader(filasTotal)
    const filaHeader = filasTotal[headerIdx] || []
    const columnasDetectadas = filaHeader.filter(celdaEsContenido).length
    const filasDatos = Math.max(0, filasTotal.length - headerIdx - 1)

    let esDatos = true
    let motivo: string | undefined

    if (REGEX_NOMBRE_INSTRUCCIONES.test(nombre)) {
      esDatos = false
      motivo = `Nombre de solapa "${nombre}" parece instructivo`
    } else if (columnasDetectadas < 3) {
      esDatos = false
      motivo = `Solo ${columnasDetectadas} columnas detectadas (mínimo 3 para ser tabla de datos)`
    } else if (filasDatos < 1) {
      esDatos = false
      motivo = 'No hay filas de datos debajo del encabezado'
    }

    info.push({
      nombre,
      total_filas_raw: filasTotal.length,
      fila_header_index: headerIdx,
      columnas_detectadas: columnasDetectadas,
      filas_datos: filasDatos,
      es_datos: esDatos,
      motivo_skip: motivo,
    })
  }

  return info
}

export async function leerArchivo(
  buffer: Buffer,
  mimeType: string,
  nombreArchivo: string,
  opciones?: { hoja_preferida?: string; fila_header_override?: number }
): Promise<ResultadoLectura> {
  if (!buffer || buffer.length === 0) {
    throw new Error('Archivo vacío')
  }
  if (buffer.length > MAX_SIZE_BYTES) {
    throw new Error('Archivo excede 50 MB')
  }

  if (esExcel(nombreArchivo, mimeType)) {
    return leerExcel(buffer, mimeType, opciones)
  }
  if (esPdf(nombreArchivo, mimeType)) {
    return leerPdfStub(buffer, mimeType)
  }
  if (esCsv(nombreArchivo, mimeType)) {
    return leerCsvBuffer(buffer, mimeType, opciones)
  }

  throw new Error(`Tipo de archivo no soportado: ${mimeType || nombreArchivo}`)
}
