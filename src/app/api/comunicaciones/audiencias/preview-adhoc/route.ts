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
      const idsPersonas = Array.isArray(body.ids_personas) ? body.ids_personas : []
      const idsLeads = Array.isArray(body.ids_leads) ? body.ids_leads : []

      const [personasData, leadsData] = await Promise.all([
        idsPersonas.length > 0
          ? supabase
              .from('personas')
              .select('id, nombre, apellido, razon_social, email, acepta_marketing')
              .in('id', idsPersonas)
              .is('deleted_at', null)
          : Promise.resolve({ data: [] }),
        idsLeads.length > 0
          ? supabase
              .from('leads')
              .select('id, nombre, apellido, email, estado, motivo_descarte')
              .in('id', idsLeads)
          : Promise.resolve({ data: [] }),
      ])
      const personas = (personasData.data ?? []) as any[]
      const leads = (leadsData.data ?? []) as any[]

      const muestraPersonas = personas.slice(0, 10).map((p: any) => ({
        id: p.id, tipo: 'persona', nombre: p.nombre, apellido: p.apellido,
        razon_social: p.razon_social, email: p.email,
        acepta_marketing: !!p.acepta_marketing,
      }))
      const cupo = Math.max(0, 10 - muestraPersonas.length)
      const muestraLeads = leads.slice(0, cupo).map((l: any) => ({
        id: l.id, tipo: 'lead', nombre: l.nombre, apellido: l.apellido,
        razon_social: null, email: l.email,
        acepta_marketing: true,
        estado_lead: l.estado, motivo_descarte: l.motivo_descarte,
      }))

      return NextResponse.json({
        ok: true,
        total: personas.length + leads.length,
        ids: personas.map((p: any) => p.id),
        leads_ids: leads.map((l: any) => l.id),
        muestra: [...muestraPersonas, ...muestraLeads],
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
