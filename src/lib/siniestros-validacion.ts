/**
 * Validación y normalización centralizada de Siniestros.
 *
 * Se invoca desde POST /api/siniestros/crear y PATCH /api/siniestros/[id]
 * para garantizar coherencia de fechas, montos y datos del tercero.
 *
 * Regla: nunca confiar en el cliente — toda validación crítica vive acá.
 */

import { validarPatente, validarDNI } from '@/lib/importacion/validators'

export interface SiniestroInput {
  // Identificación
  numero_siniestro?: string | null

  // Fechas
  fecha_ocurrencia?: string | null
  fecha_denuncia?: string | null
  fecha_cierre?: string | null
  hora_siniestro?: string | null

  // Datos básicos
  tipo_siniestro?: string | null
  descripcion?: string | null
  detalle_siniestro?: Record<string, any> | null

  // Lugar
  lugar_siniestro?: string | null
  localidad_siniestro?: string | null

  // Montos
  monto_estimado?: number | string | null
  monto_liquidado?: number | string | null
  franquicia_aplicada?: number | string | null
  monto_cobrado?: number | string | null

  // Tercero
  tercero_nombre?: string | null
  tercero_dni?: string | null
  tercero_telefono?: string | null
  tercero_patente?: string | null

  // Notas internas (texto libre)
  notas?: string | null
}

function trimOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s.length > 0 ? s : null
}

function montoOrNull(v: unknown): number | null | 'INVALIDO' {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.-]/g, ''))
  if (isNaN(n) || !isFinite(n)) return 'INVALIDO'
  return n
}

function esFechaIsoValida(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return false
  const d = new Date(s)
  return !isNaN(d.getTime())
}

/**
 * Valida y normaliza un payload parcial de siniestro. En modo `crear` exige
 * los campos mínimos; en modo `editar` los toma como parciales si están presentes.
 *
 * Devuelve `{ ok: false, campos: { campo: motivo } }` si hay errores, o
 * `{ ok: true, datos: ... }` con los valores normalizados listos para INSERT/UPDATE.
 */
