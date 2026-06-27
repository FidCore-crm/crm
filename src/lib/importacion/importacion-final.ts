/**
 * Ejecución final de la importación: inserts efectivos en personas/polizas/riesgos.
 * Se invoca después de que el PAS aprobó el plan y resolvió los registros dudosos.
 */

import { getSupabaseAdmin } from '@/lib/supabase/server';
import type { RegistroProcesado } from '@/lib/importacion/procesamiento-lote';
import { notificarImportacion } from '@/lib/importacion/notificaciones-helper';
import {
  normalizarEstadoPersona,
  normalizarEstadoPoliza,
  normalizarTipoPersona,
  normalizarMoneda,
  normalizarCanalPreferido,
} from '@/lib/importacion/normalizadores';
import { normalizarMedioPago } from '@/lib/medios-pago';
import type {
  DudosoRow,
  EstadisticasImportacion,
  IdsCreadosActualizados,
  ImportacionRow,
  JSONObject,
  PersonaImportada,
  PolizaImportada,
  RiesgoImportado,
  TipoCatalogoRow,
} from '@/lib/importacion/types';

// ============================================================================
// TIPOS
// ============================================================================

interface RegistroFinal {
  numero_fila_archivo: number;
  archivo_origen: string;
  persona: PersonaImportada | null;
  poliza: PolizaImportada | null;
  riesgo: RiesgoImportado | null;
  match_persona_id?: string;
  match_poliza_id?: string;
  accion_persona: 'INSERT' | 'UPDATE' | 'SKIP' | 'USE_EXISTING';
  accion_poliza: 'INSERT' | 'UPDATE' | 'SKIP' | 'USE_EXISTING';
  // En incremental: campos específicos a actualizar (filtrados por críticos)
  update_persona_campos?: string[];
  update_poliza_campos?: string[];
}

const CAMPOS_POLIZA_CRITICOS_PROTEGIDOS = new Set<string>([
  'estado',
  'fecha_inicio',
  'fecha_fin',
  'asegurado_id',
  'compania_id',
]);

export interface ResultadoImportacionFinal {
  ok: boolean;
  ids_creados: { personas: string[]; polizas: string[]; riesgos: string[] };
  ids_actualizados: { personas: string[]; polizas: string[]; riesgos: string[] };
  errores: Array<{ fila: number; archivo?: string; error: string }>;
}

// ============================================================================
// HELPERS
// ============================================================================

const BLOQUE = 100;

/**
 * Score de completitud de los datos de persona en un registro final. Se usa
 * para:
 *   - ordenar los registros antes de procesarlos en bloques (los completos
 *     primero, así insertan la persona y los incompletos la reutilizan), y
 *   - elegir el mejor candidato al deduplicar por DNI dentro de un bloque.
 *
 * El valor absoluto no importa — sólo el orden relativo.
 */
function completitudPersona(f: { persona: PersonaImportada | null }): number {
  const p = f.persona;
  if (!p) return 0;
  let score = 0;
  const apellido = typeof p.apellido === 'string' ? p.apellido.trim() : '';
  const razon = typeof p.razon_social === 'string' ? p.razon_social.trim() : '';
  const nombre = typeof p.nombre === 'string' ? p.nombre.trim() : '';
  // Lo más determinante: tener identificación (apellido o razón social).
  if (apellido) score += 100;
  if (razon) score += 100;
  if (nombre) score += 40;
  // Datos de contacto como desempate.
  for (const campo of ['email', 'telefono', 'whatsapp', 'calle', 'localidad'] as const) {
    const v = (p as Record<string, unknown>)[campo];
    if (typeof v === 'string' && v.trim().length > 0) score += 5;
  }
  return score;
}

// ----------------------------------------------------------------------------
// Pre-procesamiento de catálogos "crear nuevo"
// ----------------------------------------------------------------------------

function slugCatalogo(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'catalogo';
}

/**
 * Crea (o reutiliza) un cat\u00e1logo `(tipo_id, nombre)` de forma segura ante
 * inserciones concurrentes. Pasos:
 *   1. Buscar por ILIKE nombre \u2014 si existe, usar su id.
 *   2. Si no existe, generar un `codigo` \u00fanico slugificado e intentar INSERT.
 *   3. Si el INSERT falla por unique_violation (23505), alguien gan\u00f3 la carrera
 *      \u2014 hacer SELECT y devolver el id del que s\u00ed se cre\u00f3.
 *
 * Retorna el id del cat\u00e1logo existente o reci\u00e9n creado, o null si se agotaron
 * los intentos de generar un c\u00f3digo \u00fanico.
 *
 * Export para que `/api/agente-pdf/[id]/aprobar` use exactamente el mismo
 * camino que el importador.
 */
export async function insertarCatalogoUpsert(
  tipo_id: number,
  nombre: string,
  metadata?: Record<string, unknown>,
): Promise<string | null> {
  const supa = getSupabaseAdmin();
  const nombreLimpio = nombre.trim();
  if (!nombreLimpio) return null;

  // 1. \u00bfExiste ya por nombre?
  const { data: existente } = await supa
    .from('catalogos')
    .select('id')
    .eq('tipo_id', tipo_id)
    .ilike('nombre', nombreLimpio)
    .limit(1)
    .maybeSingle();
  if (existente && (existente as { id: string }).id) {
    return (existente as { id: string }).id;
  }

  // 2. Intentar INSERT con c\u00f3digos progresivos. En cada intento miramos la
  // respuesta de Postgres: si es unique_violation, buscamos el que gan\u00f3 la
  // carrera.
  const baseCodigo = slugCatalogo(nombreLimpio);
  let codigo = baseCodigo;
  let sufijo = 2;
  // 5 intentos: con sufijos _2 a _5 cubre el 99.99% de las colisiones reales.
  // Antes había 12 pero nunca llegaba a 3 — el espacio de slug es lo suficientemente
  // grande para que casi nunca haya choque por (tipo_id, codigo).
  for (let intento = 0; intento < 5; intento++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: creado, error } = await (supa.from('catalogos') as any)
      .insert({
        tipo_id,
        nombre: nombreLimpio,
        codigo,
        activo: true,
        metadata: metadata ?? {},
      })
      .select('id')
      .single();

    if (!error && creado) {
      return (creado as { id: string }).id;
    }

    // PG unique_violation \u2014 otro proceso insert\u00f3 con el mismo codigo.
    const pgCode = (error as { code?: string } | null)?.code;
    const msg = (error as { message?: string } | null)?.message || '';
    const esUnique = pgCode === '23505' || /duplicate key|unique constraint/i.test(msg);
    if (!esUnique) {
      // Error distinto \u2192 bubble up al caller para que lo reporte.
      throw new Error(error?.message || 'No se pudo crear el cat\u00e1logo');
    }

    // Puede ser colisi\u00f3n por (tipo_id, codigo) \u2192 intentamos con sufijo nuevo.
    // O colisi\u00f3n por (tipo_id, nombre) si hay UNIQUE sobre ese par \u2192 en ese
    // caso re-leemos por nombre y devolvemos el id del otro.
    const { data: ganador } = await supa
      .from('catalogos')
      .select('id')
      .eq('tipo_id', tipo_id)
      .ilike('nombre', nombreLimpio)
      .limit(1)
      .maybeSingle();
    if (ganador && (ganador as { id: string }).id) {
      return (ganador as { id: string }).id;
    }

    // Choc\u00f3 s\u00f3lo el codigo (no el nombre): probamos con sufijo.
    codigo = `${baseCodigo}_${sufijo++}`;
  }

  return null;
}

