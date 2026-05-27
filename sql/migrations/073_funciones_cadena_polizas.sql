-- Migración 073: Funciones de cadena de pólizas (renovaciones)
--
-- Reemplaza el patrón while-loop N+1 del frontend que recorre la cadena
-- de origen subiendo nivel por nivel (un round-trip por nivel). Para una
-- póliza con 4 años de renovaciones se hacían 4 queries serializadas;
-- ahora una sola con WITH RECURSIVE.
--
-- Devuelven la cadena ordenada: raíz primero, descendiendo por
-- poliza_origen_id. Si la póliza es la raíz, devuelven array vacío.

BEGIN;

-- Ancestros: pólizas que llevan A esta (cadena hacia atrás).
-- Útil para mostrar "renovó a esta póliza" en la ficha.
CREATE OR REPLACE FUNCTION public.fn_polizas_ancestros(p_id uuid)
RETURNS TABLE (
  id uuid,
  numero_poliza text,
  fecha_inicio date,
  fecha_fin date,
  estado text,
  poliza_origen_id uuid,
  nivel int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH RECURSIVE cadena AS (
    -- Caso base: el origen directo de la póliza pasada
    SELECT p.id, p.numero_poliza::text, p.fecha_inicio, p.fecha_fin, p.estado::text,
           p.poliza_origen_id, 1 AS nivel
    FROM polizas p
    WHERE p.id = (
      SELECT poliza_origen_id FROM polizas WHERE id = p_id
    )

    UNION ALL

    -- Recursión: ancestro del ancestro
    SELECT p.id, p.numero_poliza::text, p.fecha_inicio, p.fecha_fin, p.estado::text,
           p.poliza_origen_id, c.nivel + 1
    FROM polizas p
    INNER JOIN cadena c ON p.id = c.poliza_origen_id
    WHERE c.nivel < 50   -- guard anti-ciclo (no debería pasar pero por las dudas)
  )
  SELECT id, numero_poliza, fecha_inicio, fecha_fin, estado, poliza_origen_id, nivel
  FROM cadena
  ORDER BY nivel DESC;   -- raíz primero (mayor nivel = más antigua)
$$;

-- Permitir uso desde el cliente autenticado.
REVOKE ALL ON FUNCTION public.fn_polizas_ancestros FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_polizas_ancestros TO authenticated, service_role;

COMMIT;
