// ============================================================
// Tipos TypeScript del dominio del CRM
// ============================================================
// Este archivo coexiste con `database.generated.ts` (auto-generado por
// `npm run types:generate`). Acá viven los tipos enriquecidos:
//   - Union types nominales (EstadoPersona, EstadoPoliza, etc.)
//   - JSONB tipado (DetalleAutomotor, DetalleHogar, etc.)
//   - Interfaces con relaciones opcionales (Persona con `_count_polizas`)
//   - Tipos derivados (FiltrosPersonas, ResultadoPaginado, etc.)
//
// Helpers para usar los tipos del schema (auto-generados) en código nuevo:
//
//   import type { Tables, InsertOf, UpdateOf } from '@/types/database'
//
//   const fila: Tables<'personas'>     // = Row de personas
//   const nueva: InsertOf<'personas'>  // payload para .insert()
//   const cambio: UpdateOf<'personas'> // payload para .update()
//
// Estos helpers son **opt-in**. Los castings `as unknown as T` existentes
// siguen funcionando — se irán reemplazando gradualmente.
// ============================================================

import type { Database } from './database.generated'

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type InsertOf<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type UpdateOf<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']

// Re-export del tipo raíz por conveniencia.
export type { Database } from './database.generated'

// ============================================================
// Tipos enriquecidos del dominio (escritos a mano)
// ============================================================

export type EstadoPersona = 'PROSPECTO' | 'ACTIVO' | 'INACTIVO' | 'BLOQUEADO'
export type TipoPersona = 'FISICA' | 'JURIDICA'
export type EstadoPoliza = 'PROGRAMADA' | 'RENOVADA' | 'VIGENTE' | 'NO_VIGENTE' | 'CANCELADA' | 'ANULADA'
export type EstadoSiniestro = 'DENUNCIADO' | 'EN_TRAMITE' | 'INSPECCION' | 'LIQUIDACION' | 'REPARACION' | 'FINALIZADO' | 'RECHAZADO'
export type TipoRiesgo = 'AUTOMOTOR' | 'HOGAR' | 'COMERCIO' | 'VIDA' | 'ACCIDENTES_PERSONALES' | 'INTEGRAL_FAMILIA' | 'CAUCION' | 'TRANSPORTE' | 'MOTO' | 'EMBARCACION' | 'TECNOLOGIA' | 'ART' | 'GENERICO' | 'OTRO'

export interface Persona {
  id: string
  tipo_persona: TipoPersona
  dni_cuil: string
  cuil_formateado: string | null
  apellido: string
  nombre: string | null
  razon_social: string | null
  email: string | null
  email_secundario: string | null
  telefono: string | null
  telefono_secundario: string | null
  whatsapp: string | null
  calle: string | null
  numero: string | null
  piso_depto: string | null
  barrio: string | null
  localidad: string | null
  provincia: string | null
  codigo_postal: string | null
  pais: string
  estado: EstadoPersona
  origen: string | null
  segmento: string | null
  fecha_alta: string
  fecha_baja: string | null
  datos_extra: Record<string, unknown>
  acepta_marketing: boolean
  canal_preferido: string | null
  created_at: string
  updated_at: string
  usuario_id: string | null
  // Relaciones calculadas (para queries con joins)
  _count_polizas?: number
  _count_siniestros?: number
}

export interface Poliza {
  id: string
  numero_poliza: string
  numero_certificado: string | null
  asegurado_id: string
  tomador_id: string | null
  compania_id: string | null
  ramo_id: string | null
  cobertura_id: string | null
  refacturacion_id: string | null
  vigencia_tipo_id: string | null
  fecha_inicio: string
  fecha_fin: string
  moneda: string
  suma_asegurada: number | null
  estado: EstadoPoliza
  motivo_baja: string | null
  fecha_baja: string | null
  observaciones_baja: string | null
  poliza_origen_id: string | null
  fecha_renovacion: string | null
  url_poliza_pdf: string | null
  notas: string | null
  observaciones: string | null
  created_at: string
  updated_at: string
  // Relaciones
  asegurado?: Persona
  compania?: Catalogo
  ramo?: Catalogo
}

