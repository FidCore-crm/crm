import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'

/**
 * GET /api/configuracion/correos/estado
 *
 * Versión "liviana" del GET de configuración SMTP. Cualquier usuario logueado
 * puede consultarla — solo devuelve si el sistema está listo para enviar
 * emails, sin exponer info técnica (host, puerto, usuario, etc.).
 *
 * La usan las fichas y la pantalla central de comunicaciones para decidir si
 * mostrar el botón "Email" habilitado o un tooltip "configurá SMTP".
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('configuracion_correos')
    .select('configurado, ultimo_test_exitoso')
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    ok: true,
    configurado: !!(data as any)?.configurado,
    test_exitoso: !!(data as any)?.ultimo_test_exitoso,
  })
}
