-- ═══════════════════════════════════════════════════════════════
-- 129_telefonos_asistencia_segundo.sql
--
-- Agrega un segundo teléfono opcional por compañía en la sección
-- "Teléfonos de utilidad" del portal del asegurado.
--
-- Motivo: hay compañías que tienen un número para siniestros y otro
-- para grúa/auxilio 24hs. Con un solo teléfono el asegurado no sabe
-- cuál usar según la situación.
--
-- Diseño: 2 columnas nuevas nullable. Si `telefono_2` está seteado,
-- el portal muestra 2 botones lado a lado con sus respectivos labels.
-- Si está NULL, se muestra solo el primer teléfono (comportamiento
-- actual — retrocompat total).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE telefonos_asistencia_companias
  ADD COLUMN IF NOT EXISTS telefono_2 VARCHAR(30),
  ADD COLUMN IF NOT EXISTS nombre_boton_2 VARCHAR(60);

COMMENT ON COLUMN telefonos_asistencia_companias.telefono_2 IS
  'Segundo teléfono opcional para la compañía. Ej: uno para siniestros y otro para grúa/auxilio. Si está NULL, el portal solo muestra el primero.';
COMMENT ON COLUMN telefonos_asistencia_companias.nombre_boton_2 IS
  'Label del segundo botón. Ej: "Auxilio 24hs", "Grúa", "Emergencias". Solo se muestra si telefono_2 está seteado.';