export interface Riesgo {
  id: string
  poliza_id: string
  tipo_riesgo: TipoRiesgo
  descripcion_corta: string | null
  detalle_tecnico: Record<string, unknown>
  suma_asegurada: number | null
  numero_item: number
  activo: boolean
  created_at: string
  updated_at: string
}

// Estructura del detalle técnico por tipo de riesgo
export interface DetalleAutomotor {
  patente?: string
  marca?: string
  modelo?: string
  anio?: number
  motor?: string
  chasis?: string
  color?: string
  uso?: string
  gnc?: boolean
}

export interface DetalleHogar {
  direccion?: string
  piso?: string
  m2?: number
  tipo?: string
  material_techo?: string
  material_paredes?: string
  uso?: string
}

export interface DetalleVida {
  beneficiarios?: Array<{
    nombre: string
    parentesco: string
    pct: number
  }>
}

export interface Siniestro {
  id: string
  numero_caso: string | null
  numero_siniestro: string | null
  poliza_id: string
  riesgo_id: string | null
  persona_id: string
  fecha_ocurrencia: string
  fecha_denuncia: string
  fecha_cierre: string | null
  fecha_ultimo_movimiento: string
  hora_siniestro: string | null
  lugar_siniestro: string | null
  localidad_siniestro: string | null
  tipo_siniestro: string | null
  descripcion: string
  detalle_siniestro: Record<string, unknown> | null
  estado: EstadoSiniestro
  motivo_rechazo: string | null
  monto_estimado: number | null
  monto_liquidado: number | null
  franquicia_aplicada: number | null
  monto_cobrado: number | null
  tercero_nombre: string | null
  tercero_dni: string | null
  tercero_telefono: string | null
  tercero_patente: string | null
  notas: string | null
  created_at: string
  updated_at: string
  // Relaciones
  persona?: Persona
  poliza?: Poliza
}

export interface Catalogo {
  id: string
  tipo_id: number
  codigo: string
  nombre: string
  descripcion: string | null
  parent_id: string | null
  metadata: Record<string, unknown>
  activo: boolean
  orden: number
  created_at: string
  updated_at: string
}

export interface Tarea {
  id: string
  titulo: string
  tipo: string
  descripcion: string | null
  persona_id: string
  poliza_id: string | null
  siniestro_id: string | null
  oportunidad_id: string | null
  cotizacion_id: string | null
  lead_id: string | null
  fecha_vencimiento: string
  hora_vencimiento: string | null
  prioridad: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAJA'
  estado: 'PENDIENTE' | 'EN_PROCESO' | 'COMPLETADA' | 'CANCELADA'
  recurrencia: 'NINGUNA' | 'DIARIA' | 'SEMANAL' | 'MENSUAL' | 'ANUAL'
  nota_cierre: string | null
  usuario_id: string | null
  created_at: string
  // Relaciones
  persona?: Persona
  poliza?: Poliza
}

export interface Facturacion {
  id: string
  compania_id: string
  ramo_id: string | null
  mes: number
  anio: number
  periodo: string | null
  monto: number
  cantidad_polizas: number | null
  polizas_nuevas: number | null
  polizas_renovadas: number | null
  polizas_canceladas: number | null
  premio_total: number | null
  comision_bruta: number | null
  retenciones: number | null
  comision_neta: number | null
  estado_liquidacion: string
  fecha_liquidacion: string | null
  fecha_cobro: string | null
  numero_liquidacion: string | null
  url_liquidacion_pdf: string | null
  notas: string | null
  created_at: string
  updated_at: string
}

// ── Módulo Comercial: Marketing y Ventas ──

