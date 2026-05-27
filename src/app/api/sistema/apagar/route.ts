import { NextResponse } from 'next/server'
import { spawn, exec } from 'child_process'
import { promisify } from 'util'
import { requireAdmin } from '@/lib/api-auth'
import { logger } from '@/lib/errores'

const execAsync = promisify(exec)

// POST /api/sistema/apagar — apaga el servidor (admin only).
// Verifica primero que sudoers permita el comando sin password; si no,
// devuelve 503 con instrucciones claras.
export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  // Pre-check: ¿el usuario que corre Node tiene permiso sudo NOPASSWD para shutdown?
  try {
    await execAsync('sudo -n -l /usr/sbin/shutdown')
  } catch {
    logger.error({
      modulo: 'sistema-power',
      mensaje: 'Sudoers no configurado para shutdown',
      contexto: { usuario_id: auth.id },
    })
    return NextResponse.json(
      {
        ok: false,
        error: {
          codigo: 'ERR_SYS_SUDOERS',
          mensaje: 'El sistema no tiene permisos para apagar el servidor. Falta configurar sudoers (contactá al administrador del servidor).',
        },
      },
      { status: 503 },
    )
  }

  logger.warn({
    modulo: 'sistema-power',
    mensaje: 'Apagado del servidor solicitado',
    contexto: { usuario_id: auth.id, email: auth.email },
  })

  // Disparar shutdown en background con 2s de gracia para que viaje la response.
  setTimeout(() => {
    try {
      const child = spawn('sudo', ['-n', '/usr/sbin/shutdown', '-h', 'now', 'Apagado solicitado desde el CRM'], {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
    } catch (err: any) {
      logger.error({
        modulo: 'sistema-power',
        mensaje: 'Falló el spawn de shutdown',
        contexto: { error: err?.message },
      })
    }
  }, 2000)

  return NextResponse.json({
    ok: true,
    mensaje: 'El servidor se está apagando. Perdiste acceso al CRM hasta que lo enciendas físicamente.',
  })
}
