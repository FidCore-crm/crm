/**
 * Helper para plantillas de WhatsApp.
 *
 * El CRM no envía WhatsApp directamente — solo abre `wa.me/{tel}?text={msg}` y
 * el PAS decide qué hace con su teléfono. Por eso el render es 100% cliente
 * (no necesita endpoint), y se cachea en memoria una vez cargadas las
 * plantillas para no martillar la DB cada vez que se aprieta un botón WA.
 */

import { getSupabaseClient } from '@/lib/supabase/client'

export type CodigoPlantillaWhatsapp =
  | 'portal_cliente_acceso'
  | 'contacto_persona'
  | 'info_poliza'
  | 'info_siniestro'
  | 'gestion_tarea'
  | 'recordatorio_renovacion'
  | 'recordatorio_pago'
  | 'envio_cotizacion'
  | 'contacto_general'

export interface PlantillaWhatsapp {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  contexto: string
  variables_disponibles: string[] | null
  mensaje: string
  mensaje_default: string
  activa: boolean
}

// Cache module-level: una sola carga por vida del browser. La invalidación
// la dispara el editor cuando guarda cambios (vía resetCachePlantillasWhatsapp).
let cache: Map<string, PlantillaWhatsapp> | null = null
let productoraNombre: string = ''
let cargaPendiente: Promise<Map<string, PlantillaWhatsapp>> | null = null

async function cargarPlantillas(): Promise<Map<string, PlantillaWhatsapp>> {
  if (cache) return cache
  if (cargaPendiente) return cargaPendiente

  cargaPendiente = (async () => {
    const supabase = getSupabaseClient()
    // Plantillas y nombre de la productora en paralelo. Si falla el nombre,
    // usamos string vacío — el render igual funciona.
    const [{ data: plantillas, error }, { data: cfg }] = await Promise.all([
      supabase.from('plantillas_whatsapp').select('*').eq('activa', true),
      supabase.from('configuracion').select('nombre').limit(1).maybeSingle(),
    ])
    if (error || !plantillas) {
      cargaPendiente = null
      throw new Error('No se pudieron cargar las plantillas de WhatsApp')
    }
    const map = new Map<string, PlantillaWhatsapp>()
    for (const p of plantillas) map.set(p.codigo, p as PlantillaWhatsapp)
    cache = map
    productoraNombre = cfg?.nombre || ''
    cargaPendiente = null
    return map
  })()

  return cargaPendiente
}

export function resetCachePlantillasWhatsapp() {
  cache = null
  productoraNombre = ''
}

/**
 * Renderiza una plantilla reemplazando {{variable}} con los valores del map.
 * Variables ausentes en `vars` se reemplazan por string vacío.
 */
export function renderizarPlantillaWhatsapp(
  mensaje: string,
  vars: Record<string, string | null | undefined>,
): string {
  return mensaje.replace(/\{\{(\w+)\}\}/g, (_, nombre) => {
    const valor = vars[nombre]
    return valor != null ? String(valor) : ''
  })
}

/**
 * Helper principal: dado el código de plantilla y variables, devuelve la URL
 * `https://wa.me/...?text=...` lista para `window.open()`.
 *
 * - Si la plantilla no existe (algún error), cae a un texto genérico simple.
 * - El teléfono se sanitiza (solo dígitos). Si queda vacío, devuelve wa.me sin
 *   número (abre WhatsApp Web para elegir contacto).
 */
export async function construirUrlWhatsapp(
  codigo: CodigoPlantillaWhatsapp,
  telefono: string | null | undefined,
  vars: Record<string, string | null | undefined>,
): Promise<string> {
  let mensaje = ''
  try {
    const plantillas = await cargarPlantillas()
    const plantilla = plantillas.get(codigo)
    if (plantilla) {
      // Auto-completar productora_nombre si el caller no lo pasó
      const varsCompletas = {
        productora_nombre: productoraNombre,
        ...vars,
      }
      mensaje = renderizarPlantillaWhatsapp(plantilla.mensaje, varsCompletas)
    }
  } catch {
    // ignoramos: caemos al fallback
  }

  // Fallback si no hay plantilla cargable: mensaje crudo con nombre.
  if (!mensaje) {
    const nombre = vars.nombre || ''
    mensaje = nombre
      ? `Hola ${nombre}, te contactamos.`
      : 'Hola, te contactamos.'
  }

  const tel = (telefono ?? '').replace(/\D/g, '')
  const base = tel ? `https://wa.me/${tel}` : 'https://wa.me/'
  return `${base}?text=${encodeURIComponent(mensaje)}`
}

/**
 * Versión sincrónica para usar cuando la plantilla ya está cacheada.
 * Tira si no está cargada — los callers deben asegurarse de pre-cargar.
 */
export function construirUrlWhatsappSync(
  codigo: CodigoPlantillaWhatsapp,
  telefono: string | null | undefined,
  vars: Record<string, string | null | undefined>,
): string {
  let mensaje = ''
  if (cache) {
    const plantilla = cache.get(codigo)
    if (plantilla) {
      mensaje = renderizarPlantillaWhatsapp(plantilla.mensaje, vars)
    }
  }
  if (!mensaje) {
    const nombre = vars.nombre || ''
    mensaje = nombre ? `Hola ${nombre}, te contactamos.` : 'Hola, te contactamos.'
  }
  const tel = (telefono ?? '').replace(/\D/g, '')
  const base = tel ? `https://wa.me/${tel}` : 'https://wa.me/'
  return `${base}?text=${encodeURIComponent(mensaje)}`
}
