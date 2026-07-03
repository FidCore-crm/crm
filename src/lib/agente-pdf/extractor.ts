// ============================================================
// Extractor IA — lee un PDF y devuelve datos estructurados
// ============================================================
//
// Usa el SDK de Anthropic directamente porque `llamarClaude` solo
// soporta prompts de texto. El SDK acepta bloques `document` con
// PDFs en base64 para extracción nativa sin OCR previo.
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { readFile } from 'fs/promises'
import {
  obtenerApiKey,
  obtenerModelo,
  registrarUso,
  autoSustituirModelo,
  resolverModeloParaFamilia,
  type FamiliaModelo,
} from '@/lib/anthropic-client'
import { logger } from '@/lib/errores'
import { TIPOS_RIESGO } from '@/lib/tipos-riesgo'
import type {
  TipoOperacionPDF,
  DatosExtraidosPoliza,
  DatosExtraidosEndoso,
} from './types'

const COSTO_INPUT_POR_MTOK = 3
const COSTO_OUTPUT_POR_MTOK = 15

/**
 * Extrae y parsea un JSON devuelto por Claude. Maneja:
 *   - Fences de markdown ```json ... ```
 *   - Basura alrededor del JSON (la IA a veces agrega texto de cortesía
 *     a pesar del prompt).
 *   - JSON vacío o no-objeto (tira error descriptivo).
 * Si el parseo falla, re-tira un Error con un prefijo predecible para
 * que el caller pueda distinguirlo de otros fallos.
 */
function extraerJson(texto: string): Record<string, unknown> {
  if (!texto || typeof texto !== 'string' || !texto.trim()) {
    throw new Error('La IA devolvió una respuesta vacía')
  }
  let limpio = texto.trim()

  // 1. Fence explícito al principio y final: ```json\n...\n```
  const fence = limpio.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence) limpio = fence[1].trim()

  // 2. Si aun así hay texto antes/después del JSON, recortar desde el primer
  // `{` hasta el último `}` que cierre balanceado.
  if (!limpio.startsWith('{')) {
    const idxInicio = limpio.indexOf('{')
    const idxFin = limpio.lastIndexOf('}')
    if (idxInicio >= 0 && idxFin > idxInicio) {
      limpio = limpio.slice(idxInicio, idxFin + 1)
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(limpio)
  } catch (err: any) {
    throw new Error(
      `La IA devolvió un JSON malformado (${err?.message || 'parse error'}). Primeros 200 caracteres: ${limpio.slice(0, 200)}`,
    )
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('La IA devolvió un valor que no es un objeto JSON')
  }

  return parsed as Record<string, unknown>
}

/**
 * Valida mínimamente que el objeto devuelto por la IA para una póliza tenga
 * la forma esperada: keys obligatorias presentes (aunque sean null), sin
 * requerir campos puntuales (esos se validan después en validador.ts).
 */
function validarEstructuraPoliza(datos: Record<string, unknown>): void {
  const keysEsperadas = ['asegurado', 'poliza', 'catalogos_pdf', 'riesgo']
  const faltantes = keysEsperadas.filter((k) => !(k in datos))
  if (faltantes.length > 0) {
    throw new Error(
      `La IA devolvió un JSON incompleto. Faltan secciones: ${faltantes.join(', ')}`,
    )
  }
  if (datos.poliza !== null && (typeof datos.poliza !== 'object' || Array.isArray(datos.poliza))) {
    throw new Error('La IA devolvió `poliza` con un tipo inválido')
  }
  if (datos.asegurado !== null && (typeof datos.asegurado !== 'object' || Array.isArray(datos.asegurado))) {
    throw new Error('La IA devolvió `asegurado` con un tipo inválido')
  }
  if (datos.riesgo !== null && (typeof datos.riesgo !== 'object' || Array.isArray(datos.riesgo))) {
    throw new Error('La IA devolvió `riesgo` con un tipo inválido')
  }
  if (datos.catalogos_pdf !== null && (typeof datos.catalogos_pdf !== 'object' || Array.isArray(datos.catalogos_pdf))) {
    throw new Error('La IA devolvió `catalogos_pdf` con un tipo inválido')
  }
}

