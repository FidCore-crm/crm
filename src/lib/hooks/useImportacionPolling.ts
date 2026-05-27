'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';

export interface EstadoImportacionPoll {
  importacion_id: string;
  estado: string;
  tipo?: string;
  progreso: { actual: number; total: number; porcentaje: number };
  lotes: {
    total: number;
    completados: number;
    fallidos: number;
    pendientes: number;
    procesando: number;
  };
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
  archivos_metadata?: any[];
  error?: string;
  fecha_inicio?: string;
  fecha_fin?: string;
}

interface Options {
  /**
   * Legacy. El hook ya no hace polling — usa Supabase Realtime suscrito a las
   * 4 tablas (`importaciones`, `importacion_lotes`, `importacion_jobs`,
   * `importacion_registros_dudosos`) filtradas por la importación. Cualquier
   * INSERT/UPDATE/DELETE dispara un refetch al endpoint /estado con debounce
   * de 300ms (varios eventos en cascada → 1 fetch). Se mantiene aceptado por
   * compatibilidad con los callers existentes, pero su valor se ignora.
   */
  intervaloMs?: number;
  /**
   * Legacy. Como Realtime mantiene conexión websocket sin polling, no hay
   * ahorro real en "detenerse en estado final". Los canales se cierran cuando
   * el componente se desmonta. Aceptado pero ignorado.
   */
  detenerEnEstadosFinales?: boolean;
}

interface Result {
  estado: EstadoImportacionPoll | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useImportacionPolling(
  importacion_id: string | null | undefined,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options?: Options
): Result {
  const [estado, setEstado] = useState<EstadoImportacionPoll | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef<boolean>(true);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchEstado = useCallback(async () => {
    if (!importacion_id) return;
    try {
      setIsLoading(true);
      const res = await fetch(`/api/importar/${importacion_id}/estado`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      if (!json?.ok) {
        throw new Error(json?.error || 'Error al obtener estado');
      }
      if (!mountedRef.current) return;
      const { ok, ...rest } = json;
      setEstado(rest as EstadoImportacionPoll);
      setError(null);
    } catch (e: any) {
      if (!mountedRef.current) return;
      setError(e?.message || 'Error desconocido');
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [importacion_id]);

  // Refetch con debounce 300ms para colapsar cascadas de eventos
  // (varios lotes terminando a la vez, varios jobs fallando, etc.)
  const programarRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      if (mountedRef.current) fetchEstado();
    }, 300);
  }, [fetchEstado]);

  useEffect(() => {
    mountedRef.current = true;

    if (!importacion_id) {
      setEstado(null);
      return () => {
        mountedRef.current = false;
        if (refetchTimerRef.current) {
          clearTimeout(refetchTimerRef.current);
          refetchTimerRef.current = null;
        }
      };
    }

    // Fetch inicial inmediato (hidratación HTTP, no espera al primer evento)
    fetchEstado();

    const supabase = getSupabaseClient();

    const canalImportacion = supabase
      .channel(`imp-${importacion_id}`)
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'importaciones',
          filter: `id=eq.${importacion_id}`,
        },
        programarRefetch
      )
      .subscribe();

    const canalLotes = supabase
      .channel(`imp-lotes-${importacion_id}`)
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'importacion_lotes',
          filter: `importacion_id=eq.${importacion_id}`,
        },
        programarRefetch
      )
      .subscribe();

    const canalJobs = supabase
      .channel(`imp-jobs-${importacion_id}`)
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'importacion_jobs',
          filter: `importacion_id=eq.${importacion_id}`,
        },
        programarRefetch
      )
      .subscribe();

    const canalDudosos = supabase
      .channel(`imp-dudosos-${importacion_id}`)
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'importacion_registros_dudosos',
          filter: `importacion_id=eq.${importacion_id}`,
        },
        programarRefetch
      )
      .subscribe();

    // Revalidación al focus de la ventana (red de seguridad tras reconexión
    // del websocket o cuando el browser estuvo en background).
    const onFocus = () => {
      if (mountedRef.current) fetchEstado();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      mountedRef.current = false;
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current);
        refetchTimerRef.current = null;
      }
      window.removeEventListener('focus', onFocus);
      supabase.removeChannel(canalImportacion);
      supabase.removeChannel(canalLotes);
      supabase.removeChannel(canalJobs);
      supabase.removeChannel(canalDudosos);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importacion_id]);

  return {
    estado,
    isLoading,
    error,
    refetch: fetchEstado,
  };
}
