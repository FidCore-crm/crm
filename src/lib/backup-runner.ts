import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'
import { createReadStream } from 'fs'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { encolarEmailSistema } from '@/lib/comunicaciones-sender'

const execAsync = promisify(exec)

const PROJECT_DIR = process.cwd()
const SCRIPTS_DIR = path.join(PROJECT_DIR, 'scripts')
const BACKUP_BASE = '/var/backups/crm-seguros'

export interface BackupResult {
  ok: boolean
  backup_id?: string
  nombre?: string
  duracion_segundos?: number
  tamano_total_bytes?: number
  sync_remoto_exitoso?: boolean
  error?: string
}

export interface BackupLocalInfo {
  nombre: string
  ruta: string
  tamano_bytes: number
  fecha: string
  metadata: any
}

export async function ejecutarBackup(opciones: {
  tipo: 'MANUAL' | 'AUTOMATICO' | 'PRE_RESTORE'
  usuario_id?: string
}): Promise<BackupResult> {
  const supabase = getSupabaseAdmin()
  const inicio = new Date()

  const { data: backupRecord, error: insertError } = await supabase
    .from('backups')
    .insert({
      nombre: `backup-pending-${Date.now()}`,
      tipo: opciones.tipo,
      fecha_inicio: inicio.toISOString(),
      estado: 'EN_PROCESO',
      usuario_id: opciones.usuario_id || null,
    })
    .select()
    .single()

  if (insertError || !backupRecord) {
    return { ok: false, error: 'No se pudo crear el registro de backup' }
  }

  const backupId = (backupRecord as any).id

  try {
    const scriptPath = path.join(SCRIPTS_DIR, 'backup-now.sh')
    const args = [`--tipo=${opciones.tipo}`]
    if (opciones.usuario_id) args.push(`--usuario-id=${opciones.usuario_id}`)

    const { stdout } = await execAsync(`bash "${scriptPath}" ${args.join(' ')}`, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30 * 60 * 1000,
    })

    const resultMatch = stdout.match(/BACKUP_RESULT_JSON=(.*)/)
    if (!resultMatch) throw new Error('No se pudo parsear el resultado del script')

    const result = JSON.parse(resultMatch[1])
    const fin = new Date()
    const duracion = Math.round((fin.getTime() - inicio.getTime()) / 1000)

    await supabase
      .from('backups')
      .update({
        nombre: result.nombre,
        fecha_fin: fin.toISOString(),
        duracion_segundos: duracion,
        tamano_db_bytes: result.tamano_db,
        tamano_storage_bytes: result.tamano_storage,
        tamano_total_bytes: result.tamano_total,
        estado: 'COMPLETADO',
        ruta_local: result.ruta,
        archivo_unico_path: result.archivo_unico_path,
        archivo_unico_tamano_bytes: result.archivo_unico_tamano_bytes,
        contenido_incluido: result.contenido_incluido,
      })
      .eq('id', backupId)

    // Sync remoto
    let syncOk: boolean | null = null
    let syncError: string | null = null

    const { data: config } = await supabase
      .from('configuracion_backups')
      .select('*')
      .limit(1)
      .maybeSingle()

    if (config && (config as any).sync_remoto_activo) {
      try {
        const syncResult = await ejecutarSyncRemoto(
          (config as any).remote_nombre,
          (config as any).carpeta_remota,
        )
        syncOk = syncResult.ok
        syncError = syncResult.error || null
      } catch (err: any) {
        syncOk = false
        syncError = err?.message || 'Error desconocido en sync remoto'
      }

      await supabase
        .from('backups')
        .update({
          sync_remoto_intentado: true,
          sync_remoto_exitoso: syncOk,
          sync_remoto_error: syncError,
          estado: syncOk ? 'COMPLETADO' : 'COMPLETADO_CON_ERRORES',
        })
        .eq('id', backupId)

      if (!syncOk && (config as any).notificar_fallos) {
        await notificarFalloSync(backupId, result.nombre, syncError || 'Error desconocido')
      }
    }

    if (config && (config as any).notificar_exito) {
      await notificarExitoBackup(
        result.tamano_total,
        opciones.tipo,
        syncOk !== false,
      )
    }

    return {
      ok: true,
      backup_id: backupId,
      nombre: result.nombre,
      duracion_segundos: duracion,
      tamano_total_bytes: result.tamano_total,
      sync_remoto_exitoso: syncOk ?? undefined,
    }
  } catch (err: any) {
    const errorMsg = err?.message || 'Error desconocido'

    await supabase
      .from('backups')
      .update({
        fecha_fin: new Date().toISOString(),
        estado: 'FALLIDO',
        error_mensaje: errorMsg,
      })
      .eq('id', backupId)

    await notificarFalloBackup(backupId, errorMsg, opciones.tipo)

    return { ok: false, error: errorMsg }
  }
}

