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
  // ────────────────────────────────────────────────────────────
  const { data: programadasListas } = await supabase
    .from('polizas')
    .select('id')
    .eq('estado', 'PROGRAMADA')
    .lte('fecha_inicio', hoy)
    .neq('origen_creacion', 'IMPORTACION')
  for (const p of (programadasListas ?? []) as Array<{ id: string }>) {
    try {
      const t = await activarProgramadaSiCorresponde(supabase, p.id, null)
      if (t.cambios.length > 0) {
        cantActivadas++
        await encolarEmailAutomaticoPoliza(supabase, p.id, 'AUTOMATICO_BIENVENIDA')
      }
    } catch (err) {
      cantFallos++
      logger.warn({ modulo: 'cron-polizas', mensaje: 'Error activando programada', contexto: { poliza_id: p.id, error: String(err) } })
    }
  }

  // ────────────────────────────────────────────────────────────
  // 2) RENOVADA → VIGENTE (con baja de la origen y movimiento de archivos)
  // ────────────────────────────────────────────────────────────
  const { data: renovadasListas } = await supabase
    .from('polizas')
    .select('id')
    .eq('estado', 'RENOVADA')
    .lte('fecha_inicio', hoy)
    .not('poliza_origen_id', 'is', null)
  for (const ren of (renovadasListas ?? []) as Array<{ id: string }>) {
    try {
      const t = await activarRenovadaSiCorresponde(supabase, ren.id, null)
      if (t.cambios.length > 0) {
        cantRenovadasActivadas++
        await encolarEmailAutomaticoPoliza(supabase, ren.id, 'AUTOMATICO_RENOVACION')
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
        .select('id')
        .eq('estado', 'VIGENTE')
        .is('poliza_origen_id', null)
        .gte('created_at', hace7Dias)
        .neq('origen_creacion', 'IMPORTACION')
        .order('created_at', { ascending: true })
        .range(offset, offset + TAMANO_LOTE - 1)

      const filas = (vigentesRecientes ?? []) as Array<{ id: string }>
      if (filas.length === 0) break

      for (const p of filas) {
        try {
          await encolarEmailAutomaticoPoliza(supabase, p.id, 'AUTOMATICO_BIENVENIDA')
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
