import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { cancelarRestauracion } from '@/lib/backup-restore'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  if (usuario.rol !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Acceso denegado' }, { status: 403 })
  }

  const { id } = await params
  const result = await cancelarRestauracion(id)
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}
