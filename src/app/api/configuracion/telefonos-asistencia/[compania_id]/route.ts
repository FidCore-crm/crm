import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api-auth'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ compania_id: string }> }
) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  const { compania_id } = await params
  const supabase = getSupabaseAdmin()

  const { error } = await supabase
    .from('telefonos_asistencia_companias')
    .delete()
    .eq('compania_id', compania_id)

  if (error) {
    return NextResponse.json({ ok: false, error: 'Error al eliminar los datos' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
