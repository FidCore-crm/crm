import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { logger } from '@/lib/errores'

/**
 * Escapa caracteres HTML peligrosos. Lo aplicamos a TODO valor dinámico
 * antes de inyectarlo en el HTML del unsubscribe (nombre de organización
 * configurado por el PAS y email del destinatario).
 */
function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * `contenido` se asume HTML ya sanitizado por el caller (estructura interna controlada).
 * `organizacionNombre` se escapa siempre, viene de configuracion.nombre que es editable.
 */
function renderPage(contenido: string, organizacionNombre: string): Response {
  const safeNombre = escapeHtml(organizacionNombre)
  const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Baja de emails - ${safeNombre}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f1f5f9;min-height:100vh;">
<tr><td align="center" style="padding:48px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="480" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
<tr><td style="background-color:#0A1628;padding:20px 32px;text-align:center;">
<span style="font-size:18px;font-weight:bold;color:#ffffff;">${safeNombre}</span>
</td></tr>
<tr><td style="padding:32px;">
${contenido}
</td></tr>
</table>
</td></tr></table>
</body>
</html>`

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

async function getOrganizacionNombre(): Promise<string> {
  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('configuracion')
      .select('nombre')
      .limit(1)
      .maybeSingle()
    return (data as any)?.nombre || 'Productor de Seguros'
  } catch (err) {
    // Si configuracion no responde, no rompemos el unsubscribe — caemos al
    // default. Loguear para tener visibilidad en logs del servidor.
    logger.warn({
      modulo: 'unsubscribe',
      mensaje: 'No se pudo leer nombre de organización para el unsubscribe',
      contexto: { error: String(err) },
    })
    return 'Productor de Seguros'
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const supabase = getSupabaseAdmin()
  const organizacionNombre = await getOrganizacionNombre()

  // Verificar token
  const { data: envio } = await supabase
    .from('email_envios')
    .select('id, destinatario_email')
    .eq('token_tracking', token)
    .maybeSingle()

  if (!envio) {
    return renderPage(
      `<p style="font-size:15px;color:#334155;text-align:center;margin:0;">El enlace no es válido o ya expiró.</p>`,
      organizacionNombre
    )
  }

  const email = (envio as any).destinatario_email
  const safeEmail = escapeHtml(email)
  const safeNombre = escapeHtml(organizacionNombre)

  return renderPage(
    `<div style="text-align:center;">
<p style="font-size:16px;color:#334155;margin:0 0 8px;">¿Confirmás que querés dejar de recibir emails de <strong>${safeNombre}</strong>?</p>
<p style="font-size:13px;color:#64748b;margin:0 0 24px;">Email: ${safeEmail}</p>
<form method="POST" style="display:inline;">
<button type="submit" style="display:inline-block;padding:12px 32px;background-color:#dc2626;color:#ffffff;font-size:14px;font-weight:bold;border:none;border-radius:6px;cursor:pointer;margin-right:8px;">Sí, dar de baja</button>
</form>
<a href="javascript:window.close()" style="display:inline-block;padding:12px 32px;background-color:#e2e8f0;color:#334155;font-size:14px;font-weight:bold;text-decoration:none;border-radius:6px;">Cancelar</a>
</div>`,
    organizacionNombre
  )
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = getClientIp(request)
  const rl = await checkRateLimit({ identifier: ip, endpoint: 'unsubscribe', maxRequests: 10, windowSeconds: 3600 })
  if (!rl.allowed) {
    return NextResponse.json({ ok: false, error: 'Demasiadas solicitudes' }, { status: 429 })
  }
  const { token } = await params
  const supabase = getSupabaseAdmin()
  const organizacionNombre = await getOrganizacionNombre()

  // Buscar envío
  const { data: envio } = await supabase
    .from('email_envios')
    .select('id, destinatario_email')
    .eq('token_tracking', token)
    .maybeSingle()

  if (!envio) {
    return renderPage(
      `<p style="font-size:15px;color:#334155;text-align:center;margin:0;">El enlace no es válido o ya expiró.</p>`,
      organizacionNombre
    )
  }

  const email = (envio as any).destinatario_email.toLowerCase()

  // Insertar baja (ON CONFLICT DO NOTHING)
  await supabase
    .from('email_bajas')
    .upsert(
      { email, origen: 'unsubscribe_link' },
      { onConflict: 'email', ignoreDuplicates: true }
    )

  const safeNombrePost = escapeHtml(organizacionNombre)
  return renderPage(
    `<div style="text-align:center;">
<div style="width:48px;height:48px;background-color:#dcfce7;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
<span style="font-size:24px;color:#16a34a;">&#10003;</span>
</div>
<p style="font-size:16px;color:#334155;margin:0 0 8px;font-weight:bold;">Te diste de baja correctamente</p>
<p style="font-size:14px;color:#64748b;margin:0;">No recibirás más emails de ${safeNombrePost}.</p>
</div>`,
    organizacionNombre
  )
}
