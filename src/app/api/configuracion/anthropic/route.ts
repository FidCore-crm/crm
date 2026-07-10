import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { encrypt, decrypt, isEncryptionAvailable } from '@/lib/encryption'
import {
  llamarClaude,
  refrescarCacheModelos,
  resolverModeloParaFamilia,
  type FamiliaModelo,
} from '@/lib/anthropic-client'

const FAMILIAS_VALIDAS: FamiliaModelo[] = ['sonnet', 'opus', 'haiku']

interface ConfigRow {
  id: string
  anthropic_api_key_encrypted: string | null
  anthropic_model: string | null
  anthropic_familia: FamiliaModelo | null
  anthropic_ultimo_test: string | null
  anthropic_ultimo_test_exitoso: boolean | null
  anthropic_tokens_usados_mes: number | null
  anthropic_llamadas_mes: number | null
  anthropic_reset_mes: string | null
  anthropic_uso_total_tokens: number | null
  anthropic_uso_total_costo: number | null
  modulo_ia_pdf_polizas_activo: boolean | null
}

const COLUMNAS_CONFIG =
  'id, anthropic_api_key_encrypted, anthropic_model, anthropic_familia, anthropic_ultimo_test, anthropic_ultimo_test_exitoso, anthropic_tokens_usados_mes, anthropic_llamadas_mes, anthropic_reset_mes, anthropic_uso_total_tokens, anthropic_uso_total_costo, modulo_ia_pdf_polizas_activo'

async function leerFila(): Promise<ConfigRow | null> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('configuracion')
    .select(COLUMNAS_CONFIG)
    .limit(1)
    .maybeSingle()
  return (data as ConfigRow) || null
}

async function obtenerOCrearFila(): Promise<ConfigRow> {
  const existente = await leerFila()
  if (existente) return existente
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('configuracion')
    .insert({ nombre: 'Mi Organización' } as any)
    .select(COLUMNAS_CONFIG)
    .single()
  if (error) throw new Error('Error al crear la configuración')
  return data as ConfigRow
}

function preview(key: string): string {
  if (!key || key.length < 12) return ''
  return `${key.slice(0, 7)}...${key.slice(-4)}`
}

// ============================================================
// GET — Estado de la configuración (sin key)
// ============================================================
export async function GET(request: Request) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  const row = await leerFila()

  const familia: FamiliaModelo = (row?.anthropic_familia as FamiliaModelo) || 'sonnet'
  const modeloResuelto = row?.anthropic_model || null

  if (!row || !row.anthropic_api_key_encrypted) {
    return NextResponse.json({
      ok: true,
      configurada: false,
      familia,
      modelo_resuelto: modeloResuelto,
      uso_total_tokens: Number(row?.anthropic_uso_total_tokens || 0),
      uso_total_costo_usd: Number(row?.anthropic_uso_total_costo || 0),
      uso_mes_tokens: Number(row?.anthropic_tokens_usados_mes || 0),
      uso_mes_llamadas: Number(row?.anthropic_llamadas_mes || 0),
      reset_mes: row?.anthropic_reset_mes || null,
      ultima_validacion: row?.anthropic_ultimo_test || null,
      ultima_validacion_ok: row?.anthropic_ultimo_test_exitoso ?? null,
      key_preview: null,
      modulo_ia_pdf_polizas_activo: !!row?.modulo_ia_pdf_polizas_activo,
    })
  }

  let keyPreview: string | null = null
  let configurada = true
  try {
    const k = decrypt(row.anthropic_api_key_encrypted)
    keyPreview = preview(k)
  } catch {
    keyPreview = null
    configurada = false
  }

  return NextResponse.json({
    ok: true,
    configurada,
    familia,
    modelo_resuelto: modeloResuelto,
    uso_total_tokens: Number(row.anthropic_uso_total_tokens || 0),
    uso_total_costo_usd: Number(row.anthropic_uso_total_costo || 0),
    uso_mes_tokens: Number(row.anthropic_tokens_usados_mes || 0),
    uso_mes_llamadas: Number(row.anthropic_llamadas_mes || 0),
    reset_mes: row.anthropic_reset_mes || null,
    ultima_validacion: row.anthropic_ultimo_test || null,
    ultima_validacion_ok: row.anthropic_ultimo_test_exitoso ?? null,
    key_preview: keyPreview,
    modulo_ia_pdf_polizas_activo: !!row.modulo_ia_pdf_polizas_activo,
  })
}

