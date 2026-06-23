/**
 * Análisis estructural de archivos de importación con IA.
 * Primer paso del flujo: determina qué contiene cada archivo y propone mapeo de columnas.
 */

import { llamarClaude, esErrorPermanente, marcarErrorFatal } from '@/lib/anthropic-client';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { intentarFastPathTemplate } from '@/lib/importacion/fast-path-template';
import type {
  ArchivoAnalizado as ArchivoAnalizadoType,
  CalidadEstimada,
  CeldaValor,
  ColumnaAnalizada,
  FilaOriginal,
  JSONObject,
  MapeoColumnas as MapeoColumnasType,
  PlanImportacion,
  TipoContenidoArchivo as TipoContenidoArchivoType,
  TipoImportacion,
  VinculacionEntreArchivos as VinculacionType,
} from '@/lib/importacion/types';

// ============================================================================
// CONSTANTES
// ============================================================================
// Los CAMPOS_* viven en `./campos` — archivo sin imports de server-only para
// que el bundle del cliente (`/crm/importar/[id]/plan/page.tsx`) pueda
// importarlos sin arrastrar anthropic-client → nodemailer → fs.
export { CAMPOS_PERSONA, CAMPOS_POLIZA, CAMPOS_RIESGO } from './campos'
import { CAMPOS_PERSONA, CAMPOS_POLIZA, CAMPOS_RIESGO } from './campos'
import { TIPOS_RIESGO } from '@/lib/tipos-riesgo'

// ============================================================================
// TIPOS
// ============================================================================

export interface ArchivoImportacion {
  nombre: string;
  mime_type: string;
  ruta_storage: string;
  hash: string;
  size_bytes: number;
  filas: FilaOriginal[];
  headers_detectados: string[];
  hojas_detectadas?: Array<{ nombre: string; filas: number }>;
  total_filas: number;
}

export type TipoContenidoArchivo = TipoContenidoArchivoType;
export type ArchivoAnalizado = ArchivoAnalizadoType;
export type VinculacionEntreArchivos = VinculacionType;
export type MapeoColumnas = MapeoColumnasType;
export type ResultadoAnalisisEstructural = PlanImportacion;

// ============================================================================
// HELPERS
// ============================================================================

function tomarMuestra(filas: FilaOriginal[]): FilaOriginal[] {
  if (!Array.isArray(filas) || filas.length === 0) return [];
  if (filas.length <= 15) return filas.slice();

  const primeras = filas.slice(0, 5);
  const ultimas = filas.slice(-5);

  const medio: FilaOriginal[] = [];
  const inicio = 5;
  const fin = filas.length - 5;
  if (fin > inicio) {
    const pool = filas.slice(inicio, fin);
    const usados = new Set<number>();
    let intentos = 0;
    while (medio.length < 5 && intentos < 50 && usados.size < pool.length) {
      const idx = Math.floor(Math.random() * pool.length);
      if (!usados.has(idx)) {
        usados.add(idx);
        medio.push(pool[idx]);
      }
      intentos++;
    }
  }

  return [...primeras, ...medio, ...ultimas];
}

function formatearFilaMarkdown(fila: readonly CeldaValor[]): string {
  return fila
    .map((v) => {
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
      return s.length > 60 ? s.slice(0, 57) + '...' : s;
    })
    .join(' | ');
}

function formatearArchivoMarkdown(a: ArchivoImportacion): string {
  const muestra = tomarMuestra(a.filas);
  const headers = a.headers_detectados.length
    ? a.headers_detectados
    : muestra[0]?.map((_: CeldaValor, i: number) => `col${i}`) ?? [];

  const lineas: string[] = [];
  lineas.push(`### Archivo: ${a.nombre}`);
  lineas.push(`- Total filas: ${a.total_filas}`);
  lineas.push(`- MIME: ${a.mime_type}`);
  if (a.hojas_detectadas?.length) {
    lineas.push(
      `- Hojas: ${a.hojas_detectadas
        .map((h) => `${h.nombre} (${h.filas} filas)`)
        .join(', ')}`
    );
  }
  lineas.push('');
  lineas.push('Headers (con índice):');
  headers.forEach((h, i) => {
    lineas.push(`  [${i}] ${h}`);
  });
  lineas.push('');
  lineas.push('Muestra de filas:');
  lineas.push('');
  lineas.push('| ' + headers.join(' | ') + ' |');
  lineas.push('|' + headers.map(() => '---').join('|') + '|');
  muestra.forEach((f) => {
    lineas.push('| ' + formatearFilaMarkdown(f) + ' |');
  });

  return lineas.join('\n');
}

