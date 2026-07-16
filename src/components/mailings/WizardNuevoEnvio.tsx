'use client'

/**
 * Wizard "Nuevo envío" de 4 pasos.
 *
 * Reemplaza al SelectorDestinatariosModal + ModalEnviarEmail/Masivo cuando
 * el PAS quiere mandar un mailing activo desde el módulo Comunicaciones.
 *
 * Pasos:
 *   1. Destinatarios: individual / lista manual / audiencia guardada / filtro ad-hoc
 *   2. Mensaje: plantilla guardada / mensaje libre
 *   3. Configuración: asunto override + adjuntos (sin schedule todavía)
 *   4. Revisar y enviar: preview + checklist + confirmar
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  X, Loader2, ChevronLeft, ChevronRight, Send, CheckCircle2,
  User, Users, Filter as FilterIcon, FileText, Edit3, Paperclip,
  AlertTriangle, Search, Image as ImageIcon, Eye, RefreshCw,
} from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { getSupabaseClient } from '@/lib/supabase/client'
import type { MailingAudiencia } from './TabMailingAudiencias'
import type { MailingPlantilla } from './TabMailingPlantillas'
import SelectorImagenBiblioteca, { type ArchivoBiblioteca } from '@/components/biblioteca/SelectorImagenBiblioteca'

interface Props {
  abierto: boolean
  onClose: () => void
  onEnviado?: () => void
}

type StepKey = 'destinatarios' | 'mensaje' | 'config' | 'revisar'

interface PersonaItem {
  id: string
  nombre: string | null
  apellido: string
  razon_social: string | null
  email: string | null
  acepta_marketing: boolean
}

interface PreviewResult {
  total: number
  ids: string[]
  muestra: Array<{
    id: string; nombre: string | null; apellido: string;
    razon_social: string | null; email: string | null;
    acepta_marketing: boolean;
  }>
}

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'destinatarios', label: 'Destinatarios' },
  { key: 'mensaje', label: 'Mensaje' },
  { key: 'config', label: 'Configuración' },
  { key: 'revisar', label: 'Revisar y enviar' },
]

const MAX_ADJUNTOS = 5
const MAX_ADJUNTO_BYTES = 10 * 1024 * 1024

export default function WizardNuevoEnvio({ abierto, onClose, onEnviado }: Props) {
  const supabase = getSupabaseClient()
  const [step, setStep] = useState<StepKey>('destinatarios')

  // ── Paso 1: Destinatarios ─────────────────────────────────
  const [dTipo, setDTipo] = useState<'individual' | 'lista' | 'audiencia' | 'filtro'>('lista')
  const [dPersonaIndividual, setDPersonaIndividual] = useState<PersonaItem | null>(null)
  const [dPersonasLista, setDPersonasLista] = useState<PersonaItem[]>([])
  const [dAudienciaId, setDAudienciaId] = useState<string | null>(null)
  const [dFiltroJsonb, setDFiltroJsonb] = useState<any>({ estado_persona: ['ACTIVO'], con_email: true })

  // ── Paso 2: Mensaje ───────────────────────────────────────
  const [mTipo, setMTipo] = useState<'mailing_plantilla' | 'libre'>('mailing_plantilla')
  const [mPlantillaId, setMPlantillaId] = useState<string | null>(null)
  const [mAsuntoLibre, setMAsuntoLibre] = useState('')
  const [mCuerpoLibre, setMCuerpoLibre] = useState('')

  // ── Paso 3: Config ────────────────────────────────────────
  const [cAsuntoOverride, setCAsuntoOverride] = useState('')
  const [cAdjuntos, setCAdjuntos] = useState<File[]>([])

  // ── Paso 4: Revisar ───────────────────────────────────────
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewCargando, setPreviewCargando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<any | null>(null)

  // Catálogos
  const [plantillas, setPlantillas] = useState<MailingPlantilla[]>([])
  const [audiencias, setAudiencias] = useState<MailingAudiencia[]>([])

  // Reset al abrir/cerrar
  useEffect(() => {
    if (abierto) {
      setStep('destinatarios')
      setResultado(null)
      // Cargar catálogos
      apiCall<{ plantillas: MailingPlantilla[] }>('/api/comunicaciones/mailing-plantillas', {}, { mostrar_toast_en_error: false })
        .then(r => { if (r.ok && r.data) setPlantillas(r.data.plantillas) })
      apiCall<{ audiencias: MailingAudiencia[] }>('/api/comunicaciones/audiencias', {}, { mostrar_toast_en_error: false })
        .then(r => { if (r.ok && r.data) setAudiencias(r.data.audiencias) })
    }
  }, [abierto])

  // Calcular preview de destinatarios cuando llegamos al paso revisar
  const calcularPreview = useCallback(async () => {
    setPreviewCargando(true)
    let body: any
    if (dTipo === 'individual') {
      body = { tipo: 'MANUAL', ids_personas: dPersonaIndividual ? [dPersonaIndividual.id] : [] }
    } else if (dTipo === 'lista') {
      body = { tipo: 'MANUAL', ids_personas: dPersonasLista.map(p => p.id) }
    } else if (dTipo === 'audiencia') {
      const aud = audiencias.find(a => a.id === dAudienciaId)
      if (!aud) {
        setPreview(null); setPreviewCargando(false); return
      }
      body = aud.tipo === 'MANUAL'
        ? { tipo: 'MANUAL', ids_personas: aud.ids_personas }
        : { tipo: 'FILTRO', filtro_jsonb: aud.filtro_jsonb }
    } else {
      body = { tipo: 'FILTRO', filtro_jsonb: dFiltroJsonb }
    }
    const r = await apiCall<PreviewResult>(
      '/api/comunicaciones/audiencias/preview-adhoc',
      { method: 'POST', body },
      { mostrar_toast_en_error: false },
    )
    setPreviewCargando(false)
    if (r.ok && r.data) setPreview(r.data)
  }, [dTipo, dPersonaIndividual, dPersonasLista, dAudienciaId, dFiltroJsonb, audiencias])

  useEffect(() => {
    if (step === 'revisar') calcularPreview()
  }, [step, calcularPreview])

  // Validación por paso
  function puedeAvanzar(): boolean {
    if (step === 'destinatarios') {
      if (dTipo === 'individual') return !!dPersonaIndividual
      if (dTipo === 'lista') return dPersonasLista.length > 0
      if (dTipo === 'audiencia') return !!dAudienciaId
      if (dTipo === 'filtro') return !!dFiltroJsonb
      return false
    }
    if (step === 'mensaje') {
      if (mTipo === 'mailing_plantilla') return !!mPlantillaId
      if (mTipo === 'libre') return mAsuntoLibre.trim().length > 0 && mCuerpoLibre.trim().length > 0
      return false
    }
    if (step === 'config') {
      // El asunto override puede estar vacío (usa el de la plantilla)
      return true
    }
    return true
  }

  function avanzar() {
    const idx = STEPS.findIndex(s => s.key === step)
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].key)
  }
  function retroceder() {
    const idx = STEPS.findIndex(s => s.key === step)
    if (idx > 0) setStep(STEPS[idx - 1].key)
  }

  // Enviar
  async function enviar() {
    setEnviando(true)
    const fd = new FormData()
    fd.set('destinatarios_tipo', dTipo)
    if (dTipo === 'individual') fd.set('persona_ids', JSON.stringify(dPersonaIndividual ? [dPersonaIndividual.id] : []))
    else if (dTipo === 'lista') fd.set('persona_ids', JSON.stringify(dPersonasLista.map(p => p.id)))
    else if (dTipo === 'audiencia') fd.set('audiencia_id', dAudienciaId!)
    else if (dTipo === 'filtro') fd.set('filtro_jsonb', JSON.stringify(dFiltroJsonb))

    fd.set('mensaje_tipo', mTipo)
    if (mTipo === 'mailing_plantilla') {
      fd.set('mailing_plantilla_id', mPlantillaId!)
      if (cAsuntoOverride.trim()) fd.set('asunto', cAsuntoOverride.trim())
    } else {
      fd.set('asunto', mAsuntoLibre.trim())
      fd.set('cuerpo', mCuerpoLibre.trim())
    }

    for (const archivo of cAdjuntos) {
      fd.append('archivos', archivo)
    }

    const r = await fetch('/api/comunicaciones/wizard-enviar', { method: 'POST', body: fd })
    let json: any
    try { json = await r.json() } catch { json = { ok: false, error: 'Respuesta inválida' } }
    setEnviando(false)
    if (!r.ok || !json.ok) {
      toast.error(json.error ?? 'Error al enviar')
      return
    }
    setResultado(json)
    if (onEnviado) onEnviado()
  }

  if (!abierto) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <Send className="h-4 w-4 text-blue-600" />
            Nuevo envío
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Resultado final (después de enviar) */}
        {resultado ? (
          <div className="flex-1 overflow-y-auto p-6">
            <ResultadoEnvio resultado={resultado} onCerrar={onClose} />
          </div>
        ) : (
          <>
            {/* Stepper */}
            <div className="border-b border-slate-200 px-5 py-3">
              <ol className="flex items-center gap-2">
                {STEPS.map((s, idx) => {
                  const actual = s.key === step
                  const pasado = STEPS.findIndex(x => x.key === step) > idx
                  return (
                    <li key={s.key} className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-2xs font-semibold ${
                        pasado ? 'bg-emerald-500 text-white' :
                        actual ? 'bg-blue-600 text-white' :
                        'bg-slate-200 text-slate-500'
                      }`}>
                        {pasado ? <CheckCircle2 className="h-3.5 w-3.5" /> : idx + 1}
                      </div>
                      <span className={`text-xs ${actual ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>
                        {s.label}
                      </span>
                      {idx < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-slate-300 mx-1" />}
                    </li>
                  )
                })}
              </ol>
            </div>

            {/* Body */}
            <div className="overflow-y-auto px-5 py-4 flex-1">
              {step === 'destinatarios' && (
                <PasoDestinatarios
                  supabase={supabase}
                  tipo={dTipo} setTipo={setDTipo}
                  personaIndividual={dPersonaIndividual} setPersonaIndividual={setDPersonaIndividual}
                  personasLista={dPersonasLista} setPersonasLista={setDPersonasLista}
                  audiencias={audiencias}
                  audienciaId={dAudienciaId} setAudienciaId={setDAudienciaId}
                  filtroJsonb={dFiltroJsonb} setFiltroJsonb={setDFiltroJsonb}
                />
              )}
              {step === 'mensaje' && (
                <PasoMensaje
                  tipo={mTipo} setTipo={setMTipo}
                  plantillas={plantillas}
                  plantillaId={mPlantillaId} setPlantillaId={setMPlantillaId}
                  asuntoLibre={mAsuntoLibre} setAsuntoLibre={setMAsuntoLibre}
                  cuerpoLibre={mCuerpoLibre} setCuerpoLibre={setMCuerpoLibre}
                />
              )}
              {step === 'config' && (
                <PasoConfig
                  mensajeTipo={mTipo}
                  plantillas={plantillas}
                  plantillaId={mPlantillaId}
                  asuntoOverride={cAsuntoOverride} setAsuntoOverride={setCAsuntoOverride}
                  adjuntos={cAdjuntos} setAdjuntos={setCAdjuntos}
                />
              )}
              {step === 'revisar' && (
                <PasoRevisar
                  preview={preview}
                  previewCargando={previewCargando}
                  mensajeTipo={mTipo}
                  plantilla={plantillas.find(p => p.id === mPlantillaId) ?? null}
                  asuntoFinal={cAsuntoOverride.trim() || (mTipo === 'libre' ? mAsuntoLibre : plantillas.find(p => p.id === mPlantillaId)?.asunto ?? '')}
                  adjuntos={cAdjuntos}
                  mailingPlantillaId={mPlantillaId}
                  asuntoOverride={cAsuntoOverride}
                  cuerpoLibre={mCuerpoLibre}
                />
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-slate-200 px-5 py-3 flex items-center justify-between shrink-0">
              <button
                onClick={retroceder}
                disabled={step === 'destinatarios' || enviando}
                className="btn-secondary flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Atrás
              </button>
              {step !== 'revisar' ? (
                <button
                  onClick={avanzar}
                  disabled={!puedeAvanzar()}
                  className="btn-primary flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Siguiente <ChevronRight className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  onClick={enviar}
                  disabled={enviando || !preview || preview.total === 0}
                  className="btn-primary flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Confirmar y enviar
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Sub-pasos ──────────────────────────────────────────────

function PasoDestinatarios(props: any) {
  const { tipo, setTipo, audiencias } = props
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-600">¿A quién querés enviar?</p>

      {/* 4 opciones */}
      <div className="grid grid-cols-2 gap-2">
        <OpcionCard
          activo={tipo === 'individual'}
          onClick={() => setTipo('individual')}
          icon={User}
          titulo="Un cliente individual"
          descripcion="Buscá y elegí una persona."
        />
        <OpcionCard
          activo={tipo === 'lista'}
          onClick={() => setTipo('lista')}
          icon={Users}
          titulo="Varios clientes (lista manual)"
          descripcion="Seleccionalos uno por uno con buscador."
        />
        <OpcionCard
          activo={tipo === 'audiencia'}
          onClick={() => setTipo('audiencia')}
          icon={Users}
          titulo="Audiencia guardada"
          descripcion={`${audiencias.length} guardadas — segmentos reutilizables.`}
          disabled={audiencias.length === 0}
        />
        <OpcionCard
          activo={tipo === 'filtro'}
          onClick={() => setTipo('filtro')}
          icon={FilterIcon}
          titulo="Filtro ad-hoc"
          descripcion="Segmentá ahora por criterios sin guardar."
        />
      </div>

      {/* Sub-contenido según tipo */}
      <div className="mt-3">
        {tipo === 'individual' && <SelectorPersonaIndividual {...props} />}
        {tipo === 'lista' && <SelectorPersonasMultiples {...props} />}
        {tipo === 'audiencia' && <SelectorAudienciaGuardada {...props} />}
        {tipo === 'filtro' && <SelectorFiltroAdHoc {...props} />}
      </div>
    </div>
  )
}

function PasoMensaje(props: any) {
  const { tipo, setTipo, plantillas, plantillaId, setPlantillaId, asuntoLibre, setAsuntoLibre, cuerpoLibre, setCuerpoLibre } = props
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-600">¿Qué mensaje vas a enviar?</p>
      <div className="grid grid-cols-2 gap-2">
        <OpcionCard
          activo={tipo === 'mailing_plantilla'}
          onClick={() => setTipo('mailing_plantilla')}
          icon={FileText}
          titulo="Plantilla guardada"
          descripcion={`${plantillas.length} disponibles — reutilizables.`}
          disabled={plantillas.length === 0}
        />
        <OpcionCard
          activo={tipo === 'libre'}
          onClick={() => setTipo('libre')}
          icon={Edit3}
          titulo="Mensaje libre"
          descripcion="Escribilo desde cero, ad-hoc."
        />
      </div>

      {tipo === 'mailing_plantilla' && (
        <div className="space-y-2">
          <label className="block text-xs text-slate-600">Elegí la plantilla:</label>
          {plantillas.length === 0 ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              No tenés plantillas guardadas. Andá al tab "Plantillas" para crear una.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {plantillas.map((p: MailingPlantilla) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlantillaId(p.id)}
                  className={`w-full text-left border rounded p-2 transition-colors ${
                    plantillaId === p.id
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-800">{p.nombre}</div>
                      <div className="text-2xs text-slate-500 truncate">Asunto: {p.asunto}</div>
                      {p.descripcion && (
                        <div className="text-2xs text-slate-400 mt-0.5 truncate">{p.descripcion}</div>
                      )}
                    </div>
                    {plantillaId === p.id && <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tipo === 'libre' && (
        <div className="space-y-2">
          <div>
            <label className="block text-2xs font-medium text-slate-600 mb-1">Asunto del email *</label>
            <input
              type="text"
              value={asuntoLibre}
              onChange={e => setAsuntoLibre(e.target.value)}
              placeholder="Promoción especial"
              className="form-input w-full text-sm"
              maxLength={300}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-2xs font-medium text-slate-600">
                Cuerpo *
                <span className="text-2xs text-slate-400 font-normal ml-2">
                  Variables: <code>{`{{nombre}} {{apellido}} {{organizacion_nombre}}`}</code>
                </span>
              </label>
              <BotonInsertarImagenBiblioteca cuerpo={cuerpoLibre} setCuerpo={setCuerpoLibre} />
            </div>
            <textarea
              value={cuerpoLibre}
              onChange={e => setCuerpoLibre(e.target.value)}
              placeholder="Hola {{nombre}}!&#10;&#10;Queremos contarte que..."
              className="form-input w-full text-sm font-mono"
              rows={10}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function PasoConfig({ mensajeTipo, plantillas, plantillaId, asuntoOverride, setAsuntoOverride, adjuntos, setAdjuntos }: any) {
  const plantilla = plantillas.find((p: MailingPlantilla) => p.id === plantillaId)
  const inputRef = useRef<HTMLInputElement>(null)

  function agregarArchivos(files: FileList | null) {
    if (!files) return
    const nuevos: File[] = []
    for (const f of Array.from(files)) {
      if (adjuntos.length + nuevos.length >= MAX_ADJUNTOS) {
        toast.error(`Máximo ${MAX_ADJUNTOS} adjuntos por envío`)
        break
      }
      if (f.size > MAX_ADJUNTO_BYTES) {
        toast.error(`"${f.name}" supera los 10 MB`)
        continue
      }
      nuevos.push(f)
    }
    setAdjuntos([...adjuntos, ...nuevos])
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="space-y-4">
      {mensajeTipo === 'mailing_plantilla' && plantilla && (
        <div>
          <label className="block text-2xs font-medium text-slate-600 mb-1">
            Asunto del email (opcional, si querés cambiarlo solo para este envío)
          </label>
          <input
            type="text"
            value={asuntoOverride}
            onChange={e => setAsuntoOverride(e.target.value)}
            placeholder={plantilla.asunto}
            className="form-input w-full text-sm"
            maxLength={300}
          />
          <p className="text-2xs text-slate-500 mt-1">
            Si lo dejás vacío, se usa el asunto de la plantilla: <code className="text-2xs">{plantilla.asunto}</code>
          </p>
        </div>
      )}

      <div>
        <label className="block text-2xs font-medium text-slate-600 mb-1">
          Adjuntos (opcional, máx {MAX_ADJUNTOS} archivos de 10 MB cada uno)
        </label>
        <input
          ref={inputRef}
          type="file"
          multiple
          onChange={e => agregarArchivos(e.target.files)}
          className="text-xs"
        />
        {adjuntos.length > 0 && (
          <ul className="mt-2 space-y-1">
            {adjuntos.map((f: File, i: number) => (
              <li key={i} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs">
                <span className="flex items-center gap-1.5 truncate">
                  <Paperclip className="h-3 w-3 text-slate-500" />
                  <span className="truncate">{f.name}</span>
                  <span className="text-2xs text-slate-400 ml-1">({(f.size / 1024).toFixed(0)} KB)</span>
                </span>
                <button
                  onClick={() => setAdjuntos(adjuntos.filter((_: any, j: number) => j !== i))}
                  className="text-slate-400 hover:text-red-600"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded p-3 text-2xs text-slate-600">
        <strong>Próximamente:</strong> programación para fecha/hora futura (Sprint 2).
        Por ahora todos los envíos se procesan inmediatamente.
      </div>
    </div>
  )
}

function PasoRevisar({ preview, previewCargando, mensajeTipo, plantilla, asuntoFinal, adjuntos, mailingPlantillaId, asuntoOverride, cuerpoLibre }: any) {
  const [emailPreviewHtml, setEmailPreviewHtml] = useState<string | null>(null)
  const [emailPreviewCargando, setEmailPreviewCargando] = useState(false)
  const [emailPreviewError, setEmailPreviewError] = useState<string | null>(null)

  const cargarEmailPreview = useCallback(async () => {
    setEmailPreviewCargando(true)
    setEmailPreviewError(null)
    const body: any = {
      mensaje_tipo: mensajeTipo,
    }
    if (mensajeTipo === 'mailing_plantilla') {
      body.mailing_plantilla_id = mailingPlantillaId
      body.asunto = asuntoOverride || undefined
    } else {
      body.asunto = asuntoFinal
      body.cuerpo = cuerpoLibre
    }
    const r = await apiCall<{ html: string; asunto: string }>(
      '/api/comunicaciones/wizard-enviar/preview',
      { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
      { mostrar_toast_en_error: false },
    )
    if (r.ok && r.data) {
      setEmailPreviewHtml(r.data.html)
    } else {
      setEmailPreviewError(r.error?.mensaje ?? 'No se pudo generar el preview')
    }
    setEmailPreviewCargando(false)
  }, [mensajeTipo, mailingPlantillaId, asuntoOverride, asuntoFinal, cuerpoLibre])

  // Auto-cargar el preview al entrar al paso
  useEffect(() => {
    cargarEmailPreview()
  }, [cargarEmailPreview])

  if (previewCargando || !preview) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400 text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Calculando destinatarios...
      </div>
    )
  }

  const validos = preview.muestra.filter((p: any) => p.email && p.acepta_marketing !== false).length
  const sinEmail = preview.muestra.filter((p: any) => !p.email).length
  const noMarketing = preview.muestra.filter((p: any) => p.email && p.acepta_marketing === false).length

  // Proporciones extrapoladas (la muestra es de 10)
  const totalMuestra = preview.muestra.length || 1
  const totalValidos = Math.round((validos / totalMuestra) * preview.total)
  const totalSinEmail = Math.round((sinEmail / totalMuestra) * preview.total)
  const totalNoMarketing = Math.round((noMarketing / totalMuestra) * preview.total)

  return (
    <div className="space-y-4">
      {/* Resumen destinatarios */}
      <div className="bg-blue-50 border border-blue-200 rounded p-3">
        <p className="text-xs font-semibold text-blue-900 mb-2">Destinatarios</p>
        <div className="grid grid-cols-4 gap-2">
          <Stat label="Total alcanzados" valor={preview.total} color="blue" />
          <Stat label="Recibirán email" valor={totalValidos} color="emerald" />
          <Stat label="Sin email" valor={totalSinEmail} color="amber" />
          <Stat label="Sin marketing" valor={totalNoMarketing} color="slate" />
        </div>
        <p className="text-2xs text-blue-700 mt-2">
          Estimaciones basadas en muestra de {preview.muestra.length}. Los valores finales pueden diferir levemente.
        </p>
      </div>

      {/* Resumen mensaje */}
      <div className="bg-slate-50 border border-slate-200 rounded p-3">
        <p className="text-xs font-semibold text-slate-700 mb-2">Mensaje</p>
        <dl className="text-xs space-y-1">
          <div className="flex gap-2">
            <dt className="text-slate-500 w-24 shrink-0">Tipo:</dt>
            <dd className="text-slate-800">
              {mensajeTipo === 'mailing_plantilla' ? `Plantilla guardada — ${plantilla?.nombre}` : 'Mensaje libre'}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500 w-24 shrink-0">Asunto:</dt>
            <dd className="text-slate-800 font-medium truncate">{asuntoFinal}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500 w-24 shrink-0">Adjuntos:</dt>
            <dd className="text-slate-800">{adjuntos.length === 0 ? 'Sin adjuntos' : `${adjuntos.length} archivo(s)`}</dd>
          </div>
        </dl>
      </div>

      {/* Preview HTML del email */}
      <div className="border border-slate-200 rounded overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-slate-500" />
            <span className="text-xs font-semibold text-slate-700">Vista previa del email</span>
          </div>
          <button
            type="button"
            onClick={cargarEmailPreview}
            disabled={emailPreviewCargando}
            className="text-2xs px-2 py-1 border border-slate-300 rounded hover:bg-white text-slate-600 flex items-center gap-1 disabled:opacity-50"
          >
            {emailPreviewCargando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Actualizar
          </button>
        </div>
        <div className="bg-white">
          {emailPreviewCargando ? (
            <div className="py-10 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Generando preview...
            </div>
          ) : emailPreviewError ? (
            <div className="py-6 text-center text-xs text-red-600 bg-red-50">
              {emailPreviewError}
            </div>
          ) : emailPreviewHtml ? (
            <iframe
              srcDoc={emailPreviewHtml}
              title="Preview del email"
              className="w-full border-0 bg-white"
              style={{ height: '500px' }}
              sandbox="allow-same-origin allow-popups"
            />
          ) : (
            <div className="py-6 text-center text-xs text-slate-400">
              Sin preview disponible
            </div>
          )}
        </div>
        <p className="text-2xs text-slate-400 bg-slate-50 border-t border-slate-100 px-3 py-1.5">
          Datos de ejemplo: nombre &quot;Juan Pérez&quot;. Al enviar, se reemplazan por los datos reales de cada destinatario.
        </p>
      </div>

      {/* Advertencia */}
      {preview.total > 100 && (
        <div className="bg-amber-50 border border-amber-200 rounded p-2 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-900">
            Vas a enviar a <strong>{preview.total} personas</strong>. El envío puede tardar varios minutos
            (con delay anti-spam entre cada email). No cierres esta ventana mientras procesa.
          </p>
        </div>
      )}
    </div>
  )
}

function ResultadoEnvio({ resultado, onCerrar }: { resultado: any; onCerrar: () => void }) {
  return (
    <div className="text-center py-6">
      <div className="bg-emerald-100 rounded-full w-14 h-14 flex items-center justify-center mx-auto mb-3">
        <CheckCircle2 className="h-7 w-7 text-emerald-700" />
      </div>
      <h3 className="text-base font-semibold text-slate-800">Envío completado</h3>
      <p className="text-xs text-slate-500 mt-1">
        Tu mailing se procesó correctamente.
      </p>

      <div className="grid grid-cols-4 gap-2 mt-5 max-w-md mx-auto">
        <Stat label="Total" valor={resultado.total} color="slate" />
        <Stat label="Enviados" valor={resultado.enviados} color="emerald" />
        <Stat label="Excluidos" valor={resultado.excluidos} color="amber" />
        <Stat label="Fallidos" valor={resultado.fallidos} color={resultado.fallidos > 0 ? 'red' : 'slate'} />
      </div>

      <button onClick={onCerrar} className="btn-primary mt-6">Cerrar</button>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────

function OpcionCard({ activo, onClick, icon: Icon, titulo, descripcion, disabled }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-left border rounded p-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        activo ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start gap-2">
        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${activo ? 'text-blue-600' : 'text-slate-400'}`} />
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-medium ${activo ? 'text-blue-900' : 'text-slate-700'}`}>{titulo}</div>
          <div className="text-2xs text-slate-500 mt-0.5">{descripcion}</div>
        </div>
        {activo && <CheckCircle2 className="h-3.5 w-3.5 text-blue-600 shrink-0" />}
      </div>
    </button>
  )
}

function Stat({ label, valor, color }: { label: string; valor: number; color: 'blue' | 'emerald' | 'amber' | 'red' | 'slate' }) {
  const bg = {
    blue: 'bg-blue-100 text-blue-800',
    emerald: 'bg-emerald-100 text-emerald-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
    slate: 'bg-slate-100 text-slate-700',
  }[color]
  return (
    <div className="text-center">
      <div className={`text-lg font-bold font-mono rounded py-1 ${bg}`}>{valor}</div>
      <div className="text-2xs text-slate-500 mt-1">{label}</div>
    </div>
  )
}

// ─── Selectores de destinatarios ────────────────────────────

function SelectorPersonaIndividual({ supabase, personaIndividual, setPersonaIndividual }: any) {
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<PersonaItem[]>([])
  const [cargando, setCargando] = useState(false)

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
        .select('id, nombre, apellido, razon_social, email, acepta_marketing')
        .is('deleted_at', null)
        .or(`apellido_norm.ilike.%${safeBusq}%,nombre_norm.ilike.%${safeBusq}%,razon_social_norm.ilike.%${safeBusq}%,dni_cuil.ilike.%${safeBusq}%`)
        .order('apellido')
        .limit(15)
      setResultados(((data ?? []) as any[]))
      setCargando(false)
    }, 350)
    return () => clearTimeout(t)
  }, [supabase, busqueda])

  return (
    <div className="space-y-2 bg-slate-50 border border-slate-200 rounded p-3">
      <div className="relative">
        <Search className="h-3.5 w-3.5 absolute left-2 top-2.5 text-slate-400" />
        <input
          type="text"
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar persona (nombre, apellido, DNI)..."
          className="form-input w-full pl-7 text-sm"
        />
      </div>
      {cargando ? (
        <div className="text-xs text-slate-400 italic flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Buscando...
        </div>
      ) : resultados.length > 0 && (
        <div className="bg-white border border-slate-200 rounded max-h-40 overflow-y-auto">
          {resultados.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPersonaIndividual(p)}
              className="block w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
            >
              <div className="font-medium">
                {[p.apellido, p.nombre].filter(Boolean).join(', ') || p.razon_social || '—'}
              </div>
              <div className="text-2xs text-slate-500">{p.email ?? 'sin email'}</div>
            </button>
          ))}
        </div>
      )}
      {personaIndividual && (
        <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs">
          <strong>Seleccionado:</strong> {[personaIndividual.apellido, personaIndividual.nombre].filter(Boolean).join(', ') || personaIndividual.razon_social}
          <span className="text-2xs text-slate-500 ml-2">{personaIndividual.email ?? 'sin email'}</span>
        </div>
      )}
    </div>
  )
}

function SelectorPersonasMultiples({ supabase, personasLista, setPersonasLista }: any) {
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<PersonaItem[]>([])
  const [cargando, setCargando] = useState(false)

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
        .select('id, nombre, apellido, razon_social, email, acepta_marketing')
        .is('deleted_at', null)
        .or(`apellido_norm.ilike.%${safeBusq}%,nombre_norm.ilike.%${safeBusq}%,razon_social_norm.ilike.%${safeBusq}%`)
        .order('apellido')
        .limit(20)
      setResultados(((data ?? []) as any[]))
      setCargando(false)
    }, 350)
    return () => clearTimeout(t)
  }, [supabase, busqueda])

  return (
    <div className="space-y-2 bg-slate-50 border border-slate-200 rounded p-3">
      <div className="relative">
        <Search className="h-3.5 w-3.5 absolute left-2 top-2.5 text-slate-400" />
        <input
          type="text"
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar y agregar personas..."
          className="form-input w-full pl-7 text-sm"
        />
      </div>
      {cargando ? (
        <div className="text-xs text-slate-400 italic flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Buscando...
        </div>
      ) : resultados.length > 0 && (
        <div className="bg-white border border-slate-200 rounded max-h-32 overflow-y-auto">
          {resultados.map(p => {
            const ya = personasLista.some((x: PersonaItem) => x.id === p.id)
            return (
              <button
                key={p.id}
                type="button"
                disabled={ya}
                onClick={() => setPersonasLista([...personasLista, p])}
                className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 border-b border-slate-100 last:border-b-0 ${ya ? 'opacity-50' : ''}`}
              >
                <div className="font-medium">
                  {[p.apellido, p.nombre].filter(Boolean).join(', ') || p.razon_social || '—'}
                </div>
                <div className="text-2xs text-slate-500">{p.email ?? 'sin email'}</div>
              </button>
            )
          })}
        </div>
      )}
      <div className="bg-violet-50 border border-violet-200 rounded p-2">
        <p className="text-2xs font-semibold text-violet-900 uppercase mb-1">
          Seleccionados ({personasLista.length})
        </p>
        {personasLista.length === 0 ? (
          <p className="text-2xs text-slate-500 italic">Buscá personas para agregarlas.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {personasLista.map((p: PersonaItem) => (
              <span key={p.id} className="inline-flex items-center gap-1 bg-white border border-violet-200 rounded px-1.5 py-0.5 text-2xs">
                {[p.apellido, p.nombre].filter(Boolean).join(', ') || p.razon_social}
                <button
                  type="button"
                  onClick={() => setPersonasLista(personasLista.filter((x: PersonaItem) => x.id !== p.id))}
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

function SelectorAudienciaGuardada({ audiencias, audienciaId, setAudienciaId }: any) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded p-3">
      {audiencias.length === 0 ? (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          No tenés audiencias guardadas. Andá al tab "Audiencias" para crear una.
        </p>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {audiencias.map((a: MailingAudiencia) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAudienciaId(a.id)}
              className={`w-full text-left border rounded p-2 transition-colors ${
                audienciaId === a.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800">{a.nombre}</div>
                  <div className="text-2xs text-slate-500">
                    {a.tipo === 'FILTRO' ? 'Filtro dinámico' : 'Lista manual'}
                    {a.ultima_cantidad != null && ` · ${a.ultima_cantidad} personas (cacheado)`}
                  </div>
                </div>
                {audienciaId === a.id && <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SelectorFiltroAdHoc({ filtroJsonb, setFiltroJsonb }: any) {
  // Para el MVP del wizard usamos un filtro simplificado: solo los más usados.
  // El admin que quiera filtros complejos puede crear una audiencia guardada.
  return (
    <div className="bg-slate-50 border border-slate-200 rounded p-3 space-y-3">
      <p className="text-2xs text-slate-600">
        Para filtros más completos, creá una audiencia guardada en el tab "Audiencias".
        Acá podés usar los criterios más comunes:
      </p>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filtroJsonb.con_email ?? true}
            onChange={e => setFiltroJsonb({ ...filtroJsonb, con_email: e.target.checked })}
            className="h-3.5 w-3.5"
          />
          <label className="text-xs text-slate-700">Solo personas con email</label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filtroJsonb.acepta_marketing === true}
            onChange={e => setFiltroJsonb({ ...filtroJsonb, acepta_marketing: e.target.checked ? true : null })}
            className="h-3.5 w-3.5"
          />
          <label className="text-xs text-slate-700">Solo personas con marketing habilitado</label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={filtroJsonb.con_polizas_vigentes === true}
            onChange={e => setFiltroJsonb({ ...filtroJsonb, con_polizas_vigentes: e.target.checked ? true : null })}
            className="h-3.5 w-3.5"
          />
          <label className="text-xs text-slate-700">Solo personas con pólizas vigentes</label>
        </div>
        <div>
          <label className="text-xs text-slate-700">Estado de persona:</label>
          <div className="flex gap-1 mt-1">
            {['PROSPECTO', 'ACTIVO', 'INACTIVO'].map(s => {
              const sel = (filtroJsonb.estado_persona ?? []) as string[]
              const activo = sel.includes(s)
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    const nuevo = activo ? sel.filter(x => x !== s) : [...sel, s]
                    setFiltroJsonb({ ...filtroJsonb, estado_persona: nuevo })
                  }}
                  className={`text-2xs px-2 py-0.5 rounded border ${
                    activo
                      ? 'bg-blue-50 border-blue-300 text-blue-800 font-medium'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {s}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Botón helper que abre el selector de biblioteca e inserta [[IMG:uuid]]
 * al final del cuerpo del mensaje. Uso independiente al textarea (no toma
 * cursor position — inserta al final por simplicidad en el wizard).
 */
function BotonInsertarImagenBiblioteca({ cuerpo, setCuerpo }: { cuerpo: string; setCuerpo: (v: string) => void }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="text-2xs px-2 py-0.5 border border-slate-300 rounded hover:bg-slate-50 flex items-center gap-1 text-slate-700"
      >
        <ImageIcon className="h-3 w-3" /> Insertar imagen
      </button>
      <SelectorImagenBiblioteca
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        onElegir={(a: ArchivoBiblioteca) => {
          const marcador = `[[IMG:${a.id}]]`
          const sep = cuerpo.trim().length > 0 ? '\n\n' : ''
          setCuerpo(cuerpo + sep + marcador)
          setAbierto(false)
        }}
        titulo="Insertar imagen en el cuerpo"
      />
    </>
  )
}
