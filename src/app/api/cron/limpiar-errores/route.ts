import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { logger } from '@/lib/errores'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/limpiar-errores
 *
 * Aplica la política de retención configurada para la tabla errores_sistema:
 *  - errores_retener_completo_dias (default 30): rows más viejos se archivan
 *    (se ponen en NULL stack_trace, request_body, request_headers, contexto_extra).
 *    La metadata (código, mensaje, módulo, contador) queda intacta para poder
 *    ver tendencias históricas sin pagar el costo de almacenar el detalle.
 *  - errores_retener_metadata_dias (default 90): rows más viejos se eliminan
 *    completamente.
 *
 * Protegido con CRON_SECRET. Se llama desde scripts/startup-crons.sh.
 */
export async function GET(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  const supabase = getSupabaseAdmin()

  const { data: config } = await supabase
    .from('configuracion_comunicaciones')
    .select('errores_retener_completo_dias, errores_retener_metadata_dias')
    .limit(1)
    .maybeSingle()

  const completoDias = (config as any)?.errores_retener_completo_dias ?? 30
  const metadataDias = (config as any)?.errores_retener_metadata_dias ?? 90

  const ahora = Date.now()
  const limiteCompleto = new Date(ahora - completoDias * 24 * 60 * 60 * 1000).toISOString()
  const limiteMetadata = new Date(ahora - metadataDias * 24 * 60 * 60 * 1000).toISOString()

  // Paso 1: archivar (borrar detalle pesado, conservar metadata)
  const { data: archivadosData, error: errArchivar } = await supabase
    .from('errores_sistema')
    .update({
      archivado: true,
      stack_trace: null,
      request_body: null,
      request_headers: null,
      contexto_extra: null,
    } as never)
    .lt('created_at', limiteCompleto)
    .eq('archivado', false)
    .select('id')

  const archivados = archivadosData?.length || 0

  // Paso 2: eliminar definitivamente
  const { data: eliminadosData, error: errEliminar } = await supabase
    .from('errores_sistema')
    .delete()
    .lt('created_at', limiteMetadata)
    .select('id')

  const eliminados = eliminadosData?.length || 0

  logger.info({
    modulo: 'cron-errores',
    mensaje: 'Limpieza de errores_sistema completada',
    archivados,
    eliminados,
    retener_completo_dias: completoDias,
    retener_metadata_dias: metadataDias,
  })

  return NextResponse.json({
    ok: !errArchivar && !errEliminar,
    archivados,
    eliminados,
    retener_completo_dias: completoDias,
    retener_metadata_dias: metadataDias,
    errores: [errArchivar?.message, errEliminar?.message].filter(Boolean),
  })
}
