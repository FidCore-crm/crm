'use client'

/**
 * Modal de alta/edición de una mailing_audiencia.
 *
 * Tipo FILTRO: criterios combinables que se aplican al momento de uso.
 *   - Estado persona (multi)
 *   - Tipo persona (FISICA/JURIDICA)
 *   - Acepta marketing
 *   - Origen (multi)
 *   - Provincia (multi)
 *   - Con email (checkbox)
 *   - Compañías (multi)
 *   - Ramos (multi)
 *   - Estado póliza (multi)
 *   - Vencimiento próximo en N días
 *   - Vencidas hace N días
 *   - Con/sin pólizas vigentes
 *   - Antigüedad cliente (min/max días)
 *
 * Tipo MANUAL: selección directa de personas con search.
 *
 * Preview en vivo: al cambiar filtros, llama POST /audiencias/[id]/preview
 * para mostrar cuántas personas cumplen + muestra de 10.
 */

import { useState, useEffect, useCallback } from 'react'
import { X, Loader2, Save, Filter as FilterIcon, Users, RefreshCw, Search } from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { getSupabaseClient } from '@/lib/supabase/client'
import type { MailingAudiencia } from './TabMailingAudiencias'

interface Props {
  audiencia: MailingAudiencia | null
  onCerrar: () => void
  onGuardada: () => void
}

interface CatalogoItem { id: string; nombre: string }
interface PreviewResult {
  total: number
  ids: string[]
  leads_ids?: string[]
  muestra: Array<{ id: string; tipo?: 'persona' | 'lead'; nombre: string | null; apellido: string; razon_social: string | null; email: string | null; acepta_marketing: boolean; estado_lead?: string; motivo_descarte?: string | null }>
}

const ESTADOS_PERSONA = ['PROSPECTO', 'ACTIVO', 'INACTIVO', 'BLOQUEADO']
const ESTADOS_POLIZA = ['PROGRAMADA', 'VIGENTE', 'NO_VIGENTE', 'RENOVADA', 'CANCELADA', 'ANULADA']
const ESTADOS_LEAD = ['NUEVO', 'CONTACTADO', 'CONVERTIDO', 'DESCARTADO']

