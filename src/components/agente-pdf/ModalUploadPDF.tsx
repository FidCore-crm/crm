'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  X, Upload, FileText, Loader2, AlertCircle, Sparkles, Trash2, Info,
} from 'lucide-react'
import type { TipoOperacionPDF } from '@/lib/agente-pdf/types'
import { getSupabaseClient } from '@/lib/supabase/client'
import { apiCall } from '@/lib/api-client'
import { sanitizarBusquedaNormalizada } from '@/lib/utils'

interface PolizaOrigenInfo {
  numero_poliza: string
  asegurado_nombre: string
  compania_nombre: string
  vencimiento?: string
}

interface PersonaPreview {
  id: string
  nombre_completo: string
  dni_cuil: string
}

interface Props {
  abierto: boolean
  onCerrar: () => void
  tipo_operacion: TipoOperacionPDF
  poliza_origen_id?: string
  poliza_origen_info?: PolizaOrigenInfo
  persona_preseleccionada_id?: string
  persona_preseleccionada_info?: PersonaPreview
}

const TITULOS: Record<TipoOperacionPDF, string> = {
  POLIZA_NUEVA: 'Cargar póliza desde PDF',
  RENOVACION: 'Renovar póliza desde PDF',
  ENDOSO: 'Crear endoso desde PDF',
}

