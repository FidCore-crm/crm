'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Loader2,
  XCircle,
  ArrowLeft,
  Users,
  FileText,
  Shield,
  X,
} from 'lucide-react';
import { useImportacionPolling } from '@/lib/hooks/useImportacionPolling';
import { apiCall } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import type { IdsCreadosActualizados } from '@/lib/importacion/types';

interface ResumenParcial {
  clientes_creados: number | null;
  polizas_creadas: number | null;
  ids_creados: IdsCreadosActualizados | null;
}

export default function ImportandoPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) || '';
  const { estado, error } = useImportacionPolling(id, { intervaloMs: 1000 });
  const [resumen, setResumen] = useState<ResumenParcial | null>(null);
  const [cancelando, setCancelando] = useState(false);

  async function cancelar() {
    const msg =
      '¿Cancelar la importación?\n\n' +
      'ATENCIÓN: los registros que ya se insertaron en la base quedarán. ' +
      'Para revertir toda la importación desde cero usá "Deshacer" en el ' +
      'historial (disponible dentro de las 24h posteriores).';
    if (!window.confirm(msg)) return;
    setCancelando(true);
    const r = await apiCall(`/api/importar/${id}/cancelar`, { method: 'POST' }, { mostrar_toast_en_error: false });
    if (r.ok) {
      toast.info('Importación cancelada');
      router.push('/crm/importar');
    } else {
      toast.error(r.error?.mensaje ?? 'No se pudo cancelar');
      setCancelando(false);
    }
  }

  // Poll resumen en paralelo para contadores parciales
  useEffect(() => {
    if (!id) return;
    let alive = true;
    async function fetchResumen() {
      type ResumenResp = {
        importacion?: {
          clientes_creados: number | null;
          polizas_creadas: number | null;
          ids_creados: IdsCreadosActualizados | null;
        };
      };
      const r = await apiCall<ResumenResp>(`/api/importar/${id}/resumen`, {
        cache: 'no-store',
      }, { mostrar_toast_en_error: false });
      if (alive && r.ok && r.data?.importacion) {
        const imp = r.data.importacion;
        setResumen({
          clientes_creados: imp.clientes_creados ?? 0,
          polizas_creadas: imp.polizas_creadas ?? 0,
          ids_creados: imp.ids_creados ?? null,
        });
      }
    }
    fetchResumen();
    const t = setInterval(fetchResumen, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);

  useEffect(() => {
    if (!estado) return;
    if (estado.estado === 'COMPLETADA') {
      router.replace(`/crm/importar/${id}/completada`);
    }
  }, [estado, id, router]);

  if (!estado) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
      </div>
    );
  }

  if (estado.estado === 'FALLIDA') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="bg-white rounded-xl border border-red-200 p-8 text-center">
          <XCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-900 mb-2">
            La importación falló
          </h1>
          {estado.error && (
            <pre className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-2xs text-red-800 whitespace-pre-wrap text-left">
              {estado.error}
            </pre>
          )}
          <div className="flex gap-3 justify-center mt-6">
            <button
              className="btn-secondary"
              onClick={() => router.push('/crm/importar')}
            >
              Volver al inicio
            </button>
          </div>
        </div>
      </div>
    );
  }

  const progreso = estado.progreso || { actual: 0, total: 0, porcentaje: 0 };
  const jobs = estado.jobs || {
    pendientes: 0,
    ejecutando: 0,
    completados: 0,
    fallidos: 0,
  };
  const totalJobs = jobs.completados + jobs.ejecutando + jobs.pendientes;

  const riesgosCount = Array.isArray(resumen?.ids_creados?.riesgos)
    ? resumen!.ids_creados.riesgos.length
    : 0;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">
          Importando a tu base de datos
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Estamos creando los registros definitivos
        </p>
      </div>

      {error && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          Reintentando consulta de estado... ({error})
        </div>
      )}

      {/* Barra de progreso */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-4">
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-4xl font-bold text-slate-900">
              {progreso.porcentaje}%
            </p>
            <p className="text-sm text-slate-600">
              {progreso.actual} de {progreso.total} registros
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">
              Procesando bloque {jobs.completados} de {totalJobs || 1}
            </p>
          </div>
        </div>
        <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-violet-600 transition-all duration-500"
            style={{
              width: `${Math.min(100, Math.max(0, progreso.porcentaje))}%`,
            }}
          />
        </div>
      </div>

      {/* Contadores parciales */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Users className="w-4 h-4 text-violet-600" />
            <p className="text-xs font-medium text-slate-600">Clientes</p>
          </div>
          <p className="text-2xl font-bold text-slate-900">
            {resumen?.clientes_creados ?? 0}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-violet-600" />
            <p className="text-xs font-medium text-slate-600">Pólizas</p>
          </div>
          <p className="text-2xl font-bold text-slate-900">
            {resumen?.polizas_creadas ?? 0}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-4 h-4 text-violet-600" />
            <p className="text-xs font-medium text-slate-600">Riesgos</p>
          </div>
          <p className="text-2xl font-bold text-slate-900">{riesgosCount}</p>
        </div>
      </div>

      <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 mb-4 text-sm text-violet-900 flex items-start gap-3">
        <Loader2 className="w-5 h-5 animate-spin flex-shrink-0 mt-0.5" />
        <p>
          El proceso continúa aunque cierres la pantalla. Te avisamos en la
          campana cuando termine.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          className="btn-secondary flex-1 flex items-center justify-center gap-2"
          onClick={() => router.push('/crm/dashboard')}
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al dashboard
        </button>
        <button
          className="btn-danger flex items-center justify-center gap-2"
          onClick={cancelar}
          disabled={cancelando}
        >
          {cancelando ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
          {cancelando ? 'Cancelando...' : 'Cancelar importación'}
        </button>
      </div>
    </div>
  );
}
