-- Migración 070: nueva plantilla de WhatsApp "recordatorio_pago"
--
-- Complementa al botón "Recordar pago" en la ficha de póliza, que permite
-- mandar el recordatorio por email (plantilla `recordatorio_pago` de
-- `plantillas_email`) o por WhatsApp (esta plantilla nueva).
--
-- Variables disponibles:
--   - nombre              : nombre de pila del asegurado
--   - apellido            : apellido del asegurado
--   - numero_poliza       : número de póliza
--   - compania            : nombre de la compañía
--   - ramo                : nombre del ramo
--   - productora_nombre   : nombre de la productora (auto-completado)

BEGIN;

INSERT INTO plantillas_whatsapp (codigo, nombre, descripcion, contexto, variables_disponibles, mensaje, mensaje_default, activa)
VALUES (
  'recordatorio_pago',
  'Recordatorio de pago',
  'Mensaje para recordarle al cliente que tiene un vencimiento pendiente en su póliza.',
  'POLIZA',
  ARRAY['nombre','apellido','numero_poliza','compania','ramo','productora_nombre'],
  E'Hola {{nombre}}, te recuerdo que tenés un vencimiento pendiente en tu póliza de {{ramo}} con {{compania}} (N° {{numero_poliza}}).\n\nPor favor regularizá el pago para evitar interrupciones en la cobertura. Si ya pagaste, ignorá este mensaje.\n\nCualquier duda, escribime.\n\nSaludos,\n{{productora_nombre}}',
  E'Hola {{nombre}}, te recuerdo que tenés un vencimiento pendiente en tu póliza de {{ramo}} con {{compania}} (N° {{numero_poliza}}).\n\nPor favor regularizá el pago para evitar interrupciones en la cobertura. Si ya pagaste, ignorá este mensaje.\n\nCualquier duda, escribime.\n\nSaludos,\n{{productora_nombre}}',
  true
)
ON CONFLICT (codigo) DO NOTHING;

COMMIT;
