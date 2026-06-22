import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import ExcelJS from 'exceljs'
import { TIPOS_RIESGO } from '@/lib/tipos-riesgo'
import { REFACTURACIONES } from '@/lib/refacturaciones'

export const dynamic = 'force-dynamic'

// ──────────────────────────────────────────────────────────
// Paleta
// ──────────────────────────────────────────────────────────
const COLOR_NAVY = 'FF0A1628'
const COLOR_BORDER = 'FFCBD5E1'
const COLOR_ZEBRA = 'FFF8FAFC'
const COLOR_EXAMPLE_BG = 'FFFEF3C7'
const COLOR_EXAMPLE_TEXT = 'FF92400E'
const COLOR_NOTE_BG = 'FFEFF6FF'
const COLOR_NOTE_TEXT = 'FF1E3A8A'
const COLOR_SECTION_BG = 'FFF1F5F9'
const COLOR_SECTION_TEXT = 'FF0F172A'

type BorderSide = { style: 'thin'; color: { argb: string } }
const thinBorder: BorderSide = { style: 'thin', color: { argb: COLOR_BORDER } }
const allBorders = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder }

// ──────────────────────────────────────────────────────────
// Helpers de estilos
// ──────────────────────────────────────────────────────────
function filaDeRango(rango: string): number {
  const [inicio] = rango.split(':')
  const match = inicio.match(/\d+/)
  return match ? parseInt(match[0], 10) : 1
}

function letraColumna(n: number): string {
  // n=1 → A, n=27 → AA
  let resultado = ''
  while (n > 0) {
    const resto = (n - 1) % 26
    resultado = String.fromCharCode(65 + resto) + resultado
    n = Math.floor((n - 1) / 26)
  }
  return resultado
}

function aplicarTituloPrincipal(sheet: ExcelJS.Worksheet, rango: string, texto: string) {
  sheet.mergeCells(rango)
  const [inicio] = rango.split(':')
  const cell = sheet.getCell(inicio)
  cell.value = texto
  cell.font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_NAVY } }
  cell.alignment = { vertical: 'middle', horizontal: 'center' }
  sheet.getRow(filaDeRango(rango)).height = 36
}

function aplicarHeaderTabla(sheet: ExcelJS.Worksheet, fila: number, headers: string[]) {
  headers.forEach((texto, idx) => {
    const cell = sheet.getRow(fila).getCell(idx + 1)
    cell.value = texto
    cell.font = { bold: true, size: 10.5, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_NAVY } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = allBorders
  })
  sheet.getRow(fila).height = 30
}

function aplicarFilaEjemplo(
  sheet: ExcelJS.Worksheet,
  fila: number,
  valores: Array<string | number | null>,
) {
  valores.forEach((valor, idx) => {
    const cell = sheet.getRow(fila).getCell(idx + 1)
    cell.value = valor === '' || valor === null ? null : valor
    cell.font = { size: 10, color: { argb: COLOR_EXAMPLE_TEXT }, italic: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_EXAMPLE_BG } }
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true }
    cell.border = allBorders
  })
  sheet.getRow(fila).height = 22
}

function aplicarBannerNota(sheet: ExcelJS.Worksheet, rango: string, texto: string) {
  sheet.mergeCells(rango)
  const [inicio] = rango.split(':')
  const cell = sheet.getCell(inicio)
  cell.value = texto
  cell.font = { bold: true, size: 10.5, color: { argb: COLOR_NOTE_TEXT } }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_NOTE_BG } }
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  cell.border = allBorders
  sheet.getRow(filaDeRango(rango)).height = 28
}

function aplicarTextoSeccion(
  sheet: ExcelJS.Worksheet,
  rango: string,
  texto: string,
  opts: { bold?: boolean; size?: number; bg?: string; color?: string; height?: number } = {},
) {
  sheet.mergeCells(rango)
  const [inicio] = rango.split(':')
  const cell = sheet.getCell(inicio)
  cell.value = texto
  cell.font = {
    bold: opts.bold ?? false,
    size: opts.size ?? 11,
    color: { argb: opts.color ?? COLOR_SECTION_TEXT },
  }
  if (opts.bg) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.bg } }
  }
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true }
  if (opts.height) sheet.getRow(filaDeRango(rango)).height = opts.height
}

