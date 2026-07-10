'use client'

import { useState, useEffect, useCallback, useId, cloneElement, isValidElement, type ReactElement } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Save, Loader2, AlertCircle, CheckCircle, User, Building2 } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { validarCUIT } from '@/lib/importacion/validators'
import { normalizarIdentificadorPersona } from '@/lib/identificador-persona'
import { useAuth } from '@/contexts/AuthContext'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { nombreCompleto } from '@/lib/utils'
import { apiCall } from '@/lib/api-client'
import { ModalConflictoEdicion } from '@/components/ModalConflictoEdicion'
import { PresenciaEnFicha } from '@/components/PresenciaEnFicha'
import type { Persona } from '@/types/database'

// ── Tipos del formulario ─────────────────────────────────────
interface FormData {
  tipo_persona:     'FISICA' | 'JURIDICA'
  apellido:         string
  nombre:           string
  razon_social:     string
  dni_cuil:         string
  fecha_nacimiento: string
  email:            string
  email_secundario: string
  telefono:         string
  whatsapp:         string
  estado:           string
  origen:           string
  segmento:         string
  canal_preferido:  string
  acepta_marketing: boolean
  // Dirección
  calle:            string
  numero:           string
  piso_depto:       string
  barrio:           string
  localidad:        string
  provincia:        string
  codigo_postal:    string
  // Extra
  observaciones:    string
}

// ── Componente de campo de formulario ───────────────────────
// Genera un id único y lo inyecta tanto en el `<label htmlFor>` como en el
// children (input/select/textarea/etc.) vía `cloneElement`. Cumple WCAG 2.1 A.
function Campo({
  label, required, error, children
}: {
  label: string; required?: boolean; error?: string; children: React.ReactNode
}) {
  const id = useId()
  const errorId = `${id}-error`

  const childWithId = isValidElement(children)
    ? cloneElement(children as ReactElement<any>, {
        id,
        'aria-invalid': !!error,
        'aria-describedby': error ? errorId : undefined,
      })
    : children

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {childWithId}
      {error && (
        <span id={errorId} className="flex items-center gap-1 text-xs text-red-500">
          <AlertCircle className="h-3 w-3" /> {error}
        </span>
      )}
    </div>
  )
}