async function cargarCatalogosContexto(): Promise<{
  companias: Array<{ nombre: string; equivalencias: string[] }>;
  ramos: Array<{ nombre: string; tipo_riesgo: string }>;
}> {
  try {
    const supa = getSupabaseAdmin();
    const { data: tipos } = await supa
      .from('tipo_catalogo')
      .select('id, codigo');

    const tiposRows = (tipos || []) as Array<{ id: number; codigo: string }>;
    const idCompania = tiposRows.find((t) => t.codigo === 'COMPANIA')?.id;
    const idRamo = tiposRows.find((t) => t.codigo === 'RAMO')?.id;

    const companias: Array<{ nombre: string; equivalencias: string[] }> = [];
    const ramos: Array<{ nombre: string; tipo_riesgo: string }> = [];

    type CatalogoRow = { nombre: string; metadata: JSONObject | null };

    if (idCompania) {
      const { data } = await supa
        .from('catalogos')
        .select('nombre, metadata')
        .eq('tipo_id', idCompania)
        .eq('activo', true);
      const rows = (data || []) as CatalogoRow[];
      rows.forEach((c) => {
        const meta: JSONObject = c.metadata ?? {};
        const eq = meta.equivalencias;
        const equivalencias = Array.isArray(eq)
          ? (eq as unknown[]).map((v) => String(v))
          : eq && typeof eq === 'object'
          ? Object.values(eq as Record<string, unknown>).map((v) => String(v))
          : [];
        companias.push({
          nombre: c.nombre,
          equivalencias,
        });
      });
    }

    if (idRamo) {
      const { data } = await supa
        .from('catalogos')
        .select('nombre, metadata')
        .eq('tipo_id', idRamo)
        .eq('activo', true);
      const rows = (data || []) as CatalogoRow[];
      rows.forEach((r) => {
        const meta: JSONObject = r.metadata ?? {};
        ramos.push({
          nombre: r.nombre,
          tipo_riesgo: (meta.tipo_riesgo as string) || 'generico',
        });
      });
    }

    return { companias, ramos };
  } catch {
    return { companias: [], ramos: [] };
  }
}

function construirSystem(): string {
  return `Sos un asistente experto en cartera de seguros argentinos. Trabajás con datos de productores asesores de seguros (PAS).
Tu tarea es analizar archivos Excel/CSV y determinar:
1. Qué contiene cada archivo (clientes, pólizas, mixto, riesgos).
2. Cómo mapear cada columna a los campos del CRM.
3. Si hay múltiples archivos, cómo se vinculan entre sí.

IMPORTANTE: Tu respuesta DEBE ser un JSON válido, sin texto adicional, sin markdown, sin backticks. SOLO el JSON puro.`;
}