function validarEstructuraEndoso(datos: Record<string, unknown>): void {
  const keysEsperadas = ['motivo']
  const faltantes = keysEsperadas.filter((k) => !(k in datos))
  if (faltantes.length > 0) {
    throw new Error(
      `La IA devolvió un JSON de endoso incompleto. Faltan: ${faltantes.join(', ')}`,
    )
  }
}

/**
 * Traduce los errores del SDK de Anthropic y del parseo a mensajes útiles
 * para el PAS. Evita que llegue un "Error desconocido" a la notificación.
 */
function traducirErrorExtractor(err: any): string {
  const mensajeCrudo: string =
    err?.error?.error?.message || err?.message || String(err) || ''
  const msg = mensajeCrudo.toLowerCase()

  if (/password|encrypted|encriptado|protegido/.test(msg)) {
    return 'El PDF está protegido con contraseña. Guardalo sin protección e intentá de nuevo.'
  }
  if (/corrupt|invalid pdf|malformed|could not parse pdf/.test(msg)) {
    return 'El PDF parece estar corrupto o incompleto. Probá con otro archivo.'
  }
  if (/pages|too many|too large|exceed/.test(msg) && /pdf|document/.test(msg)) {
    return 'El PDF es demasiado grande o tiene demasiadas páginas. Anthropic rechaza documentos de más de ~100 páginas.'
  }
  if (/rate limit|429/.test(msg)) {
    return 'La IA está saturada (rate limit). Esperá un minuto y volvé a intentar.'
  }
  if (/timeout|timed out/.test(msg)) {
    return 'La IA tardó demasiado en responder. Probá de nuevo; si se repite, el PDF puede ser muy largo.'
  }
  if (/json/.test(msg) && /malformed|parse|invalid/.test(msg)) {
    return `La IA devolvió una respuesta que no pudimos interpretar. Probá cargar el PDF otra vez. Detalle técnico: ${mensajeCrudo.slice(0, 200)}`
  }
  if (mensajeCrudo.startsWith('La IA devolvió')) {
    // Ya es un mensaje nuestro de validarEstructura* — pasar tal cual.
    return mensajeCrudo
  }
  return mensajeCrudo || 'Error desconocido al procesar el PDF'
}

// ────────────────────────────────────────────────────────────
// Prompts
// ────────────────────────────────────────────────────────────

/**
 * Construye dinámicamente la sección del prompt que describe los tipos de
 * riesgo válidos y los campos esperados en `detalle_tecnico` para cada uno.
 * Lee `TIPOS_RIESGO` para mantener una sola fuente de verdad — agregar un
 * tipo nuevo a `tipos-riesgo.ts` lo hace aparecer automáticamente en este
 * prompt sin tocar el extractor.
 *
 * Formato compacto: sólo lista de keys sin placeholder ni "importante" —
 * baja el tamaño del prompt ~70% respecto de la versión verbosa sin perder
 * la restricción de qué keys usar bajo `detalle_tecnico`.
 */
function construirSeccionTiposRiesgo(): string {
  return TIPOS_RIESGO.map(t => {
    const keys = t.campos_poliza.map(c => `"${c.key}"`).join(', ')
    return `   ${t.key.toUpperCase()}: ${t.resumen}\n     Keys detalle_tecnico: ${keys}`
  }).join('\n')
}

