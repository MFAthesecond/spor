-- Supabase'de SQL Editor'da çalıştır
-- (Supabase Dashboard → SQL Editor → New Query)

-- Öğünler tablosu
CREATE TABLE IF NOT EXISTS meals (
  id          bigserial    PRIMARY KEY,
  date        date         NOT NULL,
  name        text         NOT NULL,
  kcal        integer      NOT NULL DEFAULT 0,
  protein     integer      NOT NULL DEFAULT 0,
  carb        integer      NOT NULL DEFAULT 0,
  fat         integer      NOT NULL DEFAULT 0,
  items       jsonb,
  time        text,
  ai_generated boolean     NOT NULL DEFAULT false,
  created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meals_date_idx ON meals (date);

-- Kilo takip tablosu
CREATE TABLE IF NOT EXISTS weight_logs (
  id          bigserial    PRIMARY KEY,
  date        date         NOT NULL UNIQUE,
  weight_kg   numeric(5,2) NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now()
);

-- RLS devre dışı (kişisel araç)
ALTER TABLE meals       DISABLE ROW LEVEL SECURITY;
ALTER TABLE weight_logs DISABLE ROW LEVEL SECURITY;
