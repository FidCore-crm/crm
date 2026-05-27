import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const supabase = getSupabaseAdmin()
  const { data: row } = await supabase
    .from('pdf_procesamientos')
    .select('id, tipo_operacion, poliza_origen_id, poliza_creada_id, endoso_creado_id, estado, nombre_archivo, tamano_archivo, datos_extraidos, mapeos_catalogos, campos_dudosos, tokens_usados, costo_estimado, error_mensaje, usuario_id, created_at, updated_at')
    .eq('id', id)
    .maybeSingle()

  if (!row) {
    return NextResponse.json({ ok: false, error: 'Procesamiento no encontrado' }, { status: 404 })
  }

  const owns = requireOwnership(auth, { usuario_id: (row as any).usuario_id })
  if (owns) return owns

  return NextResponse.json({ ok: true, procesamiento: row })
}
