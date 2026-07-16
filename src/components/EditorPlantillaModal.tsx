'use client'

/**
 * Modal de edición de una plantilla de email. Edita los 4 campos (asunto,
 * saludo, cuerpo, cierre) con preview en vivo debounced contra el endpoint
 * /preview-draft. Botón "Restaurar default" para volver al seed del sistema.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Save, RotateCcw, Loader2, Eye, AlertTriangle, CheckCircle, Image as ImageIcon } from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import SelectorImagenBiblioteca, { type ArchivoBiblioteca } from './biblioteca/SelectorImagenBiblioteca'

interface PlantillaData {
  codigo: string
  nombre: string
  descripcion: string | null
  contexto: string
  asunto: string
  saludo: string
  cuerpo: string
  cierre: string
  asunto_default: string | null
  saludo_default: string | null
  cuerpo_default: string | null
  cierre_default: string | null
  variables_disponibles: string[]
  editable: boolean
}

interface Props {
  codigo: string
  onClose: () => void
  onSaved?: () => void
}

export default function EditorPlantillaModal({ codigo, onClose, onSaved }: Props) {
  const [cargando, setCargando] = useState(true)
  const [plantilla, setPlantilla] = useState<PlantillaData | null>(null)
  const [asunto, setAsunto] = useState('')
  const [saludo, setSaludo] = useState('')
  const [cuerpo, setCuerpo] = useState('')
  const [cierre, setCierre] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [guardadoOk, setGuardadoOk] = useState(false)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewAbierto, setPreviewAbierto] = useState(false)
  const [previewCargando, setPreviewCargando] = useState(false)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const cuerpoRef = useRef<HTMLTextAreaElement | null>(null)
  const [selectorImagenAbierto, setSelectorImagenAbierto] = useState(false)

  // Cargar plantilla
  useEffect(() => {
    async function cargar() {
      setCargando(true)
      setError('')
      const r = await apiCall<{ plantilla: PlantillaData }>(`/api/configuracion/comunicaciones/plantillas/${codigo}`, {}, { mostrar_toast_en_error: false })
      if (r.ok && r.data?.plantilla) {
        const p = r.data.plantilla
        setPlantilla(p)
        setAsunto(p.asunto)
        setSaludo(p.saludo)
        setCuerpo(p.cuerpo)
        setCierre(p.cierre)
      } else {
        setError(r.error?.mensaje || 'Error cargando plantilla')
      }
      setCargando(false)
    }
    cargar()
  }, [codigo])

  // Preview debounced
  const actualizarPreview = useCallback(async () => {
    if (!plantilla) return
    setPreviewCargando(true)
    const r = await apiCall<{ html: string }>(`/api/configuracion/comunicaciones/plantillas/${codigo}/preview-draft`, {
      method: 'POST',
      body: { asunto, saludo, cuerpo, cierre },
    }, { mostrar_toast_en_error: false })
    if (r.ok && r.data) setPreviewHtml(r.data.html)
    else setPreviewHtml(`<p style="color:red">Error: ${r.error?.mensaje ?? 'Error de red'}</p>`)
    setPreviewCargando(false)
  }, [codigo, plantilla, asunto, saludo, cuerpo, cierre])

  useEffect(() => {
    if (!plantilla || !previewAbierto) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => actualizarPreview(), 500)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [asunto, saludo, cuerpo, cierre, plantilla, previewAbierto, actualizarPreview])

  async function guardar() {
    setGuardando(true)
    setError('')
    setGuardadoOk(false)
    const r = await apiCall(`/api/configuracion/comunicaciones/plantillas/${codigo}`, {
      method: 'PATCH',
      body: { asunto, saludo, cuerpo, cierre },
    }, { mostrar_toast_en_error: false })
    if (r.ok) {
      setGuardadoOk(true)
      if (onSaved) onSaved()
      setTimeout(() => setGuardadoOk(false), 2000)
    } else {
      setError(r.error?.mensaje || 'Error guardando')
    }
    setGuardando(false)
  }

  function insertarImagen(archivo: ArchivoBiblioteca) {
    const marcador = `[[IMG:${archivo.id}]]`
    const textarea = cuerpoRef.current
    if (!textarea) {
      setCuerpo(cuerpo + '\n' + marcador)
      setSelectorImagenAbierto(false)
      return
    }
    const inicio = textarea.selectionStart ?? cuerpo.length
    const fin = textarea.selectionEnd ?? cuerpo.length
    const nuevo = cuerpo.substring(0, inicio) + marcador + cuerpo.substring(fin)
    setCuerpo(nuevo)
    setSelectorImagenAbierto(false)
    // Reposicionar cursor después del marcador
    setTimeout(() => {
      textarea.focus()
      const pos = inicio + marcador.length
      textarea.setSelectionRange(pos, pos)
    }, 0)
  }

  async function restaurarDefault() {
    if (!confirm('¿Restaurar la plantilla a sus valores por defecto? Se van a perder los cambios actuales.')) return
    setGuardando(true)
    setError('')
    const r = await apiCall<{ plantilla: PlantillaData }>(`/api/configuracion/comunicaciones/plantillas/${codigo}/restaurar`, {
      method: 'POST',
    }, { mostrar_toast_en_error: false })
    if (r.ok && r.data?.plantilla) {
      const p = r.data.plantilla
      setAsunto(p.asunto)
      setSaludo(p.saludo)
      setCuerpo(p.cuerpo)
      setCierre(p.cierre)
      setGuardadoOk(true)
      if (onSaved) onSaved()
      setTimeout(() => setGuardadoOk(false), 2000)
    } else {
      setError(r.error?.mensaje || 'Error restaurando')
    }
    setGuardando(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 sticky top-0 bg-white z-10">
          <h2 className="text-sm font-semibold text-slate-800">
            Editar plantilla{plantilla ? `: ${plantilla.nombre}` : ''}
          </h2>
          <div className="flex items-center gap-2">
            {guardadoOk && (
              <span className="text-2xs text-green-600 flex items-center gap-1">
                <CheckCircle className="h-3 w-3" /> Guardado
              </span>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {cargando ? (
          <div className="py-16 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400 mx-auto" />
          </div>
        ) : !plantilla ? (
          <div className="px-5 py-8 text-center text-xs text-red-600">
            {error || 'Plantilla no encontrada'}
          </div>
        ) : (
          <div className="px-5 py-4 flex flex-col gap-4">
            {error && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-xs text-red-700 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            {/* Info de la plantilla */}
            <div className="bg-slate-50 border border-slate-200 rounded p-3">
              <p className="text-2xs text-slate-500 uppercase font-medium">Código</p>
              <p className="text-xs font-mono text-slate-800">{plantilla.codigo}</p>
              <p className="text-2xs text-slate-500 uppercase font-medium mt-2">Variables disponibles</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {plantilla.variables_disponibles.map((v) => (
                  <span key={v} className="text-2xs bg-white border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
            </div>

            {/* Campos editables */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Asunto</label>
              <input
                type="text"
                value={asunto}
                onChange={(e) => setAsunto(e.target.value)}
                className="form-input w-full text-xs"
                disabled={!plantilla.editable}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Saludo (inicio del email)</label>
              <textarea
                value={saludo}
                onChange={(e) => setSaludo(e.target.value)}
                rows={2}
                className="form-input w-full text-xs font-mono"
                disabled={!plantilla.editable}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-700">Cuerpo (contenido principal)</label>
                {plantilla.editable && (
                  <button
                    type="button"
                    onClick={() => setSelectorImagenAbierto(true)}
                    className="text-xs px-3 py-1.5 border border-blue-200 bg-blue-50 rounded hover:bg-blue-100 hover:border-blue-300 flex items-center gap-1.5 text-blue-700 font-medium transition-colors"
                  >
                    <ImageIcon className="h-3.5 w-3.5" /> Insertar imagen
                  </button>
                )}
              </div>
              <textarea
                ref={cuerpoRef}
                value={cuerpo}
                onChange={(e) => setCuerpo(e.target.value)}
                rows={10}
                className="form-input w-full text-xs font-mono"
                disabled={!plantilla.editable}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Cierre (despedida)</label>
              <textarea
                value={cierre}
                onChange={(e) => setCierre(e.target.value)}
                rows={4}
                className="form-input w-full text-xs font-mono"
                disabled={!plantilla.editable}
              />
            </div>

            {/* Preview toggle */}
            <div>
              <button
                onClick={() => setPreviewAbierto(!previewAbierto)}
                className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
              >
                <Eye className="h-3 w-3" /> {previewAbierto ? 'Ocultar' : 'Mostrar'} vista previa
              </button>
              {previewAbierto && (
                <div className="mt-2 border border-slate-200 rounded overflow-hidden">
                  {previewCargando ? (
                    <div className="py-8 text-center bg-slate-50">
                      <Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" />
                    </div>
                  ) : previewHtml ? (
                    <iframe
                      // allow-same-origin + allow-popups: imágenes del logo
                      // cargan correctamente y los links del preview abren
                      // en nueva pestaña. Scripts siguen bloqueados (sin
                      // allow-scripts) → no hay riesgo de XSS.
                      sandbox="allow-same-origin allow-popups"
                      srcDoc={previewHtml}
                      className="w-full bg-white"
                      style={{ height: '600px', border: 'none' }}
                    />
                  ) : (
                    <div className="py-8 text-center text-xs text-slate-400 bg-slate-50">
                      Editá los campos para generar el preview
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        {plantilla && (
          <div className="border-t border-slate-200 px-5 py-3 sticky bottom-0 bg-white flex items-center justify-between">
            <button
              onClick={restaurarDefault}
              disabled={guardando}
              className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1 disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" /> Restaurar default
            </button>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="btn-secondary text-xs px-3 py-1.5">
                Cancelar
              </button>
              <button
                onClick={guardar}
                disabled={guardando || !plantilla.editable}
                className="btn-primary text-xs px-4 py-1.5 flex items-center gap-1 disabled:opacity-50"
              >
                {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Guardar cambios
              </button>
            </div>
          </div>
        )}
      </div>

      <SelectorImagenBiblioteca
        abierto={selectorImagenAbierto}
        onCerrar={() => setSelectorImagenAbierto(false)}
        onElegir={insertarImagen}
        titulo="Insertar imagen en el cuerpo"
      />
    </div>
  )
}
