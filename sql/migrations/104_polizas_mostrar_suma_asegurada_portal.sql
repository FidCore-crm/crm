-- Migración 104: toggle para mostrar/ocultar la suma asegurada en el portal del asegurado.
--
-- Caso de uso: en seguros de auto la suma asegurada cambia mes a mes (depende
-- de la cotización del vehículo). Mantener ese valor actualizado a mano en
-- cada póliza es inviable, y mostrar un valor desactualizado al cliente es
-- peor que no mostrar nada. El PAS decide por póliza si exponerlo o no.
--
-- Default: false (oculto) — más seguro. Pólizas existentes quedan ocultas
-- hasta que el PAS las habilite explícitamente.

ALTER TABLE polizas
  ADD COLUMN IF NOT EXISTS mostrar_suma_asegurada_portal BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN polizas.mostrar_suma_asegurada_portal IS
  'Si true, el endpoint público del portal del asegurado expone polizas.suma_asegurada. Si false (default) no lo expone aunque tenga valor. El PAS decide por póliza.';
