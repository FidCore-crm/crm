import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { decrypt } from '@/lib/encryption'

type TipoError =
  | 'NO_CONFIGURED'
  | 'INVALID_KEY'
  | 'INSUFFICIENT_QUOTA'
  | 'RATE_LIMIT'
  | 'NETWORK'
  | 'UNKNOWN'

function mapearError(err: any): { tipo: TipoError; mensaje: string } {
  const status = err?.status ?? err?.response?.status
  const errorType = err?.error?.error?.type || err?.error?.type

  if (status === 401) {
    return {
      tipo: 'INVALID_KEY',
      mensaje: 'La API key es inválida o fue revocada.',
    }
  }
  if (status === 429) {
    if (errorType === 'insufficient_quota') {
      return {
        tipo: 'INSUFFICIENT_QUOTA',
        mensaje: 'La cuenta no tiene crédito suficiente.',
      }
    }
    return {
      tipo: 'RATE_LIMIT',
      mensaje: 'Se excedió el límite de llamadas. Reintentá en unos segundos.',
    }
  }
  if (err?.name === 'AbortError' || /fetch|network|ENOTFOUND|ETIMEDOUT/i.test(err?.message || '')) {
    return {
      tipo: 'NETWORK',
      mensaje: 'Error de red al contactar con Anthropic.',
    }
  }
  return {
    tipo: 'UNKNOWN',
    mensaje: err?.message || 'Error desconocido al contactar con Anthropic.',
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  let body: any = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const keyCustom: string | undefined = body?.api_key
    ? body.api_key.toString().trim()
    : undefined

  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('configuracion')
    .select('id, anthropic_api_key_encrypted')
    .limit(1)
    .maybeSingle()

  const fila = data as { id: string; anthropic_api_key_encrypted: string | null } | null

  let keyAUsar: string | null = null
  let usoKeyGuardada = false

  if (keyCustom) {
    keyAUsar = keyCustom
  } else if (fila?.anthropic_api_key_encrypted) {
    try {
      keyAUsar = decrypt(fila.anthropic_api_key_encrypted)
      usoKeyGuardada = true
    } catch {
      keyAUsar = null
    }
  }

  if (!keyAUsar) {
    return NextResponse.json({
      ok: false,
      error: {
        tipo: 'NO_CONFIGURED' as TipoError,
        mensaje: 'No hay API key configurada.',
      },
    })
  }

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: keyAUsar })
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Responde solo "OK".' }],
    })

    const tokensInput = response.usage?.input_tokens ?? 0
    const tokensOutput = response.usage?.output_tokens ?? 0

    if (usoKeyGuardada && fila) {
      await supabase
        .from('configuracion')
        .update({
          anthropic_ultimo_test: new Date().toISOString(),
          anthropic_ultimo_test_exitoso: true,
        } as any)
        .eq('id', fila.id)
    }

    return NextResponse.json({
      ok: true,
      mensaje: 'Conexión exitosa',
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
    })
  } catch (err: any) {
    const error = mapearError(err)

    if (usoKeyGuardada && fila) {
      await supabase
        .from('configuracion')
        .update({
          anthropic_ultimo_test: new Date().toISOString(),
          anthropic_ultimo_test_exitoso: false,
        } as any)
        .eq('id', fila.id)
    }

    return NextResponse.json({ ok: false, error })
  }
}
