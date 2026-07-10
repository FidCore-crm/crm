'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus, Save, Loader2, ChevronDown, ChevronUp, FileText, Image as ImageIcon,
  Download, Trash2, Upload, AlertCircle, Edit2, Paperclip, X, Eye, Sparkles,
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { formatFecha, hoyLocal } from '@/lib/utils'
import { useModuloIAPDF } from '@/lib/hooks/useModuloIAPDF'
import ModalUploadPDF from '@/components/agente-pdf/ModalUploadPDF'
import { apiCall } from '@/lib/api-client'

interface Endoso {
  id: string
  numero_endoso: number
  fecha: string
  motivo: string
  observaciones: string | null
  created_at: string
  updated_at?: string | null
}

interface EndosoArchivo {
  id: string
  endoso_id: string | null
  nombre: string
  ruta: string
  mime_type: string | null
  tamano: number | null
  created_at: string
}

interface Props {
  polizaId: string
  numeroPoliza: string
  polizaContexto?: {
    asegurado_nombre: string
    compania_nombre: string
  }
  /** Si true, el header hace de toggle y todo el body se colapsa. Default: false. */
  colapsable?: boolean
  /** Estado inicial cuando es colapsable. Default: true (abierto). */
  defaultAbierto?: boolean
}

function formatBytes(bytes: number | null) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function esImagen(mime: string | null) {
  return mime?.startsWith('image/') ?? false
}

