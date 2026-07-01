import Anthropic from '@anthropic-ai/sdk'
import { decrypt } from './encryption'
import { getSupabaseAdmin } from './supabase/server'
import { logger } from '@/lib/errores'

const COSTO_INPUT_POR_MTOK = 3
const COSTO_OUTPUT_POR_MTOK = 15

// Familia por defecto si no hay nada configurado (PAS nuevo, sin setup).
// Es sólo un fallback; el setup interactivo guarda la elección del admin.
const FAMILIA_DEFAULT: FamiliaModelo = 'sonnet'

// Cuánto puede tener el cache antes de considerarlo stale y refrescarse
// de forma sincrónica cuando alguien pide un modelo.
const CACHE_STALE_MS = 7 * 24 * 60 * 60 * 1000 // 7 días

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type FamiliaModelo = 'sonnet' | 'opus' | 'haiku'

export type TipoError =
  | 'NO_CONFIGURED'
  | 'INVALID_KEY'
  | 'RATE_LIMIT'
  | 'INSUFFICIENT_QUOTA'
  | 'SERVER_ERROR'
  | 'INVALID_RESPONSE'
  | 'TIMEOUT'
  | 'MODEL_DISCONTINUED'
  | 'NO_MODELS_AVAILABLE'
  | 'UNKNOWN'

/**
 * Errores "permanentes" que requieren acción humana (cargar créditos,
 * renovar API key). Los callers deben fallar rápido sin reintentar.
 *
 * MODEL_DISCONTINUED NO está acá: el CRM se auto-repara cambiando de modelo.
 */
export const TIPOS_ERROR_PERMANENTE: ReadonlySet<TipoError> = new Set<TipoError>([
  'NO_CONFIGURED',
  'INVALID_KEY',
  'INSUFFICIENT_QUOTA',
  'NO_MODELS_AVAILABLE',
])

export function esErrorPermanente(tipo: TipoError | undefined): boolean {
  return tipo ? TIPOS_ERROR_PERMANENTE.has(tipo) : false
}

export const PREFIJO_ERROR_FATAL = '[ANTHROPIC_FATAL:'

export function marcarErrorFatal(tipo: TipoError, mensaje: string): string {
  return `${PREFIJO_ERROR_FATAL}${tipo}] ${mensaje}`
}

export function parsearErrorFatal(
  mensaje: string
): { tipo: TipoError; mensaje: string } | null {
  const match = mensaje.match(/^\[ANTHROPIC_FATAL:([A-Z_]+)\]\s*([\s\S]*)$/)
  if (!match) return null
  return { tipo: match[1] as TipoError, mensaje: match[2] }
}

export interface ResultadoLlamadaClaude {
  ok: boolean
  data?: string
  json?: any
  error?: { tipo: TipoError; mensaje: string }
  tokens_input?: number
  tokens_output?: number
  tokens_total?: number
  costo_estimado_usd?: number
  modelo_usado?: string
}

export interface ModeloCache {
  id: string
  display_name: string | null
  familia: FamiliaModelo | null
  created_at: string | null
  deprecated_at: string | null
  refreshed_at: string
}

interface ConfigRow {
  id: string
  anthropic_api_key_encrypted: string | null
  anthropic_model: string | null
  anthropic_familia: FamiliaModelo | null
  anthropic_reset_mes: string | null
  anthropic_tokens_usados_mes: number | null
  anthropic_llamadas_mes: number | null
}

// ---------------------------------------------------------------------------
// Config / key
// ---------------------------------------------------------------------------

// IMPORTANTE: siempre incluir `id` en el select. Sin el PK, @supabase/supabase-js
// devuelve null/0 en ciertas combinaciones de columnas en tablas singleton.
async function leerConfig(): Promise<ConfigRow | null> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('configuracion')
    .select(
      'id, anthropic_api_key_encrypted, anthropic_model, anthropic_familia, anthropic_reset_mes, anthropic_tokens_usados_mes, anthropic_llamadas_mes'
    )
    .limit(1)
    .maybeSingle()
  if (error) return null
  return (data as ConfigRow) || null
}

export async function obtenerApiKey(): Promise<string | null> {
  try {
    const config = await leerConfig()
    if (config?.anthropic_api_key_encrypted) {
      try {
        const key = decrypt(config.anthropic_api_key_encrypted)
        if (key && key.trim().length > 0) return key
      } catch {
        // sigue al fallback
      }
    }
    const fallback = process.env.ANTHROPIC_API_KEY_DEFAULT
    if (fallback && fallback.trim().length > 0) return fallback
    return null
  } catch {
    return null
  }
}

