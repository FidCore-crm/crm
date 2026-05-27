import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { hexARgb, normalizarColorMarca, COLOR_MARCA_DEFAULT } from './color-marca'

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
  textoValidez: string,
  pieProd: string,
) {
  const total = (doc as any).internal.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    const yLinea = pageHeight - 18
    doc.setDrawColor(...COLOR_LINEA_SUTIL)
    doc.setLineWidth(0.2)
    doc.line(14, yLinea, pageWidth - 14, yLinea)

    doc.setFontSize(7)
    doc.setFont('helvetica', 'italic')
    doc.setTextColor(...COLOR_TEXTO_TENUE)
    doc.text(textoValidez, 14, yLinea + 5, { maxWidth: pageWidth - 28 })

    doc.setFont('helvetica', 'normal')
    doc.text(pieProd, 14, yLinea + 12)
    doc.text(`Página ${p} de ${total}`, pageWidth - 14, yLinea + 12, { align: 'right' })
  }
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
  let y = 18

  // Color de marca: solo se usa para nombre organización, título principal
  // y header de la tabla. El resto (títulos de sección, texto de cuerpo)
  // queda en grises para legibilidad e impresión limpia.
  const cm = hexARgb(normalizarColorMarca(organizacion.color_marca ?? COLOR_MARCA_DEFAULT))

  // ── Header organización ──
  // Si hay logo, va a la izquierda dentro de una caja 32×24mm respetando
  // aspect ratio (no se deforma). El texto se desplaza tras el logo.
  const nombreProd = organizacion.razon_social || organizacion.nombre || 'Mi Organización'
  let textoX = 14

  if (organizacion.logo_data_url) {
    try {
      // Detectar formato del data URL: "data:image/png;base64,..." → "PNG"
      // jsPDF acepta 'PNG', 'JPEG', 'WEBP'. Mapeamos jpg→JPEG.
      const m = organizacion.logo_data_url.match(/^data:image\/(\w+);/i)
      const ext = (m?.[1] ?? 'png').toUpperCase()
      const formato = ext === 'JPG' ? 'JPEG' : ext

      const dim = calcularTamanioLogo(doc, organizacion.logo_data_url, 32, 24)
      if (dim) {
        // Centrado vertical dentro de caja de 24mm a partir de y=14
        const yLogo = 14 + (24 - dim.h) / 2
        doc.addImage(organizacion.logo_data_url, formato, 14, yLogo, dim.w, dim.h)
        textoX = 14 + dim.w + 6  // margen tras el logo
      }
    } catch {
      // Si addImage falla (formato no soportado, data URL roto, etc.),
      // ignoramos silenciosamente y caemos al layout solo-texto.
      textoX = 14
    }
  }

  // Nombre organización — color de marca, único uso destacado en el header
  doc.setFontSize(15)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(cm.r, cm.g, cm.b)
  doc.text(nombreProd, textoX, y + 4)
  y += 9

  // Datos de contacto — gris secundario
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...COLOR_TEXTO_SECUNDARIO)
  const contactoLineas: string[] = []
  if (organizacion.telefono) contactoLineas.push(`Tel: ${organizacion.telefono}`)
  if (organizacion.email) contactoLineas.push(organizacion.email)
  if (organizacion.direccion) contactoLineas.push(organizacion.direccion)
  if (contactoLineas.length > 0) {
    doc.text(contactoLineas.join('  ·  '), textoX, y)
    y += 4
  }
  if (organizacion.matricula_ssn) {
    doc.text(`Matrícula SSN ${organizacion.matricula_ssn}`, textoX, y)
    y += 4
  }

  // Espacio mínimo después del logo
  if (organizacion.logo_data_url) {
    const yLogoBottom = 14 + 24
    if (y < yLogoBottom + 4) y = yLogoBottom + 4
  }
  y += 2

  // ── Título principal ──
  doc.setDrawColor(cm.r, cm.g, cm.b)
  doc.setLineWidth(0.6)
  doc.line(14, y, pageWidth - 14, y)
  y += 6

  doc.setFontSize(17)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(cm.r, cm.g, cm.b)
  doc.text(`COTIZACIÓN N° ${cotizacion.numero_cotizacion}`, 14, y)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...COLOR_TEXTO_SECUNDARIO)
  doc.text(`Emitida el ${formatFechaPDF(cotizacion.fecha)}`, pageWidth - 14, y, { align: 'right' })
  y += 10

  // ── Destinatario ──
  y = dibujarTituloSeccion(doc, 'DESTINATARIO', y, pageWidth)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...COLOR_TEXTO_CUERPO)
  const nombreDest = [destinatario.nombre, destinatario.apellido].filter(Boolean).join(' ').trim() || 'Sin destinatario'
  doc.text(nombreDest, 14, y)
  y += 5

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  if (destinatario.dni) {
    doc.setTextColor(...COLOR_TEXTO_SECUNDARIO)
    doc.text('DNI/CUIL:', 14, y)
    doc.setTextColor(...COLOR_TEXTO_CUERPO)
    doc.text(destinatario.dni, 32, y)
    y += 4
  }
  const contactoDest: string[] = []
  if (destinatario.telefono) contactoDest.push(`Tel ${destinatario.telefono}`)
  if (destinatario.email) contactoDest.push(destinatario.email)
  if (contactoDest.length > 0) {
    doc.setTextColor(...COLOR_TEXTO_SECUNDARIO)
    doc.text(contactoDest.join('  ·  '), 14, y)
    y += 4
  }
  y += 4

  // ── Datos del riesgo ──
  y = dibujarTituloSeccion(doc, 'DATOS DEL RIESGO', y, pageWidth)

  // Ramo siempre primero, full-width
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...COLOR_TEXTO_SECUNDARIO)
  doc.text('Ramo:', 14, y)
  doc.setTextColor(...COLOR_TEXTO_CUERPO)
  doc.setFont('helvetica', 'bold')
  doc.text(cotizacion.ramo, 36, y)
  doc.setFont('helvetica', 'normal')
  y += 5

  const filasRiesgo = getRiesgoTexto(cotizacion.datos_riesgo, cotizacion.tipo_riesgo)
  if (filasRiesgo.length > 0) {
    y = dibujarFilasDosColumnas(doc, filasRiesgo, 14, y, (pageWidth - 28) / 2)
  }
  y += 4

  // ── Comparativa de opciones ──
  y = dibujarTituloSeccion(doc, 'COMPARATIVA DE OPCIONES', y, pageWidth)

  const precioMin = companias.length > 0 ? Math.min(...companias.map(c => c.precio)) : null

  autoTable(doc, {
    startY: y,
    head: [['Compañía', 'Cobertura', 'Precio', 'Detalle']],
    body: companias.map(c => [
      (c.seleccionada ? '✓ ' : '') + c.compania_nombre,
      c.cobertura_nombre ?? '—',
      formatMonedaPDF(c.precio) + (c.precio === precioMin && companias.length > 1 ? '  ★' : ''),
      c.detalle ?? '—',
    ]),
    theme: 'grid',
    headStyles: {
      fillColor: [cm.r, cm.g, cm.b],
      textColor: [255, 255, 255],
      fontSize: 9,
      fontStyle: 'bold',
      halign: 'left',
      cellPadding: 2.5,
    },
    bodyStyles: {
      fontSize: 8.5,
      textColor: COLOR_TEXTO_CUERPO,
      cellPadding: 2.5,
      lineColor: COLOR_LINEA_SUTIL,
      lineWidth: 0.1,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],  // slate-50
    },
    columnStyles: {
      0: { fontStyle: 'bold' },
      2: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
    didParseCell: (data: any) => {
      if (data.section === 'body') {
        const comp = companias[data.row.index]
        if (comp?.seleccionada) {
          data.cell.styles.fillColor = [220, 252, 231]  // emerald-100
        }
      }
    },
  })

  y = (doc as any).lastAutoTable?.finalY ?? y + 20

  // Leyenda discreta de íconos si aplica
  if (companias.length > 1) {
    y += 3
    doc.setFontSize(7)
    doc.setFont('helvetica', 'italic')
    doc.setTextColor(...COLOR_TEXTO_TENUE)
    doc.text('★ precio más bajo    ✓ opción seleccionada', 14, y)
    y += 1
  }
  y += 6

  // ── Detalle de coberturas (sólo las que tengan info cargada) ──
  // Deduplicamos por cobertura_id para no repetir si dos opciones usan la
  // misma cobertura. Solo mostramos las que tengan al menos descripción
  // o un bullet en `cubre`.
  const coberturasUnicas = new Map<string, { nombre: string; descripcion?: string | null; cubre?: string[] | null }>()
  for (const c of companias) {
    if (!c.cobertura_id) continue
    if (coberturasUnicas.has(c.cobertura_id)) continue
    const tieneInfo = (c.cobertura_descripcion && c.cobertura_descripcion.trim())
      || (Array.isArray(c.cobertura_cubre) && c.cobertura_cubre.length > 0)
    if (!tieneInfo) continue
    coberturasUnicas.set(c.cobertura_id, {
      nombre: c.cobertura_nombre ?? '—',
      descripcion: c.cobertura_descripcion,
      cubre: c.cobertura_cubre,
    })
  }

  if (coberturasUnicas.size > 0) {
    // Page break si quedan menos de ~40mm en la página
    if (y > pageHeight - 50) {
      doc.addPage()
      y = 18
    }
    y = dibujarTituloSeccion(doc, 'DETALLE DE COBERTURAS', y, pageWidth)

    for (const cob of Array.from(coberturasUnicas.values())) {
      // Page break si queda poco espacio
      if (y > pageHeight - 35) {
        doc.addPage()
        y = 18
      }
      // Nombre de cobertura
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...COLOR_TEXTO_CUERPO)
      doc.text(cob.nombre, 14, y)
      y += 5

      // Descripción breve
      if (cob.descripcion && cob.descripcion.trim()) {
        doc.setFontSize(9)
        doc.setFont('helvetica', 'italic')
        doc.setTextColor(...COLOR_TEXTO_SECUNDARIO)
        const lineasDesc = doc.splitTextToSize(cob.descripcion.trim(), pageWidth - 28)
        doc.text(lineasDesc, 14, y)
        y += lineasDesc.length * 4 + 1
      }

      // Bullets de "qué cubre"
      if (Array.isArray(cob.cubre) && cob.cubre.length > 0) {
        doc.setFontSize(9)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...COLOR_TEXTO_CUERPO)
        for (const item of cob.cubre) {
          if (!item || !String(item).trim()) continue
          if (y > pageHeight - 25) {
            doc.addPage()
            y = 18
          }
          const lineasItem = doc.splitTextToSize(String(item).trim(), pageWidth - 36)
          doc.text('•', 18, y)
          doc.text(lineasItem, 22, y)
          y += lineasItem.length * 4 + 0.5
        }
      }
      y += 4  // espacio entre coberturas
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

  // ── Footer en todas las páginas ──
  const textoValidez = cotizacion.fecha_vencimiento
    ? `Cotización válida hasta el ${formatFechaPDF(cotizacion.fecha_vencimiento)}. Los precios están sujetos a confirmación por parte de la compañía aseguradora.`
    : 'Cotización válida por 30 días desde la fecha de envío. Los precios están sujetos a confirmación por parte de la compañía aseguradora.'
  const pieProd = [nombreProd, organizacion.matricula_ssn ? `Matrícula SSN ${organizacion.matricula_ssn}` : ''].filter(Boolean).join(' · ')
  pintarFooterTodasPaginas(doc, pageWidth, pageHeight, textoValidez, pieProd)

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
