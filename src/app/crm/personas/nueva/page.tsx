'use client'

import { useState, useEffect, useId, cloneElement, isValidElement, type ReactElement } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, Loader2, AlertCircle, CheckCircle, User, Building2 } from 'lucide-react'
import { validarCUIT } from '@/lib/importacion/validators'
import { apiCall } from '@/lib/api-client'

// ── Tipos del formulario ─────────────────────────────────────
interface FormData {
  tipo_persona:   'FISICA' | 'JURIDICA'
  apellido:       string
  nombre:         string
  razon_social:   string
  dni_cuil:       string
  fecha_nacimiento: string
  email:          string
  email_secundario: string
  telefono:       string
  whatsapp:       string
  estado:         'ACTIVO' | 'INACTIVO'
  origen:         string
  // Dirección
  calle:          string
  numero:         string
  piso_depto:     string
  barrio:         string
  localidad:      string
  provincia:      string
  codigo_postal:  string
  // Extra
  observaciones:  string
}

const FORM_INICIAL: FormData = {
  tipo_persona:    'FISICA',
  apellido:        '',
  nombre:          '',
  razon_social:    '',
  dni_cuil:        '',
  fecha_nacimiento:'',
  email:           '',
  email_secundario:'',
  telefono:        '',
  whatsapp:        '',
  estado:          'ACTIVO',
  origen:          'REFERIDO',
  calle:           '',
  numero:          '',
  piso_depto:      '',
  barrio:          '',
  localidad:       '',
  provincia:       '',
  codigo_postal:   '',
  observaciones:   '',
}

// ── Formatear CUIL mientras escribe ─────────────────────────
function formatearCuil(valor: string): string {
  const solo = valor.replace(/\D/g, '').slice(0, 11)
  if (solo.length <= 2)  return solo
  if (solo.length <= 10) return `${solo.slice(0, 2)}-${solo.slice(2)}`
  return `${solo.slice(0, 2)}-${solo.slice(2, 10)}-${solo.slice(10)}`
}

