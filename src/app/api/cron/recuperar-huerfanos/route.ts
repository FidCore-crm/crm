// ============================================================
// Cron — recupera procesos huérfanos (emails + jobs de importación)
// ============================================================
//
// Dos procesos del CRM transicionan a un estado "EJECUTANDO/ENVIANDO" antes
// de hacer trabajo bloqueante (SMTP, INSERTs masivos). Si Next.js o el
// container se reinicia mientras alguno está en vuelo, la fila queda
// permanentemente en ese estado intermedio y nada la rescata:
//
// 1. `email_envios`: row ENVIANDO sin nadie procesándolo → el email no sale.
//    Peor: `yaSeEnvioEmailAutomatico` cuenta ENVIANDO como "ya enviado" y el
//    anti-spam bloquea reintentos del mismo tipo.
//
// 2. `importacion_jobs`: row EJECUTANDO sin worker → la importación queda
//    en IMPORTANDO con datos parcialmente insertados. El deshacer exige
//    COMPLETADA y por endpoint no se puede ejecutar. Datos zombi.
//
// Este cron corre cada 4h junto al resto. Por cada caso:
//   - Si la edad > timeout configurado, lo movemos a un estado terminal
//     (FALLIDO para jobs, ENCOLADO o FALLIDO para emails según intentos).
//   - El UPDATE va con filtro defensivo (.in('estado', [...]))  para no
//     pisar transiciones legítimas que ocurran entre el SELECT y el UPDATE.
// ============================================================

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { logger } from '@/lib/errores'

export const dynamic = 'force-dynamic'

// Ventanas de gracia. Los SMTP timeout suele andar en 30-60s; importar lotes
// puede demorar varios minutos. Damos margen generoso para no abortar uno
// legítimamente en curso.
const TIMEOUT_EMAIL_ENVIANDO_MIN = 10
const TIMEOUT_JOB_EJECUTANDO_MIN = 30

// Cuántos intentos máximos antes de marcarlo FALLIDO definitivo (el resto
// vuelven a ENCOLADO/PENDIENTE para que el worker los retome).
const MAX_INTENTOS_EMAIL = 3
const MAX_INTENTOS_JOB = 3

interface EmailRow {
  id: string
  estado: string
  intentos: number | null
  fecha_envio: string | null
  fecha_creacion: string | null
  tipo_envio: string | null
  persona_id: string | null
}

interface JobRow {
  id: string
  tipo: string
  estado: string
  intentos: number | null
  importacion_id: string | null
  worker_id: string | null
  fecha_inicio: string | null
  fecha_creacion: string | null
}

async function recuperarEmailsHuerfanos(): Promise<{ revisados: number; recuperados: string[] }> {
  const supabase = getSupabaseAdmin()
  const ahora = Date.now()

  const { data, error } = await supabase
    .from('email_envios')
    .select('id, estado, intentos, fecha_envio, fecha_creacion, tipo_envio, persona_id')
    .eq('estado', 'ENVIANDO')
    .limit(500)

  if (error) {
    logger.error({
      modulo: 'cron',
      mensaje: 'Error leyendo email_envios huérfanos',
      contexto: { error: error.message },
    })
    return { revisados: 0, recuperados: [] }
  }

  const rows = (data || []) as EmailRow[]
  const recuperados: string[] = []
  const timeoutMs = TIMEOUT_EMAIL_ENVIANDO_MIN * 60 * 1000

  for (const row of rows) {
    const ref = row.fecha_envio || row.fecha_creacion
    if (!ref) continue
    const edadMs = ahora - new Date(ref).getTime()
    if (edadMs < timeoutMs) continue

    const intentos = row.intentos ?? 0
    const nuevoEstado = intentos >= MAX_INTENTOS_EMAIL ? 'FALLIDO' : 'ENCOLADO'
    const errorMsg = intentos >= MAX_INTENTOS_EMAIL
      ? `Email abandonado tras ${TIMEOUT_EMAIL_ENVIANDO_MIN} min en ENVIANDO y ${intentos} intentos; marcado FALLIDO definitivo`
      : `Email abandonado tras ${TIMEOUT_EMAIL_ENVIANDO_MIN} min en ENVIANDO (probable crash); vuelto a ENCOLADO`

    const updatePayload: Record<string, any> = {
      estado: nuevoEstado,
      error_mensaje: errorMsg,
    }
    if (nuevoEstado === 'ENCOLADO') {
      // Damos 30s de respiro antes de re-intentar para evitar loops si el
      // problema persiste (ej: SMTP caído).
      updatePayload.enviar_despues_de = new Date(Date.now() + 30_000).toISOString()
    }

    const { data: updated, error: errUpd } = await (supabase
      .from('email_envios') as any)
      .update(updatePayload)
      .eq('id', row.id)
      .eq('estado', 'ENVIANDO')
      .select('id')

    if (errUpd) {
      logger.warn({
        modulo: 'cron',
        mensaje: 'No se pudo recuperar email huérfano',
        contexto: { envio_id: row.id, error: errUpd.message },
      })
      continue
    }
    if (!updated || (updated as unknown[]).length === 0) continue
    recuperados.push(row.id)
  }

  return { revisados: rows.length, recuperados }
}

