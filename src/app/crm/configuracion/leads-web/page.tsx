'use client'

/**
 * Pantalla de configuración del sistema de leads desde formularios web.
 * Solo admin.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Inbox,
  Copy,
  RefreshCw,
  Plus,
  X,
  Globe,
  Code,
  Send,
  Loader2,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Mail,
  Power,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'
import { generarHtmlFormEjemplo, normalizarDominio, type ModoAsignacionLeadsWeb } from '@/lib/leads-web-shared'

interface ConfiguracionLeadsWeb {
  id: string
  activo: boolean
  token: string
  dominios_permitidos: string[]
  modo_asignacion: ModoAsignacionLeadsWeb
  notificar_email_admin: boolean
  notificar_inapp: boolean
  recibidos_mes_actual: number
  recibidos_historico: number
  ultimo_lead_recibido_en: string | null
}

interface IntentoLog {
  id: string
  exito: boolean
  ip: string | null
  referer: string | null
  motivo_rechazo: string | null
  created_at: string
}

const LABELS_RECHAZO: Record<string, string> = {
  TOKEN_INVALIDO: 'Token incorrecto',
  SISTEMA_INACTIVO: 'Sistema desactivado',
  RATE_LIMIT: 'Demasiados intentos',
  HONEYPOT: 'Bot detectado',
  REFERER_INVALIDO: 'Dominio no autorizado',
  CAMPOS_FALTANTES: 'Faltan campos',
  EMAIL_INVALIDO: 'Email inválido',
  PAYLOAD_GRANDE: 'Formulario muy grande',
  ERROR_INTERNO: 'Error del servidor',
}

export default function LeadsWebConfigPage() {
  const router = useRouter()
  const { usuario, isAdmin } = useAuth()

  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [cfg, setCfg] = useState<ConfiguracionLeadsWeb | null>(null)
  const [intentos, setIntentos] = useState<IntentoLog[]>([])
  const [tabActiva, setTabActiva] = useState<'html' | 'formsubmit' | 'desarrollador'>('html')
  const [nuevoDominio, setNuevoDominio] = useState('')
  const [redirectTo, setRedirectTo] = useState('')

  const baseUrl = useMemo(() => {
    if (typeof window === 'undefined') return ''
    return window.location.origin
  }, [])

  const urlPublica = useMemo(() => {
    if (!cfg) return ''
    return `${baseUrl}/api/publico/leads/${cfg.token}`
  }, [baseUrl, cfg])

  const cargar = useCallback(async () => {
    const r = await apiCall<{ configuracion: ConfiguracionLeadsWeb | null }>(
      '/api/configuracion/leads-web',
      undefined,
      { mostrar_toast_en_error: false },
    )
    if (r.ok && r.data?.configuracion) setCfg(r.data.configuracion)
  }, [])

  const cargarIntentos = useCallback(async () => {
    const r = await apiCall<{ intentos: IntentoLog[] }>(
      '/api/configuracion/leads-web/intentos?limite=20',
      undefined,
      { mostrar_toast_en_error: false },
    )
    if (r.ok && r.data) setIntentos(r.data.intentos)
  }, [])

  useEffect(() => {
    if (!usuario) return
    if (!isAdmin) {
      router.push('/crm/configuracion')
      return
    }
    Promise.all([cargar(), cargarIntentos()]).finally(() => setCargando(false))
  }, [usuario, isAdmin, router, cargar, cargarIntentos])

  if (cargando || !cfg) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
        </div>
      </div>
    )
  }

  const guardarCambios = async (patch: Partial<ConfiguracionLeadsWeb>) => {
    setGuardando(true)
    const r = await apiCall<{ ok: boolean }>(
      '/api/configuracion/leads-web',
      { method: 'PATCH', body: patch },
      { mostrar_toast_en_error: false },
    )
    setGuardando(false)
    if (r.ok) {
      setCfg({ ...cfg, ...patch })
      toast.exito('Cambios guardados')
    } else {
      toast.error(r.error?.mensaje || 'No se pudo guardar')
    }
  }

  const toggleActivo = () => {
    if (!cfg.activo && cfg.dominios_permitidos.length === 0) {
      toast.warning('Agregá al menos un dominio permitido antes de activar.')
      return
    }
    guardarCambios({ activo: !cfg.activo })
  }

  const agregarDominio = () => {
    const normalizado = normalizarDominio(nuevoDominio)
    if (!normalizado) {
      toast.warning('Dominio inválido')
      return
    }
    if (cfg.dominios_permitidos.includes(normalizado)) {
      toast.warning('Ese dominio ya está en la lista')
      return
    }
    const lista = [...cfg.dominios_permitidos, normalizado]
    setNuevoDominio('')
    guardarCambios({ dominios_permitidos: lista })
  }

  const quitarDominio = (d: string) => {
    const lista = cfg.dominios_permitidos.filter((x) => x !== d)
    guardarCambios({ dominios_permitidos: lista })
  }

  const regenerarToken = async () => {
    if (!confirm('Si regenerás el token, el formulario actual de tu web va a dejar de funcionar hasta que actualices la URL allá. ¿Continuar?')) return
    setGuardando(true)
    const r = await apiCall<{ token: string }>(
      '/api/configuracion/leads-web/regenerar-token',
      { method: 'POST', body: {} },
      { mostrar_toast_en_error: false },
    )
    setGuardando(false)
    if (r.ok && r.data?.token) {
      setCfg({ ...cfg, token: r.data.token })
      toast.exito('Token regenerado — actualizá tu formulario web con la nueva URL')
    } else {
      toast.error(r.error?.mensaje || 'No se pudo regenerar')
    }
  }

  const copiar = async (texto: string, nombre: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      toast.exito(`${nombre} copiada al portapapeles`)
    } catch {
      toast.error('No se pudo copiar')
    }
  }

  const htmlEjemplo = generarHtmlFormEjemplo(urlPublica, redirectTo)

  const totalIntentos = intentos.length
  const exitosos = intentos.filter((i) => i.exito).length
  const fallidos = totalIntentos - exitosos

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Encabezado */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/crm/configuracion')}
          className="btn-secondary"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Inbox className="h-5 w-5 text-emerald-600" />
            Leads desde web
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Recibí leads del formulario de contacto de tu sitio web directamente al CRM.
          </p>
        </div>
      </div>

      {/* Bloque 1: Estado del sistema + KPIs */}
      <div className={`rounded-lg border-2 p-4 ${cfg.activo ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded ${cfg.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
              <Power className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">
                {cfg.activo ? 'Sistema activo' : 'Sistema desactivado'}
              </div>
              <div className="text-xs text-slate-600 mt-0.5">
                {cfg.activo
                  ? 'El formulario está aceptando leads desde la web.'
                  : 'No se reciben leads. Cuando lo actives, los formularios postearán al CRM.'}
              </div>
            </div>
          </div>
          <button
            onClick={toggleActivo}
            disabled={guardando}
            className={cfg.activo ? 'btn-danger' : 'btn-primary'}
          >
            {cfg.activo ? 'Desactivar' : 'Activar'}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="bg-white rounded p-3 border border-slate-200">
            <div className="text-2xs text-slate-600 uppercase tracking-wide">Este mes</div>
            <div className="text-2xl font-bold text-slate-800 font-mono">{cfg.recibidos_mes_actual}</div>
          </div>
          <div className="bg-white rounded p-3 border border-slate-200">
            <div className="text-2xs text-slate-600 uppercase tracking-wide">Total acumulado</div>
            <div className="text-2xl font-bold text-slate-800 font-mono">{cfg.recibidos_historico}</div>
          </div>
          <div className="bg-white rounded p-3 border border-slate-200">
            <div className="text-2xs text-slate-600 uppercase tracking-wide">Último lead</div>
            <div className="text-sm font-medium text-slate-800 mt-1">
              {cfg.ultimo_lead_recibido_en
                ? new Date(cfg.ultimo_lead_recibido_en).toLocaleString('es-AR')
                : 'Todavía ninguno'}
            </div>
          </div>
        </div>
      </div>

      {/* Bloque 2: URL del endpoint */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Globe className="h-4 w-4 text-blue-500" />
            URL para tu formulario
          </h2>
          <button
            onClick={regenerarToken}
            disabled={guardando}
            className="btn-secondary text-xs"
            title="Regenerar el token. Cualquier formulario que use la URL actual va a dejar de funcionar."
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Regenerar URL
          </button>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={urlPublica}
            className="form-input flex-1 font-mono text-xs"
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <button onClick={() => copiar(urlPublica, 'URL')} className="btn-primary">
            <Copy className="h-4 w-4" />
            Copiar
          </button>
        </div>
        <p className="text-xs text-slate-600 mt-2">
          Esta es la URL única de tu instalación. Cualquier formulario web que envíe datos a esta dirección los va a crear como leads automáticamente.
        </p>
      </div>

      {/* Bloque 3: Cómo conectar tu formulario */}
      <div className="bg-white rounded-lg border border-slate-200">
        <div className="border-b border-slate-200 px-4 pt-3">
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2 mb-3">
            <Code className="h-4 w-4 text-violet-500" />
            Cómo conectar tu formulario
          </h2>
          <div className="flex gap-1">
            {[
              { key: 'html', label: 'HTML propio' },
              { key: 'formsubmit', label: 'Vengo de FormSubmit' },
              { key: 'desarrollador', label: 'Para mi desarrollador' },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setTabActiva(t.key as typeof tabActiva)}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                  tabActiva === t.key
                    ? 'border-violet-500 text-violet-700'
                    : 'border-transparent text-slate-600 hover:text-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 space-y-4">
          {tabActiva === 'html' && (
            <>
              <p className="text-sm text-slate-700">
                Pegá este HTML donde quieras que aparezca el formulario en tu web. Los campos pueden personalizarse, pero los <code className="bg-slate-100 px-1 py-0.5 rounded text-xs">name="..."</code> deben mantenerse iguales para que el CRM los entienda.
              </p>
              <div>
                <label className="form-label text-xs">Página de gracias (opcional)</label>
                <input
                  type="url"
                  value={redirectTo}
                  onChange={(e) => setRedirectTo(e.target.value)}
                  placeholder="https://tusitio.com/gracias.html"
                  className="form-input"
                />
                <p className="text-xs text-slate-600 mt-1">
                  Si lo completás, después del envío redirige al usuario a esa página. Sino se muestra un mensaje de "¡Gracias!".
                </p>
              </div>
              <div className="relative">
                <pre className="bg-slate-900 text-slate-100 rounded p-3 text-xs overflow-x-auto max-h-[400px]">
                  <code>{htmlEjemplo}</code>
                </pre>
                <button
                  onClick={() => copiar(htmlEjemplo, 'HTML del formulario')}
                  className="absolute top-2 right-2 btn-secondary text-xs"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copiar HTML
                </button>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-900">
                <strong>Campos que el CRM reconoce:</strong>
                <ul className="mt-1 text-xs space-y-0.5 list-disc list-inside">
                  <li><code>nombre</code> (obligatorio)</li>
                  <li><code>email</code> (obligatorio)</li>
                  <li><code>apellido</code>, <code>telefono</code>, <code>seguro</code>, <code>mensaje</code> (opcionales)</li>
                  <li><code>website_honeypot</code> — campo invisible anti-spam, no lo modifiques</li>
                  <li><code>redirect_to</code> — opcional, URL a donde mandar al usuario después del envío</li>
                </ul>
              </div>
            </>
          )}

          {tabActiva === 'formsubmit' && (
            <>
              <p className="text-sm text-slate-700">
                Si tu formulario actualmente usa <strong>FormSubmit</strong> (la línea empieza con <code className="bg-slate-100 px-1 py-0.5 rounded text-xs">action="https://formsubmit.co/..."</code>), solo tenés que cambiar 2 cosas:
              </p>
              <ol className="text-sm text-slate-700 space-y-2 list-decimal list-inside ml-2">
                <li>
                  <strong>Reemplazá la URL del action</strong> por:
                  <div className="ml-6 mt-1 flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={urlPublica}
                      className="form-input flex-1 font-mono text-xs"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <button onClick={() => copiar(urlPublica, 'URL')} className="btn-secondary text-xs">
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
                <li>
                  <strong>Borrá los inputs hidden de FormSubmit</strong> (los que tienen <code className="text-xs">name="_subject"</code>, <code className="text-xs">_captcha</code>, <code className="text-xs">_next</code>, <code className="text-xs">_template</code>).
                </li>
                <li>
                  <strong>Si querés mantener la página de gracias</strong>, reemplazá el <code className="text-xs">_next</code> de FormSubmit por:
                  <pre className="bg-slate-900 text-slate-100 rounded p-2 text-xs mt-1 ml-6">
                    <code>{`<input type="hidden" name="redirect_to" value="https://tusitio.com/gracias.html">`}</code>
                  </pre>
                </li>
                <li>
                  <strong>Agregá el honeypot anti-spam</strong> (FormSubmit hacía esto por vos):
                  <pre className="bg-slate-900 text-slate-100 rounded p-2 text-xs mt-1 ml-6">
                    <code>{`<input type="text" name="website_honeypot" tabindex="-1" autocomplete="off"
       style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">`}</code>
                  </pre>
                </li>
              </ol>
              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900">
                <AlertTriangle className="inline h-3.5 w-3.5 mr-1" />
                Después del cambio, FormSubmit deja de tener sentido para vos — el CRM hace todo lo que FormSubmit hacía (recibir, validar, mandarte aviso por email, redirigir).
              </div>
            </>
          )}

          {tabActiva === 'desarrollador' && (
            <>
              <p className="text-sm text-slate-700">
                Si la web la maneja otra persona, copiá este texto y mandáselo:
              </p>
              <div className="bg-slate-50 border border-slate-200 rounded p-3 text-sm text-slate-800 whitespace-pre-line">
                {`Hola, necesito conectar el formulario de contacto de mi sitio web al CRM.

La URL del endpoint del CRM es:
${urlPublica}

Te paso un ejemplo HTML completo con los campos esperados.

Asegurate de:
- Que el formulario haga POST a esa URL (action="${urlPublica}" method="POST")
- Mantener los name="..." exactos de cada campo (nombre, email, telefono, seguro, mensaje)
- Incluir el campo invisible "website_honeypot" (anti-spam)
- Agregar opcionalmente un input hidden "redirect_to" con la URL de la página de gracias

Si querés ver el HTML completo de ejemplo, está en el panel del CRM en Configuración > Leads desde web > tab "HTML propio".

Avisame si algo no queda claro.`}
              </div>
              <button
                onClick={() => copiar(
                  `Hola, necesito conectar el formulario de contacto de mi sitio web al CRM.\n\nLa URL del endpoint del CRM es:\n${urlPublica}\n\nTe paso un ejemplo HTML completo con los campos esperados.\n\nAsegurate de:\n- Que el formulario haga POST a esa URL (action="${urlPublica}" method="POST")\n- Mantener los name="..." exactos de cada campo (nombre, email, telefono, seguro, mensaje)\n- Incluir el campo invisible "website_honeypot" (anti-spam)\n- Agregar opcionalmente un input hidden "redirect_to" con la URL de la página de gracias\n\nSi querés ver el HTML completo de ejemplo, está en el panel del CRM en Configuración > Leads desde web > tab "HTML propio".\n\nAvisame si algo no queda claro.`,
                  'Texto para tu desarrollador',
                )}
                className="btn-primary"
              >
                <Copy className="h-4 w-4" />
                Copiar texto
              </button>
            </>
          )}
        </div>
      </div>

      {/* Bloque 4a: Dominios permitidos */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2 mb-1">
          <Globe className="h-4 w-4 text-orange-500" />
          Dominios permitidos
        </h2>
        <p className="text-sm text-slate-600 mb-3">
          Solo los formularios que vengan de estos dominios van a ser aceptados. Es la principal defensa para que otros sitios no te inunden con spam.
        </p>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={nuevoDominio}
            onChange={(e) => setNuevoDominio(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') agregarDominio() }}
            placeholder="ej: loboseguros.com.ar"
            className="form-input flex-1"
          />
          <button onClick={agregarDominio} disabled={guardando} className="btn-primary">
            <Plus className="h-4 w-4" />
            Agregar
          </button>
        </div>
        {cfg.dominios_permitidos.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900">
            <AlertTriangle className="inline h-4 w-4 mr-1" />
            No hay dominios autorizados todavía. El endpoint está rechazando TODOS los intentos. Agregá al menos uno antes de activar el sistema.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {cfg.dominios_permitidos.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1.5 bg-slate-100 border border-slate-200 rounded-full px-3 py-1 text-sm text-slate-700"
              >
                <Globe className="h-3 w-3 text-slate-600" />
                {d}
                <button
                  onClick={() => quitarDominio(d)}
                  className="ml-1 hover:bg-slate-200 rounded-full p-0.5"
                  aria-label={`Quitar ${d}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Bloque 4b: Reglas + notificaciones */}
      <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
        <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
          <Send className="h-4 w-4 text-indigo-500" />
          Asignación y notificaciones
        </h2>

        <div>
          <label className="form-label">Cuando llega un lead nuevo, asignárselo a:</label>
          <select
            value={cfg.modo_asignacion}
            onChange={(e) => guardarCambios({ modo_asignacion: e.target.value as ModoAsignacionLeadsWeb })}
            disabled={guardando}
            className="form-input max-w-md"
          >
            <option value="ROTATIVO">Rotación equitativa entre usuarios activos (round-robin)</option>
            <option value="ADMIN">Siempre al admin</option>
            <option value="SIN_ASIGNAR">Sin asignar (queda en cola para distribución manual)</option>
          </select>
          <p className="text-xs text-slate-600 mt-1">
            {cfg.modo_asignacion === 'ROTATIVO' && 'Cada lead va al siguiente usuario activo, en orden. Si sos el único usuario, todos van a vos.'}
            {cfg.modo_asignacion === 'ADMIN' && 'Todos los leads van al admin. Útil si querés filtrarlos antes de distribuir.'}
            {cfg.modo_asignacion === 'SIN_ASIGNAR' && 'Los leads quedan sin dueño. Cualquier admin puede asignarlos manualmente desde la ficha del lead.'}
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 py-2 border-t border-slate-100">
          <div className="flex items-start gap-2">
            <Inbox className="h-4 w-4 text-emerald-600 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-slate-700">Notificación en el CRM</div>
              <div className="text-xs text-slate-600">Muestra el lead nuevo en el ícono Inbox del navbar (al lado de la campana).</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => guardarCambios({ notificar_inapp: !cfg.notificar_inapp })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${cfg.notificar_inapp ? 'bg-emerald-500' : 'bg-slate-300'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${cfg.notificar_inapp ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 py-2 border-t border-slate-100">
          <div className="flex items-start gap-2">
            <Mail className="h-4 w-4 text-blue-600 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-slate-700">Email al admin</div>
              <div className="text-xs text-slate-600">Recibí un email cada vez que llegue un lead nuevo. Editable desde Comunicaciones → plantilla "Lead nuevo desde la web".</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => guardarCambios({ notificar_email_admin: !cfg.notificar_email_admin })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${cfg.notificar_email_admin ? 'bg-emerald-500' : 'bg-slate-300'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${cfg.notificar_email_admin ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>

      {/* Bloque 5: Diagnóstico */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-slate-800">Diagnóstico — últimos intentos</h2>
          <button onClick={cargarIntentos} className="btn-secondary text-xs">
            <RefreshCw className="h-3.5 w-3.5" />
            Actualizar
          </button>
        </div>
        {totalIntentos > 0 && (
          <div className="flex gap-3 mb-3 text-xs">
            <span className="text-emerald-700"><CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />{exitosos} aceptados</span>
            <span className="text-red-700"><XCircle className="inline h-3.5 w-3.5 mr-1" />{fallidos} rechazados</span>
          </div>
        )}
        {intentos.length === 0 ? (
          <div className="text-sm text-slate-600 text-center py-6">
            Todavía no llegó ningún intento al endpoint.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-2xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="text-left px-2 py-2">Fecha</th>
                  <th className="text-left px-2 py-2">Estado</th>
                  <th className="text-left px-2 py-2">IP</th>
                  <th className="text-left px-2 py-2">Referer / Motivo</th>
                </tr>
              </thead>
              <tbody>
                {intentos.map((i) => (
                  <tr key={i.id} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 text-xs text-slate-600">
                      {new Date(i.created_at).toLocaleString('es-AR')}
                    </td>
                    <td className="px-2 py-1.5">
                      {i.exito ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 text-xs">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Aceptado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-700 text-xs">
                          <XCircle className="h-3.5 w-3.5" /> Rechazado
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-xs font-mono text-slate-600">{i.ip ?? '—'}</td>
                    <td className="px-2 py-1.5 text-xs text-slate-600 truncate max-w-md">
                      {i.exito
                        ? (i.referer ?? '—')
                        : (LABELS_RECHAZO[i.motivo_rechazo ?? ''] ?? i.motivo_rechazo ?? '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
