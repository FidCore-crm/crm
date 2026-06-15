/**
 * Sistema de licencias Ed25519 — librería central.
 *
 * Cada licencia .lic es un JSON firmado con la llave privada de Nahuel.
 * El CRM verifica la firma con la llave pública embebida.
 *
 * Conceptos:
 *   - ACTIVA: la licencia que rige ahora. Solo una a la vez.
 *   - ENCOLADA: cargada por anticipado (su fecha_inicio es futura).
 *   - GRACIA: la activa venció hace <= 7 días. El sistema sigue funcionando.
 *   - BLOQUEADA: vencida hace > 7 días. Modo solo lectura.
 *   - SIN_LICENCIA: no hay ninguna licencia cargada. Modo solo lectura.
 */

import { verify } from 'crypto'
import { logger } from '@/lib/errores'
import { obtenerInstalacionId } from '@/lib/instalacion-id'
import {
  obtenerLicenciaPublicKey,
  esLicenciaPublicKeyPlaceholder,
} from '@/lib/licencia-public-key'

export const DIAS_GRACIA_POST_VENCIMIENTO = 7

export type PlanLicencia = 'MENSUAL' | 'SEMESTRAL' | 'ANUAL' | 'PERMANENTE'

export type EstadoLicenciaDB = 'ACTIVA' | 'ENCOLADA' | 'EXPIRADA' | 'REEMPLAZADA'

export type ModoSistema = 'ACTIVA' | 'GRACIA' | 'BLOQUEADA' | 'SIN_LICENCIA'

export interface PayloadLicencia {
  version: number
  cliente: string
  razon_social: string | null
  instalacion_id: string
  plan: PlanLicencia
  fecha_inicio: string // YYYY-MM-DD
  fecha_vencimiento: string // YYYY-MM-DD
  fecha_emision: string
  notas: string | null
}

export interface ArchivoLicencia extends PayloadLicencia {
  firma: string // base64
}

export interface ResultadoVerificacion {
  ok: boolean
  motivo?: string
  payload?: PayloadLicencia
}

export interface EstadoLicencia {
  modo: ModoSistema
  modo_solo_lectura: boolean
  licencia_activa: {
    id: string
    plan: PlanLicencia
    cliente: string
    fecha_inicio: string
    fecha_vencimiento: string
    fecha_emision: string
    dias_restantes: number // negativo si vencida
    es_permanente: boolean
  } | null
  licencias_encoladas: Array<{
    id: string
    plan: PlanLicencia
    fecha_inicio: string
    fecha_vencimiento: string
    fecha_emision: string
    dias_hasta_inicio: number
  }>
  dias_gracia_restantes: number | null
}

/**
 * Serialización determinística — debe ser idéntica a la del script emitir-licencia.js.
 * Orden alfabético de claves, sin la firma.
 */
function serializarParaFirma(payload: PayloadLicencia): string {
  const claves = (Object.keys(payload) as Array<keyof PayloadLicencia>).sort()
  const obj: Record<string, unknown> = {}
  for (const k of claves) obj[k] = payload[k]
  return JSON.stringify(obj)
}

/**
 * Verifica la firma Ed25519 de una licencia y validez de estructura/instalación.
 * NO chequea fechas todavía — solo autenticidad y que pertenezca a este server.
 */
