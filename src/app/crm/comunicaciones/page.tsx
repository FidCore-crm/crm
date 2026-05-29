'use client'

/**
 * Módulo Comunicaciones (mailings) del CRM.
 *
 * Este es el centro de mailings ACTIVOS del PAS: envíos individuales, masivos,
 * plantillas reutilizables y audiencias guardadas. NO se mezcla con los 5 emails
 * automáticos del sistema (que viven en Configuración → Comunicaciones).
 *
 * Tabs:
 *   - Envíos:    historial global de todo lo enviado
 *   - Campañas:  campañas guardadas reutilizables (Sprint 2 — placeholder)
 *   - Plantillas: CRUD de plantillas propias para mailings
 *   - Audiencias: CRUD de segmentos guardados de la cartera
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Mail, Send, Eye, MousePointerClick, Clock, AlertTriangle,
  Plus, Inbox, Users, FileText, Megaphone,
} from 'lucide-react'
import Link from 'next/link'
import { apiCall } from '@/lib/api-client'
import { useAuth } from '@/contexts/AuthContext'
import { useEmailConfigurado } from '@/lib/hooks/useEmailConfigurado'
import ComunicacionesTab from '@/components/ComunicacionesTab'
import TabMailingPlantillas from '@/components/mailings/TabMailingPlantillas'
import TabMailingAudiencias from '@/components/mailings/TabMailingAudiencias'
import TabMailingCampanas from '@/components/mailings/TabMailingCampanas'
import WizardNuevoEnvio from '@/components/mailings/WizardNuevoEnvio'
import BannerColaAtrasada from '@/components/comunicaciones/BannerColaAtrasada'

interface Kpis {
  enviados_mes: number
  aperturas_mes: number
  clicks_mes: number
  en_cola: number
  cola_atrasada: number
  fallidos_mes: number
  fallidos_reintentables: number
  tasa_apertura: number
  tasa_click: number
}

type Tab = 'envios' | 'campanas' | 'plantillas' | 'audiencias'

export default function ComunicacionesPage() {
  const { isAdmin } = useAuth()
  const { configurado: smtpConfigurado, testExitoso, isLoading: smtpLoading } = useEmailConfigurado()

  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [cargandoKpis, setCargandoKpis] = useState(true)
  const [tab, setTab] = useState<Tab>('envios')

  const [wizardAbierto, setWizardAbierto] = useState(false)

  const cargarKpis = useCallback(async () => {
    setCargandoKpis(true)
    const r = await apiCall<{ kpis: Kpis }>('/api/comunicaciones/kpis', undefined, { mostrar_toast_en_error: false })
    if (r.ok && r.data) setKpis(r.data.kpis)
    setCargandoKpis(false)
  }, [])

  useEffect(() => { cargarKpis() }, [cargarKpis])

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Comunicaciones</h1>
          <p className="text-xs text-slate-500">
            Centro de mailings, campañas y segmentación de cartera. Los emails automáticos del sistema se configuran en{' '}
            {isAdmin ? (
              <Link href="/crm/configuracion/comunicaciones" className="text-blue-600 hover:underline">
                Configuración → Comunicaciones
              </Link>
            ) : (
              <span>Configuración → Comunicaciones</span>
            )}.
          </p>
        </div>
        <button
          onClick={() => setWizardAbierto(true)}
          disabled={!smtpLoading && !smtpConfigurado}
          className="btn-primary flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          title={
            !smtpLoading && !smtpConfigurado
              ? 'Configurá el servidor SMTP en Configuración → Correos para empezar a enviar'
              : 'Crear un envío de email'
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Nuevo envío
        </button>
      </div>

      {/* Banners SMTP */}
      {!smtpLoading && !smtpConfigurado && (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-amber-900">
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
            <span>
              <strong>El servidor SMTP no está configurado todavía.</strong>{' '}
              Hasta que lo configures no vas a poder enviar emails (ni manuales ni automáticos).
            </span>
          </div>
          {isAdmin && (
            <Link href="/crm/configuracion/correos" className="btn-primary flex items-center gap-1.5 shrink-0">
              Configurar ahora
            </Link>
          )}
        </div>
      )}

      {!smtpLoading && smtpConfigurado && !testExitoso && (
        <div className="bg-amber-50 border border-amber-200 rounded p-2 px-3 flex items-center gap-2 text-xs text-amber-900">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-700 shrink-0" />
          <span>
            SMTP está configurado pero todavía no hicimos un envío de prueba exitoso.
            Te recomendamos probar la conexión antes de mandar emails reales.
          </span>
          {isAdmin && (
            <Link href="/crm/configuracion/correos" className="ml-auto text-amber-900 underline hover:text-amber-700">
              Ir a Configuración
            </Link>
          )}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <div className="kpi-card bg-blue-50 border border-blue-200">
          <span className="kpi-label flex items-center gap-1">
            <Send className="h-3 w-3 text-blue-600" /> Enviados este mes
          </span>
          <span className="kpi-value text-blue-700">
            {cargandoKpis ? '…' : (kpis?.enviados_mes ?? 0).toLocaleString('es-AR')}
          </span>
          <span className="kpi-sub">emails entregados</span>
        </div>
        <div className="kpi-card bg-emerald-50 border border-emerald-200">
          <span className="kpi-label flex items-center gap-1">
            <Eye className="h-3 w-3 text-emerald-600" /> Aperturas
          </span>
          <span className="kpi-value text-emerald-700">
            {cargandoKpis ? '…' : (kpis?.aperturas_mes ?? 0).toLocaleString('es-AR')}
          </span>
          <span className="kpi-sub">
            {cargandoKpis ? ' ' : `${kpis?.tasa_apertura ?? 0}% del total`}
          </span>
        </div>
        <div className="kpi-card bg-violet-50 border border-violet-200">
          <span className="kpi-label flex items-center gap-1">
            <MousePointerClick className="h-3 w-3 text-violet-600" /> Clicks
          </span>
          <span className="kpi-value text-violet-700">
            {cargandoKpis ? '…' : (kpis?.clicks_mes ?? 0).toLocaleString('es-AR')}
          </span>
          <span className="kpi-sub">
            {cargandoKpis ? ' ' : `${kpis?.tasa_click ?? 0}% del total`}
          </span>
        </div>
        <div className={`kpi-card border ${kpis && kpis.cola_atrasada > 0 ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-200'}`}>
          <span className="kpi-label flex items-center gap-1">
            <Clock className={`h-3 w-3 ${kpis && kpis.cola_atrasada > 0 ? 'text-red-600' : 'text-amber-600'}`} /> En cola
          </span>
          <span className={`kpi-value ${kpis && kpis.cola_atrasada > 0 ? 'text-red-700' : 'text-amber-700'}`}>
            {cargandoKpis ? '…' : (kpis?.en_cola ?? 0).toLocaleString('es-AR')}
          </span>
          <span className="kpi-sub">
            {kpis && kpis.cola_atrasada > 0
              ? `⚠ ${kpis.cola_atrasada} esperando >12h`
              : 'esperando envío'}
          </span>
        </div>
        <div className={`kpi-card border ${kpis && kpis.fallidos_mes > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
          <span className="kpi-label flex items-center gap-1">
            <AlertTriangle className={`h-3 w-3 ${kpis && kpis.fallidos_mes > 0 ? 'text-red-600' : 'text-slate-400'}`} /> Fallidos este mes
          </span>
          <span className={`kpi-value ${kpis && kpis.fallidos_mes > 0 ? 'text-red-700' : 'text-slate-500'}`}>
            {cargandoKpis ? '…' : (kpis?.fallidos_mes ?? 0).toLocaleString('es-AR')}
          </span>
          <span className="kpi-sub">
            {kpis && kpis.fallidos_reintentables > 0
              ? `${kpis.fallidos_reintentables} reintentándose solo`
              : 'no entregados'}
          </span>
        </div>
      </div>

      {/* Banner de cola atrasada / acción de rescate */}
      {kpis && (kpis.cola_atrasada > 0 || kpis.fallidos_mes > 0) && (
        <BannerColaAtrasada
          colaAtrasada={kpis.cola_atrasada}
          fallidosMes={kpis.fallidos_mes}
          fallidosReintentables={kpis.fallidos_reintentables}
          onReintentar={cargarKpis}
        />
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
        <TabBtn active={tab === 'envios'} onClick={() => setTab('envios')} icon={Inbox} label="Envíos" />
        <TabBtn active={tab === 'campanas'} onClick={() => setTab('campanas')} icon={Megaphone} label="Campañas" />
        <TabBtn active={tab === 'plantillas'} onClick={() => setTab('plantillas')} icon={FileText} label="Plantillas" />
        <TabBtn active={tab === 'audiencias'} onClick={() => setTab('audiencias')} icon={Users} label="Audiencias" />
      </div>

      {/* Contenido del tab activo */}
      <div className="min-h-[300px]">
        {tab === 'envios' && <ComunicacionesTab global />}
        {tab === 'campanas' && <TabMailingCampanas />}
        {tab === 'plantillas' && <TabMailingPlantillas />}
        {tab === 'audiencias' && <TabMailingAudiencias />}
      </div>

      {/* Wizard de nuevo envío (4 pasos) */}
      <WizardNuevoEnvio
        abierto={wizardAbierto}
        onClose={() => setWizardAbierto(false)}
        onEnviado={() => cargarKpis()}
      />
    </div>
  )
}

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
        active ? 'border-blue-500 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  )
}

