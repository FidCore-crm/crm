import { readFile } from 'fs/promises'
import { PDFParse } from 'pdf-parse'
import { logger } from '@/lib/errores'

export type ResultadoExtraccion = {
  texto: string
  paginas: number
  caracteres: number
}

// Umbral mínimo de caracteres por página promedio para considerar que un PDF
// tiene texto seleccionable. Por debajo de esto asumimos que es escaneado
// (imagen sin OCR) y no vale la pena mandarlo a la IA.
const MIN_CARACTERES_POR_PAGINA = 50

export class PDFSinTextoExtraible extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'PDFSinTextoExtraible'
  }
}

/**
 * Extrae el texto plano de un PDF usando pdf-parse (pdfjs-dist bajo la
 * superficie). Usado como fallback cuando la comparación con PDF nativo
 * excede el límite de 200k tokens de Anthropic. Un PDF típico de póliza
 * ocupa 100k-150k tokens en modo nativo y ~5k-15k en modo texto plano.
 *
 * Tira PDFSinTextoExtraible si el PDF tiene menos de MIN_CARACTERES_POR_PAGINA
 * de promedio — señal de que es imagen escaneada y necesitaría OCR (fuera
 * del alcance actual del CRM).
 */
export async function extraerTextoPDF(rutaAbsoluta: string): Promise<ResultadoExtraccion> {
  const buffer = await readFile(rutaAbsoluta)
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  try {
    const result = await parser.getText()
    const texto = (result.text || '').trim()
    const paginas = result.total || result.pages?.length || 0
    const caracteres = texto.length

    if (paginas > 0 && caracteres / paginas < MIN_CARACTERES_POR_PAGINA) {
      throw new PDFSinTextoExtraible(
        `El PDF tiene ${paginas} páginas pero solo ${caracteres} caracteres — parece un PDF escaneado (imagen sin texto). Habría que hacerle OCR primero.`,
      )
    }

    if (caracteres === 0) {
      throw new PDFSinTextoExtraible(
        'No se pudo extraer texto del PDF. Puede ser un archivo escaneado o corrupto.',
      )
    }

    logger.info({
      modulo: 'agente-pdf',
      mensaje: 'Texto extraído del PDF',
      contexto: { ruta: rutaAbsoluta, paginas, caracteres },
    })

    return { texto, paginas, caracteres }
  } finally {
    try {
      await parser.destroy()
    } catch {
      // destroy() puede tirar si el documento nunca se cargó; no bloquea
    }
  }
}
