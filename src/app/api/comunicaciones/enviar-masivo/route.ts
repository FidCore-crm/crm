import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { encolarEmail } from '@/lib/comunicaciones-sender'
import { obtenerVariablesOrganizacion } from '@/lib/email-variables'
import { checkLicenciaActiva } from '@/lib/licencia-guard'
import { logger } from '@/lib/errores'
import * as fs from 'fs'
import * as path from 'path'

/**
 * POST /api/comunicaciones/enviar-masivo (v1.0.179 — async)
 *
 * Antes: procesaba los N envíos en el request HTTP con delay entre cada uno.
 * Con 100 destinatarios el modal del PAS quedaba bloqueado 3-5 minutos.
 *
 * Ahora: crea la campaña padre + N filas `ENCOLADO` en email_envios y
 * responde en < 1s. El cron `enviar-emails-encolados` procesa la cola en
 * background respetando el delay entre envíos configurado.
 *
 * Adjuntos: se guardan en `storage/campanas/{id}/` (bind mount permanente),
 * NO en `/tmp/`. Sino se perderían al terminar el request o durante envíos
 * programados a futuro. Se limpian al pasar N días de estado COMPLETADA.
 *
 * Body (multipart form-data):
 *   - plantilla_codigo (req)
 *   - persona_ids (req, JSON array)
 *   - asunto (opt) — sino usa el de la plantilla
 *   - campos_editables (opt, JSON) — {titulo, cuerpo, cta_texto, cta_url}
 *   - archivos (opt) — files
 *   - programada_para (opt, ISO) — si viene, encola con enviar_despues_de = esa fecha
 */
