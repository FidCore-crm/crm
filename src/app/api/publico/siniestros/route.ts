import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { generarNumeroCaso } from '@/lib/numero-caso'
import { generarPDFSiniestro, type DatosPDFSiniestro } from '@/lib/pdf-siniestro'
import { enviarEmail } from '@/lib/email-sender'
import { registrarEnvioDirecto } from '@/lib/comunicaciones-sender'
import { mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { checkRateLimit as rlCheck, getClientIp } from '@/lib/rate-limit'
import { logger } from '@/lib/errores'
import { validarDNI, validarPatente } from '@/lib/importacion/validators'
import { validarYNormalizarSiniestro } from '@/lib/siniestros-validacion'
import { hoyAR } from '@/lib/utils'
import { registrarEventoBitacoraSiniestro } from '@/lib/bitacora-siniestro'
import {
  construirDetalleSiniestro,
  normalizarTipoRiesgo,
  MAX_TESTIGOS,
  type ConductorData, type TerceroData, type TestigoData,
} from '@/lib/siniestros-tipos'
import { derivarTonos, normalizarColorMarca, COLOR_MARCA_DEFAULT, type TonosDerivados } from '@/lib/color-marca'
import { AVISO_PRECARGA_TITULO, AVISO_PRECARGA_TEXTO } from '@/lib/aviso-precarga-siniestro'

const STORAGE_ROOT = path.join(process.cwd(), 'storage')
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB por archivo
const MAX_BODY_SIZE = 50 * 1024 * 1024 // 50MB total
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'pdf', 'doc', 'docx']
const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function sanitizeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

function sanitizeFileName(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
}

/**
 * Verifica que los primeros bytes del archivo coincidan con un tipo conocido.
 * Defensa contra archivos renombrados (ej: malicioso.exe → malicioso.pdf).
 * No depende del Content-Type que envía el cliente (controlable).
 *
 * Soporta: JPEG, PNG, PDF, DOC (OLE legacy), DOCX (zip-based).
 * Devuelve la extensión inferida o null si no matchea ningún formato esperado.
 */
function detectarTipoPorBytes(buffer: Buffer): 'jpg' | 'png' | 'pdf' | 'doc' | 'docx' | null {
  if (buffer.length < 8) return null
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
      buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) return 'png'
  // PDF: 25 50 44 46 2D ("%PDF-")
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46 &&
      buffer[4] === 0x2d) return 'pdf'
  // DOC OLE legacy: D0 CF 11 E0 A1 B1 1A E1
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0 &&
      buffer[4] === 0xa1 && buffer[5] === 0xb1 && buffer[6] === 0x1a && buffer[7] === 0xe1) return 'doc'
  // DOCX (zip-based): 50 4B 03 04 — el zip podría ser cualquier OOXML, lo
  // aceptamos porque la extensión ya se valida y el riesgo es bajo.
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return 'docx'
  return null
}

/**
 * Valida que la extensión declarada sea consistente con los magic bytes.
 * jpg/jpeg comparten formato, así que se consideran equivalentes.
 */
function tipoCoincideConExtension(tipo: ReturnType<typeof detectarTipoPorBytes>, ext: string): boolean {
  if (!tipo) return false
  if (ext === 'jpg' || ext === 'jpeg') return tipo === 'jpg'
  return tipo === ext
}

function normalizeDNI(dni: string): string {
  return dni.replace(/[.\s-]/g, '')
}

function isYesString(v: string | null): boolean {
  if (!v) return false
  const s = v.toLowerCase().trim()
  return s === 'si' || s === 'sí' || s === 'yes' || s === 'true' || s === '1'
}

const MSG_DATOS_NO_COINCIDEN_DEFAULT =
  'Los datos ingresados no coinciden con nuestro sistema. Verificá tu DNI, email y número de póliza, o contactá a tu productor.'

