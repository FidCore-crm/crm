'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Save, Loader2, CheckCircle, AlertTriangle,
  Lock, Send, X
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'

function Campo({ label, required, ayuda, children }: {
  label: string; required?: boolean; ayuda?: string; children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {ayuda && <p className="text-2xs text-slate-500 mt-1">{ayuda}</p>}
    </div>
  )
}

export default function CorreosPage() {
  const router = useRouter()
  const { usuario, loading: authLoading, isAdmin } = useAuth()

  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [exito, setExito] = useState(false)
  const [errorGral, setErrorGral] = useState('')

  // Estado del sistema
  const [encryptionDisponible, setEncryptionDisponible] = useState(true)
  const [configurado, setConfigurado] = useState(false)
  const [ultimoTest, setUltimoTest] = useState<string | null>(null)
  const [ultimoTestExitoso, setUltimoTestExitoso] = useState<boolean | null>(null)

  // SMTP
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpSecure, setSmtpSecure] = useState(false)
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [tienePassword, setTienePassword] = useState(false)
  const [editandoPassword, setEditandoPassword] = useState(false)

  // Remitente
  const [fromName, setFromName] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [firmaHtml, setFirmaHtml] = useState('')

  // Modal test
  const [mostrarModalTest, setMostrarModalTest] = useState(false)
  const [testDestinatario, setTestDestinatario] = useState('')
  const [testeando, setTesteando] = useState(false)
  const [testResultado, setTestResultado] = useState<{ ok: boolean; mensaje?: string; error?: string } | null>(null)

  // Redirigir si no es admin
  useEffect(() => {
    if (!authLoading && (!usuario || !isAdmin)) {
      router.push('/crm/dashboard')
    }
  }, [authLoading, usuario, isAdmin, router])

  // Cargar configuración
  useEffect(() => {
    async function cargar() {
      const r = await apiCall<{
        encryption_disponible: boolean
        configurado: boolean
        configuracion?: any
      }>('/api/configuracion/correos', undefined, { mostrar_toast_en_error: false })

      if (!r.ok || !r.data) {
        setErrorGral(r.error?.mensaje ?? 'Error al cargar la configuración')
        setCargando(false)
        return
      }

      setEncryptionDisponible(r.data.encryption_disponible)
      setConfigurado(r.data.configurado)

      if (r.data.configuracion) {
        const c = r.data.configuracion
        setSmtpHost(c.smtp_host || '')
        setSmtpPort(String(c.smtp_port || 587))
        setSmtpSecure(c.smtp_secure || false)
        setSmtpUser(c.smtp_user || '')
        setTienePassword(c.tiene_password || false)
        setFromName(c.from_name || '')
        setFromEmail(c.from_email || '')
        setReplyTo(c.reply_to || '')
        setFirmaHtml(c.firma_html || '')
        setUltimoTest(c.ultimo_test || null)
        setUltimoTestExitoso(c.ultimo_test_exitoso)
      }
      setCargando(false)
    }
    if (!authLoading && usuario) cargar()
  }, [authLoading, usuario])

  // Pre-cargar email del test
  useEffect(() => {
    if (usuario?.email) setTestDestinatario(usuario.email)
  }, [usuario])

  const guardar = async () => {
    setGuardando(true)
    setErrorGral('')
    setExito(false)

    const datos: Record<string, any> = {
      smtp_host: smtpHost,
      smtp_port: smtpPort,
      smtp_secure: smtpSecure,
      smtp_user: smtpUser,
      from_name: fromName,
      from_email: fromEmail,
      reply_to: replyTo || null,
      firma_html: firmaHtml || null,
    }

    if (editandoPassword && smtpPassword) {
      datos.smtp_password = smtpPassword
    } else if (!tienePassword && smtpPassword) {
      datos.smtp_password = smtpPassword
    }

    const r = await apiCall<{ configuracion?: any }>('/api/configuracion/correos', {
      method: 'PATCH',
      body: datos,
    }, { mostrar_toast_en_error: false })

    if (!r.ok) {
      setErrorGral(r.error?.mensaje ?? 'Error al guardar')
      setGuardando(false)
      return
    }

    setConfigurado(r.data?.configuracion?.configurado || false)
    setTienePassword(r.data?.configuracion?.tiene_password || false)
    setEditandoPassword(false)
    setSmtpPassword('')
    setExito(true)
    toast.exito('Configuración guardada')
    setTimeout(() => setExito(false), 3000)
    setGuardando(false)
  }

  const enviarTest = async () => {
    setTesteando(true)
    setTestResultado(null)

    const r = await apiCall<{ mensaje?: string }>('/api/configuracion/correos/test', {
      method: 'POST',
      body: { destinatario: testDestinatario },
    }, { mostrar_toast_en_error: false })

    if (r.ok) {
      setTestResultado({ ok: true, mensaje: r.data?.mensaje })
      setUltimoTest(new Date().toISOString())
      setUltimoTestExitoso(true)
    } else {
      setTestResultado({ ok: false, error: r.error?.mensaje ?? 'Error desconocido' })
      setUltimoTest(new Date().toISOString())
      setUltimoTestExitoso(false)
    }
    setTesteando(false)
  }

  if (authLoading || cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
      </div>
    )
  }

  if (!usuario || !isAdmin) return null

  return (
    <div className="flex flex-col gap-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/crm/configuracion')} className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-700">
          <ArrowLeft className="h-3.5 w-3.5" /> Volver
        </button>
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Configuración de correos</h1>
          <p className="text-xs text-slate-600">Servidor SMTP, remitente y destinatarios del sistema</p>
        </div>
      </div>

      {/* Sin encryption */}
      {!encryptionDisponible && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-5">
          <div className="flex items-start gap-3">
            <Lock className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-red-800">Sistema de encriptación no disponible</h3>
              <p className="text-xs text-red-600 mt-1">
                La variable <code className="bg-red-100 px-1 py-0.5 rounded text-2xs">ENCRYPTION_KEY</code> no está configurada en el servidor. La configuración de correos está deshabilitada.
              </p>
              <div className="mt-3 text-2xs text-red-500 bg-red-100 rounded p-2 font-mono">
                node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;hex&apos;))&quot;
                <br />
                # Agregar al .env.local como ENCRYPTION_KEY=... y reiniciar el servicio
              </div>
            </div>
          </div>
        </div>
      )}

      {encryptionDisponible && (
        <>
          {/* SECCIÓN 1 — Estado */}
          <div className={`border rounded-lg p-4 ${configurado ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {configurado
                  ? <CheckCircle className="h-5 w-5 text-green-600" />
                  : <AlertTriangle className="h-5 w-5 text-amber-600" />
                }
                <div>
                  <p className={`text-sm font-medium ${configurado ? 'text-green-800' : 'text-amber-800'}`}>
                    {configurado ? 'Sistema de correos configurado' : 'Sistema de correos no configurado'}
                  </p>
                  {configurado && ultimoTest && (
                    <p className="text-2xs text-green-600 mt-0.5">
                      Último test: {new Date(ultimoTest).toLocaleString('es-AR')} — {ultimoTestExitoso ? 'Exitoso' : 'Falló'}
                    </p>
                  )}
                  {!configurado && (
                    <p className="text-2xs text-amber-600 mt-0.5">Completá los datos abajo para empezar a enviar emails</p>
                  )}
                </div>
              </div>
              {configurado && (
                <button onClick={() => setMostrarModalTest(true)} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5">
                  <Send className="h-3 w-3" /> Enviar email de prueba
                </button>
              )}
            </div>
          </div>

          {/* SECCIÓN 2 — SMTP */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-1">Servidor SMTP</h2>
            <p className="text-2xs text-slate-600 mb-4">Datos del servidor de correo. Te los proporciona tu proveedor de email (Gmail, Outlook, tu hosting, etc.).</p>

            <div className="grid grid-cols-2 gap-4">
              <Campo label="Servidor SMTP" required ayuda="Ej: smtp.gmail.com">
                <input type="text" className="form-input w-full text-xs" placeholder="smtp.gmail.com" value={smtpHost} onChange={e => setSmtpHost(e.target.value)} />
              </Campo>
              <Campo label="Puerto" required ayuda="587 para TLS (recomendado), 465 para SSL, 25 sin cifrado">
                <input type="number" className="form-input w-full text-xs" value={smtpPort} onChange={e => setSmtpPort(e.target.value)} min={1} max={65535} />
              </Campo>
            </div>

            <div className="mt-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={smtpSecure} onChange={e => setSmtpSecure(e.target.checked)} className="rounded border-slate-300" />
                <span className="text-xs text-slate-700">Conexión segura SSL/TLS</span>
              </label>
              <p className="text-2xs text-slate-500 mt-1 ml-6">Activar solo si usás puerto 465. Para puerto 587 dejar desactivado.</p>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <Campo label="Usuario" required ayuda="Dirección de email completa de la cuenta SMTP (suele ser la misma que el remitente).">
                <input type="text" className="form-input w-full text-xs" placeholder="cuenta-smtp@dominio.com" value={smtpUser} onChange={e => setSmtpUser(e.target.value)} />
              </Campo>
              <Campo label="Contraseña" required={!tienePassword} ayuda="Para Gmail necesitás una 'contraseña de aplicación', no la contraseña normal.">
                {tienePassword && !editandoPassword ? (
                  <div className="flex items-center gap-2">
                    <input type="password" className="form-input flex-1 text-xs bg-slate-50" value="••••••••" disabled />
                    <button onClick={() => setEditandoPassword(true)} className="text-2xs text-blue-600 hover:text-blue-800 whitespace-nowrap">
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input type="password" className="form-input flex-1 text-xs" placeholder={tienePassword ? 'Nueva contraseña...' : 'Contraseña SMTP'} value={smtpPassword} onChange={e => setSmtpPassword(e.target.value)} />
                    {editandoPassword && (
                      <button onClick={() => { setEditandoPassword(false); setSmtpPassword('') }} className="text-2xs text-slate-600 hover:text-slate-700">
                        Cancelar
                      </button>
                    )}
                  </div>
                )}
              </Campo>
            </div>
          </div>

          {/* SECCIÓN 3 — Remitente */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-1">Datos del remitente</h2>
            <p className="text-2xs text-slate-600 mb-4">Cómo aparecen los emails enviados en la bandeja de entrada del destinatario.</p>

            <div className="grid grid-cols-2 gap-4">
              <Campo label="Nombre del remitente" required ayuda="Aparece como nombre del remitente (ej: 'Lobo Seguros')">
                <input type="text" className="form-input w-full text-xs" placeholder="Mi Organización" value={fromName} onChange={e => setFromName(e.target.value)} />
              </Campo>
              <Campo label="Email del remitente" required ayuda="Dirección que aparece como remitente. Puede diferir del usuario SMTP.">
                <input type="email" className="form-input w-full text-xs" placeholder="info@miorganizacion.com" value={fromEmail} onChange={e => setFromEmail(e.target.value)} />
              </Campo>
            </div>

            <div className="mt-4">
              <Campo label="Email de respuesta" ayuda="Cuando respondan al email, llega a esta dirección. Si lo dejás vacío, se usa el email del remitente.">
                <input type="email" className="form-input w-full text-xs" placeholder="contacto@miorganizacion.com" value={replyTo} onChange={e => setReplyTo(e.target.value)} />
              </Campo>
            </div>

            <div className="mt-4">
              <Campo label="Firma HTML" ayuda="HTML que se agrega al pie de cada email. Puede incluir nombre, datos de contacto, redes sociales, etc.">
                <textarea className="form-input w-full text-xs" rows={4} placeholder="<p>Tu Nombre — Productor Asesor de Seguros<br>Tel: 011-1234-5678</p>" value={firmaHtml} onChange={e => setFirmaHtml(e.target.value)} />
              </Campo>
            </div>
          </div>

          {/* Errores y éxito */}
          {errorGral && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded p-3">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {errorGral}
            </div>
          )}
          {exito && (
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded p-3">
              <CheckCircle className="h-4 w-4 shrink-0" />
              Configuración guardada correctamente
            </div>
          )}

          {/* Botones */}
          <div className="flex items-center gap-3">
            <button onClick={guardar} disabled={guardando} className="btn-primary text-xs px-4 py-2 flex items-center gap-1.5">
              {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Guardar configuración
            </button>
            {configurado && (
              <button onClick={() => setMostrarModalTest(true)} className="btn-secondary text-xs px-4 py-2 flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5" /> Test de conexión
              </button>
            )}
          </div>
        </>
      )}

      {/* Modal test */}
      {mostrarModalTest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setMostrarModalTest(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-800">Enviar email de prueba</h2>
              <button onClick={() => setMostrarModalTest(false)} className="text-slate-500 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs text-slate-600 mb-4">Vamos a intentar enviar un email de prueba para verificar que la configuración funciona.</p>
              <Campo label="Enviar a" required>
                <input type="email" className="form-input w-full text-xs" value={testDestinatario} onChange={e => setTestDestinatario(e.target.value)} placeholder="destinatario@ejemplo.com" />
              </Campo>

              {testeando && (
                <div className="flex items-center gap-2 mt-4 text-xs text-slate-600">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Conectando con el servidor SMTP...
                </div>
              )}

              {testResultado && (
                <div className={`mt-4 p-3 rounded text-xs ${testResultado.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  {testResultado.ok
                    ? <span className="flex items-center gap-1.5"><CheckCircle className="h-3.5 w-3.5" /> Email enviado correctamente. Revisá tu bandeja de entrada.</span>
                    : <span className="flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {testResultado.error}</span>
                  }
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200">
              <button onClick={() => setMostrarModalTest(false)} className="btn-secondary text-xs px-3 py-1.5">Cerrar</button>
              <button
                onClick={enviarTest}
                disabled={testeando || !testDestinatario}
                className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
              >
                <Send className="h-3 w-3" /> Enviar prueba
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
