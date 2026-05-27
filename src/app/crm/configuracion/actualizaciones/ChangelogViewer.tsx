'use client'

/**
 * Render seguro y limpio del changelog de un release.
 *
 * GitHub devuelve el cuerpo del release en markdown ligero (`### Título`,
 * `- bullet`, `**negrita**`, etc.) con CRLF. Esto:
 *   - Normaliza CRLF/CR a LF
 *   - Reconoce headers `# H1`, `## H2`, `### H3`
 *   - Reconoce bullets `- `, `* `
 *   - Reconoce listas numeradas `1. `
 *   - Reconoce `**negrita**`, `*itálica*`, `` `código` ``
 *   - Linkifica URLs http(s)://
 *
 * No usa una librería markdown completa para mantener el bundle chico y
 * tener control total sobre qué se renderiza (anti-XSS). Todo el texto
 * usuario se escapa primero y luego se aplican los reemplazos.
 */

interface Props {
  texto: string
  className?: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function aplicarInline(s: string): string {
  // ESCAPADO PRIMERO — todo lo que sigue trabaja sobre HTML-safe
  let out = escapeHtml(s)
  // Código inline `xxx`
  out = out.replace(/`([^`]+)`/g, '<code class="bg-slate-100 text-slate-800 px-1 rounded text-2xs font-mono">$1</code>')
  // Negrita **xxx**
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-slate-900">$1</strong>')
  // Itálica *xxx* — cuidar de no matchear el ** ya consumido (negative lookahead simple)
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  // URLs (escape ya aplicado → < y > están encoded, los http://... quedan crudos)
  out = out.replace(
    /(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">$1</a>',
  )
  return out
}

export function ChangelogViewer({ texto, className = '' }: Props) {
  if (!texto || !texto.trim()) {
    return (
      <p className={`text-xs text-slate-400 italic ${className}`}>
        Sin descripción de cambios.
      </p>
    )
  }

  // Normalizar saltos de línea (GitHub manda CRLF)
  const normalizado = texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lineas = normalizado.split('\n')

  type Bloque =
    | { tipo: 'h1' | 'h2' | 'h3' | 'parrafo'; contenido: string }
    | { tipo: 'lista'; items: string[]; ordenada: boolean }
    | { tipo: 'vacio' }

  const bloques: Bloque[] = []
  let listaBuffer: { items: string[]; ordenada: boolean } | null = null
  let parrafoBuffer: string[] = []

  const flushLista = () => {
    if (listaBuffer) {
      bloques.push({ tipo: 'lista', items: listaBuffer.items, ordenada: listaBuffer.ordenada })
      listaBuffer = null
    }
  }
  const flushParrafo = () => {
    if (parrafoBuffer.length > 0) {
      bloques.push({ tipo: 'parrafo', contenido: parrafoBuffer.join(' ') })
      parrafoBuffer = []
    }
  }

  for (const raw of lineas) {
    const linea = raw.trim()

    // Línea vacía → cierra párrafo/lista
    if (!linea) {
      flushLista()
      flushParrafo()
      continue
    }

    // Headers
    if (/^### /.test(linea)) {
      flushLista()
      flushParrafo()
      bloques.push({ tipo: 'h3', contenido: linea.replace(/^### /, '') })
      continue
    }
    if (/^## /.test(linea)) {
      flushLista()
      flushParrafo()
      bloques.push({ tipo: 'h2', contenido: linea.replace(/^## /, '') })
      continue
    }
    if (/^# /.test(linea)) {
      flushLista()
      flushParrafo()
      bloques.push({ tipo: 'h1', contenido: linea.replace(/^# /, '') })
      continue
    }

    // Bullets
    const matchBullet = /^[-*] (.*)/.exec(linea)
    if (matchBullet) {
      flushParrafo()
      if (!listaBuffer || listaBuffer.ordenada) {
        flushLista()
        listaBuffer = { items: [], ordenada: false }
      }
      listaBuffer.items.push(matchBullet[1])
      continue
    }

    // Lista numerada
    const matchNum = /^\d+\.\s+(.*)/.exec(linea)
    if (matchNum) {
      flushParrafo()
      if (!listaBuffer || !listaBuffer.ordenada) {
        flushLista()
        listaBuffer = { items: [], ordenada: true }
      }
      listaBuffer.items.push(matchNum[1])
      continue
    }

    // Texto normal → acumular como párrafo
    parrafoBuffer.push(linea)
  }
  flushLista()
  flushParrafo()

  return (
    <div className={`text-xs leading-relaxed text-slate-700 space-y-2 ${className}`}>
      {bloques.map((b, i) => {
        if (b.tipo === 'h1') {
          return <h2 key={i} className="text-base font-bold text-slate-900 mt-3 first:mt-0">{b.contenido}</h2>
        }
        if (b.tipo === 'h2') {
          return <h3 key={i} className="text-sm font-semibold text-slate-900 mt-3 first:mt-0">{b.contenido}</h3>
        }
        if (b.tipo === 'h3') {
          return <h4 key={i} className="text-xs font-semibold text-slate-800 mt-2 first:mt-0">{b.contenido}</h4>
        }
        if (b.tipo === 'parrafo') {
          return (
            <p key={i} dangerouslySetInnerHTML={{ __html: aplicarInline(b.contenido) }} />
          )
        }
        if (b.tipo === 'lista') {
          const Tag = b.ordenada ? 'ol' : 'ul'
          return (
            <Tag key={i} className={`pl-5 space-y-1 ${b.ordenada ? 'list-decimal' : 'list-disc'}`}>
              {b.items.map((item, j) => (
                <li key={j} dangerouslySetInnerHTML={{ __html: aplicarInline(item) }} />
              ))}
            </Tag>
          )
        }
        return null
      })}
    </div>
  )
}