// ── Componente de campo de formulario ───────────────────────
// Genera un id único y lo inyecta tanto en el `<label htmlFor>` como en el
// children (input/select/textarea/etc.) vía `cloneElement`. Esto vincula
// programáticamente la label al control y permite enfocarlo al hacer clic
// en la label, además de cumplir WCAG 2.1 nivel A.
function Campo({
  label, required, error, children
}: {
  label: string; required?: boolean; error?: string; children: React.ReactNode
}) {
  const id = useId()
  const errorId = `${id}-error`

  // Si el children es un elemento React (input/select/textarea), le inyectamos
  // id y aria-describedby si hay error. Si no, lo dejamos pasar tal cual.
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
export default function NuevaPersonaPage() {
  const router   = useRouter()

  const [form,      setForm]      = useState<FormData>(FORM_INICIAL)
  const [errores,   setErrores]   = useState<Partial<Record<keyof FormData, string>>>({})
  const [guardando, setGuardando] = useState(false)
  const [exito,     setExito]     = useState(false)
  const [errorGral, setErrorGral] = useState('')

  // ── Detección de cambios sin guardar ───────────────────
  const hayCambiosSinGuardar = JSON.stringify(form) !== JSON.stringify(FORM_INICIAL)

  useEffect(() => {
    if (!hayCambiosSinGuardar || exito || guardando) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hayCambiosSinGuardar, exito, guardando])

  const cancelar = () => {
    if (hayCambiosSinGuardar) {
      if (!confirm('Hay cambios sin guardar. ¿Querés salir igual?')) return
    }
    router.back()
  }

  // ── Actualizar campo ─────────────────────────────────────
  const set = (campo: keyof FormData, valor: string) => {
    setForm(f => ({ ...f, [campo]: valor }))
    if (errores[campo]) setErrores(e => ({ ...e, [campo]: '' }))
  }

  // ── Validación onBlur del DNI/CUIL ─────────────────────
  const validarDniOnBlur = () => {
    const digitos = form.dni_cuil.replace(/\D/g, '')
    if (!digitos) return
    if (digitos.length < 7) {
      setErrores(e => ({ ...e, dni_cuil: 'DNI/CUIL inválido (mínimo 7 dígitos)' }))
    } else if (digitos.length === 11) {
      const r = validarCUIT(digitos)
      if (!r.valido) setErrores(e => ({ ...e, dni_cuil: r.motivo || 'CUIL/CUIT inválido' }))
    } else if (digitos.length > 8 && digitos.length !== 11) {
      setErrores(e => ({ ...e, dni_cuil: 'DNI debe tener 7-8 dígitos o CUIL/CUIT 11 dígitos' }))
    }
  }

  // ── Validación del formulario ────────────────────────────
  const validar = (): boolean => {
    const e: Partial<Record<keyof FormData, string>> = {}

    if (form.tipo_persona === 'FISICA') {
      if (!form.apellido.trim()) e.apellido = 'El apellido es obligatorio'
      if (!form.nombre.trim())   e.nombre   = 'El nombre es obligatorio'
    } else {
      if (!form.razon_social.trim()) e.razon_social = 'La razón social es obligatoria'
    }

    if (!form.dni_cuil.trim()) {
      e.dni_cuil = 'El DNI/CUIL es obligatorio'
    } else {
      const digitos = form.dni_cuil.replace(/\D/g, '')
      if (digitos.length < 7) {
        e.dni_cuil = 'DNI/CUIL inválido (mínimo 7 dígitos)'
      } else if (digitos.length === 11) {
        const res = validarCUIT(digitos)
        if (!res.valido) {
          e.dni_cuil = res.motivo || 'CUIL/CUIT inválido (dígito verificador incorrecto)'
        }
      } else if (digitos.length > 8 && digitos.length !== 11) {
        e.dni_cuil = 'DNI debe tener 7-8 dígitos o CUIL/CUIT 11 dígitos'
      }
    }

    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      e.email = 'Email inválido'
    }

    setErrores(e)
    return Object.keys(e).length === 0
  }

  // ── Guardar ──────────────────────────────────────────────
  const guardar = async () => {
    if (!validar()) return
    setGuardando(true)
    setErrorGral('')

    const payload = {
      tipo_persona:     form.tipo_persona,
      apellido:         form.tipo_persona === 'FISICA' ? form.apellido : form.razon_social,
      nombre:           form.tipo_persona === 'FISICA' ? form.nombre : null,
      razon_social:     form.tipo_persona === 'JURIDICA' ? form.razon_social : null,
      dni_cuil:         form.dni_cuil,
      fecha_nacimiento: form.tipo_persona === 'FISICA' && form.fecha_nacimiento ? form.fecha_nacimiento : null,
      email:            form.email,
      email_secundario: form.email_secundario,
      telefono:         form.telefono,
      whatsapp:         form.whatsapp,
      estado:           form.estado,
      origen:           form.origen,
      canal_preferido:  'WHATSAPP',
      acepta_marketing: true,
      calle:            form.calle,
      numero:           form.numero,
      piso_depto:       form.piso_depto,
      barrio:           form.barrio,
      localidad:        form.localidad,
      provincia:        form.provincia,
      codigo_postal:    form.codigo_postal,
    }

    const res = await apiCall<{ id: string }>(
      '/api/personas',
      { method: 'POST', body: payload },
      { mostrar_toast_en_error: false },
    )

    if (!res.ok) {
      const err = res.error
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
      router.push(`/crm/personas/${res.data!.id}`)
    }, 1000)
  }

  // ── Pantalla de éxito ────────────────────────────────────
  if (exito) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <CheckCircle className="h-6 w-6 text-green-600" />
        </div>
        <p className="text-sm font-medium text-slate-700">¡Cliente guardado correctamente!</p>
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
            <ArrowLeft className="h-3.5 w-3.5" /></button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Nuevo Cliente</h1>
            <p className="text-xs text-slate-500">Alta de cliente en cartera</p>
          </div>
        </div>
        <button
          onClick={guardar}
          disabled={guardando}
          className="btn-primary"
        >
          {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {guardando ? 'Guardando...' : 'Guardar Cliente'}
        </button>
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
        <div className="p-4">
          <div className="flex gap-3">
            {[
              { valor: 'FISICA',   label: 'Persona Física',   sub: 'DNI / CUIL', icono: <User className="h-4 w-4" /> },
              { valor: 'JURIDICA', label: 'Persona Jurídica', sub: 'CUIT',       icono: <Building2 className="h-4 w-4" /> },
            ].map((t) => (
              <button
                key={t.valor}
                onClick={() => set('tipo_persona', t.valor)}
                className={`flex items-center gap-3 flex-1 rounded border-2 px-4 py-3 transition-all ${
                  form.tipo_persona === t.valor
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                {t.icono}
                <div className="text-left">
                  <p className="text-sm font-medium">{t.label}</p>
                  <p className="text-xs opacity-70">{t.sub}</p>
                </div>
              </button>
            ))}
          </div>
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
                  autoFocus
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
                  autoFocus
                />
              </Campo>
            </div>
          )}

          <Campo label="DNI / CUIL" required error={errores.dni_cuil}>
            <input
              className={`${inputClass('dni_cuil')} font-mono`}
              value={form.dni_cuil}
              onChange={(e) => set('dni_cuil', e.target.value.replace(/\D/g, ''))}
              onBlur={validarDniOnBlur}
              placeholder="20-12345678-9"
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

          <Campo label="Estado" required>
            <select
              className="form-input"
              value={form.estado}
              onChange={(e) => set('estado', e.target.value)}
            >
              <option value="ACTIVO">Asegurado</option>
              <option value="INACTIVO">Inactivo</option>
            </select>
          </Campo>

          <Campo label="Origen del contacto">
            <select
              className="form-input"
              value={form.origen}
              onChange={(e) => set('origen', e.target.value)}
            >
              <option value="REFERIDO">Referido</option>
              <option value="WEB">Web / Internet</option>
              <option value="REDES_SOCIALES">Redes Sociales</option>
              <option value="CARTERA_PROPIA">Cartera Propia</option>
              <option value="LLAMADA_ENTRANTE">Llamada Entrante</option>
              <option value="EVENTO">Evento</option>
              <option value="OTRO">Otro</option>
            </select>
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

      {/* ── Sección 5: Observaciones ────────────────────── */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Observaciones</h3>
        </div>
        <div className="p-4">
          <textarea
            className="form-input w-full resize-none"
            rows={3}
            value={form.observaciones}
            onChange={(e) => set('observaciones', e.target.value)}
            placeholder="Notas internas, cómo llegó al cliente, preferencias, etc."
          />
        </div>
      </div>

      {/* Botones finales */}
      <div className="flex items-center justify-between pb-4">
        <button onClick={cancelar} className="btn-secondary">
          <ArrowLeft className="h-3.5 w-3.5" /> Cancelar
        </button>
        <button
          onClick={guardar}
          disabled={guardando}
          className="btn-primary px-6"
        >
          {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {guardando ? 'Guardando...' : 'Guardar Cliente'}
        </button>
      </div>
    </div>
  )
}
