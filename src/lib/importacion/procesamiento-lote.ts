/**
 * Procesamiento de lotes del importador v2.
 * Aplica mapeo + validadores + detección de duplicados + IA condicional.
 */

import {
  llamarClaude,
  esErrorPermanente,
  marcarErrorFatal,
  type TipoError,
} from '@/lib/anthropic-client';
import { normalizarEntidadesRegistro } from '@/lib/importacion/normalizadores';
import { normalizarRefacturacion } from '@/lib/refacturaciones';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import {
  validarDNI,
  validarCUIT,
  validarEmail,
  validarTelefono,
  validarFecha,
  validarMonto,
  validarPatente,
} from '@/lib/importacion/validators';
import type {
  CeldaValor,
  ContextoCRM,
  EntidadesRegistro,
  FilaOriginal,
  JSONObject,
  ModoLimpiezaIA,
  PersonaImportada,
  PolizaImportada,
  RegistroProcesado,
  RiesgoImportado,
  TipoEntidad,
  TipoImportacion,
  TipoProblema,
} from '@/lib/importacion/types';

// Re-exportar para compat con callers previos que importaban estos tipos desde acá
export type { ContextoCRM, RegistroProcesado } from '@/lib/importacion/types';

// ============================================================================
// TIPOS INTERNOS
// ============================================================================

interface ColumnaMapeada {
  indice: number;
  header: string;
  campo_crm: string | null;
}

interface ColumnaMapeoInput {
  indice?: number | string;
  header?: string;
  campo_crm?: string | null;
}

interface PlanMapeoPorArchivo {
  columnas?: ColumnaMapeoInput[];
}

/**
 * Forma laxa que acepta tanto un PlanImportacion como un objeto ad-hoc
 * con `columnas` o `por_archivo` directo. Se normaliza en extraerColumnasDelMapeo.
 */
export interface PlanMapeoInput {
  por_archivo?: Record<string, unknown>;
  mapeo_propuesto?: { por_archivo?: Record<string, unknown> };
  columnas?: ColumnaMapeoInput[];
  // Opcional: info de vinculación entre archivos. Usado por
  // suprimirDudososDeApellidoVinculado para saber si un archivo "hijo" (ej
  // hoja "Pólizas") está referenciando clientes del "maestro" por DNI.
  vinculacion_detectada?: {
    tipo?: string;
    archivo_maestro?: string;
    archivo_hijo?: string;
  } | null;
}

interface CatalogoConMetadata {
  id: string;
  nombre: string;
  codigo: string;
  metadata: JSONObject | null;
}

// Campos críticos de póliza que NO se auto-actualizan en incremental
// aunque aparezcan con cambios — deben pasar por revisión explícita.
export const CAMPOS_POLIZA_CRITICOS = new Set<string>([
  'estado',
  'fecha_inicio',
  'fecha_fin',
  'asegurado_id',
  'compania_id',
]);

// ============================================================================
// HELPERS: contexto CRM
// ============================================================================

export async function cargarContextoCRM(): Promise<ContextoCRM> {
  const supa = getSupabaseAdmin();
  const { data: tipos } = await supa.from('tipo_catalogo').select('id, codigo');

  const tiposRows = (tipos || []) as Array<{ id: number; codigo: string }>;
  const idCompania = tiposRows.find((t) => t.codigo === 'COMPANIA')?.id;
  const idRamo = tiposRows.find((t) => t.codigo === 'RAMO')?.id;
  const idCobertura = tiposRows.find((t) => t.codigo === 'COBERTURA')?.id;

  const companias: ContextoCRM['companias'] = [];
  const ramos: ContextoCRM['ramos'] = [];
  const coberturas: ContextoCRM['coberturas'] = [];

  if (idCompania) {
    const { data } = await supa
      .from('catalogos')
      .select('id, codigo, nombre, metadata')
      .eq('tipo_id', idCompania)
      .eq('activo', true);
    const rows = (data || []) as CatalogoConMetadata[];
    rows.forEach((c) => {
      const meta: JSONObject = c.metadata ?? {};
      let equivalencias: string[] = [];
      const eqRaw = meta.equivalencias;
      if (Array.isArray(eqRaw)) {
        equivalencias = eqRaw.map((x) => String(x));
      } else if (eqRaw && typeof eqRaw === 'object') {
        equivalencias = Object.values(eqRaw as Record<string, unknown>).map((x) => String(x));
      }
      companias.push({
        id: c.id,
        nombre: c.nombre,
        codigo: c.codigo,
        equivalencias,
      });
    });
  }

  if (idRamo) {
    const { data } = await supa
      .from('catalogos')
      .select('id, codigo, nombre, metadata')
      .eq('tipo_id', idRamo)
      .eq('activo', true);
    const rows = (data || []) as CatalogoConMetadata[];
    rows.forEach((r) => {
      const meta: JSONObject = r.metadata ?? {};
      ramos.push({
        id: r.id,
        nombre: r.nombre,
        codigo: r.codigo,
        tipo_riesgo: (meta.tipo_riesgo as string) || 'generico',
      });
    });
  }

  if (idCobertura) {
    const { data } = await supa
      .from('catalogos')
      .select('id, codigo, nombre, metadata')
      .eq('tipo_id', idCobertura)
      .eq('activo', true);
    const rows = (data || []) as CatalogoConMetadata[];
    rows.forEach((c) => {
      const meta: JSONObject = c.metadata ?? {};
      const ramoIdsRaw = meta.ramo_ids;
      const ramo_ids = Array.isArray(ramoIdsRaw)
        ? ramoIdsRaw.map((x) => String(x))
        : [];
      // Las equivalencias de cobertura son objetos { compania_id, nombre_comercial }
      // — de ahí sacamos los nombres comerciales para matchear.
      let equivalencias: string[] = [];
      const eqRaw = meta.equivalencias;
      if (Array.isArray(eqRaw)) {
        for (const e of eqRaw) {
          if (e && typeof e === 'object') {
            const nc = (e as Record<string, unknown>).nombre_comercial;
            if (typeof nc === 'string' && nc.trim()) equivalencias.push(nc);
          } else if (typeof e === 'string' && e.trim()) {
            equivalencias.push(e);
          }
        }
      }
      coberturas.push({
        id: c.id,
        nombre: c.nombre,
        codigo: c.codigo,
        ramo_ids,
        equivalencias,
      });
    });
  }

  return { companias, ramos, coberturas };
}

// ============================================================================
// HELPERS: mapeo y extracción
// ============================================================================

export function extraerColumnasDelMapeo(
  mapeo: PlanMapeoInput | null | undefined,
  archivoOrigen: string,
  headers: string[]
): ColumnaMapeada[] {
  // `mapeo` puede ser el plan confirmado completo, o un objeto con columnas directamente.
  // Intentamos resolver por archivo.
  let archivoMapeo: PlanMapeoPorArchivo | undefined;

  if (mapeo?.por_archivo && typeof mapeo.por_archivo === 'object') {
    archivoMapeo = mapeo.por_archivo[archivoOrigen] as PlanMapeoPorArchivo | undefined;
  } else if (mapeo?.mapeo_propuesto?.por_archivo) {
    archivoMapeo = mapeo.mapeo_propuesto.por_archivo[archivoOrigen] as PlanMapeoPorArchivo | undefined;
  } else if (Array.isArray(mapeo?.columnas)) {
    archivoMapeo = mapeo as PlanMapeoPorArchivo;
  } else if (mapeo && typeof mapeo === 'object' && archivoOrigen in mapeo) {
    archivoMapeo = (mapeo as Record<string, unknown>)[archivoOrigen] as PlanMapeoPorArchivo;
  }

  if (!archivoMapeo || !Array.isArray(archivoMapeo.columnas)) {
    // Fallback: mapeo vacío → todas las columnas ignoradas
    return headers.map((h, i) => ({ indice: i, header: h, campo_crm: null }));
  }

  return archivoMapeo.columnas.map((c) => ({
    indice: Number(c.indice) || 0,
    header: String(c.header || ''),
    campo_crm:
      c.campo_crm === 'ignorar' || c.campo_crm == null
        ? null
        : String(c.campo_crm),
  }));
}