/**
 * Procesa las resoluciones de dudosos que pidieron "crear nuevo" en compañías
 * o ramos. Crea los catálogos inexistentes y devuelve mapas de nombre→id.
 */
export async function crearCatalogosPendientes(
  importacion_id: string
): Promise<{
  companias_creadas: Map<string, string>;
  ramos_creados: Map<string, string>;
  coberturas_creadas: Map<string, string>;
  errores: string[];
}> {
  const supa = getSupabaseAdmin();
  const companias_creadas = new Map<string, string>();
  const ramos_creados = new Map<string, string>();
  const coberturas_creadas = new Map<string, string>();
  const errores: string[] = [];

  const { data: dudosos, error: errD } = await supa
    .from('importacion_registros_dudosos')
    .select('resolucion_datos, resolucion_accion, estado_resolucion')
    .eq('importacion_id', importacion_id)
    .eq('estado_resolucion', 'RESUELTO')
    .eq('resolucion_accion', 'EDITAR');

  if (errD) {
    errores.push(`No se pudieron leer resoluciones: ${errD.message}`);
    return { companias_creadas, ramos_creados, coberturas_creadas, errores };
  }

  // Extraer (tipo → Map<nombre, metadata>). El metadata permite que el PAS
  // haya elegido un `tipo_riesgo` al crear un ramo nuevo desde la pantalla de
  // dudosos — sin eso el ramo quedaba con metadata={} y todos los riesgos
  // asociados caían en 'generico' (placeholder vacío en el form).
  const porTipo = {
    compania: new Map<string, Record<string, unknown>>(),
    ramo: new Map<string, Record<string, unknown>>(),
    cobertura: new Map<string, Record<string, unknown>>(),
  };
  type DudosoResolucion = Pick<DudosoRow, 'resolucion_datos' | 'resolucion_accion' | 'estado_resolucion'>;
  for (const d of ((dudosos || []) as DudosoResolucion[])) {
    const datos = d?.resolucion_datos as JSONObject | null | undefined;
    if (!datos || datos.crear_nuevo !== true) continue;
    const nombre = String(datos.nombre || '').trim();
    const tipoRaw = String(datos.tipo || '').toLowerCase();
    if (!nombre) continue;
    const clave = nombre.toLowerCase().trim();
    if (tipoRaw === 'compania' || tipoRaw === 'compañia' || tipoRaw === 'compañía') {
      if (!porTipo.compania.has(clave)) porTipo.compania.set(clave, {});
    } else if (tipoRaw === 'ramo') {
      const tipoRiesgo = String(datos.tipo_riesgo || '').trim().toLowerCase();
      const metaPrev = porTipo.ramo.get(clave) ?? {};
      // Si dos dudosos de ramo coinciden en el nombre pero traen tipo_riesgo
      // distinto, el primero gana (no debería pasar en la práctica).
      if (tipoRiesgo && !metaPrev.tipo_riesgo) {
        metaPrev.tipo_riesgo = tipoRiesgo;
      }
      metaPrev.__nombre_original = nombre;
      porTipo.ramo.set(clave, metaPrev);
    } else if (tipoRaw === 'cobertura') {
      const metaPrev = porTipo.cobertura.get(clave) ?? {};
      metaPrev.__nombre_original = nombre;
      porTipo.cobertura.set(clave, metaPrev);
    }
  }

  if (porTipo.compania.size === 0 && porTipo.ramo.size === 0 && porTipo.cobertura.size === 0) {
    return { companias_creadas, ramos_creados, coberturas_creadas, errores };
  }

  // Obtener tipo_ids
  const { data: tipos } = await supa
    .from('tipo_catalogo')
    .select('id, codigo')
    .in('codigo', ['COMPANIA', 'RAMO', 'COBERTURA']);
  const tiposRows = (tipos || []) as TipoCatalogoRow[];
  const tipoCompaniaId = tiposRows.find((t) => t.codigo === 'COMPANIA')?.id;
  const tipoRamoId = tiposRows.find((t) => t.codigo === 'RAMO')?.id;
  const tipoCoberturaId = tiposRows.find((t) => t.codigo === 'COBERTURA')?.id;

  async function crearEnCatalogo(
    tipo_id: number,
    entradas: Map<string, Record<string, unknown>>,
    destino: Map<string, string>,
    incluirMetadata: boolean,
  ) {
    for (const [clave, meta] of Array.from(entradas.entries())) {
      if (destino.has(clave)) continue;
      const nombre = String(meta.__nombre_original ?? clave);
      try {
        const metadata = incluirMetadata
          ? Object.fromEntries(
              Object.entries(meta).filter(([k]) => !k.startsWith('__')),
            )
          : undefined;
        const id = await insertarCatalogoUpsert(tipo_id, nombre, metadata);
        if (id) destino.set(clave, id);
      } catch (e) {
        const err = e as { message?: string } | string;
        const msg = typeof err === 'string' ? err : err?.message || String(e);
        errores.push(`Error creando catálogo "${nombre}": ${msg}`);
      }
    }
  }

  if (tipoCompaniaId && porTipo.compania.size > 0) {
    await crearEnCatalogo(tipoCompaniaId, porTipo.compania, companias_creadas, false);
  } else if (porTipo.compania.size > 0) {
    errores.push('No se encontró tipo_catalogo COMPANIA');
  }
  if (tipoRamoId && porTipo.ramo.size > 0) {
    await crearEnCatalogo(tipoRamoId, porTipo.ramo, ramos_creados, true);
  } else if (porTipo.ramo.size > 0) {
    errores.push('No se encontró tipo_catalogo RAMO');
  }
  if (tipoCoberturaId && porTipo.cobertura.size > 0) {
    // Coberturas se crean SIN metadata.ramo_ids — el PAS las verá disponibles
    // en el catálogo pero no aparecen filtradas por ramo en el form de pólizas
    // hasta que él complete la metadata desde /crm/configuracion/catalogos.
    // Es deuda menor a cambio de desbloquear la importación.
    await crearEnCatalogo(tipoCoberturaId, porTipo.cobertura, coberturas_creadas, false);
  } else if (porTipo.cobertura.size > 0) {
    errores.push('No se encontró tipo_catalogo COBERTURA');
  }

  return { companias_creadas, ramos_creados, coberturas_creadas, errores };
}

