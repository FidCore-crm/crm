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

export interface ActualizacionRow {
  id: string
  version_anterior: string
  version_nueva: string
  changelog: string | null
  estado: 'PROGRAMADA' | 'EJECUTANDO' | 'COMPLETADA' | 'FALLIDA' | 'CANCELADA'
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