// ============================================================
// POST — Guardar/actualizar la API key + test inmediato
// ============================================================
export async function POST(request: Request) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  if (!isEncryptionAvailable()) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'ENCRYPTION_KEY no configurada en el servidor. No se puede guardar la API key.',
      },
      { status: 503 }
    )
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const apiKey: string = (body?.api_key || '').toString().trim()
  if (!apiKey.startsWith('sk-ant-')) {
    return NextResponse.json(
      { ok: false, error: 'La API key debe empezar con "sk-ant-".' },
      { status: 400 }
    )
  }
  if (apiKey.length < 40) {
    return NextResponse.json(
      { ok: false, error: 'La API key parece demasiado corta.' },
      { status: 400 }
    )
  }

  const supabase = getSupabaseAdmin()
  let fila: ConfigRow
  try {
    fila = await obtenerOCrearFila()
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: 'Error al preparar la configuración' },
      { status: 500 }
    )
  }

  const encrypted = encrypt(apiKey)

  const { error: errUpd } = await supabase
    .from('configuracion')
    .update({ anthropic_api_key_encrypted: encrypted } as any)
    .eq('id', fila.id)

  if (errUpd) {
    return NextResponse.json({ ok: false, error: 'Error al guardar los datos' }, { status: 500 })
  }

  // Test inmediato usando llamarClaude (ya lee la key recién guardada)
  const resultado = await llamarClaude({
    prompt: 'Hola, responde solo "OK".',
    max_tokens: 10,
  })

  const okTest = !!resultado.ok
  await supabase
    .from('configuracion')
    .update({
      anthropic_ultimo_test: new Date().toISOString(),
      anthropic_ultimo_test_exitoso: okTest,
    } as any)
    .eq('id', fila.id)

  return NextResponse.json({
    ok: true,
    test: okTest
      ? { ok: true }
      : { ok: false, error: resultado.error?.mensaje || 'Error desconocido' },
  })
}

// ============================================================
// DELETE — Borrar configuración (mantiene históricos)
// ============================================================
export async function DELETE(request: Request) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  const fila = await leerFila()
  if (!fila) {
    return NextResponse.json({ ok: true })
  }

  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('configuracion')
    .update({
      anthropic_api_key_encrypted: null,
      anthropic_ultimo_test: null,
      anthropic_ultimo_test_exitoso: null,
    } as any)
    .eq('id', fila.id)

  if (error) {
    return NextResponse.json({ ok: false, error: 'Error al actualizar los datos' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

// ============================================================
// PATCH — Cambiar familia de modelo y/o toggle de módulos
// ============================================================
export async function PATCH(request: Request) {
  const auth = await requireAdmin(request)
  if (auth instanceof NextResponse) return auth

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const patch: Record<string, any> = {}
  let familiaPedida: FamiliaModelo | null = null

  if (body?.familia !== undefined) {
    const familia = (body.familia || '').toString().trim().toLowerCase() as FamiliaModelo
    if (!FAMILIAS_VALIDAS.includes(familia)) {
      return NextResponse.json(
        { ok: false, error: `Familia inválida. Permitidas: ${FAMILIAS_VALIDAS.join(', ')}` },
        { status: 400 }
      )
    }
    patch.anthropic_familia = familia
    familiaPedida = familia
  }

  if (body?.modulo_ia_pdf_polizas_activo !== undefined) {
    patch.modulo_ia_pdf_polizas_activo = !!body.modulo_ia_pdf_polizas_activo
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'Nada para actualizar' }, { status: 400 })
  }

  let fila: ConfigRow
  try {
    fila = await obtenerOCrearFila()
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: 'Error al preparar la configuración' },
      { status: 500 }
    )
  }

  // Si el admin cambió la familia, resolvemos el ID concreto al momento
  // para actualizar anthropic_model de una. Esto también sirve para
  // detectar temprano si la familia pedida no tiene modelos vigentes.
  if (familiaPedida) {
    try {
      const id = await resolverModeloParaFamilia(familiaPedida)
      patch.anthropic_model = id
    } catch (e: any) {
      // Si el cache está vacío (primer setup), intentamos refrescar y reintentar.
      const refresh = await refrescarCacheModelos()
      if (refresh.ok) {
        try {
          const id = await resolverModeloParaFamilia(familiaPedida)
          patch.anthropic_model = id
        } catch {
          return NextResponse.json(
            {
              ok: false,
              error: `La familia "${familiaPedida}" no tiene modelos vigentes en Anthropic. Revisá console.anthropic.com.`,
            },
            { status: 422 }
          )
        }
      } else {
        // Si no pudimos refrescar (ej. no hay key todavía), guardamos la
        // familia sin resolver el modelo — se resolverá al primer uso real.
      }
    }
  }

  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('configuracion')
    .update(patch as any)
    .eq('id', fila.id)

  if (error) {
    return NextResponse.json({ ok: false, error: 'Error al actualizar los datos' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, ...patch })
}
