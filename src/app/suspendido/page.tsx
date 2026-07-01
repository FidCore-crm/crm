'use client'

/**
 * Pantalla de servicio suspendido — solo aplica en modo VPS (SaaS-managed).
 *
 * A dónde llegás:
 *   - Login del CRM devolvió 403 SERVICIO_SUSPENDIDO → el frontend redirige acá.
 *   - Estabas logueado y una request devolvió estado_servicio suspendido → redirect.
 *
 * Muestra:
 *   - Logo del PAS (el que él configuró) para que el asegurado / staff se ubique.
 *   - Mensaje "Servicio temporalmente suspendido".
 *   - Motivo (si lo hay) traído del backend.
 *   - Contacto: info@fidcore.com.ar (solo email, sin WhatsApp — decisión del producto).
 *
 * NO tiene form de login. NO tiene botones que lleven a otros lados del CRM.
 * Un intento de ir al login se topa con el mismo 403 y termina redirigido acá.
 */

import { useEffect, useState } from 'react'
import { AlertCircle, Mail } from 'lucide-react'
import { gradientDeColorMarca } from '@/lib/color-marca'

interface Branding {
  nombre: string
  logo_url: string | null
  color_marca: string | null
}

interface EstadoSuspension {
  motivo: string | null
  fecha_suspension: string | null
}

function formatearFecha(iso: string | null): string | null {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export default function SuspendidoPage() {
  const [branding, setBranding] = useState<Branding | null>(null)
  const [suspension, setSuspension] = useState<EstadoSuspension>({ motivo: null, fecha_suspension: null })

  useEffect(() => {
    fetch('/api/publico/organizacion')
      .then((r) => r.json())
      .then((d) =>
        setBranding({
          nombre: d?.nombre || '',
          logo_url: d?.logo_url || null,
          color_marca: d?.color_marca || null,
        }),
      )
      .catch(() => setBranding({ nombre: '', logo_url: null, color_marca: null }))

    // Traer motivo y fecha desde el login endpoint (que aunque falle el auth,
    // si es SERVICIO_SUSPENDIDO devuelve el detalle).
    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '__ping__', password: '__ping__' }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j?.estado === 'SERVICIO_SUSPENDIDO') {
          setSuspension({
            motivo: j.motivo ?? null,
            fecha_suspension: j.fecha_suspension ?? null,
          })
        }
      })
      .catch(() => {})
  }, [])

  const nombre = (branding?.nombre || '').trim()
  const bg = branding?.color_marca
    ? gradientDeColorMarca(branding.color_marca)
    : 'linear-gradient(135deg, #0F172A 0%, #1E3A5F 60%, #2A4A7A 100%)'
  const fechaFormat = formatearFecha(suspension.fecha_suspension)

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10" style={{ background: bg }}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header con logo o nombre del PAS */}
        <div className="px-8 pt-8 pb-6 text-center border-b border-slate-100">
          {branding?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.logo_url}
              alt={nombre}
              className="mx-auto h-16 w-auto max-w-[240px] object-contain"
              draggable={false}
            />
          ) : nombre ? (
            <div className="text-2xl font-semibold text-slate-800 tracking-tight">{nombre}</div>
          ) : null}
        </div>

        {/* Cuerpo del mensaje */}
        <div className="px-8 py-8 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 mb-4">
            <AlertCircle className="h-7 w-7 text-amber-600" />
          </div>
          <h1 className="text-xl font-semibold text-slate-800 tracking-tight">
            Servicio temporalmente suspendido
          </h1>
          <p className="text-sm text-slate-600 mt-3 leading-relaxed">
            El servicio tiene un pago pendiente. Contactanos para regularizar la
            suscripción y reactivar tu cuenta.
          </p>

          {suspension.motivo && (
            <div className="mt-5 p-3 rounded-lg bg-slate-50 border border-slate-200 text-left">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Motivo</p>
              <p className="text-sm text-slate-700">{suspension.motivo}</p>
            </div>
          )}

          {fechaFormat && (
            <p className="text-2xs text-slate-400 mt-3">Suspendido desde el {fechaFormat}</p>
          )}
        </div>

        {/* Footer con contacto */}
        <div className="bg-slate-50 px-8 py-5 border-t border-slate-100">
          <p className="text-xs text-slate-500 text-center mb-2">Para reactivar tu servicio, escribinos a:</p>
          <a
            href="mailto:info@fidcore.com.ar"
            className="flex items-center justify-center gap-2 text-sm font-semibold text-slate-800 hover:text-slate-900"
          >
            <Mail className="h-4 w-4" />
            info@fidcore.com.ar
          </a>
        </div>
      </div>
    </div>
  )
}
