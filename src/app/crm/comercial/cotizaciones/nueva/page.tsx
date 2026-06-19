'use client'

import { useState, useEffect, useRef, Suspense, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft, Save, Send, Loader2, AlertCircle, CheckCircle,
  Plus, Trash2, Car, Home, Heart, Package, Search, X, User, Users
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { hoyLocal, formatMoneda, sanitizarBusquedaNormalizada } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { tipoRenderForm } from '@/lib/tipos-riesgo'

// ── Interfaces ──

interface Catalogo { id: string; nombre: string; metadata?: Record<string, any> | null }

interface PersonaResult { id: string; label: string }
interface LeadResult { id: string; label: string }

interface CompaniaRow {
  key: string
  compania_id: string
  cobertura_id: string
  precio: string
  detalle: string
}

interface DatosRiesgo {
  patente: string; marca: string; modelo: string; anio: string
  motor: string; chasis: string; color: string; uso: string
  calle: string; numero: string; localidad: string; provincia: string
  tipo_construccion: string; superficie: string; medidas_seguridad: string
  capital_asegurado: string; beneficiarios: string
  descripcion: string
}

const RIESGO_INICIAL: DatosRiesgo = {
  patente: '', marca: '', modelo: '', anio: '', motor: '', chasis: '', color: '', uso: 'PARTICULAR',
  calle: '', numero: '', localidad: '', provincia: 'Buenos Aires',
  tipo_construccion: 'MAMPOSTERIA', superficie: '', medidas_seguridad: '',
  capital_asegurado: '', beneficiarios: '',
  descripcion: '',
}

const ICONOS: Record<string, React.ReactNode> = {
  automotor: <Car className="h-4 w-4" />,
  hogar:     <Home className="h-4 w-4" />,
  vida:      <Heart className="h-4 w-4" />,
  generico:  <Package className="h-4 w-4" />,
}

let rowKeyCounter = 0
function nextRowKey() { return `row_${++rowKeyCounter}_${Date.now()}` }

// ── Helpers ──

function Campo({ label, required, error, col = 1, children }: {
  label: string; required?: boolean; error?: string; col?: 1 | 2; children: React.ReactNode
}) {
  return (
    <div className={col === 2 ? 'col-span-2' : ''}>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <span className="flex items-center gap-1 text-xs text-red-500 mt-0.5"><AlertCircle className="h-3 w-3" />{error}</span>}
    </div>
  )
}

// ── Main ──

export default function NuevaCotizacionPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
      </div>
    }>
      <NuevaCotizacionContent />
    </Suspense>
  )
}

