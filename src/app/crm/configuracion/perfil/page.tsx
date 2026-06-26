'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Save, Loader2, AlertCircle, CheckCircle,
  User, Building2, Plus, Trash2, Upload, X, Link2, MessageSquare, Palette
} from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { mensajeErrorAmigable } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import {
  PALETA_COLORES_MARCA, COLOR_MARCA_DEFAULT,
  derivarTonos, normalizarColorMarca,
} from '@/lib/color-marca'

interface Socio {
  nombre: string
  matricula: string
}

function Campo({ label, required, children }: {
  label: string; required?: boolean; children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

export default function PerfilPage() {
  const router   = useRouter()
  const supabase = getSupabaseClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const { isAdmin, loading: authLoading } = useAuth()

  useEffect(() => {
    if (!authLoading && !isAdmin) router.replace('/crm/dashboard')
  }, [authLoading, isAdmin, router])

  const [cargando,  setCargando]  = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [exito,     setExito]     = useState(false)
  const [errorGral, setErrorGral] = useState('')
  const [registroId, setRegistroId] = useState<string | null>(null)

  // Campos
  const [tipoOperacion, setTipoOperacion] = useState<'INDEPENDIENTE' | 'SOCIEDAD'>('INDEPENDIENTE')
  const [nombre,       setNombre]       = useState('')
  const [razonSocial,  setRazonSocial]  = useState('')
  const [cuit,         setCuit]         = useState('')
  const [matriculaSsn, setMatriculaSsn] = useState('')
  const [logoPath,     setLogoPath]     = useState('')
  const [usarLogo,     setUsarLogo]     = useState(true)
  const [telefono,     setTelefono]     = useState('')
  const [whatsapp,     setWhatsapp]     = useState('')
  const [email,        setEmail]        = useState('')
  const [direccion,    setDireccion]    = useState('')
  const [sitioWeb,     setSitioWeb]     = useState('')
  const [instagram,    setInstagram]    = useState('')
  const [facebook,     setFacebook]     = useState('')
  const [socios,       setSocios]       = useState<Socio[]>([])
  const [prefijoCasos, setPrefijoCasos] = useState('CASO')
  const [urlCrm,       setUrlCrm]       = useState('')
  const [colorMarca,   setColorMarca]   = useState(COLOR_MARCA_DEFAULT)
  const [emailHeaderEstilo, setEmailHeaderEstilo] = useState<'banda' | 'compacto' | 'lateral'>('banda')
  const [emailHeaderSubtitulo, setEmailHeaderSubtitulo] = useState('')

  // Mensajes predefinidos al enviar cotizaciones (WhatsApp + email)
  const [cotWspTemplate, setCotWspTemplate] = useState('')
  const [cotEmailAsuntoTemplate, setCotEmailAsuntoTemplate] = useState('')
  const [cotEmailCuerpoTemplate, setCotEmailCuerpoTemplate] = useState('')

  // Logo preview
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [subiendoLogo, setSubiendoLogo] = useState(false)

  // ── Cargar datos ───────────────────────────────────────
  useEffect(() => {
    async function cargar() {
      const { data } = await supabase.from('configuracion').select('*').limit(1).single()
      if (data) {
        setRegistroId(data.id)
        setTipoOperacion(data.tipo_operacion ?? 'INDEPENDIENTE')
        setNombre(data.nombre ?? '')
        setRazonSocial(data.razon_social ?? '')
        setCuit(data.cuit ?? '')
        setMatriculaSsn(data.matricula_ssn ?? '')
        setLogoPath(data.logo_path ?? '')
        setUsarLogo((data as any).usar_logo !== false)
        setTelefono(data.telefono ?? '')
        setWhatsapp(data.whatsapp ?? '')
        setEmail(data.email ?? '')
        setDireccion(data.direccion ?? '')
        setSitioWeb(data.sitio_web ?? '')
        setInstagram(data.instagram ?? '')
        setFacebook(data.facebook ?? '')
        setSocios(data.socios ?? [])
        setPrefijoCasos(data.prefijo_casos ?? 'CASO')
        setUrlCrm(data.url_crm ?? '')
        setColorMarca(normalizarColorMarca(data.color_marca))
        const estiloGuardado = (data as any).email_header_estilo
        if (estiloGuardado === 'compacto' || estiloGuardado === 'lateral' || estiloGuardado === 'banda') {
          setEmailHeaderEstilo(estiloGuardado)
        }
        setEmailHeaderSubtitulo((data as any).email_header_subtitulo ?? '')
        setCotWspTemplate(data.cotizacion_whatsapp_template ?? '')
        setCotEmailAsuntoTemplate(data.cotizacion_email_asunto_template ?? '')
        setCotEmailCuerpoTemplate(data.cotizacion_email_cuerpo_template ?? '')
        if (data.logo_path) setLogoPreview(`/api/storage/${data.logo_path}`)
      }
      setCargando(false)
    }
    cargar()
  }, [supabase])

  // ── Subir logo ─────────────────────────────────────────
  const subirLogo = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      setErrorGral('El logo no puede superar 2MB')
      return
    }
    setSubiendoLogo(true)
    setErrorGral('')
    const formData = new FormData()
    formData.append('archivo', file)
    formData.append('tipo', 'perfil')
    formData.append('categoria', 'logo')
    const r = await apiCall<{ ruta: string }>('/api/storage/upload', { method: 'POST', body: formData }, { mostrar_toast_en_error: false })
    if (r.ok && r.data) {
      setLogoPath(r.data.ruta)
      setLogoPreview(`/api/storage/${r.data.ruta}?t=${Date.now()}`)
    } else {
      setErrorGral(`Error subiendo logo: ${r.error?.mensaje ?? 'desconocido'}`)
    }
    setSubiendoLogo(false)
  }

  // ── Guardar ────────────────────────────────────────────
  const guardar = async () => {
    const nombreFinal = tipoOperacion === 'SOCIEDAD' ? razonSocial : nombre
    if (!nombreFinal.trim()) {
      setErrorGral(tipoOperacion === 'SOCIEDAD' ? 'La razón social es obligatoria' : 'El nombre es obligatorio')
      return
    }
    if (tipoOperacion === 'SOCIEDAD' && !cuit.trim()) {
      setErrorGral('El CUIT es obligatorio para sociedades')
      return
    }

    // Validación liviana de URL del CRM (vacío también es válido = "usar fallback").
    const urlCrmTrim = urlCrm.trim()
    if (urlCrmTrim) {
      try {
        const u = new URL(urlCrmTrim)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          setErrorGral('La URL del CRM debe empezar con http:// o https://')
          return
        }
        if (u.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(u.host)) {
          setErrorGral('Solo se permite http:// para localhost; el resto debe usar https://')
          return
        }
        if (u.pathname && u.pathname !== '/' && u.pathname !== '') {
          setErrorGral('La URL del CRM no debe incluir path (solo el dominio raíz)')
          return
        }
      } catch {
        setErrorGral('La URL del CRM no tiene un formato válido')
        return
      }
    }

    setGuardando(true); setErrorGral('')
    try {
      const payload = {
        tipo_operacion: tipoOperacion,
        nombre:         tipoOperacion === 'INDEPENDIENTE' ? nombre.trim() : null,
        razon_social:   tipoOperacion === 'SOCIEDAD' ? razonSocial.trim() : null,
        cuit:           cuit.trim() || null,
        matricula_ssn:  matriculaSsn.trim() || null,
        logo_path:      logoPath || null,
        usar_logo:      usarLogo,
        telefono:       telefono.trim() || null,
        whatsapp:       whatsapp.trim() || null,
        email:          email.trim() || null,
        direccion:      direccion.trim() || null,
        sitio_web:      sitioWeb.trim() || null,
        instagram:      instagram.trim() || null,
        facebook:       facebook.trim() || null,
        socios:         tipoOperacion === 'SOCIEDAD' ? socios : null,
        prefijo_casos:  prefijoCasos.trim().toUpperCase() || 'CASO',
        url_crm:        urlCrmTrim ? urlCrmTrim.replace(/\/+$/, '') : null,
        color_marca:    normalizarColorMarca(colorMarca),
        email_header_estilo: emailHeaderEstilo,
        email_header_subtitulo: emailHeaderSubtitulo.trim().slice(0, 80),
        cotizacion_whatsapp_template:     cotWspTemplate.trim() || null,
        cotizacion_email_asunto_template: cotEmailAsuntoTemplate.trim() || null,
        cotizacion_email_cuerpo_template: cotEmailCuerpoTemplate.trim() || null,
      }

      if (registroId) {
        const { error } = await supabase.from('configuracion').update(payload).eq('id', registroId)
        if (error) throw new Error(error.message)
      } else {
        const { data, error } = await supabase.from('configuracion').insert(payload).select('id').single()
        if (error) throw new Error(error.message)
        setRegistroId(data.id)
      }

      // Guardar en localStorage para sidebar y otros componentes (cache anti-flash)
      const displayName = tipoOperacion === 'SOCIEDAD' ? razonSocial.trim() : nombre.trim()
      localStorage.setItem('crm_perfil_nombre', displayName)
      localStorage.setItem('crm_perfil_logo', logoPath || '')
      localStorage.setItem('crm_perfil_usar_logo', usarLogo ? 'true' : 'false')
      // Notificar a sidebar/navbar de la misma pestaña que el perfil cambió.
      window.dispatchEvent(new Event('perfil-actualizado'))

      setExito(true)
      toast.exito('Perfil guardado')
      setTimeout(() => setExito(false), 3000)
    } catch (err: any) {
      const msg = mensajeErrorAmigable(err, 'No se pudo guardar el perfil')
      setErrorGral(msg)
      toast.error(msg)
    } finally {
      setGuardando(false)
    }
  }

  // ── Socios ─────────────────────────────────────────────
  const agregarSocio = () => setSocios(s => [...s, { nombre: '', matricula: '' }])
  const eliminarSocio = (i: number) => setSocios(s => s.filter((_, idx) => idx !== i))
  const actualizarSocio = (i: number, campo: keyof Socio, valor: string) => {
    setSocios(s => s.map((socio, idx) => idx === i ? { ...socio, [campo]: valor } : socio))
  }

  if (cargando) return (
    <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
      <Loader2 className="h-4 w-4 animate-spin" /> Cargando configuración...
    </div>
  )

  return (
    <div className="flex flex-col gap-4 max-w-3xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/crm/configuracion')} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center" title="Volver">
            <ArrowLeft className="h-3 w-3" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Perfil</h1>
            <p className="text-xs text-slate-500">Datos de tu organización</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {exito && (
            <span className="flex items-center gap-1 text-xs text-emerald-600">
              <CheckCircle className="h-3.5 w-3.5" /> Guardado
            </span>
          )}
          <button onClick={guardar} disabled={guardando} className="btn-primary px-5">
            {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            {guardando ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>

      {errorGral && (
        <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />{errorGral}
        </div>
      )}

      {/* ── Tipo de operación ───────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Tipo de operación</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <button
            onClick={() => setTipoOperacion('INDEPENDIENTE')}
            className={`flex items-start gap-3 p-3 rounded border-2 transition-all text-left ${
              tipoOperacion === 'INDEPENDIENTE'
                ? 'border-blue-400 bg-blue-50/50'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded shrink-0 ${
              tipoOperacion === 'INDEPENDIENTE' ? 'bg-blue-100' : 'bg-slate-100'
            }`}>
              <User className={`h-4 w-4 ${tipoOperacion === 'INDEPENDIENTE' ? 'text-blue-600' : 'text-slate-400'}`} />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-700">Productor independiente</p>
              <p className="text-2xs text-slate-500 mt-0.5">Autónomo o marca personal</p>
            </div>
          </button>
          <button
            onClick={() => setTipoOperacion('SOCIEDAD')}
            className={`flex items-start gap-3 p-3 rounded border-2 transition-all text-left ${
              tipoOperacion === 'SOCIEDAD'
                ? 'border-blue-400 bg-blue-50/50'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded shrink-0 ${
              tipoOperacion === 'SOCIEDAD' ? 'bg-blue-100' : 'bg-slate-100'
            }`}>
              <Building2 className={`h-4 w-4 ${tipoOperacion === 'SOCIEDAD' ? 'text-blue-600' : 'text-slate-400'}`} />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-700">Sociedad de productores</p>
              <p className="text-2xs text-slate-500 mt-0.5">Organización con múltiples socios</p>
            </div>
          </button>
        </div>
      </div>

      {/* ── Identidad ───────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Identidad</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          {tipoOperacion === 'INDEPENDIENTE' ? (<>
            <Campo label="Nombre completo o de fantasía" required>
              <input className="form-input w-full" value={nombre}
                onChange={e => setNombre(e.target.value)} placeholder="Ej: Juan Pérez Seguros" />
            </Campo>
            <Campo label="CUIT">
              <input className="form-input w-full font-mono" value={cuit}
                onChange={e => setCuit(e.target.value)} placeholder="20-12345678-9" />
            </Campo>
            <Campo label="Matrícula SSN">
              <input className="form-input w-full font-mono" value={matriculaSsn}
                onChange={e => setMatriculaSsn(e.target.value)} placeholder="Ej: 12345" />
            </Campo>
          </>) : (<>
            <Campo label="Razón social" required>
              <input className="form-input w-full" value={razonSocial}
                onChange={e => setRazonSocial(e.target.value)} placeholder="Ej: Pérez & Asociados SRL" />
            </Campo>
            <Campo label="CUIT" required>
              <input className="form-input w-full font-mono" value={cuit}
                onChange={e => setCuit(e.target.value)} placeholder="30-12345678-9" />
            </Campo>

            {/* Socios */}
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-slate-600">Socios</label>
                <button onClick={agregarSocio} className="btn-secondary flex items-center gap-1">
                  <Plus className="h-3 w-3" /> Agregar socio
                </button>
              </div>
              {socios.length === 0 ? (
                <p className="text-xs text-slate-400 py-2">No hay socios cargados</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {socios.map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input className="form-input flex-1" value={s.nombre}
                        onChange={e => actualizarSocio(i, 'nombre', e.target.value)}
                        placeholder="Nombre del socio" />
                      <input className="form-input w-32 font-mono" value={s.matricula}
                        onChange={e => actualizarSocio(i, 'matricula', e.target.value)}
                        placeholder="Matrícula SSN" />
                      <button onClick={() => eliminarSocio(i)}
                        className="h-7 w-7 flex items-center justify-center rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>)}
        </div>
      </div>

      {/* ── Logo ────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Logo</h3>
        </div>
        <div className="p-4 space-y-3">
          {/* Toggle: usar logo o no */}
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!usarLogo}
              onChange={e => setUsarLogo(!e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <div className="text-sm text-slate-700">No usar logo</div>
              <p className="text-2xs text-slate-400">
                Si lo marcás, en todo el sistema (sidebar, emails, PDFs, portal del cliente) aparece
                solo el nombre, sin imagen.
              </p>
            </div>
          </label>

          {usarLogo && (
            <div className="flex items-center gap-4 pt-2 border-t border-slate-100">
              {/* Preview */}
              <div className="flex h-16 w-16 items-center justify-center rounded border-2 border-dashed border-slate-200 bg-slate-50 shrink-0 overflow-hidden">
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo" className="h-full w-full object-contain" />
                ) : (
                  <Building2 className="h-6 w-6 text-slate-300" />
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden"
                    onChange={e => { if (e.target.files?.[0]) subirLogo(e.target.files[0]); e.target.value = '' }} />
                  <button onClick={() => inputRef.current?.click()} disabled={subiendoLogo}
                    className="btn-secondary flex items-center gap-1">
                    {subiendoLogo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                    {logoPreview ? 'Reemplazar' : 'Subir logo'}
                  </button>
                  {logoPreview && (
                    <button onClick={() => { setLogoPath(''); setLogoPreview(null) }}
                      className="btn-secondary flex items-center gap-1 text-red-600 hover:text-red-700">
                      <X className="h-3 w-3" /> Quitar
                    </button>
                  )}
                </div>
                <p className="text-2xs text-slate-400">PNG, JPG o SVG. Máximo 2MB.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Datos de contacto ───────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Datos de contacto</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Campo label="Teléfono">
            <input className="form-input w-full" value={telefono}
              onChange={e => setTelefono(e.target.value)} placeholder="Ej: 011 4567-8900" />
          </Campo>
          <Campo label="WhatsApp">
            <input className="form-input w-full" value={whatsapp}
              onChange={e => setWhatsapp(e.target.value)} placeholder="Ej: 5491145678900" />
          </Campo>
          <Campo label="Email de contacto">
            <input className="form-input w-full" value={email}
              onChange={e => setEmail(e.target.value)} placeholder="contacto@miorganizacion.com" />
          </Campo>
          <Campo label="Dirección">
            <input className="form-input w-full" value={direccion}
              onChange={e => setDireccion(e.target.value)} placeholder="Av. Corrientes 1234, CABA" />
          </Campo>
          <Campo label="Sitio web">
            <input className="form-input w-full" value={sitioWeb}
              onChange={e => setSitioWeb(e.target.value)} placeholder="www.miorganizacion.com" />
          </Campo>
          <Campo label="Instagram">
            <div className="flex gap-1">
              <span className="flex items-center px-2 bg-slate-100 border border-slate-300 rounded-l text-xs text-slate-500 border-r-0">@</span>
              <input className="form-input rounded-l-none flex-1" value={instagram}
                onChange={e => setInstagram(e.target.value)} placeholder="miorganizacion" />
            </div>
          </Campo>
          <Campo label="Facebook">
            <input className="form-input w-full" value={facebook}
              onChange={e => setFacebook(e.target.value)} placeholder="Nombre de la página" />
          </Campo>
        </div>
      </div>

      {/* Identificación de casos */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Identificación de casos</h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Campo label="Prefijo para casos" required>
            <input className="form-input w-full font-mono uppercase" value={prefijoCasos}
              onChange={e => setPrefijoCasos(e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 5))}
              placeholder="CASO" maxLength={5} />
          </Campo>
          <div className="flex items-end pb-1">
            <p className="text-2xs text-slate-400">
              Ejemplo: <span className="font-mono text-slate-600">{prefijoCasos || 'CASO'}-2026-0001</span>
            </p>
          </div>
          <div className="col-span-2">
            <p className="text-2xs text-amber-600">Si cambiás este prefijo, los casos existentes mantienen su número original. Solo los nuevos usarán el prefijo actualizado.</p>
          </div>
        </div>
      </div>

      {/* ── Mensajes predefinidos para cotizaciones ────────────── */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
          <MessageSquare className="h-3.5 w-3.5 text-slate-500" />
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Mensajes predefinidos para cotizaciones</h3>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="bg-blue-50 border border-blue-200 rounded p-2 text-2xs text-blue-800">
            Estos textos se usan al apretar <strong>"Enviar por WhatsApp"</strong> o <strong>"Enviar por email"</strong> desde la ficha de una cotización.
            Podés usar las siguientes variables — el sistema las reemplaza automáticamente:
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <code className="bg-white border border-blue-200 px-1.5 py-0.5 rounded font-mono">{'{nombre}'}</code>
              <span className="text-blue-700">primer nombre del destinatario</span>
              <code className="bg-white border border-blue-200 px-1.5 py-0.5 rounded font-mono ml-2">{'{numero}'}</code>
              <span className="text-blue-700">número de cotización</span>
              <code className="bg-white border border-blue-200 px-1.5 py-0.5 rounded font-mono ml-2">{'{ramo}'}</code>
              <span className="text-blue-700">ramo (Automotor, Hogar, etc.)</span>
              <code className="bg-white border border-blue-200 px-1.5 py-0.5 rounded font-mono ml-2">{'{opciones}'}</code>
              <span className="text-blue-700">cantidad de compañías comparadas</span>
            </div>
          </div>

          <Campo label="Mensaje de WhatsApp">
            <textarea
              className="form-input w-full font-mono text-xs"
              rows={3}
              value={cotWspTemplate}
              onChange={e => setCotWspTemplate(e.target.value)}
              placeholder="Hola {nombre}, te paso la cotización N° {numero}..."
            />
            <p className="text-2xs text-slate-500 mt-1">
              Texto que aparece pre-cargado en el chat de WhatsApp cuando apretás "Enviar por WhatsApp".
              El PDF se descarga automáticamente y vos lo adjuntás manualmente al chat.
            </p>
          </Campo>

          <Campo label="Asunto del email">
            <input
              className="form-input w-full font-mono text-xs"
              value={cotEmailAsuntoTemplate}
              onChange={e => setCotEmailAsuntoTemplate(e.target.value)}
              placeholder="Cotización {numero} - {ramo}"
            />
          </Campo>

          <Campo label="Cuerpo del email">
            <textarea
              className="form-input w-full font-mono text-xs"
              rows={3}
              value={cotEmailCuerpoTemplate}
              onChange={e => setCotEmailCuerpoTemplate(e.target.value)}
              placeholder="Hola {nombre}, adjuntamos la cotización N° {numero}..."
            />
            <p className="text-2xs text-slate-500 mt-1">
              Cuerpo del email que recibe tu cliente. El PDF de la cotización va adjunto.
              Requiere SMTP configurado en Configuración → Correos para que se mande.
            </p>
          </Campo>
        </div>
      </div>

      {/* ── Color de marca ──────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
          <Palette className="h-3.5 w-3.5 text-slate-500" />
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Color de marca</h3>
        </div>
        <div className="p-4 flex flex-col gap-4">
          <p className="text-2xs text-slate-500">
            Este color se aplica solo a <strong>las superficies que ven tus asegurados</strong>: PDFs de
            cotización, emails, portal del asegurado y formulario público de denuncia. El CRM interno
            mantiene su propia paleta y no se modifica.
          </p>

          {/* Paleta */}
          <div>
            <p className="text-2xs font-medium text-slate-600 uppercase tracking-wide mb-2">Sobrios</p>
            <div className="grid grid-cols-12 gap-1.5">
              {PALETA_COLORES_MARCA.filter(c => c.familia === 'sobrio').map(c => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setColorMarca(c.hex)}
                  title={`${c.nombre} (${c.hex})`}
                  className={`relative h-9 rounded border-2 transition-all ${
                    colorMarca.toUpperCase() === c.hex.toUpperCase()
                      ? 'border-slate-800 ring-2 ring-slate-300 scale-105'
                      : 'border-slate-200 hover:border-slate-400'
                  }`}
                  style={{ backgroundColor: c.hex }}
                >
                  {colorMarca.toUpperCase() === c.hex.toUpperCase() && (
                    <CheckCircle className="absolute inset-0 m-auto h-4 w-4" style={{ color: derivarTonos(c.hex).textoSobreColor }} />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-2xs font-medium text-slate-600 uppercase tracking-wide mb-2">Pasteles</p>
            <div className="grid grid-cols-12 gap-1.5">
              {PALETA_COLORES_MARCA.filter(c => c.familia === 'pastel').map(c => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setColorMarca(c.hex)}
                  title={`${c.nombre} (${c.hex})`}
                  className={`relative h-9 rounded border-2 transition-all ${
                    colorMarca.toUpperCase() === c.hex.toUpperCase()
                      ? 'border-slate-800 ring-2 ring-slate-300 scale-105'
                      : 'border-slate-200 hover:border-slate-400'
                  }`}
                  style={{ backgroundColor: c.hex }}
                >
                  {colorMarca.toUpperCase() === c.hex.toUpperCase() && (
                    <CheckCircle className="absolute inset-0 m-auto h-4 w-4" style={{ color: derivarTonos(c.hex).textoSobreColor }} />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Color personalizado */}
          <div>
            <p className="text-2xs font-medium text-slate-600 uppercase tracking-wide mb-2">Personalizado</p>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={colorMarca}
                onChange={e => setColorMarca(e.target.value)}
                className="h-9 w-12 rounded border border-slate-300 cursor-pointer p-0.5 bg-white"
                title="Elegí cualquier color"
              />
              <input
                key={colorMarca}
                type="text"
                defaultValue={colorMarca}
                onChange={e => {
                  // Input uncontrolled: solo actualizamos el state global
                  // cuando el usuario terminó de tipear un hex válido. Así
                  // puede borrar/escribir caracteres parciales sin que React
                  // pise el campo. El `key={colorMarca}` resincroniza el
                  // defaultValue cuando el color cambia desde la paleta o
                  // el picker visual.
                  const v = e.target.value.trim().toLowerCase()
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                    setColorMarca(v)
                  }
                }}
                placeholder="#0a1628"
                maxLength={7}
                className="form-input w-32 font-mono text-xs"
                title="Pegá un código hex (ej: #0a1628)"
              />
              <p className="text-2xs text-slate-400">
                Pegá el código exacto de tu marca o usá el selector visual.
              </p>
            </div>
          </div>

          {/* Color elegido */}
          {(() => {
            const tonos = derivarTonos(colorMarca)
            const nombreColor = PALETA_COLORES_MARCA.find(c => c.hex.toUpperCase() === colorMarca.toUpperCase())?.nombre
            return (
              <div className="flex items-center gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="h-6 w-6 rounded border border-slate-300 shrink-0" style={{ backgroundColor: tonos.base }} />
                <div className="flex-1">
                  <p className="text-xs font-medium text-slate-700">{nombreColor ?? 'Color personalizado'}</p>
                  <p className="text-2xs text-slate-500 font-mono">{tonos.base}</p>
                </div>
              </div>
            )
          })()}

          {/* Preview email-mock */}
          {(() => {
            const tonos = derivarTonos(colorMarca)
            return (
              <div>
                <p className="text-2xs font-medium text-slate-600 uppercase tracking-wide mb-2">
                  Vista previa — así se vería un email a tu cliente
                </p>
                <div className="border border-slate-200 rounded overflow-hidden bg-white">
                  {/* Header del email */}
                  <div className="px-4 py-3" style={{ backgroundColor: tonos.base, color: tonos.textoSobreColor }}>
                    <p className="text-sm font-semibold">{nombre || 'Tu Organización'}</p>
                  </div>
                  {/* Cuerpo */}
                  <div className="px-4 py-3 text-xs text-slate-700 space-y-2">
                    <p>Hola Juan,</p>
                    <p>Te enviamos los detalles de tu nueva póliza de automotor.</p>
                    <div className="rounded p-2 my-2 text-2xs" style={{ backgroundColor: tonos.muyClaro, borderLeft: `3px solid ${tonos.base}` }}>
                      <p className="font-semibold" style={{ color: tonos.oscuro }}>Datos importantes:</p>
                      <p className="text-slate-700">Vigencia desde 01/05/2026 hasta 01/05/2027</p>
                    </div>
                    <button
                      type="button"
                      className="text-2xs font-medium px-3 py-1.5 rounded inline-block"
                      style={{ backgroundColor: tonos.base, color: tonos.textoSobreColor }}
                    >
                      Ver en el portal
                    </button>
                    <p className="text-2xs text-slate-500 pt-2">Saludos cordiales.</p>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      {/* ── Estilo de encabezado de emails ──────────────────── */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
          <Palette className="h-3.5 w-3.5 text-slate-500" />
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Estilo de encabezado de emails
          </h3>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <p className="text-2xs text-slate-500">
            Elegí cómo se ve el encabezado de los emails que enviás a tus clientes.
            El color y el logo son los que ya configuraste arriba — solo cambia el bloque del encabezado.
          </p>
          {(() => {
            const tonos = derivarTonos(colorMarca)
            const nombreOrg = (tipoOperacion === 'SOCIEDAD' ? razonSocial : nombre) || 'Mi Organización'
            const inicial = (nombreOrg.charAt(0) || '?').toUpperCase()
            const mostrarLogo = usarLogo && !!logoPreview
            const opciones: Array<{
              valor: 'banda' | 'compacto' | 'lateral'
              titulo: string
              descripcion: string
              preview: React.ReactNode
            }> = [
              {
                valor: 'banda',
                titulo: 'Banda con logo',
                descripcion: 'Encabezado destacado con logo a la izquierda.',
                preview: (
                  <div className="rounded overflow-hidden bg-white">
                    <div
                      className="px-3 py-3 flex items-center gap-2"
                      style={{ background: `linear-gradient(135deg, ${tonos.base} 0%, ${tonos.oscuro} 100%)` }}
                    >
                      <div
                        className="h-7 w-7 rounded bg-white flex items-center justify-center shrink-0"
                        style={{ borderRadius: 6 }}
                      >
                        {mostrarLogo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={logoPreview!} alt="" className="max-h-5 max-w-5 object-contain" />
                        ) : (
                          <span className="text-xs font-bold" style={{ color: tonos.base }}>{inicial}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-white truncate leading-tight">{nombreOrg}</p>
                        {emailHeaderSubtitulo.trim() && (
                          <p className="text-[9px] text-white/70 uppercase tracking-widest mt-0.5 truncate">{emailHeaderSubtitulo.trim()}</p>
                        )}
                      </div>
                    </div>
                    <div className="h-[3px]" style={{ backgroundColor: '#D4DDE8' }}></div>
                  </div>
                ),
              },
              {
                valor: 'compacto',
                titulo: 'Compacto',
                descripcion: 'Encabezado fino, protagonismo al cuerpo del email.',
                preview: (
                  <div className="rounded overflow-hidden bg-white">
                    <div
                      className="px-3 py-2 flex items-center justify-between gap-2"
                      style={{ background: `linear-gradient(135deg, ${tonos.base} 0%, ${tonos.oscuro} 100%)` }}
                    >
                      <p className="text-[11px] font-bold text-white truncate">{nombreOrg}</p>
                      <div
                        className="h-5 w-5 rounded bg-white flex items-center justify-center shrink-0"
                        style={{ borderRadius: 4 }}
                      >
                        {mostrarLogo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={logoPreview!} alt="" className="max-h-3.5 max-w-3.5 object-contain" />
                        ) : (
                          <span className="text-[9px] font-bold" style={{ color: tonos.base }}>{inicial}</span>
                        )}
                      </div>
                    </div>
                    <div className="h-[2px]" style={{ backgroundColor: '#D4DDE8' }}></div>
                  </div>
                ),
              },
              {
                valor: 'lateral',
                titulo: 'Borde lateral',
                descripcion: 'Sin bloque de color, borde superior fino.',
                preview: (
                  <div className="rounded overflow-hidden bg-white border-t-[3px]" style={{ borderTopColor: tonos.base }}>
                    <div className="px-3 py-3 flex items-center gap-2 bg-white">
                      <div
                        className="h-6 w-6 rounded flex items-center justify-center shrink-0"
                        style={{ backgroundColor: tonos.base, borderRadius: 5 }}
                      >
                        {mostrarLogo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={logoPreview!} alt="" className="max-h-4 max-w-4 object-contain brightness-0 invert" />
                        ) : (
                          <span className="text-[10px] font-bold text-white">{inicial}</span>
                        )}
                      </div>
                      <p className="text-xs font-bold truncate" style={{ color: tonos.base }}>{nombreOrg}</p>
                    </div>
                  </div>
                ),
              },
            ]
            const placeholderSubtitulo = tipoOperacion === 'SOCIEDAD'
              ? 'Sociedad de Productores Asesores de Seguros'
              : 'Productor Asesor de Seguros'
            return (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {opciones.map(op => {
                    const seleccionada = emailHeaderEstilo === op.valor
                    return (
                      <button
                        key={op.valor}
                        type="button"
                        onClick={() => setEmailHeaderEstilo(op.valor)}
                        className={`flex flex-col gap-2 rounded border-2 p-2.5 text-left transition-all ${
                          seleccionada
                            ? 'border-slate-800 ring-2 ring-slate-300 bg-slate-50'
                            : 'border-slate-200 hover:border-slate-400 bg-white'
                        }`}
                      >
                        <div className="border border-slate-200 rounded overflow-hidden">
                          {op.preview}
                          <div className="h-6 bg-slate-50 border-t border-slate-100"></div>
                        </div>
                        <div className="flex items-start gap-2">
                          <div className={`h-3.5 w-3.5 rounded-full border-2 shrink-0 mt-0.5 ${seleccionada ? 'border-slate-800 bg-slate-800' : 'border-slate-300 bg-white'}`}>
                            {seleccionada && <div className="h-1.5 w-1.5 rounded-full bg-white m-auto mt-0.5"></div>}
                          </div>
                          <div className="flex-1">
                            <p className="text-xs font-semibold text-slate-700">{op.titulo}</p>
                            <p className="text-2xs text-slate-500 mt-0.5 leading-snug">{op.descripcion}</p>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>

                {/* Subtítulo editable de la variante banda */}
                <div className="pt-2 border-t border-slate-100">
                  <label className="block text-2xs font-medium text-slate-600 uppercase tracking-wide mb-1.5">
                    Subtítulo del encabezado
                  </label>
                  <input
                    type="text"
                    value={emailHeaderSubtitulo}
                    onChange={e => setEmailHeaderSubtitulo(e.target.value.slice(0, 80))}
                    placeholder={placeholderSubtitulo}
                    maxLength={80}
                    className="form-input w-full text-xs"
                  />
                  <p className="text-2xs text-slate-500 mt-1">
                    Aparece debajo del nombre <strong>solo en la variante "Banda con logo"</strong>.
                    Dejá vacío si no querés que se muestre.
                  </p>
                </div>
              </>
            )
          })()}
        </div>
      </div>

      {/* ── Acceso público al CRM ────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
          <Link2 className="h-3.5 w-3.5 text-slate-500" />
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Acceso público al CRM</h3>
        </div>
        <div className="p-4 flex flex-col gap-2">
          <Campo label="URL pública del CRM (login y admin)">
            <input
              type="url"
              value={urlCrm}
              onChange={e => setUrlCrm(e.target.value)}
              placeholder="https://crm.suempresa.com.ar"
              className="form-input w-full text-xs font-mono"
            />
          </Campo>
          <p className="text-2xs text-slate-500">
            Pegá el subdominio público que vas a usar para entrar al CRM (Cloudflare Tunnel u otro). Solo el dominio raíz, sin <code className="bg-slate-100 px-1 rounded">/login</code>.
            Esta URL se usa para los links que aparecen dentro de los emails que envía el sistema.
          </p>
          <p className="text-2xs text-slate-400">
            La URL del <strong>portal del asegurado</strong> y la del <strong>formulario público de denuncia</strong> se configuran en sus pantallas correspondientes.
          </p>
        </div>
      </div>

      {/* Botones */}
      <div className="flex items-center justify-between pb-4">
        <button onClick={() => router.push('/crm/configuracion')} className="btn-secondary">
          <ArrowLeft className="h-3 w-3" /> Volver
        </button>
        <button onClick={guardar} disabled={guardando} className="btn-primary px-6">
          {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {guardando ? 'Guardando...' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}
