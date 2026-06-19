import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { iniciarRestauracion, type OpcionesRestauracion } from '@/lib/backup-restore'
import fs from 'fs/promises'
import { createWriteStream } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import path from 'path'
import crypto from 'crypto'
import { logger } from '@/lib/errores'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RESTORE_TMP_BASE = '/tmp/crm-restauraciones'
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024 // 5 GB

// POST — Inicia una restauración. Dos modos:
//   1) multipart/form-data: archivo + opciones  → fuente ARCHIVO_SUBIDO
//   2) application/json:    { backup_id, opciones } → fuente BACKUP_EXISTENTE
export async function POST(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  if (usuario.rol !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Acceso denegado. Solo administradores.' }, { status: 403 })
  }

  const contentType = request.headers.get('content-type') || ''
  const ip = request.headers.get('x-forwarded-for') || null
  const ua = request.headers.get('user-agent') || null

  // Modo JSON: backup existente
  if (contentType.includes('application/json')) {
    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
    }
    const { backup_id, opciones } = body
    if (!backup_id) {
      return NextResponse.json({ ok: false, error: 'backup_id requerido' }, { status: 400 })
    }
    if (!opciones) {
      return NextResponse.json({ ok: false, error: 'opciones requeridas' }, { status: 400 })
    }
    const result = await iniciarRestauracion({
      fuente: 'BACKUP_EXISTENTE',
      backup_id,
      opciones: normalizarOpciones(opciones),
      usuario_id: usuario.id,
      ip_origen: ip || undefined,
      user_agent: ua || undefined,
    })
    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  }

  // Modo multipart: archivo subido
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ ok: false, error: 'Content-Type inválido' }, { status: 400 })
  }

  let formData
  try {
    formData = await request.formData()
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'Error parseando formData: ' + err?.message }, { status: 400 })
  }

  const file = formData.get('archivo') as File | null
  const opcionesRaw = formData.get('opciones') as string | null

  if (!file || !opcionesRaw) {
    return NextResponse.json({ ok: false, error: 'archivo y opciones requeridos' }, { status: 400 })
  }
  if (!file.name.endsWith('.crmbak')) {
    return NextResponse.json({ ok: false, error: 'Solo se aceptan archivos .crmbak' }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: 'Archivo excede el límite de 5 GB' }, { status: 413 })
  }

  let opciones: OpcionesRestauracion
  try {
    opciones = normalizarOpciones(JSON.parse(opcionesRaw))
  } catch {
    return NextResponse.json({ ok: false, error: 'opciones JSON inválido' }, { status: 400 })
  }

  const tmpDir = path.join(RESTORE_TMP_BASE, `upload-${crypto.randomUUID()}`)
  await fs.mkdir(tmpDir, { recursive: true })
  const archivoPath = path.join(tmpDir, file.name)

  try {
    const webStream = file.stream()
    const nodeStream = Readable.fromWeb(webStream as any)
    await pipeline(nodeStream, createWriteStream(archivoPath))
  } catch (err: any) {
    try { await fs.rm(tmpDir, { recursive: true, force: true }) } catch (rmErr) {
      // No crítico: limpieza de carpeta temporal tras fallo de upload
      logger.warn({ modulo: 'backups', mensaje: 'Error limpiando carpeta temporal tras fallo de upload', contexto: { tmpDir, error: String(rmErr) } })
    }
    return NextResponse.json({ ok: false, error: 'Error guardando el archivo: ' + err?.message }, { status: 500 })
  }

  const result = await iniciarRestauracion({
    fuente: 'ARCHIVO_SUBIDO',
    archivo_path: archivoPath,
    nombre_archivo: file.name,
    tamano_archivo_bytes: file.size,
    opciones,
    usuario_id: usuario.id,
    ip_origen: ip || undefined,
    user_agent: ua || undefined,
  })

  if (!result.ok) {
    try { await fs.rm(tmpDir, { recursive: true, force: true }) } catch (rmErr) {
      // No crítico: limpieza de carpeta temporal tras fallo de restauración
      logger.warn({ modulo: 'backups', mensaje: 'Error limpiando carpeta temporal tras fallo de restauración', contexto: { tmpDir, error: String(rmErr) } })
    }
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}

function normalizarOpciones(raw: any): OpcionesRestauracion {
  return {
    restaurar_db: !!raw.restaurar_db,
    restaurar_storage: !!raw.restaurar_storage,
    crear_pre_backup: raw.crear_pre_backup !== false,
  }
}
