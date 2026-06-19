import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { validarArchivoCrmbak } from '@/lib/backup-restore'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import fs from 'fs/promises'
import { createWriteStream } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import path from 'path'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TMP_BASE = '/tmp/crm-restauraciones'

/**
 * POST — Pre-validación de un archivo .crmbak SIN ejecutar restauración.
 *
 * Dos modos:
 *  - multipart/form-data con `archivo` → valida archivo subido
 *  - application/json con `{ backup_id }` → valida backup existente
 */
export async function POST(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  if (usuario.rol !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Acceso denegado' }, { status: 403 })
  }

  const contentType = request.headers.get('content-type') || ''
  const supabase = getSupabaseAdmin()

  // Modo JSON: validar un backup existente
  if (contentType.includes('application/json')) {
    const body = await request.json().catch(() => null)
    if (!body?.backup_id) {
      return NextResponse.json({ ok: false, error: 'backup_id requerido' }, { status: 400 })
    }

    const { data: b } = await supabase
      .from('backups')
      .select('nombre, archivo_unico_path')
      .eq('id', body.backup_id)
      .single()
    if (!b) {
      return NextResponse.json({ ok: false, error: 'Backup no encontrado' }, { status: 404 })
    }

    const archivoPath = (b as any).archivo_unico_path
    if (!archivoPath) {
      return NextResponse.json({ ok: false, error: 'Backup sin archivo en disco' }, { status: 404 })
    }

    const validacion = await validarArchivoCrmbak(archivoPath)
    return NextResponse.json(validacion)
  }

  // Modo multipart: archivo subido
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ ok: false, error: 'Content-Type inválido' }, { status: 400 })
  }

  let formData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ ok: false, error: 'Error parseando formData' }, { status: 400 })
  }

  const file = formData.get('archivo') as File | null
  if (!file) {
    return NextResponse.json({ ok: false, error: 'archivo requerido' }, { status: 400 })
  }
  if (!file.name.endsWith('.crmbak')) {
    return NextResponse.json({ ok: false, error: 'Solo archivos .crmbak' }, { status: 400 })
  }

  const tmpDir = path.join(TMP_BASE, `validar-${crypto.randomUUID()}`)
  await fs.mkdir(tmpDir, { recursive: true })
  const archivoPath = path.join(tmpDir, file.name)

  try {
    const webStream = file.stream()
    const nodeStream = Readable.fromWeb(webStream as any)
    await pipeline(nodeStream, createWriteStream(archivoPath))

    const validacion = await validarArchivoCrmbak(archivoPath)
    return NextResponse.json(validacion)
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Error validando' }, { status: 500 })
  } finally {
    try { await fs.rm(tmpDir, { recursive: true, force: true }) } catch {
      // Silenciado: archivo/recurso puede no existir
    }
  }
}
