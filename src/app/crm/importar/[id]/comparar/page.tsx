'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  Edit3,
  Plus,
  RefreshCw,
  AlertTriangle,
  Loader2,
  XCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { apiCall } from '@/lib/api-client';

type Comparacion = {
  personas: {
    sin_cambios: number;
    con_cambios: number;
    nuevas: number;
    duplicadas: number;
    muestra_con_cambios: Array<{ dni: string; nombre: string; cambios: Record<string, { antes: unknown; despues: unknown }> }>;
  };
  polizas: {
    sin_cambios: number;
    con_cambios: number;
    nuevas: number;
    renovaciones_detectadas: number;
    no_encontradas: number;
    no_encontradas_detalle: Array<{ id: string; numero_poliza: string; cliente: string }>;
    muestra_con_cambios: Array<{ numero: string; cliente: string; cambios: Record<string, { antes: unknown; despues: unknown }> }>;
  };
  cartera_actual: { clientes: number; polizas: number };
};

type ModoAplicacion = 'AUTOMATICO' | 'REVISAR_SOSPECHOSOS' | 'SOLO_NUEVOS';
type AccionNoEncontradas = 'NO_TOCAR' | 'MARCAR_BAJAS';

function resumenCambios(cambios: Record<string, { antes: unknown; despues: unknown }>): string {
  const keys = Object.keys(cambios);
  if (keys.length === 0) return '';
  if (keys.length <= 2) return keys.join(' + ');
  return `${keys.length} campos modificados`;
}

function formatCambio(campo: string, c: { antes: unknown; despues: unknown }): string {
  const antes = c.antes == null || c.antes === '' ? '(vacío)' : String(c.antes);
  const despues = c.despues == null || c.despues === '' ? '(vacío)' : String(c.despues);
  return `${campo}: ${antes} → ${despues}`;
}

