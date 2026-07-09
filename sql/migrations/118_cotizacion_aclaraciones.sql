-- Aclaraciones legales de cotización — editables por el PAS
--
-- Antes vivían hardcoded en src/lib/pdf-cotizacion.ts (constante
-- ACLARACIONES_COTIZACION). Movidas a `configuracion.cotizacion_aclaraciones`
-- para que el PAS pueda editarlas desde la pantalla de perfil.
--
-- Formato: TEXT plano. Cada "punto" separado por una línea en blanco
-- (\n\n). El renderer del PDF divide por eso y muestra cada bloque como
-- un párrafo. NULL o vacío = sin aclaraciones (el PAS decidió sacarlas).
--
-- El default se puebla con los 9 puntos legales estándar de plaza para
-- instalaciones nuevas y para las viejas que aún no lo tienen seteado.

ALTER TABLE configuracion
  ADD COLUMN IF NOT EXISTS cotizacion_aclaraciones TEXT;

-- Backfill: aplica el default a filas que no lo tienen aún.
UPDATE configuracion
SET cotizacion_aclaraciones = $DEFAULT$Se deja expresa constancia que las sumas informadas para cotizar, al momento de la emisión pueden ser adecuadas por la compañía de seguros.

El otorgamiento de la cobertura quedará sujeto al resultado de la inspección previa satisfactoria de la/s unidad/es, de corresponder. La cobertura cotizada podrá sufrir modificaciones en base al resultado de la inspección.

La presente cotización se encuentra sujeta a las condiciones generales y particulares de la póliza aprobadas por la Superintendencia de Seguros de la Nación.

Esta propuesta no constituye una cobertura de seguros sino una cotización de la misma, y tiene validez por un plazo determinado. Después de dicha fecha la/s Aseguradoras podrán retirar o modificar los términos previamente ofertados.

Los costos indicados precedentemente corresponden al período de vigencia de cobertura informado.

Inspección previa: si la cobertura seleccionada requiere inspección previa, recuerde que hasta tanto no cumpla con dicho trámite la póliza no será emitida por la Aseguradora.

Instalación de dispositivo de rastreo satelital: las aseguradoras podrán exigir la instalación de un dispositivo de rastreo, cuyo costo de instalación y abono por servicio estará a cargo del asegurado. Consulte alcances y condiciones.

Esta cotización está basada en la información suministrada por ustedes, por lo que si considera que existen variaciones que puedan modificar el riesgo la cotización podría variar.

Para mayor información, comuníquese con nosotros por cualquiera de nuestros canales de atención.$DEFAULT$
WHERE cotizacion_aclaraciones IS NULL;
