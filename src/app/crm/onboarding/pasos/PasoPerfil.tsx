'use client'

/**
 * Paso "Perfil" del wizard de onboarding.
 *
 * Captura los datos mínimos para identificar al productor / organización:
 * tipo de operación, nombre o razón social, CUIT (siempre obligatorio),
 * matrícula SSN y datos de contacto básicos. El logo va en el paso siguiente
 * o queda como opcional dentro de la pantalla de configuración avanzada.
 *
 * No es skippeable: sin esto el CRM no puede operar coherentemente.
 */

import { useEffect, useMemo, useState } from 'react'
import { Building2, Upload, X, Loader2 } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { toast } from '@/lib/toast'
import { WizardLayout } from '../components/WizardLayout'
import { validarCUIT, validarEmail } from '@/lib/importacion/validators'

interface Props {
  pasoActual: number
  totalPasos: number
  onAtras: () => void
  onContinuar: () => void
}

type TipoOperacion = 'INDEPENDIENTE' | 'SOCIEDAD'

export function PasoPerfil({ pasoActual, totalPasos, onAtras, onContinuar }: Props) {
  const supabase = getSupabaseClient()
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [registroId, setRegistroId] = useState<string | null>(null)

  // Campos
  const [tipoOperacion, setTipoOperacion] = useState<TipoOperacion>('INDEPENDIENTE')
  const [nombre, setNombre] = useState('')
  const [razonSocial, setRazonSocial] = useState('')
  const [cuit, setCuit] = useState('')
  const [matriculaSsn, setMatriculaSsn] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')

  // Logo
  const [usarLogo, setUsarLogo] = useState(true)
  const [logoPath, setLogoPath] = useState('')
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [subiendoLogo, setSubiendoLogo] = useState(false)

  // Cargar configuración existente (por si retoma desde donde quedó)
  useEffect(() => {
    const cargar = async () => {
      const { data } = await supabase
        .from('configuracion')
        .select('*')
        .limit(1)
        .maybeSingle()
      if (data) {
        setRegistroId((data as any).id)
        setTipoOperacion(((data as any).tipo_operacion ?? 'INDEPENDIENTE') as TipoOperacion)
        setNombre((data as any).nombre ?? '')
        setRazonSocial((data as any).razon_social ?? '')
        setCuit((data as any).cuit ?? '')
        setMatriculaSsn((data as any).matricula_ssn ?? '')
        setTelefono((data as any).telefono ?? '')
        setEmail((data as any).email ?? '')
        setUsarLogo((data as any).usar_logo !== false)
        const lp = (data as any).logo_path ?? ''
        setLogoPath(lp)
        if (lp) setLogoPreview(`/api/storage/${lp}`)
      }
      setCargando(false)
    }
    void cargar()
  }, [supabase])

  const subirLogo = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      toast.error('El logo no puede pesar más de 2MB')
      return
    }
    setSubiendoLogo(true)
    // El endpoint /api/storage/upload espera `archivo` + `tipo=perfil`
    // (mismos field names que la pantalla de configuración / perfil).
    const fd = new FormData()
    fd.append('archivo', file)
    fd.append('tipo', 'perfil')
    fd.append('categoria', 'logo')
    try {
      const r = await fetch('/api/storage/upload', { method: 'POST', body: fd })
      const json = await r.json().catch(() => ({}))
      if (!r.ok || !json.ok) {
        // El backend devuelve { ok: false, error: { codigo, mensaje } | string }.
        // Tomamos el mensaje más específico disponible.
        const errMsg =
          json?.error?.mensaje ??
          (typeof json?.error === 'string' ? json.error : null) ??
          `No se pudo subir el logo (HTTP ${r.status})`
        toast.error(errMsg)
        return
      }
      const ruta = json.data?.ruta ?? json.ruta
      if (!ruta) {
        toast.error('Respuesta inesperada del servidor al subir el logo.')
        return
      }
      setLogoPath(ruta)
      setLogoPreview(`/api/storage/${ruta}?t=${Date.now()}`)
    } catch (err: any) {
      toast.error(err?.message || 'Error de red al subir el logo')
    } finally {
      setSubiendoLogo(false)
    }
  }

  // ─── Validaciones ───
  const cuitValido = useMemo(() => validarCUIT(cuit), [cuit])
  const emailValido = useMemo(() => {
    if (!email.trim()) return { valido: true }
    return validarEmail(email)
  }, [email])

  const valido = (() => {
    if (tipoOperacion === 'INDEPENDIENTE' && !nombre.trim()) return false
    if (tipoOperacion === 'SOCIEDAD' && !razonSocial.trim()) return false
    if (!cuit.trim()) return false
    if (!cuitValido.valido) return false
    if (!emailValido.valido) return false
    return true
  })()

  const guardarYContinuar = async () => {
    if (!valido) {
      if (!cuitValido.valido && cuit.trim()) {
        toast.error(`CUIT inválido: ${cuitValido.motivo}`)
      } else if (!emailValido.valido && email.trim()) {
        toast.error('El email no tiene un formato válido')
      } else {
        toast.error('Completá los campos obligatorios')
      }
      return
    }
    setGuardando(true)
    try {
      const payload: any = {
        tipo_operacion: tipoOperacion,
        nombre: tipoOperacion === 'INDEPENDIENTE' ? nombre.trim() : null,
        razon_social: tipoOperacion === 'SOCIEDAD' ? razonSocial.trim() : null,
        cuit: cuitValido.normalizado ?? cuit.trim(),
        matricula_ssn: matriculaSsn.trim() || null,
        telefono: telefono.trim() || null,
        email: emailValido.normalizado ?? (email.trim() || null),
        logo_path: logoPath || null,
        usar_logo: usarLogo,
      }

      if (registroId) {
        const { error } = await supabase.from('configuracion').update(payload).eq('id', registroId)
        if (error) throw new Error(error.message)
      } else {
        const { data, error } = await supabase
          .from('configuracion')
          .insert(payload)
          .select('id')
          .single()
        if (error) throw new Error(error.message)
        setRegistroId((data as any).id)
      }

      const displayName = tipoOperacion === 'SOCIEDAD' ? razonSocial.trim() : nombre.trim()
      localStorage.setItem('crm_perfil_nombre', displayName)
      localStorage.setItem('crm_perfil_logo', logoPath || '')
      localStorage.setItem('crm_perfil_usar_logo', usarLogo ? 'true' : 'false')
      window.dispatchEvent(new Event('perfil-actualizado'))

      onContinuar()
    } catch (err: any) {
      toast.error(`Error al guardar: ${err.message}`)
    } finally {
      setGuardando(false)
    }
  }

  if (cargando) {
    return (
      <WizardLayout pasoActual={pasoActual} totalPasos={totalPasos} titulo="Tu perfil profesional">
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
      titulo="Tu perfil profesional"
      descripcion="Estos datos identifican tu organización en el CRM, los emails que mandás a clientes, el portal del cliente y los PDF de cotización. Podés modificarlos después en Configuración → Perfil."
      onAtras={onAtras}
      onContinuar={guardarYContinuar}
      continuarHabilitado={valido}
      continuarLoading={guardando}
    >
      <div className="space-y-5">
        {/* Tipo de operación */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">¿Cómo trabajás?</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label
              className={`flex items-start gap-3 p-3 rounded border-2 cursor-pointer transition-colors ${
                tipoOperacion === 'INDEPENDIENTE'
                  ? 'border-orange-500 bg-orange-50'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                checked={tipoOperacion === 'INDEPENDIENTE'}
                onChange={() => setTipoOperacion('INDEPENDIENTE')}
                className="mt-0.5"
              />
              <div>
                <div className="text-sm font-medium text-slate-900">PAS individual</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Sos el titular único, sin sociedad inscripta.
                </div>
              </div>
            </label>
            <label
              className={`flex items-start gap-3 p-3 rounded border-2 cursor-pointer transition-colors ${
                tipoOperacion === 'SOCIEDAD'
                  ? 'border-orange-500 bg-orange-50'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <input
                type="radio"
                checked={tipoOperacion === 'SOCIEDAD'}
                onChange={() => setTipoOperacion('SOCIEDAD')}
                className="mt-0.5"
              />
              <div>
                <div className="text-sm font-medium text-slate-900">En sociedad</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Trabajás con otros productores bajo una organización con razón social.
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Datos identificatorios */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Datos identificatorios</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {tipoOperacion === 'INDEPENDIENTE' ? (
              <Campo label="Nombre y apellido *" full>
                <input
                  className="form-input w-full"
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                  placeholder="Ej: Juan Pérez"
                />
              </Campo>
            ) : (
              <Campo label="Razón social *" full>
                <input
                  className="form-input w-full"
                  value={razonSocial}
                  onChange={e => setRazonSocial(e.target.value)}
                  placeholder="Ej: Pérez & Asociados SRL"
                />
              </Campo>
            )}
            <Campo label="CUIT *">
              <input
                className={`form-input w-full ${
                  cuit.trim() && !cuitValido.valido ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' : ''
                }`}
                value={cuit}
                onChange={e => setCuit(e.target.value)}
                placeholder="20-12345678-9"
              />
              {cuit.trim() && !cuitValido.valido && (
                <p className="text-xs text-red-600 mt-1">{cuitValido.motivo}</p>
              )}
            </Campo>
            <Campo label="Matrícula SSN">
              <input
                className="form-input w-full"
                value={matriculaSsn}
                onChange={e => setMatriculaSsn(e.target.value)}
                placeholder="Ej: 12345"
              />
            </Campo>
          </div>
        </div>

        {/* Contacto */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Contacto</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Campo label="Teléfono">
              <input
                className="form-input w-full"
                value={telefono}
                onChange={e => setTelefono(e.target.value)}
                placeholder="011 4567-8900"
              />
            </Campo>
            <Campo label="Email de contacto">
              <input
                type="email"
                className={`form-input w-full ${
                  email.trim() && !emailValido.valido ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20' : ''
                }`}
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="contacto@miorganizacion.com"
              />
              {email.trim() && !emailValido.valido && (
                <p className="text-xs text-red-600 mt-1">El email no tiene un formato válido</p>
              )}
            </Campo>
          </div>
        </div>

        {/* Logo (opcional con toggle) */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Logo (opcional)</h3>
          <label className="flex items-start gap-2 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={!usarLogo}
              onChange={e => setUsarLogo(!e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <div className="text-sm text-slate-700">No usar logo</div>
              <p className="text-xs text-slate-500">
                Si lo marcás, en todo el sistema aparece solo el nombre sin imagen.
              </p>
            </div>
          </label>

          {usarLogo && (
            <div className="flex items-center gap-4 pt-2 border-t border-slate-100">
              <div className="flex h-16 w-16 items-center justify-center rounded border-2 border-dashed border-slate-200 bg-slate-50 shrink-0 overflow-hidden">
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo" className="h-full w-full object-contain" />
                ) : (
                  <Building2 className="h-6 w-6 text-slate-300" />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <label className="btn-secondary flex items-center gap-1 cursor-pointer">
                    {subiendoLogo ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Upload className="h-3 w-3" />
                    )}
                    {logoPreview ? 'Reemplazar' : 'Subir logo'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/svg+xml"
                      className="hidden"
                      onChange={e => {
                        if (e.target.files?.[0]) void subirLogo(e.target.files[0])
                        e.target.value = ''
                      }}
                    />
                  </label>
                  {logoPreview && (
                    <button
                      type="button"
                      onClick={() => {
                        setLogoPath('')
                        setLogoPreview(null)
                      }}
                      className="btn-secondary flex items-center gap-1 text-red-600"
                    >
                      <X className="h-3 w-3" /> Quitar
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-400">PNG, JPG o SVG. Máximo 2MB.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </WizardLayout>
  )
}

function Campo({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="block text-xs text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  )
}
