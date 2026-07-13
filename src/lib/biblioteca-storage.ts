/**
 * Helpers para gestionar el filesystem de la biblioteca de recursos.
 *
 * Estructura: storage/biblioteca/{YYYY}/{MM}/{uuid}.{ext}
 * El particionado por año/mes evita que una carpeta se llene con miles de
 * archivos y facilita backups incrementales.
 */

import { mkdir, writeFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

const STORAGE_ROOT = path.join(process.cwd(), 'storage')
const BIBLIOTECA_ROOT = path.join(STORAGE_ROOT, 'biblioteca')

/** Extensiones permitidas por MIME type. */
const MIME_A_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

export const MIMES_PERMITIDOS = Object.keys(MIME_A_EXTENSION)
export const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024 // 10 MB

/**
 * Construye la ruta relativa a STORAGE_ROOT para un archivo de biblioteca.
 * La ruta se guarda en `biblioteca_archivos.ruta`.
 */
export function armarRutaBiblioteca(uuid: string, mimeType: string, fecha: Date = new Date()): string {
  const ext = MIME_A_EXTENSION[mimeType]
  if (!ext) throw new Error(`MIME no permitido: ${mimeType}`)
  const anio = fecha.getUTCFullYear()
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0')
  return path.posix.join('biblioteca', String(anio), mes, `${uuid}.${ext}`)
}

/**
 * Ruta absoluta en filesystem para una ruta relativa dada.
 * Valida path traversal — la ruta resultante DEBE estar dentro de STORAGE_ROOT.
 */
export function rutaAbsolutaSegura(rutaRelativa: string): string {
  const abs = path.resolve(STORAGE_ROOT, rutaRelativa)
  if (!abs.startsWith(STORAGE_ROOT + path.sep) && abs !== STORAGE_ROOT) {
    throw new Error('Path traversal detectado')
  }
  return abs
}

/** Guarda el buffer en la ruta relativa. Crea carpetas intermedias. */
export async function guardarArchivoBiblioteca(rutaRelativa: string, buffer: Buffer): Promise<void> {
  const abs = rutaAbsolutaSegura(rutaRelativa)
  await mkdir(path.dirname(abs), { recursive: true })
  await writeFile(abs, buffer)
}

/** Elimina el archivo físico. No falla si ya no existe. */
export async function eliminarArchivoBiblioteca(rutaRelativa: string): Promise<void> {
  try {
    const abs = rutaAbsolutaSegura(rutaRelativa)
    if (existsSync(abs)) await unlink(abs)
  } catch {
    // Silent — el archivo pudo haberse borrado ya, o la ruta era inválida.
    // No queremos que falle el DELETE de DB si el filesystem se adelantó.
  }
}

/** Ruta absoluta para servir el archivo desde el endpoint público. */
export function rutaAbsolutaBiblioteca(rutaRelativa: string): string {
  return rutaAbsolutaSegura(rutaRelativa)
}