export async function isAnthropicConfigured(): Promise<boolean> {
  const key = await obtenerApiKey()
  return key !== null
}

export async function obtenerFamiliaConfigurada(): Promise<FamiliaModelo> {
  const config = await leerConfig()
  return config?.anthropic_familia || FAMILIA_DEFAULT
}

// ---------------------------------------------------------------------------
// Cache de modelos vivos
// ---------------------------------------------------------------------------

export function inferirFamilia(modeloId: string): FamiliaModelo | null {
  const id = modeloId.toLowerCase()
  if (id.includes('sonnet')) return 'sonnet'
  if (id.includes('opus')) return 'opus'
  if (id.includes('haiku')) return 'haiku'
  return null
}

export async function listarCacheModelos(): Promise<ModeloCache[]> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('anthropic_modelos_cache')
    .select('id, display_name, familia, created_at, deprecated_at, refreshed_at')
    .order('created_at', { ascending: false })
  return (data as ModeloCache[]) || []
}

/**
 * Llama a /v1/models y hace upsert en anthropic_modelos_cache.
 * Los modelos que ya no aparecen en la respuesta se marcan con
 * deprecated_at = NOW para que el resolver los descarte.
 */
export async function refrescarCacheModelos(): Promise<{
  ok: boolean
  agregados: number
  actualizados: number
  deprecados: number
  error?: string
}> {
  const apiKey = await obtenerApiKey()
  if (!apiKey) {
    return { ok: false, agregados: 0, actualizados: 0, deprecados: 0, error: 'NO_CONFIGURED' }
  }

  // Anthropic pagina con `has_more`/`last_id`. 20 por página alcanza sobrado
  // para el catálogo actual (<10 modelos) pero iteramos por si crece.
  let modelos: Array<{ id: string; display_name?: string; created_at?: string }> = []
  let after: string | undefined
  try {
    for (let i = 0; i < 10; i++) {
      const qs = new URLSearchParams({ limit: '100' })
      if (after) qs.set('after_id', after)
      const res = await fetch(`https://api.anthropic.com/v1/models?${qs}`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return {
          ok: false,
          agregados: 0,
          actualizados: 0,
          deprecados: 0,
          error: `HTTP ${res.status} ${body.slice(0, 200)}`,
        }
      }
      const json: any = await res.json()
      const data = Array.isArray(json?.data) ? json.data : []
      modelos = modelos.concat(data)
      if (!json?.has_more || data.length === 0) break
      after = data[data.length - 1]?.id
      if (!after) break
    }
  } catch (e) {
    return {
      ok: false,
      agregados: 0,
      actualizados: 0,
      deprecados: 0,
      error: `Error de red: ${String(e)}`,
    }
  }

  if (modelos.length === 0) {
    return { ok: false, agregados: 0, actualizados: 0, deprecados: 0, error: 'Respuesta vacía de /v1/models' }
  }

  const supabase = getSupabaseAdmin()
  const idsActuales = new Set(modelos.map((m) => m.id))

  // Upsert de los modelos vigentes. `deprecated_at = null` limpia el flag
  // si un modelo que habíamos marcado como obsoleto volvió a aparecer.
  const filas = modelos.map((m) => ({
    id: m.id,
    display_name: m.display_name || null,
    familia: inferirFamilia(m.id),
    created_at: m.created_at || null,
    deprecated_at: null,
    refreshed_at: new Date().toISOString(),
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpsert } = await (supabase.from('anthropic_modelos_cache') as any)
    .upsert(filas, { onConflict: 'id' })

  if (errUpsert) {
    return {
      ok: false,
      agregados: 0,
      actualizados: 0,
      deprecados: 0,
      error: `Error al persistir cache: ${errUpsert.message || 'desconocido'}`,
    }
  }

  // Marcar como deprecados los que NO aparecieron en la respuesta (antes estaban
  // vigentes en el cache pero desaparecieron del catálogo de Anthropic).
  const { data: existentes } = await supabase
    .from('anthropic_modelos_cache')
    .select('id, deprecated_at')

  const existentesList = (existentes as Array<{ id: string; deprecated_at: string | null }> | null) || []
  const aDeprecar = existentesList
    .filter((e) => !idsActuales.has(e.id) && !e.deprecated_at)
    .map((e) => e.id)

  let deprecados = 0
  if (aDeprecar.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: errDep } = await (supabase.from('anthropic_modelos_cache') as any)
      .update({ deprecated_at: new Date().toISOString() })
      .in('id', aDeprecar)
    if (!errDep) deprecados = aDeprecar.length
  }

  return {
    ok: true,
    agregados: filas.length,
    actualizados: filas.length,
    deprecados,
  }
}

// ---------------------------------------------------------------------------
// Resolver: familia → ID concreto
// ---------------------------------------------------------------------------

export class ErrorSinModelosEnFamilia extends Error {
  familia: FamiliaModelo
  constructor(familia: FamiliaModelo) {
    super(
      `No hay modelos vigentes de la familia "${familia}" en el catálogo de Anthropic. Revisá console.anthropic.com y actualizá el sistema.`
    )
    this.familia = familia
    this.name = 'ErrorSinModelosEnFamilia'
  }
}

/**
 * Devuelve el ID del modelo más reciente vigente para una familia.
 * Si el cache está vacío o stale (>7 días), lo refresca sincrónicamente.
 * Tira ErrorSinModelosEnFamilia si no encuentra ninguno — el caller decide
 * si caer a un modelo cableado por contingencia o propagar.
 */
export async function resolverModeloParaFamilia(
  familia: FamiliaModelo
): Promise<string> {
  let modelos = await listarCacheModelos()

  const cacheNecesitaRefresh =
    modelos.length === 0 ||
    modelos.every(
      (m) => Date.now() - new Date(m.refreshed_at).getTime() > CACHE_STALE_MS
    )

  if (cacheNecesitaRefresh) {
    await refrescarCacheModelos()
    modelos = await listarCacheModelos()
  }

  const candidatos = modelos
    .filter((m) => m.familia === familia)
    .filter((m) => !m.deprecated_at)
    .sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      return tb - ta
    })

  if (candidatos.length === 0) {
    throw new ErrorSinModelosEnFamilia(familia)
  }

  return candidatos[0].id
}

