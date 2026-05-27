#!/usr/bin/env node
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') })

const { createClient } = require('@supabase/supabase-js')

// Colores ANSI
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

async function main() {
  const url = process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    console.error(`${RED}✗ Faltan variables de entorno. Verificá que .env.local tenga NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.${RESET}`)
    process.exit(1)
  }

  const supabase = createClient(url, key)

  const { data: perfiles, error } = await supabase
    .from('usuarios_perfil')
    .select('id, nombre, apellido, activo, ultimo_acceso, bloqueado_hasta')
    .eq('rol', 'ADMIN')
    .order('apellido')
    .order('nombre')

  if (error) {
    console.error(`${RED}✗ Error al consultar usuarios: ${error.message}${RESET}`)
    process.exit(1)
  }

  // Resolver emails desde auth.users
  const emailsPorId = new Map()
  let pageActual = 1
  while (true) {
    const { data: pagina } = await supabase.auth.admin.listUsers({ page: pageActual, perPage: 200 })
    const users = pagina?.users ?? []
    for (const u of users) emailsPorId.set(u.id, u.email ?? '')
    if (users.length < 200) break
    pageActual++
    if (pageActual > 50) break
  }

  const admins = (perfiles || []).map(p => ({ ...p, email: emailsPorId.get(p.id) || '' }))

  if (!admins || admins.length === 0) {
    console.log(`
${YELLOW}No hay administradores en el sistema.${RESET}
Usá ${BOLD}node scripts/create-emergency-admin.js${RESET} para crear uno.
`)
    process.exit(0)
  }

  console.log(`\n${BOLD}Administradores del sistema:${RESET}\n`)

  // Calcular anchos
  const emailMax = Math.max(5, ...admins.map(a => a.email.length))
  const nombreMax = Math.max(7, ...admins.map(a => `${a.nombre} ${a.apellido}`.length))

  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length))

  // Header
  console.log(`  ${pad('Email', emailMax)}   ${pad('Nombre', nombreMax)}   Estado              Último acceso`)
  console.log(`  ${'-'.repeat(emailMax)}   ${'-'.repeat(nombreMax)}   ${'─'.repeat(18)}   ${'─'.repeat(20)}`)

  for (const admin of admins) {
    const nombre = `${admin.nombre} ${admin.apellido}`
    let estado
    const ahora = new Date()

    if (admin.bloqueado_hasta && new Date(admin.bloqueado_hasta) > ahora) {
      const hasta = new Date(admin.bloqueado_hasta)
      estado = `${RED}Bloqueado ${hasta.toLocaleDateString('es-AR')} ${hasta.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}${RESET}`
    } else if (!admin.activo) {
      estado = `${YELLOW}Inactivo${RESET}`
    } else {
      estado = `${GREEN}Activo${RESET}`
    }

    let acceso = 'Nunca'
    if (admin.ultimo_acceso) {
      const d = new Date(admin.ultimo_acceso)
      const hoy = new Date()
      if (d.toDateString() === hoy.toDateString()) {
        acceso = `Hoy ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
      } else {
        acceso = `${d.toLocaleDateString('es-AR')} ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
      }
    }

    // Pad estado sin contar códigos ANSI
    const estadoVisible = estado.replace(/\x1b\[[0-9;]*m/g, '')
    const estadoPadded = estado + ' '.repeat(Math.max(0, 18 - estadoVisible.length))
    console.log(`  ${pad(admin.email, emailMax)}   ${pad(nombre, nombreMax)}   ${estadoPadded}   ${acceso}`)
  }

  console.log(`\n  Total: ${admins.length} administrador(es)\n`)
}

main().catch((err) => {
  console.error(`${RED}✗ Error inesperado: ${err.message}${RESET}`)
  process.exit(1)
})