export default function ModalEditarAudiencia({ audiencia, onCerrar, onGuardada }: Props) {
  const esNueva = audiencia === null
  const supabase = getSupabaseClient()

  const [nombre, setNombre] = useState(audiencia?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(audiencia?.descripcion ?? '')
  const [tipo, setTipo] = useState<'FILTRO' | 'MANUAL'>(audiencia?.tipo ?? 'FILTRO')

  // Filtros (tipo=FILTRO)
  const f = audiencia?.filtro_jsonb ?? {}
  const [estadoPersona, setEstadoPersona] = useState<string[]>(f.estado_persona ?? ['ACTIVO'])
  const [tipoPersona, setTipoPersona] = useState<string[]>(f.tipo_persona ?? [])
  const [aceptaMarketing, setAceptaMarketing] = useState<boolean | null>(f.acepta_marketing ?? null)
  const [conEmail, setConEmail] = useState<boolean>(f.con_email ?? true)
  const [companiaIds, setCompaniaIds] = useState<string[]>(f.compania_ids ?? [])
  const [ramoIds, setRamoIds] = useState<string[]>(f.ramo_ids ?? [])
  const [estadoPoliza, setEstadoPoliza] = useState<string[]>(f.estado_poliza ?? [])
  const [vencProx, setVencProx] = useState<string>(f.vencimiento_proximo_dias?.toString() ?? '')
  const [vencHace, setVencHace] = useState<string>(f.vencidas_hace_dias?.toString() ?? '')
  const [conVigentes, setConVigentes] = useState<boolean | null>(f.con_polizas_vigentes ?? null)
  const [antMin, setAntMin] = useState<string>(f.antiguedad_cliente_dias_min?.toString() ?? '')
  const [antMax, setAntMax] = useState<string>(f.antiguedad_cliente_dias_max?.toString() ?? '')

  // Leads (tipo=FILTRO). Migración 114 — audiencia puede incluir leads
  // además de personas para enviar campañas a prospectos no convertidos.
  const [incluirPersonas, setIncluirPersonas] = useState<boolean>(f.incluir_personas ?? !f.incluir_leads)
  const [incluirLeads, setIncluirLeads] = useState<boolean>(f.incluir_leads ?? false)
  const [leadsEstado, setLeadsEstado] = useState<string[]>(f.leads_estado ?? ['DESCARTADO'])
  const [leadsMotivo, setLeadsMotivo] = useState<string>(f.leads_motivo_descarte_ilike ?? '')

  // Manual (tipo=MANUAL)
  const [idsManual, setIdsManual] = useState<string[]>(audiencia?.ids_personas ?? [])
  const [busquedaManual, setBusquedaManual] = useState('')

  // Catálogos
  const [companias, setCompanias] = useState<CatalogoItem[]>([])
  const [ramos, setRamos] = useState<CatalogoItem[]>([])

  // Preview
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewCargando, setPreviewCargando] = useState(false)
  const [guardando, setGuardando] = useState(false)

  // Cargar catálogos
  useEffect(() => {
    (async () => {
      const { data: tCompania } = await supabase
        .from('tipo_catalogo').select('id').eq('codigo', 'COMPANIA').maybeSingle()
      const { data: tRamo } = await supabase
        .from('tipo_catalogo').select('id').eq('codigo', 'RAMO').maybeSingle()
      if (tCompania) {
        const { data: cs } = await supabase
          .from('catalogos').select('id, nombre')
          .eq('tipo_id', (tCompania as any).id).eq('activo', true).order('nombre')
        setCompanias(((cs ?? []) as any[]))
      }
      if (tRamo) {
        const { data: rs } = await supabase
          .from('catalogos').select('id, nombre')
          .eq('tipo_id', (tRamo as any).id).eq('activo', true).order('nombre')
        setRamos(((rs ?? []) as any[]))
      }
    })()
  }, [supabase])

  // Construir filtro JSONB actual (memoizable pero simple)
  function construirFiltro(): any {
    const filtro: any = {}
    // Destinatarios
    filtro.incluir_personas = incluirPersonas
    filtro.incluir_leads = incluirLeads
    // Personas
    if (estadoPersona.length) filtro.estado_persona = estadoPersona
    if (tipoPersona.length) filtro.tipo_persona = tipoPersona
    if (aceptaMarketing != null) filtro.acepta_marketing = aceptaMarketing
    if (conEmail) filtro.con_email = true
    if (companiaIds.length) filtro.compania_ids = companiaIds
    if (ramoIds.length) filtro.ramo_ids = ramoIds
    if (estadoPoliza.length) filtro.estado_poliza = estadoPoliza
    if (vencProx) filtro.vencimiento_proximo_dias = parseInt(vencProx, 10)
    if (vencHace) filtro.vencidas_hace_dias = parseInt(vencHace, 10)
    if (conVigentes != null) filtro.con_polizas_vigentes = conVigentes
    if (antMin) filtro.antiguedad_cliente_dias_min = parseInt(antMin, 10)
    if (antMax) filtro.antiguedad_cliente_dias_max = parseInt(antMax, 10)
    // Leads
    if (incluirLeads) {
      if (leadsEstado.length) filtro.leads_estado = leadsEstado
      if (leadsMotivo.trim()) filtro.leads_motivo_descarte_ilike = leadsMotivo.trim()
    }
    return filtro
  }

  // Preview con debounce
  const ejecutarPreview = useCallback(async () => {
    setPreviewCargando(true)
    const body = tipo === 'FILTRO'
      ? { tipo, filtro_jsonb: construirFiltro() }
      : { tipo, ids_personas: idsManual }
    const r = await apiCall<PreviewResult>(
      '/api/comunicaciones/audiencias/preview-adhoc',
      { method: 'POST', body },
      { mostrar_toast_en_error: false },
    )
    setPreviewCargando(false)
    if (r.ok && r.data) setPreview(r.data)
    // construirFiltro es una función local que depende de exactamente estos
    // mismos state values; declararla explícitamente sería redundante.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, estadoPersona, tipoPersona, aceptaMarketing, conEmail, companiaIds, ramoIds, estadoPoliza, vencProx, vencHace, conVigentes, antMin, antMax, idsManual, incluirPersonas, incluirLeads, leadsEstado, leadsMotivo])

  useEffect(() => {
    const t = setTimeout(ejecutarPreview, 500)
    return () => clearTimeout(t)
  }, [ejecutarPreview])

  function toggleEn<T extends string>(setter: (v: T[]) => void, arr: T[], item: T) {
    setter(arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item])
  }

  async function guardar() {
    if (!nombre.trim()) {
      toast.error('Falta el nombre de la audiencia')
      return
    }
    if (tipo === 'MANUAL' && idsManual.length === 0) {
      toast.error('Seleccioná al menos una persona en modo Manual')
      return
    }
    setGuardando(true)
    const body = {
      nombre: nombre.trim(),
      descripcion: descripcion.trim() || null,
      tipo,
      filtro_jsonb: tipo === 'FILTRO' ? construirFiltro() : null,
      ids_personas: tipo === 'MANUAL' ? idsManual : [],
    }
    const r = esNueva
      ? await apiCall('/api/comunicaciones/audiencias', { method: 'POST', body })
      : await apiCall(`/api/comunicaciones/audiencias/${audiencia.id}`, { method: 'PATCH', body })
    setGuardando(false)
    if (r.ok) {
      toast.exito(esNueva ? 'Audiencia creada' : 'Audiencia actualizada')
      onGuardada()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800">
            {esNueva ? 'Nueva audiencia' : `Editar: ${audiencia.nombre}`}
          </h3>
          <button onClick={onCerrar} className="text-slate-500 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body scroll */}
        <div className="overflow-y-auto px-5 py-4 flex-1 space-y-4">
          {/* Nombre + descripción */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-2xs font-medium text-slate-600 mb-1">Nombre *</label>
              <input
                type="text"
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                placeholder="Clientes de La Caja con vencimiento próximo"
                className="form-input w-full text-sm"
              />
            </div>
            <div>
              <label className="block text-2xs font-medium text-slate-600 mb-1">Descripción</label>
              <input
                type="text"
                value={descripcion}
                onChange={e => setDescripcion(e.target.value)}
                placeholder="Para campañas de renovación"
                className="form-input w-full text-sm"
              />
            </div>
          </div>

          {/* Tipo: FILTRO / MANUAL */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTipo('FILTRO')}
              className={`flex-1 px-3 py-2 rounded border text-xs font-medium flex items-center justify-center gap-1.5 ${
                tipo === 'FILTRO'
                  ? 'bg-blue-50 border-blue-300 text-blue-800'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <FilterIcon className="h-3.5 w-3.5" />
              Por filtro (dinámico)
            </button>
            <button
              type="button"
              onClick={() => setTipo('MANUAL')}
              className={`flex-1 px-3 py-2 rounded border text-xs font-medium flex items-center justify-center gap-1.5 ${
                tipo === 'MANUAL'
                  ? 'bg-violet-50 border-violet-300 text-violet-800'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              Lista manual (fija)
            </button>
          </div>

          {/* Selección de tipos de destinatarios — solo aplica al FILTRO */}
          {tipo === 'FILTRO' && (
            <div className="bg-blue-50/50 border border-blue-200 rounded p-3">
              <p className="text-2xs font-semibold text-slate-700 uppercase mb-2">Destinatarios</p>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={incluirPersonas}
                    onChange={e => setIncluirPersonas(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span className="text-xs text-slate-700 font-medium">Clientes / prospectos (personas)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={incluirLeads}
                    onChange={e => setIncluirLeads(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span className="text-xs text-slate-700 font-medium">Leads (no convertidos)</span>
                </label>
              </div>
              <p className="text-2xs text-slate-600 mt-2">
                Elegí a qué tipo de destinatarios querés apuntar. Podés combinar ambos en la misma audiencia
                (ej: clientes ACTIVOS + leads DESCARTADOS para una campaña de reactivación).
              </p>
            </div>
          )}

          {/* Sub-form de criterios para LEADS */}
          {tipo === 'FILTRO' && incluirLeads && (
            <div className="bg-amber-50/40 border border-amber-200 rounded p-3">
              <p className="text-2xs font-semibold text-slate-700 uppercase mb-2">Filtros de leads</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-2xs text-slate-600 mb-1">Estado del lead</label>
                  <div className="flex flex-wrap gap-1.5">
                    {ESTADOS_LEAD.map(est => (
                      <button
                        key={est}
                        type="button"
                        onClick={() => toggleEn(setLeadsEstado, leadsEstado, est)}
                        className={`text-2xs px-2 py-1 rounded border transition-colors ${
                          leadsEstado.includes(est)
                            ? 'bg-amber-100 text-amber-800 border-amber-300 font-medium'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {est}
                      </button>
                    ))}
                  </div>
                  <p className="text-2xs text-slate-600 mt-1">
                    Si no seleccionás ninguno, se incluyen todos los estados.
                  </p>
                </div>
                <div>
                  <label className="block text-2xs text-slate-600 mb-1">
                    Motivo de descarte contiene (opcional)
                  </label>
                  <input
                    type="text"
                    value={leadsMotivo}
                    onChange={e => setLeadsMotivo(e.target.value)}
                    placeholder="Ej: precio, tiempo, competencia"
                    className="form-input w-full text-sm"
                  />
                  <p className="text-2xs text-slate-600 mt-1">
                    Búsqueda parcial dentro del motivo de descarte. Deja vacío para no filtrar por motivo.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Contenido según tipo */}
          {tipo === 'FILTRO' ? (
            <FiltrosForm
              estadoPersona={estadoPersona} setEstadoPersona={setEstadoPersona}
              tipoPersona={tipoPersona} setTipoPersona={setTipoPersona}
              aceptaMarketing={aceptaMarketing} setAceptaMarketing={setAceptaMarketing}
              conEmail={conEmail} setConEmail={setConEmail}
              companias={companias} companiaIds={companiaIds} setCompaniaIds={setCompaniaIds}
              ramos={ramos} ramoIds={ramoIds} setRamoIds={setRamoIds}
              estadoPoliza={estadoPoliza} setEstadoPoliza={setEstadoPoliza}
              vencProx={vencProx} setVencProx={setVencProx}
              vencHace={vencHace} setVencHace={setVencHace}
              conVigentes={conVigentes} setConVigentes={setConVigentes}
              antMin={antMin} setAntMin={setAntMin}
              antMax={antMax} setAntMax={setAntMax}
              toggleEn={toggleEn}
            />
          ) : (
            <ManualSelector
              supabase={supabase}
              busqueda={busquedaManual}
              setBusqueda={setBusquedaManual}
              idsSeleccionados={idsManual}
              setIdsSeleccionados={setIdsManual}
            />
          )}

          {/* Preview */}
          <div className="bg-slate-50 border border-slate-200 rounded p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-2xs font-semibold text-slate-700 uppercase">Resultado del filtro</p>
              <button
                onClick={ejecutarPreview}
                disabled={previewCargando}
                className="text-2xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                {previewCargando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Actualizar
              </button>
            </div>
            {previewCargando && !preview ? (
              <div className="text-xs text-slate-500 italic">Calculando...</div>
            ) : preview ? (
              <>
                <div className="text-lg font-semibold text-slate-800 font-mono">
                  {preview.total} destinatario{preview.total === 1 ? '' : 's'}
                </div>
                {(preview.ids?.length > 0 || (preview.leads_ids && preview.leads_ids.length > 0)) && (
                  <div className="text-2xs text-slate-600 mt-0.5">
                    {preview.ids.length > 0 && <span>{preview.ids.length} persona{preview.ids.length === 1 ? '' : 's'}</span>}
                    {preview.ids.length > 0 && preview.leads_ids && preview.leads_ids.length > 0 && ' · '}
                    {preview.leads_ids && preview.leads_ids.length > 0 && (
                      <span>{preview.leads_ids.length} lead{preview.leads_ids.length === 1 ? '' : 's'}</span>
                    )}
                  </div>
                )}
                {preview.muestra.length > 0 && (
                  <div className="mt-2 text-2xs text-slate-600">
                    Muestra de los primeros {preview.muestra.length}:
                    <ul className="mt-1 space-y-0.5">
                      {preview.muestra.map(p => (
                        <li key={`${p.tipo ?? 'persona'}-${p.id}`} className="flex items-center gap-2">
                          {p.tipo === 'lead' && (
                            <span className="text-2xs px-1 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 font-medium">Lead</span>
                          )}
                          <span className="font-medium">
                            {[p.apellido, p.nombre].filter(Boolean).join(', ') || p.razon_social || '—'}
                          </span>
                          {p.email && <span className="text-slate-500">· {p.email}</span>}
                          {p.tipo !== 'lead' && !p.acepta_marketing && (
                            <span className="text-amber-700">· sin opt-in</span>
                          )}
                          {p.tipo === 'lead' && p.estado_lead && (
                            <span className="text-slate-600">· {p.estado_lead}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-slate-500 italic">Sin datos</div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 px-5 py-3 flex items-center justify-end gap-2 shrink-0">
          <button onClick={onCerrar} disabled={guardando} className="btn-secondary">
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando} className="btn-primary flex items-center gap-1.5">
            {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {esNueva ? 'Crear audiencia' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-componentes ─────────────────────────────────────────

function FiltrosForm(props: any) {
  const {
    estadoPersona, setEstadoPersona,
    tipoPersona, setTipoPersona,
    aceptaMarketing, setAceptaMarketing,
    conEmail, setConEmail,
    companias, companiaIds, setCompaniaIds,
    ramos, ramoIds, setRamoIds,
    estadoPoliza, setEstadoPoliza,
    vencProx, setVencProx,
    vencHace, setVencHace,
    conVigentes, setConVigentes,
    antMin, setAntMin,
    antMax, setAntMax,
    toggleEn,
  } = props

  return (
    <div className="space-y-4">
      {/* Filtros de persona */}
      <Seccion titulo="Persona">
        <Field label="Estado">
          <ChipMulti opciones={ESTADOS_PERSONA} seleccionados={estadoPersona} onToggle={v => toggleEn(setEstadoPersona, estadoPersona, v)} />
        </Field>
        <Field label="Tipo">
          <ChipMulti opciones={['FISICA', 'JURIDICA']} seleccionados={tipoPersona} onToggle={v => toggleEn(setTipoPersona, tipoPersona, v)} />
        </Field>
        <Field label="Acepta marketing">
          <TriToggle valor={aceptaMarketing} onChange={setAceptaMarketing} labels={['Sí', 'No', 'Cualquiera']} />
        </Field>
        <Field label="Solo personas con email">
          <input type="checkbox" checked={conEmail} onChange={e => setConEmail(e.target.checked)} className="h-3.5 w-3.5" />
        </Field>
      </Seccion>

      {/* Filtros de cartera */}
      <Seccion titulo="Cartera (pólizas)">
        <Field label="Compañías">
          {companias.length === 0 ? (
            <span className="text-2xs text-slate-500 italic">Sin catálogo</span>
          ) : (
            <ChipMulti
              opciones={companias.map((c: CatalogoItem) => c.id)}
              labels={Object.fromEntries(companias.map((c: CatalogoItem) => [c.id, c.nombre]))}
              seleccionados={companiaIds}
              onToggle={v => toggleEn(setCompaniaIds, companiaIds, v)}
            />
          )}
        </Field>
        <Field label="Ramos">
          {ramos.length === 0 ? (
            <span className="text-2xs text-slate-500 italic">Sin catálogo</span>
          ) : (
            <ChipMulti
              opciones={ramos.map((r: CatalogoItem) => r.id)}
              labels={Object.fromEntries(ramos.map((r: CatalogoItem) => [r.id, r.nombre]))}
              seleccionados={ramoIds}
              onToggle={v => toggleEn(setRamoIds, ramoIds, v)}
            />
          )}
        </Field>
        <Field label="Estado de pólizas">
          <ChipMulti opciones={ESTADOS_POLIZA} seleccionados={estadoPoliza} onToggle={v => toggleEn(setEstadoPoliza, estadoPoliza, v)} />
        </Field>
        <Field label="¿Tiene pólizas vigentes?">
          <TriToggle valor={conVigentes} onChange={setConVigentes} labels={['Sí, al menos 1', 'No tiene', 'Cualquiera']} />
        </Field>
      </Seccion>

      {/* Filtros de vencimiento */}
      <Seccion titulo="Vencimientos">
        <Field label="Pólizas vigentes que vencen en los próximos N días (incluye hoy)">
          <input
            type="number" min={0} max={365}
            value={vencProx}
            onChange={e => setVencProx(e.target.value)}
            placeholder="ej: 30"
            className="form-input w-24 text-sm"
          />
        </Field>
        <Field label="Pólizas vencidas hace N días (o menos)">
          <input
            type="number" min={0} max={365}
            value={vencHace}
            onChange={e => setVencHace(e.target.value)}
            placeholder="ej: 7"
            className="form-input w-24 text-sm"
          />
        </Field>
      </Seccion>

      {/* Antigüedad */}
      <Seccion titulo="Antigüedad como cliente">
        <Field label="Mínimo (días desde fecha_alta)">
          <input type="number" min={0} value={antMin} onChange={e => setAntMin(e.target.value)} className="form-input w-24 text-sm" />
        </Field>
        <Field label="Máximo (días desde fecha_alta)">
          <input type="number" min={0} value={antMax} onChange={e => setAntMax(e.target.value)} className="form-input w-24 text-sm" />
        </Field>
      </Seccion>
    </div>
  )
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded p-3">
      <p className="text-2xs font-semibold text-slate-700 uppercase mb-2">{titulo}</p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <label className="text-xs text-slate-600 w-64 shrink-0 pt-1">{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function ChipMulti({ opciones, seleccionados, onToggle, labels }: {
  opciones: string[]; seleccionados: string[]; onToggle: (v: string) => void; labels?: Record<string, string>
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {opciones.map(o => {
        const activo = seleccionados.includes(o)
        return (
          <button
            key={o}
            type="button"
            onClick={() => onToggle(o)}
            className={`text-2xs px-1.5 py-0.5 rounded border transition-colors ${
              activo
                ? 'bg-blue-50 border-blue-300 text-blue-800 font-medium'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {labels?.[o] ?? o}
          </button>
        )
      })}
    </div>
  )
}

function TriToggle({ valor, onChange, labels }: {
  valor: boolean | null; onChange: (v: boolean | null) => void; labels: [string, string, string]
}) {
  return (
    <div className="flex gap-1">
      {[
        { v: true, label: labels[0] },
        { v: false, label: labels[1] },
        { v: null, label: labels[2] },
      ].map(o => (
        <button
          key={String(o.v)}
          type="button"
          onClick={() => onChange(o.v)}
          className={`text-2xs px-2 py-0.5 rounded border ${
            valor === o.v
              ? 'bg-blue-50 border-blue-300 text-blue-800 font-medium'
              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ManualSelector({ supabase, busqueda, setBusqueda, idsSeleccionados, setIdsSeleccionados }: any) {
  const [resultados, setResultados] = useState<any[]>([])
  const [seleccionadas, setSeleccionadas] = useState<Map<string, any>>(new Map())
  const [cargando, setCargando] = useState(false)

  // Cargar info de personas ya seleccionadas (para mostrar lista).
  // Comparamos por la firma serializada del array; sin esto reaccionaríamos
  // a cada cambio de referencia aunque los IDs sean los mismos.
  const idsSeleccionadosKey = (idsSeleccionados as string[]).join(',')
  useEffect(() => {
    if (idsSeleccionados.length === 0) return
    (async () => {
      const { data } = await supabase
        .from('personas')
        .select('id, nombre, apellido, razon_social, email')
        .in('id', idsSeleccionados)
        .is('deleted_at', null)
      const map = new Map()
      ;((data ?? []) as any[]).forEach(p => map.set(p.id, p))
      setSeleccionadas(map)
    })()
    // idsSeleccionados se compara vía la key serializada arriba; agregarlo
    // directo re-ejecutaría en cada render (nueva referencia).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, idsSeleccionadosKey])

  // Buscar con debounce
  useEffect(() => {
    if (!busqueda || busqueda.length < 2) {
      setResultados([])
      return
    }
    const t = setTimeout(async () => {
      setCargando(true)
      const safeBusq = busqueda
        .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[%_,()]/g, ' ')
      const { data } = await supabase
        .from('personas')
        .select('id, nombre, apellido, razon_social, email')
        .is('deleted_at', null)
        .or(`apellido_norm.ilike.%${safeBusq}%,nombre_norm.ilike.%${safeBusq}%,razon_social_norm.ilike.%${safeBusq}%,dni_cuil.ilike.%${safeBusq}%`)
        .order('apellido')
        .limit(20)
      setResultados(((data ?? []) as any[]))
      setCargando(false)
    }, 350)
    return () => clearTimeout(t)
  }, [supabase, busqueda])

  function agregar(p: any) {
    if (idsSeleccionados.includes(p.id)) return
    setIdsSeleccionados([...idsSeleccionados, p.id])
    setSeleccionadas(prev => new Map(prev).set(p.id, p))
  }

  function quitar(id: string) {
    setIdsSeleccionados(idsSeleccionados.filter((x: string) => x !== id))
    setSeleccionadas(prev => {
      const map = new Map(prev)
      map.delete(id)
      return map
    })
  }

  return (
    <div className="space-y-3">
      {/* Buscador */}
      <div className="relative">
        <Search className="h-3.5 w-3.5 absolute left-2 top-2.5 text-slate-500" />
        <input
          type="text"
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, apellido, razón social o DNI..."
          className="form-input w-full pl-7 text-sm"
        />
      </div>

      {/* Resultados de búsqueda */}
      {cargando ? (
        <div className="text-xs text-slate-500 italic flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Buscando...
        </div>
      ) : resultados.length > 0 && (
        <div className="bg-white border border-slate-200 rounded max-h-40 overflow-y-auto">
          {resultados.map(p => {
            const ya = idsSeleccionados.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                disabled={ya}
                onClick={() => agregar(p)}
                className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 border-b border-slate-100 last:border-b-0 ${ya ? 'opacity-50' : ''}`}
              >
                <div className="font-medium">
                  {[p.apellido, p.nombre].filter(Boolean).join(', ') || p.razon_social || '—'}
                </div>
                <div className="text-2xs text-slate-600">{p.email ?? 'sin email'}</div>
              </button>
            )
          })}
        </div>
      )}

      {/* Lista seleccionados */}
      <div className="bg-violet-50/50 border border-violet-200 rounded p-3">
        <p className="text-2xs font-semibold text-violet-900 uppercase mb-2">
          Seleccionados ({idsSeleccionados.length})
        </p>
        {idsSeleccionados.length === 0 ? (
          <p className="text-2xs text-slate-600 italic">Sin personas seleccionadas. Usá el buscador.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {Array.from(seleccionadas.values()).map((p: any) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1 bg-white border border-violet-200 rounded px-1.5 py-0.5 text-2xs"
              >
                {[p.apellido, p.nombre].filter(Boolean).join(', ') || p.razon_social || '—'}
                <button
                  type="button"
                  onClick={() => quitar(p.id)}
                  className="text-violet-500 hover:text-violet-700"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
