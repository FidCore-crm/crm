import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { hexARgb, normalizarColorMarca, COLOR_MARCA_DEFAULT, derivarTonos, textoSobreColor } from './color-marca'
import { ACLARACIONES_COTIZACION_DEFAULT_TEXTO } from './cotizacion-aclaraciones'
import { parsearDetalleOpcion, resumenCortoDetalle } from './cotizacion-detalle'

interface DatosCotizacion {
  numero_cotizacion: string
  fecha: string
  ramo: string
  datos_riesgo: Record<string, any>
  tipo_riesgo: string
  notas: string | null
  fecha_vencimiento?: string | null
}

interface DatosDestinatario {
  nombre: string
  apellido: string
  dni: string | null
  telefono: string | null
  email: string | null
}

interface CompaniaCotizada {
  compania_nombre: string
  cobertura_id?: string | null
  // Nombre genérico de la cobertura del catálogo (ej: "Terceros Completo").
  // Si está presente y difiere de `cobertura_nombre`, se muestra combinado
  // como "Terceros Completo — CF" en el PDF.
  cobertura_nombre_generico?: string | null
  cobertura_nombre: string | null
  cobertura_descripcion?: string | null
  cobertura_cubre?: string[] | null
  precio: number
  detalle: string | null
  seleccionada: boolean
}

interface DatosOrganizacion {
  nombre: string | null
  razon_social: string | null
  telefono: string | null
  email: string | null
  direccion: string | null
  matricula_ssn: string | null
  // Data URL del logo (ej: "data:image/png;base64,iVBOR..."). Si está
  // presente, se renderiza a la izquierda del bloque de cabecera y el
  // texto se desplaza a la derecha. Si es null/undefined, se mantiene
  // el layout viejo (solo texto).
  logo_data_url?: string | null
  // Color hex de marca elegido por el PAS ('#RRGGBB'). Si no viene,
  // se usa el navy por defecto. Solo afecta título principal, nombre
  // organización y header de la tabla.
  color_marca?: string | null
  // Aclaraciones legales editadas por el PAS desde su perfil
  // (`configuracion.cotizacion_aclaraciones`). Texto plano con párrafos
  // separados por línea en blanco. Si viene null/vacío se usan las
  // aclaraciones default del rubro (ver ACLARACIONES_DEFAULT).
  cotizacion_aclaraciones?: string | null
}

// Colores de tipografía:
//  - Títulos de sección (DESTINATARIO, DATOS DEL RIESGO, etc.) en gris
//    muy oscuro para legibilidad sobre blanco.
//  - Texto cuerpo en gris oscuro.
//  - Texto secundario / metadatos en gris medio.
//  - Líneas y bordes en gris claro.
const COLOR_TITULO_SECCION: [number, number, number] = [30, 30, 30]
const COLOR_TEXTO_CUERPO:   [number, number, number] = [40, 40, 40]
const COLOR_TEXTO_SECUNDARIO: [number, number, number] = [110, 110, 110]
const COLOR_TEXTO_TENUE:    [number, number, number] = [140, 140, 140]
const COLOR_LINEA_SUTIL:    [number, number, number] = [220, 220, 220]
const COLOR_LINEA_SECCION:  [number, number, number] = [180, 180, 180]

// Las aclaraciones default viven en `./cotizacion-aclaraciones` (módulo puro
// sin jsPDF) — así el perfil puede importarlas sin arrastrar dependencias.

// Convierte el TEXT del PAS en párrafos. Cada bloque separado por línea
// en blanco es un párrafo. Filtra líneas huérfanas para tolerar formato
// inconsistente. Si el texto está vacío devuelve array vacío.
function parsearAclaraciones(texto: string | null | undefined): string[] {
  if (!texto || !texto.trim()) return []
  return texto
    .split(/\n\s*\n/)                    // párrafos separados por línea en blanco
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 0)
}

function formatMonedaPDF(monto: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(monto)
}

function formatFechaPDF(f: string): string {
  const [anio, mes, dia] = f.split('T')[0].split('-')
  return `${dia}/${mes}/${anio}`
}

