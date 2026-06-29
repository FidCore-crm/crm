/**
 * GET /api/configuracion/leads-web/intentos
 * Lista los últimos N intentos al endpoint público para diagnóstico.
 *
 * Query: ?limite=50 (max 200)
 * Solo admin.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import {
  manejarErrores,
  respuestaExito,
  respuestaError,
  ERRORES,
} from '@/lib/errores'

export const GET = manejarErrores(
  async (request: NextRequest) => {
    const auth = await requireAdmin(request)
    if (auth instanceof NextResponse) return auth

    const { searchParams } = new URL(request.url)
    const limite = Math.min(parseInt(searchParams.get('limite') || '50', 10) || 50, 200)

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('leads_web_intentos')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limite)

    if (error) {
      return respuestaError(ERRORES.DB_NO_DISPONIBLE, {
        detalle: error.message,
        contexto: { tabla: 'leads_web_intentos' },
      })
    }

    return respuestaExito({ intentos: data ?? [] })
  },
  { modulo: 'configuracion-leads-web' },
)
