'use client'

/**
 * Tab "Audiencias" del módulo Comunicaciones.
 *
 * CRUD de mailing_audiencias. Cada audiencia es un segmento de cartera
 * reutilizable, de 2 tipos:
 *   - FILTRO: criterios JSON que se aplican al momento de uso (lista dinámica)
 *   - MANUAL: lista fija de personas seleccionadas por el admin
 *
 * Acciones: editar / ver personas (preview) / desactivar.
 */

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Plus, Users, Edit2, Trash2, Eye, Filter } from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import ModalEditarAudiencia from './ModalEditarAudiencia'

export interface MailingAudiencia {
  id: string
  nombre: string
  descripcion: string | null
  tipo: 'FILTRO' | 'MANUAL'
  filtro_jsonb: any
  ids_personas: string[]
  ultima_cantidad: number | null
  ultimo_preview_en: string | null
  activa: boolean
  created_at: string
  updated_at: string
}

export default function TabMailingAudiencias() {
  const [audiencias, setAudiencias] = useState<MailingAudiencia[]>([])
  const [cargando, setCargando] = useState(true)
  const [editar, setEditar] = useState<MailingAudiencia | 'nueva' | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await apiCall<{ audiencias: MailingAudiencia[] }>(
      '/api/comunicaciones/audiencias',
      {}, { mostrar_toast_en_error: false },
    )
    if (r.ok && r.data) setAudiencias(r.data.audiencias)
    setCargando(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function eliminar(a: MailingAudiencia) {
    if (!confirm(`¿Desactivar la audiencia "${a.nombre}"?\n\nSe oculta del listado pero el historial de envíos queda intacto.`)) {
      return
    }
    const r = await apiCall(`/api/comunicaciones/audiencias/${a.id}`, { method: 'DELETE' })
    if (r.ok) {
      toast.exito('Audiencia desactivada')
      cargar()
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Segmentos de tu cartera guardados (clientes por compañía, vencimiento, etc.) para reutilizar en envíos.
        </p>
        <button
          onClick={() => setEditar('nueva')}
          className="btn-secondary flex items-center gap-1.5 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          Nueva audiencia
        </button>
      </div>

      {cargando ? (
        <div className="py-10 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando audiencias...
        </div>
      ) : audiencias.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded p-10 text-center">
          <Users className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-700">Sin audiencias todavía</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
            Una audiencia es un grupo de clientes para enviar campañas (ej: "Clientes de La Caja con vencimiento
            en 30 días", "Clientes nuevos del último mes"). Las definís una vez y las reutilizás.
          </p>
          <button
            onClick={() => setEditar('nueva')}
            className="btn-primary mt-4 flex items-center gap-1.5 mx-auto"
          >
            <Plus className="h-3.5 w-3.5" />
            Crear primera audiencia
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Personas</th>
                <th>Actualizada</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {audiencias.map(a => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td>
                    <div className="text-sm text-slate-800 font-medium">{a.nombre}</div>
                    {a.descripcion && (
                      <div className="text-2xs text-slate-500 mt-0.5 truncate max-w-md">{a.descripcion}</div>
                    )}
                  </td>
                  <td>
                    <span className={`inline-flex items-center gap-1 text-2xs font-semibold px-1.5 py-0.5 rounded border ${
                      a.tipo === 'FILTRO'
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-violet-50 text-violet-700 border-violet-200'
                    }`}>
                      {a.tipo === 'FILTRO' ? <><Filter className="h-3 w-3" />Filtro</> : <><Users className="h-3 w-3" />Manual</>}
                    </span>
                  </td>
                  <td className="text-xs text-slate-700">
                    {a.ultima_cantidad != null ? (
                      <>
                        <strong className="font-mono">{a.ultima_cantidad}</strong>
                        {a.ultimo_preview_en && (
                          <span className="text-2xs text-slate-400 ml-1" title={`Última verificación: ${new Date(a.ultimo_preview_en).toLocaleString('es-AR')}`}>
                            (cacheado)
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-slate-400 italic">—</span>
                    )}
                  </td>
                  <td className="text-xs text-slate-500">
                    {new Date(a.updated_at).toLocaleDateString('es-AR', { dateStyle: 'short' })}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditar(a)}
                        className="btn-tabla-accion"
                        title="Editar"
                      >
                        <Edit2 />
                      </button>
                      <button
                        onClick={() => eliminar(a)}
                        className="btn-tabla-accion-danger"
                        title="Desactivar"
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editar && (
        <ModalEditarAudiencia
          audiencia={editar === 'nueva' ? null : editar}
          onCerrar={() => setEditar(null)}
          onGuardada={() => { setEditar(null); cargar() }}
        />
      )}
    </div>
  )
}