export interface Lead {
  id: string
  nombre: string
  apellido: string
  dni: string | null
  telefono: string | null
  email: string | null
  empresa: string | null
  cargo: string | null
  fuente: 'REFERIDO' | 'WEB' | 'REDES_SOCIALES' | 'LLAMADA_ENTRANTE' | 'EVENTO' | 'OTRO'
  canal: 'WHATSAPP' | 'TELEFONO' | 'EMAIL' | 'PRESENCIAL' | null
  nivel_interes: 'ALTO' | 'MEDIO' | 'BAJO'
  productos_interes: string | null
  estado: 'NUEVO' | 'CONTACTADO' | 'CONVERTIDO' | 'DESCARTADO'
  motivo_descarte: string | null
  notas: string | null
  usuario_id: string | null
  persona_id: string | null
  fecha_conversion: string | null
  created_at: string
  updated_at: string
}

export interface Oportunidad {
  id: string
  persona_id: string
  tipo: 'CROSS_SELL' | 'RECUPERACION' | 'NUEVA_VENTA'
  fuente: 'AUTOMATICA' | 'MANUAL'
  descripcion: string | null
  estado: 'DETECTADA' | 'CONTACTADO' | 'NEGOCIACION' | 'GANADA' | 'PERDIDA'
  motivo_perdida: string | null
  fecha_proximo_contacto: string | null
  notas: string | null
  usuario_id: string | null
  monto_estimado: number | null
  probabilidad_cierre: number | null
  fecha_estimada_cierre: string | null
  created_at: string
  updated_at: string
}

export interface Cotizacion {
  id: string
  numero_cotizacion: string
  persona_id: string | null
  lead_id: string | null
  oportunidad_id: string | null
  ramo_id: string | null
  datos_riesgo: Record<string, any>
  estado: 'BORRADOR' | 'ENVIADA' | 'EN_PROCESO' | 'GANADA' | 'PERDIDA'
  motivo_perdida: string | null
  compania_ganadora_id: string | null
  fecha_envio: string | null
  fecha_cierre: string | null
  fecha_vencimiento: string | null
  notas: string | null
  usuario_id: string | null
  poliza_generada_id: string | null
  created_at: string
  updated_at: string
}

export interface CotizacionCompania {
  id: string
  cotizacion_id: string
  compania_id: string
  cobertura_id: string | null
  precio: number
  detalle: string | null
  seleccionada: boolean
  created_at: string
}

export interface Interaccion {
  id: string
  lead_id: string | null
  oportunidad_id: string | null
  tipo: 'LLAMADA' | 'EMAIL' | 'WHATSAPP' | 'REUNION' | 'NOTA'
  descripcion: string
  fecha: string
  created_at: string
}

// Vista v_polizas_por_vencer
export interface PolizaPorVencer {
  poliza_id: string
  numero_poliza: string
  fecha_fin: string
  dias_restantes: number
  estado_poliza: EstadoPoliza
  persona_id: string
  nombre_completo: string
  dni_cuil: string
  email: string | null
  telefono: string | null
  whatsapp: string | null
  compania: string
  ramo: string
  prioridad_alerta: 'VENCIDA' | 'URGENTE' | 'CRITICA' | 'PROXIMA' | 'NORMAL'
}

// Tipos para filtros y paginación
export interface FiltrosPersonas {
  busqueda?: string
  estado?: EstadoPersona | 'TODOS'
  provincia?: string
  pagina?: number
  porPagina?: number
}

export interface ResultadoPaginado<T> {
  data: T[]
  total: number
  pagina: number
  porPagina: number
  totalPaginas: number
}

export type TipoNotificacion =
  | 'POLIZA_VENCIDA' | 'TAREA_VENCIDA' | 'SINIESTRO_30_DIAS' | 'SINIESTRO_60_DIAS'
  | 'COTIZACION_SIN_RESPUESTA' | 'COTIZACION_SIN_SEGUIMIENTO' | 'OPORTUNIDAD_ESTANCADA'
  | 'COTIZACION_VENCIENDO_PRONTO' | 'COTIZACION_VENCIDA'
  | 'IMPORTACION_INICIADA' | 'IMPORTACION_ANALIZADA' | 'IMPORTACION_LISTA_REVISION'
  | 'IMPORTACION_COMPLETADA' | 'IMPORTACION_FALLIDA' | 'IMPORTACION_PAUSADA' | 'IMPORTACION_DESHECHA'
  | 'PDF_LISTO_PARA_REVISAR' | 'PDF_FALLIDO' | 'POLIZA_REHABILITADA'
  | 'BACKUP_FALLIDO' | 'BACKUP_SYNC_FALLIDO'
  | 'RESTAURACION_INICIADA' | 'RESTAURACION_COMPLETADA' | 'RESTAURACION_FALLIDA'
  | 'EMAIL_AUTOMATICO_FALLIDO'
  | 'SINIESTRO_DENUNCIA_PUBLICA'
  | 'SOLICITUD_BLANQUEO_PASSWORD'
  | 'BLANQUEO_ABUSO_DETECTADO'

