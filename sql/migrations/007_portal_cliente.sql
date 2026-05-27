-- ============================================================
-- 007_portal_cliente.sql
-- Portal del Cliente: tokens de acceso permanentes, configuración
-- general y teléfonos de asistencia por compañía.
-- ============================================================

-- Tokens de acceso al portal (un token activo por persona)
CREATE TABLE IF NOT EXISTS portal_cliente_accesos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  token VARCHAR UNIQUE NOT NULL,
  fecha_creacion TIMESTAMPTZ DEFAULT NOW(),
  veces_accedido INTEGER DEFAULT 0,
  ultimo_acceso TIMESTAMPTZ,
  ultimo_ip VARCHAR,
  revocado BOOLEAN DEFAULT false,
  fecha_revocacion TIMESTAMPTZ,
  motivo_revocacion TEXT,
  creado_por_usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_portal_accesos_token ON portal_cliente_accesos(token);
CREATE INDEX IF NOT EXISTS idx_portal_accesos_persona ON portal_cliente_accesos(persona_id);
-- Un solo token NO revocado por persona (permite múltiples revocados históricos)
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_accesos_activo_por_persona
  ON portal_cliente_accesos(persona_id) WHERE revocado = false;

ALTER TABLE portal_cliente_accesos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en portal_cliente_accesos" ON portal_cliente_accesos;
CREATE POLICY "Permitir todo en portal_cliente_accesos" ON portal_cliente_accesos FOR ALL USING (true) WITH CHECK (true);


-- Configuración general del portal (singleton)
CREATE TABLE IF NOT EXISTS configuracion_portal_cliente (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activo BOOLEAN DEFAULT false,
  texto_bienvenida TEXT DEFAULT 'Bienvenido a tu portal personal',
  mensaje_acceso_revocado TEXT DEFAULT 'Este enlace ya no está disponible. Contactá a tu productor para obtener un nuevo acceso.',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_configuracion_portal_singleton ON configuracion_portal_cliente((true));

ALTER TABLE configuracion_portal_cliente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en configuracion_portal_cliente" ON configuracion_portal_cliente;
CREATE POLICY "Permitir todo en configuracion_portal_cliente" ON configuracion_portal_cliente FOR ALL USING (true) WITH CHECK (true);

INSERT INTO configuracion_portal_cliente (activo) VALUES (false) ON CONFLICT DO NOTHING;


-- Teléfonos de asistencia/grúa por compañía
CREATE TABLE IF NOT EXISTS telefonos_asistencia_companias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compania_id UUID NOT NULL REFERENCES catalogos(id) ON DELETE CASCADE,
  telefono VARCHAR NOT NULL,
  nombre_boton VARCHAR DEFAULT 'Asistencia 24hs',
  visible_en_portal BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT telefonos_asistencia_unique UNIQUE(compania_id)
);

ALTER TABLE telefonos_asistencia_companias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en telefonos_asistencia_companias" ON telefonos_asistencia_companias;
CREATE POLICY "Permitir todo en telefonos_asistencia_companias" ON telefonos_asistencia_companias FOR ALL USING (true) WITH CHECK (true);


-- Plantilla de email para el envío del link
INSERT INTO plantillas_email (codigo, nombre, descripcion, asunto_default, contexto, variables_disponibles)
VALUES (
  'portal_cliente_acceso',
  'Acceso al Portal del Cliente',
  'Email con el link de acceso permanente al portal del cliente',
  'Tu acceso al portal de {{productora_nombre}}',
  'CLIENTE',
  ARRAY['nombre','apellido','url_portal','productora_nombre','productora_telefono','productora_email']
) ON CONFLICT (codigo) DO NOTHING;
