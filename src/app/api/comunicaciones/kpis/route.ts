import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { tieneAccesoTotal } from '@/lib/cartera-filter'

/**
 * GET /api/comunicaciones/kpis
 *
 * Devuelve los contadores agregados de la pantalla central de comunicaciones:
 *   - enviados_mes      : ENVIADO con fecha_envio en el mes en curso
 *   - aperturas_mes     : aperturas únicas (cantidad_aperturas > 0) sobre los enviados del mes
 *   - clicks_mes        : clicks únicos (cantidad_clicks > 0) sobre los enviados del mes
 *   - en_cola           : ENCOLADO + ENVIANDO ahora
 *   - fallidos_mes      : FALLIDO con fecha_creacion en el mes en curso
 *   - tasa_apertura     : (aperturas / enviados) * 100, redondeado
 *   - tasa_click        : (clicks / enviados) * 100, redondeado
 *
 * Respeta filtro de cartera para usuarios PROPIA: restringe por persona_id IN
 * (sus personas). Admin/TOTAL ve global.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const supabase = getSupabaseAdmin()

  // Restricción de cartera
  let idsPersonas: string[] | null = null
  if (!tieneAccesoTotal(usuario)) {
    const { data: pers } = await supabase
      .from('personas')
      .select('id')
      .eq('usuario_id', usuario.id)
    idsPersonas = (pers ?? []).map((p: any) => p.id)
    if (idsPersonas.length === 0) {
      return NextResponse.json({
        ok: true,
        kpis: {
          enviados_mes: 0, aperturas_mes: 0, clicks_mes: 0,
          en_cola: 0, fallidos_mes: 0, tasa_apertura: 0, tasa_click: 0,
        },
      })
    }
  }

  // Rango "este mes"
  const ahora = new Date()
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString()

  const conCartera = (q: any) => idsPersonas !== null ? q.in('persona_id', idsPersonas) : q

  // Queries en paralelo
  const [enviados, aperturas, clicks, enCola, fallidos] = await Promise.all([
    conCartera(supabase
      .from('email_envios')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'ENVIADO')
      .gte('fecha_envio', inicioMes)),
    conCartera(supabase
      .from('email_envios')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'ENVIADO')
      .gte('fecha_envio', inicioMes)
      .gt('cantidad_aperturas', 0)),
    conCartera(supabase
      .from('email_envios')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'ENVIADO')
      .gte('fecha_envio', inicioMes)
      .gt('cantidad_clicks', 0)),
    conCartera(supabase
      .from('email_envios')
      .select('id', { count: 'exact', head: true })
      .in('estado', ['ENCOLADO', 'ENVIANDO'])),
    conCartera(supabase
      .from('email_envios')
      .select('id', { count: 'exact', head: true })
      .eq('estado', 'FALLIDO')
      .gte('fecha_creacion', inicioMes)),
  ])

  const enviadosMes = enviados.count ?? 0
  const aperturasMes = aperturas.count ?? 0
  const clicksMes = clicks.count ?? 0

  return NextResponse.json({
    ok: true,
    kpis: {
      enviados_mes: enviadosMes,
      aperturas_mes: aperturasMes,
      clicks_mes: clicksMes,
      en_cola: enCola.count ?? 0,
      fallidos_mes: fallidos.count ?? 0,
      tasa_apertura: enviadosMes > 0 ? Math.round((aperturasMes / enviadosMes) * 100) : 0,
      tasa_click: enviadosMes > 0 ? Math.round((clicksMes / enviadosMes) * 100) : 0,
    },
  })
}
