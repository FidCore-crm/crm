'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X, Folder, FolderOpen, ChevronRight, ChevronDown, Upload, Search, Image as ImageIcon, Loader2 } from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'

export interface ArchivoBiblioteca {
  id: string
  carpeta_id: string | null
  nombre_archivo: string
  ruta: string
  mime_type: string
  tamano_bytes: number
  created_at: string
}

interface CarpetaBiblioteca {
  id: string
  nombre: string
  parent_id: string | null
  orden: number
}

interface SelectorImagenBibliotecaProps {
  abierto: boolean
  onCerrar: () => void
  /** Callback al elegir una imagen. Se pasa el archivo completo. */
  onElegir: (archivo: ArchivoBiblioteca) => void
  /** Título del modal. Default: "Elegir imagen". */
  titulo?: string
}

const MIMES_ACEPTADOS = 'image/jpeg,image/png,image/gif,image/webp'
const TAMANO_MAX_MB = 10

/**
 * Modal reusable para elegir una imagen de la biblioteca o subir una nueva.
 *
 * 2 tabs:
 *  - "De la biblioteca": árbol de carpetas + grilla de imágenes.
 *  - "Subir nueva": input file + carpeta destino.
 *
 * Se usa en: editor de plantillas de email, wizard de campañas masivas, y
 * modal de envío manual.
 */
