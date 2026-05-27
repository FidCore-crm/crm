'use client'

import { useState } from 'react'
import {
  Calendar, Hash, CheckCircle2, XCircle, MessageSquare, ArrowRight,
  ChevronDown, ChevronUp, FileText, Download, Folder,
} from 'lucide-react'

export interface SiniestroData {
  id: string
  numero_caso: string
  numero_siniestro: string | null
  estado: string
  fecha_denuncia: string
  tipo_siniestro: string | null
  tipo_otro_descripcion: string | null
  timeline: Array<{
    tipo: 'ESTADO' | 'NOTA'
    texto: string | null
    estado_anterior: string | null
    estado_nuevo: string | null
    fecha: string
  }>
  archivos: Array<{ nombre: string; ruta: string; tamano: number }>
}

const PASOS = [
  { key: 'DENUNCIADO', label: 'Denunciado' },
  { key: 'EN_TRAMITE', label: 'En trámite' },
  { key: 'INSPECCION', label: 'Inspección' },
  { key: 'LIQUIDACION', label: 'Liquidación' },
  { key: 'FINALIZADO', label: 'Finalizado' },
]

const ESTADO_BADGE: Record<string, string> = {
  DENUNCIADO: 'bg-blue-50 text-blue-700 border-blue-200',
  EN_TRAMITE: 'bg-sky-50 text-sky-700 border-sky-200',
  INSPECCION: 'bg-amber-50 text-amber-700 border-amber-200',
  LIQUIDACION: 'bg-orange-50 text-orange-700 border-orange-200',
  REPARACION: 'bg-violet-50 text-violet-700 border-violet-200',
  FINALIZADO: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  RECHAZADO: 'bg-red-50 text-red-700 border-red-200',
}

const ESTADO_LABEL: Record<string, string> = {
  DENUNCIADO: 'Denunciado',
  EN_TRAMITE: 'En trámite',
  INSPECCION: 'En inspección',
  LIQUIDACION: 'En liquidación',
  REPARACION: 'En reparación',
  FINALIZADO: 'Finalizado',
  RECHAZADO: 'Rechazado',
}

// Lista unificada de tipos (también vive en src/lib/siniestros-config.ts).
// Mantengo claves históricas (ROBO_TOTAL, AGUA, etc.) para que registros
// viejos sigan mostrando un nombre legible.
const TIPO_LABEL: Record<string, string> = {
  ACCIDENTE_TRANSITO: 'Accidente de tránsito',
  ROBO: 'Robo',
  ROBO_TOTAL: 'Robo total',
  ROBO_PARCIAL: 'Robo parcial / Hurto',
  INCENDIO: 'Incendio',
  GRANIZO: 'Granizo',
  ROTURA_CRISTALES: 'Rotura de cristales, parabrisas o luneta',
  ROTURA_CERRADURAS: 'Rotura de cerraduras',
  RC_TERCEROS: 'Responsabilidad Civil',
  DAÑOS: 'Daños',
  AGUA: 'Daños por agua',
  ACCIDENTE_PERSONAL: 'Accidente personal',
  FALLECIMIENTO: 'Fallecimiento',
  INVALIDEZ: 'Invalidez',
  INTERNACION: 'Internación',
  DAÑO_TECNICO: 'Daño técnico',
  OTRO: 'Otro',
}

function labelTipo(tipo: string | null, tipoOtro: string | null): string {
  if (!tipo) return ''
  if (tipo === 'OTRO') return tipoOtro?.trim() || 'Otro'
  return TIPO_LABEL[tipo] || tipo.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())
}

