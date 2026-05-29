import { getSupabaseAdmin } from '@/lib/supabase/server'

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

  const fechaFin = poliza.fecha_fin ? new Date(poliza.fecha_fin) : null
  const hoy = new Date()
  const diasHastaVencimiento = fechaFin
    ? Math.ceil((fechaFin.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24))
    : 0

  const formatFecha = (f: string | null) => {
    if (!f) return ''
    const d = new Date(f)
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  return {
    numero_poliza: poliza.numero_poliza || '',
    compania: (companiaRes.data as any)?.nombre || '',
    ramo: (ramoRes.data as any)?.nombre || '',
    fecha_inicio: formatFecha(poliza.fecha_inicio),
    fecha_fin: formatFecha(poliza.fecha_fin),
    riesgo: (riesgoRes.data as any)?.descripcion_corta || '',
    dias_hasta_vencimiento: String(diasHastaVencimiento),
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
    .select('nombre, telefono, email, logo_path, color_marca, usar_logo')
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
  const logo = mostrarLogo ? (data.logo_path || '') : ''
  const colorMarca = data.color_marca || ''

  const vars = {
    organizacion_nombre: nombre,
    organizacion_telefono: telefono,
    organizacion_email: email,
    organizacion_logo: logo,
    organizacion_color_marca: colorMarca,
  }
  _cacheOrganizacion = { data: vars, expira: Date.now() + TTL_ORGANIZACION_MS }
  return vars
}

/** Útil cuando el admin guarda /crm/configuracion/perfil: forzar refresh */
export function invalidarCacheVariablesOrganizacion(): void {
  _cacheOrganizacion = null
}
