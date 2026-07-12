// ============================================================
// Helper centralizado para resolver las 3 URLs públicas del CRM:
//   - url_crm                 (admin/login)                → env URL_CRM_PUBLICA
//   - url_portal_cliente      (portal del asegurado, /c/[token]) → env URL_PORTAL_CLIENTE
//   - url_formulario_publico  (formulario de denuncia, /denuncia) → env URL_FORMULARIO_PUBLICO
//
// Las 3 se leen SOLO del env. El instalador las setea durante el wizard.
// El PAS no puede editarlas desde el CRM — son infraestructura fija por
// instalación.
//
// Historia: originalmente vivían en `configuracion.url_*` en DB y el
// resolver caía al env. Eso permitía que un restore de DB de otra
// instalación pisara las URLs correctas. Simplificado en la sesión del
// 2026-07-13: env manda siempre. Las columnas DB quedan vacías (código
// muerto, sin eliminar por costo bajo/nulo).
//
// Todas las URLs se devuelven sin trailing slash. Si el env no está,
// devuelve null.
// ============================================================

export type TipoUrl = 'crm' | 'portal_cliente' | 'formulario_publico'

const ENV_POR_TIPO: Record<TipoUrl, string> = {
  crm: 'URL_CRM_PUBLICA',
  portal_cliente: 'URL_PORTAL_CLIENTE',
  formulario_publico: 'URL_FORMULARIO_PUBLICO',
}

function normalizar(url: string | null | undefined): string | null {
  if (!url) return null
  const limpia = String(url).trim().replace(/\/+$/, '')
  return limpia.length > 0 ? limpia : null
}

/**
 * Lee las 3 URLs públicas del env. Función async (no cambia la firma para
 * mantener compat con todos los callers) aunque técnicamente ya no espera IO.
 */
export async function obtenerUrlsPublicas(): Promise<{
  crm: string | null
  portal_cliente: string | null
  formulario_publico: string | null
}> {
  return {
    crm: normalizar(process.env[ENV_POR_TIPO.crm]),
    portal_cliente: normalizar(process.env[ENV_POR_TIPO.portal_cliente]),
    formulario_publico: normalizar(process.env[ENV_POR_TIPO.formulario_publico]),
  }
}

export async function obtenerUrlCRM(): Promise<string | null> {
  return (await obtenerUrlsPublicas()).crm
}

export async function obtenerUrlPortalCliente(): Promise<string | null> {
  return (await obtenerUrlsPublicas()).portal_cliente
}

export async function obtenerUrlFormularioPublico(): Promise<string | null> {
  return (await obtenerUrlsPublicas()).formulario_publico
}

/**
 * Construye la URL pública completa del portal para un token.
 * Devuelve string vacío si la URL del portal no está configurada
 * (mismo contrato que la versión sync original).
 */
export async function construirUrlPortalDinamica(token: string): Promise<string> {
  const base = await obtenerUrlPortalCliente()
  if (!base) return ''
  return `${base}/c/${token}`
}

// Rangos privados RFC 1918 + loopback + link-local. Estos NO pueden tener
// cert SSL válido emitido por una CA pública, así que NO se permite HTTPS
// sobre ellos.
const HOSTNAME_PRIVADO = /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|.*\.local|.*\.localhost|.*\.internal)$/i

function esHostnamePrivado(host: string): boolean {
  // host puede venir con puerto (192.168.0.2:3000). Lo separamos.
  const sinPuerto = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return HOSTNAME_PRIVADO.test(sinPuerto)
}

/**
 * Validación de URL pública. Acepta http/https, sin trailing slash, sin
 * path/query/fragment. La pantalla de edición la usa antes de guardar.
 *
 * Reglas:
 *   - HTTP solo se permite para localhost (development).
 *   - HTTPS solo se permite para hostnames PÚBLICOS (no IPs privadas, no
 *     .local, no .internal). Una IP privada no puede tener cert SSL emitido
 *     por una CA pública, así que un link con https://192.168.x.x falla en
 *     el browser del cliente del PAS.
 *
 * Devuelve `{ valido: true, normalizada }` o `{ valido: false, motivo }`.
 */
export function validarUrlPublica(
  url: string | null | undefined,
): { valido: true; normalizada: string | null } | { valido: false; motivo: string } {
  if (url === null || url === undefined || String(url).trim() === '') {
    // Vacío es válido: significa "usar fallback / no configurada".
    return { valido: true, normalizada: null }
  }
  const limpia = String(url).trim().replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(limpia)
  } catch {
    return { valido: false, motivo: 'Formato de URL inválido' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valido: false, motivo: 'La URL debe empezar con http:// o https://' }
  }
  if (parsed.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(parsed.host)) {
    return { valido: false, motivo: 'Solo se permite http:// para localhost; el resto debe usar https://' }
  }
  if (parsed.protocol === 'https:' && esHostnamePrivado(parsed.host)) {
    return {
      valido: false,
      motivo:
        'No se puede usar HTTPS con una IP privada o dominio local. Para que el link funcione en el teléfono del cliente, usá tu dominio público (ej: https://miorganizacion.fidcore.com.ar).',
    }
  }
  if (parsed.pathname && parsed.pathname !== '/' && parsed.pathname !== '') {
    return { valido: false, motivo: 'No incluyas path en la URL (solo el dominio raíz)' }
  }
  if (parsed.search || parsed.hash) {
    return { valido: false, motivo: 'No incluyas query ni fragment en la URL' }
  }
  // Reconstruimos sin path/trailing slash para normalizar.
  const normalizada = `${parsed.protocol}//${parsed.host}`
  return { valido: true, normalizada }
}
