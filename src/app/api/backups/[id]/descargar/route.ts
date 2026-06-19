import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { abrirBackupParaDescarga } from '@/lib/backup-runner'
import { Readable } from 'stream'

// GET — Descargar un backup (streaming del archivo .crmbak, sin cargar en RAM).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }
  if (usuario.rol !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Acceso denegado. Solo administradores.' }, { status: 403 })
  }

  const { id } = await params
  const supabase = getSupabaseAdmin()

  const { data: backup, error } = await supabase
    .from('backups')
    .select('nombre')
    .eq('id', id)
    .single()

  if (error || !backup) {
    return NextResponse.json({ ok: false, error: 'Backup no encontrado' }, { status: 404 })
  }

  const nombre = (backup as any).nombre
  if (!nombre) {
    return NextResponse.json({ ok: false, error: 'Backup sin nombre' }, { status: 400 })
  }

  const info = await abrirBackupParaDescarga(nombre)
  if (!info) {
    return NextResponse.json({ ok: false, error: 'Archivo no encontrado en disco' }, { status: 404 })
  }

  // Convertir el Node Readable en Web ReadableStream
  const webStream = Readable.toWeb(info.stream as Readable) as unknown as ReadableStream<Uint8Array>

  return new NextResponse(webStream, {
    headers: {
      'Content-Type': info.contentType,
      'Content-Disposition': `attachment; filename="${info.filename}"`,
      'Content-Length': info.tamano.toString(),
    },
  })
}
