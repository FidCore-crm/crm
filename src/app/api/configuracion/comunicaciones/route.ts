import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth
  try {
    const supabase = getSupabaseAdmin()

    const { data, error } = await supabase
      .from('configuracion_comunicaciones')
      .select('*')
      .limit(1)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ ok: false, error: 'Error al obtener los datos' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, configuracion: data })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Error interno del servidor' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth
  try {
    const supabase = getSupabaseAdmin()
    const body = await request.json()

    // Si se intenta activar, verificar SMTP
    if (body.activo === true || body.envio_automatico_renovaciones === true) {
      const { data: correos } = await supabase
        .from('configuracion_correos')
        .select('configurado')
        .limit(1)
        .maybeSingle()

      if (!correos || !(correos as any).configurado) {
        return NextResponse.json(
          { ok: false, error: 'Configurá primero el sistema de correos antes de activar las comunicaciones' },
          { status: 400 }
        )
      }
    }

    // Validar límite diario
    if (body.limite_diario !== undefined) {
      const limite = Number(body.limite_diario)
      if (isNaN(limite) || limite < 1 || limite > 10000) {
        return NextResponse.json(
          { ok: false, error: 'El límite diario debe estar entre 1 y 10000' },
          { status: 400 }
        )
      }
      body.limite_diario = limite
    }

    // Validar delay
    if (body.delay_entre_envios_ms !== undefined) {
      const delay = Number(body.delay_entre_envios_ms)
      if (isNaN(delay) || delay < 0 || delay > 60000) {
        return NextResponse.json(
          { ok: false, error: 'El delay debe estar entre 0 y 60000 ms' },
          { status: 400 }
        )
      }
      body.delay_entre_envios_ms = delay
    }

    // Validar nuevos campos avanzados
    const validarRango = (v: any, min: number, max: number, nombre: string) => {
      const n = Number(v)
      if (isNaN(n) || n < min || n > max) {
        return `${nombre} debe estar entre ${min} y ${max}`
      }
      return null
    }

    if (body.delay_entre_envios_automaticos_seg !== undefined) {
      const err = validarRango(body.delay_entre_envios_automaticos_seg, 0, 300, 'El delay entre emails automáticos')
      if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 })
      body.delay_entre_envios_automaticos_seg = Number(body.delay_entre_envios_automaticos_seg)
    }
    if (body.max_adjuntos_mb !== undefined) {
      const err = validarRango(body.max_adjuntos_mb, 1, 25, 'El tamaño máximo de adjuntos')
      if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 })
      body.max_adjuntos_mb = Number(body.max_adjuntos_mb)
    }
    if (body.retener_completo_dias !== undefined) {
      const err = validarRango(body.retener_completo_dias, 7, 3650, 'Conservar historial completo (días)')
      if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 })
      body.retener_completo_dias = Number(body.retener_completo_dias)
    }
    if (body.retener_metadata_meses !== undefined) {
      const err = validarRango(body.retener_metadata_meses, 1, 120, 'Conservar metadata (meses)')
      if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 })
      body.retener_metadata_meses = Number(body.retener_metadata_meses)
    }
    if (body.eliminar_despues_meses !== undefined) {
      const err = validarRango(body.eliminar_despues_meses, 3, 240, 'Eliminar completamente (meses)')
      if (err) return NextResponse.json({ ok: false, error: err }, { status: 400 })
      body.eliminar_despues_meses = Number(body.eliminar_despues_meses)
    }

    // Validar consistencia cuando se reciben los 3 valores (cargamos los que
    // falten desde la fila actual para comparar).
    const afectaRetencion =
      body.retener_completo_dias !== undefined ||
      body.retener_metadata_meses !== undefined ||
      body.eliminar_despues_meses !== undefined

    if (afectaRetencion) {
      const { data: actual } = await supabase
        .from('configuracion_comunicaciones')
        .select('retener_completo_dias, retener_metadata_meses, eliminar_despues_meses')
        .limit(1)
        .maybeSingle()
      const a = (actual as any) || {}
      const diasCompleto = body.retener_completo_dias ?? a.retener_completo_dias ?? 90
      const mesesMetadata = body.retener_metadata_meses ?? a.retener_metadata_meses ?? 6
      const mesesEliminar = body.eliminar_despues_meses ?? a.eliminar_despues_meses ?? 12

      if (!(diasCompleto < mesesMetadata * 30 && mesesMetadata * 30 < mesesEliminar * 30)) {
        return NextResponse.json(
          {
            ok: false,
            error:
              'Los valores de retención son inconsistentes: el período completo (días) debe ser menor al de metadata (meses × 30), y éste menor al de eliminación.',
          },
          { status: 400 },
        )
      }
    }

    // Campos permitidos
    const campos: Record<string, any> = {}
    if (body.activo !== undefined) campos.activo = body.activo
    if (body.envio_automatico_renovaciones !== undefined) campos.envio_automatico_renovaciones = body.envio_automatico_renovaciones
    if (body.envio_automatico_bienvenida_poliza !== undefined) campos.envio_automatico_bienvenida_poliza = body.envio_automatico_bienvenida_poliza
    if (body.envio_automatico_bienvenida_cliente !== undefined) campos.envio_automatico_bienvenida_cliente = body.envio_automatico_bienvenida_cliente
    if (body.envio_automatico_portal_cliente !== undefined) campos.envio_automatico_portal_cliente = body.envio_automatico_portal_cliente
    if (body.adjuntar_docs_renovacion !== undefined) campos.adjuntar_docs_renovacion = body.adjuntar_docs_renovacion
    if (body.limite_diario !== undefined) campos.limite_diario = body.limite_diario
    if (body.delay_entre_envios_ms !== undefined) campos.delay_entre_envios_ms = body.delay_entre_envios_ms
    if (body.delay_entre_envios_automaticos_seg !== undefined) campos.delay_entre_envios_automaticos_seg = body.delay_entre_envios_automaticos_seg
    if (body.max_adjuntos_mb !== undefined) campos.max_adjuntos_mb = body.max_adjuntos_mb
    if (body.retener_completo_dias !== undefined) campos.retener_completo_dias = body.retener_completo_dias
    if (body.retener_metadata_meses !== undefined) campos.retener_metadata_meses = body.retener_metadata_meses
    if (body.eliminar_despues_meses !== undefined) campos.eliminar_despues_meses = body.eliminar_despues_meses
    if (body.notificar_admin_eventos_informativos !== undefined) {
      campos.notificar_admin_eventos_informativos = body.notificar_admin_eventos_informativos === true
    }
    // Toggles granulares al admin (migración 071) — reemplazan al global
    if (body.notificar_admin_backup_completado !== undefined)
      campos.notificar_admin_backup_completado = body.notificar_admin_backup_completado === true
    if (body.notificar_admin_restauracion_iniciada !== undefined)
      campos.notificar_admin_restauracion_iniciada = body.notificar_admin_restauracion_iniciada === true
    if (body.notificar_admin_restauracion_completada !== undefined)
      campos.notificar_admin_restauracion_completada = body.notificar_admin_restauracion_completada === true
    if (body.notificar_admin_pdf_procesado !== undefined)
      campos.notificar_admin_pdf_procesado = body.notificar_admin_pdf_procesado === true
    if (body.notificar_admin_pdf_fallido !== undefined)
      campos.notificar_admin_pdf_fallido = body.notificar_admin_pdf_fallido === true
    if (body.notificar_admin_email_automatico_fallido !== undefined)
      campos.notificar_admin_email_automatico_fallido = body.notificar_admin_email_automatico_fallido === true
    // Toggles para el formulario público de denuncia
    if (body.envio_automatico_denuncia_publica_cliente !== undefined)
      campos.envio_automatico_denuncia_publica_cliente = body.envio_automatico_denuncia_publica_cliente === true
    if (body.envio_automatico_denuncia_publica_pas !== undefined)
      campos.envio_automatico_denuncia_publica_pas = body.envio_automatico_denuncia_publica_pas === true

    campos.updated_at = new Date().toISOString()

    // Obtener ID del singleton
    const { data: existente } = await supabase
      .from('configuracion_comunicaciones')
      .select('id')
      .limit(1)
      .maybeSingle()

    if (!existente) {
      return NextResponse.json({ ok: false, error: 'No se encontró la configuración' }, { status: 500 })
    }

    const { data, error } = await supabase
      .from('configuracion_comunicaciones')
      .update(campos)
      .eq('id', (existente as any).id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ ok: false, error: 'Error al actualizar los datos' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, configuracion: data })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Error interno del servidor' }, { status: 500 })
  }
}
