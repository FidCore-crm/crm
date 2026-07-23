'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Save, Loader2, AlertCircle, CheckCircle,
  User, Building2, Plus, Trash2, Upload, X, MessageSquare, Palette
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
import { ACLARACIONES_COTIZACION_DEFAULT_TEXTO } from '@/lib/cotizacion-aclaraciones'

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
  const [colorMarca,   setColorMarca]   = useState(COLOR_MARCA_DEFAULT)
  const [emailHeaderEstilo, setEmailHeaderEstilo] = useState<'banda' | 'compacto' | 'lateral' | 'blanco_solo_logo'>('banda')
  const [emailHeaderSubtitulo, setEmailHeaderSubtitulo] = useState('')
  // v1.0.151: state `emailHeaderOcultarNombre` eliminado — las variantes
  // "Solo logo — fondo color/blanco" (v1.0.150) reemplazaron el caso de uso.

  // v1.0.157: se retiró el textarea "Mensaje de WhatsApp para cotizaciones".
  // La plantilla real vive en `plantillas_whatsapp.envio_cotizacion` y se
  // edita desde /crm/configuracion/comunicaciones → sección WhatsApp.
  // La columna `configuracion.cotizacion_whatsapp_template` queda en DB por
  // compat con backups anteriores pero ninguna superficie del CRM la lee.

  // Aclaraciones legales al pie del PDF de cotización — editable con default
  // razonable de plaza. Texto plano con párrafos separados por línea en blanco.
  const [cotAclaraciones, setCotAclaraciones] = useState('')

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
        setColorMarca(normalizarColorMarca(data.color_marca))
        const estiloGuardado = (data as any).email_header_estilo
        if (
          estiloGuardado === 'compacto' ||
          estiloGuardado === 'lateral' ||
          estiloGuardado === 'banda' ||
          estiloGuardado === 'blanco_solo_logo'
        ) {
          setEmailHeaderEstilo(estiloGuardado)
        } else if (estiloGuardado === 'banda_solo_logo') {
          // v1.0.152: la variante 'banda_solo_logo' se eliminó. Los registros
          // migrados por la migración 136 pasan a 'blanco_solo_logo'; este
          // fallback es defensivo por si el load lee un cache viejo.
          setEmailHeaderEstilo('blanco_solo_logo')
        }
        setEmailHeaderSubtitulo((data as any).email_header_subtitulo ?? '')
        setCotAclaraciones((data as any).cotizacion_aclaraciones ?? '')
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
        color_marca:    normalizarColorMarca(colorMarca),
        email_header_estilo: emailHeaderEstilo,
        email_header_subtitulo: emailHeaderSubtitulo.trim().slice(0, 80),
        cotizacion_aclaraciones:          cotAclaraciones.trim() || null,
      }

      if (registroId) {
        const { error } = await supabase.from('configuracion').update(payload).eq('id', registroId)
        if (error) throw new Error(error.message)
      } else {
        const { data, error } = await supabase.from('configuracion').insert(payload).select('id').single()
        if (error) throw new Error(error.message)
        setRegistroId(data.id)
      }

      // Invalidar cache server-side de variables de organización para que
      // los previews de plantillas reflejen el cambio recién guardado.
      fetch('/api/configuracion/invalidar-cache', { method: 'POST' }).catch(() => {})

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
    <div className="flex items-center justify-center py-20 text-slate-500 text-sm gap-2">
      <Loader2 className="h-4 w-4 animate-spin" /> Cargando configuración...
    </div>
  )

  return (
    <div className="flex flex-col gap-4 max-w-6xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => router.push('/crm/configuracion')} className="btn-secondary h-7 w-7 p-0 flex items-center justify-center" title="Volver">
            <ArrowLeft className="h-3 w-3" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Perfil</h1>
            <p className="text-xs text-slate-600">Datos de tu organización</p>
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
              <User className={`h-4 w-4 ${tipoOperacion === 'INDEPENDIENTE' ? 'text-blue-600' : 'text-slate-500'}`} />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-700">Productor independiente</p>
              <p className="text-2xs text-slate-600 mt-0.5">Autónomo o marca personal</p>
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
              <Building2 className={`h-4 w-4 ${tipoOperacion === 'SOCIEDAD' ? 'text-blue-600' : 'text-slate-500'}`} />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-700">Sociedad de productores</p>
              <p className="text-2xs text-slate-600 mt-0.5">Organización con múltiples socios</p>
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
                <p className="text-xs text-slate-500 py-2">No hay socios cargados</p>
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
                        className="h-7 w-7 flex items-center justify-center rounded text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0">
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
              <p className="text-2xs text-slate-500">
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
                <p className="text-2xs text-slate-500">PNG, JPG o SVG. Máximo 2MB.</p>
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
              <span className="flex items-center px-2 bg-slate-100 border border-slate-300 rounded-l text-xs text-slate-600 border-r-0">@</span>
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
            <p className="text-2xs text-slate-500">
              Ejemplo: <span className="font-mono text-slate-600">{prefijoCasos || 'CASO'}-2026-0001</span>
            </p>
          </div>
          <div className="col-span-2">
            <p className="text-2xs text-amber-600">Si cambiás este prefijo, los casos existentes mantienen su número original. Solo los nuevos usarán el prefijo actualizado.</p>
          </div>
        </div>
      </div>

      {/* ── Aclaraciones al pie del PDF de cotización ───────── */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5 text-slate-600" />
            <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Aclaraciones al pie del PDF de cotización</h3>
          </div>
          <button
            type="button"
            className="btn-secondary text-2xs"
            onClick={() => {
              if (cotAclaraciones.trim() && cotAclaraciones !== ACLARACIONES_COTIZACION_DEFAULT_TEXTO) {
                if (!confirm('¿Reemplazar el texto actual por las aclaraciones default del rubro?')) return
              }
              setCotAclaraciones(ACLARACIONES_COTIZACION_DEFAULT_TEXTO)
            }}
          >
            Restaurar default
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="bg-slate-50 border border-slate-200 rounded p-2 text-2xs text-slate-600">
            Este texto aparece al final del PDF de cada cotización, con tono discreto. Separá cada aclaración con una <strong>línea en blanco</strong> —
            cada bloque queda como un párrafo aparte. Dejalo vacío si preferís que no aparezcan aclaraciones.
          </div>

          <Campo label="Aclaraciones">
            <textarea
              className="form-input w-full text-xs"
              rows={12}
              value={cotAclaraciones}
              onChange={e => setCotAclaraciones(e.target.value)}
              placeholder={ACLARACIONES_COTIZACION_DEFAULT_TEXTO.slice(0, 200) + '...'}
            />
          </Campo>
        </div>
      </div>

      {/* ── Color de marca ──────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
          <Palette className="h-3.5 w-3.5 text-slate-600" />
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Color de marca</h3>
        </div>
        <div className="p-4 flex flex-col gap-4">
          <p className="text-2xs text-slate-600">
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
              <p className="text-2xs text-slate-500">
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
                  <p className="text-2xs text-slate-600 font-mono">{tonos.base}</p>
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
                    <p className="text-2xs text-slate-600 pt-2">Saludos cordiales.</p>
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
          <Palette className="h-3.5 w-3.5 text-slate-600" />
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Estilo de encabezado de emails
          </h3>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <p className="text-2xs text-slate-600">
            Elegí cómo se ve el encabezado de los emails que enviás a tus clientes.
            El color y el logo son los que ya configuraste arriba — solo cambia el bloque del encabezado.
          </p>
          {(() => {
            const tonos = derivarTonos(colorMarca)
            const nombreOrg = (tipoOperacion === 'SOCIEDAD' ? razonSocial : nombre) || 'Mi Organización'
            const inicial = (nombreOrg.charAt(0) || '?').toUpperCase()
            const mostrarLogo = usarLogo && !!logoPreview
            const opciones: Array<{
              valor: 'banda' | 'compacto' | 'lateral' | 'blanco_solo_logo'
              titulo: string
              descripcion: string
              preview: React.ReactNode
            }> = [
              {
                valor: 'banda',
                titulo: 'Banda clásica',
                descripcion: 'Logo dentro de un cuadro blanco sobre el color de marca. La opción más segura — funciona con cualquier logo.',
                preview: (
                  <div className="rounded overflow-hidden bg-white">
                    <div
                      className="px-3 py-3 flex items-center gap-2"
                      style={{ background: `linear-gradient(135deg, ${tonos.base} 0%, ${tonos.stopMedio} 60%, ${tonos.stopProfundo} 100%)` }}
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
                        <p className="text-xs font-bold truncate leading-tight" style={{ color: tonos.textoSobreColor }}>{nombreOrg}</p>
                        {emailHeaderSubtitulo.trim() && (
                          <p className="text-[9px] uppercase tracking-widest mt-0.5 truncate" style={{ color: tonos.esOscuro ? '#CBD5E1' : '#475569' }}>{emailHeaderSubtitulo.trim()}</p>
                        )}
                      </div>
                    </div>
                    <div className="h-[3px]" style={{ backgroundColor: tonos.stopProfundo }}></div>
                  </div>
                ),
              },
              {
                valor: 'compacto',
                titulo: 'Banda integrada',
                descripcion: 'Logo directo sobre el color de marca, sin cuadro. Ideal si tu logo tiene fondo blanco o transparente.',
                preview: (
                  <div className="rounded overflow-hidden bg-white">
                    <div
                      className="px-3 py-3 flex items-center gap-2"
                      style={{ background: `linear-gradient(135deg, ${tonos.base} 0%, ${tonos.stopMedio} 60%, ${tonos.stopProfundo} 100%)` }}
                    >
                      <div className="h-7 w-7 flex items-center justify-center shrink-0">
                        {mostrarLogo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={logoPreview!} alt="" className="max-h-6 max-w-6 object-contain" />
                        ) : (
                          <span className="text-xs font-bold" style={{ color: tonos.textoSobreColor }}>{inicial}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate leading-tight" style={{ color: tonos.textoSobreColor }}>{nombreOrg}</p>
                        {emailHeaderSubtitulo.trim() && (
                          <p className="text-[9px] uppercase tracking-widest mt-0.5 truncate" style={{ color: tonos.esOscuro ? '#CBD5E1' : '#475569' }}>{emailHeaderSubtitulo.trim()}</p>
                        )}
                      </div>
                    </div>
                    <div className="h-[3px]" style={{ backgroundColor: tonos.stopProfundo }}></div>
                  </div>
                ),
              },
              {
                valor: 'lateral',
                titulo: 'Banda con logo teñido',
                descripcion: 'El logo se tiñe automáticamente en blanco o negro según tu color de marca. Ideal si tu logo es de un solo color.',
                preview: (
                  <div className="rounded overflow-hidden bg-white">
                    <div
                      className="px-3 py-3 flex items-center gap-2"
                      style={{ background: `linear-gradient(135deg, ${tonos.base} 0%, ${tonos.stopMedio} 60%, ${tonos.stopProfundo} 100%)` }}
                    >
                      <div className="h-7 w-7 flex items-center justify-center shrink-0">
                        {mostrarLogo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={logoPreview!}
                            alt=""
                            className="max-h-6 max-w-6 object-contain"
                            style={tonos.esOscuro
                              ? { filter: 'brightness(0) invert(1)' }
                              : { filter: 'brightness(0)', opacity: 0.82 }}
                          />
                        ) : (
                          <span className="text-xs font-bold" style={{ color: tonos.textoSobreColor }}>{inicial}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate leading-tight" style={{ color: tonos.textoSobreColor }}>{nombreOrg}</p>
                        {emailHeaderSubtitulo.trim() && (
                          <p className="text-[9px] uppercase tracking-widest mt-0.5 truncate" style={{ color: tonos.esOscuro ? '#CBD5E1' : '#475569' }}>{emailHeaderSubtitulo.trim()}</p>
                        )}
                      </div>
                    </div>
                    <div className="h-[3px]" style={{ backgroundColor: tonos.stopProfundo }}></div>
                  </div>
                ),
              },
              // v1.0.150 agregó 2 variantes "solo logo". v1.0.152 sacó
              // 'banda_solo_logo' — queda solo la de fondo blanco.
              {
                valor: 'blanco_solo_logo',
                titulo: 'Solo logo — fondo blanco',
                descripcion: 'Fondo blanco con una barra fina de tu color de marca arriba. Elegante y sobrio.',
                preview: (
                  <div className="rounded overflow-hidden bg-white">
                    <div className="h-[3px]" style={{ backgroundColor: tonos.base }}></div>
                    <div
                      className="flex items-center justify-center bg-white"
                      style={{ height: 56, padding: '8px 12px' }}
                    >
                      {mostrarLogo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={logoPreview!}
                          alt=""
                          style={{ height: 32, maxWidth: 130, objectFit: 'contain', display: 'block' }}
                        />
                      ) : (
                        <span className="text-sm font-bold" style={{ color: tonos.base }}>{nombreOrg}</span>
                      )}
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
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
                            <p className="text-2xs text-slate-600 mt-0.5 leading-snug">{op.descripcion}</p>
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
                  <p className="text-2xs text-slate-600 mt-1">
                    Aparece debajo del nombre <strong>solo en la variante "Banda con logo"</strong>.
                    Dejá vacío si no querés que se muestre.
                  </p>
                </div>

                {/* v1.0.151: eliminado el checkbox "Ocultar el nombre en el encabezado"
                    (v1.0.149). Las 2 variantes nuevas "Solo logo — fondo color" y
                    "Solo logo — fondo blanco" (v1.0.150) ya cubren ese caso — el
                    checkbox universal quedaba redundante. La columna DB queda con
                    su valor pero se ignora en el renderer. */}
              </>
            )
          })()}
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
