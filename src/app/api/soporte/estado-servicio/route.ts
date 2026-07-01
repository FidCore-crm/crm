/**
 * Endpoint de soporte para gestionar el estado del servicio del cliente
 * (SaaS-managed). Solo tiene sentido en modo VPS — en APPLIANCE devuelve
 * 404 porque no aplica.
 *
 * Autenticación:
 *   Header `Authorization: Bearer <SOPORTE_TOKEN>` donde SOPORTE_TOKEN es
 *   una variable de entorno única por cliente que solo vos (FidCore) sabés.
 *   Se setea en `.env.docker` al instalar y NUNCA se rota junto con los
 *   backups (queda solo en tu registro local para poder llamarlo desde curl
 *   o desde el panel).
 *
 *   El panel de administración conoce el token de cada cliente y lo usa
 *   para suspender/reactivar via este endpoint. Mientras el panel no
 *   existe, vos lo llamás con curl desde tu terminal cuando querés
 *   suspender por falta de pago.
 *
 * Endpoints:
 *   GET  → devuelve el estado actual
 *   POST → cambia el estado. Body: { estado: 'ACTIVO' | 'SUSPENDIDO', motivo?: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { esModoVps } from '@/lib/modo-instalacion'
import { obtenerEstadoServicio, actualizarEstadoServicio } from '@/lib/estado-servicio'
import { logger } from '@/lib/errores'

function autenticar(request: NextRequest): { ok: true } | { ok: false; res: NextResponse } {
  const token = process.env.SOPORTE_TOKEN
  if (!token || token.length < 16) {
    // Si el token no está seteado, negamos siempre. Sin token, no hay soporte.
    return {
      ok: false,
      res: NextResponse.json(
        { ok: false, error: { codigo: 'SOPORTE_NO_CONFIGURADO', mensaje: 'El endpoint de soporte no está habilitado en esta instalación.' } },
        { status: 503 },
      ),
    }
  }

  const header = request.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  const provisto = match?.[1]?.trim()

  if (!provisto || provisto !== token) {
    return {
      ok: false,
      res: NextResponse.json(
        { ok: false, error: { codigo: 'SOPORTE_TOKEN_INVALIDO', mensaje: 'Token de soporte inválido' } },
        { status: 401 },
      ),
    }
  }

  return { ok: true }
}

function chequeoModo(): NextResponse | null {
  if (!esModoVps()) {
    // En APPLIANCE devolvemos 404 para no revelar que este endpoint existe.
    return NextResponse.json({ ok: false, error: 'Not Found' }, { status: 404 })
  }
  return null
}

export async function GET(request: NextRequest) {
  const errModo = chequeoModo()
  if (errModo) return errModo

  const auth = autenticar(request)
  if (!auth.ok) return auth.res

  const estado = await obtenerEstadoServicio()
  return NextResponse.json({ ok: true, data: estado })
}

export async function POST(request: NextRequest) {
  const errModo = chequeoModo()
  if (errModo) return errModo

  const auth = autenticar(request)
  if (!auth.ok) return auth.res

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: { codigo: 'BODY_INVALIDO', mensaje: 'Body debe ser JSON' } },
      { status: 400 },
    )
  }

  const nuevoEstado = body?.estado
  if (nuevoEstado !== 'ACTIVO' && nuevoEstado !== 'SUSPENDIDO') {
    return NextResponse.json(
      { ok: false, error: { codigo: 'ESTADO_INVALIDO', mensaje: 'estado debe ser ACTIVO o SUSPENDIDO' } },
      { status: 400 },
    )
  }

  const motivo = typeof body?.motivo === 'string' ? body.motivo.trim() : null

  const res = await actualizarEstadoServicio(nuevoEstado, motivo || null)
  if (!res.ok) {
    logger.error({
      modulo: 'soporte',
      mensaje: 'No se pudo actualizar estado_servicio',
      contexto: { nuevoEstado, error: res.error },
    })
    return NextResponse.json(
      { ok: false, error: { codigo: 'ERROR_ACTUALIZACION', mensaje: res.error } },
      { status: 500 },
    )
  }

  logger.info({
    modulo: 'soporte',
    mensaje: `Estado del servicio cambiado a ${nuevoEstado}`,
    contexto: { motivo },
  })

  const actual = await obtenerEstadoServicio()
  return NextResponse.json({ ok: true, data: actual })
}
