-- ============================================================
-- 091 — Seed inmutable de tipo_catalogo
-- ============================================================
-- Los 5 tipos de catálogo (COMPANIA, RAMO, COBERTURA, REFACTURACION,
-- VIGENCIA) son una constante del SISTEMA: el código del CRM los
-- referencia por código (ver MapeoColumnaSelector, ImportadorIA,
-- AgentePDFAplicador, mapeador-catalogos.ts, etc.). Sin ellos la
-- pantalla /crm/configuracion/catalogos no muestra tabs y el PAS no
-- puede cargar compañías ni ramos.
--
-- Hasta hoy se cargaban a mano una sola vez y vivían en la DB. Si por
-- cualquier motivo se borraban (reset manual de DB, restauración de un
-- backup viejo sin seeds, instalación nueva), había que insertarlos
-- a mano cada vez. Esta migración los formaliza como seed permanente.
--
-- Lo que SÍ es configurable y vive en `catalogos` (compañías, ramos,
-- coberturas concretas que cada PAS quiere usar) no se toca acá: esa
-- configuración la define cada usuario en /crm/configuracion/catalogos
-- y sigue viajando en los backups como hasta ahora.
--
-- Idempotente: corre N veces sin efectos.
-- ============================================================

INSERT INTO public.tipo_catalogo (id, codigo, descripcion) VALUES
  (1, 'COMPANIA',      'Compañías aseguradoras'),
  (2, 'RAMO',          'Ramos de seguro (Automotor, Hogar, Vida, etc.)'),
  (3, 'COBERTURA',     'Tipos de cobertura por ramo'),
  (4, 'REFACTURACION', 'Formas/frecuencia de cobro de las pólizas'),
  (5, 'VIGENCIA',      'Tipos de vigencia (Anual, Semestral, etc.)')
ON CONFLICT (id) DO NOTHING;

-- Reposicionar el sequence por si la tabla viene vacía y se reinsertan
-- los IDs explícitos arriba. Sin esto el próximo INSERT con DEFAULT
-- tiraría duplicate key porque el sequence quedaría en 1.
SELECT setval(
  'public.tipo_catalogo_id_seq',
  GREATEST((SELECT COALESCE(MAX(id), 0) FROM public.tipo_catalogo), 5),
  true
);
