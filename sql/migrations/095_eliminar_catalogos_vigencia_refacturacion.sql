-- ============================================================
-- 095 — Eliminar catálogos VIGENCIA y REFACTURACION
-- ============================================================
-- Decisión de producto (2026-06-20):
--
-- VIGENCIA: la vigencia de una póliza es derivable 100% de
-- fecha_inicio y fecha_fin. Se calcula on-the-fly como cantidad
-- de meses y se muestra como "12 meses", "6 meses", etc. El PAS
-- interpreta el número directamente (12 = anual, 6 = semestral).
-- La columna polizas.vigencia_tipo_id se elimina.
--
-- REFACTURACION: las 7 formas de pago de la industria son
-- universales (Mensual, Bimestral, Trimestral, Cuatrimestral,
-- Semestral, Anual, Pago único). No tiene sentido que el PAS las
-- pueda editar como catálogo. La columna polizas.refacturacion_id
-- (UUID FK a catalogos) se reemplaza por polizas.refacturacion
-- (VARCHAR con CHECK constraint sobre los 7 valores).
--
-- Las bases productivas a la fecha de esta migración están vacías
-- (no hay pólizas cargadas), por lo que NO hay backfill. Si en el
-- futuro hay que portar a una base con datos, hacer una migración
-- separada que mapee los nombres del catálogo viejo a los nuevos
-- enums usando normalizarRefacturacion() del lib.
--
-- Idempotente: corre N veces sin efectos colaterales.
-- ============================================================

-- 1) Agregar la columna nueva polizas.refacturacion (texto) con CHECK
ALTER TABLE public.polizas
  ADD COLUMN IF NOT EXISTS refacturacion VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'polizas_refacturacion_check'
      AND conrelid = 'public.polizas'::regclass
  ) THEN
    ALTER TABLE public.polizas
      ADD CONSTRAINT polizas_refacturacion_check
      CHECK (refacturacion IS NULL OR refacturacion IN (
        'MENSUAL',
        'BIMESTRAL',
        'TRIMESTRAL',
        'CUATRIMESTRAL',
        'SEMESTRAL',
        'ANUAL',
        'PAGO_UNICO'
      ));
  END IF;
END $$;

-- 2) Eliminar las FK columns viejas (si existen)
ALTER TABLE public.polizas DROP COLUMN IF EXISTS refacturacion_id;
ALTER TABLE public.polizas DROP COLUMN IF EXISTS vigencia_tipo_id;

-- 3) Eliminar las filas de catalogos del tipo VIGENCIA y REFACTURACION
DELETE FROM public.catalogos
WHERE tipo_id IN (
  SELECT id FROM public.tipo_catalogo
  WHERE codigo IN ('VIGENCIA', 'REFACTURACION')
);

-- 4) Eliminar las filas de tipo_catalogo VIGENCIA y REFACTURACION
DELETE FROM public.tipo_catalogo
WHERE codigo IN ('VIGENCIA', 'REFACTURACION');