// Nombre a mostrar en la columna Cobertura y en el detalle de cada opción.
// Si el catálogo tiene equivalencia comercial distinta al nombre genérico,
// devuelve "Genérico — Comercial" (ej: "Terceros Completo — CF"). Si son
// iguales o falta uno, devuelve el que exista.
function nombreCoberturaCompleto(op: CompaniaCotizada): string {
  const generico = (op.cobertura_nombre_generico ?? '').trim()
  const comercial = (op.cobertura_nombre ?? '').trim()
  if (generico && comercial && generico.toLowerCase() !== comercial.toLowerCase()) {
    return `${generico} — ${comercial}`
  }
  return comercial || generico || '—'
}

function getRiesgoTexto(datos: Record<string, any>, tipo: string): Array<[string, string]> {
  const filas: Array<[string, string]> = []
  if (tipo === 'automotor') {
    if (datos.marca) filas.push(['Marca', String(datos.marca)])
    if (datos.modelo) filas.push(['Modelo', String(datos.modelo)])
    if (datos.anio) filas.push(['Año', String(datos.anio)])
    if (datos.patente) filas.push(['Patente', String(datos.patente)])
    if (datos.color) filas.push(['Color', String(datos.color)])
    if (datos.uso) filas.push(['Uso', String(datos.uso)])
    if (datos.motor) filas.push(['Motor', String(datos.motor)])
    if (datos.chasis) filas.push(['Chasis', String(datos.chasis)])
  } else if (tipo === 'hogar') {
    const dir = [datos.calle, datos.numero].filter(Boolean).join(' ')
    if (dir) filas.push(['Dirección', dir])
    if (datos.localidad) filas.push(['Localidad', String(datos.localidad)])
    if (datos.provincia) filas.push(['Provincia', String(datos.provincia)])
    if (datos.tipo_construccion) filas.push(['Construcción', String(datos.tipo_construccion)])
    if (datos.superficie) filas.push(['Superficie', `${datos.superficie} m²`])
  } else if (tipo === 'vida') {
    if (datos.capital_asegurado) filas.push(['Capital', formatMonedaPDF(Number(datos.capital_asegurado))])
    if (datos.beneficiarios) filas.push(['Beneficiarios', String(datos.beneficiarios)])
  } else {
    if (datos.descripcion) filas.push(['Descripción', String(datos.descripcion)])
  }
  return filas
}

// Calcula dimensiones del logo respetando aspect ratio dentro de una caja
// dada. Si el logo es horizontal (más ancho que alto), se ajusta al ancho
// máximo y se reduce el alto. Si es vertical, al revés. Si es cuadrado,
// se usa el lado más corto.
function calcularTamanioLogo(
  doc: jsPDF,
  dataUrl: string,
  maxW: number,
  maxH: number,
): { w: number; h: number } | null {
  try {
    const props = doc.getImageProperties(dataUrl)
    if (!props.width || !props.height) return null
    const ar = props.width / props.height  // aspect ratio = w/h
    let w = maxW, h = maxW / ar
    if (h > maxH) { h = maxH; w = maxH * ar }
    return { w, h }
  } catch {
    return null
  }
}

// Dibuja el título de sección con una línea sutil debajo. Estilo
// minimalista — sin fondos coloreados, fácil de leer e imprimir bien.
function dibujarTituloSeccion(
  doc: jsPDF,
  texto: string,
  y: number,
  pageWidth: number,
): number {
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...COLOR_TITULO_SECCION)
  doc.text(texto, 14, y)
  doc.setDrawColor(...COLOR_LINEA_SECCION)
  doc.setLineWidth(0.3)
  doc.line(14, y + 1.5, pageWidth - 14, y + 1.5)
  return y + 6
}

// Renderiza datos en formato "key: value" en dos columnas para ahorrar
// espacio cuando hay muchos campos del riesgo.
function dibujarFilasDosColumnas(
  doc: jsPDF,
  filas: Array<[string, string]>,
  xIzq: number,
  yInicio: number,
  anchoCol: number,
): number {
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  let y = yInicio
  for (let i = 0; i < filas.length; i += 2) {
    const [k1, v1] = filas[i]
    doc.setTextColor(...COLOR_TEXTO_SECUNDARIO)
    doc.text(`${k1}:`, xIzq, y)
    doc.setTextColor(...COLOR_TEXTO_CUERPO)
    doc.setFont('helvetica', 'bold')
    doc.text(v1, xIzq + 22, y)
    doc.setFont('helvetica', 'normal')

    if (i + 1 < filas.length) {
      const [k2, v2] = filas[i + 1]
      doc.setTextColor(...COLOR_TEXTO_SECUNDARIO)
      doc.text(`${k2}:`, xIzq + anchoCol, y)
      doc.setTextColor(...COLOR_TEXTO_CUERPO)
      doc.setFont('helvetica', 'bold')
      doc.text(v2, xIzq + anchoCol + 22, y)
      doc.setFont('helvetica', 'normal')
    }
    y += 5
  }
  return y
}

