import { NextRequest, NextResponse } from 'next/server'
import { stat, open } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { validarTokenAcceso } from '@/lib/portal-cliente-tokens'
import { logger } from '@/lib/errores'

const STORAGE_ROOT = path.join(process.cwd(), 'storage')
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB tope defensivo
// Whitelist de caracteres permitidos en numeros de póliza/caso y nombres de archivo:
// alfanumérico + punto + guión bajo + guión. Cubre nombres reales y bloquea NUL/CRLF/unicode raro.
const SAFE_PATH_REGEX = /^[A-Za-z0-9._-]+$/

/**
 * Sanitiza un nombre de archivo para Content-Disposition: header injection.
 * Elimina CR, LF, comillas y backslashes. Si el resultado queda vacío, usa 'archivo'.
 */
function sanitizeContentDispositionFilename(name: string): string {
  const limpio = name.replace(/[\r\n"\\]/g, '').trim()
  return limpio || 'archivo'
}

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    // 1. Rate limit
    const ip = getClientIp(request)
    const rl = await checkRateLimit({
      identifier: ip,
      endpoint: 'publico-portal-cliente-archivo',
      maxRequests: 100,
      windowSeconds: 60,
      failMode: 'closed',
    })
    if (!rl.allowed) {
      const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000)
      return NextResponse.json(
        { ok: false, error: 'Demasiadas solicitudes' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      )
    }

    const { token } = await params
    const url = new URL(request.url)
    const ruta = url.searchParams.get('ruta')

    if (!ruta) {
      return NextResponse.json({ ok: false, error: 'Falta parámetro ruta' }, { status: 400 })
    }

    // 2. Validar sistema activo
    const supabase = getSupabaseAdmin()
    const { data: config } = await supabase
      .from('configuracion_portal_cliente')
      .select('activo')
      .limit(1)
      .maybeSingle()

    if (!(config as any)?.activo) {
      return NextResponse.json({ ok: false, error: 'Portal no disponible' }, { status: 503 })
    }

    // 3. Validar token
    const validacion = await validarTokenAcceso(token, ip)
    if (!validacion.valido || !validacion.persona_id) {
      return NextResponse.json({ ok: false, error: 'Acceso no válido' }, { status: 403 })
    }

    // 4. Validación estricta del formato de ruta:
    //    polizas/{numero}/documentacion/{archivo}      (de pólizas vigentes)
    //    siniestros/{numero_caso}/documentacion/{archivo}  (de siniestros del asegurado)
    if (ruta.includes('..') || ruta.includes('\\')) {
      return NextResponse.json({ ok: false, error: 'Ruta inválida' }, { status: 400 })
    }

    const partes = ruta.split('/')
    if (partes.length !== 4 || partes[2] !== 'documentacion') {
      return NextResponse.json({ ok: false, error: 'Ruta no permitida' }, { status: 403 })
    }

    const tipo = partes[0]
    const idEntidad = partes[1]
    const nombreArchivo = partes[3]
    if (!idEntidad || !nombreArchivo) {
      return NextResponse.json({ ok: false, error: 'Ruta inválida' }, { status: 400 })
    }
    // Whitelist estricta antes de path.join — bloquea NUL, CRLF, unicode raro,
    // espacios y caracteres especiales que puedan derivar en path traversal
    // o header injection río abajo.
    if (!SAFE_PATH_REGEX.test(idEntidad) || !SAFE_PATH_REGEX.test(nombreArchivo)) {
      logger.warn({ modulo: 'portal-cliente', mensaje: 'Ruta con caracteres no permitidos', contexto: { idEntidad, nombreArchivo, ip } })
      return NextResponse.json({ ok: false, error: 'Ruta inválida' }, { status: 400 })
    }

    let dirRel: string
    if (tipo === 'polizas') {
      // 5a. Validar que la póliza pertenezca al cliente y esté VIGENTE
      const { data: poliza } = await supabase
        .from('polizas')
        .select('id, asegurado_id, estado')
        .eq('numero_poliza', idEntidad)
        .maybeSingle()

      if (!poliza) {
        return NextResponse.json({ ok: false, error: 'Póliza no encontrada' }, { status: 403 })
      }
      const p = poliza as any
      if (p.asegurado_id !== validacion.persona_id) {
        return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 })
      }
      if (p.estado !== 'VIGENTE') {
        return NextResponse.json({ ok: false, error: 'Póliza no vigente' }, { status: 403 })
      }
      dirRel = path.join('polizas', idEntidad, 'documentacion')
    } else if (tipo === 'siniestros') {
      // 5b. Validar que el siniestro pertenezca al asegurado (no soft-deleted)
      const { data: siniestro } = await supabase
        .from('siniestros')
        .select('id, persona_id, deleted_at')
        .eq('numero_caso', idEntidad)
        .maybeSingle()

      if (!siniestro) {
        return NextResponse.json({ ok: false, error: 'Siniestro no encontrado' }, { status: 403 })
      }
      const s = siniestro as any
      if (s.deleted_at) {
        return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 })
      }
      if (s.persona_id !== validacion.persona_id) {
        return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 403 })
      }
      dirRel = path.join('siniestros', idEntidad, 'documentacion')
    } else {
      return NextResponse.json({ ok: false, error: 'Tipo de recurso no permitido' }, { status: 403 })
    }

    // 6. Leer y servir archivo (streaming, no cargar en RAM)
    const absolutePath = path.join(STORAGE_ROOT, dirRel, nombreArchivo)
    if (!absolutePath.startsWith(STORAGE_ROOT + path.sep)) {
      return NextResponse.json({ ok: false, error: 'Ruta inválida' }, { status: 400 })
    }
    if (!existsSync(absolutePath)) {
      return NextResponse.json({ ok: false, error: 'Archivo no encontrado' }, { status: 404 })
    }

    const stats = await stat(absolutePath)
    if (stats.size > MAX_FILE_SIZE_BYTES) {
      logger.warn({
        modulo: 'portal-cliente',
        mensaje: 'Archivo excede tope para serving',
        contexto: { ruta, tamano: stats.size, ip },
      })
      return NextResponse.json({ ok: false, error: 'Archivo demasiado grande' }, { status: 413 })
    }

    const ext = path.extname(absolutePath).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    const filenameSeguro = sanitizeContentDispositionFilename(nombreArchivo)

    // Stream del archivo: createReadStream → ReadableStream Web compatible.
    const fh = await open(absolutePath, 'r')
    const nodeStream = fh.createReadStream()
    const webStream = new ReadableStream<Uint8Array>({
      start(controller) {
        nodeStream.on('data', (chunk: Buffer | string) => {
          controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk))
        })
        nodeStream.on('end', () => controller.close())
        nodeStream.on('error', (err) => controller.error(err))
      },
      cancel() { nodeStream.destroy() },
    })

    logger.info({ modulo: 'portal-cliente', mensaje: 'Archivo servido', contexto: { persona_id: validacion.persona_id, ruta, ip } })

    return new NextResponse(webStream as any, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': stats.size.toString(),
        // Sanitizado: caracteres CRLF/comillas evitan header injection.
        'Content-Disposition': `inline; filename="${filenameSeguro}"`,
        // no-store: dispositivos compartidos no deberían cachear el documento del cliente.
        'Cache-Control': 'private, no-store, must-revalidate',
      },
    })
  } catch (err: any) {
    logger.error({ modulo: 'portal-cliente', mensaje: 'Error al servir archivo del portal', contexto: { error: err?.message } })
    return NextResponse.json({ ok: false, error: 'Error interno' }, { status: 500 })
  }
}
