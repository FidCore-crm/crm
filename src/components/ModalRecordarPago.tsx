'use client'

/**
 * Modal "Recordar pago" desde la ficha de póliza. Le ofrece al PAS dos
 * canales para enviar el recordatorio: Email (con la plantilla
 * `recordatorio_pago` de `plantillas_email`) o WhatsApp (con la plantilla
 * `recordatorio_pago` de `plantillas_whatsapp`).
 *
 * Para Email delega en `ModalEnviarEmail` con `plantillaInicial='recordatorio_pago'`.
 * Para WhatsApp arma la URL `wa.me` con el mensaje renderizado desde la
 * plantilla y abre nueva pestaña.
 *
 * Cada canal se habilita solo si tiene los datos mínimos (email vs teléfono)
 * y muestra tooltip cuando no aplica.
 */

import { useEffect, useState } from 'react'
import { Mail, MessageCircle, X, Loader2 } from 'lucide-react'
import { construirUrlWhatsapp } from '@/lib/whatsapp-templates'
import ModalEnviarEmail from '@/components/ModalEnviarEmail'

interface PolizaInfo {
  id: string
  numero_poliza: string
  compania: string
  ramo: string
}

interface PersonaInfo {
  id: string
  nombre: string
  apellido: string
  email: string | null
  telefono: string | null
  whatsapp: string | null
  acepta_marketing?: boolean
}

interface Props {
  abierto: boolean
  onClose: () => void
  poliza: PolizaInfo
  persona: PersonaInfo
  smtpConfigurado: boolean
  comunicacionesActivo: boolean
  onEmailEnviado?: () => void
}

export default function ModalRecordarPago({
  abierto,
  onClose,
  poliza,
  persona,
  smtpConfigurado,
  comunicacionesActivo,
  onEmailEnviado,
}: Props) {
  const [modalEmailAbierto, setModalEmailAbierto] = useState(false)
  const [previewWhatsapp, setPreviewWhatsapp] = useState('')
  const [cargandoPreview, setCargandoPreview] = useState(false)

  // Pre-renderizar el mensaje de WhatsApp para el preview
  useEffect(() => {
    if (!abierto) return
    setCargandoPreview(true)
    const tel = persona.whatsapp || persona.telefono || ''
    construirUrlWhatsapp('recordatorio_pago', tel, {
      nombre: persona.nombre,
      apellido: persona.apellido,
      numero_poliza: poliza.numero_poliza,
      compania: poliza.compania,
      ramo: poliza.ramo,
    }).then(url => {
      try {
        const text = decodeURIComponent(url.split('?text=')[1] ?? '')
        setPreviewWhatsapp(text)
      } catch {
        setPreviewWhatsapp('')
      }
      setCargandoPreview(false)
    })
  }, [abierto, persona, poliza])

  if (!abierto) return null

  // Análisis de canales disponibles
  const tieneEmail = !!persona.email
  const tieneTel = !!(persona.whatsapp || persona.telefono)
  const emailHabilitado = tieneEmail && smtpConfigurado && comunicacionesActivo

  let tooltipEmail = 'Enviar recordatorio por email'
  if (!comunicacionesActivo) tooltipEmail = 'El sistema de comunicaciones está desactivado'
  else if (!smtpConfigurado) tooltipEmail = 'Configurá SMTP en Configuración → Correos'
  else if (!tieneEmail) tooltipEmail = 'El cliente no tiene email cargado'

  let tooltipWa = 'Abrir WhatsApp con el mensaje preparado'
  if (!tieneTel) tooltipWa = 'El cliente no tiene teléfono ni WhatsApp cargado'

  async function abrirWhatsapp() {
    const tel = persona.whatsapp || persona.telefono || ''
    const url = await construirUrlWhatsapp('recordatorio_pago', tel, {
      nombre: persona.nombre,
      apellido: persona.apellido,
      numero_poliza: poliza.numero_poliza,
      compania: poliza.compania,
      ramo: poliza.ramo,
    })
    window.open(url, '_blank', 'noopener,noreferrer')
    onClose()
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-lg shadow-xl w-full max-w-md flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-800">Recordar pago al cliente</h2>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Resumen del destinatario */}
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 text-xs">
            <div className="text-slate-700">
              <span className="font-medium">{persona.apellido}{persona.nombre ? `, ${persona.nombre}` : ''}</span>
            </div>
            <div className="text-2xs text-slate-500 mt-0.5">
              Póliza <span className="font-mono">{poliza.numero_poliza}</span> · {poliza.compania} · {poliza.ramo}
            </div>
          </div>

          {/* Opciones de canal */}
          <div className="px-4 py-4 flex flex-col gap-2">
            <p className="text-2xs text-slate-500 mb-1">Elegí cómo enviar el recordatorio:</p>

            <button
              onClick={() => setModalEmailAbierto(true)}
              disabled={!emailHabilitado}
              title={tooltipEmail}
              className="flex items-center gap-3 px-3 py-2.5 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-50"
            >
              <Mail className="h-4 w-4 text-blue-600 shrink-0" />
              <div className="flex-1">
                <div className="text-xs font-medium text-slate-800">Por email</div>
                <div className="text-2xs text-slate-500 truncate">
                  {tieneEmail ? persona.email : 'Sin email cargado'}
                </div>
              </div>
            </button>

            <button
              onClick={abrirWhatsapp}
              disabled={!tieneTel}
              title={tooltipWa}
              className="flex items-center gap-3 px-3 py-2.5 rounded border border-green-200 bg-green-50 hover:bg-green-100 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-green-50"
            >
              <MessageCircle className="h-4 w-4 text-green-600 shrink-0" />
              <div className="flex-1">
                <div className="text-xs font-medium text-slate-800">Por WhatsApp</div>
                <div className="text-2xs text-slate-500 truncate">
                  {tieneTel
                    ? (persona.whatsapp || persona.telefono)
                    : 'Sin teléfono ni WhatsApp cargado'}
                </div>
              </div>
            </button>

            {/* Preview del WhatsApp */}
            {tieneTel && (
              <div className="mt-2 border-t border-slate-100 pt-3">
                <p className="text-2xs text-slate-500 mb-1 font-medium uppercase">
                  Vista previa del mensaje de WhatsApp:
                </p>
                {cargandoPreview ? (
                  <div className="flex items-center gap-2 text-2xs text-slate-400">
                    <Loader2 className="h-3 w-3 animate-spin" /> Cargando...
                  </div>
                ) : (
                  <div className="bg-slate-50 border border-slate-200 rounded p-2 text-2xs text-slate-700 whitespace-pre-wrap font-mono max-h-32 overflow-y-auto">
                    {previewWhatsapp || '(plantilla vacía)'}
                  </div>
                )}
                <p className="text-2xs text-slate-400 mt-1">
                  Podés editar la plantilla en Configuración → Comunicaciones → tab WhatsApp.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sub-modal: envío por email */}
      {modalEmailAbierto && (
        <ModalEnviarEmail
          isOpen={true}
          onClose={() => setModalEmailAbierto(false)}
          persona={{
            id: persona.id,
            nombre: persona.nombre,
            apellido: persona.apellido,
            email: persona.email,
            acepta_marketing: persona.acepta_marketing,
          }}
          poliza={poliza}
          plantillaInicial="recordatorio_pago"
          onSuccess={() => {
            setModalEmailAbierto(false)
            onClose()
            if (onEmailEnviado) onEmailEnviado()
          }}
        />
      )}
    </>
  )
}
