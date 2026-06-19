'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, Edit, Loader2, AlertCircle, MessageCircle,
  User, Calendar, Car, Home, Heart, Package,
  AlertTriangle, Eye, RefreshCw, UserX, Ban, X,
  Trash2, FolderOpen, Send, Sparkles, Banknote,
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { formatFecha, formatFechaLocal, formatMoneda, getBadgeClase, getLabelEstado, getPolizaBadgeColor, nombreCompleto, hoyLocal, diasHastaVencimiento } from '@/lib/utils'
import GestorArchivos from '@/components/GestorArchivos'
import EndososSection from '@/components/EndososSection'
import ModalEnviarEmail from '@/components/ModalEnviarEmail'
import ModalRecordarPago from '@/components/ModalRecordarPago'
import ModalUploadPDF from '@/components/agente-pdf/ModalUploadPDF'
import RehabilitarPolizaModal from '@/components/RehabilitarPolizaModal'
import HistorialPoliza from '@/components/HistorialPoliza'
import ComunicacionesTab from '@/components/ComunicacionesTab'
import { useModuloIAPDF } from '@/lib/hooks/useModuloIAPDF'
import { useEmailConfigurado } from '@/lib/hooks/useEmailConfigurado'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal, puedeEliminar } from '@/lib/cartera-filter'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { construirUrlWhatsapp } from '@/lib/whatsapp-templates'
import { PresenciaEnFicha } from '@/components/PresenciaEnFicha'
import { formatearRefacturacion } from '@/lib/refacturaciones'
import { vigenciaTextoDesdeFechas } from '@/lib/vigencia'

// ── Tipos locales ────────────────────────────────────────────
interface PolizaDetalle {
  id: string
  numero_poliza: string
  numero_certificado: string | null
  fecha_inicio: string
  fecha_fin: string
  refacturacion: string | null
  moneda: string
  estado: string
  motivo_baja: string | null
  fecha_baja: string | null
  observaciones_baja: string | null
  observaciones: string | null
  notas: string | null
  created_at: string
  updated_at: string
  asegurado: { id: string; apellido: string; nombre: string | null; razon_social: string | null; dni_cuil: string; telefono: string | null; whatsapp: string | null; email: string | null }
  compania: { id: string; nombre: string } | null
  ramo: { id: string; nombre: string; metadata: Record<string, any> | null } | null
  cobertura: { id: string; nombre: string; metadata: Record<string, any> | null } | null
  riesgos: { id: string; tipo_riesgo: string; detalle_tecnico: Record<string, any>; suma_asegurada: number | null }[]
}

interface SiniestroResumen {
  id: string
  numero_caso: string
  fecha_denuncia: string
  estado: string
  tipo_siniestro: string | null
  monto_estimado: number | null
  monto_liquidado: number | null
}

// ── Helpers ──────────────────────────────────────────────────
function estadoPolizaBadge(estado: string, fechaFin: string) {
  const dias = diasHastaVencimiento(fechaFin)
  if (estado === 'VIGENTE' && dias >= 0 && dias <= 7)  return { label: `Vence en ${dias}d`, color: 'bg-red-50 text-red-700 border-red-200' }
  if (estado === 'VIGENTE' && dias >= 0 && dias <= 30) return { label: `Vence en ${dias}d`, color: 'bg-orange-50 text-orange-700 border-orange-200' }
  return { label: getLabelEstado(estado), color: getPolizaBadgeColor(estado) }
}

function iconoRamo(tipo: string) {
  if (tipo === 'automotor' || tipo === 'AUTOMOTOR') return <Car className="h-4 w-4 text-blue-500" />
  if (tipo === 'hogar' || tipo === 'HOGAR')         return <Home className="h-4 w-4 text-amber-500" />
  if (tipo === 'vida' || tipo === 'VIDA')           return <Heart className="h-4 w-4 text-rose-500" />
  return <Package className="h-4 w-4 text-slate-400" />
}

function diasRestantes(fechaFin: string) {
  return diasHastaVencimiento(fechaFin)
}

const MOTIVOS_CANCELACION = [
  'Solicitud del cliente',
  'Cambio de compañía',
  'No renovó',
  'Otro',
]

const MOTIVOS_ANULACION = [
  'Falta de pago',
  'Fraude o declaración falsa',
  'Incumplimiento de condiciones',
  'Decisión de la compañía',
  'Otro',
]

