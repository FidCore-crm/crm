'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Shield, AlertTriangle, Phone, FileWarning, User, Lock, Loader2, UserCircle } from 'lucide-react'
import PolizaCard, { PolizaData } from './components/PolizaCard'
import SiniestroCard, { SiniestroData } from './components/SiniestroCard'
import AsistenciaButton, { AsistenciaData } from './components/AsistenciaButton'
import ProductorCard, { OrganizacionData } from './components/ProductorCard'
import WhatsAppFloatingButton from './components/WhatsAppFloatingButton'
import MisDatosSection, { DatosCliente } from './components/MisDatosSection'
import FooterPortal from './components/FooterPortal'
import InstalarAppBanner from './components/InstalarAppBanner'
import { gradientDeColorMarca } from '@/lib/color-marca'

interface PortalData {
  cliente: {
    id: string
    nombre: string | null
    apellido: string
    razon_social: string | null
    tipo_persona: string
    nombre_mostrar: string
    nombre_completo: string
    email: string
    email_secundario: string
    telefono: string
    telefono_secundario: string
    whatsapp: string
    direccion: DatosCliente['direccion']
  }
  polizas: PolizaData[]
  siniestros: SiniestroData[]
  telefonos_asistencia: AsistenciaData[]
  organizacion: OrganizacionData & { matriculado: boolean }
  portal: {
    texto_bienvenida: string
  }
}

function construirWhatsAppUrl(organizacion: OrganizacionData, nombreCliente: string): string {
  const tel = (organizacion.whatsapp || organizacion.telefono || '').replace(/[^\d]/g, '')
  if (!tel) return ''
  const mensaje = `Hola, soy ${nombreCliente || 'un cliente'}. Consulta: `
  return `https://wa.me/${tel}?text=${encodeURIComponent(mensaje)}`
}

