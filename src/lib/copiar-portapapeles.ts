/**
 * Copia texto al portapapeles con fallback para contextos no seguros (HTTP).
 *
 * `navigator.clipboard` solo funciona en HTTPS o localhost. El CRM corre en
 * `http://192.168.0.2:3000`, así que sin fallback el botón "Copiar" no hace
 * nada en producción. Usa `document.execCommand('copy')` con un textarea
 * temporal cuando la API moderna no está disponible.
 */
export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  if (!texto) return false

  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(texto)
      return true
    } catch {
      // cae al fallback
    }
  }

  if (typeof document === 'undefined') return false

  const textarea = document.createElement('textarea')
  textarea.value = texto
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)

  try {
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, texto.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}