export interface Notificacion {
  id: string
  tipo: TipoNotificacion
  prioridad: 'CRITICA' | 'ADVERTENCIA' | 'INFORMATIVA'
  titulo: string
  mensaje: string
  entidad_tipo: string | null
  entidad_id: string | null
  url: string | null
  leida: boolean
  fecha_lectura: string | null
  usuario_id: string | null
  created_at: string
}

export interface Usuario {
  id: string
  nombre: string
  apellido: string
  email: string
  password_hash: string
  rol: 'ADMIN' | 'USUARIO'
  acceso_cartera: 'TOTAL' | 'PROPIA'
  activo: boolean
  ultimo_acceso: string | null
  intentos_fallidos: number
  bloqueado_hasta: string | null
  mostrar_ayuda_contextual: boolean
  created_at: string
  updated_at: string
}

export interface Sesion {
  id: string
  usuario_id: string
  token: string
  expires_at: string
  created_at: string
}

export interface ConfiguracionNotificacion {
  id: string
  tipo: TipoNotificacion
  activa: boolean
  umbral_dias: number | null
  antispam_dias: number
  created_at: string
  updated_at: string
}

export interface Postit {
  id: string
  usuario_id: string
  texto: string
  color: 'amarillo' | 'rosa' | 'verde' | 'azul' | 'naranja'
  compartido: boolean
  created_at: string
  updated_at: string
}

export type EstadoImportacion =
  | 'PENDIENTE' | 'ANALIZANDO' | 'ANALIZADO' | 'IMPORTANDO'
  | 'REVISANDO' | 'COMPLETADA' | 'FALLIDA' | 'CANCELADA' | 'PAUSADA'

export type TipoImportacion = 'INICIAL' | 'INCREMENTAL'

export interface Importacion {
  id: string
  usuario_id: string
  compania_id: string | null
  nombre_archivo: string
  total_filas: number
  clientes_creados: number
  clientes_existentes: number
  polizas_creadas: number
  errores: number
  detalle_errores: Array<{ fila: number; mensaje: string }>
  tipo: TipoImportacion | null
  estado_proceso: EstadoImportacion | null
  plan_importacion: Record<string, unknown> | null
  estadisticas: Record<string, unknown> | null
  archivos_metadata: Record<string, unknown> | null
  ids_creados: Record<string, unknown> | null
  ids_actualizados: Record<string, unknown> | null
  fecha_inicio: string | null
  fecha_fin: string | null
  notas: string | null
  deshecha: boolean | null
  fecha_deshecha: string | null
  created_at: string
}

export interface ConfiguracionCorreos {
  id: string
  smtp_host: string | null
  smtp_port: number
  smtp_secure: boolean
  smtp_user: string | null
  smtp_password_encrypted: string | null
  from_name: string | null
  from_email: string | null
  reply_to: string | null
  firma_html: string | null
  configurado: boolean
  ultimo_test: string | null
  ultimo_test_exitoso: boolean | null
  created_at: string
  updated_at: string
}

export interface SiniestrosContador {
  anio: number
  ultimo_numero: number
  updated_at: string
}

export interface ConfiguracionFormularioPublico {
  id: string
  activo: boolean
  titulo_hero: string
  subtitulo_hero: string
  mensaje_validacion_fallida: string
  mensaje_fuera_servicio: string
  terminos_activos: boolean
  terminos_titulo: string
  terminos_contenido: string | null
  created_at: string
  updated_at: string
}

