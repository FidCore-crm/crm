import jsPDF from 'jspdf'
import { AVISO_PRECARGA_TITULO, AVISO_PRECARGA_TEXTO } from './aviso-precarga-siniestro'

export interface DatosPDFSiniestro {
  numero_caso: string
  fecha_denuncia: string
  asegurado: {
    apellido: string
    nombre: string
    dni: string
    email: string
    telefono: string
  }
  poliza: {
    numero_poliza: string
    compania: string
    ramo: string
  }
  siniestro: {
    tipo: string
    fecha_ocurrencia: string
    hora: string
    lugar: string
    localidad: string
    descripcion: string
    denuncia_policial: string
  }
  /**
   * detalle_siniestro JSONB completo. Si está presente, se renderizan
   * automáticamente las secciones de conductor, tercero, lesionados, testigos,
   * daños propios, datos del hogar, etc.
   */
  detalle_extendido?: Record<string, any> | null
  archivos_adjuntos: Array<{ nombre: string; tipo: string; tamano: number }>
  organizacion: {
    nombre: string
  }
  /**
   * Trazabilidad de la carga: contexto técnico de quien generó la denuncia.
   * Se renderiza en el pie del PDF como evidencia para el productor / compañía.
   */
  trazabilidad?: {
    origen: string         // ej: "Formulario web público"
    ip?: string
    user_agent?: string
    fecha_carga: string    // ISO timestamp del POST
  }
}

function formatFecha(f: string): string {
  if (!f) return '—'
  const [anio, mes, dia] = f.split('T')[0].split('-')
  return `${dia}/${mes}/${anio}`
}

function formatTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function checkPage(doc: jsPDF, y: number, needed: number, numeroCaso: string): number {
  const pageHeight = doc.internal.pageSize.getHeight()
  if (y + needed > pageHeight - 25) {
    doc.addPage()
    // Header chico en páginas siguientes
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(130, 130, 130)
    doc.text(`Caso ${numeroCaso}`, 14, 12)
    doc.setDrawColor(200, 200, 200)
    doc.line(14, 14, doc.internal.pageSize.getWidth() - 14, 14)
    return 22
  }
  return y
}

function drawSection(doc: jsPDF, title: string, y: number, pageWidth: number): number {
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 22, 40) // Navy #0A1628
  doc.text(title, 14, y)
  y += 1
  doc.setDrawColor(0, 82, 204) // Blue #0052CC
  doc.setLineWidth(0.5)
  doc.line(14, y, pageWidth - 14, y)
  doc.setLineWidth(0.2)
  y += 5
  return y
}