function setEntidad(
  entidades: EntidadesRegistro,
  campoCrm: string,
  valor: CeldaValor
): void {
  const [entidad, campo] = campoCrm.split('.');
  if (!entidad || !campo) return;
  if (valor === null || valor === undefined || valor === '') return;

  if (entidad === 'persona') {
    if (!entidades.persona) entidades.persona = {} as PersonaImportada;
    (entidades.persona as Record<string, unknown>)[campo] = valor;
  } else if (entidad === 'poliza') {
    if (!entidades.poliza) entidades.poliza = {} as PolizaImportada;
    (entidades.poliza as Record<string, unknown>)[campo] = valor;
  } else if (entidad === 'riesgo') {
    if (!entidades.riesgo) entidades.riesgo = {} as RiesgoImportado;
    (entidades.riesgo as Record<string, unknown>)[campo] = valor;
  }
}

/**
 * Detecta columnas distintas del archivo que apuntan al MISMO campo_crm.
 * Cuando ocurre, `setEntidad` aplica silenciosamente el último valor y los
 * datos previos se pierden. Devuelve los grupos con más de una columna para
 * que el caller emita advertencias visibles.
 */
function detectarMapeosDuplicados(
  columnas: ColumnaMapeada[],
): Array<{ campo_crm: string; columnas: string[] }> {
  const mapa = new Map<string, string[]>();
  for (const col of columnas) {
    if (!col.campo_crm) continue;
    const clave = col.campo_crm;
    const lista = mapa.get(clave) || [];
    const etiqueta = col.header ? `"${col.header}" (col ${col.indice + 1})` : `col ${col.indice + 1}`;
    lista.push(etiqueta);
    mapa.set(clave, lista);
  }
  const duplicados: Array<{ campo_crm: string; columnas: string[] }> = [];
  for (const [campo, lista] of Array.from(mapa.entries())) {
    if (lista.length > 1) duplicados.push({ campo_crm: campo, columnas: lista });
  }
  return duplicados;
}

export function aplicarMapeoAFila(
  fila: FilaOriginal,
  columnas: ColumnaMapeada[]
): EntidadesRegistro {
  const entidades: EntidadesRegistro = {
    persona: null,
    poliza: null,
    riesgo: null,
  };

  for (const col of columnas) {
    if (!col.campo_crm) continue;
    const valor = fila[col.indice];
    setEntidad(entidades, col.campo_crm, valor);
  }

  return entidades;
}

// ============================================================================
// HELPERS: validación técnica
// ============================================================================

function normalizar(s: unknown): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function validarEntidades(reg: RegistroProcesado): void {
  const { persona, poliza, riesgo } = reg.entidades;

  // --- persona ---
  if (persona) {
    if (persona.dni_cuil) {
      const r = validarDNI(persona.dni_cuil);
      if (!r.valido) {
        // Tal vez sea CUIT
        const rC = validarCUIT(persona.dni_cuil);
        if (rC.valido) {
          persona.dni_cuil = rC.normalizado ?? persona.dni_cuil;
        } else {
          reg.problemas.push({
            tipo_entidad: 'PERSONA',
            tipo_problema: 'DNI_INVALIDO',
            descripcion: r.motivo || 'DNI/CUIT inválido',
            campo: 'dni_cuil',
            valor_original: persona.dni_cuil,
          });
        }
      } else {
        persona.dni_cuil = r.normalizado ?? persona.dni_cuil;
      }
    } else {
      reg.problemas.push({
        tipo_entidad: 'PERSONA',
        tipo_problema: 'DNI_FALTANTE',
        descripcion: 'Falta DNI/CUIL del asegurado',
        campo: 'dni_cuil',
      });
    }

    if (persona.email) {
      const r = validarEmail(persona.email);
      if (!r.valido) {
        reg.problemas.push({
          tipo_entidad: 'PERSONA',
          tipo_problema: 'EMAIL_INVALIDO',
          descripcion: 'Email con formato inválido',
          campo: 'email',
          valor_original: persona.email,
        });
      } else {
        persona.email = r.normalizado ?? persona.email;
      }
    }

    if (persona.telefono) {
      const r = validarTelefono(persona.telefono);
      if (r.valido && r.normalizado) persona.telefono = r.normalizado;
    }
    if (persona.whatsapp) {
      const r = validarTelefono(persona.whatsapp);
      if (r.valido && r.normalizado) persona.whatsapp = r.normalizado;
    }

    if (!persona.apellido && !persona.razon_social) {
      reg.problemas.push({
        tipo_entidad: 'PERSONA',
        tipo_problema: 'DATOS_FALTANTES',
        descripcion: 'Falta apellido o razón social',
        campo: 'apellido',
      });
    }
  }

  // --- poliza ---
  if (poliza) {
    if (poliza.fecha_inicio) {
      const r = validarFecha(poliza.fecha_inicio);
      if (!r.valido) {
        reg.problemas.push({
          tipo_entidad: 'POLIZA',
          tipo_problema: 'FECHA_INVALIDA',
          descripcion: r.motivo || 'Fecha de inicio inválida',
          campo: 'fecha_inicio',
          valor_original: poliza.fecha_inicio,
        });
      } else if (r.fecha_iso) {
        poliza.fecha_inicio = r.fecha_iso;
      }
    }
    if (poliza.fecha_fin) {
      const r = validarFecha(poliza.fecha_fin);
      if (!r.valido) {
        reg.problemas.push({
          tipo_entidad: 'POLIZA',
          tipo_problema: 'FECHA_INVALIDA',
          descripcion: r.motivo || 'Fecha de fin inválida',
          campo: 'fecha_fin',
          valor_original: poliza.fecha_fin,
        });
      } else if (r.fecha_iso) {
        poliza.fecha_fin = r.fecha_iso;
      }
    }
    if (
      poliza.fecha_inicio &&
      poliza.fecha_fin &&
      typeof poliza.fecha_inicio === 'string' &&
      typeof poliza.fecha_fin === 'string' &&
      poliza.fecha_inicio > poliza.fecha_fin
    ) {
      reg.problemas.push({
        tipo_entidad: 'POLIZA',
        tipo_problema: 'INCONSISTENCIA_LOGICA',
        descripcion: 'fecha_inicio es posterior a fecha_fin',
        campo: 'fecha_inicio',
      });
    }

    for (const campoMonto of ['suma_asegurada'] as const) {
      const v = poliza[campoMonto];
      if (v !== undefined && v !== null && v !== '') {
        const r = validarMonto(v);
        if (!r.valido) {
          reg.problemas.push({
            tipo_entidad: 'POLIZA',
            tipo_problema: 'MONTO_INVALIDO',
            descripcion: r.motivo || `Monto inválido en ${campoMonto}`,
            campo: campoMonto,
            valor_original: v,
          });
        } else if (r.valor !== undefined) {
          poliza[campoMonto] = r.valor;
        }
      }
    }

    if (!poliza.numero_poliza) {
      reg.problemas.push({
        tipo_entidad: 'POLIZA',
        tipo_problema: 'DATOS_FALTANTES',
        descripcion: 'Falta número de póliza',
        campo: 'numero_poliza',
      });
    }
  }

  // --- riesgo ---
  if (riesgo) {
    if (riesgo.patente) {
      const r = validarPatente(String(riesgo.patente));
      if (!r.valido) {
        reg.problemas.push({
          tipo_entidad: 'RIESGO',
          tipo_problema: 'RIESGO_INCOMPLETO',
          descripcion: 'Patente con formato inválido',
          campo: 'patente',
          valor_original: riesgo.patente,
        });
      } else if (r.normalizado) {
        riesgo.patente = r.normalizado;
      }
    }
  }
}

// ============================================================================
// HELPERS: duplicados
// ============================================================================

function valoresIguales(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  // Fechas: normalizar a ISO YYYY-MM-DD
  if (
    typeof a === 'string' &&
    typeof b === 'string' &&
    /^\d{4}-\d{2}-\d{2}/.test(a) &&
    /^\d{4}-\d{2}-\d{2}/.test(b)
  ) {
    return a.slice(0, 10) === b.slice(0, 10);
  }
  // Numéricos
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && (typeof a === 'number' || typeof b === 'number')) {
    return na === nb;
  }
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

// Campos que la entidad "poliza" arrastra durante el procesamiento pero que
// no son columnas reales de la tabla polizas — sólo existen para trazar el
// texto original del archivo o para pasarse al matcher de catálogos. Hay que
// excluirlos del diff de incremental, o si no disparan falsos "ACTUALIZAR"
// y pueden romper la detección de RENOVACION_DETECTADA (que exige que el
// único cambio sea fecha_fin).
const CAMPOS_AUXILIARES_NO_COMPARABLES = new Set<string>([
  'compania',
  'compania_nombre',
  'ramo',
  'ramo_nombre',
  'cobertura',
]);