export async function POST(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }
  if (usuario.rol !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Solo administradores pueden hacer envíos masivos' }, { status: 403 })
  }

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  try {
    const supabase = getSupabaseAdmin()
    const formData = await request.formData()

    const plantilla_codigo = formData.get('plantilla_codigo') as string
    const persona_ids_raw = formData.get('persona_ids') as string
    const campos_editables_raw = formData.get('campos_editables') as string
    const programada_para_raw = formData.get('programada_para') as string | null
    const campos_editables = campos_editables_raw ? JSON.parse(campos_editables_raw) : {}
    const persona_ids: string[] = persona_ids_raw ? JSON.parse(persona_ids_raw) : []

    if (!plantilla_codigo) {
      return NextResponse.json({ ok: false, error: 'Falta plantilla_codigo' }, { status: 400 })
    }
    if (!persona_ids.length) {
      return NextResponse.json({ ok: false, error: 'No hay destinatarios' }, { status: 400 })
    }
    if (persona_ids.length > 1000) {
      return NextResponse.json({ ok: false, error: 'Máximo 1000 destinatarios por envío' }, { status: 400 })
    }

    // Validar programada_para (opcional). Debe ser al menos 1 min en el futuro.
    let programadaPara: Date | null = null
    if (programada_para_raw) {
      const parsed = new Date(programada_para_raw)
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ ok: false, error: 'programada_para inválida' }, { status: 400 })
      }
      if (parsed.getTime() < Date.now() + 60_000) {
        return NextResponse.json({ ok: false, error: 'La fecha programada debe ser al menos 1 minuto en el futuro' }, { status: 400 })
      }
      programadaPara = parsed
    }

    // Verificar sistema activo
    const { data: comConfig } = await supabase
      .from('configuracion_comunicaciones')
      .select('activo, limite_diario')
      .limit(1)
      .maybeSingle()

    const config = comConfig as any
    if (!config?.activo) {
      return NextResponse.json(
        { ok: false, error: 'El sistema de comunicaciones no está activo.' },
        { status: 400 }
      )
    }

    // Obtener personas
    const { data: personas } = await supabase
      .from('personas')
      .select('id, nombre, apellido, razon_social, email, acepta_marketing')
      .in('id', persona_ids)

    if (!personas || personas.length === 0) {
      return NextResponse.json({ ok: false, error: 'No se encontraron personas' }, { status: 400 })
    }

    const personasArr = personas as any[]
    const personaIdsUnicos = personasArr.map(p => p.id)

    // ── Crear campaña padre PRIMERO — necesitamos su ID para la carpeta de adjuntos ──
    const asuntoParaCampana = (formData.get('asunto') as string) || plantilla_codigo
    const nombreCampana = `Envío masivo — ${asuntoParaCampana}`.slice(0, 200)
    const estadoInicial = programadaPara ? 'PROGRAMADA' : 'EJECUTANDO'
    const { data: campanaData, error: campanaError } = await (supabase.from('mailing_campanas') as any)
      .insert({
        nombre: nombreCampana,
        descripcion: `Envío masivo iniciado desde ${plantilla_codigo}.`,
        personas_ids: personaIdsUnicos,
        asunto_libre: asuntoParaCampana,
        cuerpo_libre: campos_editables?.cuerpo || '(envío masivo desde ficha/listado)',
        estado: estadoInicial,
        tipo: 'ENVIO_MASIVO',
        total_destinatarios: personasArr.length,
        programada_para: programadaPara?.toISOString() ?? null,
        fecha_inicio_ejecucion: programadaPara ? null : new Date().toISOString(),
        usuario_creador_id: usuario.id,
      })
      .select('id')
      .single()

    if (campanaError || !campanaData) {
      logger.error({
        modulo: 'comunicaciones',
        mensaje: 'No se pudo crear campaña padre',
        contexto: { error: campanaError?.message },
      })
      return NextResponse.json({ ok: false, error: 'No se pudo crear la campaña' }, { status: 500 })
    }

    const envio_agrupado_id = (campanaData as any).id as string

    // ── Guardar adjuntos en storage permanente (no /tmp) ──
    // Path relativo al proyecto — bind mount /app/storage → host: storage/
    const projectRoot = process.env.PROJECT_ROOT || process.cwd()
    const carpetaCampana = path.join(projectRoot, 'storage', 'campanas', envio_agrupado_id)
    const archivos_adjuntos: Array<{ filename: string; path: string; size?: number }> = []
    const archivos = formData.getAll('archivos') as File[]

    if (archivos.length > 0) {
      fs.mkdirSync(carpetaCampana, { recursive: true })
      for (const archivo of archivos) {
        if (!(archivo instanceof File) || archivo.size === 0) continue
        if (archivo.size > 10 * 1024 * 1024) continue
        const safeName = archivo.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const filePath = path.join(carpetaCampana, safeName)
        const buffer = Buffer.from(await archivo.arrayBuffer())
        fs.writeFileSync(filePath, buffer)
        archivos_adjuntos.push({ filename: archivo.name, path: filePath, size: archivo.size })
      }
    }

    // ── Pre-computar variables comunes (mismo cuerpo para todos) ──
    // El sender mapea `campos_editables.titulo` → {{titulo}} y `cuerpo` →
    // {{cuerpo_mensaje}}. Botón CTA se genera acá una sola vez.
    let cuerpoConBoton = campos_editables?.cuerpo ?? ''
    let botonHtml: string | undefined
    const ctaTexto = campos_editables?.cta_texto?.trim()
    const ctaUrl = campos_editables?.cta_url?.trim()
    if (ctaTexto && ctaUrl) {
      const orgVars = await obtenerVariablesOrganizacion()
      const { generarBotonHtml } = await import('@/lib/email-templates/botones')
      botonHtml = generarBotonHtml({
        texto: ctaTexto,
        url: ctaUrl,
        color_marca: orgVars.organizacion_color_marca || undefined,
      })
      if (!cuerpoConBoton.includes('{{boton_accion}}')) {
        cuerpoConBoton = cuerpoConBoton.trim()
          ? `${cuerpoConBoton}\n\n{{boton_accion}}`
          : `{{boton_accion}}`
      }
    }
    const variablesExtra: Record<string, string> = {
      ...(campos_editables?.titulo ? { titulo: campos_editables.titulo } : {}),
      ...(cuerpoConBoton ? { cuerpo_mensaje: cuerpoConBoton } : {}),
      ...(botonHtml ? { boton_accion: botonHtml } : {}),
    }

    // ── Encolar N emails (uno por destinatario) ──
    // El cron `enviar-emails-encolados` los procesa en background respetando
    // el delay entre envíos y el límite diario. Este loop es rápido: solo
    // INSERTs, sin llamadas a SMTP.
    const enviar_despues_de = programadaPara ?? new Date()
    let encolados = 0
    let excluidos = 0

    for (const persona of personasArr) {
      const nombreCompleto = persona.razon_social || [persona.apellido, persona.nombre].filter(Boolean).join(', ')

      // Skip sin email
      if (!persona.email) {
        excluidos++
        continue
      }

      const res = await encolarEmail({
        plantilla_codigo,
        destinatario: {
          email: persona.email,
          nombre: nombreCompleto,
          persona_id: persona.id,
        },
        tipo_envio: 'MASIVO',
        enviado_por_usuario_id: usuario.id,
        variables_extra: variablesExtra,
        archivos_adjuntos: archivos_adjuntos.length > 0 ? archivos_adjuntos : undefined,
        anti_spam: false,
        envio_agrupado_id,
        enviar_despues_de,
      })

      if (res.ok && res.estado === 'ENCOLADO') {
        encolados++
      } else if (res.estado === 'EXCLUIDO_BAJA' || res.estado === 'EXCLUIDO_NO_MARKETING') {
        excluidos++
      } else {
        // Error inesperado al encolar — cuenta como excluido para no engañar los totales.
        excluidos++
      }
    }

    // ── Actualizar métricas iniciales de la campaña ──
    // Los excluidos se determinan al encolar (baja / no marketing). Enviados/fallidos
    // los va incrementando el cron a medida que procesa. Al procesarse el último,
    // el cron marca estado='COMPLETADA'.
    await (supabase.from('mailing_campanas') as any)
      .update({ excluidos, total_destinatarios: personasArr.length })
      .eq('id', envio_agrupado_id)

    return NextResponse.json({
      ok: true,
      campana_id: envio_agrupado_id,
      total: personasArr.length,
      encolados,
      excluidos,
      programada: programadaPara?.toISOString() ?? null,
      mensaje: programadaPara
        ? `${encolados} emails programados para ${programadaPara.toLocaleString('es-AR')}. Se van a enviar automáticamente cuando llegue la fecha.`
        : `${encolados} emails encolados. Se van enviando en segundo plano — vas a ver el progreso en el historial.`,
    })
  } catch (err: any) {
    logger.error({
      modulo: 'comunicaciones',
      mensaje: 'Error en /enviar-masivo',
      contexto: { error: err?.message || String(err) },
    })
    return NextResponse.json({ ok: false, error: 'Error interno del servidor' }, { status: 500 })
  }
}