function construirPrompt(
  archivos: ArchivoImportacion[],
  ctx: { companias: Array<{ nombre: string; equivalencias: string[] }>; ramos: Array<{ nombre: string; tipo_riesgo: string }> },
  reintentoEstricto = false
): string {
  const partes: string[] = [];

  partes.push('## Archivos a analizar');
  archivos.forEach((a) => {
    partes.push(formatearArchivoMarkdown(a));
    partes.push('');
  });

  partes.push('## Contexto del CRM');
  partes.push('');
  partes.push('### Compañías conocidas');
  if (ctx.companias.length === 0) {
    partes.push('(ninguna cargada)');
  } else {
    ctx.companias.forEach((c) => {
      const equiv = c.equivalencias.length ? ` — equivalencias: ${c.equivalencias.join(', ')}` : '';
      partes.push(`- ${c.nombre}${equiv}`);
    });
  }
  partes.push('');
  partes.push('### Ramos conocidos');
  if (ctx.ramos.length === 0) {
    partes.push('(ninguno cargado)');
  } else {
    ctx.ramos.forEach((r) => {
      partes.push(`- ${r.nombre} (tipo_riesgo: ${r.tipo_riesgo})`);
    });
  }
  partes.push('');

  partes.push('## Campos CRM disponibles');
  partes.push('');
  partes.push('Usá como `campo_crm` uno de estos valores (con prefijo), o `"ignorar"` si la columna no se usa, o `null` si no estás seguro:');
  partes.push('');
  partes.push('### persona.*');
  partes.push(CAMPOS_PERSONA.map((c) => `persona.${c}`).join(', '));
  partes.push('');
  partes.push('### poliza.*');
  partes.push(CAMPOS_POLIZA.map((c) => `poliza.${c}`).join(', '));
  partes.push('');
  partes.push('### riesgo.*');
  partes.push(CAMPOS_RIESGO.map((c) => `riesgo.${c}`).join(', '));
  partes.push('');
  partes.push('### Campos del bien asegurado por tipo de riesgo');
  partes.push('Cuando el ramo del archivo tiene un tipo de riesgo específico, mapeá las columnas a los campos esperados de ese tipo. Las keys exactas son las que figuran abajo:');
  partes.push('');
  for (const tipo of TIPOS_RIESGO) {
    if (tipo.campos_poliza.length === 0) continue
    const ejemplos = tipo.ejemplos.length > 0 ? ` (ej: ${tipo.ejemplos.slice(0, 3).join(', ')})` : ''
    partes.push(`- **${tipo.label}** [${tipo.key}]${ejemplos}: ${tipo.campos_poliza.map((c) => `riesgo.${c.key}`).join(', ')}`);
  }
  partes.push('');

  partes.push('## Formato de respuesta (JSON estricto)');
  partes.push('');
  partes.push('```');
  partes.push(
    JSON.stringify(
      {
        archivos_analizados: [
          {
            nombre: 'string',
            tipo_contenido: 'CLIENTES|POLIZAS|MIXTO|RIESGOS|DESCONOCIDO',
            columnas: [
              {
                indice: 0,
                header: 'string',
                campo_crm: 'persona.dni_cuil | poliza.numero_poliza | riesgo.patente | ignorar | null',
                confianza: 0.95,
                nota: 'opcional',
              },
            ],
            compania_detectada: 'string|null',
            ramos_detectados: ['string'],
            advertencias: ['string'],
          },
        ],
        vinculacion_detectada: {
          tipo: 'DNI|NUMERO_POLIZA|NINGUNA',
          archivo_maestro: 'string',
          archivo_hijo: 'string',
          campo_vinculacion_maestro: 'string',
          campo_vinculacion_hijo: 'string',
          confianza: 0.9,
        },
        mapeo_propuesto: {
          por_archivo: {},
        },
        campos_a_ignorar: ['string'],
        total_registros_estimado: 0,
        calidad_estimada: 'EXCELENTE|BUENA|REGULAR|BAJA',
        advertencias: ['string'],
        companias_detectadas: ['string'],
        tipo_importacion_sugerida: 'INICIAL|INCREMENTAL',
      },
      null,
      2
    )
  );
  partes.push('```');
  partes.push('');
  partes.push(
    'El objeto `mapeo_propuesto.por_archivo` debe tener como keys los nombres de los archivos y como value el mismo objeto que está en `archivos_analizados` para ese archivo.'
  );

  if (reintentoEstricto) {
    partes.push('');
    partes.push('ATENCIÓN: El intento anterior devolvió un JSON inválido o con shape incorrecto.');
    partes.push('DEBE ser JSON puro, sin markdown, sin comentarios, sin texto antes o después.');
    partes.push('TODOS los campos listados en el shape son obligatorios.');
  }

  return partes.join('\n');
}

function validarShape(obj: unknown): obj is Partial<ResultadoAnalisisEstructural> {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as { archivos_analizados?: unknown };
  if (!Array.isArray(o.archivos_analizados)) return false;
  for (const aRaw of o.archivos_analizados) {
    if (!aRaw || typeof aRaw !== 'object') return false;
    const a = aRaw as { nombre?: unknown; columnas?: unknown };
    if (typeof a.nombre !== 'string') return false;
    if (!Array.isArray(a.columnas)) return false;
  }
  return true;
}

