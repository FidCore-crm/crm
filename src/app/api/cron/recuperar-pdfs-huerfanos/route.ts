// ============================================================
// Cron — recupera procesamientos de PDF huérfanos
// ============================================================
//
// El módulo del agente IA de PDFs dispara `procesarPDFAsync` como
// fire-and-forget dentro del proceso Next.js. Si el server se
// reinicia mientras un procesamiento está en vuelo, la fila queda
// colgada en PROCESANDO o PENDIENTE para siempre.
//
// Este cron corre periódicamente y:
//   - marca FALLIDO todo PDF con estado PROCESANDO hace >30 min
//   - marca FALLIDO todo PDF con estado PENDIENTE hace >15 min
//     (debió haber saltado a PROCESANDO casi al toque; si no lo hizo,
//     el server se murió antes de la primera transición)
//
// Notifica al PAS y encola email al admin para cada uno.
// ============================================================

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { notificarPDF } from '@/lib/agente-pdf/notificaciones-helper'
import { encolarEmailSistema } from '@/lib/comunicaciones-sender'
import { logger } from '@/lib/errores'

export const dynamic = 'force-dynamic'

// Ventanas de gracia antes de considerar un PDF huérfano
const TIMEOUT_PROCESANDO_MIN = 30
const TIMEOUT_PENDIENTE_MIN = 15

interface ProcRow {
  id: string
  estado: string
  nombre_archivo: string | null
  tipo_operacion: string | null
  usuario_id: string | null
  updated_at: string | null
  created_at: string | null
}

export async function GET(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  try {
    const supabase = getSupabaseAdmin()
    const ahora = Date.now()

    // Traer los que podrían estar colgados
    const { data: candidatos, error } = await supabase
      .from('pdf_procesamientos')
      .select('id, estado, nombre_archivo, tipo_operacion, usuario_id, updated_at, created_at')
      .in('estado', ['PENDIENTE', 'PROCESANDO'])
      .limit(200)

    if (error) {
      logger.error({
        modulo: 'cron',
        mensaje: 'Error leyendo pdf_procesamientos para recuperación',
        contexto: { error: error.message },
      })
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    const rows = (candidatos || []) as ProcRow[]
    const recuperados: string[] = []

    for (const row of rows) {
      const timeoutMin =
        row.estado === 'PROCESANDO' ? TIMEOUT_PROCESANDO_MIN : TIMEOUT_PENDIENTE_MIN
      const timeoutMs = timeoutMin * 60 * 1000
      const referencia = row.updated_at || row.created_at
      if (!referencia) continue
      const edadMs = ahora - new Date(referencia).getTime()
      if (edadMs < timeoutMs) continue

      const mensaje = `Procesamiento abandonado tras ${timeoutMin} min en estado ${row.estado} (probable reinicio del servidor)`

      // Update con filtro defensivo: si alguien lo movió de estado entre la
      // lectura y este update, no lo pisamos.
      const { data: updated, error: errUpd } = await (supabase
        .from('pdf_procesamientos') as any)
        .update({ estado: 'FALLIDO', error_mensaje: mensaje })
        .eq('id', row.id)
        .in('estado', ['PENDIENTE', 'PROCESANDO'])
        .select('id')

      if (errUpd) {
        logger.warn({
          modulo: 'cron',
          mensaje: 'No se pudo marcar PDF huérfano como FALLIDO',
          contexto: { procesamiento_id: row.id, error: errUpd.message },
        })
        continue
      }
      if (!updated || (updated as unknown[]).length === 0) {
        // Otro proceso ya lo movió de estado; skip silencioso
        continue
      }

      recuperados.push(row.id)

      // Notificación in-app al PAS
      try {
        await notificarPDF({
          procesamiento_id: row.id,
          tipo: 'PDF_FALLIDO',
          titulo: 'El procesamiento del PDF se abandonó',
          mensaje: `El PDF "${row.nombre_archivo || 'archivo'}" quedó huérfano tras un reinicio del servidor y se marcó como fallido. Podés volver a cargarlo.`,
          usuario_id: row.usuario_id,
          prioridad: 'ADVERTENCIA',
        })
      } catch (err) {
        logger.warn({
          modulo: 'cron',
          mensaje: 'No se pudo notificar al PAS sobre PDF huérfano',
          contexto: { procesamiento_id: row.id, error: String(err) },
        })
      }

      // Email de sistema al admin (informativo — solo se envía si el toggle
      // de eventos informativos está activo)
      try {
        await encolarEmailSistema({
          tipo_evento: 'PDF_FALLIDO',
          variables_extra: {
            nombre_pdf: row.nombre_archivo || 'archivo',
            tipo_operacion: row.tipo_operacion || 'desconocido',
            error_mensaje: mensaje,
          },
        })
      } catch (err) {
        logger.warn({
          modulo: 'cron',
          mensaje: 'No se pudo encolar email de sistema sobre PDF huérfano',
          contexto: { procesamiento_id: row.id, error: String(err) },
        })
      }
    }

    return NextResponse.json({
      ok: true,
      revisados: rows.length,
      recuperados: recuperados.length,
      ids: recuperados,
    })
  } catch (err: any) {
    logger.error({
      modulo: 'cron',
      mensaje: 'Error en cron recuperar-pdfs-huerfanos',
      contexto: { error: String(err) },
    })
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error desconocido' },
      { status: 500 },
    )
  }
}