function compararEntidad(
  incoming: Record<string, unknown>,
  existente: Record<string, unknown>
): Record<string, { antes: unknown; despues: unknown }> {
  const cambios: Record<string, { antes: unknown; despues: unknown }> = {};
  for (const [campo, nuevo] of Object.entries(incoming)) {
    if (nuevo === null || nuevo === undefined || nuevo === '') continue;
    if (CAMPOS_AUXILIARES_NO_COMPARABLES.has(campo)) continue;
    const viejo = existente[campo];
    if (!valoresIguales(nuevo, viejo)) {
      cambios[campo] = { antes: viejo ?? null, despues: nuevo };
    }
  }
  return cambios;
}

/** Fila de persona existente — se usan sólo algunos campos conocidos. */
type PersonaDbRow = { id: string; dni_cuil: string } & Record<string, unknown>;
/** Fila de póliza existente — se usan sólo algunos campos conocidos. */
type PolizaDbRow = { id: string; numero_poliza: string; compania_id?: string | null } & Record<string, unknown>;

async function detectarDuplicadosCRM(
  registros: RegistroProcesado[],
  companiaIdDefault?: string,
  tipoImportacion: TipoImportacion = 'INICIAL'
): Promise<void> {
  const supa = getSupabaseAdmin();
  const esIncremental = tipoImportacion === 'INCREMENTAL';

  // Personas por DNI
  const dnis = Array.from(
    new Set(
      registros
        .map((r) => r.entidades.persona?.dni_cuil)
        .filter((d): d is string => typeof d === 'string' && d.length > 0)
    )
  );

  const personasExistentesById = new Map<string, PersonaDbRow>();

  if (dnis.length > 0) {
    try {
      const { data } = await supa
        .from('personas')
        .select(esIncremental ? '*' : 'id, dni_cuil')
        .in('dni_cuil', dnis);
      const mapa = new Map<string, PersonaDbRow>();
      const rows = (data || []) as unknown as PersonaDbRow[];
      rows.forEach((p) => {
        mapa.set(p.dni_cuil, p);
        personasExistentesById.set(p.id, p);
      });
      for (const reg of registros) {
        const d = reg.entidades.persona?.dni_cuil;
        if (typeof d === 'string' && mapa.has(d)) {
          const existente = mapa.get(d)!;
          reg.match_existente = reg.match_existente || {};
          reg.match_existente.persona_id = existente.id;

          if (esIncremental && reg.entidades.persona) {
            const cambios = compararEntidad(
              reg.entidades.persona as Record<string, unknown>,
              existente as Record<string, unknown>
            );
            reg.acciones = reg.acciones || {};
            if (Object.keys(cambios).length === 0) {
              reg.acciones.persona = 'SIN_CAMBIOS';
            } else {
              reg.acciones.persona = 'ACTUALIZAR';
              reg.acciones.cambios_persona = cambios;
            }
          }
        } else if (esIncremental && reg.entidades.persona) {
          reg.acciones = reg.acciones || {};
          reg.acciones.persona = 'CREAR';
        }
      }
    } catch {
      // ignorar error, seguimos sin match
    }
  }

  // Pólizas por numero_poliza
  const nros = Array.from(
    new Set(
      registros
        .map((r) => r.entidades.poliza?.numero_poliza)
        .filter((n): n is string => typeof n === 'string' && n.length > 0)
    )
  );

  if (nros.length > 0) {
    try {
      const { data } = await supa
        .from('polizas')
        .select(esIncremental ? '*' : 'id, numero_poliza, compania_id')
        .in('numero_poliza', nros);
      const mapa = new Map<string, PolizaDbRow>();
      const rows = (data || []) as unknown as PolizaDbRow[];
      rows.forEach((p) => {
        // Si hay default de compañía, sólo matcheo si coincide
        if (!companiaIdDefault || p.compania_id === companiaIdDefault) {
          mapa.set(p.numero_poliza, p);
        }
      });
      for (const reg of registros) {
        const n = reg.entidades.poliza?.numero_poliza;
        if (typeof n === 'string' && mapa.has(n)) {
          const existente = mapa.get(n)!;
          reg.match_existente = reg.match_existente || {};
          reg.match_existente.poliza_id = existente.id;

          if (esIncremental && reg.entidades.poliza) {
            const cambios = compararEntidad(
              reg.entidades.poliza as Record<string, unknown>,
              existente as Record<string, unknown>
            );
            reg.acciones = reg.acciones || {};
            if (Object.keys(cambios).length === 0) {
              reg.acciones.poliza = 'SIN_CAMBIOS';
            } else {
              // Detección de renovación: solo cambió fecha_fin y es posterior.
              // Si fecha_fin cambió pero hacia ATRÁS (despues < antes), es muy
              // probable que sea un error del archivo: la flaggeamos como
              // DUDOSA para que el PAS la revise en vez de sobreescribir la
              // fecha silenciosamente.
              const keys = Object.keys(cambios);
              const fechaFinCambia =
                'fecha_fin' in cambios &&
                typeof cambios.fecha_fin.antes === 'string' &&
                typeof cambios.fecha_fin.despues === 'string';
              const fechaFinHaciaAtras =
                fechaFinCambia &&
                (cambios.fecha_fin.despues as string) < (cambios.fecha_fin.antes as string);
              const soloFechaFinHaciaAdelante =
                keys.length === 1 && keys[0] === 'fecha_fin' &&
                fechaFinCambia &&
                (cambios.fecha_fin.despues as string) > (cambios.fecha_fin.antes as string);

              if (soloFechaFinHaciaAdelante) {
                reg.acciones.poliza = 'RENOVACION_DETECTADA';
              } else {
                reg.acciones.poliza = 'ACTUALIZAR';
              }

              if (fechaFinHaciaAtras) {
                reg.problemas.push({
                  tipo_entidad: 'POLIZA',
                  tipo_problema: 'FECHA_INVALIDA',
                  descripcion: `El archivo trae fecha_fin ${cambios.fecha_fin.despues} anterior a la actual ${cambios.fecha_fin.antes}. Revisá antes de actualizar.`,
                  campo: 'fecha_fin',
                  valor_original: String(cambios.fecha_fin.despues),
                });
              }
              reg.acciones.cambios_poliza = cambios;
            }
          } else {
            // Flujo INICIAL: el duplicado es problema
            reg.problemas.push({
              tipo_entidad: 'POLIZA',
              tipo_problema: 'DUPLICADO_EN_CRM',
              descripcion: `Póliza ${n} ya existe en el CRM`,
              campo: 'numero_poliza',
              valor_original: n,
            });
          }
        } else if (esIncremental && reg.entidades.poliza) {
          reg.acciones = reg.acciones || {};
          reg.acciones.poliza = 'CREAR';
        }
      }
    } catch {
      // ignorar
    }
  }
}

function detectarDuplicadosEnArchivo(registros: RegistroProcesado[]): void {
  // Agrupar por valor primero para poder marcar TODAS las ocurrencias cuando
  // hay más de una (antes: sólo se marcaba la 2ª+, y la primera nunca se
  // marcaba aunque fuera obviamente ambigua).
  const dniGrupos = new Map<string, RegistroProcesado[]>();
  const polGrupos = new Map<string, RegistroProcesado[]>();

  for (const reg of registros) {
    const d = reg.entidades.persona?.dni_cuil;
    if (typeof d === 'string' && d.length > 0) {
      const lista = dniGrupos.get(d) || [];
      lista.push(reg);
      dniGrupos.set(d, lista);
    }
    const n = reg.entidades.poliza?.numero_poliza;
    if (typeof n === 'string' && n.length > 0) {
      const lista = polGrupos.get(n) || [];
      lista.push(reg);
      polGrupos.set(n, lista);
    }
  }

  for (const [dni, lista] of Array.from(dniGrupos.entries())) {
    if (lista.length < 2) continue;
    const filas = lista.map((r) => r.numero_fila_archivo);
    for (const reg of lista) {
      const otras = filas.filter((f) => f !== reg.numero_fila_archivo);
      reg.problemas.push({
        tipo_entidad: 'PERSONA',
        tipo_problema: 'DUPLICADO_EN_ARCHIVO',
        descripcion:
          otras.length === 1
            ? `DNI ${dni} también aparece en fila ${otras[0]}`
            : `DNI ${dni} aparece ${lista.length} veces (filas ${filas.join(', ')})`,
        campo: 'dni_cuil',
        valor_original: dni,
      });
    }
  }

  for (const [numero, lista] of Array.from(polGrupos.entries())) {
    if (lista.length < 2) continue;
    const filas = lista.map((r) => r.numero_fila_archivo);
    for (const reg of lista) {
      const otras = filas.filter((f) => f !== reg.numero_fila_archivo);
      reg.problemas.push({
        tipo_entidad: 'POLIZA',
        tipo_problema: 'DUPLICADO_EN_ARCHIVO',
        descripcion:
          otras.length === 1
            ? `Póliza ${numero} también aparece en fila ${otras[0]}`
            : `Póliza ${numero} aparece ${lista.length} veces (filas ${filas.join(', ')})`,
        campo: 'numero_poliza',
        valor_original: numero,
      });
    }
  }
}