export function verificarLicencia(archivo: unknown): ResultadoVerificacion {
  if (!archivo || typeof archivo !== 'object') {
    return { ok: false, motivo: 'Archivo de licencia inválido (no es un objeto)' }
  }

  const lic = archivo as Partial<ArchivoLicencia>

  // Estructura mínima
  const camposRequeridos: Array<keyof ArchivoLicencia> = [
    'version', 'cliente', 'instalacion_id', 'plan',
    'fecha_inicio', 'fecha_vencimiento', 'fecha_emision', 'firma',
  ]
  for (const campo of camposRequeridos) {
    if (lic[campo] === undefined || lic[campo] === null || lic[campo] === '') {
      return { ok: false, motivo: `Falta el campo "${campo}" en la licencia` }
    }
  }

  if (lic.version !== 1) {
    return { ok: false, motivo: `Versión de licencia no soportada: ${lic.version}` }
  }

  const planesValidos: PlanLicencia[] = ['MENSUAL', 'SEMESTRAL', 'ANUAL', 'PERMANENTE']
  if (!planesValidos.includes(lic.plan as PlanLicencia)) {
    return { ok: false, motivo: `Plan inválido: ${lic.plan}` }
  }

  // Las licencias PERMANENTE tienen fecha_vencimiento sentinel '2099-12-31'.
  // Si firmaron con otra fecha es una emisión incorrecta o adulterada.
  if (lic.plan === 'PERMANENTE' && lic.fecha_vencimiento !== '2099-12-31') {
    return {
      ok: false,
      motivo: 'Licencia PERMANENTE con fecha de vencimiento inconsistente (debería ser 2099-12-31).',
    }
  }

  // Instalación correcta
  const instalacionEsperada = obtenerInstalacionId()
  if (lic.instalacion_id !== instalacionEsperada) {
    return {
      ok: false,
      motivo: `Esta licencia fue emitida para otra instalación. ID esperado: ${instalacionEsperada}`,
    }
  }

  // Verificar firma
  if (esLicenciaPublicKeyPlaceholder()) {
    return {
      ok: false,
      motivo: 'La llave pública de licencias no fue configurada en este CRM. Contactá a FidCore.',
    }
  }

  const payload: PayloadLicencia = {
    version: lic.version!,
    cliente: lic.cliente!,
    razon_social: lic.razon_social ?? null,
    instalacion_id: lic.instalacion_id!,
    plan: lic.plan!,
    fecha_inicio: lic.fecha_inicio!,
    fecha_vencimiento: lic.fecha_vencimiento!,
    fecha_emision: lic.fecha_emision!,
    notas: lic.notas ?? null,
  }

  try {
    const datos = Buffer.from(serializarParaFirma(payload), 'utf-8')
    const firma = Buffer.from(lic.firma!, 'base64')
    const publicKeyPem = obtenerLicenciaPublicKey()
    const valido = verify(null, datos, publicKeyPem, firma)
    if (!valido) {
      return { ok: false, motivo: 'La firma no coincide. La licencia fue adulterada o no es auténtica.' }
    }
  } catch (err) {
    logger.warn({
      modulo: 'licencia',
      mensaje: 'Error verificando firma de licencia',
      contexto: { error: String(err) },
    })
    return { ok: false, motivo: 'No se pudo verificar la firma (formato inválido)' }
  }

  return { ok: true, payload }
}

function diferenciaDiasUTC(desde: string, hasta: string): number {
  const a = new Date(desde + 'T00:00:00Z').getTime()
  const b = new Date(hasta + 'T00:00:00Z').getTime()
  return Math.floor((b - a) / (24 * 60 * 60 * 1000))
}

function hoyIsoUTC(): string {
  return new Date().toISOString().slice(0, 10)
}

interface LicenciaDB {
  id: string
  cliente: string
  plan: PlanLicencia
  fecha_inicio: string
  fecha_vencimiento: string
  fecha_emision: string
  estado: EstadoLicenciaDB
}

/**
 * Evalúa el estado del sistema dado el set de licencias actuales en DB.
 */
export function evaluarEstado(
  licenciaActiva: LicenciaDB | null,
  encoladas: LicenciaDB[],
): EstadoLicencia {
  const hoy = hoyIsoUTC()

  if (!licenciaActiva) {
    return {
      modo: 'SIN_LICENCIA',
      modo_solo_lectura: true,
      licencia_activa: null,
      licencias_encoladas: encoladas.map((l) => ({
        id: l.id,
        plan: l.plan,
        fecha_inicio: l.fecha_inicio,
        fecha_vencimiento: l.fecha_vencimiento,
        fecha_emision: l.fecha_emision,
        dias_hasta_inicio: diferenciaDiasUTC(hoy, l.fecha_inicio),
      })),
      dias_gracia_restantes: null,
    }
  }

  const diasRestantes = diferenciaDiasUTC(hoy, licenciaActiva.fecha_vencimiento)
  const esPermanente = licenciaActiva.plan === 'PERMANENTE'

  let modo: ModoSistema
  let diasGracia: number | null = null

  if (diasRestantes >= 0) {
    modo = 'ACTIVA'
  } else if (-diasRestantes <= DIAS_GRACIA_POST_VENCIMIENTO) {
    modo = 'GRACIA'
    diasGracia = DIAS_GRACIA_POST_VENCIMIENTO - (-diasRestantes)
  } else {
    modo = 'BLOQUEADA'
    diasGracia = 0
  }

  return {
    modo,
    modo_solo_lectura: (modo as ModoSistema) === 'BLOQUEADA',
    licencia_activa: {
      id: licenciaActiva.id,
      plan: licenciaActiva.plan,
      cliente: licenciaActiva.cliente,
      fecha_inicio: licenciaActiva.fecha_inicio,
      fecha_vencimiento: licenciaActiva.fecha_vencimiento,
      fecha_emision: licenciaActiva.fecha_emision,
      dias_restantes: diasRestantes,
      es_permanente: esPermanente,
    },
    licencias_encoladas: encoladas.map((l) => ({
      id: l.id,
      plan: l.plan,
      fecha_inicio: l.fecha_inicio,
      fecha_vencimiento: l.fecha_vencimiento,
      fecha_emision: l.fecha_emision,
      dias_hasta_inicio: diferenciaDiasUTC(hoy, l.fecha_inicio),
    })),
    dias_gracia_restantes: diasGracia,
  }
}

