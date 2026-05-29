/**
 * POST /api/comunicaciones/audiencias/preview-adhoc
 *
 * Preview en vivo de una audiencia que TODAVÍA NO SE GUARDÓ (caso: el admin
 * está creando/editando una audiencia y quiere ver cuántas personas cumplen
 * los filtros antes de presionar "Guardar").
 *
 * Body: { tipo: 'FILTRO'|'MANUAL', filtro_jsonb?, ids_personas? }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { aplicarFiltroAudiencia } from '@/lib/mailings/audiencia-filtros'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }) }

  const supabase = getSupabaseAdmin()

  try {
    if (body.tipo === 'MANUAL') {
      const ids = (body.ids_personas ?? []) as string[]
      if (ids.length === 0) {
        return NextResponse.json({ ok: true, total: 0, ids: [], muestra: [] })
      }
      const { data: personas } = await supabase
        .from('personas')
        .select('id, nombre, apellido, razon_social, email, acepta_marketing')
        .in('id', ids)
        .is('deleted_at', null)
      const lista = (personas ?? []) as any[]
      return NextResponse.json({
        ok: true,
        total: lista.length,
        ids: lista.map(p => p.id),
        muestra: lista.slice(0, 10).map(p => ({
          id: p.id, nombre: p.nombre, apellido: p.apellido,
          razon_social: p.razon_social, email: p.email,
          acepta_marketing: !!p.acepta_marketing,
        })),
      })
    }

    if (body.tipo === 'FILTRO') {
      const resultado = await aplicarFiltroAudiencia(supabase, body.filtro_jsonb ?? {})
      return NextResponse.json({ ok: true, ...resultado })
    }

    return NextResponse.json({ ok: false, error: 'Tipo inválido' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? 'Error aplicando filtro' }, { status: 500 })
  }
}
