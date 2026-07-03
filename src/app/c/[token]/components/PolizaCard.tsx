'use client'

import { useState } from 'react'
import {
  FileText, Download, ChevronDown, ChevronUp, Folder,
  Car, Home, HeartPulse, Building2, Bike, Shield,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { formatFechaLocalLarga, diasHastaVencimiento } from '@/lib/utils'

export interface PolizaData {
  id: string
  numero_poliza: string
  compania: string
  ramo: string
  cobertura: string
  suma_asegurada: number | null
  moneda: string
  fecha_inicio: string
  fecha_fin: string
  observaciones?: string | null
  riesgos: Array<{
    descripcion: string | null
    tipo: string | null
    detalle: Record<string, any>
    suma_asegurada: number | null
  }>
  archivos: Array<{ nombre: string; ruta: string; tamano: number }>
}

// Resumen de un riesgo en una línea (para 1 riesgo solo).
function resumenRiesgo(r: PolizaData['riesgos'][number]): string {
  const t = (r.tipo || '').toLowerCase()
  const d = r.detalle || {}
  if (t === 'automotor' || t === 'moto') {
    const partes: string[] = []
    if (d.patente) partes.push(String(d.patente).toUpperCase())
    const auto = [d.marca, d.modelo].filter(Boolean).join(' ')
    if (auto) partes.push(auto)
    if (d.anio) partes.push(String(d.anio))
    return partes.join(' · ') || r.descripcion || '—'
  }
  if (t === 'hogar') {
    const dir = [d.calle, d.numero, d.localidad].filter(Boolean).join(' ')
    return dir || r.descripcion || '—'
  }
  if (t === 'vida') {
    return d.beneficiarios || r.descripcion || '—'
  }
  return r.descripcion || d.descripcion || '—'
}

// Líneas detalladas de un riesgo (para flotas).
function lineasRiesgo(r: PolizaData['riesgos'][number]): { label: string; valor: string }[] {
  const t = (r.tipo || '').toLowerCase()
  const d = r.detalle || {}
  const out: { label: string; valor: string }[] = []
  if (t === 'automotor' || t === 'moto') {
    if (d.patente) out.push({ label: 'Patente', valor: String(d.patente).toUpperCase() })
    const auto = [d.marca, d.modelo].filter(Boolean).join(' ')
    if (auto) out.push({ label: 'Vehículo', valor: auto })
    if (d.anio) out.push({ label: 'Año', valor: String(d.anio) })
    if (d.color) out.push({ label: 'Color', valor: String(d.color) })
    if (d.uso) out.push({ label: 'Uso', valor: String(d.uso) })
  } else if (t === 'hogar') {
    const dir = [d.calle, d.numero, d.piso_depto].filter(Boolean).join(' ')
    if (dir) out.push({ label: 'Domicilio', valor: dir })
    const loc = [d.localidad, d.provincia].filter(Boolean).join(', ')
    if (loc) out.push({ label: 'Localidad', valor: loc })
    if (d.tipo_construccion) out.push({ label: 'Construcción', valor: String(d.tipo_construccion) })
    if (d.superficie) out.push({ label: 'Superficie', valor: `${d.superficie} m²` })
  } else if (t === 'vida') {
    if (d.capital_asegurado) out.push({ label: 'Capital', valor: String(d.capital_asegurado) })
    if (d.beneficiarios) out.push({ label: 'Beneficiarios', valor: String(d.beneficiarios) })
  } else {
    if (d.descripcion) out.push({ label: 'Descripción', valor: String(d.descripcion) })
  }
  if (r.descripcion && !out.some(l => l.valor === r.descripcion)) {
    out.unshift({ label: 'Descripción', valor: r.descripcion })
  }
  return out
}

function formatoTamano(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatoMonto(monto: number, moneda: string): string {
  const simbolo = moneda === 'USD' ? 'US$' : '$'
  try {
    return `${simbolo} ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(monto)}`
  } catch {
    return `${simbolo} ${monto}`
  }
}

function iconoRamo(ramo: string, tipo_riesgo?: string | null): LucideIcon {
  const r = (ramo || '').toLowerCase()
  const t = (tipo_riesgo || '').toLowerCase()
  // Auto primero (porque "automotor" contiene "moto" como substring).
  if (r.includes('automotor') || r.includes('automovil') || r.includes('autom') || t === 'automotor') return Car
  // Moto: solo si la palabra está como token aislado (no "automotor").
  if (/\bmoto/.test(r) || t === 'moto' || t === 'motovehiculo') return Bike
  if (r.includes('hogar') || r.includes('combinado familiar') || t === 'hogar') return Home
  if (r.includes('vida') || t === 'vida' || r.includes('salud') || r.includes('accidente')) return HeartPulse
  if (r.includes('comerc') || r.includes('integral') || r.includes('riesgo del trabajo') || r.includes('art')) return Building2
  return Shield
}

export default function PolizaCard({
  poliza,
  token,
}: {
  poliza: PolizaData
  token: string
}) {
  const [docsAbierto, setDocsAbierto] = useState(false)
  const dias = diasHastaVencimiento(poliza.fecha_fin)
  const porVencer = dias >= 0 && dias <= 30
  const Icono = iconoRamo(poliza.ramo, poliza.riesgos[0]?.tipo)

  function urlDescarga(ruta: string): string {
    return `/api/publico/portal-cliente/archivo/${token}?ruta=${encodeURIComponent(ruta)}`
  }

  const cantidadRiesgos = poliza.riesgos.length
  const esFlota = cantidadRiesgos > 1
  const cantidadArchivos = poliza.archivos.length

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Header con icono del ramo */}
      <div className="px-4 py-4 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
          <Icono className="h-5 w-5 text-blue-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-500">{poliza.ramo || 'Póliza'}</p>
          <p className="text-sm font-mono font-semibold text-slate-800 truncate">
            {poliza.numero_poliza}
          </p>
        </div>
        {dias >= 0 && (
          <span
            className={`shrink-0 inline-flex items-center px-2.5 py-1 rounded-full text-2xs font-semibold ${
              porVencer
                ? 'bg-amber-100 text-amber-700 border border-amber-200'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            }`}
          >
            {porVencer ? `${dias}d para vencer` : 'Vigente'}
          </span>
        )}
      </div>

      {/* Cuerpo */}
      <div className="p-4 flex flex-col gap-2.5">
        {poliza.compania && (
          <div className="flex items-start gap-2">
            <span className="text-xs text-slate-500 w-24 shrink-0">Compañía</span>
            <span className="text-sm font-medium text-slate-800">{poliza.compania}</span>
          </div>
        )}
        {poliza.cobertura && (
          <div className="flex items-start gap-2">
            <span className="text-xs text-slate-500 w-24 shrink-0">Cobertura</span>
            <span className="text-sm text-slate-700">{poliza.cobertura}</span>
          </div>
        )}
        {/* 1 riesgo: línea inline. Flota (>1): bloque completo abajo */}
        {!esFlota && cantidadRiesgos === 1 && (
          <div className="flex items-start gap-2">
            <span className="text-xs text-slate-500 w-24 shrink-0">Bien aseg.</span>
            <span className="text-sm text-slate-700">{resumenRiesgo(poliza.riesgos[0])}</span>
          </div>
        )}
        {poliza.suma_asegurada && poliza.suma_asegurada > 0 && (
          <div className="flex items-start gap-2">
            <span className="text-xs text-slate-500 w-24 shrink-0">Suma aseg.</span>
            <span className="text-sm font-mono font-medium text-slate-800">
              {formatoMonto(poliza.suma_asegurada, poliza.moneda)}
            </span>
          </div>
        )}
        <div className="flex items-start gap-2">
          <span className="text-xs text-slate-500 w-24 shrink-0">Vigencia</span>
          <span className="text-sm text-slate-700">
            {formatFechaLocalLarga(poliza.fecha_inicio)} → {formatFechaLocalLarga(poliza.fecha_fin)}
          </span>
        </div>
        {poliza.observaciones && (
          <div className="flex items-start gap-2 pt-2 border-t border-slate-100 mt-1">
            <span className="text-xs text-slate-500 w-24 shrink-0">Observaciones</span>
            <span className="text-sm text-slate-700 whitespace-pre-wrap">{poliza.observaciones}</span>
          </div>
        )}
      </div>

      {/* Bienes asegurados — sólo si hay flota (>1 riesgo) */}
      {esFlota && (
        <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/40">
          <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide flex items-center justify-between">
            <span>Bienes asegurados</span>
            <span className="text-2xs font-medium normal-case tracking-normal text-slate-400">
              {cantidadRiesgos} {cantidadRiesgos === 1 ? 'item' : 'items'}
            </span>
          </p>
          <ul className="flex flex-col gap-2">
            {poliza.riesgos.map((r, i) => {
              const lineas = lineasRiesgo(r)
              const IconR = iconoRamo(poliza.ramo, r.tipo)
              return (
                <li key={i} className="bg-white border border-slate-200 rounded-lg px-3 py-2.5 flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                    <IconR className="h-4 w-4 text-slate-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-2xs text-slate-400 uppercase tracking-wide">Ítem {i + 1}</p>
                    {lineas.length > 0 ? (
                      <div className="mt-1 grid grid-cols-1 gap-0.5">
                        {lineas.map((l, j) => (
                          <div key={j} className="flex items-baseline gap-2 text-xs">
                            <span className="text-slate-500 w-20 shrink-0">{l.label}</span>
                            <span className="text-slate-800 font-medium truncate">{l.valor}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-700 mt-0.5">{resumenRiesgo(r)}</p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Documentación */}
      <div className="border-t border-slate-100 bg-slate-50/40">
        {cantidadArchivos === 0 ? (
          <div className="px-4 py-3 flex items-center gap-2 text-xs text-slate-400">
            <FileText className="h-3.5 w-3.5" />
            Sin documentación cargada todavía
          </div>
        ) : (
          <>
            <button
              onClick={() => setDocsAbierto(v => !v)}
              className="w-full flex items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 active:bg-blue-100 min-h-[48px]"
              aria-expanded={docsAbierto}
            >
              <span className="flex items-center gap-2">
                <Folder className="h-4 w-4" />
                Ver documentación
                <span className="ml-1 text-2xs font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                  {cantidadArchivos}
                </span>
              </span>
              {docsAbierto ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {docsAbierto && (
              <ul className="border-t border-slate-100 bg-white">
                {poliza.archivos.map((a, i) => (
                  <li key={i} className="border-b border-slate-50 last:border-b-0">
                    <a
                      href={urlDescarga(a.ruta)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 min-h-[52px]"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <FileText className="h-4 w-4 text-slate-400 shrink-0" />
                        <span className="truncate">{a.nombre}</span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0 text-xs text-slate-400">
                        <span>{formatoTamano(a.tamano)}</span>
                        <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-blue-50 text-blue-600">
                          <Download className="h-4 w-4" />
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
