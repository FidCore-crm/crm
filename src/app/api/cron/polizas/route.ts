import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { validarCronSecret } from '@/lib/cron-auth'
import { logger } from '@/lib/errores'
import { hoyAR } from '@/lib/utils'
import {
  activarProgramadaSiCorresponde,
  activarRenovadaSiCorresponde,
  vencerPolizaSiCorresponde,
} from '@/lib/polizas-transiciones'
import { encolarEmailAutomaticoPoliza } from '@/lib/polizas-emails'
import { encolarBienvenidaCliente } from '@/lib/personas-emails'

export async function GET(request: Request) {
  const authError = await validarCronSecret(request)
  if (authError) return authError

  const supabase = getSupabaseAdmin()
  const hoy = hoyAR() // forzar zona AR para no transicionar pólizas un día antes
  const erroresGlobales: string[] = []
  let cantActivadas = 0
  let cantRenovadasActivadas = 0
  let cantVencidas = 0
  let cantFallos = 0

  // ────────────────────────────────────────────────────────────
  // 1) PROGRAMADA → VIGENTE
  //
  // Activamos TODAS las que cumplan la fecha, incluso las importadas
  // (típico: un PAS migra una cartera donde algunas pólizas arrancan
  // dentro de unos días). Lo que NO hacemos es disparar bienvenida si
  // la póliza vino de una importación — esas pólizas el cliente ya las
  // tiene desde antes con su productor anterior.
  // ────────────────────────────────────────────────────────────
  const { data: programadasListas } = await supabase
    .from('polizas')
    .select('id, origen_creacion, asegurado_id')
    .eq('estado', 'PROGRAMADA')
    .lte('fecha_inicio', hoy)
  for (const p of (programadasListas ?? []) as Array<{ id: string; origen_creacion: string | null; asegurado_id: string }>) {
    try {
      const t = await activarProgramadaSiCorresponde(supabase, p.id, null)
      if (t.cambios.length > 0) {
        cantActivadas++
        if (p.origen_creacion !== 'IMPORTACION') {
          await encolarEmailAutomaticoPoliza(supabase, p.id, 'AUTOMATICO_BIENVENIDA')
          await encolarBienvenidaCliente(supabase, p.asegurado_id)
        }
      }
    } catch (err) {
      cantFallos++
      logger.warn({ modulo: 'cron-polizas', mensaje: 'Error activando programada', contexto: { poliza_id: p.id, error: String(err) } })
    }
  }

  // ────────────────────────────────────────────────────────────
  // 2) RENOVADA → VIGENTE (con baja de la origen y movimiento de archivos)
  //
  // Las renovaciones se crean desde dentro del CRM (no por el importador),
  // pero por defensa también filtramos IMPORTACION acá: si en algún caso
  // futuro se importa una RENOVADA, se activa pero no manda email.
  // ────────────────────────────────────────────────────────────
  const { data: renovadasListas } = await supabase
    .from('polizas')
    .select('id, origen_creacion, asegurado_id')
    .eq('estado', 'RENOVADA')
    .lte('fecha_inicio', hoy)
    .not('poliza_origen_id', 'is', null)
  for (const ren of (renovadasListas ?? []) as Array<{ id: string; origen_creacion: string | null; asegurado_id: string }>) {
    try {
      const t = await activarRenovadaSiCorresponde(supabase, ren.id, null)
      if (t.cambios.length > 0) {
        cantRenovadasActivadas++
        if (ren.origen_creacion !== 'IMPORTACION') {
          await encolarEmailAutomaticoPoliza(supabase, ren.id, 'AUTOMATICO_RENOVACION')
          await encolarBienvenidaCliente(supabase, ren.asegurado_id)
        }
      }
      if (t.errores) {
        erroresGlobales.push(...t.errores)
        cantFallos += t.errores.length
      }
    } catch (err) {
      cantFallos++
      logger.warn({ modulo: 'cron-polizas', mensaje: 'Error activando renovación', contexto: { poliza_id: ren.id, error: String(err) } })
    }
  }

  // ────────────────────────────────────────────────────────────
  // 3) VIGENTE vencidas sin renovación activa → NO_VIGENTE
  // ────────────────────────────────────────────────────────────
  const { data: vigentesVencidas } = await supabase
    .from('polizas')
    .select('id')
    .eq('estado', 'VIGENTE')
    .lt('fecha_fin', hoy)
  for (const pol of (vigentesVencidas ?? []) as Array<{ id: string }>) {
    try {
      const t = await vencerPolizaSiCorresponde(supabase, pol.id, null)
      if (t.cambios.length > 0) cantVencidas++
    } catch (err) {
      cantFallos++
      logger.warn({ modulo: 'cron-polizas', mensaje: 'Error venciendo póliza', contexto: { poliza_id: pol.id, error: String(err) } })
    }
  }

  // ────────────────────────────────────────────────────────────
  // 4) Bienvenida para pólizas que NACIERON vigentes (no pasaron por PROGRAMADA).
  // El anti-spam de encolarEmail evita duplicados. Procesamos en lotes para no
  // saturar memoria/red en cargas grandes (importadores recientes, etc.).
  // ────────────────────────────────────────────────────────────
  const TAMANO_LOTE = 100
  const MAX_LOTES = 50 // tope de seguridad: hasta 5000 pólizas por corrida
  let cantBienvenidas = 0
  try {
    const hace7Dias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    let offset = 0
    for (let lote = 0; lote < MAX_LOTES; lote++) {
      const { data: vigentesRecientes } = await supabase
        .from('polizas')
        .select('id, asegurado_id')
        .eq('estado', 'VIGENTE')
        .is('poliza_origen_id', null)
        .gte('created_at', hace7Dias)
        .neq('origen_creacion', 'IMPORTACION')
        .order('created_at', { ascending: true })
        .range(offset, offset + TAMANO_LOTE - 1)

      const filas = (vigentesRecientes ?? []) as Array<{ id: string; asegurado_id: string }>
      if (filas.length === 0) break

      for (const p of filas) {
        try {
          await encolarEmailAutomaticoPoliza(supabase, p.id, 'AUTOMATICO_BIENVENIDA')
          await encolarBienvenidaCliente(supabase, p.asegurado_id)
          cantBienvenidas++
        } catch (err) {
          cantFallos++
          logger.warn({ modulo: 'cron-polizas', mensaje: 'Error encolando bienvenida para póliza nacida vigente', contexto: { poliza_id: p.id, error: String(err) } })
        }
      }

      if (filas.length < TAMANO_LOTE) break // no hay más
      offset += TAMANO_LOTE
    }
  } catch (err) {
    cantFallos++
    logger.warn({ modulo: 'cron-polizas', mensaje: 'Error en bloque de bienvenida nacidas vigentes', contexto: { error: String(err) } })
  }

  return NextResponse.json({
    ok: erroresGlobales.length === 0 && cantFallos === 0,
    fecha: hoy,
    activadas: cantActivadas,
    renovadas_activadas: cantRenovadasActivadas,
    vencidas: cantVencidas,
    bienvenidas_encoladas: cantBienvenidas,
    fallos: cantFallos,
    errores: erroresGlobales,
  })
}
