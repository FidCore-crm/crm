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
  llamarClaude,
  obtenerApiKey,
  obtenerModelo,
  registrarUso,
  autoSustituirModelo,
  resolverModeloParaFamilia,
  type FamiliaModelo,
} from '@/lib/anthropic-client'
import { logger } from '@/lib/errores'
import { TIPOS_RIESGO } from '@/lib/tipos-riesgo'
import { extraerTextoPDF, PDFSinTextoExtraible } from './pdf-texto'
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
  // Anthropic devuelve "prompt is too long: X tokens > Y maximum" cuando el
  // total (contexto + PDFs adjuntos) supera el límite del modelo (200k
  // tokens para Haiku/Sonnet 4). Típico en comparaciones donde ambos PDFs
  // son largos y juntos superan el límite.
  const tokensMatch = mensajeCrudo.match(/prompt is too long:\s*(\d+)\s+tokens?\s*>\s*(\d+)/i)
  if (tokensMatch) {
    const usados = Number(tokensMatch[1]).toLocaleString('es-AR')
    const maximo = Number(tokensMatch[2]).toLocaleString('es-AR')
    return `Los PDFs son demasiado extensos para procesar (${usados} tokens sobre un máximo de ${maximo}). Probá con un PDF más corto o dividí el documento en secciones más chicas.`
  }
  if (/prompt is too long|context length|maximum context|tokens.*exceed/i.test(msg)) {
    return 'Los PDFs son demasiado extensos para procesar. Anthropic tiene un límite de 200.000 tokens por request.'
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

10. Para "detalle_tecnico" priorizá las keys listadas arriba para el tipo identificado — usalas siempre que el PDF traiga esa info. Si un campo del listado no aparece en el PDF, omitilo (no pongas null).
    PROHIBIDO: duplicar información con sinónimos. Antes de agregar CUALQUIER key extra, verificá que la info NO esté ya cubierta por una key core. Si "anio" es una key core y el PDF dice "AÑO: 2020", usá "anio: 2020" — NO agregues "año", "año_modelo", "año_fabricacion", "modelo_anio" ni ninguna variante. Si "modelo" es core, no crees "modelo_vehiculo", "descripcion_modelo", "version". Si "patente" es core, no uses "dominio", "chapa" ni "matricula". La misma regla vale para TODAS las keys core del tipo: marca, chasis, motor, calle, numero, localidad, etc.
    SIN EMBARGO — si el PDF trae DATOS ÚTILES para el PAS que NO están cubiertos por ninguna key core, AGREGALAS como keys extras con snake_case en el mismo detalle_tecnico. Estos datos estructurados son mucho más útiles que un texto libre en "observaciones". Ejemplos habituales:
     • Automotor/Moto: combustible, gnc, alarma, alarma_monitoreada, rastreador_satelital, garage, uso_comercial, transporta_pasajeros_pagos, kilometraje_anual, tipo_llanta, accesorios, adicionales
     • Hogar/Integrales: alarma_monitoreada, empresa_monitoreo, rejas, medidas_seguridad_adicionales, cerraduras_multipunto, caja_fuerte, valor_contenido, cobertura_electrodomesticos
     • Transporte: tipo_transporte, ruta_habitual, valor_promedio_carga, tipo_carga
     • ART / Personas: profesion, actividad, categoria_ocupacion, tiene_beneficiarios
     • Cualquier tipo: observaciones (SOLO para info que no se puede estructurar en una key)
    Regla: si podés convertir la info en una key con nombre claro, hacelo. "observaciones" es el último recurso para texto libre que no encaje en nada estructurado.
10.b CONDICIONES PARTICULARES — CRÍTICO para el PAS.
    Las condiciones particulares son la parte personalizada del contrato — todo lo que aplica a ESTA póliza en particular y no al marco general del ramo. Se contraponen a las "condiciones generales" (cláusulas estándar aplicables a todos los contratos del mismo tipo de seguro: alcance genérico, exclusiones estándar, plazos legales, procedimientos de resolución). Las condiciones generales NO se extraen; las particulares SÍ, con el límite indicado en la regla 4.

    Extraé como key "clausulas" en detalle_tecnico un array de objetos { label, valor } con condiciones particulares del contrato que el PAS necesita para comparar renovaciones y detectar variaciones sin abrir el PDF.

    QUÉ EXTRAER:
    Pares (concepto → valor) que aparezcan como parte de las condiciones particulares del PDF, típicamente en secciones tipo "Datos relevantes del riesgo", "Condiciones particulares", "Beneficios adicionales", "Cláusulas anexas", "Descuentos y bonificaciones", "Extensiones de cobertura", "Franquicias específicas", "Coberturas adicionales", "Sublímites", o similar. Categorías habituales sin ánimo exhaustivo: coberturas adicionales contratadas, bonificaciones aplicadas, descuentos por medidas de seguridad, tipo de franquicia, sublímites específicos del contrato, extensiones geográficas del contrato, zona de riesgo, lugar de guarda, RC ampliada, ajustes automáticos, cláusulas de tolerancia por mora, adhesiones a servicios adicionales del contrato, cesiones de derechos.

    REGLAS ESTRICTAS:
    1. TEXTUAL del PDF: "label" y "valor" deben ser copiados exactamente como figuran en el PDF. Sin reformular, sin traducir, sin resumir, sin normalizar, sin corregir mayúsculas/minúsculas, sin agregar contexto.
    2. NO extraer el detalle de qué cubre cada cobertura estándar (Robo Total, Robo Parcial, Daño Total, Incendio, RC, Granizo, Cristales, etc.) — el CRM ya sabe qué cubre cada cobertura del catálogo. Solo interesa lo que varía dentro de esa cobertura.
    3. NO extraer condiciones generales: alcance genérico de la cobertura, exclusiones estándar, artículos de la Ley de Seguros, procedimientos generales de denuncia, plazos legales, direcciones de aseguradoras, textos administrativos de SSN, información legal general del ramo.
    4. NO extraer condiciones particulares que ya están estructuradas en columnas core del CRM. Aunque conceptualmente son parte de las condiciones particulares del contrato, estos datos viven en columnas propias y duplicarlos en "clausulas" no aporta:
       • Datos identificatorios: nombre/apellido/razón social del asegurado y tomador, DNI/CUIT, domicilio, email, teléfono.
       • Datos de la póliza: número de póliza, número de endoso, fecha de inicio, fecha de fin, moneda, suma asegurada global.
       • Datos del bien asegurado: patente, marca, modelo, año, motor, chasis, uso (automotor); calle, número, localidad, provincia, código postal, superficie (integrales); y todas las keys core listadas en la regla 10.
       • Costo y forma de pago: refacturación (mensual/anual/etc), medio de pago.
    5. NO inventar un "label" si el PDF no lo trae explícito. Si el dato viene sin label claro pero es útil, usá el título de la sección del PDF como label; nunca uses un label ficticio.
    6. NO agregar "clausulas" si el PDF no tiene esos datos. Omití la key entera; no la pongas como array vacío.

    Formato del array (el nombre de key "clausulas" se mantiene por retrocompat con datos ya cargados; conceptualmente es la lista de condiciones particulares):
     "clausulas": [
       { "label": "<texto del label tal cual figura en el PDF>", "valor": "<texto del valor tal cual figura en el PDF>" }
     ]
10.c COBERTURAS DESGLOSADAS — para pólizas con múltiples sub-coberturas con suma asegurada propia.
    Extraé como key "coberturas_desglosadas" en detalle_tecnico un array de objetos { cobertura, suma_asegurada, notas } cuando el PDF trae un listado de coberturas contratadas cada una con su propia suma asegurada. Típico en seguros integrales (hogar, comercio, consorcio), transporte con múltiples riesgos cubiertos, embarcaciones, ART con distintos capitales, y algunas pólizas de vida con sumas por evento.

    QUÉ EXTRAER:
    Cada línea del PDF donde figura una cobertura junto a un monto asegurado propio. Ejemplos habituales: "Incendio edificio", "Incendio contenido", "Robo contenido", "Daños por agua", "RC frente a terceros", "Cristales", "Rotura de máquinas", "Todo riesgo operativo", "Equipos electrónicos", "Robo con violación", "Granizo", "Tempestad", "Huelga y tumulto", "Responsabilidad civil comprensiva".

    REGLAS ESTRICTAS:
    1. TEXTUAL del PDF: el campo "cobertura" es el nombre exacto como aparece en el PDF (sin normalizar, sin traducir, sin abreviar).
    2. "suma_asegurada" es NUMBER — solo el número, sin símbolos, sin separadores de miles, con "." para decimales. NUNCA string. Si el PDF muestra "$1.500.000" devolvé 1500000.
    3. "notas" (opcional, string | null) solo si el PDF trae info específica de esa cobertura al lado de la suma (ej: "Franquicia 5%", "Sin franquicia", "A prorrata", "Al valor de reposición"). Si no hay nota extra, devolvé null.
    4. NO extraer coberturas sin suma asegurada propia. Si el PDF solo dice "incluye Robo" sin monto, NO va acá.
    5. NO duplicar la suma asegurada global de la póliza. Si el PDF solo tiene una única cobertura con la misma suma que ya cargaste en poliza.suma_asegurada, OMITÍ esta key entera.
    6. NO extraer coberturas base cuya cobertura sale sin listado de sub-coberturas (ej: automotor Terceros Completo — es una sola cobertura, no un desglose).
    7. Si un ítem del listado NO tiene monto porque dice "SIN COBERTURA", "NO CONTRATADO", "$0", "-" o similar, OMITILO — no lo incluyas con 0.
    8. NO inventar coberturas ni sumas. Si no está en el PDF, no va.
    9. Si el PDF NO trae este tipo de listado, OMITÍ la key entera (no la pongas como array vacío).

    Formato del array:
     "coberturas_desglosadas": [
       { "cobertura": "<nombre exacto del PDF>", "suma_asegurada": <number>, "notas": "<texto|null>" }
     ]
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
  descripcion: string      // frase factual y corta: "La cobertura principal pasó de CF (Terceros Full) a C (Terceros común)."
}