/**
 * Resuelve el modelo para la familia configurada y, si cambió respecto al
 * valor guardado, actualiza `configuracion.anthropic_model`. Devuelve el ID
 * resuelto y si hubo cambio.
 *
 * Si no encuentra modelos en la familia configurada, loggea + devuelve
 * null para que el caller decida (p.ej., fallback al último ID conocido).
 */
export async function obtenerModelo(): Promise<string> {
  const familia = await obtenerFamiliaConfigurada()
  try {
    const id = await resolverModeloParaFamilia(familia)
    const config = await leerConfig()
    if (config && config.anthropic_model !== id) {
      const supabase = getSupabaseAdmin()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('configuracion') as any)
        .update({ anthropic_model: id })
        .eq('id', config.id)
      logger.info({
        modulo: 'anthropic-client',
        mensaje: 'anthropic_model actualizado desde resolver',
        contexto: { anterior: config.anthropic_model, nuevo: id, familia },
      })
    }
    return id
  } catch (e) {
    // Contingencia: si no podemos resolver, usamos lo que esté guardado
    // en configuracion (último ID conocido) aunque pueda estar obsoleto.
    // El catch posterior en llamarClaude intentará auto-sustituir.
    const config = await leerConfig()
    if (config?.anthropic_model) {
      logger.warn({
        modulo: 'anthropic-client',
        mensaje: 'Resolver falló, usando anthropic_model guardado como fallback',
        contexto: { familia, error: String(e), fallback: config.anthropic_model },
      })
      return config.anthropic_model
    }
    throw e
  }
}

/**
 * Después de una llamada que falló con MODEL_DISCONTINUED, refresca el cache
 * y resuelve un modelo nuevo para la familia configurada. Si lo encuentra,
 * actualiza configuracion.anthropic_model y devuelve el ID nuevo.
 *
 * Retorna null si no hay forma de recuperarse (familia vacía, refresh falló).
 */
