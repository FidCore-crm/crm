'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  ArrowLeft, Loader2, CheckCircle2, AlertTriangle, Sparkles, FileText,
  User, Building2, Car, Home, Heart, Package, Calendar, ShieldCheck, X,
} from 'lucide-react'
import { useAgentePDFPolling } from '@/lib/hooks/useAgentePDFPolling'
import { getSupabaseClient } from '@/lib/supabase/client'
import CampoEditable from '@/components/agente-pdf/CampoEditable'
import SelectorCatalogoPDF from '@/components/agente-pdf/SelectorCatalogoPDF'
import ClienteExistenteBanner, { AccionCliente } from '@/components/agente-pdf/ClienteExistenteBanner'
import ComparacionEnRevision from '@/components/agente-pdf/ComparacionEnRevision'
import { CoberturasDesglosadasEditor, type CoberturaDesglosada } from '@/components/CoberturasDesglosadasEditor'
import type {
  DatosExtraidosPoliza,
  DatosExtraidosEndoso,
  MapeosCatalogos,
} from '@/lib/agente-pdf/types'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'

interface OpcionCatalogo {
  id: string
  nombre: string
  metadata?: any
  tipo_id?: number
}

function IconoRamo({ tipo }: { tipo: string }) {
  const t = (tipo || '').toLowerCase()
  if (t === 'automotor' || t === 'auto' || t === 'moto') return <Car className="h-4 w-4 text-blue-500" />
  if (t === 'hogar') return <Home className="h-4 w-4 text-amber-500" />
  if (t === 'vida') return <Heart className="h-4 w-4 text-rose-500" />
  return <Package className="h-4 w-4 text-slate-500" />
}

