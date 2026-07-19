'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Info,
  Building2,
  Eye,
  ChevronDown,
  ChevronRight,
  Edit3,
} from 'lucide-react';
import { apiCall } from '@/lib/api-client';
import { obtenerTipoRiesgo } from '@/lib/tipos-riesgo';
import type {
  ArchivoMetadata,
  EstadisticasImportacion,
  PlanImportacion,
  RegistroProcesado,
} from '@/lib/importacion/types';

interface EstadoBasico {
  estado: string;
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
}

interface Resumen {
  id: string;
  tipo: string;
  estado_proceso: string;
  total_filas: number | null;
  plan_importacion: PlanImportacion | null;
  archivos_metadata: ArchivoMetadata[] | null;
  estadisticas: EstadisticasImportacion | null;
}

export default function ConfirmarPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) || '';

  const [estado, setEstado] = useState<EstadoBasico | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cargando, setCargando] = useState(true);
  const [confirmando, setConfirmando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [previewAbierto, setPreviewAbierto] = useState(false);
  const [previewRegistros, setPreviewRegistros] = useState<RegistroProcesado[] | null>(null);
  const [filaExpandida, setFilaExpandida] = useState<number | null>(null);
  const [volviendoAlPlan, setVolviendoAlPlan] = useState(false);

  useEffect(() => {
    let alive = true;
    async function cargar() {
      type EstadoApiResp = EstadoBasico;
      type ResumenApiResp = { importacion?: Resumen } & Partial<Resumen>;
      const [rEst, rRes] = await Promise.all([
        apiCall<EstadoApiResp>(`/api/importar/${id}/estado`, { cache: 'no-store' }, { mostrar_toast_en_error: false }),
        apiCall<ResumenApiResp>(`/api/importar/${id}/resumen`, { cache: 'no-store' }, { mostrar_toast_en_error: false }),
      ]);

      if (!alive) return;

      if (!rEst.ok || !rEst.data) {
        setCargando(false);
        return;
      }

      const estJson = rEst.data;
      const e = estJson.estado as string;

      // Routing según estado
      if (e === 'ANALIZANDO' || e === 'PENDIENTE') {
        router.replace(`/crm/importar/${id}/procesando`);
        return;
      }
      if (e === 'IMPORTANDO') {
        router.replace(`/crm/importar/${id}/importando`);
        return;
      }
      if (e === 'COMPLETADA') {
        router.replace(`/crm/importar/${id}/completada`);
        return;
      }
      if (e === 'FALLIDA' || e === 'CANCELADA') {
        router.replace('/crm/importar');
        return;
      }

      // REVISANDO o ANALIZADO sin dudosos
      if ((estJson.registros?.pendientes_revision ?? 0) > 0) {
        router.replace(`/crm/importar/${id}/revisar`);
        return;
      }

      setEstado({
        estado: e,
        registros: estJson.registros,
        jobs: estJson.jobs,
      });
      if (rRes.ok && rRes.data) {
        const r = rRes.data;
        setResumen(r.importacion || (r as Resumen));
      }
      setCargando(false);
    }
    if (id) cargar();
    return () => {
      alive = false;
    };
  }, [id, router]);

  async function confirmar() {
    setConfirmando(true);
    const r = await apiCall(`/api/importar/${id}/confirmar`, { method: 'POST' });
    if (r.ok) {
      router.push(`/crm/importar/${id}/importando`);
    } else {
      setConfirmando(false);
    }
  }

  async function cancelar() {
    if (!window.confirm('¿Seguro que querés cancelar la importación?')) return;
    setCancelando(true);
    const r = await apiCall(`/api/importar/${id}/cancelar`, { method: 'POST' });
    if (r.ok) {
      router.push('/crm/importar');
    } else {
      setCancelando(false);
    }
  }

  async function togglePreview() {
    const abrir = !previewAbierto;
    setPreviewAbierto(abrir);
    if (abrir && previewRegistros === null) {
      const r = await apiCall<{ registros: RegistroProcesado[] }>(
        `/api/importar/${id}/preview?limite=10`,
        { cache: 'no-store' },
        { mostrar_toast_en_error: false }
      );
      if (r.ok && r.data) {
        setPreviewRegistros(r.data.registros || []);
      } else {
        setPreviewRegistros([]);
      }
    }
  }

  async function volverAlPlan() {
    const msg =
      '¿Volver al plan para ajustar el mapeo? Se van a descartar los registros procesados (pero los archivos se mantienen) y vas a tener que re-procesar.';
    if (!window.confirm(msg)) return;
    setVolviendoAlPlan(true);
    const r = await apiCall(`/api/importar/${id}/volver-al-plan`, { method: 'POST' });
    if (r.ok) {
      router.push(`/crm/importar/${id}/plan`);
    } else {
      setVolviendoAlPlan(false);
    }
  }

  if (cargando || !estado) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
      </div>
    );
  }

  const registros = estado.registros;
  const totalImportar = registros.listos + registros.resueltos;
  const tipo = resumen?.tipo || 'INICIAL';
  const plan = resumen?.plan_importacion || ({} as Partial<PlanImportacion>);
  // `companias_detectadas` puede venir como strings o como objetos (variación histórica del plan)
  type CompaniaDetectadaItem = string | { nombre?: string; codigo?: string; existe?: boolean };
  const companiasDetectadas: CompaniaDetectadaItem[] = Array.isArray(plan?.companias_detectadas)
    ? (plan.companias_detectadas as CompaniaDetectadaItem[])
    : [];
  const archivos: ArchivoMetadata[] = Array.isArray(resumen?.archivos_metadata)
    ? resumen!.archivos_metadata!
    : [];

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 pb-32">
      {confirmando && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl p-8 shadow-2xl text-center max-w-sm">
            <Loader2 className="w-10 h-10 text-violet-600 animate-spin mx-auto mb-4" />
            <p className="text-lg font-semibold text-slate-900">
              Encolando importación...
            </p>
            <p className="text-sm text-slate-600 mt-2">
              Te vamos a redirigir en unos segundos
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-end mb-6">
        <button
          className="btn-danger text-xs"
          onClick={cancelar}
          disabled={cancelando}
        >
          {cancelando ? 'Cancelando...' : 'Cancelar importación'}
        </button>
      </div>

      <h1 className="text-2xl font-bold text-slate-900">
        Confirmar importación
      </h1>
      <p className="text-sm text-slate-600 mt-1 mb-6">
        Revisá el resumen final antes de importar a tu base de datos.
      </p>

      {/* Sección 1 — Resumen general */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex items-start gap-3 mb-4">
          <CheckCircle2 className="w-6 h-6 text-green-600 flex-shrink-0 mt-1" />
          <div className="flex-1">
            <p className="text-sm text-slate-600">Total a importar</p>
            <p className="text-4xl font-bold text-slate-900">
              {totalImportar}{' '}
              <span className="text-base font-normal text-slate-600">
                registros
              </span>
            </p>
          </div>
          <span
            className={`text-2xs font-semibold px-2 py-1 rounded-full ${
              tipo === 'INCREMENTAL'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-violet-100 text-violet-800'
            }`}
          >
            MODO: {tipo === 'INCREMENTAL' ? 'INCREMENTAL' : 'INICIAL'}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-slate-100">
          <div>
            <p className="text-2xs text-slate-600 uppercase tracking-wide">
              Listos
            </p>
            <p className="text-xl font-semibold text-green-700">
              {registros.listos}
            </p>
          </div>
          <div>
            <p className="text-2xs text-slate-600 uppercase tracking-wide">
              Resueltos
            </p>
            <p className="text-xl font-semibold text-violet-700">
              {registros.resueltos}
            </p>
          </div>
          <div>
            <p className="text-2xs text-slate-600 uppercase tracking-wide">
              Dudosos
            </p>
            <p className="text-xl font-semibold text-amber-700">
              {registros.dudosos}
            </p>
          </div>
        </div>
      </div>

      {/* Sección 2 — Preview de datos */}
      <div className="bg-white rounded-xl border border-slate-200 mb-6 overflow-hidden">
        <button
          onClick={togglePreview}
          className="w-full flex items-center justify-between p-5 hover:bg-slate-50 text-left"
        >
          <div className="flex items-center gap-3">
            <Eye className="w-5 h-5 text-slate-600" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Ver muestra de los datos antes de importar
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Revisá cómo quedaron mapeados apellido, nombre, DNI y demás campos. Si algo
                quedó mal (ej: apellido y nombre en un mismo campo), ajustá el mapeo antes
                de importar.
              </p>
            </div>
          </div>
          {previewAbierto ? (
            <ChevronDown className="w-5 h-5 text-slate-600 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-5 h-5 text-slate-600 flex-shrink-0" />
          )}
        </button>

        {previewAbierto && (
          <div className="border-t border-slate-200 p-5 bg-slate-50">
            {previewRegistros === null ? (
              <div className="flex items-center justify-center py-8 text-slate-600">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-sm">Cargando muestra…</span>
              </div>
            ) : previewRegistros.length === 0 ? (
              <p className="text-sm text-slate-600 text-center py-6">
                No hay registros procesados para mostrar.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto bg-white rounded-md border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100 border-b border-slate-200">
                      <tr>
                        <th className="text-left py-2 px-2 font-semibold text-slate-700 w-12">
                          Fila
                        </th>
                        <th className="text-left py-2 px-2 font-semibold text-slate-700">
                          Apellido
                        </th>
                        <th className="text-left py-2 px-2 font-semibold text-slate-700">
                          Nombre
                        </th>
                        <th className="text-left py-2 px-2 font-semibold text-slate-700">
                          DNI/CUIL
                        </th>
                        <th className="text-left py-2 px-2 font-semibold text-slate-700">
                          Email
                        </th>
                        <th className="text-left py-2 px-2 font-semibold text-slate-700">
                          Teléfono
                        </th>
                        <th className="text-left py-2 px-2 font-semibold text-slate-700">
                          Póliza
                        </th>
                        <th className="py-2 px-2 w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRegistros.map((r, i) => {
                        const p = r.entidades?.persona as Record<string, unknown> | null;
                        const po = r.entidades?.poliza as Record<string, unknown> | null;
                        const expandida = filaExpandida === i;
                        return (
                          <FilaPreview
                            key={i}
                            idx={i}
                            fila={r.numero_fila_archivo}
                            persona={p}
                            poliza={po}
                            riesgo={r.entidades?.riesgo as Record<string, unknown> | null}
                            expandida={expandida}
                            onToggle={() => setFilaExpandida(expandida ? null : i)}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <ResumenAvisoCampos registros={previewRegistros} />
                <p className="text-2xs text-slate-600 mt-3">
                  Mostrando {previewRegistros.length} de {totalImportar} registros. Hacé
                  clic en cada fila para ver todos los campos.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Sección 3 — Compañías */}
      {companiasDetectadas.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            Compañías detectadas
          </h2>
          <ul className="space-y-1">
            {companiasDetectadas.map((c, i: number) => {
              const nombre =
                typeof c === 'string' ? c : c?.nombre || c?.codigo || 'Sin nombre';
              // Estricto: solo "existe" si el flag viene true explícito. Si es
              // string (formato legacy del análisis IA) asumimos que existe;
              // si es objeto con existe undefined, asumimos NUEVA (conservador).
              const existe = typeof c === 'string' ? true : c?.existe === true;
              return (
                <li
                  key={i}
                  className="flex items-center gap-2 text-xs text-slate-700"
                >
                  {existe ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                  )}
                  <span>{nombre}</span>
                  {!existe && (
                    <span className="text-2xs text-amber-700">(nueva)</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Archivos */}
      {archivos.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">
            Archivos importados
          </h2>
          <ul className="space-y-1 text-xs text-slate-700">
            {archivos.map((a, i: number) => (
              <li key={i} className="flex items-center gap-2">
                <span className="font-mono">{a?.nombre || a?.filename || `archivo-${i + 1}`}</span>
                {a?.filas && (
                  <span className="text-slate-600">({a.filas} filas)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sección 4 — Info importante */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 space-y-1">
            <p className="font-semibold text-sm mb-2">Información importante</p>
            <p>• La importación va a tardar entre 2 y 10 minutos</p>
            <p>• Una vez confirmada, no se puede pausar</p>
            <p>
              • Tenés 24 horas para deshacer la importación si algo salió mal
            </p>
            <p>
              • Los archivos originales se guardan por 30 días para auditoría
            </p>
          </div>
        </div>
      </div>

      {/* Footer sticky */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-4 shadow-lg z-40">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="flex gap-2">
            <button
              className="btn-secondary text-xs"
              onClick={cancelar}
              disabled={cancelando || volviendoAlPlan}
            >
              Cancelar
            </button>
            <button
              className="btn-secondary text-xs flex items-center gap-1"
              onClick={volverAlPlan}
              disabled={volviendoAlPlan || confirmando}
              title="Descarta los registros procesados y vuelve al paso de mapeo de columnas"
            >
              {volviendoAlPlan ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Edit3 className="w-3 h-3" />
              )}
              Ajustar mapeo
            </button>
          </div>
          <button
            className="btn-primary text-sm px-6 py-3 font-semibold"
            onClick={confirmar}
            disabled={confirmando || volviendoAlPlan}
          >
            {confirmando && (
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
            )}
            Confirmar e importar a la base de datos
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componentes auxiliares
// ---------------------------------------------------------------------------

function FilaPreview({
  idx,
  fila,
  persona,
  poliza,
  riesgo,
  expandida,
  onToggle,
}: {
  idx: number;
  fila: number;
  persona: Record<string, unknown> | null;
  poliza: Record<string, unknown> | null;
  riesgo: Record<string, unknown> | null;
  expandida: boolean;
  onToggle: () => void;
}) {
  const ap = (persona?.apellido as string) || '';
  const nom = (persona?.nombre as string) || '';
  const dni = (persona?.dni_cuil as string) || '';
  const email = (persona?.email as string) || '';
  const tel = (persona?.telefono as string) || (persona?.whatsapp as string) || '';
  const numPoliza = (poliza?.numero_poliza as string) || '';

  // Heurística: detectar si apellido parece contener nombre también (>= 3 palabras)
  const apSospechoso = ap.trim().split(/\s+/).length >= 3 && !nom;

  return (
    <>
      <tr
        className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${
          idx % 2 === 0 ? '' : 'bg-slate-50/50'
        }`}
        onClick={onToggle}
      >
        <td className="py-2 px-2 font-mono text-slate-600">{fila}</td>
        <td className="py-2 px-2 font-medium text-slate-900">
          <div className="flex items-center gap-1">
            {apSospechoso && (
              <AlertTriangle
                className="w-3 h-3 text-amber-600 flex-shrink-0"
                aria-label="Posible apellido+nombre combinados"
              />
            )}
            <span className={apSospechoso ? 'text-amber-800' : ''}>{ap || '—'}</span>
          </div>
        </td>
        <td className="py-2 px-2 text-slate-700">
          {nom || <span className="text-slate-500 italic">vacío</span>}
        </td>
        <td className="py-2 px-2 font-mono text-slate-700">{dni || '—'}</td>
        <td className="py-2 px-2 text-slate-700 truncate max-w-[160px]">
          {email || '—'}
        </td>
        <td className="py-2 px-2 text-slate-700">{tel || '—'}</td>
        <td className="py-2 px-2 font-mono text-slate-700">{numPoliza || '—'}</td>
        <td className="py-2 px-2 text-slate-500">
          {expandida ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
        </td>
      </tr>
      {expandida && (
        <tr>
          <td colSpan={8} className="p-4 bg-slate-100 border-b border-slate-200">
            <div className="grid md:grid-cols-3 gap-3 text-2xs">
              <CampoDump titulo="Persona" obj={persona} />
              <CampoDump titulo="Póliza" obj={poliza} />
              <CampoDump titulo="Riesgo" obj={riesgo} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function CampoDump({
  titulo,
  obj,
}: {
  titulo: string;
  obj: Record<string, unknown> | null;
}) {
  if (!obj || typeof obj !== 'object') {
    return (
      <div className="bg-white rounded p-2 border border-slate-200">
        <div className="font-semibold text-slate-600 mb-1 uppercase tracking-wide">
          {titulo}
        </div>
        <p className="text-slate-500 italic">sin datos</p>
      </div>
    );
  }
  const entries = Object.entries(obj).filter(
    ([, v]) => v !== null && v !== undefined && v !== ''
  );
  return (
    <div className="bg-white rounded p-2 border border-slate-200">
      <div className="font-semibold text-slate-600 mb-1 uppercase tracking-wide">
        {titulo}
      </div>
      {entries.length === 0 ? (
        <p className="text-slate-500 italic">sin datos</p>
      ) : (
        <dl className="space-y-0.5">
          {entries.map(([k, v]) => {
            // El valor crudo de `tipo_riesgo` es un identificador interno
            // ('automotor', 'integrales', etc). Lo mostramos como label
            // legible para el PAS ("Automotor", "Integrales", ...).
            const display =
              k === 'tipo_riesgo' && typeof v === 'string'
                ? obtenerTipoRiesgo(v).label
                : typeof v === 'object'
                  ? JSON.stringify(v)
                  : String(v);
            return (
              <div key={k} className="flex gap-1">
                <dt className="text-slate-600 min-w-[90px] flex-shrink-0">{k}</dt>
                <dd className="font-mono text-slate-800 break-all">{display}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}

function ResumenAvisoCampos({ registros }: { registros: RegistroProcesado[] }) {
  // Heurística: cuántas personas parecen tener apellido+nombre en un mismo campo
  let apellidoSospechoso = 0;
  let sinDni = 0;
  let sinEmail = 0;
  for (const r of registros) {
    const p = r.entidades?.persona as Record<string, unknown> | null;
    if (!p) continue;
    const ap = ((p.apellido as string) || '').trim();
    const nom = ((p.nombre as string) || '').trim();
    if (ap.split(/\s+/).length >= 3 && !nom) apellidoSospechoso += 1;
    if (!p.dni_cuil) sinDni += 1;
    if (!p.email) sinEmail += 1;
  }

  const avisos: { icono: 'warn' | 'info'; mensaje: string }[] = [];
  if (apellidoSospechoso > 0) {
    avisos.push({
      icono: 'warn',
      mensaje: `${apellidoSospechoso} de ${registros.length} registros parecen tener apellido + nombre combinados en un solo campo. Si es así, usá "Ajustar mapeo" y separá la columna.`,
    });
  }
  if (sinDni > 0) {
    avisos.push({
      icono: 'info',
      mensaje: `${sinDni} de ${registros.length} registros no tienen DNI/CUIL.`,
    });
  }
  if (sinEmail === registros.length && registros.length > 0) {
    avisos.push({
      icono: 'info',
      mensaje: `Ninguno de los registros mostrados tiene email.`,
    });
  }

  if (avisos.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {avisos.map((a, i) => (
        <div
          key={i}
          className={`flex items-start gap-2 rounded-md p-3 text-xs border ${
            a.icono === 'warn'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-blue-50 border-blue-200 text-blue-900'
          }`}
        >
          {a.icono === 'warn' ? (
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          ) : (
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          )}
          <p>{a.mensaje}</p>
        </div>
      ))}
    </div>
  );
}
