import type { Usuario } from '@/types/database'

/**
 * Verifica si el usuario es administrador
 */
export function esAdmin(usuario: { rol: string } | null): boolean {
  return usuario?.rol === 'ADMIN'
}

/**
 * Verifica si el usuario tiene acceso total a la cartera
 */
export function tieneAccesoTotal(usuario: { rol: string; acceso_cartera: string } | null): boolean {
  if (!usuario) return false
  return usuario.rol === 'ADMIN' || usuario.acceso_cartera === 'TOTAL'
}

/**
 * Verifica si el usuario puede eliminar registros (solo admin)
 */
export function puedeEliminar(usuario: { rol: string } | null): boolean {
  return usuario?.rol === 'ADMIN'
}

/**
 * Aplica filtro de cartera a una query de Supabase sobre tablas que tienen usuario_id directo
 * (personas, leads, oportunidades, cotizaciones, tareas).
 *
 * Reglas:
 *   - ADMIN o USUARIO con acceso_cartera=TOTAL → ve todo, sin filtro.
 *   - USUARIO con acceso_cartera=PROPIA → solo ve registros con usuario_id = él.
 *     Los huérfanos (usuario_id IS NULL) NO son visibles: pertenecen al pool
 *     del admin hasta que los asigne explícitamente.
 */
export function aplicarFiltroCartera<T>(
  query: T,
  usuario: { id: string; rol: string; acceso_cartera: string } | null
): T {
  if (!usuario) return query
  if (tieneAccesoTotal(usuario)) return query
  // @ts-ignore - Supabase query builder
  return query.eq('usuario_id', usuario.id)
}

/**
 * Obtiene los IDs de personas a las que el usuario tiene acceso.
 * Retorna null si tiene acceso total (no necesita filtrar).
 *
 * Para USUARIO con acceso_cartera=PROPIA: solo personas con usuario_id = él.
 * Los huérfanos (NULL) NO se incluyen — un admin tiene que asignarlos primero
 * desde /crm/configuracion/usuarios/asignar.
 *
 * Excluye personas en papelera (deleted_at IS NOT NULL): los registros
 * vinculados (pólizas/siniestros/tareas) de una persona soft-deleted no
 * deberían aparecer en KPIs, listados ni filtros de cartera. La purga
 * definitiva (a los 30 días) hace CASCADE de todo lo asociado.
 */
export async function obtenerIdsPersonas(
  supabase: any,
  usuario: { id: string; rol: string; acceso_cartera: string } | null
): Promise<string[] | null> {
  if (!usuario) return []
  if (tieneAccesoTotal(usuario)) return null // null = sin filtro

  const { data } = await supabase
    .from('personas')
    .select('id')
    .is('deleted_at', null)
    .eq('usuario_id', usuario.id)

  return (data ?? []).map((p: any) => p.id)
}

/**
 * Aplica filtro a queries de pólizas basándose en los IDs de personas del usuario.
 * Si idsPersonas es null, no filtra (acceso total).
 */
export function filtrarPorPersonas<T>(
  query: T,
  idsPersonas: string[] | null,
  campo: string = 'asegurado_id'
): T {
  if (idsPersonas === null) return query
  if (idsPersonas.length === 0) {
    // @ts-ignore
    return query.in(campo, ['00000000-0000-0000-0000-000000000000'])
  }
  // @ts-ignore
  return query.in(campo, idsPersonas)
}

/**
 * Devuelve los IDs de personas que están en la papelera (deleted_at IS NOT NULL).
 *
 * Se usa junto con `excluirPersonasEnPapelera` para listados que combinan
 * filtro de cartera por `usuario_id` con la necesidad de ocultar registros
 * cuyo cliente fue mandado a papelera (oportunidades, cotizaciones,
 * pipeline, embudo). Para tablas que cargan via `filtrarPorPersonas` con
 * `idsPersonas` venidos de `obtenerIdsPersonas`, este helper no es
 * necesario para usuarios PROPIA (la papelera ya está excluida), pero sí
 * para usuarios TOTAL (que reciben `idsPersonas = null`).
 *
 * Espera-se que la cantidad de personas en papelera sea baja (cron purga
 * a los 30 días), así que el costo de traer la lista completa es menor.
 */
export async function obtenerIdsPapelera(supabase: any): Promise<string[]> {
  const { data } = await supabase
    .from('personas')
    .select('id')
    .not('deleted_at', 'is', null)
  return (data ?? []).map((p: any) => p.id)
}

/**
 * Excluye registros cuyo `campo` (default `persona_id`) apunte a una persona
 * en papelera. Soporta columnas nullable: si el campo es NULL (ej: cotización
 * a lead, sin persona asociada), el registro pasa el filtro.
 *
 * Si `papeleraIds` está vacío, devuelve la query sin tocar.
 */
export function excluirPersonasEnPapelera<T>(
  query: T,
  papeleraIds: string[],
  campo: string = 'persona_id'
): T {
  if (papeleraIds.length === 0) return query
  // @ts-ignore
  return query.or(`${campo}.is.null,${campo}.not.in.(${papeleraIds.join(',')})`)
}
