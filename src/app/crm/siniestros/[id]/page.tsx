'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, Save, Loader2, AlertCircle, AlertTriangle, Car, Home,
  Heart, Package, User, FileText, MessageCircle,
  CheckCircle, Clock, Send, ChevronRight,
  Trash2, X, FolderOpen, Pencil
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal, puedeEliminar } from '@/lib/cartera-filter'
import { getEstadoBadge } from '@/lib/siniestros-config'
import { obtenerEstadosSiguientes, esEstadoTerminal } from '@/lib/siniestros-estados'
import { formatFechaLocalLarga, formatMoneda, getTooltipEstado } from '@/lib/utils'
import { logger } from '@/lib/errores/logger'
import GestorArchivos from '@/components/GestorArchivos'
import EditarSiniestroModal from '@/components/EditarSiniestroModal'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { formatFecha } from '@/lib/utils'
import { useRealtimeRefresh } from '@/lib/hooks/useRealtimeRefresh'
import { construirUrlWhatsapp } from '@/lib/whatsapp-templates'
import { PresenciaEnFicha } from '@/components/PresenciaEnFicha'
import { extraerCamposCustom, mapaLabelsPorKey, labelDeCampo } from '@/lib/siniestros-campos-custom'
import { ModalConflictoEdicion } from '@/components/ModalConflictoEdicion'

// ── Tipos ────────────────────────────────────────────────────
interface Siniestro {
  id: string
  numero_caso: string
  numero_siniestro: string | null
  fecha_ocurrencia: string | null
  fecha_denuncia: string
  hora_siniestro: string | null
  tipo_siniestro: string
  estado: string
  monto_estimado: number | null
  monto_liquidado: number | null
  franquicia_aplicada: number | null
  monto_cobrado: number | null
  descripcion: string | null
  detalle_siniestro: Record<string, any> | null
  lugar_siniestro: string | null
  localidad_siniestro: string | null
  tercero_nombre: string | null
  tercero_dni: string | null
  tercero_telefono: string | null
  tercero_patente: string | null
  notas: string | null
  deleted_at: string | null
  updated_at: string | null
  origen_creacion: 'MANUAL_PAS' | 'PORTAL_CLIENTE'
  revisado_por_pas: boolean
  fecha_revision: string | null
  asegurado: { id: string; apellido: string; nombre: string; razon_social: string | null; telefono?: string | null; whatsapp?: string | null; usuario_id?: string | null }
  poliza: {
    id: string
    numero_poliza: string
    compania: { nombre: string } | null
    ramo: { nombre: string; metadata: Record<string, any> | null } | null
    riesgos: { tipo_riesgo: string; detalle_tecnico: Record<string, any> }[]
  }
}

interface EntradaBitacora {
  id: string
  tipo: 'NOTA' | 'ESTADO' | 'ARCHIVO' | 'CREACION' | 'EDICION' | 'ELIMINACION' | 'RESTAURACION' | 'PURGA_DEFINITIVA'
  texto: string | null
  estado_anterior: string | null
  estado_nuevo: string | null
  monto_actualizado: number | null
  campos_modificados: string[] | null
  created_at: string
  usuario?: { id: string; nombre: string; apellido: string } | null
}

// ── Helpers ──────────────────────────────────────────────────
function formatTimestamp(f: string) {
  return new Date(f).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function formatHora(f: string) {
  return new Date(f).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}
// Wrapper local: el helper centralizado acepta null/undefined.
const formatPeso = (n: number | null | undefined) => formatMoneda(n)
function nombreAsegurado(s: Siniestro) {
  return [s.asegurado?.apellido, s.asegurado?.nombre].filter(Boolean).join(', ') || s.asegurado?.razon_social || '—'
}
function iconoRamo(tipo: string) {
  if (tipo === 'automotor') return <Car    className="h-4 w-4 text-blue-500" />
  if (tipo === 'hogar')     return <Home   className="h-4 w-4 text-amber-500" />
  if (tipo === 'vida')      return <Heart  className="h-4 w-4 text-rose-500" />
  return <Package className="h-4 w-4 text-slate-400" />
}
function bienAfectado(s: Siniestro) {
  const dt = s.poliza?.riesgos?.[0]?.detalle_tecnico
  if (!dt) return '—'
  return dt.patente ?? [dt.calle, dt.numero].filter(Boolean).join(' ') ?? dt.descripcion ?? '—'
}

/**
 * Descripción rica del bien afectado para el card "Póliza vinculada".
 * Automotor: marca + modelo + año + patente + color.
 * Hogar: dirección completa + tipo de construcción + superficie.
 * Otros: descripción libre y campos genéricos.
 */
function DescripcionBien({ tipoRiesgo, dt }: { tipoRiesgo: string; dt: any }) {
  if (!dt) return <p className="text-xs text-slate-400">Sin datos del bien</p>
  const filas: Array<{ label: string; valor: string }> = []
  const add = (label: string, v: any) => {
    if (v == null || v === '') return
    filas.push({ label, valor: String(v) })
  }
  if (tipoRiesgo === 'automotor') {
    const titulo = [dt.marca, dt.modelo, dt.anio].filter(Boolean).join(' ')
    if (titulo) filas.push({ label: 'Vehículo', valor: titulo })
    if (dt.patente) filas.push({ label: 'Patente', valor: String(dt.patente).toUpperCase() })
    add('Color', dt.color)
    add('Motor', dt.motor)
    add('Chasis', dt.chasis)
    add('Uso', dt.uso)
  } else if (tipoRiesgo === 'hogar' || tipoRiesgo === 'integrales') {
    const dir = [dt.calle, dt.numero].filter(Boolean).join(' ')
    if (dir) filas.push({ label: 'Dirección', valor: dir })
    const loc = [dt.localidad, dt.provincia].filter(Boolean).join(', ')
    if (loc) filas.push({ label: 'Localidad', valor: loc })
    add('Tipo de construcción', dt.tipo_construccion)
    add('Superficie', dt.superficie)
  } else {
    // Generico / dinámico: mostrar todos los pares no vacíos
    for (const [k, v] of Object.entries(dt)) {
      if (v == null || v === '') continue
      if (typeof v === 'object') continue
      filas.push({ label: k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()), valor: String(v) })
    }
  }
  if (filas.length === 0) return <p className="text-xs text-slate-400">Sin datos del bien</p>
  return (
    <div className="flex flex-col gap-1">
      {filas.map(({ label, valor }) => (
        <div key={label} className="flex items-baseline gap-1.5">
          <span className="text-2xs text-slate-500 shrink-0">{label}:</span>
          <span className="text-xs font-medium text-slate-700 break-words">{valor}</span>
        </div>
      ))}
    </div>
  )
}
function tipoLabel(tipo: string) {
  return tipo?.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()) ?? '—'
}