/**
 * Elimina el dudoso DATOS_FALTANTES de apellido/razon_social cuando el PAS
 * no lo necesita resolver:
 *   - si la fila ya matcheó contra una persona existente en el CRM por DNI
 *     (match_existente.persona_id), no se crea persona nueva — el apellido es
 *     irrelevante.
 *   - si el plan declara una vinculación DNI entre archivos y este archivo es
 *     el hijo (ej hoja "Pólizas" que vincula con hoja "Clientes"), el apellido
 *     lo va a traer el maestro, no el hijo.
 *
 * Se ejecuta después de la detección de duplicados para poder consultar
 * match_existente.persona_id ya poblado.
 */
function suprimirDudososDeApellidoVinculado(
  registros: RegistroProcesado[],
  mapeo: PlanMapeoInput | null | undefined,
  archivoOrigen: string,
): void {
  // ¿Este archivo es el hijo de una vinculación DNI?
  const vinc =
    mapeo?.vinculacion_detectada ??
    (mapeo as { mapeo_propuesto?: { vinculacion_detectada?: unknown } } | null)
      ?.mapeo_propuesto?.vinculacion_detectada ??
    null;
  // PlanImportacion guarda vinculacion_detectada al top-level, pero aceptamos
  // ambas formas por seguridad.
  const esHijoDniVinculado = !!(
    vinc &&
    typeof vinc === 'object' &&
    (vinc as { tipo?: string }).tipo === 'DNI' &&
    (vinc as { archivo_hijo?: string }).archivo_hijo === archivoOrigen
  );

  for (const reg of registros) {
    const matchPersona = reg.match_existente?.persona_id;
    if (!matchPersona && !esHijoDniVinculado) continue;
    reg.problemas = reg.problemas.filter(
      (p) =>
        !(
          p.tipo_entidad === 'PERSONA' &&
          p.tipo_problema === 'DATOS_FALTANTES' &&
          (p.campo === 'apellido' || p.campo === 'razon_social')
        ),
    );
  }

  // En el archivo hijo de una vinculación DNI, el mismo DNI puede repetirse
  // legítimamente (varias pólizas del mismo cliente). DUPLICADO_EN_ARCHIVO
  // del DNI es ruido en ese caso: lo suprimimos. Los duplicados de
  // numero_poliza sí son problema real y no se tocan.
  if (esHijoDniVinculado) {
    for (const reg of registros) {
      reg.problemas = reg.problemas.filter(
        (p) =>
          !(
            p.tipo_entidad === 'PERSONA' &&
            p.tipo_problema === 'DUPLICADO_EN_ARCHIVO' &&
            p.campo === 'dni_cuil'
          ),
      );
    }
  }
}

// ============================================================================
// HELPERS: matching catálogos
// ============================================================================

function matchearCompania(
  nombre: string,
  ctx: ContextoCRM
): { id: string; nombre: string } | null {
  const norm = normalizar(nombre);
  if (!norm) return null;

  for (const c of ctx.companias) {
    if (normalizar(c.nombre) === norm) return { id: c.id, nombre: c.nombre };
    if (c.equivalencias?.some((e) => normalizar(e) === norm)) {
      return { id: c.id, nombre: c.nombre };
    }
  }
  return null;
}

function matchearRamo(
  nombre: string,
  ctx: ContextoCRM
): { id: string; nombre: string; tipo_riesgo: string } | null {
  const norm = normalizar(nombre);
  if (!norm) return null;
  // Pasada 1: match por NOMBRE. El nombre es lo que el PAS ve en la UI y es
  // la fuente de verdad. El código es un slug interno que puede tener sufijos
  // (`AUTO_2`, etc.) cuando hay colisiones — usar código como primer criterio
  // confunde casos donde "Auto" (cod AUTO_2) y "Moto" (cod AUTO) coexisten y
  // el archivo dice "Auto" → terminaría matcheando Moto.
  for (const r of ctx.ramos) {
    if (normalizar(r.nombre) === norm) {
      return { id: r.id, nombre: r.nombre, tipo_riesgo: r.tipo_riesgo };
    }
  }
  // Pasada 2: match por CÓDIGO (fallback para casos donde el archivo trae
  // el slug en vez del nombre comercial).
  for (const r of ctx.ramos) {
    if (normalizar(r.codigo) === norm) {
      return { id: r.id, nombre: r.nombre, tipo_riesgo: r.tipo_riesgo };
    }
  }
  return null;
}

/**
 * Matchea una cobertura del archivo contra el catálogo. Si se conoce el
 * ramo de la póliza, prioriza las coberturas cuyo metadata.ramo_ids lo
 * incluye (la misma semántica que aplica el form de nueva póliza al filtrar
 * coberturas por ramo). Si no hay ramo, cae a match global.
 *
 * Busca por nombre, código y equivalencias comerciales por compañía.
 */
function matchearCobertura(
  nombre: string,
  ctx: ContextoCRM,
  ramoId?: string | null,
): { id: string; nombre: string } | null {
  const norm = normalizar(nombre);
  if (!norm) return null;

  // Misma lógica de prioridad que matchearRamo: NOMBRE primero, después
  // equivalencias, después código (para evitar colisiones tipo "Auto"→cod
  // AUTO_2 vs "Moto"→cod AUTO).
  const coincidePorNombre = (c: (typeof ctx.coberturas)[number]) =>
    normalizar(c.nombre) === norm;
  const coincidePorEquivalencia = (c: (typeof ctx.coberturas)[number]) =>
    c.equivalencias?.some((e) => normalizar(e) === norm) ?? false;
  const coincidePorCodigo = (c: (typeof ctx.coberturas)[number]) =>
    normalizar(c.codigo) === norm;

  // Acumulamos las pasadas para ejecutarlas en orden de prioridad.
  // Para cada criterio probamos primero contra las del ramo (si hay ramoId)
  // y luego match global.
  const criterios: Array<(c: (typeof ctx.coberturas)[number]) => boolean> = [
    coincidePorNombre,
    coincidePorEquivalencia,
    coincidePorCodigo,
  ];

  for (const criterio of criterios) {
    if (ramoId) {
      for (const c of ctx.coberturas) {
        if (!c.ramo_ids.includes(ramoId)) continue;
        if (criterio(c)) return { id: c.id, nombre: c.nombre };
      }
    }
    for (const c of ctx.coberturas) {
      if (criterio(c)) return { id: c.id, nombre: c.nombre };
    }
  }
  return null;
}

function matchearCatalogoSimple(
  nombre: string,
  lista: Array<{ id: string; nombre: string; codigo: string }>,
): { id: string; nombre: string } | null {
  const norm = normalizar(nombre);
  if (!norm) return null;
  // Nombre primero, después código (mismo principio que matchearRamo).
  for (const x of lista) {
    if (normalizar(x.nombre) === norm) {
      return { id: x.id, nombre: x.nombre };
    }
  }
  for (const x of lista) {
    if (normalizar(x.codigo) === norm) {
      return { id: x.id, nombre: x.nombre };
    }
  }
  return null;
}

