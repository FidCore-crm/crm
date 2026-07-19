'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, List, Loader2, FileText, AlertCircle, Clock,
  CheckCircle, XCircle, FileEdit, Send, X
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { formatFechaLocalLarga, formatMoneda, hoyLocal } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { aplicarFiltroCartera, obtenerIdsPapelera, excluirPersonasEnPapelera } from '@/lib/cartera-filter'
import { EstadoCarga } from '@/components/EstadoCarga'
import { useRealtimeRefresh } from '@/lib/hooks/useRealtimeRefresh'

interface CotCard {
  id: string
  numero_cotizacion: string
  estado: string
  created_at: string
  fecha_envio: string | null
  fecha_cierre: string | null
  updated_at: string
  compania_ganadora: { nombre: string } | null
  persona: { apellido: string; nombre: string | null } | null
  lead: { apellido: string; nombre: string } | null
  ramo: { nombre: string } | null
  opciones_count: number
  oportunidad: { monto_estimado: number | null; probabilidad_cierre: number | null } | null
}

interface Catalogo { id: string; nombre: string }

// Valid state transitions
const TRANSICIONES_VALIDAS: Record<string, string[]> = {
  BORRADOR: ['ENVIADA'],
  ENVIADA: ['EN_PROCESO', 'GANADA', 'PERDIDA'],
  EN_PROCESO: ['GANADA', 'PERDIDA'],
}

const MOTIVOS_PERDIDA = ['Precio alto', 'Eligió otra compañía', 'No le interesa', 'No responde', 'Otro']

const COLUMNAS = [
  { key: 'BORRADOR', label: 'Borrador', color: 'border-slate-400', headerBg: 'bg-slate-100 text-slate-700', icon: FileEdit },
  { key: 'ENVIADA', label: 'Enviada', color: 'border-blue-400', headerBg: 'bg-blue-50 text-blue-700', icon: Send },
  { key: 'EN_PROCESO', label: 'En proceso', color: 'border-amber-400', headerBg: 'bg-amber-50 text-amber-700', icon: Clock },
  { key: 'CERRADAS', label: 'Cerradas', color: 'border-emerald-400', headerBg: 'bg-slate-50 text-slate-700', icon: CheckCircle },
]

function diasDesde(fecha: string): number {
  return Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000)
}

function destinatario(c: CotCard) {
  if (c.persona) return { nombre: `${c.persona.apellido}, ${c.persona.nombre ?? ''}`, esLead: false }
  if (c.lead) return { nombre: `${c.lead.apellido}, ${c.lead.nombre}`, esLead: true }
  return { nombre: 'Sin asignar', esLead: false }
}