async function recuperarJobsHuerfanos(): Promise<{ revisados: number; recuperados: string[] }> {
  const supabase = getSupabaseAdmin()
  const ahora = Date.now()

  const { data, error } = await supabase
    .from('importacion_jobs')
    .select('id, tipo, estado, intentos, importacion_id, worker_id, fecha_inicio, fecha_creacion')
    .eq('estado', 'EJECUTANDO')
    .limit(200)

  if (error) {
    logger.error({
      modulo: 'cron',
      mensaje: 'Error leyendo importacion_jobs huérfanos',
      contexto: { error: error.message },
    })
    return { revisados: 0, recuperados: [] }
  }

  const rows = (data || []) as JobRow[]
  const recuperados: string[] = []
  const timeoutMs = TIMEOUT_JOB_EJECUTANDO_MIN * 60 * 1000

  for (const row of rows) {
    const ref = row.fecha_inicio || row.fecha_creacion
    if (!ref) continue
    const edadMs = ahora - new Date(ref).getTime()
    if (edadMs < timeoutMs) continue

    const intentos = row.intentos ?? 0
    const nuevoEstado = intentos >= MAX_INTENTOS_JOB ? 'FALLIDO' : 'PENDIENTE'
    const mensaje = intentos >= MAX_INTENTOS_JOB
      ? `Job abandonado tras ${TIMEOUT_JOB_EJECUTANDO_MIN} min en EJECUTANDO y ${intentos} intentos; marcado FALLIDO definitivo`
      : `Job abandonado tras ${TIMEOUT_JOB_EJECUTANDO_MIN} min en EJECUTANDO (probable crash); vuelto a PENDIENTE`

    const updatePayload: Record<string, any> = {
      estado: nuevoEstado,
      worker_id: null,
      error: mensaje,
    }

    const { data: updated, error: errUpd } = await (supabase
      .from('importacion_jobs') as any)
      .update(updatePayload)
      .eq('id', row.id)
      .eq('estado', 'EJECUTANDO')
      .select('id, importacion_id, tipo')

    if (errUpd) {
      logger.warn({
        modulo: 'cron',
        mensaje: 'No se pudo recuperar job huérfano',
        contexto: { job_id: row.id, error: errUpd.message },
      })
      continue
    }
    if (!updated || (updated as unknown[]).length === 0) continue
    recuperados.push(row.id)

    // Si era IMPORTACION_FINAL y queda FALLIDO definitivo, marcar la
    // importación como FALLIDA también para que el PAS pueda ver/operar.
    if (row.tipo === 'IMPORTACION_FINAL' && nuevoEstado === 'FALLIDO' && row.importacion_id) {
      try {
        await (supabase.from('importaciones') as any)
          .update({
            estado_proceso: 'FALLIDA',
            fecha_fin: new Date().toISOString(),
            notas: mensaje,
          })
          .eq('id', row.importacion_id)
          .eq('estado_proceso', 'IMPORTANDO')
      } catch (err) {
        logger.warn({
          modulo: 'cron',
          mensaje: 'No se pudo marcar importación FALLIDA tras rescatar job',
          contexto: { importacion_id: row.importacion_id, error: String(err) },
        })
      }
    }
  }

  return { revisados: rows.length, recuperados }
}

export async function GET(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  try {
    const [emails, jobs] = await Promise.all([
      recuperarEmailsHuerfanos(),
      recuperarJobsHuerfanos(),
    ])

    return NextResponse.json({
      ok: true,
      emails: {
        revisados: emails.revisados,
        recuperados: emails.recuperados.length,
      },
      jobs: {
        revisados: jobs.revisados,
        recuperados: jobs.recuperados.length,
      },
    })
  } catch (err: any) {
    logger.error({
      modulo: 'cron',
      mensaje: 'Error en cron recuperar-huerfanos',
      contexto: { error: String(err) },
    })
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error desconocido' },
      { status: 500 },
    )
  }
}