async function ejecutarSyncRemoto(
  remote: string,
  folder: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const scriptPath = path.join(SCRIPTS_DIR, 'backup-sync-remote.sh')
    await execAsync(`bash "${scriptPath}" "${remote}" "${folder}"`, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 60 * 60 * 1000,
    })
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.stderr || err?.message || 'Error desconocido' }
  }
}

/**
 * Lista los archivos .crmbak presentes en /var/backups/crm-seguros.
 */
export async function listarBackupsLocales(): Promise<BackupLocalInfo[]> {
  try {
    const entries = await fs.readdir(BACKUP_BASE, { withFileTypes: true })
    const backups: BackupLocalInfo[] = []

    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.startsWith('backup-') || !entry.name.endsWith('.crmbak')) continue

      const nombre = entry.name.slice(0, -'.crmbak'.length)
      const ruta = path.join(BACKUP_BASE, entry.name)
      const stat = await fs.stat(ruta)
      backups.push({
        nombre,
        ruta,
        tamano_bytes: stat.size,
        fecha: stat.mtime.toISOString(),
        metadata: null,
      })
    }

    return backups.sort((a, b) => b.fecha.localeCompare(a.fecha))
  } catch {
    return []
  }
}

/**
 * Abre un stream de lectura del .crmbak de un backup. Simple: el archivo
 * ya es un tar.gz listo para descargar.
 */
export async function abrirBackupParaDescarga(nombre: string): Promise<{
  stream: NodeJS.ReadableStream
  tamano: number
  filename: string
  contentType: string
} | null> {
  if (nombre.includes('/') || nombre.includes('..')) return null

  const crmbakPath = path.join(BACKUP_BASE, `${nombre}.crmbak`)
  try {
    const stat = await fs.stat(crmbakPath)
    if (!stat.isFile()) return null
    return {
      stream: createReadStream(crmbakPath),
      tamano: stat.size,
      filename: `${nombre}.crmbak`,
      contentType: 'application/gzip',
    }
  } catch {
    return null
  }
}

export async function verificarRcloneDisponible(): Promise<{
  instalado: boolean
  remotes: string[]
  remote_configurado: boolean
}> {
  try {
    await execAsync('which rclone')
    const { stdout } = await execAsync('rclone listremotes')
    const remotes = stdout.trim().split('\n').filter((r) => r).map((r) => r.replace(':', ''))
    return { instalado: true, remotes, remote_configurado: remotes.includes('gdrive') }
  } catch {
    return { instalado: false, remotes: [], remote_configurado: false }
  }
}

// ---------------------------------------------------------------------------
// Notificaciones
// ---------------------------------------------------------------------------
// Las 3 funciones siguientes mantienen la notificación in-app (campana del
// CRM) y además encolan un email al admin a través del sistema unificado.
// Todo el HTML y la selección de destinatarios vive en `encolarEmailSistema`
// (usa las plantillas `sistema_backup_*` de plantillas_email).
// ---------------------------------------------------------------------------

async function notificarFalloBackup(backupId: string, error: string, tipoBackup: string) {
  const supabase = getSupabaseAdmin()

  await supabase.from('notificaciones').insert({
    tipo: 'BACKUP_FALLIDO',
    prioridad: 'CRITICA',
    titulo: 'Fallo en backup automatico',
    mensaje: `El backup automatico fallo: ${error}`,
    entidad_tipo: 'backup',
    entidad_id: backupId,
    url: '/crm/configuracion/backups',
    leida: false,
  })

  await encolarEmailSistema({
    tipo_evento: 'BACKUP_FALLIDO',
    variables_extra: {
      fecha_intento: new Date().toLocaleString('es-AR'),
      tipo_backup: tipoBackup,
      error_mensaje: error,
    },
  })
}

async function notificarFalloSync(backupId: string, nombre: string, error: string) {
  const supabase = getSupabaseAdmin()

  await supabase.from('notificaciones').insert({
    tipo: 'BACKUP_SYNC_FALLIDO',
    prioridad: 'ADVERTENCIA',
    titulo: 'Fallo en sincronizacion remota de backup',
    mensaje: `El backup local se completo pero fallo la sincronizacion remota: ${error}`,
    entidad_tipo: 'backup',
    entidad_id: backupId,
    url: '/crm/configuracion/backups',
    leida: false,
  })

  await encolarEmailSistema({
    tipo_evento: 'BACKUP_SYNC_FALLIDO',
    variables_extra: {
      fecha_intento: new Date().toLocaleString('es-AR'),
      error_mensaje: `${nombre}: ${error}`,
    },
  })
}

async function notificarExitoBackup(
  tamano: number,
  tipoBackup: string,
  syncOk: boolean,
) {
  const tamanoMb = (tamano / (1024 * 1024)).toFixed(1)

  await encolarEmailSistema({
    tipo_evento: 'BACKUP_COMPLETADO',
    variables_extra: {
      fecha_backup: new Date().toLocaleString('es-AR'),
      tipo_backup: tipoBackup,
      tamano_mb: tamanoMb,
      sync_status: syncOk ? 'Sí' : 'No (solo local)',
    },
  })
}
