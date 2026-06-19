import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { validarTokenArchivo } from '@/lib/storage-tokens'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { logger } from '@/lib/errores'

const STORAGE_ROOT = path.join(process.cwd(), 'storage')
// Sufijo con path.sep para que startsWith no matchee carpetas hermanas
// (ej: STORAGE_ROOT="/foo/storage" no debe permitir "/foo/storage2/...").
const STORAGE_ROOT_GUARDED = STORAGE_ROOT + path.sep

// Extensiones consideradas "imagen segura" para servir como asset público bajo /perfil/.
// Cualquier otra extensión (pdf, docx, etc.) requiere autenticación aunque esté en /perfil/.
const EXTENSIONES_IMAGEN_PUBLICA = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'])

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const { path: segments } = await params
    const relativePath = segments.join('/')

    // Prevenir path traversal
    if (relativePath.includes('..') || relativePath.includes('\0')) {
      return NextResponse.json({ error: 'Ruta inválida' }, { status: 400 })
    }

    const absolutePath = path.join(STORAGE_ROOT, relativePath)

    // Validación estricta: la ruta absoluta debe estar dentro de STORAGE_ROOT.
    // Usamos STORAGE_ROOT + path.sep para evitar el bypass clásico de carpetas
    // hermanas (ej: /foo/storage vs /foo/storage2/...).
    if (!absolutePath.startsWith(STORAGE_ROOT_GUARDED) || !existsSync(absolutePath)) {
      return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 })
    }

    // ── Autorización ─────────────────────────────────────────
    // 0) Assets públicos: SOLO imágenes bajo /perfil/ (branding de organización
    //    usado en /login, /denuncia, emails, etc.). Cualquier otro tipo de
    //    archivo bajo /perfil/ requiere autenticación.
    // 1) Sesión de usuario válida → servir (con cartera check)
    // 2) Token firmado (?token=...) → servir si válido (sin cartera check)
    // 3) Sin nada → 401
    const extLower = path.extname(relativePath).toLowerCase()
    const esAssetPublico =
      relativePath.startsWith('perfil/') && EXTENSIONES_IMAGEN_PUBLICA.has(extLower)
    let autorizado = esAssetPublico
    let usuarioSesion: any = null

    if (!autorizado) {
      try {
        const usuario = await obtenerUsuarioDesdeRequest(req)
        if (usuario) {
          autorizado = true
          usuarioSesion = usuario
        }
      } catch {
        // continuar con token
      }
    }

    if (!autorizado) {
      const token = req.nextUrl.searchParams.get('token')
      if (!token) {
        return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
      }
      const resultado = await validarTokenArchivo(token, relativePath)
      if (!resultado.valido) {
        return NextResponse.json({ error: resultado.motivo ?? 'Token inválido' }, { status: 403 })
      }
      autorizado = true
      // Token-based auth skips cartera check
    }

    // ── Verificación de cartera (solo para sesión, no para tokens) ──
    if (usuarioSesion && usuarioSesion.acceso_cartera === 'PROPIA') {
      const supabaseCartera = getSupabaseAdmin()
      let personaUserId: string | null = null
      let recursoEncontrado = true

      if (segments[0] === 'polizas' && segments[1]) {
        const numeroPoliza = segments[1]
        const { data: poliza } = await supabaseCartera
          .from('polizas')
          .select('asegurado_id')
          .eq('numero_poliza', numeroPoliza)
          .maybeSingle()
        if (!poliza) {
          recursoEncontrado = false
        } else {
          const { data: persona } = await supabaseCartera
            .from('personas')
            .select('usuario_id')
            .eq('id', (poliza as any).asegurado_id)
            .maybeSingle()
          if (persona) personaUserId = (persona as any).usuario_id
        }
      } else if (segments[0] === 'siniestros' && segments[1]) {
        const numeroCaso = segments[1]
        const { data: siniestro } = await supabaseCartera
          .from('siniestros')
          .select('persona_id')
          .eq('numero_caso', numeroCaso)
          .maybeSingle()
        if (!siniestro) {
          recursoEncontrado = false
        } else {
          const { data: persona } = await supabaseCartera
            .from('personas')
            .select('usuario_id')
            .eq('id', (siniestro as any).persona_id)
            .maybeSingle()
          if (persona) personaUserId = (persona as any).usuario_id
        }
      }

      if (!recursoEncontrado || (personaUserId && personaUserId !== usuarioSesion.id)) {
        return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 })
      }
    }

    const buffer = await readFile(absolutePath)
    const ext = path.extname(absolutePath).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'

    const download = req.nextUrl.searchParams.get('download') === 'true'
    const fileName = path.basename(absolutePath)

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': buffer.length.toString(),
      'Cache-Control': 'private, max-age=3600',
    }

    if (download) {
      headers['Content-Disposition'] = `attachment; filename="${fileName}"`
    }

    return new NextResponse(buffer, { headers })
  } catch (err: any) {
    logger.error({ modulo: 'storage', mensaje: 'Error inesperado al servir archivo', contexto: { error: err.message } })
    return NextResponse.json({ error: 'Error al servir el archivo' }, { status: 500 })
  }
}
