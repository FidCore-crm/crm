'use client'

/**
 * Sección de plantillas WhatsApp en /crm/configuracion/comunicaciones.
 * Listado de plantillas + modal de edición con preview en vivo.
 */

import { useEffect, useState } from 'react'
import { MessageCircle, Loader2, Eye, X, RotateCcw, Save } from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { renderizarPlantillaWhatsapp, resetCachePlantillasWhatsapp } from '@/lib/whatsapp-templates'

interface PlantillaWA {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  contexto: string
  variables_disponibles: string[] | null
  mensaje: string
  mensaje_default: string
}

const CONTEXTO_LABEL: Record<string, string> = {
  PERSONA:    'Cliente / Persona',
  POLIZA:     'Pólizas',
  SINIESTRO:  'Siniestros',
  TAREA:      'Tareas',
  RENOVACION: 'Renovaciones',
  COTIZACION: 'Cotizaciones',
  PORTAL:     'Portal del Asegurado',
  GENERAL:    'Uso general',
}

const CONTEXTO_COLOR: Record<string, string> = {
  PERSONA:    'bg-blue-50 text-blue-700 border-blue-200',
  POLIZA:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  SINIESTRO:  'bg-amber-50 text-amber-700 border-amber-200',
  TAREA:      'bg-violet-50 text-violet-700 border-violet-200',
  RENOVACION: 'bg-orange-50 text-orange-700 border-orange-200',
  COTIZACION: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  PORTAL:     'bg-indigo-50 text-indigo-700 border-indigo-200',
  GENERAL:    'bg-slate-100 text-slate-600 border-slate-200',
}

/** Valores de ejemplo para el preview en vivo del editor. */
const VALORES_EJEMPLO: Record<string, string> = {
  nombre:            'Juan',
  apellido:          'Pérez',
  url_portal:           'https://clientes.tu-organizacion.com.ar/c/abc123',
  organizacion_nombre:  'Productor de Seguros',
  numero_poliza:     'AP-2026-001234',
  numero_caso:       'CASO-2026-0001',
  numero_cotizacion: 'COT-2026-0042',
  compania:          'La Segunda',
  ramo:              'Automotor',
  fecha_fin:         '15/06/2026',
  titulo_tarea:      'Llamar para gestionar renovación',
}