export function validarYNormalizarSiniestro(
  input: SiniestroInput,
  modo: 'crear' | 'editar',
  contextoActual?: {
    fecha_ocurrencia?: string | null
    fecha_denuncia?: string | null
    monto_estimado?: number | null
    monto_liquidado?: number | null
  },
): { ok: true; datos: Record<string, any> } | { ok: false; campos: Record<string, string> } {
  const campos: Record<string, string> = {}
  const out: Record<string, any> = {}

  // ── Fechas ──────────────────────────────────────────────
  const hoyIso = new Date().toISOString().slice(0, 10)

  if (input.fecha_denuncia !== undefined) {
    const fd = trimOrNull(input.fecha_denuncia)
    if (modo === 'crear' && !fd) {
      campos.fecha_denuncia = 'La fecha de denuncia es obligatoria'
    } else if (fd) {
      if (!esFechaIsoValida(fd)) {
        campos.fecha_denuncia = 'Formato de fecha inválido'
      } else if (fd.slice(0, 10) > hoyIso) {
        campos.fecha_denuncia = 'No puede ser una fecha futura'
      } else {
        out.fecha_denuncia = fd
      }
    }
  }

  if (input.fecha_ocurrencia !== undefined) {
    const fo = trimOrNull(input.fecha_ocurrencia)
    if (fo) {
      if (!esFechaIsoValida(fo)) {
        campos.fecha_ocurrencia = 'Formato de fecha inválido'
      } else if (fo.slice(0, 10) > hoyIso) {
        campos.fecha_ocurrencia = 'No puede ser una fecha futura'
      } else {
        out.fecha_ocurrencia = fo
      }
    } else {
      out.fecha_ocurrencia = null
    }
  }

  // Coherencia ocurrencia ≤ denuncia
  const foEff = (out.fecha_ocurrencia ?? contextoActual?.fecha_ocurrencia ?? null) as string | null
  const fdEff = (out.fecha_denuncia ?? contextoActual?.fecha_denuncia ?? null) as string | null
  if (foEff && fdEff && foEff.slice(0, 10) > fdEff.slice(0, 10)) {
    campos.fecha_ocurrencia = 'La fecha de ocurrencia debe ser anterior o igual a la denuncia'
  }

  if (input.fecha_cierre !== undefined) {
    const fc = trimOrNull(input.fecha_cierre)
    if (fc) {
      if (!esFechaIsoValida(fc)) {
        campos.fecha_cierre = 'Formato de fecha inválido'
      } else if (fdEff && fc.slice(0, 10) < fdEff.slice(0, 10)) {
        campos.fecha_cierre = 'Debe ser posterior o igual a la fecha de denuncia'
      } else {
        out.fecha_cierre = fc
      }
    } else {
      out.fecha_cierre = null
    }
  }

  // ── Hora ────────────────────────────────────────────────
  if (input.hora_siniestro !== undefined) {
    const h = trimOrNull(input.hora_siniestro)
    if (h && !/^\d{2}:\d{2}(:\d{2})?$/.test(h)) {
      campos.hora_siniestro = 'Formato HH:MM o HH:MM:SS'
    } else {
      out.hora_siniestro = h
    }
  }

  // ── Descripción / texto libre ──────────────────────────
  if (input.descripcion !== undefined) {
    const d = trimOrNull(input.descripcion)
    if (modo === 'crear' && !d) {
      campos.descripcion = 'La descripción es obligatoria'
    } else {
      out.descripcion = d
    }
  }

  if (input.tipo_siniestro !== undefined) {
    out.tipo_siniestro = trimOrNull(input.tipo_siniestro)
  }
  if (input.numero_siniestro !== undefined) {
    out.numero_siniestro = trimOrNull(input.numero_siniestro)
  }
  if (input.lugar_siniestro !== undefined) {
    out.lugar_siniestro = trimOrNull(input.lugar_siniestro)
  }
  if (input.localidad_siniestro !== undefined) {
    out.localidad_siniestro = trimOrNull(input.localidad_siniestro)
  }
  if (input.notas !== undefined) {
    out.notas = trimOrNull(input.notas)
  }

  // ── Montos ──────────────────────────────────────────────
  let mEstNuevo: number | null | undefined
  if (input.monto_estimado !== undefined) {
    const m = montoOrNull(input.monto_estimado)
    if (m === 'INVALIDO') campos.monto_estimado = 'Monto inválido'
    else if (m !== null && m < 0) campos.monto_estimado = 'No puede ser negativo'
    else { out.monto_estimado = m; mEstNuevo = m }
  }
  let mLiqNuevo: number | null | undefined
  if (input.monto_liquidado !== undefined) {
    const m = montoOrNull(input.monto_liquidado)
    if (m === 'INVALIDO') campos.monto_liquidado = 'Monto inválido'
    else if (m !== null && m < 0) campos.monto_liquidado = 'No puede ser negativo'
    else { out.monto_liquidado = m; mLiqNuevo = m }
  }
  if (input.franquicia_aplicada !== undefined) {
    const m = montoOrNull(input.franquicia_aplicada)
    if (m === 'INVALIDO') campos.franquicia_aplicada = 'Monto inválido'
    else if (m !== null && m < 0) campos.franquicia_aplicada = 'No puede ser negativo'
    else out.franquicia_aplicada = m
  }
  if (input.monto_cobrado !== undefined) {
    const m = montoOrNull(input.monto_cobrado)
    if (m === 'INVALIDO') campos.monto_cobrado = 'Monto inválido'
    else if (m !== null && m < 0) campos.monto_cobrado = 'No puede ser negativo'
    else out.monto_cobrado = m
  }

  // Coherencia: liquidado ≤ estimado
  const mEstEff = mEstNuevo !== undefined ? mEstNuevo : contextoActual?.monto_estimado ?? null
  const mLiqEff = mLiqNuevo !== undefined ? mLiqNuevo : contextoActual?.monto_liquidado ?? null
  if (mEstEff !== null && mLiqEff !== null && mLiqEff > mEstEff) {
    campos.monto_liquidado = `No puede superar el monto estimado (${mEstEff})`
  }
  // Coherencia: cobrado ≤ liquidado (si ambos vienen en el mismo payload)
  if (out.monto_cobrado !== undefined && out.monto_cobrado !== null
      && mLiqEff !== null && (out.monto_cobrado as number) > (mLiqEff as number)) {
    campos.monto_cobrado = `No puede superar el monto liquidado`
  }
  // Coherencia: franquicia ≤ estimado
  if (out.franquicia_aplicada !== undefined && out.franquicia_aplicada !== null
      && mEstEff !== null && (out.franquicia_aplicada as number) > (mEstEff as number)) {
    campos.franquicia_aplicada = `No puede superar el monto estimado`
  }

  // ── Datos del tercero ──────────────────────────────────
  if (input.tercero_nombre !== undefined) {
    out.tercero_nombre = trimOrNull(input.tercero_nombre)
  }
  if (input.tercero_dni !== undefined) {
    const d = trimOrNull(input.tercero_dni)
    if (d) {
      const r = validarDNI(d)
      if (!r.valido) campos.tercero_dni = r.motivo || 'DNI del tercero inválido'
      else out.tercero_dni = r.normalizado ?? d
    } else {
      out.tercero_dni = null
    }
  }
  if (input.tercero_telefono !== undefined) {
    out.tercero_telefono = trimOrNull(input.tercero_telefono)
  }
  if (input.tercero_patente !== undefined) {
    const p = trimOrNull(input.tercero_patente)
    if (p) {
      const r = validarPatente(p)
      if (!r.valido) campos.tercero_patente = 'Patente inválida (formato ABC123 o AB123CD)'
      else out.tercero_patente = r.normalizado ?? p.toUpperCase()
    } else {
      out.tercero_patente = null
    }
  }

  // ── detalle_siniestro JSONB ────────────────────────────
  // Solo aceptamos objetos planos; descartamos arrays/primitivos.
  if (input.detalle_siniestro !== undefined) {
    if (input.detalle_siniestro === null) {
      out.detalle_siniestro = null
    } else if (typeof input.detalle_siniestro === 'object' && !Array.isArray(input.detalle_siniestro)) {
      // Limita el tamaño total para evitar payloads enormes en JSONB.
      const serialized = JSON.stringify(input.detalle_siniestro)
      if (serialized.length > 50_000) {
        campos.detalle_siniestro = 'Detalle demasiado grande'
      } else {
        out.detalle_siniestro = input.detalle_siniestro
      }
    } else {
      campos.detalle_siniestro = 'Debe ser un objeto'
    }
  }

  if (Object.keys(campos).length > 0) return { ok: false, campos }
  return { ok: true, datos: out }
}