export interface Backup {
  id: string
  nombre: string
  tipo: 'AUTOMATICO' | 'MANUAL' | 'PRE_RESTORE'
  fecha_inicio: string
  fecha_fin: string | null
  duracion_segundos: number | null
  tamano_db_bytes: number | null
  tamano_storage_bytes: number | null
  tamano_total_bytes: number | null
  estado: 'EN_PROCESO' | 'COMPLETADO' | 'FALLIDO' | 'COMPLETADO_CON_ERRORES'
  error_mensaje: string | null
  sync_remoto_intentado: boolean
  sync_remoto_exitoso: boolean | null
  sync_remoto_error: string | null
  ruta_local: string | null
  ruta_remota: string | null
  usuario_id: string | null
  created_at: string
  // Formato .crmbak (tar.gz sin cifrar)
  archivo_unico_path: string | null
  archivo_unico_tamano_bytes: number | null
  contenido_incluido: {
    database?: boolean
    storage?: boolean
  } | null
}

export type EstadoRestauracion =
  | 'PENDIENTE'
  | 'VALIDANDO'
  | 'PRE_BACKUP'
  | 'EXTRAYENDO'
  | 'RESTAURANDO_DB'
  | 'RESTAURANDO_STORAGE'
  | 'FINALIZANDO'
  | 'COMPLETADA'
  | 'FALLIDA'
  | 'CANCELADA'

export interface Restauracion {
  id: string
  fuente: 'BACKUP_EXISTENTE' | 'ARCHIVO_SUBIDO'
  backup_id: string | null
  nombre_archivo: string | null
  tamano_archivo_bytes: number | null
  estado: EstadoRestauracion
  paso_actual: number
  total_pasos: number
  mensaje_progreso: string | null
  porcentaje: number
  restaura_db: boolean
  restaura_storage: boolean
  crear_pre_backup: boolean
  pre_backup_id: string | null
  metadata_backup: any
  fecha_inicio: string
  fecha_fin: string | null
  duracion_segundos: number | null
  error_mensaje: string | null
  log_completo: string | null
  work_dir: string | null
  usuario_id: string | null
  ip_origen: string | null
  user_agent: string | null
  created_at: string
}

export interface ConfiguracionBackups {
  id: string
  activo: boolean
  retener_diarios: number
  retener_semanales: number
  retener_mensuales: number
  sync_remoto_activo: boolean
  remote_nombre: string
  carpeta_remota: string
  hora_backup: string
  notificar_exito: boolean
  notificar_fallos: boolean
  created_at: string
  updated_at: string
}

export type ContextoPlantillaEmail =
  | 'PERSONA' | 'POLIZA' | 'PORTAL_CLIENTE' | 'GENERAL' | 'CLIENTE' | 'RENOVACION'

export interface PlantillaEmail {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  contexto: ContextoPlantillaEmail
  // Contenido editable (estructura fija con 4 campos)
  asunto: string
  saludo: string
  cuerpo: string
  cierre: string
  // Defaults del sistema (para "Restaurar default")
  asunto_default: string | null
  saludo_default: string | null
  cuerpo_default: string | null
  cierre_default: string | null
  variables_disponibles: string[]
  activa: boolean
  es_sistema: boolean
  editable: boolean
  created_at: string
  updated_at: string
}

