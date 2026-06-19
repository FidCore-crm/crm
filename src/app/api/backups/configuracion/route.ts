import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { verificarRcloneDisponible } from '@/lib/backup-runner'

// GET — Obtener configuracion del sistema de backups
export async function GET(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }
  if (usuario.rol !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Acceso denegado. Solo administradores.' }, { status: 403 })
  }

  const supabase = getSupabaseAdmin()

  const { data: configuracion, error } = await supabase
    .from('configuracion_backups')
    .select('*')
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ ok: false, error: 'Error al obtener los datos' }, { status: 500 })
  }

  const rclone = await verificarRcloneDisponible()

  return NextResponse.json({
    ok: true,
    configuracion,
    rclone
  })
}

// PATCH — Actualizar configuracion
export async function PATCH(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }
  if (usuario.rol !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Acceso denegado. Solo administradores.' }, { status: 403 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body invalido' }, { status: 400 })
  }

  // Si se activa sync remoto, verificar que rclone este disponible
  if (body.sync_remoto_activo === true) {
    const rclone = await verificarRcloneDisponible()
    if (!rclone.instalado) {
      return NextResponse.json({
        ok: false,
        error: 'rclone no esta instalado. Contacta al administrador del sistema para instalarlo.'
      }, { status: 400 })
    }
    const remoteName = body.remote_nombre || 'gdrive'
    if (!rclone.remotes.includes(remoteName)) {
      return NextResponse.json({
        ok: false,
        error: `El remote '${remoteName}' no esta configurado en rclone. Contacta al administrador del sistema para configurarlo.`
      }, { status: 400 })
    }
  }

  // Campos permitidos
  const camposPermitidos = [
    'activo', 'retener_diarios', 'retener_semanales', 'retener_mensuales',
    'sync_remoto_activo', 'remote_nombre', 'carpeta_remota', 'hora_backup',
    'notificar_exito', 'notificar_fallos'
  ]

  const update: Record<string, any> = {}
  for (const campo of camposPermitidos) {
    if (body[campo] !== undefined) {
      update[campo] = body[campo]
    }
  }

  const supabase = getSupabaseAdmin()

  // Obtener el ID del singleton
  const { data: existing } = await supabase
    .from('configuracion_backups')
    .select('id')
    .limit(1)
    .maybeSingle()

  if (!existing) {
    // Crear si no existe
    const { data, error } = await supabase
      .from('configuracion_backups')
      .insert({ ...update })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ ok: false, error: 'Error al guardar los datos' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, configuracion: data })
  }

  const { data, error } = await supabase
    .from('configuracion_backups')
    .update(update)
    .eq('id', (existing as any).id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ ok: false, error: 'Error al actualizar los datos' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, configuracion: data })
}