export default function PipelinePage() {
  const router   = useRouter()
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  const [columnas, setColumnas] = useState<Record<string, CotCard[]>>({ BORRADOR: [], ENVIADA: [], EN_PROCESO: [], CERRADAS: [] })
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<{ codigo?: string; mensaje: string } | null>(null)
  const [filtroRamo, setFiltroRamo] = useState('')
  const [ramos, setRamos] = useState<Catalogo[]>([])
  const [tabMobile, setTabMobile] = useState('BORRADOR')

  // Drag & Drop state
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)

  // Modal for state transitions that require data
  const [modalTransicion, setModalTransicion] = useState<{
    cotizacion: CotCard
    nuevoEstado: string
  } | null>(null)
  const [modalFecha, setModalFecha] = useState(hoyLocal())
  const [modalMotivo, setModalMotivo] = useState('')
  const [modalCompaniaId, setModalCompaniaId] = useState('')
  const [opcionesModal, setOpcionesModal] = useState<{compania_id: string; compania_nombre: string; precio: number}[]>([])
  const [guardandoModal, setGuardandoModal] = useState(false)
  const [errorModal, setErrorModal] = useState('')

  // Cargar ramos
  useEffect(() => {
    async function cargar() {
      const { data: tipos } = await supabase.from('tipo_catalogo').select('id, codigo')
      const tipoRamo = (tipos ?? []).find((t: any) => t.codigo === 'RAMO')
      if (tipoRamo) {
        const { data } = await supabase.from('catalogos').select('id, nombre').eq('tipo_id', tipoRamo.id).eq('activo', true).order('nombre')
        setRamos((data ?? []) as Catalogo[])
      }
    }
    cargar()
  }, [supabase])

  const cargarDatos = useCallback(async (silencioso: boolean = false) => {
    if (!silencioso) setCargando(true)
    setErrorCarga(null)
    const primerDiaMes = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`

    // Excluimos cotizaciones cuyo cliente está en papelera (preserva las
    // cotizaciones a leads, que tienen persona_id NULL).
    const papeleraIds = await obtenerIdsPapelera(supabase)
    const buildQ = (q: any) => excluirPersonasEnPapelera(aplicarFiltroCartera(q, usuario), papeleraIds, 'persona_id')

    const selectFields = `
      id, numero_cotizacion, estado, created_at, fecha_envio, fecha_cierre, updated_at, oportunidad_id,
      compania_ganadora:catalogos!compania_ganadora_id(nombre),
      persona:personas!persona_id(apellido, nombre),
      lead:leads!lead_id(apellido, nombre),
      ramo:catalogos!ramo_id(nombre),
      oportunidad:oportunidades!oportunidad_id(monto_estimado, probabilidad_cierre)
    `

    let qBorrador = buildQ(supabase.from('cotizaciones').select(selectFields).eq('estado', 'BORRADOR').order('created_at', { ascending: false }))
    let qEnviada = buildQ(supabase.from('cotizaciones').select(selectFields).eq('estado', 'ENVIADA').order('fecha_envio', { ascending: false }))
    let qEnProceso = buildQ(supabase.from('cotizaciones').select(selectFields).eq('estado', 'EN_PROCESO').order('updated_at', { ascending: false }))
    let qCerradas = buildQ(supabase.from('cotizaciones').select(selectFields).in('estado', ['GANADA', 'PERDIDA']).gte('fecha_cierre', primerDiaMes).order('fecha_cierre', { ascending: false }))

    if (filtroRamo) {
      qBorrador = qBorrador.eq('ramo_id', filtroRamo)
      qEnviada = qEnviada.eq('ramo_id', filtroRamo)
      qEnProceso = qEnProceso.eq('ramo_id', filtroRamo)
      qCerradas = qCerradas.eq('ramo_id', filtroRamo)
    }

    const [r1, r2, r3, r4] = await Promise.all([qBorrador, qEnviada, qEnProceso, qCerradas])
    const erroresQuery = [r1.error, r2.error, r3.error, r4.error].filter(Boolean)
    if (erroresQuery.length > 0) {
      setErrorCarga({ mensaje: erroresQuery[0]?.message ?? 'No se pudo cargar el pipeline.' })
      setCargando(false)
      return
    }

    // Cargar conteo de opciones
    const allCots = [...(r1.data ?? []), ...(r2.data ?? []), ...(r3.data ?? []), ...(r4.data ?? [])] as any[]
    const allIds = allCots.map(c => c.id)
    let opcionesPorCot: Record<string, number> = {}
    if (allIds.length > 0) {
      const { data: opcData } = await supabase.from('cotizacion_companias').select('cotizacion_id').in('cotizacion_id', allIds)
      for (const o of (opcData ?? []) as any[]) {
        opcionesPorCot[o.cotizacion_id] = (opcionesPorCot[o.cotizacion_id] ?? 0) + 1
      }
    }

    const mapCot = (data: any[]) => data.map(c => ({ ...c, opciones_count: opcionesPorCot[c.id] ?? 0 })) as CotCard[]

    setColumnas({
      BORRADOR: mapCot((r1.data ?? []) as any[]),
      ENVIADA: mapCot((r2.data ?? []) as any[]),
      EN_PROCESO: mapCot((r3.data ?? []) as any[]),
      CERRADAS: mapCot((r4.data ?? []) as any[]),
    })
    setCargando(false)
  }, [supabase, filtroRamo, usuario])

  useEffect(() => { cargarDatos() }, [cargarDatos])

  // Realtime: kanban debe reflejar cambios en el acto. Si otro PAS avanza una
  // cotización desde su vista, esta la muestra en la columna correcta sin F5.
  useRealtimeRefresh({
    tablas: ['cotizaciones', 'cotizacion_companias'],
    onCambio: () => cargarDatos(true),
  })

  // ── Drag & Drop handlers ──
  const handleDragStart = (e: React.DragEvent, cotId: string) => {
    setDraggedId(cotId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', cotId)
    // Add opacity to the dragged element
    const el = e.currentTarget as HTMLElement
    setTimeout(() => el.style.opacity = '0.4', 0)
  }

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggedId(null)
    setDragOverCol(null)
    const el = e.currentTarget as HTMLElement
    el.style.opacity = '1'
  }

  const handleDragOver = (e: React.DragEvent, colKey: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverCol(colKey)
  }

  const handleDragLeave = () => {
    setDragOverCol(null)
  }

  const handleDrop = async (e: React.DragEvent, targetCol: string) => {
    e.preventDefault()
    setDragOverCol(null)
    const cotId = e.dataTransfer.getData('text/plain')
    if (!cotId) return

    // Find the card and its current column
    let card: CotCard | null = null
    let sourceCol = ''
    for (const [col, cards] of Object.entries(columnas)) {
      const found = cards.find(c => c.id === cotId)
      if (found) { card = found; sourceCol = col; break }
    }
    if (!card || sourceCol === targetCol) return

    // Map CERRADAS target to actual state — can't drop INTO cerradas
    if (targetCol === 'CERRADAS') return

    // Check if transition is valid
    const validTargets = TRANSICIONES_VALIDAS[card.estado] ?? []
    if (!validTargets.includes(targetCol)) return

    // If transition requires additional data, open modal
    if (targetCol === 'ENVIADA' && card.estado === 'BORRADOR') {
      setModalTransicion({ cotizacion: card, nuevoEstado: 'ENVIADA' })
      setModalFecha(hoyLocal())
      return
    }
    if (targetCol === 'GANADA' || targetCol === 'PERDIDA') {
      // These can't happen from column drop since GANADA/PERDIDA aren't columns
      return
    }

    // Direct transition: ENVIADA → EN_PROCESO
    if (card.estado === 'ENVIADA' && targetCol === 'EN_PROCESO') {
      await supabase.from('cotizaciones').update({ estado: 'EN_PROCESO' }).eq('id', cotId)
      cargarDatos()
    }
  }

  // Handle state transitions that need modals (from within cards or drag)
  const abrirModalTransicion = async (card: CotCard, nuevoEstado: string) => {
    setModalTransicion({ cotizacion: card, nuevoEstado })
    setModalFecha(hoyLocal())
    setModalMotivo('')
    setModalCompaniaId('')
    setErrorModal('')

    if (nuevoEstado === 'GANADA') {
      const { data } = await supabase.from('cotizacion_companias').select('compania_id, precio, compania:catalogos!compania_id(nombre)').eq('cotizacion_id', card.id)
      setOpcionesModal((data ?? []).map((o: any) => ({ compania_id: o.compania_id, compania_nombre: o.compania?.nombre ?? '—', precio: o.precio })))
    }
  }

  const confirmarTransicion = async () => {
    if (!modalTransicion) return
    const { cotizacion, nuevoEstado } = modalTransicion

    if (nuevoEstado === 'GANADA' && !modalCompaniaId) { setErrorModal('Selecciona la compania ganadora'); return }
    if (nuevoEstado === 'PERDIDA' && !modalMotivo) { setErrorModal('Selecciona un motivo'); return }

    setGuardandoModal(true)
    setErrorModal('')

    const updateData: Record<string, any> = { estado: nuevoEstado }
    if (nuevoEstado === 'ENVIADA') updateData.fecha_envio = modalFecha
    if (nuevoEstado === 'GANADA') { updateData.compania_ganadora_id = modalCompaniaId; updateData.fecha_cierre = modalFecha }
    if (nuevoEstado === 'PERDIDA') { updateData.motivo_perdida = modalMotivo; updateData.fecha_cierre = modalFecha }

    const { error } = await supabase.from('cotizaciones').update(updateData).eq('id', cotizacion.id)
    if (error) { setErrorModal(error.message); setGuardandoModal(false); return }

    if (nuevoEstado === 'GANADA') {
      await supabase.from('cotizacion_companias').update({ seleccionada: false }).eq('cotizacion_id', cotizacion.id)
      await supabase.from('cotizacion_companias').update({ seleccionada: true }).eq('cotizacion_id', cotizacion.id).eq('compania_id', modalCompaniaId)
      // Sync oportunidad
      if ((cotizacion as any).oportunidad_id) {
        await supabase.from('oportunidades').update({ estado: 'GANADA' }).eq('id', (cotizacion as any).oportunidad_id)
      }
    }
    if (nuevoEstado === 'PERDIDA' && (cotizacion as any).oportunidad_id) {
      await supabase.from('oportunidades').update({ estado: 'PERDIDA', motivo_perdida: modalMotivo }).eq('id', (cotizacion as any).oportunidad_id)
    }

    setModalTransicion(null)
    setGuardandoModal(false)
    cargarDatos()
  }

  const totalActivas = columnas.BORRADOR.length + columnas.ENVIADA.length + columnas.EN_PROCESO.length
  const ganadas = columnas.CERRADAS.filter(c => c.estado === 'GANADA').length
  const perdidas = columnas.CERRADAS.filter(c => c.estado === 'PERDIDA').length

  const renderCard = (c: CotCard, draggable: boolean = true) => {
    const dest = destinatario(c)
    const borderColor = c.estado === 'BORRADOR' ? 'border-l-slate-400' :
                        c.estado === 'ENVIADA' ? 'border-l-blue-400' :
                        c.estado === 'EN_PROCESO' ? 'border-l-amber-400' :
                        c.estado === 'GANADA' ? 'border-l-emerald-400' : 'border-l-red-400'

    const sinRespuesta = c.estado === 'ENVIADA' && c.fecha_envio && diasDesde(c.fecha_envio) > 5
    const sinSeguimiento = c.estado === 'EN_PROCESO' && diasDesde(c.updated_at) > 3
    const isDragging = draggedId === c.id

    return (
      <div key={c.id}
        draggable={draggable && !['GANADA', 'PERDIDA'].includes(c.estado)}
        onDragStart={(e) => handleDragStart(e, c.id)}
        onDragEnd={handleDragEnd}
        onClick={() => router.push(`/crm/comercial/cotizaciones/${c.id}`)}
        className={`bg-white border border-slate-200 border-l-4 ${borderColor} rounded p-3 cursor-pointer hover:shadow-md transition-all
          ${draggable && !['GANADA', 'PERDIDA'].includes(c.estado) ? 'cursor-grab active:cursor-grabbing' : ''}
          ${isDragging ? 'opacity-40' : ''}`}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-mono text-xs font-semibold text-slate-700">{c.numero_cotizacion}</span>
          {c.estado === 'GANADA' && <span className="text-2xs font-semibold px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">Ganada</span>}
          {c.estado === 'PERDIDA' && <span className="text-2xs font-semibold px-1.5 py-0.5 rounded border bg-red-50 text-red-700 border-red-200">Perdida</span>}
          {sinRespuesta && <span className="text-2xs font-semibold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">Sin respuesta</span>}
          {sinSeguimiento && <span className="text-2xs font-semibold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">Sin seguimiento</span>}
        </div>
        <p className="text-xs text-slate-700 font-medium">
          {dest.nombre}
          {dest.esLead && <span className="ml-1 text-2xs bg-cyan-50 text-cyan-700 border border-cyan-200 px-1 rounded">Lead</span>}
        </p>
        {c.ramo && <p className="text-2xs text-slate-600 mt-0.5">{c.ramo.nombre}</p>}
        <div className="flex items-center justify-between mt-2">
          <span className="text-2xs text-slate-600">{c.opciones_count} {c.opciones_count === 1 ? 'opcion' : 'opciones'}</span>
          <span className="text-2xs text-slate-600">
            {c.estado === 'BORRADOR' && formatFechaLocalLarga(c.created_at)}
            {c.estado === 'ENVIADA' && (c.fecha_envio ? formatFechaLocalLarga(c.fecha_envio) : formatFechaLocalLarga(c.created_at))}
            {c.estado === 'EN_PROCESO' && formatFechaLocalLarga(c.updated_at)}
            {(c.estado === 'GANADA' || c.estado === 'PERDIDA') && (c.fecha_cierre ? formatFechaLocalLarga(c.fecha_cierre) : '')}
          </span>
        </div>
        {c.estado === 'GANADA' && c.compania_ganadora && (
          <p className="text-2xs text-emerald-600 mt-1 font-medium">{c.compania_ganadora.nombre}</p>
        )}
        {/* Quick action buttons for state changes */}
        {!['GANADA', 'PERDIDA'].includes(c.estado) && (
          <div className="flex items-center gap-1 mt-2 pt-2 border-t border-slate-100" onClick={e => e.stopPropagation()}>
            {(TRANSICIONES_VALIDAS[c.estado] ?? []).map(target => {
              const icons: Record<string, React.ReactNode> = {
                ENVIADA: <Send className="h-3 w-3"/>,
                EN_PROCESO: <Clock className="h-3 w-3"/>,
                GANADA: <CheckCircle className="h-3 w-3"/>,
                PERDIDA: <XCircle className="h-3 w-3"/>,
              }
              const colors: Record<string, string> = {
                ENVIADA: 'text-blue-500 hover:bg-blue-50',
                EN_PROCESO: 'text-amber-500 hover:bg-amber-50',
                GANADA: 'text-emerald-500 hover:bg-emerald-50',
                PERDIDA: 'text-red-500 hover:bg-red-50',
              }
              return (
                <button key={target}
                  onClick={() => abrirModalTransicion(c, target)}
                  className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${colors[target] ?? ''}`}
                  title={target.replace(/_/g, ' ')}>
                  {icons[target]}
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  const sumarColumna = (cards: CotCard[]) => {
    let total = 0, esperado = 0
    for (const c of cards) {
      const m = Number(c.oportunidad?.monto_estimado ?? 0)
      const p = Number(c.oportunidad?.probabilidad_cierre ?? 0)
      total += m
      esperado += m * p / 100
    }
    return { total, esperado }
  }

  const renderColumna = (col: typeof COLUMNAS[0], cards: CotCard[]) => {
    const isDragOver = dragOverCol === col.key && col.key !== 'CERRADAS'
    const { total, esperado } = sumarColumna(cards)
    return (
      <div key={col.key} className="flex flex-col min-w-[260px] flex-1">
        <div className={`${col.headerBg} rounded-t px-3 py-2 border border-b-0 border-slate-200`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <col.icon className="h-3.5 w-3.5"/>
              <span className="text-xs font-semibold">{col.label}</span>
            </div>
            <span className="text-2xs font-mono opacity-70">{cards.length} {cards.length === 1 ? 'oport.' : 'oport.'}</span>
          </div>
          {total > 0 && (
            <div className="mt-1 text-2xs font-mono opacity-80 leading-tight">
              <span className="font-semibold">{formatMoneda(total)}</span>
              <span className="opacity-70"> · esperado: {formatMoneda(esperado)}</span>
            </div>
          )}
        </div>
        <div
          onDragOver={(e) => handleDragOver(e, col.key)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, col.key)}
          className={`flex-1 border border-slate-200 rounded-b bg-slate-50/50 p-2 flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-280px)] min-h-[200px] transition-colors
            ${isDragOver ? 'bg-blue-50/50 border-blue-300 ring-2 ring-blue-200' : ''}`}
        >
          {cards.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-300">
              <FileText className="h-6 w-6 mb-1"/>
              <p className="text-2xs">Sin cotizaciones</p>
            </div>
          ) : cards.map(c => renderCard(c))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Pipeline de ventas</h1>
          <p className="text-xs text-slate-600">
            Mostrando {totalActivas} cotizaciones activas. Cerradas del mes: {ganadas} ganadas, {perdidas} perdidas.
            <span className="text-slate-600 ml-1">Arrastra las tarjetas entre columnas para cambiar el estado.</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="form-input" value={filtroRamo} onChange={e => setFiltroRamo(e.target.value)}>
            <option value="">Todos los ramos</option>
            {ramos.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
          <button onClick={() => router.push('/crm/comercial/cotizaciones/nueva')} className="btn-primary">
            <Plus className="h-3 w-3"/> Nueva cotizacion
          </button>
          <button onClick={() => router.push('/crm/comercial/cotizaciones')} className="btn-secondary">
            <List className="h-3 w-3"/> Ver como lista
          </button>
        </div>
      </div>

      <EstadoCarga
        loading={cargando}
        error={errorCarga}
        empty={false}
        onReintentar={cargarDatos}
      >
        <>
          {/* Desktop: 4 columnas */}
          <div className="hidden md:flex gap-3">
            {COLUMNAS.map(col => renderColumna(col, columnas[col.key] ?? []))}
          </div>

          {/* Mobile: tabs */}
          <div className="md:hidden flex flex-col gap-2">
            <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded overflow-x-auto">
              {COLUMNAS.map(col => (
                <button key={col.key} onClick={() => setTabMobile(col.key)}
                  className={`px-3 py-1.5 text-xs rounded transition-all whitespace-nowrap flex items-center gap-1 ${
                    tabMobile === col.key ? 'bg-white shadow-sm font-medium text-slate-700' : 'text-slate-600'
                  }`}>
                  {col.label}
                  <span className="font-mono text-2xs text-slate-600">{(columnas[col.key] ?? []).length}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              {(columnas[tabMobile] ?? []).length === 0 ? (
                <div className="flex flex-col items-center py-8 text-slate-300">
                  <FileText className="h-6 w-6 mb-1"/>
                  <p className="text-2xs">Sin cotizaciones</p>
                </div>
              ) : (columnas[tabMobile] ?? []).map(c => renderCard(c, false))}
            </div>
          </div>
        </>
      </EstadoCarga>

      {/* ── Modal transicion de estado ── */}
      {modalTransicion && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setModalTransicion(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-800">
                {modalTransicion.nuevoEstado === 'ENVIADA' && 'Marcar como enviada'}
                {modalTransicion.nuevoEstado === 'EN_PROCESO' && 'Marcar en proceso'}
                {modalTransicion.nuevoEstado === 'GANADA' && 'Marcar como ganada'}
                {modalTransicion.nuevoEstado === 'PERDIDA' && 'Marcar como perdida'}
              </h3>
              <button onClick={() => setModalTransicion(null)} className="text-slate-500 hover:text-slate-600">
                <X className="h-4 w-4"/>
              </button>
            </div>

            <p className="text-xs text-slate-600 mb-3">
              Cotizacion <span className="font-mono font-semibold">{modalTransicion.cotizacion.numero_cotizacion}</span>
            </p>

            <div className="space-y-3">
              {modalTransicion.nuevoEstado === 'GANADA' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Compania ganadora <span className="text-red-500">*</span></label>
                  <select className="form-input w-full" value={modalCompaniaId} onChange={e => setModalCompaniaId(e.target.value)}>
                    <option value="">Seleccionar...</option>
                    {opcionesModal.map(o => (
                      <option key={o.compania_id} value={o.compania_id}>{o.compania_nombre} - {formatMoneda(o.precio)}</option>
                    ))}
                  </select>
                </div>
              )}

              {modalTransicion.nuevoEstado === 'PERDIDA' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Motivo <span className="text-red-500">*</span></label>
                  <select className="form-input w-full" value={modalMotivo} onChange={e => setModalMotivo(e.target.value)}>
                    <option value="">Seleccionar...</option>
                    {MOTIVOS_PERDIDA.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fecha</label>
                <input type="date" className="form-input w-full" value={modalFecha} onChange={e => setModalFecha(e.target.value)}/>
              </div>
            </div>

            {errorModal && (
              <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3"/> {errorModal}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setModalTransicion(null)} className="btn-secondary">Cancelar</button>
              <button onClick={confirmarTransicion} disabled={guardandoModal} className="btn-primary">
                {guardandoModal ? <Loader2 className="h-3 w-3 animate-spin"/> : <CheckCircle className="h-3 w-3"/>} Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
