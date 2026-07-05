/**
 * GET /api/comunicaciones/audiencias/[id]/preview
 *
 * Resuelve la audiencia (aplica el filtro si tipo=FILTRO o lee los ids si tipo=MANUAL)
 * y devuelve cantidad total + muestra de 10 destinatarios (personas y/o leads).
 *
 * Además actualiza `ultima_cantidad` y `ultimo_preview_en` en la audiencia (cache).
 *
 * Acepta también POST con body { filtro_jsonb, tipo, ids_personas, ids_leads } para
 * preview en vivo SIN guardar (caso: el admin está creando la audiencia y quiere ver
 * cuántos cumplen antes de guardarla).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { aplicarFiltroAudiencia } from '@/lib/mailings/audiencia-filtros'
import type { SupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Preview MANUAL — carga personas y leads en paralelo y arma muestra combinada
async function resolverManual(supabase: SupabaseClient, idsPersonas: string[], idsLeads: string[]) {
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

  return {
    total: personas.length + leads.length,
    ids: personas.map((p: any) => p.id),
    leads_ids: leads.map((l: any) => l.id),
    muestra: [...muestraPersonas, ...muestraLeads],
  }
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await ctx.params
  if (!UUID_REGEX.test(id)) return NextResponse.json({ ok: false, error: 'ID inválido' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const { data: aud, error: errAud } = await supabase
    .from('mailing_audiencias').select('*').eq('id', id).maybeSingle()
  if (errAud) return NextResponse.json({ ok: false, error: errAud.message }, { status: 500 })
  if (!aud) return NextResponse.json({ ok: false, error: 'No encontrada' }, { status: 404 })

  const a = aud as any
  let resultado
  try {
    if (a.tipo === 'MANUAL') {
      const idsPersonas = (a.ids_personas ?? []) as string[]
      const idsLeads = (a.ids_leads ?? []) as string[]
      resultado = await resolverManual(supabase, idsPersonas, idsLeads)
    } else {
      // FILTRO: aplicar criterios
      resultado = await aplicarFiltroAudiencia(supabase, a.filtro_jsonb ?? {})
    }
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? 'Error aplicando filtro' }, { status: 500 })
  }

  // Cachear cantidad y fecha del último preview (no crítico si falla)
  await (supabase.from('mailing_audiencias') as any)
    .update({
      ultima_cantidad: resultado.total,
      ultimo_preview_en: new Date().toISOString(),
    })
    .eq('id', id)

  return NextResponse.json({ ok: true, ...resultado })
}

// POST: preview en vivo sin guardar (durante creación/edición de audiencia)
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }) }

  const supabase = getSupabaseAdmin()
  try {
    let resultado
    if (body.tipo === 'MANUAL') {
      const idsPersonas = Array.isArray(body.ids_personas) ? body.ids_personas : []
      const idsLeads = Array.isArray(body.ids_leads) ? body.ids_leads : []
      resultado = await resolverManual(supabase, idsPersonas, idsLeads)
    } else if (body.tipo === 'FILTRO') {
      resultado = await aplicarFiltroAudiencia(supabase, body.filtro_jsonb ?? {})
    } else {
      return NextResponse.json({ ok: false, error: 'Tipo inválido' }, { status: 400 })
    }
    return NextResponse.json({ ok: true, ...resultado })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? 'Error aplicando filtro' }, { status: 500 })
  }
}