/**
 * Lee del DB el estado actual de licencias y devuelve el resumen evaluado.
 * Cachea internamente por 60s para no saturar la DB en cada request.
 */
let cacheEstado: { ts: number; estado: EstadoLicencia } | null = null
const TTL_CACHE_MS = 60_000

export async function obtenerEstadoLicencia(opciones?: {
  forzar?: boolean
}): Promise<EstadoLicencia> {
  const ahora = Date.now()
  if (!opciones?.forzar && cacheEstado && ahora - cacheEstado.ts < TTL_CACHE_MS) {
    return cacheEstado.estado
  }

  const { getSupabaseAdmin } = await import('@/lib/supabase/server')
  const supabase = getSupabaseAdmin()

  const { data: activas } = await supabase
    .from('licencias')
    .select('id, cliente, plan, fecha_inicio, fecha_vencimiento, fecha_emision, estado')
    .eq('estado', 'ACTIVA')
    .limit(1)

  const { data: encoladas } = await supabase
    .from('licencias')
    .select('id, cliente, plan, fecha_inicio, fecha_vencimiento, fecha_emision, estado')
    .eq('estado', 'ENCOLADA')
    .order('fecha_inicio', { ascending: true })

  const estado = evaluarEstado(
    (activas?.[0] as LicenciaDB | undefined) ?? null,
    (encoladas as LicenciaDB[] | null) ?? [],
  )

  cacheEstado = { ts: ahora, estado }
  return estado
}

/**
 * Invalida el cache. Llamar después de cargar/cambiar licencias.
 */
export function invalidarCacheEstado(): void {
  cacheEstado = null
}

/**
 * Rota licencias: si la ACTIVA venció, busca una ENCOLADA que cubra hoy y la promueve.
 * Devuelve cantidad de cambios aplicados. Idempotente — se puede correr en loop.
 */
export async function rotarLicencias(): Promise<{ promovidas: number; expiradas: number }> {
  const { getSupabaseAdmin } = await import('@/lib/supabase/server')
  const supabase = getSupabaseAdmin()
  const hoy = hoyIsoUTC()

  let promovidas = 0
  let expiradas = 0

  // 1) Si hay activa vencida, marcarla EXPIRADA
  const { data: activa } = await supabase
    .from('licencias')
    .select('id, fecha_vencimiento, plan')
    .eq('estado', 'ACTIVA')
    .limit(1)

  const activaActual = activa?.[0] as
    | { id: string; fecha_vencimiento: string; plan: PlanLicencia }
    | undefined

  // Solo expirar si NO es permanente y la fecha ya pasó
  if (activaActual && activaActual.plan !== 'PERMANENTE' && activaActual.fecha_vencimiento < hoy) {
    await supabase.from('licencias').update({ estado: 'EXPIRADA' }).eq('id', activaActual.id)
    expiradas++
    invalidarCacheEstado()
  }

  // 2) Si NO hay activa, buscar la encolada más antigua que cubra hoy y promoverla
  const { data: activaPostExpire } = await supabase
    .from('licencias')
    .select('id')
    .eq('estado', 'ACTIVA')
    .limit(1)

  if (!activaPostExpire || activaPostExpire.length === 0) {
    const { data: candidatas } = await supabase
      .from('licencias')
      .select('id, fecha_inicio, fecha_vencimiento, plan')
      .eq('estado', 'ENCOLADA')
      .lte('fecha_inicio', hoy)
      .order('fecha_inicio', { ascending: true })
      .limit(1)

    const candidata = candidatas?.[0] as
      | { id: string; fecha_inicio: string; fecha_vencimiento: string; plan: PlanLicencia }
      | undefined

    if (candidata) {
      // Que también su fecha_vencimiento sea >= hoy (sino estaría ya vencida)
      if (candidata.plan === 'PERMANENTE' || candidata.fecha_vencimiento >= hoy) {
        await supabase.from('licencias').update({ estado: 'ACTIVA' }).eq('id', candidata.id)
        promovidas++
        invalidarCacheEstado()
      }
    }
  }

  return { promovidas, expiradas }
}
