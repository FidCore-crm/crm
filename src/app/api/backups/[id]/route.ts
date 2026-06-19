import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import fs from 'fs/promises'
import path from 'path'
import { logger } from '@/lib/errores'

const BACKUP_BASE = '/var/backups/crm-seguros'

// GET — Obtener detalle de un backup
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }
  if (usuario.rol !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Acceso denegado. Solo administradores.' }, { status: 403 })
  }

  const { id } = await params
  const supabase = getSupabaseAdmin()

  const { data: backup, error } = await supabase
    .from('backups')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !backup) {
    return NextResponse.json({ ok: false, error: 'Backup no encontrado' }, { status: 404 })
  }

  // Verificar existencia en disco
  let existeEnDisco = false
  if ((backup as any).nombre) {
    try {
      await fs.access(path.join(BACKUP_BASE, (backup as any).nombre))
      existeEnDisco = true
    } catch {
      // Silenciado: archivo/recurso puede no existir
    }
  }

  return NextResponse.json({
    ok: true,
    backup: { ...backup, existe_en_disco: existeEnDisco }
  })
}

// DELETE — Eliminar un backup
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }
  if (usuario.rol !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Acceso denegado. Solo administradores.' }, { status: 403 })
  }

  const { id } = await params
  const supabase = getSupabaseAdmin()

  const { data: backup, error } = await supabase
    .from('backups')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !backup) {
    return NextResponse.json({ ok: false, error: 'Backup no encontrado' }, { status: 404 })
  }

  // Eliminar carpeta del filesystem
  const nombre = (backup as any).nombre
  if (nombre && !nombre.includes('..') && !nombre.includes('/')) {
    const backupDir = path.join(BACKUP_BASE, nombre)
    try {
      await fs.rm(backupDir, { recursive: true, force: true })
    } catch (err) {
      // No crítico: la carpeta del backup puede no existir en disco
      logger.warn({ modulo: 'backups', mensaje: 'Error eliminando carpeta de backup del disco', contexto: { backupDir, error: String(err) } })
    }
  }

  // Eliminar registro de la DB
  await supabase.from('backups').delete().eq('id', id)

  return NextResponse.json({ ok: true })
}
