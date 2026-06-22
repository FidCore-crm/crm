import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { encolarJob } from '@/lib/importacion/job-runner'
import { logger } from '@/lib/errores/logger'
import { checkLicenciaActiva } from '@/lib/licencia-guard'

export const dynamic = 'force-dynamic'

const ESTADOS_OK_PARA_CONFIRMAR = new Set(['REVISANDO', 'ANALIZADO'])

export async function POST(request: Request, context: { params: { id: string } }) {
  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth
  const { id } = context.params

  const supabase = getSupabaseAdmin()
  const { data: imp, error } = await supabase
    .from('importaciones')
    .select('id, usuario_id, estado_proceso')
    .eq('id', id)
    .maybeSingle()

  if (error || !imp) {
    return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 })
  }
  type ImpRow = { usuario_id: string; estado_proceso: string }
  const impRow = imp as ImpRow
  const own = requireOwnership(usuario, { usuario_id: impRow.usuario_id })
  if (own) return own

  if (!ESTADOS_OK_PARA_CONFIRMAR.has(impRow.estado_proceso)) {
    return NextResponse.json(
      { ok: false, error: 'La importación no está en un estado confirmable' },
      { status: 400 }
    )
  }

  const { count: pendientes } = await supabase
    .from('importacion_registros_dudosos')
    .select('id', { count: 'exact', head: true })
    .eq('importacion_id', id)
    .eq('estado_resolucion', 'PENDIENTE')

  if ((pendientes ?? 0) > 0) {
    return NextResponse.json(
      { ok: false, error: 'Hay registros dudosos sin resolver' },
      { status: 400 }
    )
  }

  try {
    await encolarJob({
      importacion_id: id,
      tipo: 'IMPORTACION_FINAL',
      payload: {},
      // 1 intento: el IMPORTACION_FINAL toca INSERTs. Si falla, los reintentos
      // automáticos pueden generar duplicados o estado inconsistente. Mejor
      // fallar rápido y que el PAS reanude manualmente si lo necesita.
      max_intentos: 1,
    })
  } catch (e) {
    const msg = (e as { message?: string })?.message || 'desconocido'
    return NextResponse.json(
      { ok: false, error: `No se pudo encolar el job: ${msg}` },
      { status: 500 }
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('importaciones') as any)
    .update({ estado_proceso: 'IMPORTANDO' })
    .eq('id', id)

  // Trigger sincrónico del runner. Esperamos hasta 60s a que termine el job
  // de IMPORTACION_FINAL — para importaciones chicas (< 200 registros) eso
  // alcanza y el PAS ve el resultado en la misma response. Para importaciones
  // grandes, devolvemos OK al cumplirse el timeout y el cron del host (cada
  // 30s) toma el job pendiente si quedó algo.
  try {
    const { ejecutarJobsPendientes } = await import('@/lib/importacion/job-runner')
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 60_000))
    await Promise.race([
      ejecutarJobsPendientes().catch((err) => {
        logger.warn({ modulo: 'importar', mensaje: 'Error ejecutando jobs pendientes tras /confirmar', contexto: { importacion_id: id, error: String(err) } })
      }),
      timeout,
    ])
  } catch (err) {
    logger.warn({ modulo: 'importar', mensaje: 'Error disparando runner tras /confirmar', contexto: { importacion_id: id, error: String(err) } })
  }

  return NextResponse.json({ ok: true, job_encolado: true })
}

export const maxDuration = 120