export default function WhatsappPlantillasSection() {
  const [cargando, setCargando]   = useState(true)
  const [plantillas, setPlantillas] = useState<PlantillaWA[]>([])
  const [editando, setEditando]   = useState<PlantillaWA | null>(null)

  async function cargar() {
    setCargando(true)
    const res = await apiCall<{ plantillas: PlantillaWA[] }>(
      '/api/configuracion/comunicaciones/whatsapp',
      undefined,
      { mostrar_toast_en_error: false },
    )
    if (res.ok && res.data) setPlantillas(res.data.plantillas)
    setCargando(false)
  }

  useEffect(() => { cargar() }, [])

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-500 text-xs gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando plantillas WhatsApp...
      </div>
    )
  }

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-1">
          <MessageCircle className="h-4 w-4 text-green-600" />
          <h2 className="text-sm font-semibold text-slate-800">Plantillas de WhatsApp</h2>
        </div>
        <p className="text-2xs text-slate-600 mb-4">
          Mensajes pre-armados que se cargan al abrir WhatsApp desde el CRM. Las variables
          (<span className="font-mono">{'{{nombre}}'}</span>, <span className="font-mono">{'{{numero_poliza}}'}</span>, etc.)
          se reemplazan con datos reales antes de abrir wa.me.
          <br />
          <span className="font-mono">{'{{nombre}}'}</span> es solo el primer nombre del asegurado (ej: "Juan"). Si necesitás el nombre completo, usá <span className="font-mono">{'{{nombre_completo}}'}</span>.
        </p>

        <div className="flex flex-col gap-2">
          {plantillas.map(p => (
            <div key={p.id} className="border border-slate-200 rounded p-3 hover:border-slate-300 transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-xs font-medium text-slate-800">{p.nombre}</p>
                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${CONTEXTO_COLOR[p.contexto] ?? CONTEXTO_COLOR.GENERAL}`}>
                      {CONTEXTO_LABEL[p.contexto] ?? p.contexto}
                    </span>
                  </div>
                  {p.descripcion && (
                    <p className="text-2xs text-slate-600 mt-0.5">{p.descripcion}</p>
                  )}
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(p.variables_disponibles ?? []).map(v => (
                      <span key={v} className="text-2xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                        {`{{${v}}}`}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => setEditando(p)}
                  className="btn-primary text-2xs px-2 py-1 flex items-center gap-1 shrink-0"
                >
                  ✏️ Editar
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {editando && (
        <EditorWhatsappModal
          plantilla={editando}
          onClose={() => setEditando(null)}
          onSaved={(updated) => {
            setPlantillas(prev => prev.map(p => p.codigo === updated.codigo ? updated : p))
            resetCachePlantillasWhatsapp()
            setEditando(null)
          }}
        />
      )}
    </>
  )
}

/* ────────────── Modal de edición ────────────── */

function EditorWhatsappModal({
  plantilla,
  onClose,
  onSaved,
}: {
  plantilla: PlantillaWA
  onClose: () => void
  onSaved: (p: PlantillaWA) => void
}) {
  const [mensaje, setMensaje] = useState(plantilla.mensaje)
  const [guardando, setGuardando] = useState(false)
  const [restaurando, setRestaurando] = useState(false)

  const variables = plantilla.variables_disponibles ?? []
  const vars = Object.fromEntries(variables.map(v => [v, VALORES_EJEMPLO[v] ?? `{{${v}}}`]))
  const preview = renderizarPlantillaWhatsapp(mensaje, vars)
  const cambio = mensaje !== plantilla.mensaje
  const charsRestantes = 3000 - mensaje.length

  async function guardar() {
    if (!mensaje.trim()) {
      toast.error('El mensaje no puede estar vacío')
      return
    }
    setGuardando(true)
    const res = await apiCall<{ plantilla: PlantillaWA }>(
      `/api/configuracion/comunicaciones/whatsapp/${plantilla.codigo}`,
      { method: 'PATCH', body: { mensaje } },
      { mostrar_toast_en_error: true },
    )
    setGuardando(false)
    if (res.ok && res.data) {
      toast.exito('Plantilla guardada')
      onSaved(res.data.plantilla)
    }
  }

  async function restaurar() {
    if (!confirm('¿Restaurar al mensaje predeterminado? Vas a perder los cambios.')) return
    setRestaurando(true)
    const res = await apiCall<{ plantilla: PlantillaWA }>(
      `/api/configuracion/comunicaciones/whatsapp/${plantilla.codigo}/restaurar`,
      { method: 'POST' },
      { mostrar_toast_en_error: true },
    )
    setRestaurando(false)
    if (res.ok && res.data) {
      setMensaje(res.data.plantilla.mensaje)
      toast.exito('Plantilla restaurada al texto original')
    }
  }

  /** Insertar variable en la posición del cursor (mejor UX). */
  function insertarVar(v: string) {
    const tag = `{{${v}}}`
    const ta = document.getElementById('wa-mensaje-textarea') as HTMLTextAreaElement | null
    if (!ta) {
      setMensaje(m => m + tag)
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const next = mensaje.slice(0, start) + tag + mensaje.slice(end)
    setMensaje(next)
    // restablecer cursor después del tag insertado
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(start + tag.length, start + tag.length)
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-green-600" />
            <h3 className="text-sm font-semibold text-slate-800">{plantilla.nombre}</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {plantilla.descripcion && (
            <p className="text-xs text-slate-600">{plantilla.descripcion}</p>
          )}

          {/* Variables disponibles */}
          {variables.length > 0 && (
            <div>
              <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
                Variables disponibles (click para insertar)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {variables.map(v => (
                  <button
                    key={v}
                    onClick={() => insertarVar(v)}
                    className="text-2xs bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-2 py-1 rounded font-mono"
                  >
                    {`{{${v}}}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Editor */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-600">
                Mensaje
              </label>
              <span className={`text-2xs ${charsRestantes < 100 ? 'text-orange-600 font-medium' : 'text-slate-500'}`}>
                {mensaje.length} / 3000
              </span>
            </div>
            <textarea
              id="wa-mensaje-textarea"
              value={mensaje}
              onChange={e => setMensaje(e.target.value)}
              rows={8}
              maxLength={3000}
              className="form-input w-full resize-y text-xs font-mono"
              placeholder="Escribí el mensaje aquí..."
            />
          </div>

          {/* Preview */}
          <div>
            <label className="block text-2xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5 flex items-center gap-1.5">
              <Eye className="h-3 w-3" /> Vista previa (con datos de ejemplo)
            </label>
            <div className="bg-green-50 border border-green-200 rounded p-3 text-xs text-slate-800 whitespace-pre-wrap font-mono">
              {preview}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50">
          <button
            onClick={restaurar}
            disabled={restaurando || guardando}
            className="btn-secondary text-2xs flex items-center gap-1"
          >
            {restaurando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            Restaurar default
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="btn-secondary">Cancelar</button>
            <button
              onClick={guardar}
              disabled={guardando || restaurando || !cambio}
              className="btn-primary flex items-center gap-1.5"
            >
              {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              {guardando ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