export type TipoEnvioEmail =
  // Comunicaciones a clientes
  | 'AUTOMATICO_BIENVENIDA'
  | 'AUTOMATICO_BIENVENIDA_CLIENTE'
  | 'AUTOMATICO_RENOVACION'
  | 'AUTOMATICO_PORTAL_CLIENTE'
  | 'MANUAL'
  | 'MASIVO'
  | 'NOTIFICACION_INTERNA'
  // Notificaciones al admin por eventos del sistema
  | 'SISTEMA_BACKUP_COMPLETADO'
  | 'SISTEMA_BACKUP_FALLIDO'
  | 'SISTEMA_BACKUP_SYNC_FALLIDO'
  | 'SISTEMA_RESTAURACION_INICIADA'
  | 'SISTEMA_RESTAURACION_COMPLETADA'
  | 'SISTEMA_RESTAURACION_FALLIDA'
  | 'SISTEMA_PDF_PROCESADO'
  | 'SISTEMA_PDF_FALLIDO'
  | 'SISTEMA_EMAIL_AUTOMATICO_FALLIDO'
  | 'SISTEMA_TEST_SMTP'
  | 'SISTEMA_ERROR_CRITICO'
  | 'SISTEMA_SUGERENCIA_CORRECCION_PORTAL'
  | 'SISTEMA_SOLICITUD_BLANQUEO_PASSWORD'
  | 'SISTEMA_BLANQUEO_ADMIN_CONFIRMACION'
  // Auth (Supabase Auth, migración 057+)
  | 'AUTH_RECUPERAR_PASSWORD'
  | 'AUTH_INVITACION_USUARIO'
  | 'AUTH_CONFIRMACION_EMAIL'
  // Licencias (migración 062)
  | 'SISTEMA_LICENCIA_POR_VENCER'
  | 'SISTEMA_LICENCIA_VENCIDA'
  | 'SISTEMA_LICENCIA_EN_GRACIA'
  | 'SISTEMA_LICENCIA_BLOQUEADA'
  // Rollback del sistema de actualizaciones (migración 092)
  | 'SISTEMA_ROLLBACK_UPDATE'

export type PrioridadEmailEnvio = 'ALTA' | 'NORMAL'

export type EstadoEnvioEmail =
  | 'ENCOLADO'
  | 'ENVIANDO'
  | 'ENVIADO'
  | 'FALLIDO'
  | 'EXCLUIDO_BAJA'
  | 'EXCLUIDO_NO_MARKETING'
  | 'PENDIENTE'

export interface EmailEnvio {
  id: string
  token_tracking: string | null
  plantilla_codigo: string
  destinatario_email: string
  destinatario_nombre: string | null
  persona_id: string | null
  poliza_id: string | null
  asunto: string
  cuerpo_html: string | null
  variables_usadas: Record<string, string> | null
  archivos_adjuntos: Array<{ filename: string; path: string; size?: number }> | null
  tipo_envio: TipoEnvioEmail
  prioridad: PrioridadEmailEnvio
  estado: EstadoEnvioEmail
  error_mensaje: string | null
  intentos: number
  enviar_despues_de: string | null
  archivado: boolean
  enviado_por_usuario_id: string | null
  fecha_creacion: string
  fecha_envio: string | null
  fecha_apertura: string | null
  cantidad_aperturas: number
  fecha_primer_click: string | null
  cantidad_clicks: number
}

export interface EmailClick {
  id: string
  envio_id: string
  url_destino: string
  fecha_click: string
  ip_origen: string | null
}

export interface EmailBaja {
  id: string
  email: string
  persona_id: string | null
  fecha_baja: string
  origen: 'unsubscribe_link' | 'manual_admin' | 'bounce_permanente' | null
  motivo: string | null
}

export interface ConfiguracionComunicaciones {
  id: string
  activo: boolean
  envio_automatico_renovaciones: boolean
  envio_automatico_bienvenida_poliza: boolean
  envio_automatico_portal_cliente: boolean
  adjuntar_docs_renovacion: boolean
  limite_diario: number
  delay_entre_envios_ms: number
  delay_entre_envios_automaticos_seg: number
  max_adjuntos_mb: number
  retener_completo_dias: number
  retener_metadata_meses: number
  eliminar_despues_meses: number
  notificar_admin_eventos_informativos: boolean
  errores_retener_completo_dias: number
  errores_retener_metadata_dias: number
  errores_ventana_agregacion_minutos: number
  created_at: string
  updated_at: string
}

