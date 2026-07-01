'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, Edit, MessageCircle, Phone, Mail, MapPin,
  User, Building2, FileText, AlertTriangle, Calendar,
  Shield, Eye, CheckCircle, CheckCircle2, Loader2, ClipboardList,
  Trash2, X, FolderOpen, Target, Send, Briefcase, ExternalLink,
  Globe, Copy, RefreshCw, Ban, Check, Sparkles
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal, puedeEliminar } from '@/lib/cartera-filter'
import { formatFecha, formatFechaLocal, formatMoneda, getBadgeClase, getLabelEstado, getPolizaBadgeColor, getTooltipEstado, nombreCompleto, hoyLocal, diasHastaVencimiento } from '@/lib/utils'
import type { Persona } from '@/types/database'
import ModalEnviarEmail from '@/components/ModalEnviarEmail'
import ModalUploadPDF from '@/components/agente-pdf/ModalUploadPDF'
import ComunicacionesTab from '@/components/ComunicacionesTab'
import HistorialPersona from '@/components/HistorialPersona'
import { useModuloIAPDF } from '@/lib/hooks/useModuloIAPDF'
import { useEmailConfigurado } from '@/lib/hooks/useEmailConfigurado'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { copiarAlPortapapeles } from '@/lib/copiar-portapapeles'
import { construirUrlWhatsapp } from '@/lib/whatsapp-templates'
import { PresenciaEnFicha } from '@/components/PresenciaEnFicha'

// ── Tipos locales para las queries con joins ─────────────────
interface PolizaResumen {
  id: string
  numero_poliza: string
  fecha_inicio: string
  fecha_fin: string
  estado: string
  compania: { nombre: string } | null
  ramo: { nombre: string } | null
}

interface SiniestroResumen {
  id: string
  numero_caso: string
  fecha_denuncia: string
  estado: string
  tipo_siniestro: string | null
  monto_estimado: number | null
}

interface TareaResumen {
  id: string
  titulo: string
  fecha_vencimiento: string
  prioridad: string
  estado: string
}

interface LeadOrigen {
  id: string
  fuente: string
  nivel_interes: string
  created_at: string
  fecha_conversion: string | null
}

interface OportunidadResumen {
  id: string
  tipo: string
  estado: string
  descripcion: string | null
  created_at: string
}

interface CotizacionResumen {
  id: string
  numero_cotizacion: string
  estado: string
  ramo: { nombre: string } | null
  compania_ganadora: { nombre: string } | null
  created_at: string
}

// Historial de interacciones del cliente. Si la persona viene de la
// conversión de un lead (migración 035 + leads/[id]/page.tsx), aquí
// también aparecen las interacciones registradas durante la etapa lead.
interface InteraccionResumen {
  id: string
  tipo: string
  descripcion: string
  fecha: string
}

type Tab = 'polizas' | 'siniestros' | 'tareas' | 'comercial' | 'portal' | 'comunicaciones'

// ── Helpers ──────────────────────────────────────────────────
function estadoPolizaBadge(p: PolizaResumen) {
  const dias = diasHastaVencimiento(p.fecha_fin)
  if (p.estado === 'VIGENTE' && dias >= 0 && dias <= 30) {
    return { label: `Vence en ${dias}d`, color: 'bg-orange-50 text-orange-700 border-orange-200' }
  }
  return { label: getLabelEstado(p.estado), color: getPolizaBadgeColor(p.estado) }
}

function prioridadBadge(p: string) {
  const map: Record<string, string> = {
    CRITICA: 'bg-red-50 text-red-700 border-red-200',
    ALTA:    'bg-orange-50 text-orange-700 border-orange-200',
    MEDIA:   'bg-amber-50 text-amber-700 border-amber-200',
    BAJA:    'bg-slate-100 text-slate-600 border-slate-200',
  }
  return map[p] ?? map.BAJA
}

