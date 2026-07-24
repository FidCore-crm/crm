'use client'

import { useState, useEffect, useRef } from 'react'
import { logger } from '@/lib/errores/logger'
import {
  X, Loader2, Send, Eye, AlertTriangle, CheckCircle,
  FileText, Paperclip, Users, ChevronDown, ChevronUp, Image as ImageIcon
} from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import SelectorImagenBiblioteca, { type ArchivoBiblioteca } from './biblioteca/SelectorImagenBiblioteca'
import { ConfiguradorBotonCTA } from './comunicaciones/ConfiguradorBotonCTA'
import ModalVistaPrevia from './ModalVistaPrevia'

interface Plantilla {
  codigo: string
  nombre: string
  descripcion: string
  asunto_default: string
  contexto: string
  variables_disponibles: string[]
}

interface PersonaMasivo {
  id: string
  nombre: string
  apellido: string
  email: string | null
  acepta_marketing: boolean
}

interface Props {
  isOpen: boolean
  onClose: () => void
  personas: PersonaMasivo[]
  contexto: 'CLIENTE' | 'POLIZA' | 'GENERAL'
  onSuccess?: () => void
}

const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_FILES = 5

interface ResultadoEnvio {
  campana_id?: string
  total: number
  encolados: number
  excluidos: number
  programada?: string | null
  mensaje?: string
}