export interface ResultadoComparacion {
  ok: boolean
  cambios?: CambioDetectado[]
  resumen?: string         // 1 línea factual — QUÉ cambió, sin valoraciones
  error?: string
  tokens_input: number
  tokens_output: number
  tokens_total: number
  costo_usd: number
  ms_ia: number
  // Qué pipeline se usó para producir el resultado:
  //   'pdf_nativo'  → bloques `document` de Anthropic (default, layout preservado)
  //   'texto_plano' → texto extraído con pdf-parse + prompt adaptado
  //                    (fallback automático cuando PDF nativo supera 200k tokens)
  modo?: 'pdf_nativo' | 'texto_plano'
}

const SYSTEM_COMPARADOR = `Sos un asistente especializado en comparar dos versiones de una póliza de seguros argentina.

Tu tarea es leer los 2 PDFs adjuntos y devolver un JSON con los cambios materiales que detectes. El PAS que asesora al cliente necesita saber qué cambió para poder avisarle antes de que el cliente firme la renovación.

CONTEXTO — comparación de la misma póliza entre 2 vigencias:
Los 2 PDFs son de la MISMA póliza en 2 momentos distintos: la vigencia actual y su renovación. Siempre son de la MISMA compañía.

Cada compañía usa sus propios códigos o nombres comerciales para las coberturas contratadas (por ejemplo, la cobertura puede figurar como "CM", "CF", "D", "Terceros Completo", "M-Plus", o cualquier otro identificador propio de esa compañía). Estos códigos varían entre compañías y no tenés que inferir equivalencias entre ellos por tu cuenta.

Regla dura sobre nombres de cobertura:
- Si el código/nombre de la cobertura contratada cambia entre el PDF viejo y el PDF nuevo, marcalo como cambio material con categoría "Cobertura". Copiá ambos códigos textuales.
- Dentro de la misma compañía, un cambio de código o nombre casi siempre implica un cambio real de plan (por ejemplo pasar de un plan de responsabilidad civil a un todo riesgo, o viceversa). El PAS necesita saberlo sí o sí.
- No inventes equivalencias entre nombres. Si el catálogo del CRM (bloque más abajo, cuando esté disponible) provee la equivalencia código → cobertura canónica para la compañía involucrada, usalo. Si no hay catálogo o el código no aparece ahí, reportá exactamente lo que ves sin asumir nada.

QUÉ CONSIDERAR COMO CAMBIO MATERIAL:
- Cambio de código/nombre de la cobertura contratada.
- Cambio de suma asegurada de la póliza o de una cobertura interna.
- Cambio de responsabilidad civil (RC): monto, sublímite, exclusiones.
- Cambio de franquicia.
- Coberturas adicionales agregadas o quitadas.
- Cambio de sublímites por cobertura.
- Cambio de zonas geográficas cubiertas.
- Cambio de exclusiones o restricciones.
- Cambio de moneda (ARS → USD o viceversa).
- Cláusulas específicas del contrato (condiciones particulares, bonificaciones, descuentos, franquicias específicas, extensiones de cobertura del contrato, adhesiones a servicios opcionales del contrato). Enumeralas de ambos PDFs y detectá cuáles fueron agregadas, cuáles quitadas y cuáles modificadas. Marcá cada cambio con la categoría "Cláusulas".

QUÉ CONSIDERAR COSMÉTICO (marcá igual, pero con tipo 'cosmético'):
- Número de póliza nuevo (es normal en renovaciones).
- Fecha de emisión.
- Número de endoso.
- Número de recibo.
- Forma de pago si es la misma.
- Datos del asegurado (dirección, teléfono) si son solo actualizaciones.

TONO — MUY IMPORTANTE:
- El PAS es un profesional del rubro. Escribí en la terminología habitual del rubro tal como aparece en el PDF.
- Limitate a describir QUÉ cambió, citando los valores exactos que aparecen en cada PDF. No traduzcas términos técnicos ni uses sinónimos genéricos.
- No valorés el cambio. No digas si es bueno o malo para el cliente. Eso lo evalúa el PAS.
- No uses palabras valorativas: "mejor", "peor", "mejora", "empeora", "conveniente", "favorable", "desfavorable", "positivo", "negativo", "upgrade", "downgrade", "beneficia", "perjudica".

REGLAS DURAS:
1. Respondé SOLO con JSON válido, sin texto extra, sin fences.
2. Los 2 PDFs se te pasan en orden: PRIMERO el PDF viejo (póliza vigente), SEGUNDO el PDF nuevo (renovación).
3. Prohibido inventar montos, porcentajes, fechas o nombres de cobertura que no figuren textualmente en los PDFs.
4. Copiá las cifras exactas que aparecen en cada PDF, sin redondear.
5. Copiá los nombres/códigos de cobertura tal cual (letras, códigos, mayúsculas).
6. El campo "resumen" debe ser UNA sola oración, corta y factual. Máximo 20 palabras. Mencioná QUÉ cambió citando los valores exactos. Si no hay cambios materiales, respondé "Sin cambios materiales — se mantienen las mismas condiciones."
7. En "descripcion" aplicá el mismo tono factual, sin valoraciones.
8. Si detectás algo dudoso (no estás seguro si es cambio o no), agregalo con severidad 'baja' y aclará en descripción.

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

// Prompt adaptado para modo texto plano: se usa cuando los PDFs juntos superan
// el límite de 200k tokens en modo nativo. La diferencia clave con
// SYSTEM_COMPARADOR es que acá los PDFs se entregan como texto plano
// (extraído con pdf-parse) — sin imágenes, sin layout. Advertimos a la IA
// sobre posibles errores de tablas y le pedimos marcar como severidad baja
// cualquier cosa dudosa por orden de columnas.
const SYSTEM_COMPARADOR_TEXTO = `Sos un asistente especializado en comparar dos versiones de una póliza de seguros argentina.

