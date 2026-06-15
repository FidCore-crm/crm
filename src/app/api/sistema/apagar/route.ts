import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { requireAdmin } from '@/lib/api-auth'
import { logger } from '@/lib/errores'
import { obtenerModo } from '@/lib/modo-instalacion'

// POST /api/sistema/apagar — solicita apagar el servidor físico (admin only,
// modo APPLIANCE only).
//
// Funcionamiento:
//   1. Verifica que el usuario sea admin y el modo sea APPLIANCE.
//   2. Escribe un archivo trigger en /app/tmp/sistema/apagar.flag (bind-mounted
//      al host como ${CRM_DIR}/tmp/sistema/apagar.flag).
//   3. Un cron del host (sistema-trigger.sh) detecta el flag cada minuto y
//      ejecuta sudo /sbin/shutdown -h now.
//
// El container no ejecuta sudo — Docker lo aislaría del host. El patrón
// trigger+watcher es el mismo que usa el sistema de actualizaciones.

const SISTEMA_DIR = path.resolve(process.cwd(), 'tmp/sistema')
const TRIGGER_FILE = path.join(SISTEMA_DIR, 'apagar.flag')

export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  if (obtenerModo() !== 'APPLIANCE') {
    return NextResponse.json(
      {
        ok: false,
        error: {
          codigo: 'ERR_NEG_002',
          mensaje: 'Apagar el servidor solo está disponible en modo servidor local. En VPS administrá la instancia desde el panel del proveedor.',
        },
      },
      { status: 422 },
    )
  }

  logger.warn({
    modulo: 'sistema-power',
    mensaje: 'Apagado del servidor solicitado',
    contexto: { usuario_id: auth.id, email: auth.email },
  })

  try {
    await fs.mkdir(SISTEMA_DIR, { recursive: true })
    const triggerData = {
      accion: 'apagar',
      solicitado_por_id: auth.id,
      solicitado_por_email: auth.email,
      timestamp: new Date().toISOString(),
    }
    await fs.writeFile(TRIGGER_FILE, JSON.stringify(triggerData, null, 2), 'utf-8')
  } catch (err) {
    logger.error({
      modulo: 'sistema-power',
      mensaje: 'No se pudo escribir el archivo trigger de apagado',
      contexto: { error: String(err) },
    })
    return NextResponse.json(
      {
        ok: false,
        error: {
          codigo: 'ERR_SYS_001',
          mensaje: 'No se pudo registrar la orden de apagado. Contactá al soporte técnico.',
        },
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    mensaje: 'Orden de apagado registrada. El servidor se va a apagar en menos de 1 minuto.',
  })
}
