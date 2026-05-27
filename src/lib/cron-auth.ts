// ============================================================
// Validación de autenticación para endpoints /api/cron/*
// ============================================================
//
// Política dual:
// 1) Header `Authorization: Bearer <CRON_SECRET>` — usado por systemd/curl
// 2) Fallback: sesión de usuario ADMIN válida — usado por el fallback
//    client-side (CronPolizas.tsx) que no puede exponer el secret al browser
//
// Si no se configuró CRON_SECRET en el servidor: responde 500.
// ============================================================

import { NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { logger } from '@/lib/errores'

export async function validarCronSecret(request: Request): Promise<NextResponse | null> {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    logger.error({ modulo: 'cron-auth', mensaje: 'CRON_SECRET no configurado en el entorno' })
    return NextResponse.json(
      { ok: false, error: 'Sistema no configurado' },
      { status: 500 }
    )
  }

  // Opción 1: Bearer token (systemd/curl)
  const authHeader = request.headers.get('authorization')
  if (authHeader && authHeader === `Bearer ${expected}`) {
    return null
  }

  // Opción 2: sesión de usuario ADMIN (fallback client-side CronPolizas.tsx)
  try {
    const usuario = await obtenerUsuarioDesdeRequest(request)
    if (usuario && usuario.rol === 'ADMIN') {
      return null
    }
  } catch {
    // caer al 401 abajo
  }

  return NextResponse.json(
    { ok: false, error: 'No autorizado' },
    { status: 401 }
  )
}
