import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'

const COLOR_NAVY = 'FF0A1628'
const COLOR_BORDER = 'FFCBD5E1'
const COLOR_ZEBRA = 'FFF8FAFC'
const COLOR_EXAMPLE_BG = 'FFFEF3C7'
const COLOR_EXAMPLE_TEXT = 'FF92400E'
const COLOR_NOTE_BG = 'FFEFF6FF'
const COLOR_NOTE_TEXT = 'FF1E3A8A'

type BorderSide = { style: 'thin'; color: { argb: string } }
const thinBorder: BorderSide = { style: 'thin', color: { argb: COLOR_BORDER } }
const allBorders = { top: thinBorder, left: thinBorder, bottom: thinBorder, right: thinBorder }

function filaDeRango(rango: string): number {
  const [inicio] = rango.split(':')
  const match = inicio.match(/\d+/)
  return match ? parseInt(match[0], 10) : 1
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
  valores: Array<string | number>,
  zebra: boolean,
) {
  valores.forEach((valor, idx) => {
    const cell = sheet.getRow(fila).getCell(idx + 1)
    cell.value = valor === '' ? null : valor
    cell.font = { size: 10, color: { argb: COLOR_EXAMPLE_TEXT }, italic: true }
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: zebra ? COLOR_ZEBRA : COLOR_EXAMPLE_BG },
    }
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

  const ultimaCol = String.fromCharCode(64 + headers.length)
  aplicarTituloPrincipal(sheet, `A1:${ultimaCol}1`, 'CLIENTES')
  aplicarBannerNota(
    sheet,
    `A2:${ultimaCol}2`,
    '⚠ Las 3 filas de ejemplo (en ámbar) deben eliminarse antes de subir el archivo al CRM',
  )

  aplicarHeaderTabla(sheet, 3, headers)

  const ejemplos: Array<Array<string | number>> = [
    [
      'FISICA',
      '20123456781',
      'PEREZ',
      'Juan Carlos',
      '',
      'juan.perez@mail.com',
      '',
      '+541155551234',
      '',
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
      '',
    ],
    [
      'FISICA',
      '27334455668',
      'GONZALEZ',
      'María Elena',
      '',
      'mgonzalez@mail.com',
      '',
      '+541166667777',
      '',
      '+541166667777',
      'Rivadavia',
      '5678',
      '',
      'Caballito',
      'CABA',
      'CABA',
      'C1406',
      'Argentina',
      'ACTIVO',
      'Web',
      '',
    ],
    [
      'JURIDICA',
      '30701234567',
      '',
      '',
      'TRANSPORTES DEL SUR SRL',
      'contacto@transportes.com',
      '',
      '+541144445555',
      '',
      '',
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
    aplicarFilaEjemplo(sheet, 4 + idx, fila, false)
  })

  for (let i = 0; i < 20; i++) {
    const fila = 7 + i
    for (let c = 1; c <= headers.length; c++) {
      const cell = sheet.getRow(fila).getCell(c)
      cell.border = allBorders
      if (i % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ZEBRA } }
      }
    }
    sheet.getRow(fila).height = 20
  }

  sheet.views = [{ state: 'frozen', ySplit: 3, xSplit: 2, showGridLines: false }]
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: headers.length } }
}

function construirHojaPolizas(wb: ExcelJS.Workbook) {
  const headers: string[] = [
    'dni_cuil',
    'numero_poliza',
    'numero_certificado',
    'numero_endoso',
    'compania',
    'ramo',
    'cobertura',
    'refacturacion',
    'fecha_inicio',
    'fecha_fin',
    'moneda',
    'suma_asegurada',
    'estado',
    'observaciones',
    'tipo_riesgo',
    'descripcion_corta',
    'patente',
    'marca',
    'modelo',
    'anio',
    'motor',
    'chasis',
    'color',
    'uso',
    'direccion_riesgo',
    'tipo_construccion',
    'superficie',
    'capital_asegurado',
    'beneficiarios',
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
    tipo_riesgo: 16,
    descripcion_corta: 24,
    patente: 12,
    marca: 14,
    modelo: 18,
    anio: 8,
    motor: 16,
    chasis: 18,
    color: 12,
    uso: 14,
    direccion_riesgo: 28,
    tipo_construccion: 16,
    superficie: 12,
    capital_asegurado: 16,
    beneficiarios: 22,
  }

  const sheet = wb.addWorksheet('Pólizas', { views: [{ showGridLines: false }] })
  headers.forEach((h, idx) => {
    sheet.getColumn(idx + 1).width = anchos[h] ?? 16
  })

  const ultimaColIdx = headers.length
  const ultimaColLetra =
    ultimaColIdx <= 26
      ? String.fromCharCode(64 + ultimaColIdx)
      : `${String.fromCharCode(64 + Math.floor((ultimaColIdx - 1) / 26))}${String.fromCharCode(65 + ((ultimaColIdx - 1) % 26))}`

  aplicarTituloPrincipal(sheet, `A1:${ultimaColLetra}1`, 'PÓLIZAS')
  aplicarBannerNota(
    sheet,
    `A2:${ultimaColLetra}2`,
    '⚠ Las 3 filas de ejemplo (en ámbar) deben eliminarse antes de subir el archivo al CRM',
  )

  aplicarHeaderTabla(sheet, 3, headers)

  const ejemplos: Array<Array<string | number>> = [
    [
      '20123456781',
      'POL-AUTO-001234',
      '',
      '',
      '',
      'AUTOMOTOR',
      '',
      '',
      '',
      '2026-01-15',
      '2027-01-15',
      'ARS',
      8500000,
      'VIGENTE',
      '',
      'AUTOMOTOR',
      '',
      'AB123CD',
      'Toyota',
      'Corolla XEI',
      2022,
      '',
      '',
      'Blanco',
      'Particular',
      '',
      '',
      '',
      '',
      '',
    ],
    [
      '27334455668',
      'POL-HOG-567',
      '',
      '',
      '',
      'HOGAR',
      '',
      '',
      '',
      '2026-03-01',
      '2027-03-01',
      'ARS',
      35000000,
      'VIGENTE',
      'Casa familiar',
      'HOGAR',
      'Casa con alarma',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'Rivadavia 5678, Caballito',
      'Mampostería',
      '120',
      '',
      '',
    ],
    [
      '30701234567',
      'POL-VIDA-9001',
      '',
      '',
      '',
      'VIDA',
      '',
      '',
      '',
      '2026-02-10',
      '2027-02-10',
      'USD',
      50000,
      'VIGENTE',
      '',
      'VIDA',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      50000,
      'Cónyuge 100%',
    ],
  ]
  ejemplos.forEach((fila, idx) => {
    aplicarFilaEjemplo(sheet, 4 + idx, fila, false)
  })

  for (let i = 0; i < 20; i++) {
    const fila = 7 + i
    for (let c = 1; c <= headers.length; c++) {
      const cell = sheet.getRow(fila).getCell(c)
      cell.border = allBorders
      if (i % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ZEBRA } }
      }
    }
    sheet.getRow(fila).height = 20
  }

  sheet.views = [{ state: 'frozen', ySplit: 3, xSplit: 2, showGridLines: false }]
  sheet.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: headers.length } }
}

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const wb = new ExcelJS.Workbook()
  wb.creator = 'FidCore'
  wb.created = new Date()

  construirHojaClientes(wb)
  construirHojaPolizas(wb)

  const buffer = (await wb.xlsx.writeBuffer()) as unknown as Buffer

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="modelo-importacion-crm-seguros.xlsx"',
      'Cache-Control': 'no-store',
    },
  })
}