export interface ErrorSistema {
  id: string
  codigo: string
  mensaje: string
  modulo: string | null
  endpoint: string | null
  metodo: string | null
  stack_trace: string | null
  request_body: Record<string, unknown> | null
  request_headers: Record<string, string> | null
  contexto_extra: Record<string, unknown> | null
  usuario_id: string | null
  correlation_id: string | null
  contador: number
  primera_aparicion: string
  ultima_aparicion: string
  archivado: boolean
  created_at: string
}

export interface Configuracion {
  id: string
  tipo_operacion: 'INDEPENDIENTE' | 'SOCIEDAD' | null
  nombre: string | null
  razon_social: string | null
  cuit: string | null
  matricula_ssn: string | null
  logo_path: string | null
  telefono: string | null
  whatsapp: string | null
  email: string | null
  direccion: string | null
  sitio_web: string | null
  instagram: string | null
  facebook: string | null
  socios: Array<{ nombre: string; matricula: string }> | null
  prefijo_casos: string | null
  notificaciones_activas: boolean | null
  modulo_ia_pdf_polizas_activo: boolean | null
  // Anthropic / Claude (configurable desde la UI del módulo IA)
  anthropic_api_key_encrypted: string | null
  anthropic_model: string | null
  anthropic_ultimo_test: string | null
  anthropic_ultimo_test_exitoso: boolean | null
  anthropic_tokens_usados_mes: number | null
  anthropic_llamadas_mes: number | null
  anthropic_reset_mes: string | null
  anthropic_uso_total_tokens: number | null
  anthropic_uso_total_costo: number | null
  // Familia de modelo Anthropic seleccionada por el admin (migración 020)
  anthropic_familia: 'sonnet' | 'opus' | 'haiku' | null
  // URLs públicas configurables (instalador)
  url_crm: string | null
  url_portal_cliente: string | null
  url_formulario_publico: string | null
  // Configuración de generación de cotizaciones
  cotizacion_validez_dias: number | null
  cotizacion_terminos: string | null
  cotizacion_nota_final: string | null
  // Color de marca aplicado a emails / portal / denuncia (migración 038)
  color_marca: string | null
  // Toggle de mostrar logo (vs solo nombre) en emails
  usar_logo: boolean | null
  // Onboarding wizard (migración 063)
  onboarding_completado: boolean | null
  onboarding_paso_actual: number | null
  created_at: string | null
  updated_at: string | null
}

export interface PdfProcesamiento {
  id: string
  tipo_operacion: 'POLIZA_NUEVA' | 'RENOVACION' | 'ENDOSO'
  poliza_origen_id: string | null
  poliza_creada_id: string | null
  endoso_creado_id: string | null
  estado: 'PENDIENTE' | 'PROCESANDO' | 'EXTRAIDO' | 'APROBADO' | 'CANCELADO' | 'FALLIDO'
  nombre_archivo: string
  tamano_archivo: number | null
  ruta_temporal: string | null
  datos_extraidos: Record<string, any> | null
  mapeos_catalogos: Record<string, any> | null
  campos_dudosos: Array<Record<string, any>> | null
  tokens_usados: number | null
  costo_estimado: number | null
  error_mensaje: string | null
  usuario_id: string | null
  created_at: string
  updated_at: string
}

export interface SiniestroBitacora {
  id: string
  siniestro_id: string
  tipo:
    | 'NOTA'
    | 'ESTADO'
    | 'ARCHIVO'
    | 'CREACION'
    | 'EDICION'
    | 'ELIMINACION'
    | 'RESTAURACION'
    | 'PURGA_DEFINITIVA'
  texto: string | null
  estado_anterior: string | null
  estado_nuevo: string | null
  monto_actualizado: number | null
  usuario_id: string | null
  campos_modificados: string[] | null
  created_at: string
}

export interface SiniestroArchivo {
  id: string
  siniestro_id: string
  categoria: 'fotos' | 'documentacion'
  nombre: string
  ruta: string
  mime_type: string | null
  tamano: number | null
  created_at: string
}

export interface PolizaArchivo {
  id: string
  poliza_id: string
  endoso_id: string | null
  categoria: 'inspeccion' | 'documentacion' | 'documentacion_renovada' | 'endosos'
  nombre: string
  ruta: string
  mime_type: string | null
  tamano: number | null
  created_at: string
}

