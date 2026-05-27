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
import { registrarEventoBitacoraPersona } from '@/lib/bitacora-persona'
import { requireLicenciaActiva } from '@/lib/licencia-guard'

/**
 * Reasigna el `usuario_id` (dueño de cartera) de N personas en una sola
 * operación. Solo accesible para ADMIN.
 *
 * Body: { ids: string[]; usuario_id: string | null }
 *  - usuario_id `null` → quita la asignación
 *  - usuario_id `string` → asigna ese usuario como dueño
 */
export const POST = manejarErrores(async (request: NextRequest) => {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)
  if (usuario.rol !== 'ADMIN') return respuestaError(ERRORES.PERM_SIN_PERMISO)
  await requireLicenciaActiva()

  const body = await request.json().catch(() => null)
  if (!body || !Array.isArray(body.ids) || body.ids.length === 0) {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
      campos: { ids: 'Lista de personas requerida' },
    })
  }

  const ids: string[] = body.ids.filter((x: any) => typeof x === 'string')
  const nuevoUsuarioId: string | null = body.usuario_id ?? null

  const supabase = getSupabaseAdmin()

  const { error } = await supabase
    .from('personas')
    .update({ usuario_id: nuevoUsuarioId })
    .in('id', ids)

  if (error) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: error.message,
      contexto: { tabla: 'personas', operacion: 'asignar', ids: ids.length },
    })
  }

  // Registrar en la bitácora un evento EDICION para cada persona reasignada.
  // Es importante para auditoría — quién reasignó qué cliente.
  for (const id of ids) {
    await registrarEventoBitacoraPersona(supabase, {
      persona_id: id,
      tipo_evento: 'EDICION',
      campos_modificados: ['usuario_id'],
      observaciones: nuevoUsuarioId
        ? `Reasignado al usuario ${nuevoUsuarioId}`
        : 'Cartera quitada',
      usuario_id: usuario.id,
    })
  }

  return respuestaExito({ asignados: ids.length })
}, { modulo: 'personas' })
