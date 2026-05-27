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

if (args.length !== 4) {
  console.log(`
${BOLD}Uso:${RESET} node scripts/create-emergency-admin.js <email> <nombre> <apellido> <contraseña>

${BOLD}Ejemplo:${RESET}
  node scripts/create-emergency-admin.js admin@example.com Juan Perez admin123
`)
  process.exit(1)
}

const [email, nombre, apellido, password] = args

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

  // Verificar que no exista (via RPC porque auth.users no está expuesto)
  const { data: existeArr } = await supabase.rpc('fn_obtener_perfil_por_email', { p_email: email })
  if (Array.isArray(existeArr) && existeArr.length > 0) {
    console.error(`${RED}✗ Ya existe un usuario con el email: ${email}${RESET}`)
    console.log(`  Usá ${BOLD}node scripts/reset-admin-password.js${RESET} para cambiar su contraseña.`)
    process.exit(1)
  }

  // Crear usuario via admin API de GoTrue. El trigger crea usuarios_perfil
  // automáticamente desde el user_metadata.
  const { data: created, error: errCreate } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nombre, apellido, rol: 'ADMIN', acceso_cartera: 'TOTAL' },
  })

  if (errCreate || !created?.user) {
    console.error(`${RED}✗ Error al crear el usuario: ${errCreate?.message ?? 'sin detalle'}${RESET}`)
    process.exit(1)
  }

  // Asegurar rol y acceso_cartera correctos en el perfil
  await supabase
    .from('usuarios_perfil')
    .update({ rol: 'ADMIN', acceso_cartera: 'TOTAL' })
    .eq('id', created.user.id)

  console.log(`
${GREEN}✓ Administrador de emergencia creado${RESET}

  ${BOLD}Email:${RESET}   ${email}
  ${BOLD}Nombre:${RESET}  ${nombre} ${apellido}
  ${BOLD}Rol:${RESET}     ADMIN
  ${BOLD}Acceso:${RESET}  Cartera total

  Ya podés iniciar sesión en el CRM con estas credenciales.
  ${YELLOW}IMPORTANTE: cambiá esta contraseña después del primer login.${RESET}
`)
}

main().catch((err) => {
  console.error(`${RED}✗ Error inesperado: ${err.message}${RESET}`)
  process.exit(1)
})
