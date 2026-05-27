'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  FileSpreadsheet,
  FileText,
  File as FileIcon,
  Download,
  Users,
  Shield,
  Clock,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { EstadoImportacionBadge } from '@/components/importacion/EstadoImportacionBadge';
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
  tipo: string | null;
  estado_proceso: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  archivos_metadata: ArchivoMetadata[] | null;
  estadisticas: EstadisticasImportacion | null;
  plan_importacion: PlanImportacion | null;
  ids_creados: IdsCreadosActualizados | null;
  ids_actualizados: IdsCreadosActualizados | null;
  clientes_creados: number | null;
  clientes_existentes: number | null;
  polizas_creadas: number | null;
  errores: number | null;
  detalle_errores: ErrorImportacion[] | null;
  total_filas: number | null;
  notas: string | null;
  deshecha: boolean | null;
  fecha_deshecha: string | null;
  usuario_id: string | null;
  created_at: string;
}

interface ResultadoDeshacer {
  registros_revertidos: { personas: number; polizas: number; riesgos: number };
  registros_preservados: { personas: number; polizas: number };
}

const DIAS_VALIDEZ_ARCHIVO = 30;

function formatFechaHora(iso: string | null): string {
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

function formatTamano(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRestante(ms: number): string {
  if (ms <= 0) return '0m';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function iconoArchivo(nombre: string) {
  const ext = nombre.toLowerCase().split('.').pop() ?? '';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
    return <FileSpreadsheet className="w-5 h-5 text-green-600" />;
  }
  if (ext === 'pdf') {
    return <FileText className="w-5 h-5 text-red-600" />;
  }
  return <FileIcon className="w-5 h-5 text-slate-500" />;
}

export default function HistorialDetallePage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) || '';

  const [imp, setImp] = useState<Importacion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [deshaciendo, setDeshaciendo] = useState(false);
  const [mostrarErrores, setMostrarErrores] = useState(false);
  const [tick, setTick] = useState(0);
  const [resultadoDeshacer, setResultadoDeshacer] =
    useState<ResultadoDeshacer | null>(null);
  const [usuariosMap, setUsuariosMap] = useState<
    Record<string, { nombre: string; apellido: string }>
  >({});

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60000);
    return () => clearInterval(t);
  }, []);

  async function cargar() {
    const r = await apiCall<{ importacion: Importacion }>(`/api/importar/${id}/resumen`, { cache: 'no-store' });
    if (r.ok && r.data) setImp(r.data.importacion);
    setCargando(false);
  }

  useEffect(() => {
    if (id) cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    let activo = true;
    (async () => {
      const r = await apiCall<{ usuarios: { id: string; nombre: string; apellido: string }[] }>('/api/usuarios', { cache: 'no-store' }, { mostrar_toast_en_error: false });
      if (!activo || !r.ok || !r.data) return;
      const map: Record<string, { nombre: string; apellido: string }> = {};
      for (const u of r.data.usuarios ?? []) {
        map[u.id] = { nombre: u.nombre, apellido: u.apellido };
      }
      setUsuariosMap(map);
    })();
    return () => {
      activo = false;
    };
  }, []);

  const archivosPurgados = useMemo(() => {
    if (!imp?.fecha_inicio) return true;
    const edad = Date.now() - new Date(imp.fecha_inicio).getTime();
    return edad > DIAS_VALIDEZ_ARCHIVO * 24 * 3600 * 1000;
  }, [imp]);

  const puedeDeshacer = useMemo(() => {
    if (!imp?.fecha_fin) return false;
    if (imp.deshecha) return false;
    if (imp.estado_proceso !== 'COMPLETADA') return false;
    const finMs = new Date(imp.fecha_fin).getTime();
    return Date.now() - finMs < 24 * 3600 * 1000;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imp, tick]);

  const msRestante = useMemo(() => {
    if (!imp?.fecha_fin) return 0;
    const finMs = new Date(imp.fecha_fin).getTime();
    return 24 * 3600 * 1000 - (Date.now() - finMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imp, tick]);

  const fechaExpiracion = useMemo(() => {
    if (!imp?.fecha_fin) return '—';
    const exp = new Date(new Date(imp.fecha_fin).getTime() + 24 * 3600 * 1000);
    return formatFechaHora(exp.toISOString());
  }, [imp]);

  async function deshacer() {
    if (
      !window.confirm(
        '¿Seguro que querés deshacer esta importación? Se revertirán todos los cambios.'
      )
    )
      return;
    if (
      !window.confirm('Última confirmación: esta acción es irreversible. ¿Continuar?')
    )
      return;
    setDeshaciendo(true);
    const r = await apiCall<{ resultado?: ResultadoDeshacer }>(`/api/importar/${id}/deshacer`, { method: 'POST' });
    if (r.ok) {
      if (r.data?.resultado) setResultadoDeshacer(r.data.resultado);
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

  const personasActualizadas = Array.isArray(imp.ids_actualizados?.personas)
    ? imp.ids_actualizados.personas.length
    : 0;
  const polizasActualizadas = Array.isArray(imp.ids_actualizados?.polizas)
    ? imp.ids_actualizados.polizas.length
    : 0;
  const riesgosCreados = Array.isArray(imp.ids_creados?.riesgos)
    ? imp.ids_creados.riesgos.length
    : 0;

  const companiasNuevas: string[] = Array.isArray(
    imp.estadisticas?.catalogos_creados?.companias
  )
    ? imp.estadisticas.catalogos_creados.companias
    : [];
  const ramosNuevos: string[] = Array.isArray(
    imp.estadisticas?.catalogos_creados?.ramos
  )
    ? imp.estadisticas.catalogos_creados.ramos
    : [];

  const tieneErrores = (imp.errores ?? 0) > 0;
  const detalleErrores: ErrorImportacion[] = Array.isArray(imp.detalle_errores)
    ? imp.detalle_errores
    : [];

  const usuarioLabel = imp.usuario_id
    ? usuariosMap[imp.usuario_id]
      ? `${usuariosMap[imp.usuario_id].nombre} ${usuariosMap[imp.usuario_id].apellido}`
      : imp.usuario_id.slice(0, 8)
    : '—';

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <button
          className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-900 mb-3"
          onClick={() => router.push('/crm/importar/historial')}
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al historial
        </button>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Detalle de importación</h1>
            <p className="text-sm text-slate-600 mt-1">
              <span className="font-mono">{imp.id.slice(0, 8)}</span> ·{' '}
              {formatFechaHora(imp.fecha_inicio)}
            </p>
          </div>
          <EstadoImportacionBadge estado={imp.estado_proceso} />
        </div>
      </div>

      {/* Sección 1 — Información general */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">
          Información general
        </h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-y-2 gap-x-4 text-xs">
          <div>
            <dt className="text-slate-500">Fecha de inicio</dt>
            <dd className="text-slate-900">{formatFechaHora(imp.fecha_inicio)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Fecha de finalización</dt>
            <dd className="text-slate-900">{formatFechaHora(imp.fecha_fin)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Duración</dt>
            <dd className="text-slate-900">
              {formatDuracion(imp.fecha_inicio, imp.fecha_fin)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Realizada por</dt>
            <dd className="text-slate-900">{usuarioLabel}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Tipo</dt>
            <dd className="text-slate-900">{imp.tipo || 'INICIAL'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Estado</dt>
            <dd>
              <EstadoImportacionBadge estado={imp.estado_proceso} size="sm" />
            </dd>
          </div>
          {imp.notas && (
            <div className="md:col-span-2">
              <dt className="text-slate-500">Nota descriptiva</dt>
              <dd className="text-slate-900 whitespace-pre-wrap">{imp.notas}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Sección 2 — Archivos */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">
          Archivos importados
        </h2>
        {archivos.length === 0 ? (
          <p className="text-xs text-slate-500">Sin archivos registrados</p>
        ) : (
          <ul className="space-y-2">
            {archivos.map((a, i: number) => {
              const nombre = a?.nombre || a?.filename || `archivo-${i + 1}`;
              const tamano = a?.tamano ?? a?.size ?? 0;
              const href = `/api/importar/${id}/archivo/${encodeURIComponent(nombre)}`;
              return (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 border border-slate-100 rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {iconoArchivo(nombre)}
                    <div className="min-w-0">
                      <p className="text-xs font-mono text-slate-900 truncate">
                        {nombre}
                      </p>
                      <p className="text-2xs text-slate-500">{formatTamano(tamano)}</p>
                    </div>
                  </div>
                  {archivosPurgados ? (
                    <span
                      className="text-2xs text-slate-400 inline-flex items-center gap-1 opacity-50 cursor-not-allowed"
                      title="Archivo purgado (>30 días)"
                    >
                      <Download className="w-3 h-3" />
                      Descargar
                    </span>
                  ) : (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-2xs text-violet-700 hover:text-violet-900 inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-violet-50"
                    >
                      <Download className="w-3 h-3" />
                      Descargar archivo original
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Sección 3 — Resultados */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Resultados</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-slate-500">Registros procesados</p>
            <p className="text-xl font-bold text-slate-900 mt-1">
              {(imp.total_filas ?? 0).toLocaleString('es-AR')}
            </p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-slate-500">Personas creadas</p>
            <p className="text-xl font-bold text-slate-900 mt-1">
              {(imp.clientes_creados ?? 0).toLocaleString('es-AR')}
            </p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-slate-500">Personas actualizadas</p>
            <p className="text-xl font-bold text-slate-900 mt-1">
              {personasActualizadas.toLocaleString('es-AR')}
            </p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-slate-500">Pólizas creadas</p>
            <p className="text-xl font-bold text-slate-900 mt-1">
              {(imp.polizas_creadas ?? 0).toLocaleString('es-AR')}
            </p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-slate-500">Pólizas actualizadas</p>
            <p className="text-xl font-bold text-slate-900 mt-1">
              {polizasActualizadas.toLocaleString('es-AR')}
            </p>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-slate-500">Riesgos creados</p>
            <p className="text-xl font-bold text-slate-900 mt-1">
              {riesgosCreados.toLocaleString('es-AR')}
            </p>
          </div>
        </div>

        {(companiasNuevas.length > 0 || ramosNuevos.length > 0) && (
          <div className="mt-4 bg-violet-50 border border-violet-200 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-violet-700 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-violet-900 mb-1">
                  Catálogos nuevos agregados
                </p>
                {companiasNuevas.length > 0 && (
                  <div className="mb-1">
                    <p className="text-2xs font-medium text-violet-900">
                      Compañías ({companiasNuevas.length})
                    </p>
                    <ul className="text-2xs text-violet-800">
                      {companiasNuevas.map((n, i) => (
                        <li key={i} className="flex items-center gap-1">
                          <CheckCircle className="w-3 h-3 text-violet-600" />
                          <span className="capitalize">{n}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {ramosNuevos.length > 0 && (
                  <div>
                    <p className="text-2xs font-medium text-violet-900">
                      Ramos ({ramosNuevos.length})
                    </p>
                    <ul className="text-2xs text-violet-800">
                      {ramosNuevos.map((n, i) => (
                        <li key={i} className="flex items-center gap-1">
                          <CheckCircle className="w-3 h-3 text-violet-600" />
                          <span className="capitalize">{n}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sección 4 — Acceso rápido */}
      <div className="mb-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Acceso rápido</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
            <Shield className="w-5 h-5 text-violet-600 mb-2" />
            <p className="text-sm font-semibold text-slate-900">
              Ver pólizas importadas
            </p>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              Ir al listado <ArrowRight className="w-3 h-3" />
            </p>
          </button>
        </div>
      </div>

      {/* Sección 5 — Errores */}
      {tieneErrores && detalleErrores.length > 0 && (
        <div className="bg-white border border-red-200 rounded-xl p-5 mb-5">
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

      {/* Sección 6 — Deshacer */}
      {imp.deshecha ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-5">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-red-700 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-900">
                Importación deshecha correctamente
              </p>
              <p className="text-xs text-red-800 mt-1">
                Deshecha el {formatFechaHora(imp.fecha_deshecha)}. No se puede volver a
                revertir.
              </p>
              {resultadoDeshacer && (
                <ul className="text-xs text-red-800 mt-3 space-y-0.5">
                  <li>
                    {resultadoDeshacer.registros_revertidos.personas} personas eliminadas
                  </li>
                  {resultadoDeshacer.registros_preservados.personas > 0 && (
                    <li>
                      {resultadoDeshacer.registros_preservados.personas} personas
                      preservadas (tenían actividad posterior)
                    </li>
                  )}
                  <li>
                    {resultadoDeshacer.registros_revertidos.polizas} pólizas eliminadas
                  </li>
                  {resultadoDeshacer.registros_preservados.polizas > 0 && (
                    <li>
                      {resultadoDeshacer.registros_preservados.polizas} pólizas
                      preservadas (tenían siniestros)
                    </li>
                  )}
                  <li>
                    {resultadoDeshacer.registros_revertidos.riesgos} riesgos eliminados
                  </li>
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : puedeDeshacer ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-5">
          <div className="flex items-start gap-3">
            <RotateCcw className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900">
                Podés deshacer esta importación
              </p>
              <p className="text-xs text-amber-800 mt-1">
                Tenés 24 horas para deshacer esta importación. Después no se puede
                revertir automáticamente.
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
      ) : imp.estado_proceso === 'COMPLETADA' ? (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 mb-5">
          <p className="text-xs text-slate-700 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            El plazo para deshacer expiró el {fechaExpiracion}.
          </p>
        </div>
      ) : null}
    </div>
  );
}
