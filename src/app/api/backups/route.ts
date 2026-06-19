import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { ejecutarBackup, listarBackupsLocales } from '@/lib/backup-runner'
import { ERRORES, respuestaError } from '@/lib/errores'

// GET — Listar backups
export async function GET(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }
  if (usuario.rol !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Acceso denegado. Solo administradores.' }, { status: 403 })
  }

  const supabase = getSupabaseAdmin()

  // Obtener backups de la DB (ultimos 50)
  const { data: backupsDB, error } = await supabase
    .from('backups')
    .select('*')
    .order('fecha_inicio', { ascending: false })
    .limit(50)

  if (error) {
    return respuestaError(ERRORES.DB_ERROR_ESCRITURA, { detalle: error.message })
  }

  // Obtener backups locales del filesystem
  const backupsLocales = await listarBackupsLocales()

  // Crear un set de nombres locales para marcar existencia
  const nombresLocales = new Set(backupsLocales.map(b => b.nombre))

  // Enriquecer los registros de DB con info de existencia en disco
  const backups = (backupsDB ?? []).map((b: any) => ({
    ...b,
    existe_en_disco: nombresLocales.has(b.nombre),
    tamano_disco: backupsLocales.find(l => l.nombre === b.nombre)?.tamano_bytes || null
  }))

  return NextResponse.json({
    ok: true,
    backups,
    total_local: backupsLocales.length
  })
}

// POST — Ejecutar backup manual
export async function POST(request: NextRequest) {
  const usuario = await obtenerUsuarioDesdeRequest(request)
  if (!usuario) {
    return NextResponse.json({ ok: false, error: 'No autenticado' }, { status: 401 })
  }
  if (usuario.rol !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Acceso denegado. Solo administradores.' }, { status: 403 })
  }

  const supabase = getSupabaseAdmin()

  // Verificar que no haya un backup en curso
  const { data: enCurso } = await supabase
    .from('backups')
    .select('id')
    .eq('estado', 'EN_PROCESO')
    .limit(1)
    .maybeSingle()

  if (enCurso) {
    return respuestaError(ERRORES.NEG_OPERACION_INVALIDA, {
      detalle: 'Ya hay un backup en curso. Esperá a que termine.',
    })
  }

  const result = await ejecutarBackup({
    tipo: 'MANUAL',
    usuario_id: usuario.id,
  })

  if (result.ok) {
    return NextResponse.json({ ok: true, data: result })
  }

  // El backup falló realmente. 503 (servicio no disponible) es más preciso
  // que 500 para un fallo de ejecución de script externo.
  return respuestaError(ERRORES.EXT_STORAGE_NO_DISPONIBLE, {
    detalle: result.error || 'Error ejecutando el backup',
  })
}
