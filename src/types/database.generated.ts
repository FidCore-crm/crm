// ============================================================
// ARCHIVO AUTO-GENERADO — NO EDITAR A MANO
// ============================================================
// Regenerar con: npm run types:generate
//
// Refleja el schema actual del Postgres de Supabase.
// Las interfaces enriquecidas (con relaciones, JSONB tipado,
// unions nominales) viven en src/types/database.ts y extienden
// de los tipos `Row` exportados acá.
// ============================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      anthropic_modelos_cache: {
        Row: {
          created_at: string | null
          deprecated_at: string | null
          display_name: string | null
          familia: string | null
          id: string
          refreshed_at: string
        }
        Insert: {
          created_at?: string | null
          deprecated_at?: string | null
          display_name?: string | null
          familia?: string | null
          id: string
          refreshed_at?: string
        }
        Update: {
          created_at?: string | null
          deprecated_at?: string | null
          display_name?: string | null
          familia?: string | null
          id?: string
          refreshed_at?: string
        }
        Relationships: []
      }
      backups: {
        Row: {
          archivo_unico_path: string | null
          archivo_unico_tamano_bytes: number | null
          contenido_incluido: Json | null
          created_at: string | null
          duracion_segundos: number | null
          error_mensaje: string | null
          estado: string
          fecha_fin: string | null
          fecha_inicio: string
          id: string
          nombre: string
          ruta_local: string | null
          ruta_remota: string | null
          sync_remoto_error: string | null
          sync_remoto_exitoso: boolean | null
          sync_remoto_intentado: boolean | null
          tamano_db_bytes: number | null
          tamano_storage_bytes: number | null
          tamano_total_bytes: number | null
          tipo: string
          usuario_id: string | null
        }
        Insert: {
          archivo_unico_path?: string | null
          archivo_unico_tamano_bytes?: number | null
          contenido_incluido?: Json | null
          created_at?: string | null
          duracion_segundos?: number | null
          error_mensaje?: string | null
          estado?: string
          fecha_fin?: string | null
          fecha_inicio: string
          id?: string
          nombre: string
          ruta_local?: string | null
          ruta_remota?: string | null
          sync_remoto_error?: string | null
          sync_remoto_exitoso?: boolean | null
          sync_remoto_intentado?: boolean | null
          tamano_db_bytes?: number | null
          tamano_storage_bytes?: number | null
          tamano_total_bytes?: number | null
          tipo?: string
          usuario_id?: string | null
        }
        Update: {
          archivo_unico_path?: string | null
          archivo_unico_tamano_bytes?: number | null
          contenido_incluido?: Json | null
          created_at?: string | null
          duracion_segundos?: number | null
          error_mensaje?: string | null
          estado?: string
          fecha_fin?: string | null
          fecha_inicio?: string
          id?: string
          nombre?: string
          ruta_local?: string | null
          ruta_remota?: string | null
          sync_remoto_error?: string | null
          sync_remoto_exitoso?: boolean | null
          sync_remoto_intentado?: boolean | null
          tamano_db_bytes?: number | null
          tamano_storage_bytes?: number | null
          tamano_total_bytes?: number | null
          tipo?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "backups_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      catalogos: {
        Row: {
          activo: boolean
          codigo: string
          created_at: string
          descripcion: string | null
          id: string
          metadata: Json
          nombre: string
          orden: number
          parent_id: string | null
          tipo_id: number
          updated_at: string
        }
        Insert: {
          activo?: boolean
          codigo: string
          created_at?: string
          descripcion?: string | null
          id?: string
          metadata?: Json
          nombre: string
          orden?: number
          parent_id?: string | null
          tipo_id: number
          updated_at?: string
        }
        Update: {
          activo?: boolean
          codigo?: string
          created_at?: string
          descripcion?: string | null
          id?: string
          metadata?: Json
          nombre?: string
          orden?: number
          parent_id?: string | null
          tipo_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogos_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalogos_tipo_id_fkey"
            columns: ["tipo_id"]
            isOneToOne: false
            referencedRelation: "tipo_catalogo"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracion: {
        Row: {
          anthropic_api_key_encrypted: string | null
          anthropic_familia: string | null
          anthropic_llamadas_mes: number | null
          anthropic_model: string | null
          anthropic_reset_mes: string | null
          anthropic_tokens_usados_mes: number | null
          anthropic_ultimo_test: string | null
          anthropic_ultimo_test_exitoso: boolean | null
          anthropic_uso_total_costo: number | null
          anthropic_uso_total_tokens: number | null
          color_marca: string
          cotizacion_email_asunto_template: string | null
          cotizacion_email_cuerpo_template: string | null
          cotizacion_whatsapp_template: string | null
          created_at: string | null
          cuit: string | null
          direccion: string | null
          email: string | null
          facebook: string | null
          id: string
          instagram: string | null
          logo_path: string | null
          matricula_ssn: string | null
          modulo_ia_pdf_polizas_activo: boolean | null
          nombre: string | null
          notificaciones_activas: boolean | null
          onboarding_completado_at: string | null
          onboarding_paso_actual: number
          prefijo_casos: string | null
          razon_social: string | null
          sitio_web: string | null
          socios: Json | null
          telefono: string | null
          tipo_operacion: string
          updated_at: string | null
          url_crm: string | null
          url_formulario_publico: string | null
          url_portal_cliente: string | null
          usar_logo: boolean
          whatsapp: string | null
        }
        Insert: {
          anthropic_api_key_encrypted?: string | null
          anthropic_familia?: string | null
          anthropic_llamadas_mes?: number | null
          anthropic_model?: string | null
          anthropic_reset_mes?: string | null
          anthropic_tokens_usados_mes?: number | null
          anthropic_ultimo_test?: string | null
          anthropic_ultimo_test_exitoso?: boolean | null
          anthropic_uso_total_costo?: number | null
          anthropic_uso_total_tokens?: number | null
          color_marca?: string
          cotizacion_email_asunto_template?: string | null
          cotizacion_email_cuerpo_template?: string | null
          cotizacion_whatsapp_template?: string | null
          created_at?: string | null
          cuit?: string | null
          direccion?: string | null
          email?: string | null
          facebook?: string | null
          id?: string
          instagram?: string | null
          logo_path?: string | null
          matricula_ssn?: string | null
          modulo_ia_pdf_polizas_activo?: boolean | null
          nombre?: string | null
          notificaciones_activas?: boolean | null
          onboarding_completado_at?: string | null
          onboarding_paso_actual?: number
          prefijo_casos?: string | null
          razon_social?: string | null
          sitio_web?: string | null
          socios?: Json | null
          telefono?: string | null
          tipo_operacion?: string
          updated_at?: string | null
          url_crm?: string | null
          url_formulario_publico?: string | null
          url_portal_cliente?: string | null
          usar_logo?: boolean
          whatsapp?: string | null
        }
        Update: {
          anthropic_api_key_encrypted?: string | null
          anthropic_familia?: string | null
          anthropic_llamadas_mes?: number | null
          anthropic_model?: string | null
          anthropic_reset_mes?: string | null
          anthropic_tokens_usados_mes?: number | null
          anthropic_ultimo_test?: string | null
          anthropic_ultimo_test_exitoso?: boolean | null
          anthropic_uso_total_costo?: number | null
          anthropic_uso_total_tokens?: number | null
          color_marca?: string
          cotizacion_email_asunto_template?: string | null
          cotizacion_email_cuerpo_template?: string | null
          cotizacion_whatsapp_template?: string | null
          created_at?: string | null
          cuit?: string | null
          direccion?: string | null
          email?: string | null
          facebook?: string | null
          id?: string
          instagram?: string | null
          logo_path?: string | null
          matricula_ssn?: string | null
          modulo_ia_pdf_polizas_activo?: boolean | null
          nombre?: string | null
          notificaciones_activas?: boolean | null
          onboarding_completado_at?: string | null
          onboarding_paso_actual?: number
          prefijo_casos?: string | null
          razon_social?: string | null
          sitio_web?: string | null
          socios?: Json | null
          telefono?: string | null
          tipo_operacion?: string
          updated_at?: string | null
          url_crm?: string | null
          url_formulario_publico?: string | null
          url_portal_cliente?: string | null
          usar_logo?: boolean
          whatsapp?: string | null
        }
        Relationships: []
      }
      configuracion_backups: {
        Row: {
          activo: boolean | null
          carpeta_remota: string | null
          created_at: string | null
          hora_backup: string | null
          id: string
          notificar_exito: boolean | null
          notificar_fallos: boolean | null
          remote_nombre: string | null
          retener_diarios: number | null
          retener_mensuales: number | null
          retener_semanales: number | null
          sync_remoto_activo: boolean | null
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          carpeta_remota?: string | null
          created_at?: string | null
          hora_backup?: string | null
          id?: string
          notificar_exito?: boolean | null
          notificar_fallos?: boolean | null
          remote_nombre?: string | null
          retener_diarios?: number | null
          retener_mensuales?: number | null
          retener_semanales?: number | null
          sync_remoto_activo?: boolean | null
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          carpeta_remota?: string | null
          created_at?: string | null
          hora_backup?: string | null
          id?: string
          notificar_exito?: boolean | null
          notificar_fallos?: boolean | null
          remote_nombre?: string | null
          retener_diarios?: number | null
          retener_mensuales?: number | null
          retener_semanales?: number | null
          sync_remoto_activo?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      configuracion_comunicaciones: {
        Row: {
          activo: boolean | null
          adjuntar_docs_renovacion: boolean | null
          created_at: string | null
          delay_entre_envios_automaticos_seg: number
          delay_entre_envios_ms: number | null
          eliminar_despues_meses: number
          envio_automatico_bienvenida_poliza: boolean
          envio_automatico_portal_cliente: boolean
          envio_automatico_renovaciones: boolean | null
          errores_retener_completo_dias: number
          errores_retener_metadata_dias: number
          errores_ventana_agregacion_minutos: number
          id: string
          limite_diario: number | null
          max_adjuntos_mb: number
          notificar_admin_eventos_informativos: boolean
          retener_completo_dias: number
          retener_metadata_meses: number
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          adjuntar_docs_renovacion?: boolean | null
          created_at?: string | null
          delay_entre_envios_automaticos_seg?: number
          delay_entre_envios_ms?: number | null
          eliminar_despues_meses?: number
          envio_automatico_bienvenida_poliza?: boolean
          envio_automatico_portal_cliente?: boolean
          envio_automatico_renovaciones?: boolean | null
          errores_retener_completo_dias?: number
          errores_retener_metadata_dias?: number
          errores_ventana_agregacion_minutos?: number
          id?: string
          limite_diario?: number | null
          max_adjuntos_mb?: number
          notificar_admin_eventos_informativos?: boolean
          retener_completo_dias?: number
          retener_metadata_meses?: number
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          adjuntar_docs_renovacion?: boolean | null
          created_at?: string | null
          delay_entre_envios_automaticos_seg?: number
          delay_entre_envios_ms?: number | null
          eliminar_despues_meses?: number
          envio_automatico_bienvenida_poliza?: boolean
          envio_automatico_portal_cliente?: boolean
          envio_automatico_renovaciones?: boolean | null
          errores_retener_completo_dias?: number
          errores_retener_metadata_dias?: number
          errores_ventana_agregacion_minutos?: number
          id?: string
          limite_diario?: number | null
          max_adjuntos_mb?: number
          notificar_admin_eventos_informativos?: boolean
          retener_completo_dias?: number
          retener_metadata_meses?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      configuracion_correos: {
        Row: {
          configurado: boolean | null
          created_at: string | null
          firma_html: string | null
          from_email: string | null
          from_name: string | null
          id: string
          reply_to: string | null
          smtp_host: string | null
          smtp_password_encrypted: string | null
          smtp_port: number | null
          smtp_secure: boolean | null
          smtp_user: string | null
          ultimo_test: string | null
          ultimo_test_exitoso: boolean | null
          updated_at: string | null
        }
        Insert: {
          configurado?: boolean | null
          created_at?: string | null
          firma_html?: string | null
          from_email?: string | null
          from_name?: string | null
          id?: string
          reply_to?: string | null
          smtp_host?: string | null
          smtp_password_encrypted?: string | null
          smtp_port?: number | null
          smtp_secure?: boolean | null
          smtp_user?: string | null
          ultimo_test?: string | null
          ultimo_test_exitoso?: boolean | null
          updated_at?: string | null
        }
        Update: {
          configurado?: boolean | null
          created_at?: string | null
          firma_html?: string | null
          from_email?: string | null
          from_name?: string | null
          id?: string
          reply_to?: string | null
          smtp_host?: string | null
          smtp_password_encrypted?: string | null
          smtp_port?: number | null
          smtp_secure?: boolean | null
          smtp_user?: string | null
          ultimo_test?: string | null
          ultimo_test_exitoso?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      configuracion_formulario_publico: {
        Row: {
          activo: boolean | null
          created_at: string | null
          id: string
          mensaje_fuera_servicio: string | null
          mensaje_validacion_fallida: string | null
          subtitulo_hero: string | null
          terminos_activos: boolean | null
          terminos_contenido: string | null
          terminos_titulo: string | null
          titulo_hero: string | null
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          created_at?: string | null
          id?: string
          mensaje_fuera_servicio?: string | null
          mensaje_validacion_fallida?: string | null
          subtitulo_hero?: string | null
          terminos_activos?: boolean | null
          terminos_contenido?: string | null
          terminos_titulo?: string | null
          titulo_hero?: string | null
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          created_at?: string | null
          id?: string
          mensaje_fuera_servicio?: string | null
          mensaje_validacion_fallida?: string | null
          subtitulo_hero?: string | null
          terminos_activos?: boolean | null
          terminos_contenido?: string | null
          terminos_titulo?: string | null
          titulo_hero?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      configuracion_notificaciones: {
        Row: {
          activa: boolean | null
          antispam_dias: number
          created_at: string | null
          id: string
          tipo: string
          umbral_dias: number | null
          updated_at: string | null
        }
        Insert: {
          activa?: boolean | null
          antispam_dias?: number
          created_at?: string | null
          id?: string
          tipo: string
          umbral_dias?: number | null
          updated_at?: string | null
        }
        Update: {
          activa?: boolean | null
          antispam_dias?: number
          created_at?: string | null
          id?: string
          tipo?: string
          umbral_dias?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      configuracion_portal_cliente: {
        Row: {
          activo: boolean | null
          created_at: string | null
          id: string
          mensaje_acceso_revocado: string | null
          texto_bienvenida: string | null
          updated_at: string | null
        }
        Insert: {
          activo?: boolean | null
          created_at?: string | null
          id?: string
          mensaje_acceso_revocado?: string | null
          texto_bienvenida?: string | null
          updated_at?: string | null
        }
        Update: {
          activo?: boolean | null
          created_at?: string | null
          id?: string
          mensaje_acceso_revocado?: string | null
          texto_bienvenida?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      cotizacion_companias: {
        Row: {
          cobertura_id: string | null
          compania_id: string
          cotizacion_id: string
          created_at: string | null
          detalle: string | null
          id: string
          precio: number
          seleccionada: boolean | null
        }
        Insert: {
          cobertura_id?: string | null
          compania_id: string
          cotizacion_id: string
          created_at?: string | null
          detalle?: string | null
          id?: string
          precio: number
          seleccionada?: boolean | null
        }
        Update: {
          cobertura_id?: string | null
          compania_id?: string
          cotizacion_id?: string
          created_at?: string | null
          detalle?: string | null
          id?: string
          precio?: number
          seleccionada?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "cotizacion_companias_cobertura_id_fkey"
            columns: ["cobertura_id"]
            isOneToOne: false
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizacion_companias_compania_id_fkey"
            columns: ["compania_id"]
            isOneToOne: false
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizacion_companias_cotizacion_id_fkey"
            columns: ["cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      cotizaciones: {
        Row: {
          compania_ganadora_id: string | null
          created_at: string | null
          datos_riesgo: Json | null
          estado: string
          fecha_cierre: string | null
          fecha_envio: string | null
          fecha_vencimiento: string | null
          id: string
          lead_id: string | null
          motivo_perdida: string | null
          notas: string | null
          numero_cotizacion: string
          oportunidad_id: string | null
          persona_id: string | null
          poliza_generada_id: string | null
          ramo_id: string | null
          updated_at: string | null
          usuario_id: string | null
        }
        Insert: {
          compania_ganadora_id?: string | null
          created_at?: string | null
          datos_riesgo?: Json | null
          estado?: string
          fecha_cierre?: string | null
          fecha_envio?: string | null
          fecha_vencimiento?: string | null
          id?: string
          lead_id?: string | null
          motivo_perdida?: string | null
          notas?: string | null
          numero_cotizacion: string
          oportunidad_id?: string | null
          persona_id?: string | null
          poliza_generada_id?: string | null
          ramo_id?: string | null
          updated_at?: string | null
          usuario_id?: string | null
        }
        Update: {
          compania_ganadora_id?: string | null
          created_at?: string | null
          datos_riesgo?: Json | null
          estado?: string
          fecha_cierre?: string | null
          fecha_envio?: string | null
          fecha_vencimiento?: string | null
          id?: string
          lead_id?: string | null
          motivo_perdida?: string | null
          notas?: string | null
          numero_cotizacion?: string
          oportunidad_id?: string | null
          persona_id?: string | null
          poliza_generada_id?: string | null
          ramo_id?: string | null
          updated_at?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cotizaciones_compania_ganadora_id_fkey"
            columns: ["compania_ganadora_id"]
            isOneToOne: false
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_oportunidad_id_fkey"
            columns: ["oportunidad_id"]
            isOneToOne: false
            referencedRelation: "oportunidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["persona_id"]
          },
          {
            foreignKeyName: "cotizaciones_poliza_generada_id_fkey"
            columns: ["poliza_generada_id"]
            isOneToOne: false
            referencedRelation: "polizas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_poliza_generada_id_fkey"
            columns: ["poliza_generada_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_pendientes_renovar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_poliza_generada_id_fkey"
            columns: ["poliza_generada_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["poliza_id"]
          },
          {
            foreignKeyName: "cotizaciones_ramo_id_fkey"
            columns: ["ramo_id"]
            isOneToOne: false
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      email_bajas: {
        Row: {
          email: string
          fecha_baja: string | null
          id: string
          motivo: string | null
          origen: string | null
          persona_id: string | null
        }
        Insert: {
          email: string
          fecha_baja?: string | null
          id?: string
          motivo?: string | null
          origen?: string | null
          persona_id?: string | null
        }
        Update: {
          email?: string
          fecha_baja?: string | null
          id?: string
          motivo?: string | null
          origen?: string | null
          persona_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_email_bajas_persona"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_email_bajas_persona"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["persona_id"]
          },
        ]
      }
      email_clicks: {
        Row: {
          envio_id: string
          fecha_click: string | null
          id: string
          ip_origen: string | null
          url_destino: string
        }
        Insert: {
          envio_id: string
          fecha_click?: string | null
          id?: string
          ip_origen?: string | null
          url_destino: string
        }
        Update: {
          envio_id?: string
          fecha_click?: string | null
          id?: string
          ip_origen?: string | null
          url_destino?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_clicks_envio_id_fkey"
            columns: ["envio_id"]
            isOneToOne: false
            referencedRelation: "email_envios"
            referencedColumns: ["id"]
          },
        ]
      }
      email_envios: {
        Row: {
          archivado: boolean
          archivos_adjuntos: Json | null
          asunto: string
          cantidad_aperturas: number | null
          cantidad_clicks: number | null
          cuerpo_html: string | null
          destinatario_email: string
          destinatario_nombre: string | null
          enviado_por_usuario_id: string | null
          enviar_despues_de: string | null
          error_mensaje: string | null
          estado: string
          fecha_apertura: string | null
          fecha_creacion: string | null
          fecha_envio: string | null
          fecha_primer_click: string | null
          id: string
          intentos: number | null
          persona_id: string | null
          plantilla_codigo: string
          poliza_id: string | null
          prioridad: string
          tipo_envio: string
          token_tracking: string | null
          variables_usadas: Json | null
        }
        Insert: {
          archivado?: boolean
          archivos_adjuntos?: Json | null
          asunto: string
          cantidad_aperturas?: number | null
          cantidad_clicks?: number | null
          cuerpo_html?: string | null
          destinatario_email: string
          destinatario_nombre?: string | null
          enviado_por_usuario_id?: string | null
          enviar_despues_de?: string | null
          error_mensaje?: string | null
          estado?: string
          fecha_apertura?: string | null
          fecha_creacion?: string | null
          fecha_envio?: string | null
          fecha_primer_click?: string | null
          id?: string
          intentos?: number | null
          persona_id?: string | null
          plantilla_codigo: string
          poliza_id?: string | null
          prioridad?: string
          tipo_envio?: string
          token_tracking?: string | null
          variables_usadas?: Json | null
        }
        Update: {
          archivado?: boolean
          archivos_adjuntos?: Json | null
          asunto?: string
          cantidad_aperturas?: number | null
          cantidad_clicks?: number | null
          cuerpo_html?: string | null
          destinatario_email?: string
          destinatario_nombre?: string | null
          enviado_por_usuario_id?: string | null
          enviar_despues_de?: string | null
          error_mensaje?: string | null
          estado?: string
          fecha_apertura?: string | null
          fecha_creacion?: string | null
          fecha_envio?: string | null
          fecha_primer_click?: string | null
          id?: string
          intentos?: number | null
          persona_id?: string | null
          plantilla_codigo?: string
          poliza_id?: string | null
          prioridad?: string
          tipo_envio?: string
          token_tracking?: string | null
          variables_usadas?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "email_envios_enviado_por_usuario_id_fkey"
            columns: ["enviado_por_usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_envios_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_envios_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["persona_id"]
          },
          {
            foreignKeyName: "email_envios_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "polizas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_envios_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_pendientes_renovar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_envios_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["poliza_id"]
          },
        ]
      }
      endosos: {
        Row: {
          created_at: string
          fecha: string
          id: string
          motivo: string
          numero_endoso: number
          observaciones: string | null
          poliza_id: string
        }
        Insert: {
          created_at?: string
          fecha?: string
          id?: string
          motivo: string
          numero_endoso?: number
          observaciones?: string | null
          poliza_id: string
        }
        Update: {
          created_at?: string
          fecha?: string
          id?: string
          motivo?: string
          numero_endoso?: number
          observaciones?: string | null
          poliza_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "endosos_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "polizas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endosos_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_pendientes_renovar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "endosos_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["poliza_id"]
          },
        ]
      }
      errores_sistema: {
        Row: {
          archivado: boolean
          codigo: string
          contador: number
          contexto_extra: Json | null
          correlation_id: string | null
          created_at: string | null
          endpoint: string | null
          id: string
          mensaje: string
          metodo: string | null
          modulo: string | null
          primera_aparicion: string
          request_body: Json | null
          request_headers: Json | null
          stack_trace: string | null
          ultima_aparicion: string
          usuario_id: string | null
        }
        Insert: {
          archivado?: boolean
          codigo: string
          contador?: number
          contexto_extra?: Json | null
          correlation_id?: string | null
          created_at?: string | null
          endpoint?: string | null
          id?: string
          mensaje: string
          metodo?: string | null
          modulo?: string | null
          primera_aparicion?: string
          request_body?: Json | null
          request_headers?: Json | null
          stack_trace?: string | null
          ultima_aparicion?: string
          usuario_id?: string | null
        }
        Update: {
          archivado?: boolean
          codigo?: string
          contador?: number
          contexto_extra?: Json | null
          correlation_id?: string | null
          created_at?: string | null
          endpoint?: string | null
          id?: string
          mensaje?: string
          metodo?: string | null
          modulo?: string | null
          primera_aparicion?: string
          request_body?: Json | null
          request_headers?: Json | null
          stack_trace?: string | null
          ultima_aparicion?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "errores_sistema_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      facturacion: {
        Row: {
          anio: number
          cantidad_polizas: number | null
          comision_bruta: number | null
          comision_neta: number | null
          compania_id: string
          created_at: string
          estado_liquidacion: string
          fecha_cobro: string | null
          fecha_liquidacion: string | null
          id: string
          mes: number
          monto: number
          notas: string | null
          numero_liquidacion: string | null
          periodo: string | null
          polizas_canceladas: number | null
          polizas_nuevas: number | null
          polizas_renovadas: number | null
          premio_total: number | null
          ramo_id: string | null
          retenciones: number | null
          updated_at: string
          url_liquidacion_pdf: string | null
        }
        Insert: {
          anio: number
          cantidad_polizas?: number | null
          comision_bruta?: number | null
          comision_neta?: number | null
          compania_id: string
          created_at?: string
          estado_liquidacion?: string
          fecha_cobro?: string | null
          fecha_liquidacion?: string | null
          id?: string
          mes: number
          monto?: number
          notas?: string | null
          numero_liquidacion?: string | null
          periodo?: string | null
          polizas_canceladas?: number | null
          polizas_nuevas?: number | null
          polizas_renovadas?: number | null
          premio_total?: number | null
          ramo_id?: string | null
          retenciones?: number | null
          updated_at?: string
          url_liquidacion_pdf?: string | null
        }
        Update: {
          anio?: number
          cantidad_polizas?: number | null
          comision_bruta?: number | null
          comision_neta?: number | null
          compania_id?: string
          created_at?: string
          estado_liquidacion?: string
          fecha_cobro?: string | null
          fecha_liquidacion?: string | null
          id?: string
          mes?: number
          monto?: number
          notas?: string | null
          numero_liquidacion?: string | null
          periodo?: string | null
          polizas_canceladas?: number | null
          polizas_nuevas?: number | null
          polizas_renovadas?: number | null
          premio_total?: number | null
          ramo_id?: string | null
          retenciones?: number | null
          updated_at?: string
          url_liquidacion_pdf?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facturacion_compania_id_fkey"
            columns: ["compania_id"]
            isOneToOne: false
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturacion_ramo_id_fkey"
            columns: ["ramo_id"]
            isOneToOne: false
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
        ]
      }
      importacion_jobs: {
        Row: {
          error: string | null
          estado: string | null
          fecha_creacion: string | null
          fecha_fin: string | null
          fecha_inicio: string | null
          id: string
          importacion_id: string
          intentos: number | null
          max_intentos: number | null
          payload: Json | null
          prioridad: number | null
          resultado: Json | null
          tipo: string
          worker_id: string | null
        }
        Insert: {
          error?: string | null
          estado?: string | null
          fecha_creacion?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          importacion_id: string
          intentos?: number | null
          max_intentos?: number | null
          payload?: Json | null
          prioridad?: number | null
          resultado?: Json | null
          tipo: string
          worker_id?: string | null
        }
        Update: {
          error?: string | null
          estado?: string | null
          fecha_creacion?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          importacion_id?: string
          intentos?: number | null
          max_intentos?: number | null
          payload?: Json | null
          prioridad?: number | null
          resultado?: Json | null
          tipo?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "importacion_jobs_importacion_id_fkey"
            columns: ["importacion_id"]
            isOneToOne: false
            referencedRelation: "importaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      importacion_lotes: {
        Row: {
          estado: string | null
          fecha_fin: string | null
          fecha_inicio: string | null
          id: string
          importacion_id: string
          intentos: number | null
          numero_lote: number
          registros_dudosos: number | null
          registros_listos: number | null
          registros_originales: Json | null
          registros_procesados: number | null
          registros_procesados_data: Json | null
          registros_total: number
        }
        Insert: {
          estado?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          importacion_id: string
          intentos?: number | null
          numero_lote: number
          registros_dudosos?: number | null
          registros_listos?: number | null
          registros_originales?: Json | null
          registros_procesados?: number | null
          registros_procesados_data?: Json | null
          registros_total: number
        }
        Update: {
          estado?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          importacion_id?: string
          intentos?: number | null
          numero_lote?: number
          registros_dudosos?: number | null
          registros_listos?: number | null
          registros_originales?: Json | null
          registros_procesados?: number | null
          registros_procesados_data?: Json | null
          registros_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "importacion_lotes_importacion_id_fkey"
            columns: ["importacion_id"]
            isOneToOne: false
            referencedRelation: "importaciones"
            referencedColumns: ["id"]
          },
        ]
      }
      importacion_registros_dudosos: {
        Row: {
          archivo_origen: string | null
          datos_originales: Json | null
          datos_propuestos: Json | null
          descripcion_problema: string | null
          estado_resolucion: string | null
          fecha_resolucion: string | null
          id: string
          importacion_id: string
          lote_id: string | null
          numero_fila_archivo: number | null
          resolucion_accion: string | null
          resolucion_datos: Json | null
          resuelto_por_usuario_id: string | null
          sugerencia_ia: string | null
          tipo_entidad: string
          tipo_problema: string
        }
        Insert: {
          archivo_origen?: string | null
          datos_originales?: Json | null
          datos_propuestos?: Json | null
          descripcion_problema?: string | null
          estado_resolucion?: string | null
          fecha_resolucion?: string | null
          id?: string
          importacion_id: string
          lote_id?: string | null
          numero_fila_archivo?: number | null
          resolucion_accion?: string | null
          resolucion_datos?: Json | null
          resuelto_por_usuario_id?: string | null
          sugerencia_ia?: string | null
          tipo_entidad: string
          tipo_problema: string
        }
        Update: {
          archivo_origen?: string | null
          datos_originales?: Json | null
          datos_propuestos?: Json | null
          descripcion_problema?: string | null
          estado_resolucion?: string | null
          fecha_resolucion?: string | null
          id?: string
          importacion_id?: string
          lote_id?: string | null
          numero_fila_archivo?: number | null
          resolucion_accion?: string | null
          resolucion_datos?: Json | null
          resuelto_por_usuario_id?: string | null
          sugerencia_ia?: string | null
          tipo_entidad?: string
          tipo_problema?: string
        }
        Relationships: [
          {
            foreignKeyName: "importacion_registros_dudosos_importacion_id_fkey"
            columns: ["importacion_id"]
            isOneToOne: false
            referencedRelation: "importaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "importacion_registros_dudosos_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "importacion_lotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "importacion_registros_dudosos_resuelto_por_usuario_id_fkey"
            columns: ["resuelto_por_usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      importaciones: {
        Row: {
          archivos_metadata: Json | null
          clientes_creados: number
          clientes_existentes: number
          compania_id: string | null
          created_at: string | null
          deshecha: boolean | null
          detalle_errores: Json | null
          errores: number
          estadisticas: Json | null
          estado_proceso: string | null
          fecha_deshecha: string | null
          fecha_fin: string | null
          fecha_inicio: string | null
          id: string
          ids_actualizados: Json | null
          ids_creados: Json | null
          nombre_archivo: string
          notas: string | null
          plan_importacion: Json | null
          polizas_creadas: number
          tipo: string | null
          total_filas: number
          usuario_id: string
        }
        Insert: {
          archivos_metadata?: Json | null
          clientes_creados?: number
          clientes_existentes?: number
          compania_id?: string | null
          created_at?: string | null
          deshecha?: boolean | null
          detalle_errores?: Json | null
          errores?: number
          estadisticas?: Json | null
          estado_proceso?: string | null
          fecha_deshecha?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          ids_actualizados?: Json | null
          ids_creados?: Json | null
          nombre_archivo: string
          notas?: string | null
          plan_importacion?: Json | null
          polizas_creadas?: number
          tipo?: string | null
          total_filas?: number
          usuario_id: string
        }
        Update: {
          archivos_metadata?: Json | null
          clientes_creados?: number
          clientes_existentes?: number
          compania_id?: string | null
          created_at?: string | null
          deshecha?: boolean | null
          detalle_errores?: Json | null
          errores?: number
          estadisticas?: Json | null
          estado_proceso?: string | null
          fecha_deshecha?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          ids_actualizados?: Json | null
          ids_creados?: Json | null
          nombre_archivo?: string
          notas?: string | null
          plan_importacion?: Json | null
          polizas_creadas?: number
          tipo?: string | null
          total_filas?: number
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "importaciones_compania_id_fkey"
            columns: ["compania_id"]
            isOneToOne: false
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "importaciones_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      interacciones: {
        Row: {
          created_at: string | null
          descripcion: string
          fecha: string
          id: string
          lead_id: string | null
          oportunidad_id: string | null
          persona_id: string | null
          tipo: string
        }
        Insert: {
          created_at?: string | null
          descripcion: string
          fecha?: string
          id?: string
          lead_id?: string | null
          oportunidad_id?: string | null
          persona_id?: string | null
          tipo: string
        }
        Update: {
          created_at?: string | null
          descripcion?: string
          fecha?: string
          id?: string
          lead_id?: string | null
          oportunidad_id?: string | null
          persona_id?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "interacciones_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interacciones_oportunidad_id_fkey"
            columns: ["oportunidad_id"]
            isOneToOne: false
            referencedRelation: "oportunidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interacciones_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interacciones_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["persona_id"]
          },
        ]
      }
      leads: {
        Row: {
          apellido: string
          apellido_norm: string | null
          canal: string | null
          cargo: string | null
          created_at: string | null
          dni: string | null
          email: string | null
          empresa: string | null
          estado: string
          fecha_conversion: string | null
          fuente: string
          id: string
          motivo_descarte: string | null
          nivel_interes: string
          nombre: string
          nombre_norm: string | null
          notas: string | null
          persona_id: string | null
          productos_interes: string | null
          telefono: string | null
          updated_at: string | null
          usuario_id: string | null
        }
        Insert: {
          apellido: string
          apellido_norm?: string | null
          canal?: string | null
          cargo?: string | null
          created_at?: string | null
          dni?: string | null
          email?: string | null
          empresa?: string | null
          estado?: string
          fecha_conversion?: string | null
          fuente?: string
          id?: string
          motivo_descarte?: string | null
          nivel_interes?: string
          nombre: string
          nombre_norm?: string | null
          notas?: string | null
          persona_id?: string | null
          productos_interes?: string | null
          telefono?: string | null
          updated_at?: string | null
          usuario_id?: string | null
        }
        Update: {
          apellido?: string
          apellido_norm?: string | null
          canal?: string | null
          cargo?: string | null
          created_at?: string | null
          dni?: string | null
          email?: string | null
          empresa?: string | null
          estado?: string
          fecha_conversion?: string | null
          fuente?: string
          id?: string
          motivo_descarte?: string | null
          nivel_interes?: string
          nombre?: string
          nombre_norm?: string | null
          notas?: string | null
          persona_id?: string | null
          productos_interes?: string | null
          telefono?: string | null
          updated_at?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["persona_id"]
          },
          {
            foreignKeyName: "leads_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      licencias: {
        Row: {
          cargada_por_usuario_id: string | null
          cliente: string
          estado: string
          fecha_carga: string
          fecha_emision: string
          fecha_inicio: string
          fecha_vencimiento: string
          firma: string
          id: string
          instalacion_id: string
          notas: string | null
          payload_completo: Json
          plan: string
          razon_social: string | null
        }
        Insert: {
          cargada_por_usuario_id?: string | null
          cliente: string
          estado?: string
          fecha_carga?: string
          fecha_emision: string
          fecha_inicio: string
          fecha_vencimiento: string
          firma: string
          id?: string
          instalacion_id: string
          notas?: string | null
          payload_completo: Json
          plan: string
          razon_social?: string | null
        }
        Update: {
          cargada_por_usuario_id?: string | null
          cliente?: string
          estado?: string
          fecha_carga?: string
          fecha_emision?: string
          fecha_inicio?: string
          fecha_vencimiento?: string
          firma?: string
          id?: string
          instalacion_id?: string
          notas?: string | null
          payload_completo?: Json
          plan?: string
          razon_social?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "licencias_cargada_por_usuario_id_fkey"
            columns: ["cargada_por_usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios_perfil"
            referencedColumns: ["id"]
          },
        ]
      }
      migraciones_aplicadas: {
        Row: {
          fecha: string
          nombre: string
        }
        Insert: {
          fecha?: string
          nombre: string
        }
        Update: {
          fecha?: string
          nombre?: string
        }
        Relationships: []
      }
      notificaciones: {
        Row: {
          created_at: string
          descartada: boolean
          entidad_id: string | null
          entidad_tipo: string | null
          fecha_lectura: string | null
          generada_por: string
          id: string
          leida: boolean
          mensaje: string
          prioridad: string
          tipo: string
          titulo: string
          url: string | null
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          descartada?: boolean
          entidad_id?: string | null
          entidad_tipo?: string | null
          fecha_lectura?: string | null
          generada_por?: string
          id?: string
          leida?: boolean
          mensaje: string
          prioridad?: string
          tipo: string
          titulo: string
          url?: string | null
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          descartada?: boolean
          entidad_id?: string | null
          entidad_tipo?: string | null
          fecha_lectura?: string | null
          generada_por?: string
          id?: string
          leida?: boolean
          mensaje?: string
          prioridad?: string
          tipo?: string
          titulo?: string
          url?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notificaciones_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      oportunidades: {
        Row: {
          created_at: string | null
          descripcion: string | null
          estado: string
          fecha_estimada_cierre: string | null
          fecha_proximo_contacto: string | null
          fuente: string
          id: string
          monto_estimado: number | null
          motivo_perdida: string | null
          notas: string | null
          persona_id: string
          probabilidad_cierre: number | null
          tipo: string
          updated_at: string | null
          usuario_id: string | null
        }
        Insert: {
          created_at?: string | null
          descripcion?: string | null
          estado?: string
          fecha_estimada_cierre?: string | null
          fecha_proximo_contacto?: string | null
          fuente?: string
          id?: string
          monto_estimado?: number | null
          motivo_perdida?: string | null
          notas?: string | null
          persona_id: string
          probabilidad_cierre?: number | null
          tipo: string
          updated_at?: string | null
          usuario_id?: string | null
        }
        Update: {
          created_at?: string | null
          descripcion?: string | null
          estado?: string
          fecha_estimada_cierre?: string | null
          fecha_proximo_contacto?: string | null
          fuente?: string
          id?: string
          monto_estimado?: number | null
          motivo_perdida?: string | null
          notas?: string | null
          persona_id?: string
          probabilidad_cierre?: number | null
          tipo?: string
          updated_at?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oportunidades_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oportunidades_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["persona_id"]
          },
          {
            foreignKeyName: "oportunidades_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      pdf_procesamientos: {
        Row: {
          campos_dudosos: Json | null
          costo_estimado: number | null
          created_at: string | null
          datos_extraidos: Json | null
          endoso_creado_id: string | null
          error_mensaje: string | null
          estado: string
          id: string
          mapeos_catalogos: Json | null
          nombre_archivo: string
          poliza_creada_id: string | null
          poliza_origen_id: string | null
          ruta_temporal: string | null
          tamano_archivo: number | null
          tipo_operacion: string
          tokens_usados: number | null
          updated_at: string | null
          usuario_id: string | null
        }
        Insert: {
          campos_dudosos?: Json | null
          costo_estimado?: number | null
          created_at?: string | null
          datos_extraidos?: Json | null
          endoso_creado_id?: string | null
          error_mensaje?: string | null
          estado?: string
          id?: string
          mapeos_catalogos?: Json | null
          nombre_archivo: string
          poliza_creada_id?: string | null
          poliza_origen_id?: string | null
          ruta_temporal?: string | null
          tamano_archivo?: number | null
          tipo_operacion: string
          tokens_usados?: number | null
          updated_at?: string | null
          usuario_id?: string | null
        }
        Update: {
          campos_dudosos?: Json | null
          costo_estimado?: number | null
          created_at?: string | null
          datos_extraidos?: Json | null
          endoso_creado_id?: string | null
          error_mensaje?: string | null
          estado?: string
          id?: string
          mapeos_catalogos?: Json | null
          nombre_archivo?: string
          poliza_creada_id?: string | null
          poliza_origen_id?: string | null
          ruta_temporal?: string | null
          tamano_archivo?: number | null
          tipo_operacion?: string
          tokens_usados?: number | null
          updated_at?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pdf_procesamientos_endoso_creado_id_fkey"
            columns: ["endoso_creado_id"]
            isOneToOne: false
            referencedRelation: "endosos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdf_procesamientos_poliza_creada_id_fkey"
            columns: ["poliza_creada_id"]
            isOneToOne: false
            referencedRelation: "polizas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdf_procesamientos_poliza_creada_id_fkey"
            columns: ["poliza_creada_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_pendientes_renovar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdf_procesamientos_poliza_creada_id_fkey"
            columns: ["poliza_creada_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["poliza_id"]
          },
          {
            foreignKeyName: "pdf_procesamientos_poliza_origen_id_fkey"
            columns: ["poliza_origen_id"]
            isOneToOne: false
            referencedRelation: "polizas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdf_procesamientos_poliza_origen_id_fkey"
            columns: ["poliza_origen_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_pendientes_renovar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdf_procesamientos_poliza_origen_id_fkey"
            columns: ["poliza_origen_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["poliza_id"]
          },
          {
            foreignKeyName: "pdf_procesamientos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      persona_bitacora: {
        Row: {
          campos_modificados: Json | null
          created_at: string | null
          estado_anterior: string | null
          estado_nuevo: string | null
          id: string
          motivo: string | null
          observaciones: string | null
          persona_id: string
          tipo_evento: string
          usuario_id: string | null
        }
        Insert: {
          campos_modificados?: Json | null
          created_at?: string | null
          estado_anterior?: string | null
          estado_nuevo?: string | null
          id?: string
          motivo?: string | null
          observaciones?: string | null
          persona_id: string
          tipo_evento: string
          usuario_id?: string | null
        }
        Update: {
          campos_modificados?: Json | null
          created_at?: string | null
          estado_anterior?: string | null
          estado_nuevo?: string | null
          id?: string
          motivo?: string | null
          observaciones?: string | null
          persona_id?: string
          tipo_evento?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "persona_bitacora_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "persona_bitacora_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["persona_id"]
          },
          {
            foreignKeyName: "persona_bitacora_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      personas: {
        Row: {
          acepta_marketing: boolean
          apellido: string
          apellido_norm: string | null
          barrio: string | null
          calle: string | null
          canal_preferido: string | null
          codigo_postal: string | null
          created_at: string
          cuil_formateado: string | null
          datos_extra: Json
          deleted_at: string | null
          deleted_by_usuario_id: string | null
          dni_cuil: string
          email: string | null
          email_secundario: string | null
          estado: string
          fecha_alta: string
          fecha_baja: string | null
          id: string
          localidad: string | null
          nombre: string | null
          nombre_norm: string | null
          numero: string | null
          origen: string | null
          pais: string
          piso_depto: string | null
          provincia: string | null
          razon_social: string | null
          razon_social_norm: string | null
          segmento: string | null
          telefono: string | null
          telefono_secundario: string | null
          tipo_persona: string
          updated_at: string
          usuario_id: string | null
          whatsapp: string | null
        }
        Insert: {
          acepta_marketing?: boolean
          apellido: string
          apellido_norm?: string | null
          barrio?: string | null
          calle?: string | null
          canal_preferido?: string | null
          codigo_postal?: string | null
          created_at?: string
          cuil_formateado?: string | null
          datos_extra?: Json
          deleted_at?: string | null
          deleted_by_usuario_id?: string | null
          dni_cuil: string
          email?: string | null
          email_secundario?: string | null
          estado?: string
          fecha_alta?: string
          fecha_baja?: string | null
          id?: string
          localidad?: string | null
          nombre?: string | null
          nombre_norm?: string | null
          numero?: string | null
          origen?: string | null
          pais?: string
          piso_depto?: string | null
          provincia?: string | null
          razon_social?: string | null
          razon_social_norm?: string | null
          segmento?: string | null
          telefono?: string | null
          telefono_secundario?: string | null
          tipo_persona?: string
          updated_at?: string
          usuario_id?: string | null
          whatsapp?: string | null
        }
        Update: {
          acepta_marketing?: boolean
          apellido?: string
          apellido_norm?: string | null
          barrio?: string | null
          calle?: string | null
          canal_preferido?: string | null
          codigo_postal?: string | null
          created_at?: string
          cuil_formateado?: string | null
          datos_extra?: Json
          deleted_at?: string | null
          deleted_by_usuario_id?: string | null
          dni_cuil?: string
          email?: string | null
          email_secundario?: string | null
          estado?: string
          fecha_alta?: string
          fecha_baja?: string | null
          id?: string
          localidad?: string | null
          nombre?: string | null
          nombre_norm?: string | null
          numero?: string | null
          origen?: string | null
          pais?: string
          piso_depto?: string | null
          provincia?: string | null
          razon_social?: string | null
          razon_social_norm?: string | null
          segmento?: string | null
          telefono?: string | null
          telefono_secundario?: string | null
          tipo_persona?: string
          updated_at?: string
          usuario_id?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "personas_deleted_by_usuario_id_fkey"
            columns: ["deleted_by_usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      plantillas_email: {
        Row: {
          activa: boolean | null
          asunto: string | null
          asunto_default: string
          cierre: string | null
          cierre_default: string | null
          codigo: string
          contexto: string
          created_at: string | null
          cuerpo: string | null
          cuerpo_default: string | null
          descripcion: string | null
          editable: boolean
          es_sistema: boolean
          id: string
          nombre: string
          saludo: string | null
          saludo_default: string | null
          updated_at: string | null
          variables_disponibles: string[] | null
        }
        Insert: {
          activa?: boolean | null
          asunto?: string | null
          asunto_default: string
          cierre?: string | null
          cierre_default?: string | null
          codigo: string
          contexto: string
          created_at?: string | null
          cuerpo?: string | null
          cuerpo_default?: string | null
          descripcion?: string | null
          editable?: boolean
          es_sistema?: boolean
          id?: string
          nombre: string
          saludo?: string | null
          saludo_default?: string | null
          updated_at?: string | null
          variables_disponibles?: string[] | null
        }
        Update: {
          activa?: boolean | null
          asunto?: string | null
          asunto_default?: string
          cierre?: string | null
          cierre_default?: string | null
          codigo?: string
          contexto?: string
          created_at?: string | null
          cuerpo?: string | null
          cuerpo_default?: string | null
          descripcion?: string | null
          editable?: boolean
          es_sistema?: boolean
          id?: string
          nombre?: string
          saludo?: string | null
          saludo_default?: string | null
          updated_at?: string | null
          variables_disponibles?: string[] | null
        }
        Relationships: []
      }
      poliza_archivos: {
        Row: {
          categoria: string
          created_at: string | null
          endoso_id: string | null
          id: string
          mime_type: string | null
          nombre: string
          poliza_id: string
          ruta: string
          tamano: number | null
        }
        Insert: {
          categoria: string
          created_at?: string | null
          endoso_id?: string | null
          id?: string
          mime_type?: string | null
          nombre: string
          poliza_id: string
          ruta: string
          tamano?: number | null
        }
        Update: {
          categoria?: string
          created_at?: string | null
          endoso_id?: string | null
          id?: string
          mime_type?: string | null
          nombre?: string
          poliza_id?: string
          ruta?: string
          tamano?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_poliza_archivos_endoso"
            columns: ["endoso_id"]
            isOneToOne: false
            referencedRelation: "endosos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poliza_archivos_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "polizas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poliza_archivos_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_pendientes_renovar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poliza_archivos_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["poliza_id"]
          },
        ]
      }
      poliza_bitacora: {
        Row: {
          created_at: string | null
          estado_anterior: string | null
          estado_nuevo: string | null
          id: string
          motivo: string | null
          observaciones: string | null
          poliza_id: string
          tipo_evento: string
          usuario_id: string | null
        }
        Insert: {
          created_at?: string | null
          estado_anterior?: string | null
          estado_nuevo?: string | null
          id?: string
          motivo?: string | null
          observaciones?: string | null
          poliza_id: string
          tipo_evento: string
          usuario_id?: string | null
        }
        Update: {
          created_at?: string | null
          estado_anterior?: string | null
          estado_nuevo?: string | null
          id?: string
          motivo?: string | null
          observaciones?: string | null
          poliza_id?: string
          tipo_evento?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "poliza_bitacora_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "polizas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poliza_bitacora_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_pendientes_renovar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poliza_bitacora_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["poliza_id"]
          },
          {
            foreignKeyName: "poliza_bitacora_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      polizas: {
        Row: {
          asegurado_id: string
          cobertura_id: string | null
          compania_id: string | null
          created_at: string
          estado: string
          fecha_baja: string | null
          fecha_fin: string
          fecha_inicio: string
          fecha_renovacion: string | null
          id: string
          moneda: string
          motivo_baja: string | null
          notas: string | null
          numero_certificado: string | null
          numero_poliza: string
          observaciones: string | null
          observaciones_baja: string | null
          origen_creacion: string
          poliza_origen_id: string | null
          ramo_id: string | null
          refacturacion_id: string | null
          suma_asegurada: number | null
          tomador_id: string | null
          updated_at: string
          url_poliza_pdf: string | null
          vigencia_tipo_id: string | null
        }
        Insert: {
          asegurado_id: string
          cobertura_id?: string | null
          compania_id?: string | null
          created_at?: string
          estado?: string
          fecha_baja?: string | null
          fecha_fin: string
          fecha_inicio: string
          fecha_renovacion?: string | null
          id?: string
          moneda?: string
          motivo_baja?: string | null
          notas?: string | null
          numero_certificado?: string | null
          numero_poliza: string
          observaciones?: string | null
          observaciones_baja?: string | null
          origen_creacion?: string
          poliza_origen_id?: string | null
          ramo_id?: string | null
          refacturacion_id?: string | null
          suma_asegurada?: number | null
          tomador_id?: string | null
          updated_at?: string
          url_poliza_pdf?: string | null
          vigencia_tipo_id?: string | null
        }
        Update: {
          asegurado_id?: string
          cobertura_id?: string | null
          compania_id?: string | null
          created_at?: string
          estado?: string
          fecha_baja?: string | null
          fecha_fin?: string
          fecha_inicio?: string
          fecha_renovacion?: string | null
          id?: string
          moneda?: string
          motivo_baja?: string | null
          notas?: string | null
          numero_certificado?: string | null
          numero_poliza?: string
          observaciones?: string | null
          observaciones_baja?: string | null
          origen_creacion?: string
          poliza_origen_id?: string | null
          ramo_id?: string | null
          refacturacion_id?: string | null
          suma_asegurada?: number | null
          tomador_id?: string | null
          updated_at?: string
          url_poliza_pdf?: string | null
          vigencia_tipo_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_polizas_asegurado"
            columns: ["asegurado_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_polizas_asegurado"
            columns: ["asegurado_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["persona_id"]
          },
          {
            foreignKeyName: "fk_polizas_compania"
            columns: ["compania_id"]
            isOneToOne: false
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_polizas_origen"
            columns: ["poliza_origen_id"]
            isOneToOne: false
            referencedRelation: "polizas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_polizas_origen"
            columns: ["poliza_origen_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_pendientes_renovar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_polizas_origen"
            columns: ["poliza_origen_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["poliza_id"]
          },
          {
            foreignKeyName: "fk_polizas_ramo"
            columns: ["ramo_id"]
            isOneToOne: false
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_polizas_tomador"
            columns: ["tomador_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_polizas_tomador"
            columns: ["tomador_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["persona_id"]
          },
          {
            foreignKeyName: "polizas_cobertura_id_fkey"
            columns: ["cobertura_id"]
            isOneToOne: false
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polizas_refacturacion_id_fkey"
            columns: ["refacturacion_id"]
            isOneToOne: false
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polizas_vigencia_tipo_id_fkey"
            columns: ["vigencia_tipo_id"]
            isOneToOne: false
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
        ]
      }
      polizas_eliminadas: {
        Row: {
          asegurado_id: string | null
          asegurado_nombre: string | null
          cant_archivos: number | null
          cant_endosos: number | null
          cant_polizas_hijas: number | null
          cant_riesgos: number | null
          cant_siniestros: number | null
          compania_id: string | null
          compania_nombre: string | null
          eliminada_por_email: string | null
          eliminada_por_usuario_id: string | null
          estado: string | null
          fecha_eliminacion: string | null
          fecha_fin: string | null
          fecha_inicio: string | null
          id: string
          motivo: string | null
          numero_poliza: string
          poliza_id: string
          poliza_origen_id: string | null
          ramo_id: string | null
          ramo_nombre: string | null
        }
        Insert: {
          asegurado_id?: string | null
          asegurado_nombre?: string | null
          cant_archivos?: number | null
          cant_endosos?: number | null
          cant_polizas_hijas?: number | null
          cant_riesgos?: number | null
          cant_siniestros?: number | null
          compania_id?: string | null
          compania_nombre?: string | null
          eliminada_por_email?: string | null
          eliminada_por_usuario_id?: string | null
          estado?: string | null
          fecha_eliminacion?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          motivo?: string | null
          numero_poliza: string
          poliza_id: string
          poliza_origen_id?: string | null
          ramo_id?: string | null
          ramo_nombre?: string | null
        }
        Update: {
          asegurado_id?: string | null
          asegurado_nombre?: string | null
          cant_archivos?: number | null
          cant_endosos?: number | null
          cant_polizas_hijas?: number | null
          cant_riesgos?: number | null
          cant_siniestros?: number | null
          compania_id?: string | null
          compania_nombre?: string | null
          eliminada_por_email?: string | null
          eliminada_por_usuario_id?: string | null
          estado?: string | null
          fecha_eliminacion?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          motivo?: string | null
          numero_poliza?: string
          poliza_id?: string
          poliza_origen_id?: string | null
          ramo_id?: string | null
          ramo_nombre?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "polizas_eliminadas_eliminada_por_usuario_id_fkey"
            columns: ["eliminada_por_usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_cliente_accesos: {
        Row: {
          creado_por_usuario_id: string | null
          fecha_creacion: string | null
          fecha_revocacion: string | null
          id: string
          motivo_revocacion: string | null
          persona_id: string
          revocado: boolean | null
          token_hash: string
          ultimo_acceso: string | null
          ultimo_ip: string | null
          veces_accedido: number | null
        }
        Insert: {
          creado_por_usuario_id?: string | null
          fecha_creacion?: string | null
          fecha_revocacion?: string | null
          id?: string
          motivo_revocacion?: string | null
          persona_id: string
          revocado?: boolean | null
          token_hash: string
          ultimo_acceso?: string | null
          ultimo_ip?: string | null
          veces_accedido?: number | null
        }
        Update: {
          creado_por_usuario_id?: string | null
          fecha_creacion?: string | null
          fecha_revocacion?: string | null
          id?: string
          motivo_revocacion?: string | null
          persona_id?: string
          revocado?: boolean | null
          token_hash?: string
          ultimo_acceso?: string | null
          ultimo_ip?: string | null
          veces_accedido?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_cliente_accesos_creado_por_usuario_id_fkey"
            columns: ["creado_por_usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_cliente_accesos_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_cliente_accesos_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["persona_id"]
          },
        ]
      }
      postits: {
        Row: {
          color: string
          compartido: boolean | null
          created_at: string | null
          id: string
          texto: string
          updated_at: string | null
          usuario_id: string
        }
        Insert: {
          color?: string
          compartido?: boolean | null
          created_at?: string | null
          id?: string
          texto: string
          updated_at?: string | null
          usuario_id: string
        }
        Update: {
          color?: string
          compartido?: boolean | null
          created_at?: string | null
          id?: string
          texto?: string
          updated_at?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "postits_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_buckets: {
        Row: {
          count: number | null
          endpoint: string
          id: string
          identifier: string
          reset_at: string
        }
        Insert: {
          count?: number | null
          endpoint: string
          id?: string
          identifier: string
          reset_at: string
        }
        Update: {
          count?: number | null
          endpoint?: string
          id?: string
          identifier?: string
          reset_at?: string
        }
        Relationships: []
      }
      restauraciones: {
        Row: {
          backup_id: string | null
          crear_pre_backup: boolean | null
          created_at: string | null
          duracion_segundos: number | null
          error_mensaje: string | null
          estado: string
          fecha_fin: string | null
          fecha_inicio: string | null
          fuente: string
          id: string
          ip_origen: string | null
          log_completo: string | null
          mensaje_progreso: string | null
          metadata_backup: Json | null
          nombre_archivo: string | null
          paso_actual: number | null
          porcentaje: number | null
          pre_backup_id: string | null
          restaura_db: boolean | null
          restaura_storage: boolean | null
          tamano_archivo_bytes: number | null
          total_pasos: number | null
          user_agent: string | null
          usuario_id: string | null
          work_dir: string | null
        }
        Insert: {
          backup_id?: string | null
          crear_pre_backup?: boolean | null
          created_at?: string | null
          duracion_segundos?: number | null
          error_mensaje?: string | null
          estado?: string
          fecha_fin?: string | null
          fecha_inicio?: string | null
          fuente: string
          id?: string
          ip_origen?: string | null
          log_completo?: string | null
          mensaje_progreso?: string | null
          metadata_backup?: Json | null
          nombre_archivo?: string | null
          paso_actual?: number | null
          porcentaje?: number | null
          pre_backup_id?: string | null
          restaura_db?: boolean | null
          restaura_storage?: boolean | null
          tamano_archivo_bytes?: number | null
          total_pasos?: number | null
          user_agent?: string | null
          usuario_id?: string | null
          work_dir?: string | null
        }
        Update: {
          backup_id?: string | null
          crear_pre_backup?: boolean | null
          created_at?: string | null
          duracion_segundos?: number | null
          error_mensaje?: string | null
          estado?: string
          fecha_fin?: string | null
          fecha_inicio?: string | null
          fuente?: string
          id?: string
          ip_origen?: string | null
          log_completo?: string | null
          mensaje_progreso?: string | null
          metadata_backup?: Json | null
          nombre_archivo?: string | null
          paso_actual?: number | null
          porcentaje?: number | null
          pre_backup_id?: string | null
          restaura_db?: boolean | null
          restaura_storage?: boolean | null
          tamano_archivo_bytes?: number | null
          total_pasos?: number | null
          user_agent?: string | null
          usuario_id?: string | null
          work_dir?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restauraciones_backup_id_fkey"
            columns: ["backup_id"]
            isOneToOne: false
            referencedRelation: "backups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restauraciones_pre_backup_id_fkey"
            columns: ["pre_backup_id"]
            isOneToOne: false
            referencedRelation: "backups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restauraciones_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      riesgos: {
        Row: {
          activo: boolean
          created_at: string
          descripcion_corta: string | null
          detalle_tecnico: Json
          id: string
          numero_item: number
          poliza_id: string
          suma_asegurada: number | null
          tipo_riesgo: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          descripcion_corta?: string | null
          detalle_tecnico?: Json
          id?: string
          numero_item?: number
          poliza_id: string
          suma_asegurada?: number | null
          tipo_riesgo: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          descripcion_corta?: string | null
          detalle_tecnico?: Json
          id?: string
          numero_item?: number
          poliza_id?: string
          suma_asegurada?: number | null
          tipo_riesgo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "riesgos_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "polizas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "riesgos_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_pendientes_renovar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "riesgos_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["poliza_id"]
          },
        ]
      }
      sesiones: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          token: string
          usuario_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          token: string
          usuario_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          token?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sesiones_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      siniestro_archivos: {
        Row: {
          categoria: string
          created_at: string
          id: string
          mime_type: string | null
          nombre: string
          ruta: string
          siniestro_id: string
          tamano: number | null
        }
        Insert: {
          categoria: string
          created_at?: string
          id?: string
          mime_type?: string | null
          nombre: string
          ruta: string
          siniestro_id: string
          tamano?: number | null
        }
        Update: {
          categoria?: string
          created_at?: string
          id?: string
          mime_type?: string | null
          nombre?: string
          ruta?: string
          siniestro_id?: string
          tamano?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "siniestro_archivos_siniestro_id_fkey"
            columns: ["siniestro_id"]
            isOneToOne: false
            referencedRelation: "siniestros"
            referencedColumns: ["id"]
          },
        ]
      }
      siniestro_bitacora: {
        Row: {
          campos_modificados: Json | null
          created_at: string | null
          estado_anterior: string | null
          estado_nuevo: string | null
          id: string
          monto_actualizado: number | null
          siniestro_id: string
          texto: string | null
          tipo: string
          usuario_id: string | null
        }
        Insert: {
          campos_modificados?: Json | null
          created_at?: string | null
          estado_anterior?: string | null
          estado_nuevo?: string | null
          id?: string
          monto_actualizado?: number | null
          siniestro_id: string
          texto?: string | null
          tipo?: string
          usuario_id?: string | null
        }
        Update: {
          campos_modificados?: Json | null
          created_at?: string | null
          estado_anterior?: string | null
          estado_nuevo?: string | null
          id?: string
          monto_actualizado?: number | null
          siniestro_id?: string
          texto?: string | null
          tipo?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "siniestro_bitacora_siniestro_id_fkey"
            columns: ["siniestro_id"]
            isOneToOne: false
            referencedRelation: "siniestros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "siniestro_bitacora_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      siniestros: {
        Row: {
          created_at: string
          deleted_at: string | null
          deleted_by_usuario_id: string | null
          descripcion: string
          detalle_siniestro: Json | null
          estado: string
          fecha_cierre: string | null
          fecha_denuncia: string
          fecha_ocurrencia: string
          fecha_ultimo_movimiento: string
          franquicia_aplicada: number | null
          hora_siniestro: string | null
          id: string
          localidad_siniestro: string | null
          lugar_siniestro: string | null
          monto_cobrado: number | null
          monto_estimado: number | null
          monto_liquidado: number | null
          motivo_rechazo: string | null
          notas: string | null
          numero_caso: string | null
          numero_siniestro: string | null
          persona_id: string
          poliza_id: string
          riesgo_id: string | null
          tercero_dni: string | null
          tercero_nombre: string | null
          tercero_patente: string | null
          tercero_telefono: string | null
          tipo_siniestro: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          deleted_by_usuario_id?: string | null
          descripcion: string
          detalle_siniestro?: Json | null
          estado?: string
          fecha_cierre?: string | null
          fecha_denuncia?: string
          fecha_ocurrencia: string
          fecha_ultimo_movimiento?: string
          franquicia_aplicada?: number | null
          hora_siniestro?: string | null
          id?: string
          localidad_siniestro?: string | null
          lugar_siniestro?: string | null
          monto_cobrado?: number | null
          monto_estimado?: number | null
          monto_liquidado?: number | null
          motivo_rechazo?: string | null
          notas?: string | null
          numero_caso?: string | null
          numero_siniestro?: string | null
          persona_id: string
          poliza_id: string
          riesgo_id?: string | null
          tercero_dni?: string | null
          tercero_nombre?: string | null
          tercero_patente?: string | null
          tercero_telefono?: string | null
          tipo_siniestro?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          deleted_by_usuario_id?: string | null
          descripcion?: string
          detalle_siniestro?: Json | null
          estado?: string
          fecha_cierre?: string | null
          fecha_denuncia?: string
          fecha_ocurrencia?: string
          fecha_ultimo_movimiento?: string
          franquicia_aplicada?: number | null
          hora_siniestro?: string | null
          id?: string
          localidad_siniestro?: string | null
          lugar_siniestro?: string | null
          monto_cobrado?: number | null
          monto_estimado?: number | null
          monto_liquidado?: number | null
          motivo_rechazo?: string | null
          notas?: string | null
          numero_caso?: string | null
          numero_siniestro?: string | null
          persona_id?: string
          poliza_id?: string
          riesgo_id?: string | null
          tercero_dni?: string | null
          tercero_nombre?: string | null
          tercero_patente?: string | null
          tercero_telefono?: string | null
          tipo_siniestro?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_siniestros_persona"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_siniestros_persona"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["persona_id"]
          },
          {
            foreignKeyName: "fk_siniestros_poliza"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "polizas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_siniestros_poliza"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_pendientes_renovar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_siniestros_poliza"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["poliza_id"]
          },
          {
            foreignKeyName: "siniestros_deleted_by_usuario_id_fkey"
            columns: ["deleted_by_usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "siniestros_riesgo_id_fkey"
            columns: ["riesgo_id"]
            isOneToOne: false
            referencedRelation: "riesgos"
            referencedColumns: ["id"]
          },
        ]
      }
      siniestros_contador: {
        Row: {
          anio: number
          ultimo_numero: number
          updated_at: string | null
        }
        Insert: {
          anio: number
          ultimo_numero?: number
          updated_at?: string | null
        }
        Update: {
          anio?: number
          ultimo_numero?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      solicitudes_blanqueo_password: {
        Row: {
          created_at: string
          estado: string
          fecha_consumo: string | null
          fecha_habilitacion: string | null
          fecha_rechazo: string | null
          habilitada_por_admin_id: string | null
          id: string
          ip_origen: unknown
          motivo_rechazo: string | null
          token_expira_at: string | null
          token_hash: string | null
          updated_at: string
          user_agent: string | null
          usuario_id: string
        }
        Insert: {
          created_at?: string
          estado?: string
          fecha_consumo?: string | null
          fecha_habilitacion?: string | null
          fecha_rechazo?: string | null
          habilitada_por_admin_id?: string | null
          id?: string
          ip_origen?: unknown
          motivo_rechazo?: string | null
          token_expira_at?: string | null
          token_hash?: string | null
          updated_at?: string
          user_agent?: string | null
          usuario_id: string
        }
        Update: {
          created_at?: string
          estado?: string
          fecha_consumo?: string | null
          fecha_habilitacion?: string | null
          fecha_rechazo?: string | null
          habilitada_por_admin_id?: string | null
          id?: string
          ip_origen?: unknown
          motivo_rechazo?: string | null
          token_expira_at?: string | null
          token_hash?: string | null
          updated_at?: string
          user_agent?: string | null
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "solicitudes_blanqueo_password_habilitada_por_admin_id_fkey"
            columns: ["habilitada_por_admin_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_blanqueo_password_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_tokens: {
        Row: {
          contexto: string | null
          creado_por_usuario_id: string | null
          fecha_creacion: string | null
          fecha_expiracion: string
          id: string
          max_usos: number | null
          ruta_archivo: string
          token: string
          veces_usado: number | null
        }
        Insert: {
          contexto?: string | null
          creado_por_usuario_id?: string | null
          fecha_creacion?: string | null
          fecha_expiracion: string
          id?: string
          max_usos?: number | null
          ruta_archivo: string
          token: string
          veces_usado?: number | null
        }
        Update: {
          contexto?: string | null
          creado_por_usuario_id?: string | null
          fecha_creacion?: string | null
          fecha_expiracion?: string
          id?: string
          max_usos?: number | null
          ruta_archivo?: string
          token?: string
          veces_usado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "storage_tokens_creado_por_usuario_id_fkey"
            columns: ["creado_por_usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      tareas: {
        Row: {
          cotizacion_id: string | null
          created_at: string
          descripcion: string | null
          estado: string
          fecha_vencimiento: string
          hora_vencimiento: string | null
          id: string
          lead_id: string | null
          nota_cierre: string | null
          oportunidad_id: string | null
          persona_id: string
          poliza_id: string | null
          prioridad: string
          recurrencia: string
          siniestro_id: string | null
          tipo: string
          titulo: string
          usuario_id: string | null
        }
        Insert: {
          cotizacion_id?: string | null
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_vencimiento: string
          hora_vencimiento?: string | null
          id?: string
          lead_id?: string | null
          nota_cierre?: string | null
          oportunidad_id?: string | null
          persona_id: string
          poliza_id?: string | null
          prioridad?: string
          recurrencia?: string
          siniestro_id?: string | null
          tipo?: string
          titulo: string
          usuario_id?: string | null
        }
        Update: {
          cotizacion_id?: string | null
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_vencimiento?: string
          hora_vencimiento?: string | null
          id?: string
          lead_id?: string | null
          nota_cierre?: string | null
          oportunidad_id?: string | null
          persona_id?: string
          poliza_id?: string | null
          prioridad?: string
          recurrencia?: string
          siniestro_id?: string | null
          tipo?: string
          titulo?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tareas_cotizacion_id_fkey"
            columns: ["cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tareas_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tareas_oportunidad_id_fkey"
            columns: ["oportunidad_id"]
            isOneToOne: false
            referencedRelation: "oportunidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tareas_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tareas_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["persona_id"]
          },
          {
            foreignKeyName: "tareas_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "polizas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tareas_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_pendientes_renovar"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tareas_poliza_id_fkey"
            columns: ["poliza_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["poliza_id"]
          },
          {
            foreignKeyName: "tareas_siniestro_id_fkey"
            columns: ["siniestro_id"]
            isOneToOne: false
            referencedRelation: "siniestros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tareas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      telefonos_asistencia_companias: {
        Row: {
          compania_id: string
          created_at: string | null
          id: string
          nombre_boton: string | null
          telefono: string
          updated_at: string | null
          visible_en_portal: boolean | null
        }
        Insert: {
          compania_id: string
          created_at?: string | null
          id?: string
          nombre_boton?: string | null
          telefono: string
          updated_at?: string | null
          visible_en_portal?: boolean | null
        }
        Update: {
          compania_id?: string
          created_at?: string | null
          id?: string
          nombre_boton?: string | null
          telefono?: string
          updated_at?: string | null
          visible_en_portal?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "telefonos_asistencia_companias_compania_id_fkey"
            columns: ["compania_id"]
            isOneToOne: true
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
        ]
      }
      tipo_catalogo: {
        Row: {
          codigo: string
          descripcion: string
          id: number
        }
        Insert: {
          codigo: string
          descripcion: string
          id?: number
        }
        Update: {
          codigo?: string
          descripcion?: string
          id?: number
        }
        Relationships: []
      }
      usuarios: {
        Row: {
          acceso_cartera: string
          activo: boolean | null
          apellido: string
          bloqueado_hasta: string | null
          created_at: string | null
          email: string
          id: string
          intentos_fallidos: number | null
          nombre: string
          password_hash: string
          rol: string
          ultimo_acceso: string | null
          updated_at: string | null
        }
        Insert: {
          acceso_cartera?: string
          activo?: boolean | null
          apellido: string
          bloqueado_hasta?: string | null
          created_at?: string | null
          email: string
          id?: string
          intentos_fallidos?: number | null
          nombre: string
          password_hash: string
          rol?: string
          ultimo_acceso?: string | null
          updated_at?: string | null
        }
        Update: {
          acceso_cartera?: string
          activo?: boolean | null
          apellido?: string
          bloqueado_hasta?: string | null
          created_at?: string | null
          email?: string
          id?: string
          intentos_fallidos?: number | null
          nombre?: string
          password_hash?: string
          rol?: string
          ultimo_acceso?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      usuarios_perfil: {
        Row: {
          acceso_cartera: string
          activo: boolean | null
          apellido: string
          bloqueado_hasta: string | null
          created_at: string | null
          id: string
          intentos_fallidos: number | null
          nombre: string
          rol: string
          ultimo_acceso: string | null
          updated_at: string | null
        }
        Insert: {
          acceso_cartera?: string
          activo?: boolean | null
          apellido: string
          bloqueado_hasta?: string | null
          created_at?: string | null
          id: string
          intentos_fallidos?: number | null
          nombre: string
          rol?: string
          ultimo_acceso?: string | null
          updated_at?: string | null
        }
        Update: {
          acceso_cartera?: string
          activo?: boolean | null
          apellido?: string
          bloqueado_hasta?: string | null
          created_at?: string | null
          id?: string
          intentos_fallidos?: number | null
          nombre?: string
          rol?: string
          ultimo_acceso?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      v_polizas_pendientes_renovar: {
        Row: {
          asegurado_id: string | null
          categoria_renovacion: string | null
          cobertura_id: string | null
          compania_id: string | null
          dias_hasta_fin: number | null
          estado: string | null
          fecha_fin: string | null
          fecha_inicio: string | null
          id: string | null
          numero_poliza: string | null
          ramo_id: string | null
          tiene_renovacion_activa: boolean | null
        }
        Insert: {
          asegurado_id?: string | null
          categoria_renovacion?: never
          cobertura_id?: string | null
          compania_id?: string | null
          dias_hasta_fin?: never
          estado?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string | null
          numero_poliza?: string | null
          ramo_id?: string | null
          tiene_renovacion_activa?: never
        }
        Update: {
          asegurado_id?: string | null
          categoria_renovacion?: never
          cobertura_id?: string | null
          compania_id?: string | null
          dias_hasta_fin?: never
          estado?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string | null
          numero_poliza?: string | null
          ramo_id?: string | null
          tiene_renovacion_activa?: never
        }
        Relationships: [
          {
            foreignKeyName: "fk_polizas_asegurado"
            columns: ["asegurado_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_polizas_asegurado"
            columns: ["asegurado_id"]
            isOneToOne: false
            referencedRelation: "v_polizas_por_vencer"
            referencedColumns: ["persona_id"]
          },
          {
            foreignKeyName: "fk_polizas_compania"
            columns: ["compania_id"]
            isOneToOne: false
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_polizas_ramo"
            columns: ["ramo_id"]
            isOneToOne: false
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "polizas_cobertura_id_fkey"
            columns: ["cobertura_id"]
            isOneToOne: false
            referencedRelation: "catalogos"
            referencedColumns: ["id"]
          },
        ]
      }
      v_polizas_por_vencer: {
        Row: {
          compania: string | null
          dias_restantes: number | null
          dni_cuil: string | null
          email: string | null
          estado_poliza: string | null
          fecha_fin: string | null
          nombre_completo: string | null
          numero_poliza: string | null
          persona_id: string | null
          poliza_id: string | null
          prioridad_alerta: string | null
          ramo: string | null
          telefono: string | null
          whatsapp: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      actualizar_estados_polizas: { Args: never; Returns: undefined }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      fn_acceso_cartera_actual: { Args: never; Returns: string }
      fn_acceso_total_actual: { Args: never; Returns: boolean }
      fn_cambiar_email: {
        Args: { p_nuevo_email: string; p_usuario_id: string }
        Returns: undefined
      }
      fn_es_admin_actual: { Args: never; Returns: boolean }
      fn_invalidar_todas_sesiones_auth: { Args: never; Returns: undefined }
      fn_obtener_perfil_por_email: {
        Args: { p_email: string }
        Returns: {
          acceso_cartera: string
          activo: boolean
          apellido: string
          bloqueado_hasta: string
          email: string
          id: string
          intentos_fallidos: number
          nombre: string
          rol: string
        }[]
      }
      fn_rol_actual: { Args: never; Returns: string }
      fn_setear_password_directo: {
        Args: { p_password_hash: string; p_usuario_id: string }
        Returns: undefined
      }
      generar_numero_caso: { Args: { prefijo: string }; Returns: string }
      generar_numero_endoso: { Args: { p_poliza_id: string }; Returns: number }
      immutable_unaccent: { Args: { "": string }; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

