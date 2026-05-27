import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'

const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64')

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  try {
    const supabase = getSupabaseAdmin()
    const { data: envio } = await supabase
      .from('email_envios')
      .select('id, fecha_apertura, cantidad_aperturas')
      .eq('token_tracking', token)
      .maybeSingle()

    if (envio) {
      const updates: Record<string, any> = {
        cantidad_aperturas: ((envio as any).cantidad_aperturas || 0) + 1,
      }
      if (!(envio as any).fecha_apertura) {
        updates.fecha_apertura = new Date().toISOString()
      }
      await supabase
        .from('email_envios')
        .update(updates)
        .eq('id', (envio as any).id)
    }
  } catch {
    // No revelar errores
  }

  return new Response(PIXEL_GIF, {
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': PIXEL_GIF.length.toString(),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    },
  })
}
