#!/usr/bin/env node
/**
 * Devuelve por stdout la última migración SQL aplicada al proyecto.
 * Se basa en listar `sql/migrations/` ordenado alfabéticamente y tomar el
 * último archivo — convención del repo (migraciones numeradas 001, 002, ...).
 *
 * Devuelve solo el prefijo numérico (ej: "009") o "0" si no hay migraciones.
 */

const fs = require('fs')
const path = require('path')

try {
  const dir = path.resolve(__dirname, '..', 'sql', 'migrations')
  if (!fs.existsSync(dir)) {
    process.stdout.write('0\n')
    process.exit(0)
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  if (files.length === 0) {
    process.stdout.write('0\n')
    process.exit(0)
  }
  const last = files[files.length - 1]
  const m = last.match(/^(\d+)/)
  process.stdout.write(m ? `${m[1]}\n` : `${last}\n`)
} catch (err) {
  process.stdout.write('0\n')
}
