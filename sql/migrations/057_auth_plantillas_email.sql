-- Migración 057: Plantillas de email para flows de auth
--
-- Inserta plantillas que envía el CRM (no GoTrue directamente) cuando
-- un usuario pide reset de password, recibe una invitación, pide magic link
-- o cambia su email. Cada email lleva un link generado por
-- `auth.admin.generateLink()` (GoTrue) — el CRM solo encola el envío con
-- el contenido y SMTP propios.

BEGIN;

-- ============================================================================
-- 1. auth_recuperar_password — Password reset (#86)
-- ============================================================================

INSERT INTO plantillas_email (
  codigo, nombre, descripcion, contexto, es_sistema, editable,
  variables_disponibles,
  asunto, saludo, cuerpo, cierre,
  asunto_default, saludo_default, cuerpo_default, cierre_default
)
VALUES (
  'auth_recuperar_password',
  'Recuperación de contraseña',
  'Se envía cuando un usuario pide reset de su password desde el login.',
  'GENERAL',
  true, true,
  ARRAY['nombre', 'apellido', 'email', 'boton_accion', 'url_accion'],
  'Recuperá tu contraseña',
  'Hola {{nombre}}!',
  'Recibimos un pedido para recuperar la contraseña de tu cuenta en el CRM.

Para definir una nueva contraseña, hacé click en el siguiente botón:

{{boton_accion}}

Si no fuiste vos quien pidió este cambio, ignorá este email. Tu contraseña no se modificará.

Este link expira en 1 hora.',
  'Saludos,',
  'Recuperá tu contraseña',
  'Hola {{nombre}}!',
  'Recibimos un pedido para recuperar la contraseña de tu cuenta en el CRM.

Para definir una nueva contraseña, hacé click en el siguiente botón:

{{boton_accion}}

Si no fuiste vos quien pidió este cambio, ignorá este email. Tu contraseña no se modificará.

Este link expira en 1 hora.',
  'Saludos,'
)
ON CONFLICT (codigo) DO NOTHING;


-- ============================================================================
-- 2. auth_invitacion_usuario — Invitación (#87)
-- ============================================================================

INSERT INTO plantillas_email (
  codigo, nombre, descripcion, contexto, es_sistema, editable,
  variables_disponibles,
  asunto, saludo, cuerpo, cierre,
  asunto_default, saludo_default, cuerpo_default, cierre_default
)
VALUES (
  'auth_invitacion_usuario',
  'Invitación a usuario nuevo',
  'Se envía cuando un admin invita a alguien a crear cuenta en el CRM. El invitado define su propia contraseña al aceptar.',
  'GENERAL',
  true, true,
  ARRAY['nombre', 'apellido', 'email_invitado', 'admin_nombre', 'boton_accion', 'url_accion'],
  'Te invitaron a usar el CRM',
  'Hola {{nombre}}!',
  '{{admin_nombre}} te invitó a usar el CRM con tu cuenta de email {{email_invitado}}.

Para activar tu cuenta y definir tu contraseña, hacé click en el siguiente botón:

{{boton_accion}}

Una vez que actives la cuenta vas a poder ingresar con tu email y la contraseña que definas.

Este link expira en 24 horas.',
  'Bienvenido/a al equipo,',
  'Te invitaron a usar el CRM',
  'Hola {{nombre}}!',
  '{{admin_nombre}} te invitó a usar el CRM con tu cuenta de email {{email_invitado}}.

Para activar tu cuenta y definir tu contraseña, hacé click en el siguiente botón:

{{boton_accion}}

Una vez que actives la cuenta vas a poder ingresar con tu email y la contraseña que definas.

Este link expira en 24 horas.',
  'Bienvenido/a al equipo,'
)
ON CONFLICT (codigo) DO NOTHING;


-- ============================================================================
-- 3. auth_magic_link — Login sin contraseña (#75)
-- ============================================================================

INSERT INTO plantillas_email (
  codigo, nombre, descripcion, contexto, es_sistema, editable,
  variables_disponibles,
  asunto, saludo, cuerpo, cierre,
  asunto_default, saludo_default, cuerpo_default, cierre_default
)
VALUES (
  'auth_magic_link',
  'Magic link de acceso',
  'Se envía cuando un usuario pide un link de acceso rápido sin contraseña desde la pantalla de login.',
  'GENERAL',
  true, true,
  ARRAY['nombre', 'apellido', 'email', 'boton_accion', 'url_accion'],
  'Tu link de acceso al CRM',
  'Hola {{nombre}}!',
  'Pediste un link de acceso rápido al CRM.

Hacé click en el siguiente botón para ingresar directamente sin escribir tu contraseña:

{{boton_accion}}

Si no fuiste vos quien pidió este link, ignorá este email.

Este link expira en 15 minutos.',
  'Saludos,',
  'Tu link de acceso al CRM',
  'Hola {{nombre}}!',
  'Pediste un link de acceso rápido al CRM.

Hacé click en el siguiente botón para ingresar directamente sin escribir tu contraseña:

{{boton_accion}}

Si no fuiste vos quien pidió este link, ignorá este email.

Este link expira en 15 minutos.',
  'Saludos,'
)
ON CONFLICT (codigo) DO NOTHING;


-- ============================================================================
-- 4. auth_confirmacion_email — Cambio de email (#85)
-- ============================================================================

INSERT INTO plantillas_email (
  codigo, nombre, descripcion, contexto, es_sistema, editable,
  variables_disponibles,
  asunto, saludo, cuerpo, cierre,
  asunto_default, saludo_default, cuerpo_default, cierre_default
)
VALUES (
  'auth_confirmacion_email',
  'Confirmación de nuevo email',
  'Se envía a la nueva dirección de email cuando un usuario (o el admin en su nombre) cambia su email. El cambio queda pendiente hasta que el usuario confirme.',
  'GENERAL',
  true, true,
  ARRAY['nombre', 'apellido', 'email_nuevo', 'email_anterior', 'boton_accion', 'url_accion'],
  'Confirmá tu nueva dirección de email',
  'Hola {{nombre}}!',
  'Se solicitó cambiar la dirección de email de tu cuenta del CRM a {{email_nuevo}}.

Para confirmar que esta es tu dirección, hacé click en el siguiente botón:

{{boton_accion}}

Hasta que confirmes, podés seguir ingresando con tu email anterior.

Si no fuiste vos quien pidió este cambio, ignorá este email.

Este link expira en 24 horas.',
  'Saludos,',
  'Confirmá tu nueva dirección de email',
  'Hola {{nombre}}!',
  'Se solicitó cambiar la dirección de email de tu cuenta del CRM a {{email_nuevo}}.

Para confirmar que esta es tu dirección, hacé click en el siguiente botón:

{{boton_accion}}

Hasta que confirmes, podés seguir ingresando con tu email anterior.

Si no fuiste vos quien pidió este cambio, ignorá este email.

Este link expira en 24 horas.',
  'Saludos,'
)
ON CONFLICT (codigo) DO NOTHING;


COMMIT;