// Pinta footer con número de página y leyenda en cada página.
function pintarFooterTodasPaginas(
  doc: jsPDF,
  pageWidth: number,
  pageHeight: number,
  pieProd: string,
) {
  const total = (doc as any).internal.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    const yLinea = pageHeight - 14
    doc.setDrawColor(...COLOR_LINEA_SUTIL)
    doc.setLineWidth(0.2)
    doc.line(14, yLinea, pageWidth - 14, yLinea)

    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...COLOR_TEXTO_TENUE)
    doc.text(pieProd, 14, yLinea + 5)
    doc.text(`Página ${p} de ${total}`, pageWidth - 14, yLinea + 5, { align: 'right' })
  }
}

// ── Helpers de marca: header, franja, caja, tag, fila destacada ──

// Header superior en fondo blanco (sin rectángulo de color). Logo a la
// izquierda con su tamaño natural, nombre + contacto + matrícula a la
// derecha en texto oscuro. Cerrado con una línea sutil color de marca.
function dibujarHeader(
  doc: jsPDF,
  pageWidth: number,
  organizacion: DatosOrganizacion,
  pleno: { r: number; g: number; b: number },
): number {
  const padX = 14
  const padY = 10
  let textoX = padX

  const cajaLogo = 26   // logo bastante más grande que el anterior (era 18)

  // Logo con aspect ratio respetado, sobre fondo blanco (sin caja de color).
  if (organizacion.logo_data_url) {
    try {
      const m = organizacion.logo_data_url.match(/^data:image\/(\w+);/i)
      const ext = (m?.[1] ?? 'png').toUpperCase()
      const formato = ext === 'JPG' ? 'JPEG' : ext

      const dim = calcularTamanioLogo(doc, organizacion.logo_data_url, cajaLogo, cajaLogo)
      if (dim) {
        // Centro vertical dentro del bloque del header
        const xLogo = padX
        const yLogo = padY + (cajaLogo - dim.h) / 2
        doc.addImage(organizacion.logo_data_url, formato, xLogo, yLogo, dim.w, dim.h)
      }
      textoX = padX + cajaLogo + 6
    } catch {
      textoX = padX
    }
  }

  // Nombre organización — en color de marca sobre blanco
  const nombre = organizacion.razon_social || organizacion.nombre || 'Mi Organización'
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(pleno.r, pleno.g, pleno.b)
  doc.text(nombre, textoX, padY + 6)

  // Contacto y matrícula en gris para no competir con el nombre
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...COLOR_TEXTO_SECUNDARIO)

  const lineas: string[] = []
  const contactoPartes: string[] = []
  if (organizacion.telefono) contactoPartes.push(`Tel ${organizacion.telefono}`)
  if (organizacion.email) contactoPartes.push(organizacion.email)
  if (organizacion.direccion) contactoPartes.push(organizacion.direccion)
  if (contactoPartes.length > 0) lineas.push(contactoPartes.join('  ·  '))
  if (organizacion.matricula_ssn) lineas.push(`Matrícula SSN ${organizacion.matricula_ssn}`)

  let yLinea = padY + 11
  for (const linea of lineas) {
    doc.text(linea, textoX, yLinea, { maxWidth: pageWidth - textoX - padX })
    yLinea += 4
  }

  // Alto del header — se toma el mayor entre el bloque de texto y la caja del logo
  const altoBloqueTexto = yLinea - padY
  const altoHeader = padY + Math.max(cajaLogo, altoBloqueTexto) + 3

  // Línea sutil color de marca al pie del header — divide sin cargar
  doc.setDrawColor(pleno.r, pleno.g, pleno.b)
  doc.setLineWidth(0.6)
  doc.line(padX, altoHeader, pageWidth - padX, altoHeader)

  return altoHeader + 2
}