function NuevaCotizacionContent() {
  const router   = useRouter()
  const params   = useSearchParams()
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  // ── Query params ──
  const qPersonaId     = params.get('persona_id') ?? ''
  const qLeadId        = params.get('lead_id') ?? ''
  const qOportunidadId = params.get('oportunidad_id') ?? ''

  // ── State: destinatario ──
  const [tipoDestinatario, setTipoDestinatario] = useState<'persona' | 'lead'>(qLeadId ? 'lead' : 'persona')
  const [personaId, setPersonaId]       = useState(qPersonaId)
  const [leadId, setLeadId]             = useState(qLeadId)
  const [oportunidadId]                 = useState(qOportunidadId)
  const [personaLabel, setPersonaLabel] = useState('')
  const [leadLabel, setLeadLabel]       = useState('')
  const [searchTerm, setSearchTerm]     = useState('')
  const [searchResults, setSearchResults] = useState<(PersonaResult | LeadResult)[]>([])
  const [showDropdown, setShowDropdown]   = useState(false)
  const [buscando, setBuscando]           = useState(false)
  const searchRef = useRef<NodeJS.Timeout>()
  const dropdownRef = useRef<HTMLDivElement>(null)

  // ── State: riesgo ──
  const [ramoId, setRamoId]           = useState('')
  const [tipoRiesgo, setTipoRiesgo]   = useState('generico')
  // Render del form: mapea los 7 tipos del catálogo a los 4 layouts existentes.
  const renderTipo = tipoRenderForm(tipoRiesgo)
  const [riesgo, setRiesgo]           = useState<DatosRiesgo>(RIESGO_INICIAL)

  // ── State: companias rows ──
  const [rows, setRows] = useState<CompaniaRow[]>([{ key: nextRowKey(), compania_id: '', cobertura_id: '', precio: '', detalle: '' }])

  // ── State: notas ──
  const [notas, setNotas] = useState('')

  // ── State: vencimiento ──
  const [fechaVencimiento, setFechaVencimiento] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().split('T')[0]
  })

  // ── State: catalogos ──
  const [companias, setCompanias]     = useState<Catalogo[]>([])
  const [ramos, setRamos]             = useState<Catalogo[]>([])
  const [coberturas, setCoberturas]   = useState<Catalogo[]>([])

  // ── State: UI ──
  const [errores, setErrores]       = useState<Record<string, string>>({})
  const [guardando, setGuardando]   = useState(false)
  const [exito, setExito]           = useState(false)
  const [errorGral, setErrorGral]   = useState('')

  // Guardas anti-doble-INSERT:
  //  - guardandoRef: bloquea clicks en paralelo (rápidos) — el state
  //    `guardando` no se ve a tiempo en el primer click sincrónico.
  //  - yaSeGuardoRef: una vez creada la cotización, ningún botón puede
  //    crear OTRA. El usuario debe esperar la redirección o cancelar.
  const guardandoRef = useRef(false)
  const yaSeGuardoRef = useRef(false)

  // ── Cargar catálogos ──
  useEffect(() => {
    async function cargar() {
      const { data: tipos } = await supabase.from('tipo_catalogo').select('id, codigo')
      if (!tipos) return

      const tipoComp   = tipos.find((t: any) => t.codigo === 'COMPANIA')
      const tipoRamo   = tipos.find((t: any) => t.codigo === 'RAMO')
      const tipoCobert = tipos.find((t: any) => t.codigo === 'COBERTURA')

      const [{ data: comps }, { data: rams }, { data: cobs }] = await Promise.all([
        tipoComp
          ? supabase.from('catalogos').select('id,nombre,metadata').eq('tipo_id', tipoComp.id).eq('activo', true).order('nombre')
          : Promise.resolve({ data: [] }),
        tipoRamo
          ? supabase.from('catalogos').select('id,nombre,metadata').eq('tipo_id', tipoRamo.id).eq('activo', true).order('nombre')
          : Promise.resolve({ data: [] }),
        tipoCobert
          ? supabase.from('catalogos').select('id,nombre,metadata').eq('tipo_id', tipoCobert.id).eq('activo', true).order('nombre')
          : Promise.resolve({ data: [] }),
      ])

      setCompanias((comps ?? []) as unknown as Catalogo[])
      setRamos((rams ?? []) as unknown as Catalogo[])
      setCoberturas((cobs ?? []) as unknown as Catalogo[])
    }
    cargar()
  }, [supabase])

  // ── Pre-cargar labels si vienen query params ──
  useEffect(() => {
    async function precargar() {
      if (qPersonaId) {
        const { data } = await supabase
          .from('personas')
          .select('apellido,nombre,razon_social')
          .eq('id', qPersonaId)
          .is('deleted_at', null)
          .single()
        if (data) {
          const d = data as unknown as { apellido: string; nombre: string | null; razon_social: string | null }
          setPersonaLabel([d.apellido, d.nombre].filter(Boolean).join(', ') || d.razon_social || qPersonaId)
        }
      }
      if (qLeadId) {
        const { data } = await supabase.from('leads').select('apellido,nombre').eq('id', qLeadId).single()
        if (data) {
          const d = data as unknown as { apellido: string; nombre: string }
          setLeadLabel([d.apellido, d.nombre].filter(Boolean).join(', '))
        }
      }
    }
    precargar()
  }, [supabase, qPersonaId, qLeadId])

  // ── Tipo riesgo al cambiar ramo ──
  useEffect(() => {
    const r = ramos.find(r => r.id === ramoId)
    setTipoRiesgo(r?.metadata?.tipo_riesgo ?? 'generico')
  }, [ramoId, ramos])

  // ── Coberturas filtradas por ramo ──
  const coberturasFiltradas = ramoId
    ? coberturas.filter(c => {
        const ramoIds = ((c.metadata ?? {}) as any).ramo_ids as string[] | undefined
        return ramoIds && ramoIds.includes(ramoId)
      })
    : []

  // ── Búsqueda de destinatarios con debounce ──
  const buscarDestinatarios = useCallback(async (term: string) => {
    if (term.length < 2) { setSearchResults([]); setShowDropdown(false); return }
    const safeBusq = sanitizarBusquedaNormalizada(term)
    if (!safeBusq) { setSearchResults([]); setShowDropdown(false); return }
    setBuscando(true)

    if (tipoDestinatario === 'persona') {
      let qPersonas = supabase
        .from('personas')
        .select('id,apellido,nombre,razon_social,dni_cuil')
        .is('deleted_at', null)
        .or(`apellido_norm.ilike.%${safeBusq}%,nombre_norm.ilike.%${safeBusq}%,razon_social_norm.ilike.%${safeBusq}%,dni_cuil.ilike.%${safeBusq}%`)
        .order('apellido')
        .limit(10)
      if (usuario && !tieneAccesoTotal(usuario)) {
        qPersonas = qPersonas.eq("usuario_id", usuario.id)
      }
      const { data } = await qPersonas
      const results = ((data ?? []) as unknown as any[]).map(p => ({
        id: p.id,
        label: [p.apellido, p.nombre].filter(Boolean).join(', ') || p.razon_social || p.dni_cuil,
      }))
      setSearchResults(results)
    } else {
      let qLeads = supabase
        .from('leads')
        .select('id,apellido,nombre,dni,telefono,email')
        .or(`apellido_norm.ilike.%${safeBusq}%,nombre_norm.ilike.%${safeBusq}%,dni.ilike.%${safeBusq}%,email.ilike.%${safeBusq}%`)
        .order('apellido')
        .limit(10)
      if (usuario && !tieneAccesoTotal(usuario)) {
        qLeads = qLeads.eq("usuario_id", usuario.id)
      }
      const { data } = await qLeads
      const results = ((data ?? []) as unknown as any[]).map(l => ({
        id: l.id,
        label: [l.apellido, l.nombre].filter(Boolean).join(', ') || l.email || l.id,
      }))
      setSearchResults(results)
    }
    setBuscando(false)
    setShowDropdown(true)
  }, [supabase, tipoDestinatario])

  useEffect(() => {
    clearTimeout(searchRef.current)
    if (searchTerm.length >= 2) {
      searchRef.current = setTimeout(() => buscarDestinatarios(searchTerm), 350)
    } else {
      setSearchResults([])
      setShowDropdown(false)
    }
    return () => clearTimeout(searchRef.current)
  }, [searchTerm, buscarDestinatarios])

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const seleccionarDestinatario = (item: PersonaResult | LeadResult) => {
    if (tipoDestinatario === 'persona') {
      setPersonaId(item.id)
      setPersonaLabel(item.label)
      setLeadId('')
      setLeadLabel('')
    } else {
      setLeadId(item.id)
      setLeadLabel(item.label)
      setPersonaId('')
      setPersonaLabel('')
    }
    setSearchTerm('')
    setShowDropdown(false)
    setErrores(e => ({ ...e, destinatario: '' }))
  }

  const limpiarDestinatario = () => {
    setPersonaId(''); setLeadId('')
    setPersonaLabel(''); setLeadLabel('')
    setSearchTerm('')
  }

  // ── Rows management ──
  const addRow = () => setRows(r => [...r, { key: nextRowKey(), compania_id: '', cobertura_id: '', precio: '', detalle: '' }])
  const removeRow = (key: string) => setRows(r => r.filter(row => row.key !== key))
  const updateRow = (key: string, field: keyof CompaniaRow, value: string) => {
    setRows(r => r.map(row => row.key === key ? { ...row, [field]: value } : row))
    setErrores(e => ({ ...e, [`row_${key}_${field}`]: '' }))
  }

  // ── Set riesgo helper ──
  const setR = (k: keyof DatosRiesgo, v: string) => {
    setRiesgo(r => ({ ...r, [k]: v }))
    setErrores(e => ({ ...e, [`r_${k}`]: '' }))
  }

  // ── Validación ──
  const validar = (): boolean => {
    const e: Record<string, string> = {}

    // Destinatario
    if (!personaId && !leadId) e.destinatario = 'Seleccioná un destinatario'

    // Ramo
    if (!ramoId) e.ramo_id = 'Seleccioná el ramo'

    // Rows
    if (rows.length === 0) {
      e.rows = 'Agregá al menos una opción de compañía'
    } else {
      const combos = new Set<string>()
      rows.forEach(row => {
        if (!row.compania_id) e[`row_${row.key}_compania_id`] = 'Requerido'
        if (!row.cobertura_id) e[`row_${row.key}_cobertura_id`] = 'Requerido'
        if (!row.precio || parseFloat(row.precio) <= 0) e[`row_${row.key}_precio`] = 'Requerido'
        const combo = `${row.compania_id}__${row.cobertura_id}`
        if (row.compania_id && row.cobertura_id) {
          if (combos.has(combo)) {
            e[`row_${row.key}_compania_id`] = 'Combinación duplicada'
            e[`row_${row.key}_cobertura_id`] = 'Combinación duplicada'
          }
          combos.add(combo)
        }
      })
    }

    // Riesgo fields
    if (renderTipo === 'automotor') {
      if (!riesgo.patente.trim()) e.r_patente = 'La patente es obligatoria'
      if (!riesgo.marca.trim()) e.r_marca = 'La marca es obligatoria'
      if (!riesgo.modelo.trim()) e.r_modelo = 'El modelo es obligatorio'
      if (!riesgo.anio.trim()) e.r_anio = 'El año es obligatorio'
    }
    if (renderTipo === 'hogar') {
      if (!riesgo.calle.trim()) e.r_calle = 'La calle es obligatoria'
      if (!riesgo.localidad.trim()) e.r_localidad = 'La localidad es obligatoria'
    }

    setErrores(e)
    return Object.keys(e).length === 0
  }

  // ── Guardar ──
  const guardar = async (estado: 'BORRADOR' | 'ENVIADA') => {
    // Bloquea clicks duplicados o secuenciales en otro botón después
    // del primer guardado exitoso (caso real: el PAS apretó "Guardar
    // como borrador" y después "Guardar y enviar" — ambos hacían INSERT
    // y dejaban dos cotizaciones idénticas).
    if (guardandoRef.current || yaSeGuardoRef.current) return
    if (!validar()) return
    guardandoRef.current = true
    setGuardando(true)
    setErrorGral('')

    try {
      // Build datos_riesgo
      let datosRiesgo: Record<string, any> = {}
      if (renderTipo === 'automotor') {
        datosRiesgo = {
          patente: riesgo.patente.toUpperCase().replace(/\s/g, ''),
          marca: riesgo.marca, modelo: riesgo.modelo, anio: riesgo.anio,
          motor: riesgo.motor || null, chasis: riesgo.chasis || null,
          color: riesgo.color || null, uso: riesgo.uso,
        }
      } else if (renderTipo === 'hogar') {
        datosRiesgo = {
          calle: riesgo.calle, numero: riesgo.numero || null,
          localidad: riesgo.localidad, provincia: riesgo.provincia,
          tipo_construccion: riesgo.tipo_construccion,
          superficie: riesgo.superficie || null,
          medidas_seguridad: riesgo.medidas_seguridad || null,
        }
      } else if (renderTipo === 'vida') {
        datosRiesgo = {
          capital_asegurado: riesgo.capital_asegurado || null,
          beneficiarios: riesgo.beneficiarios || null,
        }
      } else {
        datosRiesgo = { descripcion: riesgo.descripcion || null }
      }

      const payload: Record<string, any> = {
        numero_cotizacion: '',
        persona_id: personaId || null,
        lead_id: leadId || null,
        oportunidad_id: oportunidadId || null,
        ramo_id: ramoId,
        datos_riesgo: datosRiesgo,
        notas: notas || null,
        fecha_vencimiento: fechaVencimiento || null,
        estado,
        fecha_envio: estado === 'ENVIADA' ? hoyLocal() : null,
        usuario_id: usuario?.id ?? null,
      }

      const { data: cotData, error: cotErr } = await supabase
        .from('cotizaciones')
        .insert(payload)
        .select('id')
        .single()

      if (cotErr) throw new Error(cotErr.message)
      const cotizacionId = (cotData as unknown as { id: string }).id

      // Insert rows
      const companiaRows = rows.map(row => ({
        cotizacion_id: cotizacionId,
        compania_id: row.compania_id,
        cobertura_id: row.cobertura_id,
        precio: parseFloat(row.precio),
        detalle: row.detalle || null,
      }))

      const { error: rowErr } = await supabase
        .from('cotizacion_companias')
        .insert(companiaRows)

      if (rowErr) throw new Error(rowErr.message)

      yaSeGuardoRef.current = true
      setExito(true)
      // No rehabilitamos los botones: la cotización ya fue creada y
      // estamos por redirigir. Cualquier nuevo click sería un INSERT
      // duplicado. Mantenemos `guardando=true` para que la UI lo refleje.
      setTimeout(() => router.push(`/crm/comercial/cotizaciones/${cotizacionId}`), 1200)
      return
    } catch (err: any) {
      setErrorGral(err.message || 'Error al guardar la cotización')
      // Solo permitimos reintentar si hubo error: rehabilitamos refs y state.
      guardandoRef.current = false
      setGuardando(false)
    }
  }

  const destinatarioActual = tipoDestinatario === 'persona' ? personaLabel : leadLabel
  const destinatarioSeleccionado = tipoDestinatario === 'persona' ? !!personaId : !!leadId

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="btn-secondary p-2">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Nueva Cotización</h1>
            <p className="text-xs text-slate-500">Comparativa de compañías y coberturas</p>
          </div>
        </div>
      </div>

      {/* Mensajes */}
      {errorGral && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">
          <AlertCircle className="h-4 w-4 flex-shrink-0" /> {errorGral}
        </div>
      )}
      {exito && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm border border-emerald-200">
          <CheckCircle className="h-4 w-4 flex-shrink-0" /> Cotización guardada correctamente. Redirigiendo...
        </div>
      )}

      {/* ── SECTION A: Destinatario ── */}
      {/* Sin `overflow-hidden`: el dropdown del autocomplete usa absolute
          positioning y se debe poder expandir fuera del card. El header
          mantiene el look con `rounded-t-lg`. */}
      <div className="bg-white border border-slate-200 rounded-lg">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 rounded-t-lg">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <Users className="h-4 w-4 text-slate-400" /> Destinatario
          </h2>
        </div>
        <div className="p-5 space-y-4">
          {/* Radio toggle */}
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="tipo_dest"
                checked={tipoDestinatario === 'persona'}
                onChange={() => { setTipoDestinatario('persona'); limpiarDestinatario() }}
                className="text-blue-600"
              />
              <User className="h-4 w-4 text-slate-400" />
              <span className="text-sm text-slate-700">Cliente existente</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="tipo_dest"
                checked={tipoDestinatario === 'lead'}
                onChange={() => { setTipoDestinatario('lead'); limpiarDestinatario() }}
                className="text-blue-600"
              />
              <Users className="h-4 w-4 text-slate-400" />
              <span className="text-sm text-slate-700">Lead</span>
            </label>
          </div>

          {/* Autocomplete */}
          <div className="relative" ref={dropdownRef}>
            {destinatarioSeleccionado ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                {tipoDestinatario === 'persona' ? <User className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                <span className="font-medium">{destinatarioActual}</span>
                <button onClick={limpiarDestinatario} className="ml-auto p-0.5 hover:bg-blue-100 rounded">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    className="form-input pl-9 w-full"
                    placeholder={tipoDestinatario === 'persona'
                      ? 'Buscar por nombre, apellido o DNI...'
                      : 'Buscar lead por nombre, email o DNI...'}
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                  {buscando && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />}
                </div>

                {showDropdown && searchResults.length > 0 && (
                  <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {searchResults.map(item => (
                      <button
                        key={item.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0"
                        onClick={() => seleccionarDestinatario(item)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
                {showDropdown && searchResults.length === 0 && searchTerm.length >= 2 && !buscando && (
                  <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg p-3 text-sm text-slate-500 text-center">
                    No se encontraron resultados
                  </div>
                )}
              </>
            )}
            {errores.destinatario && (
              <span className="flex items-center gap-1 text-xs text-red-500 mt-1">
                <AlertCircle className="h-3 w-3" />{errores.destinatario}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── SECTION B: Datos del riesgo ── */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            {ICONOS[tipoRiesgo] || <Package className="h-4 w-4 text-slate-400" />} Datos del riesgo
          </h2>
        </div>
        <div className="p-5 space-y-4">
          <Campo label="Ramo" required error={errores.ramo_id}>
            <select className="form-input w-full" value={ramoId} onChange={e => { setRamoId(e.target.value); setErrores(er => ({ ...er, ramo_id: '' })) }}>
              <option value="">Seleccionar ramo...</option>
              {ramos.map(r => (
                <option key={r.id} value={r.id}>{r.nombre}</option>
              ))}
            </select>
          </Campo>

          {ramoId && renderTipo === 'automotor' && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
              <Campo label="Patente" required error={errores.r_patente}>
                <input className="form-input w-full font-mono uppercase" value={riesgo.patente} onChange={e => setR('patente', e.target.value)} placeholder="AA 123 BB" />
              </Campo>
              <Campo label="Marca" required error={errores.r_marca}>
                <input className="form-input w-full" value={riesgo.marca} onChange={e => setR('marca', e.target.value)} />
              </Campo>
              <Campo label="Modelo" required error={errores.r_modelo}>
                <input className="form-input w-full" value={riesgo.modelo} onChange={e => setR('modelo', e.target.value)} />
              </Campo>
              <Campo label="Año" required error={errores.r_anio}>
                <input className="form-input w-full font-mono" type="number" value={riesgo.anio} onChange={e => setR('anio', e.target.value)} placeholder="2024" />
              </Campo>
              <Campo label="Motor">
                <input className="form-input w-full font-mono" value={riesgo.motor} onChange={e => setR('motor', e.target.value)} />
              </Campo>
              <Campo label="Chasis">
                <input className="form-input w-full font-mono" value={riesgo.chasis} onChange={e => setR('chasis', e.target.value)} />
              </Campo>
              <Campo label="Color">
                <input className="form-input w-full" value={riesgo.color} onChange={e => setR('color', e.target.value)} />
              </Campo>
              <Campo label="Uso">
                <select className="form-input w-full" value={riesgo.uso} onChange={e => setR('uso', e.target.value)}>
                  <option value="PARTICULAR">Particular</option>
                  <option value="COMERCIAL">Comercial</option>
                </select>
              </Campo>
            </div>
          )}

          {ramoId && renderTipo === 'hogar' && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
              <Campo label="Calle" required error={errores.r_calle} col={2}>
                <input className="form-input w-full" value={riesgo.calle} onChange={e => setR('calle', e.target.value)} />
              </Campo>
              <Campo label="Número">
                <input className="form-input w-full font-mono" value={riesgo.numero} onChange={e => setR('numero', e.target.value)} />
              </Campo>
              <Campo label="Localidad" required error={errores.r_localidad}>
                <input className="form-input w-full" value={riesgo.localidad} onChange={e => setR('localidad', e.target.value)} />
              </Campo>
              <Campo label="Provincia">
                <input className="form-input w-full" value={riesgo.provincia} onChange={e => setR('provincia', e.target.value)} />
              </Campo>
              <Campo label="Tipo construcción">
                <select className="form-input w-full" value={riesgo.tipo_construccion} onChange={e => setR('tipo_construccion', e.target.value)}>
                  <option value="MAMPOSTERIA">Mampostería</option>
                  <option value="MADERA">Madera</option>
                  <option value="MIXTA">Mixta</option>
                  <option value="PREFABRICADA">Prefabricada</option>
                </select>
              </Campo>
              <Campo label="Superficie (m²)">
                <input className="form-input w-full font-mono" type="number" value={riesgo.superficie} onChange={e => setR('superficie', e.target.value)} />
              </Campo>
              <Campo label="Medidas de seguridad">
                <input className="form-input w-full" value={riesgo.medidas_seguridad} onChange={e => setR('medidas_seguridad', e.target.value)} placeholder="Alarma, rejas, etc." />
              </Campo>
            </div>
          )}

          {ramoId && renderTipo === 'vida' && (
            <div className="grid grid-cols-2 gap-4 pt-2">
              <Campo label="Capital asegurado">
                <input className="form-input w-full font-mono" type="number" value={riesgo.capital_asegurado} onChange={e => setR('capital_asegurado', e.target.value)} />
              </Campo>
              <Campo label="Beneficiarios">
                <input className="form-input w-full" value={riesgo.beneficiarios} onChange={e => setR('beneficiarios', e.target.value)} placeholder="Nombre(s) de beneficiarios" />
              </Campo>
            </div>
          )}

          {ramoId && renderTipo === 'generico' && (
            <div className="pt-2">
              <Campo label="Descripción del riesgo">
                <textarea className="form-input w-full" rows={3} value={riesgo.descripcion} onChange={e => setR('descripcion', e.target.value)} placeholder="Describir el bien o riesgo a asegurar..." />
              </Campo>
            </div>
          )}
        </div>
      </div>

      {/* ── SECTION C: Comparativa de compañías ── */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Comparativa de compañías</h2>
          <button type="button" onClick={addRow} className="btn-secondary text-xs flex items-center gap-1">
            <Plus className="h-3.5 w-3.5" /> Agregar opción
          </button>
        </div>
        <div className="p-5">
          {errores.rows && (
            <span className="flex items-center gap-1 text-xs text-red-500 mb-3">
              <AlertCircle className="h-3 w-3" />{errores.rows}
            </span>
          )}

          {/* Table header */}
          <div className="hidden md:grid md:grid-cols-[1fr_1fr_140px_1fr_40px] gap-3 mb-2 px-1">
            <span className="text-xs font-medium text-slate-500">Compañía *</span>
            <span className="text-xs font-medium text-slate-500">Cobertura *</span>
            <span className="text-xs font-medium text-slate-500">Precio *</span>
            <span className="text-xs font-medium text-slate-500">Detalle</span>
            <span></span>
          </div>

          <div className="space-y-3">
            {rows.map((row, idx) => (
              <div key={row.key} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_140px_1fr_40px] gap-3 items-start p-3 md:p-1 bg-slate-50 md:bg-transparent rounded-lg md:rounded-none border md:border-0 border-slate-200">
                {/* Compania */}
                <div>
                  <span className="text-xs text-slate-500 md:hidden mb-1 block">Compañía *</span>
                  <select
                    className={`form-input w-full text-sm ${errores[`row_${row.key}_compania_id`] ? 'border-red-300' : ''}`}
                    value={row.compania_id}
                    onChange={e => updateRow(row.key, 'compania_id', e.target.value)}
                  >
                    <option value="">Seleccionar...</option>
                    {companias.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                  {errores[`row_${row.key}_compania_id`] && (
                    <span className="text-xs text-red-500">{errores[`row_${row.key}_compania_id`]}</span>
                  )}
                </div>

                {/* Cobertura */}
                <div>
                  <span className="text-xs text-slate-500 md:hidden mb-1 block">Cobertura *</span>
                  <select
                    className={`form-input w-full text-sm ${errores[`row_${row.key}_cobertura_id`] ? 'border-red-300' : ''}`}
                    value={row.cobertura_id}
                    onChange={e => updateRow(row.key, 'cobertura_id', e.target.value)}
                    disabled={!ramoId}
                  >
                    <option value="">{ramoId ? 'Seleccionar...' : 'Elegir ramo primero'}</option>
                    {coberturasFiltradas.map(c => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                  {errores[`row_${row.key}_cobertura_id`] && (
                    <span className="text-xs text-red-500">{errores[`row_${row.key}_cobertura_id`]}</span>
                  )}
                </div>

                {/* Precio */}
                <div>
                  <span className="text-xs text-slate-500 md:hidden mb-1 block">Precio *</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className={`form-input w-full text-sm font-mono ${errores[`row_${row.key}_precio`] ? 'border-red-300' : ''}`}
                    placeholder="0.00"
                    value={row.precio}
                    onChange={e => updateRow(row.key, 'precio', e.target.value)}
                  />
                  {errores[`row_${row.key}_precio`] && (
                    <span className="text-xs text-red-500">{errores[`row_${row.key}_precio`]}</span>
                  )}
                </div>

                {/* Detalle */}
                <div>
                  <span className="text-xs text-slate-500 md:hidden mb-1 block">Detalle</span>
                  <input
                    type="text"
                    className="form-input w-full text-sm"
                    placeholder="Observaciones..."
                    value={row.detalle}
                    onChange={e => updateRow(row.key, 'detalle', e.target.value)}
                  />
                </div>

                {/* Delete */}
                <div className="flex items-center justify-end md:justify-center">
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                      title="Eliminar opción"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Total summary */}
          {rows.some(r => r.precio) && (
            <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-sm">
              <span className="text-slate-500">{rows.filter(r => r.precio).length} opción(es) cargadas</span>
              <span className="text-slate-600">
                Rango: <span className="font-mono font-medium">
                  {formatMoneda(Math.min(...rows.filter(r => r.precio).map(r => parseFloat(r.precio))))}
                </span>
                {rows.filter(r => r.precio).length > 1 && (
                  <>
                    {' — '}
                    <span className="font-mono font-medium">
                      {formatMoneda(Math.max(...rows.filter(r => r.precio).map(r => parseFloat(r.precio))))}
                    </span>
                  </>
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── SECTION D: Notas y vencimiento ── */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 bg-slate-50 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-700">Datos generales</h2>
        </div>
        <div className="p-5 space-y-4">
          <Campo label="Vencimiento de la cotización">
            <input
              type="date"
              className="form-input w-full md:w-64"
              value={fechaVencimiento}
              onChange={e => setFechaVencimiento(e.target.value)}
            />
            <p className="text-2xs text-slate-500 mt-1">
              Fecha hasta la cual los precios de esta cotización son válidos. Después de esta fecha, la cotización se marca como vencida.
            </p>
          </Campo>
          <Campo label="Notas">
            <textarea
              className="form-input w-full"
              rows={3}
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Notas internas sobre esta cotización..."
            />
          </Campo>
        </div>
      </div>

      {/* ── Botones ── */}
      <div className="flex flex-col items-end gap-2 pt-2">
        <p className="text-2xs text-slate-500 max-w-md text-right">
          <span className="font-semibold">Tip:</span> Estos botones solo guardan la cotización en el CRM.
          Para mandarla por email a tu cliente, usá el botón "Enviar por email"
          desde la ficha (requiere SMTP configurado en Configuración → Correos).
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="btn-secondary"
            disabled={guardando}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => guardar('BORRADOR')}
            className="btn-secondary flex items-center gap-2"
            disabled={guardando}
            title="Guarda la cotización como borrador (sin marcarla como enviada)"
          >
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar como borrador
          </button>
          <button
            type="button"
            onClick={() => guardar('ENVIADA')}
            className="btn-primary flex items-center gap-2"
            disabled={guardando}
            title="Guarda la cotización marcándola como enviada. NO manda email — usá esto si ya se la pasaste al cliente por WhatsApp/teléfono/etc."
          >
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Guardar como enviada
          </button>
        </div>
      </div>
    </div>
  )
}
