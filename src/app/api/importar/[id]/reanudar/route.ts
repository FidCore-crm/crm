import { NextResponse } from 'next/server';
import { requireAuth, requireOwnership } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isAnthropicConfigured } from '@/lib/anthropic-client';
import { logger } from '@/lib/errores';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const usuario = auth;

  const supa = getSupabaseAdmin();
  const { data: imp, error } = await supa
    .from('importaciones')
    .select('id, usuario_id, estado_proceso')
    .eq('id', params.id)
    .maybeSingle();

  if (error || !imp) {
    return NextResponse.json(
      { ok: false, error: 'Importación no encontrada' },
      { status: 404 }
    );
  }

  type ImpRow = { usuario_id: string; estado_proceso: string };
  const impRow = imp as ImpRow;

  const own = requireOwnership(usuario, {
    usuario_id: impRow.usuario_id,
  });
  if (own) return own;

  if (impRow.estado_proceso !== 'PAUSADA') {
    return NextResponse.json(
      {
        ok: false,
        error: `No se puede reanudar desde el estado ${impRow.estado_proceso}`,
      },
      { status: 400 }
    );
  }

  if (!(await isAnthropicConfigured())) {
    return NextResponse.json(
      { ok: false, error: 'La API key de Claude no está configurada.' },
      { status: 400 }
    );
  }

  // Buscar jobs FALLIDO de esta importación con error relacionado a API/quota
  const { data: jobs } = await supa
    .from('importacion_jobs')
    .select('id, error')
    .eq('importacion_id', params.id)
    .eq('estado', 'FALLIDO');

  type JobFallidoRow = { id: string; error: string | null };
  const jobsRows = (jobs || []) as JobFallidoRow[];
  const jobsReactivables = jobsRows.filter((j) => {
    const err = (j.error || '').toLowerCase();
    return (
      err.includes('quota') ||
      err.includes('insufficient') ||
      err.includes('rate') ||
      err.includes('429') ||
      err.includes('api')
    );
  });

  // Si no hay específicos, reactivar todos los FALLIDO (criterio amplio)
  const aReactivar =
    jobsReactivables.length > 0 ? jobsReactivables : jobsRows;

  if (aReactivar.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supa.from('importacion_jobs') as any)
      .update({
        estado: 'PENDIENTE',
        intentos: 0,
        error: null,
        worker_id: null,
      })
      .in(
        'id',
        aReactivar.map((j) => j.id)
      );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supa.from('importaciones') as any)
    .update({ estado_proceso: 'IMPORTANDO', notas: null })
    .eq('id', params.id);

  // Trigger inmediato del runner (fire-and-forget)
  try {
    const { ejecutarJobsPendientes } = await import(
      '@/lib/importacion/job-runner'
    );
    ejecutarJobsPendientes().catch((err) => {
      // Fire-and-forget: el cron ejecuta los jobs igual si este trigger falla
      logger.warn({ modulo: 'importar', mensaje: 'Error ejecutando jobs pendientes fire-and-forget', contexto: { importacion_id: params.id, error: String(err) } });
    });
  } catch (err) {
    // No crítico: el runner se ejecutará por el cron de todas formas
    logger.warn({ modulo: 'importar', mensaje: 'Error disparando runner fire-and-forget tras reanudar importación', contexto: { importacion_id: params.id, error: String(err) } });
  }

  return NextResponse.json({
    ok: true,
    jobs_reactivados: aReactivar.length,
  });
}