export type TipoEventoBitacoraPoliza =
  | 'CREACION'
  | 'CAMBIO_ESTADO'
  | 'CANCELACION'
  | 'ANULACION'
  | 'REHABILITACION'
  | 'RENOVACION_CREADA'
  | 'RENOVACION_ACTIVADA'

export interface PolizaBitacora {
  id: string
  poliza_id: string
  tipo_evento: TipoEventoBitacoraPoliza
  estado_anterior: string | null
  estado_nuevo: string | null
  motivo: string | null
  observaciones: string | null
  usuario_id: string | null
  created_at: string
}

export interface Endoso {
  id: string
  poliza_id: string
  numero_endoso: number
  fecha: string
  motivo: string
  observaciones: string | null
  created_at: string
}

export interface StorageToken {
  id: string
  token: string
  ruta_archivo: string
  fecha_creacion: string
  fecha_expiracion: string
  veces_usado: number
  max_usos: number | null
  contexto: string | null
  creado_por_usuario_id: string | null
}

export interface RateLimitBucket {
  id: string
  identifier: string
  endpoint: string
  count: number
  reset_at: string
}

// ============================================================
// Portal del Cliente
// ============================================================

export interface PortalClienteAcceso {
  id: string
  persona_id: string
  token: string
  fecha_creacion: string
  veces_accedido: number
  ultimo_acceso: string | null
  ultimo_ip: string | null
  revocado: boolean
  fecha_revocacion: string | null
  motivo_revocacion: string | null
  creado_por_usuario_id: string | null
}

export interface ConfiguracionPortalCliente {
  id: string
  activo: boolean
  texto_bienvenida: string
  mensaje_acceso_revocado: string
  created_at: string
  updated_at: string
}

export interface TelefonoAsistenciaCompania {
  id: string
  compania_id: string
  telefono: string
  nombre_boton: string
  visible_en_portal: boolean
  created_at: string
  updated_at: string
}

// =============================================================================
// Tipos enriquecidos para tablas auxiliares (auditoría #M5)
// =============================================================================

export type TipoEventoPersonaBitacora =
  | 'CREACION'
  | 'EDICION'
  | 'CAMBIO_ESTADO'
  | 'ELIMINACION'
  | 'RESTAURACION'
  | 'PURGA_DEFINITIVA'

export interface PersonaBitacora {
  id: string
  persona_id: string
  tipo_evento: TipoEventoPersonaBitacora
  estado_anterior: string | null
  estado_nuevo: string | null
  campos_modificados: string[] | null
  motivo: string | null
  observaciones: string | null
  usuario_id: string | null
  created_at: string
}

/**
 * Snapshot histórico de pólizas eliminadas. Se usa para mostrar en
 * /crm/polizas/papelera y para reconstruir contexto en auditoría.
 */
export interface PolizaEliminada {
  id: string
  poliza_id: string
  numero_poliza: string
  asegurado_id: string | null
  asegurado_nombre: string | null
  compania_id: string | null
  compania_nombre: string | null
  ramo_id: string | null
  ramo_nombre: string | null
  estado: string | null
  fecha_inicio: string | null
  fecha_fin: string | null
  poliza_origen_id: string | null
  cant_polizas_hijas: number
  cant_riesgos: number
  cant_siniestros: number
  cant_endosos: number
  eliminada_por_usuario_id: string | null
  motivo: string | null
  observaciones: string | null
  created_at: string
}

export interface AnthropicModeloCache {
  id: string                      // ej: 'claude-sonnet-4-6'
  display_name: string | null
  familia: 'sonnet' | 'opus' | 'haiku' | null
  created_at: string | null
  deprecated_at: string | null    // si !== null, el modelo ya no se devuelve por /v1/models
  refreshed_at: string
}

// NOTA: el antiguo `interface Database` manual fue eliminado. Ahora se
// reexporta desde `./database.generated` (ver header de este archivo).
// El generado refleja las 53 tablas reales del schema, no 6 escritas a mano.
