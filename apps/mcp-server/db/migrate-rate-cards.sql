--
-- migrate-rate-cards.sql
-- Creates the rate_cards table for HVDC contract rate validation.
--
-- Usage (psql):
--   psql "$DATABASE_URL" -f db/migrate-rate-cards.sql
--
-- Usage (pipe):
--   cat db/migrate-rate-cards.sql | psql "$DATABASE_URL"
--
-- Columns:
--   id              SERIAL PRIMARY KEY
--   charge_code     TEXT NOT NULL              — TRANSPORT / CUSTOMS / THC / DO / DETENTION / STORAGE
--   lane            TEXT                       — e.g. "MOSB→Mirfa", "Khalifa Port"
--   contracted_rate NUMERIC(10,2) NOT NULL     — contract rate in AED
--   rate_basis      TEXT                       — e.g. "PER_TRIP", "PER_KG", "PER_DAY"
--   effective_from  DATE                       — contract start date
--   effective_to    DATE                       — contract end date
--   created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
--   updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
--

CREATE TABLE IF NOT EXISTS rate_cards (
    id              SERIAL          PRIMARY KEY,
    charge_code     TEXT            NOT NULL,
    lane            TEXT,
    contracted_rate NUMERIC(10,2)   NOT NULL,
    rate_basis      TEXT,
    effective_from  DATE,
    effective_to    DATE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_cards_charge_code ON rate_cards (charge_code);
CREATE INDEX IF NOT EXISTS idx_rate_cards_lane        ON rate_cards (lane);
CREATE INDEX IF NOT EXISTS idx_rate_cards_effective   ON rate_cards (effective_from, effective_to);
