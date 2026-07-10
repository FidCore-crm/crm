'use client'

/**
 * Modal de alta/edición de una mailing_campana.
 *
 * Campos:
 *   - Nombre + descripción (internos)
 *   - Audiencia (seleccionar de las guardadas)
 *   - Plantilla (seleccionar de las guardadas) o mensaje libre (asunto + cuerpo)
 *   - Asunto override (si se usa plantilla)
 *   - Schedule: "Sin schedule (queda BORRADOR para disparar manual)" o fecha+hora
 *
 * Validación:
 *   - Nombre obligatorio
 *   - Debe haber audiencia
 *   - Debe haber plantilla o (asunto_libre + cuerpo_libre)
 *   - Si schedule, debe ser >= ahora + 1 min
 */

import { useState, useEffect } from 'react'
import { X, Loader2, Save, Calendar, Megaphone } from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import type { MailingCampana } from './TabMailingCampanas'
import type { MailingAudiencia } from './TabMailingAudiencias'
import type { MailingPlantilla } from './TabMailingPlantillas'

interface Props {
  campana: MailingCampana | null
  onCerrar: () => void
  onGuardada: () => void
}

function aInputDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function ModalEditarCampana({ campana, onCerrar, onGuardada }: Props) {
  const esNueva = campana === null
  const [nombre, setNombre] = useState(campana?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(campana?.descripcion ?? '')
  const [audienciaId, setAudienciaId] = useState<string | null>(campana?.audiencia_id ?? null)
  const [modoMensaje, setModoMensaje] = useState<'plantilla' | 'libre'>(
    campana?.mailing_plantilla_id ? 'plantilla' : 'libre'
  )
  const [plantillaId, setPlantillaId] = useState<string | null>(campana?.mailing_plantilla_id ?? null)
  const [asuntoOverride, setAsuntoOverride] = useState(campana?.asunto_override ?? '')
  const [asuntoLibre, setAsuntoLibre] = useState(campana?.asunto_libre ?? '')
  const [cuerpoLibre, setCuerpoLibre] = useState(campana?.cuerpo_libre ?? '')

  const [conSchedule, setConSchedule] = useState(!!campana?.programada_para)
  const [fechaHora, setFechaHora] = useState(
    campana?.programada_para
      ? aInputDateTime(new Date(campana.programada_para))
      : aInputDateTime(new Date(Date.now() + 60 * 60_000)) // default: en 1h
  )

  const [audiencias, setAudiencias] = useState<MailingAudiencia[]>([])
  const [plantillas, setPlantillas] = useState<MailingPlantilla[]>([])
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    apiCall<{ audiencias: MailingAudiencia[] }>('/api/comunicaciones/audiencias', {}, { mostrar_toast_en_error: false })
      .then(r => { if (r.ok && r.data) setAudiencias(r.data.audiencias) })
    apiCall<{ plantillas: MailingPlantilla[] }>('/api/comunicaciones/mailing-plantillas', {}, { mostrar_toast_en_error: false })
      .then(r => { if (r.ok && r.data) setPlantillas(r.data.plantillas) })
  }, [])

  async function guardar() {
    if (!nombre.trim()) { toast.error('Falta el nombre'); return }
    if (!audienciaId) { toast.error('Elegí una audiencia'); return }
    if (modoMensaje === 'plantilla' && !plantillaId) { toast.error('Elegí una plantilla'); return }
    if (modoMensaje === 'libre' && (!asuntoLibre.trim() || !cuerpoLibre.trim())) {
      toast.error('Asunto y cuerpo son obligatorios en modo libre'); return
    }
    let programada_para: string | null = null
    if (conSchedule) {
      const fecha = new Date(fechaHora)
      if (isNaN(fecha.getTime())) { toast.error('Fecha inválida'); return }
      if (fecha.getTime() < Date.now() + 60_000) {
        toast.error('La fecha debe ser al menos 1 minuto en el futuro'); return
      }
      programada_para = fecha.toISOString()
    }

    setGuardando(true)
    const body: any = {
      nombre: nombre.trim(),
      descripcion: descripcion.trim() || null,
      audiencia_id: audienciaId,
      programada_para,
    }
    if (modoMensaje === 'plantilla') {
      body.mailing_plantilla_id = plantillaId
      body.asunto_override = asuntoOverride.trim() || null
      body.asunto_libre = null
      body.cuerpo_libre = null
    } else {
      body.mailing_plantilla_id = null
      body.asunto_libre = asuntoLibre.trim()
      body.cuerpo_libre = cuerpoLibre.trim()
      body.asunto_override = null
    }

    const r = esNueva
      ? await apiCall('/api/comunicaciones/campanas', { method: 'POST', body })
      : await apiCall(`/api/comunicaciones/campanas/${campana.id}`, { method: 'PATCH', body })
    setGuardando(false)
    if (r.ok) {
      toast.exito(esNueva ? 'Campaña creada' : 'Campaña actualizada')
      onGuardada()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-blue-600" />
            {esNueva ? 'Nueva campaña' : `Editar: ${campana.nombre}`}
          </h3>
          <button onClick={onCerrar} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex-1 space-y-4">
          {/* Nombre + descripción */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-2xs font-medium text-slate-600 mb-1">Nombre *</label>
              <input
                type="text" value={nombre} onChange={e => setNombre(e.target.value)}
                placeholder="Black Friday 2026"
                className="form-input w-full text-sm"
              />
            </div>
            <div>
              <label className="block text-2xs font-medium text-slate-600 mb-1">Descripción</label>
              <input
                type="text" value={descripcion} onChange={e => setDescripcion(e.target.value)}
                placeholder="Promoción de fin de año"
                className="form-input w-full text-sm"
              />
            </div>
          </div>

          {/* Audiencia */}
          <div>
            <label className="block text-2xs font-medium text-slate-600 mb-1">Audiencia *</label>
            {audiencias.length === 0 ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                No tenés audiencias guardadas. Andá al tab "Audiencias" para crear una.
              </p>
            ) : (
              <select
                value={audienciaId ?? ''}
                onChange={e => setAudienciaId(e.target.value || null)}
                className="form-input w-full text-sm"
              >
                <option value="">— Elegir —</option>
                {audiencias.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.nombre} {a.ultima_cantidad != null && `(${a.ultima_cantidad} personas)`}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Mensaje */}
          <div>
            <label className="block text-2xs font-medium text-slate-600 mb-1">Mensaje *</label>
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => setModoMensaje('plantilla')}
                className={`flex-1 px-3 py-2 rounded border text-xs ${
                  modoMensaje === 'plantilla' ? 'bg-blue-50 border-blue-300 text-blue-800 font-medium' : 'bg-white border-slate-200 text-slate-600'
                }`}
              >
                Plantilla guardada
              </button>
              <button
                type="button"
                onClick={() => setModoMensaje('libre')}
                className={`flex-1 px-3 py-2 rounded border text-xs ${
                  modoMensaje === 'libre' ? 'bg-blue-50 border-blue-300 text-blue-800 font-medium' : 'bg-white border-slate-200 text-slate-600'
                }`}
              >
                Mensaje libre
              </button>
            </div>

            {modoMensaje === 'plantilla' ? (
              <div className="space-y-2">
                {plantillas.length === 0 ? (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                    No tenés plantillas. Andá al tab "Plantillas" para crear una.
                  </p>
                ) : (
                  <>
                    <select
                      value={plantillaId ?? ''}
                      onChange={e => setPlantillaId(e.target.value || null)}
                      className="form-input w-full text-sm"
                    >
                      <option value="">— Elegir —</option>
                      {plantillas.map(p => (
                        <option key={p.id} value={p.id}>{p.nombre}</option>
                      ))}
                    </select>
                    <input
                      type="text" value={asuntoOverride} onChange={e => setAsuntoOverride(e.target.value)}
                      placeholder="(Opcional) Asunto distinto solo para esta campaña"
                      className="form-input w-full text-sm"
                    />
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  type="text" value={asuntoLibre} onChange={e => setAsuntoLibre(e.target.value)}
                  placeholder="Asunto del email"
                  className="form-input w-full text-sm"
                  maxLength={300}
                />
                <textarea
                  value={cuerpoLibre} onChange={e => setCuerpoLibre(e.target.value)}
                  placeholder="Cuerpo del mensaje (con {{variables}})"
                  className="form-input w-full text-sm font-mono"
                  rows={8}
                />
              </div>
            )}
          </div>

          {/* Schedule */}
          <div className="bg-slate-50 border border-slate-200 rounded p-3">
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={conSchedule}
                onChange={e => setConSchedule(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              <span className="text-xs font-medium text-slate-700 flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5 text-slate-500" />
                Programar envío para una fecha y hora específica
              </span>
            </label>
            {conSchedule ? (
              <input
                type="datetime-local"
                value={fechaHora}
                onChange={e => setFechaHora(e.target.value)}
                min={aInputDateTime(new Date(Date.now() + 60 * 60_000))}
                className="form-input w-full text-sm max-w-xs"
              />
            ) : (
              <p className="text-2xs text-slate-500">
                Sin schedule: la campaña queda en <strong>Borrador</strong>. Hay que dispararla manualmente
                con el botón <strong>Enviar ahora</strong>.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 px-5 py-3 flex items-center justify-end gap-2 shrink-0">
          <button onClick={onCerrar} disabled={guardando} className="btn-secondary">Cancelar</button>
          <button onClick={guardar} disabled={guardando} className="btn-primary flex items-center gap-1.5">
            {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {esNueva ? 'Crear campaña' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}