export async function POST(request: NextRequest) {
  const ip = getClientIp(request)
  const userAgent = (request.headers.get('user-agent') || '').slice(0, 500)

  try {
    // Body size total
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10)
    if (contentLength > MAX_BODY_SIZE) {
      return NextResponse.json(
        { ok: false, error: 'Request demasiado grande. Máximo permitido: 50MB en total.' },
        { status: 413 },
      )
    }

    // Rate limiting
    const rl = await rlCheck({ identifier: ip, endpoint: 'publico-siniestros', maxRequests: 5, windowSeconds: 3600, failMode: 'closed' })
    if (!rl.allowed) {
      const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000)
      return NextResponse.json(
        { ok: false, error: 'Demasiados envíos. Intentá nuevamente en una hora.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      )
    }

    const supabaseCheck = getSupabaseAdmin()

    const { data: configFormulario } = await supabaseCheck
      .from('configuracion_formulario_publico')
      .select('activo, mensaje_validacion_fallida')
      .limit(1)
      .maybeSingle()

    if (configFormulario && configFormulario.activo === false) {
      return NextResponse.json(
        { ok: false, error: 'El formulario público está actualmente desactivado.' },
        { status: 503 },
      )
    }

    const MSG_DATOS_NO_COINCIDEN = configFormulario?.mensaje_validacion_fallida || MSG_DATOS_NO_COINCIDEN_DEFAULT

    const formData = await request.formData()

    // Honeypot — descarta sin pretender éxito (un cliente legítimo cuyo
    // password manager autocompletó el campo trampa NO debe ver pantalla
    // de éxito falsa). Devolvemos el mismo mensaje genérico de datos no
    // coincidentes para no revelar al bot que detectamos el honeypot.
    const honeypot = formData.get('website_honeypot')
    if (honeypot && String(honeypot).trim() !== '') {
      logger.warn({ modulo: 'formulario-publico', mensaje: 'Honeypot activado', contexto: { ip } })
      return NextResponse.json(
        { ok: false, error: MSG_DATOS_NO_COINCIDEN },
        { status: 400 },
      )
    }

    // El captcha matemático visible se sacó por fricción innecesaria. La
    // protección anti-bot ahora se basa solo en honeypot + rate limiting.

    // ── Datos del asegurado y póliza ─────────────────────
    const dni = formData.get('dni') as string | null
    const email = formData.get('email') as string | null
    const numero_poliza = formData.get('numero_poliza') as string | null
    const poliza_id_form = formData.get('poliza_id') as string | null
    const apellido = formData.get('apellido') as string | null
    const nombre = formData.get('nombre') as string | null
    const telefono = formData.get('telefono') as string | null

    // Datos del siniestro
    const tipo_siniestro = formData.get('tipo_siniestro') as string | null
    const tipo_otro_descripcion = formData.get('tipo_otro_descripcion') as string | null
    const fecha_siniestro = formData.get('fecha_siniestro') as string | null
    const hora_siniestro = formData.get('hora_siniestro') as string | null
    const lugar_siniestro = formData.get('lugar_siniestro') as string | null
    const localidad_siniestro = formData.get('localidad_siniestro') as string | null
    const monto_estimado = formData.get('monto_estimado') as string | null
    const descripcion = formData.get('descripcion') as string | null
    const denuncia_policial = formData.get('denuncia_policial') as string | null
    const acta_policial = formData.get('acta_policial') as string | null

    // Conductor (auto/moto)
    const conductor_es_asegurado = isYesString(formData.get('conductor_es_asegurado') as string | null)
                                || (formData.get('conductor_es_asegurado') === null)  // default true
    const conductor_nombre = formData.get('conductor_nombre') as string | null
    const conductor_apellido = formData.get('conductor_apellido') as string | null
    const conductor_dni = formData.get('conductor_dni') as string | null
    const conductor_telefono = formData.get('conductor_telefono') as string | null
    const conductor_relacion = formData.get('conductor_relacion') as string | null
    const conductor_registro = formData.get('conductor_registro') as string | null

    // Vehículo estacionado (auto/moto)
    const vehiculo_estacionado_raw = (formData.get('vehiculo_estacionado') as string | null)?.toLowerCase().trim() || ''
    const vehiculo_estacionado: 'si' | 'no' | '' =
      vehiculo_estacionado_raw === 'si' ? 'si'
      : vehiculo_estacionado_raw === 'no' ? 'no'
      : ''

    // Tercero / Otra persona o vehículo involucrado (Opción C, auto/moto)
    const hubo_tercero = isYesString(formData.get('hubo_tercero') as string | null)
    const tercero_categoria_raw = (formData.get('tercero_categoria') as string | null)?.toLowerCase().trim() || ''
    const CATEGORIAS_VALIDAS = new Set(['vehiculo', 'moto', 'bici', 'peaton', 'objeto_fijo', 'persona', 'otro'])
    const tercero_categoria = CATEGORIAS_VALIDAS.has(tercero_categoria_raw) ? tercero_categoria_raw : ''
    const tercero_fuga = isYesString(formData.get('tercero_fuga') as string | null)
    const tercero_nombre_form = formData.get('tercero_nombre') as string | null
    const tercero_dni_form = formData.get('tercero_dni') as string | null
    const tercero_telefono_form = formData.get('tercero_telefono') as string | null
    const tercero_compania = formData.get('tercero_compania') as string | null
    const tercero_poliza = formData.get('tercero_poliza') as string | null
    const tercero_tipo_vehiculo = formData.get('tercero_tipo_vehiculo') as string | null
    const tercero_patente_form = formData.get('tercero_patente') as string | null
    const tercero_marca = formData.get('tercero_marca') as string | null
    const tercero_modelo = formData.get('tercero_modelo') as string | null
    const tercero_anio = formData.get('tercero_anio') as string | null
    const tercero_danos = formData.get('tercero_danos') as string | null

    // Lesionados
    const hubo_lesionados = isYesString(formData.get('hubo_lesionados') as string | null)
    const detalle_lesiones = formData.get('detalle_lesiones') as string | null

    // Daños propios
    const danos_propios = formData.get('danos_propios') as string | null

    // Hogar
    const tipo_vivienda = formData.get('tipo_vivienda') as string | null
    const que_paso = formData.get('que_paso') as string | null
    const ambiente_afectado = formData.get('ambiente_afectado') as string | null
    const causa_siniestro = formData.get('causa_siniestro') as string | null

    // Testigos
    const hubo_testigos = isYesString(formData.get('hubo_testigos') as string | null)
    const testigosForm: TestigoData[] = []
    for (let i = 1; i <= MAX_TESTIGOS; i++) {
      const tn = formData.get(`testigo_${i}_nombre`) as string | null
      const tt = formData.get(`testigo_${i}_telefono`) as string | null
      if (tn?.trim() || tt?.trim()) {
        testigosForm.push({ nombre: (tn ?? '').trim(), telefono: (tt ?? '').trim() })
      }
    }

    // Validar campos obligatorios
    if (!dni || !email || !numero_poliza || !apellido || !nombre || !descripcion || !fecha_siniestro) {
      return NextResponse.json(
        { ok: false, error: 'Faltan campos obligatorios: DNI, email, número de póliza, apellido, nombre, fecha del siniestro y descripción.' },
        { status: 400 },
      )
    }

    if (!EMAIL_REGEX.test(email.trim())) {
      return NextResponse.json({ ok: false, error: 'El formato del email no es válido.' }, { status: 400 })
    }

    const dniValidado = validarDNI(normalizeDNI(dni))
    if (!dniValidado.valido) {
      return NextResponse.json({ ok: false, error: dniValidado.motivo || 'DNI inválido.' }, { status: 400 })
    }
    const dniNorm = dniValidado.normalizado!

    const supabase = getSupabaseAdmin()

    // ── Validar persona, póliza y contexto ───────────────
    const { data: persona } = await supabase
      .from('personas')
      .select('id, apellido, nombre, dni_cuil, email, telefono, usuario_id')
      .eq('dni_cuil', dniNorm)
      .maybeSingle()

    if (!persona) {
      return NextResponse.json({ ok: false, error: MSG_DATOS_NO_COINCIDEN }, { status: 400 })
    }

    if (!persona.email || persona.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
      return NextResponse.json({ ok: false, error: MSG_DATOS_NO_COINCIDEN }, { status: 400 })
    }

    // Buscar póliza: primero por id (si vino del portal con token), si no por número.
    let polizaQuery = supabase
      .from('polizas')
      .select(`
        id, numero_poliza, compania_id, ramo_id, estado, asegurado_id,
        ramo:catalogos!ramo_id (id, nombre, metadata),
        riesgos (id, tipo_riesgo, detalle_tecnico)
      `)
      .eq('asegurado_id', persona.id)

    if (poliza_id_form) {
      polizaQuery = polizaQuery.eq('id', poliza_id_form)
    } else {
      polizaQuery = polizaQuery.eq('numero_poliza', numero_poliza.trim())
    }
    const { data: poliza } = await polizaQuery.maybeSingle()

    if (!poliza) {
      return NextResponse.json({ ok: false, error: MSG_DATOS_NO_COINCIDEN }, { status: 400 })
    }

    if ((poliza as any).estado !== 'VIGENTE') {
      return NextResponse.json(
        { ok: false, error: 'La póliza ingresada no se encuentra vigente. Contactá a tu productor para regularizar la situación.' },
        { status: 400 },
      )
    }

    // Resolver compañía y ramo (con metadata para tipo_riesgo)
    let companiaNombre = '—'
    const ramoCat = (poliza as any).ramo as { id: string; nombre: string; metadata: any } | null
    let ramoNombre = ramoCat?.nombre || '—'
    if ((poliza as any).compania_id) {
      const { data: cat } = await supabase
        .from('catalogos')
        .select('id, nombre')
        .eq('id', (poliza as any).compania_id)
        .maybeSingle()
      if (cat) companiaNombre = (cat as any).nombre
    }

    const tipoRiesgoRaw = ramoCat?.metadata?.tipo_riesgo
                       ?? ((poliza as any).riesgos?.[0]?.tipo_riesgo)
                       ?? ''
    const tipoRiesgo = normalizarTipoRiesgo(tipoRiesgoRaw)
    const esAutoMoto = tipoRiesgo === 'automotor' || tipoRiesgo === 'moto'
    const esHogar = tipoRiesgo === 'hogar'

    const riesgoPrincipal = (poliza as any).riesgos?.[0] || null
    const riesgo_id: string | null = riesgoPrincipal?.id ?? null

    // ── Validar y normalizar fechas/montos/datos del siniestro ──
    // Construimos el detalle_siniestro JSONB consolidado primero para
    // que validarYNormalizarSiniestro lo persista coherente.
    const conductor: ConductorData | undefined = (esAutoMoto && !conductor_es_asegurado) ? {
      nombre:   conductor_nombre ?? '',
      apellido: conductor_apellido ?? '',
      dni:      conductor_dni ? normalizeDNI(conductor_dni) : '',
      telefono: conductor_telefono ?? '',
      relacion: conductor_relacion ?? '',
      registro: conductor_registro ?? '',
    } : undefined

    const tercero: TerceroData | undefined = (esAutoMoto && hubo_tercero && !tercero_fuga) ? {
      nombre:        tercero_nombre_form ?? '',
      dni:           tercero_dni_form ?? '',
      telefono:      tercero_telefono_form ?? '',
      compania:      tercero_compania ?? '',
      poliza:        tercero_poliza ?? '',
      tipo_vehiculo: tercero_tipo_vehiculo ?? '',
      patente:       (tercero_patente_form ?? '').toUpperCase(),
      marca:         tercero_marca ?? '',
      modelo:        tercero_modelo ?? '',
      anio:          tercero_anio ?? '',
      danos:         tercero_danos ?? '',
    } : undefined

    const detalleSiniestroBase = construirDetalleSiniestro({
      tipo_riesgo: tipoRiesgo,
      tipo_otro_descripcion: tipo_siniestro === 'OTRO' ? (tipo_otro_descripcion ?? '') : undefined,
      denuncia_policial: isYesString(denuncia_policial),
      acta_policial: acta_policial ?? undefined,
      otra_persona_conduce: esAutoMoto ? !conductor_es_asegurado : undefined,
      conductor: conductor,
      danos_propios: esAutoMoto ? (danos_propios ?? undefined) : undefined,
      hubo_lesionados: esAutoMoto ? hubo_lesionados : undefined,
      detalle_lesiones: esAutoMoto && hubo_lesionados ? (detalle_lesiones ?? undefined) : undefined,
      hubo_tercero: esAutoMoto ? hubo_tercero : undefined,
      tercero_fuga: esAutoMoto && hubo_tercero ? tercero_fuga : undefined,
      tercero: tercero,
      hubo_testigos: hubo_testigos,
      testigos: hubo_testigos ? testigosForm : undefined,
      tipo_vivienda: esHogar ? (tipo_vivienda ?? undefined) : undefined,
      que_paso: esHogar ? (que_paso ?? undefined) : undefined,
      ambiente_afectado: esHogar ? (ambiente_afectado ?? undefined) : undefined,
      causa_siniestro: esHogar ? (causa_siniestro ?? undefined) : undefined,
    })

    // Campos extra del rediseño del formulario público que no pasan por
    // construirDetalleSiniestro (mantenido por compat con CRM interno).
    const detalleSiniestro: Record<string, any> = { ...detalleSiniestroBase }
    if (esAutoMoto && vehiculo_estacionado) {
      detalleSiniestro.vehiculo_estacionado = vehiculo_estacionado
    }
    if (esAutoMoto && hubo_tercero && tercero_categoria) {
      detalleSiniestro.tercero_categoria = tercero_categoria
    }

    // Campos custom configurados por el PAS en /crm/configuracion/catalogos.
    // El form los manda con prefijo `custom_<key>`. Solo aceptamos los que
    // están en la lista oficial del catálogo (ramoCat.metadata.campos_siniestro)
    // para evitar que un cliente inyecte keys arbitrarias en el JSONB.
    const camposCustomCatalogo = Array.isArray(ramoCat?.metadata?.campos_siniestro)
      ? (ramoCat!.metadata!.campos_siniestro as Array<{ key?: unknown }>)
        .map(c => (c && typeof c === 'object' && typeof c.key === 'string' ? c.key : null))
        .filter((k): k is string => !!k)
      : []
    for (const key of camposCustomCatalogo) {
      const raw = formData.get(`custom_${key}`)
      if (typeof raw === 'string' && raw.trim()) {
        detalleSiniestro[key] = raw.trim().slice(0, 2000)
      }
    }

    // Valores del bloque dinámico (para tipos ROBO_RUEDAS, GRANIZO, etc. que
    // renderea CamposDinamicos en el form). El cliente los serializa como JSON.
    // Los mergeamos al detalle. Aceptamos cualquier key porque estos campos vienen
    // de la matriz siniestros-catalogo.ts que ya define keys válidas por tipo.
    const valoresDinamicosRaw = formData.get('valores_dinamicos')
    if (typeof valoresDinamicosRaw === 'string' && valoresDinamicosRaw.trim()) {
      try {
        const parsed = JSON.parse(valoresDinamicosRaw)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed)) {
            if (v == null || v === '') continue
            // Limitar el tamaño para evitar JSONBs gigantes (max ~50 KB).
            const sizeCheck = JSON.stringify(v).length
            if (sizeCheck > 50_000) continue
            detalleSiniestro[k] = v
          }
        }
      } catch {
        // Si el JSON es inválido lo ignoramos silenciosamente.
      }
    }

    // Sanitizar todos los strings dentro de detalle_siniestro para evitar XSS.
    // IMPORTANTE: cortamos a 2000 ANTES de sanitizar — si el texto incluía un
    // `&`, `sanitizeText` lo expande a `&amp;` (5 chars) y un slice posterior
    // podría partir la entidad HTML dejando "&am..." y rompiendo el render.
    const sanitizarRecursivo = (v: any): any => {
      if (typeof v === 'string') return sanitizeText(v.slice(0, 2000))
      if (Array.isArray(v)) return v.map(sanitizarRecursivo)
      if (v && typeof v === 'object') {
        const out: Record<string, any> = {}
        for (const [k, val] of Object.entries(v)) out[k] = sanitizarRecursivo(val)
        return out
      }
      return v
    }
    const detalleSiniestroSeguro = sanitizarRecursivo(detalleSiniestro)

    // Fecha de denuncia = hoy en Argentina. `new Date().toISOString()` usa UTC
    // y en horario 21:00-23:59 ARG queda con el día siguiente cuando Postgres
    // castea a DATE. hoyAR() devuelve YYYY-MM-DD forzando TZ Buenos Aires.
    const fechaDenunciaIso = hoyAR()
    const validacionSiniestro = validarYNormalizarSiniestro({
      fecha_denuncia: fechaDenunciaIso,
      fecha_ocurrencia: fecha_siniestro,
      hora_siniestro: hora_siniestro,
      descripcion: descripcion,
      tipo_siniestro: tipo_siniestro,
      lugar_siniestro: lugar_siniestro,
      localidad_siniestro: localidad_siniestro,
      monto_estimado: monto_estimado,
      detalle_siniestro: detalleSiniestroSeguro,
      // Columnas directas del tercero (validación de DNI y patente)
      tercero_nombre: tercero?.nombre,
      tercero_dni: tercero?.dni,
      tercero_telefono: tercero?.telefono,
      tercero_patente: tercero?.patente,
    }, 'crear')

    if (!validacionSiniestro.ok) {
      const primerCampo = Object.keys(validacionSiniestro.campos)[0]
      const mensaje = primerCampo ? validacionSiniestro.campos[primerCampo] : 'Datos del siniestro inválidos'
      return NextResponse.json(
        { ok: false, error: mensaje, campos: validacionSiniestro.campos },
        { status: 400 },
      )
    }
    const datosSiniestro = validacionSiniestro.datos

    // Validación adicional: patente del tercero (no es bloqueante por validador,
    // pero la rechazamos si vino en formato inválido).
    if (tercero?.patente) {
      const r = validarPatente(tercero.patente)
      if (!r.valido) {
        return NextResponse.json(
          { ok: false, error: 'La patente del tercero tiene formato inválido (ABC123 o AB123CD).' },
          { status: 400 },
        )
      }
    }

    // ── Generar número de caso atómico ───────────────────
    let numeroCaso: string
    try {
      numeroCaso = await generarNumeroCaso()
    } catch (err: any) {
      logger.error({ modulo: 'formulario-publico', mensaje: 'Error generando numero de caso', contexto: { error: err.message } })
      return NextResponse.json({ ok: false, error: 'Error interno. Intentá nuevamente.' }, { status: 500 })
    }

    logger.info({
      modulo: 'formulario-publico',
      mensaje: 'Inicio de procesamiento',
      contexto: { numero_caso: numeroCaso, asegurado: `${persona.apellido} ${persona.nombre}` },
    })

    // ── Insertar siniestro ───────────────────────────────
    const { data: siniestro, error: siniestroError } = await supabase
      .from('siniestros')
      .insert({
        numero_caso: numeroCaso,
        numero_siniestro: null,
        poliza_id: (poliza as any).id,
        persona_id: persona.id,
        riesgo_id: riesgo_id,
        fecha_denuncia: datosSiniestro.fecha_denuncia ?? fechaDenunciaIso,
        fecha_ocurrencia: datosSiniestro.fecha_ocurrencia ?? null,
        hora_siniestro: datosSiniestro.hora_siniestro ?? null,
        lugar_siniestro: datosSiniestro.lugar_siniestro ? sanitizeText(datosSiniestro.lugar_siniestro) : null,
        localidad_siniestro: datosSiniestro.localidad_siniestro ? sanitizeText(datosSiniestro.localidad_siniestro) : null,
        tipo_siniestro: datosSiniestro.tipo_siniestro ?? null,
        descripcion: sanitizeText(datosSiniestro.descripcion ?? ''),
        estado: 'DENUNCIADO',
        monto_estimado: datosSiniestro.monto_estimado ?? null,
        detalle_siniestro: detalleSiniestroSeguro,
        tercero_nombre: datosSiniestro.tercero_nombre ?? null,
        tercero_dni: datosSiniestro.tercero_dni ?? null,
        tercero_telefono: datosSiniestro.tercero_telefono ?? null,
        tercero_patente: datosSiniestro.tercero_patente ?? null,
        origen_creacion: 'PORTAL_CLIENTE',
        revisado_por_pas: false,
      } as any)
      .select('id, numero_caso')
      .single()

    if (siniestroError || !siniestro) {
      logger.error({ modulo: 'formulario-publico', mensaje: 'Error creando siniestro', contexto: { error: siniestroError?.message } })
      return NextResponse.json({ ok: false, error: 'Error al registrar la denuncia. Intentá nuevamente.' }, { status: 500 })
    }

    // ── Crear carpetas ───────────────────────────────────
    const carpetaSiniestro = path.join(STORAGE_ROOT, 'siniestros', numeroCaso)
    try {
      await mkdir(path.join(carpetaSiniestro, 'documentacion'), { recursive: true })
      await mkdir(path.join(carpetaSiniestro, 'fotos'), { recursive: true })
    } catch (err: any) {
      await supabase.from('siniestros').delete().eq('id', siniestro.id)
      logger.error({ modulo: 'formulario-publico', mensaje: 'Error creando carpetas', contexto: { numero_caso: numeroCaso, error: err.message } })
      return NextResponse.json({ ok: false, error: 'Error al registrar la denuncia. Intentá nuevamente.' }, { status: 500 })
    }

    // ── Procesar archivos adjuntos con categoría ─────────
    // El frontend envía pares "archivos" + "archivos_categoria" en el mismo
    // orden. Ejemplo de slot ids: licencia_frente, licencia_dorso, cedula_frente,
    // cedula_dorso, dni_conductor_frente, dni_conductor_dorso, denuncia_policial, generales.
    const archivos = formData.getAll('archivos') as File[]
    const categorias = formData.getAll('archivos_categoria') as string[]
    const archivosInfo: Array<{ nombre: string; tipo: string; tamano: number; categoria: string }> = []

    for (let idx = 0; idx < archivos.length; idx++) {
      const archivo = archivos[idx]
      const categoriaSlot = (categorias[idx] ?? 'generales')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 50)
      if (!archivo || !archivo.name || archivo.size === 0) continue

      if (archivo.size > MAX_FILE_SIZE) {
        logger.warn({ modulo: 'formulario-publico', mensaje: 'Archivo excede 10MB', contexto: { numero_caso: numeroCaso, archivo: archivo.name } })
        continue
      }

      const ext = archivo.name.split('.').pop()?.toLowerCase() || ''
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        logger.warn({ modulo: 'formulario-publico', mensaje: 'Extensión no permitida', contexto: { numero_caso: numeroCaso, archivo: archivo.name } })
        continue
      }
      // El Content-Type del cliente es controlable; lo usamos solo como pre-check.
      // La validación REAL se hace abajo por magic bytes después de leer el buffer.
      if (archivo.type && !ALLOWED_MIMES.has(archivo.type)) {
        logger.warn({ modulo: 'formulario-publico', mensaje: 'MIME no permitido', contexto: { numero_caso: numeroCaso, archivo: archivo.name, mime: archivo.type } })
        continue
      }

      // Leer el buffer y validar magic bytes contra la extensión declarada.
      const buffer = Buffer.from(await archivo.arrayBuffer())
      const tipoReal = detectarTipoPorBytes(buffer)
      if (!tipoCoincideConExtension(tipoReal, ext)) {
        logger.warn({
          modulo: 'formulario-publico',
          mensaje: 'Magic bytes no coinciden con extensión — posible archivo renombrado',
          contexto: { numero_caso: numeroCaso, archivo: archivo.name, extension: ext, tipo_detectado: tipoReal },
        })
        continue
      }

      // Prefijar el nombre con la categoría para que el PAS identifique de un
      // vistazo qué es cada archivo: "licencia_frente__foto.jpg".
      const nombreSanitizado = sanitizeFileName(archivo.name)
      const prefijo = categoriaSlot && categoriaSlot !== 'generales' ? `${categoriaSlot}__` : ''
      let nombreFinal = `${prefijo}${nombreSanitizado}`
      const carpetaDocs = path.join(carpetaSiniestro, 'documentacion')

      if (existsSync(path.join(carpetaDocs, nombreFinal))) {
        const extPart = path.extname(nombreFinal)
        const basePart = path.basename(nombreFinal, extPart)
        // crypto.randomUUID() evita colisiones concurrentes (Date.now() puede
        // chocar entre dos uploads simultáneos del mismo nombre dentro del mismo ms).
        nombreFinal = `${basePart}_${crypto.randomUUID().slice(0, 8)}${extPart}`
      }

      const rutaAbsoluta = path.resolve(carpetaDocs, nombreFinal)
      const rootConSep = STORAGE_ROOT.endsWith(path.sep) ? STORAGE_ROOT : STORAGE_ROOT + path.sep
      if (!rutaAbsoluta.startsWith(rootConSep)) {
        logger.warn({ modulo: 'formulario-publico', mensaje: 'Path traversal detectado', contexto: { numero_caso: numeroCaso, archivo: nombreFinal } })
        continue
      }

      try {
        await writeFile(rutaAbsoluta, buffer)

        const rutaRelativa = `siniestros/${numeroCaso}/documentacion/${nombreFinal}`
        await supabase.from('siniestro_archivos').insert({
          siniestro_id: siniestro.id,
          categoria: 'documentacion',
          nombre: nombreFinal,
          ruta: rutaRelativa,
          mime_type: archivo.type || null,
          tamano: archivo.size,
        })

        archivosInfo.push({
          nombre: nombreFinal,
          tipo: archivo.type || ext,
          tamano: archivo.size,
          categoria: categoriaSlot || 'generales',
        })
      } catch (err: any) {
        logger.error({ modulo: 'formulario-publico', mensaje: 'Error guardando archivo', contexto: { numero_caso: numeroCaso, archivo: nombreFinal, error: err.message } })
      }
    }

    // ── Generar PDF ──────────────────────────────────────
    let pdfBuffer: Buffer | null = null
    try {
      const { data: configProd } = await supabase
        .from('configuracion')
        .select('nombre')
        .limit(1)
        .maybeSingle()

      const datosPDF: DatosPDFSiniestro = {
        numero_caso: numeroCaso,
        fecha_denuncia: fechaDenunciaIso,
        asegurado: {
          apellido: persona.apellido,
          nombre: persona.nombre || '',
          dni: persona.dni_cuil,
          email: persona.email,
          telefono: telefono || persona.telefono || '',
        },
        poliza: {
          numero_poliza: (poliza as any).numero_poliza,
          compania: companiaNombre,
          ramo: ramoNombre,
        },
        siniestro: {
          tipo: tipo_siniestro || '—',
          fecha_ocurrencia: fecha_siniestro,
          hora: hora_siniestro || '',
          lugar: lugar_siniestro || '',
          localidad: localidad_siniestro || '',
          descripcion: descripcion,
          denuncia_policial: denuncia_policial || '',
        },
        detalle_extendido: detalleSiniestroSeguro,
        archivos_adjuntos: archivosInfo.map(a => ({ nombre: a.nombre, tipo: a.tipo, tamano: a.tamano })),
        organizacion: { nombre: configProd?.nombre || 'Productor de Seguros' },
        trazabilidad: {
          origen: 'Formulario web público',
          ip: ip || undefined,
          user_agent: userAgent || undefined,
          fecha_carga: fechaDenunciaIso,
        },
      }

      pdfBuffer = await generarPDFSiniestro(datosPDF)

      const pdfNombre = `Denuncia_${numeroCaso}.pdf`
      const pdfRuta = path.join(carpetaSiniestro, pdfNombre)
      await writeFile(pdfRuta, pdfBuffer)

      await supabase.from('siniestro_archivos').insert({
        siniestro_id: siniestro.id,
        categoria: 'documentacion',
        nombre: pdfNombre,
        ruta: `siniestros/${numeroCaso}/${pdfNombre}`,
        mime_type: 'application/pdf',
        tamano: pdfBuffer.length,
      })
    } catch (err: any) {
      logger.error({ modulo: 'formulario-publico', mensaje: 'Error generando PDF', contexto: { numero_caso: numeroCaso, error: err.message } })
    }

    // ── Bitácora ─────────────────────────────────────────
    await registrarEventoBitacoraSiniestro(supabase, {
      siniestro_id: siniestro.id,
      tipo: 'CREACION',
      estado_nuevo: 'DENUNCIADO',
      usuario_id: null,
      texto: `Siniestro denunciado a través del formulario público por ${persona.nombre || ''} ${persona.apellido}. IP: ${ip}.`,
    })

    // ── Notificación in-app al PAS ───────────────────────
    const nombreCliente = persona.nombre ? `${persona.apellido}, ${persona.nombre}` : persona.apellido
    await supabase.from('notificaciones').insert({
      tipo: 'SINIESTRO_DENUNCIA_PUBLICA',
      prioridad: 'CRITICA',
      titulo: 'Nueva denuncia desde el formulario público',
      mensaje: `${nombreCliente} denunció un siniestro (caso #${numeroCaso}) sobre la póliza ${(poliza as any).numero_poliza}.`,
      entidad_tipo: 'siniestro',
      entidad_id: siniestro.id,
      url: `/crm/siniestros/${siniestro.id}`,
      usuario_id: persona.usuario_id ?? null,
    })

    // ── Emails ───────────────────────────────────────────
    let emailEnviado = false
    try {
      const [{ data: configCorreos }, { data: configComunic }, { data: configOrgEmail }] = await Promise.all([
        supabase
          .from('configuracion_correos')
          .select('from_email, from_name, configurado')
          .limit(1)
          .maybeSingle(),
        supabase
          .from('configuracion_comunicaciones')
          .select('envio_automatico_denuncia_publica_cliente, envio_automatico_denuncia_publica_pas')
          .limit(1)
          .maybeSingle(),
        supabase
          .from('configuracion')
          .select('email')
          .limit(1)
          .maybeSingle(),
      ])

      // Email operativo del PAS (el que lee el correo) — priorizamos éste sobre
      // configCorreos.from_email para evitar que el email al PAS se envíe al
      // mismo buzón SMTP (Gmail y otros aplican anti-loop y lo mandan a
      // "Enviados" en lugar del Inbox → el PAS cree que no le llega).
      const emailPAS = (configOrgEmail as any)?.email?.trim() || (configCorreos as any)?.from_email

      // Toggles individuales — el admin puede apagar cada uno por separado.
      // Default true (si no hay config_comunicaciones, se envían).
      const enviarAlCliente = configComunic
        ? (configComunic as any).envio_automatico_denuncia_publica_cliente !== false
        : true
      const enviarAlPAS = configComunic
        ? (configComunic as any).envio_automatico_denuncia_publica_pas !== false
        : true

      if (!configCorreos || !configCorreos.configurado) {
        logger.warn({ modulo: 'formulario-publico', mensaje: 'SMTP no configurado', contexto: { numero_caso: numeroCaso } })
        await registrarEventoBitacoraSiniestro(supabase, {
          siniestro_id: siniestro.id,
          tipo: 'NOTA',
          texto: 'No se pudieron enviar emails: configuración SMTP no disponible.',
        })
      } else if (!enviarAlCliente && !enviarAlPAS) {
        await registrarEventoBitacoraSiniestro(supabase, {
          siniestro_id: siniestro.id,
          tipo: 'NOTA',
          texto: 'No se enviaron emails: ambos toggles de denuncia pública están desactivados en Configuración.',
        })
      } else {
        // Color de marca configurado por el PAS (cae a default si no está)
        const { data: configOrganizacion } = await supabase
          .from('configuracion')
          .select('color_marca')
          .limit(1)
          .maybeSingle()
        const tonos = derivarTonos(normalizarColorMarca((configOrganizacion as any)?.color_marca ?? COLOR_MARCA_DEFAULT))

        const attachments = pdfBuffer
          ? [{ filename: `Denuncia_${numeroCaso}.pdf`, content: pdfBuffer }]
          : []

        if (enviarAlCliente) {
          const htmlCliente = construirEmailCliente({
            numeroCaso, persona, poliza: poliza as any, companiaNombre, ramoNombre,
            tipo_siniestro, fecha_siniestro, archivosInfo, tonos,
          })
          const asuntoCliente = `Confirmación de denuncia - Caso ${numeroCaso}`
          const resCliente = await enviarEmail({
            to: email.trim(),
            subject: asuntoCliente,
            html: htmlCliente,
            attachments,
          })
          if (resCliente.ok) emailEnviado = true
          else {
            logger.error({ modulo: 'formulario-publico', mensaje: 'Error email cliente', contexto: { numero_caso: numeroCaso, error: resCliente.error } })
          }
          // Registrar post-hoc en email_envios para tener tracking + auditoría
          // en el tab Comunicaciones de la ficha del cliente.
          await registrarEnvioDirecto({
            destinatario_email: email.trim(),
            destinatario_nombre: nombreCliente,
            persona_id: persona.id,
            poliza_id: (poliza as any).id,
            asunto: asuntoCliente,
            tipo_envio: 'SINIESTRO_DENUNCIA_CLIENTE',
            estado: resCliente.ok ? 'ENVIADO' : 'FALLIDO',
            error: resCliente.ok ? undefined : resCliente.error,
            archivos_adjuntos: attachments.map(a => ({ filename: a.filename })),
            variables_extra: { numero_caso: numeroCaso },
          })
        }

        if (enviarAlPAS) {
          if (!emailPAS) {
            logger.warn({ modulo: 'formulario-publico', mensaje: 'Email al PAS no enviado: no hay email operativo configurado en configuracion.email ni en configuracion_correos.from_email', contexto: { numero_caso: numeroCaso } })
          } else if (emailPAS === (configCorreos as any).from_email) {
            logger.warn({ modulo: 'formulario-publico', mensaje: 'Email al PAS se enviará al mismo buzón que from_email (Gmail y otros lo pueden filtrar como self-send)', contexto: { numero_caso: numeroCaso, email: emailPAS } })
          }
          const htmlPAS = construirEmailPAS({
            numeroCaso, persona, email: email.trim(), telefono: telefono || '',
            poliza: poliza as any, companiaNombre, ramoNombre,
            tipo_siniestro, fecha_siniestro, hora_siniestro, lugar_siniestro, localidad_siniestro,
            descripcion, denuncia_policial, acta_policial,
            tipoRiesgo, esAutoMoto, esHogar,
            conductor_es_asegurado, conductor,
            hubo_tercero, tercero_fuga, tercero,
            hubo_lesionados, detalle_lesiones,
            danos_propios,
            hubo_testigos, testigos: testigosForm,
            tipo_vivienda, que_paso, ambiente_afectado, causa_siniestro,
            archivosInfo, ip, tonos,
          })
          const asuntoPAS = `Nueva denuncia - ${numeroCaso} - ${persona.apellido} ${persona.nombre || ''}`
          const resPAS = emailPAS
            ? await enviarEmail({ to: emailPAS, subject: asuntoPAS, html: htmlPAS, attachments })
            : { ok: false, error: 'No hay email operativo del PAS configurado' } as const
          if (!resPAS.ok) {
            logger.error({ modulo: 'formulario-publico', mensaje: 'Error email PAS', contexto: { numero_caso: numeroCaso, error: resPAS.error } })
          }
          await registrarEnvioDirecto({
            destinatario_email: emailPAS ?? '(no configurado)',
            destinatario_nombre: null,
            persona_id: persona.id,
            poliza_id: (poliza as any).id,
            asunto: asuntoPAS,
            tipo_envio: 'SINIESTRO_DENUNCIA_PAS',
            estado: resPAS.ok ? 'ENVIADO' : 'FALLIDO',
            error: resPAS.ok ? undefined : resPAS.error,
            archivos_adjuntos: attachments.map(a => ({ filename: a.filename })),
            variables_extra: { numero_caso: numeroCaso },
          })
        }
      }
    } catch (err: any) {
      logger.error({ modulo: 'formulario-publico', mensaje: 'Error en envío de emails', contexto: { numero_caso: numeroCaso, error: err.message } })
    }

    return NextResponse.json({
      ok: true,
      numero_caso: numeroCaso,
      mensaje: 'Denuncia registrada correctamente',
      email_enviado_a: emailEnviado ? email.trim() : null,
    })
  } catch (err: any) {
    logger.error({ modulo: 'formulario-publico', mensaje: 'Error inesperado', contexto: { error: err.message } })
    return NextResponse.json({ ok: false, error: 'Error interno. Intentá nuevamente.' }, { status: 500 })
  }
}

