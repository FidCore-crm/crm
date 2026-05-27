'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Upload, Trash2, Download, FileText, Image, X, Loader2, AlertCircle, Eye,
  ChevronDown, ChevronUp
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { apiCall } from '@/lib/api-client'

interface Archivo {
  id: string
  nombre: string
  ruta: string
  categoria: string
  mime_type: string | null
  tamano: number | null
  created_at: string
}

interface Props {
  // Póliza
  polizaId?: string
  numeroPoliza?: string
  // Póliza raíz (para inspección compartida en cadena de renovaciones)
  polizaRaizId?: string
  polizaRaizNumero?: string
  // Siniestro
  siniestroId?: string
  numeroCaso?: string
  // Común
  categoria: 'inspeccion' | 'documentacion' | 'documentacion_renovada' | 'fotos'
  titulo: string
}

function formatBytes(bytes: number | null) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatFechaCorta(f: string) {
  return new Date(f).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function esImagen(mime: string | null) {
  return mime?.startsWith('image/') ?? false
}

const ACCEPT_IMAGENES = 'image/jpeg,image/png,image/webp'
const ACCEPT_DOCUMENTACION = 'image/jpeg,image/png,image/webp,application/pdf'

export default function GestorArchivos({ polizaId, numeroPoliza, polizaRaizId, polizaRaizNumero, siniestroId, numeroCaso, categoria, titulo }: Props) {
  const supabase = getSupabaseClient()
  const inputRef = useRef<HTMLInputElement>(null)

  const esSiniestro = !!siniestroId
  const tabla = esSiniestro ? 'siniestro_archivos' : 'poliza_archivos'
  const fkColumn = esSiniestro ? 'siniestro_id' : 'poliza_id'

  // Para inspección: usar la póliza raíz si se proporcionó
  const usarRaiz = !esSiniestro && categoria === 'inspeccion' && polizaRaizId && polizaRaizNumero
  const fkValue = esSiniestro ? siniestroId : (usarRaiz ? polizaRaizId : polizaId)
  const numPolizaEfectivo = usarRaiz ? polizaRaizNumero : numeroPoliza

  const [archivos, setArchivos] = useState<Archivo[]>([])
  const [cargando, setCargando] = useState(true)
  const [subiendo, setSubiendo] = useState(false)
  const [progreso, setProgreso] = useState(0)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [expandido, setExpandido] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data } = await supabase
      .from(tabla)
      .select('*')
      .eq(fkColumn, fkValue!)
      .eq('categoria', categoria)
      .order('created_at', { ascending: false })
    setArchivos((data ?? []) as Archivo[])
    setCargando(false)
  }, [supabase, tabla, fkColumn, fkValue, categoria])

  useEffect(() => { cargar() }, [cargar])

  // Escape cierra el lightbox cuando está abierto
  useEffect(() => {
    if (!lightbox) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightbox])

  const subirArchivos = async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return

    setSubiendo(true)
    setError('')
    setProgreso(0)

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i]
      const formData = new FormData()
      formData.append('archivo', file)
      formData.append('categoria', categoria)

      if (esSiniestro) {
        formData.append('siniestro_id', siniestroId!)
        formData.append('numero_caso', numeroCaso!)
      } else {
        formData.append('poliza_id', usarRaiz ? polizaRaizId! : polizaId!)
        formData.append('numero_poliza', numPolizaEfectivo!)
      }

      const r = await apiCall('/api/storage/upload', { method: 'POST', body: formData }, { mostrar_toast_en_error: false })
      if (!r.ok) setError(`Error subiendo ${file.name}: ${r.error?.mensaje ?? 'error desconocido'}`)

      setProgreso(Math.round(((i + 1) / fileArray.length) * 100))
    }

    setSubiendo(false)
    setProgreso(0)
    cargar()
  }

  const eliminar = async (archivoId: string) => {
    if (!confirm('¿Eliminar este archivo?')) return
    setError('')
    const r = await apiCall('/api/storage/delete', {
      method: 'DELETE',
      body: { archivo_id: archivoId, tabla },
    }, { mostrar_toast_en_error: false })
    if (!r.ok) {
      setError(`Error al eliminar: ${r.error?.mensaje ?? 'error desconocido'}`)
      return
    }
    setArchivos(prev => prev.filter(a => a.id !== archivoId))
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) subirArchivos(e.dataTransfer.files)
  }

  const esGaleria = categoria === 'inspeccion' || categoria === 'fotos'
  const accept = esGaleria ? ACCEPT_IMAGENES : ACCEPT_DOCUMENTACION

  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden">
      <button
        onClick={() => setExpandido(e => !e)}
        className="w-full px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between cursor-pointer hover:bg-slate-100 transition-colors"
      >
        <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">
          {titulo} ({archivos.length})
        </h3>
        {expandido ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
      </button>

      {expandido && (<>
        {/* Drop zone compacta */}
        <div
          className={`mx-3 mt-3 mb-2 h-10 border-2 border-dashed rounded flex items-center px-3 cursor-pointer transition-colors ${
            dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300'
          }`}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input ref={inputRef} type="file" accept={accept} multiple className="hidden"
            onChange={e => { if (e.target.files) subirArchivos(e.target.files); e.target.value = '' }} />
          <Upload className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span className="text-xs text-slate-500 flex-1 text-center">
            Arrastrá archivos o <span className="text-blue-600 font-medium">hacé clic para seleccionar</span>
          </span>
          <span className="text-2xs text-slate-400 shrink-0">
            {esGaleria ? 'JPG, PNG, WebP' : 'JPG, PNG, WebP, PDF'}
          </span>
        </div>

        {/* Progress */}
        {subiendo && (
          <div className="mx-3 mb-2">
            <div className="flex items-center gap-2 text-xs text-blue-600 mb-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Subiendo... {progreso}%
            </div>
            <div className="w-full bg-slate-100 rounded-full h-1.5">
              <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${progreso}%` }} />
            </div>
          </div>
        )}

        {error && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}
          </div>
        )}

        {/* Contenido */}
        {cargando ? (
          <div className="text-center py-6 text-xs text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin mx-auto" />
          </div>
        ) : archivos.length === 0 ? (
          <div className="text-center py-4 text-xs text-slate-400 pb-4">
            Sin archivos cargados
          </div>
        ) : esGaleria ? (
          <div className="p-3 grid grid-cols-3 gap-2">
            {archivos.map(a => (
              <div key={a.id} className="group relative rounded border border-slate-200 overflow-hidden bg-slate-50">
                <img
                  src={`/api/storage/${a.ruta}`}
                  alt={a.nombre}
                  loading="lazy"
                  className="w-full aspect-square object-cover cursor-pointer"
                  onClick={() => setLightbox(`/api/storage/${a.ruta}`)}
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
                  <button onClick={() => setLightbox(`/api/storage/${a.ruta}`)}
                    className="h-7 w-7 flex items-center justify-center rounded-full bg-white/90 text-slate-700 hover:bg-white">
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <a href={`/api/storage/${a.ruta}?download=true`}
                    className="h-7 w-7 flex items-center justify-center rounded-full bg-white/90 text-slate-700 hover:bg-white">
                    <Download className="h-3.5 w-3.5" />
                  </a>
                  <button onClick={() => eliminar(a.id)}
                    className="h-7 w-7 flex items-center justify-center rounded-full bg-white/90 text-red-600 hover:bg-white">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="px-1.5 py-1 text-2xs text-slate-500 truncate">{a.nombre}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {archivos.map(a => (
              <div key={a.id} className="px-3 py-2 flex items-center gap-3">
                <div className="shrink-0">
                  {esImagen(a.mime_type) ? (
                    <Image className="h-4 w-4 text-blue-500" />
                  ) : (
                    <FileText className="h-4 w-4 text-red-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-700 font-medium truncate">{a.nombre}</p>
                  <p className="text-2xs text-slate-400">{formatBytes(a.tamano)} · {formatFechaCorta(a.created_at)}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {esImagen(a.mime_type) && (
                    <button onClick={() => setLightbox(`/api/storage/${a.ruta}`)}
                      className="btn-tabla-accion">
                      <Eye />
                    </button>
                  )}
                  <a href={`/api/storage/${a.ruta}?download=true`}
                    className="btn-tabla-accion-neutral">
                    <Download />
                  </a>
                  <button onClick={() => eliminar(a.id)}
                    className="btn-tabla-accion-danger">
                    <Trash2 />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </>)}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}>
          <button className="absolute top-4 right-4 h-8 w-8 flex items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30"
            onClick={() => setLightbox(null)}>
            <X className="h-5 w-5" />
          </button>
          <img src={lightbox} alt="Vista previa" className="max-w-full max-h-full rounded shadow-2xl"
            onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
