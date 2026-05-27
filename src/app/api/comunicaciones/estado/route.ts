import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { sistemaComunicacionesActivo } from '@/lib/acceso-comunicaciones'

export async function GET(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }

  const activo = await sistemaComunicacionesActivo()
  return NextResponse.json({ ok: true, activo })
}