export default function SelectorImagenBiblioteca({
  abierto,
  onCerrar,
  onElegir,
  titulo = 'Elegir imagen',
}: SelectorImagenBibliotecaProps) {
  const [tab, setTab] = useState<'biblioteca' | 'subir'>('biblioteca')
  const [carpetas, setCarpetas] = useState<CarpetaBiblioteca[]>([])
  const [archivos, setArchivos] = useState<ArchivoBiblioteca[]>([])
  const [carpetaSeleccionada, setCarpetaSeleccionada] = useState<string | null>(null) // null = raíz
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const [busqueda, setBusqueda] = useState('')
  const [cargandoCarpetas, setCargandoCarpetas] = useState(true)
  const [cargandoArchivos, setCargandoArchivos] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [carpetaDestinoUpload, setCarpetaDestinoUpload] = useState<string | null>(null)
  const [nuevaCarpetaNombre, setNuevaCarpetaNombre] = useState('')
  const [creandoCarpeta, setCreandoCarpeta] = useState(false)
  const inputFileRef = useRef<HTMLInputElement>(null)

  // Cargar árbol de carpetas al abrir
  const cargarCarpetas = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargandoCarpetas(true)
    const r = await apiCall<{ carpetas: CarpetaBiblioteca[] }>(
      '/api/biblioteca/carpetas',
      {},
      { mostrar_toast_en_error: false }
    )
    if (r.ok && r.data) setCarpetas(r.data.carpetas)
    setCargandoCarpetas(false)
  }, [])

  // Cargar archivos de la carpeta actual
  const cargarArchivos = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargandoArchivos(true)
    const params = new URLSearchParams()
    params.set('carpeta_id', carpetaSeleccionada ?? 'raiz')
    if (busqueda.trim()) params.set('q', busqueda.trim())
    const r = await apiCall<{ archivos: ArchivoBiblioteca[] }>(
      `/api/biblioteca?${params.toString()}`,
      {},
      { mostrar_toast_en_error: false }
    )
    if (r.ok && r.data) setArchivos(r.data.archivos)
    setCargandoArchivos(false)
  }, [carpetaSeleccionada, busqueda])

  useEffect(() => {
    if (abierto) {
      cargarCarpetas()
      cargarArchivos()
      setCarpetaDestinoUpload(carpetaSeleccionada)
    }
  }, [abierto, cargarCarpetas, cargarArchivos])

  // Recargar archivos cuando cambia carpeta o búsqueda
  useEffect(() => {
    if (abierto) cargarArchivos()
  }, [carpetaSeleccionada, busqueda, abierto, cargarArchivos])

  // Construir árbol jerárquico a partir del array plano
  const carpetasPorParent = useMemo(() => {
    const map = new Map<string | null, CarpetaBiblioteca[]>()
    for (const c of carpetas) {
      const list = map.get(c.parent_id) ?? []
      list.push(c)
      map.set(c.parent_id, list)
    }
    return map
  }, [carpetas])

  const toggleExpandir = (id: string) => {
    setExpandidas(prev => {
      const nuevo = new Set(prev)
      if (nuevo.has(id)) nuevo.delete(id)
      else nuevo.add(id)
      return nuevo
    })
  }

  const subirArchivo = async (archivo: File) => {
    if (archivo.size > TAMANO_MAX_MB * 1024 * 1024) {
      toast.error(`El archivo supera ${TAMANO_MAX_MB} MB`)
      return
    }
    if (!MIMES_ACEPTADOS.split(',').includes(archivo.type)) {
      toast.error('Formato no permitido. Usá JPG, PNG, GIF o WEBP.')
      return
    }

    setSubiendo(true)
    const fd = new FormData()
    fd.append('archivo', archivo)
    if (carpetaDestinoUpload) fd.append('carpeta_id', carpetaDestinoUpload)

    const r = await apiCall<{ archivo: ArchivoBiblioteca }>(
      '/api/biblioteca/upload',
      { method: 'POST', body: fd },
      { mostrar_toast_en_error: false }
    )
    setSubiendo(false)

    if (!r.ok || !r.data) {
      toast.error(r.error?.mensaje || 'No se pudo subir el archivo')
      return
    }

    toast.exito('Imagen subida')
    // Seleccionar directamente al subir (comportamiento esperado)
    onElegir(r.data.archivo)
  }

  const crearCarpeta = async () => {
    const nombre = nuevaCarpetaNombre.trim()
    if (!nombre) return
    setCreandoCarpeta(true)
    const r = await apiCall<{ carpeta: CarpetaBiblioteca }>(
      '/api/biblioteca/carpetas',
      { method: 'POST', body: { nombre, parent_id: carpetaSeleccionada } },
      { mostrar_toast_en_error: false }
    )
    setCreandoCarpeta(false)
    if (!r.ok || !r.data) {
      toast.error(r.error?.mensaje || 'No se pudo crear la carpeta')
      return
    }
    setCarpetas(prev => [...prev, r.data!.carpeta])
    setNuevaCarpetaNombre('')
    // Expandir el padre para mostrar la nueva
    if (carpetaSeleccionada) setExpandidas(prev => new Set(prev).add(carpetaSeleccionada))
  }

  if (!abierto) return null

  // Renderer recursivo del árbol
  const renderCarpeta = (c: CarpetaBiblioteca, nivel: number): JSX.Element => {
    const hijos = carpetasPorParent.get(c.id) ?? []
    const expandida = expandidas.has(c.id)
    const seleccionada = carpetaSeleccionada === c.id
    return (
      <div key={c.id}>
        <div
          className={`flex items-center gap-1 py-1 px-2 rounded cursor-pointer text-sm hover:bg-slate-100 ${
            seleccionada ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700'
          }`}
          style={{ paddingLeft: `${8 + nivel * 16}px` }}
          onClick={() => setCarpetaSeleccionada(c.id)}
        >
          {hijos.length > 0 ? (
            <button
              onClick={e => {
                e.stopPropagation()
                toggleExpandir(c.id)
              }}
              className="p-0.5 hover:bg-slate-200 rounded"
            >
              {expandida ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="w-4" />
          )}
          {expandida ? <FolderOpen className="h-4 w-4 text-amber-500" /> : <Folder className="h-4 w-4 text-amber-500" />}
          <span className="truncate">{c.nombre}</span>
        </div>
        {expandida && hijos.map(h => renderCarpeta(h, nivel + 1))}
      </div>
    )
  }

  const carpetasRaiz = carpetasPorParent.get(null) ?? []
  const breadcrumb = construirBreadcrumb(carpetaSeleccionada, carpetas)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg w-full max-w-5xl shadow-2xl flex flex-col" style={{ height: '85vh', maxHeight: '85vh' }}>
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
          <button onClick={onCerrar} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="shrink-0 flex border-b bg-slate-50">
          <button
            onClick={() => setTab('biblioteca')}
            className={`px-5 py-3 text-sm font-medium border-b-2 ${
              tab === 'biblioteca' ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            De la biblioteca
          </button>
          <button
            onClick={() => setTab('subir')}
            className={`px-5 py-3 text-sm font-medium border-b-2 ${
              tab === 'subir' ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            Subir nueva
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden flex">
          {tab === 'biblioteca' && (
            <>
              {/* Sidebar árbol de carpetas */}
              <div className="w-64 shrink-0 border-r overflow-y-auto p-2 bg-slate-50">
                <div
                  className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer text-sm hover:bg-slate-100 ${
                    carpetaSeleccionada === null ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700'
                  }`}
                  onClick={() => setCarpetaSeleccionada(null)}
                >
                  <Folder className="h-4 w-4 text-amber-500" />
                  <span>Raíz</span>
                </div>
                {cargandoCarpetas ? (
                  <div className="flex items-center gap-2 p-3 text-xs text-slate-500">
                    <Loader2 className="h-3 w-3 animate-spin" /> Cargando...
                  </div>
                ) : (
                  carpetasRaiz.map(c => renderCarpeta(c, 0))
                )}
                {/* Crear carpeta inline */}
                <div className="mt-4 border-t pt-3">
                  <p className="text-xs text-slate-500 mb-1 px-2">Nueva carpeta en {carpetaSeleccionada ? 'esta carpeta' : 'la raíz'}</p>
                  <div className="flex gap-1 px-2">
                    <input
                      type="text"
                      value={nuevaCarpetaNombre}
                      onChange={e => setNuevaCarpetaNombre(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && crearCarpeta()}
                      placeholder="Nombre"
                      className="flex-1 px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      onClick={crearCarpeta}
                      disabled={creandoCarpeta || !nuevaCarpetaNombre.trim()}
                      className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              {/* Grilla de imágenes */}
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="shrink-0 p-3 border-b bg-white flex items-center gap-3">
                  <div className="text-xs text-slate-500 flex-1 truncate">
                    {breadcrumb}
                  </div>
                  <div className="relative w-64">
                    <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={busqueda}
                      onChange={e => setBusqueda(e.target.value)}
                      placeholder="Buscar por nombre..."
                      className="w-full pl-7 pr-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3">
                  {cargandoArchivos ? (
                    <div className="flex items-center gap-2 p-6 text-sm text-slate-500 justify-center">
                      <Loader2 className="h-4 w-4 animate-spin" /> Cargando imágenes...
                    </div>
                  ) : archivos.length === 0 ? (
                    <div className="text-center p-12">
                      <ImageIcon className="h-12 w-12 mx-auto text-slate-300 mb-2" />
                      <p className="text-sm text-slate-500">
                        {busqueda ? 'Sin resultados para tu búsqueda' : 'Esta carpeta está vacía. Subí una imagen desde la otra pestaña.'}
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-3">
                      {archivos.map(a => (
                        <button
                          key={a.id}
                          onClick={() => onElegir(a)}
                          className="group border border-slate-200 rounded-lg overflow-hidden hover:border-blue-500 hover:shadow-md transition-all bg-white text-left"
                        >
                          <div className="aspect-square bg-slate-100 overflow-hidden">
                            <img
                              src={`/api/biblioteca-publica/${a.id}/${encodeURIComponent(a.nombre_archivo)}`}
                              alt={a.nombre_archivo}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                          </div>
                          <div className="p-2">
                            <p className="text-xs font-medium text-slate-700 truncate">{a.nombre_archivo}</p>
                            <p className="text-2xs text-slate-400 mt-0.5">{formatearTamano(a.tamano_bytes)}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {tab === 'subir' && (
            <div className="flex-1 p-6 overflow-y-auto">
              <div className="max-w-xl mx-auto">
                <label className="block text-sm font-medium text-slate-700 mb-2">Guardar en carpeta</label>
                <select
                  value={carpetaDestinoUpload ?? ''}
                  onChange={e => setCarpetaDestinoUpload(e.target.value || null)}
                  className="w-full px-3 py-2 border rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Raíz (sin carpeta)</option>
                  {carpetas.map(c => (
                    <option key={c.id} value={c.id}>{construirPath(c.id, carpetas)}</option>
                  ))}
                </select>

                <div
                  className="mt-4 border-2 border-dashed border-slate-300 rounded-lg p-10 text-center hover:border-blue-500 hover:bg-blue-50/30 transition-colors cursor-pointer"
                  onClick={() => inputFileRef.current?.click()}
                  onDragOver={e => {
                    e.preventDefault()
                    e.currentTarget.classList.add('border-blue-500', 'bg-blue-50/30')
                  }}
                  onDragLeave={e => e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50/30')}
                  onDrop={e => {
                    e.preventDefault()
                    e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50/30')
                    const f = e.dataTransfer.files[0]
                    if (f) subirArchivo(f)
                  }}
                >
                  <input
                    ref={inputFileRef}
                    type="file"
                    accept={MIMES_ACEPTADOS}
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) subirArchivo(f)
                    }}
                  />
                  {subiendo ? (
                    <div className="flex flex-col items-center gap-2 text-sm text-slate-600">
                      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                      <p>Subiendo...</p>
                    </div>
                  ) : (
                    <>
                      <Upload className="h-10 w-10 mx-auto text-slate-400 mb-3" />
                      <p className="text-sm font-medium text-slate-700 mb-1">Arrastrá una imagen o hacé click</p>
                      <p className="text-xs text-slate-500">JPG, PNG, GIF, WEBP · Máx 10 MB</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3 border-t bg-slate-50 flex justify-end">
          <button onClick={onCerrar} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- helpers ----------

function formatearTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function construirPath(carpetaId: string, todas: CarpetaBiblioteca[]): string {
  const partes: string[] = []
  let actual = todas.find(c => c.id === carpetaId)
  while (actual) {
    partes.unshift(actual.nombre)
    actual = actual.parent_id ? todas.find(c => c.id === actual!.parent_id) : undefined
  }
  return partes.join(' / ')
}

function construirBreadcrumb(carpetaId: string | null, todas: CarpetaBiblioteca[]): string {
  if (!carpetaId) return 'Raíz'
  return `Raíz / ${construirPath(carpetaId, todas)}`
}
