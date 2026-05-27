import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import {
  ERRORES,
  ErrorAplicacion,
  manejarErrores,
  respuestaError,
  respuestaExito,
} from '@/lib/errores'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { requireLicenciaActiva } from '@/lib/licencia-guard'

/**
 * Agrega una nota libre a la bitácora del siniestro. Bloqueada por filtro
 * de cartera. La nota actualiza `fecha_ultimo_movimiento` del siniestro
 * para alimentar correctamente el cron de SINIESTRO_30/60_DIAS.
 *
 * Body: { texto: string } — máximo 5000 caracteres.
 */
export const POST = manejarErrores(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params

  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)

  await requireLicenciaActiva()

  const body = await request.json().catch(() => null)
  const texto = String(body?.texto ?? '').trim()
  if (!texto) {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
      campos: { texto: 'La nota no puede estar vacía' },
    })
  }
  if (texto.length > 5000) {
    return respuestaError(ERRORES.VALID_VALOR_FUERA_DE_RANGO, {
      campos: { texto: 'La nota es demasiado larga (máx 5000 caracteres)' },
    })
  }

  const supabase = getSupabaseAdmin()

  const { data: siniestro, error: errSel } = await supabase
    .from('siniestros')
    .select('id, persona_id, deleted_at')
    .eq('id', id)
    .is('deleted_at', null)
    .single()
  if (errSel || !siniestro) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  if (!tieneAccesoTotal(usuario)) {
    const { data: persona } = await supabase
      .from('personas')
      .select('usuario_id')
      .eq('id', (siniestro as any).persona_id)
      .single()
    if (persona && (persona as any).usuario_id && (persona as any).usuario_id !== usuario.id) {
      return respuestaError(ERRORES.PERM_RECURSO_AJENO)
    }
  }

  const { data: nota, error } = await supabase
    .from('siniestro_bitacora')
    .insert({
      siniestro_id: id,
      tipo: 'NOTA',
      texto,
      usuario_id: usuario.id,
    })
    .select('id, created_at')
    .single()

  if (error || !nota) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: error?.message,
      contexto: { tabla: 'siniestro_bitacora', operacion: 'insert' },
    })
  }

  // Actualizar fecha_ultimo_movimiento para el cron de notificaciones.
  await supabase
    .from('siniestros')
    .update({ fecha_ultimo_movimiento: new Date().toISOString() })
    .eq('id', id)

  return respuestaExito({ id: (nota as any).id, created_at: (nota as any).created_at })
}, { modulo: 'siniestros' })
