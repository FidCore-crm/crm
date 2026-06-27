import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { invalidarCacheVariablesOrganizacion } from '@/lib/email-variables'

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth
  invalidarCacheVariablesOrganizacion()
  return NextResponse.json({ ok: true })
}
