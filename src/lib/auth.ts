/**
 * Adaptador de auth: API pública igual que la versión custom anterior,
 * implementación interna usa Supabase Auth (GoTrue) + `usuarios_perfil`.
 *
 * Mantiene la misma firma para que los ~48 archivos del CRM que importan
 * de `@/lib/auth` no se rompan en la migración. El tipo `Usuario` que se
 * devuelve se reconstruye juntando `auth.users` + `public.usuarios_perfil`.
 *
 * Cookies usadas:
 *   - `crm_session`  → refresh_token (30 días). Es la cookie principal,
 *                       sobrevive a reinicios del browser.
 *   - `crm_access`   → access_token (1 hora). Para validar rápido sin
 *                       hacer roundtrip a GoTrue en cada request.
 *
 * Cuando el access_token vence, `obtenerUsuarioDesdeRequest()` usa el
 * refresh_token para obtener uno nuevo. La rotación se hace contra GoTrue;
 * las cookies actualizadas se devuelven via el helper opcional.
 */

import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import type { Usuario } from '@/types/database'

// ---- helpers ----

function getSupabaseUrlServer(): string {
  return (
    process.env.SUPABASE_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL!
  )
}

/** Cliente Supabase configurado con la anon key — usado para llamadas
 *  al endpoint de auth (signIn, signOut, refreshSession). NO usar el
 *  service_role para esto, porque GoTrue distingue entre admin y user. */
