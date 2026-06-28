'use client'

import { useState, useEffect, useRef } from 'react'
import { logger } from '@/lib/errores/logger'
import {
  X, Loader2, Send, Eye, AlertTriangle,
  CheckCircle, FileText, Paperclip
} from 'lucide-react'
import { apiCall } from '@/lib/api-client'

interface Plantilla {
  codigo: string
  nombre: string
  descripcion: string
  asunto_default: string
  contexto: string
  variables_disponibles: string[]
}

interface Props {
  isOpen: boolean
  onClose: () => void
  persona: { id: string; nombre: string; apellido: string; email: string | null; acepta_marketing?: boolean }
  poliza?: { id: string; numero_poliza: string; compania: string; ramo: string }
  onSuccess?: () => void
  /**
   * Si se pasa, pre-selecciona esa plantilla al abrir el modal en vez de
   * elegir el default por contexto. Usado por accesos directos como
   * "Recordar pago".
   */
  plantillaInicial?: string
}

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_FILES = 5

export default function ModalEnviarEmail({ isOpen, onClose, persona, poliza, onSuccess, plantillaInicial }: Props) {
  const [plantillas, setPlantillas] = useState<Plantilla[]>([])
  const [cargandoPlantillas, setCargandoPlantillas] = useState(true)
  const [plantillaSeleccionada, setPlantillaSeleccionada] = useState('')

  const [asunto, setAsunto] = useState('')
  const [titulo, setTitulo] = useState('')
  const [cuerpo, setCuerpo] = useState('')

  const [archivos, setArchivos] = useState<File[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: boolean; mensaje: string } | null>(null)

  const [previewHtml, setPreviewHtml] = useState('')
  const [mostrarPreview, setMostrarPreview] = useState(false)
  const [cargandoPreview, setCargandoPreview] = useState(false)

  const [estaBaja, setEstaBaja] = useState(false)
  const [cargandoBaja, setCargandoBaja] = useState(true)

  // Cargar plantillas
  useEffect(() => {
    if (!isOpen) return
    setCargandoPlantillas(true)
    const contexto = poliza ? 'POLIZA' : 'CLIENTE'
    apiCall<{ plantillas: Plantilla[] }>(`/api/comunicaciones/plantillas?contexto=${contexto}`, {}, { mostrar_toast_en_error: false })
      .then(r => {
        if (r.ok && r.data?.plantillas) {
          setPlantillas(r.data.plantillas)
          // Si vino plantillaInicial y existe, usarla. Si no, caer al default
          // por contexto (póliza → POLIZA, sino → GENERAL).
          const elegida = plantillaInicial
            ? r.data.plantillas.find((p: Plantilla) => p.codigo === plantillaInicial)
            : null
          if (elegida) {
            seleccionarPlantilla(elegida)
          } else {
            const polizaPlantillas = r.data.plantillas.filter((p: Plantilla) => p.contexto === 'POLIZA')
            const generalPlantillas = r.data.plantillas.filter((p: Plantilla) => p.contexto === 'GENERAL')
            if (poliza && polizaPlantillas.length > 0) {
              seleccionarPlantilla(polizaPlantillas[0])
            } else if (generalPlantillas.length > 0) {
              seleccionarPlantilla(generalPlantillas[0])
            } else if (r.data.plantillas.length > 0) {
              seleccionarPlantilla(r.data.plantillas[0])
            }
          }
        }
        setCargandoPlantillas(false)
      })
  }, [isOpen, poliza, plantillaInicial])

  // Verificar si está en lista de bajas
  useEffect(() => {
    if (!isOpen || !persona.email) { setCargandoBaja(false); return }
    setCargandoBaja(true)
    apiCall<{ en_baja: boolean }>(`/api/comunicaciones/verificar-baja?email=${encodeURIComponent(persona.email)}`, {}, { mostrar_toast_en_error: false })
      .then(r => {
        if (r.ok && r.data) setEstaBaja(r.data.en_baja === true)
        setCargandoBaja(false)
      })
  }, [isOpen, persona.email])

  function seleccionarPlantilla(p: Plantilla) {
    setPlantillaSeleccionada(p.codigo)
    setAsunto(p.asunto_default)
    setTitulo('')
    setCuerpo('')
    setResultado(null)
    setMostrarPreview(false)
  }

  function agregarArchivos(files: FileList | File[]) {
    const nuevos = Array.from(files).filter(f => {
      if (f.size > MAX_FILE_SIZE) return false
      if (archivos.length + 1 > MAX_FILES) return false
      return true
    })
    setArchivos(prev => [...prev, ...nuevos].slice(0, MAX_FILES))
  }

  function quitarArchivo(idx: number) {
    setArchivos(prev => prev.filter((_, i) => i !== idx))
  }

  async function verPreview() {
    setCargandoPreview(true)
    setMostrarPreview(false)
    const r = await apiCall<{ html: string }>(`/api/comunicaciones/plantillas/${plantillaSeleccionada}/preview`, {
      method: 'POST',
      body: {
        persona_id: persona.id,
        poliza_id: poliza?.id || null,
        campos_editables: { titulo, cuerpo },
      },
    }, { mostrar_toast_en_error: false })
    if (r.ok && r.data) {
      setPreviewHtml(r.data.html)
      setMostrarPreview(true)
    } else if (r.error) {
      logger.warn({ modulo: 'emails', mensaje: 'Error cargando preview de plantilla', contexto: { error: r.error.mensaje } })
    }
    setCargandoPreview(false)
  }

  async function enviar() {
    if (!plantillaSeleccionada) return
    setEnviando(true)
    setResultado(null)

    const formData = new FormData()
    formData.append('plantilla_codigo', plantillaSeleccionada)
    formData.append('persona_id', persona.id)
    if (poliza) formData.append('poliza_id', poliza.id)
    if (asunto) formData.append('asunto', asunto)
    formData.append('campos_editables', JSON.stringify({
      titulo: titulo || undefined,
      cuerpo: cuerpo || undefined,
    }))
    archivos.forEach(f => formData.append('archivos', f))

    const r = await apiCall('/api/comunicaciones/enviar', { method: 'POST', body: formData }, { mostrar_toast_en_error: false })
    if (r.ok) {
      setResultado({ ok: true, mensaje: 'Email enviado correctamente' })
      setTimeout(() => {
        onSuccess?.()
        onClose()
        resetForm()
      }, 1500)
    } else {
      setResultado({ ok: false, mensaje: r.error?.mensaje || 'Error al enviar' })
    }
    setEnviando(false)
  }

  function resetForm() {
    setPlantillaSeleccionada('')
    setAsunto('')
    setTitulo('')
    setCuerpo('')
    setArchivos([])
    setResultado(null)
    setMostrarPreview(false)
  }

  if (!isOpen) return null

  const plantillaActual = plantillas.find(p => p.codigo === plantillaSeleccionada)
  const esPlantillaLibre = plantillaActual?.asunto_default.includes('asunto_personalizado')
  // Solo las plantillas que declaran estas variables en `variables_disponibles`
  // van a reflejar el texto que escriba el PAS. El resto tiene contenido fijo
  // (bienvenida, renovación, recordatorio, portal cliente).
  const vars = plantillaActual?.variables_disponibles ?? []
  const aceptaTitulo = vars.includes('titulo')
  const aceptaCuerpo = vars.includes('cuerpo_mensaje')
  const tieneCamposPersonalizables = aceptaTitulo || aceptaCuerpo
  const noTieneEmail = !persona.email
  const noAceptaMarketing = persona.acepta_marketing === false

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-sm font-semibold text-slate-800">
            Enviar email a {persona.apellido}{persona.nombre ? `, ${persona.nombre}` : ''}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto px-5 py-4 flex flex-col gap-4">
          {/* Sin email */}
          {noTieneEmail ? (
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded p-4">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800">Este cliente no tiene email cargado</p>
                <p className="text-xs text-amber-600 mt-1">Cargá un email en su ficha antes de enviar comunicaciones.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Warnings */}
              {noAceptaMarketing && (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Este cliente tiene desactivada la recepción de comunicaciones. El email no se va a enviar.
                </div>
              )}
              {estaBaja && !cargandoBaja && (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Este email se dio de baja de las comunicaciones. El envío se va a registrar pero no se va a enviar.
                </div>
              )}

              {/* Destinatario */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Destinatario</label>
                <div className="form-input bg-slate-50 text-xs text-slate-700 cursor-default">
                  {persona.apellido}{persona.nombre ? `, ${persona.nombre}` : ''} &lt;{persona.email}&gt;
                  {poliza && (
                    <span className="ml-2 text-slate-400">· Póliza {poliza.numero_poliza}</span>
                  )}
                </div>
              </div>

              {/* Plantilla */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Plantilla</label>
                {cargandoPlantillas ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                    <Loader2 className="h-3 w-3 animate-spin" /> Cargando plantillas...
                  </div>
                ) : (
                  <select
                    className="form-input w-full text-xs"
                    value={plantillaSeleccionada}
                    onChange={e => {
                      const p = plantillas.find(pl => pl.codigo === e.target.value)
                      if (p) seleccionarPlantilla(p)
                    }}
                  >
                    <option value="">Seleccionar plantilla...</option>
                    {plantillas.map(p => (
                      <option key={p.codigo} value={p.codigo}>{p.nombre}</option>
                    ))}
                  </select>
                )}
                {plantillaActual && (
                  <p className="text-2xs text-slate-400 mt-1">{plantillaActual.descripcion}</p>
                )}
              </div>

              {/* Campos editables */}
              {plantillaSeleccionada && (
                <>
                  {/* Asunto */}
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Asunto{esPlantillaLibre && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    <input
                      type="text"
                      className="form-input w-full text-xs"
                      value={asunto}
                      onChange={e => setAsunto(e.target.value)}
                      placeholder="Asunto del email..."
                    />
                    <p className="text-2xs text-slate-400 mt-1">Las variables como {'{{nombre}}'} se reemplazan automáticamente.</p>
                  </div>

                  {/* Título — solo si la plantilla lo usa */}
                  {aceptaTitulo && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Título del email</label>
                      <input
                        type="text"
                        className="form-input w-full text-xs"
                        value={titulo}
                        onChange={e => setTitulo(e.target.value)}
                        placeholder="Título que aparece dentro del email (opcional)..."
                      />
                    </div>
                  )}

                  {/* Cuerpo — solo si la plantilla lo usa */}
                  {aceptaCuerpo && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Cuerpo del mensaje</label>
                      <textarea
                        className="form-input w-full text-xs"
                        rows={4}
                        value={cuerpo}
                        onChange={e => setCuerpo(e.target.value)}
                        placeholder="Texto personalizado del email (opcional)..."
                      />
                    </div>
                  )}

                  {/* Mensaje si la plantilla es de contenido fijo */}
                  {!tieneCamposPersonalizables && (
                    <div className="text-2xs text-slate-500 bg-slate-50 border border-slate-200 rounded p-2.5">
                      Esta plantilla tiene contenido fijo. Solo se completa con los datos del cliente y de la póliza. Si querés escribir un texto propio, elegí <strong>&quot;Mensaje informativo&quot;</strong> o <strong>&quot;Notificación general&quot;</strong>.
                    </div>
                  )}

                  {/* Archivos adjuntos */}
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Archivos adjuntos <span className="text-slate-400 font-normal">({archivos.length}/{MAX_FILES})</span>
                    </label>
                    <div
                      className={`border-2 border-dashed rounded p-3 text-center cursor-pointer transition-colors ${
                        dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
                      } ${archivos.length >= MAX_FILES ? 'opacity-50 pointer-events-none' : ''}`}
                      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => { e.preventDefault(); setDragOver(false); agregarArchivos(e.dataTransfer.files) }}
                      onClick={() => inputRef.current?.click()}
                    >
                      <input
                        ref={inputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={e => { if (e.target.files) agregarArchivos(e.target.files); e.target.value = '' }}
                      />
                      <Paperclip className="h-4 w-4 text-slate-400 mx-auto mb-1" />
                      <p className="text-xs text-slate-500">
                        Arrastrá archivos o <span className="text-blue-600 font-medium">hacé clic</span>
                      </p>
                      <p className="text-2xs text-slate-400 mt-0.5">Máx. 10MB por archivo, {MAX_FILES} archivos</p>
                    </div>

                    {archivos.length > 0 && (
                      <div className="mt-2 flex flex-col gap-1">
                        {archivos.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 rounded px-2 py-1.5">
                            <FileText className="h-3 w-3 text-slate-400 shrink-0" />
                            <span className="flex-1 truncate">{f.name}</span>
                            <span className="text-2xs text-slate-400 shrink-0">
                              {(f.size / 1024).toFixed(0)} KB
                            </span>
                            <button onClick={() => quitarArchivo(i)} className="text-slate-400 hover:text-red-500 shrink-0">
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Preview */}
              {mostrarPreview && (
                <div className="border border-slate-200 rounded overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-100">
                    <span className="text-xs font-medium text-slate-600">Vista previa</span>
                    <button onClick={() => setMostrarPreview(false)} className="text-slate-400 hover:text-slate-600">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <iframe
                    srcDoc={previewHtml}
                    title="Preview"
                    className="w-full border-0"
                    style={{ minHeight: '400px' }}
                    sandbox="allow-same-origin allow-popups"
                  />
                </div>
              )}

              {/* Resultado */}
              {resultado && (
                <div className={`flex items-center gap-2 text-xs rounded p-3 ${
                  resultado.ok
                    ? 'text-green-700 bg-green-50 border border-green-200'
                    : 'text-red-700 bg-red-50 border border-red-200'
                }`}>
                  {resultado.ok
                    ? <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                    : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  }
                  {resultado.mensaje}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 shrink-0">
          <button onClick={onClose} className="btn-secondary text-xs px-3 py-1.5">
            {noTieneEmail ? 'Cerrar' : 'Cancelar'}
          </button>
          {!noTieneEmail && plantillaSeleccionada && (
            <>
              <button
                onClick={verPreview}
                disabled={cargandoPreview}
                className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
              >
                {cargandoPreview ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                Vista previa
              </button>
              <button
                onClick={enviar}
                disabled={enviando || (esPlantillaLibre && !asunto.trim()) || resultado?.ok === true}
                className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
              >
                {enviando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                {enviando ? 'Enviando...' : 'Enviar'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
