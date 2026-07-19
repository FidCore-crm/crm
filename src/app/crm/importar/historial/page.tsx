'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Search,
  X,
  Loader2,
  RotateCcw,
  Eye,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
} from 'lucide-react';
import { EstadoImportacionBadge } from '@/components/importacion/EstadoImportacionBadge';
import { apiCall } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import type { ArchivoMetadata } from '@/lib/importacion/types';
import { urlContinuarImportacion, labelContinuarImportacion } from '@/lib/importacion/navegacion';

interface Importacion {
  id: string;
  usuario_id: string | null;
  tipo: string | null;
  nombre_archivo: string | null;
  estado_proceso: string;
  archivos_metadata: ArchivoMetadata[] | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  deshecha: boolean | null;
  clientes_creados: number | null;
  polizas_creadas: number | null;
  errores: number | null;
  total_filas: number | null;
  created_at: string;
}

interface Kpis {
  total_importaciones: number;
  total_registros_importados: number;
  ultima_importacion: {
    id: string;
    fecha_fin: string | null;
    estado_proceso: string;
    nombre_archivo: string | null;
  } | null;
  importaciones_esta_semana: number;
}

interface UsuarioMini {
  id: string;
  nombre: string;
  apellido: string;
}

const POR_PAGINA = 25;

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

function HistorialContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [cargandoKpis, setCargandoKpis] = useState(true);

  const [items, setItems] = useState<Importacion[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [usuariosMap, setUsuariosMap] = useState<Record<string, UsuarioMini>>({});
  const [deshaciendoId, setDeshaciendoId] = useState<string | null>(null);

  // Filtros desde query string (fuente de verdad)
  const qsBusqueda = searchParams.get('busqueda') ?? '';
  const qsEstado = searchParams.get('estado') ?? 'TODAS';
  const qsTipo = searchParams.get('tipo') ?? 'TODAS';
  const qsPeriodo = searchParams.get('periodo') ?? 'TODAS';
  const qsDesde = searchParams.get('fecha_desde') ?? '';
  const qsHasta = searchParams.get('fecha_hasta') ?? '';
  const qsPagina = Math.max(1, parseInt(searchParams.get('pagina') ?? '1', 10));

  // Input local para búsqueda con debounce
  const [busquedaInput, setBusquedaInput] = useState(qsBusqueda);

  useEffect(() => {
    setBusquedaInput(qsBusqueda);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qsBusqueda]);

  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (busquedaInput === qsBusqueda) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      actualizarFiltros({ busqueda: busquedaInput, pagina: '1' });
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busquedaInput]);

  const actualizarFiltros = useCallback(
    (cambios: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(cambios)) {
        if (!v || v === 'TODAS') params.delete(k);
        else params.set(k, v);
      }
      router.replace(`/crm/importar/historial?${params.toString()}`);
    },
    [router, searchParams]
  );

  function limpiarFiltros() {
    setBusquedaInput('');
    router.replace('/crm/importar/historial');
  }

  // Calcular rango de fechas según período
  const rangoFechas = useMemo(() => {
    if (qsPeriodo === 'TODAS' || qsPeriodo === '') return { desde: '', hasta: '' };
    if (qsPeriodo === 'PERSONALIZADO') return { desde: qsDesde, hasta: qsHasta };
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();
    if (qsPeriodo === 'HOY') {
      const desde = new Date(y, m, d, 0, 0, 0, 0).toISOString();
      const hasta = new Date(y, m, d, 23, 59, 59, 999).toISOString();
      return { desde, hasta };
    }
    if (qsPeriodo === 'SEMANA') {
      const day = now.getDay();
      const diffDays = day === 0 ? 6 : day - 1;
      const lunes = new Date(y, m, d - diffDays, 0, 0, 0, 0);
      return { desde: lunes.toISOString(), hasta: '' };
    }
    if (qsPeriodo === 'MES') {
      return { desde: new Date(y, m, 1, 0, 0, 0, 0).toISOString(), hasta: '' };
    }
    if (qsPeriodo === 'ANIO') {
      return { desde: new Date(y, 0, 1, 0, 0, 0, 0).toISOString(), hasta: '' };
    }
    return { desde: '', hasta: '' };
  }, [qsPeriodo, qsDesde, qsHasta]);

  // Cargar KPIs (una vez)
  useEffect(() => {
    let activo = true;
    (async () => {
      const r = await apiCall<Kpis>('/api/importar/historial/kpis', { cache: 'no-store' }, { mostrar_toast_en_error: false });
      if (!activo) return;
      if (r.ok && r.data) {
        setKpis({
          total_importaciones: r.data.total_importaciones ?? 0,
          total_registros_importados: r.data.total_registros_importados ?? 0,
          ultima_importacion: r.data.ultima_importacion ?? null,
          importaciones_esta_semana: r.data.importaciones_esta_semana ?? 0,
        });
      }
      setCargandoKpis(false);
    })();
    return () => {
      activo = false;
    };
  }, []);

  // Cargar usuarios (admin)
  useEffect(() => {
    let activo = true;
    (async () => {
      const r = await apiCall<{ usuarios: UsuarioMini[] }>('/api/usuarios', { cache: 'no-store' }, { mostrar_toast_en_error: false });
      if (!activo || !r.ok || !r.data) return;
      const map: Record<string, UsuarioMini> = {};
      for (const u of r.data.usuarios ?? []) {
        map[u.id] = { id: u.id, nombre: u.nombre, apellido: u.apellido };
      }
      setUsuariosMap(map);
    })();
    return () => {
      activo = false;
    };
  }, []);

  // Cargar listado al cambiar filtros
  const cargarListado = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    params.set('pagina', String(qsPagina));
    params.set('por_pagina', String(POR_PAGINA));
    if (qsBusqueda) params.set('busqueda', qsBusqueda);
    if (qsEstado && qsEstado !== 'TODAS') params.set('estado', qsEstado);
    if (qsTipo && qsTipo !== 'TODAS') params.set('tipo', qsTipo);
    if (rangoFechas.desde) params.set('fecha_desde', rangoFechas.desde);
    if (rangoFechas.hasta) params.set('fecha_hasta', rangoFechas.hasta);

    const r = await apiCall<{ data: Importacion[]; total: number }>(`/api/importar/historial?${params.toString()}`, {
      cache: 'no-store',
    });
    if (r.ok && r.data) {
      setItems(r.data.data ?? []);
      setTotal(r.data.total ?? 0);
    }
    setCargando(false);
  }, [qsPagina, qsBusqueda, qsEstado, qsTipo, rangoFechas.desde, rangoFechas.hasta]);

  useEffect(() => {
    cargarListado();
  }, [cargarListado]);

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  function puedeDeshacer(imp: Importacion): boolean {
    if (imp.deshecha) return false;
    if (imp.estado_proceso !== 'COMPLETADA') return false;
    if (!imp.fecha_fin) return false;
    const finMs = new Date(imp.fecha_fin).getTime();
    return Date.now() - finMs < 24 * 3600 * 1000;
  }

  async function deshacerImp(e: React.MouseEvent, imp: Importacion) {
    e.stopPropagation();
    if (
      !window.confirm(
        '¿Seguro que querés deshacer esta importación? Se revertirán todos los cambios.'
      )
    )
      return;
    if (!window.confirm('Última confirmación: esta acción es irreversible. ¿Continuar?'))
      return;
    setDeshaciendoId(imp.id);
    const r = await apiCall(`/api/importar/${imp.id}/deshacer`, { method: 'POST' });
    if (r.ok) {
      toast.exito('Importación deshecha correctamente');
      await cargarListado();
    }
    setDeshaciendoId(null);
  }

  // Una importación se puede cancelar si está en un estado intermedio
  // (todavía no se completó). Los estados terminales son COMPLETADA,
  // FALLIDA y CANCELADA.
  function puedeCancelar(estado: string): boolean {
    return ['PENDIENTE', 'ANALIZANDO', 'ANALIZADO', 'REVISANDO', 'IMPORTANDO', 'PAUSADA'].includes(estado);
  }

  async function cancelarImp(e: React.MouseEvent, imp: Importacion) {
    e.stopPropagation();
    if (
      !window.confirm(
        '¿Seguro que querés cancelar esta importación? Se borra el progreso pero los archivos quedan en el servidor.'
      )
    )
      return;
    const r = await apiCall(`/api/importar/${imp.id}/cancelar`, { method: 'POST' });
    if (r.ok) {
      toast.exito('Importación cancelada');
      await cargarListado();
    }
  }

  function nombreUsuario(usuarioId: string | null): string {
    if (!usuarioId) return '—';
    const u = usuariosMap[usuarioId];
    if (u) return `${u.nombre} ${u.apellido}`;
    return usuarioId.slice(0, 8);
  }

  function nombresArchivos(imp: Importacion): {
    count: number;
    tooltip: string;
  } {
    const meta = Array.isArray(imp.archivos_metadata) ? imp.archivos_metadata : [];
    const nombres: string[] = meta
      .map((a) => a?.nombre || a?.filename || '')
      .filter(Boolean);
    if (nombres.length === 0 && imp.nombre_archivo) {
      return { count: 1, tooltip: imp.nombre_archivo };
    }
    return {
      count: nombres.length || (imp.nombre_archivo ? 1 : 0),
      tooltip: nombres.join('\n') || imp.nombre_archivo || '',
    };
  }

  function registrosTotal(imp: Importacion): string {
    if (imp.estado_proceso !== 'COMPLETADA') return '—';
    const n = (imp.clientes_creados ?? 0) + (imp.polizas_creadas ?? 0);
    return n.toLocaleString('es-AR');
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <button
          className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-900 mb-3"
          onClick={() => router.push('/crm/importar')}
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al importador
        </button>
        <h1 className="text-2xl font-bold text-slate-900">Historial de importaciones</h1>
        <p className="text-sm text-slate-600 mt-1">
          Todas las importaciones realizadas en tu CRM
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="kpi-card">
          <p className="text-xs text-slate-600 font-medium uppercase tracking-wide">
            Total de importaciones
          </p>
          <p className="text-3xl font-bold text-slate-900 mt-1">
            {cargandoKpis ? '—' : (kpis?.total_importaciones ?? 0).toLocaleString('es-AR')}
          </p>
        </div>
        <div className="kpi-card">
          <p className="text-xs text-slate-600 font-medium uppercase tracking-wide">
            Registros importados
          </p>
          <p className="text-3xl font-bold text-slate-900 mt-1">
            {cargandoKpis
              ? '—'
              : (kpis?.total_registros_importados ?? 0).toLocaleString('es-AR')}
          </p>
        </div>
        <div className="kpi-card">
          <p className="text-xs text-slate-600 font-medium uppercase tracking-wide">
            Última importación
          </p>
          {cargandoKpis ? (
            <p className="text-sm text-slate-500 mt-1">—</p>
          ) : kpis?.ultima_importacion ? (
            <div className="mt-1">
              <p className="text-sm font-semibold text-slate-900">
                {formatFechaHora(kpis.ultima_importacion.fecha_fin)}
              </p>
              <div className="mt-1">
                <EstadoImportacionBadge
                  estado={kpis.ultima_importacion.estado_proceso}
                  size="sm"
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500 mt-1">Sin datos</p>
          )}
        </div>
        <div className="kpi-card">
          <p className="text-xs text-slate-600 font-medium uppercase tracking-wide">
            Esta semana
          </p>
          <p className="text-3xl font-bold text-slate-900 mt-1">
            {cargandoKpis
              ? '—'
              : (kpis?.importaciones_esta_semana ?? 0).toLocaleString('es-AR')}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[220px]">
            <label className="text-xs text-slate-600 block mb-1">Búsqueda</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                className="form-input pl-9 w-full"
                placeholder="Archivo o notas..."
                value={busquedaInput}
                onChange={(e) => setBusquedaInput(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-600 block mb-1">Estado</label>
            <select
              className="form-input"
              value={qsEstado}
              onChange={(e) => actualizarFiltros({ estado: e.target.value, pagina: '1' })}
            >
              <option value="TODAS">Todas</option>
              <option value="COMPLETADA">Completada</option>
              <option value="FALLIDA">Fallida</option>
              <option value="CANCELADA">Cancelada</option>
              <option value="EN_PROCESO">En proceso</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-600 block mb-1">Modo</label>
            <select
              className="form-input"
              value={qsTipo}
              onChange={(e) => actualizarFiltros({ tipo: e.target.value, pagina: '1' })}
            >
              <option value="TODAS">Todas</option>
              <option value="INICIAL">Inicial</option>
              <option value="INCREMENTAL">Incremental</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-600 block mb-1">Período</label>
            <select
              className="form-input"
              value={qsPeriodo}
              onChange={(e) =>
                actualizarFiltros({
                  periodo: e.target.value,
                  pagina: '1',
                  fecha_desde: '',
                  fecha_hasta: '',
                })
              }
            >
              <option value="TODAS">Todas</option>
              <option value="HOY">Hoy</option>
              <option value="SEMANA">Esta semana</option>
              <option value="MES">Este mes</option>
              <option value="ANIO">Este año</option>
              <option value="PERSONALIZADO">Personalizado</option>
            </select>
          </div>
          {qsPeriodo === 'PERSONALIZADO' && (
            <>
              <div>
                <label className="text-xs text-slate-600 block mb-1">Desde</label>
                <input
                  type="date"
                  className="form-input"
                  value={qsDesde.split('T')[0] || ''}
                  onChange={(e) =>
                    actualizarFiltros({
                      fecha_desde: e.target.value
                        ? new Date(e.target.value + 'T00:00:00').toISOString()
                        : '',
                      pagina: '1',
                    })
                  }
                />
              </div>
              <div>
                <label className="text-xs text-slate-600 block mb-1">Hasta</label>
                <input
                  type="date"
                  className="form-input"
                  value={qsHasta.split('T')[0] || ''}
                  onChange={(e) =>
                    actualizarFiltros({
                      fecha_hasta: e.target.value
                        ? new Date(e.target.value + 'T23:59:59').toISOString()
                        : '',
                      pagina: '1',
                    })
                  }
                />
              </div>
            </>
          )}
          <button className="btn-secondary text-xs" onClick={limpiarFiltros}>
            <X className="w-3 h-3 inline mr-1" />
            Limpiar
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="crm-table w-full">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Archivos</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Registros</th>
                <th>Usuario</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr>
                  <td colSpan={7} className="text-center py-10">
                    <Loader2 className="w-5 h-5 text-slate-500 animate-spin inline" />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-sm text-slate-600">
                    No hay importaciones que coincidan con los filtros
                  </td>
                </tr>
              ) : (
                items.map((imp) => {
                  const archInfo = nombresArchivos(imp);
                  const dDesc = puedeDeshacer(imp);
                  return (
                    <tr
                      key={imp.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() =>
                        router.push(`/crm/importar/historial/${imp.id}`)
                      }
                    >
                      <td className="text-xs text-slate-700">
                        {formatFechaHora(imp.created_at)}
                      </td>
                      <td>
                        <span
                          className="text-xs text-slate-700"
                          title={archInfo.tooltip}
                        >
                          {archInfo.count} archivo{archInfo.count === 1 ? '' : 's'}
                        </span>
                      </td>
                      <td>
                        <span className="text-2xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded">
                          {imp.tipo || 'INICIAL'}
                        </span>
                      </td>
                      <td>
                        <EstadoImportacionBadge estado={imp.estado_proceso} size="sm" />
                      </td>
                      <td className="font-mono text-xs text-slate-900">
                        {registrosTotal(imp)}
                      </td>
                      <td className="text-xs text-slate-700">
                        {nombreUsuario(imp.usuario_id)}
                      </td>
                      <td className="text-right">
                        <div className="inline-flex items-center gap-1">
                          {(() => {
                            const urlCont = urlContinuarImportacion({
                              id: imp.id,
                              estado: imp.estado_proceso,
                              tipo: imp.tipo,
                            });
                            if (urlCont) {
                              return (
                                <button
                                  className="text-2xs text-white bg-amber-600 hover:bg-amber-700 inline-flex items-center gap-1 px-2 py-1 rounded font-semibold"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    router.push(urlCont);
                                  }}
                                >
                                  <ArrowRight className="w-3 h-3" />
                                  {labelContinuarImportacion(imp.estado_proceso)}
                                </button>
                              );
                            }
                            return null;
                          })()}
                          <button
                            className="text-2xs text-violet-700 hover:text-violet-900 inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-violet-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/crm/importar/historial/${imp.id}`);
                            }}
                          >
                            <Eye className="w-3 h-3" />
                            Ver
                          </button>
                          {dDesc && (
                            <button
                              className="text-2xs text-amber-700 hover:text-amber-900 inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-amber-50 disabled:opacity-50"
                              onClick={(e) => deshacerImp(e, imp)}
                              disabled={deshaciendoId === imp.id}
                            >
                              {deshaciendoId === imp.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RotateCcw className="w-3 h-3" />
                              )}
                              Deshacer
                            </button>
                          )}
                          {puedeCancelar(imp.estado_proceso) && (
                            <button
                              className="text-2xs text-red-700 hover:text-red-900 inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-red-50"
                              onClick={(e) => cancelarImp(e, imp)}
                              title="Cancelar importación"
                            >
                              <X className="w-3 h-3" />
                              Cancelar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <p className="text-xs text-slate-600">
              Mostrando {(qsPagina - 1) * POR_PAGINA + 1}-
              {Math.min(qsPagina * POR_PAGINA, total)} de {total.toLocaleString('es-AR')}
            </p>
            <div className="flex items-center gap-2">
              <button
                className="btn-secondary text-xs disabled:opacity-50"
                disabled={qsPagina <= 1}
                onClick={() => actualizarFiltros({ pagina: String(qsPagina - 1) })}
              >
                <ChevronLeft className="w-3 h-3 inline" />
                Anterior
              </button>
              <span className="text-xs text-slate-600">
                Página {qsPagina} de {totalPaginas}
              </span>
              <button
                className="btn-secondary text-xs disabled:opacity-50"
                disabled={qsPagina >= totalPaginas}
                onClick={() => actualizarFiltros({ pagina: String(qsPagina + 1) })}
              >
                Siguiente
                <ChevronRight className="w-3 h-3 inline" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HistorialPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
        </div>
      }
    >
      <HistorialContent />
    </Suspense>
  );
}
