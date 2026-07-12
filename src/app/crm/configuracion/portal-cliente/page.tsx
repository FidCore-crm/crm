'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Loader2, CheckCircle, Power, PowerOff,
  AlertTriangle, Phone, Users, RefreshCw, Trash2, Search,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'

type Compania = {
  compania_id: string
  compania_nombre: string
  tiene_config: boolean
  id: string | null
  telefono: string | null
  nombre_boton: string | null
  visible_en_portal: boolean | null
}

type Acceso = {
  id: string
  persona_id: string
  persona_nombre: string
  persona_dni: string
  // token y url_completa NO se devuelven más — los tokens viven hasheados.
  // Para conseguir un link, ir a la ficha de la persona y regenerar.
  fecha_creacion: string
  ultimo_acceso: string | null
  veces_accedido: number
  revocado: boolean
}

function formatoFecha(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function formatoFechaRelativa(iso: string | null): string {
  if (!iso) return 'Nunca'
  const d = new Date(iso)
  const ahora = Date.now()
  const diff = ahora - d.getTime()
  const dias = Math.floor(diff / (24 * 3600 * 1000))
  if (dias === 0) return 'Hoy'
  if (dias === 1) return 'Ayer'
  if (dias < 30) return `Hace ${dias} días`
  return formatoFecha(iso)
}

export default function PortalClientePage() {
  const router = useRouter()
  const { usuario, loading: authLoading, isAdmin } = useAuth()

  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [guardadoOk, setGuardadoOk] = useState(false)
  const [errorGral, setErrorGral] = useState('')

  const [activo, setActivo] = useState(false)
  const [textoBienvenida, setTextoBienvenida] = useState('')
  const [mensajeRevocado, setMensajeRevocado] = useState('')

  const [companias, setCompanias] = useState<Compania[]>([])
  const [accesos, setAccesos] = useState<Acceso[]>([])
  const [filtroBusqueda, setFiltroBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'activos' | 'revocados' | 'sin_uso' | 'con_uso'>('todos')

  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    if (!authLoading && (!usuario || !isAdmin)) {
      router.push('/crm/dashboard')
    }
  }, [authLoading, usuario, isAdmin, router])

  async function cargarTodo() {
    const [cfgRes, telRes, accRes] = await Promise.all([
      apiCall<{ configuracion?: any }>('/api/configuracion/portal-cliente', undefined, { mostrar_toast_en_error: false }),
      apiCall<{ companias?: Compania[] }>('/api/configuracion/telefonos-asistencia', undefined, { mostrar_toast_en_error: false }),
      apiCall<{ accesos?: Acceso[] }>('/api/portal-cliente/accesos', undefined, { mostrar_toast_en_error: false }),
    ])

    if (cfgRes.ok && cfgRes.data?.configuracion) {
      const c = cfgRes.data.configuracion
      setActivo(c.activo ?? false)
      setTextoBienvenida(c.texto_bienvenida || '')
      setMensajeRevocado(c.mensaje_acceso_revocado || '')
    } else if (!cfgRes.ok) {
      setErrorGral(cfgRes.error?.mensaje ?? 'Error al cargar la configuración')
    }

    if (telRes.ok && telRes.data) {
      setCompanias(telRes.data.companias || [])
    }

    if (accRes.ok && accRes.data) {
      setAccesos(accRes.data.accesos || [])
    }

    setCargando(false)
    setTimeout(() => { mountedRef.current = true }, 100)
  }

  useEffect(() => {
    if (!authLoading && usuario) cargarTodo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, usuario])

  const guardarConfig = useCallback(async (datos: Record<string, any>) => {
    if (!mountedRef.current) return
    setGuardando(true)
    setErrorGral('')
    setGuardadoOk(false)

    const r = await apiCall('/api/configuracion/portal-cliente', {
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
    debounceRef.current = setTimeout(() => guardarConfig(datos), 500)
  }, [guardarConfig])

  const immediateSave = useCallback((datos: Record<string, any>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    guardarConfig(datos)
  }, [guardarConfig])

  async function guardarTelefono(compania_id: string, campos: Partial<Compania>) {
    const actual = companias.find(c => c.compania_id === compania_id)
    if (!actual) return
    const payload = {
      compania_id,
      telefono: campos.telefono ?? actual.telefono ?? '',
      nombre_boton: campos.nombre_boton ?? actual.nombre_boton ?? 'Asistencia 24hs',
      visible_en_portal:
        campos.visible_en_portal !== undefined
          ? campos.visible_en_portal
          : (actual.visible_en_portal ?? true),
    }
    if (!payload.telefono) return

    const r = await apiCall('/api/configuracion/telefonos-asistencia', {
      method: 'PUT',
      body: payload,
    }, { mostrar_toast_en_error: false })
    if (r.ok) {
      setGuardadoOk(true)
      setTimeout(() => setGuardadoOk(false), 1500)
    }
  }

  async function eliminarTelefono(compania_id: string) {
    if (!confirm('¿Eliminar la configuración de esta compañía?')) return
    const r = await apiCall(`/api/configuracion/telefonos-asistencia/${compania_id}`, {
      method: 'DELETE',
    }, { mostrar_toast_en_error: false })
    if (r.ok) {
      setCompanias(prev =>
        prev.map(c =>
          c.compania_id === compania_id
            ? { ...c, tiene_config: false, id: null, telefono: null, nombre_boton: null, visible_en_portal: null }
            : c
        )
      )
      toast.exito('Configuración eliminada')
    } else {
      toast.error(r.error?.mensaje ?? 'No se pudo eliminar')
    }
  }

  function actualizarCompania(compania_id: string, campos: Partial<Compania>) {
    setCompanias(prev =>
      prev.map(c => (c.compania_id === compania_id ? { ...c, ...campos } : c))
    )
  }

  async function regenerarAcceso(acceso: Acceso) {
    if (!confirm('Esto invalida el link actual. ¿Continuar?')) return
    const r = await apiCall(`/api/portal-cliente/acceso/${acceso.persona_id}`, {
      method: 'PATCH',
    }, { mostrar_toast_en_error: false })
    if (r.ok) {
      toast.exito('Link regenerado')
      await cargarTodo()
    } else {
      toast.error(r.error?.mensaje ?? 'No se pudo regenerar')
    }
  }

  async function revocarAcceso(acceso: Acceso) {
    const motivo = prompt('Motivo de la revocación (opcional):') || undefined
    if (motivo === null) return
    const r = await apiCall(`/api/portal-cliente/acceso/${acceso.persona_id}`, {
      method: 'DELETE',
      body: { motivo },
    }, { mostrar_toast_en_error: false })
    if (r.ok) {
      toast.exito('Acceso revocado')
      await cargarTodo()
    } else {
      toast.error(r.error?.mensaje ?? 'No se pudo revocar')
    }
  }

  async function reactivarAcceso(acceso: Acceso) {
    if (!confirm('Se creará un nuevo link de acceso. ¿Continuar?')) return
    const r = await apiCall(`/api/portal-cliente/acceso/${acceso.persona_id}`, {
      method: 'POST',
    }, { mostrar_toast_en_error: false })
    if (r.ok) {
      toast.exito('Acceso reactivado')
      await cargarTodo()
    } else {
      toast.error(r.error?.mensaje ?? 'No se pudo reactivar')
    }
  }

  const accesosFiltrados = accesos.filter(a => {
    if (filtroBusqueda) {
      const q = filtroBusqueda.toLowerCase()
      if (!a.persona_nombre.toLowerCase().includes(q) && !a.persona_dni.includes(q)) return false
    }
    if (filtroEstado === 'activos' && a.revocado) return false
    if (filtroEstado === 'revocados' && !a.revocado) return false
    if (filtroEstado === 'sin_uso' && a.veces_accedido > 0) return false
    if (filtroEstado === 'con_uso' && a.veces_accedido === 0) return false
    return true
  })

  if (authLoading || cargando) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  if (!usuario || !isAdmin) return null

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/crm/configuracion')}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Volver
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-slate-800">Portal del Asegurado</h1>
          <p className="text-xs text-slate-500">
            Configurá el portal público donde tus asegurados acceden a su información
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-2xs">
          {guardando && (
            <>
              <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
              <span className="text-slate-400">Guardando...</span>
            </>
          )}
          {guardadoOk && (
            <>
              <CheckCircle className="h-3 w-3 text-green-500" />
              <span className="text-green-600">Guardado</span>
            </>
          )}
        </div>
      </div>

      {errorGral && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded p-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {errorGral}
        </div>
      )}

      {/* SECCIÓN 1 — Estado */}
      <div className={`border rounded-lg p-4 ${activo ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {activo ? <Power className="h-5 w-5 text-green-600" /> : <PowerOff className="h-5 w-5 text-slate-500" />}
            <div>
              <p className={`text-sm font-medium ${activo ? 'text-green-800' : 'text-slate-700'}`}>
                {activo ? 'Portal del Asegurado activo' : 'Portal del Asegurado desactivado'}
              </p>
              <p className={`text-2xs mt-0.5 ${activo ? 'text-green-600' : 'text-slate-500'}`}>
                {activo
                  ? 'Los asegurados pueden acceder a sus portales con los links generados.'
                  : 'Los links existentes no funcionan mientras el sistema esté desactivado.'}
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


      {/* SECCIÓN 2 — Textos */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-1">Textos del portal</h2>
        <p className="text-2xs text-slate-500 mb-4">
          Personalizá los textos que ven los clientes en su portal.
        </p>
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Mensaje de bienvenida
            </label>
            <input
              type="text"
              className="form-input w-full text-xs"
              maxLength={200}
              value={textoBienvenida}
              onChange={e => {
                setTextoBienvenida(e.target.value)
                debouncedSave({ texto_bienvenida: e.target.value })
              }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Mensaje cuando el acceso está revocado
            </label>
            <textarea
              className="form-input w-full text-xs"
              rows={3}
              maxLength={500}
              value={mensajeRevocado}
              onChange={e => {
                setMensajeRevocado(e.target.value)
                debouncedSave({ mensaje_acceso_revocado: e.target.value })
              }}
            />
          </div>
        </div>
      </div>

      {/* SECCIÓN 3 — Teléfonos de asistencia */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-1">
          <Phone className="h-4 w-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-slate-800">Teléfonos de asistencia por compañía</h2>
        </div>
        <p className="text-2xs text-slate-500 mb-4">
          Configurá el teléfono de asistencia/grúa de cada compañía con la que trabajás. El botón aparece en
          el portal del asegurado según las pólizas que tenga.
        </p>

        {companias.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">No hay compañías cargadas en el catálogo.</p>
        ) : (
          <div className="flex flex-col divide-y divide-slate-100">
            {companias.map(c => (
              <div key={c.compania_id} className="grid grid-cols-12 gap-2 items-center py-3">
                <div className="col-span-3 text-xs font-medium text-slate-700 truncate">
                  {c.compania_nombre}
                </div>
                <div className="col-span-3">
                  <input
                    type="text"
                    placeholder="Teléfono"
                    className="form-input w-full text-xs"
                    value={c.telefono || ''}
                    onChange={e => actualizarCompania(c.compania_id, { telefono: e.target.value })}
                    onBlur={() => {
                      if (c.telefono) guardarTelefono(c.compania_id, {})
                    }}
                  />
                </div>
                <div className="col-span-3">
                  <input
                    type="text"
                    placeholder="Nombre del botón"
                    className="form-input w-full text-xs"
                    value={c.nombre_boton || 'Asistencia 24hs'}
                    onChange={e => actualizarCompania(c.compania_id, { nombre_boton: e.target.value })}
                    onBlur={() => {
                      if (c.telefono) guardarTelefono(c.compania_id, {})
                    }}
                  />
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-2xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={c.visible_en_portal !== false}
                      disabled={!c.telefono}
                      onChange={e => {
                        actualizarCompania(c.compania_id, { visible_en_portal: e.target.checked })
                        if (c.telefono) guardarTelefono(c.compania_id, { visible_en_portal: e.target.checked })
                      }}
                    />
                    Visible
                  </label>
                </div>
                <div className="col-span-1 flex justify-end">
                  {c.tiene_config && (
                    <button
                      onClick={() => eliminarTelefono(c.compania_id)}
                      className="p-1 text-slate-400 hover:text-red-500"
                      title="Eliminar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SECCIÓN 4 — Gestión de accesos */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-1">
          <Users className="h-4 w-4 text-blue-600" />
          <h2 className="text-sm font-semibold text-slate-800">Accesos de clientes</h2>
        </div>
        <p className="text-2xs text-slate-500 mb-4">
          Gestión global de todos los tokens generados. Los accesos individuales también se gestionan desde cada ficha de persona.
        </p>

        <div className="flex gap-2 mb-3">
          <div className="flex-1 relative">
            <Search className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por nombre o DNI..."
              className="form-input w-full text-xs pl-7"
              value={filtroBusqueda}
              onChange={e => setFiltroBusqueda(e.target.value)}
            />
          </div>
          <select
            className="form-input text-xs"
            value={filtroEstado}
            onChange={e => setFiltroEstado(e.target.value as any)}
          >
            <option value="todos">Todos</option>
            <option value="activos">Activos</option>
            <option value="revocados">Revocados</option>
            <option value="sin_uso">Sin uso (0 accesos)</option>
            <option value="con_uso">Con uso</option>
          </select>
        </div>

        {accesosFiltrados.length === 0 ? (
          <p className="text-xs text-slate-400 py-6 text-center">
            {accesos.length === 0 ? 'No hay accesos generados todavía.' : 'No hay resultados con los filtros aplicados.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="text-left py-2 px-2 font-medium">Cliente</th>
                  <th className="text-left py-2 px-2 font-medium">Generado</th>
                  <th className="text-left py-2 px-2 font-medium">Último acceso</th>
                  <th className="text-center py-2 px-2 font-medium">Accesos</th>
                  <th className="text-center py-2 px-2 font-medium">Estado</th>
                  <th className="text-right py-2 px-2 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {accesosFiltrados.slice(0, 100).map(a => (
                  <tr key={a.id} className="border-b border-slate-100">
                    <td className="py-2 px-2">
                      <div className="text-slate-800">{a.persona_nombre}</div>
                      <div className="text-2xs text-slate-400 font-mono">{a.persona_dni}</div>
                    </td>
                    <td className="py-2 px-2 text-slate-600">{formatoFecha(a.fecha_creacion)}</td>
                    <td className="py-2 px-2 text-slate-600">{formatoFechaRelativa(a.ultimo_acceso)}</td>
                    <td className="py-2 px-2 text-center text-slate-700">{a.veces_accedido}</td>
                    <td className="py-2 px-2 text-center">
                      {a.revocado ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-red-50 text-red-600 text-2xs">Revocado</span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded bg-green-50 text-green-600 text-2xs">Activo</span>
                      )}
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex justify-end gap-1">
                        {a.revocado ? (
                          <button
                            onClick={() => reactivarAcceso(a)}
                            className="text-2xs text-blue-600 hover:underline flex items-center gap-1"
                          >
                            <RefreshCw className="h-3 w-3" /> Re-activar
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => regenerarAcceso(a)}
                              className="text-2xs text-blue-600 hover:underline"
                            >
                              Regenerar
                            </button>
                            <span className="text-slate-300">·</span>
                            <button
                              onClick={() => revocarAcceso(a)}
                              className="text-2xs text-red-600 hover:underline"
                            >
                              Revocar
                            </button>
                          </>
                        )}
                      </div>
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
