import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { tieneAccesoTotal } from '@/lib/cartera-filter'

/**
 * GET /api/comunicaciones/historial
 *
 * Query params:
 *   - persona_id | poliza_id : filtro opcional. Si no se pasa ninguno,
 *     devuelve el historial GLOBAL (respetando cartera).
 *   - estado : ENVIADO/FALLIDO/... filtro opcional
 *   - tipo : AUTOMATICO_BIENVENIDA/etc
 *   - busqueda : búsqueda parcial en destinatario_email/destinatario_nombre/asunto
 *   - incluir_archivados : "true" para mostrar los viejos archivados
 *   - page, page_size : paginación
 *
 * Respeta filtro de cartera: usuarios PROPIA solo ven emails de sus personas
 * (también en modo global — se restringe via persona_id IN (...)).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const sp = request.nextUrl.searchParams
  const personaId = sp.get('persona_id') || undefined
  const polizaId = sp.get('poliza_id') || undefined
  const estado = sp.get('estado') || undefined
  const tipo = sp.get('tipo') || undefined
  const busqueda = (sp.get('busqueda') || '').trim()
  const incluirArchivados = sp.get('incluir_archivados') === 'true'
  const page = Math.max(1, parseInt(sp.get('page') || '1'))
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('page_size') || '25')))

  const supabase = getSupabaseAdmin()

  // Verificar acceso de cartera si es PROPIA. Sin entidad explícita,
  // restringimos por persona_id IN (mis personas).
  let idsPersonasPropias: string[] | null = null
  if (!tieneAccesoTotal(usuario)) {
    if (polizaId) {
      const { data: poli } = await supabase
        .from('polizas')
        .select('asegurado_id, personas!asegurado_id(usuario_id)')
        .eq('id', polizaId)
        .maybeSingle()
      const ownerId = (poli as any)?.personas?.usuario_id ?? null
      if (ownerId !== null && ownerId !== usuario.id) {
        return NextResponse.json({ ok: false, error: 'Sin acceso' }, { status: 403 })
      }
    } else if (personaId) {
      const { data: per } = await supabase
        .from('personas')
        .select('usuario_id')
        .eq('id', personaId)
        .maybeSingle()
      const ownerId = (per as any)?.usuario_id ?? null
      if (ownerId !== null && ownerId !== usuario.id) {
        return NextResponse.json({ ok: false, error: 'Sin acceso' }, { status: 403 })
      }
    } else {
      // Historial global: traer los IDs de personas del usuario
      const { data: pers } = await supabase
        .from('personas')
        .select('id')
        .eq('usuario_id', usuario.id)
      idsPersonasPropias = (pers ?? []).map((p: any) => p.id)
    }
  }

  let query = supabase
    .from('email_envios')
    .select(
      'id, plantilla_codigo, destinatario_email, destinatario_nombre, asunto, tipo_envio, estado, error_mensaje, fecha_creacion, fecha_envio, fecha_apertura, cantidad_aperturas, cantidad_clicks, fecha_primer_click, archivado, poliza_id, persona_id, archivos_adjuntos',
      { count: 'exact' },
    )

  if (polizaId) query = query.eq('poliza_id', polizaId)
  else if (personaId) query = query.eq('persona_id', personaId)
  else if (idsPersonasPropias !== null) {
    if (idsPersonasPropias.length === 0) {
      return NextResponse.json({
        ok: true, envios: [], total: 0, page, page_size: pageSize, total_paginas: 0,
      })
    }
    query = query.in('persona_id', idsPersonasPropias)
  }

  if (estado) query = query.eq('estado', estado)
  if (tipo) query = query.eq('tipo_envio', tipo)
  if (!incluirArchivados) query = query.eq('archivado', false)
  if (busqueda) {
    // ILIKE en destinatario_email | destinatario_nombre | asunto
    const safe = busqueda.replace(/[%_,()]/g, '')
    query = query.or(
      `destinatario_email.ilike.%${safe}%,destinatario_nombre.ilike.%${safe}%,asunto.ilike.%${safe}%`,
    )
  }

  query = query.order('fecha_creacion', { ascending: false })
  query = query.range((page - 1) * pageSize, page * pageSize - 1)

  const { data, count, error } = await query
  if (error) {
    return NextResponse.json({ ok: false, error: 'Error al obtener los datos' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    envios: data ?? [],
    total: count ?? 0,
    page,
    page_size: pageSize,
    total_paginas: Math.ceil((count ?? 0) / pageSize),
  })
}