export async function autoSustituirModelo(
  modeloDiscontinuado: string
): Promise<{ modelo_nuevo: string; familia: FamiliaModelo; modelo_viejo: string } | null> {
  const familia = await obtenerFamiliaConfigurada()
  const refresh = await refrescarCacheModelos()
  if (!refresh.ok) {
    logger.error({
      modulo: 'anthropic-client',
      mensaje: 'autoSustituirModelo: refresh del cache falló',
      contexto: { error: refresh.error, modeloDiscontinuado },
    })
    return null
  }

  try {
    const nuevo = await resolverModeloParaFamilia(familia)
    if (nuevo === modeloDiscontinuado) {
      // Extremadamente raro: Anthropic devolvió 404 pero el modelo sigue listado.
      logger.warn({
        modulo: 'anthropic-client',
        mensaje: 'autoSustituirModelo: el modelo discontinuado sigue en /v1/models',
        contexto: { modelo: modeloDiscontinuado, familia },
      })
      return null
    }
    const config = await leerConfig()
    if (config) {
      const supabase = getSupabaseAdmin()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('configuracion') as any)
        .update({ anthropic_model: nuevo })
        .eq('id', config.id)
    }
    return { modelo_nuevo: nuevo, familia, modelo_viejo: modeloDiscontinuado }
  } catch (e) {
    logger.error({
      modulo: 'anthropic-client',
      mensaje: 'autoSustituirModelo: no se pudo resolver familia',
      contexto: { familia, error: String(e) },
    })
    return null
  }
}

// ---------------------------------------------------------------------------
// Registro de uso
// ---------------------------------------------------------------------------

/**
 * Registra el uso de tokens y costo en la tabla `configuracion`.
 * Exportado para que módulos con SDK directo (agente-pdf) puedan reportar
 * consumos a las mismas estadísticas.
 */
export async function registrarUso(
  tokensInput: number,
  tokensOutput: number,
  costoUsd: number,
  modelo?: string
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('configuracion')
      .select(
        'id, anthropic_reset_mes, anthropic_tokens_usados_mes, anthropic_llamadas_mes, anthropic_uso_total_tokens, anthropic_uso_total_costo'
      )
      .limit(1)
      .maybeSingle()

    if (!data) return

    const row = data as {
      id: string
      anthropic_reset_mes: string | null
      anthropic_tokens_usados_mes: number | null
      anthropic_llamadas_mes: number | null
      anthropic_uso_total_tokens: number | null
      anthropic_uso_total_costo: number | null
    }

    const now = new Date()
    const primerDiaMes = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const primerDiaIso = primerDiaMes.toISOString().slice(0, 10)

    let tokensBase = row.anthropic_tokens_usados_mes || 0
    let llamadasBase = row.anthropic_llamadas_mes || 0
    let resetMes = row.anthropic_reset_mes

    const debeResetear =
      !resetMes || new Date(resetMes).getTime() < primerDiaMes.getTime()

    if (debeResetear) {
      tokensBase = 0
      llamadasBase = 0
      resetMes = primerDiaIso
    }

    const totalTokens = Number(row.anthropic_uso_total_tokens || 0)
    const totalCosto = Number(row.anthropic_uso_total_costo || 0)
    const deltaTokens = tokensInput + tokensOutput

    await supabase
      .from('configuracion')
      .update({
        anthropic_tokens_usados_mes: tokensBase + deltaTokens,
        anthropic_llamadas_mes: llamadasBase + 1,
        anthropic_reset_mes: resetMes,
        anthropic_uso_total_tokens: totalTokens + deltaTokens,
        anthropic_uso_total_costo: Number((totalCosto + costoUsd).toFixed(4)),
      } as any)
      .eq('id', row.id)
  } catch (e) {
    logger.error({ modulo: 'anthropic-client', mensaje: 'Error al registrar uso', contexto: { error: String(e) } })
  }
}

// ---------------------------------------------------------------------------
// Mapeo de errores SDK
// ---------------------------------------------------------------------------

