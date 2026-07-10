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
 * Body: {
 *   ids: string[];
 *   usuario_id: string | null;
 *   // Optimistic concurrency opcional (recomendado):
 *   if_match_map?: Record<string, string>;  // { persona_id: updated_at }
 *   force_overwrite?: boolean;              // fuerza aun con conflictos
 * }
 *  - usuario_id `null` → quita la asignación
 *  - usuario_id `string` → asigna ese usuario como dueño
 *
 * Con `if_match_map`, cada persona se actualiza con doble WHERE (id + updated_at).
 * Las que no matchean quedan como conflictos y NO se sobreescriben. El endpoint
 * devuelve `asignados` (efectivos), `conflictos` (ids que otro admin/proceso
 * cambió) y `omitidos` (por otros errores). El frontend puede refrescar y
 * reintentar solo los conflictos.
 *
 * Sin `if_match_map` mantiene el comportamiento anterior (bulk update — último
 * gana).
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
  const ifMatchMap: Record<string, string> | null =
    body.if_match_map && typeof body.if_match_map === 'object' && !body.force_overwrite
      ? body.if_match_map
      : null

  const supabase = getSupabaseAdmin()

  const asignadosEfectivos: string[] = []
  const conflictos: string[] = []
  const omitidos: Array<{ id: string; motivo: string }> = []

  if (ifMatchMap) {
    // Per-item UPDATE con doble WHERE (id + updated_at). Si el updated_at
    // cambió → la fila no matchea y sabemos que hubo conflicto.
    for (const id of ids) {
      const matchTs = ifMatchMap[id]
      if (!matchTs) {
        // El caller no mandó el updated_at para esta persona; la omitimos por
        // defensa — el patrón exige el map completo cuando se usa.
        omitidos.push({ id, motivo: 'sin updated_at de referencia' })
        continue
      }
      const { data, error } = await supabase
        .from('personas')
        .update({ usuario_id: nuevoUsuarioId })
        .eq('id', id)
        .eq('updated_at', matchTs)
        .select('id')
        .maybeSingle()

      if (error) {
        omitidos.push({ id, motivo: error.message })
        continue
      }
      if (!data) {
        // Ninguna fila matcheó — el updated_at cambió entre load y save.
        conflictos.push(id)
        continue
      }
      asignadosEfectivos.push(id)
    }
  } else {
    // Bulk update legacy (sin optimistic).
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
    asignadosEfectivos.push(...ids)
  }

  // Registrar bitácora solo para los efectivamente asignados.
  for (const id of asignadosEfectivos) {
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

  return respuestaExito({
    asignados: asignadosEfectivos.length,
    conflictos,
    omitidos,
  })
}, { modulo: 'personas' })
