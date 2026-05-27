import { NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { isEncryptionAvailable, encrypt } from '@/lib/encryption'
import { invalidarCacheTransporter } from '@/lib/email-sender'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function GET(request: Request) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario || usuario.rol !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Acceso denegado' }, { status: 403 })
  }

  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('configuracion_correos')
    .select('*')
    .limit(1)
    .maybeSingle()

  if (!data) {
    return NextResponse.json({
      ok: true,
      configuracion: null,
      encryption_disponible: isEncryptionAvailable(),
      configurado: false
    })
  }

  // No exponer la contraseña encriptada
  const { smtp_password_encrypted, ...rest } = data
  return NextResponse.json({
    ok: true,
    configuracion: {
      ...rest,
      tiene_password: !!smtp_password_encrypted
    },
    encryption_disponible: isEncryptionAvailable(),
    configurado: data.configurado
  })
}

export async function PATCH(request: Request) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario || usuario.rol !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Acceso denegado' }, { status: 403 })
  }

  if (!isEncryptionAvailable()) {
    return NextResponse.json({
      ok: false,
      error: 'ENCRYPTION_KEY no configurada en el servidor. No se puede guardar la configuración de correos.',
      codigo: 'SIN_ENCRYPTION_KEY'
    }, { status: 503 })
  }

  const body = await request.json()

  // Validar emails
  const camposEmail = ['from_email', 'reply_to']
  for (const campo of camposEmail) {
    if (body[campo] && !EMAIL_REGEX.test(body[campo])) {
      return NextResponse.json({ ok: false, error: `Email inválido en ${campo}: ${body[campo]}` }, { status: 400 })
    }
  }

  // Validar puerto
  if (body.smtp_port !== undefined) {
    const port = Number(body.smtp_port)
    if (isNaN(port) || port < 1 || port > 65535) {
      return NextResponse.json({ ok: false, error: 'Puerto SMTP inválido (debe ser entre 1 y 65535)' }, { status: 400 })
    }
  }

  const supabase = getSupabaseAdmin()

  // Verificar si ya existe una fila
  const { data: existente } = await supabase
    .from('configuracion_correos')
    .select('id, smtp_password_encrypted')
    .limit(1)
    .maybeSingle()

  // Construir datos a guardar
  const datos: Record<string, any> = {
    smtp_host: body.smtp_host || null,
    smtp_port: Number(body.smtp_port) || 587,
    smtp_secure: !!body.smtp_secure,
    smtp_user: body.smtp_user || null,
    from_name: body.from_name || null,
    from_email: body.from_email || null,
    reply_to: body.reply_to || null,
    firma_html: body.firma_html || null,
  }

  // Contraseña: solo actualizar si se envió una nueva
  if (body.smtp_password) {
    datos.smtp_password_encrypted = encrypt(body.smtp_password)
  }

  // Determinar si está configurado (campos mínimos)
  const tienePassword = body.smtp_password || existente?.smtp_password_encrypted
  datos.configurado = !!(
    datos.smtp_host &&
    datos.smtp_port &&
    datos.smtp_user &&
    tienePassword &&
    datos.from_email
  )

  let result
  if (existente) {
    result = await supabase
      .from('configuracion_correos')
      .update(datos)
      .eq('id', existente.id)
      .select('*')
      .single()
  } else {
    result = await supabase
      .from('configuracion_correos')
      .insert(datos)
      .select('*')
      .single()
  }

  if (result.error) {
    return NextResponse.json({ ok: false, error: 'Error al guardar los datos' }, { status: 500 })
  }

  // Invalidar cache del transporter
  invalidarCacheTransporter()

  // Devolver sin la contraseña
  const { smtp_password_encrypted, ...rest } = result.data
  return NextResponse.json({
    ok: true,
    configuracion: {
      ...rest,
      tiene_password: !!smtp_password_encrypted
    }
  })
}
