'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  FileText, Ban, XCircle, Undo2, RefreshCw, Zap, Loader2, ChevronDown, ChevronUp, Pencil,
} from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { useRealtimeRefresh } from '@/lib/hooks/useRealtimeRefresh'

interface EventoBitacora {
  id: string
  tipo_evento: string
  estado_anterior: string | null
  estado_nuevo: string | null
  motivo: string | null
  observaciones: string | null
  created_at: string
  usuario: { id: string; nombre: string; apellido: string } | null
}

interface Props {
  polizaId: string
  refreshKey?: number
}

function iconoEvento(tipo: string) {
  switch (tipo) {
    case 'CREACION':
      return <FileText className="h-3.5 w-3.5 text-emerald-600" />
    case 'CANCELACION':
      return <XCircle className="h-3.5 w-3.5 text-red-600" />
    case 'ANULACION':
      return <Ban className="h-3.5 w-3.5 text-red-600" />
    case 'REHABILITACION':
      return <Undo2 className="h-3.5 w-3.5 text-blue-600" />
    case 'RENOVACION_CREADA':
      return <RefreshCw className="h-3.5 w-3.5 text-amber-600" />
    case 'RENOVACION_ACTIVADA':
      return <Zap className="h-3.5 w-3.5 text-emerald-600" />
    case 'EDICION':
      return <Pencil className="h-3.5 w-3.5 text-slate-600" />
    default:
      return <FileText className="h-3.5 w-3.5 text-slate-500" />
  }
}

function labelEvento(tipo: string): string {
  const map: Record<string, string> = {
    CREACION: 'Creación',
    CAMBIO_ESTADO: 'Cambio de estado',
    CANCELACION: 'Cancelación',
    ANULACION: 'Anulación',
    REHABILITACION: 'Rehabilitación',
    RENOVACION_CREADA: 'Renovación creada',
    RENOVACION_ACTIVADA: 'Renovación activada',
    EDICION: 'Edición',
  }
  return map[tipo] || tipo
}

function formatFechaHora(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function HistorialPoliza({ polizaId, refreshKey = 0 }: Props) {
  const [eventos, setEventos] = useState<EventoBitacora[]>([])
  const [cargando, setCargando] = useState(true)
  const [expandido, setExpandido] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await apiCall<{ eventos: EventoBitacora[] }>(
      `/api/polizas/${polizaId}/bitacora`,
      { cache: 'no-store' },
      { mostrar_toast_en_error: false },
    )
    if (r.ok && r.data) setEventos(r.data.eventos ?? [])
    setCargando(false)
  }, [polizaId])

  useEffect(() => { cargar() }, [cargar, refreshKey])

  // Realtime: solo escuchamos INSERTs en bitácora de esta póliza.
  // Se agrega un evento sin re-cargar toda la ficha padre (evita flash).
  useRealtimeRefresh({
    tablas: ['poliza_bitacora'],
    filter: `poliza_id=eq.${polizaId}`,
    onCambio: cargar,
  })

  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden">
      <button
        onClick={() => setExpandido(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <h3 className="text-2xs font-semibold text-slate-600 uppercase tracking-wide">
          Historial de la póliza ({eventos.length})
        </h3>
        {expandido ? <ChevronUp className="h-3.5 w-3.5 text-slate-500" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-500" />}
      </button>
      {expandido && (
        <div className="p-3">
          {cargando ? (
            <div className="text-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-slate-500 mx-auto" />
            </div>
          ) : eventos.length === 0 ? (
            <div className="text-center py-4 text-xs text-slate-500">
              Sin eventos registrados
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {eventos.map(e => (
                <div key={e.id} className="flex items-start gap-2 border-l-2 border-slate-200 pl-3 py-1">
                  <div className="shrink-0 -ml-[7px] bg-white p-0.5 rounded-full">
                    {iconoEvento(e.tipo_evento)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-slate-700">
                        {labelEvento(e.tipo_evento)}
                      </span>
                      <span className="text-2xs text-slate-500">{formatFechaHora(e.created_at)}</span>
                    </div>
                    {(e.estado_anterior || e.estado_nuevo) && (
                      <p className="text-2xs text-slate-600 mt-0.5">
                        {e.estado_anterior && <><span className="font-mono">{e.estado_anterior}</span> → </>}
                        {e.estado_nuevo && <span className="font-mono font-medium">{e.estado_nuevo}</span>}
                      </p>
                    )}
                    {e.motivo && (
                      <p className="text-2xs text-slate-600 mt-0.5">
                        <span className="text-slate-500">Motivo: </span>{e.motivo}
                      </p>
                    )}
                    {e.observaciones && (
                      <p className="text-2xs text-slate-600 italic mt-0.5">{e.observaciones}</p>
                    )}
                    {e.usuario && (
                      <p className="text-2xs text-slate-500 mt-0.5">
                        Por: {[e.usuario.apellido, e.usuario.nombre].filter(Boolean).join(', ') || e.usuario.id}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
