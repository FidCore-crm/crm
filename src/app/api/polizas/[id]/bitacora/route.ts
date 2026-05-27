import { NextResponse } from 'next/server'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { ERRORES, respuestaError, respuestaExito, manejarErrores, ErrorAplicacion } from '@/lib/errores'

export const GET = manejarErrores(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const { id } = await params
  const supabase = getSupabaseAdmin()

  const { data: poliza } = await supabase
    .from('polizas')
    .select('id, asegurado:personas!asegurado_id (usuario_id)')
    .eq('id', id)
    .maybeSingle()
  if (!poliza) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

  const owns = requireOwnership(usuario, {
    usuario_id: (poliza as any).asegurado?.usuario_id ?? null,
  })
  if (owns) return owns

  const { data: eventos, error } = await supabase
    .from('poliza_bitacora')
    .select(`
      id, tipo_evento, estado_anterior, estado_nuevo, motivo, observaciones, created_at,
      usuario:usuarios_perfil!usuario_id (id, nombre, apellido)
    `)
    .eq('poliza_id', id)
    .order('created_at', { ascending: false })

  if (error) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: error.message,
      contexto: { tabla: 'poliza_bitacora', operacion: 'select' },
    })
  }

  return respuestaExito({ eventos: eventos || [] })
}, { modulo: 'polizas' })
