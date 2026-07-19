'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  CheckCircle2, Sparkles, Loader2, ArrowRight, RefreshCw, Home,
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import type { EstadoPDFPoll } from '@/lib/hooks/useAgentePDFPolling'
import { apiCall } from '@/lib/api-client'

interface ResumenPoliza {
  id: string
  numero_poliza: string
  estado: string
  fecha_inicio: string
  fecha_fin: string
  asegurado_nombre: string
  compania_nombre: string | null
  riesgo_descripcion: string | null
}

interface ResumenEndoso {
  id: string
  numero_endoso: number
  poliza_id: string
  poliza_numero: string
  motivo: string
}

export default function ExitoPDFPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const supabase = getSupabaseClient()

  const [cargando, setCargando] = useState(true)
  const [procesamiento, setProcesamiento] = useState<EstadoPDFPoll | null>(null)
  const [resumenPoliza, setResumenPoliza] = useState<ResumenPoliza | null>(null)
  const [resumenEndoso, setResumenEndoso] = useState<ResumenEndoso | null>(null)
  const [polizaOrigenInfo, setPolizaOrigenInfo] = useState<{ numero: string; fecha_fin: string } | null>(null)
  const [accionEjecutada, setAccionEjecutada] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      setCargando(true)
      try {
        const r = await apiCall<{ procesamiento: EstadoPDFPoll }>(`/api/agente-pdf/${id}/estado`, {}, { mostrar_toast_en_error: false })
        if (!r.ok || !r.data) { setCargando(false); return }
        const proc = r.data.procesamiento
        setProcesamiento(proc)
        const meta = (proc?.datos_extraidos as any)?.meta_aplicacion
        if (meta?.accion_ejecutada) setAccionEjecutada(meta.accion_ejecutada)

        if (proc.poliza_creada_id) {
          const { data: pol } = await supabase
            .from('polizas')
            .select(`
              id, numero_poliza, estado, fecha_inicio, fecha_fin,
              asegurado:personas!asegurado_id (apellido, nombre, razon_social),
              compania:catalogos!compania_id (nombre),
              riesgos (tipo_riesgo, detalle_tecnico)
            `)
            .eq('id', proc.poliza_creada_id)
            .maybeSingle()
          if (pol) {
            const a = (pol as any).asegurado
            const r = ((pol as any).riesgos || [])[0]
            let desc: string | null = null
            if (r) {
              const dt = r.detalle_tecnico || {}
              if (r.tipo_riesgo === 'automotor' || r.tipo_riesgo === 'moto') {
                desc = `${dt.marca || ''} ${dt.modelo || ''} ${dt.anio || ''}`.trim() || r.tipo_riesgo
              } else {
                desc = r.tipo_riesgo
              }
            }
            setResumenPoliza({
              id: (pol as any).id,
              numero_poliza: (pol as any).numero_poliza,
              estado: (pol as any).estado,
              fecha_inicio: (pol as any).fecha_inicio,
              fecha_fin: (pol as any).fecha_fin,
              asegurado_nombre: a?.razon_social || [a?.apellido, a?.nombre].filter(Boolean).join(', ') || '—',
              compania_nombre: (pol as any).compania?.nombre || null,
              riesgo_descripcion: desc,
            })
          }

          if (proc.tipo_operacion === 'RENOVACION' && proc.poliza_origen_id) {
            const { data: origen } = await supabase
              .from('polizas')
              .select('numero_poliza, fecha_fin')
              .eq('id', proc.poliza_origen_id)
              .maybeSingle()
            if (origen) {
              setPolizaOrigenInfo({ numero: (origen as any).numero_poliza, fecha_fin: (origen as any).fecha_fin })
            }
          }
        }

        if (proc.endoso_creado_id) {
          const { data: endoso } = await supabase
            .from('endosos')
            .select('id, numero_endoso, motivo, polizas:polizas!poliza_id (id, numero_poliza)')
            .eq('id', proc.endoso_creado_id)
            .maybeSingle()
          if (endoso) {
            setResumenEndoso({
              id: (endoso as any).id,
              numero_endoso: (endoso as any).numero_endoso,
              poliza_id: (endoso as any).polizas?.id,
              poliza_numero: (endoso as any).polizas?.numero_poliza,
              motivo: (endoso as any).motivo || '',
            })
          }
        }
      } finally {
        setCargando(false)
      }
    })()
  }, [id, supabase])

  if (cargando || !procesamiento) {
    return (
      <div className="max-w-2xl mx-auto p-8 text-center text-sm text-slate-600">
        <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
        Cargando resultado...
      </div>
    )
  }

  const tipo = procesamiento.tipo_operacion

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      {/* Header celebratorio */}
      <div className="bg-white border border-emerald-200 rounded p-6 flex flex-col items-center text-center gap-3">
        <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        </div>
        {tipo === 'POLIZA_NUEVA' && resumenPoliza && (
          <>
            <h1 className="text-lg font-semibold text-slate-800">¡Póliza creada correctamente!</h1>
            <p className="text-xs text-slate-600 max-w-md">
              La póliza <span className="font-mono font-semibold">{resumenPoliza.numero_poliza}</span> de{' '}
              <span className="font-semibold">{resumenPoliza.asegurado_nombre}</span> se creó con todos sus datos.
            </p>
          </>
        )}
        {tipo === 'RENOVACION' && resumenPoliza && (
          <>
            <h1 className="text-lg font-semibold text-slate-800">¡Renovación creada correctamente!</h1>
            <p className="text-xs text-slate-600 max-w-md">
              {polizaOrigenInfo ? (
                <>
                  La renovación de la póliza <span className="font-mono">{polizaOrigenInfo.numero}</span> se creó como{' '}
                  <span className="font-mono font-semibold">{resumenPoliza.numero_poliza}</span>.
                </>
              ) : (
                <>La renovación se creó como <span className="font-mono font-semibold">{resumenPoliza.numero_poliza}</span>.</>
              )}
            </p>
            {polizaOrigenInfo && (
              <p className="text-2xs text-slate-600 max-w-md">
                La póliza actual sigue vigente hasta {polizaOrigenInfo.fecha_fin}. La nueva va a activarse automáticamente el {resumenPoliza.fecha_inicio}.
              </p>
            )}
          </>
        )}
        {tipo === 'ENDOSO' && resumenEndoso && (
          <>
            <h1 className="text-lg font-semibold text-slate-800">¡Endoso creado correctamente!</h1>
            <p className="text-xs text-slate-600 max-w-md">
              El endoso <span className="font-semibold">#{resumenEndoso.numero_endoso}</span> de la póliza{' '}
              <span className="font-mono">{resumenEndoso.poliza_numero}</span> se creó con el PDF adjunto.
            </p>
          </>
        )}
      </div>

      {/* Resumen */}
      <div className="bg-white border border-slate-200 rounded p-4">
        <p className="text-2xs font-semibold text-slate-600 uppercase mb-2">Resumen</p>
        <ul className="space-y-1 text-xs text-slate-700">
          {resumenPoliza && (
            <>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                Cliente {resumenPoliza.asegurado_nombre}
                {accionEjecutada === 'USADA_EXISTENTE' && ' (usado cliente existente)'}
                {accionEjecutada === 'ACTUALIZADA' && ' actualizado con datos del PDF'}
                {accionEjecutada === 'CREADA_NUEVA' && ' creado nuevo'}
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                Póliza <span className="font-mono">{resumenPoliza.numero_poliza}</span> creada con estado{' '}
                <span className="font-semibold">{resumenPoliza.estado}</span>
              </li>
              {resumenPoliza.riesgo_descripcion && (
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                  Bien asegurado: {resumenPoliza.riesgo_descripcion}
                </li>
              )}
              {resumenPoliza.compania_nombre && (
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                  Compañía: {resumenPoliza.compania_nombre}
                </li>
              )}
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                PDF guardado en la carpeta {tipo === 'RENOVACION' ? 'documentacion_renovada/' : 'documentacion/'} de la póliza
              </li>
            </>
          )}
          {resumenEndoso && (
            <>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                Endoso #{resumenEndoso.numero_endoso} creado: {resumenEndoso.motivo}
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                PDF guardado en la carpeta endosos/ de la póliza
              </li>
            </>
          )}
        </ul>
      </div>

      {/* Costo */}
      {(procesamiento.tokens_usados || procesamiento.costo_estimado) && (
        <div className="bg-white border border-slate-200 rounded p-4">
          <p className="text-2xs font-semibold text-slate-600 uppercase mb-2 flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> Costo del procesamiento
          </p>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-2xs text-slate-600">Tokens usados</p>
              <p className="font-mono text-slate-800">{(procesamiento.tokens_usados || 0).toLocaleString('es-AR')}</p>
            </div>
            <div>
              <p className="text-2xs text-slate-600">Costo</p>
              <p className="font-mono text-slate-800">
                ${(procesamiento.costo_estimado || 0).toFixed(4)} USD
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Acciones */}
      <div className="flex flex-col gap-2">
        {resumenPoliza && (
          <button
            onClick={() => router.push(`/crm/polizas/${resumenPoliza.id}`)}
            className="btn-primary justify-center py-3 text-sm"
          >
            <ArrowRight className="h-4 w-4" />
            Ver {tipo === 'RENOVACION' ? 'póliza renovada' : 'póliza creada'}
          </button>
        )}
        {resumenEndoso && (
          <button
            onClick={() => router.push(`/crm/polizas/${resumenEndoso.poliza_id}`)}
            className="btn-primary justify-center py-3 text-sm"
          >
            <ArrowRight className="h-4 w-4" />
            Ver póliza con el endoso
          </button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => router.push('/crm/polizas/nueva')}
            className="btn-secondary justify-center"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Procesar otro PDF
          </button>
          <button
            onClick={() => router.push('/crm/dashboard')}
            className="btn-secondary justify-center"
          >
            <Home className="h-3.5 w-3.5" /> Volver al dashboard
          </button>
        </div>
      </div>
    </div>
  )
}
