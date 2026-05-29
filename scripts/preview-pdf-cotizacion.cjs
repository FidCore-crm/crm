#!/usr/bin/env node
/**
 * Genera un PDF de cotización de ejemplo para revisar el layout sin
 * cargar datos reales en el CRM.
 *
 * Uso:
 *   node scripts/preview-pdf-cotizacion.cjs
 *
 * Salida:
 *   /tmp/preview-cotizacion.pdf
 *
 * Replica exactamente la lógica de `src/lib/pdf-cotizacion.ts` con
 * tres datasets distintos (automotor, hogar, vida). Si querés probar
 * otro caso, editá DATOS_EJEMPLO al final del archivo.
 */

const fs = require('fs')
const path = require('path')
const { jsPDF } = require('jspdf')
const autoTable = require('jspdf-autotable').default || require('jspdf-autotable')

// ── Helpers (espejados de pdf-cotizacion.ts) ──

function formatMonedaPDF(monto) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(monto)
}

function formatFechaPDF(f) {
  const [anio, mes, dia] = f.split('T')[0].split('-')
  return `${dia}/${mes}/${anio}`
}

function getRiesgoTexto(datos, tipo) {
  const lineas = []
  if (tipo === 'automotor') {
    if (datos.marca) lineas.push(`Marca: ${datos.marca}`)
    if (datos.modelo) lineas.push(`Modelo: ${datos.modelo}`)
    if (datos.anio) lineas.push(`Año: ${datos.anio}`)
    if (datos.patente) lineas.push(`Patente: ${datos.patente}`)
    if (datos.color) lineas.push(`Color: ${datos.color}`)
    if (datos.uso) lineas.push(`Uso: ${datos.uso}`)
    if (datos.motor) lineas.push(`Motor: ${datos.motor}`)
    if (datos.chasis) lineas.push(`Chasis: ${datos.chasis}`)
  } else if (tipo === 'hogar') {
    const dir = [datos.calle, datos.numero].filter(Boolean).join(' ')
    if (dir) lineas.push(`Dirección: ${dir}`)
    if (datos.localidad) lineas.push(`Localidad: ${datos.localidad}`)
    if (datos.provincia) lineas.push(`Provincia: ${datos.provincia}`)
    if (datos.tipo_construccion) lineas.push(`Construcción: ${datos.tipo_construccion}`)
    if (datos.superficie) lineas.push(`Superficie: ${datos.superficie} m²`)
  } else if (tipo === 'vida') {
    if (datos.capital_asegurado) lineas.push(`Capital: ${formatMonedaPDF(Number(datos.capital_asegurado))}`)
    if (datos.beneficiarios) lineas.push(`Beneficiarios: ${datos.beneficiarios}`)
  } else {
    if (datos.descripcion) lineas.push(`Descripción: ${datos.descripcion}`)
  }
  return lineas
}

function construirDocumentoCotizacion(cotizacion, destinatario, companias, organizacion) {
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  let y = 20

  // Header organizacion con logo opcional
  const nombreOrg = organizacion.razon_social || organizacion.nombre || 'Mi Organización'
  let textoX = 14

  if (organizacion.logo_data_url) {
    try {
      const m = organizacion.logo_data_url.match(/^data:image\/(\w+);/i)
      const ext = (m && m[1] ? m[1] : 'png').toUpperCase()
      const formato = ext === 'JPG' ? 'JPEG' : ext
      doc.addImage(organizacion.logo_data_url, formato, 14, 14, 24, 24)
      textoX = 42
    } catch (e) {
      textoX = 14
    }
  }

  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 22, 40)
  doc.text(nombreOrg, textoX, y)
  y += 6
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 100, 100)
  const contactoLineas = []
  if (organizacion.telefono) contactoLineas.push(`Tel: ${organizacion.telefono}`)
  if (organizacion.email) contactoLineas.push(`Email: ${organizacion.email}`)
  if (organizacion.direccion) contactoLineas.push(organizacion.direccion)
  if (contactoLineas.length > 0) {
    doc.text(contactoLineas.join('  |  '), textoX, y)
    y += 4
  }
  if (organizacion.matricula_ssn) {
    doc.text(`Matrícula SSN: ${organizacion.matricula_ssn}`, textoX, y)
    y += 4
  }

  y += 2
  if (organizacion.logo_data_url) {
    const yLogoBottom = 14 + 24
    if (y < yLogoBottom + 2) y = yLogoBottom + 2
  }
  doc.setDrawColor(200, 200, 200)
  doc.line(14, y, pageWidth - 14, y)
  y += 8

  // Título
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 22, 40)
  doc.text(`COTIZACIÓN Nº ${cotizacion.numero_cotizacion}`, 14, y)
  y += 6
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 100, 100)
  doc.text(`Fecha de emisión: ${formatFechaPDF(cotizacion.fecha)}`, 14, y)
  y += 10

  // Destinatario
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 22, 40)
  doc.text('DESTINATARIO', 14, y)
  y += 5
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  const nombreDest = [destinatario.nombre, destinatario.apellido].filter(Boolean).join(' ').trim() || 'Sin destinatario'
  doc.text(nombreDest, 14, y)
  y += 4
  if (destinatario.dni) { doc.text(`DNI/CUIL: ${destinatario.dni}`, 14, y); y += 4 }
  const contactoDest = []
  if (destinatario.telefono) contactoDest.push(`Tel: ${destinatario.telefono}`)
  if (destinatario.email) contactoDest.push(`Email: ${destinatario.email}`)
  if (contactoDest.length > 0) { doc.text(contactoDest.join('  |  '), 14, y); y += 4 }
  y += 4

  // Datos del riesgo
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 22, 40)
  doc.text('DATOS DEL RIESGO', 14, y)
  y += 5
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(`Ramo: ${cotizacion.ramo}`, 14, y)
  y += 4
  const riesgoLineas = getRiesgoTexto(cotizacion.datos_riesgo, cotizacion.tipo_riesgo)
  for (const linea of riesgoLineas) {
    doc.text(linea, 14, y)
    y += 4
  }
  y += 4

  // Tabla comparativa
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 22, 40)
  doc.text('COMPARATIVA DE OPCIONES', 14, y)
  y += 2

  const precioMin = companias.length > 0 ? Math.min(...companias.map(c => c.precio)) : null

  autoTable(doc, {
    startY: y,
    head: [['Compañía', 'Cobertura', 'Precio', 'Detalle']],
    body: companias.map(c => [
      (c.seleccionada ? '✓ ' : '') + c.compania_nombre,
      c.cobertura_nombre ?? '—',
      formatMonedaPDF(c.precio) + (c.precio === precioMin && companias.length > 1 ? ' ★' : ''),
      c.detalle ?? '—',
    ]),
    theme: 'striped',
    headStyles: { fillColor: [10, 22, 40], fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      2: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.section === 'body') {
        const comp = companias[data.row.index]
        if (comp && comp.seleccionada) data.cell.styles.fillColor = [220, 252, 231]
      }
    },
  })

  y = doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY : y + 20
  y += 8

  // Notas
  if (cotizacion.notas) {
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(10, 22, 40)
    doc.text('NOTAS', 14, y)
    y += 5
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(80, 80, 80)
    const notasLineas = doc.splitTextToSize(cotizacion.notas, pageWidth - 28)
    doc.text(notasLineas, 14, y)
    y += notasLineas.length * 4 + 4
  }

  // Pie de página
  y += 6
  doc.setDrawColor(200, 200, 200)
  doc.line(14, y, pageWidth - 14, y)
  y += 5
  doc.setFontSize(7)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(130, 130, 130)
  const textoValidez = cotizacion.fecha_vencimiento
    ? `Cotización válida hasta el ${formatFechaPDF(cotizacion.fecha_vencimiento)}. Los precios están sujetos a confirmación por parte de la compañía aseguradora.`
    : 'Cotización válida por 30 días desde la fecha de envío. Los precios están sujetos a confirmación por parte de la compañía aseguradora.'
  doc.text(textoValidez, 14, y)
  y += 4
  const pieProd = [nombreOrg, organizacion.matricula_ssn ? `Matrícula SSN: ${organizacion.matricula_ssn}` : ''].filter(Boolean).join(' — ')
  doc.text(pieProd, 14, y)

  return doc
}