const SYSTEM_POLIZA = `Sos un asistente especializado en interpretar PDFs de pólizas de compañías de seguros argentinas (Federación Patronal, San Cristóbal, Sancor, Mercantil Andina, Provincia, La Segunda, Allianz, Zurich, La Holando, etc.).

Tu tarea es extraer datos estructurados del PDF que te van a mostrar y devolverlos en un JSON que cumpla exactamente el schema que se te pide abajo.

REGLAS DURAS:
1. Respondé SOLO con JSON válido — sin texto adicional, sin fences, sin comentarios.
2. Si un campo no se puede determinar con razonable confianza, devolvelo como null. NO inventes datos.
3. Si el PDF contiene múltiples pólizas (caso "pago consolidado" o "refacturación múltiple"), procesá solo la PRINCIPAL (la primera listada, o la de mayor suma asegurada si hay ambigüedad) y agregá un string a "advertencias_ia" explicando que detectaste múltiples pólizas.
4. Fechas: siempre en formato ISO "YYYY-MM-DD".
5. Montos: solo el número (sin símbolos, sin separadores de miles). Usá "." para decimales. Devolvé number, no string.
6. Moneda: solo "ARS" o "USD".
7. DNI/CUIT: solo dígitos, sin puntos ni guiones.
8. Para "catalogos_pdf" devolvé los textos tal como figuran en el PDF (ej: "San Cristóbal Seguros", "Automotores", "C+"), sin normalizar. El CRM hará el mapeo después.
   • "medio_pago_texto": forma en que el cliente paga (ej: "Tarjeta VISA", "Débito en cuenta", "CBU", "Efectivo", "Contado"). Si el PDF no lo dice, devolvé null.
9. CRÍTICO — "tipo_riesgo" debe ser EXACTAMENTE uno de estos identificadores en MAYÚSCULA. Elegí el que mejor describa el contenido del PDF. Si ninguno encaja claramente, usá GENERICO.

${construirSeccionTiposRiesgo()}

   GENERICO: Cualquier ramo que no encaje en los anteriores.
     Campos esperados en detalle_tecnico:
       • "descripcion" (Descripción libre del bien o riesgo asegurado)

10. CRÍTICO — Para "detalle_tecnico" usá EXACTAMENTE las keys listadas arriba para el tipo identificado. NO inventes keys nuevas, NO uses sinónimos. Si un campo del listado no aparece en el PDF, omitilo del objeto (no lo pongas como null). Si el PDF tiene datos relevantes que no encajan en ninguna key del tipo, agregalos como una key "observaciones" con texto libre.
11. Patente, motor y chasis siempre en MAYÚSCULA, sin espacios ni guiones en la patente.
12. Si detectás inconsistencias (ej: fecha_fin antes de fecha_inicio), agregá advertencia a "advertencias_ia".

Schema de salida (todos los campos pueden ser null si faltan):
{
  "asegurado": {
    "nombre_completo": string | null,
    "apellido": string | null,
    "nombre": string | null,
    "razon_social": string | null,
    "tipo_persona": "FISICA" | "JURIDICA",
    "dni_cuil": string | null,
    "email": string | null,
    "telefono": string | null,
    "domicilio": { "calle": string|null, "numero": string|null, "localidad": string|null, "provincia": string|null, "codigo_postal": string|null } | null
  },
  "tomador": { /* misma estructura que asegurado */ } | null,
  "poliza": {
    "numero_poliza": string | null,
    "numero_endoso": string | null,
    "fecha_inicio": "YYYY-MM-DD" | null,
    "fecha_fin": "YYYY-MM-DD" | null,
    "moneda": "ARS" | "USD" | null,
    "suma_asegurada": number | null
  },
  "catalogos_pdf": {
    "compania_texto": string | null,
    "ramo_texto": string | null,
    "cobertura_texto": string | null,
    "refacturacion_texto": string | null,
    "medio_pago_texto": string | null
  },
  "riesgo": {
    "tipo_riesgo": string,
    "descripcion_corta": string | null,
    "detalle_tecnico": object,
    "suma_asegurada": number | null
  },
  "advertencias_ia": string[]
}`

const SYSTEM_ENDOSO = `Sos un asistente especializado en interpretar PDFs de endosos/modificaciones de pólizas de seguros argentinas.

Tu tarea es extraer los datos clave del endoso y devolverlos en JSON. Un endoso típicamente indica:
- El motivo del endoso (cambio de domicilio, cambio de unidad, inclusión de adicional, cambio de cobertura, etc.)
- La fecha en que aplica
- Qué campos de la póliza original cambiaron

REGLAS:
1. Respondé SOLO con JSON válido — sin texto adicional, sin fences.
2. Si no podés determinar un campo, usá null. NO inventes.
3. "motivo" es obligatorio — si el PDF no lo dice explícito, infierelo del contenido (ej: "Cambio de domicilio del asegurado").
4. Fechas en formato "YYYY-MM-DD".
5. "cambios_detectados" es un array de strings describiendo cada cambio que identificaste (ej: "Domicilio: Av. Corrientes 1234 → Av. Santa Fe 5678").

Schema de salida:
{
  "numero_endoso": string | null,
  "fecha_endoso": "YYYY-MM-DD" | null,
  "motivo": string,
  "observaciones": string | null,
  "cambios_detectados": string[],
  "advertencias_ia": string[]
}`

