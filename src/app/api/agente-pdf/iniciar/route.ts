import { NextResponse } from 'next/server'
import path from 'path'
import { mkdir, writeFile, unlink } from 'fs/promises'
import { randomUUID } from 'crypto'
import { requireAuth, requireOwnership } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { checkModuloPDFActivo } from '@/lib/agente-pdf/check-modulo-activo'
import { procesarPDFAsync } from '@/lib/agente-pdf/procesador'
import { limpiarTemporalesAntiguosSinBloquear } from '@/lib/limpieza-temporales'
import type { TipoOperacionPDF } from '@/lib/agente-pdf/types'
import { logger } from '@/lib/errores'
import { checkLicenciaActiva } from '@/lib/licencia-guard'

const MAX_SIZE = 20 * 1024 * 1024 // 20 MB
const TEMP_ROOT = path.join(process.cwd(), 'tmp', 'pdf-procesamientos')

function sanitizeName(name: string): string {
  const limpio = name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 200)
  // Defensa final: rechazar si contiene separadores (no debería después del
  // reemplazo anterior) o quedó vacío.
  if (!limpio || /[/\\\0]/.test(limpio)) return 'archivo.pdf'
  return limpio
}

export async function POST(request: Request) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo

  // Limpieza oportunista de temporales antiguos (fire-and-forget)
  limpiarTemporalesAntiguosSinBloquear().catch((err) =>
    logger.warn({ modulo: 'agente-pdf', mensaje: 'Limpieza oportunista falló', contexto: { error: String(err) } }),
  )

  const estadoModulo = await checkModuloPDFActivo()
  if (!estadoModulo.activo) {
    return NextResponse.json(
      { ok: false, error: estadoModulo.motivo || 'Módulo IA desactivado' },
      { status: 403 }
    )
  }

  const formData = await request.formData()
  const archivo = formData.get('archivo') as File | null
  const tipoOperacion = formData.get('tipo_operacion') as TipoOperacionPDF | null
  const polizaOrigenId = formData.get('poliza_origen_id') as string | null

  if (!archivo) {
    return NextResponse.json({ ok: false, error: 'Falta el archivo' }, { status: 400 })
  }
  if (!tipoOperacion || !['POLIZA_NUEVA', 'RENOVACION', 'ENDOSO'].includes(tipoOperacion)) {
    return NextResponse.json({ ok: false, error: 'tipo_operacion inválido' }, { status: 400 })
  }
  if ((tipoOperacion === 'RENOVACION' || tipoOperacion === 'ENDOSO') && !polizaOrigenId) {
    return NextResponse.json(
      { ok: false, error: 'poliza_origen_id es obligatorio para renovación o endoso' },
      { status: 400 }
    )
  }
  if (archivo.size > MAX_SIZE) {
    return NextResponse.json({ ok: false, error: 'El PDF excede el límite de 20MB' }, { status: 400 })
  }
  if (archivo.size === 0) {
    return NextResponse.json({ ok: false, error: 'El archivo está vacío' }, { status: 400 })
  }
  if (!/pdf/i.test(archivo.type) && !archivo.name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ ok: false, error: 'Solo se aceptan archivos PDF' }, { status: 400 })
  }

  // Leer el archivo a buffer (necesario para validar magic bytes y para
  // persistirlo después)
  const buffer = Buffer.from(await archivo.arrayBuffer())

  // Validación de magic bytes: un PDF real empieza con "%PDF-"
  // Protege contra extensiones/MIME spoofeadas.
  if (buffer.length < 5 || buffer.slice(0, 5).toString('utf8') !== '%PDF-') {
    return NextResponse.json(
      { ok: false, error: 'El archivo no es un PDF válido (firma inesperada).' },
      { status: 400 },
    )
  }

  const supabase = getSupabaseAdmin()

  // Si es renovación/endoso, validar que la póliza exista Y que el usuario
  // sea dueño del recurso (via asegurado.usuario_id). Un usuario PROPIA no
  // debe poder iniciar renovación/endoso de una póliza de otro PAS.
  if (polizaOrigenId) {
    const { data: polOrigen } = await supabase
      .from('polizas')
      .select('id, asegurado:personas!asegurado_id (usuario_id)')
      .eq('id', polizaOrigenId)
      .maybeSingle()
    if (!polOrigen) {
      return NextResponse.json({ ok: false, error: 'Póliza origen no encontrada' }, { status: 404 })
    }
    const owns = requireOwnership(usuario, {
      usuario_id: (polOrigen as any).asegurado?.usuario_id ?? null,
    })
    if (owns) return owns
  }

  // Guardar archivo temporal
  const procesamientoId = randomUUID()
  await mkdir(TEMP_ROOT, { recursive: true })
  const nombreSan = sanitizeName(archivo.name)
  const rutaTemporal = path.join(TEMP_ROOT, `${procesamientoId}_${nombreSan}`)
  // Validación extra de traversal — TEMP_ROOT ya fue resuelto, la ruta final
  // debe seguir estando dentro. Si `nombreSan` es manipulado de alguna forma
  // que genere `..`, rechazamos.
  const tempRootResolved = path.resolve(TEMP_ROOT)
  const rutaTemporalResolved = path.resolve(rutaTemporal)
  if (!rutaTemporalResolved.startsWith(tempRootResolved + path.sep)) {
    return NextResponse.json(
      { ok: false, error: 'Nombre de archivo inválido' },
      { status: 400 },
    )
  }
  await writeFile(rutaTemporal, buffer)

  // Insertar fila
  const { data: creado, error } = await supabase
    .from('pdf_procesamientos')
    .insert({
      id: procesamientoId,
      tipo_operacion: tipoOperacion,
      poliza_origen_id: polizaOrigenId,
      estado: 'PENDIENTE',
      nombre_archivo: archivo.name,
      tamano_archivo: archivo.size,
      ruta_temporal: rutaTemporal,
      usuario_id: usuario.id,
    } as any)
    .select('id')
    .single()

  if (error || !creado) {
    // Limpiar archivo temporal si no pudimos crear la fila
    try { await unlink(rutaTemporal) } catch (unlinkErr) {
      logger.warn({
        modulo: 'agente-pdf',
        mensaje: 'No se pudo borrar temporal tras fallar el INSERT de pdf_procesamientos',
        contexto: { ruta: rutaTemporal, error: String(unlinkErr) },
      })
    }
    return NextResponse.json(
      { ok: false, error: error?.message || 'No se pudo crear el procesamiento' },
      { status: 500 }
    )
  }

  // Disparar async (fire-and-forget)
  procesarPDFAsync(procesamientoId).catch(err => {
    logger.error({ modulo: 'agente-pdf', mensaje: 'Error en procesamiento async', contexto: { procesamiento_id: procesamientoId, error: String(err) } })
  })

  return NextResponse.json({ ok: true, procesamiento_id: procesamientoId })
}
