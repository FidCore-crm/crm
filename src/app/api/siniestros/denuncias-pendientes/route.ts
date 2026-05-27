import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import {
  ERRORES,
  manejarErrores,
  respuestaError,
  respuestaExito,
} from '@/lib/errores'
import { obtenerIdsPersonas, filtrarPorPersonas } from '@/lib/cartera-filter'

/**
 * Devuelve la cantidad de siniestros denunciados desde el portal del cliente
 * que el PAS todavía no marcó como revisados.
 *
 * Lo usa:
 *   - La barra global arriba del navbar (alerta de cabecera)
 *   - El badge del KPI en /crm/siniestros
 *
 * Respeta filtro de cartera: un usuario con acceso PROPIA solo cuenta sus
 * denuncias. Admin/TOTAL ve todas.
 *
 * Cuando ?incluir_listado=1, devuelve además los últimos N (default 5)
 * para previsualizar en un dropdown.
 */
export const GET = manejarErrores(async (request: NextRequest) => {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)

  const supabase = getSupabaseAdmin()
  const { searchParams } = new URL(request.url)
  const incluirListado = searchParams.get('incluir_listado') === '1'
  const limite = Math.min(parseInt(searchParams.get('limite') ?? '5', 10) || 5, 25)

  const idsPersonas = await obtenerIdsPersonas(supabase, usuario)

  // Conteo
  let qCount = supabase
    .from('siniestros')
    .select('id', { count: 'exact', head: true })
    .eq('origen_creacion', 'PORTAL_CLIENTE')
    .eq('revisado_por_pas', false)
    .is('deleted_at', null)
  qCount = filtrarPorPersonas(qCount, idsPersonas, 'persona_id')
  const { count } = await qCount

  if (!incluirListado) {
    return respuestaExito({ pendientes: count ?? 0 })
  }

  // Listado de los más recientes
  let qList = supabase
    .from('siniestros')
    .select(`
      id, numero_caso, created_at, fecha_denuncia, tipo_siniestro, descripcion,
      persona:personas!persona_id (id, apellido, nombre, razon_social),
      poliza:polizas!poliza_id (id, numero_poliza)
    `)
    .eq('origen_creacion', 'PORTAL_CLIENTE')
    .eq('revisado_por_pas', false)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limite)
  qList = filtrarPorPersonas(qList, idsPersonas, 'persona_id')
  const { data } = await qList

  return respuestaExito({ pendientes: count ?? 0, listado: data ?? [] })
}, { modulo: 'siniestros' })