function isoLocalMin() {
  // datetime-local mínimo: ahora + 5 min, sin segundos ni TZ
  const d = new Date(Date.now() + 5 * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function ModalEnviarEmailMasivo({ isOpen, onClose, personas, contexto, onSuccess }: Props) {
  const [plantillas, setPlantillas] = useState<Plantilla[]>([])
  const [cargandoPlantillas, setCargandoPlantillas] = useState(true)
  const [plantillaSeleccionada, setPlantillaSeleccionada] = useState('')

  const [asunto, setAsunto] = useState('')
  const [titulo, setTitulo] = useState('')
  const [cuerpo, setCuerpo] = useState('')
  const [ctaTexto, setCtaTexto] = useState('')
  const [ctaUrl, setCtaUrl] = useState('')

  const [archivos, setArchivos] = useState<File[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoEnvio | null>(null)
  const [errorGral, setErrorGral] = useState('')

  const [programarModo, setProgramarModo] = useState<'ahora' | 'futuro'>('ahora')
  const [programadaPara, setProgramadaPara] = useState<string>(isoLocalMin())

  const [previewHtml, setPreviewHtml] = useState('')
  const [mostrarPreview, setMostrarPreview] = useState(false)
  const [cargandoPreview, setCargandoPreview] = useState(false)

  const [mostrarExcluidos, setMostrarExcluidos] = useState(false)

  const [selectorImagenAbierto, setSelectorImagenAbierto] = useState(false)
  const cuerpoRef = useRef<HTMLTextAreaElement>(null)

  const insertarImagenEnCuerpo = (archivo: ArchivoBiblioteca) => {
    const marcador = `[[IMG:${archivo.id}]]`
    const textarea = cuerpoRef.current
    if (!textarea) {
      setCuerpo(prev => `${prev}${prev && !prev.endsWith('\n') ? '\n' : ''}${marcador}\n`)
      return
    }
    const start = textarea.selectionStart ?? cuerpo.length
    const end = textarea.selectionEnd ?? cuerpo.length
    const nuevo = cuerpo.slice(0, start) + marcador + cuerpo.slice(end)
    setCuerpo(nuevo)
    setTimeout(() => {
      textarea.focus()
      const pos = start + marcador.length
      textarea.setSelectionRange(pos, pos)
    }, 0)
  }

  // Análisis de destinatarios
  const sinEmail = personas.filter(p => !p.email)
  const noMarketing = personas.filter(p => p.email && p.acepta_marketing === false)
  const validos = personas.filter(p => p.email && p.acepta_marketing !== false)

  useEffect(() => {
    if (!isOpen) return
    setCargandoPlantillas(true)
    setResultado(null)
    setErrorGral('')
    apiCall<{ plantillas: Plantilla[] }>(`/api/comunicaciones/plantillas?contexto=${contexto}`, {}, { mostrar_toast_en_error: false })
      .then(r => {
        if (r.ok && r.data?.plantillas) {
          setPlantillas(r.data.plantillas)
          if (r.data.plantillas.length > 0) {
            seleccionarPlantilla(r.data.plantillas[0])
          }
        }
        setCargandoPlantillas(false)
      })
  }, [isOpen, contexto])

  function seleccionarPlantilla(p: Plantilla) {
    setPlantillaSeleccionada(p.codigo)
    setAsunto(p.asunto_default)
    setTitulo('')
    setCuerpo('')
    setCtaTexto('')
    setCtaUrl('')
    setMostrarPreview(false)
  }

  function agregarArchivos(files: FileList | File[]) {
    const nuevos = Array.from(files).filter(f => f.size <= MAX_FILE_SIZE)
    setArchivos(prev => [...prev, ...nuevos].slice(0, MAX_FILES))
  }

  async function verPreview() {
    if (!validos.length) return
    // Abre el modal ANTES del fetch para mostrar estado "cargando" al PAS.
    setPreviewHtml('')
    setMostrarPreview(true)
    setCargandoPreview(true)
    const r = await apiCall<{ html: string }>(`/api/comunicaciones/plantillas/${plantillaSeleccionada}/preview`, {
      method: 'POST',
      body: {
        persona_id: validos[0].id,
        campos_editables: { titulo, cuerpo, cta_texto: ctaTexto.trim() || undefined, cta_url: ctaUrl.trim() || undefined },
      },
    }, { mostrar_toast_en_error: false })
    if (r.ok && r.data) {
      setPreviewHtml(r.data.html)
    } else if (r.error) {
      logger.warn({ modulo: 'emails', mensaje: 'Error cargando preview de plantilla (masivo)', contexto: { error: r.error.mensaje } })
    }
    setCargandoPreview(false)
  }

  async function enviar() {
    if (!plantillaSeleccionada || !validos.length) return

    // Validar fecha programada si aplica
    let programadaIso: string | null = null
    if (programarModo === 'futuro') {
      const fecha = new Date(programadaPara)
      if (isNaN(fecha.getTime())) {
        setErrorGral('Fecha programada inválida')
        return
      }
      if (fecha.getTime() < Date.now() + 60_000) {
        setErrorGral('La fecha programada debe ser al menos 1 minuto en el futuro')
        return
      }
      programadaIso = fecha.toISOString()
      if (!confirm(`Vas a programar ${validos.length} emails para el ${fecha.toLocaleString('es-AR')}. ¿Confirmás?`)) return
    } else {
      if (!confirm(`Vas a encolar ${validos.length} emails para enviar en segundo plano. ¿Confirmás?`)) return
    }

    setEnviando(true)
    setResultado(null)
    setErrorGral('')

    const formData = new FormData()
    formData.append('plantilla_codigo', plantillaSeleccionada)
    formData.append('persona_ids', JSON.stringify(validos.map(p => p.id)))
    formData.append('campos_editables', JSON.stringify({
      titulo: titulo || undefined,
      cuerpo: cuerpo || undefined,
      cta_texto: ctaTexto.trim() || undefined,
      cta_url: ctaUrl.trim() || undefined,
    }))
    if (asunto) formData.append('asunto', asunto)
    if (programadaIso) formData.append('programada_para', programadaIso)
    archivos.forEach(f => formData.append('archivos', f))

    const r = await apiCall<ResultadoEnvio>('/api/comunicaciones/enviar-masivo', { method: 'POST', body: formData }, { mostrar_toast_en_error: false })
    setEnviando(false)

    if (r.ok && r.data) {
      // Envío async: cerrar el modal + toast con el mensaje del backend.
      // El PAS ve el progreso en el historial.
      toast.exito(r.data.mensaje || `${r.data.encolados} emails encolados. Se envían en segundo plano.`)
      onSuccess?.()
      onClose()
      // Reset local para próxima apertura
      setResultado(null)
      setErrorGral('')
      setArchivos([])
      setMostrarPreview(false)
      setProgramarModo('ahora')
      setProgramadaPara(isoLocalMin())
    } else {
      setErrorGral(r.error?.mensaje || 'Error al enviar')
    }
  }

  function cerrar() {
    if (enviando) return
    if (resultado) onSuccess?.()
    onClose()
    setResultado(null)
    setErrorGral('')
    setArchivos([])
    setMostrarPreview(false)
  }

  if (!isOpen) return null

  const plantillaActual = plantillas.find(p => p.codigo === plantillaSeleccionada)
  const esPlantillaLibre = plantillaActual?.asunto_default.includes('asunto_personalizado')
  // Solo las plantillas que declaran estas variables en `variables_disponibles`
  // reflejan el texto que escribe el PAS. El resto tiene contenido fijo.
  const vars = plantillaActual?.variables_disponibles ?? []
  const aceptaTitulo = vars.includes('titulo')
  const aceptaCuerpo = vars.includes('cuerpo_mensaje')
  const tieneCamposPersonalizables = aceptaTitulo || aceptaCuerpo

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={enviando ? undefined : cerrar}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <Users className="h-4 w-4 text-blue-600" />
            Enviar email a {personas.length} destinatario{personas.length !== 1 ? 's' : ''}
          </h2>
          {!enviando && (
            <button onClick={cerrar} className="text-slate-500 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Body — min-h-0 obligatorio para que `overflow-auto` respete el
            max-h-[90vh] del contenedor (sin él, el preview y las listas largas
            de destinatarios quedan cortadas sin scroll). */}
        <div className="flex-1 min-h-0 overflow-auto px-5 py-4 flex flex-col gap-4">

          {/* En modo async (v1.0.179) el resultado se muestra como toast + cierre
              del modal. No hay pantalla de resultado inline. */}
          {(
            <>
              {/* Resumen de destinatarios */}
              <div className="bg-slate-50 border border-slate-200 rounded p-3">
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  <div>
                    <p className="font-semibold text-slate-700">{personas.length}</p>
                    <p className="text-2xs text-slate-600">Seleccionados</p>
                  </div>
                  <div>
                    <p className="font-semibold text-green-700">{validos.length}</p>
                    <p className="text-2xs text-slate-600">Se enviarán</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-500">{sinEmail.length}</p>
                    <p className="text-2xs text-slate-600">Sin email</p>
                  </div>
                  <div>
                    <p className="font-semibold text-amber-600">{noMarketing.length}</p>
                    <p className="text-2xs text-slate-600">No marketing</p>
                  </div>
                </div>
                {(sinEmail.length > 0 || noMarketing.length > 0) && (
                  <button
                    onClick={() => setMostrarExcluidos(!mostrarExcluidos)}
                    className="text-2xs text-blue-600 hover:underline mt-2 flex items-center gap-1 mx-auto"
                  >
                    {mostrarExcluidos ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    {mostrarExcluidos ? 'Ocultar' : 'Ver'} excluidos
                  </button>
                )}
                {mostrarExcluidos && (
                  <div className="mt-2 border-t border-slate-200 pt-2 max-h-32 overflow-auto text-2xs text-slate-600">
                    {sinEmail.map(p => (
                      <div key={p.id}>{p.apellido}{p.nombre ? `, ${p.nombre}` : ''} — <span className="text-slate-500">sin email</span></div>
                    ))}
                    {noMarketing.map(p => (
                      <div key={p.id}>{p.apellido}{p.nombre ? `, ${p.nombre}` : ''} — <span className="text-amber-500">no acepta marketing</span></div>
                    ))}
                  </div>
                )}
              </div>

              {/* Warnings */}
              {validos.length > 100 && (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Este envío puede tardar varios minutos. No cierres esta ventana hasta que termine.
                </div>
              )}

              {validos.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  No hay destinatarios válidos para enviar.
                </div>
              )}

              {/* Plantilla */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-slate-600">Plantilla</label>
                  {plantillaSeleccionada && !cargandoPlantillas && (
                    <button
                      type="button"
                      onClick={verPreview}
                      disabled={cargandoPreview}
                      className="text-xs px-3 py-1.5 border border-blue-200 bg-blue-50 rounded hover:bg-blue-100 hover:border-blue-300 flex items-center gap-1.5 text-blue-700 font-medium transition-colors disabled:opacity-50"
                    >
                      {cargandoPreview
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Eye className="h-3.5 w-3.5" />}
                      {mostrarPreview ? 'Actualizar vista previa' : 'Ver vista previa'}
                    </button>
                  )}
                </div>
                {cargandoPlantillas ? (
                  <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
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
              </div>

              {/* Campos editables */}
              {plantillaSeleccionada && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Asunto{esPlantillaLibre && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    <input type="text" className="form-input w-full text-xs" value={asunto}
                      onChange={e => setAsunto(e.target.value)} placeholder="Asunto del email..." />
                    <p className="text-2xs text-slate-500 mt-1">Las variables como {'{{nombre}}'} se reemplazan automáticamente.</p>
                  </div>
                  {aceptaTitulo && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Título del email</label>
                      <input type="text" className="form-input w-full text-xs" value={titulo}
                        onChange={e => setTitulo(e.target.value)} placeholder="Título que aparece dentro del email (opcional)..." />
                    </div>
                  )}
                  {aceptaCuerpo && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-xs font-medium text-slate-600">Cuerpo del mensaje</label>
                        <button
                          type="button"
                          onClick={() => setSelectorImagenAbierto(true)}
                          className="text-xs px-3 py-1.5 border border-blue-200 bg-blue-50 rounded hover:bg-blue-100 hover:border-blue-300 flex items-center gap-1.5 text-blue-700 font-medium transition-colors"
                        >
                          <ImageIcon className="h-3.5 w-3.5" /> Insertar imagen
                        </button>
                      </div>
                      <textarea
                        ref={cuerpoRef}
                        className="form-input w-full text-xs"
                        rows={4}
                        value={cuerpo}
                        onChange={e => setCuerpo(e.target.value)}
                        placeholder="Texto personalizado del email (opcional)..."
                      />
                    </div>
                  )}

                  {/* Botón CTA (v1.0.141) — disponible solo cuando la plantilla admite cuerpo */}
                  {aceptaCuerpo && (
                    <ConfiguradorBotonCTA
                      ctaTexto={ctaTexto}
                      ctaUrl={ctaUrl}
                      onCambio={(t, u) => { setCtaTexto(t); setCtaUrl(u) }}
                    />
                  )}

                  {!tieneCamposPersonalizables && (
                    <div className="text-2xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-2.5">
                      Esta plantilla tiene contenido fijo. Solo se completa con los datos del cliente y de la póliza. Si querés escribir un texto propio, elegí <strong>&quot;Mensaje informativo&quot;</strong> o <strong>&quot;Notificación general&quot;</strong>.
                    </div>
                  )}

                  {/* Adjuntos — alineado con ModalEnviarEmail (v1.0.173):
                      drag-drop + iconos + padding + tamaño en KB unificados. */}
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Archivos adjuntos <span className="text-slate-500 font-normal">({archivos.length}/{MAX_FILES})</span>
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
                      <input ref={inputRef} type="file" multiple className="hidden"
                        onChange={e => { if (e.target.files) agregarArchivos(e.target.files); e.target.value = '' }} />
                      <Paperclip className="h-4 w-4 text-slate-500 mx-auto mb-1" />
                      <p className="text-xs text-slate-600">
                        Arrastrá archivos o <span className="text-blue-600 font-medium">hacé clic</span>
                      </p>
                      <p className="text-2xs text-slate-500 mt-0.5">Máx. 10MB por archivo, {MAX_FILES} archivos</p>
                    </div>
                    {archivos.length > 0 && (
                      <div className="mt-2 flex flex-col gap-1">
                        {archivos.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 rounded px-2 py-1.5">
                            <FileText className="h-3 w-3 text-slate-500 shrink-0" />
                            <span className="flex-1 truncate">{f.name}</span>
                            <span className="text-2xs text-slate-500 shrink-0">
                              {(f.size / 1024).toFixed(0)} KB
                            </span>
                            <button onClick={() => setArchivos(prev => prev.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-500 shrink-0">
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Enviar ahora / Programar para fecha y hora */}
                  <div className="border border-slate-200 rounded p-3 bg-slate-50">
                    <label className="block text-xs font-medium text-slate-600 mb-2">¿Cuándo enviar?</label>
                    <div className="flex gap-3 flex-wrap">
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="radio"
                          checked={programarModo === 'ahora'}
                          onChange={() => setProgramarModo('ahora')}
                          className="h-3.5 w-3.5"
                        />
                        Enviar ahora (segundo plano)
                      </label>
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="radio"
                          checked={programarModo === 'futuro'}
                          onChange={() => setProgramarModo('futuro')}
                          className="h-3.5 w-3.5"
                        />
                        Programar para fecha y hora
                      </label>
                    </div>
                    {programarModo === 'futuro' && (
                      <div className="mt-2">
                        <input
                          type="datetime-local"
                          value={programadaPara}
                          onChange={e => setProgramadaPara(e.target.value)}
                          min={isoLocalMin()}
                          className="form-input h-8 text-xs w-full"
                        />
                        <p className="text-2xs text-slate-500 mt-1">
                          El sistema va a enviarlos automáticamente cuando llegue esta fecha. Mientras tanto podés seguir usando el CRM.
                        </p>
                      </div>
                    )}
                    {programarModo === 'ahora' && (
                      <p className="text-2xs text-slate-500 mt-2">
                        Los emails se encolan y se envían en segundo plano. Podés cerrar esta ventana y seguir trabajando — el progreso lo ves en el historial.
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* Encolando */}
              {enviando && (
                <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded p-4">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-600 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-blue-800">Encolando {validos.length} emails...</p>
                    <p className="text-xs text-blue-600 mt-0.5">Un segundo — el envío en sí corre en segundo plano.</p>
                  </div>
                </div>
              )}

              {errorGral && (
                <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-3">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {errorGral}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 shrink-0">
          {!enviando && (
            <button onClick={cerrar} className="btn-secondary text-xs px-3 py-1.5">
              {resultado ? 'Cerrar' : 'Cancelar'}
            </button>
          )}
          {!resultado && plantillaSeleccionada && validos.length > 0 && (
            <button onClick={enviar} disabled={enviando || (esPlantillaLibre && !asunto.trim())}
              className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50">
              {enviando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              {enviando ? 'Enviando...' : `Enviar a ${validos.length}`}
            </button>
          )}
        </div>
      </div>

      <SelectorImagenBiblioteca
        abierto={selectorImagenAbierto}
        onCerrar={() => setSelectorImagenAbierto(false)}
        onElegir={insertarImagenEnCuerpo}
        titulo="Insertar imagen en el cuerpo"
      />

      <ModalVistaPrevia
        abierto={mostrarPreview}
        onCerrar={() => setMostrarPreview(false)}
        html={previewHtml}
        titulo="Vista previa (primer destinatario)"
        cargando={cargandoPreview}
      />
    </div>
  )
}
