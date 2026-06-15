-- Migración 082 — Sacar la última mención al "período de gracia".
--
-- La plantilla sistema_licencia_bloqueada arrancaba el cuerpo con "El
-- período de gracia terminó." — ese concepto no debe mencionarse al admin.
-- Reescribimos para que sea directo: "tu licencia venció y el CRM está
-- en modo solo lectura".
--
-- Misma estrategia que la 081: actualizamos cuerpo + cuerpo_default para
-- que "Restaurar default" no traiga de vuelta el texto viejo.

BEGIN;

UPDATE public.plantillas_email SET
  cuerpo = 'Tu licencia FidCore venció. El sistema pasó a modo solo lectura: podés consultar personas, pólizas y siniestros, pero no crear ni editar nada nuevo.

Para reactivar el sistema completo, cargá una licencia válida desde Configuración → Licencia. Apenas la subas, todas las funciones se desbloquean al instante.',
  cuerpo_default = 'Tu licencia FidCore venció. El sistema pasó a modo solo lectura: podés consultar personas, pólizas y siniestros, pero no crear ni editar nada nuevo.

Para reactivar el sistema completo, cargá una licencia válida desde Configuración → Licencia. Apenas la subas, todas las funciones se desbloquean al instante.'
WHERE codigo = 'sistema_licencia_bloqueada';

COMMIT;