export default function CompararPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) || '';

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [comparacion, setComparacion] = useState<Comparacion | null>(null);
  const [modo, setModo] = useState<ModoAplicacion>('REVISAR_SOSPECHOSOS');
  const [accionNoEncontradas, setAccionNoEncontradas] = useState<AccionNoEncontradas>('NO_TOCAR');
  const [verNoEncontradas, setVerNoEncontradas] = useState(false);
  const [verClientes, setVerClientes] = useState(true);
  const [verPolizas, setVerPolizas] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [cancelando, setCancelando] = useState(false);

  useEffect(() => {
    let activo = true;
    (async () => {
      setCargando(true);
      setError('');
      const r = await apiCall<Comparacion>(`/api/importar/${id}/comparacion`, { cache: 'no-store' }, { mostrar_toast_en_error: false });
      if (!activo) return;
      if (r.ok && r.data) {
        setComparacion(r.data);
      } else {
        setError(r.error?.mensaje || 'No se pudo cargar el análisis comparativo');
      }
      setCargando(false);
    })();
    return () => {
      activo = false;
    };
  }, [id]);

  async function cancelar() {
    if (!window.confirm('¿Seguro que querés cancelar la importación?')) return;
    setCancelando(true);
    const r = await apiCall(`/api/importar/${id}/cancelar`, { method: 'POST' }, { mostrar_toast_en_error: false });
    if (r.ok) {
      router.push('/crm/importar');
    } else {
      setCancelando(false);
    }
  }

  async function aplicarPlan() {
    setEnviando(true);
    const r = await apiCall(`/api/importar/${id}/aplicar-comparacion`, {
      method: 'POST',
      body: {
        modo_aplicacion: modo,
        polizas_no_encontradas: accionNoEncontradas,
      },
    }, { mostrar_toast_en_error: false });
    if (r.ok) {
      router.push(`/crm/importar/${id}/progreso`);
    } else {
      setError(r.error?.mensaje || 'No se pudo aplicar el plan');
      setEnviando(false);
    }
  }

  if (cargando) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-16 text-center">
        <Loader2 className="w-10 h-10 text-violet-600 animate-spin mx-auto mb-4" />
        <p className="text-sm text-slate-600">Analizando cambios contra tu cartera actual...</p>
      </div>
    );
  }

  if (error && !comparacion) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="bg-white rounded-xl border border-red-200 p-8 text-center">
          <XCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-900 mb-2">Error en el análisis</h1>
          <p className="text-sm text-slate-600 mb-6">{error}</p>
          <button className="btn-primary" onClick={() => router.push('/crm/importar')}>
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  if (!comparacion) return null;

  const { personas, polizas, cartera_actual } = comparacion;

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 pb-32">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <button
            className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-700 mb-2"
            onClick={() => router.push('/crm/importar')}
          >
            <ArrowLeft className="w-3 h-3" /> Volver
          </button>
          <h1 className="text-2xl font-bold text-slate-900">Análisis comparativo</h1>
          <p className="text-sm text-slate-600 mt-1">
            Detectamos los cambios entre tu cartera actual y los archivos cargados.
          </p>
        </div>
        <button className="btn-danger" onClick={cancelar} disabled={cancelando}>
          {cancelando ? 'Cancelando...' : 'Cancelar importación'}
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded p-3 text-xs text-red-800">
          {error}
        </div>
      )}

      {/* Resumen */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <p className="text-sm text-slate-600 mb-4">
          Tu cartera actual: <strong>{cartera_actual.clientes}</strong> clientes,{' '}
          <strong>{cartera_actual.polizas}</strong> pólizas vigentes
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">
              Clientes
            </h3>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="w-4 h-4" /> {personas.sin_cambios} sin cambios
              </li>
              <li className="flex items-center gap-2 text-amber-700">
                <Edit3 className="w-4 h-4" /> {personas.con_cambios} con cambios
              </li>
              <li className="flex items-center gap-2 text-blue-700">
                <Plus className="w-4 h-4" /> {personas.nuevas} nuevos
              </li>
              {personas.duplicadas > 0 && (
                <li className="flex items-center gap-2 text-slate-600">
                  <AlertTriangle className="w-4 h-4" /> {personas.duplicadas} duplicados
                </li>
              )}
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">
              Pólizas
            </h3>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="w-4 h-4" /> {polizas.sin_cambios} sin cambios
              </li>
              <li className="flex items-center gap-2 text-amber-700">
                <Edit3 className="w-4 h-4" /> {polizas.con_cambios} con cambios
              </li>
              <li className="flex items-center gap-2 text-blue-700">
                <Plus className="w-4 h-4" /> {polizas.nuevas} nuevas
              </li>
              <li className="flex items-center gap-2 text-violet-700">
                <RefreshCw className="w-4 h-4" /> {polizas.renovaciones_detectadas} renovaciones
              </li>
              {polizas.no_encontradas > 0 && (
                <li className="flex items-center gap-2 text-red-700">
                  <AlertTriangle className="w-4 h-4" /> {polizas.no_encontradas} no encontradas
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* Detalles clientes con cambios */}
      {personas.con_cambios > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 mb-4 overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50"
            onClick={() => setVerClientes((v) => !v)}
          >
            <span className="font-semibold text-sm text-slate-800">
              Clientes con cambios ({personas.con_cambios})
            </span>
            {verClientes ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {verClientes && (
            <div className="border-t border-slate-200 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Cliente</th>
                    <th className="text-left px-4 py-2 font-medium">DNI</th>
                    <th className="text-left px-4 py-2 font-medium">Cambios</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {personas.muestra_con_cambios.map((p, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2 text-slate-800">{p.nombre}</td>
                      <td className="px-4 py-2 font-mono text-slate-600">{p.dni}</td>
                      <td className="px-4 py-2 text-slate-600">{resumenCambios(p.cambios)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {personas.con_cambios > personas.muestra_con_cambios.length && (
                <p className="text-2xs text-slate-600 p-3 text-center">
                  Mostrando los primeros {personas.muestra_con_cambios.length} de{' '}
                  {personas.con_cambios}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Detalles pólizas con cambios */}
      {polizas.con_cambios > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 mb-4 overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50"
            onClick={() => setVerPolizas((v) => !v)}
          >
            <span className="font-semibold text-sm text-slate-800">
              Pólizas con cambios ({polizas.con_cambios})
            </span>
            {verPolizas ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {verPolizas && (
            <div className="border-t border-slate-200 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Nº Póliza</th>
                    <th className="text-left px-4 py-2 font-medium">Cambios detectados</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {polizas.muestra_con_cambios.map((p, i) => {
                    const entries = Object.entries(p.cambios).slice(0, 2);
                    return (
                      <tr key={i}>
                        <td className="px-4 py-2 font-mono text-slate-700">{p.numero}</td>
                        <td className="px-4 py-2 text-slate-600">
                          {entries.map(([k, v]) => formatCambio(k, v)).join(' · ')}
                          {Object.keys(p.cambios).length > 2 && (
                            <span className="text-slate-500"> (+{Object.keys(p.cambios).length - 2})</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Plan de aplicación */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">¿Cómo querés aplicar los cambios?</h3>
        <div className="space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="modo"
              className="mt-1"
              checked={modo === 'REVISAR_SOSPECHOSOS'}
              onChange={() => setModo('REVISAR_SOSPECHOSOS')}
            />
            <div>
              <p className="text-sm font-medium text-slate-800">
                Revisar cambios sospechosos primero{' '}
                <span className="text-2xs text-violet-600">(recomendado)</span>
              </p>
              <p className="text-xs text-slate-600">
                Aplica automáticamente los cambios simples y te pide confirmación en los dudosos.
              </p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="modo"
              className="mt-1"
              checked={modo === 'AUTOMATICO'}
              onChange={() => setModo('AUTOMATICO')}
            />
            <div>
              <p className="text-sm font-medium text-slate-800">Aplicar todos los cambios automáticamente</p>
              <p className="text-xs text-slate-600">
                Actualiza todo sin revisión intermedia. Más rápido, menos seguro.
              </p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="modo"
              className="mt-1"
              checked={modo === 'SOLO_NUEVOS'}
              onChange={() => setModo('SOLO_NUEVOS')}
            />
            <div>
              <p className="text-sm font-medium text-slate-800">Solo importar los nuevos</p>
              <p className="text-xs text-slate-600">
                Ignora los cambios en clientes/pólizas existentes, importa únicamente lo nuevo.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Pólizas no encontradas */}
      {polizas.no_encontradas > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-4">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-900">
                {polizas.no_encontradas} pólizas vigentes no están en el archivo
              </p>
              <p className="text-xs text-amber-800 mt-1">
                Estas pólizas figuran como VIGENTES en tu CRM pero no aparecen en el archivo importado.
                Pueden ser bajas que olvidaste, pólizas renovadas bajo otro número, o simplemente no
                incluidas en esta tanda.
              </p>
            </div>
          </div>
          <div className="space-y-2 ml-8">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="no_enc"
                className="mt-1"
                checked={accionNoEncontradas === 'NO_TOCAR'}
                onChange={() => setAccionNoEncontradas('NO_TOCAR')}
              />
              <div>
                <p className="text-sm font-medium text-amber-900">
                  No tocar <span className="text-2xs text-amber-700">(recomendado)</span>
                </p>
                <p className="text-xs text-amber-800">Deja las pólizas como están.</p>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="no_enc"
                className="mt-1"
                checked={accionNoEncontradas === 'MARCAR_BAJAS'}
                onChange={() => setAccionNoEncontradas('MARCAR_BAJAS')}
              />
              <div>
                <p className="text-sm font-medium text-amber-900">Marcar como posibles bajas para revisar</p>
                <p className="text-xs text-amber-800">Crea tareas de revisión para cada una.</p>
              </div>
            </label>
          </div>
          <button
            className="ml-8 mt-3 text-xs text-amber-700 underline hover:text-amber-900"
            onClick={() => setVerNoEncontradas((v) => !v)}
          >
            {verNoEncontradas ? 'Ocultar' : 'Ver'} las {polizas.no_encontradas} pólizas
          </button>
          {verNoEncontradas && (
            <div className="mt-3 ml-8 bg-white rounded border border-amber-200 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-amber-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-amber-900">Nº Póliza</th>
                    <th className="text-left px-3 py-2 font-medium text-amber-900">ID Cliente</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-100">
                  {polizas.no_encontradas_detalle.map((p, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 font-mono text-slate-700">{p.numero_poliza}</td>
                      <td className="px-3 py-1.5 font-mono text-2xs text-slate-600">{p.cliente}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Botones sticky */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg z-20">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button className="btn-secondary" onClick={cancelar} disabled={cancelando || enviando}>
            Cancelar importación
          </button>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={aplicarPlan}
            disabled={enviando}
          >
            {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
            {enviando ? 'Aplicando...' : 'Aplicar el plan e importar'}
          </button>
        </div>
      </div>
    </div>
  );
}
