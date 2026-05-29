'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Loader2, CheckCircle, AlertTriangle, Power, PowerOff,
  Send, Eye, X, ChevronDown, ChevronUp, RotateCcw,
  FileText, Settings2, UserX, Mail, MessageCircle
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import EditorPlantillaModal from '@/components/EditorPlantillaModal'
import WhatsappPlantillasSection from '@/components/WhatsappPlantillasSection'

interface Plantilla {
  id: string
  codigo: string
  nombre: string
  descripcion: string
  variables_disponibles: string[]
  activa: boolean
}

interface Baja {
  id: string
  email: string
  fecha_baja: string
  origen: string
}

export default function ComunicacionesPage() {
  const router = useRouter()
  const { usuario, loading: authLoading, isAdmin } = useAuth()

  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [guardadoOk, setGuardadoOk] = useState(false)
  const [errorGral, setErrorGral] = useState('')

  // Config
  const [activo, setActivo] = useState(false)
  const [envioAutoRenovaciones, setEnvioAutoRenovaciones] = useState(false)
  const [envioAutoBienvenida, setEnvioAutoBienvenida] = useState(false)
  const [envioAutoPortal, setEnvioAutoPortal] = useState(false)
  const [adjuntarDocs, setAdjuntarDocs] = useState(true)
  const [limiteDiario, setLimiteDiario] = useState(500)
  const [delayEnvios, setDelayEnvios] = useState(2000)
  const [delayAutomaticoSeg, setDelayAutomaticoSeg] = useState(10)
  const [maxAdjuntosMb, setMaxAdjuntosMb] = useState(20)
  const [retenerCompletoDias, setRetenerCompletoDias] = useState(90)
  const [retenerMetadataMeses, setRetenerMetadataMeses] = useState(6)
  const [eliminarDespuesMeses, setEliminarDespuesMeses] = useState(12)
  const [errorRetencion, setErrorRetencion] = useState('')
  const [notificarInformativos, setNotificarInformativos] = useState(false)

  // Toggles individuales por evento al admin (migración 071)
  const [notifBackupOk, setNotifBackupOk] = useState(false)
  const [notifRestauracionIni, setNotifRestauracionIni] = useState(false)
  const [notifRestauracionOk, setNotifRestauracionOk] = useState(false)
  const [notifPdfOk, setNotifPdfOk] = useState(false)
  const [notifPdfFallido, setNotifPdfFallido] = useState(false)
  const [notifEmailFallido, setNotifEmailFallido] = useState(false)

  // Toggles para emails del formulario público de denuncia
  const [denunciaEmailCliente, setDenunciaEmailCliente] = useState(false)
  const [denunciaEmailPas, setDenunciaEmailPas] = useState(false)
  const [smtpConfigurado, setSmtpConfigurado] = useState(false)
  const [editandoPlantilla, setEditandoPlantilla] = useState<string | null>(null)

  // Plantillas
  const [plantillas, setPlantillas] = useState<Plantilla[]>([])
  const [previewPlantilla, setPreviewPlantilla] = useState<string | null>(null)

  // Bajas
  const [bajas, setBajas] = useState<Baja[]>([])
  const [totalBajas, setTotalBajas] = useState(0)
  const [paginaBajas, setPaginaBajas] = useState(1)
  const [cargandoBajas, setCargandoBajas] = useState(false)

  // Avanzado
  const [avanzadoAbierto, setAvanzadoAbierto] = useState(false)

  // Tab activo: Email vs WhatsApp
  const [tabActiva, setTabActiva] = useState<'email' | 'whatsapp'>('email')

  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    if (!authLoading && (!usuario || !isAdmin)) {
      router.push('/crm/dashboard')
    }
  }, [authLoading, usuario, isAdmin, router])

  // Cargar config
  useEffect(() => {
    async function cargar() {
      const [configRes, smtpRes] = await Promise.all([
        apiCall<{ configuracion?: any }>('/api/configuracion/comunicaciones', undefined, { mostrar_toast_en_error: false }),
        apiCall<{ configurado?: boolean }>('/api/configuracion/correos', undefined, { mostrar_toast_en_error: false }),
      ])

      if (configRes.ok && configRes.data?.configuracion) {
        const c = configRes.data.configuracion
        setActivo(c.activo ?? false)
        setEnvioAutoRenovaciones(c.envio_automatico_renovaciones ?? false)
        setEnvioAutoBienvenida(c.envio_automatico_bienvenida_poliza ?? false)
        setEnvioAutoPortal(c.envio_automatico_portal_cliente ?? false)
        setAdjuntarDocs(c.adjuntar_docs_renovacion ?? true)
        setLimiteDiario(c.limite_diario ?? 500)
        setDelayEnvios(c.delay_entre_envios_ms ?? 2000)
        setDelayAutomaticoSeg(c.delay_entre_envios_automaticos_seg ?? 10)
        setMaxAdjuntosMb(c.max_adjuntos_mb ?? 20)
        setRetenerCompletoDias(c.retener_completo_dias ?? 90)
        setRetenerMetadataMeses(c.retener_metadata_meses ?? 6)
        setEliminarDespuesMeses(c.eliminar_despues_meses ?? 12)
        setNotificarInformativos(c.notificar_admin_eventos_informativos ?? false)
        setNotifBackupOk(c.notificar_admin_backup_completado ?? false)
        setNotifRestauracionIni(c.notificar_admin_restauracion_iniciada ?? false)
        setNotifRestauracionOk(c.notificar_admin_restauracion_completada ?? false)
        setNotifPdfOk(c.notificar_admin_pdf_procesado ?? false)
        setNotifPdfFallido(c.notificar_admin_pdf_fallido ?? false)
        setNotifEmailFallido(c.notificar_admin_email_automatico_fallido ?? false)
        setDenunciaEmailCliente(c.envio_automatico_denuncia_publica_cliente ?? false)
        setDenunciaEmailPas(c.envio_automatico_denuncia_publica_pas ?? false)
      } else if (!configRes.ok) {
        setErrorGral(configRes.error?.mensaje ?? 'Error al cargar la configuración')
      }

      if (smtpRes.ok && smtpRes.data) {
        setSmtpConfigurado(smtpRes.data.configurado ?? false)
      }

      // Plantillas directo de Supabase via API custom o hardcoded
      await cargarPlantillas()
      await cargarBajas(1)

      setCargando(false)
      setTimeout(() => { mountedRef.current = true }, 100)
    }
    if (!authLoading && usuario) cargar()
  }, [authLoading, usuario])

  async function cargarPlantillas() {
    const r = await apiCall<{ plantillas?: Plantilla[] }>('/api/configuracion/comunicaciones/plantillas', undefined, { mostrar_toast_en_error: false })
    if (r.ok && r.data) setPlantillas(r.data.plantillas || [])
    // Si falla, plantillas queda vacío y se muestra PlantillasHardcoded como fallback
  }

  async function cargarBajas(pagina: number) {
    setCargandoBajas(true)
    const r = await apiCall<{ bajas?: Baja[]; total?: number }>(`/api/configuracion/comunicaciones/bajas?pagina=${pagina}`, undefined, { mostrar_toast_en_error: false })
    if (r.ok && r.data) {
      setBajas(r.data.bajas || [])
      setTotalBajas(r.data.total || 0)
      setPaginaBajas(pagina)
    }
    setCargandoBajas(false)
  }

  // Auto-save
  const guardar = useCallback(async (datos: Record<string, any>) => {
    if (!mountedRef.current) return
    setGuardando(true)
    setErrorGral('')
    setGuardadoOk(false)

    const r = await apiCall('/api/configuracion/comunicaciones', {
      method: 'PATCH',
      body: datos,
    }, { mostrar_toast_en_error: false })

    if (!r.ok) {
      const msg = r.error?.mensaje ?? 'Error al guardar'
      setErrorGral(msg)
      // Revertir si fue un switch
      if (datos.activo !== undefined) {
        setActivo(!datos.activo)
      }
      if (datos.envio_automatico_renovaciones !== undefined) {
        setEnvioAutoRenovaciones(!datos.envio_automatico_renovaciones)
      }
    } else {
      setGuardadoOk(true)
      setTimeout(() => setGuardadoOk(false), 2000)
    }
    setGuardando(false)
  }, [])

  const debouncedSave = useCallback((datos: Record<string, any>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => guardar(datos), 500)
  }, [guardar])

  const immediateSave = useCallback((datos: Record<string, any>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    guardar(datos)
  }, [guardar])

  // Valida consistencia de retención: completo(días) < metadata(meses*30) < eliminar(meses*30)
  const validarRetencion = useCallback((diasCompleto: number, mesesMetadata: number, mesesEliminar: number) => {
    if (!(diasCompleto < mesesMetadata * 30 && mesesMetadata * 30 < mesesEliminar * 30)) {
      setErrorRetencion('Los valores deben cumplir: completo (días) < metadata (meses × 30) < eliminar (meses × 30)')
      return false
    }
    setErrorRetencion('')
    return true
  }, [])

  const guardarRetencion = useCallback((overrides: Partial<{ completo: number; metadata: number; eliminar: number }>) => {
    const c = overrides.completo ?? retenerCompletoDias
    const m = overrides.metadata ?? retenerMetadataMeses
    const e = overrides.eliminar ?? eliminarDespuesMeses
    if (!validarRetencion(c, m, e)) return
    debouncedSave({
      retener_completo_dias: c,
      retener_metadata_meses: m,
      eliminar_despues_meses: e,
    })
  }, [retenerCompletoDias, retenerMetadataMeses, eliminarDespuesMeses, validarRetencion, debouncedSave])

  const resuscribir = async (bajaId: string) => {
    if (!confirm('¿Confirmar re-suscripción? El destinatario volverá a recibir emails.')) return
    const r = await apiCall('/api/configuracion/comunicaciones/bajas', {
      method: 'DELETE',
      body: { id: bajaId },
    }, { mostrar_toast_en_error: false })
    if (r.ok) {
      toast.exito('Destinatario re-suscripto')
      await cargarBajas(paginaBajas)
    } else {
      toast.error(r.error?.mensaje ?? 'No se pudo re-suscribir')
    }
  }

  if (authLoading || cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  if (!usuario || !isAdmin) return null

  const totalPaginasBajas = Math.ceil(totalBajas / 25)

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/crm/configuracion')} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-3.5 w-3.5" /> Volver
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-slate-800">Sistema de comunicaciones</h1>
          <p className="text-xs text-slate-500">Plantillas de email y WhatsApp, envíos automáticos y gestión de bajas</p>
        </div>
        <div className="flex items-center gap-1.5 text-2xs">
          {guardando && <><Loader2 className="h-3 w-3 animate-spin text-slate-400" /><span className="text-slate-400">Guardando...</span></>}
          {guardadoOk && <><CheckCircle className="h-3 w-3 text-green-500" /><span className="text-green-600">Guardado</span></>}
        </div>
      </div>

      {errorGral && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded p-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {errorGral}
        </div>
      )}

      {/* Tabs: Email | WhatsApp */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <button
          onClick={() => setTabActiva('email')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            tabActiva === 'email'
              ? 'border-blue-500 text-blue-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Mail className="h-3.5 w-3.5" /> Email
        </button>
        <button
          onClick={() => setTabActiva('whatsapp')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
            tabActiva === 'whatsapp'
              ? 'border-green-500 text-green-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
        </button>
      </div>

      {/* ──────── TAB EMAIL ──────── */}
      {tabActiva === 'email' && <>

      {/* SECCIÓN 1 — Estado del sistema */}
      <div className={`border rounded-lg p-4 ${activo ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {activo
              ? <Power className="h-5 w-5 text-green-600" />
              : <PowerOff className="h-5 w-5 text-red-500" />
            }
            <div>
              <p className={`text-sm font-medium ${activo ? 'text-green-800' : 'text-red-800'}`}>
                {activo ? 'Sistema de comunicaciones activo' : 'Sistema de comunicaciones desactivado'}
              </p>
              <p className={`text-2xs mt-0.5 ${activo ? 'text-green-600' : 'text-red-600'}`}>
                {activo
                  ? 'Los emails se pueden enviar desde el CRM.'
                  : 'No se enviarán emails hasta que se active.'}
              </p>
            </div>
          </div>
          <label className={`relative inline-flex items-center ${!smtpConfigurado ? 'opacity-50' : 'cursor-pointer'}`}>
            <input
              type="checkbox"
              checked={activo}
              disabled={!smtpConfigurado}
              onChange={e => {
                setActivo(e.target.checked)
                immediateSave({ activo: e.target.checked })
              }}
              className="sr-only peer"
            />
            <div className="w-10 h-5 bg-slate-300 peer-checked:bg-green-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
          </label>
        </div>
        {!smtpConfigurado && (
          <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              Primero configurá el sistema de correos.{' '}
              <button onClick={() => router.push('/crm/configuracion/correos')} className="text-blue-600 hover:underline font-medium">
                Ir a Correos
              </button>
            </span>
          </div>
        )}
      </div>

      {/* SECCIÓN 2 — Envío automático en renovaciones */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-1">
          <Send className="h-4 w-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-slate-800">Emails automáticos</h2>
        </div>
        <p className="text-2xs text-slate-500 mb-4">Activá cada tipo de email automático de forma independiente. Todos se envían a través de la cola de envíos.</p>

        {smtpConfigurado && !activo && (
          <div className="mb-4 flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              El sistema general de comunicaciones está apagado. Estos toggles no van a tener efecto hasta que lo actives arriba.
            </span>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {/* Toggle: Bienvenida */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <p className="text-xs text-slate-700">Bienvenida al activarse una póliza nueva</p>
              <p className="text-2xs text-slate-400 mt-0.5">Se envía cuando una póliza pasa a VIGENTE (nace vigente o transiciona desde PROGRAMADA). Adjunta toda la documentación disponible.</p>
            </div>
            <label className={`relative inline-flex items-center ${!smtpConfigurado ? 'opacity-50' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={envioAutoBienvenida}
                disabled={!smtpConfigurado}
                onChange={e => {
                  setEnvioAutoBienvenida(e.target.checked)
                  immediateSave({ envio_automatico_bienvenida_poliza: e.target.checked })
                }}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-slate-300 peer-checked:bg-blue-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
            </label>
          </div>

          {/* Toggle: Portal cliente */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <p className="text-xs text-slate-700">Acceso al Portal del Asegurado</p>
              <p className="text-2xs text-slate-400 mt-0.5">Se envía cuando se habilita el acceso al portal desde la ficha de persona.</p>
            </div>
            <label className={`relative inline-flex items-center ${!smtpConfigurado ? 'opacity-50' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={envioAutoPortal}
                disabled={!smtpConfigurado}
                onChange={e => {
                  setEnvioAutoPortal(e.target.checked)
                  immediateSave({ envio_automatico_portal_cliente: e.target.checked })
                }}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-slate-300 peer-checked:bg-blue-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
            </label>
          </div>

          {/* Toggle: Renovación */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-700">Renovación de póliza</p>
              <p className="text-2xs text-slate-400 mt-0.5">Se envía cuando una renovación se activa y pasa a VIGENTE.</p>
            </div>
            <label className={`relative inline-flex items-center ${!smtpConfigurado ? 'opacity-50' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={envioAutoRenovaciones}
                disabled={!smtpConfigurado}
                onChange={e => {
                  setEnvioAutoRenovaciones(e.target.checked)
                  immediateSave({ envio_automatico_renovaciones: e.target.checked })
                }}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-slate-300 peer-checked:bg-blue-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
            </label>
          </div>

          {envioAutoRenovaciones && (
            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <div>
                <p className="text-xs text-slate-700">Adjuntar documentación de la renovación</p>
                <p className="text-2xs text-slate-400 mt-0.5">Incluye los archivos de la categoría "documentación" como adjuntos.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={adjuntarDocs}
                  onChange={e => {
                    setAdjuntarDocs(e.target.checked)
                    immediateSave({ adjuntar_docs_renovacion: e.target.checked })
                  }}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-slate-300 peer-checked:bg-blue-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
              </label>
            </div>
          )}

          {/* Toggle: Confirmación al cliente del formulario público */}
          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <div>
              <p className="text-xs text-slate-700">Confirmación al cliente cuando carga una denuncia</p>
              <p className="text-2xs text-slate-400 mt-0.5">Cuando un asegurado completa el formulario público de denuncia, recibe un email con el PDF de la denuncia como comprobante.</p>
            </div>
            <label className={`relative inline-flex items-center ${!smtpConfigurado ? 'opacity-50' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={denunciaEmailCliente}
                disabled={!smtpConfigurado}
                onChange={e => {
                  setDenunciaEmailCliente(e.target.checked)
                  immediateSave({ envio_automatico_denuncia_publica_cliente: e.target.checked })
                }}
                className="sr-only peer"
              />
              <div className="w-10 h-5 bg-slate-300 peer-checked:bg-blue-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
            </label>
          </div>
        </div>
      </div>

      {/* SECCIÓN 3 — Plantillas disponibles */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-1">
          <FileText className="h-4 w-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-slate-800">Plantillas disponibles</h2>
        </div>
        <p className="text-2xs text-slate-500 mb-4">Las plantillas definen el diseño de cada tipo de email. Las variables se reemplazan automáticamente con datos reales.</p>

        {plantillas.length > 0 ? (() => {
          const cliente = plantillas.filter(p => !p.codigo.startsWith('sistema_'))
          const admin = plantillas.filter(p => p.codigo.startsWith('sistema_'))

          const renderPlantilla = (p: Plantilla) => (
            <div key={p.id} className="border border-slate-200 rounded p-3 hover:border-slate-300 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-800">{p.nombre}</p>
                  <p className="text-2xs text-slate-500 mt-0.5">{p.descripcion}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {(p.variables_disponibles ?? []).map(v => (
                      <span key={v} className="text-2xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                        {`{{${v}}}`}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-3 shrink-0">
                  <button
                    onClick={() => setPreviewPlantilla(previewPlantilla === p.codigo ? null : p.codigo)}
                    className="btn-secondary text-2xs px-2 py-1 flex items-center gap-1"
                  >
                    <Eye className="h-3 w-3" /> Vista previa
                  </button>
                  <button
                    onClick={() => setEditandoPlantilla(p.codigo)}
                    className="btn-primary text-2xs px-2 py-1 flex items-center gap-1"
                  >
                    ✏️ Editar
                  </button>
                </div>
              </div>
            </div>
          )

          return (
            <div className="flex flex-col gap-5">
              {cliente.length > 0 && (
                <div>
                  <p className="text-2xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                    Comunicaciones al cliente <span className="text-slate-400 font-normal">({cliente.length})</span>
                  </p>
                  <div className="flex flex-col gap-2">
                    {cliente.map(renderPlantilla)}
                  </div>
                </div>
              )}

              {admin.length > 0 && (
                <div>
                  <p className="text-2xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                    Notificaciones al admin <span className="text-slate-400 font-normal">({admin.length})</span>
                  </p>
                  <div className="flex flex-col gap-2">
                    {admin.map(renderPlantilla)}
                  </div>
                </div>
              )}
            </div>
          )
        })() : (
          <div className="flex flex-col gap-2">
            <PlantillasHardcoded onPreview={(c) => setPreviewPlantilla(previewPlantilla === c ? null : c)} previewActual={previewPlantilla} />
          </div>
        )}
      </div>

      {/* SECCIÓN 4 — Configuración avanzada */}
      <div className="bg-white border border-slate-200 rounded-lg">
        <button
          onClick={() => setAvanzadoAbierto(!avanzadoAbierto)}
          className="w-full flex items-center justify-between p-5 text-left"
        >
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-800">Configuración avanzada</h2>
          </div>
          {avanzadoAbierto ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </button>

        {avanzadoAbierto && (
          <div className="px-5 pb-5 border-t border-slate-100 pt-4 flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Límite diario de envíos</label>
              <input
                type="number"
                className="form-input w-48 text-xs"
                min={1}
                max={10000}
                value={limiteDiario}
                onChange={e => {
                  const v = parseInt(e.target.value) || 500
                  setLimiteDiario(v)
                  debouncedSave({ limite_diario: v })
                }}
              />
              <p className="text-2xs text-slate-400 mt-1">Cantidad máxima de emails que se pueden enviar por día. Protege contra envíos masivos accidentales.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Delay entre envíos masivos (ms)</label>
              <input
                type="number"
                className="form-input w-48 text-xs"
                min={0}
                max={60000}
                step={500}
                value={delayEnvios}
                onChange={e => {
                  const v = parseInt(e.target.value) || 2000
                  setDelayEnvios(v)
                  debouncedSave({ delay_entre_envios_ms: v })
                }}
              />
              <p className="text-2xs text-slate-400 mt-1">Tiempo de espera entre cada email en envíos masivos. Evita sobrecargar el servidor SMTP.</p>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <h3 className="text-2xs font-semibold text-slate-700 uppercase tracking-wider mb-3">Configuración de envíos</h3>
              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Delay entre emails automáticos (segundos)</label>
                  <input
                    type="number"
                    className="form-input w-48 text-xs"
                    min={0}
                    max={300}
                    value={delayAutomaticoSeg}
                    onChange={e => {
                      const v = parseInt(e.target.value)
                      const val = isNaN(v) ? 0 : v
                      setDelayAutomaticoSeg(val)
                      debouncedSave({ delay_entre_envios_automaticos_seg: val })
                    }}
                    title="Pausa entre cada email automático para no saturar el servidor SMTP"
                  />
                  <p className="text-2xs text-slate-400 mt-1">Pausa entre cada email automático para no saturar el servidor SMTP.</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tamaño máximo de adjuntos (MB)</label>
                  <input
                    type="number"
                    className="form-input w-48 text-xs"
                    min={1}
                    max={25}
                    value={maxAdjuntosMb}
                    onChange={e => {
                      const v = parseInt(e.target.value)
                      const val = isNaN(v) ? 1 : v
                      setMaxAdjuntosMb(val)
                      debouncedSave({ max_adjuntos_mb: val })
                    }}
                    title="Si los adjuntos superan este tamaño, se envía link al portal del asegurado"
                  />
                  <p className="text-2xs text-slate-400 mt-1">Si los adjuntos superan este tamaño, se envía link al portal del asegurado.</p>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <h3 className="text-2xs font-semibold text-slate-700 uppercase tracking-wider mb-3">Retención del historial</h3>

              {errorRetencion && (
                <div className="flex items-center gap-2 text-2xs text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-3">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {errorRetencion}
                </div>
              )}

              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Conservar historial completo (días)</label>
                  <input
                    type="number"
                    className="form-input w-48 text-xs"
                    min={7}
                    value={retenerCompletoDias}
                    onChange={e => {
                      const v = parseInt(e.target.value)
                      const val = isNaN(v) ? 7 : v
                      setRetenerCompletoDias(val)
                      guardarRetencion({ completo: val })
                    }}
                    title="Los emails más nuevos que este período se conservan con todos sus detalles"
                  />
                  <p className="text-2xs text-slate-400 mt-1">Los emails más nuevos que este período se conservan con todos sus detalles.</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Conservar metadata (meses)</label>
                  <input
                    type="number"
                    className="form-input w-48 text-xs"
                    min={1}
                    value={retenerMetadataMeses}
                    onChange={e => {
                      const v = parseInt(e.target.value)
                      const val = isNaN(v) ? 1 : v
                      setRetenerMetadataMeses(val)
                      guardarRetencion({ metadata: val })
                    }}
                    title="Pasado este tiempo se elimina el contenido pero se conserva el registro del envío"
                  />
                  <p className="text-2xs text-slate-400 mt-1">Pasado este tiempo se elimina el contenido pero se conserva el registro del envío.</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Eliminar completamente (meses)</label>
                  <input
                    type="number"
                    className="form-input w-48 text-xs"
                    min={3}
                    value={eliminarDespuesMeses}
                    onChange={e => {
                      const v = parseInt(e.target.value)
                      const val = isNaN(v) ? 3 : v
                      setEliminarDespuesMeses(val)
                      guardarRetencion({ eliminar: val })
                    }}
                    title="Pasado este tiempo el registro se elimina definitivamente"
                  />
                  <p className="text-2xs text-slate-400 mt-1">Pasado este tiempo el registro se elimina definitivamente.</p>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <h3 className="text-2xs font-semibold text-slate-700 uppercase tracking-wider mb-1">🔔 Notificaciones al admin por email</h3>
              <p className="text-2xs text-slate-500 mb-3 leading-relaxed">
                Los <strong>eventos críticos</strong> (backup fallido, sync Google Drive fallido, restauración fallida, errores graves del sistema, denuncia pública al PAS y licencias) <strong>siempre</strong> se envían — no se pueden apagar por seguridad.
                Acá podés elegir individualmente qué <strong>eventos informativos</strong> querés recibir.
              </p>

              {smtpConfigurado && !activo && (
                <div className="mb-3 flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    El sistema general está apagado. Estos toggles no van a tener efecto hasta que lo actives.
                  </span>
                </div>
              )}

              {/* Atajos: activar/desactivar todos los informativos de un saque */}
              {(() => {
                const informativos = [notifBackupOk, notifRestauracionIni, notifRestauracionOk, notifPdfOk, notifPdfFallido, notifEmailFallido]
                const activados = informativos.filter(Boolean).length
                const todosActivos = activados === informativos.length
                const ninguno = activados === 0

                function setearTodos(valor: boolean) {
                  setNotifBackupOk(valor); setNotifRestauracionIni(valor); setNotifRestauracionOk(valor)
                  setNotifPdfOk(valor); setNotifPdfFallido(valor); setNotifEmailFallido(valor)
                  immediateSave({
                    notificar_admin_backup_completado: valor,
                    notificar_admin_restauracion_iniciada: valor,
                    notificar_admin_restauracion_completada: valor,
                    notificar_admin_pdf_procesado: valor,
                    notificar_admin_pdf_fallido: valor,
                    notificar_admin_email_automatico_fallido: valor,
                  })
                }

                return (
                  <div className="flex items-center justify-between gap-2 mb-3 bg-slate-50 border border-slate-200 rounded p-2">
                    <p className="text-2xs text-slate-600">
                      <strong className="font-mono text-slate-800">{activados}/6</strong> informativos activados
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setearTodos(true)}
                        disabled={todosActivos}
                        className="text-2xs px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Activar todos
                      </button>
                      <button
                        type="button"
                        onClick={() => setearTodos(false)}
                        disabled={ninguno}
                        className="text-2xs px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Desactivar todos
                      </button>
                    </div>
                  </div>
                )
              })()}

              <div className="flex flex-col gap-2">
                {/* Backup completado */}
                <div className="flex items-center justify-between gap-4 py-1.5 border-b border-slate-100">
                  <div>
                    <p className="text-xs text-slate-700">Backup completado correctamente</p>
                    <p className="text-2xs text-slate-400">Email cada vez que termina un backup exitoso.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={notifBackupOk}
                      onChange={e => {
                        setNotifBackupOk(e.target.checked)
                        immediateSave({ notificar_admin_backup_completado: e.target.checked })
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-slate-300 peer-checked:bg-blue-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
                  </label>
                </div>

                {/* Restauración iniciada */}
                <div className="flex items-center justify-between gap-4 py-1.5 border-b border-slate-100">
                  <div>
                    <p className="text-xs text-slate-700">Restauración iniciada</p>
                    <p className="text-2xs text-slate-400">Email al iniciar una restauración desde backup.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={notifRestauracionIni}
                      onChange={e => {
                        setNotifRestauracionIni(e.target.checked)
                        immediateSave({ notificar_admin_restauracion_iniciada: e.target.checked })
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-slate-300 peer-checked:bg-blue-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
                  </label>
                </div>

                {/* Restauración completada */}
                <div className="flex items-center justify-between gap-4 py-1.5 border-b border-slate-100">
                  <div>
                    <p className="text-xs text-slate-700">Restauración completada</p>
                    <p className="text-2xs text-slate-400">Email al terminar una restauración exitosa.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={notifRestauracionOk}
                      onChange={e => {
                        setNotifRestauracionOk(e.target.checked)
                        immediateSave({ notificar_admin_restauracion_completada: e.target.checked })
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-slate-300 peer-checked:bg-blue-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
                  </label>
                </div>

                {/* PDF procesado */}
                <div className="flex items-center justify-between gap-4 py-1.5 border-b border-slate-100">
                  <div>
                    <p className="text-xs text-slate-700">Agente IA: PDF procesado y listo para revisar</p>
                    <p className="text-2xs text-slate-400">Email cuando la IA termina de extraer datos de un PDF de póliza.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={notifPdfOk}
                      onChange={e => {
                        setNotifPdfOk(e.target.checked)
                        immediateSave({ notificar_admin_pdf_procesado: e.target.checked })
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-slate-300 peer-checked:bg-blue-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
                  </label>
                </div>

                {/* PDF fallido */}
                <div className="flex items-center justify-between gap-4 py-1.5 border-b border-slate-100">
                  <div>
                    <p className="text-xs text-slate-700">Agente IA: PDF que falló al procesar</p>
                    <p className="text-2xs text-slate-400">Email cuando la IA no pudo extraer datos de un PDF. Recomendado activado.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={notifPdfFallido}
                      onChange={e => {
                        setNotifPdfFallido(e.target.checked)
                        immediateSave({ notificar_admin_pdf_fallido: e.target.checked })
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-slate-300 peer-checked:bg-blue-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
                  </label>
                </div>

                {/* Email automático a cliente fallido */}
                <div className="flex items-center justify-between gap-4 py-1.5">
                  <div>
                    <p className="text-xs text-slate-700">Email automático a cliente que falló</p>
                    <p className="text-2xs text-slate-400">Email cuando rebota o falla un email que el sistema mandó a un cliente. Recomendado activado.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={notifEmailFallido}
                      onChange={e => {
                        setNotifEmailFallido(e.target.checked)
                        immediateSave({ notificar_admin_email_automatico_fallido: e.target.checked })
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-slate-300 peer-checked:bg-blue-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
                  </label>
                </div>

                {/* Toggle: denuncia pública al PAS */}
                <div className="flex items-center justify-between gap-4 py-1.5 border-t border-slate-100 mt-2 pt-3">
                  <div>
                    <p className="text-xs text-slate-700">Aviso al PAS cuando un cliente carga una denuncia desde el portal</p>
                    <p className="text-2xs text-slate-400">Email con los detalles de la denuncia y el PDF adjunto. Recomendado activado.</p>
                  </div>
                  <label className={`relative inline-flex items-center ${!smtpConfigurado ? 'opacity-50' : 'cursor-pointer'} shrink-0`}>
                    <input
                      type="checkbox"
                      checked={denunciaEmailPas}
                      disabled={!smtpConfigurado}
                      onChange={e => {
                        setDenunciaEmailPas(e.target.checked)
                        immediateSave({ envio_automatico_denuncia_publica_pas: e.target.checked })
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-slate-300 peer-checked:bg-blue-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SECCIÓN 5 — Lista de bajas */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-1">
          <UserX className="h-4 w-4 text-red-500" />
          <h2 className="text-sm font-semibold text-slate-800">Lista de bajas</h2>
        </div>
        <p className="text-2xs text-slate-500 mb-4">
          Personas que se dieron de baja de las comunicaciones. No recibirán más emails del CRM.
          {totalBajas > 0 && <span className="ml-1 font-medium">({totalBajas} en total)</span>}
        </p>

        {cargandoBajas ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          </div>
        ) : bajas.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-6">No hay bajas registradas.</p>
        ) : (
          <>
            <table className="crm-table text-xs w-full">
              <thead>
                <tr>
                  <th className="text-left py-2 px-3 text-2xs font-medium text-slate-500 bg-slate-50">Email</th>
                  <th className="text-left py-2 px-3 text-2xs font-medium text-slate-500 bg-slate-50">Fecha de baja</th>
                  <th className="text-left py-2 px-3 text-2xs font-medium text-slate-500 bg-slate-50">Origen</th>
                  <th className="text-right py-2 px-3 text-2xs font-medium text-slate-500 bg-slate-50">Acción</th>
                </tr>
              </thead>
              <tbody>
                {bajas.map(b => (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="py-2 px-3 font-mono">{b.email}</td>
                    <td className="py-2 px-3 text-slate-500">{new Date(b.fecha_baja).toLocaleDateString('es-AR')}</td>
                    <td className="py-2 px-3 text-slate-500">{b.origen === 'unsubscribe_link' ? 'Link de baja' : b.origen}</td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => resuscribir(b.id)}
                        className="text-2xs text-blue-600 hover:text-blue-800 flex items-center gap-1 ml-auto"
                      >
                        <RotateCcw className="h-3 w-3" /> Re-suscribir
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPaginasBajas > 1 && (
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                <p className="text-2xs text-slate-400">Página {paginaBajas} de {totalPaginasBajas}</p>
                <div className="flex gap-1">
                  <button
                    onClick={() => cargarBajas(paginaBajas - 1)}
                    disabled={paginaBajas <= 1}
                    className="btn-secondary text-2xs px-2 py-1 disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => cargarBajas(paginaBajas + 1)}
                    disabled={paginaBajas >= totalPaginasBajas}
                    className="btn-secondary text-2xs px-2 py-1 disabled:opacity-50"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      </>}

      {/* ──────── TAB WHATSAPP ──────── */}
      {tabActiva === 'whatsapp' && (
        <WhatsappPlantillasSection />
      )}

      {/* Modal de preview */}
      {previewPlantilla && (
        <PreviewModal codigo={previewPlantilla} onClose={() => setPreviewPlantilla(null)} />
      )}

      {/* Modal de editor de plantilla */}
      {editandoPlantilla && (
        <EditorPlantillaModal
          codigo={editandoPlantilla}
          onClose={() => setEditandoPlantilla(null)}
          onSaved={() => {
            // Refrescar lista de plantillas
            cargarPlantillas()
          }}
        />
      )}
    </div>
  )
}

// Componente de plantillas hardcoded (sin endpoint de plantillas)
function PlantillasHardcoded({ onPreview, previewActual }: { onPreview: (c: string) => void; previewActual: string | null }) {
  const plantillas = [
    {
      codigo: 'renovacion_poliza',
      nombre: 'Renovación de póliza',
      descripcion: 'Email automático o manual al renovar una póliza, con la nueva documentación adjunta',
      variables: ['nombre', 'apellido', 'numero_poliza', 'compania', 'ramo', 'fecha_inicio', 'fecha_fin', 'riesgo', 'organizacion_nombre', 'organizacion_telefono', 'organizacion_email'],
    },
    {
      codigo: 'recordatorio_pago',
      nombre: 'Recordatorio de pago',
      descripcion: 'Email para recordar al cliente que tiene pagos pendientes',
      variables: ['nombre', 'apellido', 'numero_poliza', 'compania', 'ramo', 'organizacion_nombre', 'organizacion_telefono', 'organizacion_email'],
    },
    {
      codigo: 'notificacion_general',
      nombre: 'Notificación / Novedades',
      descripcion: 'Email para comunicar novedades, cambios o información general',
      variables: ['nombre', 'apellido', 'organizacion_nombre', 'organizacion_telefono', 'organizacion_email'],
    },
    {
      codigo: 'informativa',
      nombre: 'Informativa puntual',
      descripcion: 'Email para avisos puntuales con título y cuerpo libre',
      variables: ['nombre', 'apellido', 'organizacion_nombre', 'organizacion_telefono', 'organizacion_email'],
    },
  ]

  return (
    <>
      {plantillas.map(p => (
        <div key={p.codigo} className="border border-slate-200 rounded p-3 hover:border-slate-300 transition-colors">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-800">{p.nombre}</p>
              <p className="text-2xs text-slate-500 mt-0.5">{p.descripcion}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {(p.variables ?? []).map(v => (
                  <span key={v} className="text-2xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
            </div>
            <button
              onClick={() => onPreview(p.codigo)}
              className="btn-secondary text-2xs px-2 py-1 flex items-center gap-1 ml-3 shrink-0"
            >
              <Eye className="h-3 w-3" /> Vista previa
            </button>
          </div>
        </div>
      ))}
    </>
  )
}

// Modal de preview
function PreviewModal({ codigo, onClose }: { codigo: string; onClose: () => void }) {
  const [html, setHtml] = useState('')
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    async function cargar() {
      const r = await apiCall<{ html?: string }>(`/api/configuracion/comunicaciones/preview?codigo=${codigo}`, undefined, { mostrar_toast_en_error: false })
      if (r.ok && r.data?.html) {
        setHtml(r.data.html)
      } else {
        setHtml('<p style="padding:32px;text-align:center;color:#64748b;">No se pudo generar la vista previa.</p>')
      }
      setCargando(false)
    }
    cargar()
  }, [codigo])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-sm font-semibold text-slate-800">Vista previa de plantilla</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-1 bg-slate-100">
          {cargando ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : (
            <iframe
              srcDoc={html}
              title="Preview"
              className="w-full border-0 rounded"
              style={{ minHeight: '500px' }}
              // allow-same-origin + allow-popups: el logo carga y los links
              // abren en nueva pestaña. Sin allow-scripts → sigue seguro.
              sandbox="allow-same-origin allow-popups"
            />
          )}
        </div>
        <div className="flex items-center justify-end px-5 py-3 border-t border-slate-200 shrink-0">
          <button onClick={onClose} className="btn-secondary text-xs px-3 py-1.5">Cerrar</button>
        </div>
      </div>
    </div>
  )
}
