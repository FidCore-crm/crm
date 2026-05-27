'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Mail, Send, Eye, MousePointerClick, Clock, AlertTriangle,
  Settings, RefreshCw, Plus,
} from 'lucide-react'
import { apiCall } from '@/lib/api-client'
import { useAuth } from '@/contexts/AuthContext'
import { useEmailConfigurado } from '@/lib/hooks/useEmailConfigurado'
import ComunicacionesTab from '@/components/ComunicacionesTab'
import SelectorDestinatariosModal from '@/components/SelectorDestinatariosModal'
import ModalEnviarEmail from '@/components/ModalEnviarEmail'
import ModalEnviarEmailMasivo from '@/components/ModalEnviarEmailMasivo'

interface Kpis {
  enviados_mes: number
  aperturas_mes: number
  clicks_mes: number
  en_cola: number
  fallidos_mes: number
  tasa_apertura: number
  tasa_click: number
}

interface PersonaParaEnvio {
  id: string
  nombre: string | null
  apellido: string
  razon_social: string | null
  email: string | null
  acepta_marketing: boolean
}

export default function ComunicacionesPage() {
  const { isAdmin } = useAuth()
  const { configurado: smtpConfigurado, testExitoso, isLoading: smtpLoading } = useEmailConfigurado()

  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [cargandoKpis, setCargandoKpis] = useState(true)
  const [tabActiva, setTabActiva] = useState<'historial' | 'plantillas'>('historial')

  // Modales
  const [selectorAbierto, setSelectorAbierto] = useState(false)
  const [personaIndividual, setPersonaIndividual] = useState<PersonaParaEnvio | null>(null)
  const [personasMasivo, setPersonasMasivo] = useState<PersonaParaEnvio[] | null>(null)

  const cargarKpis = useCallback(async () => {
    setCargandoKpis(true)
    const r = await apiCall<{ kpis: Kpis }>('/api/comunicaciones/kpis', undefined, { mostrar_toast_en_error: false })
    if (r.ok && r.data) setKpis(r.data.kpis)
    setCargandoKpis(false)
  }, [])

  useEffect(() => { cargarKpis() }, [cargarKpis])

  function abrirNuevoEnvio() {
    setSelectorAbierto(true)
  }

  function handleElegirIndividual(persona: PersonaParaEnvio) {
    setSelectorAbierto(false)
    setPersonaIndividual(persona)
  }

  function handleElegirMasivo(personas: PersonaParaEnvio[]) {
    setSelectorAbierto(false)
    setPersonasMasivo(personas)
  }

  return (
    <div className="flex flex-col gap-3">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Comunicaciones</h1>
          <p className="text-xs text-slate-500">
            Historial completo de emails, envíos masivos y plantillas configurables.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Link href="/crm/configuracion/comunicaciones" className="btn-secondary flex items-center gap-1.5">
              <Settings className="h-3.5 w-3.5" />
              Configurar plantillas
            </Link>
          )}
          <button
            onClick={abrirNuevoEnvio}
            disabled={!smtpLoading && !smtpConfigurado}
            className="btn-primary flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              !smtpLoading && !smtpConfigurado
                ? 'Configurá el servidor SMTP en Configuración → Correos para empezar a enviar emails'
                : 'Crear un envío de email'
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Nuevo envío
          </button>
        </div>
      </div>

      {/* Banner SMTP no configurado */}
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
              <Settings className="h-3.5 w-3.5" />
              Configurar ahora
            </Link>
          )}
        </div>
      )}

      {/* Banner test SMTP nunca exitoso (configurado pero el test falló o no se hizo) */}
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
            <Send className="h-3 w-3 text-blue-600" />
            Enviados este mes
          </span>
          <span className="kpi-value text-blue-700">
            {cargandoKpis ? '…' : (kpis?.enviados_mes ?? 0).toLocaleString('es-AR')}
          </span>
          <span className="kpi-sub">emails entregados</span>
        </div>
        <div className="kpi-card bg-emerald-50 border border-emerald-200">
          <span className="kpi-label flex items-center gap-1">
            <Eye className="h-3 w-3 text-emerald-600" />
            Aperturas
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
            <MousePointerClick className="h-3 w-3 text-violet-600" />
            Clicks
          </span>
          <span className="kpi-value text-violet-700">
            {cargandoKpis ? '…' : (kpis?.clicks_mes ?? 0).toLocaleString('es-AR')}
          </span>
          <span className="kpi-sub">
            {cargandoKpis ? ' ' : `${kpis?.tasa_click ?? 0}% del total`}
          </span>
        </div>
        <div className="kpi-card bg-amber-50 border border-amber-200">
          <span className="kpi-label flex items-center gap-1">
            <Clock className="h-3 w-3 text-amber-600" />
            En cola
          </span>
          <span className="kpi-value text-amber-700">
            {cargandoKpis ? '…' : (kpis?.en_cola ?? 0).toLocaleString('es-AR')}
          </span>
          <span className="kpi-sub">esperando envío</span>
        </div>
        <div className={`kpi-card border ${kpis && kpis.fallidos_mes > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
          <span className="kpi-label flex items-center gap-1">
            <AlertTriangle className={`h-3 w-3 ${kpis && kpis.fallidos_mes > 0 ? 'text-red-600' : 'text-slate-400'}`} />
            Fallidos este mes
          </span>
          <span className={`kpi-value ${kpis && kpis.fallidos_mes > 0 ? 'text-red-700' : 'text-slate-500'}`}>
            {cargandoKpis ? '…' : (kpis?.fallidos_mes ?? 0).toLocaleString('es-AR')}
          </span>
          <span className="kpi-sub">no entregados</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <button
          onClick={() => setTabActiva('historial')}
          className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
            tabActiva === 'historial'
              ? 'border-blue-500 text-blue-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Historial global
        </button>
        {isAdmin && (
          <Link
            href="/crm/configuracion/comunicaciones"
            className="px-3 py-2 text-xs font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700"
          >
            Plantillas y configuración →
          </Link>
        )}
      </div>

      {/* Tabla historial global */}
      <ComunicacionesTab global />

      {/* Selector destinatarios */}
      <SelectorDestinatariosModal
        abierto={selectorAbierto}
        onClose={() => setSelectorAbierto(false)}
        onElegirIndividual={handleElegirIndividual}
        onElegirMasivo={handleElegirMasivo}
      />

      {/* Modal envío individual */}
      {personaIndividual && (
        <ModalEnviarEmail
          isOpen={true}
          onClose={() => setPersonaIndividual(null)}
          persona={{
            id: personaIndividual.id,
            nombre: personaIndividual.nombre || '',
            apellido: personaIndividual.apellido,
            email: personaIndividual.email,
            acepta_marketing: personaIndividual.acepta_marketing,
          }}
          onSuccess={() => {
            setPersonaIndividual(null)
            cargarKpis()
          }}
        />
      )}

      {/* Modal envío masivo */}
      {personasMasivo && (
        <ModalEnviarEmailMasivo
          isOpen={true}
          onClose={() => setPersonasMasivo(null)}
          personas={personasMasivo.map(p => ({
            id: p.id,
            nombre: p.nombre || '',
            apellido: p.apellido,
            email: p.email,
            acepta_marketing: p.acepta_marketing,
          }))}
          contexto="CLIENTE"
          onSuccess={() => {
            setPersonasMasivo(null)
            cargarKpis()
          }}
        />
      )}
    </div>
  )
}
