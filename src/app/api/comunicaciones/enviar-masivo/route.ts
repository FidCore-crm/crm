import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { enviarComunicacion } from '@/lib/comunicaciones-sender'
import { checkLicenciaActiva } from '@/lib/licencia-guard'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

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

    // Verificar sistema activo
    const { data: comConfig } = await supabase
      .from('configuracion_comunicaciones')
      .select('activo, limite_diario, delay_entre_envios_ms')
      .limit(1)
      .maybeSingle()

    const config = comConfig as any
    if (!config?.activo) {
      return NextResponse.json(
        { ok: false, error: 'El sistema de comunicaciones no está activo.' },
        { status: 400 }
      )
    }

    const limiteDiario = config.limite_diario ?? 500
    const delay = config.delay_entre_envios_ms ?? 2000

    // Contar envíos de hoy
    const hoyInicio = new Date()
    hoyInicio.setHours(0, 0, 0, 0)
    const { count: enviosHoy } = await supabase
      .from('email_envios')
      .select('id', { count: 'exact', head: true })
      .gte('fecha_creacion', hoyInicio.toISOString())
      .in('estado', ['ENVIADO', 'ENVIANDO'])

    let enviadosHoy = enviosHoy ?? 0

    // Obtener personas
    const { data: personas } = await supabase
      .from('personas')
      .select('id, nombre, apellido, razon_social, email, acepta_marketing')
      .in('id', persona_ids)

    if (!personas || personas.length === 0) {
      return NextResponse.json({ ok: false, error: 'No se encontraron personas' }, { status: 400 })
    }

    // Obtener lista de bajas
    const emails = (personas as any[]).filter(p => p.email).map(p => p.email.toLowerCase())
    const { data: bajasData } = emails.length > 0
      ? await supabase.from('email_bajas').select('email').in('email', emails)
      : { data: [] }
    const emailsBaja = new Set((bajasData ?? []).map((b: any) => b.email))

    // Guardar archivos adjuntos temporales
    const archivos_adjuntos: Array<{ filename: string; path: string }> = []
    const tmpDir = path.join('/tmp', 'crm-attachments', crypto.randomUUID())
    const archivos = formData.getAll('archivos') as File[]

    if (archivos.length > 0) {
      fs.mkdirSync(tmpDir, { recursive: true })
      for (const archivo of archivos) {
        if (!(archivo instanceof File) || archivo.size === 0) continue
        if (archivo.size > 10 * 1024 * 1024) continue
        const safeName = archivo.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const filePath = path.join(tmpDir, safeName)
        const buffer = Buffer.from(await archivo.arrayBuffer())
        fs.writeFileSync(filePath, buffer)
        archivos_adjuntos.push({ filename: archivo.name, path: filePath })
      }
    }

    // Crear la campaña padre para agrupar el envío masivo en el historial.
    // Todos los email_envios generados en este loop van a linkear a este ID.
    // Los envíos individuales (MANUAL, AUTOMATICO_*) no crean campaña.
    const asuntoParaCampana = (formData.get('asunto') as string) || plantilla_codigo
    const nombreCampana = `Envío masivo — ${asuntoParaCampana}`.slice(0, 200)
    const personaIdsUnicos = (personas as any[]).map(p => p.id)
    const { data: campanaData, error: campanaError } = await (supabase.from('mailing_campanas') as any)
      .insert({
        nombre: nombreCampana,
        descripcion: `Envío masivo iniciado desde ${plantilla_codigo}.`,
        personas_ids: personaIdsUnicos,
        asunto_libre: asuntoParaCampana,
        cuerpo_libre: '(envío masivo desde ficha/listado)',
        estado: 'EJECUTANDO',
        total_destinatarios: (personas as any[]).length,
        fecha_inicio_ejecucion: new Date().toISOString(),
        usuario_creador_id: usuario.id,
      })
      .select('id')
      .single()

    const envio_agrupado_id: string | undefined = campanaError ? undefined : (campanaData as any)?.id

    // Procesar envíos secuencialmente
    const detalle: Array<{ persona_id: string; nombre: string; estado: string; error?: string }> = []
    let enviados = 0
    let fallidos = 0
    let excluidos = 0

    for (const persona of personas as any[]) {
      const nombreCompleto = persona.razon_social || [persona.apellido, persona.nombre].filter(Boolean).join(', ')

      // Verificar sin email
      if (!persona.email) {
        excluidos++
        detalle.push({ persona_id: persona.id, nombre: nombreCompleto, estado: 'sin_email' })
        continue
      }

      // Verificar marketing
      if (persona.acepta_marketing === false) {
        excluidos++
        detalle.push({ persona_id: persona.id, nombre: nombreCompleto, estado: 'no_marketing' })
        continue
      }

      // Verificar baja
      if (emailsBaja.has(persona.email.toLowerCase())) {
        excluidos++
        detalle.push({ persona_id: persona.id, nombre: nombreCompleto, estado: 'baja' })
        continue
      }

      // Verificar límite diario
      if (enviadosHoy >= limiteDiario) {
        detalle.push({ persona_id: persona.id, nombre: nombreCompleto, estado: 'limite_diario' })
        excluidos++
        continue
      }

      // Enviar
      const resultado = await enviarComunicacion({
        plantilla_codigo,
        destinatario: {
          email: persona.email,
          nombre: nombreCompleto,
          persona_id: persona.id,
        },
        campos_editables,
        archivos_adjuntos: archivos_adjuntos.length > 0 ? archivos_adjuntos : undefined,
        tipo_envio: 'MASIVO',
        enviado_por_usuario_id: usuario.id,
        envio_agrupado_id,
      })

      if (resultado.ok) {
        enviados++
        enviadosHoy++
        detalle.push({ persona_id: persona.id, nombre: nombreCompleto, estado: 'enviado' })
      } else {
        fallidos++
        detalle.push({ persona_id: persona.id, nombre: nombreCompleto, estado: 'fallido', error: resultado.error })
      }

      // Delay entre envíos
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    // Limpiar archivos temporales
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }

    // Cerrar la campaña padre con métricas finales.
    if (envio_agrupado_id) {
      await (supabase.from('mailing_campanas') as any)
        .update({
          estado: 'COMPLETADA',
          enviados,
          fallidos,
          excluidos,
          fecha_fin_ejecucion: new Date().toISOString(),
        })
        .eq('id', envio_agrupado_id)
    }

    return NextResponse.json({
      ok: true,
      total: (personas as any[]).length,
      enviados,
      fallidos,
      excluidos,
      detalle,
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Error interno del servidor' }, { status: 500 })
  }
}
