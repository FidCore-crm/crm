-- Migración 081 — Sacar el concepto de "período de gracia" de los mensajes al admin.
--
-- La lógica interna se mantiene (los 7 días post-vencimiento siguen siendo
-- transparentes: el sistema sigue funcionando como red de seguridad), pero
-- el admin ya no ve la palabra "gracia" ni el contador de días restantes —
-- el aviso es simplemente "tu licencia venció, cargá una nueva".
--
-- Cambios:
--   * Plantilla sistema_licencia_en_gracia: asunto + cuerpo reescritos sin
--     mencionar "días de gracia", "fecha de bloqueo" ni "período".
--   * Se actualizan también los campos *_default para que "Restaurar default"
--     en la UI no traiga de vuelta los textos viejos.

BEGIN;

UPDATE public.plantillas_email SET
  asunto = 'Tu licencia Pulzar venció — renová pronto',
  asunto_default = 'Tu licencia Pulzar venció — renová pronto',
  cuerpo = 'Tu licencia Pulzar venció el {{fecha_vencimiento}}. El sistema sigue funcionando con normalidad por unos días para que tengas tiempo de renovar.

Si no cargás una licencia válida pronto, el CRM pasa a modo solo lectura: podrás consultar personas, pólizas y siniestros, pero no editar ni crear nada nuevo.',
  cuerpo_default = 'Tu licencia Pulzar venció el {{fecha_vencimiento}}. El sistema sigue funcionando con normalidad por unos días para que tengas tiempo de renovar.

Si no cargás una licencia válida pronto, el CRM pasa a modo solo lectura: podrás consultar personas, pólizas y siniestros, pero no editar ni crear nada nuevo.'
WHERE codigo = 'sistema_licencia_en_gracia';

COMMIT;
