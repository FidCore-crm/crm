import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { encolarJob } from '@/lib/importacion/job-runner'
import { chequearCatalogosFaltantes } from '@/lib/importacion/chequeo-catalogos'
import { logger } from '@/lib/errores/logger'
import { checkLicenciaActiva } from '@/lib/licencia-guard'

export const dynamic = 'force-dynamic'

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

  if (impRow.estado_proceso !== 'ANALIZADO') {
    return NextResponse.json(
      { ok: false, error: 'Solo se puede procesar una importación en estado ANALIZADO' },
      { status: 400 }
    )
  }

  // Chequeo bloqueante de catálogos: si el archivo trae valores de compañía,
  // ramo, cobertura, refacturación o tipo de vigencia que no existen en el
  // CRM, cortamos acá y le pedimos al PAS que configure los catálogos antes
  // de importar (evita que queden campos en blanco porque diferentes
  // compañías nombran lo mismo de formas distintas).
  try {
    const faltantes = await chequearCatalogosFaltantes(id)
    if (faltantes.total > 0) {
      return NextResponse.json(
        {
          ok: false,
          motivo: 'CATALOGOS_FALTANTES',
          error:
            'Hay valores del archivo que no están en los catálogos del CRM. Configurá los catálogos antes de importar.',
          faltantes,
        },
        { status: 409 },
      )
    }
  } catch (err) {
    logger.warn({
      modulo: 'importar',
      mensaje: 'Error chequeando catálogos faltantes antes de /procesar',
      contexto: { importacion_id: id, error: String(err) },
    })
    // No bloqueamos por un error de lectura — si el archivo está corrupto,
    // el procesamiento de lotes generará los dudosos como siempre.
  }

  const { data: lotes, error: errLotes } = await supabase
    .from('importacion_lotes')
    .select('id, estado')
    .eq('importacion_id', id)

  if (errLotes) {
    return NextResponse.json({ ok: false, error: errLotes.message }, { status: 500 })
  }

  type LoteRow = { id: string; estado: string }
  let encolados = 0
  for (const lote of ((lotes ?? []) as LoteRow[])) {
    if (lote.estado === 'PENDIENTE') {
      await encolarJob({
        importacion_id: id,
        tipo: 'PROCESAMIENTO_LOTE',
        payload: { lote_id: lote.id },
      })
      encolados++
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('importaciones') as any)
    .update({ estado_proceso: 'IMPORTANDO' })
    .eq('id', id)

  // Trigger inmediato del runner (fire-and-forget). El runner systemd podría
  // no estar instalado; este trigger asegura que el procesamiento arranque ya.
  try {
    const { ejecutarJobsPendientes } = await import('@/lib/importacion/job-runner')
    ejecutarJobsPendientes().catch((err) => {
      logger.warn({ modulo: 'importar', mensaje: 'Error ejecutando jobs pendientes tras /procesar', contexto: { importacion_id: id, error: String(err) } })
    })
  } catch (err) {
    logger.warn({ modulo: 'importar', mensaje: 'Error disparando runner tras /procesar', contexto: { importacion_id: id, error: String(err) } })
  }

  return NextResponse.json({ ok: true, lotes_encolados: encolados })
}
