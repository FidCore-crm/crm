import { getSupabaseAdmin } from '@/lib/supabase/server'
import { formatFechaLocalLarga, diasHastaVencimiento } from '@/lib/utils'

/**
 * Reemplaza {{variable}} por su valor. Si falta, deja vacío.
 */
export function reemplazarVariables(texto: string, variables: Record<string, string>): string {
  return texto.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || '')
}

/**
 * Obtiene variables de una persona.
 */
export async function obtenerVariablesPersona(personaId: string): Promise<Record<string, string>> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('personas')
    .select('nombre, apellido, email, telefono')
    .eq('id', personaId)
    .maybeSingle()

  if (!data) return {}

  return {
    nombre: data.nombre || '',
    apellido: data.apellido || '',
    email: data.email || '',
    telefono: data.telefono || '',
  }
}

/**
 * Obtiene variables de una póliza con joins a compañía, ramo y riesgos.
 */
export async function obtenerVariablesPoliza(polizaId: string): Promise<Record<string, string>> {
  const supabase = getSupabaseAdmin()
  const { data: poliza } = await supabase
    .from('polizas')
    .select('numero_poliza, fecha_inicio, fecha_fin, compania_id, ramo_id')
    .eq('id', polizaId)
    .maybeSingle()

  if (!poliza) return {}

  // Obtener compañía y ramo
  const [companiaRes, ramoRes, riesgoRes] = await Promise.all([
    poliza.compania_id
      ? supabase.from('catalogos').select('nombre').eq('id', poliza.compania_id).maybeSingle()
      : Promise.resolve({ data: null }),
    poliza.ramo_id
      ? supabase.from('catalogos').select('nombre').eq('id', poliza.ramo_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('riesgos').select('descripcion_corta').eq('poliza_id', polizaId).limit(1).maybeSingle(),
  ])

  // Fechas: siempre usar el helper que parsea YYYY-MM-DD split-manual, para
  // evitar el drift de UTC que hace que en Argentina (UTC-3) una póliza con
  // fecha_fin '2026-07-03' se muestre como '02/07/2026'.
  const diasVenc = diasHastaVencimiento(poliza.fecha_fin)

  return {
    numero_poliza: poliza.numero_poliza || '',
    compania: (companiaRes.data as any)?.nombre || '',
    ramo: (ramoRes.data as any)?.nombre || '',
    fecha_inicio: formatFechaLocalLarga(poliza.fecha_inicio),
    fecha_fin: formatFechaLocalLarga(poliza.fecha_fin),
    // `bien_asegurado` es el nombre correcto de la variable (el "riesgo" es
    // el evento fortuito; el "bien asegurado" es lo que se cubre). Dejamos
    // `riesgo` como alias legacy para no romper plantillas viejas que aún
    // referencian {{riesgo}}.
    bien_asegurado: (riesgoRes.data as any)?.descripcion_corta || '',
    riesgo: (riesgoRes.data as any)?.descripcion_corta || '',
    dias_hasta_vencimiento: String(diasVenc),
  }
}

/**
 * Obtiene variables del PAS u organización desde configuración.
 *
 * Cache en proceso (TTL 60s): la configuración cambia muy raramente (logo
 * nuevo o cambio de teléfono) pero esta función la llama
 * `procesarEmailEncolado` UNA VEZ POR EMAIL. Una bandeja de 50 emails
 * automáticos = 50 queries idénticas. Con cache de 60s, un ciclo completo
 * del cron gasta 1 query en vez de 50.
 *
 * Invalidación: si el admin cambia el perfil (logo/nombre), se ve en el
 * próximo email después de 60s. Aceptable — la alternativa sería un
 * pub/sub que rompe la simpleza.
 */
let _cacheOrganizacion: { data: Record<string, string>; expira: number } | null = null
const TTL_ORGANIZACION_MS = 60_000

export async function obtenerVariablesOrganizacion(): Promise<Record<string, string>> {
  if (_cacheOrganizacion && Date.now() < _cacheOrganizacion.expira) {
    return _cacheOrganizacion.data
  }

  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('configuracion')
    .select('nombre, telefono, email, sitio_web, logo_path, color_marca, usar_logo, email_header_estilo, email_header_subtitulo, email_header_ocultar_nombre')
    .limit(1)
    .maybeSingle()

  if (!data) {
    _cacheOrganizacion = { data: {}, expira: Date.now() + TTL_ORGANIZACION_MS }
    return {}
  }

  // Si usar_logo es false, no exponemos el logo aunque haya logo_path:
  // el renderizador del email cae al fallback de "solo nombre".
  const mostrarLogo = data.usar_logo !== false && !!data.logo_path

  const nombre = data.nombre || ''
  const telefono = data.telefono || ''
  const email = data.email || ''
  const sitioWeb = (data as any).sitio_web || ''
  const logo = mostrarLogo ? (data.logo_path || '') : ''
  const colorMarca = data.color_marca || ''
  const headerEstilo = (data as any).email_header_estilo || 'banda'
  const headerSubtitulo = (data as any).email_header_subtitulo ?? ''
  // v1.0.149. Guardamos el boolean como string '1'/'' porque el mapa de
  // variables está tipado como Record<string, string>. En el caller comparamos
  // con `=== '1'`.
  const ocultarNombreHeader = (data as any).email_header_ocultar_nombre === true ? '1' : ''

  const vars = {
    organizacion_nombre: nombre,
    organizacion_telefono: telefono,
    organizacion_email: email,
    organizacion_sitio_web: sitioWeb,
    organizacion_logo: logo,
    organizacion_color_marca: colorMarca,
    organizacion_email_header_estilo: headerEstilo,
    organizacion_email_header_subtitulo: headerSubtitulo,
    organizacion_email_header_ocultar_nombre: ocultarNombreHeader,
  }
  _cacheOrganizacion = { data: vars, expira: Date.now() + TTL_ORGANIZACION_MS }
  return vars
}

/** Útil cuando el admin guarda /crm/configuracion/perfil: forzar refresh */
export function invalidarCacheVariablesOrganizacion(): void {
  _cacheOrganizacion = null
}
