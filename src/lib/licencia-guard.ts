/**
 * Guard de licencia para API routes de mutación.
 *
 * Bloquea writes cuando el sistema está en modo solo lectura (BLOQUEADA / SIN_LICENCIA).
 * Las consultas (GET) siguen funcionando para que el usuario pueda ver sus datos.
 *
 * Dos variantes según el patrón del endpoint:
 *
 *   1) Endpoints envueltos con `manejarErrores`:
 *      await requireLicenciaActiva()   // tira ErrorAplicacion
 *
 *   2) Endpoints con NextResponse manual:
 *      const bloqueo = await checkLicenciaActiva()
 *      if (bloqueo) return bloqueo
 */

import { NextResponse } from 'next/server'
import { obtenerEstadoLicencia } from '@/lib/licencia'
import { ErrorAplicacion, ERRORES } from '@/lib/errores'

function mensajePorModo(modo: string): string {
  return modo === 'SIN_LICENCIA'
    ? 'Es necesario activar el sistema. Cargá tu licencia desde Configuración → Licencia.'
    : 'Tu licencia venció. Cargá una licencia válida desde Configuración → Licencia para volver a operar.'
}

/**
 * Si el sistema está en modo BLOQUEADA o SIN_LICENCIA, tira ErrorAplicacion.
 * Para usar dentro de handlers envueltos con `manejarErrores`.
 */
export async function requireLicenciaActiva(): Promise<void> {
  const estado = await obtenerEstadoLicencia()
  if (estado.modo_solo_lectura) {
    throw new ErrorAplicacion(ERRORES.NEG_OPERACION_INVALIDA, {
      detalle: mensajePorModo(estado.modo),
      contexto: { modo: estado.modo },
    })
  }
}

/**
 * Si el sistema está bloqueado devuelve una NextResponse 422 lista para retornar.
 * Para usar en handlers con NextResponse manual (sin `manejarErrores`).
 *
 *   const bloqueo = await checkLicenciaActiva()
 *   if (bloqueo) return bloqueo
 */
export async function checkLicenciaActiva(): Promise<NextResponse | null> {
  const estado = await obtenerEstadoLicencia()
  if (!estado.modo_solo_lectura) return null
  return NextResponse.json(
    {
      ok: false,
      error: {
        codigo: 'ERR_NEG_002',
        mensaje: mensajePorModo(estado.modo),
      },
    },
    { status: 422 },
  )
}
