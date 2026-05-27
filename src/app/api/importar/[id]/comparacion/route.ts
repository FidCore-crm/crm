/**
 * GET /api/importar/[id]/comparacion
 *
 * Análisis comparativo on-demand para importaciones INCREMENTALES.
 * Relee los archivos desde disco, aplica el mapeo del plan y compara
 * contra el estado actual del CRM (personas por DNI, pólizas por
 * numero_poliza + compania_id).
 *
 * TODO: este cálculo puede ser lento para cartera grande. A futuro
 * convendría pre-computarlo durante el análisis estructural y cachearlo
 * en plan_importacion.comparacion.
 */

import { NextResponse } from 'next/server';
import * as fs from 'fs/promises';
import * as path from 'path';
import { requireAuth, requireOwnership } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { leerArchivo } from '@/lib/importacion/file-readers';
import { resolverOrigenArchivo } from '@/lib/importacion/job-runner';
import {
  aplicarMapeoAFila,
  extraerColumnasDelMapeo,
  cargarContextoCRM,
} from '@/lib/importacion/procesamiento-lote';
import type {
  ArchivoMetadata,
  CambioCampo,
  PersonaImportada,
  PlanImportacion,
  PolizaImportada,
} from '@/lib/importacion/types';

export const dynamic = 'force-dynamic';

const STORAGE_BASE = path.join(process.cwd(), 'storage', 'importaciones');
const MUESTRA_LIMITE = 10;

function normalizarComp(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const sa = String(a).trim().toLowerCase();
  const sb = String(b).trim().toLowerCase();
  if (sa === sb) return true;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  // fecha ISO parcial
  if (/^\d{4}-\d{2}-\d{2}/.test(sa) && /^\d{4}-\d{2}-\d{2}/.test(sb)) {
    return sa.slice(0, 10) === sb.slice(0, 10);
  }
  return false;
}

function compararCampos(
  incoming: Record<string, unknown>,
  existente: Record<string, unknown>,
  ignorar: Set<string>
): Record<string, CambioCampo> {
  const cambios: Record<string, CambioCampo> = {};
  for (const [campo, nuevo] of Object.entries(incoming)) {
    if (ignorar.has(campo)) continue;
    if (nuevo === null || nuevo === undefined || nuevo === '') continue;
    const viejo = existente[campo];
    if (!normalizarComp(nuevo, viejo)) {
      cambios[campo] = { antes: viejo ?? null, despues: nuevo };
    }
  }
  return cambios;
}

