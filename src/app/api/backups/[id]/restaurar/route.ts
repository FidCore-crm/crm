import { NextRequest, NextResponse } from 'next/server'
import { obtenerUsuarioDesdeRequest } from '@/lib/auth'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'

const execAsync = promisify(exec)
const BACKUP_BASE = '/var/backups/crm-seguros'

// POST — Restaurar un backup
export async function POST(
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

  // Validar confirmacion en el body
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body invalido' }, { status: 400 })
  }

  if (body?.confirmacion !== 'RESTAURAR') {
    return NextResponse.json(
      { ok: false, error: 'Debes enviar { "confirmacion": "RESTAURAR" } para confirmar la operacion.' },
      { status: 400 }
    )
  }

  const supabase = getSupabaseAdmin()

  const { data: backup, error } = await supabase
    .from('backups')
    .select('nombre')
    .eq('id', id)
    .single()

  if (error || !backup) {
    return NextResponse.json({ ok: false, error: 'Backup no encontrado' }, { status: 404 })
  }

  const nombre = (backup as any).nombre
  if (!nombre || nombre.includes('..') || nombre.includes('/')) {
    return NextResponse.json({ ok: false, error: 'Nombre de backup invalido' }, { status: 400 })
  }

  const backupDir = path.join(BACKUP_BASE, nombre)
  try {
    await fs.access(backupDir)
  } catch {
    return NextResponse.json(
      { ok: false, error: 'El backup no existe en disco. No se puede restaurar.' },
      { status: 404 }
    )
  }

  // ADVERTENCIA: esta operacion reinicia el servicio, el cliente puede perder la conexion
  try {
    // Modo de ejecución: si estamos en Docker hablamos con Postgres por TCP y
    // el "restart" se hace con process.exit(0) confiando en restart:unless-stopped.
    // En host legacy seguimos usando docker exec + systemctl.
    const enDocker = process.env.RUNNING_IN_DOCKER === 'true'

    const dbDropAndRestore = enDocker
      ? `gunzip -c "$BACKUP_DIR/database.sql.gz" | PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>/dev/null || true
      gunzip -c "$BACKUP_DIR/database.sql.gz" | PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB"`
      : `gunzip -c "$BACKUP_DIR/database.sql.gz" | docker exec -i supabase-db psql -U postgres postgres -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>/dev/null || true
      gunzip -c "$BACKUP_DIR/database.sql.gz" | docker exec -i supabase-db psql -U postgres postgres`

    // El restart real se hace después: en Docker via process.exit, en host via systemctl
    const restartCmd = enDocker
      ? `# Docker: el container va a salir y restart:unless-stopped lo levanta de nuevo.
         # Lo manejamos desde Node con process.exit, no desde el script bash.
         echo 'Restore script terminado, esperando que Node se reinicie.'`
      : `sudo systemctl restart crm-seguros`

    const restoreScript = `
      set -e
      BACKUP_DIR="${backupDir}"
      PROJECT_DIR="${process.cwd()}"
      SCRIPTS_DIR="${path.join(process.cwd(), 'scripts')}"

      # 1. Backup pre-restore
      bash "$SCRIPTS_DIR/backup-now.sh" --tipo=PRE_RESTORE

      # 2. Restaurar DB
      ${dbDropAndRestore}

      # 3. Restaurar storage
      if [ -d "$PROJECT_DIR/storage" ]; then
        mv "$PROJECT_DIR/storage" "$PROJECT_DIR/storage.pre-restore.$(date +%s)"
      fi
      tar -xzf "$BACKUP_DIR/storage.tar.gz" -C "$PROJECT_DIR"

      # 4. Reiniciar servicio
      ${restartCmd}
    `

    // Lanzar en background porque el restart va a matar este proceso
    execAsync(`bash -c '${restoreScript.replace(/'/g, "'\\''")}'`, {
      timeout: 10 * 60 * 1000
    }).then(() => {
      // En Docker, el bash terminó pero el proceso Node sigue vivo.
      // Forzamos exit para que Docker reinicie (pool de conexiones tiene
      // metadata desactualizada del schema viejo).
      if (enDocker) {
        setTimeout(() => process.exit(0), 1000)
      }
    }).catch(() => {
      // Es esperable que falle si systemctl mata el proceso (modo host).
    })

    // Responder inmediatamente antes de que el restart nos mate
    return NextResponse.json({
      ok: true,
      mensaje: 'Restauracion iniciada. El servicio se va a reiniciar. Puede que pierdas la conexion momentaneamente.'
    })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error al iniciar la restauracion' },
      { status: 500 }
    )
  }
}
