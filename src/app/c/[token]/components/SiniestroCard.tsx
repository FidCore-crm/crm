'use client'

/**
 * Card de siniestro en el portal del asegurado.
 *
 * Rediseño v1.0.126 (task 8b + 8d):
 * - Muestra el bien asegurado (auto o dirección) para que el asegurado
 *   identifique cada siniestro sin adivinar por el número.
 * - Compañía visible en el header.
 * - Estado + progress bar del trámite.
 * - 2 toggles INDEPENDIENTES: 📎 Documentación y 🕐 Seguimiento del trámite.
 *   Ambos empiezan colapsados. Antes se abría todo junto y era una pared.
 */

import { useState } from 'react'
import {
  Calendar, CheckCircle2, XCircle, MessageSquare, ArrowRight,
  ChevronDown, FileText, Download, Car, Home as HomeIcon, Package,
} from 'lucide-react'
import { formatFechaLocalLarga } from '@/lib/utils'

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
  // v1.0.126 — datos del bien afectado + compañía
  compania_nombre?: string | null
  bien_asegurado?: {
    tipo_riesgo: string | null
    detalle_tecnico: Record<string, any>
    descripcion_corta: string | null
  } | null
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

const TIPO_LABEL: Record<string, string> = {
  ACCIDENTE_TRANSITO: 'Accidente de tránsito',
  ROBO: 'Robo',
  ROBO_TOTAL: 'Robo total',
  ROBO_PARCIAL: 'Robos parciales',
  ROBO_RUEDAS: 'Robo de ruedas',
  INCENDIO: 'Incendio',
  GRANIZO: 'Granizo',
  ROTURA_CRISTALES: 'Rotura de cristales, parabrisas o luneta',
  ROTURA_CERRADURAS: 'Rotura de cerraduras',
  RC_TERCEROS: 'Responsabilidad Civil',
  DAÑOS: 'Daños',
  AGUA: 'Daños por agua',
  DAÑO_POR_AGUA: 'Daño por agua',
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
  return formatFechaLocalLarga(iso)
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

/** Ícono según tipo_riesgo del bien afectado. */
function IconoBien({ tipo, className }: { tipo: string | null | undefined; className?: string }) {
  const t = String(tipo || '').toLowerCase()
  if (t === 'automotor' || t === 'moto') return <Car className={className} />
  if (t === 'integrales' || t === 'hogar') return <HomeIcon className={className} />
  return <Package className={className} />
}

/** Descripción corta del bien afectado según tipo de riesgo. */
function descripcionBien(bien: SiniestroData['bien_asegurado']): string {
  if (!bien) return ''
  const dt = bien.detalle_tecnico || {}
  const t = String(bien.tipo_riesgo || '').toLowerCase()
  if (t === 'automotor' || t === 'moto') {
    const nombre = [dt.marca, dt.modelo, dt.anio].filter(Boolean).join(' ')
    const patente = dt.patente ? String(dt.patente).toUpperCase() : ''
    if (nombre && patente) return `${nombre} · ${patente}`
    if (nombre) return nombre
    if (patente) return `Patente ${patente}`
  }
  if (t === 'integrales' || t === 'hogar') {
    const dir = [dt.calle, dt.numero].filter(Boolean).join(' ')
    const loc = [dt.localidad, dt.provincia].filter(Boolean).join(', ')
    if (dir && loc) return `${dir}, ${loc}`
    if (dir) return dir
  }
  return bien.descripcion_corta || ''
}

export default function SiniestroCard({
  siniestro,
  token,
}: {
  siniestro: SiniestroData
  token: string
}) {
  const [docsAbierto, setDocsAbierto] = useState(false)
  const [segAbierto, setSegAbierto] = useState(false)
  const idx = indexEstado(siniestro.estado)
  const badge = ESTADO_BADGE[siniestro.estado] || 'bg-slate-50 text-slate-600 border-slate-200'
  const esRechazado = siniestro.estado === 'RECHAZADO'
  const esFinalizado = siniestro.estado === 'FINALIZADO'
  const tipoLegible = labelTipo(siniestro.tipo_siniestro, siniestro.tipo_otro_descripcion)
  const cantidadArchivos = siniestro.archivos.length
  const cantidadActualizaciones = siniestro.timeline.length
  const bienDesc = descripcionBien(siniestro.bien_asegurado)

  function urlDescarga(ruta: string): string {
    return `/api/publico/portal-cliente/archivo/${token}?ruta=${encodeURIComponent(ruta)}`
  }

  return (
    <div className={`bg-white border rounded-2xl shadow-sm overflow-hidden ${
      esRechazado ? 'border-red-100' : esFinalizado ? 'border-emerald-100' : 'border-slate-200'
    }`}>
      <div className="p-4">
        {/* Header con compañía + caso + badge estado */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0 flex-1">
            {siniestro.compania_nombre && (
              <p className="text-xs text-slate-500 font-medium">{siniestro.compania_nombre}</p>
            )}
            <p className="text-sm font-mono font-semibold text-slate-800 mt-0.5">Caso #{siniestro.numero_caso}</p>
            {siniestro.numero_siniestro && (
              <p className="text-xs text-slate-500 mt-0.5">
                N° siniestro: <span className="font-mono">{siniestro.numero_siniestro}</span>
              </p>
            )}
          </div>
          <span className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-2xs font-semibold border ${badge}`}>
            {esFinalizado ? <CheckCircle2 className="h-3 w-3" /> : esRechazado ? <XCircle className="h-3 w-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />}
            {ESTADO_LABEL[siniestro.estado] || siniestro.estado}
          </span>
        </div>

        {/* Bien asegurado — destacado */}
        {bienDesc && (
          <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-3 mb-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              String(siniestro.bien_asegurado?.tipo_riesgo || '').toLowerCase().match(/^(automotor|moto)$/)
                ? 'bg-blue-100' : 'bg-amber-100'
            }`}>
              <IconoBien
                tipo={siniestro.bien_asegurado?.tipo_riesgo}
                className={`w-5 h-5 ${
                  String(siniestro.bien_asegurado?.tipo_riesgo || '').toLowerCase().match(/^(automotor|moto)$/)
                    ? 'text-blue-700' : 'text-amber-700'
                }`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800 break-words">{bienDesc}</p>
            </div>
          </div>
        )}

        {/* Tipo + fecha */}
        {tipoLegible && (
          <div className="mb-3">
            <p className="text-sm text-slate-700 font-medium">{tipoLegible}</p>
            <p className="text-xs text-slate-500 mt-0.5 inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Denunciado el {formatoFecha(siniestro.fecha_denuncia)}
            </p>
          </div>
        )}

        {/* Progress bar del trámite */}
        {!esRechazado && (
          <div className="mb-4">
            <div className="flex items-center gap-1">
              {PASOS.map((p, i) => {
                const activo = i <= idx
                return (
                  <div
                    key={p.key}
                    className={`h-1.5 flex-1 rounded-full ${
                      activo ? (esFinalizado ? 'bg-emerald-500' : 'bg-blue-500') : 'bg-slate-200'
                    }`}
                  />
                )
              })}
            </div>
            <div className="flex items-center justify-between mt-1 text-2xs">
              <span className="text-slate-400">{PASOS[0].label}</span>
              <span className={esFinalizado ? 'text-emerald-700 font-semibold' : 'text-blue-700 font-semibold'}>
                {ESTADO_LABEL[siniestro.estado] || siniestro.estado}
              </span>
              <span className="text-slate-400">{PASOS[PASOS.length - 1].label}</span>
            </div>
          </div>
        )}

        {/* 2 TOGGLES INDEPENDIENTES */}
        <div className="flex flex-col gap-2">
          {/* Documentación */}
          {cantidadArchivos > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setDocsAbierto(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-sm text-slate-700"
              >
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-slate-500" />
                  Documentación
                  <span className="text-xs text-slate-500">({cantidadArchivos})</span>
                </span>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${docsAbierto ? 'rotate-180' : ''}`} />
              </button>
              {docsAbierto && (
                <ul className="mt-2 flex flex-col gap-1.5 bg-slate-50/50 rounded-lg p-1">
                  {siniestro.archivos.map((a, i) => (
                    <li key={i}>
                      <a
                        href={urlDescarga(a.ruta)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm text-slate-700 hover:bg-white rounded min-h-[44px]"
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
              )}
            </div>
          )}

          {/* Seguimiento del trámite */}
          {cantidadActualizaciones > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setSegAbierto(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-sm text-slate-700"
              >
                <span className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-slate-500" />
                  Seguimiento del trámite
                  <span className="text-xs text-slate-500">({cantidadActualizaciones})</span>
                </span>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${segAbierto ? 'rotate-180' : ''}`} />
              </button>
              {segAbierto && (
                <ul className="mt-2 flex flex-col gap-2.5 pl-3 border-l-2 border-slate-200">
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
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