function mapeoPersona(p: PersonaImportada): Record<string, unknown> {
  const pr = p as Record<string, unknown>;
  const out: Record<string, unknown> = {
    // Los valores de enum ya vinieron normalizados por `normalizarPersonaImportada`
    // (los 4 CHECK constraint válidos), pero re-aplicamos los normalizadores como
    // red de seguridad antes del INSERT — sirve para callers que entren acá sin
    // pasar por el normalizador (importaciones viejas o reanudaciones).
    tipo_persona: normalizarTipoPersona(
      pr.tipo_persona as string | null | undefined,
      pr.dni_cuil as string | null | undefined,
    ),
    dni_cuil: pr.dni_cuil,
    apellido: pr.apellido || pr.razon_social || 'S/D',
    pais: pr.pais || 'Argentina',
    estado: normalizarEstadoPersona(pr.estado as string | null | undefined),
    // canal_preferido tiene CHECK constraint (EMAIL/WHATSAPP/TELEFONO/CORREO).
    // Si el archivo trae "email", "Email", "WhatsApp" lo mapeamos al enum.
    // Si no viene, queda en default 'EMAIL'.
    canal_preferido: normalizarCanalPreferido(
      pr.canal_preferido as string | null | undefined,
    ),
    // Marca la persona como importada para que NO se le mande bienvenida
    // de cliente automática (los clientes importados vienen de otra cartera).
    origen_creacion: 'IMPORTACION',
    // Backfill: las personas importadas también arrancan con el flag de
    // bienvenida "consumido" — defensa adicional al filtro por origen_creacion.
    bienvenida_cliente_encolada_en: new Date().toISOString(),
  };
  // NO incluir 'cuil_formateado' — es una GENERATED COLUMN que Postgres
  // calcula sola desde dni_cuil. Intentar insertarla tira
  // "cannot insert a non-DEFAULT value into column cuil_formateado".
  //
  // OJO: `estado` y `tipo_persona` NO van en esta lista porque ya se setean
  // arriba con su normalizador. Si los pusiéramos acá, el loop los sobreescribiría
  // con el valor crudo y volvería el bug del CHECK constraint.
  // OJO: `canal_preferido` NO va acá porque ya se setea arriba con su
  // normalizador. Si lo pusiéramos en el loop, sobreescribiría con el valor
  // crudo y podría violar el CHECK constraint.
  const keys = [
    'nombre',
    'razon_social',
    'fecha_nacimiento',
    'email',
    'email_secundario',
    'telefono',
    'telefono_secundario',
    'whatsapp',
    'calle',
    'numero',
    'piso_depto',
    'barrio',
    'localidad',
    'provincia',
    'codigo_postal',
    'origen',
    'segmento',
  ];
  for (const k of keys) {
    const v = pr[k];
    if (v != null && v !== '') out[k] = v;
  }
  return out;
}

function mapeoPoliza(
  pol: PolizaImportada,
  asegurado_id: string
): Record<string, unknown> {
  const pr = pol as Record<string, unknown>;
  const estadoNorm = normalizarEstadoPoliza(pr.estado as string | null | undefined);
  const out: Record<string, unknown> = {
    numero_poliza: pr.numero_poliza,
    asegurado_id,
    fecha_inicio: pr.fecha_inicio,
    fecha_fin: pr.fecha_fin,
    // Si el normalizador devolvió null, dejamos VIGENTE como fallback amplio.
    // En la práctica `normalizarPolizaImportada` ya pasó por acá y el valor
    // queda en uno de los 5 válidos. Pero defensive contra callers directos.
    estado: estadoNorm || 'VIGENTE',
    moneda: normalizarMoneda(pr.moneda as string | null | undefined),
    // Marca la póliza como importada para que el cron de bienvenida la excluya
    // (las pólizas importadas vienen de otra cartera, no son altas reales).
    origen_creacion: 'IMPORTACION',
  };
  // Medio de pago: normalizar a uno de los 3 enums válidos. Si el texto no
  // matchea ninguno, queda en null (CHECK permite null).
  const medioPagoNorm = normalizarMedioPago(pr.medio_pago as string | null | undefined);
  if (medioPagoNorm) out.medio_pago = medioPagoNorm;
  const keys = [
    'numero_certificado',
    'numero_endoso',
    'compania_id',
    'ramo_id',
    'cobertura_id',
    'refacturacion',
    'suma_asegurada',
    'observaciones',
    'notas',
  ];
  for (const k of keys) {
    const v = pr[k];
    if (v != null && v !== '') out[k] = v;
  }
  return out;
}

// Claves estructurales del riesgo — van a columnas top-level de `riesgos`,
// no al JSONB. Todo lo demás (campos del bien asegurado de cualquier tipo)
// se mueve a `detalle_tecnico` con el patrón blacklist para que automáticamente
// soporte cualquier tipo de riesgo definido en `tipos-riesgo.ts` sin tener
// que mantener una lista sincronizada acá.
const CLAVES_ESTRUCTURALES_RIESGO = new Set([
  'tipo_riesgo',
  'descripcion_corta',
  'suma_asegurada',
]);

function mapeoRiesgo(
  r: RiesgoImportado,
  poliza_id: string
): Record<string, unknown> {
  const rr = r as Record<string, unknown>;
  const detalle_tecnico: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rr)) {
    if (CLAVES_ESTRUCTURALES_RIESGO.has(k)) continue;
    if (v == null || v === '') continue;
    detalle_tecnico[k] = v;
  }
  return {
    poliza_id,
    tipo_riesgo: rr.tipo_riesgo || 'generico',
    descripcion_corta: rr.descripcion_corta || null,
    suma_asegurada: rr.suma_asegurada ? Number(rr.suma_asegurada) : null,
    detalle_tecnico,
    activo: true,
  };
}

// ============================================================================
// PRINCIPAL
// ============================================================================