Tu tarea es leer el TEXTO PLANO extraído de 2 PDFs y devolver un JSON con los cambios materiales que detectes. El PAS que asesora al cliente necesita saber qué cambió para poder avisarle antes de que el cliente firme la renovación.

FORMATO DE ENTRADA:
El texto se te pasa en dos bloques delimitados así:
=== PÓLIZA VIGENTE (VIEJA) ===
<texto extraído del PDF viejo>
=== PÓLIZA NUEVA (RENOVACIÓN) ===
<texto extraído del PDF nuevo>

IMPORTANTE — LIMITACIÓN DEL FORMATO:
El texto viene de una extracción PDF sin layout. Algunas tablas pueden aparecer con las columnas mezcladas o el orden de lectura alterado. Si detectás un dato ambiguo por posible error de tabla, marcalo con severidad 'baja' y aclará en descripción "posible confusión de columnas — revisar manualmente".

CONTEXTO — comparación de la misma póliza entre 2 vigencias:
Los 2 PDFs son de la MISMA póliza en 2 momentos distintos: la vigencia actual y su renovación. Siempre son de la MISMA compañía.

Cada compañía usa sus propios códigos o nombres comerciales para las coberturas contratadas. Estos códigos varían entre compañías y no tenés que inferir equivalencias entre ellos por tu cuenta.

