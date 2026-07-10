'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Edit3,
  Sparkles,
  Ban,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import {
  CAMPOS_PERSONA,
  CAMPOS_POLIZA,
  CAMPOS_RIESGO,
} from '@/lib/importacion/campos';
import {
  MapeoColumnaSelector,
  type MapeoColumna,
  type CampoDisponible,
} from '@/components/importacion/MapeoColumnaSelector';
import { SeparadorColumnaModal } from '@/components/importacion/SeparadorColumnaModal';
import { CombinarColumnaModal } from '@/components/importacion/CombinarColumnaModal';
import { apiCall } from '@/lib/api-client';
import type { ArchivoMetadata, CeldaValor, FilaOriginal, PlanImportacion } from '@/lib/importacion/types';
import type { CatalogosFaltantes } from '@/lib/importacion/chequeo-catalogos';

// Tipos locales laxos para el plan tal como llega de la API (permite muestra_datos/muestra extendidas)
type ColumnaUI = {
  indice: number;
  header: string;
  campo_crm: string | null;
  confianza?: number;
  nota?: string;
};
type ArchivoAnalizadoUI = {
  nombre: string;
  tipo_contenido: string;
  columnas: ColumnaUI[];
  compania_detectada?: string | null;
  ramos_detectados?: string[];
  advertencias?: string[];
  muestra_datos?: FilaOriginal[];
  muestra?: FilaOriginal[];
};
type PlanUI = Partial<PlanImportacion> & {
  archivos_analizados?: ArchivoAnalizadoUI[];
};
type ArchivoMeta = ArchivoMetadata;

// Construir campos disponibles desde las constantes del backend
const CAMPOS_DISPONIBLES: CampoDisponible[] = [
  ...CAMPOS_PERSONA.map((c) => ({
    value: `persona.${c}`,
    label: c,
    categoria: 'PERSONA' as const,
  })),
  ...CAMPOS_POLIZA.map((c) => ({
    value: `poliza.${c}`,
    label: c,
    categoria: 'POLIZA' as const,
  })),
  ...CAMPOS_RIESGO.map((c) => ({
    value: `riesgo.${c}`,
    label: c,
    categoria: 'RIESGO' as const,
  })),
];

function badgeCalidad(calidad: string) {
  const mapa: Record<string, string> = {
    EXCELENTE: 'bg-green-100 text-green-800 border-green-300',
    BUENA: 'bg-green-100 text-green-800 border-green-300',
    REGULAR: 'bg-amber-100 text-amber-800 border-amber-300',
    BAJA: 'bg-red-100 text-red-800 border-red-300',
  };
  return mapa[calidad] || 'bg-slate-100 text-slate-700 border-slate-300';
}

function parseCampoCrm(
  campo_crm: string | null
): MapeoColumna | null {
  if (!campo_crm) return null;
  if (campo_crm === 'ignorar') return { tipo: 'IGNORAR' };
  const [prefix] = campo_crm.split('.');
  const cat = prefix === 'persona' ? 'PERSONA' : prefix === 'poliza' ? 'POLIZA' : prefix === 'riesgo' ? 'RIESGO' : null;
  if (!cat) return null;
  return { tipo: 'DIRECTO', campo: campo_crm, categoria: cat };
}

function labelMapeo(m: MapeoColumna | null): string {
  if (!m) return 'Sin mapear';
  if (m.tipo === 'IGNORAR') return 'Ignorar';
  if (m.tipo === 'DIRECTO') return m.campo;
  if (m.tipo === 'SEPARAR')
    return `Separar por "${m.separador}" → ${m.campos_destino.length} campos`;
  if (m.tipo === 'COMBINAR')
    return `Combinar ${m.columnas_origen.length} columnas → ${m.campo_destino}`;
  return 'Sin mapear';
}