// ── Componente principal ─────────────────────────────────────
export default function FichaPersonaPage() {
  const router   = useRouter()
  const params   = useParams()
  const id       = params.id as string
  const supabase = getSupabaseClient()
  const { usuario, isAdmin } = useAuth()

  const [persona,    setPersona]    = useState<Persona | null>(null)

  // Asignación de cliente a usuario (admin-only)
  const [usuariosLista, setUsuariosLista] = useState<Array<{ id: string; nombre: string; apellido: string }>>([])
  const [modalAsignar, setModalAsignar] = useState(false)
  const [usuarioElegidoAsignar, setUsuarioElegidoAsignar] = useState<string>('')
  const [asignandoLoading, setAsignandoLoading] = useState(false)
  const [polizas,    setPolizas]    = useState<PolizaResumen[]>([])
  // Toggle para incluir pólizas terminales (NO_VIGENTE/CANCELADA/ANULADA) en
  // la tabla del tab. Default false — se ocultan hasta que el PAS lo pida.
  const [mostrarPolizasHistoricas, setMostrarPolizasHistoricas] = useState(false)
  // Toggle equivalente para siniestros: por default ocultamos FINALIZADO/RECHAZADO.
  const [mostrarSiniestrosHistoricos, setMostrarSiniestrosHistoricos] = useState(false)
  const [siniestros, setSiniestros] = useState<SiniestroResumen[]>([])
  const [tareas,     setTareas]     = useState<TareaResumen[]>([])
  const [leadOrigen, setLeadOrigen] = useState<LeadOrigen | null>(null)
  const [oportunidades, setOportunidades] = useState<OportunidadResumen[]>([])
  const [cotizacionesCom, setCotizacionesCom] = useState<CotizacionResumen[]>([])
  const [interaccionesCom, setInteraccionesCom] = useState<InteraccionResumen[]>([])
  const [comunicacionesCount, setComunicacionesCount] = useState<number>(0)
  const [cargando,   setCargando]   = useState(true)
  const [tabActivo,  setTabActivo]  = useState<Tab>('polizas')

  // Email
  const [modalEmail, setModalEmail] = useState(false)
  const [comunicacionesActivo, setComunicacionesActivo] = useState(false)
  const [emailRefreshKey, setEmailRefreshKey] = useState(0)
  const { configurado: smtpConfigurado } = useEmailConfigurado()

  // Nueva póliza desde PDF
  const [modalPDFNuevaPoliza, setModalPDFNuevaPoliza] = useState(false)
  const { activo: moduloIAActivo } = useModuloIAPDF()

  // Portal del cliente
  const [portalAcceso, setPortalAcceso] = useState<any>(null)
  const [portalCargando, setPortalCargando] = useState(false)
  const [portalCopiado, setPortalCopiado] = useState(false)
  const [portalEnviando, setPortalEnviando] = useState(false)
  const [portalMensaje, setPortalMensaje] = useState('')

  // Eliminar
  const [modalEliminar, setModalEliminar] = useState(false)
  const [eliminarResumen, setEliminarResumen] = useState<any>(null)
  const [eliminarDetalle, setEliminarDetalle] = useState<{
    polizas: Array<{ numero_poliza: string; fecha_fin: string; estado: string }>
    siniestros: Array<{ numero_caso: string; fecha_denuncia: string; estado: string }>
  } | null>(null)
  const [eliminarError, setEliminarError] = useState('')
  const [eliminarConfirm, setEliminarConfirm] = useState('')
  const [eliminando, setEliminando] = useState(false)
  const [cargandoPreview, setCargandoPreview] = useState(false)

  // Papelera (soft delete)
  const [restaurando, setRestaurando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const [resPer, resPol, resSin] = await Promise.all([
      supabase.from('personas').select('*').eq('id', id).single(),
      supabase.from('polizas').select(`
        id, numero_poliza, fecha_inicio, fecha_fin, estado,
        compania:catalogos!compania_id (nombre),
        ramo:catalogos!ramo_id (nombre)
      `).eq('asegurado_id', id).order('fecha_fin', { ascending: false }),
      supabase.from('siniestros').select(`
        id, numero_caso, fecha_denuncia, estado, tipo_siniestro, monto_estimado
      `).eq('persona_id', id).is('deleted_at', null).order('fecha_denuncia', { ascending: false }),
    ])
    const resTar = await supabase.from('tareas').select(`
      id, titulo, fecha_vencimiento, prioridad, estado
    `).eq('persona_id', id).order('fecha_vencimiento', { ascending: false })
    // Commercial data — incluye interacciones migradas desde el lead
    // original (si la persona vino de una conversión).
    const [resLeadOr, resOps, resCots, resInts] = await Promise.all([
      supabase.from('leads').select('id, fuente, nivel_interes, created_at, fecha_conversion').eq('persona_id', id).limit(1).maybeSingle(),
      supabase.from('oportunidades').select('id, tipo, estado, descripcion, created_at').eq('persona_id', id).order('created_at', { ascending: false }),
      supabase.from('cotizaciones').select('id, numero_cotizacion, estado, created_at, ramo:catalogos!ramo_id(nombre), compania_ganadora:catalogos!compania_ganadora_id(nombre)').eq('persona_id', id).order('created_at', { ascending: false }),
      supabase.from('interacciones').select('id, tipo, descripcion, fecha').eq('persona_id', id).order('fecha', { ascending: false }),
    ])

    if (resPer.data) setPersona(resPer.data as Persona)
    if (resPol.data) setPolizas(resPol.data as unknown as PolizaResumen[])
    if (resSin.data) setSiniestros(resSin.data as unknown as SiniestroResumen[])
    if (resTar?.data) setTareas(resTar.data as unknown as TareaResumen[])
    setLeadOrigen(resLeadOr.data as unknown as LeadOrigen | null)
    setOportunidades((resOps.data ?? []) as unknown as OportunidadResumen[])
    setCotizacionesCom((resCots.data ?? []) as unknown as CotizacionResumen[])
    setInteraccionesCom((resInts.data ?? []) as unknown as InteraccionResumen[])

    // Count del tab Comunicaciones (head:true → solo cuenta, no trae rows).
    // Se hace después del Promise.all principal para no bloquear el paint
    // inicial; si falla, queda en 0.
    try {
      const { count } = await supabase
        .from('email_envios')
        .select('id', { count: 'exact', head: true })
        .eq('persona_id', id)
      setComunicacionesCount(count ?? 0)
    } catch {
      setComunicacionesCount(0)
    }

    setCargando(false)
  }, [supabase, id])

  useEffect(() => { cargar() }, [cargar])

  // Cargar lista de usuarios (admin) para el botón "Reasignar"
  useEffect(() => {
    if (!isAdmin) return
    apiCall<{ usuarios: Array<{ id: string; nombre: string; apellido: string; activo: boolean }> }>(
      '/api/usuarios',
      {},
      { mostrar_toast_en_error: false },
    ).then(r => {
      if (r.ok && r.data) {
        const u = (r.data as any).usuarios ?? []
        setUsuariosLista(u.filter((x: any) => x.activo !== false))
      }
    })
  }, [isAdmin])

  async function ejecutarReasignacion() {
    if (!persona) return
    setAsignandoLoading(true)
    const r = await apiCall('/api/personas/asignar', {
      method: 'POST',
      body: { ids: [persona.id], usuario_id: usuarioElegidoAsignar || null },
    }, { mostrar_toast_en_error: true })
    setAsignandoLoading(false)
    if (r.ok) {
      setModalAsignar(false)
      // Refrescar la persona desde DB
      const { data } = await supabase.from('personas').select('*').eq('id', persona.id).single()
      if (data) setPersona(data as Persona)
    }
  }

  // ── Portal del Cliente ─────────────────────────────────────
  const cargarPortal = useCallback(async () => {
    const r = await apiCall<any>(`/api/portal-cliente/acceso/${id}`, {}, { mostrar_toast_en_error: false })
    if (r.ok && r.data) setPortalAcceso(r.data)
  }, [id])

  useEffect(() => {
    if (tabActivo === 'portal') cargarPortal()
  }, [tabActivo, cargarPortal])

  // Carga inicial del estado del portal (independiente del tab activo) para
  // poder mostrar el check verde en el badge del tab sin esperar a que el
  // usuario lo abra.
  useEffect(() => {
    if (id) cargarPortal()
  }, [id, cargarPortal])

  async function portalGenerar() {
    setPortalCargando(true); setPortalMensaje('')
    const r = await apiCall<any>(`/api/portal-cliente/acceso/${id}`, { method: 'POST' }, { mostrar_toast_en_error: false })
    if (r.ok && r.data) {
      setPortalAcceso(r.data)
      toast.exito('Acceso al portal generado')
    } else {
      setPortalMensaje(r.error?.mensaje || 'No se pudo generar')
    }
    setPortalCargando(false)
  }

  async function portalRegenerar() {
    if (!confirm('Esto invalida el link actual. ¿Continuar?')) return
    setPortalCargando(true); setPortalMensaje('')
    const r = await apiCall<any>(`/api/portal-cliente/acceso/${id}`, { method: 'PATCH' }, { mostrar_toast_en_error: false })
    if (r.ok && r.data) {
      setPortalAcceso(r.data)
      toast.exito('Link regenerado')
    } else {
      setPortalMensaje(r.error?.mensaje || 'No se pudo regenerar')
    }
    setPortalCargando(false)
  }

  async function portalRevocar() {
    const motivo = prompt('Motivo de la revocación (opcional):') || undefined
    if (motivo === null) return
    setPortalCargando(true); setPortalMensaje('')
    const r = await apiCall(`/api/portal-cliente/acceso/${id}`, {
      method: 'DELETE',
      body: { motivo },
    }, { mostrar_toast_en_error: false })
    if (r.ok) {
      toast.exito('Acceso revocado')
      await cargarPortal()
    } else {
      setPortalMensaje(r.error?.mensaje || 'No se pudo revocar')
    }
    setPortalCargando(false)
  }

  async function portalReactivar() {
    if (!confirm('Se creará un nuevo link de acceso. ¿Continuar?')) return
    await portalGenerar()
    await cargarPortal()
  }

  async function portalCopiar() {
    const url = portalAcceso?.acceso?.url_completa
    if (!url) return
    const ok = await copiarAlPortapapeles(url)
    if (ok) {
      setPortalCopiado(true)
      setTimeout(() => setPortalCopiado(false), 2000)
    } else {
      toast.error('No se pudo copiar al portapapeles')
    }
  }

  async function portalEnviarEmail() {
    setPortalEnviando(true); setPortalMensaje('')
    const r = await apiCall(`/api/portal-cliente/acceso/${id}/enviar`, {
      method: 'POST',
      body: { metodo: 'email' },
    }, { mostrar_toast_en_error: false })
    if (r.ok) {
      setPortalMensaje('Email enviado correctamente')
      toast.exito('Email enviado')
    } else {
      setPortalMensaje(r.error?.mensaje || 'No se pudo enviar')
    }
    setPortalEnviando(false)
  }

  async function portalEnviarWhatsapp() {
    setPortalEnviando(true); setPortalMensaje('')
    const r = await apiCall<{ url_whatsapp?: string }>(`/api/portal-cliente/acceso/${id}/enviar`, {
      method: 'POST',
      body: { metodo: 'whatsapp' },
    }, { mostrar_toast_en_error: false })
    const url = (r.data as { url_whatsapp?: string } | undefined)?.url_whatsapp
    if (r.ok && url) window.open(url, '_blank')
    else setPortalMensaje(r.error?.mensaje || 'No se pudo armar el mensaje')
    setPortalEnviando(false)
  }

  useEffect(() => {
    apiCall<{ activo: boolean }>('/api/comunicaciones/estado', {}, { mostrar_toast_en_error: false })
      .then(r => { if (r.ok && r.data) setComunicacionesActivo(Boolean((r.data as any).activo)) })
  }, [])

  // ── Estados de carga / error ───────────────────────────────
  if (cargando) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando ficha del cliente...
      </div>
    )
  }

  if (!persona) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <span className="text-slate-400 text-sm">Cliente no encontrado</span>
        <button onClick={() => router.push('/crm/personas')} className="btn-secondary">
          <ArrowLeft className="h-3 w-3" /> Volver al listado
        </button>
      </div>
    )
  }

  // Control de acceso por cartera
  if (usuario && !tieneAccesoTotal(usuario) && (persona as any).usuario_id && (persona as any).usuario_id !== usuario.id) {
    router.replace('/crm/personas')
    return null
  }

  const nombre = nombreCompleto(persona.apellido, persona.nombre, persona.razon_social)
  const polizasVigentes   = polizas.filter(p => p.estado === 'VIGENTE').length
  const siniestrosAbiertos = siniestros.filter(s => !['FINALIZADO', 'RECHAZADO'].includes(s.estado)).length

  const abrirWhatsApp = async () => {
    const tel = persona.whatsapp ?? persona.telefono ?? ''
    if (!tel) return
    const url = await construirUrlWhatsapp('contacto_persona', tel, {
      nombre: persona.nombre || persona.apellido,
    })
    window.open(url, '_blank')
  }

  // ── Tabs config ────────────────────────────────────────────
  const comercialCount = oportunidades.length + cotizacionesCom.length + interaccionesCom.length
  const portalActivo = !!portalAcceso?.tiene_acceso
  const tabs: { key: Tab; label: string; count: number; icon: React.ReactNode; check?: boolean }[] = [
    { key: 'polizas',    label: 'Pólizas',    count: polizas.length,    icon: <Shield className="h-3 w-3" /> },
    { key: 'siniestros', label: 'Siniestros',  count: siniestros.length, icon: <AlertTriangle className="h-3 w-3" /> },
    { key: 'tareas',     label: 'Tareas',      count: tareas.length,     icon: <ClipboardList className="h-3 w-3" /> },
    { key: 'comercial',  label: 'Comercial',   count: comercialCount,    icon: <Briefcase className="h-3 w-3" /> },
    { key: 'portal',     label: 'Portal',      count: 0,                 icon: <Globe className="h-3 w-3" />, check: portalActivo },
    { key: 'comunicaciones', label: 'Comunicaciones', count: comunicacionesCount, icon: <Mail className="h-3 w-3" /> },
  ]

  const enPapelera = !!(persona as any).deleted_at
  const diasParaPurga = enPapelera
    ? Math.max(0, 30 - Math.floor((Date.now() - new Date((persona as any).deleted_at).getTime()) / 86400000))
    : null

  async function restaurarPersona() {
    setRestaurando(true)
    const r = await apiCall(`/api/personas/${id}/restaurar`, { method: 'POST' }, { mostrar_toast_en_error: false })
    setRestaurando(false)
    if (r.ok) {
      toast.exito('Cliente restaurado')
      cargar()
    } else {
      toast.error(r.error ?? { mensaje: 'No se pudo restaurar' })
    }
  }

  return (
    <div className="flex flex-col gap-4">

      {/* Banner papelera */}
      {enPapelera && (
        <div className="bg-amber-50 border border-amber-300 rounded p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-amber-900">
            <Trash2 className="h-4 w-4 text-amber-700 shrink-0" />
            <span>
              <strong>{nombre}</strong> está en la papelera desde{' '}
              {formatFecha((persona as any).deleted_at)}.
              Faltan <strong>{diasParaPurga}</strong> día{diasParaPurga !== 1 ? 's' : ''} para la eliminación definitiva.
            </span>
          </div>
          <button
            onClick={restaurarPersona}
            disabled={restaurando}
            className="btn-primary flex items-center gap-1.5 disabled:opacity-50"
          >
            {restaurando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {restaurando ? 'Restaurando...' : 'Restaurar'}
          </button>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/crm/personas')} className="btn-secondary h-8 w-8 p-0 flex items-center justify-center" title="Volver al listado">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-slate-800">{nombre}</h1>
              <span
                className={getBadgeClase(persona.estado)}
                title={getTooltipEstado(persona.estado) || undefined}
              >
                {getLabelEstado(persona.estado)}
              </span>
            </div>
            <p className="text-xs text-slate-500 flex items-center gap-2 mt-0.5 flex-wrap">
              {persona.tipo_persona === 'JURIDICA'
                ? <><Building2 className="h-3 w-3" /> Persona Jurídica</>
                : <><User className="h-3 w-3" /> Persona Física</>}
              {persona.dni_cuil && (
                <> · <span>
                  <span className="text-slate-400 mr-1">
                    {persona.tipo_persona === 'JURIDICA'
                      ? 'CUIT'
                      : (persona.dni_cuil.replace(/\D/g, '').length === 11 ? 'CUIL' : 'DNI')}
                  </span>
                  <span className="font-mono">{persona.cuil_formateado ?? persona.dni_cuil}</span>
                </span></>
              )}
              {persona.tipo_persona === 'FISICA' && (persona as any).fecha_nacimiento && (
                <> · <span className="text-slate-400">Nacimiento:</span> <span className="font-mono">{new Date((persona as any).fecha_nacimiento + 'T00:00:00').toLocaleDateString('es-AR')}</span></>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PresenciaEnFicha tipoEntidad="persona" entidadId={id} />
          {(persona.whatsapp || persona.telefono) && (
            <button onClick={abrirWhatsApp} className="btn-secondary">
              <MessageCircle className="h-3 w-3" /> WhatsApp
            </button>
          )}
          {(() => {
            const sinEmail = !persona.email
            const sinSmtp = !smtpConfigurado
            const moduloOff = !comunicacionesActivo
            const deshabilitado = sinEmail || sinSmtp || moduloOff
            let tooltip = 'Enviar un email a este cliente'
            if (sinSmtp)        tooltip = 'Configurá el servidor SMTP en Configuración → Correos para empezar a enviar emails'
            else if (moduloOff) tooltip = 'El sistema de comunicaciones está desactivado en Configuración → Comunicaciones'
            else if (sinEmail)  tooltip = 'Este cliente no tiene email cargado'
            return (
              <button
                onClick={() => setModalEmail(true)}
                disabled={deshabilitado}
                title={tooltip}
                className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="h-3 w-3" /> Email
              </button>
            )
          })()}
          <button onClick={() => router.push(`/crm/personas/${id}/editar`)} className="btn-primary">
            <Edit className="h-3 w-3" /> Editar
          </button>
          {puedeEliminar(usuario) && !enPapelera && (
            <button
              onClick={async () => {
                setCargandoPreview(true); setEliminarError(''); setEliminarResumen(null); setEliminarDetalle(null); setEliminarConfirm('')
                try {
                  const r = await apiCall<{ resumen: any; detalle: any }>(`/api/personas/${id}?preview=true`, {}, { mostrar_toast_en_error: false })
                  if (!r.ok) {
                    setEliminarError(r.error?.mensaje ?? 'No se puede eliminar')
                  } else {
                    const payload = r.data as { resumen?: any; detalle?: any } | undefined
                    if (payload?.resumen) setEliminarResumen(payload.resumen)
                    if (payload?.detalle) setEliminarDetalle(payload.detalle)
                  }
                } catch { setEliminarError('Error al verificar') }
                setCargandoPreview(false)
                setModalEliminar(true)
              }}
              disabled={cargandoPreview}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-red-300 text-red-600 text-xs font-medium hover:bg-red-50 transition-colors">
              {cargandoPreview ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Eliminar
            </button>
          )}
        </div>
      </div>

      {/* ── KPIs rápidos ────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-2">
        <div className="kpi-card bg-blue-50 border-blue-200">
          <span className="kpi-label flex items-center gap-1"><Shield className="h-3 w-3 text-blue-500" /> Pólizas</span>
          <span className="kpi-value text-blue-700">{polizas.length}</span>
          <span className="kpi-sub">{polizasVigentes} vigente{polizasVigentes !== 1 ? 's' : ''}</span>
        </div>
        <div className="kpi-card bg-amber-50 border-amber-200">
          <span className="kpi-label flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-500" /> Siniestros</span>
          <span className="kpi-value text-amber-700">{siniestros.length}</span>
          <span className="kpi-sub">{siniestrosAbiertos} abierto{siniestrosAbiertos !== 1 ? 's' : ''}</span>
        </div>
        <div className="kpi-card bg-violet-50 border-violet-200">
          <span className="kpi-label flex items-center gap-1"><ClipboardList className="h-3 w-3 text-violet-500" /> Tareas</span>
          <span className="kpi-value text-violet-700">{tareas.length}</span>
          <span className="kpi-sub">pendiente{tareas.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="kpi-card bg-slate-50 border-slate-200">
          <span className="kpi-label flex items-center gap-1"><Calendar className="h-3 w-3 text-slate-500" /> Cliente desde</span>
          <span className="kpi-value text-slate-700 text-base">{formatFecha(persona.fecha_alta)}</span>
          <span className="kpi-sub">{persona.origen ?? '—'}</span>
        </div>
      </div>

      {/* ── Layout 2 columnas ───────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">

        {/* ── Columna izquierda: datos personales ───────────── */}
        <div className="flex flex-col gap-3">

          {/* Contacto */}
          <div className="bg-white border border-slate-200 rounded p-3">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Contacto</h2>
            <div className="flex flex-col gap-2 text-sm">
              {persona.telefono && (
                <div className="flex items-center gap-2 text-slate-700">
                  <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span>{persona.telefono}</span>
                </div>
              )}
              {persona.whatsapp && (
                <div className="flex items-center gap-2 text-green-700">
                  <MessageCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                  <span>{persona.whatsapp}</span>
                </div>
              )}
              {persona.telefono_secundario && (
                <div className="flex items-center gap-2 text-slate-500">
                  <Phone className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                  <span>{persona.telefono_secundario}</span>
                </div>
              )}
              {persona.email && (
                <div className="flex items-center gap-2 text-slate-700">
                  <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{persona.email}</span>
                </div>
              )}
              {persona.email_secundario && (
                <div className="flex items-center gap-2 text-slate-500">
                  <Mail className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                  <span className="truncate">{persona.email_secundario}</span>
                </div>
              )}
              {!persona.telefono && !persona.whatsapp && !persona.email && (
                <span className="text-xs text-slate-500">Sin datos de contacto</span>
              )}
            </div>
          </div>

          {/* Domicilio */}
          <div className="bg-white border border-slate-200 rounded p-3">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Domicilio</h2>
            {persona.calle ? (
              <div className="flex items-start gap-2 text-sm text-slate-700">
                <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <p>{persona.calle} {persona.numero}{persona.piso_depto ? `, ${persona.piso_depto}` : ''}</p>
                  {persona.barrio && <p className="text-slate-500">{persona.barrio}</p>}
                  <p className="text-slate-500">
                    {[persona.localidad, persona.provincia].filter(Boolean).join(', ')}
                    {persona.codigo_postal ? ` (${persona.codigo_postal})` : ''}
                  </p>
                </div>
              </div>
            ) : (
              <span className="text-xs text-slate-500">Sin domicilio cargado</span>
            )}
          </div>

          {/* Datos adicionales */}
          <div className="bg-white border border-slate-200 rounded p-3">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Información</h2>
            <div className="flex flex-col gap-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Segmento</span>
                <span className="text-slate-700 font-medium">{persona.segmento ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Canal preferido</span>
                <span className="text-slate-700 font-medium">{persona.canal_preferido ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Marketing</span>
                <span className="text-slate-700 font-medium">{persona.acepta_marketing ? 'Acepta' : 'No acepta'}</span>
              </div>
              {persona.fecha_baja && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Fecha baja</span>
                  <span className="text-red-600 font-medium">{formatFecha(persona.fecha_baja)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Asignación (admin-only). Si hay 0 o 1 usuario en el sistema, no
              tiene sentido mostrarlo — la asignación no agrega información. */}
          {isAdmin && usuariosLista.length > 1 && (
            <div className="bg-white border border-slate-200 rounded p-3">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Asignación</h2>
                <button
                  onClick={() => {
                    setUsuarioElegidoAsignar((persona as any).usuario_id ?? '')
                    setModalAsignar(true)
                  }}
                  className="text-2xs text-blue-600 hover:underline"
                >
                  Reasignar
                </button>
              </div>
              {(persona as any).usuario_id ? (
                <span className="text-xs text-slate-700 font-medium">
                  {usuariosLista.find(u => u.id === (persona as any).usuario_id)
                    ? `${usuariosLista.find(u => u.id === (persona as any).usuario_id)!.apellido}, ${usuariosLista.find(u => u.id === (persona as any).usuario_id)!.nombre}`.replace(/^,\s*/, '')
                    : 'Usuario no encontrado'}
                </span>
              ) : (
                <span className="text-xs text-amber-600 italic">Sin asignar</span>
              )}
            </div>
          )}

          {persona.datos_extra && Object.keys(persona.datos_extra).length > 0 && (
            <div className="bg-white border border-slate-200 rounded p-3">
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Datos extra</h2>
              <div className="flex flex-col gap-1">
                {Object.entries(persona.datos_extra).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-slate-500">{k}</span>
                    <span className="text-slate-700 font-medium">{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Columna derecha: tabs ─────────────────────────── */}
        <div className="col-span-2 flex flex-col gap-3">

          {/* Tab bar */}
          <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTabActivo(t.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all ${
                  tabActivo === t.key
                    ? 'bg-white shadow-sm font-medium text-slate-700'
                    : 'text-slate-500 hover:text-slate-700'
                }`}>
                {t.icon} {t.label}
                {t.check ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 ml-0.5" aria-label="Acceso activo" />
                ) : (
                  <span className="font-mono text-slate-500 ml-0.5">{t.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* ── Tab: Pólizas ──────────────────────────────── */}
          {tabActivo === 'polizas' && (() => {
            // Filtro client-side: por default ocultamos NO_VIGENTE/CANCELADA/ANULADA.
            // El PAS puede tildar el toggle para verlas.
            const terminales = ['NO_VIGENTE', 'CANCELADA', 'ANULADA']
            const polizasVisibles = mostrarPolizasHistoricas
              ? polizas
              : polizas.filter(p => !terminales.includes(p.estado))
            const cantHistoricas = polizas.length - polizas.filter(p => !terminales.includes(p.estado)).length

            return (
            <div className="bg-white border border-slate-200 rounded overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">
                    {polizasVisibles.length} póliza{polizasVisibles.length !== 1 ? 's' : ''}
                    {cantHistoricas > 0 && !mostrarPolizasHistoricas && (
                      <span className="text-2xs text-slate-400 ml-1">({cantHistoricas} histórica{cantHistoricas !== 1 ? 's' : ''} oculta{cantHistoricas !== 1 ? 's' : ''})</span>
                    )}
                  </span>
                  {cantHistoricas > 0 && (
                    <label className="inline-flex items-center gap-1 text-2xs text-slate-500 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={mostrarPolizasHistoricas}
                        onChange={e => setMostrarPolizasHistoricas(e.target.checked)}
                        className="h-3 w-3 cursor-pointer"
                      />
                      Mostrar históricas
                    </label>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => router.push(`/crm/polizas/nueva?persona_id=${id}`)}
                    className="text-xs text-blue-600 hover:underline">+ Nueva póliza</button>
                  {moduloIAActivo && (
                    <button onClick={() => setModalPDFNuevaPoliza(true)}
                      className="text-xs text-blue-600 hover:underline flex items-center gap-0.5">
                      <Sparkles className="h-3 w-3" /> Desde PDF
                    </button>
                  )}
                </div>
              </div>
              {polizasVisibles.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500">
                  {polizas.length === 0
                    ? 'No tiene pólizas asociadas'
                    : 'No tiene pólizas activas — tildá "Mostrar históricas" para ver las anteriores'}
                </div>
              ) : (
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Nro. Póliza</th>
                      <th>Compañía</th>
                      <th>Ramo</th>
                      <th>Vigencia</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {polizasVisibles.map(p => {
                      const badge = estadoPolizaBadge(p)
                      const vencida = terminales.includes(p.estado)
                      return (
                        <tr key={p.id} className={`${vencida ? 'opacity-55' : ''} cursor-pointer hover:bg-slate-50`} onClick={() => router.push(`/crm/polizas/${p.id}`)}>
                          <td className="font-mono text-xs font-semibold text-blue-600 hover:underline">{p.numero_poliza}</td>
                          <td className="text-xs text-slate-600">{p.compania?.nombre ?? '—'}</td>
                          <td className="text-xs text-slate-600">{p.ramo?.nombre ?? '—'}</td>
                          <td className="text-xs text-slate-600 whitespace-nowrap">
                            {formatFechaLocal(p.fecha_inicio)} → {formatFechaLocal(p.fecha_fin)}
                          </td>
                          <td>
                            <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${badge.color}`}>
                              {badge.label}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
            )
          })()}

          {/* ── Tab: Siniestros ───────────────────────────── */}
          {tabActivo === 'siniestros' && (() => {
            const terminalesSin = ['FINALIZADO', 'RECHAZADO']
            const siniestrosVisibles = mostrarSiniestrosHistoricos
              ? siniestros
              : siniestros.filter(s => !terminalesSin.includes(s.estado))
            const cantHistoricosSin = siniestros.length - siniestros.filter(s => !terminalesSin.includes(s.estado)).length

            return (
            <div className="bg-white border border-slate-200 rounded overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">
                    {siniestrosVisibles.length} siniestro{siniestrosVisibles.length !== 1 ? 's' : ''}
                    {cantHistoricosSin > 0 && !mostrarSiniestrosHistoricos && (
                      <span className="text-2xs text-slate-400 ml-1">({cantHistoricosSin} histórico{cantHistoricosSin !== 1 ? 's' : ''} oculto{cantHistoricosSin !== 1 ? 's' : ''})</span>
                    )}
                  </span>
                  {cantHistoricosSin > 0 && (
                    <label className="inline-flex items-center gap-1 text-2xs text-slate-500 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={mostrarSiniestrosHistoricos}
                        onChange={e => setMostrarSiniestrosHistoricos(e.target.checked)}
                        className="h-3 w-3 cursor-pointer"
                      />
                      Mostrar históricos
                    </label>
                  )}
                </div>
                <button onClick={() => router.push(`/crm/siniestros/nuevo?persona_id=${id}`)}
                  className="text-xs text-blue-600 hover:underline">+ Nuevo siniestro</button>
              </div>
              {siniestrosVisibles.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500">
                  {siniestros.length === 0
                    ? 'No tiene siniestros registrados'
                    : 'No tiene siniestros en curso — tildá "Mostrar históricos" para ver los finalizados/rechazados'}
                </div>
              ) : (
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Nro. Siniestro</th>
                      <th>Fecha</th>
                      <th>Tipo</th>
                      <th className="text-right">Monto est.</th>
                      <th>Estado</th>
                      <th style={{ width: 50 }}>Ver</th>
                    </tr>
                  </thead>
                  <tbody>
                    {siniestrosVisibles.map(s => {
                      const cerrado = terminalesSin.includes(s.estado)
                      return (
                      <tr key={s.id} className={cerrado ? 'opacity-55' : ''}>
                        <td className="font-mono text-xs font-semibold text-slate-700">{s.numero_caso}</td>
                        <td className="text-xs text-slate-600">{formatFecha(s.fecha_denuncia)}</td>
                        <td className="text-xs text-slate-600">{s.tipo_siniestro?.replace(/_/g, ' ') ?? '—'}</td>
                        <td className="text-xs text-right font-mono text-slate-700">{formatMoneda(s.monto_estimado)}</td>
                        <td><span className={getBadgeClase(s.estado)}>{getLabelEstado(s.estado)}</span></td>
                        <td>
                          <button onClick={() => router.push(`/crm/siniestros/${s.id}`)}
                            className="btn-tabla-accion">
                            <Eye />
                          </button>
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
            )
          })()}

          {/* ── Tab: Tareas ───────────────────────────────── */}
          {tabActivo === 'tareas' && (
            <div className="bg-white border border-slate-200 rounded overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50">
                <span className="text-xs text-slate-500">{tareas.length} tarea{tareas.length !== 1 ? 's' : ''}</span>
                <button onClick={() => router.push(`/crm/tareas/nueva?persona_id=${id}`)}
                  className="text-xs text-blue-600 hover:underline">+ Nueva tarea</button>
              </div>
              {tareas.length === 0 ? (
                <div className="text-center py-8 text-xs text-slate-500">No tiene tareas asociadas</div>
              ) : (
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Tarea</th>
                      <th>Vencimiento</th>
                      <th>Prioridad</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tareas.map(t => {
                      const vencida = t.fecha_vencimiento <= hoyLocal() && ['PENDIENTE', 'EN_PROCESO'].includes(t.estado)
                      const estadoTareaBadge: Record<string, { label: string; color: string }> = {
                        PENDIENTE:  { label: 'Pendiente',  color: 'bg-blue-50 text-blue-700 border-blue-200' },
                        EN_PROCESO: { label: 'En proceso', color: 'bg-amber-50 text-amber-700 border-amber-200' },
                        COMPLETADA: { label: 'Completada', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                        CANCELADA:  { label: 'Cancelada',  color: 'bg-slate-100 text-slate-600 border-slate-200' },
                      }
                      const eBadge = estadoTareaBadge[t.estado] ?? estadoTareaBadge.PENDIENTE
                      return (
                        <tr key={t.id} className={`cursor-pointer hover:bg-slate-50 ${t.estado === 'COMPLETADA' || t.estado === 'CANCELADA' ? 'opacity-55' : ''}`}
                          onClick={() => router.push(`/crm/tareas/${t.id}`)}>
                          <td className="text-xs text-slate-700 font-medium">{t.titulo}</td>
                          <td className={`text-xs whitespace-nowrap ${vencida ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>
                            {formatFecha(t.fecha_vencimiento)}
                          </td>
                          <td>
                            <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${prioridadBadge(t.prioridad)}`}>
                              {t.prioridad}
                            </span>
                          </td>
                          <td>
                            <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${eBadge.color}`}>
                              {eBadge.label}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Tab: Historial Comercial ────────────────── */}
          {tabActivo === 'comercial' && (
            <div className="flex flex-col gap-3">

              {/* Origen: Lead */}
              {leadOrigen && (
                <div className="bg-white border border-slate-200 rounded overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-100 bg-cyan-50">
                    <span className="text-xs font-semibold text-cyan-700 flex items-center gap-1.5">
                      <Target className="h-3 w-3"/> Cliente originado por lead
                    </span>
                  </div>
                  <div className="p-3 flex flex-col gap-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Fuente original</span>
                      <span className="text-slate-700 font-medium">{leadOrigen.fuente.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Nivel de interes</span>
                      <span className="text-slate-700 font-medium">{leadOrigen.nivel_interes}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Primer contacto</span>
                      <span className="text-slate-700">{formatFecha(leadOrigen.created_at)}</span>
                    </div>
                    {leadOrigen.fecha_conversion && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Fecha conversion</span>
                        <span className="text-slate-700">{formatFecha(leadOrigen.fecha_conversion)}</span>
                      </div>
                    )}
                    <button onClick={() => router.push(`/crm/comercial/leads/${leadOrigen.id}`)}
                      className="text-xs text-blue-600 hover:underline mt-1 flex items-center gap-1 self-start">
                      <ExternalLink className="h-3 w-3"/> Ver lead original
                    </button>
                  </div>
                </div>
              )}

              {/* Oportunidades */}
              <div className="bg-white border border-slate-200 rounded overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50">
                  <span className="text-xs text-slate-500">{oportunidades.length} oportunidad{oportunidades.length !== 1 ? 'es' : ''}</span>
                  <button onClick={() => router.push(`/crm/comercial/oportunidades/nueva?persona_id=${id}`)}
                    className="text-xs text-blue-600 hover:underline">+ Nueva oportunidad</button>
                </div>
                {oportunidades.length === 0 ? (
                  <div className="text-center py-6 text-xs text-slate-500">No tiene oportunidades comerciales</div>
                ) : (
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Tipo</th>
                        <th>Estado</th>
                        <th>Descripcion</th>
                        <th style={{ width: 50 }}>Ver</th>
                      </tr>
                    </thead>
                    <tbody>
                      {oportunidades.map(o => {
                        const cerrada = o.estado === 'GANADA' || o.estado === 'PERDIDA'
                        const estadoColor: Record<string, string> = {
                          DETECTADA: 'bg-blue-50 text-blue-700 border-blue-200',
                          CONTACTADO: 'bg-amber-50 text-amber-700 border-amber-200',
                          NEGOCIACION: 'bg-violet-50 text-violet-700 border-violet-200',
                          GANADA: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                          PERDIDA: 'bg-red-50 text-red-700 border-red-200',
                        }
                        return (
                          <tr key={o.id} className={`${cerrada ? 'opacity-55' : ''} cursor-pointer hover:bg-slate-50`}
                            onClick={() => router.push(`/crm/comercial/oportunidades/${o.id}`)}>
                            <td className="text-xs text-slate-600">{formatFecha(o.created_at)}</td>
                            <td className="text-xs text-slate-700 font-medium">{o.tipo.replace(/_/g, ' ')}</td>
                            <td><span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${estadoColor[o.estado] ?? ''}`}>{o.estado}</span></td>
                            <td className="text-xs text-slate-600 max-w-[200px] truncate">{o.descripcion ?? '—'}</td>
                            <td>
                              <button
                                className="btn-tabla-accion"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  router.push(`/crm/comercial/oportunidades/${o.id}`)
                                }}
                                title="Ver oportunidad"
                              >
                                <Eye />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Cotizaciones */}
              <div className="bg-white border border-slate-200 rounded overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50">
                  <span className="text-xs text-slate-500">{cotizacionesCom.length} cotizacion{cotizacionesCom.length !== 1 ? 'es' : ''}</span>
                  <button onClick={() => router.push(`/crm/comercial/cotizaciones/nueva?persona_id=${id}`)}
                    className="text-xs text-blue-600 hover:underline">+ Nueva cotizacion</button>
                </div>
                {cotizacionesCom.length === 0 ? (
                  <div className="text-center py-6 text-xs text-slate-500">No tiene cotizaciones</div>
                ) : (
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th>Numero</th>
                        <th>Fecha</th>
                        <th>Ramo</th>
                        <th>Estado</th>
                        <th>Ganadora</th>
                        <th style={{ width: 50 }}>Ver</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cotizacionesCom.map(c => {
                        const cerrada = c.estado === 'GANADA' || c.estado === 'PERDIDA'
                        const estadoColor: Record<string, string> = {
                          BORRADOR: 'bg-slate-100 text-slate-600 border-slate-200',
                          ENVIADA: 'bg-blue-50 text-blue-700 border-blue-200',
                          EN_PROCESO: 'bg-amber-50 text-amber-700 border-amber-200',
                          GANADA: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                          PERDIDA: 'bg-red-50 text-red-700 border-red-200',
                        }
                        return (
                          <tr key={c.id} className={`${cerrada ? 'opacity-55' : ''} cursor-pointer hover:bg-slate-50`}
                            onClick={() => router.push(`/crm/comercial/cotizaciones/${c.id}`)}>
                            <td className="text-xs font-mono font-semibold text-blue-600">{c.numero_cotizacion}</td>
                            <td className="text-xs text-slate-600">{formatFecha(c.created_at)}</td>
                            <td className="text-xs text-slate-600">{c.ramo?.nombre ?? '—'}</td>
                            <td><span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${estadoColor[c.estado] ?? ''}`}>{c.estado}</span></td>
                            <td className="text-xs text-emerald-600 font-medium">{c.compania_ganadora?.nombre ?? '—'}</td>
                            <td>
                              <button
                                className="btn-tabla-accion"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  router.push(`/crm/comercial/cotizaciones/${c.id}`)
                                }}
                                title="Ver cotización"
                              >
                                <Eye />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Historial de interacciones (migrado desde el lead, si aplica) */}
              {interaccionesCom.length > 0 && (
                <div className="bg-white border border-slate-200 rounded overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50">
                    <span className="text-xs text-slate-500">
                      {interaccionesCom.length} interaccion{interaccionesCom.length !== 1 ? 'es' : ''}
                    </span>
                    {leadOrigen && (
                      <span className="text-2xs text-slate-400">Migradas desde el lead original</span>
                    )}
                  </div>
                  <div className="divide-y divide-slate-100">
                    {interaccionesCom.map(i => {
                      const tipoColor: Record<string, string> = {
                        LLAMADA:  'text-blue-600',
                        EMAIL:    'text-amber-600',
                        WHATSAPP: 'text-emerald-600',
                        REUNION:  'text-violet-600',
                        NOTA:     'text-slate-500',
                      }
                      return (
                        <div key={i.id} className="px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className={`text-xs font-medium ${tipoColor[i.tipo] ?? 'text-slate-500'}`}>
                              {i.tipo}
                            </span>
                            <span className="text-2xs text-slate-400">{formatFecha(i.fecha)}</span>
                          </div>
                          <p className="text-xs text-slate-700 mt-0.5 whitespace-pre-wrap break-words">
                            {i.descripcion}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {!leadOrigen && oportunidades.length === 0 && cotizacionesCom.length === 0 && interaccionesCom.length === 0 && (
                <div className="text-center py-10 text-xs text-slate-500">
                  Este cliente no tiene historial comercial aun
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Portal del Asegurado ────────────────────── */}
          {tabActivo === 'portal' && (
            <div className="flex flex-col gap-3">
              {portalMensaje && (
                <div className="text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded px-3 py-2">
                  {portalMensaje}
                </div>
              )}

              {!portalAcceso?.tiene_acceso && !portalAcceso?.ultimo_revocado && (
                <div className="bg-white border border-slate-200 rounded-lg p-6 flex flex-col items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center">
                    <Globe className="h-5 w-5 text-slate-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-slate-700">Este asegurado no tiene acceso al portal</p>
                    <p className="text-2xs text-slate-500 mt-1">
                      Generá un link permanente para que el asegurado pueda ver sus pólizas, siniestros y teléfonos de asistencia.
                    </p>
                  </div>
                  <button
                    onClick={portalGenerar}
                    disabled={portalCargando}
                    className="btn-primary"
                  >
                    {portalCargando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
                    Generar acceso al portal
                  </button>
                </div>
              )}

              {portalAcceso?.tiene_acceso && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-5 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-semibold text-green-800">Acceso activo</span>
                    </div>
                    <div className="flex items-center gap-3 text-2xs text-green-700">
                      <span>Generado: {formatFecha(portalAcceso.acceso.fecha_creacion)}</span>
                      <span>·</span>
                      <span>{portalAcceso.acceso.veces_accedido} acceso{portalAcceso.acceso.veces_accedido !== 1 ? 's' : ''}</span>
                      <span>·</span>
                      <span>
                        Último: {portalAcceso.acceso.ultimo_acceso ? formatFecha(portalAcceso.acceso.ultimo_acceso) : 'Nunca'}
                      </span>
                    </div>
                  </div>

                  {portalAcceso.acceso.url_completa ? (
                    <div className="flex gap-2">
                      <div className="flex-1 bg-white border border-green-300 rounded px-3 py-2 text-xs font-mono text-slate-700 select-all break-all">
                        {portalAcceso.acceso.url_completa}
                      </div>
                      <button
                        onClick={portalCopiar}
                        className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 whitespace-nowrap"
                      >
                        {portalCopiado ? <><Check className="h-3 w-3" /> Copiado</> : <><Copy className="h-3 w-3" /> Copiar</>}
                      </button>
                    </div>
                  ) : (
                    <div className="bg-white border border-amber-200 rounded px-3 py-2 text-xs text-slate-600 leading-relaxed">
                      Este link se generó antes de la última actualización y no se puede recuperar visualmente.
                      Sigue funcionando para el asegurado. Si necesitás verlo de nuevo, regenerá uno nuevo
                      (el anterior dejará de funcionar).
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={portalEnviarEmail}
                      disabled={portalEnviando || !persona.email}
                      title={!persona.email ? 'El cliente no tiene email cargado' : 'Enviar por email'}
                      className="btn-secondary disabled:opacity-50"
                    >
                      <Mail className="h-3 w-3" /> Enviar por email
                    </button>
                    <button
                      onClick={portalEnviarWhatsapp}
                      disabled={portalEnviando || (!persona.whatsapp && !persona.telefono)}
                      title={!persona.whatsapp && !persona.telefono ? 'Sin teléfono cargado' : 'Enviar por WhatsApp'}
                      className="btn-secondary disabled:opacity-50"
                    >
                      <MessageCircle className="h-3 w-3" /> Enviar por WhatsApp
                    </button>
                    <button
                      onClick={portalRegenerar}
                      disabled={portalCargando}
                      className="btn-secondary"
                    >
                      <RefreshCw className="h-3 w-3" /> Regenerar link
                    </button>
                    <div className="flex-1" />
                    <button
                      onClick={portalRevocar}
                      disabled={portalCargando}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded border border-red-300 text-red-600 text-xs font-medium hover:bg-red-50"
                    >
                      <Ban className="h-3 w-3" /> Revocar acceso
                    </button>
                  </div>
                </div>
              )}

              {!portalAcceso?.tiene_acceso && portalAcceso?.ultimo_revocado && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-5 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Ban className="h-4 w-4 text-red-600" />
                    <span className="text-sm font-semibold text-red-800">Acceso revocado</span>
                  </div>
                  <div className="text-2xs text-red-700 flex flex-col gap-0.5">
                    <span>Revocado el {formatFecha(portalAcceso.ultimo_revocado.fecha_revocacion)}</span>
                    {portalAcceso.ultimo_revocado.motivo_revocacion && (
                      <span>Motivo: {portalAcceso.ultimo_revocado.motivo_revocacion}</span>
                    )}
                  </div>
                  <div>
                    <button
                      onClick={portalReactivar}
                      disabled={portalCargando}
                      className="btn-primary"
                    >
                      <RefreshCw className="h-3 w-3" /> Re-activar acceso
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Comunicaciones ──────────────────────── */}
          {tabActivo === 'comunicaciones' && (
            <ComunicacionesTab persona_id={id} refreshKey={emailRefreshKey} />
          )}

        </div>
      </div>

      {/* ── Historial / Bitácora ──────────────────────────────── */}
      <HistorialPersona personaId={id} />

      {/* ── Modal Reasignar usuario ──────────────────────────── */}
      {modalAsignar && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setModalAsignar(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-800">Reasignar cliente</h3>
              <p className="text-2xs text-slate-500 mt-0.5">Elegí a qué usuario asignás este cliente. Sus pólizas heredan automáticamente la asignación.</p>
            </div>
            <div className="px-4 py-3 flex flex-col gap-2">
              <label className="text-xs text-slate-600">Asignado a</label>
              <select
                className="form-input text-xs"
                value={usuarioElegidoAsignar}
                onChange={e => setUsuarioElegidoAsignar(e.target.value)}
              >
                <option value="">Sin asignar</option>
                {usuariosLista.map(u => (
                  <option key={u.id} value={u.id}>{`${u.apellido}, ${u.nombre}`.replace(/^,\s*/, '')}</option>
                ))}
              </select>
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
              <button onClick={() => setModalAsignar(false)} className="btn-secondary text-xs px-3 py-1.5">Cancelar</button>
              <button onClick={ejecutarReasignacion} disabled={asignandoLoading} className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50">
                {asignandoLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Enviar Email ────────────────────────────────── */}
      <ModalEnviarEmail
        isOpen={modalEmail}
        onClose={() => setModalEmail(false)}
        persona={{
          id: persona.id,
          nombre: persona.nombre || '',
          apellido: persona.apellido,
          email: persona.email || null,
          acepta_marketing: persona.acepta_marketing,
        }}
        onSuccess={() => setEmailRefreshKey(k => k + 1)}
      />

      {/* ── Modal Nueva póliza desde PDF ─────────────────────── */}
      <ModalUploadPDF
        abierto={modalPDFNuevaPoliza}
        onCerrar={() => setModalPDFNuevaPoliza(false)}
        tipo_operacion="POLIZA_NUEVA"
        persona_preseleccionada_id={persona.id}
        persona_preseleccionada_info={{
          id: persona.id,
          dni_cuil: persona.dni_cuil,
          nombre_completo: persona.razon_social || [persona.apellido, persona.nombre].filter(Boolean).join(', '),
        }}
      />

      {/* ── Modal Eliminar ───────────────────────────────────── */}
      {modalEliminar && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setModalEliminar(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 rounded-t-lg border-b bg-red-50 border-red-200">
              <div className="flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-red-600" />
                <h3 className="text-sm font-semibold text-red-800">Eliminar cliente</h3>
              </div>
              <button onClick={() => setModalEliminar(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              {eliminarError ? (
                <>
                  <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-3">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{eliminarError}</span>
                  </div>
                </>
              ) : eliminarResumen ? (
                <>
                  <p className="text-xs text-slate-600">
                    <strong>{nombre}</strong> se moverá a la papelera. Tenés <strong>30 días</strong> para deshacerlo
                    desde la propia ficha. Pasado ese plazo se eliminará definitivamente con todo lo asociado.
                  </p>
                  {(eliminarResumen.polizas > 0 || eliminarResumen.siniestros > 0 || eliminarResumen.tareas > 0 || eliminarResumen.oportunidades > 0 || eliminarResumen.cotizaciones > 0 || (eliminarResumen.archivos_polizas + eliminarResumen.archivos_siniestros) > 0) ? (
                    <div className="bg-slate-50 border border-slate-200 rounded p-3 flex flex-col gap-1.5">
                      <p className="text-2xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Se eliminará al purgar:</p>
                      {eliminarResumen.polizas > 0 && (
                        <div className="flex items-center gap-2 text-xs text-slate-700">
                          <FileText className="h-3 w-3 text-slate-400" /> {eliminarResumen.polizas} póliza(s)
                        </div>
                      )}
                      {eliminarResumen.siniestros > 0 && (
                        <div className="flex items-center gap-2 text-xs text-slate-700">
                          <AlertTriangle className="h-3 w-3 text-slate-400" /> {eliminarResumen.siniestros} siniestro(s)
                        </div>
                      )}
                      {eliminarResumen.tareas > 0 && (
                        <div className="flex items-center gap-2 text-xs text-slate-700">
                          <ClipboardList className="h-3 w-3 text-slate-400" /> {eliminarResumen.tareas} tarea(s)
                        </div>
                      )}
                      {eliminarResumen.oportunidades > 0 && (
                        <div className="flex items-center gap-2 text-xs text-slate-700">
                          <Target className="h-3 w-3 text-slate-400" /> {eliminarResumen.oportunidades} oportunidad(es)
                        </div>
                      )}
                      {eliminarResumen.cotizaciones > 0 && (
                        <div className="flex items-center gap-2 text-xs text-slate-700">
                          <FileText className="h-3 w-3 text-slate-400" /> {eliminarResumen.cotizaciones} cotización(es)
                        </div>
                      )}
                      {(eliminarResumen.archivos_polizas + eliminarResumen.archivos_siniestros) > 0 && (
                        <div className="flex items-center gap-2 text-xs text-slate-700">
                          <FolderOpen className="h-3 w-3 text-slate-400" /> {eliminarResumen.archivos_polizas + eliminarResumen.archivos_siniestros} archivo(s) físico(s)
                        </div>
                      )}
                      {/* Detalle de pólizas y siniestros que se purgarán */}
                      {eliminarDetalle && eliminarDetalle.polizas.length > 0 && (
                        <details className="mt-2">
                          <summary className="text-2xs text-slate-500 cursor-pointer hover:text-slate-700">
                            Ver pólizas ({eliminarDetalle.polizas.length}{eliminarResumen.polizas > eliminarDetalle.polizas.length ? `/${eliminarResumen.polizas}` : ''})
                          </summary>
                          <ul className="mt-1.5 ml-1 flex flex-col gap-0.5 max-h-32 overflow-y-auto">
                            {eliminarDetalle.polizas.map((p, i) => (
                              <li key={i} className="text-2xs text-slate-600 flex items-center justify-between gap-2">
                                <span className="font-mono">{p.numero_poliza}</span>
                                <span className="text-slate-400">{getLabelEstado(p.estado)} · {formatFecha(p.fecha_fin)}</span>
                              </li>
                            ))}
                            {eliminarResumen.polizas > eliminarDetalle.polizas.length && (
                              <li className="text-2xs text-slate-400 italic">
                                +{eliminarResumen.polizas - eliminarDetalle.polizas.length} más…
                              </li>
                            )}
                          </ul>
                        </details>
                      )}
                      {eliminarDetalle && eliminarDetalle.siniestros.length > 0 && (
                        <details className="mt-1">
                          <summary className="text-2xs text-slate-500 cursor-pointer hover:text-slate-700">
                            Ver siniestros directos ({eliminarDetalle.siniestros.length})
                          </summary>
                          <ul className="mt-1.5 ml-1 flex flex-col gap-0.5 max-h-32 overflow-y-auto">
                            {eliminarDetalle.siniestros.map((s, i) => (
                              <li key={i} className="text-2xs text-slate-600 flex items-center justify-between gap-2">
                                <span className="font-mono">{s.numero_caso}</span>
                                <span className="text-slate-400">{getLabelEstado(s.estado)} · {formatFecha(s.fecha_denuncia)}</span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">Este cliente no tiene registros asociados.</p>
                  )}
                  <div>
                    <label className="text-xs text-slate-600 mb-1 block">
                      Escribí el DNI del cliente para confirmar: <span className="font-mono font-semibold">{persona.dni_cuil}</span>
                    </label>
                    <input
                      type="text"
                      className="form-input w-full font-mono"
                      value={eliminarConfirm}
                      onChange={e => setEliminarConfirm(e.target.value)}
                      placeholder={persona.dni_cuil}
                      autoFocus
                    />
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center py-4 text-slate-400 text-xs gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando...
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg">
              <button onClick={() => setModalEliminar(false)} className="btn-secondary">
                {eliminarError ? 'Entendido' : 'Cancelar'}
              </button>
              {eliminarResumen && !eliminarError && (
                <button
                  onClick={async () => {
                    setEliminando(true)
                    const r = await apiCall(`/api/personas/${id}`, { method: 'DELETE' }, { mostrar_toast_en_error: false })
                    if (r.ok) {
                      toast.exitoConDeshacer(`${nombre} se movió a la papelera`, {
                        label: 'Deshacer',
                        onClick: async () => {
                          const rr = await apiCall(`/api/personas/${id}/restaurar`, { method: 'POST' }, { mostrar_toast_en_error: false })
                          if (rr.ok) {
                            toast.exito('Cliente restaurado')
                            router.push(`/crm/personas/${id}`)
                          } else {
                            toast.error(rr.error ?? { mensaje: 'No se pudo restaurar' })
                          }
                        },
                      })
                      router.push('/crm/personas')
                    } else {
                      setEliminarError(r.error?.mensaje ?? 'Error al eliminar')
                      setEliminando(false)
                    }
                  }}
                  disabled={eliminando || eliminarConfirm !== persona.dni_cuil}
                  className="btn-danger flex items-center gap-1.5 disabled:opacity-50"
                >
                  {eliminando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  {eliminando ? 'Moviendo a papelera...' : 'Mover a la papelera'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
