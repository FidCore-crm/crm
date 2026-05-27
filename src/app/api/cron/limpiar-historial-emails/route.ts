import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { validarCronSecret } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/limpiar-historial-emails
 *
 * Aplica la política de retención configurada:
 *   - retener_completo_dias (default 90): emails más viejos se archivan
 *     (cuerpo_html, archivos_adjuntos, variables_usadas → NULL)
 *   - eliminar_despues_meses (default 12): emails más viejos se borran completos
 *
 * Notas:
 *   - `retener_metadata_meses` es informativo — entre [retener_completo_dias,
 *     eliminar_despues_meses] los registros ya están archivados y solo queda
 *     metadata. No se necesita un paso adicional.
 *   - email_clicks se borra en cascada al borrar email_envios.
 */
export async function GET(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  const supabase = getSupabaseAdmin()

  const { data: config } = await supabase
    .from('configuracion_comunicaciones')
    .select('retener_completo_dias, eliminar_despues_meses')
    .limit(1)
    .maybeSingle()

  const retenerDias = (config as any)?.retener_completo_dias ?? 90
  const eliminarMeses = (config as any)?.eliminar_despues_meses ?? 12

  // 1. Archivar (borrar contenido pesado)
  const limiteArchivar = new Date(Date.now() - retenerDias * 24 * 60 * 60 * 1000).toISOString()
  const { data: archivadosData, error: errArch } = await supabase
    .from('email_envios')
    .update({
      archivado: true,
      cuerpo_html: null,
      variables_usadas: null,
      archivos_adjuntos: null,
    })
    .lt('fecha_creacion', limiteArchivar)
    .eq('archivado', false)
    .select('id')

  const archivados = archivadosData?.length || 0

  // 2. Eliminar completos
  const limiteEliminar = new Date(Date.now() - eliminarMeses * 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: eliminadosData, error: errEl } = await supabase
    .from('email_envios')
    .delete()
    .lt('fecha_creacion', limiteEliminar)
    .select('id')

  const eliminados = eliminadosData?.length || 0

  return NextResponse.json({
    ok: !errArch && !errEl,
    archivados,
    eliminados,
    retener_completo_dias: retenerDias,
    eliminar_despues_meses: eliminarMeses,
    errores: [errArch?.message, errEl?.message].filter(Boolean),
  })
}
