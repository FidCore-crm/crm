import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import * as fs from 'fs/promises'
import * as path from 'path'

export const dynamic = 'force-dynamic'

const STORAGE_ROOT = path.resolve(process.cwd(), 'storage', 'importaciones')
const DIAS_VALIDEZ = 30

export async function GET(
  request: Request,
  context: { params: { id: string; nombre: string } }
) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth
  const { id, nombre: nombreRaw } = context.params
  const nombre = decodeURIComponent(nombreRaw)

  if (path.basename(nombre) !== nombre || nombre.includes('/') || nombre.includes('\\')) {
    return NextResponse.json({ ok: false, error: 'Nombre de archivo inválido' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()
  const { data: imp, error } = await supabase
    .from('importaciones')
    .select('id, usuario_id, fecha_inicio, archivos_metadata')
    .eq('id', id)
    .maybeSingle()

  if (error || !imp) {
    return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 })
  }
  type ImpRow = { usuario_id: string; fecha_inicio: string | null; archivos_metadata: Array<{ nombre: string; mime_type?: string }> | null }
  const impRow = imp as ImpRow
  const own = requireOwnership(usuario, { usuario_id: impRow.usuario_id })
  if (own) return own

  const fechaInicio = impRow.fecha_inicio ? new Date(impRow.fecha_inicio) : null
  if (!fechaInicio) {
    return NextResponse.json({ ok: false, error: 'Importación sin fecha válida' }, { status: 400 })
  }
  const edadMs = Date.now() - fechaInicio.getTime()
  if (edadMs > DIAS_VALIDEZ * 24 * 60 * 60 * 1000) {
    return NextResponse.json(
      { ok: false, error: 'Los archivos de esta importación ya fueron eliminados (>30 días)' },
      { status: 410 }
    )
  }

  const filePath = path.join(STORAGE_ROOT, id, nombre)
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(path.resolve(STORAGE_ROOT, id) + path.sep)) {
    return NextResponse.json({ ok: false, error: 'Ruta inválida' }, { status: 400 })
  }

  let buffer: Buffer
  try {
    buffer = await fs.readFile(resolved)
  } catch {
    return NextResponse.json({ ok: false, error: 'Archivo no encontrado' }, { status: 404 })
  }

  const metadata = impRow.archivos_metadata ?? []
  const meta = metadata.find(m => m.nombre === nombre)
  const mime = meta?.mime_type || 'application/octet-stream'

  // Convertir Buffer a Uint8Array que es BodyInit válido
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, no-store',
    },
  })
}
