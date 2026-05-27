'use client'

import { useEffect, useRef, useState } from 'react'
import { Phone, Mail, MapPin, Edit3, Send, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

export interface DatosCliente {
  email: string
  email_secundario: string
  telefono: string
  telefono_secundario: string
  whatsapp: string
  direccion: {
    calle: string
    numero: string
    piso_depto: string
    barrio: string
    localidad: string
    provincia: string
    codigo_postal: string
  }
}

function formatoDireccion(d: DatosCliente['direccion']): string {
  const linea1 = [d.calle, d.numero].filter(Boolean).join(' ')
  const piso = d.piso_depto ? `, ${d.piso_depto}` : ''
  const linea2 = [d.barrio, d.localidad, d.provincia, d.codigo_postal].filter(Boolean).join(', ')
  if (!linea1 && !linea2) return ''
  return [linea1 + piso, linea2].filter(Boolean).join(' — ')
}

export default function MisDatosSection({
  datos,
  token,
}: {
  datos: DatosCliente
  token: string
}) {
  const [modalAbierto, setModalAbierto] = useState(false)
  const [telefonoNuevo, setTelefonoNuevo] = useState('')
  const [emailNuevo, setEmailNuevo] = useState('')
  const [direccionNueva, setDireccionNueva] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null)
  const primerInputRef = useRef<HTMLInputElement | null>(null)

  // a11y: cerrar con Escape y enfocar el primer input al abrir.
  useEffect(() => {
    if (!modalAbierto) return
    primerInputRef.current?.focus()
    const handler = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cerrarModal() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalAbierto])

  const direccion = formatoDireccion(datos.direccion)

  function abrirModal() {
    setTelefonoNuevo('')
    setEmailNuevo('')
    setDireccionNueva('')
    setMensaje('')
    setResultado(null)
    setModalAbierto(true)
  }

  function cerrarModal() {
    setModalAbierto(false)
  }

  async function enviar() {
    if (!telefonoNuevo.trim() && !emailNuevo.trim() && !direccionNueva.trim() && !mensaje.trim()) {
      setResultado({ ok: false, texto: 'Indicá al menos un campo a corregir.' })
      return
    }
    setEnviando(true)
    setResultado(null)
    try {
      const res = await fetch(`/api/publico/portal-cliente/sugerir-correccion/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telefono: telefonoNuevo.trim(),
          email: emailNuevo.trim(),
          direccion: direccionNueva.trim(),
          mensaje: mensaje.trim(),
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setResultado({ ok: false, texto: json?.error || 'No se pudo enviar la sugerencia. Intentá más tarde.' })
      } else {
        setResultado({ ok: true, texto: 'Tu sugerencia llegó al productor. Te contactará si necesita confirmar algo.' })
      }
    } catch {
      setResultado({ ok: false, texto: 'No pudimos conectar. Verificá tu conexión.' })
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 flex flex-col gap-3">
          {datos.telefono && (
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <Phone className="h-4 w-4 text-slate-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-2xs uppercase tracking-wide text-slate-400">Teléfono</p>
                <p className="text-sm text-slate-800 truncate">{datos.telefono}</p>
              </div>
            </div>
          )}
          {datos.email && (
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <Mail className="h-4 w-4 text-slate-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-2xs uppercase tracking-wide text-slate-400">Email</p>
                <p className="text-sm text-slate-800 truncate">{datos.email}</p>
              </div>
            </div>
          )}
          {direccion && (
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                <MapPin className="h-4 w-4 text-slate-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-2xs uppercase tracking-wide text-slate-400">Dirección</p>
                <p className="text-sm text-slate-800">{direccion}</p>
              </div>
            </div>
          )}
          {!datos.telefono && !datos.email && !direccion && (
            <p className="text-xs text-slate-400 text-center py-3">
              Tu productor todavía no cargó tus datos de contacto.
            </p>
          )}
        </div>
        <button
          onClick={abrirModal}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50 active:bg-blue-100 border-t border-slate-100 min-h-[48px]"
        >
          <Edit3 className="h-4 w-4" />
          Sugerir corrección
        </button>
      </div>

      {/* Modal */}
      {modalAbierto && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={cerrarModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="sugerir-correccion-titulo"
        >
          <div
            className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 id="sugerir-correccion-titulo" className="text-base font-semibold text-slate-800">Sugerir corrección</h3>
              <button
                onClick={cerrarModal}
                className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <p className="text-sm text-slate-600 leading-relaxed">
                Si alguno de tus datos cambió, escribilo abajo. Le va a llegar una sugerencia a tu productor para que la actualice.
              </p>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono nuevo</label>
                <input
                  ref={primerInputRef}
                  type="tel"
                  value={telefonoNuevo}
                  onChange={e => setTelefonoNuevo(e.target.value)}
                  placeholder="Dejalo vacío si no cambia"
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email nuevo</label>
                <input
                  type="email"
                  value={emailNuevo}
                  onChange={e => setEmailNuevo(e.target.value)}
                  placeholder="Dejalo vacío si no cambia"
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Dirección nueva</label>
                <input
                  type="text"
                  value={direccionNueva}
                  onChange={e => setDireccionNueva(e.target.value)}
                  placeholder="Calle, número, localidad..."
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Mensaje adicional</label>
                <textarea
                  rows={3}
                  value={mensaje}
                  onChange={e => setMensaje(e.target.value)}
                  placeholder="Aclaración opcional..."
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 resize-none"
                />
              </div>

              {resultado && (
                <div className={`flex items-start gap-2 p-3 rounded-lg text-xs ${
                  resultado.ok
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {resultado.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  )}
                  <span>{resultado.texto}</span>
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-slate-200 flex gap-2">
              <button
                onClick={cerrarModal}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg min-h-[44px]"
              >
                Cancelar
              </button>
              <button
                onClick={enviar}
                disabled={enviando || (resultado?.ok ?? false)}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg min-h-[44px] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {enviando ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Enviando...
                  </>
                ) : resultado?.ok ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Enviado
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Enviar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
