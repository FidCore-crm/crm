/**
 * GET  /api/comunicaciones/mailing-plantillas — lista activas (admin)
 * POST /api/comunicaciones/mailing-plantillas — crear (admin)
 *
 * Las mailing_plantillas son las plantillas PROPIAS del módulo Comunicaciones
 * que el PAS arma para sus mailings activos (promociones, avisos, campañas).
 * Conceptualmente separadas de `plantillas_email` (que son las 5 automáticas
 * del sistema editables desde Configuración).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  const incluirInactivas = request.nextUrl.searchParams.get('incluir_inactivas') === '1'

  const supabase = getSupabaseAdmin()
  let q = supabase
    .from('mailing_plantillas')
    .select('id, codigo, nombre, descripcion, asunto, saludo, cuerpo, cierre, cta_texto, cta_url, variables_disponibles, activa, created_at, updated_at')
    .order('updated_at', { ascending: false })

  if (!incluirInactivas) q = q.eq('activa', true)

  const { data, error } = await q

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, plantillas: data ?? [] })
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 }) }

  // Validaciones mínimas
  if (!body.nombre || typeof body.nombre !== 'string') {
    return NextResponse.json({ ok: false, error: 'Falta nombre' }, { status: 400 })
  }
  if (!body.asunto || !body.cuerpo) {
    return NextResponse.json({ ok: false, error: 'Falta asunto o cuerpo' }, { status: 400 })
  }

  // Generar codigo (slug) único a partir del nombre si no se pasa
  let codigo = (body.codigo || body.nombre)
    .toString()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
  if (!codigo) codigo = `plantilla_${Date.now()}`

  // Si ya existe, agregar sufijo numérico
  const supabase = getSupabaseAdmin()
  let codigoFinal = codigo
  let intento = 2
  while (true) {
    const { data: existe } = await supabase
      .from('mailing_plantillas').select('id').eq('codigo', codigoFinal).maybeSingle()
    if (!existe) break
    codigoFinal = `${codigo}_${intento}`
    intento += 1
    if (intento > 20) {
      codigoFinal = `${codigo}_${Date.now()}`
      break
    }
  }

  const { data, error } = await (supabase.from('mailing_plantillas') as any)
    .insert({
      codigo: codigoFinal,
      nombre: body.nombre,
      descripcion: body.descripcion ?? null,
      asunto: body.asunto,
      saludo: body.saludo ?? 'Hola {{nombre}}!',
      cuerpo: body.cuerpo,
      cierre: body.cierre ?? 'Saludos,\n{{organizacion_nombre}}',
      cta_texto: body.cta_texto ?? null,
      cta_url: body.cta_url ?? null,
      variables_disponibles: body.variables_disponibles ?? undefined,
      activa: body.activa ?? true,
      usuario_creador_id: auth.id,
    })
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, plantilla: data })
}