export default function EndososSection({ polizaId, numeroPoliza, polizaContexto, colapsable = false, defaultAbierto = true }: Props) {
  const supabase = getSupabaseClient()
  const { activo: moduloIAActivo } = useModuloIAPDF()
  const [modalPDFAbierto, setModalPDFAbierto] = useState(false)
  const [abierto, setAbierto] = useState(defaultAbierto)

  const [endosos, setEndosos] = useState<Endoso[]>([])
  const [archivosPorEndoso, setArchivosPorEndoso] = useState<Record<string, EndosoArchivo[]>>({})
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  // Form state (alta/edición)
  const [formAbierto, setFormAbierto] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [formMotivo, setFormMotivo] = useState('')
  const [formFecha, setFormFecha] = useState(hoyLocal())
  const [formObs, setFormObs] = useState('')
  const [formArchivos, setFormArchivos] = useState<File[]>([])
  const [guardando, setGuardando] = useState(false)
  const inputArchivosRef = useRef<HTMLInputElement>(null)

  // Lightbox para imágenes
  const [lightbox, setLightbox] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data: endosoRows } = await supabase
      .from('endosos')
      .select('*')
      .eq('poliza_id', polizaId)
      .order('numero_endoso', { ascending: false })

    const rows = (endosoRows ?? []) as unknown as Endoso[]
    setEndosos(rows)

    if (rows.length > 0) {
      const ids = rows.map(r => r.id)
      const { data: archivos } = await supabase
        .from('poliza_archivos')
        .select('id, endoso_id, nombre, ruta, mime_type, tamano, created_at')
        .eq('poliza_id', polizaId)
        .eq('categoria', 'endosos')
        .in('endoso_id', ids)
        .order('created_at', { ascending: true })

      const agrupados: Record<string, EndosoArchivo[]> = {}
      for (const a of (archivos ?? []) as EndosoArchivo[]) {
        if (!a.endoso_id) continue
        if (!agrupados[a.endoso_id]) agrupados[a.endoso_id] = []
        agrupados[a.endoso_id].push(a)
      }
      setArchivosPorEndoso(agrupados)
    } else {
      setArchivosPorEndoso({})
    }

    setCargando(false)
  }, [supabase, polizaId])

  useEffect(() => { cargar() }, [cargar])

  function toggleExpandido(id: string) {
    setExpandidos(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function abrirForm(editarEndoso?: Endoso) {
    setError('')
    if (editarEndoso) {
      setEditandoId(editarEndoso.id)
      setFormMotivo(editarEndoso.motivo || '')
      setFormFecha(editarEndoso.fecha)
      setFormObs(editarEndoso.observaciones || '')
    } else {
      setEditandoId(null)
      setFormMotivo('')
      setFormFecha(hoyLocal())
      setFormObs('')
    }
    setFormArchivos([])
    setFormAbierto(true)
  }

  function cerrarForm() {
    setFormAbierto(false)
    setEditandoId(null)
    setFormMotivo('')
    setFormObs('')
    setFormArchivos([])
  }

  async function subirArchivos(endosoId: string, files: File[]) {
    // Subida en paralelo, reuniendo errores para mostrar todos al usuario
    const resultados = await Promise.all(files.map(async file => {
      const fd = new FormData()
      fd.append('archivo', file)
      fd.append('categoria', 'endosos')
      fd.append('poliza_id', polizaId)
      fd.append('numero_poliza', numeroPoliza)
      fd.append('endoso_id', endosoId)
      const r = await apiCall('/api/storage/upload', { method: 'POST', body: fd }, { mostrar_toast_en_error: false })
      return r.ok ? null : `${file.name}: ${r.error?.mensaje || 'error desconocido'}`
    }))
    const errores = resultados.filter((e): e is string => e !== null)
    if (errores.length > 0) {
      throw new Error(`No se pudieron subir ${errores.length} archivo(s):\n${errores.join('\n')}`)
    }
  }

  async function guardar() {
    if (!formMotivo.trim()) { setError('El motivo es obligatorio'); return }
    setGuardando(true); setError('')
    let endosoCreadoId: string | null = null
    try {
      let endosoId = editandoId
      if (editandoId) {
        // Optimistic concurrency (#81): mandamos el updated_at que teníamos al abrir el form.
        const endosoActual = endosos.find(e => e.id === editandoId)
        const r = await apiCall(`/api/endosos/${editandoId}`, {
          method: 'PATCH',
          body: {
            motivo: formMotivo.trim(),
            fecha: formFecha,
            observaciones: formObs.trim() || null,
            if_match_updated_at: endosoActual?.updated_at ?? undefined,
          },
        }, { mostrar_toast_en_error: false })
        if (!r.ok) {
          if (r.error?.codigo === 'ERR_NEG_004') {
            throw new Error('Este endoso fue modificado por otro usuario mientras completabas la edición. Cerrá el form y volvé a abrirlo con los datos actuales.')
          }
          throw new Error(r.error?.mensaje || 'Error al editar endoso')
        }
      } else {
        const r = await apiCall<{ endoso: { id: string } }>('/api/endosos', {
          method: 'POST',
          body: { poliza_id: polizaId, motivo: formMotivo.trim(), fecha: formFecha, observaciones: formObs.trim() || null },
        }, { mostrar_toast_en_error: false })
        if (!r.ok || !r.data) throw new Error(r.error?.mensaje || 'Error al crear endoso')
        endosoId = r.data.endoso.id
        endosoCreadoId = endosoId
      }

      if (endosoId && formArchivos.length > 0) {
        await subirArchivos(endosoId, formArchivos)
      }

      cerrarForm()
      await cargar()
      if (endosoId) {
        setExpandidos(prev => new Set(prev).add(endosoId!))
      }
    } catch (err: any) {
      // Si falló subir archivos sobre un endoso recién creado, hacemos rollback del endoso
      // para no dejar registros huérfanos sin documentación.
      if (endosoCreadoId) {
        try {
          await apiCall(`/api/endosos/${endosoCreadoId}`, { method: 'DELETE' }, { mostrar_toast_en_error: false })
        } catch { /* el error principal se reporta abajo */ }
      }
      setError(err.message || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  async function eliminarEndoso(endoso: Endoso) {
    const tieneArchivos = (archivosPorEndoso[endoso.id] || []).length > 0
    const msg = tieneArchivos
      ? `¿Eliminar endoso #${endoso.numero_endoso}? Se borrarán también sus archivos adjuntos.`
      : `¿Eliminar endoso #${endoso.numero_endoso}?`
    if (!confirm(msg)) return
    const r = await apiCall(`/api/endosos/${endoso.id}`, { method: 'DELETE' }, { mostrar_toast_en_error: false })
    if (r.ok) {
      await cargar()
    } else {
      setError(r.error?.mensaje || 'Error al eliminar')
    }
  }

  async function eliminarArchivo(archivo: EndosoArchivo) {
    if (!confirm('¿Eliminar este archivo?')) return
    const r = await apiCall('/api/storage/delete', {
      method: 'DELETE',
      body: { archivo_id: archivo.id, tabla: 'poliza_archivos' },
    }, { mostrar_toast_en_error: false })
    if (r.ok) {
      await cargar()
    } else {
      setError(r.error?.mensaje || 'Error al eliminar archivo')
    }
  }

  async function agregarArchivosAEndoso(endosoId: string, files: FileList | null) {
    if (!files || files.length === 0) return
    try {
      setError('')
      await subirArchivos(endosoId, Array.from(files))
      await cargar()
    } catch (err: any) {
      setError(err.message || 'Error al subir archivos')
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50">
        <button
          type="button"
          onClick={colapsable ? () => setAbierto(v => !v) : undefined}
          className={`flex items-center gap-2 ${colapsable ? 'cursor-pointer' : 'cursor-default'}`}
          disabled={!colapsable}
        >
          <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">
            Endosos / Modificaciones
          </h3>
          <span className="text-2xs text-slate-400">
            ({endosos.length})
          </span>
        </button>
        {(!colapsable || abierto) && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => abrirForm()}
            className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
          >
            <Plus className="h-3 w-3" /> Nuevo endoso manual
          </button>
          {moduloIAActivo && (
            <button
              onClick={() => setModalPDFAbierto(true)}
              className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
            >
              <Sparkles className="h-3 w-3" /> Nuevo endoso desde PDF
            </button>
          )}
        </div>
        )}
        {colapsable && (
          <button
            type="button"
            onClick={() => setAbierto(v => !v)}
            className="ml-auto p-1 rounded hover:bg-slate-200 text-slate-400"
            title={abierto ? 'Contraer' : 'Expandir'}
          >
            {abierto ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {(!colapsable || abierto) && (<>
      {error && (
        <div className="mx-3 mt-3 flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}
        </div>
      )}

      {formAbierto && (
        <div className="border-b border-slate-200 bg-blue-50 p-3 flex flex-col gap-2">
          <p className="text-xs font-semibold text-blue-700">
            {editandoId ? 'Editar endoso' : 'Registrar nuevo endoso'}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="text-xs text-slate-600 mb-0.5 block">
                Motivo <span className="text-red-500">*</span>
              </label>
              <input
                className="form-input w-full"
                value={formMotivo}
                onChange={e => setFormMotivo(e.target.value)}
                placeholder="Ej: Cambio de cobertura, cambio de domicilio..."
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs text-slate-600 mb-0.5 block">Fecha</label>
              <input
                type="date"
                className="form-input w-full"
                value={formFecha}
                onChange={e => setFormFecha(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-600 mb-0.5 block">Observaciones</label>
            <textarea
              className="form-input w-full resize-none text-xs"
              rows={2}
              value={formObs}
              onChange={e => setFormObs(e.target.value)}
              placeholder="Detalle adicional del endoso..."
            />
          </div>

          <div>
            <label className="text-xs text-slate-600 mb-0.5 block">Archivos adjuntos (opcional)</label>
            <div
              className="h-10 border-2 border-dashed border-slate-300 bg-white rounded flex items-center px-3 cursor-pointer hover:border-blue-400"
              onClick={() => inputArchivosRef.current?.click()}
            >
              <input
                ref={inputArchivosRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={e => {
                  if (e.target.files) setFormArchivos(Array.from(e.target.files))
                }}
              />
              <Upload className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="text-xs text-slate-500 flex-1 text-center">
                {formArchivos.length === 0
                  ? 'Hacé clic para seleccionar PDFs o imágenes'
                  : `${formArchivos.length} archivo${formArchivos.length !== 1 ? 's' : ''} seleccionado${formArchivos.length !== 1 ? 's' : ''}`}
              </span>
            </div>
            {formArchivos.length > 0 && (
              <ul className="mt-2 space-y-1">
                {formArchivos.map((f, i) => (
                  <li key={i} className="text-2xs text-slate-500 flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    <span className="flex-1 truncate">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setFormArchivos(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-slate-400 hover:text-red-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={guardar} disabled={guardando} className="btn-primary">
              {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              {guardando ? 'Guardando...' : editandoId ? 'Guardar cambios' : 'Crear endoso'}
            </button>
            <button onClick={cerrarForm} className="btn-secondary" disabled={guardando}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {cargando ? (
        <div className="text-center py-8 text-xs text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin mx-auto" />
        </div>
      ) : endosos.length === 0 && !formAbierto ? (
        <div className="text-center py-8 text-xs text-slate-400">
          Sin endosos registrados — la póliza no tuvo modificaciones
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {endosos.map(e => {
            const archivos = archivosPorEndoso[e.id] || []
            const isExp = expandidos.has(e.id)
            return (
              <div key={e.id} className="px-3 py-2.5">
                <div
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={() => toggleExpandido(e.id)}
                >
                  <span className="flex items-center justify-center h-6 w-6 rounded-full bg-slate-100 text-2xs font-bold text-slate-600 shrink-0">
                    {e.numero_endoso}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-slate-700">{e.motivo}</span>
                      <span className="text-2xs text-slate-400">{formatFecha(e.fecha)}</span>
                      {archivos.length > 0 && (
                        <span className="text-2xs text-blue-600 flex items-center gap-0.5">
                          <Paperclip className="h-3 w-3" />
                          {archivos.length} adjunto{archivos.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {e.observaciones && !isExp && (
                      <p className="text-2xs text-slate-500 mt-0.5 leading-relaxed truncate">{e.observaciones}</p>
                    )}
                  </div>
                  {isExp ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                </div>

                {isExp && (
                  <div className="mt-3 ml-9 space-y-3">
                    {e.observaciones && (
                      <div>
                        <p className="text-2xs text-slate-400 uppercase mb-0.5 font-semibold">Observaciones</p>
                        <p className="text-xs text-slate-600 leading-relaxed">{e.observaciones}</p>
                      </div>
                    )}

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-2xs text-slate-400 uppercase font-semibold">
                          Archivos adjuntos ({archivos.length})
                        </p>
                        <label className="text-xs text-blue-600 hover:underline cursor-pointer flex items-center gap-0.5">
                          <Plus className="h-3 w-3" /> Agregar
                          <input
                            type="file"
                            multiple
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            className="hidden"
                            onChange={ev => {
                              agregarArchivosAEndoso(e.id, ev.target.files)
                              ev.target.value = ''
                            }}
                          />
                        </label>
                      </div>
                      {archivos.length === 0 ? (
                        <p className="text-2xs text-slate-400 italic">Sin archivos adjuntos</p>
                      ) : (
                        <ul className="space-y-1">
                          {archivos.map(a => (
                            <li key={a.id} className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1.5">
                              {esImagen(a.mime_type) ? (
                                <ImageIcon className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                              ) : (
                                <FileText className="h-3.5 w-3.5 text-red-500 shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="truncate text-slate-700">{a.nombre}</p>
                                <p className="text-2xs text-slate-400">{formatBytes(a.tamano)}</p>
                              </div>
                              {esImagen(a.mime_type) && (
                                <button
                                  onClick={() => setLightbox(`/api/storage/${a.ruta}`)}
                                  className="btn-tabla-accion"
                                >
                                  <Eye />
                                </button>
                              )}
                              <a
                                href={`/api/storage/${a.ruta}?download=true`}
                                className="btn-tabla-accion-neutral"
                              >
                                <Download />
                              </a>
                              <button
                                onClick={() => eliminarArchivo(a)}
                                className="btn-tabla-accion-danger"
                              >
                                <Trash2 />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="flex gap-2 pt-2 border-t border-slate-100">
                      <button
                        onClick={() => abrirForm(e)}
                        className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
                      >
                        <Edit2 className="h-3 w-3" /> Editar endoso
                      </button>
                      <button
                        onClick={() => eliminarEndoso(e)}
                        className="text-xs text-red-600 hover:underline flex items-center gap-0.5"
                      >
                        <Trash2 className="h-3 w-3" /> Eliminar endoso
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      </>)}

      <ModalUploadPDF
        abierto={modalPDFAbierto}
        onCerrar={() => setModalPDFAbierto(false)}
        tipo_operacion="ENDOSO"
        poliza_origen_id={polizaId}
        poliza_origen_info={polizaContexto ? {
          numero_poliza: numeroPoliza,
          asegurado_nombre: polizaContexto.asegurado_nombre,
          compania_nombre: polizaContexto.compania_nombre,
        } : undefined}
      />

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 h-8 w-8 flex items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30"
            onClick={() => setLightbox(null)}
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightbox}
            alt="Vista previa"
            className="max-w-full max-h-full rounded shadow-2xl"
            onClick={ev => ev.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
