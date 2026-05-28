/**
 * Tipos compartidos por la UI del módulo de actualizaciones.
 * Espejan los tipos del backend en `@/lib/updater`.
 */

export interface ReleaseGitHub {
  tag: string
  version: string
  nombre: string
  changelog: string
  published_at: string
  html_url: string
  es_mas_nueva: boolean
}

export type EstadoActualizacion =
  | 'PROGRAMADA'
  | 'EJECUTANDO'
  | 'COMPLETADA'
  | 'FALLIDA'
  | 'CANCELADA'

export interface ActualizacionRow {
  id: string
  version_anterior: string
  version_nueva: string
  changelog: string | null
  estado: EstadoActualizacion
  programada_para: string | null
  fecha_solicitud: string
  fecha_inicio_ejecucion: string | null
  fecha_fin_ejecucion: string | null
  backup_id: string | null
  error_mensaje: string | null
  log_completo: string | null
  solicitada_por_usuario_id: string | null
  cancelada_por_usuario_id: string | null
  created_at: string
  updated_at: string
}

/** Progreso real del script aplicar-actualizacion.sh, leído de progress.json. */
export interface ProgressInfo {
  actualizacion_id: string
  paso:
    | 'INICIANDO'
    | 'BACKUP'
    | 'BACKUP_OK'
    | 'FETCH'
    | 'FETCH_OK'
    | 'BUILD'
    | 'BUILD_OK'
    | 'MIGRATIONS'
    | 'MIGRATIONS_OK'
    | 'RESTART'
    | 'HEALTHCHECK'
    | 'DONE'
    | 'ROLLBACK'
    | 'ROLLBACK_OK'
    | 'ROLLBACK_FAILED'
    | 'FAILED'
    | 'CANCELADA'
  porcentaje: number
  mensaje: string
  actualizado_en: string
}