// ── Componente principal ─────────────────────────────────────
export default function FichaPolizaPage() {
  const router   = useRouter()
  const params   = useParams()
  const id       = params.id as string
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  const [poliza,     setPoliza]     = useState<PolizaDetalle | null>(null)
  const [siniestros, setSiniestros] = useState<SiniestroResumen[]>([])
  const [cadenaRenovaciones, setCadenaRenovaciones] = useState<{ id: string; numero_poliza: string; fecha_inicio: string; fecha_fin: string; estado: string }[]>([])
  const [cargando,   setCargando]   = useState(true)
  const [error,      setError]      = useState('')

  // Modal cancelar/anular
  const [modalTipo,       setModalTipo]       = useState<'cancelar' | 'anular' | null>(null)
  const [modalFecha,      setModalFecha]      = useState(hoyLocal())
  const [modalMotivo,     setModalMotivo]     = useState('')
  const [modalObs,        setModalObs]        = useState('')
  const [guardandoModal,  setGuardandoModal]  = useState(false)

  // Eliminar
  const [modalEliminar, setModalEliminar] = useState(false)
  const [eliminarResumen, setEliminarResumen] = useState<any>(null)
  const [eliminarError, setEliminarError] = useState('')
  const [eliminarConfirm, setEliminarConfirm] = useState('')
  const [eliminando, setEliminando] = useState(false)
  const [cargandoPreview, setCargandoPreview] = useState(false)

  // Email
  const [modalEmail, setModalEmail] = useState(false)
  const [modalRecordarPago, setModalRecordarPago] = useState(false)
  const [comunicacionesActivo, setComunicacionesActivo] = useState(false)
  const { configurado: smtpConfigurado } = useEmailConfigurado()

  // Renovar desde PDF
  const [modalRenovarPDF, setModalRenovarPDF] = useState(false)
  const { activo: moduloIAActivo } = useModuloIAPDF()

  // Rehabilitar
  const [modalRehabilitar, setModalRehabilitar] = useState(false)
  const [historialKey, setHistorialKey] = useState(0)

  // Póliza raíz para fotos de inspección
  const [polizaRaizId, setPolizaRaizId] = useState<string | undefined>()
  const [polizaRaizNumero, setPolizaRaizNumero] = useState<string | undefined>()

  const cargar = useCallback(async () => {
    setCargando(true)
    const [{ data: pol }, { data: sin }] = await Promise.all([
      supabase.from('polizas').select(`
        id, numero_poliza, numero_certificado,
        fecha_inicio, fecha_fin, refacturacion,
        moneda, estado, motivo_baja, fecha_baja, observaciones_baja,
        observaciones, notas, created_at, updated_at,
        asegurado:personas!asegurado_id (id, apellido, nombre, razon_social, dni_cuil, telefono, whatsapp, email),
        compania:catalogos!compania_id (id, nombre),
        ramo:catalogos!ramo_id (id, nombre, metadata),
        cobertura:catalogos!cobertura_id (id, nombre, metadata),
        riesgos (id, tipo_riesgo, detalle_tecnico, suma_asegurada)
      `).eq('id', id).single(),
      supabase.from('siniestros').select(`
        id, numero_caso, fecha_denuncia, estado, tipo_siniestro, monto_estimado, monto_liquidado
      `).eq('poliza_id', id).order('fecha_denuncia', { ascending: false }),
    ])
    if (pol) {
      setPoliza(pol as unknown as PolizaDetalle)

      // Cargar cadena de renovaciones: ancestros (una sola query con CTE
      // recursiva) + descendientes directos (otra query plana). Antes esto
      // hacía un while-loop con un round-trip por nivel — un cuello de
      // botella visible en cadenas de 3-4 años.
      const cadena: { id: string; numero_poliza: string; fecha_inicio: string; fecha_fin: string; estado: string }[] = []
      const currentId = (pol as any).id
      let raizCalculada: { id: string; numero_poliza: string } | null = null

      const [ancestrosRes, futurasRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).rpc('fn_polizas_ancestros', { p_id: currentId }),
        supabase
          .from('polizas')
          .select('id, numero_poliza, fecha_inicio, fecha_fin, estado')
          .eq('poliza_origen_id', currentId)
          .order('fecha_inicio'),
      ])

      const ancestros = (ancestrosRes.data ?? []) as Array<{
        id: string; numero_poliza: string; fecha_inicio: string; fecha_fin: string;
        estado: string; poliza_origen_id: string | null; nivel: number
      }>
      if (ancestros.length > 0) {
        // Vienen ordenados raíz primero (nivel DESC) — usables directo
        for (const a of ancestros) {
          cadena.push({
            id: a.id,
            numero_poliza: a.numero_poliza,
            fecha_inicio: a.fecha_inicio,
            fecha_fin: a.fecha_fin,
            estado: a.estado,
          })
        }
        // La raíz es el primer elemento (la que no tiene poliza_origen_id)
        const raiz = ancestros.find(a => !a.poliza_origen_id) ?? ancestros[0]
        raizCalculada = { id: raiz.id, numero_poliza: raiz.numero_poliza }
      }

      const futuras = futurasRes.data
      if (futuras && futuras.length > 0) {
        cadena.push(...(futuras as any[]))
      }

      setCadenaRenovaciones(cadena)

      // Resolver póliza raíz para fotos de inspección
      if (raizCalculada) {
        setPolizaRaizId(raizCalculada.id)
        setPolizaRaizNumero(raizCalculada.numero_poliza)
      } else {
        // Esta póliza no tiene ancestros encontrados → es la raíz
        setPolizaRaizId(currentId)
        setPolizaRaizNumero((pol as any).numero_poliza)
      }
    }
    if (sin) setSiniestros(sin as unknown as SiniestroResumen[])

    // Verificar acceso por cartera
    if (pol && usuario && !tieneAccesoTotal(usuario)) {
      const aseguradoId = (pol as any).asegurado?.id
      if (aseguradoId) {
        const { data: persona } = await supabase.from('personas').select('usuario_id').eq('id', aseguradoId).single()
        if (persona && (persona as any).usuario_id && (persona as any).usuario_id !== usuario.id) {
          router.push('/crm/polizas')
          return
        }
      }
    }

    setCargando(false)
  }, [supabase, id, usuario, router])

  useEffect(() => { cargar() }, [cargar])

  useEffect(() => {
    apiCall<{ activo: boolean }>('/api/comunicaciones/estado', {}, { mostrar_toast_en_error: false })
      .then(r => { if (r.ok && r.data) setComunicacionesActivo(Boolean((r.data as any).activo)) })
  }, [])

  const confirmarBaja = async () => {
    if (!modalMotivo) { setError('Seleccioná un motivo'); return }
    setGuardandoModal(true); setError('')
    const endpoint = modalTipo === 'cancelar' ? 'cancelar' : 'anular'

    try {
      const r = await apiCall(`/api/polizas/${id}/${endpoint}`, {
        method: 'POST',
        body: {
          motivo_baja: modalMotivo,
          fecha_baja: modalFecha,
          observaciones_baja: modalObs.trim() || null,
        },
      }, { mostrar_toast_en_error: false })
      if (!r.ok) {
        setError(r.error?.mensaje ?? 'Error al procesar la baja')
      } else {
        toast.exito(endpoint === 'cancelar' ? 'Póliza cancelada' : 'Póliza anulada')
        setModalTipo(null)
        setModalMotivo(''); setModalObs(''); setModalFecha(hoyLocal())
        setHistorialKey(k => k + 1)
        cargar()
      }
    } catch (err) {
      setError('Error de conexión al procesar la baja')
    }
    setGuardandoModal(false)
  }

  // ── Loading / error ────────────────────────────────────────
  if (cargando) return (
    <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
      <Loader2 className="h-4 w-4 animate-spin" /> Cargando ficha de póliza...
    </div>
  )

  if (!poliza) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <span className="text-slate-400 text-sm">Póliza no encontrada</span>
      <button onClick={() => router.push('/crm/polizas')} className="btn-secondary">
        <ArrowLeft className="h-3 w-3" /> Volver al listado
      </button>
    </div>
  )

  const badge      = estadoPolizaBadge(poliza.estado, poliza.fecha_fin)
  const dias       = diasRestantes(poliza.fecha_fin)
  const vencida    = dias < 0
  const diasInicio = diasRestantes(poliza.fecha_inicio)

  // ¿Esta póliza ya fue renovada por otra? Buscamos hijas activas en la cadena.
  const tieneRenovacionActiva = cadenaRenovaciones.some(c =>
    c.fecha_inicio >= poliza.fecha_fin
    && ['RENOVADA', 'VIGENTE', 'PROGRAMADA'].includes(c.estado)
  )

  // Card de vigencia sensible al estado real de la póliza.
  type VigenciaCard = { titulo: string; valor: string; sub: string; bg: string; border: string; icon: string; valorColor: string }
  const vigenciaCard: VigenciaCard = (() => {
    const rangoFechas = `${formatFecha(poliza.fecha_inicio)} → ${formatFecha(poliza.fecha_fin)}`
    if (poliza.estado === 'CANCELADA' || poliza.estado === 'ANULADA') {
      return {
        titulo: poliza.estado === 'CANCELADA' ? 'Cancelada' : 'Anulada',
        valor: poliza.fecha_baja ? formatFecha(poliza.fecha_baja) : 'Sin fecha',
        sub: poliza.motivo_baja ? `Motivo: ${poliza.motivo_baja}` : 'Dada de baja',
        bg: 'bg-slate-50', border: 'border-slate-200',
        icon: 'text-slate-500', valorColor: 'text-slate-700',
      }
    }
    if (poliza.estado === 'NO_VIGENTE' && tieneRenovacionActiva) {
      return {
        titulo: 'Reemplazada',
        valor: 'Renovada',
        sub: 'Cubierta por renovación posterior',
        bg: 'bg-violet-50', border: 'border-violet-200',
        icon: 'text-violet-500', valorColor: 'text-violet-700',
      }
    }
    if (poliza.estado === 'NO_VIGENTE') {
      return {
        titulo: 'Vencida',
        valor: `Hace ${Math.abs(dias)}d`,
        sub: rangoFechas,
        bg: 'bg-red-50', border: 'border-red-200',
        icon: 'text-red-500', valorColor: 'text-red-700',
      }
    }
    if (poliza.estado === 'PROGRAMADA' || poliza.estado === 'RENOVADA') {
      const titulo = poliza.estado === 'PROGRAMADA' ? 'Programada' : 'Renovada (latente)'
      return {
        titulo,
        valor: diasInicio > 0 ? `En ${diasInicio}d` : 'Hoy',
        sub: `Arranca el ${formatFecha(poliza.fecha_inicio)}`,
        bg: 'bg-blue-50', border: 'border-blue-200',
        icon: 'text-blue-500', valorColor: 'text-blue-700',
      }
    }
    // VIGENTE
    if (vencida) {
      return {
        titulo: 'Vigencia',
        valor: `Venció hace ${Math.abs(dias)}d`,
        sub: rangoFechas,
        bg: 'bg-red-50', border: 'border-red-200',
        icon: 'text-red-500', valorColor: 'text-red-700',
      }
    }
    if (dias <= 30) {
      return {
        titulo: 'Vigencia',
        valor: `${dias} días`,
        sub: rangoFechas,
        bg: 'bg-orange-50', border: 'border-orange-200',
        icon: 'text-orange-500', valorColor: 'text-orange-700',
      }
    }
    return {
      titulo: 'Vigencia',
      valor: `${dias} días`,
      sub: rangoFechas,
      bg: 'bg-emerald-50', border: 'border-emerald-200',
      icon: 'text-emerald-500', valorColor: 'text-emerald-700',
    }
  })()
  const tipoRiesgo = poliza.ramo?.metadata?.tipo_riesgo ?? poliza.riesgos?.[0]?.tipo_riesgo?.toLowerCase() ?? ''
  // Todos los riesgos no vacíos (en flotas hay varios; en pólizas simples uno solo).
  const riesgosVisibles = (poliza.riesgos ?? []).filter(r => r.detalle_tecnico && Object.keys(r.detalle_tecnico).length > 0)
  const asegurado  = poliza.asegurado
  const nombre     = nombreCompleto(asegurado.apellido, asegurado.nombre, asegurado.razon_social)
  const siniestrosAbiertos = siniestros.filter(s => !['FINALIZADO', 'RECHAZADO'].includes(s.estado)).length
  const puedeGestionarBaja = ['VIGENTE', 'PROGRAMADA', 'RENOVADA'].includes(poliza.estado)

  const abrirWhatsApp = async () => {
    const tel = asegurado.whatsapp ?? asegurado.telefono ?? ''
    if (!tel) return
    const url = await construirUrlWhatsapp('info_poliza', tel, {
      nombre: asegurado.nombre || asegurado.apellido,
      numero_poliza: poliza.numero_poliza,
      compania: poliza.compania?.nombre ?? '',
      ramo: poliza.ramo?.nombre ?? '',
    })
    window.open(url, '_blank')
  }

  return (
    <div className="flex flex-col gap-3 w-full">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <button onClick={() => router.push('/crm/polizas')}
            className="btn-secondary h-7 w-7 p-0 flex items-center justify-center mt-0.5"
            title="Volver">
            <ArrowLeft className="h-3 w-3" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-slate-800 font-mono">
                {poliza.numero_poliza}
              </h1>
              <span className={`text-2xs font-semibold px-2 py-0.5 rounded border ${badge.color}`}>
                {badge.label}
              </span>
            </div>
            <p className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
              {iconoRamo(tipoRiesgo)}
              {poliza.ramo?.nombre ?? '—'}{poliza.cobertura ? ` · ${poliza.cobertura.nombre}` : ''} · {poliza.compania?.nombre ?? '—'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PresenciaEnFicha tipoEntidad="poliza" entidadId={id} />
          {(asegurado.whatsapp || asegurado.telefono) && (
            <button onClick={abrirWhatsApp} className="btn-secondary">
              <MessageCircle className="h-3 w-3 text-green-600" /> WhatsApp
            </button>
          )}
          {(() => {
            const sinEmail = !asegurado.email
            const sinSmtp = !smtpConfigurado
            const moduloOff = !comunicacionesActivo
            const deshabilitado = sinEmail || sinSmtp || moduloOff
            let tooltip = 'Enviar un email al asegurado'
            if (sinSmtp)        tooltip = 'Configurá el servidor SMTP en Configuración → Correos para empezar a enviar emails'
            else if (moduloOff) tooltip = 'El sistema de comunicaciones está desactivado en Configuración → Comunicaciones'
            else if (sinEmail)  tooltip = 'El asegurado no tiene email cargado'
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
          {(() => {
            // Solo tiene sentido recordar pago en pólizas vigentes/programadas/renovadas.
            const estadosOk = ['VIGENTE', 'PROGRAMADA', 'RENOVADA'].includes(poliza.estado)
            if (!estadosOk) return null
            const tieneCanal = !!asegurado.email || !!asegurado.whatsapp || !!asegurado.telefono
            return (
              <button
                onClick={() => setModalRecordarPago(true)}
                disabled={!tieneCanal}
                title={tieneCanal
                  ? 'Enviar recordatorio de pago por email o WhatsApp'
                  : 'El asegurado no tiene email ni teléfono cargados'}
                className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Banknote className="h-3 w-3 text-emerald-600" /> Recordar pago
              </button>
            )
          })()}
          <button onClick={() => router.push(`/crm/siniestros/nuevo?poliza_id=${poliza.id}&persona_id=${asegurado.id}`)}
            className="btn-secondary">
            <AlertTriangle className="h-3 w-3" /> Siniestro
          </button>
          {puedeGestionarBaja && (
            <button
              onClick={() => router.push(`/crm/renovaciones/${id}`)}
              className="btn-secondary"
              title="Renovar manualmente cargando los datos en el formulario"
            >
              <RefreshCw className="h-3 w-3" /> Renovar
            </button>
          )}
          {moduloIAActivo && puedeGestionarBaja && (
            <button
              onClick={() => setModalRenovarPDF(true)}
              className="btn-secondary text-blue-600 border-blue-200"
              title="Renovar subiendo el PDF de la compañía"
            >
              <Sparkles className="h-3 w-3" /> Renovar con PDF
            </button>
          )}
          <button onClick={() => router.push(`/crm/polizas/${id}/editar`)} className="btn-primary">
            <Edit className="h-3 w-3" /> Editar
          </button>
          {(poliza.estado === 'CANCELADA' || poliza.estado === 'ANULADA') && (
            <button
              onClick={() => setModalRehabilitar(true)}
              className="btn-primary bg-blue-600 hover:bg-blue-700"
              title="Volver la póliza al estado correspondiente según la fecha actual"
            >
              <RefreshCw className="h-3 w-3" /> Rehabilitar
            </button>
          )}
          {puedeEliminar(usuario) && (
            <button
              onClick={async () => {
                setCargandoPreview(true); setEliminarError(''); setEliminarResumen(null); setEliminarConfirm('')
                try {
                  const r = await apiCall<{ resumen: any }>(`/api/polizas/${id}?preview=true`, {}, { mostrar_toast_en_error: false })
                  if (!r.ok) {
                    setEliminarError(r.error?.mensaje ?? 'No se puede eliminar')
                  } else {
                    const payload = r.data as { resumen?: any } | undefined
                    if (payload?.resumen) setEliminarResumen(payload.resumen)
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

      {/* ── KPIs rápidos ──────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-2">
        <div className={`kpi-card ${vigenciaCard.bg} ${vigenciaCard.border}`}>
          <span className="kpi-label flex items-center gap-1">
            <Calendar className={`h-3 w-3 ${vigenciaCard.icon}`} /> {vigenciaCard.titulo}
          </span>
          <span className={`kpi-value ${vigenciaCard.valorColor}`}>{vigenciaCard.valor}</span>
          <span className="kpi-sub">{vigenciaCard.sub}</span>
        </div>
        <div className="kpi-card bg-blue-50 border-blue-200">
          <span className="kpi-label flex items-center gap-1"><RefreshCw className="h-3 w-3 text-blue-500" /> Refacturación</span>
          <span className="kpi-value text-blue-700">{formatearRefacturacion(poliza.refacturacion)}</span>
          <span className="kpi-sub">frecuencia de cobro</span>
        </div>
        <div className="kpi-card bg-violet-50 border-violet-200">
          <span className="kpi-label flex items-center gap-1"><Calendar className="h-3 w-3 text-violet-500" /> Vigencia</span>
          <span className="kpi-value text-violet-700">{vigenciaTextoDesdeFechas(poliza.fecha_inicio, poliza.fecha_fin)}</span>
          <span className="kpi-sub">&nbsp;</span>
        </div>
        <div className="kpi-card bg-amber-50 border-amber-200">
          <span className="kpi-label flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-500" /> Siniestros</span>
          <span className="kpi-value text-amber-700">{siniestros.length}</span>
          <span className="kpi-sub">{siniestrosAbiertos} abierto{siniestrosAbiertos !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* ── Botones Cancelar / Anular o badge de baja ────────── */}
      {puedeGestionarBaja && puedeEliminar(usuario) ? (
        <div className="flex gap-2">
          <button onClick={() => { setModalTipo('cancelar'); setModalMotivo(''); setModalObs(''); setModalFecha(hoyLocal()) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-amber-300 bg-amber-50 text-amber-700 text-xs font-medium hover:bg-amber-100 transition-colors">
            <UserX className="h-3.5 w-3.5" /> Cancelar póliza
          </button>
          <button onClick={() => { setModalTipo('anular'); setModalMotivo(''); setModalObs(''); setModalFecha(hoyLocal()) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-red-300 bg-red-50 text-red-700 text-xs font-medium hover:bg-red-100 transition-colors">
            <Ban className="h-3.5 w-3.5" /> Anular póliza
          </button>
        </div>
      ) : (poliza.estado === 'CANCELADA' || poliza.estado === 'ANULADA') && (
        <div className={`flex items-start gap-2 rounded border px-3 py-2.5 text-xs ${
          poliza.estado === 'CANCELADA' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {poliza.estado === 'CANCELADA' ? <UserX className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <Ban className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
          <div>
            <span className="font-semibold">{poliza.estado === 'CANCELADA' ? 'Póliza cancelada' : 'Póliza anulada'}</span>
            {poliza.fecha_baja && <span> el {formatFecha(poliza.fecha_baja)}</span>}
            {poliza.motivo_baja && <span> — {poliza.motivo_baja}</span>}
            {poliza.observaciones_baja && (
              <p className="mt-1 text-2xs opacity-80">{poliza.observaciones_baja}</p>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5" />{error}
        </div>
      )}

      {/* ── Layout 2 columnas ─────────────────────────────────── */}
      <div className="flex gap-3 w-full">

        {/* ── Columna izquierda ────────────────────────────────── */}
        <div className="w-[280px] shrink-0 flex flex-col gap-2">

          {/* Asegurado */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Asegurado</h3>
            </div>
            <div className="p-3 flex flex-col gap-1.5">
              <button onClick={() => router.push(`/crm/personas/${asegurado.id}`)}
                className="flex items-center gap-1.5 text-blue-600 hover:underline text-xs font-medium text-left">
                <User className="h-3 w-3" /> {nombre}
              </button>
              {asegurado.dni_cuil && (
                <p className="text-xs text-slate-500 font-mono">{asegurado.dni_cuil}</p>
              )}
              {asegurado.email && (
                <p className="text-xs text-slate-500 truncate">{asegurado.email}</p>
              )}
              {asegurado.telefono && (
                <p className="text-xs text-slate-500 font-mono">{asegurado.telefono}</p>
              )}
            </div>
          </div>

          {/* Datos de la póliza */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Datos de la Póliza</h3>
            </div>
            <div className="p-3 flex flex-col gap-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Compañía</span>
                <span className="text-slate-700 font-medium">{poliza.compania?.nombre ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Ramo</span>
                <span className="text-slate-700 font-medium">{poliza.ramo?.nombre ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Cobertura</span>
                <span className="text-slate-700 font-medium">
                  {poliza.cobertura?.nombre ?? '—'}
                  {(() => {
                    const eq = (poliza.cobertura?.metadata?.equivalencias as { compania_id: string; nombre_comercial: string }[] | undefined)
                      ?.find(e => e.compania_id === poliza.compania?.id)
                    return eq ? <span className="text-slate-400 font-normal"> ({eq.nombre_comercial})</span> : null
                  })()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Vigencia</span>
                <span className="text-slate-700 font-medium">{formatFecha(poliza.fecha_inicio)} → {formatFecha(poliza.fecha_fin)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Refacturación</span>
                <span className="text-slate-700 font-medium">{formatearRefacturacion(poliza.refacturacion)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Duración</span>
                <span className="text-slate-700 font-medium">{vigenciaTextoDesdeFechas(poliza.fecha_inicio, poliza.fecha_fin)}</span>
              </div>
              {poliza.numero_certificado && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Certificado</span>
                  <span className="text-slate-700 font-medium font-mono">{poliza.numero_certificado}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Creada</span>
                <span className="text-slate-700 font-medium">{formatFecha(poliza.created_at)}</span>
              </div>
            </div>
          </div>

          {/* Datos del riesgo (multi-riesgo / flotas) */}
          {riesgosVisibles.length > 0 && (
            <div className="bg-white border border-slate-200 rounded overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                {iconoRamo(tipoRiesgo)}
                <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">
                  {riesgosVisibles.length > 1 ? `Riesgos asegurados (${riesgosVisibles.length})` : 'Datos del Riesgo'}
                </h3>
              </div>
              <div className="divide-y divide-slate-100">
                {riesgosVisibles.map((r, idx) => {
                  const dt = r.detalle_tecnico ?? {}
                  // Etiqueta resumida — patente / dirección / "Riesgo N"
                  const titulo = dt.patente
                    ? String(dt.patente)
                    : dt.calle
                      ? `${dt.calle}${dt.numero ? ' ' + dt.numero : ''}`
                      : `Riesgo ${idx + 1}`
                  return (
                    <div key={r.id} className="p-3 flex flex-col gap-2 text-xs">
                      {riesgosVisibles.length > 1 && (
                        <div className="text-2xs font-semibold text-slate-500 uppercase tracking-wide font-mono">
                          {titulo}
                        </div>
                      )}
                      {Object.entries(dt)
                        .filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))
                        .map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-2">
                            <span className="text-slate-500 capitalize shrink-0">{k.replace(/_/g, ' ')}</span>
                            <span className="text-slate-700 font-medium text-right font-mono truncate">
                              {Array.isArray(v) ? v.join(', ') : String(v)}
                            </span>
                          </div>
                        ))}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Columna derecha ─────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">

          {/* Observaciones / Notas */}
          {(poliza.observaciones || poliza.notas) && (
            <div className="bg-white border border-slate-200 rounded p-3">
              <p className="text-2xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">Observaciones</p>
              <p className="text-xs text-slate-700 leading-relaxed">{poliza.observaciones ?? poliza.notas}</p>
              {poliza.observaciones && poliza.notas && poliza.observaciones !== poliza.notas && (
                <>
                  <p className="text-2xs text-slate-500 mb-1 mt-3 font-semibold uppercase tracking-wide">Notas internas</p>
                  <p className="text-xs text-slate-700 leading-relaxed">{poliza.notas}</p>
                </>
              )}
            </div>
          )}

          {/* Historial de renovaciones */}
          {cadenaRenovaciones.length > 0 && (
            <div className="bg-white border border-slate-200 rounded overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
                <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">
                  Cadena de Renovaciones
                </h3>
              </div>
              <div className="divide-y divide-slate-100">
                {cadenaRenovaciones.map(r => {
                  const esCurrent = r.id === poliza.id
                  return (
                    <div key={r.id} className={`px-3 py-2 flex items-center justify-between ${esCurrent ? 'bg-blue-50' : ''}`}>
                      <div className="flex items-center gap-2">
                        <button onClick={() => { if (!esCurrent) router.push(`/crm/polizas/${r.id}`) }}
                          className={`font-mono text-xs font-semibold ${esCurrent ? 'text-slate-700' : 'text-blue-600 hover:underline cursor-pointer'}`}>
                          {r.numero_poliza}
                        </button>
                        <span className="text-2xs text-slate-500">
                          {formatFechaLocal(r.fecha_inicio)} → {formatFechaLocal(r.fecha_fin)}
                        </span>
                      </div>
                      <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded border ${getPolizaBadgeColor(r.estado)}`}>
                        {getLabelEstado(r.estado)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Historial / bitácora de la póliza */}
          <HistorialPoliza polizaId={poliza.id} refreshKey={historialKey} />

          {/* Historial de comunicaciones por email de esta póliza */}
          <ComunicacionesTab poliza_id={poliza.id} />

          {/* Historial de endosos (con archivos adjuntos) */}
          <EndososSection
            polizaId={poliza.id}
            numeroPoliza={poliza.numero_poliza}
            polizaContexto={{
              asegurado_nombre: nombre || '',
              compania_nombre: poliza.compania?.nombre || '—',
            }}
          />

          {/* Inspección previa */}
          <GestorArchivos
            polizaId={poliza.id}
            numeroPoliza={poliza.numero_poliza}
            polizaRaizId={polizaRaizId}
            polizaRaizNumero={polizaRaizNumero}
            categoria="inspeccion"
            titulo="Inspección previa"
          />

          {/* Documentación */}
          <GestorArchivos
            polizaId={poliza.id}
            numeroPoliza={poliza.numero_poliza}
            categoria="documentacion"
            titulo="Documentación"
          />

          {/* Siniestros relacionados */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">
                Siniestros vinculados
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-2xs text-slate-500">{siniestros.length} siniestro{siniestros.length !== 1 ? 's' : ''}</span>
                <button onClick={() => router.push(`/crm/siniestros/nuevo?poliza_id=${poliza.id}&persona_id=${asegurado.id}`)}
                  className="text-xs text-blue-600 hover:underline">+ Nuevo</button>
              </div>
            </div>
            {siniestros.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">
                No tiene siniestros registrados
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
                  {siniestros.map(s => (
                    <tr key={s.id}>
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
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* ── Modal Enviar Email ────────────────────────────────── */}
      <ModalEnviarEmail
        isOpen={modalEmail}
        onClose={() => setModalEmail(false)}
        persona={{
          id: asegurado.id,
          nombre: asegurado.nombre || '',
          apellido: asegurado.apellido,
          email: asegurado.email || null,
        }}
        poliza={{
          id: poliza.id,
          numero_poliza: poliza.numero_poliza,
          compania: poliza.compania?.nombre || '',
          ramo: poliza.ramo?.nombre || '',
        }}
      />

      {/* ── Modal Recordar Pago ──────────────────────────────── */}
      <ModalRecordarPago
        abierto={modalRecordarPago}
        onClose={() => setModalRecordarPago(false)}
        poliza={{
          id: poliza.id,
          numero_poliza: poliza.numero_poliza,
          compania: poliza.compania?.nombre || '',
          ramo: poliza.ramo?.nombre || '',
        }}
        persona={{
          id: asegurado.id,
          nombre: asegurado.nombre || '',
          apellido: asegurado.apellido,
          email: asegurado.email || null,
          telefono: asegurado.telefono || null,
          whatsapp: asegurado.whatsapp || null,
        }}
        smtpConfigurado={smtpConfigurado}
        comunicacionesActivo={comunicacionesActivo}
      />

      {/* ── Modal Renovar con PDF ───────────────────────────── */}
      <ModalUploadPDF
        abierto={modalRenovarPDF}
        onCerrar={() => setModalRenovarPDF(false)}
        tipo_operacion="RENOVACION"
        poliza_origen_id={poliza.id}
        poliza_origen_info={{
          numero_poliza: poliza.numero_poliza,
          asegurado_nombre: nombre || '',
          compania_nombre: poliza.compania?.nombre || '—',
          vencimiento: formatFechaLocal(poliza.fecha_fin),
        }}
      />

      {/* ── Modal Rehabilitar ───────────────────────────────── */}
      {(poliza.estado === 'CANCELADA' || poliza.estado === 'ANULADA') && (
        <RehabilitarPolizaModal
          abierto={modalRehabilitar}
          onCerrar={() => setModalRehabilitar(false)}
          poliza={{
            id: poliza.id,
            numero_poliza: poliza.numero_poliza,
            estado: poliza.estado as 'CANCELADA' | 'ANULADA',
            fecha_inicio: poliza.fecha_inicio,
            fecha_fin: poliza.fecha_fin,
            motivo_baja: poliza.motivo_baja,
            fecha_baja: poliza.fecha_baja,
            observaciones_baja: poliza.observaciones_baja,
            asegurado_nombre: nombre || '',
          }}
          onRehabilitada={() => {
            setHistorialKey(k => k + 1)
            cargar()
          }}
        />
      )}

      {/* ── Modal Eliminar ──────────────────────────────────── */}
      {modalEliminar && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setModalEliminar(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 rounded-t-lg border-b bg-red-50 border-red-200">
              <div className="flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-red-600" />
                <h3 className="text-sm font-semibold text-red-800">Eliminar póliza</h3>
              </div>
              <button onClick={() => setModalEliminar(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              {eliminarError ? (
                <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-3">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{eliminarError}</span>
                </div>
              ) : eliminarResumen ? (
                <>
                  <p className="text-xs text-slate-600">
                    Estás a punto de eliminar la póliza <strong className="font-mono">#{poliza.numero_poliza}</strong> y todo lo asociado. Esta acción no se puede deshacer.
                  </p>
                  {(eliminarResumen.siniestros > 0 || eliminarResumen.riesgos > 0 || eliminarResumen.endosos > 0 || eliminarResumen.polizas_hijas > 0 || (eliminarResumen.archivos_polizas + eliminarResumen.archivos_siniestros) > 0) ? (
                    <div className="bg-slate-50 border border-slate-200 rounded p-3 flex flex-col gap-1.5">
                      <p className="text-2xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Se eliminará:</p>
                      {eliminarResumen.siniestros > 0 && (
                        <div className="flex items-center gap-2 text-xs text-slate-700">
                          <AlertTriangle className="h-3 w-3 text-slate-400" /> {eliminarResumen.siniestros} siniestro(s) cerrado(s)
                        </div>
                      )}
                      {eliminarResumen.riesgos > 0 && (
                        <div className="flex items-center gap-2 text-xs text-slate-700">
                          <Package className="h-3 w-3 text-slate-400" /> {eliminarResumen.riesgos} riesgo(s)
                        </div>
                      )}
                      {eliminarResumen.endosos > 0 && (
                        <div className="flex items-center gap-2 text-xs text-slate-700">
                          <Edit className="h-3 w-3 text-slate-400" /> {eliminarResumen.endosos} endoso(s)
                        </div>
                      )}
                      {eliminarResumen.polizas_hijas > 0 && (
                        <div className="flex items-center gap-2 text-xs text-slate-700">
                          <RefreshCw className="h-3 w-3 text-slate-400" /> {eliminarResumen.polizas_hijas} póliza(s) renovada(s)
                        </div>
                      )}
                      {(eliminarResumen.archivos_polizas + eliminarResumen.archivos_siniestros) > 0 && (
                        <div className="flex items-center gap-2 text-xs text-slate-700">
                          <FolderOpen className="h-3 w-3 text-slate-400" /> {eliminarResumen.archivos_polizas + eliminarResumen.archivos_siniestros} archivo(s) físico(s)
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">Esta póliza no tiene registros asociados.</p>
                  )}
                  <div>
                    <label className="text-xs text-slate-600 mb-1 block">
                      Escribí el número de póliza para confirmar: <span className="font-mono font-semibold">{poliza.numero_poliza}</span>
                    </label>
                    <input
                      type="text"
                      className="form-input w-full font-mono"
                      value={eliminarConfirm}
                      onChange={e => setEliminarConfirm(e.target.value)}
                      placeholder={poliza.numero_poliza}
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
                    const r = await apiCall(`/api/polizas/${id}`, { method: 'DELETE' }, { mostrar_toast_en_error: false })
                    if (r.ok) {
                      toast.exito('Póliza eliminada')
                      router.push('/crm/polizas')
                    } else {
                      setEliminarError(r.error?.mensaje ?? 'Error al eliminar')
                      setEliminando(false)
                    }
                  }}
                  disabled={eliminando || eliminarConfirm !== poliza.numero_poliza}
                  className="btn-danger flex items-center gap-1.5 disabled:opacity-50"
                >
                  {eliminando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  {eliminando ? 'Eliminando...' : 'Eliminar definitivamente'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Cancelar / Anular ──────────────────────────── */}
      {modalTipo && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setModalTipo(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className={`flex items-center justify-between px-4 py-3 rounded-t-lg border-b ${
              modalTipo === 'cancelar' ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'
            }`}>
              <div className="flex items-center gap-2">
                {modalTipo === 'cancelar'
                  ? <UserX className="h-4 w-4 text-amber-600" />
                  : <Ban className="h-4 w-4 text-red-600" />}
                <h3 className={`text-sm font-semibold ${modalTipo === 'cancelar' ? 'text-amber-800' : 'text-red-800'}`}>
                  {modalTipo === 'cancelar' ? 'Cancelar póliza' : 'Anular póliza'}
                </h3>
              </div>
              <button onClick={() => setModalTipo(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-xs text-slate-600">
                {modalTipo === 'cancelar'
                  ? 'La cancelación representa la decisión del asegurado de dar de baja la póliza.'
                  : 'La anulación representa la decisión de la compañía aseguradora de dejar sin efecto la póliza.'}
              </p>
              <div>
                <label className="text-xs text-slate-600 mb-1 block">
                  Fecha de {modalTipo === 'cancelar' ? 'cancelación' : 'anulación'} <span className="text-red-500">*</span>
                </label>
                <input type="date" className="form-input w-full" value={modalFecha}
                  onChange={e => setModalFecha(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-600 mb-1 block">Motivo <span className="text-red-500">*</span></label>
                <select className="form-input w-full" value={modalMotivo} onChange={e => setModalMotivo(e.target.value)}>
                  <option value="">— Seleccioná el motivo —</option>
                  {(modalTipo === 'cancelar' ? MOTIVOS_CANCELACION : MOTIVOS_ANULACION).map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-600 mb-1 block">Observaciones</label>
                <textarea className="form-input w-full resize-none text-xs" rows={3}
                  value={modalObs} onChange={e => setModalObs(e.target.value)}
                  placeholder="Detalle adicional..." />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg">
              <button onClick={() => setModalTipo(null)} className="btn-secondary">
                Volver
              </button>
              <button onClick={confirmarBaja} disabled={guardandoModal}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold text-white transition-colors ${
                  modalTipo === 'cancelar'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-red-600 hover:bg-red-700'
                } disabled:opacity-50`}>
                {guardandoModal ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {guardandoModal ? 'Procesando...' : modalTipo === 'cancelar' ? 'Confirmar cancelación' : 'Confirmar anulación'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