// ── Stepper de estados ───────────────────────────────────────
const FLUJO_ESTADOS = ['DENUNCIADO', 'EN_TRAMITE', 'INSPECCION', 'LIQUIDACION', 'REPARACION', 'FINALIZADO']

function StepperEstados({ estadoActual }: { estadoActual: string }) {
  const esRechazado = estadoActual === 'RECHAZADO'
  const idxActual   = FLUJO_ESTADOS.indexOf(estadoActual)

  return (
    <ol
      role="list"
      aria-label={`Progreso del siniestro. Estado actual: ${getEstadoBadge(estadoActual).label}`}
      className="flex items-center gap-0"
    >
      {FLUJO_ESTADOS.map((e, i) => {
        const badge    = getEstadoBadge(e)
        const activo   = e === estadoActual
        const pasado   = idxActual > i
        const ultimo   = i === FLUJO_ESTADOS.length - 1

        return (
          <li key={e} role="listitem" className="flex items-center">
            <div
              aria-current={activo && !esRechazado ? 'step' : undefined}
              aria-label={`${badge.label}${activo && !esRechazado ? ' (actual)' : pasado && !esRechazado ? ' (completado)' : ' (pendiente)'}`}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-2xs font-semibold transition-all
              ${activo && !esRechazado
                ? `${badge.color} border ring-2 ring-offset-1 ring-current`
                : pasado && !esRechazado
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-slate-50 text-slate-400 border border-slate-200'
              }`}>
              {pasado && !esRechazado
                ? <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
                : activo && !esRechazado
                  ? <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  : <span className="h-3.5 w-3.5 rounded-full border border-current inline-flex" aria-hidden="true" />
              }
              {badge.label}
            </div>
            {!ultimo && <ChevronRight className="h-3 w-3 text-slate-300 mx-0.5" aria-hidden="true" />}
          </li>
        )
      })}
      {esRechazado && (
        <li role="listitem" className="flex items-center">
          <ChevronRight className="h-3 w-3 text-slate-300 mx-0.5" aria-hidden="true" />
          <div
            aria-current="step"
            aria-label="Rechazado (estado actual)"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-2xs font-semibold bg-red-50 text-red-700 border border-red-200 ring-2 ring-offset-1 ring-red-300"
          >
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> Rechazado
          </div>
        </li>
      )}
    </ol>
  )
}

// ── Entrada de bitácora ──────────────────────────────────────
function iconoBitacora(tipo: EntradaBitacora['tipo']) {
  switch (tipo) {
    case 'CREACION':       return { bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle className="h-3.5 w-3.5 text-emerald-600" /> }
    case 'ESTADO':         return { bg: 'bg-violet-50 border-violet-200',   icon: <CheckCircle className="h-3.5 w-3.5 text-violet-600" /> }
    case 'EDICION':        return { bg: 'bg-slate-50 border-slate-200',     icon: <FileText className="h-3.5 w-3.5 text-slate-500" /> }
    case 'ELIMINACION':    return { bg: 'bg-amber-50 border-amber-200',     icon: <Trash2 className="h-3.5 w-3.5 text-amber-600" /> }
    case 'RESTAURACION':   return { bg: 'bg-emerald-50 border-emerald-200', icon: <CheckCircle className="h-3.5 w-3.5 text-emerald-600" /> }
    case 'PURGA_DEFINITIVA': return { bg: 'bg-red-50 border-red-200',       icon: <Trash2 className="h-3.5 w-3.5 text-red-600" /> }
    case 'ARCHIVO':        return { bg: 'bg-blue-50 border-blue-200',       icon: <FolderOpen className="h-3.5 w-3.5 text-blue-600" /> }
    case 'NOTA':
    default:               return { bg: 'bg-slate-50 border-slate-200',     icon: <MessageCircle className="h-3.5 w-3.5 text-slate-400" /> }
  }
}

const LABEL_BITACORA: Record<string, string> = {
  CREACION: 'Creación',
  EDICION: 'Edición',
  ESTADO: 'Cambio de estado',
  NOTA: 'Nota',
  ARCHIVO: 'Archivo',
  ELIMINACION: 'Movido a papelera',
  RESTAURACION: 'Restaurado de papelera',
  PURGA_DEFINITIVA: 'Eliminación definitiva',
}

function EntradaItem({ e }: { e: EntradaBitacora }) {
  const badgeAnterior = e.estado_anterior ? getEstadoBadge(e.estado_anterior) : null
  const badgeNuevo    = e.estado_nuevo    ? getEstadoBadge(e.estado_nuevo)    : null
  const { bg, icon } = iconoBitacora(e.tipo)

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 border ${bg}`}>
          {icon}
        </div>
        <div className="w-px flex-1 bg-slate-100 mt-1" />
      </div>
      <div className="flex-1 pb-4 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-2xs font-semibold text-slate-600">{LABEL_BITACORA[e.tipo] ?? e.tipo}</span>
          <span className="text-2xs text-slate-500">{formatTimestamp(e.created_at)} · {formatHora(e.created_at)}</span>
          {e.tipo === 'ESTADO' && badgeAnterior && badgeNuevo && (
            <div className="flex items-center gap-1">
              <span className={`text-2xs px-1.5 py-0.5 rounded border ${badgeAnterior.color}`}>{badgeAnterior.label}</span>
              <ChevronRight className="h-3 w-3 text-slate-400" />
              <span className={`text-2xs px-1.5 py-0.5 rounded border ${badgeNuevo.color}`}>{badgeNuevo.label}</span>
            </div>
          )}
          {e.monto_actualizado != null && (
            <span className="text-2xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded font-mono">
              Monto: {formatPeso(e.monto_actualizado)}
            </span>
          )}
        </div>
        {Array.isArray(e.campos_modificados) && e.campos_modificados.length > 0 && (
          <p className="text-2xs text-slate-500 mb-1">
            <span className="text-slate-400">Campos: </span>
            <span className="font-mono">{e.campos_modificados.join(', ')}</span>
          </p>
        )}
        {e.texto && (
          <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded px-3 py-2 leading-relaxed">
            {e.texto}
          </p>
        )}
        {e.usuario && (
          <p className="text-2xs text-slate-400 mt-1">
            Por: {[e.usuario.apellido, e.usuario.nombre].filter(Boolean).join(', ') || e.usuario.id}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Página principal ─────────────────────────────────────────
export default function FichaSiniestroPage() {
  const router   = useRouter()
  const { id }   = useParams<{ id: string }>()
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bitacoraAbortRef = useRef<AbortController | null>(null)

  const [siniestro,  setSiniestro]  = useState<Siniestro | null>(null)
  const [bitacora,   setBitacora]   = useState<EntradaBitacora[]>([])
  const [cargando,   setCargando]   = useState(true)
  const [notaTexto,  setNotaTexto]  = useState('')
  const [nuevoEstado, setNuevoEstado] = useState('')
  const [montoActualizado, setMontoActualizado] = useState('')
  const [motivoRechazo, setMotivoRechazo] = useState('')
  const [guardandoNota, setGuardandoNota] = useState(false)
  const [guardandoEstado, setGuardandoEstado] = useState(false)
  // Estado del conflicto de concurrencia al cambiar estado de siniestro.
  // Si el backend devuelve 409 (NEG_CONFLICTO_CONCURRENCIA), guardamos el registro
  // actual y abrimos el modal para que el usuario decida recargar o sobreescribir.
  const [conflictoEstado, setConflictoEstado] = useState<{ registro_actual: any } | null>(null)
  const [error, setError] = useState('')

  // Número de siniestro de la compañía (se carga después de la denuncia administrativa)
  const [editandoNumSiniestro, setEditandoNumSiniestro] = useState(false)
  const [numSiniestroInput, setNumSiniestroInput] = useState('')
  const [guardandoNumSiniestro, setGuardandoNumSiniestro] = useState(false)

  // Observaciones internas (siniestros.notas) — solo PAS, nunca visibles al cliente
  const [notasInput, setNotasInput] = useState('')
  const [guardandoNotas, setGuardandoNotas] = useState(false)

  // Eliminar
  const [modalEliminar, setModalEliminar] = useState(false)
  const [modalEditar, setModalEditar] = useState(false)
  const [eliminarResumen, setEliminarResumen] = useState<any>(null)
  const [eliminarConfirm, setEliminarConfirm] = useState('')
  const [eliminando, setEliminando] = useState(false)
  const [cargandoPreview, setCargandoPreview] = useState(false)

  // Papelera (soft-delete)
  const [restaurando, setRestaurando] = useState(false)
  const [, setHistorialKey] = useState(0)

  // Marcar denuncia del portal como revisada
  const [marcandoRevisado, setMarcandoRevisado] = useState(false)

  // Cerrar modal con tecla Esc.
  useEffect(() => {
    if (!modalEliminar) return
    const handler = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setModalEliminar(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [modalEliminar])

  // ── Cargar datos ───────────────────────────────────────
  const cargar = useCallback(async () => {
    const [{ data: sin }, rBit] = await Promise.all([
      supabase.from('siniestros').select(`
        id, numero_caso, numero_siniestro,
        fecha_ocurrencia, fecha_denuncia, hora_siniestro,
        tipo_siniestro, estado,
        monto_estimado, monto_liquidado, franquicia_aplicada, monto_cobrado,
        descripcion, detalle_siniestro,
        lugar_siniestro, localidad_siniestro,
        tercero_nombre, tercero_dni, tercero_telefono, tercero_patente,
        notas,
        deleted_at, updated_at,
        origen_creacion, revisado_por_pas, fecha_revision,
        asegurado:personas!persona_id (id, apellido, nombre, razon_social, telefono, whatsapp, usuario_id),
        poliza:polizas!poliza_id (
          id, numero_poliza,
          compania:catalogos!compania_id (nombre),
          ramo:catalogos!ramo_id (nombre, metadata),
          riesgos (tipo_riesgo, detalle_tecnico)
        )
      `).eq('id', id).single(),
      apiCall<{ eventos: EntradaBitacora[] }>(
        `/api/siniestros/${id}/bitacora`,
        { cache: 'no-store' },
        { mostrar_toast_en_error: false },
      ),
    ])
    if (sin) {
      setSiniestro(sin as unknown as Siniestro)
      setNuevoEstado(sin.estado)
      setNotasInput((sin as any).notas ?? '')
    }
    if (rBit.ok && rBit.data) setBitacora(rBit.data.eventos ?? [])
    setCargando(false)
  }, [supabase, id])

  useEffect(() => { cargar() }, [cargar])

  // Realtime: cambios en ESTE siniestro + bitácora + archivos. Filtrado por id/siniestro_id
  // para no re-cargar la ficha ante cambios de otros siniestros del sistema.
  useRealtimeRefresh({
    tablas: ['siniestros'],
    filter: `id=eq.${id}`,
    onCambio: cargar,
  })
  // siniestro_archivos ahora la escucha el hijo GestorArchivos (evita re-render
  // completo post-upload). La bitácora se refresca aislada con `recargarBitacora`
  // en lugar de re-cargar la ficha entera → evita el flash.
  useRealtimeRefresh({
    tablas: ['siniestro_bitacora'],
    filter: `siniestro_id=eq.${id}`,
    onCambio: () => { void recargarBitacora() },
  })

  const recargarBitacora = async () => {
    // AbortController para cancelar la query previa si el usuario dispara
    // varias en rápida sucesión (cambio de estado + nota nueva, etc.).
    bitacoraAbortRef.current?.abort()
    const controller = new AbortController()
    bitacoraAbortRef.current = controller
    const r = await apiCall<{ eventos: EntradaBitacora[] }>(
      `/api/siniestros/${id}/bitacora`,
      { cache: 'no-store', signal: controller.signal },
      { mostrar_toast_en_error: false },
    )
    if (controller.signal.aborted) return
    if (r.ok && r.data) setBitacora(r.data.eventos ?? [])
  }

  // ── Agregar nota ───────────────────────────────────────
  const agregarNota = async () => {
    if (!notaTexto.trim()) return
    setGuardandoNota(true); setError('')
    const r = await apiCall(
      `/api/siniestros/${id}/bitacora/nota`,
      { method: 'POST', body: { texto: notaTexto.trim() } },
      { mostrar_toast_en_error: false },
    )
    if (!r.ok) {
      setError(r.error?.mensaje ?? 'No se pudo guardar la nota')
    } else {
      setNotaTexto('')
      await recargarBitacora()
    }
    setGuardandoNota(false)
  }

  // ── Cambiar estado ─────────────────────────────────────
  const cambiarEstado = async () => {
    if (!siniestro || nuevoEstado === siniestro.estado) return

    // Validación adicional en cliente para feedback inmediato (la real está en el backend).
    const siguientesValidos = obtenerEstadosSiguientes(siniestro.estado)
    if (!siguientesValidos.includes(nuevoEstado)) {
      setError(`No se puede pasar de ${getEstadoBadge(siniestro.estado).label} a ${getEstadoBadge(nuevoEstado).label}`)
      return
    }

    if (nuevoEstado === 'RECHAZADO' && !motivoRechazo.trim()) {
      setError('Indicá el motivo del rechazo antes de continuar.')
      return
    }

    await ejecutarCambioEstado({ force_overwrite: false })
  }

  const ejecutarCambioEstado = async ({ force_overwrite }: { force_overwrite: boolean }) => {
    if (!siniestro) return
    setGuardandoEstado(true); setError('')

    const r = await apiCall<{ estado_nuevo: string; fecha_cierre: string | null }>(
      `/api/siniestros/${id}/cambiar-estado`,
      {
        method: 'POST',
        body: {
          estado_nuevo: nuevoEstado,
          monto_liquidado: montoActualizado || undefined,
          motivo_rechazo: nuevoEstado === 'RECHAZADO' ? motivoRechazo.trim() : undefined,
          // Optimistic concurrency (#81): mandamos el updated_at del siniestro que
          // el usuario tenía cargado. Si otro usuario cambió el estado entre medio,
          // el backend devuelve 409 con `registro_actual` y abrimos modal.
          if_match_updated_at: siniestro.updated_at ?? undefined,
          force_overwrite: force_overwrite || undefined,
        },
      },
      { mostrar_toast_en_error: false },
    )

    if (!r.ok) {
      const err = r.error
      // 409: otro usuario cambió el siniestro. Abrimos modal de conflicto.
      if (err?.codigo === 'ERR_NEG_004' && (err as any)?.registro_actual) {
        setConflictoEstado({ registro_actual: (err as any).registro_actual })
        setGuardandoEstado(false)
        return
      }
      const msg = err?.campos
        ? Object.values(err.campos).join(' · ')
        : err?.mensaje ?? 'No se pudo cambiar el estado'
      setError(msg)
    } else {
      setSiniestro(s => s ? {
        ...s,
        estado: nuevoEstado,
        monto_liquidado: montoActualizado ? parseFloat(montoActualizado) : s.monto_liquidado,
      } : s)
      setMontoActualizado('')
      setMotivoRechazo('')
      setConflictoEstado(null)
      await recargarBitacora()
      toast.exito(`Estado actualizado a ${getEstadoBadge(nuevoEstado).label}`)
    }
    setGuardandoEstado(false)
  }

  if (cargando) return (
    <div className="flex items-center justify-center h-48">
      <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
    </div>
  )

  if (!siniestro) return (
    <div className="flex flex-col items-center justify-center h-48 gap-2 text-slate-400">
      <AlertCircle className="h-8 w-8" />
      <p className="text-sm">Siniestro no encontrado</p>
    </div>
  )

  // Control de acceso por cartera
  if (usuario && !tieneAccesoTotal(usuario) && siniestro.asegurado?.usuario_id && siniestro.asegurado.usuario_id !== usuario.id) {
    router.replace('/crm/siniestros')
    return null
  }

  const tipoRiesgo = (siniestro.poliza?.ramo as any)?.metadata?.tipo_riesgo ?? ''
  const detalle    = siniestro.detalle_siniestro ?? {}
  const estadoActual = getEstadoBadge(siniestro.estado)

  const enPapelera = !!siniestro.deleted_at
  const diasParaPurga = enPapelera
    ? Math.max(0, 30 - Math.floor((Date.now() - new Date(siniestro.deleted_at as string).getTime()) / 86400000))
    : null

  async function guardarNotas() {
    if (!siniestro) return
    const valor = notasInput.trim()
    setGuardandoNotas(true); setError('')
    const r = await apiCall(
      `/api/siniestros/${id}`,
      { method: 'PATCH', body: { notas: valor || null } },
      { mostrar_toast_en_error: false },
    )
    setGuardandoNotas(false)
    if (!r.ok) {
      setError(r.error?.mensaje ?? 'No se pudieron guardar las observaciones')
      return
    }
    setSiniestro(s => s ? { ...s, notas: valor || null } : s)
    toast.exito(valor ? 'Observaciones guardadas' : 'Observaciones borradas')
    setHistorialKey(k => k + 1)
    await recargarBitacora()
  }

  async function guardarNumeroSiniestro() {
    if (!siniestro) return
    const valor = numSiniestroInput.trim()
    setGuardandoNumSiniestro(true); setError('')
    const r = await apiCall(
      `/api/siniestros/${id}`,
      { method: 'PATCH', body: { numero_siniestro: valor || null } },
      { mostrar_toast_en_error: false },
    )
    setGuardandoNumSiniestro(false)
    if (!r.ok) {
      setError(r.error?.mensaje ?? 'No se pudo guardar el número')
      return
    }
    setSiniestro(s => s ? { ...s, numero_siniestro: valor || null } : s)
    setEditandoNumSiniestro(false)
    setHistorialKey(k => k + 1)
    await recargarBitacora()
    toast.exito(valor ? `Número de siniestro guardado: ${valor}` : 'Número de siniestro borrado')
  }

  async function restaurarSiniestro() {
    setRestaurando(true)
    const r = await apiCall(`/api/siniestros/${id}/restaurar`, { method: 'POST' }, { mostrar_toast_en_error: false })
    setRestaurando(false)
    if (r.ok) {
      toast.exito('Siniestro restaurado')
      // Recargar la ficha para que el banner desaparezca.
      window.location.reload()
    } else {
      toast.error(r.error ?? { mensaje: 'No se pudo restaurar' })
    }
  }

  async function marcarComoRevisado() {
    if (!siniestro) return
    setMarcandoRevisado(true)
    const r = await apiCall(`/api/siniestros/${id}/marcar-revisado`, { method: 'POST' }, { mostrar_toast_en_error: false })
    setMarcandoRevisado(false)
    if (r.ok) {
      toast.exito('Denuncia marcada como revisada')
      setSiniestro(s => s ? { ...s, revisado_por_pas: true, fecha_revision: new Date().toISOString() } : s)
      setHistorialKey(k => k + 1)
    } else {
      toast.error(r.error ?? { mensaje: 'No se pudo marcar como revisada' })
    }
  }

  return (
    <div className="flex flex-col gap-3 max-w-5xl px-1 sm:px-0">

      {/* Banner papelera */}
      {enPapelera && (
        <div className="bg-amber-50 border border-amber-300 rounded p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-amber-900">
            <Trash2 className="h-4 w-4 text-amber-700 shrink-0" />
            <span>
              Caso <strong>#{siniestro.numero_caso}</strong> en papelera desde{' '}
              {formatFecha(siniestro.deleted_at as string)}.
              Faltan <strong>{diasParaPurga}</strong> día{diasParaPurga !== 1 ? 's' : ''} para la eliminación definitiva.
            </span>
          </div>
          <button
            onClick={restaurarSiniestro}
            disabled={restaurando}
            className="btn-primary flex items-center gap-1.5 disabled:opacity-50"
          >
            {restaurando ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
            {restaurando ? 'Restaurando...' : 'Restaurar'}
          </button>
        </div>
      )}

      {/* Banner denuncia del portal sin revisar */}
      {!enPapelera && siniestro.origen_creacion === 'PORTAL_CLIENTE' && !siniestro.revisado_por_pas && (
        <div className="bg-red-50 border-l-4 border-red-400 border border-red-200 rounded p-3 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2 text-xs text-red-900 flex-1">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5 animate-pulse" />
            <div>
              <div className="font-semibold text-red-900 mb-0.5">
                Denuncia cargada por el cliente desde el portal
              </div>
              <p className="text-red-800 leading-relaxed">
                Revisá los datos, descargá los archivos adjuntos y cargá la denuncia en la compañía cuanto antes.
                Una vez gestionado, marcalo como revisado para que deje de aparecer en las alertas.
              </p>
            </div>
          </div>
          <button
            onClick={marcarComoRevisado}
            disabled={marcandoRevisado}
            className="btn-primary flex items-center gap-1.5 disabled:opacity-50 shrink-0"
          >
            {marcandoRevisado ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle className="h-3 w-3" />}
            {marcandoRevisado ? 'Marcando...' : 'Marcar revisado'}
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <button onClick={() => router.push('/crm/siniestros')}
            className="btn-secondary h-7 w-7 p-0 flex items-center justify-center mt-0.5"
            title="Volver">
            <ArrowLeft className="h-3 w-3" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-slate-800">Caso #{siniestro.numero_caso}</h1>
              <span
                className={`text-2xs font-semibold px-2 py-0.5 rounded border ${estadoActual.color}`}
                title={getTooltipEstado(siniestro.estado) || undefined}
              >
                {estadoActual.label}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-semibold text-slate-800">{tipoLabel(siniestro.tipo_siniestro)}</span>
              <span className="text-slate-400">•</span>
              <span className="text-slate-700">
                Denunciado el <span className="font-medium">{formatFechaLocalLarga(siniestro.fecha_denuncia)}</span>
              </span>
              {siniestro.numero_siniestro ? (
                <>
                  <span className="text-slate-400">•</span>
                  <span className="text-slate-700">
                    N° <span className="font-mono font-semibold">{siniestro.numero_siniestro}</span>
                    {siniestro.poliza?.compania?.nombre && (
                      <span className="text-slate-500"> ({siniestro.poliza.compania.nombre})</span>
                    )}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-slate-400">•</span>
                  <span className="italic text-amber-700">N° siniestro pendiente de carga</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PresenciaEnFicha tipoEntidad="siniestro" entidadId={id} />
          <button
            onClick={async () => {
              const url = await construirUrlWhatsapp('info_siniestro',
                siniestro.asegurado?.whatsapp ?? siniestro.asegurado?.telefono ?? '',
                {
                  nombre: siniestro.asegurado?.nombre || nombreAsegurado(siniestro),
                  numero_caso: siniestro.numero_caso,
                })
              window.open(url, '_blank')
            }}
            className="btn-secondary flex items-center gap-1">
            <MessageCircle className="h-3 w-3 text-green-600" /> WhatsApp
          </button>
          {!enPapelera && !esEstadoTerminal(siniestro.estado) && (
            <button
              onClick={() => setModalEditar(true)}
              className="btn-secondary flex items-center gap-1">
              <Pencil className="h-3 w-3" /> Editar datos
            </button>
          )}
          {puedeEliminar(usuario) && !enPapelera && (
            <button
              onClick={async () => {
                setCargandoPreview(true); setEliminarResumen(null); setEliminarConfirm('')
                try {
                  const r = await apiCall<{ resumen: any }>(`/api/siniestros/${id}?preview=true`, {}, { mostrar_toast_en_error: false })
                  if (r.ok && r.data) {
                    const payload = r.data as { resumen?: any }
                    if (payload.resumen) setEliminarResumen(payload.resumen)
                  }
                } catch (err) {
                  logger.warn({ modulo: 'siniestros', mensaje: 'Error cargando preview de eliminación', contexto: { error: String(err) } })
                }
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

      {/* Stepper */}
      <div className="bg-white border border-slate-200 rounded px-4 py-3 overflow-x-auto">
        <StepperEstados estadoActual={siniestro.estado} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">

        {/* Columna izquierda — info */}
        <div className="lg:col-span-1 flex flex-col gap-2">

          {/* Número de siniestro de la compañía (se carga después de la denuncia administrativa) */}
          <div className={`bg-white border rounded overflow-hidden ${siniestro.numero_siniestro ? 'border-slate-200' : 'border-amber-300'}`}>
            <div className={`px-3 py-2 border-b flex items-center justify-between ${siniestro.numero_siniestro ? 'border-slate-100 bg-slate-50' : 'border-amber-200 bg-amber-50'}`}>
              <h3 className={`text-2xs font-semibold uppercase tracking-wide ${siniestro.numero_siniestro ? 'text-slate-500' : 'text-amber-800'}`}>
                Siniestro N° ({siniestro.poliza?.compania?.nombre ?? 'compañía'})
              </h3>
              {siniestro.numero_siniestro && !editandoNumSiniestro && (
                <button
                  type="button"
                  onClick={() => { setNumSiniestroInput(siniestro.numero_siniestro ?? ''); setEditandoNumSiniestro(true) }}
                  className="text-2xs text-blue-600 hover:underline"
                >
                  Editar
                </button>
              )}
            </div>
            <div className="p-3 flex flex-col gap-2">
              {!editandoNumSiniestro && siniestro.numero_siniestro && (
                <span className="font-mono text-sm font-semibold text-slate-700">{siniestro.numero_siniestro}</span>
              )}
              {!editandoNumSiniestro && !siniestro.numero_siniestro && (
                <>
                  <p className="text-2xs text-amber-800 leading-relaxed">
                    Pendiente de carga. Cargá acá el número que te asignó la compañía al hacer la denuncia administrativa.
                  </p>
                  <button
                    type="button"
                    onClick={() => { setNumSiniestroInput(''); setEditandoNumSiniestro(true) }}
                    className="btn-primary self-start"
                  >
                    <Save className="h-3 w-3" /> Cargar número
                  </button>
                </>
              )}
              {editandoNumSiniestro && (
                <>
                  <input
                    type="text"
                    className="form-input font-mono"
                    value={numSiniestroInput}
                    onChange={e => setNumSiniestroInput(e.target.value)}
                    placeholder="Ej: SIN-2026-001234"
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter') guardarNumeroSiniestro()
                      else if (e.key === 'Escape') setEditandoNumSiniestro(false)
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={guardarNumeroSiniestro}
                      disabled={guardandoNumSiniestro}
                      className="btn-primary"
                    >
                      {guardandoNumSiniestro ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                      {guardandoNumSiniestro ? 'Guardando...' : 'Guardar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditandoNumSiniestro(false)}
                      className="btn-secondary"
                    >
                      Cancelar
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Asegurado */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Asegurado</h3>
            </div>
            <div className="p-3 flex flex-col gap-1.5">
              <button onClick={() => router.push(`/crm/personas/${siniestro.asegurado?.id}`)}
                className="flex items-center gap-1.5 text-blue-600 hover:underline text-xs font-medium text-left">
                <User className="h-3 w-3" />
                {nombreAsegurado(siniestro)}
              </button>
              {siniestro.asegurado?.telefono && (
                <p className="text-xs text-slate-500 font-mono">{siniestro.asegurado.telefono}</p>
              )}
            </div>
          </div>

          {/* Póliza */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Póliza vinculada</h3>
            </div>
            <div className="p-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => router.push(`/crm/polizas/${siniestro.poliza?.id}`)}
                className="flex items-center gap-1.5 text-blue-600 hover:underline text-left"
                title="Ir a la ficha de la póliza"
              >
                <FileText className="h-3 w-3" />
                <span className="font-mono text-xs font-semibold">{siniestro.poliza?.numero_poliza}</span>
              </button>
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                {iconoRamo(tipoRiesgo)}
                {(siniestro.poliza?.ramo as any)?.nombre ?? '—'}
              </div>
              {siniestro.poliza?.compania && (
                <p className="text-xs text-slate-500">{siniestro.poliza.compania.nombre}</p>
              )}
              <div className="border-t border-slate-100 pt-2 mt-1">
                <p className="text-2xs text-slate-500 mb-1 uppercase tracking-wide font-semibold">Bien afectado</p>
                <DescripcionBien tipoRiesgo={tipoRiesgo} dt={siniestro.poliza?.riesgos?.[0]?.detalle_tecnico} />
              </div>
            </div>
          </div>

          {/* Montos */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Montos</h3>
            </div>
            <div className="p-3 flex flex-col gap-2">
              <div>
                <p className="text-2xs text-slate-500 mb-0.5">Estimado</p>
                <p className="text-sm font-semibold text-slate-700">
                  {siniestro.monto_estimado ? formatPeso(siniestro.monto_estimado) : '—'}
                </p>
              </div>
              {siniestro.monto_liquidado && (
                <div>
                  <p className="text-2xs text-slate-500 mb-0.5">Liquidado</p>
                  <p className="text-sm font-semibold text-emerald-700">{formatPeso(siniestro.monto_liquidado)}</p>
                </div>
              )}
            </div>
          </div>

          {/* Detalle específico del ramo. Mostramos los campos en el orden del
              catálogo del ramo (los que el PAS configuró en "Campos del siniestro")
              y al final cualquier key extra que haya quedado en el JSONB pero que
              ya no esté en el catálogo. */}
          {(() => {
            const camposCatalogo = extraerCamposCustom(siniestro.poliza?.ramo?.metadata as any)
            const labelsMap = mapaLabelsPorKey(camposCatalogo)
            // Filtramos keys vacías. Un objeto/array cuenta como no-vacío si
            // tiene al menos un valor útil. Booleans (aún false) y strings
            // como "no"/"sí" SIEMPRE cuentan como contenido — son datos
            // significativos: "no hubo lesionados" es una respuesta, no ruido.
            const tieneContenido = (v: unknown): boolean => {
              if (v == null || v === '') return false
              if (typeof v === 'boolean') return true
              if (Array.isArray(v)) return v.some(tieneContenido)
              if (typeof v === 'object') return Object.values(v as Record<string, unknown>).some(tieneContenido)
              return true
            }
            const keysVisibles = Object.keys(detalle).filter(k => k !== 'tipo_riesgo' && tieneContenido(detalle[k]))
            if (keysVisibles.length === 0) return null
            const keysOrdenadas = [
              ...camposCatalogo.map(c => c.key).filter(k => keysVisibles.includes(k)),
              ...keysVisibles.filter(k => !labelsMap[k]),
            ]

            /** Convierte cualquier valor del detalle en JSX legible. */
            const renderValor = (valor: unknown): React.ReactNode => {
              if (valor == null || valor === '') return '—'
              if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
              if (typeof valor === 'string' || typeof valor === 'number') return String(valor)
              // Array (ej: testigos): lista con separador
              if (Array.isArray(valor)) {
                if (valor.length === 0) return '—'
                return (
                  <div className="flex flex-col gap-2">
                    {valor.map((item, i) => (
                      <div key={i} className="border-l-2 border-slate-200 pl-2">
                        <p className="text-2xs text-slate-400 mb-0.5">#{i + 1}</p>
                        {renderValor(item)}
                      </div>
                    ))}
                  </div>
                )
              }
              // Object (ej: conductor, tercero): sub-campos con label + valor
              if (typeof valor === 'object') {
                const entries = Object.entries(valor as Record<string, unknown>).filter(([, v]) => tieneContenido(v))
                if (entries.length === 0) return '—'
                return (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                    {entries.map(([k, v]) => (
                      <div key={k}>
                        <span className="text-2xs text-slate-400 capitalize">{k.replace(/_/g, ' ')}: </span>
                        <span className="text-xs text-slate-700">{renderValor(v)}</span>
                      </div>
                    ))}
                  </div>
                )
              }
              return String(valor)
            }

            return (
              <div className="bg-white border border-slate-200 rounded overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
                  <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Detalles del siniestro</h3>
                </div>
                <div className="p-3 flex flex-col gap-3">
                  {keysOrdenadas.map(k => (
                    <div key={k}>
                      <p className="text-2xs text-slate-500 mb-1 font-medium">{labelDeCampo(k, labelsMap)}</p>
                      <div className="text-xs text-slate-700">{renderValor(detalle[k])}</div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

        </div>

        {/* Columna derecha — gestión + bitácora */}
        <div className="lg:col-span-2 flex flex-col gap-2">

          {/* Descripción */}
          {siniestro.descripcion && (
            <div className="bg-white border border-slate-200 rounded p-3">
              <p className="text-2xs text-slate-500 mb-1 font-semibold uppercase tracking-wide">Relato de los hechos</p>
              <p className="text-xs text-slate-700 leading-relaxed">{siniestro.descripcion}</p>
            </div>
          )}

          {/* Panel de gestión: cambiar estado */}
          {!esEstadoTerminal(siniestro.estado) ? (
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Actualizar estado</h3>
            </div>
            <div className="p-3 flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-36">
                <label className="text-xs text-slate-500 mb-1 block">Nuevo estado</label>
                <select className="form-input w-full" value={nuevoEstado} onChange={e => setNuevoEstado(e.target.value)}>
                  <option value={siniestro.estado}>{getEstadoBadge(siniestro.estado).label} (actual)</option>
                  {obtenerEstadosSiguientes(siniestro.estado).map(est => {
                    const badge = getEstadoBadge(est)
                    return <option key={est} value={est}>{badge.label}</option>
                  })}
                </select>
              </div>
              {(nuevoEstado === 'LIQUIDACION' || nuevoEstado === 'FINALIZADO') && (
                <div className="flex-1 min-w-36">
                  <label className="text-xs text-slate-500 mb-1 block">Monto liquidado</label>
                  <div className="flex gap-1">
                    <span className="flex items-center px-2 bg-slate-100 border border-slate-300 rounded-l text-xs text-slate-500 border-r-0">$</span>
                    <input className="form-input font-mono rounded-l-none flex-1"
                      value={montoActualizado}
                      onChange={e => setMontoActualizado(e.target.value.replace(/[^\d.]/g, ''))}
                      placeholder="0" inputMode="decimal" />
                  </div>
                </div>
              )}
              <button
                onClick={cambiarEstado}
                disabled={guardandoEstado || nuevoEstado === siniestro.estado || (nuevoEstado === 'RECHAZADO' && !motivoRechazo.trim())}
                className="btn-primary">
                {guardandoEstado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                {guardandoEstado ? 'Guardando...' : 'Actualizar'}
              </button>
              {nuevoEstado === 'RECHAZADO' && (
                <div className="basis-full">
                  <label className="text-xs text-slate-500 mb-1 block">
                    Motivo del rechazo <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    className="form-input w-full resize-none text-xs"
                    rows={2}
                    placeholder="Ej: Cobertura no aplicable, falta de documentación, fuera de vigencia..."
                    value={motivoRechazo}
                    onChange={e => setMotivoRechazo(e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>
          ) : (
          <div className="bg-white border border-slate-200 rounded p-3">
            <p className="text-xs text-slate-500 flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-slate-400" />
              Este siniestro está en estado terminal ({getEstadoBadge(siniestro.estado).label}). No se puede cambiar de estado.
            </p>
          </div>
          )}

          {/* Bitácora */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden flex flex-col">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">Bitácora de seguimiento</h3>
              <span className="text-2xs text-slate-500">{bitacora.length} entradas</span>
            </div>

            {/* Input nueva nota */}
            <div className="p-3 border-b border-slate-100">
              <textarea
                ref={textareaRef}
                className="form-input w-full resize-none text-xs"
                rows={2}
                placeholder="Escribí una nota de seguimiento..."
                value={notaTexto}
                onChange={e => setNotaTexto(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) agregarNota() }}
              />
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-2xs text-slate-500">Ctrl+Enter para enviar</span>
                <button onClick={agregarNota} disabled={guardandoNota || !notaTexto.trim()} className="btn-primary">
                  {guardandoNota ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  Agregar nota
                </button>
              </div>
            </div>

            {/* Lista de entradas */}
            <div className="p-3 flex flex-col gap-0 overflow-y-auto max-h-96">
              {bitacora.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">
                  Sin entradas todavía. Agregá la primera nota arriba.
                </p>
              ) : bitacora.map(e => <EntradaItem key={e.id} e={e} />)}
            </div>
          </div>

          {/* Observaciones internas — análogo a polizas.notas. Solo el PAS las ve,
              nunca visibles al asegurado. Editable inline con auto-guardado al
              hacer click en Guardar (solo se muestra si cambió respecto al valor
              en DB). */}
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-baseline justify-between">
              <h3 className="text-2xs font-semibold text-slate-500 uppercase tracking-wide">
                Observaciones internas
              </h3>
              <span className="inline-flex items-center gap-1 text-2xs text-slate-500">
                No se comparte con el asegurado
              </span>
            </div>
            <div className="p-3">
              <textarea
                className="w-full form-input min-h-[80px] py-2 text-xs resize-none"
                value={notasInput}
                onChange={e => setNotasInput(e.target.value)}
                placeholder="Anotá info interna del caso — gestiones con la compañía, contactos, próximos pasos, cualquier cosa que no vaya en la bitácora pública..."
                disabled={guardandoNotas}
              />
              {notasInput.trim() !== (siniestro.notas ?? '').trim() && (
                <div className="flex items-center gap-1.5 mt-2">
                  <button
                    onClick={guardarNotas}
                    disabled={guardandoNotas}
                    className="btn-primary text-xs"
                  >
                    {guardandoNotas ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    Guardar
                  </button>
                  <button
                    onClick={() => setNotasInput(siniestro.notas ?? '')}
                    disabled={guardandoNotas}
                    className="btn-secondary text-xs"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Documentación del siniestro — unificado (fotos + documentación en un solo lugar,
              desde v1.0.124). El asegurado sube todo en una sola categoría. */}
          <GestorArchivos
            siniestroId={siniestro.id}
            numeroCaso={siniestro.numero_caso}
            categoria="documentacion"
            titulo="Documentación del siniestro"
          />

          {error && (
            <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              <AlertCircle className="h-3.5 w-3.5" />{error}
            </div>
          )}
        </div>
      </div>

      {/* ── Modal Editar ─────────────────────────────────────── */}
      <EditarSiniestroModal
        siniestro={{
          ...siniestro,
          // Exponer campos que el modal necesita para editar el detalle_siniestro dinámico.
          detalle_siniestro: (siniestro as { detalle_siniestro?: Record<string, unknown> | null }).detalle_siniestro ?? null,
          tipo_riesgo: (siniestro.poliza?.ramo?.metadata as { tipo_riesgo?: string } | null | undefined)?.tipo_riesgo ?? null,
        }}
        abierto={modalEditar}
        onCerrar={() => setModalEditar(false)}
        onGuardado={async () => {
          // Refrescar siniestro y bitácora
          const { data: sin } = await supabase.from('siniestros').select(`
            id, numero_caso, numero_siniestro,
            fecha_ocurrencia, fecha_denuncia, hora_siniestro,
            tipo_siniestro, estado,
            monto_estimado, monto_liquidado, franquicia_aplicada, monto_cobrado,
            descripcion, detalle_siniestro,
            lugar_siniestro, localidad_siniestro,
            tercero_nombre, tercero_dni, tercero_telefono, tercero_patente,
            notas,
            deleted_at,
            origen_creacion, revisado_por_pas, fecha_revision,
            asegurado:personas!persona_id (id, apellido, nombre, razon_social, telefono, whatsapp, usuario_id),
            poliza:polizas!poliza_id (
              id, numero_poliza,
              compania:catalogos!compania_id (nombre),
              ramo:catalogos!ramo_id (nombre, metadata),
              riesgos (tipo_riesgo, detalle_tecnico)
            )
          `).eq('id', id).single()
          if (sin) setSiniestro(sin as unknown as Siniestro)
          await recargarBitacora()
        }}
      />

      {/* ── Modal Eliminar ───────────────────────────────────── */}
      {modalEliminar && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setModalEliminar(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 rounded-t-lg border-b bg-red-50 border-red-200">
              <div className="flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-red-600" />
                <h3 className="text-sm font-semibold text-red-800">Mover siniestro a la papelera</h3>
              </div>
              <button onClick={() => setModalEliminar(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <p className="text-xs text-slate-600">
                El caso <strong className="font-mono">#{siniestro.numero_caso}</strong> se moverá a la papelera.
                Tenés <strong>30 días</strong> para deshacerlo desde la propia ficha. Pasado ese plazo se elimina
                definitivamente con bitácora y archivos.
              </p>
              {eliminarResumen && (eliminarResumen.bitacora > 0 || eliminarResumen.archivos > 0) && (
                <div className="bg-slate-50 border border-slate-200 rounded p-3 flex flex-col gap-1.5">
                  <p className="text-2xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Se eliminará al purgar:</p>
                  {eliminarResumen.bitacora > 0 && (
                    <div className="flex items-center gap-2 text-xs text-slate-700">
                      <MessageCircle className="h-3 w-3 text-slate-400" /> {eliminarResumen.bitacora} entrada(s) en la bitácora
                    </div>
                  )}
                  {eliminarResumen.archivos > 0 && (
                    <div className="flex items-center gap-2 text-xs text-slate-700">
                      <FolderOpen className="h-3 w-3 text-slate-400" /> {eliminarResumen.archivos} archivo(s) físico(s)
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="text-xs text-slate-600 mb-1 block">
                  Para confirmar, escribí el número de caso: <span className="font-mono font-semibold">{siniestro.numero_caso}</span>
                </label>
                <input
                  type="text"
                  className="form-input w-full font-mono"
                  value={eliminarConfirm}
                  onChange={e => setEliminarConfirm(e.target.value)}
                  placeholder={siniestro.numero_caso}
                  autoFocus
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-lg">
              <button onClick={() => setModalEliminar(false)} className="btn-secondary">
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setEliminando(true)
                  const r = await apiCall(`/api/siniestros/${id}`, { method: 'DELETE' }, { mostrar_toast_en_error: false })
                  if (r.ok) {
                    toast.exitoConDeshacer(`Caso #${siniestro.numero_caso} movido a la papelera`, {
                      label: 'Deshacer',
                      onClick: async () => {
                        const rr = await apiCall(`/api/siniestros/${id}/restaurar`, { method: 'POST' }, { mostrar_toast_en_error: false })
                        if (rr.ok) {
                          toast.exito('Siniestro restaurado')
                          router.push(`/crm/siniestros/${id}`)
                        } else {
                          toast.error(rr.error ?? { mensaje: 'No se pudo restaurar' })
                        }
                      },
                    })
                    router.push('/crm/siniestros')
                  } else {
                    setError(r.error?.mensaje ?? 'Error al eliminar')
                    setModalEliminar(false)
                    setEliminando(false)
                  }
                }}
                disabled={eliminando || eliminarConfirm !== siniestro.numero_caso}
                className="btn-danger flex items-center gap-1.5 disabled:opacity-50"
              >
                {eliminando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                {eliminando ? 'Moviendo a papelera...' : 'Mover a la papelera'}
              </button>
            </div>
          </div>
        </div>
      )}

      {conflictoEstado && siniestro && (
        <ModalConflictoEdicion
          valoresTuyos={{ estado: nuevoEstado, monto_liquidado: montoActualizado }}
          registroActual={conflictoEstado.registro_actual}
          labels={{ estado: 'Estado', monto_liquidado: 'Monto liquidado' }}
          campos={['estado', 'monto_liquidado']}
          onCerrar={() => setConflictoEstado(null)}
          onRecargar={async () => {
            setConflictoEstado(null)
            await cargar()
            toast.info('Datos actualizados con la versión más reciente')
          }}
          onSobreescribir={async () => {
            setConflictoEstado(null)
            await ejecutarCambioEstado({ force_overwrite: true })
          }}
        />
      )}
    </div>
  )
}
