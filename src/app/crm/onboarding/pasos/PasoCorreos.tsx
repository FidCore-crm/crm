'use client'

import { useEffect, useState } from 'react'
import { Send, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { WizardLayout } from '../components/WizardLayout'

interface Props {
  pasoActual: number
  totalPasos: number
  onAtras: () => void
  onContinuar: () => void
  onSkip: () => void
}

interface ConfigCorreos {
  smtp_host: string
  smtp_port: number
  smtp_secure: boolean
  smtp_user: string
  from_name: string
  from_email: string
  tiene_password: boolean
  configurado: boolean
}

export function PasoCorreos({ pasoActual, totalPasos, onAtras, onContinuar, onSkip }: Props) {
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [testeando, setTesteando] = useState(false)
  const [testExitoso, setTestExitoso] = useState(false)

  // Campos
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState(587)
  const [smtpSecure, setSmtpSecure] = useState(false)
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [yaTenePassword, setYaTenePassword] = useState(false)
  const [fromName, setFromName] = useState('')
  const [fromEmail, setFromEmail] = useState('')

  useEffect(() => {
    const cargar = async () => {
      try {
        const r = await fetch('/api/configuracion/correos', { cache: 'no-store' })
        const json = await r.json()
        if (json.ok && json.data) {
          const c = json.data as ConfigCorreos
          setSmtpHost(c.smtp_host ?? '')
          setSmtpPort(c.smtp_port ?? 587)
          setSmtpSecure(c.smtp_secure ?? false)
          setSmtpUser(c.smtp_user ?? '')
          setFromName(c.from_name ?? '')
          setFromEmail(c.from_email ?? '')
          setYaTenePassword(c.tiene_password ?? false)
        }
      } catch {
        /* ignorar */
      } finally {
        setCargando(false)
      }
    }
    void cargar()
  }, [])

  const valido = !!(smtpHost.trim() && smtpUser.trim() && (smtpPassword || yaTenePassword) && fromName.trim() && fromEmail.trim())

  const guardar = async (): Promise<boolean> => {
    const payload: any = {
      smtp_host: smtpHost.trim(),
      smtp_port: smtpPort,
      smtp_secure: smtpSecure,
      smtp_user: smtpUser.trim(),
      from_name: fromName.trim(),
      from_email: fromEmail.trim(),
    }
    if (smtpPassword) payload.smtp_password = smtpPassword
    try {
      const r = await fetch('/api/configuracion/correos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await r.json()
      if (!r.ok || !json.ok) {
        toast.error(json.error?.mensaje || 'No se pudo guardar la configuración SMTP')
        return false
      }
      setYaTenePassword(true)
      setSmtpPassword('')
      return true
    } catch (err: any) {
      toast.error(err.message || 'Error al guardar')
      return false
    }
  }

  const probarConexion = async () => {
    setTesteando(true)
    setTestExitoso(false)
    const ok = await guardar()
    if (!ok) {
      setTesteando(false)
      return
    }
    try {
      const r = await fetch('/api/configuracion/correos/test', { method: 'POST' })
      const json = await r.json()
      if (json.ok) {
        setTestExitoso(true)
        toast.exito('Email de prueba enviado correctamente')
      } else {
        toast.error(json.error?.mensaje || 'El test falló — revisá los datos')
      }
    } catch (err: any) {
      toast.error(err.message || 'Error al probar')
    } finally {
      setTesteando(false)
    }
  }

  const guardarYContinuar = async () => {
    setGuardando(true)
    const ok = await guardar()
    setGuardando(false)
    if (ok) onContinuar()
  }

  if (cargando) {
    return (
      <WizardLayout pasoActual={pasoActual} totalPasos={totalPasos} titulo="Correos del CRM">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
        </div>
      </WizardLayout>
    )
  }

  return (
    <WizardLayout
      pasoActual={pasoActual}
      totalPasos={totalPasos}
      titulo="Correos del CRM"
      descripcion="Conectá una cuenta de email para que el CRM mande correos automáticos a tus clientes (bienvenida de pólizas, recordatorios de vencimiento, etc.) y a vos (errores del sistema, backups). Es opcional — si todavía no tenés la cuenta a mano podés saltearlo y configurarlo más adelante en Configuración → Correos."
      onAtras={onAtras}
      onContinuar={guardarYContinuar}
      onSkip={onSkip}
      continuarHabilitado={valido && !guardando}
      continuarLoading={guardando}
    >
      <div className="space-y-4">
        {/* Aviso si saltea */}
        <div className="bg-amber-50 border border-amber-200 rounded p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-900">
            Si no tenés un email del estudio a mano, podés usar tu Gmail personal con una{' '}
            <a
              href="https://support.google.com/accounts/answer/185833"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              contraseña de aplicación
            </a>
            . O salteá el paso y lo configurás después en Configuración → Correos.
          </p>
        </div>

        {/* Servidor SMTP */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Servidor SMTP</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-600 mb-1">Host *</label>
              <input
                className="form-input w-full"
                value={smtpHost}
                onChange={e => setSmtpHost(e.target.value)}
                placeholder="smtp.gmail.com"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Puerto *</label>
              <input
                type="number"
                className="form-input w-full"
                value={smtpPort}
                onChange={e => setSmtpPort(Number(e.target.value))}
              />
            </div>
            <div className="sm:col-span-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smtpSecure}
                  onChange={e => setSmtpSecure(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span className="text-sm text-slate-700">
                  SSL/TLS (usar para puerto 465; el 587 usa STARTTLS y va destildado)
                </span>
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-600 mb-1">Usuario *</label>
              <input
                className="form-input w-full"
                value={smtpUser}
                onChange={e => setSmtpUser(e.target.value)}
                placeholder="tucuenta@gmail.com"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">
                Contraseña {yaTenePassword && '(ya guardada)'}
              </label>
              <input
                type="password"
                className="form-input w-full"
                value={smtpPassword}
                onChange={e => setSmtpPassword(e.target.value)}
                placeholder={yaTenePassword ? '••••••••' : ''}
              />
            </div>
          </div>
        </div>

        {/* Identidad del remitente */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Identidad del remitente</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-600 mb-1">Nombre visible *</label>
              <input
                className="form-input w-full"
                value={fromName}
                onChange={e => setFromName(e.target.value)}
                placeholder="Mi Organización"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Email del remitente *</label>
              <input
                type="email"
                className="form-input w-full"
                value={fromEmail}
                onChange={e => setFromEmail(e.target.value)}
                placeholder="contacto@miorganizacion.com"
              />
            </div>
          </div>
        </div>

        {/* Botón de test */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={probarConexion}
            disabled={!valido || testeando}
            className="btn-secondary flex items-center gap-2"
          >
            {testeando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar email de prueba
          </button>
          {testExitoso && (
            <div className="flex items-center gap-1 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4" />
              Email enviado — revisá tu casilla
            </div>
          )}
        </div>
      </div>
    </WizardLayout>
  )
}