// ════════════════════════════════════════════════════════════
//   HTML de los emails
// ════════════════════════════════════════════════════════════

function construirEmailCliente(args: {
  numeroCaso: string
  persona: any
  poliza: any
  companiaNombre: string
  ramoNombre: string
  tipo_siniestro: string | null
  fecha_siniestro: string
  archivosInfo: Array<{ nombre: string; tipo: string; tamano: number; categoria: string }>
  tonos: TonosDerivados
}): string {
  const { numeroCaso, persona, poliza, companiaNombre, ramoNombre, tipo_siniestro, fecha_siniestro, archivosInfo, tonos } = args
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:${tonos.base};color:${tonos.textoSobreColor};padding:20px 24px;border-radius:8px 8px 0 0;">
        <h1 style="margin:0;font-size:20px;">Confirmación de Denuncia de Siniestro</h1>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
        <div style="background:${tonos.muyClaro};border:1px solid ${tonos.borde};border-radius:6px;padding:16px;margin-bottom:20px;text-align:center;">
          <p style="margin:0;color:#64748b;font-size:13px;">Número de caso</p>
          <p style="margin:4px 0 0;color:${tonos.base};font-size:22px;font-weight:bold;">${numeroCaso}</p>
        </div>
        <p style="color:#334155;">Hola <strong>${persona.nombre || ''} ${persona.apellido}</strong>,</p>
        <p style="color:#334155;">Tu denuncia de siniestro fue registrada correctamente. A continuación, el resumen:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:6px 12px;color:#64748b;font-size:13px;">Póliza</td><td style="padding:6px 12px;font-weight:500;">${poliza.numero_poliza}</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:6px 12px;color:#64748b;font-size:13px;">Compañía</td><td style="padding:6px 12px;font-weight:500;">${companiaNombre}</td></tr>
          <tr><td style="padding:6px 12px;color:#64748b;font-size:13px;">Ramo</td><td style="padding:6px 12px;font-weight:500;">${ramoNombre}</td></tr>
          <tr style="background:#f8fafc;"><td style="padding:6px 12px;color:#64748b;font-size:13px;">Tipo</td><td style="padding:6px 12px;font-weight:500;">${tipo_siniestro || '—'}</td></tr>
          <tr><td style="padding:6px 12px;color:#64748b;font-size:13px;">Fecha del hecho</td><td style="padding:6px 12px;font-weight:500;">${fecha_siniestro}</td></tr>
        </table>
        ${archivosInfo.length > 0 ? `<p style="color:#64748b;font-size:13px;">Se adjuntaron ${archivosInfo.length} archivo(s) a la denuncia.</p>` : ''}
        <p style="color:#334155;">Adjuntamos el comprobante de denuncia en PDF. Guardalo como constancia.</p>
        <p style="color:#334155;">Tu productor se pondrá en contacto con vos para continuar con el trámite.</p>
        <div style="background:#fef3c7;border-left:4px solid #f59e0b;color:#78350f;padding:14px 18px;border-radius:6px;margin:20px 0 4px;font-size:14px;line-height:1.55;">
          <strong style="color:#b45309;">${AVISO_PRECARGA_TITULO}</strong> ${AVISO_PRECARGA_TEXTO}
        </div>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">
        <p style="color:#94a3b8;font-size:12px;">Este es un email automático. No respondas a este mensaje.</p>
      </div>
    </div>`
}

function construirEmailPAS(args: {
  numeroCaso: string
  persona: any
  email: string
  telefono: string
  poliza: any
  companiaNombre: string
  ramoNombre: string
  tipo_siniestro: string | null
  fecha_siniestro: string
  hora_siniestro: string | null
  lugar_siniestro: string | null
  localidad_siniestro: string | null
  descripcion: string
  denuncia_policial: string | null
  acta_policial: string | null
  tipoRiesgo: string
  esAutoMoto: boolean
  esHogar: boolean
  conductor_es_asegurado: boolean
  conductor?: ConductorData
  hubo_tercero: boolean
  tercero_fuga: boolean
  tercero?: TerceroData
  hubo_lesionados: boolean
  detalle_lesiones: string | null
  danos_propios: string | null
  hubo_testigos: boolean
  testigos: TestigoData[]
  tipo_vivienda: string | null
  que_paso: string | null
  ambiente_afectado: string | null
  causa_siniestro: string | null
  archivosInfo: Array<{ nombre: string; tipo: string; tamano: number; categoria: string }>
  ip: string
  tonos: TonosDerivados
}): string {
  const a = args
  const tonos = a.tonos
  const archivosPorCategoria = a.archivosInfo.reduce<Record<string, number>>((acc, x) => {
    acc[x.categoria] = (acc[x.categoria] ?? 0) + 1
    return acc
  }, {})

  function row(label: string, value: string | null | undefined, alt: boolean = false): string {
    if (!value) return ''
    return `<tr${alt ? ' style="background:#f8fafc;"' : ''}><td style="padding:4px 12px;color:#64748b;font-size:13px;">${label}</td><td style="padding:4px 12px;">${sanitizeText(String(value))}</td></tr>`
  }

  let alt = false
  function nextAlt(): boolean { alt = !alt; return alt }

  const seccionConductor = a.esAutoMoto ? `
    <h3 style="color:${tonos.base};margin:16px 0 8px;">Conductor</h3>
    <table style="width:100%;border-collapse:collapse;">
      ${row('¿Era el asegurado?', a.conductor_es_asegurado ? 'Sí' : 'No')}
      ${!a.conductor_es_asegurado && a.conductor ? `
        ${row('Apellido', a.conductor.apellido, nextAlt())}
        ${row('Nombre', a.conductor.nombre, nextAlt())}
        ${row('DNI', a.conductor.dni, nextAlt())}
        ${row('Teléfono', a.conductor.telefono, nextAlt())}
        ${row('Relación', a.conductor.relacion, nextAlt())}
        ${row('Registro', a.conductor.registro, nextAlt())}
      ` : ''}
    </table>
  ` : ''

  const seccionTercero = a.esAutoMoto && a.hubo_tercero ? `
    <h3 style="color:${tonos.base};margin:16px 0 8px;">Tercero involucrado</h3>
    <table style="width:100%;border-collapse:collapse;">
      ${a.tercero_fuga ? row('Estado', 'Se dio a la fuga') : (a.tercero ? `
        ${row('Nombre', a.tercero.nombre)}
        ${row('DNI', a.tercero.dni, true)}
        ${row('Teléfono', a.tercero.telefono)}
        ${row('Compañía', a.tercero.compania, true)}
        ${row('Nro. póliza', a.tercero.poliza)}
        ${row('Tipo vehículo', a.tercero.tipo_vehiculo, true)}
        ${row('Patente', a.tercero.patente)}
        ${row('Marca/modelo', [a.tercero.marca, a.tercero.modelo, a.tercero.anio].filter(Boolean).join(' '), true)}
        ${row('Daños', a.tercero.danos)}
      ` : '')}
    </table>
  ` : ''

  const seccionLesionados = a.esAutoMoto && a.hubo_lesionados ? `
    <h3 style="color:${tonos.base};margin:16px 0 8px;">Lesionados</h3>
    <p style="color:#334155;background:#f8fafc;padding:12px;border-radius:6px;">${sanitizeText(a.detalle_lesiones || '—')}</p>
  ` : ''

  const seccionDanos = a.esAutoMoto && a.danos_propios ? `
    <h3 style="color:${tonos.base};margin:16px 0 8px;">Daños propios</h3>
    <p style="color:#334155;background:#f8fafc;padding:12px;border-radius:6px;">${sanitizeText(a.danos_propios)}</p>
  ` : ''

  const seccionHogar = a.esHogar && (a.tipo_vivienda || a.que_paso || a.ambiente_afectado || a.causa_siniestro) ? `
    <h3 style="color:${tonos.base};margin:16px 0 8px;">Inmueble</h3>
    <table style="width:100%;border-collapse:collapse;">
      ${row('Tipo de vivienda', a.tipo_vivienda)}
      ${row('¿Qué pasó?', a.que_paso, true)}
      ${row('Ambiente', a.ambiente_afectado)}
      ${row('Causa', a.causa_siniestro, true)}
    </table>
  ` : ''

  const seccionTestigos = a.hubo_testigos && a.testigos.length > 0 ? `
    <h3 style="color:${tonos.base};margin:16px 0 8px;">Testigos</h3>
    <table style="width:100%;border-collapse:collapse;">
      ${a.testigos.map((t, i) => row(`Testigo ${i + 1}`, `${t.nombre}${t.telefono ? ' · ' + t.telefono : ''}`, i % 2 === 1)).join('')}
    </table>
  ` : ''

  const seccionDenunciaPolicial = a.denuncia_policial ? `
    <p style="color:#334155;margin-top:12px;"><strong>Denuncia policial:</strong> ${a.denuncia_policial === 'si' ? 'Sí' : 'No'}${a.acta_policial ? ` (acta ${sanitizeText(a.acta_policial)})` : ''}</p>
  ` : ''

  const seccionArchivos = a.archivosInfo.length > 0 ? `
    <h3 style="color:${tonos.base};margin:16px 0 8px;">Archivos adjuntos</h3>
    <p style="color:#64748b;font-size:13px;">${a.archivosInfo.length} archivo(s). Ubicación: <code>storage/siniestros/${a.numeroCaso}/documentacion/</code></p>
    <ul style="color:#475569;font-size:13px;margin:0;padding-left:20px;">
      ${Object.entries(archivosPorCategoria).map(([cat, n]) => `<li>${cat}: ${n}</li>`).join('')}
    </ul>
  ` : ''

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:${tonos.base};color:${tonos.textoSobreColor};padding:20px 24px;border-radius:8px 8px 0 0;">
        <h1 style="margin:0;font-size:20px;">Nueva Denuncia de Siniestro</h1>
        <p style="margin:6px 0 0;color:#94a3b8;font-size:14px;">Caso ${a.numeroCaso}</p>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
        <p style="color:#334155;">Se recibió una nueva denuncia de siniestro a través del formulario público.</p>

        <h3 style="color:${tonos.base};margin:16px 0 8px;">Asegurado</h3>
        <table style="width:100%;border-collapse:collapse;">
          ${row('Nombre', `${a.persona.apellido}, ${a.persona.nombre || ''}`)}
          ${row('DNI', a.persona.dni_cuil, true)}
          ${row('Email', a.email)}
          ${row('Teléfono', a.telefono || a.persona.telefono || '—', true)}
        </table>

        <h3 style="color:${tonos.base};margin:16px 0 8px;">Póliza</h3>
        <table style="width:100%;border-collapse:collapse;">
          ${row('Número', a.poliza.numero_poliza)}
          ${row('Compañía', a.companiaNombre, true)}
          ${row('Ramo', a.ramoNombre)}
        </table>

        <h3 style="color:${tonos.base};margin:16px 0 8px;">Siniestro</h3>
        <table style="width:100%;border-collapse:collapse;">
          ${row('Tipo', a.tipo_siniestro || '—')}
          ${row('Fecha', a.fecha_siniestro, true)}
          ${row('Hora', a.hora_siniestro || '—')}
          ${row('Lugar', a.lugar_siniestro || '—', true)}
          ${row('Localidad', a.localidad_siniestro || '—')}
        </table>

        <h3 style="color:${tonos.base};margin:16px 0 8px;">Descripción</h3>
        <p style="color:#334155;background:#f8fafc;padding:12px;border-radius:6px;">${sanitizeText(a.descripcion)}</p>

        ${seccionConductor}
        ${seccionDanos}
        ${seccionTercero}
        ${seccionLesionados}
        ${seccionTestigos}
        ${seccionHogar}
        ${seccionDenunciaPolicial}
        ${seccionArchivos}

        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">
        <p style="color:#94a3b8;font-size:12px;">IP: ${a.ip} — Registrado el ${new Date().toLocaleString('es-AR')}</p>
      </div>
    </div>`
}
