import { NextResponse } from 'next/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { ejecutarJobsPendientes } from '@/lib/importacion/job-runner'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  try {
    const result = await ejecutarJobsPendientes()
    return NextResponse.json({
      ok: true,
      procesados: result.procesados,
      fallidos: result.fallidos,
      en_cola: result.en_cola,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'Error interno del servidor' }, { status: 500 })
  }
}
