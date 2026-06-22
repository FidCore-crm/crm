/**
 * Sistema de jobs del importador v2.
 * Usa la tabla importacion_jobs como queue con polling + row-level locking optimista.
 * No hay Redis ni BullMQ. Llamar `ejecutarJobsPendientes` periódicamente (cron/worker).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { leerArchivo, listarHojasXlsx } from '@/lib/importacion/file-readers';
import {
  analizarEstructuraArchivos,
  type ArchivoImportacion,
} from '@/lib/importacion/analisis-estructural';
import {
  procesarLote,
  cargarContextoCRM,
} from '@/lib/importacion/procesamiento-lote';
import { ejecutarImportacionFinal } from '@/lib/importacion/importacion-final';
import { notificarImportacion } from '@/lib/importacion/notificaciones-helper';
import { parsearErrorFatal, type TipoError } from '@/lib/anthropic-client';
import { encolarEmailSistema } from '@/lib/comunicaciones-sender';
import { logger } from '@/lib/errores';
import type {
  ArchivoMetadata,
  HojaVirtual,
  JobPayload,
  JobPayloadProcesamientoLote,
  JobRow,
  PlanImportacion,
  TipoJob,
} from '@/lib/importacion/types';

// Re-exportar para compat con callers previos
export type { TipoJob } from '@/lib/importacion/types';

// ============================================================================
// TIPOS
// ============================================================================

export interface EstadoImportacion {
  importacion_id: string;
  estado: string;
  tipo?: string;
  progreso: { actual: number; total: number; porcentaje: number };
  lotes: {
    total: number;
    completados: number;
    fallidos: number;
    pendientes: number;
    procesando: number;
  };
  registros: {
    listos: number;
    dudosos: number;
    pendientes_revision: number;
    resueltos: number;
  };
  jobs: {
    pendientes: number;
    ejecutando: number;
    completados: number;
    fallidos: number;
  };
  archivos_metadata?: ArchivoMetadata[];
  error?: string;
  fecha_inicio?: string;
  fecha_fin?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

const STORAGE_BASE = path.join(process.cwd(), 'storage', 'importaciones');
const TAMANO_LOTE = 50;

/**
 * Resuelve un nombre de archivo dentro de la carpeta de la importación y valida
 * que no escape via `..`, links simbólicos resueltos como prefijo distinto ni
 * separadores raros. Tira si detecta path traversal. La idea: `nombre_disco`
 * viene de `archivos_metadata` en DB y pudo haber sido inyectado o quedar mal
 * sanitizado en imports viejos — nunca confiar.
 */
function resolverRutaArchivoSegura(
  importacion_id: string,
  nombre_disco: string,
): string {
  if (!nombre_disco || typeof nombre_disco !== 'string') {
    throw new Error('nombre_disco vacío o inválido');
  }
  // Rechazar separadores explícitos de directorio y null bytes. El nombre
  // debe ser un archivo plano en el root de la importación.
  if (
    nombre_disco.includes('/') ||
    nombre_disco.includes('\\') ||
    nombre_disco.includes('\0')
  ) {
    throw new Error(`nombre_disco con separadores no permitidos: ${nombre_disco}`);
  }
  const dirImportacion = path.resolve(STORAGE_BASE, importacion_id);
  const rutaAbs = path.resolve(dirImportacion, nombre_disco);
  const rel = path.relative(dirImportacion, rutaAbs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `Path traversal detectado en nombre_disco: ${nombre_disco}`,
    );
  }
  return rutaAbs;
}

/**
 * Resuelve un `archivo_origen` (que puede ser un id virtual tipo
 * "archivo.xlsx :: Clientes") a los datos físicos para releerlo del disco.
 * Si no hay `hojas_virtuales` o no matchea, cae al comportamiento clásico
 * (nombre = archivo físico, sin hoja preferida).
 */
