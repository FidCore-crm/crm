import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import {
  ERRORES,
  respuestaError,
  respuestaExito,
  manejarErrores,
  ErrorAplicacion,
} from '@/lib/errores'
import { requireLicenciaActiva } from '@/lib/licencia-guard'

// Helper — carga el evento y valida ownership. Devuelve null si no aplica.
async function cargarConOwnership(supabase: any, id: string, usuario: { id: string; rol: string; acceso_cartera: string }) {
  const { data: evento } = await supabase
    .from('eventos')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!evento) return { evento: null, permitido: false, motivoNoPermitido: 'no_encontrado' as const }
  const esDueno = evento.usuario_id === usuario.id
  const esAdminTotal = tieneAccesoTotal(usuario)
  return {
    evento,
    permitido: esDueno || esAdminTotal,
    motivoNoPermitido: 'no_dueno' as const,
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/eventos/[id]
// ─────────────────────────────────────────────────────────────
export const GET = manejarErrores(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const supabase = getSupabaseAdmin()
  const { data: evento, error } = await supabase
    .from('eventos')
    .select(`
      id, usuario_id, titulo, descripcion, fecha, hora_inicio, hora_fin,
      categoria, recurrencia, estado, compartido, nota_cierre,
      created_at, updated_at,
      creador:usuarios_perfil!eventos_usuario_id_fkey (id, nombre, apellido)
    `)
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, { detalle: error.message })
  }
  if (!evento) {
    return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)
  }

  // Puede verlo si es dueño, admin/TOTAL, o está compartido.
  const esDueno = (evento as any).usuario_id === usuario.id
  const esAdminTotal = tieneAccesoTotal(usuario)
  const esCompartido = (evento as any).compartido === true
  if (!(esDueno || esAdminTotal || esCompartido)) {
    return respuestaError(ERRORES.PERM_RECURSO_AJENO)
  }

  return respuestaExito({ evento })
}, { modulo: 'eventos' })

// ─────────────────────────────────────────────────────────────
// PATCH /api/eventos/[id]
// Solo dueño o admin/TOTAL pueden editar.
// ─────────────────────────────────────────────────────────────
export const PATCH = manejarErrores(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  await requireLicenciaActiva()

  const supabase = getSupabaseAdmin()
  const { evento, permitido, motivoNoPermitido } = await cargarConOwnership(supabase, id, usuario)
  if (!evento) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)
  if (!permitido) {
    return respuestaError(motivoNoPermitido === 'no_dueno' ? ERRORES.PERM_RECURSO_AJENO : ERRORES.PERM_SIN_PERMISO)
  }

  const body = await request.json()
  const CAMPOS_EDITABLES = new Set([
    'titulo', 'descripcion', 'fecha', 'hora_inicio', 'hora_fin',
    'categoria', 'recurrencia', 'estado', 'compartido', 'nota_cierre',
  ])
  const patch: Record<string, any> = {}
  for (const [k, v] of Object.entries(body)) {
    if (CAMPOS_EDITABLES.has(k)) patch[k] = v
  }

  if ('titulo' in patch) {
    if (!patch.titulo || String(patch.titulo).trim() === '') {
      return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
        campos: { titulo: 'El título es obligatorio' },
      })
    }
    patch.titulo = String(patch.titulo).trim().slice(0, 200)
  }
  if ('fecha' in patch && !/^\d{4}-\d{2}-\d{2}$/.test(patch.fecha)) {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
      campos: { fecha: 'Formato de fecha inválido (YYYY-MM-DD)' },
    })
  }
  if ('recurrencia' in patch) {
    const validos = ['NINGUNA','DIARIA','SEMANAL','MENSUAL','ANUAL']
    if (!validos.includes(patch.recurrencia)) patch.recurrencia = 'NINGUNA'
  }
  if ('estado' in patch) {
    const validos = ['PROGRAMADO','COMPLETADO','CANCELADO']
    if (!validos.includes(patch.estado)) {
      return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
        campos: { estado: 'Estado inválido' },
      })
    }
  }
  if ('hora_inicio' in patch || 'hora_fin' in patch) {
    const hi = 'hora_inicio' in patch ? patch.hora_inicio : (evento as any).hora_inicio
    const hf = 'hora_fin' in patch ? patch.hora_fin : (evento as any).hora_fin
    if (hi && hf && hf < hi) {
      return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
        detalle: 'La hora de fin no puede ser anterior a la hora de inicio.',
      })
    }
  }

  const { data: actualizado, error } = await supabase
    .from('eventos')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, { detalle: error.message })
  }

  return respuestaExito({ evento: actualizado })
}, { modulo: 'eventos' })

// ─────────────────────────────────────────────────────────────
// DELETE /api/eventos/[id]
// ─────────────────────────────────────────────────────────────
export const DELETE = manejarErrores(async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  await requireLicenciaActiva()

  const supabase = getSupabaseAdmin()
  const { evento, permitido, motivoNoPermitido } = await cargarConOwnership(supabase, id, usuario)
  if (!evento) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)
  if (!permitido) {
    return respuestaError(motivoNoPermitido === 'no_dueno' ? ERRORES.PERM_RECURSO_AJENO : ERRORES.PERM_SIN_PERMISO)
  }

  const { error } = await supabase.from('eventos').delete().eq('id', id)
  if (error) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, { detalle: error.message })
  }
  return respuestaExito({ ok: true })
}, { modulo: 'eventos' })
