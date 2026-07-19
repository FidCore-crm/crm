'use client'

/**
 * Wizard de restauración de backups .crmbak. 4 pasos:
 *   1. Elegir fuente (existente vs subir)
 *   2. Seleccionar backup / subir archivo
 *   3. Validar + info + opciones de restauración
 *   4. Confirmación doble con "RESTAURAR"
 */

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Upload, FolderOpen, ArrowRight, FileArchive,
  Loader2, CheckCircle, AlertTriangle, X, Shield, Database, HardDrive, Settings,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { apiCall } from '@/lib/api-client'
import type { Backup } from '@/types/database'

type BackupDisponible = Backup & { existe_en_disco?: boolean }
type Paso = 1 | 2 | 3 | 4
type Fuente = 'existente' | 'subir'

interface Validacion {
  ok: boolean
  metadata?: any
  contenido?: Record<string, boolean>
  tamano_archivo_mb?: number
  fecha_backup?: string
  version_crm?: string
  version_schema?: string
  error?: string
}

function fmtTamano(bytes: number | null | undefined): string {
  if (!bytes) return '-'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function RestaurarBackupPage() {
  const router = useRouter()
  const { usuario, loading: authLoading, isAdmin } = useAuth()

  const [paso, setPaso] = useState<Paso>(1)
  const [fuente, setFuente] = useState<Fuente | null>(null)
  const [backups, setBackups] = useState<BackupDisponible[]>([])
  const [backupSelId, setBackupSelId] = useState<string | null>(null)
  const [archivoSubido, setArchivoSubido] = useState<File | null>(null)
  const [validacion, setValidacion] = useState<Validacion | null>(null)
  const [validando, setValidando] = useState(false)

  const [restaurarDb, setRestaurarDb] = useState(true)
  const [restaurarStorage, setRestaurarStorage] = useState(true)
  const [crearPreBackup, setCrearPreBackup] = useState(true)

  const [confirmacion, setConfirmacion] = useState('')
  const [iniciando, setIniciando] = useState(false)
  const [error, setError] = useState('')
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)

  useEffect(() => {
    if (fuente === 'existente' && backups.length === 0) {
      apiCall<{ backups: BackupDisponible[] }>('/api/backups', undefined, { mostrar_toast_en_error: false }).then((r) => {
        if (r.ok && r.data) {
          setBackups(
            (r.data.backups || []).filter(
              (b) => b.estado === 'COMPLETADO' && b.existe_en_disco,
            ),
          )
        }
      })
    }
  }, [fuente, backups.length])

  useEffect(() => {
    if (!authLoading && (!usuario || !isAdmin)) {
      router.push('/crm/dashboard')
    }
  }, [authLoading, usuario, isAdmin, router])

  // Validación del archivo — se dispara al avanzar del paso 2 al 3
  const validarYAvanzar = useCallback(async () => {
    setValidando(true)
    setError('')
    setValidacion(null)
    try {
      if (fuente === 'existente') {
        if (!backupSelId) throw new Error('Seleccioná un backup')
        const r = await apiCall<Validacion>('/api/backups/validar-archivo', {
          method: 'POST',
          body: { backup_id: backupSelId },
        }, { mostrar_toast_en_error: false })
        if (!r.ok) {
          setError(r.error?.mensaje ?? 'Validación falló')
          setValidando(false)
          return
        }
        setValidacion(r.data ?? null)
        setPaso(3)
      } else {
        if (!archivoSubido) throw new Error('Subí un archivo')
        const fd = new FormData()
        fd.append('archivo', archivoSubido)
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('POST', '/api/backups/validar-archivo')
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100))
          }
          xhr.onload = () => {
            setUploadProgress(null)
            try {
              const json = JSON.parse(xhr.responseText)
              if (!json.ok) {
                setError(json.error || 'Validación falló')
                reject(new Error(json.error))
                return
              }
              setValidacion(json)
              setPaso(3)
              resolve()
            } catch {
              reject(new Error('Respuesta inválida'))
            }
          }
          xhr.onerror = () => {
            setUploadProgress(null)
            reject(new Error('Error de red'))
          }
          xhr.send(fd)
        })
      }
    } catch (err: any) {
      setError(err?.message || 'Error')
    } finally {
      setValidando(false)
    }
  }, [fuente, backupSelId, archivoSubido])

  const confirmar = useCallback(async () => {
    if (confirmacion !== 'RESTAURAR') return
    setIniciando(true)
    setError('')
    try {
      const opciones = {
        restaurar_db: restaurarDb,
        restaurar_storage: restaurarStorage,
        crear_pre_backup: crearPreBackup,
      }

      if (fuente === 'existente') {
        const r = await apiCall<{ restauracion_id: string }>('/api/backups/restaurar', {
          method: 'POST',
          body: { backup_id: backupSelId, opciones },
        }, { mostrar_toast_en_error: false })
        if (!r.ok || !r.data) {
          setError(r.error?.mensaje ?? 'Error iniciando')
          setIniciando(false)
          return
        }
        router.push(`/crm/configuracion/backups/restaurar/${r.data.restauracion_id}`)
      } else {
        if (!archivoSubido) return
        const fd = new FormData()
        fd.append('archivo', archivoSubido)
        fd.append('opciones', JSON.stringify(opciones))

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('POST', '/api/backups/restaurar')
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100))
          }
          xhr.onload = () => {
            setUploadProgress(null)
            try {
              const json = JSON.parse(xhr.responseText)
              if (!json.ok) {
                setError(json.error || 'Error iniciando')
                reject(new Error(json.error))
                return
              }
              router.push(`/crm/configuracion/backups/restaurar/${json.restauracion_id}`)
              resolve()
            } catch {
              reject(new Error('Respuesta inválida'))
            }
          }
          xhr.onerror = () => {
            setUploadProgress(null)
            reject(new Error('Error de red'))
          }
          xhr.send(fd)
        })
      }
    } catch (err: any) {
      setError(err?.message || 'Error')
    } finally {
      setIniciando(false)
    }
  }, [confirmacion, restaurarDb, restaurarStorage, crearPreBackup, fuente, backupSelId, archivoSubido, router])

  if (authLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-5 w-5 animate-spin text-slate-500" /></div>
  }
  if (!usuario || !isAdmin) return null

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/crm/configuracion/backups')} className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-700">
          <ArrowLeft className="h-3.5 w-3.5" /> Volver a backups
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-slate-800">Restaurar backup</h1>
          <p className="text-xs text-slate-600">Paso {paso} de 4</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded p-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
          <button onClick={() => setError('')} className="ml-auto"><X className="h-3 w-3" /></button>
        </div>
      )}

      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-900">
            La restauración va a <strong>REEMPLAZAR</strong> todos los datos actuales del CRM con los del backup seleccionado. Esta operación no se puede deshacer directamente (el pre-backup de seguridad sí podés restaurarlo como último recurso).
          </p>
        </div>
      </div>

      {/* PASO 1 — Elegir fuente */}
      {paso === 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            onClick={() => { setFuente('existente'); setPaso(2) }}
            className="bg-white border-2 border-slate-200 hover:border-blue-400 rounded-lg p-5 text-left transition-colors"
          >
            <FolderOpen className="h-6 w-6 text-blue-500 mb-2" />
            <h3 className="text-sm font-semibold text-slate-800">Desde un backup existente</h3>
            <p className="text-2xs text-slate-600 mt-1">
              Usá uno de los backups que ya están en el servidor.
            </p>
          </button>
          <button
            onClick={() => { setFuente('subir'); setPaso(2) }}
            className="bg-white border-2 border-slate-200 hover:border-blue-400 rounded-lg p-5 text-left transition-colors"
          >
            <Upload className="h-6 w-6 text-blue-500 mb-2" />
            <h3 className="text-sm font-semibold text-slate-800">Subir archivo .crmbak</h3>
            <p className="text-2xs text-slate-600 mt-1">
              Subí un archivo desde tu computadora (por ejemplo uno bajado de Google Drive).
            </p>
          </button>
        </div>
      )}

      {/* PASO 2A — Seleccionar existente */}
      {paso === 2 && fuente === 'existente' && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col gap-3">
          <p className="text-xs text-slate-600">Elegí el backup a restaurar:</p>
          {backups.length === 0 ? (
            <p className="text-xs text-slate-600 italic">No hay backups disponibles.</p>
          ) : (
            <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
              {backups.map((b) => (
                <label key={b.id} className={`flex items-center gap-3 border rounded p-3 cursor-pointer ${backupSelId === b.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input
                    type="radio"
                    checked={backupSelId === b.id}
                    onChange={() => setBackupSelId(b.id)}
                  />
                  <FileArchive className="h-4 w-4 text-slate-500" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-slate-800 truncate">{b.nombre}.crmbak</p>
                    <p className="text-2xs text-slate-600">
                      {new Date(b.fecha_inicio).toLocaleString('es-AR')} · {fmtTamano(b.archivo_unico_tamano_bytes || b.tamano_total_bytes)}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
          <div className="flex justify-between mt-2">
            <button onClick={() => { setFuente(null); setPaso(1) }} className="btn-secondary text-xs px-3 py-1.5">Volver</button>
            <button
              onClick={validarYAvanzar}
              disabled={!backupSelId || validando}
              className="btn-primary text-xs px-4 py-1.5 disabled:opacity-50 flex items-center gap-2"
            >
              {validando && <Loader2 className="h-3 w-3 animate-spin" />}
              Validar y continuar
            </button>
          </div>
        </div>
      )}

      {/* PASO 2B — Subir archivo */}
      {paso === 2 && fuente === 'subir' && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col gap-3">
          <label className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center cursor-pointer hover:bg-slate-50">
            <Upload className="h-8 w-8 text-slate-500 mx-auto mb-2" />
            <p className="text-xs text-slate-600">
              {archivoSubido ? 'Archivo listo' : 'Arrastrá el archivo .crmbak o hacé click para seleccionar'}
            </p>
            <p className="text-2xs text-slate-500 mt-1">Solo .crmbak · Máx 5 GB</p>
            <input
              type="file"
              accept=".crmbak"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f && f.name.endsWith('.crmbak')) setArchivoSubido(f)
              }}
            />
          </label>
          {archivoSubido && (
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded p-3">
              <FileArchive className="h-4 w-4 text-slate-600" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-slate-800 truncate">{archivoSubido.name}</p>
                <p className="text-2xs text-slate-600">{fmtTamano(archivoSubido.size)}</p>
              </div>
              <button onClick={() => setArchivoSubido(null)} className="text-slate-500 hover:text-slate-600">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {uploadProgress !== null && (
            <div>
              <p className="text-2xs text-slate-600 mb-1">Subiendo archivo: {uploadProgress}%</p>
              <div className="h-1.5 bg-slate-200 rounded overflow-hidden">
                <div className="h-full bg-blue-500 transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}
          <div className="flex justify-between mt-2">
            <button onClick={() => { setFuente(null); setPaso(1) }} className="btn-secondary text-xs px-3 py-1.5" disabled={validando}>Volver</button>
            <button
              onClick={validarYAvanzar}
              disabled={!archivoSubido || validando}
              className="btn-primary text-xs px-4 py-1.5 disabled:opacity-50 flex items-center gap-2"
            >
              {validando && <Loader2 className="h-3 w-3 animate-spin" />}
              Validar y continuar
            </button>
          </div>
        </div>
      )}

      {/* PASO 3 — Info del backup + opciones */}
      {paso === 3 && validacion && (
        <div className="flex flex-col gap-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <h2 className="text-sm font-semibold text-green-900">Backup válido</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <p className="text-2xs text-green-600 uppercase font-medium">Fecha del backup</p>
                <p className="text-slate-800 mt-0.5">{validacion.fecha_backup ? new Date(validacion.fecha_backup).toLocaleString('es-AR') : '-'}</p>
              </div>
              <div>
                <p className="text-2xs text-green-600 uppercase font-medium">Tamaño</p>
                <p className="text-slate-800 mt-0.5">{validacion.tamano_archivo_mb} MB</p>
              </div>
              <div>
                <p className="text-2xs text-green-600 uppercase font-medium">Versión CRM</p>
                <p className="text-slate-800 mt-0.5">{validacion.version_crm || '-'}</p>
              </div>
              <div>
                <p className="text-2xs text-green-600 uppercase font-medium">Versión schema</p>
                <p className="text-slate-800 mt-0.5">{validacion.version_schema || '-'}</p>
              </div>
            </div>
            {validacion.contenido && (
              <div className="mt-3 pt-3 border-t border-green-200">
                <p className="text-2xs text-green-600 uppercase font-medium mb-1">Contenido del backup</p>
                <div className="flex flex-wrap gap-1.5 text-2xs">
                  {Object.entries(validacion.contenido).map(([k, v]) =>
                    v ? (
                      <span key={k} className="bg-white border border-green-200 text-green-700 rounded px-1.5 py-0.5">
                        ✓ {k}
                      </span>
                    ) : null,
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Settings className="h-4 w-4 text-slate-600" />
              Opciones de restauración
            </h3>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={restaurarDb} onChange={(e) => setRestaurarDb(e.target.checked)} className="mt-0.5" />
              <div>
                <p className="text-xs text-slate-700"><Database className="h-3 w-3 inline mr-1" /> Restaurar base de datos <span className="text-green-600">(RECOMENDADO)</span></p>
                <p className="text-2xs text-slate-500">Reemplaza completamente el contenido de la DB actual.</p>
              </div>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={restaurarStorage} onChange={(e) => setRestaurarStorage(e.target.checked)} className="mt-0.5" />
              <div>
                <p className="text-xs text-slate-700"><HardDrive className="h-3 w-3 inline mr-1" /> Restaurar storage</p>
                <p className="text-2xs text-slate-500">Archivos de pólizas, fotos, PDFs, etc.</p>
              </div>
            </label>

            <div className="border-t border-slate-200 pt-3 mt-1">
              <h3 className="text-xs font-semibold text-slate-800 mb-2 flex items-center gap-2">
                <Shield className="h-3.5 w-3.5 text-green-600" />
                Seguridad
              </h3>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={crearPreBackup} onChange={(e) => setCrearPreBackup(e.target.checked)} className="mt-0.5" />
                <div>
                  <p className="text-xs text-slate-700">Crear backup de seguridad <strong>ANTES</strong> de restaurar <span className="text-green-600">(recomendado)</span></p>
                  <p className="text-2xs text-slate-500">Te permite volver al estado actual si la restauración sale mal.</p>
                </div>
              </label>
            </div>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setPaso(2)} className="btn-secondary text-xs px-3 py-1.5">Volver</button>
            <button
              onClick={() => setPaso(4)}
              disabled={!restaurarDb && !restaurarStorage}
              className="btn-primary text-xs px-4 py-1.5 disabled:opacity-50 flex items-center gap-1"
            >
              Siguiente <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* PASO 4 — Confirmación final */}
      {paso === 4 && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col gap-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <h2 className="text-sm font-bold text-red-900 mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Confirmación final
            </h2>
            <p className="text-xs text-red-900">
              Estás a punto de <strong>REEMPLAZAR</strong> todos los datos actuales del CRM con los del backup del{' '}
              {validacion?.fecha_backup ? new Date(validacion.fecha_backup).toLocaleString('es-AR') : '-'}.
            </p>
            <div className="mt-3 text-xs text-red-900">
              <p className="font-semibold mb-1">Qué va a pasar:</p>
              <ol className="list-decimal pl-5 space-y-0.5 text-2xs">
                {crearPreBackup && <li>Se va a crear un backup de seguridad de los datos actuales</li>}
                <li>Se va a desactivar temporalmente el CRM (2-5 minutos)</li>
                {restaurarDb && <li>Se va a reemplazar la base de datos</li>}
                {restaurarStorage && <li>Se va a reemplazar el storage</li>}
                <li>Todas las sesiones activas se van a cerrar</li>
                <li>Vas a tener que volver a loguearte</li>
              </ol>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Escribí <span className="font-bold text-red-600">RESTAURAR</span> para confirmar
            </label>
            <input
              type="text"
              className="form-input w-full text-xs font-mono"
              placeholder="RESTAURAR"
              value={confirmacion}
              onChange={(e) => setConfirmacion(e.target.value)}
              autoComplete="off"
            />
          </div>

          {uploadProgress !== null && (
            <div>
              <p className="text-2xs text-slate-600 mb-1">Subiendo archivo: {uploadProgress}%</p>
              <div className="h-1.5 bg-slate-200 rounded overflow-hidden">
                <div className="h-full bg-blue-500 transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}

          <div className="flex justify-between">
            <button onClick={() => setPaso(3)} className="btn-secondary text-xs px-3 py-1.5" disabled={iniciando}>Cancelar</button>
            <button
              onClick={confirmar}
              disabled={confirmacion !== 'RESTAURAR' || iniciando}
              className="btn-danger text-xs px-4 py-1.5 disabled:opacity-50 flex items-center gap-2"
            >
              {iniciando && <Loader2 className="h-3 w-3 animate-spin" />}
              Restaurar ahora
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