function getAuthClient() {
  return createClient(
    getSupabaseUrlServer(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

interface JwtPayload {
  sub: string // user id (auth.users.id)
  email: string
  exp: number
  iat: number
  app_metadata?: {
    rol?: string
    acceso_cartera?: string
    nombre?: string
    apellido?: string
  }
}

/** Lee el secret HS256 con el que GoTrue firma los JWTs. En producción se
 *  inyecta como `SUPABASE_JWT_SECRET` en el env del container del CRM (debe
 *  coincidir EXACTAMENTE con el JWT_SECRET de /home/<usuario>/supabase/docker/.env).
 *  Si no está, fallamos cerrado: la app no puede validar firmas, así que
 *  todos los tokens son rechazados. */
function getJwtSecret(): string | null {
  return process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET || null
}

/** Compara dos buffers en tiempo constante para evitar timing attacks. */
function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/** Decodifica + VERIFICA la firma HS256 de un JWT. Si la firma no coincide
 *  con el secret de GoTrue, devuelve null. Esto cierra el vector de
 *  forging: un atacante no puede armar un JWT con `sub: <uuid del admin>`
 *  porque no conoce el secret para firmarlo.
 *
 *  Solo soporta HS256 (el algoritmo que usa GoTrue). Si llega un token
 *  con otro `alg` (incluido "none"), se rechaza. */
function verificarYDecodificarJwt(token: string): JwtPayload | null {
  try {
    const secret = getJwtSecret()
    if (!secret) {
      // Fail closed: sin secret no podemos validar nada.
      // En dev/test puede ser ruidoso, por eso solo loguear una vez al boot.
      if (!(globalThis as any).__warned_jwt_secret_missing) {
        console.error('[auth] SUPABASE_JWT_SECRET no está configurado. Todos los JWTs serán rechazados.')
        ;(globalThis as any).__warned_jwt_secret_missing = true
      }
      return null
    }

    const partes = token.split('.')
    if (partes.length !== 3) return null

    const [headerB64, payloadB64, firmaB64] = partes

    // Validar header — solo aceptamos HS256
    const headerJson = Buffer.from(headerB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    const header = JSON.parse(headerJson) as { alg?: string; typ?: string }
    if (header.alg !== 'HS256') return null

    // Verificar firma
    const firmaEsperada = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest()

    // La firma del token viene en base64url; normalizar a base64 estándar
    const firmaRecibidaB64 = firmaB64.replace(/-/g, '+').replace(/_/g, '/')
    // Pad a múltiplo de 4 para Buffer.from('base64')
    const padLen = (4 - (firmaRecibidaB64.length % 4)) % 4
    const firmaRecibida = Buffer.from(firmaRecibidaB64 + '='.repeat(padLen), 'base64')

    if (!safeEqual(firmaEsperada, firmaRecibida)) return null

    // Firma válida — parsear payload
    const payloadJson = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
    return JSON.parse(payloadJson) as JwtPayload
  } catch {
    return null
  }
}

function jwtVencido(payload: JwtPayload): boolean {
  return Date.now() / 1000 >= payload.exp - 30 // 30s margen
}

interface CookiesSesion {
  refresh_token: string | null
  access_token: string | null
}

function leerCookiesSesion(cookieHeader: string): CookiesSesion {
  const cookies: Record<string, string> = {}
  for (const seg of cookieHeader.split(';')) {
    const [k, ...rest] = seg.trim().split('=')
    if (!k) continue
    cookies[k] = rest.join('=')
  }
  return {
    refresh_token: cookies['crm_session'] || null,
    access_token: cookies['crm_access'] || null,
  }
}

// ---- API pública ----

/** Hash bcrypt — se mantiene por compat con scripts admin que crean
 *  usuarios sin pasar por Supabase Auth. No se usa en el flujo normal. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

/** Compare bcrypt — se mantiene por compat. No se usa en el flujo normal. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function generarToken(): string {
  return crypto.randomUUID() + crypto.randomBytes(32).toString('hex')
}

/** Resultado de un login exitoso con Supabase Auth: contiene los dos
 *  tokens que tenés que setear como cookies. */
export interface SesionSupabase {
  access_token: string
  refresh_token: string
  expires_at: number
  user_id: string
}

/** Inicia sesión contra GoTrue y devuelve los tokens. La cookie la
 *  setea el endpoint que llama a esta función. */
export async function loginConSupabase(
  email: string,
  password: string,
): Promise<{ ok: true; sesion: SesionSupabase } | { ok: false; error: string }> {
  const supabase = getAuthClient()
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.toLowerCase().trim(),
    password,
  })

  if (error || !data.session) {
    return { ok: false, error: error?.message ?? 'Credenciales inválidas' }
  }

  return {
    ok: true,
    sesion: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at ?? 0,
      user_id: data.user.id,
    },
  }
}

/** Genera un link auto-confirmable usando la admin API de GoTrue.
 *
 *  Casos de uso:
 *   - 'recovery' → reset de password
 *   - 'invite' → invitar a un usuario nuevo
 *   - 'magiclink' → login sin contraseña
 *   - 'email_change_current' / 'email_change_new' → cambio de email
 *
 *  El CRM usa el link generado para mandar un email con SUS propias
 *  plantillas (no las de GoTrue). El link contiene un token de un solo uso
 *  con la expiración configurada en GoTrue.
 */
export async function generarLinkAdmin(params: {
  type: 'recovery' | 'invite' | 'magiclink' | 'signup' | 'email_change_current' | 'email_change_new'
  email: string
  password?: string
  newEmail?: string
  redirectTo?: string
  data?: Record<string, any>
}): Promise<{ ok: true; action_link: string } | { ok: false; error: string }> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.auth.admin.generateLink({
    type: params.type as any,
    email: params.email,
    password: params.password,
    newEmail: params.newEmail,
    options: {
      redirectTo: params.redirectTo,
      data: params.data,
    } as any,
  })

  if (error || !data?.properties?.action_link) {
    return { ok: false, error: error?.message ?? 'No se pudo generar el link' }
  }

  return { ok: true, action_link: data.properties.action_link }
}

/** Renueva el access_token usando un refresh_token válido. Si el
 *  refresh_token también está vencido o revocado, devuelve null. */
export async function refrescarSesion(refresh_token: string): Promise<SesionSupabase | null> {
  const supabase = getAuthClient()
  const { data, error } = await supabase.auth.refreshSession({ refresh_token })

  if (error || !data.session || !data.user) return null

  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at ?? 0,
    user_id: data.user.id,
  }
}

/** Compat: antiguo `crearSesion(usuario_id)`. Ya no aplica con Supabase
 *  Auth porque las sesiones las maneja GoTrue. Devuelve string vacío y
 *  loguea un warning para que sea evidente que el caller debe migrarse. */
export async function crearSesion(_usuarioId: string): Promise<string> {
  console.warn('[auth] crearSesion() llamado — está obsoleto. Usá loginConSupabase().')
  return ''
}

/** Cierra la sesión: invalida el refresh_token contra GoTrue. */
export async function cerrarSesion(refresh_token: string): Promise<void> {
  if (!refresh_token) return
  const supabase = getAuthClient()
  // Inicializamos el cliente con la sesión para que sepa cuál cerrar
  await supabase.auth.setSession({ access_token: '', refresh_token })
  await supabase.auth.signOut()
}