// Franja angosta debajo del banner con número de cotización + fecha emisión.
// Color oscuro derivado para dar jerarquía sin pesar de más.
function dibujarFranjaNumero(
  doc: jsPDF,
  pageWidth: number,
  yInicio: number,
  numero: string,
  fechaEmision: string,
  oscuro: { r: number; g: number; b: number },
  textoFranja: { r: number; g: number; b: number },
): number {
  const altoFranja = 9
  doc.setFillColor(oscuro.r, oscuro.g, oscuro.b)
  doc.rect(0, yInicio, pageWidth, altoFranja, 'F')

  doc.setTextColor(textoFranja.r, textoFranja.g, textoFranja.b)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text(`COTIZACIÓN N° ${numero}`, 14, yInicio + 6)

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(`Emitida el ${fechaEmision}`, pageWidth - 14, yInicio + 6, { align: 'right' })

  return yInicio + altoFranja
}

// Dibuja un tag pequeño "RECOMENDADA" con fondo color pleno + texto encima.
// Devuelve el ancho ocupado (mm) para que el caller pueda continuar después.
function dibujarTagRecomendada(
  doc: jsPDF,
  x: number,
  y: number,
  pleno: { r: number; g: number; b: number },
  textoPleno: { r: number; g: number; b: number },
): number {
  const texto = 'RECOMENDADA'
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  const anchoTexto = doc.getTextWidth(texto)
  const padX = 2.2
  const padY = 1.4
  const ancho = anchoTexto + padX * 2
  const alto = 3.8 + padY * 2

  doc.setFillColor(pleno.r, pleno.g, pleno.b)
  doc.rect(x, y - alto + 1.5, ancho, alto, 'F')

  doc.setTextColor(textoPleno.r, textoPleno.g, textoPleno.b)
  doc.text(texto, x + padX, y - 0.6)

  return ancho
}