export default function RevisarPDFPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const supabase = getSupabaseClient()

  const { estado } = useAgentePDFPolling(id, {
    intervaloMs: 3000,
    detenerEnEstadosFinales: true,
  })

  const mostrarToast = (msg: string, tipo: 'ok' | 'error' = 'ok') => {
    if (tipo === 'ok') toast.exito(msg)
    else toast.error(msg)
  }

  // Estado editable de datos extraídos + mapeos
  const [datos, setDatos] = useState<DatosExtraidosPoliza | DatosExtraidosEndoso | null>(null)
  const [mapeos, setMapeos] = useState<MapeosCatalogos | null>(null)
  const [accionCliente, setAccionCliente] = useState<AccionCliente>('USAR')
  const [clienteExistente, setClienteExistente] = useState<{ id: string; nombre_completo: string; estado: string; cant_polizas: number } | null>(null)

  // Catálogos + crear nuevos
  const [companias, setCompanias] = useState<OpcionCatalogo[]>([])
  const [ramos, setRamos] = useState<OpcionCatalogo[]>([])
  const [coberturas, setCoberturas] = useState<OpcionCatalogo[]>([])
  const [catalogosACrear, setCatalogosACrear] = useState<{ companias: string[]; ramos: string[]; coberturas: string[] }>({ companias: [], ramos: [], coberturas: [] })

  const [aprobando, setAprobando] = useState(false)

  // Cargar datos iniciales del procesamiento
  useEffect(() => {
    if (!estado) return
    if (estado.estado === 'APROBADO') {
      router.push(`/crm/agente-pdf/${id}/exito`)
      return
    }
    if (estado.estado === 'FALLIDO' || estado.estado === 'CANCELADO') {
      router.push(`/crm/agente-pdf/${id}/procesando`)
      return
    }
    if (estado.estado !== 'EXTRAIDO') return
    if (datos) return // ya cargado
    setDatos(estado.datos_extraidos)
    setMapeos(estado.mapeos_catalogos || null)
  }, [estado, datos, id, router])

  // Cargar catálogos
  useEffect(() => {
    (async () => {
      const { data: tipos } = await supabase.from('tipo_catalogo').select('id, codigo')
      const m: Record<string, number> = {}
      for (const t of (tipos || []) as any[]) m[t.codigo] = t.id
      const [cs, rs, cbs] = await Promise.all([
        m.COMPANIA ? supabase.from('catalogos').select('id, nombre, metadata').eq('tipo_id', m.COMPANIA).eq('activo', true).order('nombre') : Promise.resolve({ data: [] }),
        m.RAMO ? supabase.from('catalogos').select('id, nombre, metadata').eq('tipo_id', m.RAMO).eq('activo', true).order('nombre') : Promise.resolve({ data: [] }),
        m.COBERTURA ? supabase.from('catalogos').select('id, nombre, metadata').eq('tipo_id', m.COBERTURA).eq('activo', true).order('nombre') : Promise.resolve({ data: [] }),
      ])
      setCompanias((cs.data || []) as OpcionCatalogo[])
      setRamos((rs.data || []) as OpcionCatalogo[])
      setCoberturas((cbs.data || []) as OpcionCatalogo[])
    })()
  }, [supabase])

  // Detectar cliente existente por DNI cuando es póliza/renovación
  useEffect(() => {
    if (!datos || !estado) return
    if (estado.tipo_operacion === 'ENDOSO') return
    const d = datos as DatosExtraidosPoliza
    const dni = (d.asegurado?.dni_cuil || '').toString().replace(/\D/g, '')
    if (!dni) { setClienteExistente(null); return }
    (async () => {
      const { data: persona } = await supabase
        .from('personas')
        .select('id, apellido, nombre, razon_social, estado')
        .eq('dni_cuil', dni)
        .maybeSingle()
      if (!persona) { setClienteExistente(null); return }
      const { count } = await supabase
        .from('polizas')
        .select('*', { count: 'exact', head: true })
        .eq('asegurado_id', (persona as any).id)
      setClienteExistente({
        id: (persona as any).id,
        nombre_completo:
          (persona as any).razon_social ||
          [(persona as any).apellido, (persona as any).nombre].filter(Boolean).join(', '),
        estado: (persona as any).estado || 'ACTIVO',
        cant_polizas: count || 0,
      })
      setAccionCliente('USAR')
    })()
  }, [datos, estado, supabase])

  const esEndoso = estado?.tipo_operacion === 'ENDOSO'

  const companiaNombre = useMemo(() => {
    if (!mapeos?.compania_id) return null
    return companias.find(c => c.id === mapeos.compania_id)?.nombre
  }, [mapeos?.compania_id, companias])
  const ramoNombre = useMemo(() => {
    if (!mapeos?.ramo_id) return null
    return ramos.find(r => r.id === mapeos.ramo_id)?.nombre
  }, [mapeos?.ramo_id, ramos])
  const coberturaNombre = useMemo(() => {
    if (!mapeos?.cobertura_id) return null
    return coberturas.find(c => c.id === mapeos.cobertura_id)?.nombre
  }, [mapeos?.cobertura_id, coberturas])

  const coberturasFiltradas = useMemo(() => {
    if (!mapeos?.ramo_id) return coberturas
    return coberturas.filter(c => {
      const ramoIds = (c.metadata as any)?.ramo_ids
      if (!ramoIds || !Array.isArray(ramoIds) || ramoIds.length === 0) return true
      return ramoIds.includes(mapeos.ramo_id)
    })
  }, [coberturas, mapeos?.ramo_id])

  // Resolución completa para habilitar el botón. La cobertura queda OK si:
  // (a) hay un id mapeado, o (b) el PAS decidió crearla al vuelo (queda en
  // catalogosACrear.coberturas hasta que se aprueba). Mismo criterio que
  // compañías y ramos.
  const todoResuelto = useMemo(() => {
    if (!datos) return false
    if (esEndoso) {
      const d = datos as DatosExtraidosEndoso
      return !!d.motivo && d.motivo.trim().length > 0
    }
    const d = datos as DatosExtraidosPoliza
    if (!d.asegurado?.dni_cuil) return false
    if (!d.poliza?.numero_poliza) return false
    if (!d.poliza?.fecha_inicio || !d.poliza?.fecha_fin) return false
    const companiaOk = !!mapeos?.compania_id || catalogosACrear.companias.length > 0
    const ramoOk = !!mapeos?.ramo_id || catalogosACrear.ramos.length > 0
    const coberturaOk = !!mapeos?.cobertura_id || catalogosACrear.coberturas.length > 0
    if (!companiaOk || !ramoOk || !coberturaOk) return false
    return true
  }, [datos, mapeos, esEndoso, catalogosACrear])

  // Memoizado para estabilizar la referencia — sino el useMemo de abajo
  // recalcula en cada render aunque el contenido sea igual.
  const dudosos = useMemo(() => estado?.campos_dudosos || [], [estado?.campos_dudosos])
  const bannerColor = dudosos.length === 0
    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
    : dudosos.length <= 3
    ? 'bg-amber-50 border-amber-200 text-amber-800'
    : 'bg-red-50 border-red-200 text-red-800'
  const bannerIcon = dudosos.length === 0 ? CheckCircle2 : AlertTriangle
  const BannerIcon = bannerIcon

  const dudososPorCampo = useMemo(() => {
    const map: Record<string, { motivo: string }> = {}
    for (const d of dudosos) map[d.campo] = { motivo: d.motivo }
    return map
  }, [dudosos])

  // ────────────────────────────────────────────────────────────
  // Helpers de update parcial
  // ────────────────────────────────────────────────────────────
  function updateAsegurado(patch: any) {
    setDatos(prev => {
      if (!prev) return prev
      const p = prev as DatosExtraidosPoliza
      return { ...p, asegurado: { ...p.asegurado, ...patch } }
    })
  }
  function updateDomicilio(patch: any) {
    setDatos(prev => {
      if (!prev) return prev
      const p = prev as DatosExtraidosPoliza
      return { ...p, asegurado: { ...p.asegurado, domicilio: { ...(p.asegurado.domicilio || {}), ...patch } } }
    })
  }
  function updatePolizaCampo(patch: any) {
    setDatos(prev => {
      if (!prev) return prev
      const p = prev as DatosExtraidosPoliza
      return { ...p, poliza: { ...p.poliza, ...patch } }
    })
  }
  function updateRiesgoDetalle(patch: any) {
    setDatos(prev => {
      if (!prev) return prev
      const p = prev as DatosExtraidosPoliza
      return { ...p, riesgo: { ...p.riesgo, detalle_tecnico: { ...(p.riesgo.detalle_tecnico || {}), ...patch } } }
    })
  }
  function updateEndoso(patch: Partial<DatosExtraidosEndoso>) {
    setDatos(prev => (prev ? { ...(prev as DatosExtraidosEndoso), ...patch } : prev))
  }

  // ────────────────────────────────────────────────────────────
  // Aprobar
  // ────────────────────────────────────────────────────────────
  async function aprobar() {
    if (!todoResuelto) {
      mostrarToast('Resolvé los campos marcados primero', 'error')
      return
    }
    setAprobando(true)
    const r = await apiCall(`/api/agente-pdf/${id}/aprobar`, {
      method: 'POST',
      body: {
        datos_finales: datos,
        mapeos_finales: mapeos,
        catalogos_a_crear: catalogosACrear,
        persona_existente_accion: clienteExistente ? accionCliente : undefined,
      },
    })
    if (r.ok) {
      router.push(`/crm/agente-pdf/${id}/exito`)
    } else {
      setAprobando(false)
    }
  }

  async function cancelar() {
    if (!confirm('¿Cancelar? Los datos extraídos se pierden.')) return
    await apiCall(`/api/agente-pdf/${id}/cancelar`, { method: 'POST' }, { mostrar_toast_en_error: false })
    router.push('/crm/dashboard')
  }

  // ────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────

  if (!estado || !datos) {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center text-sm text-slate-600">
        <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
        Cargando datos del análisis...
      </div>
    )
  }

  const tipoOp = estado.tipo_operacion
  const titulo =
    tipoOp === 'POLIZA_NUEVA' ? 'Revisar datos de la póliza nueva'
    : tipoOp === 'RENOVACION' ? 'Revisar datos de la renovación'
    : 'Revisar datos del endoso'

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={cancelar} className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Cancelar
        </button>
      </div>
      <div>
        <h1 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-blue-600" /> {titulo}
        </h1>
        <p className="text-xs text-slate-600">
          Revisá los datos extraídos del PDF y ajustá lo que haga falta antes de crear {tipoOp === 'ENDOSO' ? 'el endoso' : 'la póliza'}.
        </p>
      </div>

      {/* Banner de calidad */}
      <div className={`flex items-start gap-2 border rounded p-3 ${bannerColor}`}>
        <BannerIcon className="h-4 w-4 shrink-0 mt-0.5" />
        <p className="text-xs">
          {dudosos.length === 0
            ? 'Todos los datos se extrajeron correctamente.'
            : dudosos.length <= 3
            ? `Hay ${dudosos.length} campo${dudosos.length !== 1 ? 's' : ''} que requieren tu atención.`
            : `Hay ${dudosos.length} campos con problemas — revisá con atención.`}
        </p>
      </div>

      {/* Análisis de cambios IA — solo en renovaciones. Se actualiza automáticamente
          vía Realtime cuando termina la comparación paralela del procesamiento. */}
      {tipoOp === 'RENOVACION' && estado.poliza_origen_id && (
        <ComparacionEnRevision
          procesamientoId={id}
          polizaOrigenId={estado.poliza_origen_id}
          comparacion={estado.comparacion_resultado || null}
          estadoProcesamiento={estado.estado}
        />
      )}

      {/* ──── ENDOSO ──── */}
      {esEndoso && renderSeccionesEndoso({
        datos: datos as DatosExtraidosEndoso,
        estado,
        updateEndoso,
        dudososPorCampo,
      })}

      {/* ──── POLIZA / RENOVACION ──── */}
      {!esEndoso && (() => {
        const d = datos as DatosExtraidosPoliza
        return (
          <>
            {/* Sección 1 — Asegurado */}
            <SeccionCard icono={<User className="h-4 w-4 text-blue-500" />} titulo="Asegurado">
              {clienteExistente && (
                <ClienteExistenteBanner
                  cliente_existente={clienteExistente}
                  accion={accionCliente}
                  onCambiarAccion={setAccionCliente}
                />
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-2xs text-slate-600 uppercase tracking-wide font-semibold">Tipo de persona</label>
                  <select
                    className="form-input w-full text-xs mt-0.5"
                    value={d.asegurado.tipo_persona}
                    onChange={e => updateAsegurado({ tipo_persona: e.target.value as any })}
                  >
                    <option value="FISICA">Física</option>
                    <option value="JURIDICA">Jurídica</option>
                  </select>
                </div>
                <CampoEditable
                  label="DNI / CUIT"
                  valor={d.asegurado.dni_cuil}
                  onChange={v => updateAsegurado({ dni_cuil: v })}
                  monospace
                  dudoso={!!dudososPorCampo['asegurado.dni_cuil']}
                  motivoDudoso={dudososPorCampo['asegurado.dni_cuil']?.motivo}
                />
                {d.asegurado.tipo_persona === 'JURIDICA' ? (
                  <div className="col-span-2">
                    <CampoEditable
                      label="Razón social"
                      valor={d.asegurado.razon_social || d.asegurado.apellido}
                      onChange={v => updateAsegurado({ razon_social: v })}
                    />
                  </div>
                ) : (
                  <>
                    <CampoEditable
                      label="Apellido"
                      valor={d.asegurado.apellido}
                      onChange={v => updateAsegurado({ apellido: v })}
                    />
                    <CampoEditable
                      label="Nombre"
                      valor={d.asegurado.nombre}
                      onChange={v => updateAsegurado({ nombre: v })}
                    />
                  </>
                )}
                <CampoEditable
                  label="Email"
                  valor={d.asegurado.email}
                  tipo="email"
                  onChange={v => updateAsegurado({ email: v })}
                  dudoso={!!dudososPorCampo['asegurado.email']}
                  motivoDudoso={dudososPorCampo['asegurado.email']?.motivo}
                />
                <CampoEditable
                  label="Teléfono"
                  valor={d.asegurado.telefono}
                  tipo="tel"
                  onChange={v => updateAsegurado({ telefono: v })}
                />
              </div>

              <div className="border-t border-slate-100 pt-3 mt-2">
                <p className="text-2xs text-slate-600 uppercase tracking-wide font-semibold mb-2">Domicilio</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <CampoEditable label="Calle" valor={d.asegurado.domicilio?.calle} onChange={v => updateDomicilio({ calle: v })} />
                  </div>
                  <CampoEditable label="Número" valor={d.asegurado.domicilio?.numero} onChange={v => updateDomicilio({ numero: v })} />
                  <CampoEditable label="Código postal" valor={d.asegurado.domicilio?.codigo_postal} onChange={v => updateDomicilio({ codigo_postal: v })} />
                  <CampoEditable label="Localidad" valor={d.asegurado.domicilio?.localidad} onChange={v => updateDomicilio({ localidad: v })} />
                  <CampoEditable label="Provincia" valor={d.asegurado.domicilio?.provincia} onChange={v => updateDomicilio({ provincia: v })} />
                </div>
              </div>
            </SeccionCard>

            {/* Sección 2 — Catálogos */}
            <SeccionCard icono={<Building2 className="h-4 w-4 text-blue-500" />} titulo="Compañía y producto">
              <SelectorCatalogoPDF
                tipo="COMPANIA"
                valor_pdf={d.catalogos_pdf?.compania_texto}
                valor_mapeado_id={mapeos?.compania_id || null}
                opciones={companias}
                nombreMapeado={companiaNombre || undefined}
                pendienteCrearNombre={catalogosACrear.companias[0] || null}
                onCancelarPendiente={() => setCatalogosACrear(prev => ({ ...prev, companias: [] }))}
                onMapear={idCat => {
                  setCatalogosACrear(prev => ({ ...prev, companias: [] }))
                  setMapeos(prev => ({ ...(prev || ({} as MapeosCatalogos)), compania_id: idCat }))
                }}
                onCrearNuevo={() => {
                  const nombre = d.catalogos_pdf?.compania_texto
                  if (!nombre) return
                  if (!catalogosACrear.companias.includes(nombre)) {
                    setCatalogosACrear(prev => ({ ...prev, companias: [...prev.companias, nombre] }))
                  }
                  // marca compania_id como "propuesto" (queda null hasta la aprobación)
                  mostrarToast(`"${nombre}" se va a crear al aprobar`, 'ok')
                  setMapeos(prev => ({ ...(prev || ({} as MapeosCatalogos)), compania_propuesta: nombre, compania_id: null }))
                }}
              />
              <SelectorCatalogoPDF
                tipo="RAMO"
                valor_pdf={d.catalogos_pdf?.ramo_texto}
                valor_mapeado_id={mapeos?.ramo_id || null}
                opciones={ramos}
                nombreMapeado={ramoNombre || undefined}
                pendienteCrearNombre={catalogosACrear.ramos[0] || null}
                onCancelarPendiente={() => setCatalogosACrear(prev => ({ ...prev, ramos: [] }))}
                onMapear={idCat => {
                  setCatalogosACrear(prev => ({ ...prev, ramos: [] }))
                  setMapeos(prev => ({ ...(prev || ({} as MapeosCatalogos)), ramo_id: idCat }))
                }}
                onCrearNuevo={() => {
                  const nombre = d.catalogos_pdf?.ramo_texto
                  if (!nombre) return
                  if (!catalogosACrear.ramos.includes(nombre)) {
                    setCatalogosACrear(prev => ({ ...prev, ramos: [...prev.ramos, nombre] }))
                  }
                  mostrarToast(`"${nombre}" se va a crear al aprobar`, 'ok')
                  setMapeos(prev => ({ ...(prev || ({} as MapeosCatalogos)), ramo_propuesto: nombre, ramo_id: null }))
                }}
              />
              <SelectorCatalogoPDF
                tipo="COBERTURA"
                valor_pdf={d.catalogos_pdf?.cobertura_texto}
                valor_mapeado_id={mapeos?.cobertura_id || null}
                opciones={coberturasFiltradas}
                nombreMapeado={coberturaNombre || undefined}
                pendienteCrearNombre={catalogosACrear.coberturas[0] || null}
                onCancelarPendiente={() => setCatalogosACrear(prev => ({ ...prev, coberturas: [] }))}
                permiteCrear={true}
                onMapear={idCat => {
                  setCatalogosACrear(prev => ({ ...prev, coberturas: [] }))
                  setMapeos(prev => ({ ...(prev || ({} as MapeosCatalogos)), cobertura_id: idCat }))
                }}
                onCrearNuevo={() => {
                  const nombre = mapeos?.cobertura_info_config?.texto_pdf || d.catalogos_pdf?.cobertura_texto
                  if (!nombre) return
                  if (!catalogosACrear.coberturas.includes(nombre)) {
                    setCatalogosACrear(prev => ({ ...prev, coberturas: [...prev.coberturas, nombre] }))
                  }
                  const cia = mapeos?.cobertura_info_config?.compania_nombre || companiaNombre
                  mostrarToast(
                    cia
                      ? `"${nombre}" se va a crear al aprobar y quedará vinculada a ${cia}`
                      : `"${nombre}" se va a crear al aprobar`,
                    'ok'
                  )
                  setMapeos(prev => ({ ...(prev || ({} as MapeosCatalogos)), cobertura_propuesta: nombre, cobertura_id: null }))
                }}
              />
              {mapeos?.cobertura_estado === 'SUGERIDO_CREAR' && mapeos?.cobertura_info_config && !mapeos?.cobertura_id && catalogosACrear.coberturas.length === 0 && (
                <div className="border border-blue-200 bg-blue-50 rounded p-3 text-xs text-blue-900 flex gap-2 items-start">
                  <Sparkles className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Cobertura nueva detectada</p>
                    <p className="mt-0.5 text-blue-800">{mapeos.cobertura_info_config.sugerencia_accion}</p>
                  </div>
                </div>
              )}
            </SeccionCard>

            {/* Sección 3 — Datos de póliza */}
            <SeccionCard icono={<Calendar className="h-4 w-4 text-blue-500" />} titulo="Datos de la póliza">
              <div className="grid grid-cols-2 gap-3">
                <CampoEditable
                  label="Número de póliza"
                  valor={d.poliza?.numero_poliza}
                  onChange={v => updatePolizaCampo({ numero_poliza: v })}
                  monospace
                  dudoso={!!dudososPorCampo['poliza.numero_poliza']}
                  motivoDudoso={dudososPorCampo['poliza.numero_poliza']?.motivo}
                />
                <CampoEditable
                  label="Número de endoso"
                  valor={d.poliza?.numero_endoso}
                  onChange={v => updatePolizaCampo({ numero_endoso: v })}
                />
                <CampoEditable
                  label="Vigencia desde"
                  valor={d.poliza?.fecha_inicio}
                  tipo="date"
                  onChange={v => updatePolizaCampo({ fecha_inicio: v })}
                  dudoso={!!dudososPorCampo['poliza.fecha_inicio'] || !!dudososPorCampo['poliza.vigencia']}
                  motivoDudoso={dudososPorCampo['poliza.fecha_inicio']?.motivo || dudososPorCampo['poliza.vigencia']?.motivo}
                />
                <CampoEditable
                  label="Vigencia hasta"
                  valor={d.poliza?.fecha_fin}
                  tipo="date"
                  onChange={v => updatePolizaCampo({ fecha_fin: v })}
                  dudoso={!!dudososPorCampo['poliza.fecha_fin']}
                  motivoDudoso={dudososPorCampo['poliza.fecha_fin']?.motivo}
                />
                <div>
                  <label className="text-2xs text-slate-600 uppercase tracking-wide font-semibold">Moneda</label>
                  <select
                    className="form-input w-full text-xs mt-0.5"
                    value={d.poliza?.moneda || 'ARS'}
                    onChange={e => updatePolizaCampo({ moneda: e.target.value as 'ARS' | 'USD' })}
                  >
                    <option value="ARS">ARS</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <CampoEditable
                  label="Suma asegurada"
                  valor={d.poliza?.suma_asegurada != null ? String(d.poliza.suma_asegurada) : ''}
                  tipo="number"
                  onChange={v => updatePolizaCampo({ suma_asegurada: v ? Number(v) : null })}
                />
              </div>
            </SeccionCard>

            {/* Sección 4 — Riesgo */}
            <SeccionCard
              icono={<IconoRamo tipo={d.riesgo?.tipo_riesgo || ''} />}
              titulo={`Datos del Bien Asegurado (${d.riesgo?.tipo_riesgo || 'sin tipo'})`}
            >
              {['AUTOMOTOR', 'MOTO'].includes(String(d.riesgo?.tipo_riesgo || '').toUpperCase()) ? (
                <div className="grid grid-cols-2 gap-3">
                  <CampoEditable label="Marca" valor={d.riesgo.detalle_tecnico?.marca} onChange={v => updateRiesgoDetalle({ marca: v })} />
                  <CampoEditable label="Modelo" valor={d.riesgo.detalle_tecnico?.modelo} onChange={v => updateRiesgoDetalle({ modelo: v })} />
                  <CampoEditable label="Año" valor={d.riesgo.detalle_tecnico?.anio != null ? String(d.riesgo.detalle_tecnico?.anio) : ''} tipo="number" onChange={v => updateRiesgoDetalle({ anio: v ? Number(v) : null })} />
                  <CampoEditable label="Patente" valor={d.riesgo.detalle_tecnico?.patente} onChange={v => updateRiesgoDetalle({ patente: v?.toUpperCase() })} monospace dudoso={!!dudososPorCampo['riesgo.automotor']} motivoDudoso={dudososPorCampo['riesgo.automotor']?.motivo} />
                  <CampoEditable label="Motor" valor={d.riesgo.detalle_tecnico?.motor} onChange={v => updateRiesgoDetalle({ motor: v?.toUpperCase() })} monospace />
                  <CampoEditable label="Chasis" valor={d.riesgo.detalle_tecnico?.chasis} onChange={v => updateRiesgoDetalle({ chasis: v?.toUpperCase() })} monospace />
                  <CampoEditable label="Color" valor={d.riesgo.detalle_tecnico?.color} onChange={v => updateRiesgoDetalle({ color: v })} />
                  <CampoEditable label="Uso" valor={d.riesgo.detalle_tecnico?.uso} onChange={v => updateRiesgoDetalle({ uso: v })} />
                </div>
              ) : String(d.riesgo?.tipo_riesgo || '').toUpperCase() === 'HOGAR' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <CampoEditable label="Calle" valor={d.riesgo.detalle_tecnico?.calle} onChange={v => updateRiesgoDetalle({ calle: v })} />
                  </div>
                  <CampoEditable label="Número" valor={d.riesgo.detalle_tecnico?.numero} onChange={v => updateRiesgoDetalle({ numero: v })} />
                  <CampoEditable label="Localidad" valor={d.riesgo.detalle_tecnico?.localidad} onChange={v => updateRiesgoDetalle({ localidad: v })} />
                  <CampoEditable label="Provincia" valor={d.riesgo.detalle_tecnico?.provincia} onChange={v => updateRiesgoDetalle({ provincia: v })} />
                  <CampoEditable label="Tipo construcción" valor={d.riesgo.detalle_tecnico?.tipo_construccion} onChange={v => updateRiesgoDetalle({ tipo_construccion: v })} />
                  <CampoEditable label="Superficie" valor={d.riesgo.detalle_tecnico?.superficie} onChange={v => updateRiesgoDetalle({ superficie: v })} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(d.riesgo?.detalle_tecnico || {})
                    // Ocultar keys "estructuradas" (arrays de objetos): tienen su
                    // propio renderizador. Sino se mostrarían como "[object Object]".
                    .filter(([k]) => k !== 'coberturas_desglosadas' && k !== 'clausulas')
                    .map(([k, v]) => (
                      <CampoEditable
                        key={k}
                        label={k}
                        valor={v != null ? String(v) : ''}
                        onChange={nv => updateRiesgoDetalle({ [k]: nv })}
                      />
                    ))}
                  {Object.keys(d.riesgo?.detalle_tecnico || {}).filter(k => k !== 'coberturas_desglosadas' && k !== 'clausulas').length === 0 && (
                    <p className="col-span-2 text-xs text-slate-500 italic">La IA no extrajo datos específicos del bien asegurado.</p>
                  )}
                </div>
              )}

              {/* Coberturas desglosadas — la IA la puebla para pólizas
                  integrales con sub-coberturas. Se muestra abajo del bloque
                  de datos del bien; el PAS puede editar, agregar o eliminar
                  filas antes de aprobar. */}
              <div className="mt-3 pt-3 border-t border-slate-100">
                <CoberturasDesglosadasEditor
                  valor={d.riesgo?.detalle_tecnico?.coberturas_desglosadas}
                  onChange={(nuevo: CoberturaDesglosada[]) => {
                    // Si quedó vacío, eliminamos la key entera para no dejar
                    // arrays vacíos en el JSONB. Reasignamos detalle_tecnico
                    // completo en vez de patch spread (que deja `undefined`
                    // en la key en vez de removerla).
                    setDatos(prev => {
                      if (!prev) return prev
                      const p = prev as DatosExtraidosPoliza
                      const dt = { ...(p.riesgo.detalle_tecnico || {}) }
                      if (nuevo.length === 0) {
                        delete dt.coberturas_desglosadas
                      } else {
                        dt.coberturas_desglosadas = nuevo
                      }
                      return { ...p, riesgo: { ...p.riesgo, detalle_tecnico: dt } }
                    })
                  }}
                  moneda={d.poliza?.moneda ?? 'ARS'}
                />
              </div>
            </SeccionCard>

            {/* Sección 5 — Archivo */}
            <SeccionCard icono={<FileText className="h-4 w-4 text-red-500" />} titulo="Archivo original">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-red-500 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-medium text-slate-800">{estado.nombre_archivo}</p>
                  <p className="text-2xs text-slate-600">
                    Se va a guardar en la carpeta{' '}
                    <code className="font-mono text-slate-700">
                      {tipoOp === 'RENOVACION' ? 'documentacion_renovada/' : 'documentacion/'}
                    </code>{' '}
                    de la póliza.
                  </p>
                </div>
              </div>
            </SeccionCard>
          </>
        )
      })()}

      {/* Advertencias de la IA */}
      {(() => {
        const adv = (datos as any).advertencias_ia as string[] | undefined
        if (!adv || adv.length === 0) return null
        return (
          <div className="bg-amber-50 border border-amber-200 rounded p-3 flex flex-col gap-1">
            <p className="text-2xs font-semibold text-amber-800 uppercase">Advertencias de la IA</p>
            {adv.map((a, i) => (
              <p key={i} className="text-xs text-amber-700">• {a}</p>
            ))}
          </div>
        )
      })()}

      {/* Sticky bottom — botones */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-between shadow-lg">
        <button onClick={cancelar} className="btn-secondary" disabled={aprobando}>
          <X className="h-3.5 w-3.5" /> Cancelar
        </button>
        <div className="flex items-center gap-3">
          {!todoResuelto && (
            <span className="text-2xs text-amber-700 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Resolvé los campos marcados primero
            </span>
          )}
          <button
            onClick={aprobar}
            disabled={aprobando || !todoResuelto}
            className="btn-primary"
          >
            {aprobando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {aprobando
              ? 'Creando...'
              : tipoOp === 'ENDOSO'
              ? 'Aprobar y crear endoso'
              : tipoOp === 'RENOVACION'
              ? 'Aprobar y crear renovación'
              : 'Aprobar y crear póliza'}
          </button>
        </div>
      </div>

    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Sub-componentes
// ────────────────────────────────────────────────────────────

function SeccionCard({ icono, titulo, children }: { icono: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-slate-50">
        {icono}
        <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">{titulo}</h2>
      </div>
      <div className="p-4 flex flex-col gap-3">{children}</div>
    </div>
  )
}

function renderSeccionesEndoso({
  datos,
  estado,
  updateEndoso,
  dudososPorCampo,
}: {
  datos: DatosExtraidosEndoso
  estado: any
  updateEndoso: (p: Partial<DatosExtraidosEndoso>) => void
  dudososPorCampo: Record<string, { motivo: string }>
}) {
  return (
    <>
      <SeccionCard icono={<Calendar className="h-4 w-4 text-blue-500" />} titulo="Datos del endoso">
        <div className="grid grid-cols-2 gap-3">
          <CampoEditable
            label="Número de endoso"
            valor={datos.numero_endoso}
            onChange={v => updateEndoso({ numero_endoso: v })}
            monospace
          />
          <CampoEditable
            label="Fecha del endoso"
            valor={datos.fecha_endoso}
            tipo="date"
            onChange={v => updateEndoso({ fecha_endoso: v })}
            dudoso={!!dudososPorCampo['fecha_endoso']}
            motivoDudoso={dudososPorCampo['fecha_endoso']?.motivo}
          />
          <div className="col-span-2">
            <CampoEditable
              label="Motivo"
              valor={datos.motivo}
              onChange={v => updateEndoso({ motivo: v })}
              dudoso={!!dudososPorCampo['motivo']}
              motivoDudoso={dudososPorCampo['motivo']?.motivo}
            />
          </div>
          <div className="col-span-2">
            <label className="text-2xs text-slate-600 uppercase tracking-wide font-semibold">Observaciones</label>
            <textarea
              className="form-input w-full text-xs mt-0.5"
              rows={3}
              value={datos.observaciones || ''}
              onChange={e => updateEndoso({ observaciones: e.target.value })}
            />
          </div>
        </div>
      </SeccionCard>

      {datos.cambios_detectados && datos.cambios_detectados.length > 0 && (
        <SeccionCard icono={<Sparkles className="h-4 w-4 text-blue-500" />} titulo="Cambios detectados por la IA">
          <ul className="text-xs text-slate-700 space-y-1">
            {datos.cambios_detectados.map((c, i) => (
              <li key={i}>• {c}</li>
            ))}
          </ul>
          <p className="text-2xs text-slate-500 italic">Verificá estos cambios antes de aprobar.</p>
        </SeccionCard>
      )}

      <SeccionCard icono={<FileText className="h-4 w-4 text-red-500" />} titulo="Archivo original">
        <div className="flex items-center gap-3">
          <FileText className="h-5 w-5 text-red-500 shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-medium text-slate-800">{estado.nombre_archivo}</p>
            <p className="text-2xs text-slate-600">
              Se va a guardar en la carpeta <code className="font-mono text-slate-700">endosos/</code> de la póliza.
            </p>
          </div>
        </div>
      </SeccionCard>
    </>
  )
}