function mapearErrorSdk(err: any): { tipo: TipoError; mensaje: string } {
  const status = err?.status ?? err?.response?.status
  const errorType = err?.error?.error?.type || err?.error?.type
  const errorMessage: string =
    err?.error?.error?.message || err?.error?.message || err?.message || ''

  if (err?.name === 'AbortError' || /timeout/i.test(err?.message || '')) {
    return { tipo: 'TIMEOUT', mensaje: 'La llamada a Claude excedió el tiempo máximo.' }
  }
  if (status === 401) {
    return { tipo: 'INVALID_KEY', mensaje: 'La API key de Anthropic es inválida o fue revocada.' }
  }
  // Créditos agotados: Anthropic devuelve 400 con invalid_request_error y
  // el mensaje "Your credit balance is too low...". Detectarlo acá evita
  // que caiga como UNKNOWN y que se reintente inútilmente.
  if (
    status === 400 &&
    errorType === 'invalid_request_error' &&
    /credit balance is too low/i.test(errorMessage)
  ) {
    return {
      tipo: 'INSUFFICIENT_QUOTA',
      mensaje:
        'La cuenta de Anthropic no tiene crédito suficiente. Cargá créditos en console.anthropic.com/settings/billing.',
    }
  }
  // Modelo discontinuado: Anthropic devuelve 404 con not_found_error y
  // "model: <id>". El sistema se auto-repara (autoSustituirModelo) sin
  // intervención humana.
  if (
    status === 404 &&
    errorType === 'not_found_error' &&
    /model:/i.test(errorMessage)
  ) {
    return {
      tipo: 'MODEL_DISCONTINUED',
      mensaje: errorMessage || 'El modelo de Claude ya no está disponible en Anthropic.',
    }
  }
  if (status === 403 && /permission/i.test(errorMessage)) {
    return { tipo: 'INVALID_KEY', mensaje: 'La API key de Anthropic no tiene permisos para este recurso.' }
  }
  if (status === 429) {
    if (errorType === 'insufficient_quota') {
      return {
        tipo: 'INSUFFICIENT_QUOTA',
        mensaje: 'La cuenta de Anthropic no tiene crédito suficiente.',
      }
    }
    return {
      tipo: 'RATE_LIMIT',
      mensaje: 'Se excedió el límite de llamadas a Claude. Reintentá en unos segundos.',
    }
  }
  if (typeof status === 'number' && status >= 500 && status < 600) {
    return {
      tipo: 'SERVER_ERROR',
      mensaje: 'Los servidores de Anthropic están con problemas. Reintentá más tarde.',
    }
  }
  return {
    tipo: 'UNKNOWN',
    mensaje: err?.message || 'Error desconocido al llamar a Claude.',
  }
}

function esReintentable(err: any): boolean {
  const status = err?.status ?? err?.response?.status
  const errorType = err?.error?.error?.type || err?.error?.type
  const errorMessage: string =
    err?.error?.error?.message || err?.error?.message || err?.message || ''
  // 400 con credit balance → permanente, no reintentar
  if (
    status === 400 &&
    errorType === 'invalid_request_error' &&
    /credit balance is too low/i.test(errorMessage)
  ) {
    return false
  }
  // 404 con modelo inválido → no reintentar con el mismo modelo
  // (llamarClaude intenta auto-sustituir una vez)
  if (status === 404 && errorType === 'not_found_error' && /model:/i.test(errorMessage)) {
    return false
  }
  if (status === 429 && errorType !== 'insufficient_quota') return true
  if (status === 529) return true
  if (typeof status === 'number' && status >= 500 && status < 600) return true
  if (err?.name === 'AbortError') return true
  return false
}

function extraerJson(texto: string): any {
  let limpio = texto.trim()
  const fence = limpio.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence) limpio = fence[1].trim()
  return JSON.parse(limpio)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// llamarClaude con auto-sustitución
// ---------------------------------------------------------------------------

