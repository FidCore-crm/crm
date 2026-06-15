/**
 * Identidad estable de cada instalación del CRM.
 *
 * Cada instalación de FidCore tiene un UUID único que persiste en disco.
 * Lo usamos para etiquetar errores en Sentry y poder correlacionar issues
 * con un cliente específico sin tener que loguear datos personales.
 *
 * Se genera automáticamente en el primer acceso (lazy) y se guarda en
 * `storage/.instalacion-id`. Si la variable `INSTALACION_ID` está definida
 * en el entorno, gana sobre el archivo (útil para que el instalador fije
 * un ID antes del primer arranque).
 *
 * Fail-soft: si todo falla, devuelve `'unknown'` y loguea — nunca tira.
 */

import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'

const ARCHIVO_ID = path.join(process.cwd(), 'storage', '.instalacion-id')

let cache: string | null = null

export function obtenerInstalacionId(): string {
  if (cache) return cache

  // 1) Override por env (lo usa el instalador del producto si lo pre-configura)
  const desdeEnv = process.env.INSTALACION_ID?.trim()
  if (desdeEnv) {
    cache = desdeEnv
    return cache
  }

  // 2) Lectura del archivo persistente
  try {
    if (existsSync(ARCHIVO_ID)) {
      const contenido = readFileSync(ARCHIVO_ID, 'utf-8').trim()
      if (contenido) {
        cache = contenido
        return cache
      }
    }
  } catch {
    // Si no podemos leer, intentamos crear uno nuevo abajo.
  }

  // 3) Generación + persistencia
  try {
    const nuevo = randomUUID()
    mkdirSync(path.dirname(ARCHIVO_ID), { recursive: true })
    writeFileSync(ARCHIVO_ID, nuevo, 'utf-8')
    cache = nuevo
    return cache
  } catch (err) {
    // No podemos persistir. Devolvemos un fallback estable para esta sesión
    // — peor que persistente, pero mejor que crashear.
    // eslint-disable-next-line no-console
    console.warn('[instalacion-id] No se pudo persistir el ID:', err)
    cache = 'unknown'
    return cache
  }
}
