/**
 * Helper para previews de emails: convierte el logo del PAS a data URL inline
 * (base64) leyéndolo directamente del filesystem.
 *
 * Por qué no usar la URL pública del logo en los previews:
 *   El preview se renderiza dentro de un iframe `srcdoc` con `sandbox`. Aun
 *   con `allow-same-origin`, hay browsers que tratan el origin del srcdoc
 *   como "opaque" en algunos contextos, fallando silenciosamente la carga
 *   de la imagen. Una data URL (`data:image/svg+xml;base64,...`) es nativa
 *   del HTML inline y no depende de ningún request HTTP, cookies, sandbox
 *   ni CORS — siempre funciona.
 *
 * En los emails REALES (los que se mandan al asegurado por SMTP) seguimos
 * usando la URL absoluta del CRM porque los clientes de email saben
 * fetchearla normalmente.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { logger } from '@/lib/errores'

const STORAGE_ROOT = path.join(process.cwd(), 'storage')
const STORAGE_ROOT_GUARDED = STORAGE_ROOT + path.sep

const MIME_POR_EXT: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/**
 * Convierte la ruta relativa del logo (ej: `perfil/logo-123.svg`, tal como
 * está en `configuracion.logo_path`) a una data URL inline.
 *
 * Devuelve undefined si:
 *   - logoPath es null / vacío
 *   - El archivo no existe o no es legible
 *   - La ruta intenta path traversal o cae fuera de /storage
 *   - La extensión no es una imagen conocida
 *
 * No tira nunca — falla silenciosamente y deja que el renderer caiga al
 * fallback de "solo nombre" sin logo.
 */
export async function logoComoDataUrl(logoPath: string | null | undefined): Promise<string | undefined> {
  if (!logoPath) return undefined
  if (logoPath.includes('..') || logoPath.includes('\0')) return undefined

  const absolutePath = path.join(STORAGE_ROOT, logoPath)
  if (!absolutePath.startsWith(STORAGE_ROOT_GUARDED)) return undefined

  const ext = path.extname(absolutePath).toLowerCase()
  const mime = MIME_POR_EXT[ext]
  if (!mime) return undefined

  try {
    const buf = await readFile(absolutePath)
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch (err) {
    logger.warn({
      modulo: 'email-preview',
      mensaje: 'No se pudo leer el logo para preview inline',
      contexto: { logoPath, error: String(err) },
    })
    return undefined
  }
}
