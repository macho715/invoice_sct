--
-- seed-rate-cards.sql
-- Seeds 20 representative HVDC contract rate rows for the rate_cards table.
--
-- Prerequisites: Run migrate-rate-cards.sql first.
--
-- Usage (psql):
--   psql "$DATABASE_URL" -f db/seed-rate-cards.sql
--
-- Charge codes: TRANSPORT(5) / CUSTOMS(3) / THC(3) / DO(3) / DETENTION(3) / STORAGE(3)
-- Rates in AED. All rows reference realistic HVDC Abu Dhabi lanes and rates.
--

INSERT INTO rate_cards (charge_code, lane, contracted_rate, rate_basis, effective_from, effective_to) VALUES
-- TRANSPORT (INLAND) — 5 entries
('TRANSPORT', 'MOSB→Mirfa',          1200.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('TRANSPORT', 'Mussafah→Shuweihat',  1500.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('TRANSPORT', 'KIZAD→Barakah',       1350.00, 'PER_TRIP', '2025-03-01', '2026-12-31'),
('TRANSPORT', 'Khalifa Port→Mirfa',   850.00, 'PER_TRIP', '2025-06-01', '2026-12-31'),
('TRANSPORT', 'Abu Dhabi→Ruwais',    3500.00, 'PER_TRIP', '2025-01-01', '2027-06-30'),

-- CUSTOMS — 3 entries
('CUSTOMS',  'Khalifa Port',         1500.00, 'PER_BOE',  '2025-01-01', '2026-12-31'),
('CUSTOMS',  'Mina Zayed',            800.00, 'PER_BOE',  '2025-01-01', '2026-12-31'),
('CUSTOMS',  'Abu Dhabi Airport',     200.00, 'PER_BOE',  '2025-04-01', '2026-12-31'),

-- THC (TERMINAL HANDLING) — 3 entries
('THC',      'Khalifa Port',          800.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('THC',      'Mina Zayed',            450.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('THC',      'Mussafah Port',         150.00, 'PER_CONTAINER', '2025-06-01', '2026-12-31'),

-- DO (DELIVERY ORDER) — 3 entries
('DO',       'Khalifa Port',          300.00, 'PER_DO',  '2025-01-01', '2026-12-31'),
('DO',       'Mina Zayed',            150.00, 'PER_DO',  '2025-01-01', '2026-12-31'),
('DO',       'Mussafah',               50.00, 'PER_DO',  '2025-03-01', '2026-12-31'),

-- DETENTION — 3 entries
('DETENTION', '20FT Dry',             200.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', '40FT Dry',             350.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', '40FT Reefer',          800.00, 'PER_DAY', '2025-01-01', '2026-12-31'),

-- STORAGE — 3 entries
('STORAGE',   'KIZAD Warehouse',      100.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('STORAGE',   'Mussafah Yard',        250.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('STORAGE',   'Mirfa Laydown',        500.00, 'PER_DAY', '2025-06-01', '2026-12-31');
