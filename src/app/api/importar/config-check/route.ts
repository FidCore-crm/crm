import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { isAnthropicConfigured } from '@/lib/anthropic-client'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const configurada = await isAnthropicConfigured()
  return NextResponse.json({ ok: true, configurada })
}