export async function ejecutarImportacionFinal(
  importacion_id: string
): Promise<ResultadoImportacionFinal> {
  const supa = getSupabaseAdmin();

  const ids_creados = { personas: [] as string[], polizas: [] as string[], riesgos: [] as string[] };
  const ids_actualizados = { personas: [] as string[], polizas: [] as string[], riesgos: [] as string[] };
  const errores: Array<{ fila: number; archivo?: string; error: string }> = [];

  // 0. Pre-procesar catálogos pendientes (crear_nuevo en dudosos resueltos)
  const catalogosCreados = await crearCatalogosPendientes(importacion_id);
  for (const msg of catalogosCreados.errores) {
    errores.push({ fila: 0, error: msg });
  }

  // 1. Cargar importación, lotes y dudosos
  const [{ data: imp, error: errImp }, { data: lotes }, { data: dudosos }] =
    await Promise.all([
      supa.from('importaciones').select('*').eq('id', importacion_id).single(),
      supa
        .from('importacion_lotes')
        .select('id, registros_procesados_data, estado')
        .eq('importacion_id', importacion_id)
        .eq('estado', 'COMPLETADO'),
      supa
        .from('importacion_registros_dudosos')
        .select('*')
        .eq('importacion_id', importacion_id),
    ]);

  if (errImp || !imp) {
    return {
      ok: false,
      ids_creados,
      ids_actualizados,
      errores: [{ fila: 0, error: 'Importación no encontrada' }],
    };
  }

  // 2. Index de resoluciones por (archivo_origen, numero_fila_archivo)
  const resoluciones = new Map<string, DudosoRow[]>();
  const dudososRows = (dudosos || []) as DudosoRow[];
  for (const d of dudososRows) {
    const key = `${d.archivo_origen}|${d.numero_fila_archivo}`;
    const list = resoluciones.get(key) || [];
    list.push(d);
    resoluciones.set(key, list);
  }

  // Validar: si hay algún dudoso PENDIENTE → abortar
  for (const d of dudososRows) {
    if (d.estado_resolucion === 'PENDIENTE') {
      return {
        ok: false,
        ids_creados,
        ids_actualizados,
        errores: [
          {
            fila: d.numero_fila_archivo || 0,
            archivo: d.archivo_origen ?? undefined,
            error: 'Hay registros dudosos sin resolver. Abortando importación final.',
          },
        ],
      };
    }
  }

  // 3. Construir lista final de registros
  const finales: RegistroFinal[] = [];

  type LoteRow = { id: string; registros_procesados_data: RegistroProcesado[] | null; estado: string };
  for (const lote of (lotes || []) as LoteRow[]) {
    const regs: RegistroProcesado[] = Array.isArray(lote.registros_procesados_data)
      ? lote.registros_procesados_data
      : [];

    for (const r of regs) {
      const key = `${r.archivo_origen}|${r.numero_fila_archivo}`;
      const resList = resoluciones.get(key) || [];

      // ---- Flujo INCREMENTAL: honrar acciones precalculadas ----
      const acc = r.acciones;
      const esIncremental = !!acc && (acc.persona !== undefined || acc.poliza !== undefined);

      if (esIncremental) {
        const personaSinCambios = acc?.persona === 'SIN_CAMBIOS' || acc?.persona === undefined;
        const polizaSinCambios = acc?.poliza === 'SIN_CAMBIOS' || acc?.poliza === undefined;

        // Skip total si ambas entidades aplicables están SIN_CAMBIOS
        if (personaSinCambios && polizaSinCambios) continue;

        let accion_persona_inc: RegistroFinal['accion_persona'] = 'USE_EXISTING';
        if (acc?.persona === 'CREAR') accion_persona_inc = 'INSERT';
        else if (acc?.persona === 'ACTUALIZAR') accion_persona_inc = 'UPDATE';
        else if (acc?.persona === 'SIN_CAMBIOS') accion_persona_inc = 'USE_EXISTING';

        let accion_poliza_inc: RegistroFinal['accion_poliza'] = 'SKIP';
        if (acc?.poliza === 'CREAR') accion_poliza_inc = 'INSERT';
        else if (acc?.poliza === 'ACTUALIZAR' || acc?.poliza === 'RENOVACION_DETECTADA') {
          accion_poliza_inc = 'UPDATE';
        } else if (acc?.poliza === 'SIN_CAMBIOS') {
          accion_poliza_inc = 'SKIP';
        }

        // Filtrar campos críticos del UPDATE de póliza
        let update_poliza_campos: string[] | undefined = undefined;
        if (accion_poliza_inc === 'UPDATE' && acc?.cambios_poliza) {
          const todos = Object.keys(acc.cambios_poliza);
          const permitidos = todos.filter((c) => !CAMPOS_POLIZA_CRITICOS_PROTEGIDOS.has(c));
          const bloqueados = todos.filter((c) => CAMPOS_POLIZA_CRITICOS_PROTEGIDOS.has(c));
          if (bloqueados.length > 0) {
            errores.push({
              fila: r.numero_fila_archivo,
              archivo: r.archivo_origen,
              error: `Cambios en campos críticos ignorados: ${bloqueados.join(', ')}`,
            });
          }
          if (permitidos.length === 0) {
            // No hay nada actualizable → saltar el update
            accion_poliza_inc = 'SKIP';
          } else {
            update_poliza_campos = permitidos;
          }
        }

        const update_persona_campos: string[] | undefined =
          accion_persona_inc === 'UPDATE' && acc?.cambios_persona
            ? Object.keys(acc.cambios_persona)
            : undefined;

        finales.push({
          numero_fila_archivo: r.numero_fila_archivo,
          archivo_origen: r.archivo_origen,
          persona: r.entidades.persona ? { ...r.entidades.persona } : null,
          poliza: r.entidades.poliza ? { ...r.entidades.poliza } : null,
          riesgo: r.entidades.riesgo ? { ...r.entidades.riesgo } : null,
          match_persona_id: r.match_existente?.persona_id,
          match_poliza_id: r.match_existente?.poliza_id,
          accion_persona: accion_persona_inc,
          accion_poliza: accion_poliza_inc,
          update_persona_campos,
          update_poliza_campos,
        });
        continue;
      }

      // ---- Flujo INICIAL original ----
      // Estado base según clasificación
      let accion_persona: RegistroFinal['accion_persona'] =
        r.match_existente?.persona_id ? 'USE_EXISTING' : 'INSERT';
      let accion_poliza: RegistroFinal['accion_poliza'] =
        r.match_existente?.poliza_id ? 'SKIP' : 'INSERT';

      // Si es LISTO y no hay dudosos → incluir tal cual
      // Si es DUDOSO → aplicar resoluciones
      if (r.clasificacion === 'DUDOSO' && resList.length === 0) {
        // No hay dudosos en DB: el lote se reprocesó, skipear.
        continue;
      }

      // Copias mutables
      const persona = r.entidades.persona ? { ...r.entidades.persona } : null;
      const poliza = r.entidades.poliza ? { ...r.entidades.poliza } : null;
      const riesgo = r.entidades.riesgo ? { ...r.entidades.riesgo } : null;

      let skipRegistro = false;

      for (const res of resList) {
        const accion = res.resolucion_accion ?? null;
        if (!accion) continue;

        if (accion === 'IGNORAR_REGISTRO') {
          skipRegistro = true;
          break;
        }

        const datos = (res.resolucion_datos ?? {}) as JSONObject;

        if (accion === 'ACEPTAR_PROPUESTA' || accion === 'EDITAR') {
          // Caso especial: crear nuevo catálogo (compañía, ramo o cobertura)
          if (datos && datos.crear_nuevo === true && typeof datos.nombre === 'string') {
            const clave = String(datos.nombre).toLowerCase().trim();
            const tipoRaw = String(datos.tipo || '').toLowerCase();
            if (tipoRaw.startsWith('compa')) {
              const id = catalogosCreados.companias_creadas.get(clave);
              if (id && poliza) poliza.compania_id = id;
              else if (!id) {
                errores.push({
                  fila: r.numero_fila_archivo,
                  archivo: r.archivo_origen,
                  error: `No se pudo resolver compañía nueva "${datos.nombre}"`,
                });
              }
            } else if (tipoRaw === 'ramo') {
              const id = catalogosCreados.ramos_creados.get(clave);
              if (id && poliza) poliza.ramo_id = id;
              else if (!id) {
                errores.push({
                  fila: r.numero_fila_archivo,
                  archivo: r.archivo_origen,
                  error: `No se pudo resolver ramo nuevo "${datos.nombre}"`,
                });
              }
            } else if (tipoRaw === 'cobertura') {
              const id = catalogosCreados.coberturas_creadas.get(clave);
              if (id && poliza) poliza.cobertura_id = id;
              else if (!id) {
                errores.push({
                  fila: r.numero_fila_archivo,
                  archivo: r.archivo_origen,
                  error: `No se pudo resolver cobertura nueva "${datos.nombre}"`,
                });
              }
            }
          } else {
            // Aplicar datos al entity correspondiente
            if (res.tipo_entidad === 'PERSONA' && persona) {
              Object.assign(persona, datos);
            } else if (res.tipo_entidad === 'POLIZA' && poliza) {
              Object.assign(poliza, datos);
            } else if (res.tipo_entidad === 'RIESGO' && riesgo) {
              Object.assign(riesgo, datos);
            }
          }
        } else if (accion === 'ACTUALIZAR_EXISTENTE') {
          if (res.tipo_entidad === 'PERSONA') accion_persona = 'UPDATE';
          else if (res.tipo_entidad === 'POLIZA') accion_poliza = 'UPDATE';
        } else if (accion === 'CREAR_NUEVO') {
          if (res.tipo_entidad === 'PERSONA') accion_persona = 'INSERT';
          else if (res.tipo_entidad === 'POLIZA') accion_poliza = 'INSERT';
        }
      }

      if (skipRegistro) continue;

      finales.push({
        numero_fila_archivo: r.numero_fila_archivo,
        archivo_origen: r.archivo_origen,
        persona,
        poliza,
        riesgo,
        match_persona_id: r.match_existente?.persona_id,
        match_poliza_id: r.match_existente?.poliza_id,
        accion_persona,
        accion_poliza,
      });
    }
  }

  // 4. Procesar en bloques de BLOQUE
  //
  // Antes ordenamos los registros poniendo primero los que tienen más datos de
  // persona (apellido/razon_social completos). Esto es clave cuando el mismo
  // DNI aparece en dos filas (por ejemplo, hoja "Clientes" con nombre + hoja
  // "Pólizas" solo con DNI de referencia): el registro completo debe insertar
  // la persona primero para que el otro pueda reutilizarla en vez de crear un
  // registro vacío. El orden relativo dentro de cada grupo (completo vs
  // incompleto) se preserva.
  finales.sort((a, b) => completitudPersona(b) - completitudPersona(a));

  // dniToId acumulativo entre bloques: si una persona fue insertada en el
  // bloque N, el bloque N+1 debe poder resolverla por DNI sin re-insertarla.
  const dniToIdAcum = new Map<string, string>();

  // Cache ramo_id → tipo_riesgo. Lo usamos para crear riesgos placeholder
  // cuando el archivo no trae datos del bien asegurado (típico: ramos como
  // Robo o RC que no tienen columnas dedicadas en el template del CRM).
  const ramosUsados = new Set<string>();
  for (const f of finales) {
    const ramoId = (f.poliza as Record<string, unknown> | null)?.ramo_id as string | null | undefined;
    if (ramoId) ramosUsados.add(ramoId);
  }
  const ramoIdATipoRiesgo = new Map<string, string>();
  if (ramosUsados.size > 0) {
    const { data: ramos } = await supa
      .from('catalogos')
      .select('id, metadata')
      .in('id', Array.from(ramosUsados));
    for (const r of ((ramos || []) as Array<{ id: string; metadata: Record<string, unknown> | null }>)) {
      const meta = r.metadata ?? {};
      const tipo = (meta as { tipo_riesgo?: string }).tipo_riesgo || 'generico';
      ramoIdATipoRiesgo.set(r.id, tipo);
    }
  }

  for (let offset = 0; offset < finales.length; offset += BLOQUE) {
    const bloque = finales.slice(offset, offset + BLOQUE);
    await procesarBloque(bloque, {
      ids_creados,
      ids_actualizados,
      errores,
      dniToIdAcum,
      ramoIdATipoRiesgo,
    });
  }

  // 5. Actualizar importación
  const total = finales.length;
  const creados = ids_creados.personas.length;
  const existentes = ids_actualizados.personas.length + finales.filter((f) => f.accion_persona === 'USE_EXISTING').length;
  const polizasCreadas = ids_creados.polizas.length;

  // Merge estadísticas existentes con catálogos creados
  const { data: impExistente } = await supa
    .from('importaciones')
    .select('estadisticas')
    .eq('id', importacion_id)
    .maybeSingle();
  const estadisticasPrev: EstadisticasImportacion =
    (impExistente as { estadisticas?: EstadisticasImportacion } | null)?.estadisticas || {};
  const estadisticas: EstadisticasImportacion = {
    ...estadisticasPrev,
    catalogos_creados: {
      companias: Array.from(catalogosCreados.companias_creadas.keys()),
      ramos: Array.from(catalogosCreados.ramos_creados.keys()),
      coberturas: Array.from(catalogosCreados.coberturas_creadas.keys()),
    },
    clientes_actualizados: ids_actualizados.personas.length,
    polizas_actualizadas: ids_actualizados.polizas.length,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supa.from('importaciones') as any)
    .update({
      estado_proceso: 'COMPLETADA',
      fecha_fin: new Date().toISOString(),
      clientes_creados: creados,
      clientes_existentes: existentes,
      polizas_creadas: polizasCreadas,
      errores: errores.length,
      detalle_errores: errores,
      ids_creados,
      ids_actualizados,
      total_filas: total,
      estadisticas,
    })
    .eq('id', importacion_id);
  if (errUpd) {
    throw new Error(`No se pudo marcar importación como COMPLETADA: ${errUpd.message}`);
  }

  // 6. Notificación al PAS
  await notificarImportacion({
    importacion_id,
    tipo: 'IMPORTACION_COMPLETADA',
    titulo: 'Tu importación se completó',
    mensaje: `Se importaron ${creados} clientes nuevos y ${polizasCreadas} pólizas${errores.length > 0 ? ` (${errores.length} filas con errores)` : ''}.`,
    url: `/crm/importar/${importacion_id}/completada`,
    prioridad: errores.length > 0 ? 'ADVERTENCIA' : 'INFORMATIVA',
  });

  return {
    ok: errores.length === 0 || ids_creados.personas.length + ids_creados.polizas.length > 0,
    ids_creados,
    ids_actualizados,
    errores,
  };
}

