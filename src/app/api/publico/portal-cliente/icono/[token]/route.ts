/**
 * Sirve el ícono de la PWA del portal del asegurado.
 *
 *   GET /api/publico/portal-cliente/icono/[token]
 *
 * Si la organización configuró un logo, devuelve los bytes de ese archivo.
 * Si no, devuelve el SVG genérico de portal-asegurado.
 *
 * Se llama desde el `manifest.json` dinámico y desde el `<link rel="icon">`
 * del layout — por eso vive en el origen del CRM (no requiere CORS).
 */

import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { validarTokenAcceso } from '@/lib/portal-cliente-tokens'
import { getClientIp } from '@/lib/rate-limit'
import { logger } from '@/lib/errores/logger'

const STORAGE_ROOT = path.join(process.cwd(), 'storage')
const STORAGE_ROOT_GUARDED = STORAGE_ROOT + path.sep
const ICONO_FALLBACK = path.join(process.cwd(), 'public', 'portal-asegurado', 'icon.svg')

const MIME_POR_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
}

const EXT_VALIDAS = new Set(Object.keys(MIME_POR_EXT))

async function servirFallback() {
  try {
    const buffer = await readFile(ICONO_FALLBACK)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: 'No disponible' }, { status: 404 })
  }
}

export async function GET(
  request: Request,
  { params }: { params: { token: string } },
) {
  const token = params.token

  try {
    const validacion = await validarTokenAcceso(token, getClientIp(request))
    if (!validacion.valido) return servirFallback()

    const supabase = getSupabaseAdmin()
    const { data: organizacion } = await supabase
      .from('configuracion')
      .select('logo_path, usar_logo')
      .limit(1)
      .maybeSingle()

    const prod = (organizacion as { logo_path?: string | null; usar_logo?: boolean | null } | null) ?? {}
    if (prod.usar_logo === false || !prod.logo_path) return servirFallback()

    // Validación estricta de la ruta dentro de STORAGE_ROOT.
    const relativePath = String(prod.logo_path).replace(/^\/+/, '')
    if (relativePath.includes('..') || relativePath.includes('\0')) return servirFallback()

    const absolutePath = path.join(STORAGE_ROOT, relativePath)
    if (!absolutePath.startsWith(STORAGE_ROOT_GUARDED) || !existsSync(absolutePath)) {
      return servirFallback()
    }

    const ext = path.extname(absolutePath).toLowerCase()
    if (!EXT_VALIDAS.has(ext)) return servirFallback()

    const buffer = await readFile(absolutePath)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': MIME_POR_EXT[ext],
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (e) {
    logger.warn({ modulo: 'portal-cliente-icono', mensaje: 'Error sirviendo icono', contexto: { error: String(e) } })
    return servirFallback()
  }
}