function resolverCatalogos(
  registros: RegistroProcesado[],
  ctx: ContextoCRM,
  companiaIdDefault?: string
): void {
  for (const reg of registros) {
    const pol = reg.entidades.poliza;
    if (!pol) continue;

    // compañía
    if (pol.compania) {
      const m = matchearCompania(String(pol.compania), ctx);
      if (m) {
        pol.compania_id = m.id;
        pol.compania_nombre = m.nombre;
      } else {
        reg.problemas.push({
          tipo_entidad: 'POLIZA',
          tipo_problema: 'COMPANIA_NO_RECONOCIDA',
          descripcion: `Compañía "${pol.compania}" no coincide con el catálogo`,
          campo: 'compania',
          valor_original: pol.compania,
        });
      }
    } else if (companiaIdDefault) {
      pol.compania_id = companiaIdDefault;
    }

    // ramo
    if (pol.ramo) {
      const m = matchearRamo(String(pol.ramo), ctx);
      if (m) {
        pol.ramo_id = m.id;
        pol.ramo_nombre = m.nombre;
        if (reg.entidades.riesgo && !reg.entidades.riesgo.tipo_riesgo) {
          reg.entidades.riesgo.tipo_riesgo = m.tipo_riesgo;
        }
      } else {
        reg.problemas.push({
          tipo_entidad: 'POLIZA',
          tipo_problema: 'RAMO_NO_RECONOCIDO',
          descripcion: `Ramo "${pol.ramo}" no coincide con el catálogo`,
          campo: 'ramo',
          valor_original: pol.ramo,
        });
      }
    }

    // cobertura (filtrada por ramo cuando existe)
    if (pol.cobertura) {
      const m = matchearCobertura(String(pol.cobertura), ctx, pol.ramo_id);
      if (m) {
        pol.cobertura_id = m.id;
      } else {
        reg.problemas.push({
          tipo_entidad: 'POLIZA',
          tipo_problema: 'COBERTURA_NO_RECONOCIDA',
          descripcion: `Cobertura "${pol.cobertura}" no coincide con el catálogo`,
          campo: 'cobertura',
          valor_original: pol.cobertura,
        });
      }
    }

    // refacturación: ya no es catálogo, se normaliza al enum REFACTURACIONES.
    // Si el texto no matchea ninguno de los 7 valores válidos, queda como
    // dudoso y el PAS lo resuelve manualmente. Si matchea, lo guardamos en
    // mayúsculas snake (MENSUAL, PAGO_UNICO, ...).
    if (pol.refacturacion) {
      const normalizada = normalizarRefacturacion(String(pol.refacturacion));
      if (normalizada) {
        pol.refacturacion = normalizada;
      } else {
        reg.problemas.push({
          tipo_entidad: 'POLIZA',
          tipo_problema: 'REFACTURACION_NO_RECONOCIDA',
          descripcion: `Refacturación "${pol.refacturacion}" no coincide con ninguno de los 7 valores válidos`,
          campo: 'refacturacion',
          valor_original: pol.refacturacion,
        });
        // Limpiamos para no insertar un valor inválido y romper el CHECK constraint.
        pol.refacturacion = null;
      }
    }
  }
}

// ============================================================================
// HELPERS: IA condicional
// ============================================================================

interface CeldaComplejaCandidata {
  indice_registro: number;
  tipo_entidad: TipoEntidad;
  campo: string;
  valor: string;
}

interface ParseadoIA {
  indice: number;
  tipo_entidad: TipoEntidad;
  campo: string;
  parseado: JSONObject;
}

const PALABRAS_DIRECCION = /(localidad|provincia|departamento|\bdepto\b|\bdpto\b|\bpiso\b|\bcp\b|codigo\s*postal|bar{1,2}io)/i;

function contieneDigitos(v: string): boolean {
  return /\d/.test(v);
}

function contarDigitos(v: string): number {
  return (v.match(/\d/g) || []).length;
}

function detectarCeldasComplejas(
  registros: RegistroProcesado[],
  modo: ModoLimpiezaIA = 'NORMAL'
): CeldaComplejaCandidata[] {
  const out: CeldaComplejaCandidata[] = [];
  const agresivo = modo === 'AGRESIVO';

  const pushear = (
    i: number,
    tipo_entidad: TipoEntidad,
    campo: string,
    valor: string
  ) => {
    out.push({ indice_registro: i, tipo_entidad, campo, valor });
  };

  for (let i = 0; i < registros.length; i++) {
    const reg = registros[i];
    const persona = reg.entidades.persona;
    const poliza = reg.entidades.poliza;
    const riesgo = reg.entidades.riesgo;

    // ------ PERSONA: apellido/nombre pegados ------
    if (persona && persona.apellido && !persona.razon_social) {
      const v = String(persona.apellido).trim();
      const tokens = v.split(/\s+/);
      const sinNombre = !persona.nombre;
      // NORMAL: apellido con ≥2 tokens y nombre vacío
      // AGRESIVO: apellido con ≥3 tokens sin importar si nombre está lleno
      //           (cubre el caso donde ambos vienen mal cortados)
      if (
        (sinNombre && tokens.length >= 2) ||
        (agresivo && tokens.length >= 3)
      ) {
        pushear(i, 'PERSONA', 'apellido', v);
      }
    }

    if (persona && persona.nombre && !persona.razon_social) {
      const v = String(persona.nombre).trim();
      const tokens = v.split(/\s+/);
      const sinApellido = !persona.apellido;
      if (
        (sinApellido && tokens.length >= 2) ||
        (agresivo && tokens.length >= 3)
      ) {
        pushear(i, 'PERSONA', 'nombre', v);
      }
    }

    // ------ PERSONA: dirección pegada en `calle` ------
    if (persona && persona.calle) {
      const v = String(persona.calle).trim();
      const tieneComa = v.includes(',');
      const tienePalabraDireccion = PALABRAS_DIRECCION.test(v);
      const otrosCamposVacios =
        !persona.localidad && !persona.provincia && !persona.codigo_postal;
      const umbralLongitud = agresivo ? 20 : 30;
      // NORMAL: coma o palabra clave Y sin otros campos de dirección completos
      // AGRESIVO: también si es larga (≥20 chars) y tiene dígitos (probablemente nro+calle+más)
      if (
        (tieneComa || tienePalabraDireccion) &&
        (otrosCamposVacios || agresivo) &&
        v.length >= 8
      ) {
        pushear(i, 'PERSONA', 'calle', v);
      } else if (
        agresivo &&
        otrosCamposVacios &&
        v.length >= umbralLongitud &&
        contieneDigitos(v) &&
        v.split(/\s+/).length >= 4
      ) {
        pushear(i, 'PERSONA', 'calle', v);
      }
    }

    // ------ PERSONA: teléfono no parseable ------
    if (persona && persona.telefono) {
      const v = String(persona.telefono).trim();
      const validoTel = validarTelefono(v);
      if (!validoTel.valido && contarDigitos(v) >= 7) {
        // Siempre en NORMAL y AGRESIVO: si el validador no lo acepta pero tiene
        // suficientes dígitos, probablemente sea un formato raro (prefijo país,
        // guiones, espacios, paréntesis) que la IA puede normalizar.
        pushear(i, 'PERSONA', 'telefono', v);
      }
    }

    // ------ POLIZA: fechas no parseables ------
    if (poliza) {
      for (const campo of ['fecha_inicio', 'fecha_fin'] as const) {
        const raw = poliza[campo];
        if (raw == null || raw === '') continue;
        const v = String(raw).trim();
        if (!v) continue;
        const valida = validarFecha(v);
        if (!valida.valido && contieneDigitos(v) && v.length >= 6) {
          pushear(i, 'POLIZA', campo, v);
        }
      }

      // ------ POLIZA: suma asegurada no parseable ------
      if (poliza.suma_asegurada != null && poliza.suma_asegurada !== '') {
        const v = String(poliza.suma_asegurada).trim();
        const valido = validarMonto(v);
        if (!valido.valido && contieneDigitos(v)) {
          pushear(i, 'POLIZA', 'suma_asegurada', v);
        }
      }
    }

    // ------ RIESGO: marca/modelo/año juntos ------
    if (riesgo) {
      // Caso histórico: todo en descripcion_corta
      if (riesgo.descripcion_corta && !riesgo.marca && !riesgo.modelo) {
        const v = String(riesgo.descripcion_corta).trim();
        const tokens = v.split(/\s+/);
        const umbral = agresivo ? 2 : 3;
        if (tokens.length >= umbral) {
          pushear(i, 'RIESGO', 'descripcion_corta', v);
        }
      }

      // Caso nuevo: marca con varios tokens (probablemente contiene marca+modelo+año)
      if (riesgo.marca && !riesgo.modelo) {
        const v = String(riesgo.marca).trim();
        const tokens = v.split(/\s+/);
        const umbral = agresivo ? 2 : 3;
        if (tokens.length >= umbral) {
          pushear(i, 'RIESGO', 'marca', v);
        }
      }

      // Suma asegurada del riesgo no parseable
      if (riesgo.suma_asegurada != null && riesgo.suma_asegurada !== '') {
        const v = String(riesgo.suma_asegurada).trim();
        const valido = validarMonto(v);
        if (!valido.valido && contieneDigitos(v)) {
          pushear(i, 'RIESGO', 'suma_asegurada', v);
        }
      }
    }
  }

  return out;
}