Regla dura sobre nombres de cobertura:
- Si el código/nombre de la cobertura contratada cambia entre el PDF viejo y el PDF nuevo, marcalo como cambio material con categoría "Cobertura". Copiá ambos códigos textuales.
- Dentro de la misma compañía, un cambio de código o nombre casi siempre implica un cambio real de plan. El PAS necesita saberlo sí o sí.
- No inventes equivalencias entre nombres. Si el catálogo del CRM (bloque más abajo, cuando esté disponible) provee la equivalencia código → cobertura canónica para la compañía involucrada, usalo. Si no hay catálogo o el código no aparece ahí, reportá exactamente lo que ves sin asumir nada.

QUÉ CONSIDERAR COMO CAMBIO MATERIAL:
- Cambio de código/nombre de la cobertura contratada.
- Cambio de suma asegurada de la póliza o de una cobertura interna.
- Cambio de responsabilidad civil (RC): monto, sublímite, exclusiones.
- Cambio de franquicia.
- Coberturas adicionales agregadas o quitadas.
- Cambio de sublímites por cobertura.
- Cambio de zonas geográficas cubiertas.
- Cambio de exclusiones o restricciones.
- Cambio de moneda (ARS → USD o viceversa).
- Cláusulas específicas del contrato (condiciones particulares, bonificaciones, descuentos, franquicias específicas, extensiones de cobertura del contrato, adhesiones a servicios opcionales del contrato). Enumeralas de ambos PDFs y detectá cuáles fueron agregadas, cuáles quitadas y cuáles modificadas. Marcá cada cambio con la categoría "Cláusulas".

