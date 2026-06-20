'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Loader2, CheckCircle, AlertTriangle, HardDrive,
  Download, RotateCcw, Trash2, RefreshCw, ChevronDown, ChevronUp,
  X, Shield, Cloud, CloudOff, MessageCircle, Send,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import type { Backup, ConfiguracionBackups } from '@/types/database'
import { apiCall } from '@/lib/api-client'
import { toast } from '@/lib/toast'

function formatearTamano(bytes: number | null): string {
  if (!bytes || bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatearDuracion(segundos: number | null): string {
  if (segundos === null || segundos === undefined) return '-'
  if (segundos < 60) return `${Math.round(segundos)}s`
  const min = Math.floor(segundos / 60)
  const seg = Math.round(segundos % 60)
  return `${min} min ${seg}s`
}

function tiempoRelativo(fecha: string): string {
  const ahora = Date.now()
  const ts = new Date(fecha).getTime()
  const diff = ahora - ts
  const minutos = Math.floor(diff / 60000)
  if (minutos < 1) return 'Hace un momento'
  if (minutos < 60) return `Hace ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `Hace ${horas}h`
  const dias = Math.floor(horas / 24)
  if (dias === 1) return 'Hace 1 día'
  return `Hace ${dias} días`
}

interface RcloneEstado {
  instalado: boolean
  remotes: string[]
}

type BackupConDisco = Backup & { existe_en_disco?: boolean; tamano_disco?: number | null }

export default function BackupsPage() {
  const router = useRouter()
  const { usuario, loading: authLoading, isAdmin } = useAuth()

  const [cargando, setCargando] = useState(true)
  const [configuracion, setConfiguracion] = useState<ConfiguracionBackups | null>(null)
  const [rcloneEstado, setRcloneEstado] = useState<RcloneEstado>({ instalado: false, remotes: [] })
  const [backups, setBackups] = useState<BackupConDisco[]>([])
  const [ejecutandoBackup, setEjecutandoBackup] = useState(false)
  const [modalRestaurar, setModalRestaurar] = useState(false)
  const [modalEliminar, setModalEliminar] = useState(false)
  const [backupSeleccionado, setBackupSeleccionado] = useState<BackupConDisco | null>(null)
  const [confirmacionRestore, setConfirmacionRestore] = useState('')
  const [avanzadoAbierto, setAvanzadoAbierto] = useState(false)

  const [guardando, setGuardando] = useState(false)
  const [guardadoOk, setGuardadoOk] = useState(false)
  const [errorGral, setErrorGral] = useState('')

  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    if (!authLoading && (!usuario || !isAdmin)) {
      router.push('/crm/dashboard')
    }
  }, [authLoading, usuario, isAdmin, router])

  useEffect(() => {
    if (!authLoading && usuario && isAdmin) {
      cargarDatos()
    }
  }, [authLoading, usuario, isAdmin])

  async function cargarDatos() {
    setCargando(true)
    const [resConfig, resBackups] = await Promise.all([
      apiCall<{ configuracion: ConfiguracionBackups; rclone?: RcloneEstado }>('/api/backups/configuracion', undefined, { mostrar_toast_en_error: false }),
      apiCall<{ backups: BackupConDisco[] }>('/api/backups', undefined, { mostrar_toast_en_error: false }),
    ])

    if (resConfig.ok && resConfig.data) {
      setConfiguracion(resConfig.data.configuracion)
      setRcloneEstado(resConfig.data.rclone || { instalado: false, remotes: [] })
    } else if (!resConfig.ok) {
      setErrorGral(resConfig.error?.mensaje ?? 'Error al cargar los datos')
    }
    if (resBackups.ok && resBackups.data) {
      setBackups(resBackups.data.backups || [])
    }

    setCargando(false)
    setTimeout(() => { mountedRef.current = true }, 100)
  }

  async function cargarBackups() {
    const r = await apiCall<{ backups: BackupConDisco[] }>('/api/backups', undefined, { mostrar_toast_en_error: false })
    if (r.ok && r.data) setBackups(r.data.backups || [])
  }

  const guardarConfig = useCallback(async (datos: Record<string, any>) => {
    if (!mountedRef.current) return
    setGuardando(true)
    setErrorGral('')
    setGuardadoOk(false)
    const r = await apiCall<{ configuracion: ConfiguracionBackups }>('/api/backups/configuracion', {
      method: 'PATCH',
      body: datos,
    }, { mostrar_toast_en_error: false })
    if (!r.ok) {
      setErrorGral(r.error?.mensaje ?? 'Error al guardar')
    } else if (r.data) {
      setConfiguracion(r.data.configuracion)
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

  async function toggleActivo(nuevoValor: boolean) {
    if (!nuevoValor) {
      if (!confirm('¿Estás seguro de desactivar los backups automáticos? Perderás la protección automática de tus datos.')) return
    }
    setConfiguracion(prev => prev ? { ...prev, activo: nuevoValor } : prev)
    immediateSave({ activo: nuevoValor })
  }

  async function ejecutarBackupManual() {
    if (!confirm('¿Ejecutar backup manual ahora? Esto puede tardar varios minutos dependiendo del tamaño de los datos.')) return
    setEjecutandoBackup(true)
    setErrorGral('')
    const r = await apiCall('/api/backups', { method: 'POST' }, { mostrar_toast_en_error: false })
    if (r.ok) {
      toast.exito('Backup ejecutado')
      await cargarBackups()
    } else {
      setErrorGral(r.error?.mensaje ?? 'Error al ejecutar el backup')
    }
    setEjecutandoBackup(false)
  }

  function descargarBackup(backup: BackupConDisco) {
    window.open(`/api/backups/${backup.id}/descargar`, '_blank')
  }

  async function confirmarRestaurar() {
    if (!backupSeleccionado || confirmacionRestore !== 'RESTAURAR') return
    const r = await apiCall(`/api/backups/${backupSeleccionado.id}/restaurar`, {
      method: 'POST',
      body: { confirmacion: 'RESTAURAR' },
    }, { mostrar_toast_en_error: false })
    if (r.ok) {
      setModalRestaurar(false)
      setConfirmacionRestore('')
      setErrorGral('')
      toast.info('Restaurando... El sistema se va a reiniciar en unos segundos. Serás desconectado.')
      setTimeout(() => { window.location.href = '/login' }, 30000)
    } else {
      setErrorGral(r.error?.mensaje ?? 'Error al restaurar')
    }
  }

  async function confirmarEliminar() {
    if (!backupSeleccionado) return
    const r = await apiCall(`/api/backups/${backupSeleccionado.id}`, { method: 'DELETE' }, { mostrar_toast_en_error: false })
    if (r.ok) {
      toast.exito('Backup eliminado')
      setModalEliminar(false)
      setBackupSeleccionado(null)
      await cargarBackups()
    } else {
      setErrorGral(r.error?.mensaje ?? 'Error al eliminar')
    }
  }

  const activo = configuracion?.activo ?? false
  const totalBackups = backups.length
  const espacioUsado = backups.reduce((sum, b) => sum + (b.tamano_total_bytes || 0), 0)
  const ultimoBackup = backups.length > 0 ? backups[0] : null
  const rcloneConfigurado = rcloneEstado.instalado && rcloneEstado.remotes.includes(configuracion?.remote_nombre || 'gdrive')

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
        <button onClick={() => router.push('/crm/configuracion')} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
          <ArrowLeft className="h-3.5 w-3.5" /> Volver
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-slate-800">Sistema de backups</h1>
          <p className="text-xs text-slate-500">Configurá y gestioná los backups automáticos del CRM</p>
        </div>
        <div className="flex items-center gap-1.5 text-2xs">
          {guardando && <><Loader2 className="h-3 w-3 animate-spin text-slate-400" /><span className="text-slate-400">Guardando...</span></>}
          {guardadoOk && <><CheckCircle className="h-3 w-3 text-green-500" /><span className="text-green-600">Guardado</span></>}
        </div>
      </div>

      {errorGral && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded p-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {errorGral}
          <button onClick={() => setErrorGral('')} className="ml-auto"><X className="h-3 w-3" /></button>
        </div>
      )}

      {/* SECCIÓN 1 — Estado del sistema */}
      <div className={`border rounded-lg p-5 ${activo ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {activo
              ? <CheckCircle className="h-6 w-6 text-green-600" />
              : <HardDrive className="h-6 w-6 text-slate-400" />
            }
            <div>
              <p className={`text-sm font-semibold ${activo ? 'text-green-800' : 'text-slate-700'}`}>
                {activo ? 'Sistema de backups activo' : 'Sistema de backups desactivado'}
              </p>
              <p className={`text-xs mt-0.5 ${activo ? 'text-green-600' : 'text-slate-500'}`}>
                {activo
                  ? 'Los backups se ejecutan automáticamente todos los días'
                  : 'Activalo para proteger tus datos con backups automáticos diarios'}
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={activo}
              onChange={() => toggleActivo(!activo)}
              className="sr-only peer"
            />
            <div className="w-12 h-6 bg-slate-300 peer-checked:bg-green-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-transform peer-checked:after:translate-x-6" />
          </label>
        </div>

        {activo && (
          <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-green-200">
            <div>
              <p className="text-2xs text-green-600 uppercase font-medium">Último backup</p>
              <p className="text-sm font-semibold text-green-800 mt-0.5">
                {ultimoBackup ? tiempoRelativo(ultimoBackup.fecha_inicio) : 'Sin backups aún'}
              </p>
            </div>
            <div>
              <p className="text-2xs text-green-600 uppercase font-medium">Total de backups</p>
              <p className="text-sm font-semibold text-green-800 mt-0.5">{totalBackups}</p>
            </div>
            <div>
              <p className="text-2xs text-green-600 uppercase font-medium">Espacio usado</p>
              <p className="text-sm font-semibold text-green-800 mt-0.5">{formatearTamano(espacioUsado)}</p>
            </div>
          </div>
        )}
      </div>

      {/* SECCIÓN 2 — Backup manual */}
      {activo && (
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Backup manual</h2>
              <p className="text-xs text-slate-500 mt-0.5">Creá un backup ahora mismo sin esperar al próximo automático</p>
            </div>
            <button
              onClick={ejecutarBackupManual}
              disabled={ejecutandoBackup}
              className="btn-primary text-xs px-4 py-2 flex items-center gap-1.5 disabled:opacity-50"
            >
              {ejecutandoBackup
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Ejecutando backup...</>
                : <><HardDrive className="h-3.5 w-3.5" /> Hacer backup ahora</>
              }
            </button>
          </div>
        </div>
      )}

      {/* SECCIÓN 3 — Sincronización remota */}
      {activo && (
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-slate-800">Sincronización con Google Drive</h2>
          <p className="text-xs text-slate-500 mt-0.5 mb-4">Mantené una copia de los backups en Google Drive. Recomendamos activar verificación en 2 pasos en la cuenta.</p>

          {!rcloneEstado.instalado || !rcloneConfigurado ? (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Cloud className="h-5 w-5 text-slate-400 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-700">Sincronización con la nube no configurada</p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Tus backups solo viven en este servidor. Para activar la copia automática en Google Drive
                    contactanos y la configuramos por vos, lleva 5 minutos.
                  </p>
                  <div className="flex flex-wrap gap-3 mt-3">
                    <a
                      href="https://wa.me/5491166794861?text=Hola%2C%20quiero%20activar%20la%20sincronizaci%C3%B3n%20de%20backups%20con%20Google%20Drive."
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800"
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> WhatsApp soporte
                    </a>
                    <a
                      href="mailto:info@fidcore.com.ar?subject=Activar%20backups%20en%20Google%20Drive"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-800"
                    >
                      <Send className="h-3.5 w-3.5" /> info@fidcore.com.ar
                    </a>
                  </div>
                  <details className="mt-3">
                    <summary className="text-2xs text-slate-400 cursor-pointer hover:text-slate-600">
                      Detalles técnicos (uso interno)
                    </summary>
                    <div className="mt-2 text-2xs text-slate-500 space-y-1.5">
                      {!rcloneEstado.instalado ? (
                        <>
                          <p>rclone no está instalado en el servidor.</p>
                          <code className="block bg-slate-100 text-slate-700 rounded p-2 font-mono">
                            sudo apt install -y rclone
                          </code>
                          <p className="mt-1.5">Después seguir los pasos del <code className="font-mono">README.txt</code> en <code className="font-mono">~/.config/rclone/</code>.</p>
                        </>
                      ) : (
                        <>
                          <p>rclone está instalado pero el remote <span className="font-mono">{configuracion?.remote_nombre || 'gdrive'}</span> no está configurado.</p>
                          <p className="mt-1.5">Configurarlo en el host con:</p>
                          <code className="block bg-slate-100 text-slate-700 rounded p-2 font-mono">
                            rclone config
                          </code>
                          <p className="mt-1.5">Pasos completos en <code className="font-mono">~/.config/rclone/README.txt</code> del usuario que instaló el CRM. Si el remote existe pero el token expiró:</p>
                          <code className="block bg-slate-100 text-slate-700 rounded p-2 font-mono">
                            rclone config reconnect {configuracion?.remote_nombre || 'gdrive'}:
                          </code>
                        </>
                      )}
                    </div>
                  </details>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Cloud className="h-4 w-4 text-blue-500" />
                  <div>
                    <p className="text-xs font-medium text-slate-700">Sincronizar backups con Google Drive</p>
                    {configuracion?.sync_remoto_activo && (
                      <p className="text-2xs text-slate-400 mt-0.5">
                        Último sync exitoso: {
                          backups.find(b => b.sync_remoto_exitoso)
                            ? tiempoRelativo(backups.find(b => b.sync_remoto_exitoso)!.fecha_inicio)
                            : 'Nunca'
                        }
                      </p>
                    )}
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={configuracion?.sync_remoto_activo ?? false}
                    onChange={e => {
                      setConfiguracion(prev => prev ? { ...prev, sync_remoto_activo: e.target.checked } : prev)
                      immediateSave({ sync_remoto_activo: e.target.checked })
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5 bg-slate-300 peer-checked:bg-blue-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
                </label>
              </div>

              {configuracion?.sync_remoto_activo && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Carpeta de destino en Drive</label>
                    <input
                      type="text"
                      className="form-input w-full text-xs"
                      placeholder="Backups-CRM"
                      value={configuracion?.carpeta_remota || ''}
                      onChange={e => {
                        setConfiguracion(prev => prev ? { ...prev, carpeta_remota: e.target.value } : prev)
                        debouncedSave({ carpeta_remota: e.target.value })
                      }}
                    />
                    <p className="text-2xs text-slate-400 mt-1">Los backups se subirán a esta carpeta en tu Google Drive.</p>
                  </div>
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-2xs text-blue-800 leading-relaxed">
                    <p className="font-medium mb-1">Cómo se gestionan los backups en Drive</p>
                    <p>
                      Google Drive es un <strong>espejo exacto</strong> de los backups del servidor. La política de retención
                      (configurable abajo) aplica a las dos copias: cuando un backup viejo se elimina del servidor, también
                      se elimina del Drive en el siguiente ciclo de sincronización.
                    </p>
                    <p className="mt-1">
                      Si querés guardar un backup puntual para siempre (snapshot anual, por ejemplo), descargalo o copialo
                      a otra carpeta de tu Drive antes de que la rotación lo borre.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* SECCIÓN 4 — Configuración avanzada */}
      {activo && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setAvanzadoAbierto(!avanzadoAbierto)}
            className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
          >
            <h2 className="text-sm font-semibold text-slate-800">Configuración avanzada</h2>
            {avanzadoAbierto
              ? <ChevronUp className="h-4 w-4 text-slate-400" />
              : <ChevronDown className="h-4 w-4 text-slate-400" />
            }
          </button>

          {avanzadoAbierto && (
            <div className="px-5 pb-5 border-t border-slate-100 pt-4 flex flex-col gap-5">
              <div>
                <h3 className="text-xs font-semibold text-slate-700 mb-1">Política de retención</h3>
                <p className="text-2xs text-slate-400 mb-3">
                  El sistema mantiene los últimos N backups diarios, el primer backup de cada una de las últimas semanas, y el primer backup de cada uno de los últimos meses.
                </p>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-2xs text-slate-500 mb-1">Backups diarios</label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      className="form-input w-full text-xs text-center font-mono"
                      value={configuracion?.retener_diarios ?? 7}
                      onChange={e => {
                        const v = parseInt(e.target.value)
                        if (isNaN(v)) return
                        setConfiguracion(prev => prev ? { ...prev, retener_diarios: v } : prev)
                        debouncedSave({ retener_diarios: v })
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-2xs text-slate-500 mb-1">Backups semanales</label>
                    <input
                      type="number"
                      min={0}
                      max={12}
                      className="form-input w-full text-xs text-center font-mono"
                      value={configuracion?.retener_semanales ?? 4}
                      onChange={e => {
                        const v = parseInt(e.target.value)
                        if (isNaN(v)) return
                        setConfiguracion(prev => prev ? { ...prev, retener_semanales: v } : prev)
                        debouncedSave({ retener_semanales: v })
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-2xs text-slate-500 mb-1">Backups mensuales</label>
                    <input
                      type="number"
                      min={0}
                      max={24}
                      className="form-input w-full text-xs text-center font-mono"
                      value={configuracion?.retener_mensuales ?? 6}
                      onChange={e => {
                        const v = parseInt(e.target.value)
                        if (isNaN(v)) return
                        setConfiguracion(prev => prev ? { ...prev, retener_mensuales: v } : prev)
                        debouncedSave({ retener_mensuales: v })
                      }}
                    />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-slate-700 mb-3">
                  Retención de backups pre-actualización
                </h3>
                <p className="text-2xs text-slate-500 mb-3">
                  Los backups creados antes de aplicar una actualización del CRM
                  se conservan con política propia, separada de los backups diarios.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Mínimos a conservar</label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      className="form-input w-full text-xs text-center font-mono"
                      value={(configuracion as any)?.retener_pre_update_minimos ?? 5}
                      onChange={e => {
                        const v = parseInt(e.target.value)
                        if (isNaN(v)) return
                        setConfiguracion(prev => prev ? { ...prev, retener_pre_update_minimos: v } as any : prev)
                        debouncedSave({ retener_pre_update_minimos: v })
                      }}
                    />
                    <p className="text-2xs text-slate-400 mt-1">Últimos N, siempre se mantienen</p>
                  </div>
                  <div>
                    <label className="text-xs text-slate-600 block mb-1">Días de retención</label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      className="form-input w-full text-xs text-center font-mono"
                      value={(configuracion as any)?.retener_pre_update_dias ?? 30}
                      onChange={e => {
                        const v = parseInt(e.target.value)
                        if (isNaN(v)) return
                        setConfiguracion(prev => prev ? { ...prev, retener_pre_update_dias: v } as any : prev)
                        debouncedSave({ retener_pre_update_dias: v })
                      }}
                    />
                    <p className="text-2xs text-slate-400 mt-1">Cualquiera con menos de N días</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-slate-700 mb-3">Notificaciones</h3>
                <div className="flex flex-col gap-3">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <p className="text-xs text-slate-700">Notificar backups fallidos</p>
                      <p className="text-2xs text-slate-400">Se crea notificación y email cuando un backup falla</p>
                    </div>
                    <div className="relative inline-flex items-center">
                      <input
                        type="checkbox"
                        checked={configuracion?.notificar_fallos ?? true}
                        onChange={e => {
                          setConfiguracion(prev => prev ? { ...prev, notificar_fallos: e.target.checked } : prev)
                          immediateSave({ notificar_fallos: e.target.checked })
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-10 h-5 bg-slate-300 peer-checked:bg-blue-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
                    </div>
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <p className="text-xs text-slate-700">Notificar backups exitosos</p>
                      <p className="text-2xs text-slate-400">También notifica los backups que terminaron bien</p>
                    </div>
                    <div className="relative inline-flex items-center">
                      <input
                        type="checkbox"
                        checked={configuracion?.notificar_exito ?? false}
                        onChange={e => {
                          setConfiguracion(prev => prev ? { ...prev, notificar_exito: e.target.checked } : prev)
                          immediateSave({ notificar_exito: e.target.checked })
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-10 h-5 bg-slate-300 peer-checked:bg-blue-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5" />
                    </div>
                  </label>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded p-3">
                <p className="text-xs text-slate-600">
                  Los backups automáticos se ejecutan diariamente a las {configuracion?.hora_backup || '04:00'}. Si el servidor estaba apagado, se ejecutan al iniciar.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECCIÓN 5 — Lista de backups */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 flex items-center justify-between border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-800">
            Backups disponibles <span className="text-slate-400 font-normal">({totalBackups} backups)</span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push('/crm/configuracion/backups/restaurar')}
              className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1"
            >
              <RotateCcw className="h-3 w-3" /> Restaurar un backup
            </button>
            <button onClick={cargarBackups} className="btn-secondary text-xs px-2 py-1.5 flex items-center gap-1">
              <RefreshCw className="h-3 w-3" /> Refrescar
            </button>
          </div>
        </div>

        {backups.length === 0 ? (
          <div className="p-8 text-center">
            <HardDrive className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-500">No hay backups todavía.</p>
            {activo && (
              <p className="text-2xs text-slate-400 mt-1">Hacé clic en &quot;Hacer backup ahora&quot; para crear el primero.</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="crm-table w-full">
              <thead>
                <tr>
                  <th className="text-left text-2xs font-medium text-slate-500 px-4 py-2">Fecha</th>
                  <th className="text-left text-2xs font-medium text-slate-500 px-4 py-2">Nombre</th>
                  <th className="text-left text-2xs font-medium text-slate-500 px-4 py-2">Tipo</th>
                  <th className="text-left text-2xs font-medium text-slate-500 px-4 py-2">Tamaño</th>
                  <th className="text-left text-2xs font-medium text-slate-500 px-4 py-2">Duración</th>
                  <th className="text-left text-2xs font-medium text-slate-500 px-4 py-2">Estado</th>
                  <th className="text-center text-2xs font-medium text-slate-500 px-4 py-2">Drive</th>
                  <th className="text-right text-2xs font-medium text-slate-500 px-4 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {backups.map(backup => (
                  <tr key={backup.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <p className="text-xs text-slate-800">
                        {new Date(backup.fecha_inicio).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}{' '}
                        {new Date(backup.fecha_inicio).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      <p className="text-2xs text-slate-400">{tiempoRelativo(backup.fecha_inicio)}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-mono text-slate-600">{backup.nombre}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-2xs font-medium px-1.5 py-0.5 rounded border ${
                        backup.tipo === 'AUTOMATICO' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        backup.tipo === 'MANUAL' ? 'bg-green-50 text-green-700 border-green-200' :
                        'bg-orange-50 text-orange-700 border-orange-200'
                      }`}>
                        {backup.tipo === 'AUTOMATICO' ? 'Automático' :
                         backup.tipo === 'MANUAL' ? 'Manual' : 'Pre-restore'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {formatearTamano(backup.tamano_total_bytes)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {formatearDuracion(backup.duracion_segundos)}
                    </td>
                    <td className="px-4 py-2.5">
                      {backup.estado === 'COMPLETADO' && (
                        <span className="text-2xs font-medium px-1.5 py-0.5 rounded border bg-green-50 text-green-700 border-green-200">
                          Completado
                        </span>
                      )}
                      {backup.estado === 'COMPLETADO_CON_ERRORES' && (
                        <span
                          className="text-2xs font-medium px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200 cursor-help"
                          title={backup.error_mensaje || 'Error desconocido'}
                        >
                          Con errores
                        </span>
                      )}
                      {backup.estado === 'FALLIDO' && (
                        <span
                          className="text-2xs font-medium px-1.5 py-0.5 rounded border bg-red-50 text-red-700 border-red-200 cursor-help"
                          title={backup.error_mensaje || 'Error desconocido'}
                        >
                          Fallido
                        </span>
                      )}
                      {backup.estado === 'EN_PROCESO' && (
                        <span className="text-2xs font-medium px-1.5 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-200 flex items-center gap-1 w-fit">
                          <Loader2 className="h-3 w-3 animate-spin" /> En proceso
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {!backup.sync_remoto_intentado ? (
                        <span className="text-slate-300">—</span>
                      ) : backup.sync_remoto_exitoso ? (
                        <Cloud className="h-4 w-4 text-green-500 mx-auto" />
                      ) : (
                        <span title={backup.sync_remoto_error || 'Error de sincronización'}>
                          <CloudOff className="h-4 w-4 text-red-400 mx-auto cursor-help" />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {backup.estado === 'COMPLETADO' && backup.existe_en_disco && (
                          <>
                            <button
                              onClick={() => descargarBackup(backup)}
                              className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-blue-600 transition-colors"
                              title="Descargar"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                setBackupSeleccionado(backup)
                                setConfirmacionRestore('')
                                setModalRestaurar(true)
                              }}
                              className="p-1.5 rounded hover:bg-red-50 text-slate-500 hover:text-red-600 transition-colors"
                              title="Restaurar"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => {
                            setBackupSeleccionado(backup)
                            setModalEliminar(true)
                          }}
                          className="p-1.5 rounded hover:bg-red-50 text-slate-500 hover:text-red-600 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Restaurar */}
      {modalRestaurar && backupSeleccionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setModalRestaurar(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Shield className="h-4 w-4 text-red-500" />
                Restaurar backup
              </h2>
              <button onClick={() => setModalRestaurar(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4">
              <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
                <p className="text-xs font-semibold text-red-800 mb-2">ATENCIÓN — Esta operación es irreversible</p>
                <ul className="text-2xs text-red-700 space-y-1 list-disc list-inside">
                  <li>Se va a sobrescribir la base de datos actual</li>
                  <li>Se van a sobrescribir los archivos de storage</li>
                  <li>Se va a reiniciar el servicio del CRM</li>
                  <li>Vas a perder la sesión actual</li>
                  <li>Antes de restaurar, se crea un backup automático del estado actual por seguridad</li>
                </ul>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded p-3 mb-4">
                <p className="text-2xs text-slate-500 mb-1">Backup a restaurar:</p>
                <p className="text-xs font-mono font-medium text-slate-800">{backupSeleccionado.nombre}</p>
                <p className="text-2xs text-slate-500 mt-1">
                  {new Date(backupSeleccionado.fecha_inicio).toLocaleString('es-AR')} — {formatearTamano(backupSeleccionado.tamano_total_bytes)}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Escribí <span className="font-bold text-red-600">RESTAURAR</span> para confirmar
                </label>
                <input
                  type="text"
                  className="form-input w-full text-xs"
                  placeholder="RESTAURAR"
                  value={confirmacionRestore}
                  onChange={e => setConfirmacionRestore(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200">
              <button onClick={() => setModalRestaurar(false)} className="btn-secondary text-xs px-3 py-1.5">Cancelar</button>
              <button
                onClick={confirmarRestaurar}
                disabled={confirmacionRestore !== 'RESTAURAR'}
                className="btn-danger text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw className="h-3 w-3" /> Restaurar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Eliminar */}
      {modalEliminar && backupSeleccionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setModalEliminar(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-800">Eliminar backup</h2>
              <button onClick={() => setModalEliminar(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs text-slate-600 mb-3">¿Estás seguro de eliminar este backup? Esta acción no se puede deshacer.</p>
              <div className="bg-slate-50 border border-slate-200 rounded p-3">
                <p className="text-xs font-mono font-medium text-slate-800">{backupSeleccionado.nombre}</p>
                <p className="text-2xs text-slate-500 mt-1">
                  {new Date(backupSeleccionado.fecha_inicio).toLocaleString('es-AR')} — {formatearTamano(backupSeleccionado.tamano_total_bytes)}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200">
              <button onClick={() => setModalEliminar(false)} className="btn-secondary text-xs px-3 py-1.5">Cancelar</button>
              <button
                onClick={confirmarEliminar}
                className="btn-danger text-xs px-3 py-1.5 flex items-center gap-1.5"
              >
                <Trash2 className="h-3 w-3" /> Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
