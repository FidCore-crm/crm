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
 * POST /api/personas/[id]/desbloquear
 *
 * Quita el estado BLOQUEADO. El nuevo estado se calcula con la misma
 * lógica del trigger de sincronización — ACTIVO si tiene al menos
 * una póliza VIGENTE o PROGRAMADA, INACTIVO si no.
 */
export const POST = manejarErrores(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const usuario = await obtenerUsuarioDesdeRequest(_request)
    if (!usuario) return respuestaError(ERRORES.AUTH_TOKEN_INVALIDO)

    await requireLicenciaActiva()

    const { id } = await params
    const supabase = getSupabaseAdmin()

    const { data: actual } = await supabase
      .from('personas')
      .select('id, estado, usuario_id')
      .eq('id', id)
      .maybeSingle()

    if (!actual) return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO)

    if (!tieneAccesoTotal(usuario) && (actual as any).usuario_id !== usuario.id) {
      return respuestaError(ERRORES.PERM_RECURSO_AJENO)
    }

    const estadoAnterior = (actual as any).estado
    if (estadoAnterior !== 'BLOQUEADO') {
      return respuestaExito({ estado: estadoAnterior, no_estaba_bloqueado: true })
    }

    // La función SQL respeta BLOQUEADO — hay que sacarlo primero manualmente
    // para que el recálculo pueda decidir ACTIVO/INACTIVO.
    await supabase.from('personas').update({ estado: 'INACTIVO' }).eq('id', id)

    // Recalculamos con la lógica canónica del trigger.
    const { data: nuevoEstadoData } = await supabase.rpc('fn_recalcular_estado_persona', {
      p_persona_id: id,
    })
    const nuevoEstado = (nuevoEstadoData as string | null) ?? 'INACTIVO'

    await registrarEventoBitacoraPersona(supabase, {
      persona_id: id,
      tipo_evento: 'CAMBIO_ESTADO',
      estado_anterior: 'BLOQUEADO',
      estado_nuevo: nuevoEstado,
      motivo: 'Cliente desbloqueado desde la ficha',
      usuario_id: usuario.id,
    })

    return respuestaExito({ estado: nuevoEstado })
  },
  { modulo: 'personas' },
)