QUÉ CONSIDERAR COSMÉTICO (marcá igual, pero con tipo 'cosmético'):
- Número de póliza nuevo (es normal en renovaciones).
- Fecha de emisión.
- Número de endoso.
- Número de recibo.
- Forma de pago si es la misma.
- Datos del asegurado (dirección, teléfono) si son solo actualizaciones.

TONO — MUY IMPORTANTE:
- El PAS es un profesional del rubro. Escribí en la terminología habitual del rubro tal como aparece en el PDF.
- Limitate a describir QUÉ cambió, citando los valores exactos que aparecen en cada PDF. No traduzcas términos técnicos ni uses sinónimos genéricos.
- No valorés el cambio. No digas si es bueno o malo para el cliente. Eso lo evalúa el PAS.
- No uses palabras valorativas: "mejor", "peor", "mejora", "empeora", "conveniente", "favorable", "desfavorable", "positivo", "negativo", "upgrade", "downgrade", "beneficia", "perjudica".

REGLAS DURAS:
1. Respondé SOLO con JSON válido, sin texto extra, sin fences.
2. Prohibido inventar montos, porcentajes, fechas o nombres de cobertura que no figuren textualmente en los PDFs.
3. Copiá las cifras exactas que aparecen en cada PDF, sin redondear.
4. Copiá los nombres/códigos de cobertura tal cual (letras, códigos, mayúsculas).
5. El campo "resumen" debe ser UNA sola oración, corta y factual. Máximo 20 palabras. Mencioná QUÉ cambió citando los valores exactos. Si no hay cambios materiales, respondé "Sin cambios materiales — se mantienen las mismas condiciones."
6. En "descripcion" aplicá el mismo tono factual, sin valoraciones.
7. Si detectás algo dudoso (no estás seguro si es cambio o no), agregalo con severidad 'baja' y aclará en descripción.

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
 * Ítem del catálogo de coberturas del CRM para una compañía específica.
 * El caller lo carga leyendo `catalogos` + `metadata.equivalencias` filtrado
 * por la compañía involucrada en la comparación.
 */
export interface EquivalenciaCoberturaCompania {
  /** Código o nombre comercial que la compañía usa en sus PDFs (ej: "CF", "CM", "M-Plus"). */
  codigo_compania: string
  /** Nombre canónico de la cobertura en el catálogo del CRM (ej: "Terceros Completo"). */
  nombre_canonico: string
}

/**
 * Devuelve el bloque de texto que se concatena al system prompt del comparador
 * cuando tenemos el catálogo de equivalencias de la compañía involucrada.
 * Se pega justo después del system fijo; le da a la IA el mapa "código del PDF
 * → cobertura canónica" para razonar sobre cambios reales de plan sin inventar
 * equivalencias.
 *
 * Si el array está vacío devuelve string vacío (no inyectamos ruido innecesario).
 */
