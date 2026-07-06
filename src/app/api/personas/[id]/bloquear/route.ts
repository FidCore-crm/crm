import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import {
  ERRORES,
  manejarErrores,
  respuestaError,
  respuestaExito,
} from '@/lib/errores'
import { tieneAccesoTotal } from '@/lib/cartera-filter'
import { registrarEventoBitacoraPersona } from '@/lib/bitacora-persona'
import { requireLicenciaActiva } from '@/lib/licencia-guard'

/**
 * POST /api/personas/[id]/bloquear
 *
 * Marca al cliente como BLOQUEADO. Estado manual — el trigger de
 * sincronización con pólizas respeta BLOQUEADO y no lo pisa.
 * Opcional en el body: `{ motivo?: string }` para dejar registro.
 */
export const POST = manejarErrores(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const usuario = await obtenerUsuarioDesdeRequest(request)
    if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)

    await requireLicenciaActiva()

    const { id } = await params
    const supabase = getSupabaseAdmin()

    const { data: actual } = await supabase
      .from('personas')
      .select('id, estado, usuario_id, apellido, nombre')
      .eq('id', id)
      .maybeSingle()

    if (!actual) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

    if (!tieneAccesoTotal(usuario) && (actual as any).usuario_id !== usuario.id) {
      return respuestaError(ERRORES.PERM_RECURSO_AJENO)
    }

    if ((actual as any).estado === 'BLOQUEADO') {
      return respuestaExito({ estado: 'BLOQUEADO', ya_bloqueado: true })
    }

    const body = await request.json().catch(() => ({}))
    const motivo: string | null = typeof body?.motivo === 'string' ? body.motivo.trim() : null

    const estadoAnterior = (actual as any).estado
    await supabase.from('personas').update({ estado: 'BLOQUEADO' }).eq('id', id)

    await registrarEventoBitacoraPersona(supabase, {
      persona_id: id,
      tipo_evento: 'CAMBIO_ESTADO',
      estado_anterior: estadoAnterior,
      estado_nuevo: 'BLOQUEADO',
      motivo: motivo || 'Cliente bloqueado desde la ficha',
      usuario_id: usuario.id,
    })

    return respuestaExito({ estado: 'BLOQUEADO' })
  },
  { modulo: 'personas' },
)
