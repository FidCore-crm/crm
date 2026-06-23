'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Loader2,
  CheckCircle,
  Users,
  FileText,
  Shield,
  XCircle,
  Clock,
  ArrowRight,
  RotateCcw,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { apiCall } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import type {
  ArchivoMetadata,
  EstadisticasImportacion,
  IdsCreadosActualizados,
  PlanImportacion,
} from '@/lib/importacion/types';

interface ErrorImportacion {
  fila: number;
  archivo?: string;
  error: string;
  mensaje?: string;
}

interface Importacion {
  id: string;
  tipo: string;
  estado_proceso: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  archivos_metadata: ArchivoMetadata[] | null;
  plan_importacion: PlanImportacion | null;
  ids_creados: IdsCreadosActualizados | null;
  ids_actualizados: IdsCreadosActualizados | null;
  clientes_creados: number | null;
  clientes_existentes: number | null;
  polizas_creadas: number | null;
  errores: number | null;
  detalle_errores: ErrorImportacion[] | null;
  total_filas: number | null;
  deshecha: boolean | null;
  fecha_deshecha: string | null;
  estadisticas: EstadisticasImportacion | null;
  created_at: string;
}

interface ResultadoDeshacer {
  registros_revertidos: { personas: number; polizas: number; riesgos: number };
  registros_preservados: { personas: number; polizas: number };
}

