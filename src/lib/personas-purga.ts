/**
 * Purga definitiva de una persona del sistema.
 *
 * Borra físicamente la persona y toda su cascada (pólizas, riesgos, siniestros,
 * tareas, archivos en disco, notificaciones). Es el paso final del soft-delete:
 * primero `DELETE /api/personas/[id]` marca `deleted_at`, y después de 30 días
 * el cron `/api/cron/personas-purgar` invoca esta función.
 *
 * No verifica permisos ni valida estado — asume que el caller (cron o flujo
 * administrativo) ya hizo esas validaciones.
 */

import { rm } from 'fs/promises'
import path from 'path'
import { ERRORES, ErrorAplicacion, logger } from '@/lib/errores'

const STORAGE_ROOT = path.join(process.cwd(), 'storage')

function safePath(base: string, ...segments: string[]): string {
  const full = path.join(base, ...segments)
  if (!full.startsWith(base)) throw new Error('Path traversal detected')
  return full
}

async function obtenerCadenaAbajo(supabase: any, polizaId: string): Promise<{ id: string; numero_poliza: string }[]> {
  const resultado: { id: string; numero_poliza: string }[] = []
  const cola = [polizaId]

  while (cola.length > 0) {
    const currentId = cola.shift()!
    const { data: hijas } = await supabase
      .from('polizas')
      .select('id, numero_poliza')
      .eq('poliza_origen_id', currentId)
    for (const h of (hijas ?? []) as any[]) {
      resultado.push({ id: h.id, numero_poliza: h.numero_poliza })
      cola.push(h.id)
    }
  }

  return resultado
}

export async function purgarPersonaDefinitivamente(
  personaId: string,
  supabase: any,
): Promise<{ polizas: number; siniestros: number; carpetas_eliminadas: number }> {
  const { data: polizasDirectas } = await supabase.from('polizas').select('id, numero_poliza').eq('asegurado_id', personaId)
  const allPolizas: { id: string; numero_poliza: string }[] = [...((polizasDirectas ?? []) as any[])]
  for (const p of (polizasDirectas ?? []) as any[]) {
    const hijas = await obtenerCadenaAbajo(supabase, p.id)
    allPolizas.push(...hijas)
  }
  const polizaMap = new Map<string, string>()
  for (const p of allPolizas) polizaMap.set(p.id, p.numero_poliza)
  const allPolizaIds = Array.from(polizaMap.keys())

  const { data: sinDirectos } = await supabase.from('siniestros').select('id, numero_caso').eq('persona_id', personaId)
  let sinPolizas: any[] = []
  if (allPolizaIds.length > 0) {
    const { data } = await supabase.from('siniestros').select('id, numero_caso').in('poliza_id', allPolizaIds)
    sinPolizas = data ?? []
  }
  const sinMap = new Map<string, string>()
  for (const s of [...(sinDirectos ?? []), ...sinPolizas] as any[]) {
    sinMap.set(s.id, s.numero_caso)
  }

  const { data: tareasData } = await supabase.from('tareas').select('id').eq('persona_id', personaId)
  const tareaIds = (tareasData ?? []).map((t: any) => t.id)
  let opIds: string[] = []
  try {
    const { data: opsData } = await supabase.from('oportunidades').select('id').eq('persona_id', personaId)
    opIds = (opsData ?? []).map((o: any) => o.id)
  } catch (err) {
    logger.warn({ modulo: 'personas-purga', mensaje: 'Error cargando oportunidades', contexto: { persona_id: personaId, error: String(err) } })
  }

  let carpetas = 0
  for (const [, numSin] of Array.from(sinMap.entries())) {
    if (!numSin) continue
    try {
      await rm(safePath(STORAGE_ROOT, 'siniestros', numSin), { recursive: true, force: true })
      carpetas++
    } catch (err) {
      logger.warn({ modulo: 'personas-purga', mensaje: 'Error eliminando carpeta de siniestro', contexto: { numero_caso: numSin, error: String(err) } })
    }
  }

  for (const [, numPol] of Array.from(polizaMap.entries())) {
    if (!numPol) continue
    try {
      await rm(safePath(STORAGE_ROOT, 'polizas', numPol), { recursive: true, force: true })
      carpetas++
    } catch (err) {
      logger.warn({ modulo: 'personas-purga', mensaje: 'Error eliminando carpeta de póliza', contexto: { numero_poliza: numPol, error: String(err) } })
    }
  }

  const allEntidadIds = [...allPolizaIds, ...Array.from(sinMap.keys()), ...tareaIds, ...opIds]
  if (allEntidadIds.length > 0) {
    await supabase.from('notificaciones').delete().in('entidad_id', allEntidadIds)
  }

  const { error: delError } = await supabase.from('personas').delete().eq('id', personaId)
  if (delError) {
    throw new ErrorAplicacion(ERRORES.DB_ERROR_ESCRITURA, {
      detalle: delError.message,
      contexto: { tabla: 'personas', operacion: 'delete', id: personaId },
    })
  }

  return {
    polizas: polizaMap.size,
    siniestros: sinMap.size,
    carpetas_eliminadas: carpetas,
  }
}
