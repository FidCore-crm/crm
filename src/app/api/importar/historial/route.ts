import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { aplicarFiltroCartera } from '@/lib/cartera-filter'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const url = new URL(request.url)
  const estado_proceso = url.searchParams.get('estado_proceso')
  // alias `estado`: COMPLETADA/FALLIDA/CANCELADA directos, EN_PROCESO agrupa IMPORTANDO/ANALIZANDO/REVISANDO
  const estadoAlias = url.searchParams.get('estado')
  const tipo = url.searchParams.get('tipo')
  const desde = url.searchParams.get('desde') || url.searchParams.get('fecha_desde')
  const hasta = url.searchParams.get('hasta') || url.searchParams.get('fecha_hasta')
  const busqueda = url.searchParams.get('busqueda')
  const usuarioIdParam = url.searchParams.get('usuario_id')
  const clientesCreadosGt = url.searchParams.get('clientes_creados_gt')
  const polizasCreadasGt = url.searchParams.get('polizas_creadas_gt')
  const pagina = Math.max(1, parseInt(url.searchParams.get('pagina') || '1', 10))
  const por_pagina = Math.min(100, Math.max(1, parseInt(url.searchParams.get('por_pagina') || '25', 10)))
  const rangoDesde = (pagina - 1) * por_pagina
  const rangoHasta = rangoDesde + por_pagina - 1

  const supabase = getSupabaseAdmin()
  let q = supabase
    .from('importaciones')
    .select(
      'id, usuario_id, tipo, compania_id, nombre_archivo, estado_proceso, estadisticas, archivos_metadata, fecha_inicio, fecha_fin, notas, deshecha, clientes_creados, polizas_creadas, errores, total_filas, created_at',
      { count: 'exact' }
    )

  if (estado_proceso) q = q.eq('estado_proceso', estado_proceso)
  if (estadoAlias) {
    if (estadoAlias === 'EN_PROCESO') {
      q = q.in('estado_proceso', [
        'PENDIENTE',
        'ANALIZANDO',
        'ANALIZADO',
        'REVISANDO',
        'IMPORTANDO',
      ])
    } else if (estadoAlias !== 'TODAS') {
      q = q.eq('estado_proceso', estadoAlias)
    }
  }
  if (tipo && tipo !== 'TODAS') q = q.eq('tipo', tipo)
  if (desde) q = q.gte('created_at', desde)
  if (hasta) q = q.lte('created_at', hasta)
  if (busqueda && busqueda.trim().length > 0) {
    const safe = busqueda.trim().replace(/[%,()]/g, ' ')
    q = q.or(`nombre_archivo.ilike.%${safe}%,notas.ilike.%${safe}%`)
  }
  if (clientesCreadosGt) q = q.gt('clientes_creados', parseInt(clientesCreadosGt, 10) || 0)
  if (polizasCreadasGt) q = q.gt('polizas_creadas', parseInt(polizasCreadasGt, 10) || 0)

  // usuario_id: solo admin o acceso TOTAL puede filtrar por otro usuario.
  // Un usuario PROPIA solo puede filtrar por su propio id — cualquier otro valor se ignora.
  if (usuarioIdParam) {
    const esPrivilegiado = usuario.rol === 'ADMIN' || usuario.acceso_cartera === 'TOTAL'
    if (esPrivilegiado || usuarioIdParam === usuario.id) {
      q = q.eq('usuario_id', usuarioIdParam)
    }
  }

  q = aplicarFiltroCartera(q, usuario)

  q = q.order('created_at', { ascending: false }).range(rangoDesde, rangoHasta)

  const { data, count, error } = await q
  if (error) {
    return NextResponse.json({ ok: false, error: 'Error al obtener los datos' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    data: data ?? [],
    total: count ?? 0,
    pagina,
    por_pagina,
  })
}
