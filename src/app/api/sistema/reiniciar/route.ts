import { NextResponse } from 'next/server'
import { spawn, exec } from 'child_process'
import { promisify } from 'util'
import { requireAdmin } from '@/lib/api-auth'
import { logger } from '@/lib/errores'

const execAsync = promisify(exec)

// POST /api/sistema/reiniciar — reinicia el servidor (admin only).
export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  // Pre-check: ¿sudoers permite reboot sin password?
  try {
    await execAsync('sudo -n -l /usr/sbin/reboot')
  } catch {
    logger.error({
      modulo: 'sistema-power',
      mensaje: 'Sudoers no configurado para reboot',
      contexto: { usuario_id: auth.id },
    })
    return NextResponse.json(
      {
        ok: false,
        error: {
          codigo: 'ERR_SYS_SUDOERS',
          mensaje: 'El sistema no tiene permisos para reiniciar el servidor. Falta configurar sudoers (contactá al administrador del servidor).',
        },
      },
      { status: 503 },
    )
  }

  logger.warn({
    modulo: 'sistema-power',
    mensaje: 'Reinicio del servidor solicitado',
    contexto: { usuario_id: auth.id, email: auth.email },
  })

  setTimeout(() => {
    try {
      const child = spawn('sudo', ['-n', '/usr/sbin/reboot'], {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
    } catch (err: any) {
      logger.error({
        modulo: 'sistema-power',
        mensaje: 'Falló el spawn de reboot',
        contexto: { error: err?.message },
      })
    }
  }, 2000)

  return NextResponse.json({
    ok: true,
    mensaje: 'El servidor se está reiniciando. Volvé a intentar acceder al CRM en 1-2 minutos.',
  })
}
