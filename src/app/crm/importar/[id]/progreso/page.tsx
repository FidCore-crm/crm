'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowLeft,
  Pause,
  ExternalLink,
} from 'lucide-react';
import { useImportacionPolling } from '@/lib/hooks/useImportacionPolling';
import { apiCall } from '@/lib/api-client';
import { toast } from '@/lib/toast';

function formatearTiempo(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '—';
  const totalSeg = Math.floor(ms / 1000);
  const m = Math.floor(totalSeg / 60);
  const s = totalSeg % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export default function ProgresoPage() {
  const router = useRouter();
  const params = useParams();
  const id = (params?.id as string) || '';
  const { estado, error } = useImportacionPolling(id, { intervaloMs: 2500 });
  const [ahora, setAhora] = useState(() => Date.now());
  const [cancelando, setCancelando] = useState(false);
  const [reanudando, setReanudando] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!estado) return;
    if (estado.estado === 'REVISANDO') {
      const dudosos =
        estado.registros?.pendientes_revision ?? estado.registros?.dudosos ?? 0;
      router.push(
        dudosos > 0
          ? `/crm/importar/${id}/revisar`
          : `/crm/importar/${id}/confirmar`
      );
    } else if (estado.estado === 'COMPLETADA') {
      router.push(`/crm/importar/${id}/completada`);
    }
  }, [estado, id, router]);

  async function cancelar() {
    if (!window.confirm('¿Cancelar el procesamiento? Se detendrán los lotes pendientes.')) return;
    setCancelando(true);
    const r = await apiCall(`/api/importar/${id}/cancelar`, { method: 'POST' });
    if (r.ok) {
      router.push('/crm/importar');
    } else {
      setCancelando(false);
    }
  }

  async function reanudar() {
    setReanudando(true);
    const r = await apiCall<{ jobs_reactivados?: number }>(`/api/importar/${id}/reanudar`, {
      method: 'POST',
    });
    if (r.ok) {
      toast.exito(`Procesamiento reanudado. ${r.data?.jobs_reactivados ?? 0} jobs reactivados.`);
    }
    setReanudando(false);
  }

  if (!estado) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
      </div>
    );
  }

  const e = estado.estado;
  const progreso = estado.progreso || { actual: 0, total: 0, porcentaje: 0 };
  const lotes = estado.lotes || { total: 0, completados: 0, fallidos: 0, pendientes: 0, procesando: 0 };
  const registros = estado.registros || { listos: 0, dudosos: 0, pendientes_revision: 0, resueltos: 0 };

  const inicioMs = estado.fecha_inicio ? new Date(estado.fecha_inicio).getTime() : ahora;
  const elapsedMs = Math.max(0, ahora - inicioMs);
  const tiempoTranscurrido = formatearTiempo(elapsedMs);
  const tiempoRestante =
    progreso.porcentaje > 5
      ? formatearTiempo((elapsedMs / progreso.porcentaje) * (100 - progreso.porcentaje))
      : 'Calculando...';

  // Estados especiales
  if (e === 'FALLIDA') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="bg-white rounded-xl border border-red-200 p-8 text-center">
          <XCircle className="w-12 h-12 text-red-600 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-900 mb-2">
            El procesamiento falló
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

  const pausada = e === 'PAUSADA';

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Procesando tu cartera</h1>
          <p className="text-sm text-slate-600 mt-1">
            Los registros se están importando en lotes
          </p>
        </div>
        <button className="btn-danger" onClick={cancelar} disabled={cancelando}>
          {cancelando ? 'Cancelando...' : 'Cancelar'}
        </button>
      </div>

      {pausada && (
        <div className="mb-6 bg-amber-50 border border-amber-300 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <Pause className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900">
                Procesamiento pausado
              </p>
              <p className="text-xs text-amber-800 mt-1">
                {estado.error || 'Se pausó el procesamiento. Verificá saldo en Anthropic.'}
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  className="btn-secondary text-xs flex items-center gap-1"
                  onClick={() =>
                    window.open('https://console.anthropic.com', '_blank')
                  }
                >
                  <ExternalLink className="w-3 h-3" />
                  Verificar saldo en Anthropic
                </button>
                <button
                  className="btn-primary text-xs flex items-center gap-1"
                  onClick={reanudar}
                  disabled={reanudando}
                >
                  {reanudando && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  {reanudando ? 'Reanudando...' : 'Reanudar procesamiento'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
          Reintentando consulta de estado... ({error})
        </div>
      )}

      {/* Barra de progreso */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-4">
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-3xl font-bold text-slate-900">
              {progreso.porcentaje}%
            </p>
            <p className="text-sm text-slate-600">
              {progreso.actual} de {progreso.total} registros
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-600">
              Lote {lotes.completados} de {lotes.total}
            </p>
            <p className="text-2xs text-slate-500 mt-0.5">
              {lotes.procesando > 0 && `${lotes.procesando} en curso · `}
              {lotes.pendientes} pendientes
            </p>
          </div>
        </div>
        <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-violet-600 transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, progreso.porcentaje))}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-3 text-xs text-slate-600">
          <span>Transcurrido: {tiempoTranscurrido}</span>
          <span>Restante estimado: {tiempoRestante}</span>
        </div>
      </div>

      {/* Detalles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <p className="text-xs font-medium text-slate-600">Listos</p>
          </div>
          <p className="text-2xl font-bold text-green-700">{registros.listos}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <p className="text-xs font-medium text-slate-600">Dudosos</p>
          </div>
          <p className="text-2xl font-bold text-amber-700">{registros.dudosos}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="w-4 h-4 text-red-600" />
            <p className="text-xs font-medium text-slate-600">Errores</p>
          </div>
          <p className="text-2xl font-bold text-red-700">{lotes.fallidos}</p>
        </div>
      </div>

      {/* Info */}
      <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 mb-4 text-sm text-violet-900">
        El procesamiento continúa aunque cierres esta pantalla. Te avisaremos en la campana
        de notificaciones cuando termine.
      </div>

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
