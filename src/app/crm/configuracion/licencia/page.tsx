'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Shield, Upload, Calendar, Clock, AlertTriangle, CheckCircle2, Copy, Trash2, ChevronRight, FileText, XCircle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useLicenciaEstado, emitirBroadcastLicencia } from '@/contexts/LicenciaContext'
import { toast } from '@/lib/toast'
import { apiCall } from '@/lib/api-client'
import { copiarAlPortapapeles } from '@/lib/copiar-portapapeles'
import { ConfirmacionTipeada } from '@/components/ConfirmacionTipeada'

interface LicenciaHistorial {
  id: string
  cliente: string
  razon_social: string | null
  plan: 'MENSUAL' | 'SEMESTRAL' | 'ANUAL' | 'PERMANENTE'
  fecha_inicio: string
  fecha_vencimiento: string
  fecha_emision: string
  notas: string | null
  estado: 'ACTIVA' | 'ENCOLADA' | 'EXPIRADA' | 'REEMPLAZADA'
  fecha_carga: string
}

// Datos mínimos para el modal de confirmación (sirve tanto para una fila del
// histórico como para una licencia encolada — solo necesita los campos para
// armar el mensaje y el id para llamar al endpoint).
interface LicenciaAEliminar {
  id: string
  plan: 'MENSUAL' | 'SEMESTRAL' | 'ANUAL' | 'PERMANENTE'
  cliente: string
  fecha_vencimiento: string
}

const PLAN_LABEL: Record<string, string> = {
  MENSUAL: 'Mensual',
  SEMESTRAL: 'Semestral',
  ANUAL: 'Anual',
  PERMANENTE: 'Permanente',
}

const ESTADO_BADGE: Record<string, { bg: string; texto: string; label: string }> = {
  ACTIVA: { bg: 'bg-emerald-50 border-emerald-200', texto: 'text-emerald-700', label: 'Activa' },
  ENCOLADA: { bg: 'bg-blue-50 border-blue-200', texto: 'text-blue-700', label: 'Encolada' },
  EXPIRADA: { bg: 'bg-slate-50 border-slate-200', texto: 'text-slate-500', label: 'Expirada' },
  REEMPLAZADA: { bg: 'bg-slate-50 border-slate-200', texto: 'text-slate-500', label: 'Reemplazada' },
}