/** No-op: GoTrue limpia sus sesiones expiradas automáticamente. Se
 *  mantiene la firma por compat. */
export async function limpiarSesionesExpiradas(): Promise<void> {
  // Nothing to do — GoTrue ya lo hace.
}

/** Construye el objeto `Usuario` (forma legacy compatible con el resto
 *  del CRM) a partir del user_id, juntando `auth.users` + `usuarios_perfil`. */
async function reconstruirUsuario(userId: string, emailHint?: string): Promise<Usuario | null> {
  const supabase = getSupabaseAdmin()

  const { data: perfil } = await supabase
    .from('usuarios_perfil')
    .select('*')
    .eq('id', userId)
    .single()

  if (!perfil) return null
  const p: any = perfil

  if (!p.activo) return null

  // Verificar bloqueo
  if (p.bloqueado_hasta && new Date(p.bloqueado_hasta) > new Date()) {
    return null
  }

  // Email: el JWT lo trae; si no, lo pedimos al admin API de GoTrue (auth.users).
  let email = emailHint
  if (!email) {
    try {
      const authClient = getAuthClient()
      const { data } = await authClient.auth.admin.getUserById(userId)
      email = data?.user?.email ?? ''
    } catch {
      email = ''
    }
  }

  return {
    id: p.id,
    nombre: p.nombre,
    apellido: p.apellido,
    email: email ?? '',
    password_hash: '', // ya no se expone
    rol: p.rol,
    acceso_cartera: p.acceso_cartera,
    activo: p.activo,
    ultimo_acceso: p.ultimo_acceso,
    intentos_fallidos: p.intentos_fallidos ?? 0,
    bloqueado_hasta: p.bloqueado_hasta,
    mostrar_ayuda_contextual: p.mostrar_ayuda_contextual ?? true,
    created_at: p.created_at,
    updated_at: p.updated_at,
  }
}

/** Mantiene la firma legacy. Internamente valida JWT y reconstruye el
 *  objeto `Usuario` desde `usuarios_perfil`. Si el token tiene los
 *  claims custom (rol, acceso_cartera) inyectados por el hook de la
 *  migración 055, puede evitar la query al perfil — pero igual la hace
 *  por simplicidad y para chequear `activo` y `bloqueado_hasta`. */
export async function validarSesion(token: string): Promise<Usuario | null> {
  const payload = verificarYDecodificarJwt(token)
  if (!payload) return null
  if (jwtVencido(payload)) return null
  return reconstruirUsuario(payload.sub, payload.email)
}

/** Resultado del helper de request: el usuario + (opcional) los tokens
 *  rotados si hubo refresh. Los endpoints que reciben este resultado
 *  pueden re-setear las cookies del response. */
export interface ResultadoAuthRequest {
  usuario: Usuario | null
  tokens_rotados?: SesionSupabase
}

/** Validación completa de un request: lee cookies, valida access_token,
 *  refresca con refresh_token si hace falta. Devuelve solo el usuario
 *  para mantener la firma legacy. */
export async function obtenerUsuarioDesdeRequest(request: Request): Promise<Usuario | null> {
  const res = await obtenerUsuarioYRotacion(request)
  return res.usuario
}

/** Versión extendida que también devuelve los tokens rotados (cuando el
 *  access_token vencía y se renovó). Usar esta cuando el endpoint quiera
 *  re-setear las cookies en el response. */
export async function obtenerUsuarioYRotacion(request: Request): Promise<ResultadoAuthRequest> {
  const cookieHeader = request.headers.get('cookie') ?? ''
  const { refresh_token, access_token } = leerCookiesSesion(cookieHeader)

  if (!refresh_token && !access_token) return { usuario: null }

  // 1) Si hay access_token y está vigente, usarlo directo
  if (access_token) {
    const payload = verificarYDecodificarJwt(access_token)
    if (payload && !jwtVencido(payload)) {
      const usuario = await reconstruirUsuario(payload.sub, payload.email)
      return { usuario }
    }
  }

  // 2) Si no, intentar refresh
  if (!refresh_token) return { usuario: null }
  const rotados = await refrescarSesion(refresh_token)
  if (!rotados) return { usuario: null }

  const usuario = await reconstruirUsuario(rotados.user_id)
  return { usuario, tokens_rotados: rotados }
}
