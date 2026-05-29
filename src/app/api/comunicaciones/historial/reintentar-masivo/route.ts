/**
 * POST /api/comunicaciones/historial/reintentar-masivo
 *
 * Reintenta TODOS los emails FALLIDOS que matcheen los filtros, creando un
 * registro nuevo ENCOLADO por cada uno (no se reusa el row viejo — ambos
 * intentos quedan en el historial).
 *
 * Body opcional:
 *   { desde?: 'YYYY-MM-DD', hasta?: 'YYYY-MM-DD', tipo_envio?: string,
 *     solo_transitorios?: boolean }
 *
 * Sin body = reintentar TODOS los FALLIDOS sin filtro.
 *
 * Devuelve:
 *   { ok: true, encolados: N, omitidos: N }
 */

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { logger } from '@/lib/errores/logger'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  let body: any = {}
  try {
    body = await request.json()
  } catch {
    // body vacío es válido
  }

  const supabase = getSupabaseAdmin()

  let q = supabase
    .from('email_envios')
    .select('*')
    .eq('estado', 'FALLIDO')
    .order('fecha_creacion', { ascending: true })

  if (body.desde) q = q.gte('fecha_creacion', body.desde)
  if (body.hasta) q = q.lte('fecha_creacion', body.hasta + 'T23:59:59')
  if (body.tipo_envio) q = q.eq('tipo_envio', body.tipo_envio)
  if (body.solo_transitorios) q = q.eq('error_tipo', 'TRANSITORIO')

  const { data: fallidos, error } = await q.limit(500)
  if (error) {
    return NextResponse.json({ ok: false, error: 'Error al consultar fallidos' }, { status: 500 })
  }

  if (!fallidos || fallidos.length === 0) {
    return NextResponse.json({ ok: true, encolados: 0, omitidos: 0 })
  }

  let encolados = 0
  let omitidos = 0
  const ahora = new Date().toISOString()
  for (const row of fallidos as any[]) {
    // Crear un nuevo registro ENCOLADO basado en el FALLIDO, reseteando
    // intentos y backoff para que el cron lo procese inmediatamente.
    const nuevoEnvio: any = {
      plantilla_codigo: row.plantilla_codigo,
      destinatario_email: row.destinatario_email,
      destinatario_nombre: row.destinatario_nombre,
      persona_id: row.persona_id,
      poliza_id: row.poliza_id,
      tipo_envio: row.tipo_envio,
      enviado_por_usuario_id: auth.id,
      variables_usadas: row.variables_usadas,
      archivos_adjuntos: row.archivos_adjuntos,
      estado: 'ENCOLADO',
      prioridad: row.prioridad,
      enviar_despues_de: ahora,
      intentos: 0,
      proximo_intento_en: null,
      error_tipo: null,
      asunto_override: row.asunto_override,
      token_tracking: crypto.randomUUID(),
    }

    const { error: insertErr } = await (supabase.from('email_envios') as any).insert(nuevoEnvio)
    if (insertErr) {
      omitidos++
      logger.warn({
        modulo: 'comunicaciones',
        mensaje: 'No se pudo reencolar email fallido',
        contexto: { envio_id_origen: row.id, error: insertErr.message },
      })
    } else {
      encolados++
    }
  }

  return NextResponse.json({ ok: true, encolados, omitidos, total_fallidos: fallidos.length })
}