// ============================================================================
// PROCESAMIENTO POR BLOQUE
// ============================================================================

async function procesarBloque(
  bloque: RegistroFinal[],
  acc: {
    ids_creados: IdsCreadosActualizados;
    ids_actualizados: IdsCreadosActualizados;
    errores: Array<{ fila: number; archivo?: string; error: string }>;
    /**
     * DNI → persona_id acumulado entre bloques. Permite que si un bloque
     * anterior insertó una persona con DNI X, este bloque pueda resolver
     * X sin re-insertar. Se mantiene vivo a través de todos los bloques.
     */
    dniToIdAcum?: Map<string, string>;
    /**
     * Cache ramo_id → tipo_riesgo. Lo usamos cuando una póliza nueva no
     * tiene entidad riesgo (archivo no trajo datos del bien): creamos un
     * riesgo placeholder con el tipo derivado del ramo en lugar de dejar
     * la póliza sin ningún riesgo asociado.
     */
    ramoIdATipoRiesgo?: Map<string, string>;
  }
): Promise<void> {
  const supa = getSupabaseAdmin();

  // ---- PERSONAS ----
  // Dedupe por dni_cuil: cuando el mismo DNI aparece en varios registros
  // (típico: hoja "Clientes" con datos completos + hoja "Pólizas" que sólo
  // repite el DNI como referencia), el INSERT se construye a partir del
  // registro con más datos, no del primero cronológico. Así evitamos
  // insertar personas vacías cuando el apellido vive en otra hoja.
  type PersonaInsertRow = Record<string, unknown>;
  const personasNuevas: Array<{ dni_cuil: string; row: PersonaInsertRow; registros: RegistroFinal[] }> = [];
  const mapaDniRegistro = new Map<string, RegistroFinal[]>();

  for (const f of bloque) {
    if (!f.persona) continue;
    if (f.accion_persona === 'USE_EXISTING' || f.accion_persona === 'SKIP') continue;

    const dni = String(f.persona.dni_cuil || '').trim();
    if (!dni) {
      acc.errores.push({
        fila: f.numero_fila_archivo,
        archivo: f.archivo_origen,
        error: 'Persona sin dni_cuil',
      });
      continue;
    }

    // Si este DNI ya fue insertado en un bloque anterior, este registro no
    // necesita INSERT: va a reutilizar el id acumulado cuando se resuelva la
    // póliza.
    if (acc.dniToIdAcum?.has(dni)) continue;

    const list = mapaDniRegistro.get(dni) || [];
    list.push(f);
    mapaDniRegistro.set(dni, list);
  }

  // INSERT batch: uno por DNI único. Elegimos el registro más completo como
  // fuente de los datos para el INSERT.
  const inserts: PersonaInsertRow[] = [];
  for (const [dni, regs] of Array.from(mapaDniRegistro.entries())) {
    const mejor = regs
      .filter((r) => r.accion_persona === 'INSERT' && r.persona)
      .sort((a, b) => completitudPersona(b) - completitudPersona(a))[0];
    if (!mejor || !mejor.persona) continue;
    inserts.push(mapeoPersona(mejor.persona));
    personasNuevas.push({ dni_cuil: dni, row: inserts[inserts.length - 1], registros: regs });
  }

  const dniToId = new Map<string, string>();
  // Sembramos el mapa local con los ids ya acumulados de bloques previos, para
  // que la resolución de persona_id de las pólizas funcione dentro de este
  // bloque aunque el INSERT haya ocurrido antes.
  if (acc.dniToIdAcum) {
    for (const [k, v] of Array.from(acc.dniToIdAcum.entries())) dniToId.set(k, v);
  }
  type PersonaCreadaRow = { id: string; dni_cuil: string };

  if (inserts.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: creadas, error } = await (supa.from('personas') as any)
      .insert(inserts)
      .select('id, dni_cuil');

    if (error) {
      // Fallback por fila: buscar existentes por DNI (posible carrera)
      const { data: existentes } = await supa
        .from('personas')
        .select('id, dni_cuil')
        .in(
          'dni_cuil',
          inserts.map((i) => String(i.dni_cuil))
        );
      const existentesRows = (existentes || []) as PersonaCreadaRow[];
      for (const p of existentesRows) {
        dniToId.set(p.dni_cuil, p.id);
        acc.ids_actualizados.personas.push(p.id);
      }
      const sinEncontrar = inserts.filter((i) => !dniToId.has(String(i.dni_cuil)));
      for (const i of sinEncontrar) {
        acc.errores.push({
          fila:
            mapaDniRegistro.get(String(i.dni_cuil))?.[0]?.numero_fila_archivo || 0,
          error: `Error al insertar persona: ${error.message}`,
        });
      }
    } else {
      const creadasRows = (creadas || []) as PersonaCreadaRow[];
      for (const p of creadasRows) {
        dniToId.set(p.dni_cuil, p.id);
        acc.ids_creados.personas.push(p.id);
      }
    }
  }

  // Propagar los ids recién resueltos (INSERT o fallback a existentes) al
  // mapa acumulado para los próximos bloques.
  if (acc.dniToIdAcum) {
    for (const [k, v] of Array.from(dniToId.entries())) acc.dniToIdAcum.set(k, v);
  }

  // UPDATE individuales
  for (const f of bloque) {
    if (f.accion_persona === 'UPDATE' && f.match_persona_id && f.persona) {
      try {
        const patchCompleto = mapeoPersona(f.persona);
        delete patchCompleto.dni_cuil;
        let patch: Record<string, unknown> = patchCompleto;
        if (f.update_persona_campos && f.update_persona_campos.length > 0) {
          patch = {};
          for (const c of f.update_persona_campos) {
            if (patchCompleto[c] !== undefined) patch[c] = patchCompleto[c];
          }
        }
        if (Object.keys(patch).length === 0) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supa.from('personas') as any)
          .update(patch)
          .eq('id', f.match_persona_id);
        if (!error) {
          acc.ids_actualizados.personas.push(f.match_persona_id);
        } else {
          acc.errores.push({
            fila: f.numero_fila_archivo,
            archivo: f.archivo_origen,
            error: `Update persona: ${error.message}`,
          });
        }
      } catch (e) {
        acc.errores.push({
          fila: f.numero_fila_archivo,
          archivo: f.archivo_origen,
          error: `Update persona: ${(e as { message?: string })?.message || String(e)}`,
        });
      }
    }
  }

  // Resolver persona_id para cada registro final
  function resolverPersonaId(f: RegistroFinal): string | null {
    if (f.match_persona_id) return f.match_persona_id;
    if (f.persona?.dni_cuil) {
      return dniToId.get(String(f.persona.dni_cuil)) || null;
    }
    return null;
  }

  // ---- POLIZAS ----
  type PolizaInsertRow = Record<string, unknown>;
  const polizasInsert: Array<{ row: PolizaInsertRow; registro: RegistroFinal }> = [];

  for (const f of bloque) {
    if (!f.poliza) continue;
    if (f.accion_poliza === 'SKIP') continue;

    const personaId = resolverPersonaId(f);
    if (!personaId) {
      if (f.accion_poliza === 'INSERT') {
        acc.errores.push({
          fila: f.numero_fila_archivo,
          archivo: f.archivo_origen,
          error: 'No se pudo resolver asegurado_id para la póliza',
        });
      }
      continue;
    }

    if (f.accion_poliza === 'INSERT') {
      polizasInsert.push({ row: mapeoPoliza(f.poliza, personaId), registro: f });
    } else if (f.accion_poliza === 'UPDATE' && f.match_poliza_id) {
      try {
        const patchCompleto = mapeoPoliza(f.poliza, personaId);
        delete patchCompleto.numero_poliza;
        // Protección adicional: nunca pisar estado/fechas/asegurado_id por defecto
        for (const k of Array.from(CAMPOS_POLIZA_CRITICOS_PROTEGIDOS)) {
          delete patchCompleto[k];
        }
        let patch: Record<string, unknown> = patchCompleto;
        if (f.update_poliza_campos && f.update_poliza_campos.length > 0) {
          patch = {};
          for (const c of f.update_poliza_campos) {
            if (patchCompleto[c] !== undefined) patch[c] = patchCompleto[c];
          }
        }
        if (Object.keys(patch).length === 0) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supa.from('polizas') as any)
          .update(patch)
          .eq('id', f.match_poliza_id);
        if (!error) {
          acc.ids_actualizados.polizas.push(f.match_poliza_id);
        } else {
          acc.errores.push({
            fila: f.numero_fila_archivo,
            archivo: f.archivo_origen,
            error: `Update póliza: ${error.message}`,
          });
        }
      } catch (e) {
        acc.errores.push({
          fila: f.numero_fila_archivo,
          archivo: f.archivo_origen,
          error: `Update póliza: ${(e as { message?: string })?.message || String(e)}`,
        });
      }
    }
  }

  type PolizaCreadaRow = { id: string; numero_poliza: string };
  const polizaRowToId = new Map<PolizaInsertRow, string>();
  if (polizasInsert.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: creadas, error } = await (supa.from('polizas') as any)
      .insert(polizasInsert.map((p) => p.row))
      .select('id, numero_poliza');

    if (error) {
      // Fallback: insertar de a uno
      for (const p of polizasInsert) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: single, error: errSingle } = await (supa.from('polizas') as any)
            .insert(p.row)
            .select('id')
            .single();
          if (errSingle || !single) {
            acc.errores.push({
              fila: p.registro.numero_fila_archivo,
              archivo: p.registro.archivo_origen,
              error: `Insert póliza: ${errSingle?.message || 'desconocido'}`,
            });
          } else {
            const singleRow = single as { id: string };
            acc.ids_creados.polizas.push(singleRow.id);
            polizaRowToId.set(p.row, singleRow.id);
          }
        } catch (e) {
          acc.errores.push({
            fila: p.registro.numero_fila_archivo,
            archivo: p.registro.archivo_origen,
            error: `Insert póliza: ${(e as { message?: string })?.message || String(e)}`,
          });
        }
      }
    } else {
      const numeroToId = new Map<string, string>();
      const creadasRows = (creadas || []) as PolizaCreadaRow[];
      for (const p of creadasRows) {
        numeroToId.set(p.numero_poliza, p.id);
        acc.ids_creados.polizas.push(p.id);
      }
      for (const p of polizasInsert) {
        const id = numeroToId.get(String(p.row.numero_poliza));
        if (id) polizaRowToId.set(p.row, id);
      }
    }
  }

  // ---- RIESGOS ----
  type RiesgoInsertRow = Record<string, unknown>;
  const riesgosInsert: Array<{ row: RiesgoInsertRow; registro: RegistroFinal }> = [];

  // Resolver tipo_riesgo desde el cache de ramos (precargado en la fase
  // anterior). Si el ramo no está en el cache o no tiene tipo definido,
  // caemos a 'generico' para no romper el INSERT por CHECK constraint.
  const obtenerTipoRiesgoDeRamo = (ramoId: string | null | undefined): string => {
    if (!ramoId) return 'generico';
    return acc.ramoIdATipoRiesgo?.get(ramoId) || 'generico';
  };

  // Si el ramo de la póliza tiene tipo_riesgo conocido, lo cacheamos para
  // crear placeholders cuando el archivo no trae datos del bien asegurado.
  // Caso típico: ramo "Robo" no tiene columnas dedicadas en el template del
  // CRM (no patente, no marca, no calle), entonces `entidades.riesgo` queda
  // null. Sin esto, la póliza quedaba sin ningún riesgo asociado en la DB y
  // la ficha de la póliza en la UI se veía "vacía" en el panel de riesgos.
  for (const p of polizasInsert) {
    const polizaId = polizaRowToId.get(p.row);
    if (!polizaId) continue;

    if (p.registro.riesgo) {
      // Caso normal: el archivo trajo datos del bien (patente, marca, etc.).
      // Si el riesgo no trae tipo_riesgo explícito, lo derivamos del ramo.
      const r = { ...p.registro.riesgo };
      if (!r.tipo_riesgo) {
        const rowPol = p.row as Record<string, unknown>;
        r.tipo_riesgo = obtenerTipoRiesgoDeRamo(rowPol.ramo_id as string | null);
      }
      riesgosInsert.push({
        row: mapeoRiesgo(r, polizaId),
        registro: p.registro,
      });
    } else {
      // Caso placeholder: derivamos tipo_riesgo del ramo de la póliza si lo
      // hay y guardamos las observaciones del archivo como `descripcion_corta`
      // para que el PAS pueda completar después desde la ficha de póliza.
      const rowPol = p.row as Record<string, unknown>;
      const tipoRiesgo = obtenerTipoRiesgoDeRamo(rowPol.ramo_id as string | null);
      const observaciones = (rowPol.observaciones as string | null) || null;
      riesgosInsert.push({
        row: {
          poliza_id: polizaId,
          tipo_riesgo: tipoRiesgo,
          descripcion_corta: observaciones,
          suma_asegurada: null,
          detalle_tecnico: {},
          activo: true,
        },
        registro: p.registro,
      });
    }
  }

  // Riesgos para pólizas UPDATE (incremental). Hasta v1.0.37 sólo se
  // insertaba el riesgo si la póliza NO tenía uno activo (para evitar el
  // UNIQUE `uq_riesgo_poliza_item` con numero_item=1). Eso dejaba pólizas
  // re-importadas con riesgos obsoletos (ej: patente vieja, marca sin actualizar).
  //
  // Desde v1.0.38: si ya hay riesgo activo, hacemos UPDATE in-place del
  // existente con los datos del archivo, mergeando el JSONB `detalle_tecnico`
  // para conservar campos que no vinieron en el archivo (ej: número de
  // motor cargado a mano antes). El UPDATE respeta `tipo_riesgo` original
  // — sólo se cambia con un alta nueva de riesgo desde la ficha.
  const polizasUpdateConRiesgo = bloque
    .filter((f) => f.accion_poliza === 'UPDATE' && f.match_poliza_id && f.riesgo)
    .map((f) => f.match_poliza_id as string);

  // Map poliza_id → { id_riesgo, detalle_tecnico_actual }
  const riesgoExistentePorPoliza = new Map<
    string,
    { id: string; detalle_tecnico: Record<string, unknown> }
  >();
  if (polizasUpdateConRiesgo.length > 0) {
    const { data: riesgosExistentes } = await supa
      .from('riesgos')
      .select('id, poliza_id, detalle_tecnico')
      .in('poliza_id', polizasUpdateConRiesgo)
      .eq('activo', true);
    for (const r of (riesgosExistentes || []) as Array<{
      id: string;
      poliza_id: string;
      detalle_tecnico: Record<string, unknown> | null;
    }>) {
      // Si una póliza tiene >1 riesgo activo, gana el primero leído.
      // En la práctica esto no pasa (el importador siempre crea uno) y la
      // ficha de póliza tampoco permite múltiples activos por defecto.
      if (!riesgoExistentePorPoliza.has(r.poliza_id)) {
        riesgoExistentePorPoliza.set(r.poliza_id, {
          id: r.id,
          detalle_tecnico: r.detalle_tecnico ?? {},
        });
      }
    }
  }

  // Acumulamos UPDATEs por id_riesgo y los aplicamos después del INSERT batch.
  const riesgosUpdate: Array<{
    riesgo_id: string;
    patch: Record<string, unknown>;
    registro: RegistroFinal;
  }> = [];

  for (const f of bloque) {
    if (f.accion_poliza !== 'UPDATE' || !f.match_poliza_id || !f.riesgo) continue;
    const existente = riesgoExistentePorPoliza.get(f.match_poliza_id);
    if (!existente) {
      // No hay riesgo activo todavía — INSERT normal.
      riesgosInsert.push({
        row: mapeoRiesgo(f.riesgo, f.match_poliza_id),
        registro: f,
      });
      continue;
    }
    // UPDATE in-place: mergeamos detalle_tecnico para preservar campos que
    // no vinieron en el archivo.
    const nuevoMapeo = mapeoRiesgo(f.riesgo, f.match_poliza_id) as Record<string, unknown>;
    const nuevoDT = (nuevoMapeo.detalle_tecnico as Record<string, unknown>) ?? {};
    const dtMerged: Record<string, unknown> = { ...existente.detalle_tecnico };
    for (const [k, v] of Object.entries(nuevoDT)) {
      if (v !== null && v !== undefined && v !== '') {
        dtMerged[k] = v;
      }
    }
    const patch: Record<string, unknown> = {};
    if (nuevoMapeo.descripcion_corta != null) patch.descripcion_corta = nuevoMapeo.descripcion_corta;
    if (nuevoMapeo.suma_asegurada != null) patch.suma_asegurada = nuevoMapeo.suma_asegurada;
    patch.detalle_tecnico = dtMerged;
    riesgosUpdate.push({ riesgo_id: existente.id, patch, registro: f });
  }

  if (riesgosInsert.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: creadas, error } = await (supa.from('riesgos') as any)
      .insert(riesgosInsert.map((r) => r.row))
      .select('id');
    if (error) {
      // Fallback fila-por-fila: si UNA viola CHECK constraint o constraint
      // único, el batch entero falla y perdemos todos los demás. Reintentamos
      // de a uno para conservar lo que se pueda y reportar errores por fila.
      for (const r of riesgosInsert) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: creadaIndiv, error: errIndiv } = await (supa.from('riesgos') as any)
          .insert(r.row)
          .select('id')
          .single();
        if (!errIndiv && creadaIndiv) {
          acc.ids_creados.riesgos.push((creadaIndiv as { id: string }).id);
        } else {
          acc.errores.push({
            fila: r.registro.numero_fila_archivo,
            archivo: r.registro.archivo_origen,
            error: `Insert riesgo: ${errIndiv?.message || error.message}`,
          });
        }
      }
    } else {
      const creadasRows = (creadas || []) as Array<{ id: string }>;
      for (const c of creadasRows) {
        acc.ids_creados.riesgos.push(c.id);
      }
    }
  }

  // Aplicar UPDATEs in-place de riesgos existentes (flujo INCREMENTAL).
  for (const u of riesgosUpdate) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: errUpd } = await (supa.from('riesgos') as any)
      .update(u.patch)
      .eq('id', u.riesgo_id);
    if (errUpd) {
      acc.errores.push({
        fila: u.registro.numero_fila_archivo,
        archivo: u.registro.archivo_origen,
        error: `Update riesgo: ${errUpd.message}`,
      });
    }
  }
}
