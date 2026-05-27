/**
 * Deshacer una importación completada (rollback).
 * Válido sólo dentro de las 24 horas post-importación y para el creador o un ADMIN.
 * Preserva entidades con actividad posterior (siniestros, tareas, pólizas externas).
 */

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { notificarImportacion } from '@/lib/importacion/notificaciones-helper';
import type { IdsCreadosActualizados, ImportacionRow } from '@/lib/importacion/types';

export interface ResultadoDeshacer {
  ok: boolean;
  registros_revertidos: { personas: number; polizas: number; riesgos: number };
  registros_preservados: { personas: number; polizas: number };
  error?: string;
}

const VENTANA_MS = 24 * 60 * 60 * 1000;

export async function deshacerImportacion(
  importacion_id: string,
  usuario_id: string
): Promise<ResultadoDeshacer> {
  const supa = getSupabaseAdmin();

  const base: ResultadoDeshacer = {
    ok: false,
    registros_revertidos: { personas: 0, polizas: 0, riesgos: 0 },
    registros_preservados: { personas: 0, polizas: 0 },
  };

  // 1. Cargar importación + usuario en paralelo
  const [{ data: imp, error: errImp }, { data: usuario }] = await Promise.all([
    supa.from('importaciones').select('*').eq('id', importacion_id).single(),
    supa.from('usuarios_perfil').select('id, rol').eq('id', usuario_id).single(),
  ]);

  if (errImp || !imp) {
    return { ...base, error: 'Importación no encontrada' };
  }

  const impRow = imp as ImportacionRow;

  // 2. Validaciones
  if (impRow.estado_proceso !== 'COMPLETADA') {
    return { ...base, error: 'Solo se pueden deshacer importaciones COMPLETADAS' };
  }
  if (impRow.deshecha === true) {
    return { ...base, error: 'Esta importación ya fue deshecha' };
  }
  if (!impRow.fecha_fin) {
    return { ...base, error: 'La importación no tiene fecha_fin registrada' };
  }

  const finTs = new Date(impRow.fecha_fin).getTime();
  if (Date.now() - finTs > VENTANA_MS) {
    return {
      ...base,
      error: 'Ventana de 24h para deshacer superada',
    };
  }

  const usuarioRow = usuario as { rol?: string } | null;
  const esAdmin = usuarioRow?.rol === 'ADMIN';
  const esCreador = impRow.usuario_id === usuario_id;
  if (!esAdmin && !esCreador) {
    return { ...base, error: 'Solo el creador o un ADMIN pueden deshacer' };
  }

  // 3. IDs a revertir
  const idsCreados = (impRow.ids_creados || {}) as Partial<IdsCreadosActualizados>;
  const riesgosIds: string[] = Array.isArray(idsCreados.riesgos) ? idsCreados.riesgos : [];
  const polizasIds: string[] = Array.isArray(idsCreados.polizas) ? idsCreados.polizas : [];
  const personasIds: string[] = Array.isArray(idsCreados.personas) ? idsCreados.personas : [];

  // 4. Eliminar riesgos (no tienen dependencias externas más allá de póliza)
  if (riesgosIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supa.from('riesgos') as any).delete().in('id', riesgosIds);
    if (!error) {
      base.registros_revertidos.riesgos = riesgosIds.length;
    }
  }

  // 5. Eliminar pólizas (preservar las que tengan siniestros)
  if (polizasIds.length > 0) {
    const { data: polizasConSiniestros } = await supa
      .from('siniestros')
      .select('poliza_id')
      .in('poliza_id', polizasIds);

    const preservadas = new Set<string>();
    for (const s of ((polizasConSiniestros || []) as Array<{ poliza_id: string }>)) {
      preservadas.add(s.poliza_id);
    }

    const polizasAEliminar = polizasIds.filter((id) => !preservadas.has(id));
    base.registros_preservados.polizas = preservadas.size;

    if (polizasAEliminar.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supa.from('polizas') as any)
        .delete()
        .in('id', polizasAEliminar);
      if (!error) {
        base.registros_revertidos.polizas = polizasAEliminar.length;
      }
    }
  }

  // 6. Eliminar personas (preservar las que tengan actividad)
  if (personasIds.length > 0) {
    // Pólizas que NO son de esta importación
    const polizasDeImportacion = new Set(polizasIds);
    const { data: polizasExistentes } = await supa
      .from('polizas')
      .select('id, asegurado_id')
      .in('asegurado_id', personasIds);

    const [{ data: tareasData }, { data: siniestrosData }] = await Promise.all([
      supa.from('tareas').select('persona_id').in('persona_id', personasIds),
      supa.from('siniestros').select('persona_id').in('persona_id', personasIds),
    ]);

    const preservadas = new Set<string>();
    for (const p of ((polizasExistentes || []) as Array<{ id: string; asegurado_id: string }>)) {
      if (!polizasDeImportacion.has(p.id)) preservadas.add(p.asegurado_id);
    }
    for (const t of ((tareasData || []) as Array<{ persona_id: string }>)) preservadas.add(t.persona_id);
    for (const s of ((siniestrosData || []) as Array<{ persona_id: string }>)) preservadas.add(s.persona_id);

    const personasAEliminar = personasIds.filter((id) => !preservadas.has(id));
    base.registros_preservados.personas = preservadas.size;

    if (personasAEliminar.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supa.from('personas') as any)
        .delete()
        .in('id', personasAEliminar);
      if (!error) {
        base.registros_revertidos.personas = personasAEliminar.length;
      }
    }
  }

  // 7. Marcar importación como deshecha
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supa.from('importaciones') as any)
    .update({
      deshecha: true,
      fecha_deshecha: new Date().toISOString(),
    })
    .eq('id', importacion_id);

  // 8. Notificar al PAS
  const total =
    base.registros_revertidos.personas +
    base.registros_revertidos.polizas +
    base.registros_revertidos.riesgos;
  await notificarImportacion({
    importacion_id,
    tipo: 'IMPORTACION_DESHECHA',
    titulo: 'Importación deshecha',
    mensaje: `Se revirtieron ${total} registros (${base.registros_revertidos.personas} personas, ${base.registros_revertidos.polizas} pólizas, ${base.registros_revertidos.riesgos} riesgos).`,
    url: `/crm/importar/historial/${importacion_id}`,
    usuario_id,
    prioridad: 'ADVERTENCIA',
  });

  base.ok = true;
  return base;
}