// Construye el documento jsPDF con todo el layout. Las dos APIs públicas
// (save / blob) comparten esta función para evitar duplicación.
function construirDocumentoCotizacion(
  cotizacion: DatosCotizacion,
  destinatario: DatosDestinatario,
  companias: CompaniaCotizada[],
  organizacion: DatosOrganizacion,
): jsPDF {
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  // Sistema de color: derivado del color de marca del PAS. Tres niveles
  // (pleno / oscuro / claro) más el texto sobre color (decisión WCAG).
  // Reutiliza el mismo helper que emails, portal y denuncia para que
  // todo el sistema sea coherente.
  const colorBase = normalizarColorMarca(organizacion.color_marca ?? COLOR_MARCA_DEFAULT)
  const tonos = derivarTonos(colorBase)
  const pleno = hexARgb(tonos.base)
  const oscuro = hexARgb(tonos.oscuro)
  const claro = hexARgb(tonos.muyClaro)
  const textoBanner = hexARgb(tonos.textoSobreColor)
  // textoSobreColor sobre el "oscuro" se calcula aparte por si el caso del
  // amarillo/celeste pastel cambia (el oscuro de un claro puede ser distinto).
  const textoFranja = hexARgb(textoSobreColor(tonos.oscuro))

  // ── Header con fondo blanco ──
  let y = dibujarHeader(doc, pageWidth, organizacion, pleno)

  // ── Franja del número ──
  y = dibujarFranjaNumero(doc, pageWidth, y, cotizacion.numero_cotizacion, formatFechaPDF(cotizacion.fecha), oscuro, textoFranja)

  // Margen superior antes del primer bloque de contenido
  y += 10
  const nombreProd = organizacion.razon_social || organizacion.nombre || 'Mi Organización'

  // ── Destinatario ──
  y = dibujarTituloSeccion(doc, 'DESTINATARIO', y, pageWidth)

  // Nombre a la izquierda + DNI/CUIL a la derecha (en la misma línea, debajo
  // de la línea del título de sección — antes la etiqueta "DNI/CUIL" iba en
  // y - 3 y se pisaba con la línea horizontal de dibujarTituloSeccion).
  const nombreDest = [destinatario.nombre, destinatario.apellido].filter(Boolean).join(' ').trim() || 'Sin destinatario'
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...COLOR_TEXTO_CUERPO)
  doc.text(nombreDest, 14, y + 2)

  if (destinatario.dni) {
    const xDer = pageWidth - 14
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...COLOR_TEXTO_SECUNDARIO)
    const anchoValor = doc.getTextWidth(destinatario.dni)
    const labelText = 'DNI/CUIL '
    doc.text(labelText, xDer - anchoValor - 1, y + 2, { align: 'right' })
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(...COLOR_TEXTO_CUERPO)
    doc.text(destinatario.dni, xDer, y + 2, { align: 'right' })
  }
  y += 7

  const contactoDest: string[] = []
  if (destinatario.telefono) contactoDest.push(`Tel ${destinatario.telefono}`)
  if (destinatario.email) contactoDest.push(destinatario.email)
  if (contactoDest.length > 0) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...COLOR_TEXTO_SECUNDARIO)
    doc.text(contactoDest.join('  ·  '), 14, y)
    y += 4
  }
  y += 4

  // ── Datos del riesgo ──
  y = dibujarTituloSeccion(doc, 'DATOS DEL BIEN ASEGURADO', y, pageWidth)

  // Caja con fondo color claro derivado del color de marca. Los campos
  // (ramo + grilla de 2 columnas) van adentro con un padding consistente.
  const filasRiesgo = getRiesgoTexto(cotizacion.datos_riesgo, cotizacion.tipo_riesgo)
  const padCajaX = 6
  const padCajaY = 5
  const filasTotales = 1 + Math.ceil(filasRiesgo.length / 2)  // 1 línea para "Ramo"
  const altoCaja = filasTotales * 5 + padCajaY * 2 - 1

  doc.setFillColor(claro.r, claro.g, claro.b)
  doc.rect(14, y - 3, pageWidth - 28, altoCaja, 'F')

  // Ramo full-width adentro de la caja. Usa el mismo offset (22mm) que las
  // demás filas dibujadas por dibujarFilasDosColumnas para que el valor quede
  // alineado verticalmente con "Marca", "Modelo", etc.
  const xDentro = 14 + padCajaX
  let yDentro = y + padCajaY - 1
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...COLOR_TEXTO_SECUNDARIO)
  doc.text('Ramo:', xDentro, yDentro)
  doc.setTextColor(...COLOR_TEXTO_CUERPO)
  doc.setFont('helvetica', 'bold')
  doc.text(cotizacion.ramo, xDentro + 22, yDentro)
  doc.setFont('helvetica', 'normal')
  yDentro += 5

  if (filasRiesgo.length > 0) {
    yDentro = dibujarFilasDosColumnas(doc, filasRiesgo, xDentro, yDentro, (pageWidth - 28 - padCajaX * 2) / 2)
  }

  y += altoCaja + 3

  // ── Comparativa de opciones ──
  y = dibujarTituloSeccion(doc, 'COMPARATIVA DE OPCIONES', y, pageWidth)

  // Índice de la fila recomendada (la seleccionada). Si no hay seleccionada
  // queda en -1 y la tabla no destaca ninguna fila.
  const idxRecomendada = companias.findIndex(c => c.seleccionada)

  autoTable(doc, {
    startY: y,
    head: [['Compañía', 'Cobertura', 'Precio', 'Detalle']],
    body: companias.map(c => [
      c.compania_nombre,
      nombreCoberturaCompleto(c),
      formatMonedaPDF(c.precio),
      resumenCortoDetalle(c.detalle, 2) || '—',
    ]),
    theme: 'plain',
    headStyles: {
      fillColor: [pleno.r, pleno.g, pleno.b],
      textColor: [textoBanner.r, textoBanner.g, textoBanner.b],
      fontSize: 9,
      fontStyle: 'bold',
      halign: 'left',
      cellPadding: 2.8,
    },
    bodyStyles: {
      fontSize: 9,
      textColor: COLOR_TEXTO_CUERPO,
      cellPadding: 2.8,
      lineColor: COLOR_LINEA_SUTIL,
      lineWidth: 0.1,
    },
    columnStyles: {
      0: { fontStyle: 'normal' },
      2: { halign: 'right' },
    },
    margin: { left: 14, right: 14 },
    didParseCell: (data: any) => {
      if (data.section === 'body') {
        const esRecomendada = data.row.index === idxRecomendada
        if (esRecomendada) {
          // Fila recomendada: fondo claro derivado
          data.cell.styles.fillColor = [claro.r, claro.g, claro.b]
          // Primera columna en bold, precio en color pleno bold
          if (data.column.index === 0) {
            data.cell.styles.fontStyle = 'bold'
          }
          if (data.column.index === 2) {
            data.cell.styles.fontStyle = 'bold'
            data.cell.styles.textColor = [pleno.r, pleno.g, pleno.b]
          }
        }
      }
    },
    didDrawCell: (data: any) => {
      if (data.section !== 'body') return
      const esRecomendada = data.row.index === idxRecomendada
      if (!esRecomendada) return

      // Barra lateral color pleno en la primera columna
      if (data.column.index === 0) {
        doc.setFillColor(pleno.r, pleno.g, pleno.b)
        doc.rect(data.cell.x, data.cell.y, 1.4, data.cell.height, 'F')

        // Tag "RECOMENDADA" después del nombre de la compañía
        const nombreCompania = companias[data.row.index].compania_nombre
        doc.setFontSize(9)
        doc.setFont('helvetica', 'bold')
        const anchoNombre = doc.getTextWidth(nombreCompania)
        const xTag = data.cell.x + data.cell.padding('left') + anchoNombre + 4
        const yTag = data.cell.y + data.cell.height / 2 + 1
        dibujarTagRecomendada(doc, xTag, yTag, pleno, textoBanner)
      }
    },
  })

  y = (doc as any).lastAutoTable?.finalY ?? y + 20

  // Pie de tabla: indica el criterio de la recomendación (si la hay)
  if (idxRecomendada >= 0 && companias.length > 1) {
    y += 3
    doc.setFontSize(8)
    doc.setFont('helvetica', 'italic')
    doc.setTextColor(...COLOR_TEXTO_TENUE)
    doc.text('La opción recomendada ofrece la mejor relación precio-cobertura.', 14, y)
    y += 1
  }
  y += 6

  // ── Detalle de cada opción ──
  // El prompt original del cambio decía "solo la recomendada"; el PAS
  // pidió que aparezcan TODAS las opciones con su detalle, para que el
  // cliente pueda comparar.
  const opcionesConDetalle = companias.filter(c => {
    const tieneInfoCatalogo = (c.cobertura_descripcion && c.cobertura_descripcion.trim())
      || (Array.isArray(c.cobertura_cubre) && c.cobertura_cubre.length > 0)
    // Incluir también opciones que el PAS armó con sublímites en el
    // campo `detalle` (ítems o notas), aunque el catálogo cobertura no
    // tenga descripción ni bullets.
    const parseado = parsearDetalleOpcion(c.detalle)
    const tieneInfoDetalle = parseado.items.length > 0 || parseado.notas.length > 0
    return tieneInfoCatalogo || tieneInfoDetalle
  })

  if (opcionesConDetalle.length > 0) {
    if (y > pageHeight - 50) {
      doc.addPage()
      y = 18
    }
    y = dibujarTituloSeccion(doc, 'DETALLE DE CADA OPCIÓN', y, pageWidth)

    for (const op of opcionesConDetalle) {
      const esRecomendada = op.seleccionada
      if (y > pageHeight - 35) {
        doc.addPage()
        y = 18
      }

      // Nombre de la opción: "Compañía — Cobertura"
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      // Si es la recomendada, nombre en color pleno; sino en gris oscuro
      if (esRecomendada) {
        doc.setTextColor(pleno.r, pleno.g, pleno.b)
      } else {
        doc.setTextColor(...COLOR_TEXTO_CUERPO)
      }
      const tituloOpcion = `${op.compania_nombre} — ${nombreCoberturaCompleto(op)}`
      doc.text(tituloOpcion, 14, y)

      // Tag "RECOMENDADA" al lado del título si aplica
      if (esRecomendada) {
        const anchoTitulo = doc.getTextWidth(tituloOpcion)
        dibujarTagRecomendada(doc, 14 + anchoTitulo + 4, y, pleno, textoBanner)
      }
      y += 5

      // Descripción breve (en cursiva, gris)
      if (op.cobertura_descripcion && op.cobertura_descripcion.trim()) {
        doc.setFontSize(9)
        doc.setFont('helvetica', 'italic')
        doc.setTextColor(...COLOR_TEXTO_SECUNDARIO)
        const lineasDesc = doc.splitTextToSize(op.cobertura_descripcion.trim(), pageWidth - 28)
        doc.text(lineasDesc, 14, y)
        y += lineasDesc.length * 4 + 1
      }

      // Bullets "qué cubre" en 2 columnas — viñeta cuadrada color pleno
      if (Array.isArray(op.cobertura_cubre) && op.cobertura_cubre.length > 0) {
        const items = op.cobertura_cubre.filter(it => it && String(it).trim())
        if (items.length > 0) {
          doc.setFontSize(9)
          doc.setFont('helvetica', 'normal')

          const anchoCol = (pageWidth - 28 - 4) / 2  // 2 columnas con gap
          const xColIzq = 14
          const xColDer = 14 + anchoCol + 4
          const altoLinea = 5
          const padBullet = 4  // espacio entre cuadrito y texto

          // Repartir items entre col izq y col der
          const mitad = Math.ceil(items.length / 2)
          const izq = items.slice(0, mitad)
          const der = items.slice(mitad)

          let yIzq = y
          let yDer = y
          const dibujarColumna = (lista: string[], xCol: number, yInicial: number): number => {
            let yLocal = yInicial
            for (const item of lista) {
              if (yLocal > pageHeight - 25) {
                doc.addPage()
                yLocal = 18
              }
              // Cuadradito color pleno como viñeta
              doc.setFillColor(pleno.r, pleno.g, pleno.b)
              doc.rect(xCol, yLocal - 2.5, 1.6, 1.6, 'F')
              // Texto del bullet
              doc.setTextColor(...COLOR_TEXTO_CUERPO)
              const lineasItem = doc.splitTextToSize(String(item).trim(), anchoCol - padBullet)
              doc.text(lineasItem, xCol + padBullet, yLocal)
              yLocal += lineasItem.length * altoLinea
            }
            return yLocal
          }

          yIzq = dibujarColumna(izq, xColIzq, yIzq)
          yDer = dibujarColumna(der, xColDer, yDer)
          y = Math.max(yIzq, yDer)
        }
      }

      // ── Bloque de sublímites / notas del PAS ──
      // Renderea lo que el PAS escribió en el campo `detalle` de la opción,
      // parseado con `parsearDetalleOpcion` (patrón `label: valor` por línea).
      // Ítems se muestran como pares label+valor alineados; las líneas sin `:`
      // salen como notas al final.
      {
        const parseado = parsearDetalleOpcion(op.detalle)
        const hayItems = parseado.items.length > 0
        const hayNotas = parseado.notas.length > 0
        if (hayItems || hayNotas) {
          // Espacio y separación del bloque anterior
          y += 2

          if (hayItems) {
            // Sub-título "Sumas aseguradas / Sublímites"
            if (y > pageHeight - 20) {
              doc.addPage()
              y = 18
            }
            doc.setFontSize(8.5)
            doc.setFont('helvetica', 'bold')
            doc.setTextColor(...COLOR_TEXTO_SECUNDARIO)
            doc.text('Sumas aseguradas / Sublímites', 14, y)
            y += 4

            // Renderea cada ítem como fila: label a la izquierda (gris), valor
            // a la derecha (bold, alineado a la derecha). Fondo alternado sutil.
            const anchoContenido = pageWidth - 28
            const altoFila = 4.6
            const paddingX = 2

            for (let i = 0; i < parseado.items.length; i++) {
              if (y > pageHeight - 15) {
                doc.addPage()
                y = 18
              }
              const it = parseado.items[i]

              // Fondo alternado muy sutil para mejorar la legibilidad
              if (i % 2 === 0) {
                doc.setFillColor(248, 250, 252)  // slate-50
                doc.rect(14, y - 3.2, anchoContenido, altoFila, 'F')
              }

              // Label (izquierda)
              doc.setFontSize(8.5)
              doc.setFont('helvetica', 'normal')
              doc.setTextColor(...COLOR_TEXTO_CUERPO)
              const labelTruncado = doc.splitTextToSize(it.label, anchoContenido * 0.6)[0] ?? it.label
              doc.text(labelTruncado, 14 + paddingX, y)

              // Valor (derecha, bold, en color de marca si es número/monto)
              doc.setFont('helvetica', 'bold')
              doc.setTextColor(pleno.r, pleno.g, pleno.b)
              const valorTruncado = doc.splitTextToSize(it.valor, anchoContenido * 0.4)[0] ?? it.valor
              doc.text(valorTruncado, pageWidth - 14 - paddingX, y, { align: 'right' })

              y += altoFila
            }
            y += 1
          }

          if (hayNotas) {
            // Renderea notas libres en cursiva, gris, con separación mínima
            if (y > pageHeight - 15) {
              doc.addPage()
              y = 18
            }
            doc.setFontSize(8.5)
            doc.setFont('helvetica', 'italic')
            doc.setTextColor(...COLOR_TEXTO_SECUNDARIO)
            for (const nota of parseado.notas) {
              const lineasNota = doc.splitTextToSize(nota, pageWidth - 28)
              if (y + lineasNota.length * 4 > pageHeight - 12) {
                doc.addPage()
                y = 18
              }
              doc.text(lineasNota, 14, y)
              y += lineasNota.length * 4 + 0.5
            }
          }
        }
      }

      y += 5  // espacio entre opciones
    }
  }

  // ── Notas ──
  if (cotizacion.notas) {
    if (y > pageHeight - 40) {
      doc.addPage()
      y = 18
    }
    y = dibujarTituloSeccion(doc, 'NOTAS', y, pageWidth)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...COLOR_TEXTO_CUERPO)
    const notasLineas = doc.splitTextToSize(cotizacion.notas, pageWidth - 28)
    doc.text(notasLineas, 14, y)
    y += notasLineas.length * 4 + 4
  }

  // ── Aclaraciones ──
  // Bloque legal editable por el PAS desde `/crm/configuracion/perfil`.
  // Si no configuró nada, usa el default hardcoded. Renderizado con tono
  // tenue (gris suave, tamaño chico), sin viñetas ni destacados — es
  // info de compliance, no debe robar atención al contenido comercial.
  {
    const textoAclaraciones = organizacion.cotizacion_aclaraciones ?? ACLARACIONES_COTIZACION_DEFAULT_TEXTO
    const aclaraciones = parsearAclaraciones(textoAclaraciones)
    if (aclaraciones.length > 0) {
      // Estimación aproximada de alto necesario antes de decidir salto
      if (y > pageHeight - 60) {
        doc.addPage()
        y = 18
      }
      // Título discreto — mismo estilo que otras secciones pero el
      // contenido va con menos peso visual que las secciones comerciales.
      y = dibujarTituloSeccion(doc, 'Aclaraciones', y, pageWidth)
      doc.setFontSize(7.5)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...COLOR_TEXTO_TENUE)

      const anchoTexto = pageWidth - 28
      const altoLinea = 3.3
      const separacionParrafo = 1.8
      for (const aclaracion of aclaraciones) {
        const lineas = doc.splitTextToSize(aclaracion, anchoTexto)
        const altoBloque = lineas.length * altoLinea + separacionParrafo
        // Salto de página defensivo si no entra el bloque completo
        if (y + altoBloque > pageHeight - 25) {
          doc.addPage()
          y = 18
        }
        doc.text(lineas, 14, y)
        y += altoBloque
      }
      y += 2
    }
  }

  // ── Footer en todas las páginas ──
  const pieProd = [nombreProd, organizacion.matricula_ssn ? `Matrícula SSN ${organizacion.matricula_ssn}` : ''].filter(Boolean).join(' · ')
  pintarFooterTodasPaginas(doc, pageWidth, pageHeight, pieProd)

  return doc
}

export function generarPDFCotizacion(
  cotizacion: DatosCotizacion,
  destinatario: DatosDestinatario,
  companias: CompaniaCotizada[],
  organizacion: DatosOrganizacion,
) {
  const doc = construirDocumentoCotizacion(cotizacion, destinatario, companias, organizacion)
  doc.save(`cotizacion-${cotizacion.numero_cotizacion}.pdf`)
}

export function generarPDFCotizacionBlob(
  cotizacion: DatosCotizacion,
  destinatario: DatosDestinatario,
  companias: CompaniaCotizada[],
  organizacion: DatosOrganizacion,
): File {
  const doc = construirDocumentoCotizacion(cotizacion, destinatario, companias, organizacion)
  const blob = doc.output('blob')
  return new File([blob], `cotizacion-${cotizacion.numero_cotizacion}.pdf`, { type: 'application/pdf' })
}