function rellenarDefaults(obj: Record<string, unknown>): ResultadoAnalisisEstructural {
  const rawArchivos = Array.isArray(obj.archivos_analizados)
    ? (obj.archivos_analizados as Array<Record<string, unknown>>)
    : [];
  const archivos: ArchivoAnalizado[] = rawArchivos.map((a) => ({
    nombre: String(a.nombre || ''),
    tipo_contenido: (a.tipo_contenido as TipoContenidoArchivo) || 'DESCONOCIDO',
    columnas: Array.isArray(a.columnas)
      ? (a.columnas as Array<Record<string, unknown>>).map((c): ColumnaAnalizada => ({
          indice: Number(c.indice) || 0,
          header: String(c.header || ''),
          campo_crm: (c.campo_crm as string | null | undefined) ?? null,
          confianza: typeof c.confianza === 'number' ? c.confianza : 0,
          nota: c.nota as string | undefined,
        }))
      : [],
    compania_detectada: (a.compania_detectada as string | null | undefined) ?? null,
    ramos_detectados: Array.isArray(a.ramos_detectados) ? (a.ramos_detectados as string[]) : [],
    advertencias: Array.isArray(a.advertencias) ? (a.advertencias as string[]) : [],
  }));

  const porArchivo: Record<string, ArchivoAnalizado> = {};
  archivos.forEach((a) => {
    porArchivo[a.nombre] = a;
  });

  const mapeoPropuestoRaw = obj.mapeo_propuesto as { por_archivo?: Record<string, unknown> } | undefined;
  if (mapeoPropuestoRaw?.por_archivo && typeof mapeoPropuestoRaw.por_archivo === 'object') {
    for (const [k, v] of Object.entries(mapeoPropuestoRaw.por_archivo)) {
      if (v && typeof v === 'object' && !porArchivo[k]) {
        porArchivo[k] = v as ArchivoAnalizado;
      }
    }
  }

  return {
    archivos_analizados: archivos,
    vinculacion_detectada: (obj.vinculacion_detectada as VinculacionEntreArchivos | null) ?? null,
    mapeo_propuesto: { por_archivo: porArchivo },
    campos_a_ignorar: Array.isArray(obj.campos_a_ignorar) ? (obj.campos_a_ignorar as string[]) : [],
    total_registros_estimado: Number(obj.total_registros_estimado) || 0,
    calidad_estimada: (obj.calidad_estimada as CalidadEstimada) || 'REGULAR',
    advertencias: Array.isArray(obj.advertencias) ? (obj.advertencias as string[]) : [],
    companias_detectadas: Array.isArray(obj.companias_detectadas) ? (obj.companias_detectadas as string[]) : [],
    tipo_importacion_sugerida: (obj.tipo_importacion_sugerida as TipoImportacion) || 'INICIAL',
    tokens_usados: 0,
    costo_usd: 0,
  };
}

// ============================================================================
// FUNCIÓN PRINCIPAL
// ============================================================================

export async function analizarEstructuraArchivos(
  archivos: ArchivoImportacion[]
): Promise<{
  ok: boolean;
  resultado?: ResultadoAnalisisEstructural;
  error?: string;
}> {
  if (!archivos || archivos.length === 0) {
    return { ok: false, error: 'No se recibieron archivos para analizar' };
  }

  // Fast-path: si todos los archivos matchean el template del CRM, no llamamos
  // a Claude. El mapeo es 1:1 trivial y no tiene sentido gastar 60-90s + tokens.
  const fastPath = await intentarFastPathTemplate(archivos);
  if (fastPath.aplica && fastPath.plan) {
    return { ok: true, resultado: fastPath.plan };
  }

  const ctx = await cargarCatalogosContexto();
  const system = construirSystem();

  let tokensAcumulados = 0;
  let costoAcumulado = 0;

  const MAX_INTENTOS = 2;
  for (let intento = 0; intento < MAX_INTENTOS; intento++) {
    const prompt = construirPrompt(archivos, ctx, intento > 0);

    const resp = await llamarClaude({
      prompt,
      system,
      max_tokens: 8192,
      temperature: 0,
      response_format: 'json',
    });

    tokensAcumulados += resp.tokens_total || 0;
    costoAcumulado += resp.costo_estimado_usd || 0;

    if (!resp.ok) {
      // Errores permanentes (sin créditos, key inválida, sin configurar):
      // no tiene sentido reintentar ni dentro ni fuera del bucle. Marcamos
      // con prefijo para que el job-runner los detecte y falle rápido.
      if (esErrorPermanente(resp.error?.tipo)) {
        return {
          ok: false,
          error: marcarErrorFatal(
            resp.error!.tipo,
            resp.error!.mensaje || 'Error al llamar a Claude'
          ),
        };
      }
      if (intento === MAX_INTENTOS - 1) {
        return {
          ok: false,
          error: `Error al llamar a Claude: ${resp.error?.mensaje || 'desconocido'}`,
        };
      }
      continue;
    }

    let json: unknown = resp.json;
    if (!json && typeof resp.data === 'string') {
      try {
        const limpio = resp.data.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
        json = JSON.parse(limpio);
      } catch {
        if (intento === MAX_INTENTOS - 1) {
          return { ok: false, error: 'Respuesta de Claude no es JSON válido' };
        }
        continue;
      }
    }

    if (!validarShape(json)) {
      if (intento === MAX_INTENTOS - 1) {
        return { ok: false, error: 'JSON de Claude con shape inválido' };
      }
      continue;
    }

    const resultado = rellenarDefaults(json as Record<string, unknown>);
    resultado.tokens_usados = tokensAcumulados;
    resultado.costo_usd = costoAcumulado;

    return { ok: true, resultado };
  }

  return { ok: false, error: 'Se agotaron los reintentos' };
}
