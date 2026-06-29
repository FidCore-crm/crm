/**
 * Helpers puros (sin DB ni dependencias server-only) del sistema de leads web.
 * Pueden importarse desde componentes client y server.
 *
 * Las funciones que tocan DB viven en `src/lib/leads-web.ts` y son server-only.
 */

export type ModoAsignacionLeadsWeb = 'ROTATIVO' | 'ADMIN' | 'SIN_ASIGNAR'

export type MotivoRechazoLeadsWeb =
  | 'TOKEN_INVALIDO'
  | 'SISTEMA_INACTIVO'
  | 'RATE_LIMIT'
  | 'HONEYPOT'
  | 'REFERER_INVALIDO'
  | 'CAMPOS_FALTANTES'
  | 'EMAIL_INVALIDO'
  | 'PAYLOAD_GRANDE'
  | 'ERROR_INTERNO'

/**
 * Normaliza un dominio quitando protocolo, slashes, www. y mayúsculas.
 * "https://www.loboseguros.com.ar/" → "loboseguros.com.ar"
 */
export function normalizarDominio(input: string): string {
  let s = (input || '').trim().toLowerCase()
  if (!s) return ''
  s = s.replace(/^https?:\/\//, '')
  s = s.split('/')[0] || ''
  s = s.replace(/^www\./, '')
  return s
}

/**
 * Devuelve true si el origen (URL o hostname) coincide con alguno de los
 * dominios permitidos. Tolerante con/sin www.
 *
 * Caso especial: si `dominiosPermitidos` contiene "*" se acepta cualquiera
 * (modo desarrollo).
 */
export function dominioPermitido(origen: string, dominiosPermitidos: string[]): boolean {
  if (!dominiosPermitidos || dominiosPermitidos.length === 0) return false
  if (dominiosPermitidos.includes('*')) return true
  const normalizado = normalizarDominio(origen)
  if (!normalizado) return false
  return dominiosPermitidos.map(normalizarDominio).some((d) => d === normalizado)
}

/**
 * Construye los headers CORS para una respuesta cuando el origen es válido.
 * Si no coincide, devuelve headers vacíos (el navegador bloquea).
 */
export function corsHeadersParaOrigen(
  origen: string | null,
  dominiosPermitidos: string[],
): Record<string, string> {
  if (!origen) return {}
  if (!dominioPermitido(origen, dominiosPermitidos)) return {}
  return {
    'Access-Control-Allow-Origin': origen,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function generarHtmlFormEjemplo(urlPublica: string, redirectTo: string = ''): string {
  const redirectInput = redirectTo
    ? `\n  <input type="hidden" name="redirect_to" value="${escaparHtml(redirectTo)}">`
    : ''
  return `<form action="${escaparHtml(urlPublica)}" method="POST">
  <input type="text" name="nombre" placeholder="Nombre" required>
  <input type="email" name="email" placeholder="Email" required>
  <input type="tel" name="telefono" placeholder="Teléfono (opcional)">

  <select name="seguro">
    <option value="">Tipo de seguro</option>
    <option value="auto">Auto o moto</option>
    <option value="hogar">Hogar</option>
    <option value="comercio">Comercio y Empresa</option>
    <option value="vida">Vida y AP</option>
    <option value="otro">Otro</option>
  </select>

  <textarea name="mensaje" placeholder="Mensaje (opcional)" rows="4"></textarea>

  <!-- Campo invisible anti-spam (honeypot) — NO modificar ni eliminar -->
  <input type="text" name="website_honeypot" tabindex="-1" autocomplete="off"
         style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">${redirectInput}

  <button type="submit">Enviar</button>
</form>`
}
