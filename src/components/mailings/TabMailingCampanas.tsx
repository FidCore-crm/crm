'use client'

/**
 * Tab "Campañas" del módulo Comunicaciones.
 *
 * Lista de mailing_campanas con acciones:
 *   - BORRADOR → Editar / Enviar ahora / Cancelar / Eliminar
 *   - PROGRAMADA → Editar / Enviar ahora / Cancelar / Eliminar
 *   - EJECUTANDO → Ver detalle (auto-refresh) / Pausar
 *   - PAUSADA → Reanudar / Cancelar / Eliminar
 *   - COMPLETADA → Ver métricas
 *   - CANCELADA → Eliminar / Ver detalle
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Loader2, Plus, Megaphone, Edit2, Trash2, Eye, Send, Pause, Play,
  Ban, CheckCircle2, Calendar,
} from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import ModalEditarCampana from './ModalEditarCampana'
import ModalDetalleCampana from './ModalDetalleCampana'

export interface MailingCampana {
  id: string
  nombre: string
  descripcion: string | null
  estado: 'BORRADOR' | 'PROGRAMADA' | 'EJECUTANDO' | 'COMPLETADA' | 'PAUSADA' | 'CANCELADA'
  programada_para: string | null
  audiencia_id: string | null
  personas_ids?: string[]
  mailing_plantilla_id: string | null
  asunto_libre: string | null
  cuerpo_libre: string | null
  asunto_override: string | null
  total_destinatarios: number
  enviados: number
  fallidos: number
  excluidos: number
  fecha_inicio_ejecucion: string | null
  fecha_fin_ejecucion: string | null
  ultimo_error: string | null
  created_at: string
  updated_at: string
}

const ESTADO_META: Record<MailingCampana['estado'], { label: string; color: string; icon: any }> = {
  BORRADOR:   { label: 'Borrador',     color: 'bg-slate-100 text-slate-700 border-slate-200',     icon: Edit2 },
  PROGRAMADA: { label: 'Programada',   color: 'bg-amber-50 text-amber-800 border-amber-200',      icon: Calendar },
  EJECUTANDO: { label: 'Ejecutando',   color: 'bg-blue-50 text-blue-700 border-blue-200',         icon: Loader2 },
  COMPLETADA: { label: 'Completada',   color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  PAUSADA:    { label: 'Pausada',      color: 'bg-violet-50 text-violet-700 border-violet-200',    icon: Pause },
  CANCELADA:  { label: 'Cancelada',    color: 'bg-slate-100 text-slate-600 border-slate-200',     icon: Ban },
}

export default function TabMailingCampanas() {
  const [campanas, setCampanas] = useState<MailingCampana[]>([])
  const [cargando, setCargando] = useState(true)
  const [editar, setEditar] = useState<MailingCampana | 'nueva' | null>(null)
  const [detalle, setDetalle] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await apiCall<{ campanas: MailingCampana[] }>(
      '/api/comunicaciones/campanas?tamanio=50',
      {}, { mostrar_toast_en_error: false },
    )
    if (r.ok && r.data) setCampanas(r.data.campanas)
    setCargando(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // Auto-refresh cada 8s mientras haya campañas EJECUTANDO. Usamos un ref
  // para evitar reentrancia del effect cada vez que `campanas` cambia (lo
  // cual recreaba el interval en cada tick y podía dejar varios en simultáneo
  // bajo flapping).
  const hayEjecutandoRef = useRef(false)
  hayEjecutandoRef.current = campanas.some(c => c.estado === 'EJECUTANDO')
  useEffect(() => {
    const t = setInterval(() => {
      if (hayEjecutandoRef.current) cargar()
    }, 8000)
    return () => clearInterval(t)
  }, [cargar])

  async function enviarAhora(c: MailingCampana) {
    const msg = c.estado === 'PROGRAMADA'
      ? `¿Disparar "${c.nombre}" ahora? La programación se ignora y se ejecuta inmediatamente.`
      : c.estado === 'PAUSADA'
      ? `¿Reanudar "${c.nombre}"? Continúa desde donde se pausó.`
      : `¿Enviar "${c.nombre}" ahora? Se va a procesar inmediatamente.`
    if (!confirm(msg)) return
    const r = await apiCall(`/api/comunicaciones/campanas/${c.id}/enviar`, { method: 'POST' })
    if (r.ok) {
      toast.exito('Campaña iniciada')
      cargar()
    }
  }

  async function pausar(c: MailingCampana) {
    if (!confirm(`¿Pausar "${c.nombre}"? Se va a detener en el próximo envío y guardar el progreso.`)) return
    const r = await apiCall(`/api/comunicaciones/campanas/${c.id}/pausar`, { method: 'POST' })
    if (r.ok) {
      toast.exito('Campaña pausada (puede tardar unos segundos en detenerse)')
      cargar()
    }
  }

  async function cancelar(c: MailingCampana) {
    if (!confirm(`¿Cancelar "${c.nombre}" definitivamente?`)) return
    const r = await apiCall(`/api/comunicaciones/campanas/${c.id}/cancelar`, { method: 'POST' })
    if (r.ok) {
      toast.exito('Campaña cancelada')
      cargar()
    }
  }

  async function eliminar(c: MailingCampana) {
    if (!confirm(`¿Eliminar definitivamente "${c.nombre}"?`)) return
    const r = await apiCall(`/api/comunicaciones/campanas/${c.id}`, { method: 'DELETE' })
    if (r.ok) {
      toast.exito('Campaña eliminada')
      cargar()
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-600">
          Campañas guardadas: audiencia + plantilla + schedule + métricas. Permiten reutilizar
          y trackear envíos a lo largo del tiempo.
        </p>
        <button
          onClick={() => setEditar('nueva')}
          className="btn-secondary flex items-center gap-1.5 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          Nueva campaña
        </button>
      </div>

      {cargando ? (
        <div className="py-10 text-center text-slate-500 text-sm flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando campañas...
        </div>
      ) : campanas.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded p-10 text-center">
          <Megaphone className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-700">Sin campañas todavía</h3>
          <p className="text-xs text-slate-600 mt-1 max-w-md mx-auto leading-relaxed">
            Una campaña combina una audiencia + una plantilla + un schedule.
            Útil para enviar promociones, avisos masivos o seguir métricas de un mailing puntual.
          </p>
          <button
            onClick={() => setEditar('nueva')}
            className="btn-primary mt-4 flex items-center gap-1.5 mx-auto"
          >
            <Plus className="h-3.5 w-3.5" />
            Crear primera campaña
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Estado</th>
                <th>Programada</th>
                <th>Destinatarios</th>
                <th>Métricas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {campanas.map(c => {
                const meta = ESTADO_META[c.estado]
                const Icon = meta.icon
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td>
                      <div className="text-sm text-slate-800 font-medium">{c.nombre}</div>
                      {c.descripcion && (
                        <div className="text-2xs text-slate-600 mt-0.5 truncate max-w-xs">{c.descripcion}</div>
                      )}
                    </td>
                    <td>
                      <span className={`inline-flex items-center gap-1 text-2xs font-semibold px-1.5 py-0.5 rounded border ${meta.color}`}>
                        <Icon className={`h-3 w-3 ${c.estado === 'EJECUTANDO' ? 'animate-spin' : ''}`} />
                        {meta.label}
                      </span>
                      {c.ultimo_error && (
                        <div className="text-2xs text-red-600 mt-0.5 max-w-xs truncate" title={c.ultimo_error}>
                          ⚠ {c.ultimo_error}
                        </div>
                      )}
                    </td>
                    <td className="text-2xs text-slate-600">
                      {c.programada_para
                        ? new Date(c.programada_para).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
                        : <span className="text-slate-500 italic">—</span>}
                    </td>
                    <td className="text-2xs text-slate-700 font-mono">
                      {c.total_destinatarios > 0 ? c.total_destinatarios : <span className="text-slate-500 italic">por calcular</span>}
                    </td>
                    <td className="text-2xs">
                      {c.estado === 'COMPLETADA' || c.estado === 'EJECUTANDO' || c.estado === 'PAUSADA' ? (
                        <div className="flex items-center gap-1.5 font-mono">
                          <span className="text-emerald-700" title="Enviados">✓ {c.enviados}</span>
                          {c.excluidos > 0 && <span className="text-amber-700" title="Excluidos">⊘ {c.excluidos}</span>}
                          {c.fallidos > 0 && <span className="text-red-700" title="Fallidos">✗ {c.fallidos}</span>}
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">—</span>
                      )}
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setDetalle(c.id)} className="btn-tabla-accion" title="Ver detalle">
                          <Eye />
                        </button>

                        {(c.estado === 'BORRADOR' || c.estado === 'PROGRAMADA') && (
                          <>
                            <button onClick={() => setEditar(c)} className="btn-tabla-accion" title="Editar">
                              <Edit2 />
                            </button>
                            <button onClick={() => enviarAhora(c)} className="btn-tabla-accion-success" title="Enviar ahora">
                              <Send />
                            </button>
                            <button onClick={() => cancelar(c)} className="btn-tabla-accion-warn" title="Cancelar">
                              <Ban />
                            </button>
                          </>
                        )}

                        {c.estado === 'EJECUTANDO' && (
                          <button onClick={() => pausar(c)} className="btn-tabla-accion-warn" title="Pausar">
                            <Pause />
                          </button>
                        )}

                        {c.estado === 'PAUSADA' && (
                          <>
                            <button onClick={() => enviarAhora(c)} className="btn-tabla-accion-success" title="Reanudar">
                              <Play />
                            </button>
                            <button onClick={() => cancelar(c)} className="btn-tabla-accion-warn" title="Cancelar">
                              <Ban />
                            </button>
                          </>
                        )}

                        {(c.estado === 'BORRADOR' || c.estado === 'CANCELADA' || c.estado === 'PAUSADA') && (
                          <button onClick={() => eliminar(c)} className="btn-tabla-accion-danger" title="Eliminar">
                            <Trash2 />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editar && (
        <ModalEditarCampana
          campana={editar === 'nueva' ? null : editar}
          onCerrar={() => setEditar(null)}
          onGuardada={() => { setEditar(null); cargar() }}
        />
      )}

      {detalle && (
        <ModalDetalleCampana
          campanaId={detalle}
          onCerrar={() => { setDetalle(null); cargar() }}
        />
      )}
    </div>
  )
}
