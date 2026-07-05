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

// ─────────────────────────────────────────────────────────────
// GET /api/eventos?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
//
// Lista eventos en un rango de fechas. Scope:
//   - Admin/TOTAL: todos los eventos.
//   - Usuario normal: los propios + los compartidos (compartido=true).
// ─────────────────────────────────────────────────────────────
export const GET = manejarErrores(async (request: Request) => {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const supabase = getSupabaseAdmin()
  const url = new URL(request.url)
  const desde = url.searchParams.get('desde')
  const hasta = url.searchParams.get('hasta')

  let query = supabase
    .from('eventos')
    .select(`
      id, usuario_id, titulo, descripcion, fecha, hora_inicio, hora_fin,
      categoria, recurrencia, estado, compartido, nota_cierre,
      created_at, updated_at,
      creador:usuarios_perfil!eventos_usuario_id_fkey (id, nombre, apellido)
    `)
    .order('fecha', { ascending: true })
    .order('hora_inicio', { ascending: true, nullsFirst: false })

  if (desde) query = query.gte('fecha', desde)
  if (hasta) query = query.lte('fecha', hasta)

  // Scope de cartera. Admin/TOTAL ve todo; usuario normal ve los propios +
  // los compartidos.
  if (!tieneAccesoTotal(usuario)) {
    query = query.or(`usuario_id.eq.${usuario.id},compartido.eq.true`)
  }

  const { data, error } = await query
  if (error) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: error.message,
      contexto: { tabla: 'eventos' },
    })
  }

  return respuestaExito({ eventos: data ?? [] })
}, { modulo: 'eventos' })

// ─────────────────────────────────────────────────────────────
// POST /api/eventos
//
// Crea un evento nuevo. El usuario logueado siempre es el dueño.
// ─────────────────────────────────────────────────────────────
export const POST = manejarErrores(async (request: Request) => {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  await requireLicenciaActiva()

  const supabase = getSupabaseAdmin()
  const body = await request.json()

  const {
    titulo,
    descripcion,
    fecha,
    hora_inicio,
    hora_fin,
    categoria,
    recurrencia,
    compartido,
  } = body

  // Validación
  if (!titulo || typeof titulo !== 'string' || titulo.trim() === '') {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
      campos: { titulo: 'El título es obligatorio' },
    })
  }
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
      campos: { fecha: 'La fecha es obligatoria (formato YYYY-MM-DD)' },
    })
  }
  const recurrenciasValidas = ['NINGUNA','DIARIA','SEMANAL','MENSUAL','ANUAL']
  const recFinal = recurrencia && recurrenciasValidas.includes(recurrencia) ? recurrencia : 'NINGUNA'

  // Si hora_fin < hora_inicio en el mismo día, no aceptar
  if (hora_inicio && hora_fin && hora_fin < hora_inicio) {
    return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
      detalle: 'La hora de fin no puede ser anterior a la hora de inicio.',
    })
  }

  const { data, error } = await supabase
    .from('eventos')
    .insert({
      usuario_id: usuario.id,
      titulo: titulo.trim().slice(0, 200),
      descripcion: descripcion?.trim() || null,
      fecha,
      hora_inicio: hora_inicio || null,
      hora_fin: hora_fin || null,
      categoria: categoria?.trim().slice(0, 60) || null,
      recurrencia: recFinal,
      estado: 'PROGRAMADO',
      compartido: Boolean(compartido),
    })
    .select()
    .single()

  if (error) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: error.message,
      contexto: { tabla: 'eventos' },
    })
  }

  return respuestaExito({ evento: data })
}, { modulo: 'eventos' })
