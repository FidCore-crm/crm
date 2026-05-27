import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { isAnthropicConfigured } from '@/lib/anthropic-client'
import { encolarJob } from '@/lib/importacion/job-runner'
import { checkLicenciaActiva } from '@/lib/licencia-guard'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'

export const dynamic = 'force-dynamic'

const MAX_ARCHIVOS = 10
const MAX_BYTES = 50 * 1024 * 1024

const EXT_VALIDAS = new Set(['xlsx', 'xls', 'csv', 'pdf'])
const MIME_VALIDOS = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'application/pdf',
  'application/octet-stream', // algunos navegadores no detectan
])

function extOk(nombre: string): boolean {
  const ext = nombre.toLowerCase().split('.').pop() ?? ''
  return EXT_VALIDAS.has(ext)
}

const STORAGE_ROOT = path.resolve(process.cwd(), 'storage', 'importaciones')

export async function POST(request: Request) {
  const bloqueo = await checkLicenciaActiva()
  if (bloqueo) return bloqueo
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth
  const usuario = auth

  // Solo admin: el importador masivo crea personas y pólizas para toda la
  // cartera del PAS. Un USUARIO común no debe disparar importaciones.
  if (usuario.rol !== 'ADMIN') {
    return NextResponse.json(
      { ok: false, error: 'Solo el administrador puede importar cartera.' },
      { status: 403 },
    )
  }

  if (!(await isAnthropicConfigured())) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'La API key de Claude no está configurada. Configurala en /crm/configuracion/agente-ia.',
      },
      { status: 400 }
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Formato de request inválido (se espera multipart/form-data)' },
      { status: 400 }
    )
  }

  const archivos = formData.getAll('archivos').filter((v): v is File => v instanceof File)
  if (archivos.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'Debés adjuntar al menos un archivo en el campo "archivos"' },
      { status: 400 }
    )
  }
  if (archivos.length > MAX_ARCHIVOS) {
    return NextResponse.json(
      { ok: false, error: `Máximo ${MAX_ARCHIVOS} archivos por importación` },
      { status: 400 }
    )
  }

  for (const f of archivos) {
    if (f.size > MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: `El archivo "${f.name}" supera los 50 MB permitidos` },
        { status: 400 }
      )
    }
    if (!extOk(f.name)) {
      return NextResponse.json(
        { ok: false, error: `Extensión no soportada en "${f.name}". Permitidas: xlsx, xls, csv, pdf` },
        { status: 400 }
      )
    }
    if (f.type && !MIME_VALIDOS.has(f.type)) {
      // no bloqueamos si mime es "raro" pero la extensión es válida
    }
  }

  const tipo = (formData.get('tipo') as string) || 'INICIAL'
  if (!['INICIAL', 'INCREMENTAL'].includes(tipo)) {
    return NextResponse.json({ ok: false, error: 'tipo inválido' }, { status: 400 })
  }
  const compania_id = (formData.get('compania_id') as string) || null
  const notas = (formData.get('notas') as string) || null

  const supabase = getSupabaseAdmin()

  const primerNombre = archivos[0].name
  const nombreResumen =
    archivos.length === 1 ? primerNombre : `${primerNombre} (+${archivos.length - 1})`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: importacion, error: errInsert } = await (supabase.from('importaciones') as any)
    .insert({
      usuario_id: usuario.id,
      tipo,
      compania_id,
      nombre_archivo: nombreResumen,
      estado_proceso: 'PENDIENTE',
      notas,
      fecha_inicio: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (errInsert || !importacion) {
    return NextResponse.json(
      { ok: false, error: errInsert?.message ?? 'No se pudo crear la importación' },
      { status: 500 }
    )
  }

  const importacion_id = (importacion as { id: string }).id
  const carpeta = path.join(STORAGE_ROOT, importacion_id)

  try {
    await fs.mkdir(carpeta, { recursive: true })
  } catch (e) {
    const msg = (e as { message?: string })?.message || 'desconocido'
    return NextResponse.json(
      { ok: false, error: `No se pudo crear carpeta de almacenamiento: ${msg}` },
      { status: 500 }
    )
  }

  const metadata: Array<{
    nombre: string
    size_bytes: number
    mime_type: string
    hash: string
    ruta_storage: string
  }> = []

  try {
    for (const f of archivos) {
      const buffer = Buffer.from(await f.arrayBuffer())
      const hash = crypto.createHash('sha256').update(buffer).digest('hex')
      // Sanitizar nombre
      const safeName = path.basename(f.name).replace(/[^\w.\-]+/g, '_')
      const ruta = path.join(carpeta, safeName)
      await fs.writeFile(ruta, buffer)
      metadata.push({
        nombre: safeName,
        size_bytes: f.size,
        mime_type: f.type || 'application/octet-stream',
        hash,
        ruta_storage: `importaciones/${importacion_id}/${safeName}`,
      })
    }
  } catch (e) {
    const msg = (e as { message?: string })?.message || 'desconocido'
    // rollback: borrar registro y carpeta
    await fs.rm(carpeta, { recursive: true, force: true }).catch(() => {
      // Rollback best-effort: si la carpeta no se puede borrar acá, la borrará el cron de limpieza
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('importaciones') as any).delete().eq('id', importacion_id)
    return NextResponse.json(
      { ok: false, error: `Error guardando archivos: ${msg}` },
      { status: 500 }
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('importaciones') as any)
    .update({ archivos_metadata: metadata })
    .eq('id', importacion_id)

  try {
    await encolarJob({
      importacion_id,
      tipo: 'ANALISIS_ESTRUCTURAL',
      payload: {},
    })
  } catch (e) {
    const msg = (e as { message?: string })?.message || 'desconocido'
    return NextResponse.json(
      { ok: false, error: `No se pudo encolar el job: ${msg}` },
      { status: 500 }
    )
  }

  // Trigger inmediato del runner (fire-and-forget). El runner systemd podría no
  // estar instalado; este trigger asegura que el análisis arranque de inmediato
  // en lugar de esperar al próximo tick del cron.
  try {
    const { ejecutarJobsPendientes } = await import('@/lib/importacion/job-runner')
    const { logger } = await import('@/lib/errores/logger')
    ejecutarJobsPendientes().catch((err) => {
      logger.warn({ modulo: 'importar', mensaje: 'Error ejecutando jobs pendientes tras /iniciar', contexto: { importacion_id, error: String(err) } })
    })
  } catch {
    // no crítico
  }

  return NextResponse.json({
    ok: true,
    importacion_id,
    estado: 'PENDIENTE',
  })
}
