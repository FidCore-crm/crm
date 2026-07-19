'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, Loader2, AlertCircle, CheckCircle } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'

interface FormData {
  nombre: string
  apellido: string
  dni: string
  telefono: string
  email: string
  empresa: string
  cargo: string
  fuente: string
  canal: string
  nivel_interes: string
  productos_interes: string
  notas: string
}

const FORM_INICIAL: FormData = {
  nombre: '', apellido: '', dni: '', telefono: '', email: '',
  empresa: '', cargo: '',
  fuente: 'OTRO', canal: '', nivel_interes: 'MEDIO',
  productos_interes: '', notas: '',
}

function Campo({ label, required, error, children }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-slate-600">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && (
        <span className="flex items-center gap-1 text-xs text-red-500">
          <AlertCircle className="h-3 w-3"/> {error}
        </span>
      )}
    </div>
  )
}

export default function NuevoLeadPage() {
  const router   = useRouter()
  const supabase = getSupabaseClient()
  const { usuario } = useAuth()

  const [form,        setForm]        = useState<FormData>(FORM_INICIAL)
  const [errores,     setErrores]     = useState<Partial<Record<keyof FormData, string>>>({})
  const [guardando,   setGuardando]   = useState(false)
  const [exito,       setExito]       = useState(false)
  const [errorGral,   setErrorGral]   = useState('')
  const [warnContacto, setWarnContacto] = useState(false)
  // Warning informativo (no bloquea): el PAS suele tener datos parciales
  // y a veces necesita cargar dos leads aunque compartan DNI o email.
  const [warnDuplicado, setWarnDuplicado] = useState<{
    dni: boolean
    email: boolean
  }>({ dni: false, email: false })

  const set = (campo: keyof FormData, valor: string) => {
    setForm(f => ({ ...f, [campo]: valor }))
    if (errores[campo]) setErrores(e => ({ ...e, [campo]: '' }))
    if (campo === 'telefono' || campo === 'email') setWarnContacto(false)
    // Al editar el campo, limpiamos el warning correspondiente — se vuelve
    // a chequear cuando el usuario haga blur otra vez.
    if (campo === 'dni') setWarnDuplicado(w => ({ ...w, dni: false }))
    if (campo === 'email') setWarnDuplicado(w => ({ ...w, email: false }))
  }

  // Chequeo on-blur: avisa si ya existe otro lead con el mismo DNI o
  // email. Es solo warning — el flujo de guardado no se bloquea.
  const checkDuplicado = async (campo: 'dni' | 'email', valor: string) => {
    const trimmed = valor.trim()
    if (!trimmed) {
      setWarnDuplicado(w => ({ ...w, [campo]: false }))
      return
    }
    const { data } = await supabase
      .from('leads')
      .select('id')
      .eq(campo, trimmed)
      .limit(1)
    setWarnDuplicado(w => ({ ...w, [campo]: !!(data && data.length > 0) }))
  }

  const validar = (): boolean => {
    const e: Partial<Record<keyof FormData, string>> = {}
    if (!form.nombre.trim())   e.nombre   = 'El nombre es obligatorio'
    if (!form.apellido.trim()) e.apellido  = 'El apellido es obligatorio'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      e.email = 'Email inválido'
    }
    setErrores(e)

    if (!form.telefono.trim() && !form.email.trim()) setWarnContacto(true)

    return Object.keys(e).length === 0
  }

  const guardar = async () => {
    if (!validar()) return
    setGuardando(true)
    setErrorGral('')

    const payload: Record<string, any> = {
      nombre:            form.nombre.trim(),
      apellido:          form.apellido.trim(),
      dni:               form.dni.trim() || null,
      telefono:          form.telefono.trim() || null,
      email:             form.email.trim() || null,
      empresa:           form.empresa.trim() || null,
      cargo:             form.cargo.trim() || null,
      fuente:            form.fuente,
      canal:             form.canal || null,
      nivel_interes:     form.nivel_interes,
      productos_interes: form.productos_interes.trim() || null,
      notas:             form.notas.trim() || null,
      usuario_id:        usuario?.id ?? null,
    }

    const { data, error } = await supabase
      .from('leads')
      .insert(payload)
      .select('id')
      .single()

    if (error) {
      setErrorGral(`Error al guardar: ${error.message}`)
      setGuardando(false)
      return
    }

    setExito(true)
    setGuardando(false)
    setTimeout(() => router.push(`/crm/comercial/leads/${(data as any).id}`), 1000)
  }

  if (exito) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <CheckCircle className="h-6 w-6 text-green-600"/>
        </div>
        <p className="text-sm font-medium text-slate-700">Lead guardado correctamente</p>
        <p className="text-xs text-slate-600">Redirigiendo a la ficha...</p>
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
          <button onClick={() => router.push('/crm/comercial/leads')} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center" title="Volver">
            <ArrowLeft className="h-3 w-3"/>
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Nuevo lead</h1>
            <p className="text-xs text-slate-600">Alta de contacto potencial</p>
          </div>
        </div>
        <button onClick={guardar} disabled={guardando} className="btn-primary">
          {guardando ? <Loader2 className="h-3 w-3 animate-spin"/> : <Save className="h-3 w-3"/>}
          {guardando ? 'Guardando...' : 'Guardar lead'}
        </button>
      </div>

      {errorGral && (
        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0"/> {errorGral}
        </div>
      )}

      {warnContacto && (
        <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0"/> Este lead no tiene datos de contacto. Va a ser difícil contactarlo.
        </div>
      )}

      {(warnDuplicado.dni || warnDuplicado.email) && (
        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5"/>
          <div>
            Ya existe otro lead con
            {warnDuplicado.dni && warnDuplicado.email && ' este DNI y este email'}
            {warnDuplicado.dni && !warnDuplicado.email && ' este DNI'}
            {!warnDuplicado.dni && warnDuplicado.email && ' este email'}.
            Podés guardar igual si querés mantener ambos registros, o volver al listado y editar el existente.
          </div>
        </div>
      )}

      {/* Datos personales */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Datos personales</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Campo label="Nombre" required error={errores.nombre}>
            <input className={inputClass('nombre')} value={form.nombre}
              onChange={e => set('nombre', e.target.value)} placeholder="Juan" autoFocus/>
          </Campo>
          <Campo label="Apellido" required error={errores.apellido}>
            <input className={inputClass('apellido')} value={form.apellido}
              onChange={e => set('apellido', e.target.value)} placeholder="García"/>
          </Campo>
          <Campo label="DNI">
            <input className="form-input font-mono" value={form.dni}
              onChange={e => set('dni', e.target.value)}
              onBlur={e => checkDuplicado('dni', e.target.value)}
              placeholder="12345678"/>
          </Campo>
          <Campo label="Teléfono">
            <input className="form-input font-mono" value={form.telefono}
              onChange={e => set('telefono', e.target.value)} placeholder="011 4123-4567" type="tel"/>
          </Campo>
          <Campo label="Email" error={errores.email}>
            <input className={inputClass('email')} value={form.email}
              onChange={e => set('email', e.target.value)}
              onBlur={e => checkDuplicado('email', e.target.value)}
              placeholder="juan@email.com" type="email"/>
          </Campo>
        </div>
      </div>

      {/* Datos laborales */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Datos laborales</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Campo label="Empresa">
            <input className="form-input" value={form.empresa}
              onChange={e => set('empresa', e.target.value)} placeholder="TechCorp S.A."/>
          </Campo>
          <Campo label="Cargo">
            <input className="form-input" value={form.cargo}
              onChange={e => set('cargo', e.target.value)} placeholder="Gerente Comercial"/>
          </Campo>
        </div>
      </div>

      {/* Información comercial */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Información comercial</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Campo label="Fuente" required>
            <select className="form-input" value={form.fuente} onChange={e => set('fuente', e.target.value)}>
              <option value="REFERIDO">Referido</option>
              <option value="WEB">Web</option>
              <option value="REDES_SOCIALES">Redes Sociales</option>
              <option value="LLAMADA_ENTRANTE">Llamada Entrante</option>
              <option value="EVENTO">Evento</option>
              <option value="OTRO">Otro</option>
            </select>
          </Campo>
          <Campo label="Canal de contacto">
            <select className="form-input" value={form.canal} onChange={e => set('canal', e.target.value)}>
              <option value="">Sin especificar</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="TELEFONO">Teléfono</option>
              <option value="EMAIL">Email</option>
              <option value="PRESENCIAL">Presencial</option>
            </select>
          </Campo>
          <Campo label="Nivel de interés" required>
            <select className="form-input" value={form.nivel_interes} onChange={e => set('nivel_interes', e.target.value)}>
              <option value="ALTO">Alto</option>
              <option value="MEDIO">Medio</option>
              <option value="BAJO">Bajo</option>
            </select>
          </Campo>
          <div className="col-span-2">
            <Campo label="Productos que le interesan">
              <textarea className="form-input w-full resize-none" rows={2} value={form.productos_interes}
                onChange={e => set('productos_interes', e.target.value)}
                placeholder="Ej: Seguro de auto, seguro de hogar, ART..."/>
            </Campo>
          </div>
        </div>
      </div>

      {/* Notas */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Notas</h3>
        </div>
        <div className="p-4">
          <textarea className="form-input w-full resize-none" rows={3} value={form.notas}
            onChange={e => set('notas', e.target.value)}
            placeholder="Observaciones generales sobre el lead..."/>
        </div>
      </div>

      {/* Botones finales */}
      <div className="flex items-center justify-between pb-4">
        <button onClick={() => router.push('/crm/comercial/leads')} className="btn-secondary">
          <ArrowLeft className="h-3 w-3"/> Cancelar
        </button>
        <button onClick={guardar} disabled={guardando} className="btn-primary px-6">
          {guardando ? <Loader2 className="h-3 w-3 animate-spin"/> : <Save className="h-3 w-3"/>}
          {guardando ? 'Guardando...' : 'Guardar lead'}
        </button>
      </div>
    </div>
  )
}
