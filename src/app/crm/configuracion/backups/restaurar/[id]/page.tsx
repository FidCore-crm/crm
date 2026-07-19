'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AlertTriangle, Loader2, Shield } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import StepperRestauracion from '@/components/backups/StepperRestauracion'
import type { Restauracion, EstadoRestauracion } from '@/types/database'
import { apiCall } from '@/lib/api-client'
import { getSupabaseClient } from '@/lib/supabase/client'
import { toast } from '@/lib/toast'

const ESTADOS_CANCELABLES: EstadoRestauracion[] = ['PENDIENTE', 'VALIDANDO', 'PRE_BACKUP']

export default function ProgresoRestauracionPage() {
  const { id } = useParams() as { id: string }
  const router = useRouter()
  const { usuario, loading: authLoading, isAdmin } = useAuth()
  const [restauracion, setRestauracion] = useState<Restauracion | null>(null)
  const [cancelando, setCancelando] = useState(false)

  const mountedRef = useRef(true)
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!authLoading && (!usuario || !isAdmin)) {
      router.push('/crm/dashboard')
    }
  }, [authLoading, usuario, isAdmin, router])

  // Fetch del estado + lógica de redirect según estado final.
  const fetchEstado = useCallback(async () => {
    const r = await apiCall<{ restauracion: Restauracion }>(
      `/api/backups/restaurar/${id}/estado`,
      undefined,
      { mostrar_toast_en_error: false }
    )
    if (!mountedRef.current) return
    if (r.ok && r.data?.restauracion) {
      setRestauracion(r.data.restauracion)
      const estado = r.data.restauracion.estado as EstadoRestauracion
      if (estado === 'COMPLETADA') {
        router.replace(`/crm/configuracion/backups/restaurar/${id}/exito`)
        return
      }
      if (estado === 'FALLIDA') {
        router.replace(`/crm/configuracion/backups/restaurar/${id}/fallida`)
        return
      }
      if (estado === 'CANCELADA') {
        router.replace(`/crm/configuracion/backups`)
        return
      }
    }
  }, [id, router])

  // Refetch con debounce 300ms para colapsar eventos en cascada.
  const programarRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current)
    refetchTimerRef.current = setTimeout(() => {
      if (mountedRef.current) fetchEstado()
    }, 300)
  }, [fetchEstado])

  useEffect(() => {
    mountedRef.current = true

    // Hidratación inicial: una llamada HTTP, no esperamos al primer evento.
    fetchEstado()

    // Suscripción a Realtime: cualquier UPDATE en la fila de la restauración
    // (cambios de estado, porcentaje, mensaje_progreso) dispara un refetch.
    const supabase = getSupabaseClient()
    const canal = supabase
      .channel(`restauracion-${id}`)
      .on(
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'restauraciones',
          filter: `id=eq.${id}`,
        },
        programarRefetch
      )
      .subscribe()

    // Revalidación al focus de la ventana (red de seguridad tras reconexión).
    const onFocus = () => {
      if (mountedRef.current) fetchEstado()
    }
    window.addEventListener('focus', onFocus)

    return () => {
      mountedRef.current = false
      if (refetchTimerRef.current) {
        clearTimeout(refetchTimerRef.current)
        refetchTimerRef.current = null
      }
      window.removeEventListener('focus', onFocus)
      supabase.removeChannel(canal)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function cancelar() {
    if (!confirm('¿Cancelar la restauración? Solo se puede cancelar antes de que empiece a modificar la base de datos.')) return
    setCancelando(true)
    const r = await apiCall(`/api/backups/restaurar/${id}/cancelar`, { method: 'POST' }, { mostrar_toast_en_error: false })
    if (!r.ok) toast.error(r.error?.mensaje ?? 'No se pudo cancelar')
    else toast.exito('Restauración cancelada')
    setCancelando(false)
  }

  if (authLoading || !restauracion) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
      </div>
    )
  }

  const puedeCancelar = ESTADOS_CANCELABLES.includes(restauracion.estado)

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div>
        <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Shield className="h-5 w-5 text-blue-500" />
          Restauración en progreso
        </h1>
        <p className="text-xs text-slate-600 mt-0.5">
          {restauracion.mensaje_progreso || 'Iniciando...'}
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900">NO CIERRES ESTA PÁGINA</p>
            <p className="text-xs text-amber-800 mt-1">
              La restauración está en curso. Cerrar el navegador puede causar problemas. Esperá a que termine.
            </p>
            <p className="text-xs text-amber-800 mt-1">
              El CRM va a quedar temporalmente no disponible mientras se restaura la base de datos y el storage.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <StepperRestauracion
          estadoActual={restauracion.estado}
          porcentaje={restauracion.porcentaje}
          incluirPreBackup={restauracion.crear_pre_backup}
        />
      </div>

      {restauracion.metadata_backup && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-2xs text-slate-600 uppercase font-medium mb-1">Backup siendo restaurado</p>
          <p className="text-xs font-mono text-slate-800">{restauracion.metadata_backup.nombre || '-'}</p>
          <p className="text-2xs text-slate-600 mt-0.5">
            {restauracion.metadata_backup.fecha ? new Date(restauracion.metadata_backup.fecha).toLocaleString('es-AR') : ''}
          </p>
        </div>
      )}

      {puedeCancelar && (
        <div className="flex justify-end">
          <button
            onClick={cancelar}
            disabled={cancelando}
            className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50"
          >
            {cancelando ? 'Cancelando...' : 'Cancelar restauración'}
          </button>
        </div>
      )}
    </div>
  )
}
