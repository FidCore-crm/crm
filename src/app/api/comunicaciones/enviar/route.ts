import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { enviarComunicacion } from '@/lib/comunicaciones-sender'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { checkLicenciaActiva } from '@/lib/licencia-guard'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

export async function POST(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  try {
    const formData = await request.formData()
    const plantilla_codigo = formData.get('plantilla_codigo') as string
    const persona_id = formData.get('persona_id') as string | null
    const poliza_id = formData.get('poliza_id') as string | null
    const asunto = formData.get('asunto') as string | null
    const campos_editables_raw = formData.get('campos_editables') as string
    const campos_editables = campos_editables_raw ? JSON.parse(campos_editables_raw) : {}
    // Variables extra que el caller inyecta directo al renderer (ej: número
    // de cotización, ramo, cantidad de opciones — datos que no son del
    // dominio persona/póliza pero que la plantilla necesita).
    const variables_extra_raw = formData.get('variables_extra') as string | null
    const variables_extra = variables_extra_raw ? JSON.parse(variables_extra_raw) : {}
    // Soporte para destinatarios sin persona en DB (leads, contactos sueltos).
    // Si no hay persona_id, el caller debe enviar email_directo + nombre_directo.
    const email_directo = formData.get('email_directo') as string | null
    const nombre_directo = formData.get('nombre_directo') as string | null

    if (!plantilla_codigo) {
      return NextResponse.json({ ok: false, error: 'Falta plantilla_codigo' }, { status: 400 })
    }
    if (!persona_id && !email_directo) {
      return NextResponse.json({ ok: false, error: 'Falta destinatario: persona_id o email_directo' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    // Validar que la plantilla exista (evita encolar emails que el cron luego marca FALLIDO)
    const { data: plantillaExiste } = await supabase
      .from('plantillas_email')
      .select('codigo')
      .eq('codigo', plantilla_codigo)
      .maybeSingle()
    if (!plantillaExiste) {
      return NextResponse.json(
        { ok: false, error: `La plantilla de email "${plantilla_codigo}" no existe` },
        { status: 400 }
      )
    }

    // Verificar acceso a la persona por cartera (si aplica)
    if (persona_id && !tieneAccesoTotal(usuario)) {
      const { data: persona } = await supabase
        .from('personas')
        .select('usuario_id')
        .eq('id', persona_id)
        .maybeSingle()

      if (persona && (persona as any).usuario_id && (persona as any).usuario_id !== usuario.id) {
        return NextResponse.json({ ok: false, error: 'No tenés acceso a este cliente' }, { status: 403 })
      }
    }

    // Verificar que el sistema de comunicaciones esté activo
    const { data: comConfig } = await supabase
      .from('configuracion_comunicaciones')
      .select('activo')
      .limit(1)
      .maybeSingle()

    if (!(comConfig as any)?.activo) {
      return NextResponse.json(
        { ok: false, error: 'El sistema de comunicaciones no está activo. Activalo desde Configuración → Comunicaciones.' },
        { status: 400 }
      )
    }

    // Resolver destinatario: persona en DB o email directo (lead, contacto suelto)
    let destinatarioEmail: string
    let destinatarioNombre: string
    if (persona_id) {
      const { data: personaData } = await supabase
        .from('personas')
        .select('nombre, apellido, email, razon_social')
        .eq('id', persona_id)
        .maybeSingle()

      if (!personaData || !(personaData as any).email) {
        return NextResponse.json({ ok: false, error: 'El cliente no tiene email cargado' }, { status: 400 })
      }

      const p = personaData as any
      destinatarioEmail = p.email
      destinatarioNombre = p.razon_social || [p.apellido, p.nombre].filter(Boolean).join(', ')
    } else {
      // Validación de formato básica para email_directo
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!email_directo || !emailRe.test(email_directo)) {
        return NextResponse.json({ ok: false, error: 'email_directo inválido' }, { status: 400 })
      }
      destinatarioEmail = email_directo
      destinatarioNombre = (nombre_directo || '').trim() || email_directo
    }

    // Si viene asunto personalizado, meterlo en campos_editables
    if (asunto) {
      campos_editables.titulo = campos_editables.titulo || asunto
    }

    // Procesar archivos adjuntos
    const archivos_adjuntos: Array<{ filename: string; path: string }> = []
    const tmpDir = path.join('/tmp', 'crm-attachments', crypto.randomUUID())

    const archivos = formData.getAll('archivos') as File[]
    if (archivos.length > 0) {
      fs.mkdirSync(tmpDir, { recursive: true })

      for (const archivo of archivos) {
        if (!(archivo instanceof File) || archivo.size === 0) continue
        if (archivo.size > 10 * 1024 * 1024) {
          return NextResponse.json({ ok: false, error: `El archivo "${archivo.name}" supera los 10MB` }, { status: 400 })
        }

        const safeName = archivo.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const filePath = path.join(tmpDir, safeName)
        const buffer = Buffer.from(await archivo.arrayBuffer())
        fs.writeFileSync(filePath, buffer)

        archivos_adjuntos.push({ filename: archivo.name, path: filePath })
      }
    }

    // Enviar
    const resultado = await enviarComunicacion({
      plantilla_codigo,
      destinatario: {
        email: destinatarioEmail,
        nombre: destinatarioNombre,
        persona_id: persona_id || undefined,
      },
      poliza_id: poliza_id || undefined,
      campos_editables,
      variables_extra: Object.keys(variables_extra).length > 0 ? variables_extra : undefined,
      archivos_adjuntos: archivos_adjuntos.length > 0 ? archivos_adjuntos : undefined,
      tipo_envio: 'MANUAL',
      enviado_por_usuario_id: usuario.id,
    })

    // Limpiar archivos temporales
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }

    if (resultado.ok) {
      return NextResponse.json({ ok: true, envio_id: resultado.envio_id })
    } else {
      const status = resultado.error?.includes('no está activo') ? 400 : 500
      return NextResponse.json({ ok: false, error: resultado.error, envio_id: resultado.envio_id }, { status })
    }
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Error interno del servidor' }, { status: 500 })
  }
}
