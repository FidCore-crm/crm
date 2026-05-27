/**
 * POST /api/importar/[id]/aplicar-comparacion
 *
 * Recibe las decisiones del PAS sobre cómo aplicar la importación incremental,
 * guarda esas decisiones en plan_importacion.aplicacion_incremental y encola
 * los jobs PROCESAMIENTO_LOTE pendientes (análogo a /procesar para INICIAL).
 */

import { NextResponse } from 'next/server';
import { requireAuth, requireOwnership } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { encolarJob } from '@/lib/importacion/job-runner';
import { logger } from '@/lib/errores/logger';
import { checkLicenciaActiva } from '@/lib/licencia-guard';
import type { PlanImportacion } from '@/lib/importacion/types';

export const dynamic = 'force-dynamic';

type ModoAplicacion = 'AUTOMATICO' | 'REVISAR_SOSPECHOSOS' | 'SOLO_NUEVOS';
type AccionNoEncontradas = 'NO_TOCAR' | 'MARCAR_BAJAS';

interface AplicarBody {
  modo_aplicacion?: ModoAplicacion;
  polizas_no_encontradas?: AccionNoEncontradas;
}

export async function POST(
  request: Request,
  context: { params: { id: string } }
) {
  const bloqueo = await checkLicenciaActiva();
  if (bloqueo) return bloqueo;
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const usuario = auth;
  const { id } = context.params;

  let body: AplicarBody;
  try {
    body = (await request.json()) as AplicarBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 });
  }

  const modo_aplicacion = body?.modo_aplicacion as ModoAplicacion;
  const polizas_no_encontradas = body?.polizas_no_encontradas as AccionNoEncontradas;

  const modosValidos: ModoAplicacion[] = ['AUTOMATICO', 'REVISAR_SOSPECHOSOS', 'SOLO_NUEVOS'];
  const accionesValidas: AccionNoEncontradas[] = ['NO_TOCAR', 'MARCAR_BAJAS'];
  if (!modosValidos.includes(modo_aplicacion)) {
    return NextResponse.json(
      { ok: false, error: 'modo_aplicacion inválido' },
      { status: 400 }
    );
  }
  if (!accionesValidas.includes(polizas_no_encontradas)) {
    return NextResponse.json(
      { ok: false, error: 'polizas_no_encontradas inválido' },
      { status: 400 }
    );
  }

  const supa = getSupabaseAdmin();
  const { data: imp, error } = await supa
    .from('importaciones')
    .select('id, usuario_id, estado_proceso, tipo, plan_importacion')
    .eq('id', id)
    .maybeSingle();

  if (error || !imp) {
    return NextResponse.json(
      { ok: false, error: 'Importación no encontrada' },
      { status: 404 }
    );
  }
  type ImpRow = {
    usuario_id: string;
    estado_proceso: string;
    tipo: string | null;
    plan_importacion: PlanImportacion | null;
  };
  const impRow = imp as ImpRow;

  const own = requireOwnership(usuario, { usuario_id: impRow.usuario_id });
  if (own) return own;

  if (impRow.tipo !== 'INCREMENTAL') {
    return NextResponse.json(
      { ok: false, error: 'Solo aplica a importaciones incrementales' },
      { status: 400 }
    );
  }
  if (impRow.estado_proceso !== 'ANALIZADO') {
    return NextResponse.json(
      { ok: false, error: 'La importación no está en estado ANALIZADO' },
      { status: 400 }
    );
  }

  // Guardar decisiones en plan_importacion.aplicacion_incremental
  const planActual = (impRow.plan_importacion ?? {}) as Record<string, unknown>;
  const planNuevo = {
    ...planActual,
    aplicacion_incremental: {
      modo_aplicacion,
      polizas_no_encontradas,
      decidido_en: new Date().toISOString(),
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supa.from('importaciones') as any)
    .update({ plan_importacion: planNuevo })
    .eq('id', id);

  // Encolar lotes pendientes
  const { data: lotes, error: errLotes } = await supa
    .from('importacion_lotes')
    .select('id, estado')
    .eq('importacion_id', id);

  if (errLotes) {
    return NextResponse.json({ ok: false, error: errLotes.message }, { status: 500 });
  }

  type LoteMinRow = { id: string; estado: string };
  let encolados = 0;
  for (const lote of ((lotes ?? []) as LoteMinRow[])) {
    if (lote.estado === 'PENDIENTE') {
      await encolarJob({
        importacion_id: id,
        tipo: 'PROCESAMIENTO_LOTE',
        payload: { lote_id: lote.id },
      });
      encolados++;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supa.from('importaciones') as any)
    .update({ estado_proceso: 'IMPORTANDO' })
    .eq('id', id);

  // Trigger inmediato del runner (fire-and-forget). El runner systemd podría no
  // estar instalado; este trigger asegura que los lotes arranquen de inmediato.
  try {
    const { ejecutarJobsPendientes } = await import('@/lib/importacion/job-runner');
    ejecutarJobsPendientes().catch((err) => {
      logger.warn({ modulo: 'importar', mensaje: 'Error ejecutando jobs pendientes tras /aplicar-comparacion', contexto: { importacion_id: id, error: String(err) } });
    });
  } catch (err) {
    logger.warn({ modulo: 'importar', mensaje: 'Error disparando runner tras /aplicar-comparacion', contexto: { importacion_id: id, error: String(err) } });
  }

  return NextResponse.json({ ok: true, lotes_encolados: encolados });
}
