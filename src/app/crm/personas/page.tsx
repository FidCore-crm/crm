'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Search, Plus, Download, RefreshCw, ChevronLeft, ChevronRight,
  Phone, Mail, Users, UserCheck, UserX,
  Eye, Edit, Loader2, X, Send, Trash2
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import {
  formatFecha, getBadgeClase, getLabelEstado, getTooltipEstado, nombreCompleto,
  sanitizarBusquedaNormalizada
} from '@/lib/utils'
import type { Persona, EstadoPersona } from '@/types/database'
import ModalEnviarEmailMasivo from '@/components/ModalEnviarEmailMasivo'
import { EstadoCarga } from '@/components/EstadoCarga'
import { apiCall } from '@/lib/api-client'
import { useEsSoloLectura } from '@/contexts/LicenciaContext'


const POR_PAGINA = 25

export default function PersonasPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Cargando cartera...</div>}>
      <PersonasContent />
    </Suspense>
  )
}

function PersonasContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { usuario } = useAuth()

  // Estado de la UI
  const [personas, setPersonas] = useState<Persona[]>([])
  const [total, setTotal] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<{ codigo?: string; mensaje: string } | null>(null)
  const [contadores, setContadores] = useState<Record<string, number>>({})
  const [enPapelera, setEnPapelera] = useState(0)

  // Selección masiva
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [modalMasivo, setModalMasivo] = useState(false)
  const [comunicacionesActivo, setComunicacionesActivo] = useState(false)
  const { isAdmin } = useAuth()
  const soloLectura = useEsSoloLectura()

  // Filtros
  const [busqueda, setBusqueda] = useState(searchParams.get('q') ?? '')
  const [busquedaInput, setBusquedaInput] = useState(searchParams.get('q') ?? '')
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoPersona | 'TODOS'>('TODOS')
  const [kpiActivo, setKpiActivo] = useState<string | null>(null)
  const [pagina, setPagina] = useState(1)

  // Filtro "Asignado a" — solo admin. null = todos. 'SIN_ASIGNAR' = personas
  // sin usuario_id. UUID = usuarios con esa asignación.
  const [filtroAsignado, setFiltroAsignado] = useState<string | null>(searchParams.get('asignado'))
  const [usuariosLista, setUsuariosLista] = useState<Array<{ id: string; nombre: string; apellido: string }>>([])
  const usuariosMap = useCallback(() => {
    const m = new Map<string, string>()
    for (const u of usuariosLista) m.set(u.id, `${u.apellido}, ${u.nombre}`.trim().replace(/^,\s*/, ''))
    return m
  }, [usuariosLista])

  // Filtro por importación (query param ?importacion_id=...)
  const importacionId = searchParams.get('importacion_id')
  const [filtroImportacion, setFiltroImportacion] = useState<{ id: string; fecha: string; archivos: string[]; total: number } | null>(null)
  const [idsImportacion, setIdsImportacion] = useState<string[] | null>(null)
  const [errorImportacion, setErrorImportacion] = useState<string | null>(null)

  useEffect(() => {
    if (!importacionId) {
      setFiltroImportacion(null)
      setIdsImportacion(null)
      setErrorImportacion(null)
      return
    }
    let cancelado = false
    apiCall<{ importacion?: any }>(`/api/importar/${importacionId}/resumen`, {}, { mostrar_toast_en_error: false })
      .then((r) => {
        if (cancelado) return
        if (!r.ok) {
          setErrorImportacion(importacionId)
          setFiltroImportacion(null)
          setIdsImportacion([])
          return
        }
        const imp = (r.data as any)?.importacion ?? (r.data as any) ?? {}
        const creados: string[] = imp?.ids_creados?.personas ?? []
        const actualizados: string[] = imp?.ids_actualizados?.personas ?? []
        const ids = [...creados, ...actualizados]
        const archivos: string[] = Array.isArray(imp?.archivos_metadata)
          ? imp.archivos_metadata.map((a: any) => a?.nombre).filter(Boolean)
          : []
        setErrorImportacion(null)
        setFiltroImportacion({
          id: importacionId,
          fecha: imp?.fecha_fin ?? imp?.created_at ?? '',
          archivos,
          total: ids.length,
        })
        setIdsImportacion(ids)
        setPagina(1)
      })
    return () => { cancelado = true }
  }, [importacionId])

  const supabase = getSupabaseClient()

  // AbortController para cancelar búsquedas en vuelo cuando el usuario tipea
  // rápido y el backend responde más lento que el ritmo de tipeo. Sin esto
  // una respuesta vieja podría pisar la nueva.
  const cargaAbortRef = useRef<AbortController | null>(null)

  // Cargar contadores por estado (solo cartera, sin prospectos)
  const cargarContadores = useCallback(async () => {
    const estados: EstadoPersona[] = ['ACTIVO', 'INACTIVO', 'BLOQUEADO']
    const resultados: Record<string, number> = {}

    for (const estado of estados) {
      let q = supabase
        .from('personas')
        .select('*', { count: 'exact', head: true })
        .eq('estado', estado)
        .is('deleted_at', null)
      if (usuario && !tieneAccesoTotal(usuario)) {
        q = q.eq("usuario_id", usuario.id)
      }
      const { count } = await q
      resultados[estado] = count ?? 0
    }

    // Total de cartera (sin prospectos, sin papelera)
    let qTotal = supabase
      .from('personas')
      .select('*', { count: 'exact', head: true })
      .neq('estado', 'PROSPECTO')
      .is('deleted_at', null)
    if (usuario && !tieneAccesoTotal(usuario)) {
      qTotal = qTotal.eq("usuario_id", usuario.id)
    }
    const { count: totalCount } = await qTotal
    resultados['TODOS'] = totalCount ?? 0

    setContadores(resultados)

    // Contador de papelera (independiente — separado de los KPIs visuales)
    let qPapelera = supabase
      .from('personas')
      .select('*', { count: 'exact', head: true })
      .not('deleted_at', 'is', null)
    if (usuario && !tieneAccesoTotal(usuario)) {
      qPapelera = qPapelera.eq("usuario_id", usuario.id)
    }
    const { count: papeleraCount } = await qPapelera
    setEnPapelera(papeleraCount ?? 0)
  }, [supabase, usuario])

  // Cargar personas con filtros
  const cargarPersonas = useCallback(async () => {
    // Si hay filtro por importación pero todavía no se cargaron los IDs, esperar
    if (importacionId && idsImportacion === null) {
      return
    }

    setCargando(true)
    setErrorCarga(null)

    // Cancelar la búsqueda anterior si seguía corriendo.
    cargaAbortRef.current?.abort()
    const controller = new AbortController()
    cargaAbortRef.current = controller

    let query = supabase
      .from('personas')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      .abortSignal(controller.signal)

    // Filtro por importación: si el array está vacío, mostrar vacío
    if (idsImportacion !== null) {
      if (idsImportacion.length === 0) {
        setPersonas([])
        setTotal(0)
        setCargando(false)
        return
      }
      query = query.in('id', idsImportacion)
    }

    // Filtro de cartera por usuario
    if (usuario && !tieneAccesoTotal(usuario)) {
      query = query.eq("usuario_id", usuario.id)
    }

    // Filtro "Asignado a" (admin) — null = todos, 'SIN_ASIGNAR' = NULL,
    // UUID = ese usuario en particular.
    if (filtroAsignado === 'SIN_ASIGNAR') {
      query = query.is('usuario_id', null)
    } else if (filtroAsignado && filtroAsignado !== 'TODOS') {
      query = query.eq('usuario_id', filtroAsignado)
    }

    // Excluir prospectos de la cartera
    if (estadoFiltro !== 'TODOS') {
      query = query.eq('estado', estadoFiltro)
    } else {
      query = query.neq('estado', 'PROSPECTO')
    }

    // Búsqueda case+accent-insensitive contra columnas `_norm` (ver migración 053).
    // DNI/email/teléfono van contra los campos crudos: no tienen acentos ni
    // distinción de mayúsculas relevante, así que evitamos generated columns extra.
    if (busqueda.trim()) {
      const termino = sanitizarBusquedaNormalizada(busqueda)
      query = query.or(
        `dni_cuil.ilike.%${termino}%,` +
        `apellido_norm.ilike.%${termino}%,` +
        `nombre_norm.ilike.%${termino}%,` +
        `email.ilike.%${termino}%,` +
        `telefono.ilike.%${termino}%,` +
        `razon_social_norm.ilike.%${termino}%`
      )
    }

    // Paginación
    const desde = (pagina - 1) * POR_PAGINA
    query = query
      .order('apellido', { ascending: true })
      .range(desde, desde + POR_PAGINA - 1)

    const { data, count, error } = await query

    // Si la búsqueda fue abortada, el caller (otra invocación) ya tomó el
    // control: no actualizamos el state para evitar pisar resultados nuevos.
    if (controller.signal.aborted) return

    if (error) {
      // Errores de "AbortError" son esperados — los ignoramos.
      const codigo = (error as any)?.code ?? ''
      if (codigo !== '20' && error.message !== 'AbortError') {
        setErrorCarga({ mensaje: error.message ?? 'No se pudieron cargar las personas.' })
      }
    } else {
      setPersonas(data as Persona[])
      setTotal(count ?? 0)
    }

    setCargando(false)
  }, [supabase, busqueda, estadoFiltro, pagina, usuario, idsImportacion, importacionId, filtroAsignado])

  useEffect(() => {
    cargarContadores()
  }, [cargarContadores])

  useEffect(() => {
    apiCall<{ activo: boolean }>('/api/comunicaciones/estado', {}, { mostrar_toast_en_error: false })
      .then(r => { if (r.ok && r.data) setComunicacionesActivo(Boolean((r.data as any).activo)) })
  }, [])

  // Cargar lista de usuarios (solo admin) — la usamos para el filtro y la
  // columna "Asignado a". Los usuarios no admin no la necesitan: ya ven solo
  // su propia cartera (filtro de cartera server-side).
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

  useEffect(() => {
    cargarPersonas()
  }, [cargarPersonas])

  // Realtime: cuando cualquier persona se crea/edita/elimina (en otra
  // pestaña, por importador, por scripts, etc.), refrescar el listado con
  // los filtros actuales + KPIs. Refs para llamar las versiones frescas sin
  // re-suscribir cada vez que cambian filtros o página.
  const cargarPersonasRef = useRef(cargarPersonas)
  const cargarContadoresRef = useRef(cargarContadores)
  useEffect(() => { cargarPersonasRef.current = cargarPersonas }, [cargarPersonas])
  useEffect(() => { cargarContadoresRef.current = cargarContadores }, [cargarContadores])

  useEffect(() => {
    const refetchTimer = { current: null as ReturnType<typeof setTimeout> | null }
    const refrescar = () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current)
      refetchTimer.current = setTimeout(() => {
        cargarPersonasRef.current()
        cargarContadoresRef.current()
      }, 300)
    }

    const canal = supabase
      .channel('listado-personas')
      .on(
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'personas' },
        refrescar
      )
      .subscribe()

    const onFocus = () => {
      cargarPersonasRef.current()
      cargarContadoresRef.current()
    }
    window.addEventListener('focus', onFocus)

    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current)
      window.removeEventListener('focus', onFocus)
      supabase.removeChannel(canal)
    }
  }, [supabase])

  // Búsqueda con debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setBusqueda(busquedaInput)
      setPagina(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [busquedaInput])

  // Scroll-to-top al cambiar de página — sin esto el usuario queda mirando
  // el final de la página vieja con la nueva ya cargada arriba.
  const primeraCargaRef = useRef(true)
  useEffect(() => {
    if (primeraCargaRef.current) {
      primeraCargaRef.current = false
      return
    }
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [pagina])

  const totalPaginas = Math.ceil(total / POR_PAGINA)

  const toggleSeleccion = (id: string) => {
    setSeleccionados(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const seleccionarPagina = () => {
    const ids = personas.map(p => p.id)
    const todosSeleccionados = ids.every(id => seleccionados.has(id))
    if (todosSeleccionados) {
      setSeleccionados(prev => {
        const next = new Set(prev)
        ids.forEach(id => next.delete(id))
        return next
      })
    } else {
      setSeleccionados(prev => {
        const next = new Set(prev)
        ids.forEach(id => next.add(id))
        return next
      })
    }
  }

  const todosEnPaginaSeleccionados = personas.length > 0 && personas.every(p => seleccionados.has(p.id))
  const personasSeleccionadas = personas.filter(p => seleccionados.has(p.id)).map(p => ({
    id: p.id,
    nombre: p.nombre || '',
    apellido: p.apellido,
    email: p.email || null,
    acepta_marketing: p.acepta_marketing,
  }))

  return (
    <div className="flex flex-col gap-3">

      {/* Header de página */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Cartera</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Asegurados e inactivos de tu cartera
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/crm/personas/papelera')}
            className="btn-secondary relative"
            title="Ver clientes en la papelera"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Papelera
            {enPapelera > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[1.25rem] h-4 px-1 text-2xs font-medium rounded-full bg-amber-100 text-amber-700 border border-amber-300">
                {enPapelera}
              </span>
            )}
          </button>
          <button className="btn-secondary">
            <Download className="h-3.5 w-3.5" />
            Exportar
          </button>
          {!soloLectura && (
            <button
              onClick={() => router.push('/crm/personas/nueva')}
              className="btn-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              Nuevo Cliente
            </button>
          )}
        </div>
      </div>

      {/* Banner filtro por importación */}
      {filtroImportacion && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-amber-900">
            <Download className="h-4 w-4 text-amber-600" />
            <span>
              Mostrando <strong>{filtroImportacion.total}</strong> persona{filtroImportacion.total !== 1 ? 's' : ''} importada{filtroImportacion.total !== 1 ? 's' : ''}
              {filtroImportacion.fecha && <> el {formatFecha(filtroImportacion.fecha)}</>}
              {filtroImportacion.archivos.length > 0 && (
                <span className="text-amber-700"> desde: {filtroImportacion.archivos.join(', ')}</span>
              )}
            </span>
          </div>
          <button
            onClick={() => router.push('/crm/personas')}
            className="btn-secondary text-2xs flex items-center gap-1"
          >
            <X className="h-3.5 w-3.5" /> Quitar filtro
          </button>
        </div>
      )}
      {errorImportacion && !filtroImportacion && (
        <div className="bg-red-50 border border-red-200 rounded p-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-red-800">
            <X className="h-4 w-4 text-red-600" />
            <span>No se pudo cargar la importación <strong className="font-mono">{errorImportacion}</strong></span>
          </div>
          <button
            onClick={() => router.push('/crm/personas')}
            className="btn-secondary text-2xs flex items-center gap-1"
          >
            <X className="h-3.5 w-3.5" /> Quitar filtro
          </button>
        </div>
      )}

      {/* KPIs compactos — selector excluyente: clic en uno selecciona ese
          filtro. Para limpiar, usar el botón "Limpiar". */}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => { setKpiActivo('total'); setEstadoFiltro('TODOS'); setPagina(1) }}
          aria-pressed={kpiActivo === 'total'}
          className={`kpi-card text-left cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'total' ? 'ring-2 ring-slate-400' : ''}`}
        >
          <span className="kpi-label flex items-center gap-1">
            <Users className="h-3.5 w-3.5" /> Total Cartera
          </span>
          <span className="kpi-value">{(contadores['TODOS'] ?? 0).toLocaleString('es-AR')}</span>
          <span className="kpi-sub">clientes en cartera</span>
        </button>
        <button
          type="button"
          onClick={() => { setKpiActivo('activo'); setEstadoFiltro('ACTIVO'); setPagina(1) }}
          aria-pressed={kpiActivo === 'activo'}
          className={`kpi-card text-left bg-green-50 border border-green-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'activo' ? 'ring-2 ring-green-400' : ''}`}
        >
          <span className="kpi-label flex items-center gap-1">
            <UserCheck className="h-3.5 w-3.5 text-green-600" /> Asegurados
          </span>
          <span className="kpi-value text-green-700">{(contadores['ACTIVO'] ?? 0).toLocaleString('es-AR')}</span>
          <span className="kpi-sub">con pólizas vigentes</span>
        </button>
        <button
          type="button"
          onClick={() => { setKpiActivo('inactivo'); setEstadoFiltro('INACTIVO'); setPagina(1) }}
          aria-pressed={kpiActivo === 'inactivo'}
          className={`kpi-card text-left bg-slate-50 border border-slate-200 cursor-pointer hover:opacity-80 transition-all ${kpiActivo === 'inactivo' ? 'ring-2 ring-slate-400' : ''}`}
        >
          <span className="kpi-label flex items-center gap-1">
            <UserX className="h-3.5 w-3.5 text-slate-400" /> Inactivos
          </span>
          <span className="kpi-value text-slate-500">{(contadores['INACTIVO'] ?? 0).toLocaleString('es-AR')}</span>
          <span className="kpi-sub">sin pólizas activas</span>
        </button>
      </div>

      {/* Barra de filtros */}
      <div className="bg-white border border-slate-200 rounded p-2 flex items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={busquedaInput}
            onChange={(e) => setBusquedaInput(e.target.value)}
            placeholder="Buscar por DNI/CUIT, nombre, teléfono, email..."
            className="search-input w-full pl-6"
          />
        </div>
        {/* Filtro "Asignado a" — admin-only, mostrar solo si hay >1 usuario en
            el sistema (con 1 solo usuario el filtro no aporta nada). */}
        {isAdmin && usuariosLista.length > 1 && (
          <select
            value={filtroAsignado ?? ''}
            onChange={e => { setFiltroAsignado(e.target.value || null); setPagina(1) }}
            className="search-input text-xs h-7"
            title="Filtrar por usuario asignado"
          >
            <option value="">Todos los asignados</option>
            <option value="SIN_ASIGNAR">Sin asignar</option>
            {usuariosLista.map(u => (
              <option key={u.id} value={u.id}>{`${u.apellido}, ${u.nombre}`.replace(/^,\s*/, '')}</option>
            ))}
          </select>
        )}
        {(busquedaInput || kpiActivo || filtroAsignado) && (
          <button onClick={() => { setBusquedaInput(''); setBusqueda(''); setKpiActivo(null); setEstadoFiltro('TODOS'); setFiltroAsignado(null); setPagina(1) }} className="btn-secondary flex items-center gap-1">
            <X className="h-3.5 w-3.5" /> Limpiar
          </button>
        )}
        <button onClick={() => { cargarPersonas(); cargarContadores() }} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center ml-auto" title="Actualizar">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Barra de selección masiva */}
      {seleccionados.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded p-2 flex items-center gap-3">
          <span className="text-xs font-medium text-blue-800">{seleccionados.size} persona{seleccionados.size !== 1 ? 's' : ''} seleccionada{seleccionados.size !== 1 ? 's' : ''}</span>
          {isAdmin && comunicacionesActivo && (
            <button onClick={() => setModalMasivo(true)} className="btn-primary text-xs px-3 py-1 flex items-center gap-1.5">
              <Send className="h-3.5 w-3.5" /> Enviar email
            </button>
          )}
          <button onClick={() => setSeleccionados(new Set())} className="btn-secondary text-xs px-2 py-1 ml-auto">
            <X className="h-3.5 w-3.5" /> Limpiar selección
          </button>
        </div>
      )}

      {/* Tabla principal */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">

        {/* Info de resultados */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100 bg-slate-50">
          <span className="text-xs text-slate-500">
            {cargando ? (
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Cargando...
              </span>
            ) : (
              <>
                <span className="font-medium text-slate-700">{total.toLocaleString('es-AR')}</span>
                {' '}resultados
                {busqueda && ` · "${busqueda}"`}
              </>
            )}
          </span>
          <span className="text-xs text-slate-500">
            Pág. {pagina} de {totalPaginas || 1}
          </span>
        </div>

        <div className="overflow-x-auto">
          <EstadoCarga
            loading={cargando}
            error={errorCarga}
            empty={!cargando && !errorCarga && personas.length === 0}
            emptyIcono={<Users className="h-8 w-8 text-slate-300 mb-3" />}
            emptyMensaje={busqueda ? 'No se encontraron clientes con esos criterios' : 'No hay clientes cargados todavía'}
            onReintentar={cargarPersonas}
          >
          <table className="crm-table">
            <thead>
              <tr>
                {isAdmin && comunicacionesActivo && (
                  <th style={{ width: 32 }} onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={todosEnPaginaSeleccionados} onChange={seleccionarPagina}
                      className="rounded border-slate-300 text-blue-600" />
                  </th>
                )}
                <th style={{ width: 200 }}>Apellido y Nombre</th>
                <th style={{ width: 120 }}>DNI / CUIT</th>
                <th style={{ width: 130 }}>Teléfono</th>
                <th style={{ width: 200 }}>Email</th>
                <th style={{ width: 100 }}>Localidad</th>
                <th style={{ width: 90 }}>Estado</th>
                {isAdmin && usuariosLista.length > 1 && (
                  <th style={{ width: 130 }}>Asignado a</th>
                )}
                <th style={{ width: 90 }}>Alta</th>
                <th style={{ width: 70 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {personas.map((persona) => (
                <PersonaFila
                  key={persona.id}
                  persona={persona}
                  onVerDetalle={() => router.push(`/crm/personas/${persona.id}`)}
                  onEditar={() => router.push(`/crm/personas/${persona.id}/editar`)}
                  mostrarCheckbox={!!(isAdmin && comunicacionesActivo)}
                  seleccionado={seleccionados.has(persona.id)}
                  onToggleSeleccion={() => toggleSeleccion(persona.id)}
                  mostrarAsignado={isAdmin && usuariosLista.length > 1}
                  nombreAsignado={persona.usuario_id ? usuariosMap().get(persona.usuario_id) ?? null : null}
                />
              ))}
            </tbody>
          </table>
          </EstadoCarga>
        </div>

        {/* Paginación */}
        {totalPaginas > 1 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 bg-slate-50">
            <span className="text-xs text-slate-500">
              Mostrando {((pagina - 1) * POR_PAGINA) + 1}–
              {Math.min(pagina * POR_PAGINA, total)} de {total.toLocaleString('es-AR')}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPagina(p => Math.max(1, p - 1))}
                disabled={pagina === 1}
                className="btn-secondary h-6 w-6 p-0 flex items-center justify-center disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              {/* Números de página */}
              {Array.from({ length: Math.min(5, totalPaginas) }, (_, i) => {
                const num = Math.max(1, Math.min(pagina - 2, totalPaginas - 4)) + i
                return (
                  <button
                    key={num}
                    onClick={() => setPagina(num)}
                    className={`h-6 min-w-6 px-1.5 text-xs rounded transition-colors ${
                      pagina === num
                        ? 'bg-blue-600 text-white font-medium'
                        : 'text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {num}
                  </button>
                )
              })}
              <button
                onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
                disabled={pagina === totalPaginas}
                className="btn-secondary h-6 w-6 p-0 flex items-center justify-center disabled:opacity-40"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
      {/* Modal envío masivo */}
      <ModalEnviarEmailMasivo
        isOpen={modalMasivo}
        onClose={() => setModalMasivo(false)}
        personas={personasSeleccionadas}
        contexto="CLIENTE"
        onSuccess={() => setSeleccionados(new Set())}
      />
    </div>
  )
}

// ── Fila individual de persona ───────────────────────────────
function PersonaFila({
  persona,
  onVerDetalle,
  onEditar,
  mostrarCheckbox,
  seleccionado,
  onToggleSeleccion,
  mostrarAsignado,
  nombreAsignado,
}: {
  persona: Persona
  onVerDetalle: () => void
  onEditar: () => void
  mostrarCheckbox: boolean
  seleccionado: boolean
  onToggleSeleccion: () => void
  mostrarAsignado: boolean
  nombreAsignado: string | null
}) {
  const nombre = nombreCompleto(persona.apellido, persona.nombre, persona.razon_social)

  return (
    <tr
      className="cursor-pointer"
      onClick={onVerDetalle}
    >
      {/* Checkbox */}
      {mostrarCheckbox && (
        <td onClick={e => e.stopPropagation()}>
          <input type="checkbox" checked={seleccionado} onChange={onToggleSeleccion}
            className="rounded border-slate-300 text-blue-600" />
        </td>
      )}
      {/* Nombre — clickeable explícito para que se vea interactivo
       * además del cursor-pointer del <tr>. */}
      <td>
        <div className="flex flex-col">
          <span className="font-medium text-sm text-blue-600 hover:underline">{nombre}</span>
          {persona.tipo_persona === 'JURIDICA' && (
            <span className="text-2xs text-slate-500">Persona Jurídica</span>
          )}
        </div>
      </td>

      {/* DNI/CUIT */}
      <td>
        <span className="font-mono text-xs text-slate-600">
          {persona.cuil_formateado ?? persona.dni_cuil}
        </span>
      </td>

      {/* Teléfono */}
      <td>
        <div className="flex flex-col gap-0.5">
          {persona.telefono && (
            <span className="flex items-center gap-1 text-xs text-slate-600">
              <Phone className="h-2.5 w-2.5 text-slate-400" />
              {persona.telefono}
            </span>
          )}
          {persona.whatsapp && persona.whatsapp !== persona.telefono && (
            <span className="text-2xs text-green-600">WA: {persona.whatsapp}</span>
          )}
        </div>
      </td>

      {/* Email */}
      <td>
        {persona.email ? (
          <span className="flex items-center gap-1 text-xs text-slate-600">
            <Mail className="h-2.5 w-2.5 text-slate-400 shrink-0" />
            <span className="truncate max-w-44">{persona.email}</span>
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>

      {/* Localidad */}
      <td>
        <span className="text-xs text-slate-600">
          {persona.localidad ?? <span className="text-slate-300">—</span>}
        </span>
      </td>

      {/* Estado */}
      <td onClick={(e) => e.stopPropagation()}>
        <span
          className={getBadgeClase(persona.estado)}
          title={getTooltipEstado(persona.estado) || undefined}
        >
          {getLabelEstado(persona.estado)}
        </span>
      </td>

      {/* Asignado a — admin only */}
      {mostrarAsignado && (
        <td>
          {nombreAsignado ? (
            <span className="text-xs text-slate-600 truncate block max-w-32" title={nombreAsignado}>
              {nombreAsignado}
            </span>
          ) : (
            <span className="text-2xs text-amber-600 italic">Sin asignar</span>
          )}
        </td>
      )}

      {/* Fecha alta */}
      <td>
        <span className="text-xs text-slate-500 font-mono">
          {formatFecha(persona.fecha_alta)}
        </span>
      </td>

      {/* Acciones */}
      <td onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onVerDetalle}
            className="btn-tabla-accion"
            title="Ver ficha completa"
          >
            <Eye />
          </button>
          <button
            onClick={onEditar}
            className="btn-tabla-accion-neutral"
            title="Editar"
          >
            <Edit />
          </button>
        </div>
      </td>
    </tr>
  )
}