function construirBloqueCatalogoCoberturas(
  companiaNombre: string | null,
  equivalencias: EquivalenciaCoberturaCompania[],
): string {
  if (!equivalencias || equivalencias.length === 0) return ''
  const lineas = equivalencias
    .map((e) => `- "${e.codigo_compania}" → ${e.nombre_canonico}`)
    .join('\n')
  const companiaLbl = companiaNombre ? ` para ${companiaNombre}` : ''
  return `

CATÁLOGO DE COBERTURAS DEL CRM${companiaLbl}:
Este es el mapa oficial de equivalencias entre los códigos/nombres comerciales de la compañía y las coberturas canónicas del CRM. Usalo para resolver el código de cobertura que veas en cada PDF a su cobertura canónica:
${lineas}

Al citar un cambio de cobertura en el resumen o en el campo "descripcion", mencioná tanto el código del PDF como la cobertura canónica del catálogo cuando la equivalencia esté disponible arriba. Ejemplo de formato: "antes '<código_viejo>' (<cobertura_canónica>), ahora '<código_nuevo>' (<cobertura_canónica>)". Si un código no aparece en el catálogo, reportá solo el código sin inventar la cobertura canónica.`
}

/**
 * Detecta si un error de la comparación IA fue causado por superar el límite
 * de contexto del modelo (200k tokens para Haiku/Sonnet 4). En ese caso
 * conviene reintentar con texto plano extraído de los PDFs.
 */
function esErrorLimiteTokens(err: any): boolean {
  const mensaje: string = err?.error?.error?.message || err?.message || String(err) || ''
  return /prompt is too long|context length|maximum context|tokens.*exceed/i.test(mensaje)
}

/**
 * Ejecuta la comparación en modo texto plano: extrae texto de ambos PDFs con
 * pdf-parse y llama a Claude con strings — sin bloques `document`. Usado como
 * fallback automático cuando el modo nativo excede el límite de 200k tokens.
 */
async function compararPolizasEnTextoPlano(
  rutaPDFViejo: string,
  rutaPDFNuevo: string,
  opciones?: {
    companiaNombre?: string | null
    catalogoCoberturas?: EquivalenciaCoberturaCompania[]
  },
): Promise<ResultadoComparacion> {
  const inicio = Date.now()
  try {
    const [textoViejo, textoNuevo] = await Promise.all([
      extraerTextoPDF(rutaPDFViejo),
      extraerTextoPDF(rutaPDFNuevo),
    ])

    const prompt = `=== PÓLIZA VIGENTE (VIEJA) ===\n${textoViejo.texto}\n\n=== PÓLIZA NUEVA (RENOVACIÓN) ===\n${textoNuevo.texto}`

    // Inyectamos el catálogo del CRM al system solo si el caller lo trae —
    // así la IA puede resolver códigos comerciales a nombres canónicos sin
    // inventar equivalencias.
    const systemFinal =
      SYSTEM_COMPARADOR_TEXTO +
      construirBloqueCatalogoCoberturas(opciones?.companiaNombre ?? null, opciones?.catalogoCoberturas ?? [])

    // Resolvemos la familia HAIKU explícitamente (el texto plano es mucho más
    // barato — no hace falta un modelo más grande). Igual llamarClaude puede
    // auto-sustituir si el ID vigente cambió.
    const modelo = await resolverModeloParaFamilia(FAMILIA_EXTRACTOR).catch(() => undefined)

    const resultado = await llamarClaude({
      prompt,
      system: systemFinal,
      max_tokens: 3072,
      temperature: 0,
      modelo,
      response_format: 'json',
    })

    if (!resultado.ok) {
      return {
        ok: false,
        error: resultado.error?.mensaje || 'La comparación en modo texto plano falló',
        tokens_input: resultado.tokens_input ?? 0,
        tokens_output: resultado.tokens_output ?? 0,
        tokens_total: resultado.tokens_total ?? 0,
        costo_usd: resultado.costo_estimado_usd ?? 0,
        ms_ia: Date.now() - inicio,
        modo: 'texto_plano',
      }
    }

    const crudo = resultado.json ?? extraerJson(resultado.data || '{}')
    const cambios = Array.isArray((crudo as any).cambios) ? ((crudo as any).cambios as CambioDetectado[]) : []
    const resumen = typeof (crudo as any).resumen === 'string' ? (crudo as any).resumen : ''

    logger.info({
      modulo: 'agente-pdf',
      mensaje: 'Comparación en modo texto plano completada',
      contexto: {
        ms: Date.now() - inicio,
        tokens_input: resultado.tokens_input,
        tokens_output: resultado.tokens_output,
        chars_viejo: textoViejo.caracteres,
        chars_nuevo: textoNuevo.caracteres,
        paginas_viejo: textoViejo.paginas,
        paginas_nuevo: textoNuevo.paginas,
      },
    })

    return {
      ok: true,
      cambios,
      resumen,
      tokens_input: resultado.tokens_input ?? 0,
      tokens_output: resultado.tokens_output ?? 0,
      tokens_total: resultado.tokens_total ?? 0,
      costo_usd: resultado.costo_estimado_usd ?? 0,
      ms_ia: Date.now() - inicio,
      modo: 'texto_plano',
    }
  } catch (err) {
    if (err instanceof PDFSinTextoExtraible) {
      return {
        ok: false,
        error: err.message,
        tokens_input: 0,
        tokens_output: 0,
        tokens_total: 0,
        costo_usd: 0,
        ms_ia: Date.now() - inicio,
        modo: 'texto_plano',
      }
    }
    logger.error({
      modulo: 'agente-pdf',
      mensaje: 'Error inesperado en comparación modo texto plano',
      contexto: { error: String(err) },
    })
    return {
      ok: false,
      error: traducirErrorExtractor(err),
      tokens_input: 0,
      tokens_output: 0,
      tokens_total: 0,
      costo_usd: 0,
      ms_ia: Date.now() - inicio,
      modo: 'texto_plano',
    }
  }
}