// ────────────────────────────────────────────────────────────
// Función principal
// ────────────────────────────────────────────────────────────

export interface ResultadoExtraccion<T> {
  ok: boolean
  datos?: T
  error?: string
  tokens_input: number
  tokens_output: number
  tokens_total: number
  costo_usd: number
}

async function llamarClaudeConPDF(
  rutaPDF: string,
  system: string,
  instruccionUsuario: string,
  opciones?: { familia?: FamiliaModelo; max_tokens?: number; pdfExtra?: string },
): Promise<{ texto: string; tokens_input: number; tokens_output: number; modelo: string; ms_ia: number }> {
  const apiKey = await obtenerApiKey()
  if (!apiKey) throw new Error('API key de Anthropic no configurada')

  // Si el caller forzó una familia (el extractor usa haiku para velocidad),
  // resolvemos por familia. Si no, usamos la familia configurada por el PAS.
  let modelo = opciones?.familia
    ? await resolverModeloParaFamilia(opciones.familia)
    : await obtenerModelo()

  const buffer = await readFile(rutaPDF)
  const base64 = buffer.toString('base64')

  // Segundo PDF opcional — usado por el comparador de renovaciones (2 PDFs
  // en el mismo request). Si no se pasa, se envía solo el primero.
  let base64Extra: string | null = null
  if (opciones?.pdfExtra) {
    const bufferExtra = await readFile(opciones.pdfExtra)
    base64Extra = bufferExtra.toString('base64')
  }

  const client = new Anthropic({ apiKey })

  // Llamada con auto-sustitución + fallback si el modelo rechaza temperature:
  //   1) Si Anthropic rechaza el modelo con not_found_error (discontinuado),
  //      refrescamos el cache y reintentamos con el modelo nuevo de la
  //      misma familia.
  //   2) Si el modelo devuelve "temperature is deprecated" (modelos nuevos
  //      como claude-sonnet-5 no lo aceptan), reintentamos sin ese parámetro.
  //   Ambos son transparentes al caller.
  let respuesta: Awaited<ReturnType<typeof client.messages.create>>
  let yaSustituyo = false
  let sinTemperature = false
  const inicioIA = Date.now()
  while (true) {
    try {
      // Contenido del mensaje: PDF principal + PDF extra opcional (comparador).
      const contenido: any[] = [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        },
      ]
      if (base64Extra) {
        contenido.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64Extra },
        })
      }
      contenido.push({ type: 'text', text: instruccionUsuario })

      const requestBody: any = {
        model: modelo,
        max_tokens: opciones?.max_tokens ?? 2048,
        system,
        messages: [{ role: 'user', content: contenido }],
      }
      if (!sinTemperature) requestBody.temperature = 0

      respuesta = await client.messages.create(requestBody)
      break
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status
      const errorType = err?.error?.error?.type || err?.error?.type
      const errorMsg: string = err?.error?.error?.message || err?.message || ''
      const esModeloInvalido =
        status === 404 && errorType === 'not_found_error' && /model:/i.test(errorMsg)

      // Fallback #2: temperature deprecada por el modelo → reintento sin ese param.
      if (!sinTemperature && /temperature.*deprecated/i.test(errorMsg)) {
        sinTemperature = true
        logger.warn({
          modulo: 'agente-pdf',
          mensaje: 'Modelo rechazó temperature — reintento sin ese parámetro',
          contexto: { modelo },
        })
        continue
      }

      if (esModeloInvalido && !yaSustituyo) {
        yaSustituyo = true
        const sust = await autoSustituirModelo(modelo)
        if (sust) {
          logger.warn({
            modulo: 'agente-pdf',
            mensaje: 'Auto-sustitución de modelo discontinuado',
            contexto: {
              modelo_viejo: sust.modelo_viejo,
              modelo_nuevo: sust.modelo_nuevo,
              familia: sust.familia,
            },
          })
          modelo = sust.modelo_nuevo
          continue // retry con el modelo nuevo
        }
      }
      throw err
    }
  }

  const bloques = respuesta.content || []
  const texto = bloques
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')

  const tokensInput = respuesta.usage?.input_tokens ?? 0
  const tokensOutput = respuesta.usage?.output_tokens ?? 0

  // Reportar a las estadísticas globales (mensuales + totales)
  const costoInterno =
    (tokensInput / 1_000_000) * COSTO_INPUT_POR_MTOK +
    (tokensOutput / 1_000_000) * COSTO_OUTPUT_POR_MTOK
  try {
    await registrarUso(tokensInput, tokensOutput, costoInterno, modelo)
  } catch (e) {
    logger.error({ modulo: 'agente-pdf', mensaje: 'Error al registrar uso', contexto: { error: String(e) } })
  }

  return {
    texto,
    tokens_input: tokensInput,
    tokens_output: tokensOutput,
    modelo,
    ms_ia: Date.now() - inicioIA,
  }
}