const MAX_SIZE = 20 * 1024 * 1024

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function ModalUploadPDF({
  abierto,
  onCerrar,
  tipo_operacion,
  poliza_origen_id,
  poliza_origen_info,
  persona_preseleccionada_id,
  persona_preseleccionada_info,
}: Props) {
  const router = useRouter()
  const supabase = getSupabaseClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [archivo, setArchivo] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')
  const [subiendo, setSubiendo] = useState(false)

  // Selector de cliente (solo POLIZA_NUEVA sin preseleccion)
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [resultadosCliente, setResultadosCliente] = useState<PersonaPreview[]>([])
  const [clienteSeleccionado, setClienteSeleccionado] = useState<PersonaPreview | null>(
    persona_preseleccionada_info || null
  )
  const [detectarDesdeDPF, setDetectarDesdePDF] = useState(false)

  useEffect(() => {
    if (!abierto) {
      setArchivo(null)
      setError('')
      setBusquedaCliente('')
      setResultadosCliente([])
      setClienteSeleccionado(persona_preseleccionada_info || null)
      setDetectarDesdePDF(false)
    }
  }, [abierto, persona_preseleccionada_info])

  // Si viene id sin info, cargarla
  useEffect(() => {
    if (!abierto) return
    if (!persona_preseleccionada_id) return
    if (persona_preseleccionada_info) return
    if (clienteSeleccionado?.id === persona_preseleccionada_id) return
    (async () => {
      const { data } = await supabase
        .from('personas')
        .select('id, apellido, nombre, razon_social, dni_cuil')
        .eq('id', persona_preseleccionada_id)
        .maybeSingle()
      if (data) {
        setClienteSeleccionado({
          id: (data as any).id,
          dni_cuil: (data as any).dni_cuil || '',
          nombre_completo:
            (data as any).razon_social ||
            [(data as any).apellido, (data as any).nombre].filter(Boolean).join(', '),
        })
      }
    })()
  }, [abierto, persona_preseleccionada_id, persona_preseleccionada_info, clienteSeleccionado, supabase])

  // Búsqueda debounced de clientes
  useEffect(() => {
    if (tipo_operacion !== 'POLIZA_NUEVA') return
    if (persona_preseleccionada_id) return
    if (clienteSeleccionado) return
    if (detectarDesdeDPF) return
    const q = busquedaCliente.trim()
    if (q.length < 2) {
      setResultadosCliente([])
      return
    }
    const t = setTimeout(async () => {
      const qNorm = sanitizarBusquedaNormalizada(q)
      const { data } = await supabase
        .from('personas')
        .select('id, apellido, nombre, razon_social, dni_cuil')
        .or(`apellido_norm.ilike.%${qNorm}%,nombre_norm.ilike.%${qNorm}%,razon_social_norm.ilike.%${qNorm}%,dni_cuil.ilike.%${qNorm}%`)
        .limit(8)
      setResultadosCliente(
        (data || []).map((p: any) => ({
          id: p.id,
          dni_cuil: p.dni_cuil || '',
          nombre_completo: p.razon_social || [p.apellido, p.nombre].filter(Boolean).join(', '),
        }))
      )
    }, 350)
    return () => clearTimeout(t)
  }, [busquedaCliente, tipo_operacion, persona_preseleccionada_id, clienteSeleccionado, detectarDesdeDPF, supabase])

  if (!abierto) return null

  function seleccionarArchivo(f: File | null) {
    setError('')
    if (!f) { setArchivo(null); return }
    if (!/pdf/i.test(f.type) && !f.name.toLowerCase().endsWith('.pdf')) {
      setError('Solo se aceptan archivos PDF')
      return
    }
    if (f.size > MAX_SIZE) {
      setError('El archivo supera el límite de 20 MB')
      return
    }
    setArchivo(f)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) seleccionarArchivo(e.dataTransfer.files[0])
  }

  async function procesar() {
    if (!archivo) { setError('Tenés que seleccionar un PDF'); return }

    setSubiendo(true); setError('')
    const fd = new FormData()
    fd.append('archivo', archivo)
    fd.append('tipo_operacion', tipo_operacion)
    if (poliza_origen_id) fd.append('poliza_origen_id', poliza_origen_id)
    if (clienteSeleccionado?.id && !detectarDesdeDPF) {
      fd.append('persona_id', clienteSeleccionado.id)
    }

    const r = await apiCall<{ procesamiento_id: string }>('/api/agente-pdf/iniciar', { method: 'POST', body: fd }, { mostrar_toast_en_error: false })
    if (r.ok && r.data?.procesamiento_id) {
      onCerrar()
      router.push(`/crm/agente-pdf/${r.data.procesamiento_id}/procesando`)
    } else {
      setError(r.error?.mensaje || 'No se pudo iniciar el procesamiento')
      setSubiendo(false)
    }
  }

  const mostrarSelectorCliente =
    tipo_operacion === 'POLIZA_NUEVA' && !persona_preseleccionada_id
  const mostrarContextoPoliza =
    (tipo_operacion === 'RENOVACION' || tipo_operacion === 'ENDOSO') && poliza_origen_info
  const mostrarClientePreseleccionado =
    tipo_operacion === 'POLIZA_NUEVA' && !!persona_preseleccionada_id && !!clienteSeleccionado

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={() => !subiendo && onCerrar()}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-800">{TITULOS[tipo_operacion]}</h2>
          </div>
          <button
            onClick={() => !subiendo && onCerrar()}
            disabled={subiendo}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Contexto de la póliza origen */}
          {mostrarContextoPoliza && (
            <div className="border border-slate-200 bg-slate-50 rounded p-3">
              <p className="text-2xs text-slate-600 uppercase font-semibold mb-2">
                Póliza que vas a {tipo_operacion === 'RENOVACION' ? 'renovar' : 'modificar'}
              </p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div>
                  <span className="text-slate-600">Número: </span>
                  <span className="font-mono text-slate-800">{poliza_origen_info!.numero_poliza}</span>
                </div>
                <div>
                  <span className="text-slate-600">Asegurado: </span>
                  <span className="text-slate-800">{poliza_origen_info!.asegurado_nombre}</span>
                </div>
                <div>
                  <span className="text-slate-600">Compañía: </span>
                  <span className="text-slate-800">{poliza_origen_info!.compania_nombre}</span>
                </div>
                {poliza_origen_info!.vencimiento && (
                  <div>
                    <span className="text-slate-600">Vencimiento: </span>
                    <span className="text-slate-800">{poliza_origen_info!.vencimiento}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Cliente preseleccionado */}
          {mostrarClientePreseleccionado && clienteSeleccionado && (
            <div className="border border-slate-200 bg-slate-50 rounded p-3">
              <p className="text-2xs text-slate-600 uppercase font-semibold mb-1">Cliente</p>
              <p className="text-xs text-slate-800">
                {clienteSeleccionado.nombre_completo}
                {clienteSeleccionado.dni_cuil && (
                  <span className="text-slate-600"> (DNI {clienteSeleccionado.dni_cuil})</span>
                )}
              </p>
            </div>
          )}

          {/* Selector de cliente */}
          {mostrarSelectorCliente && (
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-slate-700">
                ¿Para qué cliente es la póliza?
              </label>
              <div className="relative">
                <input
                  type="text"
                  className="form-input w-full text-xs"
                  placeholder="Buscar cliente por nombre o DNI..."
                  value={busquedaCliente}
                  onChange={e => {
                    setBusquedaCliente(e.target.value)
                    setClienteSeleccionado(null)
                  }}
                  disabled={detectarDesdeDPF}
                />
                {resultadosCliente.length > 0 && !clienteSeleccionado && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-b shadow-lg z-10 max-h-56 overflow-y-auto">
                    {resultadosCliente.map(r => (
                      <button
                        key={r.id}
                        onClick={() => {
                          setClienteSeleccionado(r)
                          setBusquedaCliente(r.nombre_completo)
                          setResultadosCliente([])
                        }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 border-b border-slate-100 last:border-0"
                      >
                        <div className="font-medium text-slate-800">{r.nombre_completo}</div>
                        {r.dni_cuil && <div className="text-2xs text-slate-600">DNI {r.dni_cuil}</div>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {clienteSeleccionado && !detectarDesdeDPF && (
                <div className="flex items-center justify-between text-xs bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5">
                  <span className="text-emerald-800">
                    ✓ Seleccionado: <span className="font-medium">{clienteSeleccionado.nombre_completo}</span>
                  </span>
                  <button
                    onClick={() => { setClienteSeleccionado(null); setBusquedaCliente('') }}
                    className="text-emerald-700 hover:text-emerald-900"
                  >
                    cambiar
                  </button>
                </div>
              )}
              <label className="flex items-center gap-2 text-2xs text-slate-600 cursor-pointer mt-1">
                <input
                  type="checkbox"
                  checked={detectarDesdeDPF}
                  onChange={e => {
                    setDetectarDesdePDF(e.target.checked)
                    if (e.target.checked) {
                      setClienteSeleccionado(null)
                      setBusquedaCliente('')
                    }
                  }}
                />
                El sistema detectará el cliente desde el PDF
              </label>
            </div>
          )}

          {/* Drag-drop */}
          {!archivo ? (
            <div
              className={`border-2 border-dashed rounded-lg py-10 px-4 flex flex-col items-center gap-2 cursor-pointer transition-colors ${
                dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-300 hover:border-blue-300'
              }`}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={e => seleccionarArchivo(e.target.files?.[0] || null)}
              />
              <Upload className="h-8 w-8 text-slate-500" />
              <p className="text-xs text-slate-600">
                Arrastrá el PDF acá o <span className="text-blue-600 font-medium">hacé click para seleccionar</span>
              </p>
              <p className="text-2xs text-slate-500">Solo PDF nativo (no escaneado) · máximo 20 MB</p>
            </div>
          ) : (
            <div className="border border-emerald-200 bg-emerald-50 rounded p-3 flex items-center gap-3">
              <div className="h-10 w-10 rounded bg-white border border-emerald-200 flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5 text-red-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-800 truncate">{archivo.name}</p>
                <p className="text-2xs text-slate-600">{formatBytes(archivo.size)}</p>
              </div>
              <button
                onClick={() => setArchivo(null)}
                className="h-7 w-7 flex items-center justify-center rounded hover:bg-white text-slate-600 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-start gap-2 text-2xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-2">
            <Info className="h-3 w-3 shrink-0 mt-0.5" />
            <span>El análisis tarda entre 30 segundos y 1 minuto. Podés dejar esta pantalla abierta o cerrarla — te avisamos cuando esté listo.</span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50">
          <button
            onClick={onCerrar}
            disabled={subiendo}
            className="btn-secondary"
          >
            Cancelar
          </button>
          <button
            onClick={procesar}
            disabled={subiendo || !archivo}
            className="btn-primary"
          >
            {subiendo ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Subiendo...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" /> Procesar con IA
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