// ── Datos de ejemplo: automotor con 4 compañías, una seleccionada ──

const DATOS_EJEMPLO = {
  organizacion: {
    nombre: 'Lobo Seguros',
    razon_social: 'Lobo Seguros S.A.',
    telefono: '+54 11 1234-5678',
    email: 'contacto@loboseguros.com.ar',
    direccion: 'Av. Corrientes 1234, CABA',
    matricula_ssn: '12345',
  },
  destinatario: {
    nombre: 'Juan Carlos',
    apellido: 'Pérez',
    dni: '20-12345678-9',
    telefono: '+54 11 9876-5432',
    email: 'jcperez@example.com',
  },
  cotizacion: {
    numero_cotizacion: 'COT-0042',
    fecha: '2026-04-28',
    ramo: 'Automotor',
    tipo_riesgo: 'automotor',
    datos_riesgo: {
      marca: 'Toyota',
      modelo: 'Corolla XEI 2.0',
      anio: '2022',
      patente: 'AB 123 CD',
      color: 'Gris plata',
      uso: 'PARTICULAR',
      motor: 'M1B-2345678',
      chasis: '9BRBLWHE1J0123456',
    },
    notas: 'Cliente solicita comparativa entre cobertura todo riesgo y terceros completo. Tiene cochera, no usa el vehículo para trabajo. Antigüedad de carnet: 15 años, sin siniestros declarados en los últimos 3 años.',
    fecha_vencimiento: '2026-05-28',
  },
  companias: [
    {
      compania_nombre: 'La Caja Seguros',
      cobertura_nombre: 'Todo Riesgo con Franquicia',
      precio: 145000,
      detalle: 'Franquicia $35.000 — Granizo incluido',
      seleccionada: false,
    },
    {
      compania_nombre: 'Sancor Seguros',
      cobertura_nombre: 'Todo Riesgo Premium',
      precio: 162500,
      detalle: 'Sin franquicia — Auto sustituto 30 días',
      seleccionada: true,
    },
    {
      compania_nombre: 'Federación Patronal',
      cobertura_nombre: 'Terceros Completo',
      precio: 89500,
      detalle: 'Robo total e incendio — sin daños propios',
      seleccionada: false,
    },
    {
      compania_nombre: 'Allianz',
      cobertura_nombre: 'Todo Riesgo con Franquicia',
      precio: 138900,
      detalle: 'Franquicia $40.000 — Cristales sin cargo',
      seleccionada: false,
    },
  ],
}

const doc = construirDocumentoCotizacion(
  DATOS_EJEMPLO.cotizacion,
  DATOS_EJEMPLO.destinatario,
  DATOS_EJEMPLO.companias,
  DATOS_EJEMPLO.organizacion,
)

const outPath = path.join('/tmp', 'preview-cotizacion.pdf')
const buffer = Buffer.from(doc.output('arraybuffer'))
fs.writeFileSync(outPath, buffer)

console.log(`✓ PDF generado: ${outPath}`)
console.log(`  Tamaño: ${(buffer.length / 1024).toFixed(1)} KB`)
console.log(`  Compañías: ${DATOS_EJEMPLO.companias.length} (1 seleccionada, mejor precio: Allianz)`)
