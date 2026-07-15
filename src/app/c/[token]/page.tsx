'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Shield, AlertTriangle, Phone, FileWarning, User, Lock, Loader2, UserCircle, ChevronDown, MessageCircle } from 'lucide-react'
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
  telefonos_asistencia: (AsistenciaData & { telefono_2?: string | null; nombre_boton_2?: string | null })[]
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
  const [tabActiva, setTabActiva] = useState<'polizas' | 'siniestros' | 'cuenta'>('polizas')
  const [asistenciaAbierta, setAsistenciaAbierta] = useState(false)

  useEffect(() => {
    let alive = true

    async function cargar(esRefetch = false) {
      try {
        const res = await fetch(`/api/publico/portal-cliente/validar/${encodeURIComponent(token)}`)
        const json = await res.json()
        if (!alive) return

        if (!res.ok || !json.ok) {
          // En el refetch silencioso NO pisamos data cargada si vino un error
          // transitorio — el usuario tiene información válida en pantalla.
          if (esRefetch) return
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
        if (!esRefetch) {
          setError({
            titulo: 'Error de conexión',
            mensaje: 'No pudimos cargar tu portal. Verificá tu conexión e intentá nuevamente.',
            soft: true,
          })
        }
      } finally {
        if (!esRefetch) setCargando(false)
      }
    }

    cargar(false)

    // El portal público no puede suscribirse a Realtime (WS anon no pasa las
    // policies con auth.uid()). En su lugar, refetcheamos cuando la ventana
    // vuelve a foco — cubre el caso "el cliente dejó abierto el portal, después
    // el PAS cambió la póliza, el cliente vuelve a la tab". El intervalo largo
    // (5 min) también compensa reconexión mobile / suspend.
    const onFocus = () => cargar(true)
    const interval = setInterval(() => cargar(true), 5 * 60 * 1000)
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      window.removeEventListener('focus', onFocus)
      clearInterval(interval)
    }
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
          <div className="mt-6 min-w-0">
            <p className="text-sm font-medium" style={{ color: textoSecundarioHero }}>Hola</p>
            <h1 className="text-2xl font-bold mt-0.5 break-words">{nombreCliente}</h1>
            {data.portal.texto_bienvenida && (
              <p className="text-sm mt-2 leading-relaxed break-words" style={{ color: textoSecundarioHero }}>
                {data.portal.texto_bienvenida}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 -mt-12 flex flex-col gap-5 relative pb-6">
        {/* Banner instalar app */}
        <InstalarAppBanner colorMarca={data.organizacion.color_marca} />

        {/* ═══════════════════════════════════════════════════════ */}
        {/* BARRA DE ACCIONES RÁPIDAS                              */}
        {/* ═══════════════════════════════════════════════════════ */}
        <div className="bg-white rounded-2xl shadow-md border border-slate-200 p-3">
          <div className={`grid gap-2 ${data.telefonos_asistencia.length > 0 && whatsappUrl ? 'grid-cols-3' : data.telefonos_asistencia.length > 0 || whatsappUrl ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {/* Denunciar */}
            <a
              href={`/denuncia?token_cliente=${encodeURIComponent(token)}`}
              className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 min-h-[76px] transition-colors"
            >
              <FileWarning className="h-6 w-6" />
              <span className="text-xs font-semibold text-center leading-tight">Denunciar<br/>siniestro</span>
            </a>

            {/* Asistencia dropdown */}
            {data.telefonos_asistencia.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAsistenciaAbierta(v => !v)}
                  className="w-full flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 min-h-[76px] transition-colors"
                >
                  <Phone className="h-6 w-6" />
                  <span className="text-xs font-semibold text-center leading-tight flex items-center gap-0.5">
                    Asistencia<br/>24hs <ChevronDown className={`h-3 w-3 transition-transform ${asistenciaAbierta ? 'rotate-180' : ''}`} />
                  </span>
                </button>
                {asistenciaAbierta && (
                  <div className="absolute top-full mt-2 left-0 right-0 bg-white rounded-xl shadow-xl border border-slate-200 p-2 z-20 min-w-[220px]">
                    {data.telefonos_asistencia.map(a => (
                      <div key={a.compania_id} className="flex flex-col gap-1 mb-2 last:mb-0">
                        <div className="px-3 py-1 text-2xs uppercase tracking-wide text-slate-500 font-semibold">
                          {a.compania}
                        </div>
                        <a
                          href={`tel:${a.telefono.replace(/[^\d+]/g, '')}`}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-blue-50 text-sm text-slate-800"
                          onClick={() => setAsistenciaAbierta(false)}
                        >
                          <Phone className="h-3.5 w-3.5 text-blue-600" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{a.nombre_boton || 'Asistencia 24hs'}</p>
                            <p className="text-xs text-slate-500 font-mono">{a.telefono}</p>
                          </div>
                        </a>
                        {a.telefono_2 && (
                          <a
                            href={`tel:${a.telefono_2.replace(/[^\d+]/g, '')}`}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-blue-50 text-sm text-slate-800"
                            onClick={() => setAsistenciaAbierta(false)}
                          >
                            <Phone className="h-3.5 w-3.5 text-blue-600" />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium">{a.nombre_boton_2 || 'Otro'}</p>
                              <p className="text-xs text-slate-500 font-mono">{a.telefono_2}</p>
                            </div>
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* WhatsApp productor */}
            {whatsappUrl && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 min-h-[76px] transition-colors"
              >
                <MessageCircle className="h-6 w-6" />
                <span className="text-xs font-semibold text-center leading-tight">WhatsApp<br/>productor</span>
              </a>
            )}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════ */}
        {/* TABS NAV                                                */}
        {/* ═══════════════════════════════════════════════════════ */}
        <div className="flex border-b border-slate-200 bg-white rounded-t-2xl px-2 pt-1 -mb-3 shadow-sm">
          <TabButton activo={tabActiva === 'polizas'} onClick={() => setTabActiva('polizas')} icono={<Shield className="w-4 h-4" />} label="Mis pólizas" badge={data.polizas.length} />
          <TabButton activo={tabActiva === 'siniestros'} onClick={() => setTabActiva('siniestros')} icono={<AlertTriangle className="w-4 h-4" />} label="Siniestros" badge={data.siniestros.length} />
          <TabButton activo={tabActiva === 'cuenta'} onClick={() => setTabActiva('cuenta')} icono={<UserCircle className="w-4 h-4" />} label="Cuenta" />
        </div>

        {/* ═══════════════════════════════════════════════════════ */}
        {/* CONTENIDO POR TAB                                       */}
        {/* ═══════════════════════════════════════════════════════ */}
        {tabActiva === 'polizas' && (
          <section className="flex flex-col gap-3">
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
        )}

        {tabActiva === 'siniestros' && (
          <section className="flex flex-col gap-3">
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
        )}

        {tabActiva === 'cuenta' && (
          <div className="flex flex-col gap-4">
            {/* Mis datos */}
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

            {/* Mi productor */}
            <section>
              <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 px-1">
                <User className="h-3.5 w-3.5" />
                Mi productor
              </h2>
              <ProductorCard organizacion={data.organizacion} whatsappUrl={whatsappUrl} />
            </section>
          </div>
        )}
      </main>

      {/* Footer */}
      <FooterPortal organizacion={data.organizacion} />

      {/* WhatsApp flotante */}
      <WhatsAppFloatingButton url={whatsappUrl} />
    </div>
  )
}

/** Botón de tab del portal — usado en la nav horizontal del rediseño v1.0.126. */
function TabButton({
  activo,
  onClick,
  icono,
  label,
  badge,
}: {
  activo: boolean
  onClick: () => void
  icono: React.ReactNode
  label: string
  badge?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm border-b-2 transition-colors ${
        activo
          ? 'text-slate-900 border-slate-900 font-semibold'
          : 'text-slate-500 border-transparent hover:text-slate-700'
      }`}
    >
      {icono}
      {label}
      {typeof badge === 'number' && (
        <span
          className={`text-2xs font-bold px-1.5 py-0.5 rounded-lg min-w-[20px] text-center ${
            activo ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  )
}