async function parseoComplejoConIA(
  candidatas: CeldaComplejaCandidata[]
): Promise<{
  parseados: ParseadoIA[];
  tokens: number;
  costo: number;
  errorFatal?: { tipo: TipoError; mensaje: string };
}> {
  if (candidatas.length === 0) return { parseados: [], tokens: 0, costo: 0 };

  const prompt = `Parseá los siguientes valores de celdas en sus componentes estructurados.
Cada item tiene "tipo_entidad" + "campo" + "valor" — usá esos para decidir cómo parsear.

=== PERSONA.apellido o PERSONA.nombre ===
El valor es un nombre completo "APELLIDOS NOMBRES" del estilo argentino.
Devolvé: { "apellido": "...", "nombre": "..." }
Convención: los primeros 1-2 tokens son apellido(s), el resto nombre(s).
Apellidos compuestos con partículas ("DE LA", "DEL", "VAN DER", "DA SILVA"):
la partícula forma parte del apellido.
Ejemplos:
  "BARRIOS RUIZ CINTHYA MAGALI" → { "apellido": "BARRIOS RUIZ", "nombre": "CINTHYA MAGALI" }
  "GARCIA JUAN" → { "apellido": "GARCIA", "nombre": "JUAN" }
  "DE LA CRUZ MARIA FERNANDA" → { "apellido": "DE LA CRUZ", "nombre": "MARIA FERNANDA" }
Si es solo un apellido (1 token) o solo un nombre, devolvé lo que corresponda y "" en el otro.

=== PERSONA.calle ===
Dirección completa mezclada en un solo campo. Devolvé:
{ "calle": "...", "numero": "...", "piso_depto": "...", "barrio": "...",
  "localidad": "...", "provincia": "...", "codigo_postal": "..." }
Solo incluí las claves que puedas identificar; el resto dejalo como "".
Ejemplos:
  "AV. SAN MARTIN 1234, DPTO 5B, CABA, 1425" →
    { "calle": "AV. SAN MARTIN", "numero": "1234", "piso_depto": "DPTO 5B",
      "localidad": "CABA", "provincia": "", "codigo_postal": "1425" }
  "Belgrano 450 Piso 3 B Rosario Santa Fe" →
    { "calle": "Belgrano", "numero": "450", "piso_depto": "Piso 3 B",
      "localidad": "Rosario", "provincia": "Santa Fe", "codigo_postal": "" }

=== PERSONA.telefono ===
Normalizá el teléfono a formato argentino E.164 si es posible (+54...).
Si no hay suficiente info para asumir +54, devolvé solo los dígitos.
Devolvé: { "telefono": "..." }
Ejemplos:
  "(011) 4555-6789" → { "telefono": "+541145556789" }
  "11 5555 6666" → { "telefono": "+541155556666" }
  "cel: 2215123456 / casa 2214999111" → { "telefono": "+542215123456" }  (tomar el primero)

=== POLIZA.fecha_inicio o POLIZA.fecha_fin ===
Parseá la fecha a formato ISO YYYY-MM-DD. Si es ambigua (ej: "01/02/2025"),
asumí formato argentino DD/MM/YYYY.
Devolvé: { "fecha": "YYYY-MM-DD" }
Ejemplos:
  "15/03/2025" → { "fecha": "2025-03-15" }
  "5-ene-26" → { "fecha": "2026-01-05" }
  "Marzo 2025" → { "fecha": "" }  (mes sin día → no parsear)

=== POLIZA.suma_asegurada o RIESGO.suma_asegurada ===
Extraé el monto numérico, ignorando símbolos de moneda, puntos de miles y
convirtiendo coma decimal a punto si aplica.
Devolvé: { "monto": <numero>, "moneda": "ARS" | "USD" | "" }
Ejemplos:
  "$ 1.250.000,50" → { "monto": 1250000.50, "moneda": "ARS" }
  "USD 10.500" → { "monto": 10500, "moneda": "USD" }
  "AR$2500000" → { "monto": 2500000, "moneda": "ARS" }

=== RIESGO.descripcion_corta o RIESGO.marca (auto) ===
Descomponé en marca / modelo / año.
Devolvé: { "marca": "...", "modelo": "...", "anio": <numero o ""> }
Ejemplos:
  "FORD FIESTA KINETIC 2018" → { "marca": "FORD", "modelo": "FIESTA KINETIC", "anio": 2018 }
  "VW GOL TREND 1.6 2020" → { "marca": "VW", "modelo": "GOL TREND 1.6", "anio": 2020 }

===========
Input JSON:
${JSON.stringify(candidatas, null, 2)}

Respondé SOLO con un JSON con esta forma exacta:
{ "parseados": [ { "indice": <numero>, "parseado": { ... } } ] }

El "indice" debe ser el "indice_registro" del input. No incluyas explicaciones.`;

  try {
    const resp = await llamarClaude({
      prompt,
      max_tokens: 2048,
      temperature: 0,
      response_format: 'json',
    });

    if (!resp.ok) {
      const errorFatal = esErrorPermanente(resp.error?.tipo)
        ? { tipo: resp.error!.tipo, mensaje: resp.error!.mensaje }
        : undefined;
      return {
        parseados: [],
        tokens: resp.tokens_total || 0,
        costo: resp.costo_estimado_usd || 0,
        errorFatal,
      };
    }

    let json: JSONObject | null = (resp.json as JSONObject) ?? null;
    if (!json && typeof resp.data === 'string') {
      try {
        json = JSON.parse(resp.data.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '')) as JSONObject;
      } catch {
        return { parseados: [], tokens: resp.tokens_total || 0, costo: resp.costo_estimado_usd || 0 };
      }
    }

    const parseados: ParseadoIA[] = [];

    const jsonParseados = json && Array.isArray((json as { parseados?: unknown }).parseados)
      ? ((json as { parseados: unknown[] }).parseados)
      : [];
    for (const pRaw of jsonParseados) {
      const p = pRaw as { indice?: unknown; parseado?: unknown };
      if (typeof p.indice !== 'number' || !p.parseado) continue;
      const candidata = candidatas.find((c) => c.indice_registro === p.indice);
      if (!candidata) continue;
      parseados.push({
        indice: p.indice,
        tipo_entidad: candidata.tipo_entidad,
        campo: candidata.campo,
        parseado: p.parseado as JSONObject,
      });
    }

    return {
      parseados,
      tokens: resp.tokens_total || 0,
      costo: resp.costo_estimado_usd || 0,
    };
  } catch {
    return { parseados: [], tokens: 0, costo: 0 };
  }
}

interface SugerenciaAmbigua {
  indice_registro: number;
  tipo_problema: TipoProblema;
  valor: string;
  candidatos: string[];
}

async function sugerenciasCorreccionConIA(
  ambiguas: SugerenciaAmbigua[]
): Promise<{
  sugerencias: Array<{ indice: number; propuesta: string }>;
  tokens: number;
  costo: number;
  errorFatal?: { tipo: TipoError; mensaje: string };
}> {
  if (ambiguas.length === 0) return { sugerencias: [], tokens: 0, costo: 0 };

  const prompt = `Tengo valores ambiguos que deben ser corregidos a uno de los candidatos del catálogo.

Input:
${JSON.stringify(ambiguas, null, 2)}

Para cada entry, devolvé la mejor propuesta entre los candidatos (o cadena vacía si ninguno razonable).

Respuesta JSON: { "sugerencias": [ { "indice": <numero>, "propuesta": "<nombre candidato>" } ] }`;

  try {
    const resp = await llamarClaude({
      prompt,
      max_tokens: 2048,
      temperature: 0,
      response_format: 'json',
    });

    if (!resp.ok) {
      const errorFatal = esErrorPermanente(resp.error?.tipo)
        ? { tipo: resp.error!.tipo, mensaje: resp.error!.mensaje }
        : undefined;
      return {
        sugerencias: [],
        tokens: resp.tokens_total || 0,
        costo: resp.costo_estimado_usd || 0,
        errorFatal,
      };
    }

    let json: JSONObject | null = (resp.json as JSONObject) ?? null;
    if (!json && typeof resp.data === 'string') {
      try {
        json = JSON.parse(resp.data.trim().replace(/^```json\s*/i, '').replace(/```\s*$/i, '')) as JSONObject;
      } catch {
        return { sugerencias: [], tokens: resp.tokens_total || 0, costo: resp.costo_estimado_usd || 0 };
      }
    }

    const sugerencias: Array<{ indice: number; propuesta: string }> = [];
    const arr = json && Array.isArray((json as { sugerencias?: unknown }).sugerencias)
      ? ((json as { sugerencias: unknown[] }).sugerencias)
      : [];
    for (const sRaw of arr) {
      const s = sRaw as { indice?: unknown; propuesta?: unknown };
      if (typeof s.indice === 'number' && typeof s.propuesta === 'string') {
        sugerencias.push({ indice: s.indice, propuesta: s.propuesta });
      }
    }

    return {
      sugerencias,
      tokens: resp.tokens_total || 0,
      costo: resp.costo_estimado_usd || 0,
    };
  } catch {
    return { sugerencias: [], tokens: 0, costo: 0 };
  }
}