function aplicarZebraFilas(sheet: ExcelJS.Worksheet, desde: number, cantidad: number, columnas: number) {
  for (let i = 0; i < cantidad; i++) {
    const fila = desde + i
    for (let c = 1; c <= columnas; c++) {
      const cell = sheet.getRow(fila).getCell(c)
      cell.border = allBorders
      if (i % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ZEBRA } }
      }
    }
    sheet.getRow(fila).height = 20
  }
}

// ──────────────────────────────────────────────────────────
// Hoja Instrucciones
// ──────────────────────────────────────────────────────────
function construirHojaInstrucciones(wb: ExcelJS.Workbook) {
  const sheet = wb.addWorksheet('Instrucciones', { views: [{ showGridLines: false }] })

  // Anchos
  sheet.getColumn(1).width = 28
  sheet.getColumn(2).width = 60
  sheet.getColumn(3).width = 60

  aplicarTituloPrincipal(sheet, 'A1:C1', '📋 INSTRUCCIONES DEL MODELO')

  // Intro
  aplicarTextoSeccion(
    sheet,
    'A2:C2',
    'Este archivo tiene 2 hojas para llenar: "Clientes" y "Pólizas". Borrá las filas de ejemplo (en ámbar) antes de subir el archivo.',
    { size: 10.5, bg: COLOR_NOTE_BG, color: COLOR_NOTE_TEXT, height: 32 },
  )

  let fila = 4

  // Sección normalización automática
  aplicarTextoSeccion(sheet, `A${fila}:C${fila}`, '✨ Normalización automática', {
    bold: true,
    size: 12,
    bg: COLOR_SECTION_BG,
    height: 26,
  })
  fila++
  const normalizaciones: Array<[string, string]> = [
    ['Nombres y apellidos', 'Si escribís "JUAN PEREZ" el sistema lo guarda como "Juan Perez". No te preocupes por mayúsculas/minúsculas.'],
    ['Direcciones', 'Title Case automático: "AV. CORRIENTES 1234" → "Av. Corrientes 1234".'],
    ['Razones sociales', 'Las siglas (SA, SRL, SAS) se preservan en mayúscula. "transportes del sur srl" → "Transportes del Sur SRL".'],
    ['Email', 'Se convierte a minúscula y se elimina espacios.'],
    ['Teléfono', 'Se normaliza a formato +54...'],
    ['DNI/CUIT', 'Se eliminan puntos y guiones. Cargá solo números si querés.'],
    ['Patente', 'Se convierte a mayúscula y se eliminan espacios/guiones. "ab 123 cd" → "AB123CD".'],
    ['Fechas', 'Aceptamos DD/MM/YYYY, YYYY-MM-DD o el formato nativo de Excel.'],
    ['Montos', 'Aceptamos "1.250.000", "1250000", "$1.250.000,50". Detección automática.'],
  ]
  for (const [titulo, descripcion] of normalizaciones) {
    sheet.getCell(`A${fila}`).value = titulo
    sheet.getCell(`A${fila}`).font = { bold: true, size: 10 }
    sheet.getCell(`A${fila}`).alignment = { vertical: 'top', indent: 1 }
    sheet.mergeCells(`B${fila}:C${fila}`)
    sheet.getCell(`B${fila}`).value = descripcion
    sheet.getCell(`B${fila}`).alignment = { vertical: 'top', wrapText: true }
    sheet.getCell(`B${fila}`).font = { size: 10 }
    sheet.getRow(fila).height = 32
    fila++
  }
  fila++

  // Sección valores válidos
  aplicarTextoSeccion(sheet, `A${fila}:C${fila}`, '✅ Valores válidos en columnas', {
    bold: true,
    size: 12,
    bg: COLOR_SECTION_BG,
    height: 26,
  })
  fila++

  const valoresValidos: Array<[string, string, string]> = [
    ['tipo_persona', 'FISICA / JURIDICA', 'Persona física (con DNI/nombre/apellido) o jurídica (con CUIT/razón social).'],
    ['estado (cliente)', 'PROSPECTO / ACTIVO / INACTIVO / BLOQUEADO', 'Si no completás, queda como ACTIVO.'],
    ['estado (póliza)', 'PROGRAMADA / VIGENTE / NO_VIGENTE / CANCELADA / ANULADA', 'Si no completás, el sistema lo calcula desde las fechas.'],
    ['moneda', 'ARS / USD', 'Si no completás, queda como ARS.'],
    ['refacturacion', REFACTURACIONES.join(' / '), 'Frecuencia de cobro de la cuota.'],
  ]
  for (const [col, valores, nota] of valoresValidos) {
    sheet.getCell(`A${fila}`).value = col
    sheet.getCell(`A${fila}`).font = { bold: true, name: 'Consolas', size: 10, color: { argb: 'FF92400E' } }
    sheet.getCell(`A${fila}`).alignment = { vertical: 'top', indent: 1 }
    sheet.getCell(`B${fila}`).value = valores
    sheet.getCell(`B${fila}`).font = { size: 10 }
    sheet.getCell(`B${fila}`).alignment = { vertical: 'top', wrapText: true }
    sheet.getCell(`C${fila}`).value = nota
    sheet.getCell(`C${fila}`).font = { size: 10, italic: true, color: { argb: 'FF6B7280' } }
    sheet.getCell(`C${fila}`).alignment = { vertical: 'top', wrapText: true }
    sheet.getRow(fila).height = 32
    fila++
  }
  fila++

  // Sección tipos de riesgo
  aplicarTextoSeccion(sheet, `A${fila}:C${fila}`, '🛡️ Tipos de riesgo y campos opcionales', {
    bold: true,
    size: 12,
    bg: COLOR_SECTION_BG,
    height: 26,
  })
  fila++
  aplicarTextoSeccion(
    sheet,
    `A${fila}:C${fila}`,
    'El sistema deduce el tipo de riesgo automáticamente desde el RAMO de la póliza (no hace falta cargarlo). Si tu cartera tiene datos específicos del bien asegurado (patente, dirección, capital, etc.), agregalos como columnas extra en la hoja "Pólizas". Los campos que tengan datos se guardan en el detalle del riesgo.',
    { size: 10, bg: COLOR_NOTE_BG, color: COLOR_NOTE_TEXT, height: 50 },
  )
  fila++

  // Tabla de tipos
  sheet.getCell(`A${fila}`).value = 'Tipo'
  sheet.getCell(`B${fila}`).value = 'Para qué ramos sirve'
  sheet.getCell(`C${fila}`).value = 'Campos sugeridos (nombres de columna)'
  ;[sheet.getCell(`A${fila}`), sheet.getCell(`B${fila}`), sheet.getCell(`C${fila}`)].forEach((c) => {
    c.font = { bold: true, size: 10.5, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_NAVY } }
    c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true }
    c.border = allBorders
  })
  sheet.getRow(fila).height = 26
  fila++

  for (const tipo of TIPOS_RIESGO) {
    sheet.getCell(`A${fila}`).value = `${tipo.emoji} ${tipo.label}`
    sheet.getCell(`A${fila}`).font = { bold: true, size: 10 }
    sheet.getCell(`A${fila}`).alignment = { vertical: 'top', indent: 1 }
    sheet.getCell(`A${fila}`).border = allBorders

    sheet.getCell(`B${fila}`).value = tipo.ejemplos.length > 0 ? tipo.ejemplos.join(', ') : '—'
    sheet.getCell(`B${fila}`).font = { size: 9.5, italic: true }
    sheet.getCell(`B${fila}`).alignment = { vertical: 'top', wrapText: true }
    sheet.getCell(`B${fila}`).border = allBorders

    const camposNombres = tipo.campos_poliza.map((c) => c.key).join(', ')
    sheet.getCell(`C${fila}`).value = camposNombres || '(solo descripción libre)'
    sheet.getCell(`C${fila}`).font = { size: 9.5, name: 'Consolas', color: { argb: 'FF374151' } }
    sheet.getCell(`C${fila}`).alignment = { vertical: 'top', wrapText: true }
    sheet.getCell(`C${fila}`).border = allBorders

    sheet.getRow(fila).height = 38
    fila++
  }
  fila++

  // Tips finales
  aplicarTextoSeccion(sheet, `A${fila}:C${fila}`, '💡 Consejos', {
    bold: true,
    size: 12,
    bg: COLOR_SECTION_BG,
    height: 26,
  })
  fila++
  const tips: Array<string> = [
    '• Una persona = una fila en "Clientes". Si tiene varias pólizas, repetí su DNI/CUIT en la hoja "Pólizas" para cada póliza.',
    '• El campo dni_cuil es el vínculo entre las dos hojas. Asegurate que coincida exacto.',
    '• Si una compañía/ramo/cobertura no existe en tu CRM todavía, la IA te va a sugerir crearla durante la importación.',
    '• Los nombres en MAYÚSCULA se convierten automáticamente a "Title Case". No te preocupes si la cartera viene gritando.',
    '• Si tu archivo tiene columnas que no encajan en este modelo (ej: "limite_por_evento" para una póliza de RC), agregálas y la IA las va a mapear al detalle del riesgo.',
    '• Borrá las 3 filas de ejemplo (en ámbar) antes de subir el archivo.',
  ]
  for (const tip of tips) {
    sheet.mergeCells(`A${fila}:C${fila}`)
    sheet.getCell(`A${fila}`).value = tip
    sheet.getCell(`A${fila}`).font = { size: 10 }
    sheet.getCell(`A${fila}`).alignment = { vertical: 'middle', wrapText: true, indent: 1 }
    sheet.getRow(fila).height = 26
    fila++
  }
}

