import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { checkModuloPDFActivo } from '@/lib/agente-pdf/check-modulo-activo'

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const estado = await checkModuloPDFActivo()
  return NextResponse.json({ ok: true, ...estado })
}
