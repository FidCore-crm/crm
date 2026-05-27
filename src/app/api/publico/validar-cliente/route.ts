import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { logger } from '@/lib/errores'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeDNI(dni: string): string {
  return dni.replace(/[.\s-]/g, '')
}

const MSG_DATOS_NO_COINCIDEN = 'Los datos ingresados no coinciden con nuestro sistema. Verificá tu DNI, email y número de póliza, o contactá a tu productor.'

export async function POST(request: NextRequest) {
  try {
    // Rate limiting: 20 intentos por hora por IP (anti-fuerza bruta de DNIs)
    const ip = getClientIp(request)
    const rl = await checkRateLimit({ identifier: ip, endpoint: 'publico-validar', maxRequests: 20, windowSeconds: 3600, failMode: 'closed' })
    if (!rl.allowed) {
      const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000)
      return NextResponse.json(
        { ok: false, error: 'Demasiados intentos. Intentá nuevamente más tarde.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      )
    }

    const body = await request.json()
    const { dni, email, numero_poliza } = body

    if (!dni || !email || !numero_poliza) {
      return NextResponse.json(
        { ok: false, error: 'Faltan campos obligatorios: DNI, email y número de póliza.' },
        { status: 400 }
      )
    }

    if (!EMAIL_REGEX.test(email.trim())) {
      return NextResponse.json(
        { ok: false, error: 'El formato del email no es válido.' },
        { status: 400 }
      )
    }

    const dniNorm = normalizeDNI(dni)
    if (!/^\d{7,8}$/.test(dniNorm)) {
      return NextResponse.json(
        { ok: false, error: 'El DNI debe tener 7 u 8 dígitos.' },
        { status: 400 }
      )
    }

    const supabase = getSupabaseAdmin()

    // Buscar persona por DNI
    const { data: persona } = await supabase
      .from('personas')
      .select('id, apellido, nombre, dni_cuil, email, telefono')
      .eq('dni_cuil', dniNorm)
      .maybeSingle()

    if (!persona) {
      return NextResponse.json({ ok: false, error: MSG_DATOS_NO_COINCIDEN }, { status: 400 })
    }

    // Verificar email
    if (!persona.email || persona.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
      return NextResponse.json({ ok: false, error: MSG_DATOS_NO_COINCIDEN }, { status: 400 })
    }

    // Buscar póliza
    const { data: poliza } = await supabase
      .from('polizas')
      .select('id, numero_poliza, compania_id, ramo_id, estado, asegurado_id')
      .eq('numero_poliza', numero_poliza.trim())
      .eq('asegurado_id', persona.id)
      .maybeSingle()

    if (!poliza) {
      return NextResponse.json({ ok: false, error: MSG_DATOS_NO_COINCIDEN }, { status: 400 })
    }

    if (poliza.estado !== 'VIGENTE') {
      return NextResponse.json(
        { ok: false, error: 'La póliza ingresada no se encuentra vigente. Contactá a tu productor para regularizar la situación.' },
        { status: 400 }
      )
    }

    // Obtener nombres de compañía y ramo
    const ids = [poliza.compania_id, poliza.ramo_id].filter(Boolean)
    let companiaNombre = '—'
    let ramoNombre = '—'

    if (ids.length > 0) {
      const { data: catalogos } = await supabase
        .from('catalogos')
        .select('id, nombre')
        .in('id', ids)

      if (catalogos) {
        const comp = catalogos.find((c: any) => c.id === poliza.compania_id)
        const ramo = catalogos.find((c: any) => c.id === poliza.ramo_id)
        if (comp) companiaNombre = comp.nombre
        if (ramo) ramoNombre = ramo.nombre
      }
    }

    return NextResponse.json({
      ok: true,
      asegurado: {
        apellido: persona.apellido,
        nombre: persona.nombre || '',
        telefono: persona.telefono || '',
      },
      poliza: {
        numero_poliza: poliza.numero_poliza,
        compania: companiaNombre,
        ramo: ramoNombre,
      },
    })
  } catch (err: any) {
    logger.error({ modulo: 'publico', mensaje: 'Error al validar cliente', contexto: { error: err.message } })
    return NextResponse.json(
      { ok: false, error: 'Error interno. Intentá nuevamente.' },
      { status: 500 }
    )
  }
}
