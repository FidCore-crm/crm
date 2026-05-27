import { redirect } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase/server';

/**
 * Landing page para /crm/importar/[id] (sin sub-ruta).
 *
 * Cada sub-pantalla del flujo (procesando/plan/comparar/progreso/revisar/
 * confirmar/importando/completada) tiene su propio page.tsx, pero antes
 * nadie cubría la ruta base. Cualquiera que llegara con la URL pelada
 * (p. ej. desde un link copiado, un email, el historial) se comía un 404.
 *
 * Este page.tsx es un server-component que resuelve el estado actual de
 * la importación y redirige al paso correcto. Si la importación no existe,
 * redirige al listado principal.
 */
export default async function ImportacionRedirectPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('importaciones')
    .select('id, estado_proceso, tipo')
    .eq('id', params.id)
    .maybeSingle();

  if (!data) {
    redirect('/crm/importar');
  }

  const estado = (data as { estado_proceso: string; tipo?: string }).estado_proceso;
  const tipo = (data as { estado_proceso: string; tipo?: string }).tipo || 'INICIAL';

  const base = `/crm/importar/${params.id}`;

  switch (estado) {
    case 'PENDIENTE':
    case 'ANALIZANDO':
      redirect(`${base}/procesando`);
    case 'ANALIZADO':
      // INCREMENTAL va a comparar; INICIAL va a plan
      redirect(`${base}/${tipo === 'INCREMENTAL' ? 'comparar' : 'plan'}`);
    case 'IMPORTANDO':
      redirect(`${base}/importando`);
    case 'REVISANDO':
      redirect(`${base}/revisar`);
    case 'COMPLETADA':
      redirect(`${base}/completada`);
    case 'FALLIDA':
    case 'CANCELADA':
    case 'PAUSADA':
      // La pantalla de procesando maneja estos estados finales con
      // banners claros y CTAs (cargar manualmente, etc.).
      redirect(`${base}/procesando`);
    default:
      redirect(`${base}/procesando`);
  }
}
