'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { X, FileText, Image as ImageIcon, Eye, Download, Loader2, FolderOpen, ExternalLink } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'

interface Archivo {
  id: string
  nombre: string
  ruta: string
  categoria: string
  mime_type: string | null
  tamano: number | null
  created_at: string
  poliza_id: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
  polizaId: string
  numeroPoliza: string
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

export default function ModalArchivosPoliza({ isOpen, onClose, polizaId, numeroPoliza }: Props) {
  const router = useRouter()
  const supabase = getSupabaseClient()
  const [cargando, setCargando] = useState(true)
  const [documentacion, setDocumentacion] = useState<Archivo[]>([])
  const [inspeccion, setInspeccion] = useState<Archivo[]>([])
  const [lightbox, setLightbox] = useState<string | null>(null)

  // Cerrar modal y lightbox con Escape
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (lightbox) setLightbox(null)
      else onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, lightbox, onClose])

  useEffect(() => {
    if (!isOpen || !polizaId) return
    let cancelado = false

    async function cargar() {
      setCargando(true)

      // Resolver póliza raíz subiendo por poliza_origen_id (la inspección vive en la raíz)
      let raizId = polizaId
      let actual: any = { id: polizaId }
      const visitados = new Set<string>()
      while (actual?.id && !visitados.has(actual.id)) {
        visitados.add(actual.id)
        const { data } = await supabase.from('polizas').select('id, poliza_origen_id').eq('id', actual.id).single()
        if (!data?.poliza_origen_id) { raizId = actual.id; break }
        actual = { id: data.poliza_origen_id }
        raizId = actual.id
      }

      const [docs, insp] = await Promise.all([
        supabase.from('poliza_archivos')
          .select('*').eq('poliza_id', polizaId)
          .in('categoria', ['documentacion', 'documentacion_renovada'])
          .order('created_at', { ascending: false }),
        supabase.from('poliza_archivos')
          .select('*').eq('poliza_id', raizId).eq('categoria', 'inspeccion')
          .order('created_at', { ascending: false }),
      ])

      if (cancelado) return
      setDocumentacion((docs.data ?? []) as Archivo[])
      setInspeccion((insp.data ?? []) as Archivo[])
      setCargando(false)
    }

    cargar()
    return () => { cancelado = true }
  }, [isOpen, polizaId, supabase])

  if (!isOpen) return null

  const irAFicha = () => {
    onClose()
    router.push(`/crm/polizas/${polizaId}`)
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-blue-600" />
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Archivos de la póliza</h2>
                <p className="text-2xs font-mono text-slate-600">N° {numeroPoliza}</p>
              </div>
            </div>
            <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {cargando ? (
              <div className="py-12 text-center text-xs text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin mx-auto" />
              </div>
            ) : (documentacion.length === 0 && inspeccion.length === 0) ? (
              <div className="py-12 text-center text-xs text-slate-500">
                <FolderOpen className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                Esta póliza no tiene archivos cargados.
              </div>
            ) : (
              <div className="p-3 space-y-4">
                {documentacion.length > 0 && (
                  <Seccion titulo="Documentación" archivos={documentacion} onVerImagen={setLightbox} />
                )}
                {inspeccion.length > 0 && (
                  <SeccionInspeccion archivos={inspeccion} onVerImagen={setLightbox} />
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between">
            <span className="text-2xs text-slate-600">
              {documentacion.length + inspeccion.length} archivo{documentacion.length + inspeccion.length !== 1 ? 's' : ''}
            </span>
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-secondary">Cerrar</button>
              <button onClick={irAFicha} className="btn-primary">
                <ExternalLink className="h-3.5 w-3.5" /> Abrir ficha
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <button onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 h-8 w-8 flex items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30">
            <X className="h-5 w-5" />
          </button>
          <img src={lightbox} alt="Vista previa" className="max-w-full max-h-full rounded shadow-2xl" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}

function Seccion({ titulo, archivos, onVerImagen }: { titulo: string; archivos: Archivo[]; onVerImagen: (url: string) => void }) {
  return (
    <div>
      <h3 className="text-2xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
        {titulo} ({archivos.length})
      </h3>
      <div className="border border-slate-200 rounded divide-y divide-slate-100">
        {archivos.map(a => (
          <div key={a.id} className="px-3 py-2 flex items-center gap-3">
            <div className="shrink-0">
              {esImagen(a.mime_type) ? <ImageIcon className="h-4 w-4 text-blue-500" /> : <FileText className="h-4 w-4 text-red-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-700 font-medium truncate">{a.nombre}</p>
              <p className="text-2xs text-slate-500">
                {formatBytes(a.tamano)} · {formatFechaCorta(a.created_at)}
                {a.categoria === 'documentacion_renovada' && <span className="ml-2 text-amber-600">· Renovación</span>}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {esImagen(a.mime_type) && (
                <button onClick={() => onVerImagen(`/api/storage/${a.ruta}`)} className="btn-tabla-accion" title="Ver">
                  <Eye />
                </button>
              )}
              <a href={`/api/storage/${a.ruta}?download=true`} className="btn-tabla-accion-neutral" title="Descargar">
                <Download />
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SeccionInspeccion({ archivos, onVerImagen }: { archivos: Archivo[]; onVerImagen: (url: string) => void }) {
  return (
    <div>
      <h3 className="text-2xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
        Inspección ({archivos.length})
      </h3>
      <div className="grid grid-cols-4 gap-2">
        {archivos.map(a => (
          <div key={a.id} className="group relative rounded border border-slate-200 overflow-hidden bg-slate-50">
            <img
              src={`/api/storage/${a.ruta}`}
              alt={a.nombre}
              loading="lazy"
              className="w-full aspect-square object-cover cursor-pointer"
              onClick={() => onVerImagen(`/api/storage/${a.ruta}`)}
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
              <button onClick={() => onVerImagen(`/api/storage/${a.ruta}`)}
                className="h-7 w-7 flex items-center justify-center rounded-full bg-white/90 text-slate-700 hover:bg-white">
                <Eye className="h-3.5 w-3.5" />
              </button>
              <a href={`/api/storage/${a.ruta}?download=true`}
                className="h-7 w-7 flex items-center justify-center rounded-full bg-white/90 text-slate-700 hover:bg-white">
                <Download className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