// Familia por defecto para las llamadas del extractor. Haiku 4.5 es 2-3x más
// rápido que Sonnet en tareas de visión y para extracción estructurada (leer
// campos de un PDF) alcanza en calidad. Si en el futuro degrada, el PAS puede
// forzar sonnet globalmente y el resto del sistema queda igual — pero por
// código, el extractor SIEMPRE arranca en haiku.
const FAMILIA_EXTRACTOR: FamiliaModelo = 'haiku'

export async function extraerDatosPoliza(
  rutaPDF: string,
  contextoAdicional?: { poliza_origen_descripcion?: string }
): Promise<ResultadoExtraccion<DatosExtraidosPoliza>> {
  try {
    const ctx = contextoAdicional?.poliza_origen_descripcion
      ? `\n\nCONTEXTO ADICIONAL: Este PDF se está cargando como renovación de una póliza existente en el CRM:\n${contextoAdicional.poliza_origen_descripcion}\n\nVerificá que el asegurado coincida. Si el número de póliza nuevo es igual al anterior, marcá una advertencia.`
      : ''

    const { texto, tokens_input, tokens_output, ms_ia } = await llamarClaudeConPDF(
      rutaPDF,
      SYSTEM_POLIZA,
      `Extraé los datos de la póliza principal del PDF adjunto y devolvémelos en el JSON que indica el system prompt.${ctx}`,
      { familia: FAMILIA_EXTRACTOR },
    )

    logger.info({
      modulo: 'agente-pdf',
      mensaje: 'Extracción de póliza completada',
      contexto: { ms_ia, tokens_input, tokens_output, familia: FAMILIA_EXTRACTOR },
    })

    const crudo = extraerJson(texto)
    validarEstructuraPoliza(crudo)
    const datos = crudo as unknown as DatosExtraidosPoliza
    const total = tokens_input + tokens_output
    const costo =
      (tokens_input / 1_000_000) * COSTO_INPUT_POR_MTOK +
      (tokens_output / 1_000_000) * COSTO_OUTPUT_POR_MTOK

    return { ok: true, datos, tokens_input, tokens_output, tokens_total: total, costo_usd: costo }
  } catch (err: any) {
    return {
      ok: false,
      error: traducirErrorExtractor(err),
      tokens_input: 0,
      tokens_output: 0,
      tokens_total: 0,
      costo_usd: 0,
    }
  }
}

