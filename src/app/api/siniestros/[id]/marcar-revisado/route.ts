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
 * Marca un siniestro denunciado desde el portal del cliente como "revisado por
 * el PAS". Quita la alerta visible (badge, banner, barra global).
 *
 * Solo aplicable cuando `origen_creacion='PORTAL_CLIENTE'`. Para siniestros
 * cargados manualmente por el PAS no hace falta — ya nacen como revisados.
 *
 * Idempotente: si ya está revisado, devuelve ok sin tocar nada.
 */
export const POST = manejarErrores(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params

  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)
  await requireLicenciaActiva()

  const supabase = getSupabaseAdmin()

  const { data: siniestro, error } = await supabase
    .from('siniestros')
    .select('id, persona_id, origen_creacion, revisado_por_pas, deleted_at')
    .eq('id', id)
    .single()

  if (error || !siniestro) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)
  if ((siniestro as any).deleted_at) {
    return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
      detalle: 'El siniestro está en la papelera',
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

  // Idempotente: si ya estaba revisado, no hacer nada.
  if ((siniestro as any).revisado_por_pas === true) {
    return respuestaExito({ ya_estaba_revisado: true })
  }

  const ahora = new Date().toISOString()
  const { error: errUpdate } = await supabase
    .from('siniestros')
    .update({
      revisado_por_pas: true,
      fecha_revision: ahora,
      revisado_por_usuario_id: usuario.id,
    } as any)
    .eq('id', id)

  if (errUpdate) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: errUpdate.message,
      contexto: { tabla: 'siniestros', operacion: 'marcar-revisado', id },
    })
  }

  await registrarEventoBitacoraSiniestro(supabase, {
    siniestro_id: id,
    tipo: 'NOTA',
    texto: 'El PAS marcó la denuncia del portal como revisada.',
    usuario_id: usuario.id,
  })

  return respuestaExito({ revisado: true })
}, { modulo: 'siniestros' })
