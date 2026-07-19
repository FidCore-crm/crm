'use client'

/**
 * Tab "Plantillas" del módulo Comunicaciones.
 *
 * CRUD de mailing_plantillas (plantillas propias del PAS para sus mailings,
 * separadas de las 5 automáticas del sistema). Cada plantilla tiene:
 *   - nombre, descripción
 *   - asunto, saludo, cuerpo, cierre (mismos campos que las automáticas)
 *   - CTA opcional (texto + URL)
 *   - variables disponibles
 *
 * Acciones por fila: editar / desactivar.
 */

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Plus, FileText, Edit2, Trash2 } from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import ModalEditarMailingPlantilla from './ModalEditarMailingPlantilla'

export interface MailingPlantilla {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  asunto: string
  saludo: string
  cuerpo: string
  cierre: string
  cta_texto: string | null
  cta_url: string | null
  variables_disponibles: string[]
  activa: boolean
  created_at: string
  updated_at: string
}

export default function TabMailingPlantillas() {
  const [plantillas, setPlantillas] = useState<MailingPlantilla[]>([])
  const [cargando, setCargando] = useState(true)
  const [editar, setEditar] = useState<MailingPlantilla | 'nueva' | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await apiCall<{ plantillas: MailingPlantilla[] }>(
      '/api/comunicaciones/mailing-plantillas',
      {}, { mostrar_toast_en_error: false },
    )
    if (r.ok && r.data) setPlantillas(r.data.plantillas)
    setCargando(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function eliminar(p: MailingPlantilla) {
    if (!confirm(`¿Desactivar la plantilla "${p.nombre}"?\n\nNo se borra del historial — se oculta del listado y deja de estar disponible para nuevos envíos.`)) {
      return
    }
    const r = await apiCall(`/api/comunicaciones/mailing-plantillas/${p.id}`, { method: 'DELETE' })
    if (r.ok) {
      toast.exito('Plantilla desactivada')
      cargar()
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-600">
          Plantillas reutilizables para tus mailings (promociones, avisos, felicitaciones, etc.).
        </p>
        <button
          onClick={() => setEditar('nueva')}
          className="btn-secondary flex items-center gap-1.5 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          Nueva plantilla
        </button>
      </div>

      {cargando ? (
        <div className="py-10 text-center text-slate-500 text-sm flex items-center justify-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando plantillas...
        </div>
      ) : plantillas.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded p-10 text-center">
          <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-700">Sin plantillas todavía</h3>
          <p className="text-xs text-slate-600 mt-1 max-w-md mx-auto leading-relaxed">
            Creá una plantilla reutilizable para no tener que escribir el mismo email cada vez que
            mandes un mailing. Podés usar variables como <code className="text-2xs bg-white px-1 rounded">{`{{nombre}}`}</code> que se reemplazan por los datos del destinatario.
          </p>
          <button
            onClick={() => setEditar('nueva')}
            className="btn-primary mt-4 flex items-center gap-1.5 mx-auto"
          >
            <Plus className="h-3.5 w-3.5" />
            Crear primera plantilla
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded overflow-hidden">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Asunto</th>
                <th>Actualizada</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {plantillas.map(p => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td>
                    <div className="text-sm text-slate-800 font-medium">{p.nombre}</div>
                    {p.descripcion && (
                      <div className="text-2xs text-slate-600 mt-0.5 truncate max-w-md">{p.descripcion}</div>
                    )}
                  </td>
                  <td className="text-xs text-slate-600 max-w-xs truncate" title={p.asunto}>
                    {p.asunto}
                  </td>
                  <td className="text-xs text-slate-600">
                    {new Date(p.updated_at).toLocaleDateString('es-AR', { dateStyle: 'short' })}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditar(p)}
                        className="btn-tabla-accion"
                        title="Editar"
                      >
                        <Edit2 />
                      </button>
                      <button
                        onClick={() => eliminar(p)}
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
        <ModalEditarMailingPlantilla
          plantilla={editar === 'nueva' ? null : editar}
          onCerrar={() => setEditar(null)}
          onGuardada={() => { setEditar(null); cargar() }}
        />
      )}
    </div>
  )
}