export async function extraerDatosEndoso(
  rutaPDF: string,
  contextoAdicional?: { poliza_origen_descripcion?: string }
): Promise<ResultadoExtraccion<DatosExtraidosEndoso>> {
  try {
    const ctx = contextoAdicional?.poliza_origen_descripcion
      ? `\n\nCONTEXTO: Este endoso aplica sobre la póliza:\n${contextoAdicional.poliza_origen_descripcion}`
      : ''

    const { texto, tokens_input, tokens_output, ms_ia } = await llamarClaudeConPDF(
      rutaPDF,
      SYSTEM_ENDOSO,
      `Extraé los datos del endoso del PDF adjunto y devolvémelos en el JSON del system prompt.${ctx}`,
      { familia: FAMILIA_EXTRACTOR },
    )

    logger.info({
      modulo: 'agente-pdf',
      mensaje: 'Extracción de endoso completada',
      contexto: { ms_ia, tokens_input, tokens_output, familia: FAMILIA_EXTRACTOR },
    })

    const crudo = extraerJson(texto)
    validarEstructuraEndoso(crudo)
    const datos = crudo as unknown as DatosExtraidosEndoso
    const total = tokens_input + tokens_output
    const costo =
      (tokens_input / 1_000_000) * COSTO_INPUT_POR_MTOK +
      (tokens_output / 1_000_000) * COSTO_OUTPUT_POR_MTOK

    return { ok: true, datos, tokens_input, tokens_output, tokens_total: total, costo_usd: costo }
  } catch (err: any) {
    return {
      ok: false,
      error: traducirErrorExtractor(err),
      tokens_input: 0,
      tokens_output: 0,
      tokens_total: 0,
      costo_usd: 0,
    }
  }
}

export async function extraerDatosDePDF(
  rutaPDF: string,
  tipoOperacion: TipoOperacionPDF,
  contextoAdicional?: { poliza_origen_descripcion?: string }
): Promise<ResultadoExtraccion<DatosExtraidosPoliza | DatosExtraidosEndoso>> {
  if (tipoOperacion === 'ENDOSO') {
    return extraerDatosEndoso(rutaPDF, contextoAdicional)
  }
  return extraerDatosPoliza(rutaPDF, contextoAdicional)
}

// ────────────────────────────────────────────────────────────
// Comparador de renovaciones: 2 PDFs → JSON de cambios
// ────────────────────────────────────────────────────────────

/**
 * Un cambio detectado por la IA entre el PDF viejo y el nuevo.
 *
 *   tipo = 'material' → cambio importante para el PAS (cobertura distinta,
 *          sublímite, RC, exclusión nueva, monto asegurado).
 *   tipo = 'cosmético' → cambio irrelevante (número de póliza nuevo,
 *          fecha de emisión, número de endoso). No se muestra por default.
 *   severidad = 'alta' | 'media' | 'baja' → para ordenar y colorear.
 */
export interface CambioDetectado {
  categoria: string        // ej: "Cobertura", "Suma asegurada", "RC", "Exclusiones", "Vigencia"
  campo: string            // ej: "Cobertura principal", "RC hasta"
  antes: string | null
  ahora: string | null
  tipo: 'material' | 'cosmético'
  severidad: 'alta' | 'media' | 'baja'
  descripcion: string      // frase legible: "La cobertura pasó de CF (Terceros Full) a C (Terceros común). Es un downgrade."
}

export interface ResultadoComparacion {
  ok: boolean
  cambios?: CambioDetectado[]
  resumen?: string         // 1-2 líneas de tl;dr para el PAS
  error?: string
  tokens_input: number
  tokens_output: number
  tokens_total: number
  costo_usd: number
  ms_ia: number
}

