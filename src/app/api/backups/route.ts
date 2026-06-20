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

// POST — Ejecutar backup manual (fire-and-forget para evitar timeouts del edge)
//
// El backup puede tardar varios minutos (pg_dump + tar de storage + verificación
// + sync opcional a Drive). Si esperamos sincrónicamente, Cloudflare Tunnel
// corta la conexión a los 100s con un 524 aunque el backup esté terminando OK
// en el server. La solución: arrancamos el backup en background y devolvemos
// 202 inmediatamente. El frontend hace polling al historial y muestra el
// resultado cuando el `ejecutarBackup` deja el row en estado COMPLETADO/FALLIDO.
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

  // Disparar el backup en background sin await. Cualquier excepción se loggea
  // pero no rompe la respuesta — el row de `backups` queda en FALLIDO si algo
  // sale mal y el frontend lo detecta vía el polling normal del historial.
  ejecutarBackup({
    tipo: 'MANUAL',
    usuario_id: usuario.id,
  }).catch((err) => {
    // Solo loggear — el error ya quedó persistido en la tabla `backups` por
    // ejecutarBackup, así que el frontend lo va a ver.
    console.error('[POST /api/backups] Error en ejecución background:', err)
  })

  return NextResponse.json(
    {
      ok: true,
      data: { iniciado: true, mensaje: 'Backup iniciado. Va a aparecer en el historial en unos minutos.' },
    },
    { status: 202 }
  )
}
