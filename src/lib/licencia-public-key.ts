/**
 * Llave pública Ed25519 para verificar licencias .lic
 *
 * Este archivo se edita MANUALMENTE una sola vez en la vida del producto,
 * después de generar el par de llaves con el script portable de emisión:
 *   ~/pulzar-licencias-emision/generar-keypair.js
 *
 * Pasos:
 *   1) Correr el generador en la estación de emisión (~/pulzar-licencias-emision/).
 *   2) Abrir public.pem que aparece al lado del script.
 *   3) Copiar TODO el contenido (incluyendo las líneas BEGIN/END).
 *   4) Pegarlo abajo reemplazando el bloque actual (mantener los backticks).
 *   5) Rebuildear: docker compose build crm && docker compose up -d --force-recreate crm
 *
 * Los scripts NO viven en este repo a propósito — vivien fuera del CRM
 * en una "estación de emisión portable" que vos backupeás aparte (pendrive
 * offline + GDrive encriptado). Si tu servidor se rompe, podés seguir
 * emitiendo licencias desde cualquier máquina con Node.js.
 *
 * Override en runtime (testing/desarrollo): variable de entorno
 *   LICENCIA_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
 */

import crypto from 'crypto'

const LICENCIA_PUBLIC_KEY_EMBEBIDA = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA8/Jd6bOrIfokt8FTLvW1RCTyfJrcJVf8aQEMmyTCgX8=
-----END PUBLIC KEY-----`

// Sentinel para detectar "repo sin keypair generado". Si alguien forkea el
// código y resetea el archivo (o si Pulzar publica el repo público con la
// llave eliminada por seguridad), el bloque debería contener este texto.
const SENTINEL_PLACEHOLDER = 'PLACEHOLDER_REEMPLAZAR'

export function obtenerLicenciaPublicKey(): string {
  const override = process.env.LICENCIA_PUBLIC_KEY?.trim()
  if (override) return override.replace(/\\n/g, '\n')
  return LICENCIA_PUBLIC_KEY_EMBEBIDA
}

let cacheValida: boolean | null = null

/**
 * Indica si la llave pública embebida es INVÁLIDA y por lo tanto el CRM no puede
 * verificar licencias. Devuelve `true` (= "placeholder/inválida") cuando:
 *   - El archivo todavía contiene el sentinel placeholder (fork sin keypair).
 *   - El bloque no es parseable como clave pública Ed25519 PEM (corrupto,
 *     mal pegado, formato incorrecto, etc.).
 *
 * Mantiene el nombre `esLicenciaPublicKeyPlaceholder` para no romper callers
 * existentes — semánticamente significa "no es una llave usable".
 */
export function esLicenciaPublicKeyPlaceholder(): boolean {
  if (cacheValida !== null) return !cacheValida
  const pem = obtenerLicenciaPublicKey()
  if (pem.includes(SENTINEL_PLACEHOLDER)) {
    cacheValida = false
    return true
  }
  try {
    const key = crypto.createPublicKey(pem)
    const tipo = (key.asymmetricKeyType ?? '').toLowerCase()
    // Ed25519 es el único algoritmo soportado para firmar licencias.
    if (tipo !== 'ed25519') {
      cacheValida = false
      return true
    }
    cacheValida = true
    return false
  } catch {
    cacheValida = false
    return true
  }
}