const SYSTEM_COMPARADOR = `Sos un asistente especializado en comparar dos versiones de una póliza de seguros argentina (la póliza vigente y su renovación de la misma compañía).

Tu tarea es leer los 2 PDFs adjuntos y devolver un JSON con los cambios materiales que detectes. El PAS que asesora al cliente necesita saber qué cambió para poder avisarle antes de que el cliente firme la renovación.

CONTEXTO IMPORTANTE — nombres de coberturas:
Las compañías usan nombres/códigos comerciales que varían aunque el producto sea el mismo. Por ejemplo, en San Cristóbal "CM", "Premium Max" y "CF" son variantes del mismo producto "Terceros Full". NO marques como cambio material si el nombre cambia pero el nivel de cobertura es equivalente (ej: "CF" → "Premium Max" en la misma compañía = sin cambio). SÍ marcá como material si el nivel real cambia (ej: "CF" → "C" es un downgrade de Terceros Full a Terceros común).

QUÉ CONSIDERAR COMO CAMBIO MATERIAL:
- Cambio de cobertura (upgrade / downgrade / cambio de plan).
- Cambio de suma asegurada de la póliza o de una cobertura interna.
- Cambio de responsabilidad civil (RC): monto, sublímite, exclusiones.
- Cambio de franquicia.
- Coberturas adicionales agregadas o quitadas (granizo, cristales, robo de ruedas, asistencia mecánica, etc.).
- Cambio de sublímites por cobertura.
- Cambio de zonas geográficas cubiertas (ej: "ya no cubre Chile").
- Cambio de exclusiones o restricciones.
- Cambio de moneda (ARS → USD o viceversa).

QUÉ CONSIDERAR COSMÉTICO (marcá igual, pero con tipo 'cosmético'):
- Número de póliza nuevo (es normal en renovaciones).
- Fecha de emisión.
- Número de endoso.
- Número de recibo, forma de pago si es la misma.
- Datos del asegurado (dirección, teléfono) si sólo son actualizaciones.

REGLAS DURAS:
1. Respondé SOLO con JSON válido, sin texto extra, sin fences.
2. Los 2 PDFs se te pasan en orden: PRIMERO el PDF viejo (póliza vigente), SEGUNDO el PDF nuevo (renovación).
3. Si no detectás ningún cambio material, devolvé "cambios": [] y un resumen tipo "Sin cambios materiales — la renovación mantiene las mismas condiciones".
4. Sé preciso con montos. Si en el viejo era $30.000.000 y en el nuevo $50.000.000, escribilo exacto.
5. En "descripcion" escribí frases claras para el PAS, no tecnicismos.
6. Si detectás algo dudoso (no estás seguro si es cambio o no), agregalo con severidad 'baja' y aclará en descripción.

Schema de salida:
{
  "resumen": string,
  "cambios": [
    {
      "categoria": string,
      "campo": string,
      "antes": string | null,
      "ahora": string | null,
      "tipo": "material" | "cosmético",
      "severidad": "alta" | "media" | "baja",
      "descripcion": string
    }
  ]
}`

/**
 * Compara dos PDFs de póliza (el viejo y la renovación) con IA y devuelve un
 * JSON de cambios detectados. Usa Haiku por defecto para velocidad.
 *
 * Diseñada para correr fire-and-forget desde el endpoint de aprobación de
 * renovación — no bloquea al PAS.
 */
export async function compararPolizasConIA(
  rutaPDFViejo: string,
  rutaPDFNuevo: string,
): Promise<ResultadoComparacion> {
  try {
    const { texto, tokens_input, tokens_output, ms_ia } = await llamarClaudeConPDF(
      rutaPDFViejo,
      SYSTEM_COMPARADOR,
      'Adjunto dos PDFs. El PRIMERO es la póliza vigente (viejo). El SEGUNDO es la renovación (nuevo). Compará y devolvé el JSON de cambios materiales según el schema del system prompt.',
      { familia: FAMILIA_EXTRACTOR, pdfExtra: rutaPDFNuevo, max_tokens: 3072 },
    )

    logger.info({
      modulo: 'agente-pdf',
      mensaje: 'Comparación de pólizas completada',
      contexto: { ms_ia, tokens_input, tokens_output, familia: FAMILIA_EXTRACTOR },
    })

    const crudo = extraerJson(texto)
    const cambios = Array.isArray((crudo as any).cambios) ? (crudo as any).cambios as CambioDetectado[] : []
    const resumen = typeof (crudo as any).resumen === 'string' ? (crudo as any).resumen : ''
    const total = tokens_input + tokens_output
    const costo =
      (tokens_input / 1_000_000) * COSTO_INPUT_POR_MTOK +
      (tokens_output / 1_000_000) * COSTO_OUTPUT_POR_MTOK

    return {
      ok: true,
      cambios,
      resumen,
      tokens_input,
      tokens_output,
      tokens_total: total,
      costo_usd: costo,
      ms_ia,
    }
  } catch (err: any) {
    return {
      ok: false,
      error: traducirErrorExtractor(err),
      tokens_input: 0,
      tokens_output: 0,
      tokens_total: 0,
      costo_usd: 0,
      ms_ia: 0,
    }
  }
}
