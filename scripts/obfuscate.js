#!/usr/bin/env node
/**
 * Code closure ligero (Hito 5 — roadmap de distribución).
 *
 * Aplica `javascript-obfuscator` a los chunks de Next.js que contienen código
 * sensible: verificación de licencias Ed25519 y desencriptación de la API key
 * de Anthropic. El resto del bundle queda como `next build` lo dejó
 * (minificado pero no ofuscado).
 *
 * Filosofía:
 *   - La protección real es el sistema de licencias firmadas Ed25519.
 *   - La ofuscación es una barrera contra modificaciones casuales del código
 *     publicado (cliente técnico que quiera anular la verificación de licencia
 *     o extraer la API key). No detiene a un atacante motivado.
 *   - El repo del CRM es público — esta capa solo eleva el costo del bypass.
 *
 * Por qué identificamos chunks por contenido y no por número:
 *   Next.js asigna números a los chunks por hash, así que cambian entre
 *   builds. Detectamos los chunks sensibles buscando "fingerprints" únicos
 *   (texto del PEM público, identificadores funcionales).
 *
 * Idempotencia:
 *   El script marca cada archivo ofuscado con un comentario sentinel
 *   `// PULZAR_OBFUSCATED_v1` en la primera línea. Si lo encuentra, salta
 *   el archivo. Útil cuando el build pipeline lo corre dos veces seguidas.
 *
 * Uso:
 *   node scripts/obfuscate.js               (corre con defaults)
 *   node scripts/obfuscate.js --verbose     (lista cada chunk procesado)
 *   node scripts/obfuscate.js --dry-run     (no escribe — solo reporta)
 */

const fs = require('fs')
const path = require('path')
const obfuscator = require('javascript-obfuscator')

const PROJECT_ROOT = path.resolve(__dirname, '..')

// Patrones que identifican los chunks sensibles. Si UN chunk matchea CUALQUIERA
// de estos patrones, lo ofuscamos entero. Mantener actualizado cuando agregue-
// mos código nuevo que debería protegerse.
const FINGERPRINTS = [
  // Licencias Ed25519
  'MCowBQYDK2VwAyEA',                    // primer fragmento de la public key embebida
  'verificarLicencia',                    // función de validación de firmas
  'esLicenciaPublicKeyPlaceholder',       // sentinel de keypair no generado
  'DIAS_GRACIA_POST_VENCIMIENTO',         // constante del modo gracia/bloqueado
  // Anthropic — API key encriptada
  'desencriptarApiKeyAnthropic',          // función de desencriptación
  'anthropic_api_key_encrypted',          // nombre de columna en DB (no es muy específico, pero ayuda)
]

const SENTINEL_LINE = '// PULZAR_OBFUSCATED_v1'

const CARPETAS_BUILD = [
  '.next/server/chunks',
  '.next/server/app/api',
  '.next/standalone/.next/server/chunks',
  '.next/standalone/.next/server/app/api',
]

// Opciones del ofuscador.
// Balanced preset — bastante fuerte sin destrozar el runtime de Next.js.
// Lo que SÍ usamos: rename identificadores, encoding base64 de strings,
// string array con rotation/shuffle, control de espacios.
// Lo que NO usamos:
//   - controlFlowFlattening (lento, frecuentemente rompe minimum bundles)
//   - selfDefending (puede tirar runtime errors en algunos entornos)
//   - debugProtection (overkill, agrega ruido a logs)
const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false,                  // CRÍTICO — false porque Next.js exporta funciones
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 1,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 2,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
  // Excluir las reservadas de Node.js para no romper exports/imports
  reservedNames: ['exports', 'module', 'require', 'default', '__esModule'],
}

// --- helpers ---

const args = process.argv.slice(2)
const VERBOSE = args.includes('--verbose')
const DRY_RUN = args.includes('--dry-run')

function log(msg) {
  console.log(`[obfuscate] ${msg}`)
}