export async function generarPDFSiniestro(datos: DatosPDFSiniestro): Promise<Buffer> {
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  let y = 15

  // ── Header ──
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 22, 40)
  doc.text(datos.organizacion.nombre || 'Productor de Seguros', 14, y)
  y += 7
  doc.setFontSize(16)
  doc.setTextColor(0, 82, 204)
  doc.text('DENUNCIA DE SINIESTRO', 14, y)
  y += 4
  doc.setDrawColor(0, 82, 204)
  doc.setLineWidth(0.8)
  doc.line(14, y, pageWidth - 14, y)
  doc.setLineWidth(0.2)
  y += 8

  // ── Caja número de caso ──
  doc.setFillColor(240, 245, 255)
  doc.setDrawColor(0, 82, 204)
  doc.roundedRect(14, y, pageWidth - 28, 18, 2, 2, 'FD')
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 82, 204)
  doc.text(`Caso N.${datos.numero_caso}`, 20, y + 8)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80, 80, 80)
  doc.text(`Fecha de denuncia: ${formatFecha(datos.fecha_denuncia)}`, 20, y + 14)
  y += 26

  // ── Datos del asegurado ──
  y = drawSection(doc, 'DATOS DEL ASEGURADO', y, pageWidth)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(50, 50, 50)

  const col1 = 14
  const col2 = pageWidth / 2 + 5
  doc.setFont('helvetica', 'bold')
  doc.text('Nombre:', col1, y)
  doc.setFont('helvetica', 'normal')
  doc.text(`${datos.asegurado.apellido}, ${datos.asegurado.nombre}`, col1 + 25, y)
  doc.setFont('helvetica', 'bold')
  doc.text('DNI:', col2, y)
  doc.setFont('helvetica', 'normal')
  doc.text(datos.asegurado.dni, col2 + 15, y)
  y += 5

  doc.setFont('helvetica', 'bold')
  doc.text('Email:', col1, y)
  doc.setFont('helvetica', 'normal')
  doc.text(datos.asegurado.email || '—', col1 + 25, y)
  doc.setFont('helvetica', 'bold')
  doc.text('Tel:', col2, y)
  doc.setFont('helvetica', 'normal')
  doc.text(datos.asegurado.telefono || '—', col2 + 15, y)
  y += 8

  // ── Datos de la poliza ──
  y = checkPage(doc, y, 25, datos.numero_caso)
  y = drawSection(doc, 'DATOS DE LA POLIZA', y, pageWidth)
  doc.setFontSize(9)
  doc.setTextColor(50, 50, 50)

  doc.setFont('helvetica', 'bold')
  doc.text('Poliza N.:', col1, y)
  doc.setFont('helvetica', 'normal')
  doc.text(datos.poliza.numero_poliza, col1 + 25, y)
  y += 5
  doc.setFont('helvetica', 'bold')
  doc.text('Compania:', col1, y)
  doc.setFont('helvetica', 'normal')
  doc.text(datos.poliza.compania, col1 + 25, y)
  doc.setFont('helvetica', 'bold')
  doc.text('Ramo:', col2, y)
  doc.setFont('helvetica', 'normal')
  doc.text(datos.poliza.ramo, col2 + 15, y)
  y += 8

  // ── Datos del siniestro ──
  y = checkPage(doc, y, 30, datos.numero_caso)
  y = drawSection(doc, 'DATOS DEL SINIESTRO', y, pageWidth)
  doc.setFontSize(9)
  doc.setTextColor(50, 50, 50)

  doc.setFont('helvetica', 'bold')
  doc.text('Tipo:', col1, y)
  doc.setFont('helvetica', 'normal')
  doc.text(datos.siniestro.tipo || '—', col1 + 25, y)
  y += 5

  doc.setFont('helvetica', 'bold')
  doc.text('Fecha:', col1, y)
  doc.setFont('helvetica', 'normal')
  doc.text(formatFecha(datos.siniestro.fecha_ocurrencia), col1 + 25, y)
  doc.setFont('helvetica', 'bold')
  doc.text('Hora:', col2, y)
  doc.setFont('helvetica', 'normal')
  doc.text(datos.siniestro.hora || '—', col2 + 15, y)
  y += 5

  doc.setFont('helvetica', 'bold')
  doc.text('Lugar:', col1, y)
  doc.setFont('helvetica', 'normal')
  doc.text(datos.siniestro.lugar || '—', col1 + 25, y)
  y += 5

  doc.setFont('helvetica', 'bold')
  doc.text('Localidad:', col1, y)
  doc.setFont('helvetica', 'normal')
  doc.text(datos.siniestro.localidad || '—', col1 + 25, y)
  y += 8

  // ── Descripcion del hecho ──
  y = checkPage(doc, y, 20, datos.numero_caso)
  y = drawSection(doc, 'DESCRIPCION DEL HECHO', y, pageWidth)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(50, 50, 50)
  const descLineas = doc.splitTextToSize(datos.siniestro.descripcion || '—', pageWidth - 28)
  for (const linea of descLineas) {
    y = checkPage(doc, y, 5, datos.numero_caso)
    doc.text(linea, 14, y)
    y += 4
  }
  y += 4

  // ── Denuncia policial ──
  if (datos.siniestro.denuncia_policial) {
    y = checkPage(doc, y, 15, datos.numero_caso)
    doc.setFont('helvetica', 'bold')
    doc.text('Denuncia policial:', 14, y)
    doc.setFont('helvetica', 'normal')
    doc.text(datos.siniestro.denuncia_policial === 'si' ? 'Sí' : 'No', 55, y)
    if (datos.detalle_extendido?.acta_policial) {
      doc.text(`Acta: ${datos.detalle_extendido.acta_policial}`, 95, y)
    }
    y += 8
  }

  // ── Secciones extendidas (si vienen en detalle_extendido) ──
  const det = datos.detalle_extendido
  if (det) {
    // Conductor (auto/moto)
    if (det.otra_persona_conduce && det.conductor) {
      y = checkPage(doc, y, 30, datos.numero_caso)
      y = drawSection(doc, 'CONDUCTOR DEL VEHICULO', y, pageWidth)
      doc.setFontSize(9)
      doc.setTextColor(50, 50, 50)
      const c = det.conductor
      doc.setFont('helvetica', 'normal')
      const nombreComp = [c.apellido, c.nombre].filter(Boolean).join(', ')
      if (nombreComp) { doc.setFont('helvetica', 'bold'); doc.text('Nombre:', col1, y); doc.setFont('helvetica', 'normal'); doc.text(String(nombreComp), col1 + 25, y); y += 5 }
      if (c.dni) { doc.setFont('helvetica', 'bold'); doc.text('DNI:', col1, y); doc.setFont('helvetica', 'normal'); doc.text(String(c.dni), col1 + 25, y); y += 5 }
      if (c.telefono) { doc.setFont('helvetica', 'bold'); doc.text('Telefono:', col1, y); doc.setFont('helvetica', 'normal'); doc.text(String(c.telefono), col1 + 25, y); y += 5 }
      if (c.relacion) { doc.setFont('helvetica', 'bold'); doc.text('Relacion:', col1, y); doc.setFont('helvetica', 'normal'); doc.text(String(c.relacion), col1 + 25, y); y += 5 }
      if (c.registro) { doc.setFont('helvetica', 'bold'); doc.text('Registro:', col1, y); doc.setFont('helvetica', 'normal'); doc.text(String(c.registro), col1 + 25, y); y += 5 }
      y += 4
    }

    // Daños propios
    if (det.danos_propios) {
      y = checkPage(doc, y, 20, datos.numero_caso)
      y = drawSection(doc, 'DAÑOS DEL VEHICULO ASEGURADO', y, pageWidth)
      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(50, 50, 50)
      const lineas = doc.splitTextToSize(String(det.danos_propios), pageWidth - 28)
      for (const ln of lineas) { y = checkPage(doc, y, 5, datos.numero_caso); doc.text(ln, 14, y); y += 4 }
      y += 4
    }

    // Tercero
    if (det.hubo_tercero) {
      y = checkPage(doc, y, 30, datos.numero_caso)
      y = drawSection(doc, 'TERCERO INVOLUCRADO', y, pageWidth)
      doc.setFontSize(9); doc.setTextColor(50, 50, 50)
      if (det.tercero_fuga) {
        doc.setFont('helvetica', 'bold'); doc.text('Estado:', col1, y); doc.setFont('helvetica', 'normal'); doc.text('Se dio a la fuga', col1 + 25, y); y += 6
      } else if (det.tercero) {
        const t = det.tercero
        const filas: Array<[string, string]> = [
          ['Nombre', t.nombre], ['DNI', t.dni], ['Telefono', t.telefono],
          ['Compania', t.compania], ['Poliza', t.poliza],
          ['Tipo veh.', t.tipo_vehiculo], ['Patente', t.patente],
          ['Marca', t.marca], ['Modelo', t.modelo], ['Anio', t.anio],
        ].filter(([_, v]) => !!v) as Array<[string, string]>
        for (const [k, v] of filas) {
          y = checkPage(doc, y, 5, datos.numero_caso)
          doc.setFont('helvetica', 'bold'); doc.text(`${k}:`, col1, y)
          doc.setFont('helvetica', 'normal'); doc.text(String(v), col1 + 25, y); y += 5
        }
        if (t.danos) {
          y = checkPage(doc, y, 8, datos.numero_caso)
          doc.setFont('helvetica', 'bold'); doc.text('Daños del tercero:', col1, y); y += 5
          doc.setFont('helvetica', 'normal')
          const lineas = doc.splitTextToSize(String(t.danos), pageWidth - 28)
          for (const ln of lineas) { y = checkPage(doc, y, 5, datos.numero_caso); doc.text(ln, 14, y); y += 4 }
        }
      }
      y += 4
    }

    // Lesionados
    if (det.hubo_lesionados) {
      y = checkPage(doc, y, 20, datos.numero_caso)
      y = drawSection(doc, 'LESIONADOS', y, pageWidth)
      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(50, 50, 50)
      const txt = det.detalle_lesiones || 'Si'
      const lineas = doc.splitTextToSize(String(txt), pageWidth - 28)
      for (const ln of lineas) { y = checkPage(doc, y, 5, datos.numero_caso); doc.text(ln, 14, y); y += 4 }
      y += 4
    }

    // Testigos
    if (det.hubo_testigos && Array.isArray(det.testigos) && det.testigos.length > 0) {
      y = checkPage(doc, y, 20, datos.numero_caso)
      y = drawSection(doc, 'TESTIGOS', y, pageWidth)
      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(50, 50, 50)
      const testigosArr = det.testigos as any[]
      for (let i = 0; i < testigosArr.length; i++) {
        const t = testigosArr[i]
        y = checkPage(doc, y, 5, datos.numero_caso)
        const txt = `${i + 1}. ${t.nombre || '—'}${t.telefono ? ` · ${t.telefono}` : ''}`
        doc.text(txt, 14, y); y += 4
      }
      y += 4
    }

    // Hogar
    if (det.tipo_riesgo === 'hogar' && (det.tipo_vivienda || det.que_paso || det.ambiente_afectado || det.causa_siniestro)) {
      y = checkPage(doc, y, 25, datos.numero_caso)
      y = drawSection(doc, 'DATOS DEL INMUEBLE', y, pageWidth)
      doc.setFontSize(9); doc.setTextColor(50, 50, 50)
      const filas: Array<[string, string]> = [
        ['Tipo de vivienda', det.tipo_vivienda],
        ['¿Qué pasó?', det.que_paso],
        ['Ambiente', det.ambiente_afectado],
        ['Causa', det.causa_siniestro],
      ].filter(([_, v]) => !!v) as Array<[string, string]>
      for (const [k, v] of filas) {
        y = checkPage(doc, y, 5, datos.numero_caso)
        doc.setFont('helvetica', 'bold'); doc.text(`${k}:`, col1, y)
        doc.setFont('helvetica', 'normal'); doc.text(String(v), col1 + 35, y); y += 5
      }
      y += 4
    }
  }

  // ── Archivos adjuntos ──
  if (datos.archivos_adjuntos.length > 0) {
    y = checkPage(doc, y, 15, datos.numero_caso)
    y = drawSection(doc, 'ARCHIVOS ADJUNTOS', y, pageWidth)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(80, 80, 80)
    for (const arch of datos.archivos_adjuntos) {
      y = checkPage(doc, y, 5, datos.numero_caso)
      doc.text(`- ${arch.nombre} (${formatTamano(arch.tamano)})`, 18, y)
      y += 4
    }
    y += 4
  }

  // ── Trazabilidad de la carga (evidencia) ──
  if (datos.trazabilidad) {
    y = checkPage(doc, y, 35, datos.numero_caso)
    y = drawSection(doc, 'TRAZABILIDAD DE LA CARGA', y, pageWidth)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(70, 70, 70)

    // Fecha en formato local Argentina + UTC para que la evidencia sea
    // interpretable sin importar la zona horaria del lector.
    const fechaCarga = new Date(datos.trazabilidad.fecha_carga)
    const fechaArg = fechaCarga.toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    const fechaUtc = fechaCarga.toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC')

    const filasTraz: Array<[string, string]> = [
      ['Origen',     datos.trazabilidad.origen],
      ['Lugar',      'Carga remota a través de internet'],
      ['Fecha (ARG)', fechaArg],
      ['Fecha (UTC)', fechaUtc],
    ]
    if (datos.trazabilidad.ip) filasTraz.push(['IP de origen', datos.trazabilidad.ip])
    if (datos.trazabilidad.user_agent) filasTraz.push(['Navegador / dispositivo', datos.trazabilidad.user_agent])

    const col1Traz = 14
    for (const [k, v] of filasTraz) {
      y = checkPage(doc, y, 5, datos.numero_caso)
      doc.setFont('helvetica', 'bold'); doc.text(`${k}:`, col1Traz, y)
      doc.setFont('helvetica', 'normal')
      const valorLineas = doc.splitTextToSize(String(v), pageWidth - col1Traz - 50)
      doc.text(valorLineas, col1Traz + 45, y)
      y += Math.max(5, valorLineas.length * 4)
    }
    y += 2
  }

  // ── Aviso "esto es una pre-carga" ──
  {
    // Calcular altura del callout dinámicamente según el texto
    const textoAviso = `${AVISO_PRECARGA_TITULO} ${AVISO_PRECARGA_TEXTO}`
    const anchoTexto = pageWidth - 28 - 8 // margen general - padding interno
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    const lineasAviso = doc.splitTextToSize(textoAviso, anchoTexto)
    const altoCallout = 6 + lineasAviso.length * 4 + 4

    y = checkPage(doc, y, altoCallout + 4, datos.numero_caso)
    y += 4

    // Fondo amber-100 + borde izquierdo amber-500
    doc.setFillColor(254, 243, 199) // #fef3c7
    doc.rect(14, y, pageWidth - 28, altoCallout, 'F')
    doc.setFillColor(245, 158, 11) // #f59e0b
    doc.rect(14, y, 2, altoCallout, 'F')

    doc.setTextColor(120, 53, 15) // #78350f
    doc.text(lineasAviso, 14 + 6, y + 6)

    y += altoCallout + 2
    doc.setTextColor(0, 0, 0)
  }

  // ── Footer ──
  y = checkPage(doc, y, 30, datos.numero_caso)
  y += 4
  doc.setDrawColor(200, 200, 200)
  doc.line(14, y, pageWidth - 14, y)
  y += 6
  doc.setFontSize(7)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(130, 130, 130)
  const declaracion = 'Declaro bajo juramento que los datos consignados en la presente denuncia son verdaderos y que no he omitido ni falseado dato alguno.'
  const declLineas = doc.splitTextToSize(declaracion, pageWidth - 28)
  doc.text(declLineas, 14, y)
  y += declLineas.length * 3.5 + 3
  doc.text(`${datos.organizacion.nombre || 'Productor de Seguros'} — Documento generado el ${formatFecha(new Date().toISOString())}`, 14, y)

  // Convertir a Buffer
  const arrayBuffer = doc.output('arraybuffer')
  return Buffer.from(arrayBuffer)
}
