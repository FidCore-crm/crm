/**
 * Parser mínimo de User-Agent sin dependencias externas.
 *
 * Detecta browser, OS y tipo de dispositivo con regex simples.
 * No es exhaustivo (no cubre todos los browsers exóticos) — cubre los
 * que usamos en denuncias reales del portal público: Chrome, Safari,
 * Firefox, Edge, Samsung Internet, Opera, más los WebViews de WhatsApp/
 * Facebook. Todo lo demás cae a "Otro".
 */

export interface UserAgentParsed {
  browser: { nombre: string; version: string | null }
  os: { nombre: string; version: string | null }
  dispositivo: 'movil' | 'tablet' | 'desktop' | 'bot' | 'desconocido'
  user_agent_raw: string
}

const BROWSERS: Array<{ nombre: string; re: RegExp }> = [
  // Orden importante: los específicos primero (Edge, Samsung, Opera contienen "Chrome" en su UA).
  { nombre: 'WhatsApp WebView', re: /WhatsApp\/([\d.]+)/i },
  { nombre: 'Instagram', re: /Instagram ([\d.]+)/i },
  { nombre: 'Facebook', re: /FBAV\/([\d.]+)/i },
  { nombre: 'Edge', re: /Edg(?:e|iOS|A)?\/([\d.]+)/i },
  { nombre: 'Opera', re: /(?:OPR|Opera)\/([\d.]+)/i },
  { nombre: 'Samsung Internet', re: /SamsungBrowser\/([\d.]+)/i },
  { nombre: 'Firefox', re: /Firefox\/([\d.]+)/i },
  { nombre: 'Chrome', re: /Chrome\/([\d.]+)/i },
  { nombre: 'Safari', re: /Version\/([\d.]+).*Safari/i },
]

const OSS: Array<{ nombre: string; re: RegExp }> = [
  { nombre: 'iOS', re: /iP(?:hone|ad|od).*OS ([\d_]+)/i },
  { nombre: 'Android', re: /Android ([\d.]+)/i },
  { nombre: 'Windows', re: /Windows NT ([\d.]+)/i },
  { nombre: 'macOS', re: /Mac OS X ([\d_]+)/i },
  { nombre: 'Linux', re: /Linux/i },
  { nombre: 'Chrome OS', re: /CrOS/i },
]

const WINDOWS_NT_MAP: Record<string, string> = {
  '10.0': '10/11',
  '6.3': '8.1',
  '6.2': '8',
  '6.1': '7',
  '6.0': 'Vista',
  '5.1': 'XP',
}

function detectarBrowser(ua: string): { nombre: string; version: string | null } {
  for (const b of BROWSERS) {
    const m = ua.match(b.re)
    if (m) return { nombre: b.nombre, version: m[1] ?? null }
  }
  return { nombre: 'Otro', version: null }
}

function detectarOS(ua: string): { nombre: string; version: string | null } {
  for (const o of OSS) {
    const m = ua.match(o.re)
    if (m) {
      let version = m[1] ?? null
      if (version) {
        // iOS/macOS usan `_` en vez de `.`
        version = version.replace(/_/g, '.')
      }
      if (o.nombre === 'Windows' && version) {
        version = WINDOWS_NT_MAP[version] ?? version
      }
      return { nombre: o.nombre, version }
    }
  }
  return { nombre: 'Otro', version: null }
}

function detectarDispositivo(ua: string): UserAgentParsed['dispositivo'] {
  const lower = ua.toLowerCase()
  if (/bot|crawler|spider|preview|scanner|http/i.test(ua) && !lower.includes('mozilla')) {
    return 'bot'
  }
  if (/ipad|tablet|silk|kindle/i.test(ua)) return 'tablet'
  // Android tablets no siempre dicen "tablet" pero raramente dicen "mobile".
  if (/android/i.test(ua) && !/mobile/i.test(ua)) return 'tablet'
  if (/iphone|ipod|mobile|android|blackberry|windows phone|opera mini/i.test(ua)) return 'movil'
  if (/mozilla|chrome|safari|firefox|edge/i.test(ua)) return 'desktop'
  return 'desconocido'
}

export function parseUserAgent(ua: string | null | undefined): UserAgentParsed {
  const raw = (ua || '').slice(0, 500)
  if (!raw.trim()) {
    return {
      browser: { nombre: 'Desconocido', version: null },
      os: { nombre: 'Desconocido', version: null },
      dispositivo: 'desconocido',
      user_agent_raw: '',
    }
  }
  return {
    browser: detectarBrowser(raw),
    os: detectarOS(raw),
    dispositivo: detectarDispositivo(raw),
    user_agent_raw: raw,
  }
}

/** Etiqueta legible tipo "Chrome 120 en Windows 10/11" para UI. */
export function etiquetaBrowserOS(parsed: UserAgentParsed): string {
  const b = parsed.browser.nombre
  const bv = parsed.browser.version ? ` ${parsed.browser.version.split('.')[0]}` : ''
  const o = parsed.os.nombre
  const ov = parsed.os.version ? ` ${parsed.os.version}` : ''
  return `${b}${bv} en ${o}${ov}`.trim()
}

/** Etiqueta corta del dispositivo con emoji. */
export function etiquetaDispositivo(disp: UserAgentParsed['dispositivo']): string {
  switch (disp) {
    case 'movil':       return '📱 Móvil'
    case 'tablet':      return '📱 Tablet'
    case 'desktop':     return '💻 Computadora'
    case 'bot':         return '🤖 Bot'
    default:            return '❓ Desconocido'
  }
}