export function resolverOrigenArchivo(
  archivo_origen: string,
  archivos_metadata: ArchivoMetadata[],
  hojas_virtuales?: HojaVirtual[] | null,
): { nombre_disco: string; hoja_preferida?: string; mime_type: string } {
  if (hojas_virtuales && hojas_virtuales.length > 0) {
    const hv = hojas_virtuales.find((h) => h.nombre_virtual === archivo_origen);
    if (hv) {
      const metaFisica = archivos_metadata.find(
        (m) => (m.nombre || m.nombre_archivo || m.filename) === hv.nombre_archivo,
      );
      return {
        nombre_disco: hv.nombre_archivo,
        hoja_preferida: hv.hoja_origen,
        mime_type: hv.mime_type || metaFisica?.mime_type || 'application/octet-stream',
      };
    }
  }
  const meta = archivos_metadata.find(
    (m) => (m.nombre || m.nombre_archivo || m.filename) === archivo_origen,
  );
  if (!meta) {
    throw new Error(`No hay metadata para archivo "${archivo_origen}"`);
  }
  return {
    nombre_disco: archivo_origen,
    mime_type: meta.mime_type || meta.mime || 'application/octet-stream',
  };
}

function nuevoWorkerId(): string {
  return `worker-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function tituloNotifFatal(tipo: TipoError): string {
  switch (tipo) {
    case 'INSUFFICIENT_QUOTA':
      return 'Importación pausada: sin créditos en Anthropic';
    case 'INVALID_KEY':
      return 'Importación pausada: API key de Anthropic inválida';
    case 'NO_CONFIGURED':
      return 'Importación pausada: falta configurar la API key de Anthropic';
    case 'NO_MODELS_AVAILABLE':
      return 'Importación pausada: no hay modelos vigentes en la familia configurada';
    default:
      return 'Tu importación falló';
  }
}

async function setEstadoImportacion(
  importacion_id: string,
  patch: Record<string, unknown>
): Promise<void> {
  const supa = getSupabaseAdmin();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supa.from('importaciones') as any).update(patch).eq('id', importacion_id);
  } catch {
    // no-op
  }
}

// ============================================================================
// ENCOLAR
// ============================================================================

export async function encolarJob(params: {
  importacion_id: string;
  tipo: TipoJob;
  payload: JobPayload;
  prioridad?: number;
  max_intentos?: number;
}): Promise<string> {
  const supa = getSupabaseAdmin();
  const row = {
    importacion_id: params.importacion_id,
    tipo: params.tipo,
    estado: 'PENDIENTE',
    prioridad: params.prioridad ?? 0,
    intentos: 0,
    max_intentos: params.max_intentos ?? 3,
    payload: params.payload ?? {},
    fecha_creacion: new Date().toISOString(),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supa.from('importacion_jobs') as any)
    .insert(row)
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(`No se pudo encolar job: ${error?.message || 'desconocido'}`);
  }
  return (data as { id: string }).id;
}

// ============================================================================
// HANDLERS POR TIPO
// ============================================================================

interface HandlerResult {
  [k: string]: unknown;
}

async function handleAnalisisEstructural(job: JobRow): Promise<HandlerResult> {
  const supa = getSupabaseAdmin();
  const importacion_id = job.importacion_id;

  await setEstadoImportacion(importacion_id, { estado_proceso: 'ANALIZANDO' });

  const { data: imp, error: errImp } = await supa
    .from('importaciones')
    .select('id, archivos_metadata')
    .eq('id', importacion_id)
    .single();

  if (errImp || !imp) {
    throw new Error(`Importación no encontrada: ${importacion_id}`);
  }

  const impRow = imp as { archivos_metadata?: ArchivoMetadata[] | null };
  const archivosMeta: ArchivoMetadata[] = Array.isArray(impRow.archivos_metadata)
    ? impRow.archivos_metadata
    : [];

  if (archivosMeta.length === 0) {
    throw new Error('La importación no tiene archivos en archivos_metadata');
  }

  // Leer cada archivo del disco y construir ArchivoImportacion[].
  // Los .xlsx con múltiples solapas de datos se expanden en N archivos virtuales
  // (uno por solapa), con un id compuesto "nombre.xlsx :: Solapa" para que la
  // IA los analice por separado y los lotes puedan relerlos después.
  const archivos: ArchivoImportacion[] = [];
  const hojasVirtuales: HojaVirtual[] = [];
  const advertenciasExpansion: string[] = [];

  for (const meta of archivosMeta) {
    const nombre: string = meta.nombre || meta.nombre_archivo || meta.filename || '';
    if (!nombre) continue;
    const rutaAbs = resolverRutaArchivoSegura(importacion_id, nombre);
    const buffer = await fs.readFile(rutaAbs);
    const mime: string = meta.mime_type || meta.mime || 'application/octet-stream';

    const esXlsx = /\.(xlsx|xls|xlsm)$/i.test(nombre) || /spreadsheet|excel/i.test(mime);
    const hojasInfo = esXlsx ? listarHojasXlsx(buffer) : [];
    const hojasDatos = hojasInfo.filter((h) => h.es_datos);

    // Decidir cómo expandir:
    //   - 0/1 solapas totales: comportamiento clásico (no tocar nombre, sin hoja_preferida).
    //   - 1 solapa de datos entre varias (típico: Instrucciones + tabla): mantener
    //     el nombre clásico pero leer la solapa correcta con hoja_preferida.
    //   - 2+ solapas de datos: expandir en ids virtuales "archivo :: Solapa".
    let entradas: Array<{ idVirtual: string; hoja?: string }>;
    if (hojasInfo.length <= 1) {
      entradas = [{ idVirtual: nombre }];
    } else if (hojasDatos.length === 0) {
      entradas = [{ idVirtual: nombre }];
    } else if (hojasDatos.length === 1) {
      entradas = [{ idVirtual: nombre, hoja: hojasDatos[0].nombre }];
    } else {
      entradas = hojasDatos.map((h) => ({
        idVirtual: `${nombre} :: ${h.nombre}`,
        hoja: h.nombre,
      }));
    }

    if (hojasInfo.length > 1 && hojasDatos.length >= 1) {
      const salteadas = hojasInfo.filter((h) => !h.es_datos).map((h) => h.nombre);
      if (salteadas.length > 0) {
        advertenciasExpansion.push(
          `Archivo "${nombre}": se omitieron las solapas ${salteadas
            .map((s) => `"${s}"`)
            .join(', ')} (parecen instructivas o no tienen tabla de datos).`,
        );
      }
    }

    for (const entrada of entradas) {
      const lectura = await leerArchivo(buffer, mime, nombre, {
        hoja_preferida: entrada.hoja,
      });

      archivos.push({
        nombre: entrada.idVirtual,
        mime_type: mime,
        ruta_storage: rutaAbs,
        hash: meta.hash || '',
        size_bytes: meta.size_bytes || buffer.length,
        filas: lectura.filas,
        headers_detectados: lectura.headers_detectados,
        hojas_detectadas: lectura.hojas_detectadas,
        total_filas: lectura.total_filas,
      });

      if (entrada.hoja) {
        hojasVirtuales.push({
          nombre_virtual: entrada.idVirtual,
          nombre_archivo: nombre,
          hoja_origen: entrada.hoja,
          mime_type: mime,
        });
      }
    }
  }

  const resultado = await analizarEstructuraArchivos(archivos);
  if (!resultado.ok || !resultado.resultado) {
    throw new Error(resultado.error || 'Falló el análisis estructural');
  }

  const plan = resultado.resultado;
  if (hojasVirtuales.length > 0) {
    plan.hojas_virtuales = hojasVirtuales;
  }
  if (advertenciasExpansion.length > 0) {
    plan.advertencias = [...(plan.advertencias || []), ...advertenciasExpansion];
  }

  // Guardar plan + stats en importaciones
  await setEstadoImportacion(importacion_id, {
    plan_importacion: plan,
    estado_proceso: 'ANALIZADO',
    estadisticas: {
      total_registros_estimado: plan.total_registros_estimado,
      calidad_estimada: plan.calidad_estimada,
      tokens_analisis: plan.tokens_usados,
      costo_analisis_usd: plan.costo_usd,
      companias_detectadas: plan.companias_detectadas,
    },
  });

  await notificarImportacion({
    importacion_id,
    tipo: 'IMPORTACION_ANALIZADA',
    titulo: 'Tu importación está lista para revisar',
    mensaje: `Analizamos ${plan.total_registros_estimado} registros. Revisá el plan y ajustá el mapeo antes de procesar.`,
    url: `/crm/importar/${importacion_id}/plan`,
  });

  // Crear lotes (PENDIENTE) partidos de TAMANO_LOTE en TAMANO_LOTE.
  // Un lote por archivo: no mezclar archivos distintos en el mismo lote.
  type LoteInsertRow = {
    importacion_id: string;
    numero_lote: number;
    estado: string;
    registros_total: number;
    registros_procesados: number;
    registros_listos: number;
    registros_dudosos: number;
    intentos: number;
    registros_originales: {
      archivo_origen: string;
      rango_desde: number;
      rango_hasta: number;
    };
  };
  const lotesInsert: LoteInsertRow[] = [];
  let numeroLoteGlobal = 0;

  for (const archivo of archivos) {
    const total = archivo.filas.length;
    for (let offset = 0; offset < total; offset += TAMANO_LOTE) {
      numeroLoteGlobal += 1;
      const fin = Math.min(offset + TAMANO_LOTE, total);
      lotesInsert.push({
        importacion_id,
        numero_lote: numeroLoteGlobal,
        estado: 'PENDIENTE',
        registros_total: fin - offset,
        registros_procesados: 0,
        registros_listos: 0,
        registros_dudosos: 0,
        intentos: 0,
        // Snapshot: sólo índices de rango + archivo. No duplicamos contenido.
        registros_originales: {
          archivo_origen: archivo.nombre,
          rango_desde: offset,
          rango_hasta: fin,
        },
      });
    }
  }

  if (lotesInsert.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supa.from('importacion_lotes') as any).insert(lotesInsert);
    if (error) {
      throw new Error(`No se pudieron crear los lotes: ${error.message}`);
    }
  }

  return {
    archivos: archivos.length,
    lotes_creados: lotesInsert.length,
    calidad: plan.calidad_estimada,
    total_registros: plan.total_registros_estimado,
  };
}

async function handleProcesamientoLote(job: JobRow): Promise<HandlerResult> {
  const supa = getSupabaseAdmin();
  const payload = (job.payload || {}) as JobPayloadProcesamientoLote;
  const lote_id: string = payload.lote_id;
  const archivo_origen: string | undefined = payload.archivo_origen;
  const compania_id_default: string | undefined = payload.compania_id_default;
  const importacion_id = job.importacion_id;

  if (!lote_id) throw new Error('Falta lote_id en payload');

  // Cargar lote + importación en paralelo
  const [{ data: lote, error: errLote }, { data: imp, error: errImp }] =
    await Promise.all([
      supa.from('importacion_lotes').select('*').eq('id', lote_id).single(),
      supa
        .from('importaciones')
        .select('id, plan_importacion, archivos_metadata, tipo')
        .eq('id', importacion_id)
        .single(),
    ]);

  if (errLote || !lote) throw new Error(`Lote no encontrado: ${lote_id}`);
  if (errImp || !imp) throw new Error(`Importación no encontrada: ${importacion_id}`);

  type LoteRow = {
    intentos?: number;
    registros_originales?: { archivo_origen?: string; rango_desde?: number; rango_hasta?: number };
  };
  const loteRow = lote as LoteRow;
  const impRow = imp as {
    plan_importacion?: PlanImportacion | null;
    archivos_metadata?: ArchivoMetadata[] | null;
    tipo?: string;
  };

  // Marcar lote PROCESANDO
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supa.from('importacion_lotes') as any)
    .update({
      estado: 'PROCESANDO',
      fecha_inicio: new Date().toISOString(),
      intentos: (loteRow.intentos || 0) + 1,
    })
    .eq('id', lote_id);

  const originales = loteRow.registros_originales || {};
  const nombreArchivo: string = archivo_origen || originales.archivo_origen || '';
  if (!nombreArchivo) throw new Error('No se pudo determinar archivo_origen del lote');

  const rangoDesde: number = originales.rango_desde ?? 0;
  const rangoHasta: number = originales.rango_hasta ?? 0;

  // Releer el archivo desde disco, resolviendo ids virtuales
  // (formato "archivo.xlsx :: Solapa") si corresponde.
  const archivosMeta: ArchivoMetadata[] = Array.isArray(impRow.archivos_metadata)
    ? impRow.archivos_metadata
    : [];
  const origen = resolverOrigenArchivo(
    nombreArchivo,
    archivosMeta,
    impRow.plan_importacion?.hojas_virtuales || null,
  );

  const rutaAbs = resolverRutaArchivoSegura(importacion_id, origen.nombre_disco);
  const buffer = await fs.readFile(rutaAbs);
  const lectura = await leerArchivo(buffer, origen.mime_type, origen.nombre_disco, {
    hoja_preferida: origen.hoja_preferida,
  });

  const registrosLote = lectura.filas.slice(rangoDesde, rangoHasta);

  const ctx = await cargarContextoCRM();
  const modoLimpiezaIA =
    impRow.plan_importacion?.modo_limpieza_ia === 'AGRESIVO' ? 'AGRESIVO' : 'NORMAL';
  const res = await procesarLote({
    lote_id,
    importacion_id,
    registros: registrosLote,
    headers: lectura.headers_detectados,
    archivo_origen: nombreArchivo,
    mapeo: impRow.plan_importacion,
    compania_id_default,
    contexto_crm: ctx,
    tipo_importacion:
      impRow.tipo === 'INCREMENTAL' ? 'INCREMENTAL' : 'INICIAL',
    modo_limpieza_ia: modoLimpiezaIA,
  });

  if (!res.ok) {
    // Marcar lote FALLIDO
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supa.from('importacion_lotes') as any)
      .update({
        estado: 'FALLIDO',
        fecha_fin: new Date().toISOString(),
      })
      .eq('id', lote_id);
    throw new Error(res.error || 'procesarLote devolvió ok=false');
  }

  // procesarLote ya actualizó el lote a COMPLETADO y guardó dudosos.
  // Verificar si todos los lotes de esta importación ya están en un estado final.
  const { data: restantes } = await supa
    .from('importacion_lotes')
    .select('id, estado')
    .eq('importacion_id', importacion_id);

  type LoteEstadoRow = { estado: string };
  const lotesList = (restantes || []) as LoteEstadoRow[];
  const totalLotes = lotesList.length;
  const completados = lotesList.filter((l) => l.estado === 'COMPLETADO').length;
  const fallidos = lotesList.filter((l) => l.estado === 'FALLIDO').length;
  const enEstadoFinal = completados + fallidos === totalLotes && totalLotes > 0;

  if (enEstadoFinal) {
    // Transición atómica a REVISANDO: usamos update + filtro para evitar que
    // dos workers que terminan sus lotes simultáneamente disparen la notif dos
    // veces. El primer worker que consiga mover el estado gana; el segundo
    // hace el update sobre 0 filas y se calla.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: transicion } = await (supa.from('importaciones') as any)
      .update({ estado_proceso: 'REVISANDO' })
      .eq('id', importacion_id)
      .in('estado_proceso', ['ANALIZADO', 'IMPORTANDO', 'PROCESANDO', 'ANALIZANDO'])
      .select('id');

    const ganeTransicion = !!transicion && (transicion as unknown[]).length > 0;

    if (ganeTransicion) {
      const { count: dudososPendientes } = await supa
        .from('importacion_registros_dudosos')
        .select('id', { count: 'exact', head: true })
        .eq('importacion_id', importacion_id)
        .eq('estado_resolucion', 'PENDIENTE');

      const dudosos = dudososPendientes || 0;

      // Si hay lotes fallidos, informar al PAS qué pasó sin bloquear la
      // revisión de los que sí completaron. También dejamos huella en
      // estadisticas para el UI.
      if (fallidos > 0) {
        const { data: impRow } = await supa
          .from('importaciones')
          .select('estadisticas')
          .eq('id', importacion_id)
          .maybeSingle();
        const estadisticasPrev =
          ((impRow as { estadisticas?: Record<string, unknown> } | null)?.estadisticas) || {};
        await setEstadoImportacion(importacion_id, {
          estadisticas: {
            ...estadisticasPrev,
            lotes_totales: totalLotes,
            lotes_completados: completados,
            lotes_fallidos: fallidos,
            parcialmente_fallida: true,
          },
          notas: `${fallidos} de ${totalLotes} lotes fallaron. Los registros de los lotes completados están disponibles para revisar.`,
        });

        await notificarImportacion({
          importacion_id,
          tipo: 'IMPORTACION_LISTA_REVISION',
          titulo: `Procesamiento terminado con ${fallidos} lote${fallidos !== 1 ? 's' : ''} fallido${fallidos !== 1 ? 's' : ''}`,
          mensaje:
            dudosos > 0
              ? `${completados} de ${totalLotes} lotes se procesaron bien. Hay ${dudosos} registros para revisar.`
              : `${completados} de ${totalLotes} lotes se procesaron bien. Podés continuar con los datos que sí quedaron listos o cancelar y volver a empezar.`,
          url: `/crm/importar/${importacion_id}/revisar`,
          prioridad: 'ADVERTENCIA',
        });
      } else {
        await notificarImportacion({
          importacion_id,
          tipo: 'IMPORTACION_LISTA_REVISION',
          titulo: dudosos > 0 ? `${dudosos} registros requieren tu atención` : 'Procesamiento terminado',
          mensaje:
            dudosos > 0
              ? `Revisá los registros dudosos antes de importar a tu cartera.`
              : `Todos los registros pasaron las validaciones. Confirmá para importar.`,
          url: `/crm/importar/${importacion_id}/revisar`,
        });
      }
    }
  }

  return {
    registros_procesados: res.registros_procesados.length,
    listos: res.registros_listos,
    dudosos: res.registros_dudosos,
    tokens_usados: res.tokens_usados,
    costo_usd: res.costo_usd,
  };
}

async function handleImportacionFinal(job: JobRow): Promise<HandlerResult> {
  const importacion_id = job.importacion_id;
  await setEstadoImportacion(importacion_id, { estado_proceso: 'IMPORTANDO' });

  const res = await ejecutarImportacionFinal(importacion_id);
  if (!res.ok) {
    throw new Error(
      res.errores?.[0]?.error || 'ejecutarImportacionFinal devolvió ok=false'
    );
  }
  return {
    creados: res.ids_creados,
    actualizados: res.ids_actualizados,
    errores: res.errores.length,
  };
}

// ============================================================================
// EJECUTOR DE JOBS
// ============================================================================

export async function ejecutarJobsPendientes(
  worker_id?: string
): Promise<{ procesados: number; fallidos: number; en_cola: number }> {
  const supa = getSupabaseAdmin();
  const wid = worker_id || nuevoWorkerId();

  let procesados = 0;
  let fallidos = 0;

  // 1. Candidatos
  // Subido de 5 a 10 jobs por tick: combinado con el dispatch inmediato
  // post-encolar (en /iniciar, /procesar, /confirmar), reduce a la mitad
  // los ticks necesarios para drenar la cola de una importación grande.
  // Los handlers de lote son IO-bound (queries + IA), no CPU, así que
  // procesar 10 seguidos en un tick no satura nada — la latencia de cada
  // uno es ~10-20s, el endpoint cron tolera hasta 300s.
  const { data: candidatos, error } = await supa
    .from('importacion_jobs')
    .select('*')
    .eq('estado', 'PENDIENTE')
    .order('prioridad', { ascending: false })
    .order('fecha_creacion', { ascending: true })
    .limit(10);

  if (error) {
    return { procesados: 0, fallidos: 0, en_cola: 0 };
  }

  for (const raw of candidatos || []) {
    const job = raw as JobRow;

    // 2. Intentar lock optimista
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: locked, error: errLock } = await (supa.from('importacion_jobs') as any)
      .update({
        estado: 'EJECUTANDO',
        worker_id: wid,
        fecha_inicio: new Date().toISOString(),
        intentos: (job.intentos || 0) + 1,
      })
      .eq('id', job.id)
      .eq('estado', 'PENDIENTE')
      .select();

    if (errLock || !locked || (locked as unknown[]).length === 0) {
      continue; // otro worker lo tomó
    }

    const intentosActuales = (job.intentos || 0) + 1;
    const maxIntentos = job.max_intentos || 3;

    // 3. Ejecutar según tipo
    try {
      let resultado: HandlerResult;
      switch (job.tipo) {
        case 'ANALISIS_ESTRUCTURAL':
          resultado = await handleAnalisisEstructural(job);
          break;
        case 'PROCESAMIENTO_LOTE':
          resultado = await handleProcesamientoLote(job);
          break;
        case 'VALIDACION_LOGICA':
          resultado = { nota: 'validacion_logica aún no implementada' };
          break;
        case 'IMPORTACION_FINAL':
          resultado = await handleImportacionFinal(job);
          break;
        default:
          throw new Error(`Tipo de job desconocido: ${job.tipo}`);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supa.from('importacion_jobs') as any)
        .update({
          estado: 'COMPLETADO',
          fecha_fin: new Date().toISOString(),
          resultado,
        })
        .eq('id', job.id);

      procesados += 1;
    } catch (e) {
      const msg = (e as { message?: string })?.message || String(e);
      // Error permanente de Anthropic: sin créditos / key inválida / no configurada.
      // No reintentar: marcar FALLIDO ya y avisar al admin para que intervenga.
      const fatal = parsearErrorFatal(msg);
      const debeFallarYa = !!fatal || intentosActuales >= maxIntentos;

      if (!debeFallarYa) {
        // Reintentar: devolver a PENDIENTE
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supa.from('importacion_jobs') as any)
          .update({
            estado: 'PENDIENTE',
            error: msg,
            worker_id: null,
          })
          .eq('id', job.id);
      } else {
        const mensajeHumano = fatal ? fatal.mensaje : msg;
        const notaNotas = fatal
          ? `Job ${job.tipo} falló por error permanente de Anthropic (${fatal.tipo}): ${fatal.mensaje}`
          : `Job ${job.tipo} falló tras ${intentosActuales} intentos: ${msg}`;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supa.from('importacion_jobs') as any)
          .update({
            estado: 'FALLIDO',
            error: fatal ? `[${fatal.tipo}] ${fatal.mensaje}` : msg,
            fecha_fin: new Date().toISOString(),
          })
          .eq('id', job.id);
        await setEstadoImportacion(job.importacion_id, {
          estado_proceso: 'FALLIDA',
          notas: notaNotas,
        });

        await notificarImportacion({
          importacion_id: job.importacion_id,
          tipo: 'IMPORTACION_FALLIDA',
          titulo: fatal ? tituloNotifFatal(fatal.tipo) : 'Tu importación falló',
          mensaje: fatal
            ? mensajeHumano
            : `El paso "${job.tipo}" no pudo completarse: ${mensajeHumano}`,
          url: `/crm/importar/${job.importacion_id}`,
        });

        // Email de sistema al admin para errores permanentes de Anthropic
        // (requiere acción humana: cargar créditos, renovar API key, etc.).
        if (fatal) {
          try {
            await encolarEmailSistema({
              tipo_evento: 'ERROR_CRITICO',
              variables_extra: {
                codigo: `ANTHROPIC_${fatal.tipo}`,
                modulo: 'importacion',
                endpoint: `job:${job.tipo}`,
                mensaje: fatal.mensaje,
                fecha: new Date().toISOString(),
              },
            });
          } catch (errEmail) {
            logger.error({
              modulo: 'importacion',
              mensaje: 'No se pudo encolar email de sistema por error de Anthropic',
              contexto: {
                tipo: fatal.tipo,
                importacion_id: job.importacion_id,
                error: String(errEmail),
              },
            });
          }
        }

        fallidos += 1;
      }
    }
  }

  // 4. Conteo de cola restante
  const { count: enCola } = await supa
    .from('importacion_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('estado', 'PENDIENTE');

  return { procesados, fallidos, en_cola: enCola || 0 };
}

// ============================================================================
// ESTADO DE UNA IMPORTACIÓN
// ============================================================================

export async function obtenerEstadoImportacion(
  importacion_id: string
): Promise<EstadoImportacion> {
  const supa = getSupabaseAdmin();

  const [impRes, lotesRes, jobsRes, dudososRes] = await Promise.all([
    supa
      .from('importaciones')
      .select(
        'id, estado_proceso, archivos_metadata, notas, fecha_inicio, fecha_fin, tipo'
      )
      .eq('id', importacion_id)
      .single(),
    supa
      .from('importacion_lotes')
      .select('estado, registros_total, registros_procesados, registros_listos, registros_dudosos')
      .eq('importacion_id', importacion_id),
    supa
      .from('importacion_jobs')
      .select('estado')
      .eq('importacion_id', importacion_id),
    supa
      .from('importacion_registros_dudosos')
      .select('estado_resolucion')
      .eq('importacion_id', importacion_id),
  ]);

  type ImpRow = {
    estado_proceso?: string;
    archivos_metadata?: ArchivoMetadata[];
    notas?: string;
    fecha_inicio?: string;
    fecha_fin?: string;
    tipo?: string;
  };
  type LoteEstadoFull = {
    estado: string;
    registros_total?: number;
    registros_procesados?: number;
    registros_listos?: number;
    registros_dudosos?: number;
  };
  type JobEstadoRow = { estado: string };
  type DudosoEstadoRow = { estado_resolucion: string };

  const imp = (impRes.data || {}) as ImpRow;
  const lotes = (lotesRes.data || []) as LoteEstadoFull[];
  const jobs = (jobsRes.data || []) as JobEstadoRow[];
  const dudosos = (dudososRes.data || []) as DudosoEstadoRow[];

  const totalLotes = lotes.length;
  let completados = 0;
  let fallidosL = 0;
  let pendientesL = 0;
  let procesandoL = 0;
  let progresoActual = 0;
  let progresoTotal = 0;
  let listos = 0;
  let dudososCount = 0;

  for (const l of lotes) {
    const e = l.estado;
    if (e === 'COMPLETADO') completados += 1;
    else if (e === 'FALLIDO') fallidosL += 1;
    else if (e === 'PROCESANDO') procesandoL += 1;
    else pendientesL += 1;

    progresoActual += Number(l.registros_procesados || 0);
    progresoTotal += Number(l.registros_total || 0);
    listos += Number(l.registros_listos || 0);
    dudososCount += Number(l.registros_dudosos || 0);
  }

  let jPend = 0;
  let jEjec = 0;
  let jComp = 0;
  let jFall = 0;
  for (const j of jobs) {
    const e = j.estado;
    if (e === 'PENDIENTE' || e === 'REINTENTANDO') jPend += 1;
    else if (e === 'EJECUTANDO') jEjec += 1;
    else if (e === 'COMPLETADO') jComp += 1;
    else if (e === 'FALLIDO' || e === 'CANCELADO') jFall += 1;
  }

  let dudosPend = 0;
  let dudosResu = 0;
  for (const d of dudosos) {
    if (d.estado_resolucion === 'PENDIENTE') dudosPend += 1;
    else if (d.estado_resolucion === 'RESUELTO' || d.estado_resolucion === 'IGNORADO')
      dudosResu += 1;
  }

  const porcentaje =
    progresoTotal > 0 ? Math.floor((progresoActual * 100) / progresoTotal) : 0;

  return {
    importacion_id,
    estado: imp.estado_proceso || 'PENDIENTE',
    tipo: imp.tipo,
    progreso: { actual: progresoActual, total: progresoTotal, porcentaje },
    lotes: {
      total: totalLotes,
      completados,
      fallidos: fallidosL,
      pendientes: pendientesL,
      procesando: procesandoL,
    },
    registros: {
      listos,
      dudosos: dudososCount,
      pendientes_revision: dudosPend,
      resueltos: dudosResu,
    },
    jobs: { pendientes: jPend, ejecutando: jEjec, completados: jComp, fallidos: jFall },
    archivos_metadata: imp.archivos_metadata,
    error: imp.estado_proceso === 'FALLIDA' ? imp.notas : undefined,
    fecha_inicio: imp.fecha_inicio,
    fecha_fin: imp.fecha_fin,
  };
}
