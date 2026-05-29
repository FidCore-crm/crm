/**
 * GET /api/comunicaciones/audiencias/[id]/preview
 *
 * Resuelve la audiencia (aplica el filtro si tipo=FILTRO o lee los ids si tipo=MANUAL)
 * y devuelve cantidad total + muestra de 10 personas para que el admin valide.
 *
 * Además actualiza `ultima_cantidad` y `ultimo_preview_en` en la audiencia (cache).
 *
 * Acepta también POST con body { filtro_jsonb, tipo, ids_personas } para preview
 * en vivo SIN guardar (caso: el admin está creando la audiencia y quiere ver cuántos
 * cumplen antes de guardarla).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { aplicarFiltroAudiencia } from '@/lib/mailings/audiencia-filtros'

export const dynamic = 'force-dynamic'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
      // Lista fija: resolver personas a partir de los ids guardados
      const ids = (a.ids_personas ?? []) as string[]
      if (ids.length === 0) {
        resultado = { total: 0, ids: [], muestra: [] }
      } else {
        const { data: personas } = await supabase
          .from('personas')
          .select('id, nombre, apellido, razon_social, email, acepta_marketing')
          .in('id', ids)
          .is('deleted_at', null)
          .limit(ids.length)
        const lista = (personas ?? []) as any[]
        resultado = {
          total: lista.length,
          ids: lista.map(p => p.id),
          muestra: lista.slice(0, 10).map(p => ({
            id: p.id, nombre: p.nombre, apellido: p.apellido,
            razon_social: p.razon_social, email: p.email,
            acepta_marketing: !!p.acepta_marketing,
          })),
        }
      }
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
      const ids = (body.ids_personas ?? []) as string[]
      if (ids.length === 0) {
        resultado = { total: 0, ids: [], muestra: [] }
      } else {
        const { data: personas } = await supabase
          .from('personas')
          .select('id, nombre, apellido, razon_social, email, acepta_marketing')
          .in('id', ids)
          .is('deleted_at', null)
        const lista = (personas ?? []) as any[]
        resultado = {
          total: lista.length,
          ids: lista.map(p => p.id),
          muestra: lista.slice(0, 10).map(p => ({
            id: p.id, nombre: p.nombre, apellido: p.apellido,
            razon_social: p.razon_social, email: p.email,
            acepta_marketing: !!p.acepta_marketing,
          })),
        }
      }
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
