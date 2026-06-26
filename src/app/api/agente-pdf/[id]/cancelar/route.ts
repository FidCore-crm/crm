import { NextResponse } from 'next/server'
import { unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { logger } from '@/lib/errores'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const supabase = getSupabaseAdmin()
  const { data: proc } = await supabase
    .from('pdf_procesamientos')
    .select('id, estado, ruta_temporal, usuario_id')
    .eq('id', id)
    .maybeSingle()

  if (!proc) {
    return NextResponse.json({ ok: false, error: 'Procesamiento no encontrado' }, { status: 404 })
  }

  const owns = requireOwnership(auth, { usuario_id: (proc as any).usuario_id })
  if (owns) return owns

  if (['APROBADO', 'CANCELADO', 'FALLIDO'].includes((proc as any).estado)) {
    return NextResponse.json({ ok: true, noop: true })
  }

  // Transición atómica: cancelar mientras no esté APROBADO/CANCELADO/FALLIDO.
  // EXTRAIDO también se puede cancelar — es el estado en el que el PAS está
  // revisando los datos y puede querer abandonar el flujo (ej: cobertura
  // bloqueada que no quiere configurar ahora).
  const { data: updated, error: errUpd } = await (supabase
    .from('pdf_procesamientos') as any)
    .update({ estado: 'CANCELADO' })
    .eq('id', id)
    .in('estado', ['PENDIENTE', 'PROCESANDO', 'EXTRAIDO'])
    .select('id')

  if (errUpd) {
    return NextResponse.json(
      { ok: false, error: errUpd.message },
      { status: 500 },
    )
  }
  if (!updated || (updated as unknown[]).length === 0) {
    return NextResponse.json({ ok: true, noop: true, motivo: 'estado_final_alcanzado' })
  }

  // Recién ahora borramos el temp — el procesador async ya tiene su buffer en
  // memoria si alcanzó a leerlo, y si no, va a recibir ENOENT y abortar por la
  // rama de cancelación.
  const ruta = (proc as any).ruta_temporal
  if (ruta && existsSync(ruta)) {
    try { await unlink(ruta) } catch (err) {
      logger.warn({ modulo: 'agente-pdf', mensaje: 'Error eliminando archivo temporal de PDF cancelado', contexto: { ruta, error: String(err) } })
    }
  }

  return NextResponse.json({ ok: true })
}