/**
 * Compara dos PDFs de póliza (el viejo y la renovación) con IA y devuelve un
 * JSON de cambios detectados. Usa Haiku por defecto para velocidad.
 *
 * Estrategia híbrida:
 *   1. Intento con PDF nativo (bloques `document` de Anthropic — layout
 *      preservado, más preciso para tablas visuales).
 *   2. Si falla porque los PDFs superan el límite de 200k tokens, hace un
 *      fallback automático a modo texto plano (pdf-parse + prompt adaptado).
 *      Reduce ~10-20x los tokens; sirve para pólizas largas de 40+ páginas.
 *
 * El JSON devuelto incluye `modo` para que la UI muestre un badge indicando
 * qué pipeline se usó.
 */
export async function compararPolizasConIA(
  rutaPDFViejo: string,
  rutaPDFNuevo: string,
  opciones?: {
    companiaNombre?: string | null
    catalogoCoberturas?: EquivalenciaCoberturaCompania[]
  },
): Promise<ResultadoComparacion> {
  try {
    // Inyectamos el catálogo del CRM al system solo si el caller lo trae —
    // así la IA puede resolver códigos comerciales a nombres canónicos sin
    // inventar equivalencias.
    const systemFinal =
      SYSTEM_COMPARADOR +
      construirBloqueCatalogoCoberturas(opciones?.companiaNombre ?? null, opciones?.catalogoCoberturas ?? [])

    const { texto, tokens_input, tokens_output, ms_ia } = await llamarClaudeConPDF(
      rutaPDFViejo,
      systemFinal,
      'Adjunto dos PDFs. El PRIMERO es la póliza vigente (viejo). El SEGUNDO es la renovación (nuevo). Compará y devolvé el JSON de cambios materiales según el schema del system prompt.',
      { familia: FAMILIA_EXTRACTOR, pdfExtra: rutaPDFNuevo, max_tokens: 3072 },
    )

    logger.info({
      modulo: 'agente-pdf',
      mensaje: 'Comparación de pólizas completada (modo PDF nativo)',
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
      modo: 'pdf_nativo',
    }
  } catch (err: any) {
    // Fallback automático a texto plano cuando el PDF nativo excede el
    // límite de contexto. Cualquier otro error (auth, network, PDF corrupto)
    // se devuelve tal cual sin reintento.
    if (esErrorLimiteTokens(err)) {
      logger.info({
        modulo: 'agente-pdf',
        mensaje: 'PDF nativo superó límite de tokens — reintentando con texto plano',
        contexto: { error: String(err?.message || err).slice(0, 200) },
      })
      return compararPolizasEnTextoPlano(rutaPDFViejo, rutaPDFNuevo, opciones)
    }

    return {
      ok: false,
      error: traducirErrorExtractor(err),
      tokens_input: 0,
      tokens_output: 0,
      tokens_total: 0,
      costo_usd: 0,
      ms_ia: 0,
      modo: 'pdf_nativo',
    }
  }
}