function formatDuracion(inicio: string | null, fin: string | null): string {
  if (!inicio || !fin) return '—';
  const ms = new Date(fin).getTime() - new Date(inicio).getTime();
  if (!isFinite(ms) || ms < 0) return '—';
  const totalSeg = Math.floor(ms / 1000);
  const h = Math.floor(totalSeg / 3600);
  const m = Math.floor((totalSeg % 3600) / 60);
  const s = totalSeg % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatFecha(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatRestante(ms: number): string {
  if (ms <= 0) return '0m';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function CompletadaPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) || '';

  const [imp, setImp] = useState<Importacion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [deshaciendo, setDeshaciendo] = useState(false);
  const [mostrarErrores, setMostrarErrores] = useState(false);
  const [tick, setTick] = useState(0); // para refrescar contador cada minuto
  const [resultadoDeshacer, setResultadoDeshacer] = useState<ResultadoDeshacer | null>(null);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60000);
    return () => clearInterval(t);
  }, []);

  async function cargar() {
    const r = await apiCall<{ importacion: Importacion }>(`/api/importar/${id}/resumen`, {
      cache: 'no-store',
    });
    if (r.ok && r.data) {
      setImp(r.data.importacion);
    }
    setCargando(false);
  }

  useEffect(() => {
    if (id) cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const duracion = imp ? formatDuracion(imp.fecha_inicio, imp.fecha_fin) : '—';
  const riesgosCount = useMemo(() => {
    const r = imp?.ids_creados?.riesgos;
    return Array.isArray(r) ? r.length : 0;
  }, [imp]);

  const tieneErrores = (imp?.errores ?? 0) > 0;
  const detalleErrores: ErrorImportacion[] = Array.isArray(imp?.detalle_errores)
    ? imp!.detalle_errores!
    : [];

  // Lógica de deshacer 24h
  const puedeDeshacer = useMemo(() => {
    if (!imp?.fecha_fin) return false;
    if (imp.deshecha) return false;
    const finMs = new Date(imp.fecha_fin).getTime();
    return Date.now() - finMs < 24 * 3600 * 1000;
  }, [imp, tick]);

  const msRestante = useMemo(() => {
    if (!imp?.fecha_fin) return 0;
    const finMs = new Date(imp.fecha_fin).getTime();
    return 24 * 3600 * 1000 - (Date.now() - finMs);
  }, [imp, tick]);

  const fechaExpiracion = useMemo(() => {
    if (!imp?.fecha_fin) return '—';
    const exp = new Date(new Date(imp.fecha_fin).getTime() + 24 * 3600 * 1000);
    return exp.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [imp]);

  async function deshacer() {
    if (
      !window.confirm(
        '¿Seguro que querés deshacer esta importación? Se revertirán todos los cambios.'
      )
    )
      return;
    if (
      !window.confirm(
        'Última confirmación: esta acción es irreversible. ¿Continuar?'
      )
    )
      return;
    setDeshaciendo(true);
    const r = await apiCall<{ resultado?: ResultadoDeshacer }>(`/api/importar/${id}/deshacer`, {
      method: 'POST',
    });
    if (r.ok) {
      if (r.data?.resultado) {
        setResultadoDeshacer(r.data.resultado);
      }
      toast.exito('Importación deshecha correctamente');
      await cargar();
    }
    setDeshaciendo(false);
  }

  if (cargando || !imp) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
      </div>
    );
  }

  const archivos: ArchivoMetadata[] = Array.isArray(imp.archivos_metadata)
    ? imp.archivos_metadata
    : [];

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-4">
          <CheckCircle className="w-12 h-12 text-green-600" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900">
          Importación completada
        </h1>
        <p className="text-sm text-slate-600 mt-2">
          Todos los registros fueron importados a tu base de datos
        </p>
      </div>

      {/* Sección 1 — Resumen */}
      <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl p-6 mb-6">
        <p className="text-sm text-green-900 font-medium mb-1">
          Total importado
        </p>
        <p className="text-5xl font-bold text-green-900">
          {(imp.clientes_creados ?? 0) +
            (imp.polizas_creadas ?? 0) +
            riesgosCount}{' '}
          <span className="text-lg font-normal text-green-700">registros</span>
        </p>

        <div className="grid grid-cols-3 gap-3 mt-5">
          <div className="bg-white/70 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-green-700" />
              <p className="text-xs text-green-900 font-medium">Clientes</p>
            </div>
            <p className="text-2xl font-bold text-green-900">
              {imp.clientes_creados ?? 0}
            </p>
          </div>
          <div className="bg-white/70 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="w-4 h-4 text-green-700" />
              <p className="text-xs text-green-900 font-medium">Pólizas</p>
            </div>
            <p className="text-2xl font-bold text-green-900">
              {imp.polizas_creadas ?? 0}
            </p>
          </div>
          <div className="bg-white/70 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-4 h-4 text-green-700" />
              <p className="text-xs text-green-900 font-medium">Riesgos</p>
            </div>
            <p className="text-2xl font-bold text-green-900">{riesgosCount}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-green-200">
          <div className="flex items-center gap-2 text-sm text-green-900">
            <Clock className="w-4 h-4" />
            <span>Tiempo total: </span>
            <strong>{duracion}</strong>
          </div>
          <div
            className={`flex items-center gap-2 text-sm ${
              tieneErrores ? 'text-red-800' : 'text-green-900'
            }`}
          >
            {tieneErrores ? (
              <XCircle className="w-4 h-4" />
            ) : (
              <CheckCircle className="w-4 h-4" />
            )}
            <span>Errores: </span>
            <strong>{imp.errores ?? 0}</strong>
          </div>
        </div>
      </div>

      {/* Detalle errores */}
      {tieneErrores && (
        <div className="bg-white border border-red-200 rounded-xl p-5 mb-6">
          <button
            className="flex items-center justify-between w-full text-left"
            onClick={() => setMostrarErrores(!mostrarErrores)}
          >
            <h2 className="text-sm font-semibold text-red-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {imp.errores} errores durante la importación
            </h2>
            <span className="text-xs text-red-700">
              {mostrarErrores ? 'Ocultar' : 'Ver detalle'}
            </span>
          </button>
          {mostrarErrores && (
            <div className="mt-3 max-h-64 overflow-y-auto space-y-1">
              {detalleErrores.map((err, i: number) => (
                <div
                  key={i}
                  className="text-xs text-red-800 bg-red-50 px-3 py-2 rounded border border-red-100"
                >
                  <span className="font-mono font-semibold">
                    Fila {err.fila ?? '?'}:
                  </span>{' '}
                  {err.error || err.mensaje || 'Error desconocido en esta fila'}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sección 2 — Acciones recomendadas */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">
          Acciones recomendadas
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            className="bg-white border border-slate-200 rounded-xl p-4 text-left hover:border-violet-400 hover:shadow-md transition-all"
            onClick={() => router.push(`/crm/personas?importacion_id=${id}`)}
          >
            <Users className="w-5 h-5 text-violet-600 mb-2" />
            <p className="text-sm font-semibold text-slate-900">
              Ver clientes importados
            </p>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              Ir al listado <ArrowRight className="w-3 h-3" />
            </p>
          </button>
          <button
            className="bg-white border border-slate-200 rounded-xl p-4 text-left hover:border-violet-400 hover:shadow-md transition-all"
            onClick={() => router.push(`/crm/polizas?importacion_id=${id}`)}
          >
            <FileText className="w-5 h-5 text-violet-600 mb-2" />
            <p className="text-sm font-semibold text-slate-900">
              Ver pólizas importadas
            </p>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              Ir al listado <ArrowRight className="w-3 h-3" />
            </p>
          </button>
          <button
            className="bg-white border border-slate-200 rounded-xl p-4 text-left hover:border-violet-400 hover:shadow-md transition-all"
            onClick={() => router.push('/crm/renovaciones')}
          >
            <Clock className="w-5 h-5 text-violet-600 mb-2" />
            <p className="text-sm font-semibold text-slate-900">
              Ver renovaciones próximas
            </p>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              Ir al listado <ArrowRight className="w-3 h-3" />
            </p>
          </button>
        </div>
      </div>

      {/* Sección 3 — Sobre la importación */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">
          Sobre esta importación
        </h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-4 text-xs">
          <div>
            <dt className="text-slate-500">ID</dt>
            <dd className="font-mono text-slate-900">{imp.id}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Modo</dt>
            <dd className="text-slate-900">{imp.tipo || 'INICIAL'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Inicio</dt>
            <dd className="text-slate-900">{formatFecha(imp.fecha_inicio)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Fin</dt>
            <dd className="text-slate-900">{formatFecha(imp.fecha_fin)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Total filas procesadas</dt>
            <dd className="text-slate-900">{imp.total_filas ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Clientes existentes</dt>
            <dd className="text-slate-900">{imp.clientes_existentes ?? 0}</dd>
          </div>
        </dl>

        {archivos.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-100">
            <p className="text-xs text-slate-500 mb-1">Archivos</p>
            <ul className="text-xs text-slate-900 space-y-0.5">
              {archivos.map((a, i: number) => (
                <li key={i} className="font-mono">
                  {a?.nombre || a?.filename || `archivo-${i + 1}`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Catálogos creados automáticamente */}
      {(() => {
        const cc = imp.estadisticas?.catalogos_creados;
        const comps: string[] = Array.isArray(cc?.companias) ? cc.companias : [];
        const rams: string[] = Array.isArray(cc?.ramos) ? cc.ramos : [];
        const cobs: string[] = Array.isArray(cc?.coberturas) ? cc.coberturas : [];
        if (comps.length === 0 && rams.length === 0 && cobs.length === 0) return null;
        return (
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-5 mb-6">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-violet-700 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-violet-900 mb-2">
                  Catálogos agregados automáticamente
                </p>
                {comps.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-medium text-violet-900 mb-1">
                      Compañías ({comps.length})
                    </p>
                    <ul className="text-xs text-violet-800 space-y-0.5">
                      {comps.map((n, i) => (
                        <li key={i} className="flex items-center gap-1.5">
                          <CheckCircle className="w-3 h-3 text-violet-600" />
                          <span className="capitalize">{n}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {rams.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-medium text-violet-900 mb-1">
                      Ramos ({rams.length})
                    </p>
                    <ul className="text-xs text-violet-800 space-y-0.5">
                      {rams.map((n, i) => (
                        <li key={i} className="flex items-center gap-1.5">
                          <CheckCircle className="w-3 h-3 text-violet-600" />
                          <span className="capitalize">{n}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {cobs.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-medium text-violet-900 mb-1">
                      Coberturas ({cobs.length})
                    </p>
                    <ul className="text-xs text-violet-800 space-y-0.5">
                      {cobs.map((n, i) => (
                        <li key={i} className="flex items-center gap-1.5">
                          <CheckCircle className="w-3 h-3 text-violet-600" />
                          <span className="capitalize">{n}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <button
                  className="text-xs font-medium text-violet-700 hover:text-violet-900 inline-flex items-center gap-1 mt-1"
                  onClick={() => router.push('/crm/configuracion/catalogos')}
                >
                  Ir a Catálogos <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Sección 4 — Deshacer */}
      {/* TODO: mismo patrón en historial/[id] */}
      {imp.deshecha ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-6">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-red-700 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-900">
                Importación deshecha correctamente
              </p>
              <p className="text-xs text-red-800 mt-1">
                Deshecha el {formatFecha(imp.fecha_deshecha)}. No se puede
                volver a revertir.
              </p>
              {resultadoDeshacer && (
                <ul className="text-xs text-red-800 mt-3 space-y-0.5">
                  <li>
                    {resultadoDeshacer.registros_revertidos.personas} personas eliminadas
                  </li>
                  {resultadoDeshacer.registros_preservados.personas > 0 && (
                    <li>
                      {resultadoDeshacer.registros_preservados.personas} personas preservadas (tenían actividad posterior)
                    </li>
                  )}
                  <li>
                    {resultadoDeshacer.registros_revertidos.polizas} pólizas eliminadas
                  </li>
                  {resultadoDeshacer.registros_preservados.polizas > 0 && (
                    <li>
                      {resultadoDeshacer.registros_preservados.polizas} pólizas preservadas (tenían siniestros)
                    </li>
                  )}
                  <li>
                    {resultadoDeshacer.registros_revertidos.riesgos} riesgos eliminados
                  </li>
                </ul>
              )}
              <button
                className="btn-secondary text-xs mt-3"
                onClick={() => router.push('/crm/importar/historial')}
              >
                Volver al historial
              </button>
            </div>
          </div>
        </div>
      ) : puedeDeshacer ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
          <div className="flex items-start gap-3">
            <RotateCcw className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900">
                Podés deshacer esta importación
              </p>
              <p className="text-xs text-amber-800 mt-1">
                Tenés 24 horas para deshacer esta importación. Después no se
                puede revertir automáticamente.
              </p>
              <p className="text-xs text-amber-900 mt-2 font-semibold">
                Vence dentro de: {formatRestante(msRestante)}
              </p>
              <button
                className="btn-danger text-xs mt-3"
                onClick={deshacer}
                disabled={deshaciendo}
              >
                {deshaciendo ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
                    Deshaciendo...
                  </>
                ) : (
                  'Deshacer importación'
                )}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 mb-6">
          <p className="text-xs text-slate-700">
            El plazo para deshacer expiró el {fechaExpiracion}.
          </p>
        </div>
      )}

      {/* Sección 5 — Acciones finales */}
      <div className="flex flex-col md:flex-row gap-3 justify-between">
        <button
          className="btn-secondary"
          onClick={() => router.push('/crm/dashboard')}
        >
          Volver al inicio
        </button>
        <button
          className="btn-primary"
          onClick={() => router.push('/crm/importar')}
        >
          Hacer otra importación
        </button>
      </div>
    </div>
  );
}
