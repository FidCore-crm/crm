/**
 * Helper centralizado para limpiar carpetas temporales del sistema.
 *
 * Maneja:
 *  - `<project>/tmp/pdf-procesamientos/` — archivos temporales del agente IA de PDFs
 *  - `/tmp/crm-restauraciones/` — workdirs temporales de restauraciones de backup
 *
 * Expone dos formas de uso:
 *  - `limpiarTemporales()` — async, retorna resultado detallado. Usado por el cron
 *    `/api/cron/limpiar-temporales`.
 *  - `limpiarTemporalesAntiguosSinBloquear()` — fire-and-forget best-effort. Usado
 *    desde flujos del usuario (iniciar un PDF, iniciar una restauración) como
 *    limpieza oportunista que no bloquea la request.
 *
 * Maneja tanto archivos sueltos como directorios (las restauraciones crean
 * subcarpetas por UUID). Errores individuales se loggean pero no propagan.
 */

import fs from 'fs/promises'
import path from 'path'
import { logger } from '@/lib/errores'

export interface CarpetaTemporalConfig {
  path: string
  maxAgeHours: number
  nombre: string
}

// Listado canónico de carpetas temporales del sistema. Agregar acá si aparece
// otra (workdirs de importaciones, etc.).
export const CARPETAS_TEMPORALES: CarpetaTemporalConfig[] = [
  {
    path: path.join(process.cwd(), 'tmp', 'pdf-procesamientos'),
    maxAgeHours: 24,
    nombre: 'PDFs procesamientos',
  },
  {
    path: '/tmp/crm-restauraciones',
    maxAgeHours: 24,
    nombre: 'Restauraciones',
  },
]

export interface ResultadoCarpeta {
  path: string
  nombre: string
  existia: boolean
  eliminados: number
  mb_liberados: string
  errores: string[]
}

export interface ResultadoLimpiezaGlobal {
  carpetas_limpiadas: ResultadoCarpeta[]
  total_mb_liberados: string
}

/**
 * Corre la limpieza sobre TODAS las carpetas configuradas y devuelve un
 * resultado detallado para el endpoint del cron.
 */
export async function limpiarTemporales(): Promise<ResultadoLimpiezaGlobal> {
  const resultados: ResultadoCarpeta[] = []
  let totalMb = 0

  for (const carpeta of CARPETAS_TEMPORALES) {
    const r = await limpiarCarpeta(carpeta)
    resultados.push(r)
    totalMb += parseFloat(r.mb_liberados)
  }

  return {
    carpetas_limpiadas: resultados,
    total_mb_liberados: totalMb.toFixed(2),
  }
}

/**
 * Fire-and-forget para usar desde flujos del usuario. Nunca tira — loggea.
 */
export function limpiarTemporalesAntiguosSinBloquear(): Promise<void> {
  return (async () => {
    for (const carpeta of CARPETAS_TEMPORALES) {
      try {
        await limpiarCarpeta(carpeta)
      } catch (err) {
        logger.warn({ modulo: 'limpieza-temporales', mensaje: `Falla limpiando ${carpeta.path}`, contexto: { error: String(err) } })
      }
    }
  })()
}

// ---------------------------------------------------------------------------
// Internos
// ---------------------------------------------------------------------------

async function limpiarCarpeta(carpeta: CarpetaTemporalConfig): Promise<ResultadoCarpeta> {
  const base: ResultadoCarpeta = {
    path: carpeta.path,
    nombre: carpeta.nombre,
    existia: false,
    eliminados: 0,
    mb_liberados: '0.00',
    errores: [],
  }

  try {
    await fs.access(carpeta.path)
  } catch {
    return base
  }
  base.existia = true

  let items: string[]
  try {
    items = await fs.readdir(carpeta.path)
  } catch (err: any) {
    base.errores.push(`readdir: ${err.message}`)
    return base
  }

  const ahora = Date.now()
  const maxAgeMs = carpeta.maxAgeHours * 60 * 60 * 1000
  let bytesLiberados = 0

  for (const item of items) {
    try {
      const rutaCompleta = path.join(carpeta.path, item)
      const stats = await fs.stat(rutaCompleta)
      const edadMs = ahora - stats.mtimeMs
      if (edadMs <= maxAgeMs) continue

      const tamano = stats.isDirectory()
        ? await calcularTamanoDirectorio(rutaCompleta)
        : stats.size
      bytesLiberados += tamano

      if (stats.isDirectory()) {
        await fs.rm(rutaCompleta, { recursive: true, force: true })
      } else {
        await fs.unlink(rutaCompleta)
      }
      base.eliminados++
    } catch (err: any) {
      base.errores.push(`${item}: ${err.message}`)
    }
  }

  base.mb_liberados = (bytesLiberados / 1024 / 1024).toFixed(2)
  return base
}

async function calcularTamanoDirectorio(dirPath: string): Promise<number> {
  let total = 0
  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true })
    for (const item of items) {
      const itemPath = path.join(dirPath, item.name)
      if (item.isDirectory()) {
        total += await calcularTamanoDirectorio(itemPath)
      } else {
        try {
          const stats = await fs.stat(itemPath)
          total += stats.size
        } catch (err) {
          logger.warn({ modulo: 'limpieza-temporales', mensaje: 'Error obteniendo stat de archivo temporal', contexto: { path: itemPath, error: String(err) } })
        }
      }
    }
  } catch {
    // Ignorar errores individuales
  }
  return total
}