export async function llamarClaude(params: {
  prompt: string | Array<{ role: 'user' | 'assistant'; content: string }>
  system?: string
  max_tokens?: number
  temperature?: number
  modelo?: string
  max_retries?: number
  response_format?: 'text' | 'json'
}): Promise<ResultadoLlamadaClaude> {
  const apiKey = await obtenerApiKey()
  if (!apiKey) {
    return {
      ok: false,
      error: {
        tipo: 'NO_CONFIGURED',
        mensaje: 'No hay API key de Anthropic configurada.',
      },
    }
  }

  // Si el caller no forzó un modelo, resolvemos la familia configurada al
  // ID vigente. Si el caller forzó uno, lo respetamos (p.ej. el test admin
  // que siempre usa Haiku para abaratar).
  let modelo: string
  try {
    modelo = params.modelo || (await obtenerModelo())
  } catch (e) {
    if (e instanceof ErrorSinModelosEnFamilia) {
      return {
        ok: false,
        error: { tipo: 'NO_MODELS_AVAILABLE', mensaje: e.message },
      }
    }
    throw e
  }

  const maxTokens = params.max_tokens ?? 4096
  const temperature = params.temperature ?? 0
  const maxRetries = params.max_retries ?? 3
  const responseFormat = params.response_format ?? 'text'

  let systemPrompt = params.system
  if (responseFormat === 'json') {
    const instruccion =
      'Respondé únicamente con JSON válido, sin comentarios, sin texto adicional y sin fences de código markdown.'
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${instruccion}` : instruccion
  }

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> =
    typeof params.prompt === 'string'
      ? [{ role: 'user', content: params.prompt }]
      : params.prompt

  const client = new Anthropic({ apiKey })

  let intento = 0
  let yaSustituyo = false
  let sinTemperature = false  // se activa si el modelo rechaza temperature
  let ultimoError: any = null

  while (intento <= maxRetries) {
    try {
      // Los modelos más nuevos de Anthropic (ej: claude-sonnet-5) rechazan
      // el parámetro `temperature` con "temperature is deprecated for this
      // model". La primera pasada lo incluye; si falla con ese mensaje, se
      // activa `sinTemperature` y reintentamos sin él (default del modelo).
      const requestBody: any = {
        model: modelo,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      }
      if (!sinTemperature) requestBody.temperature = temperature

      const respuesta = await client.messages.create(requestBody)

      const bloques = respuesta.content || []
      const texto = bloques
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')

      const tokensInput = respuesta.usage?.input_tokens ?? 0
      const tokensOutput = respuesta.usage?.output_tokens ?? 0
      const costo =
        (tokensInput / 1_000_000) * COSTO_INPUT_POR_MTOK +
        (tokensOutput / 1_000_000) * COSTO_OUTPUT_POR_MTOK

      await registrarUso(tokensInput, tokensOutput, costo)

      if (responseFormat === 'json') {
        try {
          const json = extraerJson(texto)
          return {
            ok: true,
            data: texto,
            json,
            tokens_input: tokensInput,
            tokens_output: tokensOutput,
            tokens_total: tokensInput + tokensOutput,
            costo_estimado_usd: costo,
            modelo_usado: modelo,
          }
        } catch (e: any) {
          return {
            ok: false,
            error: {
              tipo: 'INVALID_RESPONSE',
              mensaje: `Claude devolvió una respuesta que no es JSON válido: ${e?.message || 'parse error'}`,
            },
            data: texto,
            tokens_input: tokensInput,
            tokens_output: tokensOutput,
            tokens_total: tokensInput + tokensOutput,
            costo_estimado_usd: costo,
            modelo_usado: modelo,
          }
        }
      }

      return {
        ok: true,
        data: texto,
        tokens_input: tokensInput,
        tokens_output: tokensOutput,
        tokens_total: tokensInput + tokensOutput,
        costo_estimado_usd: costo,
        modelo_usado: modelo,
      }
    } catch (err: any) {
      ultimoError = err
      const mapeado = mapearErrorSdk(err)

      // "temperature is deprecated for this model" — modelos nuevos de
      // Anthropic (ej: claude-sonnet-5) rechazan el parámetro. Reintentamos
      // sin él una sola vez.
      const errorMsgTemp: string = err?.error?.error?.message || err?.message || ''
      if (!sinTemperature && /temperature.*deprecated/i.test(errorMsgTemp)) {
        sinTemperature = true
        logger.warn({
          modulo: 'anthropic-client',
          mensaje: 'Modelo rechazó temperature — reintento sin ese parámetro',
          contexto: { modelo },
        })
        continue // retry sin incrementar `intento`
      }

      // Auto-sustitución transparente: si Anthropic dice que el modelo
      // no existe y todavía no intentamos cambiarlo, refrescamos el
      // cache y resolvemos a uno vigente. El caller no se entera.
      if (mapeado.tipo === 'MODEL_DISCONTINUED' && !yaSustituyo && !params.modelo) {
        yaSustituyo = true
        const sust = await autoSustituirModelo(modelo)
        if (sust) {
          logger.warn({
            modulo: 'anthropic-client',
            mensaje: 'Auto-sustitución de modelo discontinuado',
            contexto: {
              modelo_viejo: sust.modelo_viejo,
              modelo_nuevo: sust.modelo_nuevo,
              familia: sust.familia,
            },
          })
          modelo = sust.modelo_nuevo
          continue // retry con el modelo nuevo, sin incrementar `intento`
        }
      }

      if (intento < maxRetries && esReintentable(err)) {
        const espera = 1000 * Math.pow(2, intento)
        await delay(espera)
        intento++
        continue
      }
      return { ok: false, error: mapeado, modelo_usado: modelo }
    }
  }

  return { ok: false, error: mapearErrorSdk(ultimoError), modelo_usado: modelo }
}