function verbose(msg) {
  if (VERBOSE) console.log(`[obfuscate]   ${msg}`)
}

function archivoTieneFingerprint(contenido) {
  return FINGERPRINTS.some(fp => contenido.includes(fp))
}

function yaEstaOfuscado(contenido) {
  return contenido.startsWith(SENTINEL_LINE)
}

function* recorrerJsRecursivo(dir) {
  if (!fs.existsSync(dir)) return
  const entradas = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entradas) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      yield* recorrerJsRecursivo(full)
    } else if (e.isFile() && e.name.endsWith('.js')) {
      yield full
    }
  }
}

function ofuscarArchivo(archivoPath) {
  const original = fs.readFileSync(archivoPath, 'utf-8')

  if (yaEstaOfuscado(original)) {
    verbose(`skip (ya ofuscado): ${path.relative(PROJECT_ROOT, archivoPath)}`)
    return { skipped: true }
  }

  if (!archivoTieneFingerprint(original)) {
    return { irrelevante: true }
  }

  const tamañoOriginal = Buffer.byteLength(original, 'utf-8')

  let resultado
  try {
    resultado = obfuscator.obfuscate(original, OBFUSCATOR_OPTIONS).getObfuscatedCode()
  } catch (err) {
    log(`ERROR ofuscando ${path.relative(PROJECT_ROOT, archivoPath)}: ${err.message}`)
    return { error: err.message }
  }

  const conSentinel = `${SENTINEL_LINE}\n${resultado}`
  const tamañoNuevo = Buffer.byteLength(conSentinel, 'utf-8')

  if (!DRY_RUN) {
    fs.writeFileSync(archivoPath, conSentinel, 'utf-8')
  }

  return {
    ofuscado: true,
    tamañoOriginal,
    tamañoNuevo,
  }
}

// --- main ---

function main() {
  log(`raíz del proyecto: ${PROJECT_ROOT}`)
  log(`fingerprints: ${FINGERPRINTS.length} patrones`)
  if (DRY_RUN) log('MODO DRY-RUN: no se va a escribir nada')

  let totalEscaneados = 0
  let totalOfuscados = 0
  let totalSkipped = 0
  let totalErrores = 0
  let bytesAhorradosOAgregados = 0

  for (const carpeta of CARPETAS_BUILD) {
    const dirAbs = path.join(PROJECT_ROOT, carpeta)
    if (!fs.existsSync(dirAbs)) {
      verbose(`carpeta no existe (no rompe): ${carpeta}`)
      continue
    }
    verbose(`escaneando ${carpeta}`)

    for (const archivo of recorrerJsRecursivo(dirAbs)) {
      totalEscaneados++
      const res = ofuscarArchivo(archivo)
      if (res.ofuscado) {
        totalOfuscados++
        bytesAhorradosOAgregados += res.tamañoNuevo - res.tamañoOriginal
        log(`ofuscado: ${path.relative(PROJECT_ROOT, archivo)} (${res.tamañoOriginal} → ${res.tamañoNuevo} bytes)`)
      } else if (res.skipped) {
        totalSkipped++
      } else if (res.error) {
        totalErrores++
      }
    }
  }

  log('')
  log(`Total escaneados: ${totalEscaneados}`)
  log(`Ofuscados: ${totalOfuscados}`)
  log(`Ya ofuscados (skip): ${totalSkipped}`)
  log(`Errores: ${totalErrores}`)
  log(`Diferencia de tamaño: ${bytesAhorradosOAgregados >= 0 ? '+' : ''}${bytesAhorradosOAgregados} bytes`)

  if (totalErrores > 0) {
    process.exit(1)
  }

  if (totalOfuscados === 0 && totalSkipped === 0) {
    log('AVISO: ningún chunk matcheó los fingerprints. Verificá que el build se haya completado.')
    process.exit(2)
  }
}

main()
