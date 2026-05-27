import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { validarTokenAcceso } from '@/lib/portal-cliente-tokens'
import { logger } from '@/lib/errores'
import { normalizarTipoRiesgo } from '@/lib/siniestros-tipos'

/**
 * Resumen humano del riesgo para mostrar en la card de selección de póliza.
 * Devuelve algo como "AB123CD · Toyota Corolla · 2018" o "Av. Corrientes 1234, CABA".
 */
function resumenRiesgo(tipo: string, detalle: Record<string, any> | null): string {
  if (!detalle) return ''
  const t = normalizarTipoRiesgo(tipo)
  if (t === 'automotor' || t === 'moto') {
    const partes: string[] = []
    if (detalle.patente) partes.push(String(detalle.patente).toUpperCase())
    const auto = [detalle.marca, detalle.modelo].filter(Boolean).join(' ')
    if (auto) partes.push(auto)
    if (detalle.anio) partes.push(String(detalle.anio))
    return partes.join(' · ')
  }
  if (t === 'hogar') {
    const dir = [detalle.calle, detalle.numero, detalle.localidad].filter(Boolean).join(' ')
    return dir
  }
  if (t === 'vida') {
    return detalle.beneficiarios || ''
  }
  return detalle.descripcion || ''
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const ip = getClientIp(request)
    const rl = await checkRateLimit({
      identifier: ip,
      endpoint: 'publico-portal-cliente-precompletar',
      maxRequests: 30,
      windowSeconds: 60,
      failMode: 'closed',
    })
    if (!rl.allowed) {
      const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000)
      return NextResponse.json(
        { ok: false, error: 'Demasiadas solicitudes' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      )
    }

    const { token } = await params
    const supabase = getSupabaseAdmin()

    // Verificar sistema activo
    const { data: config } = await supabase
      .from('configuracion_portal_cliente')
      .select('activo')
      .limit(1)
      .maybeSingle()
    if (!(config as any)?.activo) {
      return NextResponse.json({ ok: false, error: 'Portal no disponible' }, { status: 503 })
    }

    const validacion = await validarTokenAcceso(token, ip)
    if (!validacion.valido || !validacion.persona_id) {
      return NextResponse.json({ ok: false, error: 'Acceso no válido' }, { status: 403 })
    }

    // Solo seleccionamos los campos que el formulario de denuncia realmente
    // necesita para minimizar la PII expuesta por este endpoint público.
    // Direccion completa / provincia / barrio NO se usan en el form, así que
    // no las traemos. dni/email/telefono SÍ son necesarios (el form los manda
    // a /validar-cliente para verificar identidad antes de aceptar la denuncia).
    const { data: persona } = await supabase
      .from('personas')
      .select('id, nombre, apellido, razon_social, tipo_persona, dni_cuil, email, telefono, whatsapp, localidad')
      .eq('id', validacion.persona_id)
      .maybeSingle()

    if (!persona) {
      return NextResponse.json({ ok: false, error: 'Cliente no encontrado' }, { status: 404 })
    }

    const { data: polizas } = await supabase
      .from('polizas')
      .select(`
        id, numero_poliza, compania_id, ramo_id,
        ramo:catalogos!ramo_id (id, nombre, metadata),
        riesgos (id, tipo_riesgo, detalle_tecnico, descripcion_corta)
      `)
      .eq('asegurado_id', validacion.persona_id)
      .eq('estado', 'VIGENTE')
      .order('fecha_fin', { ascending: true })

    const polizasArr = (polizas ?? []) as any[]
    const companiaIds = Array.from(new Set(polizasArr.map(p => p.compania_id).filter(Boolean))) as string[]

    const catCompania = companiaIds.length
      ? await supabase.from('catalogos').select('id, nombre').in('id', companiaIds)
      : { data: [] as any[] }

    const mapCompania = new Map<string, string>()
    for (const c of ((catCompania as any).data ?? []) as any[]) mapCompania.set(c.id, c.nombre)

    const p = persona as any

    return NextResponse.json({
      ok: true,
      dni: p.dni_cuil || '',
      email: p.email || '',
      nombre: p.nombre || '',
      apellido: p.apellido || '',
      razon_social: p.razon_social || '',
      telefono: p.telefono || p.whatsapp || '',
      tipo_persona: p.tipo_persona,
      localidad: p.localidad || '',
      polizas: polizasArr.map((x: any) => {
        const ramoMeta = x.ramo?.metadata ?? {}
        const tipoRiesgoRaw = ramoMeta.tipo_riesgo ?? x.riesgos?.[0]?.tipo_riesgo ?? ''
        const tipoRiesgo = normalizarTipoRiesgo(tipoRiesgoRaw)
        const riesgoPrincipal = x.riesgos?.[0]
        return {
          id: x.id,
          numero_poliza: x.numero_poliza,
          compania_id: x.compania_id,
          compania: x.compania_id ? mapCompania.get(x.compania_id) || '' : '',
          ramo_id: x.ramo_id,
          ramo: x.ramo?.nombre ?? '',
          tipo_riesgo: tipoRiesgo,
          riesgo_resumen: riesgoPrincipal
            ? resumenRiesgo(tipoRiesgoRaw, riesgoPrincipal.detalle_tecnico)
            : '',
          riesgo_id: riesgoPrincipal?.id ?? null,
          campos_dinamicos: Array.isArray(ramoMeta.campos_siniestro) ? ramoMeta.campos_siniestro : [],
        }
      }),
    })
  } catch (err: any) {
    logger.error({ modulo: 'portal-cliente', mensaje: 'Error al pre-completar datos del portal', contexto: { error: err?.message } })
    return NextResponse.json({ ok: false, error: 'Error interno' }, { status: 500 })
  }
}
