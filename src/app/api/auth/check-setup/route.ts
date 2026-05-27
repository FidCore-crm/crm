import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { logger } from '@/lib/errores'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = getSupabaseAdmin()

    // Consultar usuarios_perfil (tabla nueva post-migración 055)
    // En lugar de usuarios (que va a desaparecer al cierre de la migración)
    const { data, error } = await supabase
      .from('usuarios_perfil')
      .select('id')
      .eq('activo', true)
      .limit(1)

    if (error) {
      logger.error({ modulo: 'auth', mensaje: 'Error al consultar usuarios en check-setup', contexto: { error: error.message } })
      return NextResponse.json({ needsSetup: false })
    }

    const hayUsuarios = data !== null && data.length > 0
    return NextResponse.json({ needsSetup: !hayUsuarios })
  } catch (err) {
    logger.error({ modulo: 'auth', mensaje: 'Error inesperado en check-setup', contexto: { error: String(err) } })
    return NextResponse.json({ needsSetup: false })
  }
}