// ============================================================================
// FUNCIÓN PRINCIPAL
// ============================================================================

export async function procesarLote(params: {
  lote_id: string;
  importacion_id: string;
  registros: FilaOriginal[];
  headers: string[];
  archivo_origen: string;
  mapeo: PlanMapeoInput | null | undefined;
  compania_id_default?: string;
  contexto_crm: ContextoCRM;
  tipo_importacion?: TipoImportacion;
  modo_limpieza_ia?: ModoLimpiezaIA;
}): Promise<{
  ok: boolean;
  registros_procesados: RegistroProcesado[];
  registros_listos: number;
  registros_dudosos: number;
  tokens_usados: number;
  costo_usd: number;
  error?: string;
}> {
  try {
    const columnas = extraerColumnasDelMapeo(params.mapeo, params.archivo_origen, params.headers);

    // 0. Detectar columnas que mapean al mismo campo_crm. Si dos columnas
    // apuntan al mismo campo, `setEntidad` aplica la ÚLTIMA silenciosamente
    // y el PAS no se entera. Emitimos warning al nivel del lote para que el
    // PAS lo vea en los errores de la importación.
    const mapeoDuplicado = detectarMapeosDuplicados(columnas);
    const advertenciasMapeo: string[] = [];
    if (mapeoDuplicado.length > 0) {
      for (const dup of mapeoDuplicado) {
        advertenciasMapeo.push(
          `En el archivo "${params.archivo_origen}" hay ${dup.columnas.length} columnas mapeadas al mismo campo "${dup.campo_crm}" (${dup.columnas.join(', ')}). Sólo la última toma efecto.`,
        );
      }
    }

    // 1. Mapeo + normalización + validación técnica
    //
    // La normalización corre ANTES de la validación y de la detección de
    // duplicados para garantizar:
    //   - Que en INCREMENTAL "JUAN PEREZ" (archivo) no marque cambio contra
    //     "Juan Perez" (CRM) y termine disparando un UPDATE innecesario.
    //   - Que los registros dudosos se muestren prolijos al PAS.
    //   - Que los INSERT finales queden bien sin pasar por otra normalización.
    const procesados: RegistroProcesado[] = params.registros.map((fila, idx) => {
      const entidades = normalizarEntidadesRegistro(aplicarMapeoAFila(fila, columnas));
      const reg: RegistroProcesado = {
        numero_fila_archivo: idx + 1,
        archivo_origen: params.archivo_origen,
        entidades,
        clasificacion: 'LISTO',
        problemas: [],
      };
      validarEntidades(reg);
      return reg;
    });

    // Si hubo colisiones de mapeo, las empujamos como problema "OTROS" al
    // primer registro del lote para que aparezcan en la revisión del PAS.
    if (advertenciasMapeo.length > 0 && procesados.length > 0) {
      for (const adv of advertenciasMapeo) {
        procesados[0].problemas.push({
          tipo_entidad: 'PERSONA',
          tipo_problema: 'OTROS',
          descripcion: adv,
        });
      }
    }

    // 2. Matching de catálogos (compañía / ramo)
    resolverCatalogos(procesados, params.contexto_crm, params.compania_id_default);

    // 3. Detección de duplicados (CRM y archivo)
    detectarDuplicadosEnArchivo(procesados);
    await detectarDuplicadosCRM(
      procesados,
      params.compania_id_default,
      params.tipo_importacion || 'INICIAL'
    );

    // 3b. Supresión de dudosos redundantes
    //
    // El validador marca "falta apellido/razon_social" cuando una fila trae
    // dni_cuil pero no nombre. Eso es señal legítima cuando el registro
    // representa un cliente nuevo. PERO hay dos escenarios donde ese dudoso
    // es ruido:
    //   a) El DNI ya existe en el CRM: no vamos a crear persona nueva, sólo
    //      vincular la póliza al cliente existente.
    //   b) El plan tiene vinculacion_detectada por DNI y este archivo es el
    //      hijo (típico: hoja "Pólizas" que referencia a hoja "Clientes" del
    //      mismo Excel por DNI). Los datos del cliente viven en el archivo
    //      maestro; no tiene sentido pedírselos al PAS en el hijo.
    suprimirDudososDeApellidoVinculado(procesados, params.mapeo, params.archivo_origen);

    // 4. Llamadas a IA condicionales (máximo 2 por lote)
    let tokensIA = 0;
    let costoIA = 0;

    // 4a. Parseo complejo
    const modoIA: ModoLimpiezaIA = params.modo_limpieza_ia === 'AGRESIVO' ? 'AGRESIVO' : 'NORMAL';
    const complejas = detectarCeldasComplejas(procesados, modoIA);
    if (complejas.length > 0) {
      const { parseados, tokens, costo, errorFatal } = await parseoComplejoConIA(complejas);
      tokensIA += tokens;
      costoIA += costo;
      if (errorFatal) {
        return {
          ok: false,
          registros_procesados: [],
          registros_listos: 0,
          registros_dudosos: 0,
          tokens_usados: tokensIA,
          costo_usd: costoIA,
          error: marcarErrorFatal(errorFatal.tipo, errorFatal.mensaje),
        };
      }

      for (const p of parseados) {
        const reg = procesados[p.indice];
        if (!reg) continue;
        const parseado = p.parseado;

        if (p.tipo_entidad === 'PERSONA' && reg.entidades.persona) {
          const persona = reg.entidades.persona;

          if (p.campo === 'apellido' || p.campo === 'nombre') {
            const apParseado = parseado.apellido ? String(parseado.apellido).trim() : '';
            const nomParseado = parseado.nombre ? String(parseado.nombre).trim() : '';
            // Si se logró dividir en apellido Y nombre, sobrescribir ambos.
            // Necesario cuando el valor original estaba en `nombre`
            // (ej: "BARRIOS RUIZ CINTHYA MAGALI" → apellido=BARRIOS RUIZ, nombre=CINTHYA MAGALI).
            if (apParseado) persona.apellido = apParseado;
            if (nomParseado) persona.nombre = nomParseado;
            if (persona.apellido) {
              reg.problemas = reg.problemas.filter(
                (pr) =>
                  !(
                    pr.tipo_entidad === 'PERSONA' &&
                    pr.tipo_problema === 'DATOS_FALTANTES' &&
                    pr.campo === 'apellido'
                  ),
              );
            }
          } else if (p.campo === 'calle') {
            // Dirección descompuesta. Solo pisamos los campos vacíos, nunca
            // sobrescribimos localidad/provincia si el PAS ya las tenía.
            const nuevoCalle = parseado.calle ? String(parseado.calle).trim() : '';
            if (nuevoCalle) persona.calle = nuevoCalle;
            if (parseado.numero && !persona.numero) persona.numero = String(parseado.numero).trim();
            if (parseado.piso_depto && !persona.piso_depto) persona.piso_depto = String(parseado.piso_depto).trim();
            if (parseado.barrio && !persona.barrio) persona.barrio = String(parseado.barrio).trim();
            if (parseado.localidad && !persona.localidad) persona.localidad = String(parseado.localidad).trim();
            if (parseado.provincia && !persona.provincia) persona.provincia = String(parseado.provincia).trim();
            if (parseado.codigo_postal && !persona.codigo_postal) persona.codigo_postal = String(parseado.codigo_postal).trim();
          } else if (p.campo === 'telefono') {
            const nuevo = parseado.telefono ? String(parseado.telefono).trim() : '';
            if (nuevo) {
              persona.telefono = nuevo;
              // Limpiar problema previo si ahora es válido
              reg.problemas = reg.problemas.filter(
                (pr) =>
                  !(
                    pr.tipo_entidad === 'PERSONA' &&
                    pr.campo === 'telefono'
                  ),
              );
            }
          }
        } else if (p.tipo_entidad === 'POLIZA' && reg.entidades.poliza) {
          const poliza = reg.entidades.poliza;

          if (p.campo === 'fecha_inicio' || p.campo === 'fecha_fin') {
            const nueva = parseado.fecha ? String(parseado.fecha).trim() : '';
            if (nueva && /^\d{4}-\d{2}-\d{2}$/.test(nueva)) {
              poliza[p.campo] = nueva;
              reg.problemas = reg.problemas.filter(
                (pr) =>
                  !(
                    pr.tipo_entidad === 'POLIZA' &&
                    pr.tipo_problema === 'FECHA_INVALIDA' &&
                    pr.campo === p.campo
                  ),
              );
            }
          } else if (p.campo === 'suma_asegurada') {
            const nuevoMonto = typeof parseado.monto === 'number' ? parseado.monto : Number(parseado.monto);
            if (!Number.isNaN(nuevoMonto) && Number.isFinite(nuevoMonto)) {
              poliza.suma_asegurada = nuevoMonto;
              if (parseado.moneda && !poliza.moneda) poliza.moneda = String(parseado.moneda);
              reg.problemas = reg.problemas.filter(
                (pr) =>
                  !(
                    pr.tipo_entidad === 'POLIZA' &&
                    pr.tipo_problema === 'MONTO_INVALIDO' &&
                    pr.campo === 'suma_asegurada'
                  ),
              );
            }
          }
        } else if (p.tipo_entidad === 'RIESGO' && reg.entidades.riesgo) {
          const riesgo = reg.entidades.riesgo;

          if (p.campo === 'descripcion_corta' || p.campo === 'marca') {
            if (parseado.marca) riesgo.marca = String(parseado.marca);
            if (parseado.modelo) riesgo.modelo = String(parseado.modelo);
            if (parseado.anio) riesgo.anio = parseado.anio as string | number;
          } else if (p.campo === 'suma_asegurada') {
            const nuevoMonto = typeof parseado.monto === 'number' ? parseado.monto : Number(parseado.monto);
            if (!Number.isNaN(nuevoMonto) && Number.isFinite(nuevoMonto)) {
              riesgo.suma_asegurada = nuevoMonto;
              reg.problemas = reg.problemas.filter(
                (pr) =>
                  !(
                    pr.tipo_entidad === 'RIESGO' &&
                    pr.tipo_problema === 'MONTO_INVALIDO' &&
                    pr.campo === 'suma_asegurada'
                  ),
              );
            }
          }
        }
      }

      // Re-normalizar los registros que fueron tocados por el parseo IA.
      // El IA puede devolver valores en mayúsculas (ej: "BARRIOS RUIZ"),
      // así que re-aplicamos la normalización para que persona.apellido,
      // riesgo.marca, etc. queden en Title Case. Es idempotente.
      const indicesTocados = new Set(parseados.map((p) => p.indice));
      for (const idx of Array.from(indicesTocados)) {
        const reg = procesados[idx];
        if (reg) {
          reg.entidades = normalizarEntidadesRegistro(reg.entidades);
        }
      }
    }

    // 4b. Sugerencias para compañías/ramos no reconocidos
    const ambiguas: SugerenciaAmbigua[] = [];
    for (let i = 0; i < procesados.length; i++) {
      const reg = procesados[i];
      for (const p of reg.problemas) {
        if (p.tipo_problema === 'COMPANIA_NO_RECONOCIDA') {
          ambiguas.push({
            indice_registro: i,
            tipo_problema: p.tipo_problema,
            valor: String(p.valor_original || ''),
            candidatos: params.contexto_crm.companias.map((c) => c.nombre).slice(0, 30),
          });
        } else if (p.tipo_problema === 'RAMO_NO_RECONOCIDO') {
          ambiguas.push({
            indice_registro: i,
            tipo_problema: p.tipo_problema,
            valor: String(p.valor_original || ''),
            candidatos: params.contexto_crm.ramos.map((r) => r.nombre).slice(0, 30),
          });
        }
      }
    }

    if (ambiguas.length > 0) {
      const { sugerencias, tokens, costo, errorFatal } = await sugerenciasCorreccionConIA(ambiguas);
      tokensIA += tokens;
      costoIA += costo;
      if (errorFatal) {
        return {
          ok: false,
          registros_procesados: [],
          registros_listos: 0,
          registros_dudosos: 0,
          tokens_usados: tokensIA,
          costo_usd: costoIA,
          error: marcarErrorFatal(errorFatal.tipo, errorFatal.mensaje),
        };
      }

      for (const s of sugerencias) {
        const reg = procesados[s.indice];
        if (!reg) continue;
        for (const p of reg.problemas) {
          if (
            (p.tipo_problema === 'COMPANIA_NO_RECONOCIDA' || p.tipo_problema === 'RAMO_NO_RECONOCIDO') &&
            !p.sugerencia_ia
          ) {
            p.sugerencia_ia = s.propuesta;
            p.valor_propuesto = s.propuesta;
            break;
          }
        }
      }
    }

    // 5. Clasificar
    let listos = 0;
    let dudosos = 0;
    for (const reg of procesados) {
      if (reg.problemas.length === 0) {
        reg.clasificacion = 'LISTO';
        listos++;
      } else {
        reg.clasificacion = 'DUDOSO';
        dudosos++;
      }
    }

    // 6. Persistir
    const supa = getSupabaseAdmin();

    // 6a. Registros dudosos
    const dudososFilas = procesados
      .filter((r) => r.clasificacion === 'DUDOSO')
      .flatMap((r) =>
        r.problemas.map((p) => ({
          importacion_id: params.importacion_id,
          lote_id: params.lote_id,
          archivo_origen: r.archivo_origen,
          numero_fila_archivo: r.numero_fila_archivo,
          tipo_entidad: p.tipo_entidad,
          tipo_problema: p.tipo_problema,
          descripcion_problema: [p.descripcion, p.campo ? `campo=${p.campo}` : null].filter(Boolean).join(' · '),
          datos_originales: {
            entidades: r.entidades,
            campo: p.campo ?? null,
            valor_original: p.valor_original ?? null,
            match_existente: r.match_existente ?? null,
          },
          datos_propuestos: p.valor_propuesto != null
            ? { valor_propuesto: p.valor_propuesto }
            : null,
          sugerencia_ia: p.sugerencia_ia ?? null,
        }))
      );

    // Borrar dudosos previos del MISMO lote antes de re-insertar. Si el job
    // se reintenta tras un crash (procesarLote ya escribió dudosos pero el
    // UPDATE del lote no llegó a COMPLETADO), volvemos a procesar de cero —
    // los dudosos viejos del intento anterior no deben acumularse con los nuevos.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supa.from('importacion_registros_dudosos') as any)
        .delete()
        .eq('lote_id', params.lote_id)
        .eq('estado_resolucion', 'PENDIENTE')
    } catch {
      // no abortar; el INSERT siguiente seguirá funcionando aunque haya residuos
    }

    if (dudososFilas.length > 0) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supa.from('importacion_registros_dudosos') as any).insert(dudososFilas);
      } catch {
        // no abortar; queda en memoria
      }
    }

    // 6b. Actualizar lote
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supa.from('importacion_lotes') as any)
        .update({
          registros_procesados: procesados.length,
          registros_listos: listos,
          registros_dudosos: dudosos,
          registros_procesados_data: procesados,
          estado: 'COMPLETADO',
          fecha_fin: new Date().toISOString(),
        })
        .eq('id', params.lote_id);
    } catch {
      // no abortar
    }

    return {
      ok: true,
      registros_procesados: procesados,
      registros_listos: listos,
      registros_dudosos: dudosos,
      tokens_usados: tokensIA,
      costo_usd: costoIA,
    };
  } catch (e) {
    const err = e as { message?: string };
    return {
      ok: false,
      registros_procesados: [],
      registros_listos: 0,
      registros_dudosos: 0,
      tokens_usados: 0,
      costo_usd: 0,
      error: err?.message || 'Error desconocido en procesarLote',
    };
  }
}