// ── Página principal ─────────────────────────────────────────
export default function EditarPersonaPage() {
  const router   = useRouter()
  const params   = useParams()
  const id       = params.id as string
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  const [cargando,  setCargando]  = useState(true)
  const [nombre,    setNombre]    = useState('')
  const [form,      setForm]      = useState<FormData | null>(null)
  const [formInicial, setFormInicial] = useState<FormData | null>(null)
  const [updatedAtInicial, setUpdatedAtInicial] = useState<string | null>(null)
  const [conflicto, setConflicto] = useState<{ registro_actual: any } | null>(null)
  const [errores,   setErrores]   = useState<Partial<Record<keyof FormData, string>>>({})
  const [guardando, setGuardando] = useState(false)
  const [exito,     setExito]     = useState(false)
  const [errorGral, setErrorGral] = useState('')
  const [polizasAsociadas, setPolizasAsociadas] = useState(0)

  // ── Cargar datos de la persona ───────────────────────────
  const cargar = useCallback(async () => {
    setCargando(true)
    const { data, error } = await supabase
      .from('personas')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !data) {
      setCargando(false)
      return
    }

    const p = data as Persona

    // Control de acceso por cartera
    if (usuario && !tieneAccesoTotal(usuario) && (p as any).usuario_id && (p as any).usuario_id !== usuario.id) {
      router.replace('/crm/personas')
      return
    }

    // Si la persona está en papelera, no se puede editar — redirigir a la ficha
    // donde el banner ofrece restaurar.
    if ((p as any).deleted_at) {
      router.replace(`/crm/personas/${id}`)
      return
    }

    setNombre(nombreCompleto(p.apellido, p.nombre, p.razon_social))

    // Contar pólizas para bloquear el cambio de tipo_persona.
    const { count: cantPolizas } = await supabase
      .from('polizas')
      .select('id', { count: 'exact', head: true })
      .eq('asegurado_id', id)
    setPolizasAsociadas(cantPolizas ?? 0)

    const formCargado: FormData = {
      tipo_persona:     p.tipo_persona,
      apellido:         p.apellido ?? '',
      nombre:           p.nombre ?? '',
      razon_social:     p.razon_social ?? '',
      dni_cuil:         p.dni_cuil ?? '',
      fecha_nacimiento: (p as any).fecha_nacimiento ?? '',
      email:            p.email ?? '',
      email_secundario: p.email_secundario ?? '',
      telefono:         p.telefono ?? '',
      whatsapp:         p.whatsapp ?? '',
      estado:           p.estado,
      origen:           p.origen ?? '',
      segmento:         p.segmento ?? '',
      canal_preferido:  p.canal_preferido ?? '',
      acepta_marketing: p.acepta_marketing,
      calle:            p.calle ?? '',
      numero:           p.numero ?? '',
      piso_depto:       p.piso_depto ?? '',
      barrio:           p.barrio ?? '',
      localidad:        p.localidad ?? '',
      provincia:        p.provincia ?? '',
      codigo_postal:    p.codigo_postal ?? '',
      observaciones:    '',
    }
    setForm(formCargado)
    setFormInicial(formCargado)
    // Snapshot del updated_at al cargar — se envía en el PATCH para detectar
    // conflictos de concurrencia (#81)
    setUpdatedAtInicial((p as any).updated_at ?? null)

    setCargando(false)
  }, [supabase, id, usuario, router])

  useEffect(() => { cargar() }, [cargar])

  // ── Detección de cambios sin guardar ─────────────────────
  // Compara form actual vs el snapshot inicial. Si hay cambios y el usuario
  // intenta cerrar la pestaña/navegar, dispara el prompt nativo del navegador.
  const hayCambiosSinGuardar = !!(form && formInicial &&
    JSON.stringify(form) !== JSON.stringify(formInicial))

  useEffect(() => {
    if (!hayCambiosSinGuardar || exito || guardando) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // El navegador muestra su propio mensaje genérico — no se puede
      // personalizar el texto en navegadores modernos por seguridad.
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hayCambiosSinGuardar, exito, guardando])

  // ── Actualizar campo ─────────────────────────────────────
  const set = (campo: keyof FormData, valor: string | boolean) => {
    setForm(f => f ? { ...f, [campo]: valor } : f)
    if (errores[campo as keyof FormData]) setErrores(e => ({ ...e, [campo]: '' }))
  }

  // ── Validación onBlur del DNI/CUIT para feedback inmediato ──
  const validarDniOnBlur = () => {
    if (!form) return
    const digitos = form.dni_cuil.replace(/\D/g, '')
    if (!digitos) return
    const esFisica = form.tipo_persona === 'FISICA'
    if (esFisica) {
      if (digitos.length < 7) {
        setErrores(e => ({ ...e, dni_cuil: 'DNI inválido (mínimo 7 dígitos)' }))
      } else if (digitos.length === 11) {
        const r = validarCUIT(digitos)
        if (!r.valido) setErrores(e => ({ ...e, dni_cuil: r.motivo || 'CUIL inválido' }))
      } else if (digitos.length > 8) {
        setErrores(e => ({ ...e, dni_cuil: 'DNI debe tener 7-8 dígitos (o pegá el CUIL completo de 11)' }))
      }
    } else {
      if (digitos.length !== 11) {
        setErrores(e => ({ ...e, dni_cuil: 'El CUIT debe tener 11 dígitos' }))
      } else {
        const r = validarCUIT(digitos)
        if (!r.valido) setErrores(e => ({ ...e, dni_cuil: r.motivo || 'CUIT inválido' }))
      }
    }
  }

  // ── Cancelar con confirmación si hay cambios sin guardar ──
  const cancelar = () => {
    if (hayCambiosSinGuardar) {
      if (!confirm('Hay cambios sin guardar. ¿Querés salir igual?')) return
    }
    router.back()
  }

  // ── Validación ───────────────────────────────────────────
  const validar = (): boolean => {
    if (!form) return false
    const e: Partial<Record<keyof FormData, string>> = {}

    const esFisica = form.tipo_persona === 'FISICA'

    if (esFisica) {
      if (!form.apellido.trim()) e.apellido = 'El apellido es obligatorio'
      if (!form.nombre.trim())   e.nombre   = 'El nombre es obligatorio'
    } else {
      if (!form.razon_social.trim()) e.razon_social = 'La razón social es obligatoria'
    }

    const label = esFisica ? 'DNI' : 'CUIT'
    if (!form.dni_cuil.trim()) {
      e.dni_cuil = `El ${label} es obligatorio`
    } else {
      const digitos = form.dni_cuil.replace(/\D/g, '')
      if (esFisica) {
        if (digitos.length < 7) {
          e.dni_cuil = 'DNI inválido (mínimo 7 dígitos)'
        } else if (digitos.length === 11) {
          const res = validarCUIT(digitos)
          if (!res.valido) {
            e.dni_cuil = res.motivo || 'CUIL inválido (dígito verificador incorrecto)'
          }
        } else if (digitos.length > 8) {
          e.dni_cuil = 'DNI debe tener 7-8 dígitos (o pegá el CUIL completo de 11)'
        }
      } else {
        if (digitos.length !== 11) {
          e.dni_cuil = 'El CUIT debe tener 11 dígitos'
        } else {
          const res = validarCUIT(digitos)
          if (!res.valido) {
            e.dni_cuil = res.motivo || 'CUIT inválido (dígito verificador incorrecto)'
          }
        }
      }
    }

    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      e.email = 'Email inválido'
    }

    setErrores(e)
    return Object.keys(e).length === 0
  }

  // ── Guardar ──────────────────────────────────────────────
  const guardar = async (forzar: boolean = false) => {
    if (!form || !validar()) return
    setGuardando(true)
    setErrorGral('')

    // Canonicalización: DNI para físicas, CUIT para jurídicas. Si el PAS pegó
    // un CUIL en una física, extraemos el DNI del medio para evitar duplicados
    // con altas por PDF/importador.
    const dniCanonico =
      normalizarIdentificadorPersona(form.dni_cuil, form.tipo_persona) ?? form.dni_cuil

    const payload: Record<string, any> = {
      tipo_persona:     form.tipo_persona,
      apellido:         form.tipo_persona === 'FISICA' ? form.apellido : form.razon_social,
      nombre:           form.tipo_persona === 'FISICA' ? form.nombre : null,
      razon_social:     form.tipo_persona === 'JURIDICA' ? form.razon_social : null,
      dni_cuil:         dniCanonico,
      fecha_nacimiento: form.tipo_persona === 'FISICA' && form.fecha_nacimiento ? form.fecha_nacimiento : null,
      email:            form.email,
      email_secundario: form.email_secundario,
      telefono:         form.telefono,
      whatsapp:         form.whatsapp,
      // `estado` no se envía: el backend lo ignora en el PATCH. Cambios manuales
      // van por los endpoints /bloquear y /desbloquear.
      origen:           form.origen,
      segmento:         form.segmento,
      canal_preferido:  form.canal_preferido,
      acepta_marketing: form.acepta_marketing,
      calle:            form.calle,
      numero:           form.numero,
      piso_depto:       form.piso_depto,
      barrio:           form.barrio,
      localidad:        form.localidad,
      provincia:        form.provincia,
      codigo_postal:    form.codigo_postal,
    }

    // Optimistic concurrency check: enviar el updated_at del momento de carga
    // para que el backend detecte si otro usuario modificó el registro mientras
    // editábamos. Si `forzar=true` el caller ya decidió sobreescribir.
    if (updatedAtInicial && !forzar) {
      payload.if_match_updated_at = updatedAtInicial
    }
    if (forzar) {
      payload.force_overwrite = true
    }

    const res = await apiCall(
      `/api/personas/${id}`,
      { method: 'PATCH', body: payload },
      { mostrar_toast_en_error: false },
    )

    if (!res.ok) {
      const err = res.error as any
      // Conflicto de concurrencia (#81): mostrar modal con datos del registro actual
      if (err?.codigo === 'ERR_NEG_004' && err?.registro_actual) {
        setConflicto({ registro_actual: err.registro_actual })
        setGuardando(false)
        return
      }
      if (err?.campos) {
        setErrores(e => ({ ...e, ...err.campos } as any))
      } else {
        setErrorGral(err?.mensaje ?? 'Error al guardar')
      }
      setGuardando(false)
      return
    }

    setExito(true)
    setGuardando(false)

    setTimeout(() => {
      router.push(`/crm/personas/${id}`)
    }, 1000)
  }

  // ── Estados de carga ─────────────────────────────────────
  if (cargando) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando datos del cliente...
      </div>
    )
  }

  if (!form) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <span className="text-slate-400 text-sm">Cliente no encontrado</span>
        <button onClick={() => router.push('/crm/personas')} className="btn-secondary">
          <ArrowLeft className="h-3 w-3" /> Volver al listado
        </button>
      </div>
    )
  }

  if (exito) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <CheckCircle className="h-6 w-6 text-green-600" />
        </div>
        <p className="text-sm font-medium text-slate-700">¡Cliente actualizado correctamente!</p>
        <p className="text-xs text-slate-500">Redirigiendo a la ficha...</p>
      </div>
    )
  }

  const inputClass = (campo: keyof FormData) =>
    `form-input ${errores[campo] ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''}`

  return (
    <div className="flex flex-col gap-4 max-w-3xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={cancelar} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center" title="Volver">
            <ArrowLeft className="h-3 w-3" /></button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Editar Cliente</h1>
            <p className="text-xs text-slate-500">{nombre}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PresenciaEnFicha tipoEntidad="persona" entidadId={id} modo="editando" />
          <button
            onClick={() => guardar()}
            disabled={guardando}
            className="btn-primary"
          >
            {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            {guardando ? 'Guardando...' : 'Guardar Cambios'}
          </button>
        </div>
      </div>

      {/* Error general */}
      {errorGral && (
        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {errorGral}
        </div>
      )}

      {/* ── Sección 1: Tipo de persona ─────────────────── */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Tipo de Persona</h3>
        </div>
        <div className="p-4 flex flex-col gap-2">
          <div className="flex gap-3">
            {[
              { valor: 'FISICA',   label: 'Persona Física',   sub: 'DNI',  icono: <User className="h-4 w-4" /> },
              { valor: 'JURIDICA', label: 'Persona Jurídica', sub: 'CUIT',       icono: <Building2 className="h-4 w-4" /> },
            ].map((t) => {
              const bloqueado = polizasAsociadas > 0 && form.tipo_persona !== t.valor
              return (
                <button
                  key={t.valor}
                  onClick={() => { if (!bloqueado) set('tipo_persona', t.valor) }}
                  disabled={bloqueado}
                  title={bloqueado ? `No se puede cambiar: el cliente tiene ${polizasAsociadas} póliza(s) asociada(s)` : undefined}
                  className={`flex items-center gap-3 flex-1 rounded border-2 px-4 py-3 transition-all ${
                    form.tipo_persona === t.valor
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : bloqueado
                        ? 'border-slate-200 text-slate-300 cursor-not-allowed bg-slate-50'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {t.icono}
                  <div className="text-left">
                    <p className="text-sm font-medium">{t.label}</p>
                    <p className="text-xs opacity-70">{t.sub}</p>
                  </div>
                </button>
              )
            })}
          </div>
          {polizasAsociadas > 0 && (
            <p className="text-2xs text-amber-700 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              No se puede cambiar el tipo de persona porque tiene {polizasAsociadas} póliza(s) asociada(s).
            </p>
          )}
          {errores.tipo_persona && (
            <span className="flex items-center gap-1 text-xs text-red-500">
              <AlertCircle className="h-3 w-3" /> {errores.tipo_persona}
            </span>
          )}
        </div>
      </div>

      {/* ── Sección 2: Datos personales ────────────────── */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Datos Personales</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">

          {form.tipo_persona === 'FISICA' ? (
            <>
              <Campo label="Apellido" required error={errores.apellido}>
                <input
                  className={inputClass('apellido')}
                  value={form.apellido}
                  onChange={(e) => set('apellido', e.target.value)}
                  placeholder="García"
                />
              </Campo>
              <Campo label="Nombre" required error={errores.nombre}>
                <input
                  className={inputClass('nombre')}
                  value={form.nombre}
                  onChange={(e) => set('nombre', e.target.value)}
                  placeholder="Juan Carlos"
                />
              </Campo>
            </>
          ) : (
            <div className="col-span-2">
              <Campo label="Razón Social" required error={errores.razon_social}>
                <input
                  className={inputClass('razon_social')}
                  value={form.razon_social}
                  onChange={(e) => set('razon_social', e.target.value)}
                  placeholder="Empresa S.A."
                />
              </Campo>
            </div>
          )}

          <Campo
            label={form.tipo_persona === 'FISICA' ? 'DNI' : 'CUIT'}
            required
            error={errores.dni_cuil}
          >
            <input
              className={`${inputClass('dni_cuil')} font-mono`}
              value={form.dni_cuil}
              onChange={(e) => set('dni_cuil', e.target.value.replace(/\D/g, ''))}
              onBlur={validarDniOnBlur}
              placeholder={form.tipo_persona === 'FISICA' ? '12345678' : '30-12345678-9'}
              maxLength={13}
            />
          </Campo>

          {form.tipo_persona === 'FISICA' && (
            <Campo label="Fecha de nacimiento">
              <input
                type="date"
                className="form-input"
                value={form.fecha_nacimiento}
                onChange={(e) => set('fecha_nacimiento', e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
              />
            </Campo>
          )}

          <Campo label="Estado">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
                  form.estado === 'ACTIVO'
                    ? 'border-green-200 bg-green-50 text-green-700'
                    : form.estado === 'BLOQUEADO'
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}
              >
                {form.estado === 'ACTIVO'
                  ? 'Asegurado'
                  : form.estado === 'BLOQUEADO'
                    ? 'Bloqueado'
                    : 'Inactivo'}
              </span>
              <span className="text-xs text-slate-500">
                {form.estado === 'BLOQUEADO'
                  ? 'Bloqueado manualmente'
                  : 'Se calcula automáticamente según las pólizas'}
              </span>
            </div>
          </Campo>

          <Campo label="Origen del contacto">
            <select
              className="form-input"
              value={form.origen}
              onChange={(e) => set('origen', e.target.value)}
            >
              <option value="">— Sin especificar —</option>
              <option value="REFERIDO">Referido</option>
              <option value="WEB">Web / Internet</option>
              <option value="REDES_SOCIALES">Redes Sociales</option>
              <option value="CARTERA_PROPIA">Cartera Propia</option>
              <option value="LLAMADA_ENTRANTE">Llamada Entrante</option>
              <option value="EVENTO">Evento</option>
              <option value="OTRO">Otro</option>
            </select>
          </Campo>

          <Campo label="Segmento">
            <input
              className="form-input"
              value={form.segmento}
              onChange={(e) => set('segmento', e.target.value)}
              placeholder="VIP, Corporativo, etc."
            />
          </Campo>
        </div>
      </div>

      {/* ── Sección 3: Contacto ─────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Datos de Contacto</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Campo label="Teléfono" error={errores.telefono}>
            <input
              className={`${inputClass('telefono')} font-mono`}
              value={form.telefono}
              onChange={(e) => set('telefono', e.target.value)}
              placeholder="011 4123-4567"
              type="tel"
            />
          </Campo>

          <Campo label="WhatsApp">
            <input
              className="form-input font-mono"
              value={form.whatsapp}
              onChange={(e) => set('whatsapp', e.target.value)}
              placeholder="11 5123-4567"
              type="tel"
            />
          </Campo>

          <Campo label="Email" error={errores.email}>
            <input
              className={inputClass('email')}
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="juan@email.com"
              type="email"
            />
          </Campo>

          <Campo label="Email secundario">
            <input
              className="form-input"
              value={form.email_secundario}
              onChange={(e) => set('email_secundario', e.target.value)}
              placeholder="trabajo@empresa.com"
              type="email"
            />
          </Campo>

          <Campo label="Canal preferido">
            <select
              className="form-input"
              value={form.canal_preferido}
              onChange={(e) => set('canal_preferido', e.target.value)}
            >
              <option value="">— Sin especificar —</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="TELEFONO">Teléfono</option>
              <option value="EMAIL">Email</option>
              <option value="CORREO">Correo postal</option>
            </select>
          </Campo>

          <Campo label="Marketing">
            <div className="flex items-center gap-2 h-8">
              <input
                type="checkbox"
                checked={form.acepta_marketing}
                onChange={(e) => set('acepta_marketing', e.target.checked)}
                className="rounded border-slate-300"
              />
              <span className="text-xs text-slate-600">Acepta recibir comunicaciones</span>
            </div>
          </Campo>
        </div>
      </div>

      {/* ── Sección 4: Dirección ────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Dirección</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <div className="col-span-2 grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Campo label="Calle">
                <input
                  className="form-input"
                  value={form.calle}
                  onChange={(e) => set('calle', e.target.value)}
                  placeholder="Av. Rivadavia"
                />
              </Campo>
            </div>
            <Campo label="Número">
              <input
                className="form-input font-mono"
                value={form.numero}
                onChange={(e) => set('numero', e.target.value)}
                placeholder="1234"
              />
            </Campo>
          </div>

          <Campo label="Piso / Depto">
            <input
              className="form-input"
              value={form.piso_depto}
              onChange={(e) => set('piso_depto', e.target.value)}
              placeholder="3° B"
            />
          </Campo>

          <Campo label="Barrio">
            <input
              className="form-input"
              value={form.barrio}
              onChange={(e) => set('barrio', e.target.value)}
              placeholder="Villa del Parque"
            />
          </Campo>

          <Campo label="Localidad">
            <input
              className="form-input"
              value={form.localidad}
              onChange={(e) => set('localidad', e.target.value)}
              placeholder="Castelar"
            />
          </Campo>

          <Campo label="Provincia">
            <input
              className="form-input"
              value={form.provincia}
              onChange={(e) => set('provincia', e.target.value)}
              placeholder="Buenos Aires"
            />
          </Campo>

          <Campo label="Código Postal">
            <input
              className="form-input font-mono"
              value={form.codigo_postal}
              onChange={(e) => set('codigo_postal', e.target.value)}
              placeholder="1702"
              maxLength={8}
            />
          </Campo>
        </div>
      </div>

      {/* Botones finales */}
      <div className="flex items-center justify-between pb-4">
        <button onClick={cancelar} className="btn-secondary">
          <ArrowLeft className="h-3 w-3" /> Cancelar
        </button>
        <button
          onClick={() => guardar()}
          disabled={guardando}
          className="btn-primary px-6"
        >
          {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {guardando ? 'Guardando...' : 'Guardar Cambios'}
        </button>
      </div>

      {conflicto && form && (
        <ModalConflictoEdicion
          valoresTuyos={form}
          registroActual={conflicto.registro_actual}
          labels={{
            tipo_persona: 'Tipo',
            apellido: 'Apellido',
            nombre: 'Nombre',
            razon_social: 'Razón social',
            dni_cuil: 'DNI/CUIT',
            email: 'Email',
            email_secundario: 'Email secundario',
            telefono: 'Teléfono',
            whatsapp: 'WhatsApp',
            estado: 'Estado',
            origen: 'Origen',
            segmento: 'Segmento',
            canal_preferido: 'Canal preferido',
            acepta_marketing: 'Acepta marketing',
            calle: 'Calle',
            numero: 'Número',
            piso_depto: 'Piso/Depto',
            barrio: 'Barrio',
            localidad: 'Localidad',
            provincia: 'Provincia',
            codigo_postal: 'CP',
          }}
          campos={[
            'tipo_persona', 'apellido', 'nombre', 'razon_social', 'dni_cuil',
            'email', 'email_secundario', 'telefono', 'whatsapp',
            'origen', 'segmento', 'canal_preferido', 'acepta_marketing',
            'calle', 'numero', 'piso_depto', 'barrio', 'localidad', 'provincia', 'codigo_postal',
          ]}
          onCerrar={() => setConflicto(null)}
          onRecargar={() => {
            setConflicto(null)
            cargar()
          }}
          onSobreescribir={() => {
            setConflicto(null)
            guardar(true)
          }}
        />
      )}
    </div>
  )
}
