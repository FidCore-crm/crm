# Scripts de administración del CRM

Scripts de emergencia para resetear contraseñas y crear administradores.
Solo se ejecutan desde el servidor con acceso SSH.

## Cómo ejecutar

Desde la raíz del proyecto:
```bash
cd /opt/crm-fidcore
node scripts/<script>.js [argumentos]
```

## Scripts disponibles

### list-admins.js
Lista todos los administradores del sistema.
```bash
node scripts/list-admins.js
```

### reset-admin-password.js
Resetea la contraseña de un administrador existente.
```bash
node scripts/reset-admin-password.js <email> <nueva-contraseña>
```

Ejemplo:
```bash
node scripts/reset-admin-password.js admin@example.com nueva123
```

Esto:
- Cambia la contraseña al valor indicado
- Resetea los intentos fallidos
- Desbloquea al usuario si estaba bloqueado
- Cierra todas las sesiones activas del usuario

### create-emergency-admin.js
Crea un nuevo administrador desde cero. Solo usar si NO hay ningún admin en el sistema.
```bash
node scripts/create-emergency-admin.js <email> <nombre> <apellido> <contraseña>
```

Ejemplo:
```bash
node scripts/create-emergency-admin.js admin@example.com Juan Perez admin123
```

## Casos de uso

**Olvidé la contraseña del único admin:**
```bash
node scripts/list-admins.js
node scripts/reset-admin-password.js <email> nueva-contraseña
```

**Borré el único admin por error:**
```bash
node scripts/create-emergency-admin.js admin@example.com Juan Perez admin123
```

**Quiero ver qué admins tengo:**
```bash
node scripts/list-admins.js
```

## Scripts de backup

### backup-now.sh
Crea un backup completo del CRM (base de datos + archivos).

```bash
./scripts/backup-now.sh [--tipo=manual|automatico]
```

### backup-list.sh
Lista todos los backups disponibles con fecha, tamaño y tipo.

```bash
./scripts/backup-list.sh
```

### backup-restore.sh
Restaura un backup específico. Requiere confirmación explícita.

```bash
./scripts/backup-restore.sh backup-2026-04-07_04-00-00
```

**Importante**: la restauración sobrescribe completamente la base de datos y los archivos actuales. Antes de restaurar se crea automáticamente un backup de seguridad del estado actual.

### backup-rotate.sh
Aplica la política de rotación (7 diarios + 4 semanales + 6 mensuales).
Se llama automáticamente desde backup-now.sh. También se puede ejecutar manualmente.

### backup-sync-remote.sh
Sincroniza la carpeta local de backups con un remote de rclone.

```bash
./scripts/backup-sync-remote.sh [nombre-del-remote] [carpeta-remota]
```

Por defecto usa el remote `gdrive` y la carpeta `Backups-CRM`.

### install-rclone.sh
Script helper para instalar rclone.

```bash
./scripts/install-rclone.sh
```

## Configurar rclone con Google Drive

1. Instalar rclone:
```bash
curl https://rclone.org/install.sh | sudo bash
```

2. Configurar un remote llamado `gdrive`:
```bash
rclone config
```

Seguir el asistente:
- `n` para nuevo remote
- nombre: `gdrive`
- tipo: seleccionar `drive` (Google Drive)
- `client_id` y `client_secret`: dejar en blanco (usar los default)
- `scope`: `1` (acceso completo)
- `root_folder_id`: dejar en blanco
- `service_account_file`: dejar en blanco
- `Edit advanced config?`: `n`
- `Use auto config?`: `n` (porque estamos en headless)
- Copiar la URL que muestra y abrirla en un navegador en otra máquina
- Autenticarse con la cuenta de Google del cliente
- Copiar el código que Google devuelve y pegarlo en la terminal
- `Configure this as a Shared Drive?`: `n`
- Confirmar

3. Verificar que funciona:
```bash
rclone lsd gdrive:
```

Debería listar las carpetas del Drive.

## Seguridad

Estos scripts requieren acceso SSH al servidor donde corre el CRM y leen
las credenciales de Supabase desde el archivo `.env.local`. Solo deberían poder
ejecutarlos personas con acceso administrativo al servidor.
