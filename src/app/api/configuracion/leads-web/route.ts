/**
 * GET/PATCH config singleton de recepción de leads web (admin).
 *
 * GET    → { configuracion } (incluye token, stats, dominios)
 * PATCH  → actualiza activo, dominios, modo_asignacion, notificar_*
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireAdmin } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import {
  manejarErrores,
  respuestaExito,
  respuestaError,
  ERRORES,
} from '@/lib/errores'
import { normalizarDominio, type ModoAsignacionLeadsWeb } from '@/lib/leads-web'

const MODOS_VALIDOS: ModoAsignacionLeadsWeb[] = ['ROTATIVO', 'ADMIN', 'SIN_ASIGNAR']

export const GET = manejarErrores(
  async (request: NextRequest) => {
    const auth = await requireAuth(request)
    if (auth instanceof NextResponse) return auth

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('configuracion_leads_web')
      .select('*')
      .limit(1)
      .maybeSingle()

    if (error) {
      return respuestaError(ERRORES.DB_NO_DISPONIBLE, {
        detalle: error.message,
        contexto: { tabla: 'configuracion_leads_web' },
      })
    }

    return respuestaExito({ configuracion: data ?? null })
  },
  { modulo: 'configuracion-leads-web' },
)

export const PATCH = manejarErrores(
  async (request: NextRequest) => {
    const auth = await requireAdmin(request)
    if (auth instanceof NextResponse) return auth

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return respuestaError(ERRORES.VALID_FORMATO_INVALIDO, { detalle: 'Body inválido' })
    }

    const patch: Record<string, unknown> = {}

    if (typeof body.activo === 'boolean') patch.activo = body.activo
    if (typeof body.notificar_email_admin === 'boolean') patch.notificar_email_admin = body.notificar_email_admin
    if (typeof body.notificar_inapp === 'boolean') patch.notificar_inapp = body.notificar_inapp

    if (typeof body.modo_asignacion === 'string') {
      if (!MODOS_VALIDOS.includes(body.modo_asignacion as ModoAsignacionLeadsWeb)) {
        return respuestaError(ERRORES.VALID_FORMATO_INVALIDO, {
          campos: { modo_asignacion: 'Debe ser ROTATIVO, ADMIN o SIN_ASIGNAR' },
        })
      }
      patch.modo_asignacion = body.modo_asignacion
    }

    if (Array.isArray(body.dominios_permitidos)) {
      const dominios = (body.dominios_permitidos as unknown[])
        .filter((d): d is string => typeof d === 'string')
        .map((d) => normalizarDominio(d))
        .filter((d) => d.length > 0 && d.length < 253)
      // Dedupe
      patch.dominios_permitidos = Array.from(new Set(dominios))
    }

    if (Object.keys(patch).length === 0) {
      return respuestaError(ERRORES.VALID_CAMPO_REQUERIDO, {
        detalle: 'No se recibió ningún campo válido para actualizar',
      })
    }

    const supabase = getSupabaseAdmin()
    const { data: configActual } = await supabase
      .from('configuracion_leads_web')
      .select('id')
      .limit(1)
      .maybeSingle()

    if (!configActual) {
      return respuestaError(ERRORES.DB_REGISTRO_NO_ENCONTRADO, {
        detalle: 'No existe la fila singleton de configuracion_leads_web',
      })
    }

    const { error } = await supabase
      .from('configuracion_leads_web')
      .update(patch)
      .eq('id', (configActual as { id: string }).id)

    if (error) {
      return respuestaError(ERRORES.DB_ERROR_ESCRITURA, {
        detalle: error.message,
        contexto: { tabla: 'configuracion_leads_web' },
      })
    }

    return respuestaExito({ ok: true })
  },
  { modulo: 'configuracion-leads-web' },
)
