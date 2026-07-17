'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Loader2, CheckCircle, Power, PowerOff,
  Link2, Copy, Check, FileText, ExternalLink, AlertTriangle
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { copiarAlPortapapeles } from '@/lib/copiar-portapapeles'

function Campo({ label, required, ayuda, children }: {
  label: string; required?: boolean; ayuda?: string; children: React.ReactNode
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {ayuda && <p className="text-2xs text-slate-400 mt-1">{ayuda}</p>}
    </div>
  )
}

export default function FormularioPublicoPage() {
  const router = useRouter()
  const { usuario, loading: authLoading, isAdmin } = useAuth()

  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [guardadoOk, setGuardadoOk] = useState(false)
  const [errorGral, setErrorGral] = useState('')
  const [copiado, setCopiado] = useState(false)

  // Config state
  const [activo, setActivo] = useState(true)
  const [tituloHero, setTituloHero] = useState('Denunciar Siniestro')
  const [subtituloHero, setSubtituloHero] = useState('')
  const [mensajeValidacion, setMensajeValidacion] = useState('')
  const [mensajeFuera, setMensajeFuera] = useState('')
  const [terminosActivos, setTerminosActivos] = useState(false)
  const [terminosTitulo, setTerminosTitulo] = useState('Términos y Condiciones')
  const [terminosContenido, setTerminosContenido] = useState('')
  const [urlPublica, setUrlPublica] = useState('')

  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const mountedRef = useRef(false)

  // Redirect if not admin
  useEffect(() => {
    if (!authLoading && (!usuario || !isAdmin)) {
      router.push('/crm/dashboard')
    }
  }, [authLoading, usuario, isAdmin, router])

  // Load config
  useEffect(() => {
    async function cargar() {
      const r = await apiCall<{ configuracion?: any }>('/api/configuracion/formulario-publico', undefined, { mostrar_toast_en_error: false })
      if (r.ok && r.data?.configuracion) {
        const c = r.data.configuracion
        setActivo(c.activo ?? true)
        setTituloHero(c.titulo_hero || 'Denunciar Siniestro')
        setSubtituloHero(c.subtitulo_hero || '')
        setMensajeValidacion(c.mensaje_validacion_fallida || '')
        setMensajeFuera(c.mensaje_fuera_servicio || '')
        setTerminosActivos(c.terminos_activos ?? false)
        setTerminosTitulo(c.terminos_titulo || 'Términos y Condiciones')
        setTerminosContenido(c.terminos_contenido || '')
        setUrlPublica(c.url_publica || '')
      } else if (!r.ok) {
        setErrorGral(r.error?.mensaje ?? 'Error al cargar la configuración')
      }
      setCargando(false)
      // Mark as mounted after initial load to prevent auto-save on load
      setTimeout(() => { mountedRef.current = true }, 100)
    }
    if (!authLoading && usuario) cargar()
  }, [authLoading, usuario])

  // Auto-save with debounce
  const guardar = useCallback(async (datos: Record<string, any>) => {
    if (!mountedRef.current) return
    setGuardando(true)
    setErrorGral('')
    setGuardadoOk(false)

    const r = await apiCall('/api/configuracion/formulario-publico', {
      method: 'PATCH',
      body: datos,
    }, { mostrar_toast_en_error: false })

    if (!r.ok) {
      setErrorGral(r.error?.mensaje ?? 'Error al guardar')
    } else {
      setGuardadoOk(true)
      setTimeout(() => setGuardadoOk(false), 2000)
    }
    setGuardando(false)
  }, [])

  const debouncedSave = useCallback((datos: Record<string, any>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => guardar(datos), 500)
  }, [guardar])

  // Immediate save (for switches)
  const immediateSave = useCallback((datos: Record<string, any>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    guardar(datos)
  }, [guardar])

  // URL completa al formulario = base + /denuncia.
  // Strip defensivo de /denuncia al final por si el PAS pegó la URL completa
  // o el env legacy traía el path embebido (bug histórico del instalador).
  const urlCompleta = urlPublica
    ? `${urlPublica.replace(/\/+$/, '').replace(/\/denuncia$/i, '')}/denuncia`
    : ''

  const copiarUrl = async () => {
    if (!urlCompleta) return
    const ok = await copiarAlPortapapeles(urlCompleta)
    if (ok) {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } else {
      toast.error('No se pudo copiar al portapapeles')
    }
  }

  if (authLoading || cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  if (!usuario || !isAdmin) return null

  return (
    <div className="flex flex-col gap-4 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/crm/configuracion')} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-3.5 w-3.5" /> Volver
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-slate-800">Formulario público de siniestros</h1>
          <p className="text-xs text-slate-500">Configurá el formulario de denuncia de siniestros que usan tus clientes.</p>
        </div>
        {/* Save indicator */}
        <div className="flex items-center gap-1.5 text-2xs">
          {guardando && <><Loader2 className="h-3 w-3 animate-spin text-slate-400" /><span className="text-slate-400">Guardando...</span></>}
          {guardadoOk && <><CheckCircle className="h-3 w-3 text-green-500" /><span className="text-green-600">Guardado</span></>}
        </div>
      </div>

      {errorGral && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded p-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {errorGral}
        </div>
      )}

      {/* SECCIÓN 1 — Estado */}
      <div className={`border rounded-lg p-4 ${activo ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {activo
              ? <Power className="h-5 w-5 text-green-600" />
              : <PowerOff className="h-5 w-5 text-red-500" />
            }
            <div>
              <p className={`text-sm font-medium ${activo ? 'text-green-800' : 'text-red-800'}`}>
                {activo ? 'Activo — Recibiendo denuncias' : 'Desactivado — Fuera de servicio'}
              </p>
              <p className={`text-2xs mt-0.5 ${activo ? 'text-green-600' : 'text-red-600'}`}>
                {activo
                  ? 'Los clientes pueden cargar denuncias desde el formulario público.'
                  : 'Los clientes ven un mensaje de fuera de servicio.'}
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={activo}
              onChange={e => {
                setActivo(e.target.checked)
                immediateSave({ activo: e.target.checked })
              }}
              className="sr-only peer"
            />
            <div className="w-10 h-5 bg-slate-300 peer-checked:bg-green-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
          </label>
        </div>
      </div>

      {/* SECCIÓN 2 — URL pública del subdominio */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-1">
          <Link2 className="h-4 w-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-slate-800">URL del subdominio del formulario</h2>
        </div>
        <p className="text-2xs text-slate-500 mb-3">
          Pegá el subdominio público que apunta a este servidor (ej: <code className="bg-slate-100 px-1 rounded">https://siniestros.suempresa.com.ar</code>).
          El sistema le agrega <code className="bg-slate-100 px-1 rounded">/denuncia</code> automáticamente al armar el link que vas a compartir.
        </p>
        <input
          type="url"
          value={urlPublica}
          onChange={e => setUrlPublica(e.target.value)}
          onBlur={() => immediateSave({ url_publica: urlPublica.trim() || null })}
          placeholder="https://siniestros.suempresa.com.ar"
          className="form-input w-full text-xs font-mono"
        />
        {urlPublica && urlCompleta && (
          <div className="mt-3">
            <p className="text-2xs text-slate-500 mb-1">Link completo para compartir con clientes:</p>
            <div className="flex gap-2">
              <div
                onClick={copiarUrl}
                className="flex-1 bg-blue-50 border border-blue-200 rounded px-3 py-2 text-xs font-mono text-blue-700 cursor-pointer hover:bg-blue-100 select-all"
                title="Clic para copiar"
              >
                {urlCompleta}
              </div>
              <button
                onClick={copiarUrl}
                className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 whitespace-nowrap"
              >
                {copiado ? <><Check className="h-3 w-3" /> Copiado</> : <><Copy className="h-3 w-3" /> Copiar</>}
              </button>
            </div>
          </div>
        )}
        {!urlPublica && (
          <p className="text-2xs text-amber-600 mt-2">
            Mientras no configures la URL, los emails de denuncia no van a tener un link para compartir con tus clientes.
          </p>
        )}
      </div>

      {/* SECCIÓN 3 — Textos */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-1">
          <FileText className="h-4 w-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-slate-800">Textos del formulario</h2>
        </div>
        <p className="text-2xs text-slate-500 mb-4">Personalizá los textos que ve el cliente al entrar al formulario.</p>

        <div className="flex flex-col gap-4">
          <Campo label="Título principal" required ayuda="Aparece como título grande en el hero banner del formulario. Máx. 100 caracteres.">
            <input
              type="text"
              className="form-input w-full text-xs"
              maxLength={100}
              placeholder="Denunciar Siniestro"
              value={tituloHero}
              onChange={e => {
                setTituloHero(e.target.value)
                debouncedSave({ titulo_hero: e.target.value })
              }}
            />
          </Campo>

          <Campo label="Subtítulo" required ayuda="Aparece debajo del título. Máx. 300 caracteres.">
            <textarea
              className="form-input w-full text-xs"
              rows={2}
              maxLength={300}
              placeholder="Completá los datos de tu siniestro de forma rápida y segura..."
              value={subtituloHero}
              onChange={e => {
                setSubtituloHero(e.target.value)
                debouncedSave({ subtitulo_hero: e.target.value })
              }}
            />
          </Campo>

          <Campo label="Mensaje cuando los datos no coinciden" required ayuda="Mensaje que ve el cliente si su DNI, email o póliza no coinciden. Por seguridad, evitá dar pistas específicas. Máx. 500 caracteres.">
            <textarea
              className="form-input w-full text-xs"
              rows={3}
              maxLength={500}
              placeholder="Los datos ingresados no coinciden con nuestro sistema..."
              value={mensajeValidacion}
              onChange={e => {
                setMensajeValidacion(e.target.value)
                debouncedSave({ mensaje_validacion_fallida: e.target.value })
              }}
            />
          </Campo>

          <Campo label="Mensaje cuando el formulario está desactivado" required ayuda="Mensaje que ve el cliente cuando el switch de arriba está desactivado. Máx. 500 caracteres.">
            <textarea
              className="form-input w-full text-xs"
              rows={3}
              maxLength={500}
              placeholder="El formulario de denuncias está temporalmente fuera de servicio..."
              value={mensajeFuera}
              onChange={e => {
                setMensajeFuera(e.target.value)
                debouncedSave({ mensaje_fuera_servicio: e.target.value })
              }}
            />
          </Campo>
        </div>
      </div>

      {/* SECCIÓN 4 — Términos */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Términos y Condiciones</h2>
            <p className="text-2xs text-slate-500 mt-0.5">Si está activo, el cliente debe leer y aceptar los términos antes de enviar.</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={terminosActivos}
              onChange={e => {
                setTerminosActivos(e.target.checked)
                immediateSave({ terminos_activos: e.target.checked })
              }}
              className="sr-only peer"
            />
            <div className="w-10 h-5 bg-slate-300 peer-checked:bg-blue-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
          </label>
        </div>

        {terminosActivos && (
          <div className="flex flex-col gap-4 border-t border-slate-100 pt-4">
            <Campo label="Título de los términos" ayuda="Máx. 100 caracteres.">
              <input
                type="text"
                className="form-input w-full text-xs"
                maxLength={100}
                placeholder="Términos y Condiciones"
                value={terminosTitulo}
                onChange={e => {
                  setTerminosTitulo(e.target.value)
                  debouncedSave({ terminos_titulo: e.target.value })
                }}
              />
            </Campo>

            <Campo label="Contenido de los términos" required ayuda="Texto plano. Líneas en blanco para separar párrafos. Máx. 5000 caracteres.">
              <textarea
                className="form-input w-full text-xs"
                rows={8}
                maxLength={5000}
                placeholder="Escribí acá el texto completo de los términos y condiciones..."
                value={terminosContenido}
                onChange={e => {
                  setTerminosContenido(e.target.value)
                  debouncedSave({ terminos_contenido: e.target.value })
                }}
              />
              <p className="text-2xs text-slate-400 mt-1 text-right">{terminosContenido.length}/5000</p>
            </Campo>
          </div>
        )}
      </div>

      {/* SECCIÓN 5 — Vista previa */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Vista previa</h2>
            <p className="text-2xs text-slate-500 mt-0.5">Abrí el formulario público para ver cómo queda.</p>
          </div>
          <button
            onClick={() => window.open('/denuncia', '_blank')}
            className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <ExternalLink className="h-3 w-3" /> Ver formulario
          </button>
        </div>
      </div>
    </div>
  )
}
