'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Folder, FolderOpen, ChevronRight, ChevronDown, Plus, Upload,
  Trash2, Edit2, Loader2, Image as ImageIcon, Search, MoreVertical, Move,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'

interface Carpeta {
  id: string
  nombre: string
  parent_id: string | null
  orden: number
}

interface Archivo {
  id: string
  carpeta_id: string | null
  nombre_archivo: string
  ruta: string
  mime_type: string
  tamano_bytes: number
  usos_count: number
  created_at: string
}

export default function BibliotecaAdminPage() {
  const router = useRouter()
  const { usuario, loading: loadingAuth } = useAuth()

  const [carpetas, setCarpetas] = useState<Carpeta[]>([])
  const [archivos, setArchivos] = useState<Archivo[]>([])
  const [carpetaActual, setCarpetaActual] = useState<string | null>(null)
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const [busqueda, setBusqueda] = useState('')
  const [cargando, setCargando] = useState(true)
  const [subiendo, setSubiendo] = useState(false)
  const [nuevaCarpeta, setNuevaCarpeta] = useState('')
  const [creandoCarpeta, setCreandoCarpeta] = useState(false)
  const [menuAbiertoId, setMenuAbiertoId] = useState<string | null>(null)
  const [modalMoverId, setModalMoverId] = useState<string | null>(null)
  const inputFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!loadingAuth && usuario?.rol !== 'ADMIN') router.push('/crm/configuracion')
  }, [loadingAuth, usuario, router])

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true)
    const [rc, ra] = await Promise.all([
      apiCall<{ carpetas: Carpeta[] }>('/api/biblioteca/carpetas', {}, { mostrar_toast_en_error: false }),
      apiCall<{ archivos: Archivo[] }>(
        `/api/biblioteca?carpeta_id=${carpetaActual ?? 'raiz'}${busqueda.trim() ? `&q=${encodeURIComponent(busqueda.trim())}` : ''}`,
        {},
        { mostrar_toast_en_error: false }
      ),
    ])
    if (rc.ok && rc.data) setCarpetas(rc.data.carpetas)
    if (ra.ok && ra.data) setArchivos(ra.data.archivos)
    setCargando(false)
  }, [carpetaActual, busqueda])

  useEffect(() => { if (usuario?.rol === 'ADMIN') cargar() }, [cargar, usuario])

  const carpetasPorParent = useMemo(() => {
    const m = new Map<string | null, Carpeta[]>()
    for (const c of carpetas) {
      const l = m.get(c.parent_id) ?? []
      l.push(c)
      m.set(c.parent_id, l)
    }
    return m
  }, [carpetas])

  const toggleExpandir = (id: string) => {
    setExpandidas(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const subir = async (archivo: File) => {
    if (archivo.size > 10 * 1024 * 1024) { toast.error('Máx 10 MB'); return }
    setSubiendo(true)
    const fd = new FormData()
    fd.append('archivo', archivo)
    if (carpetaActual) fd.append('carpeta_id', carpetaActual)
    const r = await apiCall('/api/biblioteca/upload', { method: 'POST', body: fd }, { mostrar_toast_en_error: false })
    setSubiendo(false)
    if (!r.ok) { toast.error(r.error?.mensaje || 'No se pudo subir'); return }
    toast.exito('Imagen subida')
    cargar(true)
  }

  const crearCarpeta = async () => {
    const n = nuevaCarpeta.trim()
    if (!n) return
    setCreandoCarpeta(true)
    const r = await apiCall<{ carpeta: Carpeta }>(
      '/api/biblioteca/carpetas',
      { method: 'POST', body: { nombre: n, parent_id: carpetaActual } },
      { mostrar_toast_en_error: false }
    )
    setCreandoCarpeta(false)
    if (!r.ok) { toast.error(r.error?.mensaje || 'Error'); return }
    setNuevaCarpeta('')
    if (carpetaActual) setExpandidas(prev => new Set(prev).add(carpetaActual))
    cargar(true)
  }

  const eliminarArchivo = async (a: Archivo) => {
    if (!confirm(`¿Eliminar "${a.nombre_archivo}"?`)) return
    const r = await apiCall(`/api/biblioteca/${a.id}`, { method: 'DELETE' })
    if (r.ok) { toast.exito('Eliminada'); cargar(true) }
  }

  const renombrarArchivo = async (a: Archivo) => {
    const nuevo = prompt('Nuevo nombre:', a.nombre_archivo)
    if (!nuevo || nuevo === a.nombre_archivo) return
    const r = await apiCall(`/api/biblioteca/${a.id}`, { method: 'PATCH', body: { nombre_archivo: nuevo } })
    if (r.ok) { toast.exito('Renombrada'); cargar(true) }
  }

  const moverArchivo = async (archivoId: string, nuevaCarpetaId: string | null) => {
    const r = await apiCall(`/api/biblioteca/${archivoId}`, { method: 'PATCH', body: { carpeta_id: nuevaCarpetaId } })
    if (r.ok) { toast.exito('Movida'); setModalMoverId(null); cargar(true) }
  }

  const eliminarCarpeta = async (c: Carpeta) => {
    if (!confirm(`¿Eliminar la carpeta "${c.nombre}"?`)) return
    let r = await apiCall<any>(`/api/biblioteca/carpetas/${c.id}`, { method: 'DELETE' }, { mostrar_toast_en_error: false })
    // Si tiene archivos dentro, preguntar si forzar
    if (!r.ok && r.error?.codigo === undefined && (r.data as any)?.error === 'CARPETA_CON_ARCHIVOS') {
      // apiCall del CRM devuelve error en r.error, pero endpoint devuelve el error dentro del body. Chequeamos ambos.
    }
    if (!r.ok) {
      const cant = (r.error as any)?.cantidad || (r as any).data?.cantidad
      const forzar = confirm(`La carpeta contiene archivos. ¿Eliminar la carpeta Y todas sus imágenes?`)
      if (!forzar) return
      r = await apiCall(`/api/biblioteca/carpetas/${c.id}?forzar=1`, { method: 'DELETE' })
    }
    if (r.ok) {
      toast.exito('Carpeta eliminada')
      if (carpetaActual === c.id) setCarpetaActual(c.parent_id)
      cargar(true)
    }
  }

  const renderCarpeta = (c: Carpeta, nivel: number): JSX.Element => {
    const hijos = carpetasPorParent.get(c.id) ?? []
    const expandida = expandidas.has(c.id)
    const sel = carpetaActual === c.id
    return (
      <div key={c.id}>
        <div
          className={`group flex items-center gap-1 py-1 px-2 rounded cursor-pointer text-sm hover:bg-slate-100 ${sel ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700'}`}
          style={{ paddingLeft: `${8 + nivel * 16}px` }}
          onClick={() => setCarpetaActual(c.id)}
        >
          {hijos.length > 0 ? (
            <button onClick={e => { e.stopPropagation(); toggleExpandir(c.id) }} className="p-0.5 hover:bg-slate-200 rounded">
              {expandida ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : <span className="w-4" />}
          {expandida ? <FolderOpen className="h-4 w-4 text-amber-500" /> : <Folder className="h-4 w-4 text-amber-500" />}
          <span className="truncate flex-1">{c.nombre}</span>
          <button
            onClick={e => { e.stopPropagation(); eliminarCarpeta(c) }}
            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-600 p-0.5"
            title="Eliminar carpeta"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        {expandida && hijos.map(h => renderCarpeta(h, nivel + 1))}
      </div>
    )
  }

  const carpetasRaiz = carpetasPorParent.get(null) ?? []
  const breadcrumb = carpetaActual ? `Raíz / ${construirPath(carpetaActual, carpetas)}` : 'Raíz'
  const archivoMoviendo = modalMoverId ? archivos.find(a => a.id === modalMoverId) : null

  if (loadingAuth) return null

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-6">
        <Link href="/crm/configuracion" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-4">
          <ArrowLeft className="h-4 w-4" /> Volver a Configuración
        </Link>

        <div className="mb-6">
          <h1 className="text-xl font-semibold text-slate-900">Biblioteca de recursos</h1>
          <p className="text-sm text-slate-600 mt-1">
            Imágenes (flyers, banners, logos) que podés reutilizar en emails. Compartida entre todos los usuarios.
          </p>
        </div>

        <div className="bg-white rounded-lg border shadow-sm flex" style={{ height: 'calc(100vh - 220px)', minHeight: 500 }}>
          {/* Sidebar de carpetas */}
          <div className="w-72 shrink-0 border-r flex flex-col">
            <div className="p-3 border-b bg-slate-50">
              <h3 className="text-xs uppercase tracking-wide text-slate-600 font-semibold">Carpetas</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              <div
                className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer text-sm hover:bg-slate-100 ${carpetaActual === null ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700'}`}
                onClick={() => setCarpetaActual(null)}
              >
                <Folder className="h-4 w-4 text-amber-500" />
                <span>Raíz</span>
              </div>
              {carpetasRaiz.map(c => renderCarpeta(c, 0))}
            </div>
            <div className="p-3 border-t bg-slate-50">
              <p className="text-2xs text-slate-600 mb-1">Nueva carpeta en {carpetaActual ? 'esta carpeta' : 'la raíz'}</p>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={nuevaCarpeta}
                  onChange={e => setNuevaCarpeta(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && crearCarpeta()}
                  placeholder="Nombre"
                  className="flex-1 px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={crearCarpeta}
                  disabled={creandoCarpeta || !nuevaCarpeta.trim()}
                  className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Contenido */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 border-b flex items-center gap-3">
              <div className="text-sm text-slate-600 flex-1 truncate">{breadcrumb}</div>
              <div className="relative w-64">
                <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                  placeholder="Buscar imagen..."
                  className="w-full pl-7 pr-2 py-1.5 border rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={() => inputFileRef.current?.click()}
                disabled={subiendo}
                className="btn-primary flex items-center gap-2"
              >
                {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                <span>Subir imagen</span>
              </button>
              <input
                ref={inputFileRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) { subir(f); e.target.value = '' } }}
              />
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {cargando ? (
                <div className="flex items-center gap-2 p-6 text-sm text-slate-600 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
                </div>
              ) : archivos.length === 0 ? (
                <div className="text-center p-12">
                  <ImageIcon className="h-12 w-12 mx-auto text-slate-300 mb-2" />
                  <p className="text-sm text-slate-600">
                    {busqueda ? 'Sin resultados' : 'Esta carpeta está vacía. Subí la primera imagen con el botón de arriba.'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-4">
                  {archivos.map(a => (
                    <div key={a.id} className="group border border-slate-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow bg-white relative">
                      <div className="aspect-square bg-slate-100 overflow-hidden">
                        <img
                          src={`/api/biblioteca-publica/${a.id}/${encodeURIComponent(a.nombre_archivo)}`}
                          alt={a.nombre_archivo}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="p-2">
                        <p className="text-xs font-medium text-slate-700 truncate">{a.nombre_archivo}</p>
                        <p className="text-2xs text-slate-500 mt-0.5">
                          {formatearTamano(a.tamano_bytes)}
                          {a.usos_count > 0 && ` · ${a.usos_count} usos`}
                        </p>
                      </div>
                      <div className="absolute top-1 right-1">
                        <button
                          onClick={() => setMenuAbiertoId(menuAbiertoId === a.id ? null : a.id)}
                          className="p-1 bg-white/90 backdrop-blur rounded shadow opacity-0 group-hover:opacity-100 hover:bg-white"
                        >
                          <MoreVertical className="h-3.5 w-3.5 text-slate-600" />
                        </button>
                        {menuAbiertoId === a.id && (
                          <div className="absolute right-0 top-full mt-1 bg-white border rounded shadow-lg py-1 min-w-[140px] z-10">
                            <button onClick={() => { renombrarArchivo(a); setMenuAbiertoId(null) }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 flex items-center gap-2">
                              <Edit2 className="h-3 w-3" /> Renombrar
                            </button>
                            <button onClick={() => { setModalMoverId(a.id); setMenuAbiertoId(null) }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 flex items-center gap-2">
                              <Move className="h-3 w-3" /> Mover
                            </button>
                            <button onClick={() => { eliminarArchivo(a); setMenuAbiertoId(null) }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100 text-red-600 flex items-center gap-2">
                              <Trash2 className="h-3 w-3" /> Eliminar
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal mover */}
        {archivoMoviendo && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h3 className="font-semibold mb-4">Mover "{archivoMoviendo.nombre_archivo}"</h3>
              <p className="text-sm text-slate-600 mb-3">Elegí la carpeta destino:</p>
              <div className="max-h-64 overflow-y-auto border rounded p-2 mb-4">
                <button onClick={() => moverArchivo(archivoMoviendo.id, null)} className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-100 text-sm flex items-center gap-2">
                  <Folder className="h-4 w-4 text-amber-500" /> Raíz
                </button>
                {carpetas.map(c => (
                  <button key={c.id} onClick={() => moverArchivo(archivoMoviendo.id, c.id)} className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-100 text-sm flex items-center gap-2">
                    <Folder className="h-4 w-4 text-amber-500" /> {construirPath(c.id, carpetas)}
                  </button>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setModalMoverId(null)} className="btn-secondary">Cancelar</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function formatearTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function construirPath(carpetaId: string, todas: Carpeta[]): string {
  const partes: string[] = []
  let actual = todas.find(c => c.id === carpetaId)
  while (actual) {
    partes.unshift(actual.nombre)
    actual = actual.parent_id ? todas.find(c => c.id === actual!.parent_id) : undefined
  }
  return partes.join(' / ')
}
