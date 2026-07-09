'use client'

import { Phone, Mail, MessageCircle } from 'lucide-react'

export interface OrganizacionData {
  nombre: string
  telefono: string
  whatsapp: string
  email: string
  logo_path: string | null
  color_marca?: string | null
}

export default function ProductorCard({
  organizacion,
  whatsappUrl,
}: {
  organizacion: OrganizacionData
  whatsappUrl: string
}) {
  const logoUrl = organizacion.logo_path ? `/api/storage/${organizacion.logo_path}` : null

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="p-5 flex flex-col items-center text-center gap-3">
        {/* Logo en círculo blanco — el logo llena el círculo */}
        <div className="h-20 w-20 rounded-full bg-white border-2 border-slate-100 shadow-sm flex items-center justify-center overflow-hidden p-1.5">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={organizacion.nombre}
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="text-2xl font-bold text-blue-700">
              {organizacion.nombre.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        <div className="min-w-0 w-full">
          <h3 className="text-base font-semibold text-slate-800 break-words">{organizacion.nombre}</h3>
          <p className="text-xs text-slate-500 mt-0.5">Tu productor de seguros</p>
        </div>
      </div>

      <div className="border-t border-slate-100 divide-y divide-slate-50">
        {organizacion.telefono && (
          <a
            href={`tel:${organizacion.telefono.replace(/[^\d+]/g, '')}`}
            className="flex items-center gap-3 px-5 py-3 text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 min-h-[48px]"
          >
            <Phone className="h-4 w-4 text-slate-400 shrink-0" />
            <span className="min-w-0 break-words">{organizacion.telefono}</span>
          </a>
        )}
        {organizacion.email && (
          <a
            href={`mailto:${organizacion.email}`}
            className="flex items-center gap-3 px-5 py-3 text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 min-h-[48px]"
          >
            <Mail className="h-4 w-4 text-slate-400 shrink-0" />
            <span className="min-w-0 break-all">{organizacion.email}</span>
          </a>
        )}
      </div>

      {whatsappUrl && (
        <div className="p-4 border-t border-slate-100">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full bg-[#25D366] hover:bg-[#20ba5a] active:bg-[#1ca34f] text-white font-semibold px-4 py-3 rounded-lg min-h-[48px] transition-colors"
          >
            <MessageCircle className="h-5 w-5" />
            Hablar por WhatsApp
          </a>
        </div>
      )}
    </div>
  )
}
