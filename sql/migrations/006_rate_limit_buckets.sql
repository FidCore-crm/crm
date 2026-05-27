-- ============================================================
-- 006_rate_limit_buckets.sql
-- Rate limiting persistente por (identifier, endpoint).
-- ============================================================

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier VARCHAR NOT NULL,
  endpoint VARCHAR NOT NULL,
  count INTEGER DEFAULT 1,
  reset_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT rate_limit_unique UNIQUE(identifier, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_reset ON rate_limit_buckets(reset_at);

ALTER TABLE rate_limit_buckets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Permitir todo en rate_limit_buckets" ON rate_limit_buckets;
CREATE POLICY "Permitir todo en rate_limit_buckets" ON rate_limit_buckets FOR ALL USING (true) WITH CHECK (true);
