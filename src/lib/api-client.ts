/**
 * Wrapper `apiCall()` para llamadas a las API routes del CRM.
 *
 * Beneficios sobre `fetch()`:
 *  - Retrocompatibilidad con ambos formatos de respuesta del CRM:
 *      { ok: true, data }               (Fase 1 — formato nuevo)
 *      { ok: true, ...campos }          (legacy — campos en el root)
 *      { ok: false, error: {...} }      (Fase 1)
 *      { ok: false, error: "string" }   (legacy)
 *  - Normaliza errores a `{ codigo?, mensaje, detalle?, campos? }`.
 *  - Muestra toast de error automáticamente (desactivable con `mostrar_toast_en_error: false`).
 *  - Serializa objetos JS como JSON si el body no es FormData/Blob/string.
 *  - Intercepta HTTP 401 redirigiendo a /login con `?volver=<path>&motivo=sesion_expirada`
 *    (desactivable con `ignorar_401: true`).
 *  - Manejo de errores de red (status=0) sin romper el caller.
 *
 * Uso:
 *   const r = await apiCall<{ id: string }>('/api/polizas', {
 *     method: 'POST',
 *     body: { numero_poliza: '123', ... },
 *   })
 *   if (r.ok) router.push(`/crm/polizas/${r.data!.id}`)
 *   else setErrorForm(r.error!)
 */

import { toast } from '@/lib/toast'

export interface ApiError {
  codigo?: string
  mensaje: string
  /** Mensaje pensado para el usuario final (sin tecnicismos). Si no viene, fallback a `mensaje`. */
  mensaje_humano?: string
  /** Qué puede hacer el usuario. */
  sugerencia?: string
  /** Agrupador legible ("Sesión", "Validación", etc.). */
  categoria_humana?: string
  detalle?: string
  campos?: Record<string, string>
}

export interface ApiResult<T> {
  ok: boolean
  data?: T
  error?: ApiError
  status: number
}

export interface ApiCallOpciones {
  /** Si se muestra toast automático en errores. Default: true */
  mostrar_toast_en_error?: boolean
  /** Si se bypassa el interceptor de 401 (para endpoints públicos). Default: false */
  ignorar_401?: boolean
}

interface RequestInitExtendido extends Omit<RequestInit, 'body'> {
  body?: BodyInit | Record<string, unknown> | unknown[] | null
}

function esFormDataOBlob(value: unknown): boolean {
  if (typeof FormData !== 'undefined' && value instanceof FormData) return true
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true
  if (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) return true
  return false
}

function normalizarError(raw: unknown, status: number): ApiError {
  // Formato nuevo: { ok: false, error: { codigo, mensaje, mensaje_humano, sugerencia, categoria_humana, detalle?, campos? } }
  if (raw && typeof raw === 'object' && 'error' in raw) {
    const err = (raw as { error: unknown }).error
    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>
      return {
        codigo: typeof e.codigo === 'string' ? e.codigo : undefined,
        mensaje: typeof e.mensaje === 'string' ? e.mensaje : 'Error desconocido',
        mensaje_humano: typeof e.mensaje_humano === 'string' ? e.mensaje_humano : undefined,
        sugerencia: typeof e.sugerencia === 'string' ? e.sugerencia : undefined,
        categoria_humana: typeof e.categoria_humana === 'string' ? e.categoria_humana : undefined,
        detalle: typeof e.detalle === 'string' ? e.detalle : undefined,
        campos: e.campos && typeof e.campos === 'object' ? (e.campos as Record<string, string>) : undefined,
      }
    }
    if (typeof err === 'string') {
      return { mensaje: err }
    }
  }

  // Legacy: { ok: false, mensaje: "..." } o { ok: false, motivo: "..." }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    if (typeof r.mensaje === 'string') return { mensaje: r.mensaje, codigo: typeof r.codigo === 'string' ? r.codigo : undefined }
    if (typeof r.motivo === 'string') return { mensaje: r.motivo }
  }

  return { mensaje: `Error HTTP ${status}` }
}

function extraerData<T>(raw: unknown): T | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const keysNoOk = Object.keys(r).filter((k) => k !== 'ok')
  // Formato nuevo puro: { ok: true, data } — desenvolver data
  if (keysNoOk.length === 1 && keysNoOk[0] === 'data') {
    return r.data as T
  }
  // Formato mixto/legacy: { ok: true, data: [...], total, pagina, ... } o { ok: true, ...campos }
  // Devolver el objeto completo sin `ok` para que el caller acceda a data, total, etc.
  const { ok: _ok, ...resto } = r
  return resto as T
}

function manejar401(): void {
  if (typeof window === 'undefined') return
  const actual = window.location.pathname + window.location.search
  const volver = encodeURIComponent(actual)
  // Evitar loop si ya estamos en login
  if (window.location.pathname.startsWith('/login')) return
  window.location.assign(`/login?volver=${volver}&motivo=sesion_expirada`)
}

export async function apiCall<T = unknown>(
  url: string,
  init: RequestInitExtendido = {},
  opciones: ApiCallOpciones = {}
): Promise<ApiResult<T>> {
  const mostrar_toast = opciones.mostrar_toast_en_error ?? true
  const ignorar_401 = opciones.ignorar_401 ?? false

  // Serializar body si es objeto plano
  const initFinal: RequestInit = { ...init } as RequestInit
  if (init.body !== undefined && init.body !== null && !esFormDataOBlob(init.body) && typeof init.body !== 'string') {
    initFinal.body = JSON.stringify(init.body)
    initFinal.headers = {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    }
  }

  let response: Response
  try {
    response = await fetch(url, initFinal)
  } catch (err) {
    const error: ApiError = { mensaje: 'No se pudo conectar con el servidor' }
    if (mostrar_toast) toast.error(error)
    return { ok: false, error, status: 0 }
  }

  // Interceptor 401
  if (response.status === 401 && !ignorar_401) {
    manejar401()
    return {
      ok: false,
      error: { codigo: 'ERR_AUTH_001', mensaje: 'Sesión expirada' },
      status: 401,
    }
  }

  // Parsear body (puede no ser JSON)
  let raw: unknown = null
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      raw = await response.json()
    } catch {
      raw = null
    }
  }

  if (!response.ok || (raw && typeof raw === 'object' && 'ok' in raw && (raw as { ok: boolean }).ok === false)) {
    const error = normalizarError(raw, response.status)
    if (mostrar_toast) toast.error(error)
    return { ok: false, error, status: response.status }
  }

  return { ok: true, data: extraerData<T>(raw), status: response.status }
}