// ──────────────────────────────────────────────────────────
// Hoja Clientes
// ──────────────────────────────────────────────────────────
function construirHojaClientes(wb: ExcelJS.Workbook) {
  const headers: string[] = [
    'tipo_persona',
    'dni_cuil',
    'apellido',
    'nombre',
    'razon_social',
    'email',
    'email_secundario',
    'telefono',
    'telefono_secundario',
    'whatsapp',
    'calle',
    'numero',
    'piso_depto',
    'barrio',
    'localidad',
    'provincia',
    'codigo_postal',
    'pais',
    'estado',
    'origen',
    'segmento',
  ]
  const anchos: Record<string, number> = {
    tipo_persona: 14,
    dni_cuil: 15,
    apellido: 20,
    nombre: 20,
    razon_social: 26,
    email: 28,
    email_secundario: 28,
    telefono: 18,
    telefono_secundario: 18,
    whatsapp: 18,
    calle: 22,
    numero: 10,
    piso_depto: 12,
    barrio: 16,
    localidad: 16,
    provincia: 14,
    codigo_postal: 14,
    pais: 14,
    estado: 14,
    origen: 18,
    segmento: 16,
  }

  const sheet = wb.addWorksheet('Clientes', { views: [{ showGridLines: false }] })
  headers.forEach((h, idx) => {
    sheet.getColumn(idx + 1).width = anchos[h] ?? 16
  })

  const ultimaCol = letraColumna(headers.length)
  aplicarTituloPrincipal(sheet, `A1:${ultimaCol}1`, 'CLIENTES')
  aplicarBannerNota(
    sheet,
    `A2:${ultimaCol}2`,
    '⚠ Borrá las filas de ejemplo (ámbar) antes de subir el archivo. Cargá MAYÚSCULA o minúscula como quieras: el sistema lo prolija solo.',
  )

  aplicarHeaderTabla(sheet, 3, headers)

  const ejemplos: Array<Array<string | number | null>> = [
    [
      'FISICA',
      '20123456781',
      'PEREZ',
      'Juan Carlos',
      null,
      'juan.perez@mail.com',
      null,
      '+541155551234',
      null,
      '+541155551234',
      'Av. Corrientes',
      '1234',
      '5 B',
      'San Nicolás',
      'CABA',
      'CABA',
      'C1043',
      'Argentina',
      'ACTIVO',
      'Referido',
      null,
    ],
    [
      'FISICA',
      '27334455668',
      'GONZALEZ',
      'María Elena',
      null,
      'mgonzalez@mail.com',
      null,
      '+541166667777',
      null,
      '+541166667777',
      'Rivadavia',
      '5678',
      null,
      'Caballito',
      'CABA',
      'CABA',
      'C1406',
      'Argentina',
      'ACTIVO',
      'Web',
      null,
    ],
    [
      'JURIDICA',
      '30701234567',
      null,
      null,
      'Transportes del Sur SRL',
      'contacto@transportes.com',
      null,
      '+541144445555',
      null,
      null,
      'Av. Libertador',
      '9999',
      'Piso 3',
      'Palermo',
      'CABA',
      'CABA',
      'C1425',
      'Argentina',
      'ACTIVO',
      'Cartera heredada',
      'PYME',
    ],
  ]
  ejemplos.forEach((fila, idx) => {
    aplicarFilaEjemplo(sheet, 4 + idx, fila)
  })

  aplicarZebraFilas(sheet, 7, 20, headers.length)

  // Data validation: tipo_persona y estado
  const colTipoPersona = letraColumna(headers.indexOf('tipo_persona') + 1)
  const colEstado = letraColumna(headers.indexOf('estado') + 1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(sheet as any).dataValidations.add(`${colTipoPersona}4:${colTipoPersona}1000`, {
    type: 'list',
    allowBlank: true,
    formulae: ['"FISICA,JURIDICA"'],
    showErrorMessage: false,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(sheet as any).dataValidations.add(`${colEstado}4:${colEstado}1000`, {
    type: 'list',
    allowBlank: true,
    formulae: ['"PROSPECTO,ACTIVO,INACTIVO,BLOQUEADO"'],
    showErrorMessage: false,
  })

  sheet.views = [{ state: 'frozen', ySplit: 3, xSplit: 2, showGridLines: false }]
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: headers.length } }
}

// ──────────────────────────────────────────────────────────
// Hoja Pólizas
// ──────────────────────────────────────────────────────────
function construirHojaPolizas(wb: ExcelJS.Workbook) {
  // ──── COLUMNAS ────
  // Core (siempre): identificación + datos comerciales.
  // Opcionales (automotor común): patente, marca, modelo, año, color.
  // Opcionales (inmueble común): calle_riesgo, localidad_riesgo, superficie.
  // Opcionales (personas): capital_asegurado.
  // Cualquier otra columna se mapea al detalle del riesgo automáticamente.
  //
  // SACAMOS respecto al modelo viejo:
  // - tipo_riesgo (se deriva del ramo)
  // - motor / chasis (datos técnicos que rara vez vienen en una cartera importada;
  //   si vienen como columna extra, igual se guardan en detalle_tecnico)
  // - direccion_riesgo / tipo_construccion (se reemplazan por calle_riesgo + localidad_riesgo
  //   que es lo que más se usa en la práctica)
  // - beneficiarios (texto largo libre, se carga después; en JSONB si viene como extra)
  // - descripcion_corta (la genera el sistema desde marca+modelo o desde la descripción del ramo)
  const headers: string[] = [
    // Identificación
    'dni_cuil',
    'numero_poliza',
    'numero_certificado',
    'numero_endoso',
    // Catálogos
    'compania',
    'ramo',
    'cobertura',
    // Datos comerciales
    'refacturacion',
    'fecha_inicio',
    'fecha_fin',
    'moneda',
    'suma_asegurada',
    'estado',
    'observaciones',
    // Datos del bien (opcionales — solo si tu cartera los tiene)
    'patente',
    'marca',
    'modelo',
    'anio',
    'color',
    'uso',
    'calle_riesgo',
    'localidad_riesgo',
    'superficie',
    'capital_asegurado',
  ]
  const anchos: Record<string, number> = {
    dni_cuil: 15,
    numero_poliza: 20,
    numero_certificado: 16,
    numero_endoso: 14,
    compania: 20,
    ramo: 16,
    cobertura: 20,
    refacturacion: 16,
    fecha_inicio: 13,
    fecha_fin: 13,
    moneda: 9,
    suma_asegurada: 16,
    estado: 14,
    observaciones: 26,
    patente: 12,
    marca: 14,
    modelo: 18,
    anio: 8,
    color: 12,
    uso: 14,
    calle_riesgo: 24,
    localidad_riesgo: 18,
    superficie: 12,
    capital_asegurado: 16,
  }

  const sheet = wb.addWorksheet('Pólizas', { views: [{ showGridLines: false }] })
  headers.forEach((h, idx) => {
    sheet.getColumn(idx + 1).width = anchos[h] ?? 16
  })

  const ultimaColLetra = letraColumna(headers.length)

  aplicarTituloPrincipal(sheet, `A1:${ultimaColLetra}1`, 'PÓLIZAS')
  aplicarBannerNota(
    sheet,
    `A2:${ultimaColLetra}2`,
    '⚠ El sistema deduce el tipo de riesgo desde el RAMO. Cargá patente/marca/etc. solo si tu cartera los tiene. Borrá las filas de ejemplo antes de subir.',
  )

  aplicarHeaderTabla(sheet, 3, headers)

  const ejemplos: Array<Array<string | number | null>> = [
    // Ejemplo 1: AUTOMOTOR
    [
      '20123456781',
      'POL-AUTO-001234',
      null, // numero_certificado
      null, // numero_endoso
      'La Caja',
      'Automotor',
      'Todo Riesgo',
      'MENSUAL',
      '2026-01-15',
      '2027-01-15',
      'ARS',
      8500000,
      'VIGENTE',
      null,
      'AB123CD',
      'Toyota',
      'Corolla XEI',
      2022,
      'Blanco',
      'Particular',
      null,
      null,
      null,
      null,
    ],
    // Ejemplo 2: HOGAR (Integrales)
    [
      '27334455668',
      'POL-HOG-567',
      null,
      null,
      'Sancor Seguros',
      'Integral de Hogar',
      'Cobertura B',
      'TRIMESTRAL',
      '2026-03-01',
      '2027-03-01',
      'ARS',
      35000000,
      'VIGENTE',
      'Casa familiar',
      null,
      null,
      null,
      null,
      null,
      null,
      'Rivadavia 5678',
      'Caballito',
      120,
      null,
    ],
    // Ejemplo 3: VIDA (Personas)
    [
      '30701234567',
      'POL-VIDA-9001',
      null,
      null,
      'Galeno Vida',
      'Vida',
      'Vida Individual',
      'ANUAL',
      '2026-02-10',
      '2027-02-10',
      'USD',
      50000,
      'VIGENTE',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      50000,
    ],
  ]
  ejemplos.forEach((fila, idx) => {
    aplicarFilaEjemplo(sheet, 4 + idx, fila)
  })

  aplicarZebraFilas(sheet, 7, 20, headers.length)

  // Data validation: refacturacion, moneda, estado
  const colRefac = letraColumna(headers.indexOf('refacturacion') + 1)
  const colMoneda = letraColumna(headers.indexOf('moneda') + 1)
  const colEstado = letraColumna(headers.indexOf('estado') + 1)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(sheet as any).dataValidations.add(`${colRefac}4:${colRefac}1000`, {
    type: 'list',
    allowBlank: true,
    formulae: [`"${REFACTURACIONES.join(',')}"`],
    showErrorMessage: false,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(sheet as any).dataValidations.add(`${colMoneda}4:${colMoneda}1000`, {
    type: 'list',
    allowBlank: true,
    formulae: ['"ARS,USD"'],
    showErrorMessage: false,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(sheet as any).dataValidations.add(`${colEstado}4:${colEstado}1000`, {
    type: 'list',
    allowBlank: true,
    formulae: ['"PROGRAMADA,VIGENTE,NO_VIGENTE,CANCELADA,ANULADA"'],
    showErrorMessage: false,
  })

  sheet.views = [{ state: 'frozen', ySplit: 3, xSplit: 2, showGridLines: false }]
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: headers.length } }
}

// ──────────────────────────────────────────────────────────
// Entrypoint
// ──────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const wb = new ExcelJS.Workbook()
  wb.creator = 'FidCore'
  wb.created = new Date()

  // Orden: Instrucciones primero (lo lee el PAS antes de llenar).
  construirHojaInstrucciones(wb)
  construirHojaClientes(wb)
  construirHojaPolizas(wb)

  const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="modelo-importacion-fidcore.xlsx"',
      'Cache-Control': 'no-store',
    },
  })
}