export async function GET(
  request: Request,
  context: { params: { id: string } }
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const usuario = auth;
  const { id } = context.params;

  const supa = getSupabaseAdmin();
  const { data: imp, error } = await supa
    .from('importaciones')
    .select(
      'id, usuario_id, estado_proceso, tipo, plan_importacion, archivos_metadata, compania_id'
    )
    .eq('id', id)
    .maybeSingle();

  if (error || !imp) {
    return NextResponse.json(
      { ok: false, error: 'Importación no encontrada' },
      { status: 404 }
    );
  }

  type ImpRow = {
    usuario_id: string
    estado_proceso: string
    tipo: string | null
    plan_importacion: PlanImportacion | null
    archivos_metadata: ArchivoMetadata[] | null
    compania_id: string | null
  };
  const impRow = imp as ImpRow;

  const own = requireOwnership(usuario, {
    usuario_id: impRow.usuario_id,
  });
  if (own) return own;

  if (impRow.tipo !== 'INCREMENTAL') {
    return NextResponse.json(
      { ok: false, error: 'Esta importación no es incremental' },
      { status: 400 }
    );
  }
  if (impRow.estado_proceso !== 'ANALIZADO') {
    return NextResponse.json(
      { ok: false, error: 'El análisis aún no está listo' },
      { status: 400 }
    );
  }

  const plan = impRow.plan_importacion || ({} as PlanImportacion);
  const archivosMeta: ArchivoMetadata[] = Array.isArray(impRow.archivos_metadata)
    ? impRow.archivos_metadata
    : [];
  const companiaIdDefault: string | undefined = impRow.compania_id || undefined;

  // 1. Releer todos los archivos y acumular entidades mapeadas
  const personasPorDni = new Map<string, PersonaImportada>();
  const polizasPorNumero = new Map<string, PolizaImportada>();

  const ctx = await cargarContextoCRM();

  function normalizarNombre(s: string) {
    return String(s || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }
  function matchCompania(nombre: string): string | null {
    const n = normalizarNombre(nombre);
    if (!n) return null;
    for (const c of ctx.companias) {
      if (normalizarNombre(c.nombre) === n) return c.id;
      if (c.equivalencias?.some((e) => normalizarNombre(e) === n)) return c.id;
    }
    return null;
  }

  // Si el análisis expandió un .xlsx multi-solapa, iteramos por archivo virtual
  // (una entrada por solapa); si no, iteramos los archivos físicos del metadata.
  const virtuales = plan.hojas_virtuales || [];
  const orígenes: string[] = virtuales.length
    ? virtuales.map((h) => h.nombre_virtual)
    : archivosMeta
        .map((m) => m.nombre || m.nombre_archivo || m.filename || '')
        .filter((n): n is string => !!n);

  for (const nombre of orígenes) {
    try {
      const origen = resolverOrigenArchivo(nombre, archivosMeta, virtuales);
      const rutaAbs = path.join(STORAGE_BASE, id, origen.nombre_disco);
      const buffer = await fs.readFile(rutaAbs);
      const lectura = await leerArchivo(buffer, origen.mime_type, origen.nombre_disco, {
        hoja_preferida: origen.hoja_preferida,
      });
      const columnas = extraerColumnasDelMapeo(plan, nombre, lectura.headers_detectados);

      for (const fila of lectura.filas) {
        const ent = aplicarMapeoAFila(fila, columnas);
        if (ent.persona?.dni_cuil) {
          const dni = String(ent.persona.dni_cuil).replace(/\D/g, '');
          if (dni.length >= 7) {
            if (!personasPorDni.has(dni)) {
              personasPorDni.set(dni, { ...ent.persona, dni_cuil: dni });
            }
          }
        }
        if (ent.poliza?.numero_poliza) {
          const num = String(ent.poliza.numero_poliza).trim();
          if (num) {
            // Resolver compania_id si viene por nombre
            let compId: string | null = companiaIdDefault || null;
            if (ent.poliza.compania) {
              compId = matchCompania(String(ent.poliza.compania)) || compId;
            }
            polizasPorNumero.set(num, { ...ent.poliza, numero_poliza: num, compania_id: compId });
          }
        }
      }
    } catch {
      // seguir con los demás
    }
  }

  // 2. Consultar CRM en batch
  const dnis = Array.from(personasPorDni.keys());
  const nros = Array.from(polizasPorNumero.keys());

  const [carteraClientes, carteraPolizas] = await Promise.all([
    supa.from('personas').select('id', { count: 'exact', head: true }),
    supa.from('polizas').select('id', { count: 'exact', head: true }).eq('estado', 'VIGENTE'),
  ]);

  const cartera_actual = {
    clientes: (carteraClientes as { count?: number | null }).count || 0,
    polizas: (carteraPolizas as { count?: number | null }).count || 0,
  };

  type PersonaDbRow = Record<string, unknown> & { dni_cuil: string };
  type PolizaDbRow = Record<string, unknown> & {
    id: string;
    numero_poliza: string;
    asegurado_id?: string;
    compania_id?: string | null;
  };

  // Personas existentes
  const personasExistentes = new Map<string, PersonaDbRow>();
  if (dnis.length > 0) {
    // Dividir en chunks de 500 para evitar querystrings gigantes
    for (let i = 0; i < dnis.length; i += 500) {
      const chunk = dnis.slice(i, i + 500);
      const { data } = await supa.from('personas').select('*').in('dni_cuil', chunk);
      ((data || []) as PersonaDbRow[]).forEach((p) => personasExistentes.set(p.dni_cuil, p));
    }
  }

  // Pólizas existentes
  const polizasExistentes = new Map<string, PolizaDbRow>();
  if (nros.length > 0) {
    for (let i = 0; i < nros.length; i += 500) {
      const chunk = nros.slice(i, i + 500);
      const { data } = await supa.from('polizas').select('*').in('numero_poliza', chunk);
      ((data || []) as PolizaDbRow[]).forEach((p) => {
        // Solo contar match si coincide compania (cuando está disponible)
        const incoming = polizasPorNumero.get(p.numero_poliza);
        if (!incoming) return;
        if (incoming.compania_id && p.compania_id && incoming.compania_id !== p.compania_id) return;
        polizasExistentes.set(p.numero_poliza, p);
      });
    }
  }

  // Campos a ignorar en la comparación (auxiliares)
  const ignorarPersona = new Set(['compania', 'ramo']);
  const ignorarPoliza = new Set(['compania', 'ramo', 'compania_nombre', 'ramo_nombre']);

  // 3. Conteos personas
  let per_sin_cambios = 0;
  let per_con_cambios = 0;
  let per_nuevas = 0;
  const per_muestra: Array<{ dni: string; nombre: string; cambios: Record<string, CambioCampo> }> = [];

  for (const [dni, incoming] of Array.from(personasPorDni.entries())) {
    const existente = personasExistentes.get(dni);
    if (!existente) {
      per_nuevas++;
      continue;
    }
    const cambios = compararCampos(
      incoming as unknown as Record<string, unknown>,
      existente as Record<string, unknown>,
      ignorarPersona
    );
    if (Object.keys(cambios).length === 0) {
      per_sin_cambios++;
    } else {
      per_con_cambios++;
      if (per_muestra.length < MUESTRA_LIMITE) {
        const apellido = String(existente.apellido ?? '');
        const nombre = String(existente.nombre ?? '');
        per_muestra.push({
          dni,
          nombre: `${apellido}${nombre ? ', ' + nombre : ''}`.trim() || '(sin nombre)',
          cambios,
        });
      }
    }
  }

  // 4. Conteos pólizas
  let pol_sin_cambios = 0;
  let pol_con_cambios = 0;
  let pol_nuevas = 0;
  let pol_renovaciones = 0;
  const pol_muestra: Array<{ numero: string; cliente: string; cambios: Record<string, CambioCampo> }> = [];

  for (const [num, incoming] of Array.from(polizasPorNumero.entries())) {
    const existente = polizasExistentes.get(num);
    if (!existente) {
      pol_nuevas++;
      continue;
    }
    const cambios = compararCampos(
      incoming as unknown as Record<string, unknown>,
      existente as Record<string, unknown>,
      ignorarPoliza
    );
    if (Object.keys(cambios).length === 0) {
      pol_sin_cambios++;
    } else {
      const keys = Object.keys(cambios);
      const esRenovacion =
        keys.length === 1 &&
        keys[0] === 'fecha_fin' &&
        typeof cambios.fecha_fin.antes === 'string' &&
        typeof cambios.fecha_fin.despues === 'string' &&
        String(cambios.fecha_fin.despues) > String(cambios.fecha_fin.antes);
      if (esRenovacion) pol_renovaciones++;
      else pol_con_cambios++;
      if (pol_muestra.length < MUESTRA_LIMITE) {
        pol_muestra.push({
          numero: num,
          cliente: existente.asegurado_id || '',
          cambios,
        });
      }
    }
  }

  // 5. Pólizas VIGENTES del CRM que NO están en el archivo (posibles bajas)
  // Limitar a las compañías detectadas en el archivo.
  const companiasDetectadas = new Set<string>();
  for (const p of Array.from(polizasPorNumero.values())) {
    if (p.compania_id) companiasDetectadas.add(p.compania_id);
  }

  let no_encontradas_count = 0;
  const no_encontradas_detalle: Array<{
    id: string;
    numero_poliza: string;
    cliente: string;
  }> = [];

  if (companiasDetectadas.size > 0 && nros.length > 0) {
    try {
      const { data: vigentesCRM } = await supa
        .from('polizas')
        .select('id, numero_poliza, asegurado_id, compania_id')
        .eq('estado', 'VIGENTE')
        .in('compania_id', Array.from(companiasDetectadas));
      type VigenteRow = { id: string; numero_poliza: string; asegurado_id: string; compania_id: string };
      const setArchivo = new Set(nros);
      for (const p of ((vigentesCRM || []) as VigenteRow[])) {
        if (!setArchivo.has(p.numero_poliza)) {
          no_encontradas_count++;
          if (no_encontradas_detalle.length < 50) {
            no_encontradas_detalle.push({
              id: p.id,
              numero_poliza: p.numero_poliza,
              cliente: p.asegurado_id || '',
            });
          }
        }
      }
    } catch {
      // ignorar
    }
  }

  return NextResponse.json(
    {
      ok: true,
      personas: {
        sin_cambios: per_sin_cambios,
        con_cambios: per_con_cambios,
        nuevas: per_nuevas,
        duplicadas: 0,
        muestra_con_cambios: per_muestra,
      },
      polizas: {
        sin_cambios: pol_sin_cambios,
        con_cambios: pol_con_cambios,
        nuevas: pol_nuevas,
        renovaciones_detectadas: pol_renovaciones,
        no_encontradas: no_encontradas_count,
        no_encontradas_detalle,
        muestra_con_cambios: pol_muestra,
      },
      cartera_actual,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
