import { NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { testConexionSMTP, enviarEmail } from '@/lib/email-sender'
import { logger } from '@/lib/errores'

// Limpia mensajes técnicos de nodemailer/SMTP antes de exponerlos al PAS.
// El detalle crudo va al log del server.
function mensajeUsuarioParaErrorSMTP(raw: string | undefined): string {
  const t = (raw || '').toLowerCase()
  if (t.includes('eauth') || t.includes('authentication') || t.includes('535'))
    return 'Usuario o contraseña SMTP incorrectos.'
  if (t.includes('econn') || t.includes('etimedout') || t.includes('timeout'))
    return 'No se pudo conectar al servidor SMTP (host o puerto incorrectos, o firewall bloqueado).'
  if (t.includes('etls') || t.includes('ssl') || t.includes('tls'))
    return 'Error de TLS/SSL — revisá el toggle SSL/TLS y el puerto.'
  if (t.includes('enotfound') || t.includes('dns'))
    return 'No se resolvió el host SMTP. Revisá que esté bien escrito.'
  return 'Error al conectar con el servidor SMTP. Revisá los datos.'
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(request: Request) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario || usuario.rol !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Acceso denegado' }, { status: 403 })
  }

  const body = await request.json()
  const { destinatario, config_temporal } = body

  if (!destinatario || !EMAIL_REGEX.test(destinatario)) {
    return NextResponse.json({ ok: false, error: 'Email destinatario inválido' }, { status: 400 })
  }

  const supabase = getSupabaseAdmin()

  try {
    // Test de conexión
    const testResult = await testConexionSMTP(config_temporal || undefined)

    if (!testResult.ok) {
      // Registrar test fallido
      await supabase
        .from('configuracion_correos')
        .update({ ultimo_test: new Date().toISOString(), ultimo_test_exitoso: false })
        .neq('id', '00000000-0000-0000-0000-000000000000') // actualizar cualquier fila

      // Log técnico al server (con detalle completo) y mensaje limpio al usuario
      logger.warn({
        modulo: 'smtp-test',
        mensaje: 'Test SMTP falló',
        contexto: { error_crudo: testResult.error, usuario_id: usuario.id },
      })
      return NextResponse.json({
        ok: false,
        error: mensajeUsuarioParaErrorSMTP(testResult.error),
      }, { status: 400 })
    }

    // Si la conexión funciona, enviar email de prueba
    const ahora = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })

    if (config_temporal) {
      // Enviar con transporter temporal
      const nodemailer = require('nodemailer')
      const transporter = nodemailer.createTransport({
        host: config_temporal.host,
        port: config_temporal.port,
        secure: config_temporal.secure,
        auth: { user: config_temporal.user, pass: config_temporal.password }
      })
      await transporter.sendMail({
        from: `"FidCore - Test" <${config_temporal.user}>`,
        to: destinatario,
        subject: 'Email de prueba — FidCore',
        html: `<div style="font-family:sans-serif;padding:20px;">
          <h2 style="color:#1e293b;">Test de correo exitoso</h2>
          <p>Si recibís este email, la configuración SMTP del CRM funciona correctamente.</p>
          <p style="color:#64748b;font-size:13px;">Fecha de envío: ${ahora}</p>
        </div>`
      })
    } else {
      // Enviar con configuración guardada
      const resultado = await enviarEmail({
        to: destinatario,
        subject: 'Email de prueba — FidCore',
        html: `<div style="font-family:sans-serif;padding:20px;">
          <h2 style="color:#1e293b;">Test de correo exitoso</h2>
          <p>Si recibís este email, la configuración SMTP del CRM funciona correctamente.</p>
          <p style="color:#64748b;font-size:13px;">Fecha de envío: ${ahora}</p>
        </div>`
      })

      if (!resultado.ok) {
        await supabase
          .from('configuracion_correos')
          .update({ ultimo_test: new Date().toISOString(), ultimo_test_exitoso: false })
          .neq('id', '00000000-0000-0000-0000-000000000000')

        logger.warn({
          modulo: 'smtp-test',
          mensaje: 'Test SMTP envío falló',
          contexto: { error_crudo: resultado.error, usuario_id: usuario.id },
        })
        return NextResponse.json({
          ok: false,
          error: mensajeUsuarioParaErrorSMTP(resultado.error),
        }, { status: 400 })
      }
    }

    // Registrar test exitoso
    await supabase
      .from('configuracion_correos')
      .update({ ultimo_test: new Date().toISOString(), ultimo_test_exitoso: true })
      .neq('id', '00000000-0000-0000-0000-000000000000')

    return NextResponse.json({ ok: true, mensaje: `Email enviado correctamente a ${destinatario}` })
  } catch (err: any) {
    // El detalle crudo (que puede contener fragmentos de password en el stack)
    // queda solo en logs server-side. Al PAS le devolvemos un mensaje neutro.
    logger.error({
      modulo: 'smtp-test',
      mensaje: 'Error inesperado en test SMTP',
      contexto: { error_crudo: String(err?.message || err), usuario_id: usuario.id },
    })
    return NextResponse.json({ ok: false, error: 'Error inesperado al probar la conexión SMTP. Revisá el log del server.' }, { status: 500 })
  }
}