function formatearFecha(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export default function LicenciaPage() {
  const router = useRouter()
  const { isAdmin, loading: loadingAuth } = useAuth()
  const { estado, loading: loadingEstado, refetch } = useLicenciaEstado()

  const [historial, setHistorial] = useState<LicenciaHistorial[]>([])
  const [loadingHistorial, setLoadingHistorial] = useState(true)
  const [subiendo, setSubiendo] = useState(false)
  const [licenciaAEliminar, setLicenciaAEliminar] = useState<LicenciaAEliminar | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const cargarHistorial = useCallback(async () => {
    setLoadingHistorial(true)
    const res = await apiCall<{ licencias: LicenciaHistorial[] }>('/api/licencia/historial', {}, {
      mostrar_toast_en_error: false,
    })
    if (res.ok && res.data) {
      setHistorial(res.data.licencias)
    }
    setLoadingHistorial(false)
  }, [])

  useEffect(() => {
    if (!loadingAuth && !isAdmin) {
      router.push('/crm/configuracion')
      return
    }
    cargarHistorial()
  }, [loadingAuth, isAdmin, router, cargarHistorial])

  const handleArchivo = async (file: File) => {
    setSubiendo(true)
    const formData = new FormData()
    formData.append('archivo', file)

    const res = await apiCall<{ id: string; estado: string; mensaje: string }>(
      '/api/licencia/cargar',
      { method: 'POST', body: formData },
      { mostrar_toast_en_error: false },
    )

    if (res.ok && res.data) {
      toast.exito(res.data.mensaje)
      await refetch()
      await cargarHistorial()
      emitirBroadcastLicencia()
    } else {
      const msg = res.error?.detalle ?? res.error?.mensaje ?? 'No se pudo cargar la licencia'
      toast.error(msg)
    }
    setSubiendo(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleArchivo(f)
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) handleArchivo(f)
  }

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault()

  const eliminar = (lic: LicenciaAEliminar) => {
    setLicenciaAEliminar(lic)
  }

  const confirmarEliminarLicencia = async () => {
    if (!licenciaAEliminar) return
    const res = await apiCall(`/api/licencia/${licenciaAEliminar.id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.exito('Licencia eliminada')
      await cargarHistorial()
      await refetch()
      emitirBroadcastLicencia()
      setLicenciaAEliminar(null)
    }
  }

  const copiarInstalacionId = async () => {
    if (!estado?.instalacion_id) return
    const ok = await copiarAlPortapapeles(estado.instalacion_id)
    if (ok) toast.exito('ID copiado al portapapeles')
  }

  if (loadingAuth || loadingEstado || !estado) {
    return <div className="text-sm text-slate-500">Cargando...</div>
  }

  const activa = estado.licencia_activa
  const modo = estado.modo

  // Estilo del card principal según modo
  const cardModoEstilo =
    modo === 'ACTIVA'
      ? 'border-emerald-200 bg-emerald-50/40'
      : modo === 'GRACIA'
      ? 'border-amber-300 bg-amber-50'
      : 'border-red-300 bg-red-50'

  const IconoModo =
    modo === 'ACTIVA' ? CheckCircle2 : modo === 'GRACIA' ? AlertTriangle : XCircle

  const colorIconoModo =
    modo === 'ACTIVA' ? 'text-emerald-600' : modo === 'GRACIA' ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-slate-500">
        <button onClick={() => router.push('/crm/configuracion')} className="hover:text-blue-600">
          Configuración
        </button>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-700 font-medium">Licencia</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-slate-700" />
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Licencia</h1>
          <p className="text-xs text-slate-500">Estado de tu suscripción a Pulzar</p>
        </div>
      </div>

      {/* Card de estado actual */}
      <div className={`border rounded-lg p-5 ${cardModoEstilo}`}>
        <div className="flex items-start gap-3">
          <IconoModo className={`h-6 w-6 ${colorIconoModo} shrink-0 mt-0.5`} />
          <div className="flex-1">
            {modo === 'ACTIVA' && activa && (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-base font-semibold text-emerald-800">Licencia activa</h2>
                  <span className="text-xs font-medium px-2 py-0.5 rounded bg-white border border-emerald-200 text-emerald-700">
                    Plan {PLAN_LABEL[activa.plan]}
                  </span>
                </div>
                {activa.es_permanente ? (
                  <p className="text-sm text-emerald-700">Plan permanente — sin vencimiento.</p>
                ) : (
                  <p className="text-sm text-emerald-700">
                    Vence el {formatearFecha(activa.fecha_vencimiento)} —{' '}
                    <span className="font-medium">
                      {activa.dias_restantes === 0
                        ? 'vence hoy'
                        : `${activa.dias_restantes} día${activa.dias_restantes === 1 ? '' : 's'} restantes`}
                    </span>
                  </p>
                )}
              </>
            )}

            {modo === 'GRACIA' && activa && (
              <>
                <h2 className="text-base font-semibold text-amber-800 mb-1">
                  Licencia vencida
                </h2>
                <p className="text-sm text-amber-700">
                  Tu licencia venció el {formatearFecha(activa.fecha_vencimiento)}. Te quedan{' '}
                  <span className="font-semibold">
                    {estado.dias_gracia_restantes} día{estado.dias_gracia_restantes === 1 ? '' : 's'}
                  </span>{' '}
                  para cargar una nueva y mantener todas las funciones activas.
                </p>
              </>
            )}

            {modo === 'BLOQUEADA' && activa && (
              <>
                <h2 className="text-base font-semibold text-red-800 mb-1">
                  Funciones de edición restringidas
                </h2>
                <p className="text-sm text-red-700">
                  La licencia venció el {formatearFecha(activa.fecha_vencimiento)}. Podés consultar
                  tus datos pero no crear ni editar nada hasta cargar una licencia válida.
                </p>
              </>
            )}

            {modo === 'SIN_LICENCIA' && (
              <>
                <h2 className="text-base font-semibold text-red-800 mb-1">
                  Activación pendiente
                </h2>
                <p className="text-sm text-red-700">
                  Es necesario activar el sistema. Contactá a Pulzar para recibir tu archivo .lic
                  y subilo abajo.
                </p>
              </>
            )}
          </div>
        </div>

        {activa && (
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-600 pt-4 border-t border-slate-200/60">
            <div>
              <div className="text-slate-400 mb-0.5">Cliente</div>
              <div className="font-medium text-slate-700">{activa.cliente}</div>
            </div>
            <div>
              <div className="text-slate-400 mb-0.5">Fecha de inicio</div>
              <div className="font-medium text-slate-700">{formatearFecha(activa.fecha_inicio)}</div>
            </div>
            <div>
              <div className="text-slate-400 mb-0.5">Emitida el</div>
              <div className="font-medium text-slate-700">{formatearFecha(activa.fecha_emision)}</div>
            </div>
            <div>
              <div className="text-slate-400 mb-0.5">Plan</div>
              <div className="font-medium text-slate-700">{PLAN_LABEL[activa.plan]}</div>
            </div>
          </div>
        )}
      </div>

      {/* ID de instalación */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">ID de instalación</h3>
        <p className="text-xs text-slate-500 mb-2">
          Cuando pidas o renueves tu licencia, mandale este ID a Pulzar — sirve para emitir un archivo
          .lic que solo funcione en este server.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono px-3 py-2 bg-slate-50 border border-slate-200 rounded text-slate-700">
            {estado.instalacion_id}
          </code>
          <button
            onClick={copiarInstalacionId}
            className="btn-secondary"
            title="Copiar"
          >
            <Copy className="h-3.5 w-3.5" />
            Copiar
          </button>
        </div>
      </div>

      {/* Upload de nueva licencia */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Cargar licencia</h3>
        <p className="text-xs text-slate-500 mb-3">
          Subí el archivo .lic que te mandó Pulzar. Si la fecha de inicio es hoy o anterior, se activa
          enseguida. Si es futura, queda encolada y se activa sola cuando llegue ese día.
        </p>

        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors"
        >
          <Upload className="h-8 w-8 text-slate-400 mx-auto mb-2" />
          <p className="text-sm text-slate-700 mb-1">
            Arrastrá el archivo .lic acá o
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={subiendo}
            className="btn-primary"
          >
            {subiendo ? 'Subiendo...' : 'Elegir archivo'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".lic,application/json"
            onChange={onSelectFile}
            className="hidden"
          />
        </div>
      </div>

      {/* Licencias encoladas */}
      {estado.licencias_encoladas.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-blue-600" />
            Licencias encoladas ({estado.licencias_encoladas.length})
          </h3>
          <p className="text-xs text-slate-500 mb-3">
            Estas licencias se van a activar automáticamente cuando llegue su fecha de inicio. No
            tenés que hacer nada el día de la transición.
          </p>
          <div className="space-y-2">
            {estado.licencias_encoladas.map((lic) => (
              <div
                key={lic.id}
                className="flex items-center justify-between p-3 border border-slate-200 rounded bg-slate-50"
              >
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-blue-600" />
                  <div>
                    <div className="text-sm font-medium text-slate-700">
                      Plan {PLAN_LABEL[lic.plan]}
                    </div>
                    <div className="text-xs text-slate-500">
                      Se activa el {formatearFecha(lic.fecha_inicio)} (en {lic.dias_hasta_inicio} días)
                      {' — '}vence el {formatearFecha(lic.fecha_vencimiento)}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => eliminar({
                    id: lic.id,
                    plan: lic.plan,
                    fecha_vencimiento: lic.fecha_vencimiento,
                    cliente: activa?.cliente ?? 'el cliente actual',
                  })}
                  className="btn-tabla-accion-danger"
                  title="Eliminar"
                >
                  <Trash2 />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Histórico */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-500" />
          Histórico de licencias
        </h3>
        {loadingHistorial ? (
          <p className="text-xs text-slate-500">Cargando...</p>
        ) : historial.length === 0 ? (
          <p className="text-xs text-slate-500">No hay licencias cargadas todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Cargada</th>
                  <th>Plan</th>
                  <th>Vigencia</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {historial.map((lic) => {
                  const badge = ESTADO_BADGE[lic.estado]
                  return (
                    <tr key={lic.id}>
                      <td className="text-xs">{formatearFecha(lic.fecha_carga.slice(0, 10))}</td>
                      <td className="text-xs">{PLAN_LABEL[lic.plan]}</td>
                      <td className="text-xs font-mono">
                        {formatearFecha(lic.fecha_inicio)} → {formatearFecha(lic.fecha_vencimiento)}
                      </td>
                      <td>
                        <span className={`text-2xs font-medium px-2 py-0.5 rounded border ${badge.bg} ${badge.texto}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td>
                        {lic.estado !== 'ACTIVA' && (
                          <button
                            onClick={() => eliminar(lic)}
                            className="btn-tabla-accion-danger"
                            title="Eliminar del histórico"
                          >
                            <Trash2 />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmacionTipeada
        abierto={!!licenciaAEliminar}
        titulo="Eliminar licencia del histórico"
        mensaje={
          licenciaAEliminar
            ? `Vas a eliminar la licencia ${PLAN_LABEL[licenciaAEliminar.plan]} de ${licenciaAEliminar.cliente} ` +
              `(vence ${formatearFecha(licenciaAEliminar.fecha_vencimiento)}). ` +
              `Solo se eliminan licencias NO activas; esto borra el registro del histórico de forma irreversible.`
            : ''
        }
        palabraConfirmar="ELIMINAR"
        etiquetaConfirmar="Eliminar licencia"
        onConfirmar={confirmarEliminarLicencia}
        onCancelar={() => setLicenciaAEliminar(null)}
      />
    </div>
  )
}