export default function PortalAseguradoPage() {
  const params = useParams()
  const token = params.token as string
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<{ titulo: string; mensaje: string; soft: boolean } | null>(null)
  const [data, setData] = useState<PortalData | null>(null)

  useEffect(() => {
    async function cargar() {
      try {
        const res = await fetch(`/api/publico/portal-cliente/validar/${encodeURIComponent(token)}`)
        const json = await res.json()

        if (!res.ok || !json.ok) {
          if (res.status === 503) {
            setError({
              titulo: 'Portal temporalmente no disponible',
              mensaje: 'El portal del asegurado está desactivado en este momento. Intentá más tarde.',
              soft: true,
            })
          } else {
            setError({
              titulo: 'Acceso no disponible',
              mensaje:
                json?.error ||
                'Este enlace ya no está disponible. Contactá a tu productor para obtener un nuevo acceso.',
              soft: false,
            })
          }
          return
        }

        setData(json as PortalData)
      } catch {
        setError({
          titulo: 'Error de conexión',
          mensaje: 'No pudimos cargar tu portal. Verificá tu conexión e intentá nuevamente.',
          soft: true,
        })
      } finally {
        setCargando(false)
      }
    }
    cargar()
  }, [token])

  if (cargando) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <Loader2 className="h-5 w-5 animate-spin" />
          Cargando tu portal...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
            <Lock className="h-6 w-6 text-slate-500" />
          </div>
          <h1 className="text-lg font-semibold text-slate-800">{error.titulo}</h1>
          <p className="text-sm text-slate-500 mt-2 leading-relaxed">{error.mensaje}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  const nombreCliente = data.cliente.nombre_mostrar || data.cliente.nombre || data.cliente.apellido
  const whatsappUrl = construirWhatsAppUrl(data.organizacion, data.cliente.nombre_completo)
  const logoUrl = data.organizacion.logo_path ? `/api/storage/${data.organizacion.logo_path}` : null
  // Gradient generado a partir del color de marca del PAS (oscuro → base →
  // vibrante). Si el PAS no eligió color, queda el navy default. Coherente con
  // el theme del PWA manifest y con el portal de denuncia.
  const heroBg = gradientDeColorMarca(data.organizacion.color_marca)
  const heroTextColor = '#FFFFFF'
  const textoSecundarioHero = 'rgba(255,255,255,0.85)'

  return (
    <div className="min-h-screen bg-slate-50 pb-4">
      {/* Hero con gradient navy estándar (no usa color de marca) */}
      <header
        className="relative pb-16"
        style={{ background: heroBg, color: heroTextColor }}
      >
        <div className="max-w-3xl mx-auto px-4 pt-6 pb-8">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {/* Logo en círculo blanco — el logo ocupa casi todo el diámetro */}
              <div className="h-14 w-14 rounded-full bg-white shadow-md flex items-center justify-center shrink-0 overflow-hidden p-1">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={data.organizacion.nombre}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <Shield className="h-7 w-7 text-blue-700" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-2xs uppercase tracking-wider font-medium" style={{ color: textoSecundarioHero }}>
                  Mi portal
                </p>
                <p className="text-base font-semibold truncate">{data.organizacion.nombre || 'Mi seguro'}</p>
              </div>
            </div>
          </div>

          {/* Saludo prominente */}
          <div className="mt-6">
            <p className="text-sm font-medium" style={{ color: textoSecundarioHero }}>Hola</p>
            <h1 className="text-2xl font-bold mt-0.5">{nombreCliente}</h1>
            {data.portal.texto_bienvenida && (
              <p className="text-sm mt-2 leading-relaxed" style={{ color: textoSecundarioHero }}>
                {data.portal.texto_bienvenida}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 -mt-12 flex flex-col gap-6 relative">
        {/* Banner instalar app — primero después del hero para que el cliente
            lo vea apenas entra (solo si no está instalada y el navegador lo
            soporta). */}
        <InstalarAppBanner colorMarca={data.organizacion.color_marca} />

        {/* Resumen rápido */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
              <Shield className="h-5 w-5 text-blue-700" />
            </div>
            <div className="min-w-0">
              <p className="text-2xs text-slate-500 uppercase tracking-wide">Pólizas</p>
              <p className="text-xl font-bold text-slate-800">{data.polizas.length}</p>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-5 w-5 text-amber-700" />
            </div>
            <div className="min-w-0">
              <p className="text-2xs text-slate-500 uppercase tracking-wide">Siniestros</p>
              <p className="text-xl font-bold text-slate-800">{data.siniestros.length}</p>
            </div>
          </div>
        </div>

        {/* MIS PÓLIZAS */}
        <section>
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 px-1">
            <Shield className="h-3.5 w-3.5" />
            Mis pólizas
            {data.polizas.length > 0 && (
              <span className="ml-auto text-2xs font-medium normal-case tracking-normal text-slate-400">
                {data.polizas.length} {data.polizas.length === 1 ? 'póliza' : 'pólizas'}
              </span>
            )}
          </h2>
          {data.polizas.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
              <Shield className="h-10 w-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No tenés pólizas vigentes actualmente.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {data.polizas.map(p => (
                <PolizaCard key={p.id} poliza={p} token={token} />
              ))}
            </div>
          )}
        </section>

        {/* MIS SINIESTROS */}
        <section>
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 px-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            Mis siniestros
            {data.siniestros.length > 0 && (
              <span className="ml-auto text-2xs font-medium normal-case tracking-normal text-slate-400">
                {data.siniestros.length} {data.siniestros.length === 1 ? 'siniestro' : 'siniestros'}
              </span>
            )}
          </h2>
          {data.siniestros.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
              <AlertTriangle className="h-10 w-10 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No tenés siniestros registrados.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {data.siniestros.map(s => (
                <SiniestroCard key={s.id} siniestro={s} token={token} />
              ))}
            </div>
          )}
        </section>

        {/* DENUNCIAR SINIESTRO */}
        <section>
          <div className="bg-gradient-to-br from-red-50 to-orange-50 border border-red-200 rounded-2xl p-5 flex flex-col items-center text-center gap-3">
            <div className="h-14 w-14 rounded-full bg-red-100 flex items-center justify-center">
              <FileWarning className="h-7 w-7 text-red-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-800">¿Tuviste un siniestro?</h3>
              <p className="text-xs text-slate-600 mt-1">Denuncialo rápido desde acá</p>
            </div>
            <a
              href={`/denuncia?token_cliente=${encodeURIComponent(token)}`}
              className="w-full bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-semibold px-4 py-3 rounded-xl text-center min-h-[48px] flex items-center justify-center transition-colors shadow-sm"
            >
              Denunciar ahora
            </a>
          </div>
        </section>

        {/* TELÉFONOS DE UTILIDAD */}
        {data.telefonos_asistencia.length > 0 && (
          <section>
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 px-1">
              <Phone className="h-3.5 w-3.5" />
              Teléfonos de utilidad
            </h2>
            <div className="flex flex-col gap-2.5">
              {data.telefonos_asistencia.map(a => (
                <AsistenciaButton key={a.compania_id} asistencia={a} />
              ))}
            </div>
          </section>
        )}

        {/* MIS DATOS */}
        <section>
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 px-1">
            <UserCircle className="h-3.5 w-3.5" />
            Mis datos
          </h2>
          <MisDatosSection
            datos={{
              email: data.cliente.email,
              email_secundario: data.cliente.email_secundario,
              telefono: data.cliente.telefono,
              telefono_secundario: data.cliente.telefono_secundario,
              whatsapp: data.cliente.whatsapp,
              direccion: data.cliente.direccion,
            }}
            token={token}
          />
        </section>

        {/* MI PRODUCTOR */}
        <section>
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 px-1">
            <User className="h-3.5 w-3.5" />
            Mi productor
          </h2>
          <ProductorCard organizacion={data.organizacion} whatsappUrl={whatsappUrl} />
        </section>
      </main>

      {/* Footer */}
      <FooterPortal organizacion={data.organizacion} />

      {/* WhatsApp flotante */}
      <WhatsAppFloatingButton url={whatsappUrl} />
    </div>
  )
}
