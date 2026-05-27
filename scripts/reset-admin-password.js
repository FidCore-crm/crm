#!/usr/bin/env node
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') })

const { createClient } = require('@supabase/supabase-js')

// Colores ANSI
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

const args = process.argv.slice(2)

if (args.length !== 2) {
  console.log(`
${BOLD}Uso:${RESET} node scripts/reset-admin-password.js <email> <nueva-contraseña>

${BOLD}Ejemplo:${RESET}
  node scripts/reset-admin-password.js admin@example.com nueva123
`)
  process.exit(1)
}

const [email, password] = args

// Validar email
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(`${RED}✗ Email inválido: ${email}${RESET}`)
  process.exit(1)
}

// Validar contraseña
if (password.length < 6) {
  console.error(`${RED}✗ La contraseña debe tener al menos 6 caracteres.${RESET}`)
  process.exit(1)
}

async function main() {
  const url = process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    console.error(`${RED}✗ Faltan variables de entorno. Verificá que .env.local tenga NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.${RESET}`)
    process.exit(1)
  }

  const supabase = createClient(url, key)

  // Buscar usuario via RPC (post-migración a Supabase Auth)
  const { data: perfilArr, error: errBuscar } = await supabase.rpc('fn_obtener_perfil_por_email', {
    p_email: email,
  })

  const usuario = Array.isArray(perfilArr) && perfilArr.length > 0 ? perfilArr[0] : null

  if (errBuscar || !usuario) {
    console.error(`${RED}✗ No existe ningún usuario con el email: ${email}${RESET}`)
    process.exit(1)
  }

  if (usuario.rol !== 'ADMIN') {
    console.error(`${RED}✗ Este script solo resetea contraseñas de administradores. El usuario ${email} tiene rol ${usuario.rol}.${RESET}`)
    process.exit(1)
  }

  // Actualizar password via admin API de GoTrue
  const { error: errUpdate } = await supabase.auth.admin.updateUserById(usuario.id, { password })

  if (errUpdate) {
    console.error(`${RED}✗ Error al actualizar la contraseña: ${errUpdate.message}${RESET}`)
    process.exit(1)
  }

  // Resetear bloqueo en usuarios_perfil
  await supabase
    .from('usuarios_perfil')
    .update({ intentos_fallidos: 0, bloqueado_hasta: null })
    .eq('id', usuario.id)

  // Cerrar sesiones activas en GoTrue
  await supabase.auth.admin.signOut(usuario.id).catch(() => {})

  console.log(`
${GREEN}✓ Contraseña actualizada correctamente${RESET}

  ${BOLD}Usuario:${RESET} ${usuario.nombre} ${usuario.apellido}
  ${BOLD}Email:${RESET}   ${email}
  ${BOLD}Rol:${RESET}     ${usuario.rol}

  El usuario ya puede iniciar sesión con la nueva contraseña.
  Las sesiones anteriores fueron cerradas por seguridad.
`)
}

main().catch((err) => {
  console.error(`${RED}✗ Error inesperado: ${err.message}${RESET}`)
  process.exit(1)
})