function formatoFecha(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatoTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function indexEstado(estado: string): number {
  if (estado === 'DENUNCIADO') return 0
  if (estado === 'EN_TRAMITE') return 1
  if (estado === 'INSPECCION') return 2
  if (estado === 'LIQUIDACION' || estado === 'REPARACION') return 3
  if (estado === 'FINALIZADO') return 4
  return 0
}

export default function SiniestroCard({
  siniestro,
  token,
}: {
  siniestro: SiniestroData
  token: string
}) {
  const [abierto, setAbierto] = useState(false)
  const idx = indexEstado(siniestro.estado)
  const badge = ESTADO_BADGE[siniestro.estado] || 'bg-slate-50 text-slate-600 border-slate-200'
  const esRechazado = siniestro.estado === 'RECHAZADO'
  const esFinalizado = siniestro.estado === 'FINALIZADO'
  const tipoLegible = labelTipo(siniestro.tipo_siniestro, siniestro.tipo_otro_descripcion)
  const cantidadArchivos = siniestro.archivos.length
  const cantidadActualizaciones = siniestro.timeline.length

  function urlDescarga(ruta: string): string {
    return `/api/publico/portal-cliente/archivo/${token}?ruta=${encodeURIComponent(ruta)}`
  }

  return (
    <div className={`bg-white border rounded-2xl shadow-sm overflow-hidden ${
      esRechazado ? 'border-red-100' : esFinalizado ? 'border-emerald-100' : 'border-slate-200'
    }`}>
      {/* Header — siempre visible. Click para expandir/colapsar */}
      <button
        type="button"
        onClick={() => setAbierto(v => !v)}
        className={`w-full text-left px-4 py-3 border-b flex items-center justify-between gap-2 hover:bg-slate-100/50 active:bg-slate-100 transition-colors ${
          esRechazado ? 'bg-red-50/40 border-red-100' : esFinalizado ? 'bg-emerald-50/40 border-emerald-100' : 'bg-slate-50 border-slate-100'
        }`}
        aria-expanded={abierto}
      >
        <div className="min-w-0 flex items-center gap-2 flex-1">
          {esFinalizado ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          ) : esRechazado ? (
            <XCircle className="h-4 w-4 text-red-600 shrink-0" />
          ) : (
            <Hash className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-2xs uppercase tracking-wide text-slate-500 leading-tight">
              N° de siniestro
            </p>
            {siniestro.numero_siniestro ? (
              <p className="text-sm font-mono font-semibold text-slate-800 truncate leading-tight">
                {siniestro.numero_siniestro}
              </p>
            ) : (
              <p className="text-xs italic text-slate-400 truncate leading-tight">
                Pendiente de asignación
              </p>
            )}
          </div>
        </div>
        <span
          className={`shrink-0 inline-block px-2.5 py-1 rounded-full text-2xs font-semibold border ${badge}`}
        >
          {ESTADO_LABEL[siniestro.estado] || siniestro.estado}
        </span>
        {abierto ? (
          <ChevronUp className="h-4 w-4 text-slate-400 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
        )}
      </button>

      {/* Resumen breve siempre visible (cuando está colapsado) */}
      {!abierto && (
        <div className="px-4 py-3 flex items-center justify-between gap-3 text-xs text-slate-600">
          <div className="min-w-0 flex flex-col gap-0.5">
            {tipoLegible && (
              <span className="font-medium text-slate-800 truncate">{tipoLegible}</span>
            )}
            <span className="inline-flex items-center gap-1 text-slate-500">
              <Calendar className="h-3 w-3" />
              {formatoFecha(siniestro.fecha_denuncia)}
            </span>
          </div>
          <div className="flex items-center gap-3 shrink-0 text-2xs text-slate-400">
            {cantidadArchivos > 0 && (
              <span className="inline-flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {cantidadArchivos}
              </span>
            )}
            {cantidadActualizaciones > 0 && (
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {cantidadActualizaciones}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Contenido expandido */}
      {abierto && (
        <div className="p-4 flex flex-col gap-3">
          {tipoLegible && (
            <div className="flex items-start gap-2">
              <span className="text-xs text-slate-500 w-28 shrink-0">Tipo</span>
              <span className="text-sm font-medium text-slate-800">{tipoLegible}</span>
            </div>
          )}
          <div className="flex items-start gap-2">
            <span className="text-xs text-slate-500 w-28 shrink-0">Fecha denuncia</span>
            <span className="text-sm text-slate-700 inline-flex items-center gap-1">
              <Calendar className="h-3 w-3 text-slate-400" />
              {formatoFecha(siniestro.fecha_denuncia)}
            </span>
          </div>

          {/* Stepper */}
          {!esRechazado && (
            <div className="pt-1">
              <div className="flex items-center gap-1">
                {PASOS.map((p, i) => {
                  const activo = i <= idx
                  return (
                    <div key={p.key} className="flex-1">
                      <div
                        className={`h-1.5 rounded-full ${
                          activo
                            ? esFinalizado
                              ? 'bg-emerald-500'
                              : 'bg-blue-500'
                            : 'bg-slate-200'
                        }`}
                      />
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center gap-1 mt-1.5">
                {PASOS.map((p, i) => {
                  const activo = i <= idx
                  return (
                    <div
                      key={p.key}
                      className={`flex-1 text-center text-2xs leading-tight ${
                        activo ? 'text-slate-700 font-medium' : 'text-slate-400'
                      }`}
                    >
                      {p.label}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Documentación del siniestro */}
          {cantidadArchivos > 0 && (
            <div className="border-t border-slate-100 pt-3 mt-1">
              <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide flex items-center gap-1.5">
                <Folder className="h-3.5 w-3.5" />
                Documentación
                <span className="ml-auto text-2xs font-medium normal-case tracking-normal text-slate-400">
                  {cantidadArchivos} {cantidadArchivos === 1 ? 'archivo' : 'archivos'}
                </span>
              </p>
              <ul className="flex flex-col gap-1.5 bg-slate-50/50 rounded-lg p-1">
                {siniestro.archivos.map((a, i) => (
                  <li key={i}>
                    <a
                      href={urlDescarga(a.ruta)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm text-slate-700 hover:bg-white active:bg-slate-100 rounded min-h-[44px]"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <FileText className="h-4 w-4 text-slate-400 shrink-0" />
                        <span className="truncate">{a.nombre}</span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0 text-xs text-slate-400">
                        <span>{formatoTamano(a.tamano)}</span>
                        <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-blue-50 text-blue-600">
                          <Download className="h-3.5 w-3.5" />
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Bitácora de seguimiento */}
          {cantidadActualizaciones > 0 && (
            <div className="border-t border-slate-100 pt-3 mt-1">
              <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">
                Seguimiento del trámite
              </p>
              <ul className="flex flex-col gap-2.5">
                {siniestro.timeline.slice(-15).reverse().map((t, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    {t.tipo === 'NOTA' ? (
                      <MessageSquare className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                    ) : (
                      <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      {t.tipo === 'NOTA' ? (
                        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap break-words">
                          {t.texto || ''}
                        </p>
                      ) : (
                        <p className="text-xs text-slate-600">
                          {t.estado_anterior && (
                            <>
                              <span className="text-slate-400">{ESTADO_LABEL[t.estado_anterior] || t.estado_anterior}</span>
                              <span className="text-slate-400"> → </span>
                            </>
                          )}
                          <span className="font-medium">{ESTADO_LABEL[t.estado_nuevo || ''] || t.estado_nuevo}</span>
                        </p>
                      )}
                      <p className="text-2xs text-slate-400 mt-0.5">{formatoFecha(t.fecha)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
