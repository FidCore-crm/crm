'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  CheckCircle2,
  Loader2,
  FileSpreadsheet,
  FileText,
  XCircle,
  AlertCircle,
  ArrowLeft,
  Sparkles,
} from 'lucide-react';
import { useImportacionPolling } from '@/lib/hooks/useImportacionPolling';
import { apiCall } from '@/lib/api-client';

function iconoArchivo(nombre: string) {
  const ext = (nombre || '').toLowerCase().split('.').pop() ?? '';
  if (ext === 'xlsx' || ext === 'xls') {
    return <FileSpreadsheet className="w-5 h-5 text-green-600" />;
  }
  if (ext === 'pdf') {
    return <FileText className="w-5 h-5 text-red-600" />;
  }
  return <FileText className="w-5 h-5 text-slate-600" />;
}

function formatearTamano(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type StepStatus = 'pending' | 'active' | 'done';

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return (
      <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
        <CheckCircle2 className="w-6 h-6 text-green-600" />
      </div>
    );
  }
  if (status === 'active') {
    return (
      <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center animate-pulse">
        <Loader2 className="w-6 h-6 text-violet-600 animate-spin" />
      </div>
    );
  }
  return (
    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
      <div className="w-3 h-3 rounded-full bg-slate-300" />
    </div>
  );
}

export default function ProcesandoPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) || '';
  const { estado, error } = useImportacionPolling(id, { intervaloMs: 2500 });
  const [mostrarDetalleError, setMostrarDetalleError] = useState(false);
  const [cancelando, setCancelando] = useState(false);

  useEffect(() => {
    if (!estado) return;
    if (estado.estado === 'ANALIZADO') {
      const destino =
        estado.tipo === 'INCREMENTAL'
          ? `/crm/importar/${id}/comparar`
          : `/crm/importar/${id}/plan`;
      router.push(destino);
    }
  }, [estado, id, router]);

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

  const e = estado?.estado || 'PENDIENTE';
  const step1: StepStatus = 'done';
  const step2: StepStatus =
    e === 'PENDIENTE' || e === 'ANALIZANDO' ? 'active' : 'done';
  const step3: StepStatus =
    e === 'PENDIENTE' || e === 'ANALIZANDO'
      ? 'pending'
      : e === 'REFINANDO'
      ? 'active'
      : 'done';
  const step4: StepStatus = e === 'ANALIZADO' ? 'done' : 'pending';

  const fallida = e === 'FALLIDA';
  const cancelada = e === 'CANCELADA';

  if (fallida) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="bg-white rounded-xl border border-red-200 p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 mb-4">
            <XCircle className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">El análisis falló</h1>
          <p className="text-sm text-slate-600 mb-6">
            Ocurrió un error durante el análisis estructural de tus archivos.
          </p>
          {estado?.error && (
            <div className="text-left mb-4">
              <button
                className="text-xs text-violet-600 font-medium"
                onClick={() => setMostrarDetalleError((v) => !v)}
              >
                {mostrarDetalleError ? 'Ocultar' : 'Ver'} detalles
              </button>
              {mostrarDetalleError && (
                <pre className="mt-2 p-3 bg-red-50 border border-red-200 rounded text-2xs text-red-800 whitespace-pre-wrap overflow-x-auto">
                  {estado.error}
                </pre>
              )}
            </div>
          )}
          <button className="btn-primary" onClick={() => router.push('/crm/importar')}>
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  if (cancelada) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 mb-4">
            <AlertCircle className="w-8 h-8 text-slate-600" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Importación cancelada</h1>
          <p className="text-sm text-slate-600 mb-6">
            Cancelaste el análisis. Los archivos fueron descartados.
          </p>
          <button className="btn-primary" onClick={() => router.push('/crm/importar')}>
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Analizando tus archivos</h1>
          <p className="text-sm text-slate-600 mt-1">
            La IA está detectando la estructura de tu cartera
          </p>
        </div>
        <button className="btn-danger" onClick={cancelar} disabled={cancelando}>
          {cancelando ? 'Cancelando...' : 'Cancelar importación'}
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          Reintentando consulta de estado... ({error})
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-8 mb-6">
        <ol className="space-y-6">
          <li className="flex items-start gap-4">
            <StepIcon status={step1} />
            <div className="flex-1 pt-1">
              <p className="text-sm font-semibold text-slate-800">Archivos cargados</p>
              <p className="text-xs text-slate-600 mt-0.5">
                Archivos subidos y validados correctamente
              </p>
            </div>
          </li>
          <li className="flex items-start gap-4">
            <StepIcon status={step2} />
            <div className="flex-1 pt-1">
              <p className="text-sm font-semibold text-slate-800">
                Analizando estructura con IA
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                Claude identifica qué contiene cada archivo
              </p>
            </div>
          </li>
          <li className="flex items-start gap-4">
            <StepIcon status={step3} />
            <div className="flex-1 pt-1">
              <p className="text-sm font-semibold text-slate-800">
                Detectando relaciones entre archivos
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                Busca vínculos por DNI o número de póliza
              </p>
            </div>
          </li>
          <li className="flex items-start gap-4">
            <StepIcon status={step4} />
            <div className="flex-1 pt-1">
              <p className="text-sm font-semibold text-slate-800">
                Generando plan de importación
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                Propone mapeo de columnas y valida catálogos
              </p>
            </div>
          </li>
        </ol>
      </div>

      <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 mb-6 flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-violet-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm text-violet-900 font-medium">Esto puede tardar 30s a 2min</p>
          <p className="text-xs text-violet-700 mt-1">
            Podés cerrar esta pantalla — el análisis continúa en segundo plano y te avisamos
            en la campana de notificaciones.
          </p>
        </div>
      </div>

      {estado?.archivos_metadata && estado.archivos_metadata.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Archivos en proceso</h2>
          <ul className="space-y-2">
            {estado.archivos_metadata.map((a, idx: number) => (
              <li
                key={idx}
                className="flex items-center gap-3 p-2 rounded-lg border border-slate-100"
              >
                {iconoArchivo(a.nombre)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800 truncate">{a.nombre}</p>
                  {a.size_bytes && (
                    <p className="text-2xs text-slate-600">{formatearTamano(a.size_bytes)}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        className="btn-secondary w-full flex items-center justify-center gap-2"
        onClick={() => router.push('/crm/dashboard')}
      >
        <ArrowLeft className="w-4 h-4" />
        Volver al dashboard
      </button>
    </div>
  );
}
