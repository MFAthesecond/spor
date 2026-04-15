-- Mevcut weight_logs tablosunu güncelle: UNIQUE kaldır, time kolonu ekle
-- Supabase SQL Editor'da çalıştır

ALTER TABLE weight_logs DROP CONSTRAINT IF EXISTS weight_logs_date_key;
ALTER TABLE weight_logs ADD COLUMN IF NOT EXISTS time text;
CREATE INDEX IF NOT EXISTS weight_date_idx ON weight_logs (date);
