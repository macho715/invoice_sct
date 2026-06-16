BEGIN;

-- Rate cards table: stores contract rates for both SHIPMENT (charge_code) and
-- DOMESTIC (lane key = origin||destination||vehicle||unit) workflows.
-- Supports deterministic rate comparison with audit trail.

CREATE TABLE IF NOT EXISTS rate_cards (
    id              SERIAL PRIMARY KEY,
    charge_code     TEXT,                     -- SHIPMENT: e.g. 'FRT_OCEAN_BASIC'
    lane            TEXT,                     -- DOMESTIC: composite lane key
    contracted_rate NUMERIC(12, 4) NOT NULL,  -- agreed unit rate (USD)
    applied_rate    NUMERIC(12, 4),           -- invoice-applied rate (for reference)
    rate_basis      TEXT,                     -- PER_TRUCK, PER_TEU, PER_CBM, etc.
    currency        TEXT NOT NULL DEFAULT 'USD',
    effective_from  DATE,
    effective_to    DATE,
    match_eligible  TEXT DEFAULT 'Y',         -- 'Y' or 'N' — whether rate card is matchable
    contract_ref    TEXT,                     -- contract/PO reference
    lane_id         TEXT,                     -- ApprovedLaneMap lane_id (e.g. 'L036')
    median_distance_km NUMERIC(12, 2),       -- median trip distance for this lane
    samples         INTEGER DEFAULT 0,        -- sample count from ApprovedLaneMap
    workflow_type   TEXT NOT NULL DEFAULT 'SHIPMENT',  -- 'SHIPMENT' or 'DOMESTIC'
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_rate_card_type CHECK (
        (charge_code IS NOT NULL AND workflow_type = 'SHIPMENT')
        OR (lane IS NOT NULL AND workflow_type = 'DOMESTIC')
    ),
    CONSTRAINT chk_workflow_type_rate CHECK (workflow_type IN ('SHIPMENT', 'DOMESTIC'))
);

-- Indexes for lookup performance
CREATE INDEX IF NOT EXISTS idx_rate_cards_charge_code ON rate_cards(charge_code) WHERE charge_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rate_cards_lane ON rate_cards(lane) WHERE lane IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rate_cards_workflow_type ON rate_cards(workflow_type);

COMMIT;