export default function PlanPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<PlanUI | null>(null);
  const [_estadoProceso, setEstadoProceso] = useState<string>('');
  const [_archivosMeta, setArchivosMeta] = useState<ArchivoMeta[]>([]);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [editandoKey, setEditandoKey] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [modalSeparar, setModalSeparar] = useState<{
    archivo: string;
    columna: string;
    ejemplos: string[];
    valorInicial?: {
      separador: string;
      campos_destino: Array<{ campo: string; categoria: string }>;
    };
  } | null>(null);
  const [modalCombinar, setModalCombinar] = useState<{
    archivo: string;
    columnaActual: string;
    valorInicial?: {
      columnas_origen: string[];
      separador: string;
      campo_destino: string;
      categoria: string;
    };
  } | null>(null);

  // mapeoLocal[archivo][columna] = MapeoColumna
  const [mapeoLocal, setMapeoLocal] = useState<Record<string, Record<string, MapeoColumna>>>({});

  // Modo de intervención de la IA durante el procesamiento de lotes.
  // NORMAL (default) = la IA solo arregla lo que la heurística marca como complejo.
  // AGRESIVO = el PAS acepta el costo extra a cambio de que la IA intervenga más.
  const [modoLimpiezaIA, setModoLimpiezaIA] = useState<'NORMAL' | 'AGRESIVO'>('NORMAL');

  // Chequeo bloqueante: si el archivo trae valores de compañía / ramo /
  // cobertura / refacturación / vigencia que no existen en los catálogos del
  // CRM, frenamos la importación para que el PAS los configure primero.
  const [catalogosFaltantes, setCatalogosFaltantes] = useState<CatalogosFaltantes | null>(null);
  const [chequeandoCatalogos, setChequeandoCatalogos] = useState(false);

  async function refrescarCatalogosFaltantes() {
    setChequeandoCatalogos(true);
    const r = await apiCall<{ faltantes: CatalogosFaltantes }>(
      `/api/importar/${id}/catalogos-faltantes`,
      { cache: 'no-store' },
      { mostrar_toast_en_error: false },
    );
    if (r.ok && r.data) setCatalogosFaltantes(r.data.faltantes);
    setChequeandoCatalogos(false);
  }

  useEffect(() => {
    let activo = true;
    (async () => {
      type EstadoResp = { estado: string; tipo?: string };
      type PlanResp = {
        plan_importacion?: PlanUI | null;
        archivos_metadata?: ArchivoMeta[];
      };
      const [rEstado, rPlan] = await Promise.all([
        apiCall<EstadoResp>(`/api/importar/${id}/estado`, { cache: 'no-store' }, { mostrar_toast_en_error: false }),
        apiCall<PlanResp>(`/api/importar/${id}/plan`, { cache: 'no-store' }, { mostrar_toast_en_error: false }),
      ]);
      if (!activo) return;
      if (!rEstado.ok || !rEstado.data) {
        setError(rEstado.error?.mensaje || 'No se pudo obtener el estado');
        setLoading(false);
        return;
      }
      const estadoActual = rEstado.data.estado;
      const tipoActual = rEstado.data.tipo;
      setEstadoProceso(estadoActual);
      // Incremental → siempre va a la pantalla de comparación
      if (tipoActual === 'INCREMENTAL' && estadoActual === 'ANALIZADO') {
        router.push(`/crm/importar/${id}/comparar`);
        return;
      }
      // Redirección si el estado no corresponde
      if (estadoActual === 'PENDIENTE' || estadoActual === 'ANALIZANDO' || estadoActual === 'REFINANDO') {
        router.push(`/crm/importar/${id}/procesando`);
        return;
      }
      if (estadoActual === 'IMPORTANDO') {
        router.push(`/crm/importar/${id}/progreso`);
        return;
      }
      if (estadoActual === 'FALLIDA' || estadoActual === 'CANCELADA') {
        router.push(`/crm/importar/${id}/procesando`);
        return;
      }
      if (!rPlan.ok || !rPlan.data) {
        setError(rPlan.error?.mensaje || 'No se pudo obtener el plan');
        setLoading(false);
        return;
      }
      setPlan(rPlan.data.plan_importacion || null);
      setArchivosMeta(rPlan.data.archivos_metadata || []);
      const modoGuardado = rPlan.data.plan_importacion?.modo_limpieza_ia;
      if (modoGuardado === 'AGRESIVO' || modoGuardado === 'NORMAL') {
        setModoLimpiezaIA(modoGuardado);
      }

      // Construir mapeoLocal inicial desde plan_importacion.archivos_analizados
      const inicial: Record<string, Record<string, MapeoColumna>> = {};
      const archivos = rPlan.data.plan_importacion?.archivos_analizados || [];
      for (const a of archivos) {
        inicial[a.nombre] = {};
        for (const col of a.columnas || []) {
          const parsed = parseCampoCrm(col.campo_crm);
          if (parsed) inicial[a.nombre][col.header] = parsed;
        }
      }
      setMapeoLocal(inicial);
      // Expandir el primer archivo por defecto
      if (archivos.length > 0) {
        setExpandidos(new Set([archivos[0].nombre]));
      }
      setLoading(false);
      // Chequeo inicial de catálogos faltantes (no bloquea el render)
      const rCat = await apiCall<{ faltantes: CatalogosFaltantes }>(
        `/api/importar/${id}/catalogos-faltantes`,
        { cache: 'no-store' },
        { mostrar_toast_en_error: false },
      );
      if (activo && rCat.ok && rCat.data) setCatalogosFaltantes(rCat.data.faltantes);
    })();
    return () => {
      activo = false;
    };
  }, [id, router]);

  function toggleExpand(nombre: string) {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(nombre)) next.delete(nombre);
      else next.add(nombre);
      return next;
    });
  }

  function setMapeoColumna(archivo: string, columna: string, m: MapeoColumna) {
    setMapeoLocal((prev) => ({
      ...prev,
      [archivo]: { ...(prev[archivo] || {}), [columna]: m },
    }));
  }

  async function cancelarImportacion() {
    if (!window.confirm('¿Cancelar la importación? Se descartarán los archivos.')) return;
    const r = await apiCall(`/api/importar/${id}/cancelar`, { method: 'POST' });
    if (r.ok) router.push('/crm/importar');
  }

  async function confirmarYProcesar() {
    setConfirmando(true);
    // PATCH plan
    const rPatch = await apiCall(`/api/importar/${id}/plan`, {
      method: 'PATCH',
      body: { mapeo: mapeoLocal, modo_limpieza_ia: modoLimpiezaIA },
    });
    if (!rPatch.ok) {
      setConfirmando(false);
      return;
    }
    // POST procesar — puede fallar con 409 si faltan catálogos
    const rProc = await apiCall<{ lotes_encolados: number }>(
      `/api/importar/${id}/procesar`,
      { method: 'POST' },
    );
    if (!rProc.ok) {
      if (rProc.status === 409) {
        // Backend frenó por catálogos faltantes — refrescamos el banner
        await refrescarCatalogosFaltantes();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      setConfirmando(false);
      return;
    }
    router.push(`/crm/importar/${id}/progreso`);
  }

  const archivosAnalizados: ArchivoAnalizadoUI[] = useMemo(
    () => plan?.archivos_analizados || [],
    [plan]
  );

  // Ejemplos por columna: tomamos del plan si los tiene (muestra_datos), si no vacío
  function ejemplosDeColumna(archivoNombre: string, header: string): string[] {
    const archivo = archivosAnalizados.find((a) => a.nombre === archivoNombre);
    if (!archivo) return [];
    const muestra: FilaOriginal[] = archivo.muestra_datos || archivo.muestra || [];
    if (!Array.isArray(muestra)) return [];
    const col = (archivo.columnas || []).find((c) => c.header === header);
    if (!col) return [];
    const idx = col.indice;
    return muestra
      .slice(0, 3)
      .map((fila) => (Array.isArray(fila) ? String((fila as CeldaValor[])[idx] ?? '') : ''))
      .filter((v: string) => v !== '');
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <XCircle className="w-10 h-10 text-red-600 mx-auto mb-3" />
          <p className="text-sm text-red-800 mb-4">{error}</p>
          <button className="btn-primary" onClick={() => router.push('/crm/importar')}>
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10 text-center text-slate-600">
        No hay plan disponible para esta importación.
      </div>
    );
  }

  const calidad = plan.calidad_estimada || 'REGULAR';
  const vinculacion = plan.vinculacion_detectada;
  // `companias_detectadas` puede venir como strings (flujo IA tradicional) o
  // como objetos { nombre, existe } (fast-path del template). Normalizamos a
  // un shape común para el render.
  const companiasDetectadasRaw = (plan.companias_detectadas || []) as Array<
    string | { nombre?: string; codigo?: string; existe?: boolean }
  >;
  const companiasDetectadas: Array<{ nombre: string; existe: boolean }> =
    companiasDetectadasRaw.map((c) => {
      if (typeof c === 'string') return { nombre: c, existe: true };
      // Estricto: solo verde si `existe === true` explícito. Defensa contra
      // shape inesperado donde existe podría venir undefined.
      return {
        nombre: c?.nombre || c?.codigo || 'Sin nombre',
        existe: c?.existe === true,
      };
    });
  const hayCatalogosFaltantes = (catalogosFaltantes?.total ?? 0) > 0;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 pb-28">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Plan de importación</h1>
          <p className="text-sm text-slate-600 mt-1">
            Revisá el mapeo propuesto y confirmá para procesar tu cartera
          </p>
        </div>
        <button className="btn-secondary" onClick={cancelarImportacion}>
          Cancelar
        </button>
      </div>

      {/* Banner bloqueante: catálogos faltantes */}
      {hayCatalogosFaltantes && catalogosFaltantes && (
        <section className="bg-red-50 border border-red-300 rounded-xl p-6 mb-4">
          <div className="flex items-start gap-3 mb-3">
            <Ban className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-red-900 uppercase tracking-wide">
                No podés importar todavía — faltan {catalogosFaltantes.total} valor{catalogosFaltantes.total === 1 ? '' : 'es'} en tus catálogos
              </h2>
              <p className="text-xs text-red-800 mt-1">
                El archivo trae valores de compañía, ramo o cobertura que no existen
                en el CRM. Si importás igual te van a quedar los campos en blanco.
                Configurá primero los catálogos, después volvé acá y tocá
                <strong> Verificar de nuevo</strong>.
              </p>
            </div>
          </div>

          <div className="ml-9 space-y-2 mb-4">
            {catalogosFaltantes.companias.length > 0 && (
              <div>
                <p className="text-2xs font-semibold text-red-900 uppercase tracking-wide mb-1">
                  Compañías faltantes ({catalogosFaltantes.companias.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {catalogosFaltantes.companias.map((v) => (
                    <span key={`c-${v}`} className="text-xs bg-white border border-red-200 text-red-800 px-2 py-0.5 rounded">
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {catalogosFaltantes.ramos.length > 0 && (
              <div>
                <p className="text-2xs font-semibold text-red-900 uppercase tracking-wide mb-1">
                  Ramos faltantes ({catalogosFaltantes.ramos.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {catalogosFaltantes.ramos.map((v) => (
                    <span key={`r-${v}`} className="text-xs bg-white border border-red-200 text-red-800 px-2 py-0.5 rounded">
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {catalogosFaltantes.coberturas.length > 0 && (
              <div>
                <p className="text-2xs font-semibold text-red-900 uppercase tracking-wide mb-1">
                  Coberturas faltantes ({catalogosFaltantes.coberturas.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {catalogosFaltantes.coberturas.map((v) => (
                    <span key={`cob-${v}`} className="text-xs bg-white border border-red-200 text-red-800 px-2 py-0.5 rounded">
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="ml-9 flex flex-wrap items-center gap-2">
            <a
              href="/crm/configuracion/catalogos"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Abrir Catálogos
            </a>
            <button
              onClick={refrescarCatalogosFaltantes}
              disabled={chequeandoCatalogos}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-red-300 hover:bg-red-50 text-red-700 text-xs font-medium rounded-lg transition-colors disabled:opacity-60"
            >
              {chequeandoCatalogos ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Verificar de nuevo
            </button>
          </div>
        </section>
      )}

      {/* Sección 1 — Resumen */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 mb-4">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">
            Resumen general
          </h2>
          <span
            className={`px-3 py-1 text-xs font-semibold rounded-full border ${badgeCalidad(
              calidad
            )}`}
          >
            Calidad: {calidad}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-medium text-slate-500 mb-2">Archivos analizados</p>
            <ul className="space-y-1 text-sm">
              {archivosAnalizados.map((a) => (
                <li key={a.nombre} className="text-slate-700">
                  <span className="font-medium">{a.nombre}</span>{' '}
                  <span className="text-slate-500">
                    → {a.tipo_contenido}
                  </span>
                </li>
              ))}
            </ul>
            {(plan.total_registros_estimado ?? 0) > 0 && (
              <p className="text-xs text-slate-500 mt-2">
                Total estimado: {plan.total_registros_estimado} registros
              </p>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-slate-500 mb-2">Vinculación detectada</p>
            {vinculacion && vinculacion.tipo !== 'NINGUNA' ? (
              <div className="text-sm text-slate-700">
                <p>
                  <span className="font-medium">Tipo:</span> {vinculacion.tipo}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {vinculacion.archivo_maestro} ⟷ {vinculacion.archivo_hijo}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                Sin vinculación entre archivos (archivo único)
              </p>
            )}

            <p className="text-xs font-medium text-slate-500 mt-4 mb-2">
              Compañías detectadas
            </p>
            {companiasDetectadas.length === 0 ? (
              <p className="text-xs text-slate-500">Ninguna</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {companiasDetectadas.map((c) => (
                  <li key={c.nombre} className="text-slate-700">
                    • {c.nombre}
                    {!c.existe && (
                      <span className="text-2xs text-amber-700 ml-1">(nueva)</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {calidad !== 'EXCELENTE' && calidad !== 'BUENA' && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              La calidad estimada del mapeo es {calidad}. Revisá cuidadosamente el mapeo de
              columnas antes de procesar.
            </p>
          </div>
        )}

        {plan.advertencias && plan.advertencias.length > 0 && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs font-medium text-amber-800 mb-1">Advertencias:</p>
            <ul className="text-xs text-amber-800 space-y-0.5">
              {plan.advertencias.map((a: string, i: number) => (
                <li key={i}>• {a}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Sección 2 — Mapeo por archivo */}
      <section className="mb-4">
        <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wide mb-3">
          Mapeo por archivo
        </h2>
        <div className="space-y-3">
          {archivosAnalizados.map((archivo) => {
            const nombre = archivo.nombre;
            const expandido = expandidos.has(nombre);
            const columnas: ColumnaUI[] = archivo.columnas || [];
            return (
              <div
                key={nombre}
                className="bg-white rounded-xl border border-slate-200 overflow-hidden"
              >
                <button
                  onClick={() => toggleExpand(nombre)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{nombre}</p>
                    <p className="text-2xs text-slate-500">
                      {archivo.tipo_contenido} · {columnas.length} columnas
                    </p>
                  </div>
                  {expandido ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </button>
                {expandido && (
                  <div className="border-t border-slate-100">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-2xs uppercase text-slate-500">
                        <tr>
                          <th className="text-left p-3">Columna archivo</th>
                          <th className="text-left p-3">Ejemplos</th>
                          <th className="text-left p-3">Campo CRM</th>
                          <th className="text-right p-3">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {columnas.map((col) => {
                          const mapeo =
                            mapeoLocal[nombre]?.[col.header] ||
                            parseCampoCrm(col.campo_crm);
                          const key = `${nombre}::${col.header}`;
                          const editando = editandoKey === key;
                          const ejemplos = ejemplosDeColumna(nombre, col.header);
                          return (
                            <tr
                              key={col.indice}
                              className="border-t border-slate-100 align-top"
                            >
                              <td className="p-3">
                                <p className="text-sm text-slate-800 font-medium">
                                  {col.header}
                                </p>
                                <p className="text-2xs text-slate-500">
                                  Índice {col.indice}
                                </p>
                              </td>
                              <td className="p-3 text-xs text-slate-600">
                                {ejemplos.length === 0 ? (
                                  <span className="text-slate-400">—</span>
                                ) : (
                                  <ul className="space-y-0.5">
                                    {ejemplos.map((e, i) => (
                                      <li key={i} className="truncate max-w-xs">
                                        {e}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                              <td className="p-3">
                                <span className="inline-block px-2 py-1 bg-slate-100 rounded text-xs font-mono text-slate-700">
                                  {labelMapeo(mapeo)}
                                </span>
                                {typeof col.confianza === 'number' &&
                                  col.confianza > 0 && (
                                    <p className="text-2xs text-slate-500 mt-1 flex items-center gap-1">
                                      <Sparkles className="w-3 h-3" /> IA:{' '}
                                      {Math.round(col.confianza * 100)}%
                                    </p>
                                  )}
                                {editando && (
                                  <div className="mt-2 relative z-10">
                                    <MapeoColumnaSelector
                                      columnaArchivo={col.header}
                                      valorActual={mapeo}
                                      camposDisponibles={CAMPOS_DISPONIBLES}
                                      ejemplosDatos={ejemplos}
                                      sugerenciaIA={
                                        col.campo_crm
                                          ? {
                                              campo: col.campo_crm,
                                              confianza: col.confianza || 0,
                                            }
                                          : undefined
                                      }
                                      onChange={(m) => {
                                        setMapeoColumna(nombre, col.header, m);
                                        setEditandoKey(null);
                                      }}
                                      onClose={() => setEditandoKey(null)}
                                      onOpenSeparador={() => {
                                        setEditandoKey(null);
                                        setModalSeparar({
                                          archivo: nombre,
                                          columna: col.header,
                                          ejemplos,
                                          valorInicial:
                                            mapeo?.tipo === 'SEPARAR'
                                              ? {
                                                  separador: mapeo.separador,
                                                  campos_destino:
                                                    mapeo.campos_destino,
                                                }
                                              : undefined,
                                        });
                                      }}
                                      onOpenCombinar={() => {
                                        setEditandoKey(null);
                                        setModalCombinar({
                                          archivo: nombre,
                                          columnaActual: col.header,
                                          valorInicial:
                                            mapeo?.tipo === 'COMBINAR'
                                              ? {
                                                  columnas_origen:
                                                    mapeo.columnas_origen,
                                                  separador: mapeo.separador,
                                                  campo_destino:
                                                    mapeo.campo_destino,
                                                  categoria: mapeo.categoria,
                                                }
                                              : undefined,
                                        });
                                      }}
                                    />
                                  </div>
                                )}
                              </td>
                              <td className="p-3 text-right">
                                <button
                                  className="text-xs text-violet-600 hover:text-violet-700 font-medium inline-flex items-center gap-1"
                                  onClick={() =>
                                    setEditandoKey(editando ? null : key)
                                  }
                                >
                                  <Edit3 className="w-3 h-3" />
                                  Editar
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Sección 3 — Compañías */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 mb-4">
        <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wide mb-3">
          Compañías y catálogos
        </h2>
        {companiasDetectadas.length === 0 ? (
          <p className="text-xs text-slate-500">No se detectaron compañías específicas.</p>
        ) : (
          <ul className="space-y-2">
            {companiasDetectadas.map((c) => (
              <li
                key={c.nombre}
                className="flex items-center justify-between p-2 border border-slate-100 rounded-lg"
              >
                <span className="text-sm text-slate-700">
                  {c.nombre}
                  {!c.existe && (
                    <span className="text-2xs text-amber-700 ml-1">(nueva)</span>
                  )}
                </span>
                <span className="text-2xs text-slate-500 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3 text-amber-500" />
                  Verificar en catálogos del CRM
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Sección 4 — Intervención de la IA */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-violet-600" />
          <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">
            Limpieza con IA
          </h2>
        </div>
        <p className="text-xs text-slate-600 mb-4">
          Durante el procesamiento, la IA puede intervenir para limpiar datos
          desordenados (nombres/apellidos pegados, direcciones mezcladas, fechas
          o montos en formatos raros, etc). Elegí cuán agresivamente querés que
          participe.
        </p>
        <div className="space-y-2">
          <label
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              modoLimpiezaIA === 'NORMAL'
                ? 'border-blue-500 bg-blue-50'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <input
              type="radio"
              name="modo_limpieza_ia"
              value="NORMAL"
              checked={modoLimpiezaIA === 'NORMAL'}
              onChange={() => setModoLimpiezaIA('NORMAL')}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-800">
                Normal <span className="text-2xs font-normal text-slate-500">(recomendado)</span>
              </div>
              <div className="text-xs text-slate-600 mt-0.5">
                La IA interviene solo cuando detecta datos claramente desordenados
                (ej: apellido con 2+ palabras y nombre vacío). Bajo consumo de tokens.
              </div>
            </div>
          </label>

          <label
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              modoLimpiezaIA === 'AGRESIVO'
                ? 'border-violet-500 bg-violet-50'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <input
              type="radio"
              name="modo_limpieza_ia"
              value="AGRESIVO"
              checked={modoLimpiezaIA === 'AGRESIVO'}
              onChange={() => setModoLimpiezaIA('AGRESIVO')}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-800">
                Agresivo <span className="text-2xs font-normal text-violet-700">(archivo desordenado)</span>
              </div>
              <div className="text-xs text-slate-600 mt-0.5">
                La IA se pasa también por celdas con umbrales más bajos e intenta
                reinterpretar fechas, montos y teléfonos con formato raro. Limpia
                más casos pero consume más tokens.
              </div>
            </div>
          </label>
        </div>
      </section>

      {/* Sección 5 — Preview */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 mb-4">
        <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wide mb-3">
          Preview
        </h2>
        <p className="text-xs text-slate-500">
          El preview completo estará disponible después de procesar el primer lote.
        </p>
      </section>

      {/* Modales: separar / combinar */}
      {modalSeparar && (
        <SeparadorColumnaModal
          columnaArchivo={modalSeparar.columna}
          ejemplosDatos={modalSeparar.ejemplos}
          camposDisponibles={CAMPOS_DISPONIBLES}
          valorInicial={modalSeparar.valorInicial}
          onAplicar={(config) => {
            setMapeoColumna(modalSeparar.archivo, modalSeparar.columna, {
              tipo: 'SEPARAR',
              separador: config.separador,
              campos_destino: config.campos_destino,
            });
            setModalSeparar(null);
          }}
          onCancelar={() => setModalSeparar(null)}
        />
      )}

      {modalCombinar && (() => {
        const archivo = archivosAnalizados.find(
          (a) => a.nombre === modalCombinar.archivo
        );
        const todasLasColumnas = (archivo?.columnas || []).map(
          (c) => ({
            nombre: c.header,
            ejemplos: ejemplosDeColumna(modalCombinar.archivo, c.header),
          })
        );
        return (
          <CombinarColumnaModal
            todasLasColumnas={todasLasColumnas}
            columnaInicial={modalCombinar.columnaActual}
            camposDisponibles={CAMPOS_DISPONIBLES}
            valorInicial={modalCombinar.valorInicial}
            onAplicar={(config) => {
              setMapeoColumna(
                modalCombinar.archivo,
                modalCombinar.columnaActual,
                {
                  tipo: 'COMBINAR',
                  columnas_origen: config.columnas_origen,
                  separador: config.separador,
                  campo_destino: config.campo_destino,
                  categoria: config.categoria,
                }
              );
              setModalCombinar(null);
            }}
            onCancelar={() => setModalCombinar(null)}
          />
        );
      })()}

      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-4 z-40">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <button
            className="btn-secondary"
            onClick={cancelarImportacion}
            disabled={confirmando}
          >
            Cancelar importación
          </button>
          <div className="flex-1 text-right">
            <p className="text-2xs text-slate-500 mb-1">
              {hayCatalogosFaltantes
                ? 'Configurá los catálogos faltantes antes de continuar'
                : 'Al confirmar, el sistema dividirá los registros en lotes y los procesará en segundo plano'}
            </p>
          </div>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={confirmarYProcesar}
            disabled={confirmando || hayCatalogosFaltantes}
            title={hayCatalogosFaltantes ? 'Configurá los catálogos faltantes antes de importar' : undefined}
          >
            {confirmando ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Iniciando...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Confirmar plan e iniciar procesamiento
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
