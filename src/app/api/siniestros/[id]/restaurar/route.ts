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
import { registrarEventoBitacoraSiniestro } from '@/lib/bitacora-siniestro'
import { requireLicenciaActiva } from '@/lib/licencia-guard'

/**
 * Restaura un siniestro que está en la papelera (deleted_at != null).
 * Limpia deleted_at y deleted_by_usuario_id, y registra evento RESTAURACION
 * en la bitácora.
 */
export const POST = manejarErrores(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params

  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)
  if (usuario.rol !== 'ADMIN') return respuestaError(ERRORES.PERM_SIN_PERMISO)
  await requireLicenciaActiva()

  const supabase = getSupabaseAdmin()

  const { data: siniestro, error } = await supabase
    .from('siniestros')
    .select('id, persona_id, deleted_at, estado')
    .eq('id', id)
    .single()

  if (error || !siniestro) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  if (!(siniestro as any).deleted_at) {
    return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
      detalle: 'El siniestro no está en la papelera',
    })
  }

  // Filtro de cartera
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

  const { error: errUpdate } = await supabase
    .from('siniestros')
    .update({ deleted_at: null, deleted_by_usuario_id: null })
    .eq('id', id)

  if (errUpdate) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: errUpdate.message,
      contexto: { tabla: 'siniestros', operacion: 'restaurar', id },
    })
  }

  await registrarEventoBitacoraSiniestro(supabase, {
    siniestro_id: id,
    tipo: 'RESTAURACION',
    estado_nuevo: (siniestro as any).estado,
    usuario_id: usuario.id,
  })

  return respuestaExito({ restaurado: true })
}, { modulo: 'siniestros' })
