--
-- seed-rate-cards.sql
-- Seeds 250 HVDC contract rate rows for the rate_cards table.
--
-- Prerequisites: Run migrate-rate-cards.sql first.
--
-- Usage (psql):
--   psql "$DATABASE_URL" -f db/seed-rate-cards.sql
--
-- Charge codes (20 types): TRANSPORT / FREIGHT / CUSTOMS / THC / DO /
--   DETENTION / DEMURRAGE / STORAGE / HANDLING / CRANE / ESCORT /
--   INSPECTION / PERMIT / ADMIN / PACKING / LASHING / SURVEY / AGENCY /
--   BAF / WHARFAGE
-- Rates in AED. All rows reference realistic HVDC Abu Dhabi lanes and rates.
--

INSERT INTO rate_cards (charge_code, lane, contracted_rate, rate_basis, effective_from, effective_to) VALUES
-- ======================================================================
-- TRANSPORT (INLAND) — 34 entries
-- ======================================================================
('TRANSPORT', 'MOSB→Mirfa',              1200.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('TRANSPORT', 'MOSB→Mirfa',              1250.00, 'PER_TRIP', '2027-01-01', '2028-12-31'),
('TRANSPORT', 'Mussafah→Shuweihat',      1500.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('TRANSPORT', 'Mussafah→Shuweihat',      1580.00, 'PER_TRIP', '2027-01-01', '2028-12-31'),
('TRANSPORT', 'KIZAD→Barakah',           1350.00, 'PER_TRIP', '2025-03-01', '2026-12-31'),
('TRANSPORT', 'KIZAD→Barakah',           1400.00, 'PER_TRIP', '2027-01-01', '2028-06-30'),
('TRANSPORT', 'Khalifa Port→Mirfa',       850.00, 'PER_TRIP', '2025-06-01', '2026-12-31'),
('TRANSPORT', 'Khalifa Port→Mirfa',       900.00, 'PER_TRIP', '2027-01-01', '2028-12-31'),
('TRANSPORT', 'Abu Dhabi→Ruwais',        3500.00, 'PER_TRIP', '2025-01-01', '2027-06-30'),
('TRANSPORT', 'Mussafah→Barakah',        1800.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('TRANSPORT', 'Khalifa Port→Barakah',    1100.00, 'PER_TRIP', '2025-03-01', '2026-12-31'),
('TRANSPORT', 'Khalifa Port→Shuweihat',   950.00, 'PER_TRIP', '2025-06-01', '2026-12-31'),
('TRANSPORT', 'Mina Zayed→Mirfa',        1300.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('TRANSPORT', 'Mina Zayed→Ruwais',       3200.00, 'PER_TRIP', '2025-01-01', '2027-06-30'),
('TRANSPORT', 'KIZAD→Shuweihat',         1600.00, 'PER_TRIP', '2025-03-01', '2026-12-31'),
('TRANSPORT', 'MOSB→Barakah',            1400.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('TRANSPORT', 'Mussafah→Ruwais',         2900.00, 'PER_TRIP', '2025-06-01', '2027-06-30'),
('TRANSPORT', 'Abu Dhabi Airport→Mirfa', 1000.00, 'PER_TRIP', '2025-04-01', '2026-12-31'),
('TRANSPORT', 'Khalifa Port→Ruwais',     2800.00, 'PER_TRIP', '2025-01-01', '2027-06-30'),
('TRANSPORT', 'Mina Zayed→Barakah',      1200.00, 'PER_TRIP', '2025-03-01', '2026-12-31'),
('TRANSPORT', 'KIZAD→Mirfa',             1150.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('TRANSPORT', 'Al Ain→Barakah',          2200.00, 'PER_TRIP', '2025-06-01', '2026-12-31'),
('TRANSPORT', 'Abu Dhabi→Shuweihat',     2000.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('TRANSPORT', 'Mussafah→Mirfa',          1100.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('TRANSPORT', 'MOSB→Shuweihat',          1300.00, 'PER_TRIP', '2025-03-01', '2026-12-31'),
('TRANSPORT', 'Khalifa Port→Mina Zayed',  550.00, 'PER_TRIP', '2025-06-01', '2026-12-31'),
('TRANSPORT', 'Abu Dhabi Airport→KIZAD',  450.00, 'PER_TRIP', '2025-04-01', '2026-12-31'),
('TRANSPORT', 'Abu Dhabi→KIZAD',          850.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('TRANSPORT', 'Overweight Permit Route',  2500.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('TRANSPORT', 'Night Movement Route',     2800.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('TRANSPORT', 'Weekend/Holiday Transport',3500.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('TRANSPORT', 'Abu Dhabi→Jebel Dhanna',   2800.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('TRANSPORT', 'Mussafah→Jebel Dhanna',    2600.00, 'PER_TRIP', '2025-06-01', '2026-12-31'),
('TRANSPORT', 'Ruwais→Barakah',           1800.00, 'PER_TRIP', '2025-01-01', '2027-06-30'),

-- ======================================================================
-- FREIGHT (OCEAN / AIR) — 26 entries
-- ======================================================================
('FREIGHT', 'Busan→Khalifa Port',        4500.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('FREIGHT', 'Busan→Khalifa Port',        4800.00, 'PER_CONTAINER', '2027-01-01', '2028-06-30'),
('FREIGHT', 'Shanghai→Khalifa Port',     4200.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('FREIGHT', 'Shanghai→Khalifa Port',     4450.00, 'PER_CONTAINER', '2027-01-01', '2028-06-30'),
('FREIGHT', 'Singapore→Khalifa Port',    3200.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('FREIGHT', 'Singapore→Mina Zayed',      3400.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('FREIGHT', 'Jebel Ali→Khalifa Port',    1200.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('FREIGHT', 'Hamburg→Khalifa Port',      5800.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('FREIGHT', 'Antwerp→Khalifa Port',      5600.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('FREIGHT', 'Mumbai→Khalifa Port',       2200.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('FREIGHT', 'Mumbai→Mina Zayed',         2350.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('FREIGHT', 'Incheon→Abu Dhabi Airport',  8500.00, 'PER_KG',      '2025-01-01', '2026-12-31'),
('FREIGHT', 'Incheon→Abu Dhabi Airport',  9200.00, 'PER_KG',      '2027-01-01', '2028-06-30'),
('FREIGHT', 'Frankfurt→Abu Dhabi Airport',6200.00, 'PER_KG',      '2025-01-01', '2026-12-31'),
('FREIGHT', 'Tokyo→Abu Dhabi Airport',    7800.00, 'PER_KG',      '2025-01-01', '2026-12-31'),
('FREIGHT', 'Gwangyang→Khalifa Port',    4600.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('FREIGHT', 'Ulsan→Khalifa Port',        4550.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('FREIGHT', 'Ningbo→Khalifa Port',       4100.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('FREIGHT', 'Qingdao→Khalifa Port',      4300.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('FREIGHT', 'Rotterdam→Khalifa Port',    5700.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('FREIGHT', 'Houston→Khalifa Port',      6500.00, 'PER_CONTAINER', '2025-06-01', '2026-12-31'),
('FREIGHT', 'Dammam→Khalifa Port',       1400.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('FREIGHT', 'Sohar→Khalifa Port',         950.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('FREIGHT', 'Salalah→Khalifa Port',      1100.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('FREIGHT', 'Breakbulk Fuel Surcharge',    15.00, 'PER_CBM',     '2025-01-01', '2026-12-31'),
('FREIGHT', 'Salalah→Mina Zayed',        1250.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),

-- ======================================================================
-- CUSTOMS — 14 entries
-- ======================================================================
('CUSTOMS',  'Khalifa Port',             1500.00, 'PER_BOE',  '2025-01-01', '2026-12-31'),
('CUSTOMS',  'Khalifa Port',             1600.00, 'PER_BOE',  '2027-01-01', '2028-12-31'),
('CUSTOMS',  'Mina Zayed',                800.00, 'PER_BOE',  '2025-01-01', '2026-12-31'),
('CUSTOMS',  'Mina Zayed',                850.00, 'PER_BOE',  '2027-01-01', '2028-12-31'),
('CUSTOMS',  'Abu Dhabi Airport',         200.00, 'PER_BOE',  '2025-04-01', '2026-12-31'),
('CUSTOMS',  'Dubai World Central',      1800.00, 'PER_BOE',  '2025-01-01', '2026-12-31'),
('CUSTOMS',  'Al Ain Border',             600.00, 'PER_BOE',  '2025-01-01', '2026-12-31'),
('CUSTOMS',  'Ghuwaifat Border',          500.00, 'PER_BOE',  '2025-01-01', '2026-12-31'),
('CUSTOMS',  'KIZAD Customs Hub',        1200.00, 'PER_BOE',  '2025-03-01', '2026-12-31'),
('CUSTOMS',  'Customs Brokerage Fee',     350.00, 'PER_BOE',  '2025-01-01', '2026-12-31'),
('CUSTOMS',  'Duty Assessment Service',   250.00, 'PER_BOE',  '2025-01-01', '2026-12-31'),
('CUSTOMS',  'TIR Carnet Processing',     750.00, 'PER_BOE',  '2025-01-01', '2026-12-31'),
('CUSTOMS',  'ATA Carnet Processing',     650.00, 'PER_BOE',  '2025-01-01', '2026-12-31'),
('CUSTOMS',  'Temporary Import Bond',    1200.00, 'PER_BOE',  '2025-06-01', '2026-12-31'),

-- ======================================================================
-- THC (TERMINAL HANDLING) — 12 entries
-- ======================================================================
('THC',      'Khalifa Port 20FT',         800.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('THC',      'Khalifa Port 40FT',        1200.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('THC',      'Mina Zayed 20FT',           450.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('THC',      'Mina Zayed 40FT',           700.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('THC',      'Mussafah Port 20FT',        150.00, 'PER_CONTAINER', '2025-06-01', '2026-12-31'),
('THC',      'Mussafah Port 40FT',        250.00, 'PER_CONTAINER', '2025-06-01', '2026-12-31'),
('THC',      'Khalifa Port Reefer',      1800.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('THC',      'Khalifa Port OOG',         2500.00, 'PER_CONTAINER', '2025-01-01', '2026-12-31'),
('THC',      'Khalifa Port Breakbulk',     35.00, 'PER_CBM',       '2025-01-01', '2026-12-31'),
('THC',      'Mina Zayed Breakbulk',       25.00, 'PER_CBM',       '2025-01-01', '2026-12-31'),
('THC',      'Gate Fee Khalifa Port',     150.00, 'PER_ENTRY',     '2025-01-01', '2026-12-31'),
('THC',      'Gate Fee Mussafah',          75.00, 'PER_ENTRY',     '2025-01-01', '2026-12-31'),

-- ======================================================================
-- DO (DELIVERY ORDER) — 12 entries
-- ======================================================================
('DO',       'Khalifa Port',              300.00, 'PER_DO',  '2025-01-01', '2026-12-31'),
('DO',       'Khalifa Port',              320.00, 'PER_DO',  '2027-01-01', '2028-06-30'),
('DO',       'Mina Zayed',                150.00, 'PER_DO',  '2025-01-01', '2026-12-31'),
('DO',       'Mussafah',                   50.00, 'PER_DO',  '2025-03-01', '2026-12-31'),
('DO',       'Mussafah',                   60.00, 'PER_DO',  '2027-01-01', '2028-06-30'),
('DO',       'KIZAD',                     120.00, 'PER_DO',  '2025-01-01', '2026-12-31'),
('DO',       'Abu Dhabi Airport Cargo',   250.00, 'PER_DO',  '2025-04-01', '2026-12-31'),
('DO',       'Dubai World Central',       350.00, 'PER_DO',  '2025-01-01', '2026-12-31'),
('DO',       'Express DO (Same Day)',     500.00, 'PER_DO',  '2025-01-01', '2026-12-31'),
('DO',       'DO Amendment Fee',          100.00, 'PER_DO',  '2025-01-01', '2026-12-31'),
('DO',       'Telex Release Fee',         150.00, 'PER_DO',  '2025-01-01', '2026-12-31'),
('DO',       'Sea Waybill Fee',            80.00, 'PER_DO',  '2025-01-01', '2026-12-31'),

-- ======================================================================
-- DETENTION (CONTAINER) — 18 entries
-- ======================================================================
('DETENTION', '20FT Dry Day 1-7',         200.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', '20FT Dry Day 8-14',        250.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', '20FT Dry Day 15+',         350.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', '40FT Dry Day 1-7',         350.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', '40FT Dry Day 8-14',        450.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', '40FT Dry Day 15+',         600.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', '40FT Reefer Day 1-7',      800.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', '40FT Reefer Day 8-14',    1000.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', '40FT Reefer Day 15+',     1300.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', '40FT HC Day 1-7',          400.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', '40FT HC Day 8-14',         500.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', '40FT HC Day 15+',          650.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', '20FT Open Top Day 1-7',    300.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', '20FT Open Top Day 8+',     400.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', '40FT Flat Rack Day 1-7',   500.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', '40FT Flat Rack Day 8+',    650.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', 'Khalifa Port Free Days',     0.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DETENTION', 'Mina Zayed Free Days',       0.00, 'PER_DAY', '2025-01-01', '2026-12-31'),

-- ======================================================================
-- DEMURRAGE (PORT) — 12 entries
-- ======================================================================
('DEMURRAGE', 'Khalifa Port 20FT Day 1-5',      150.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DEMURRAGE', 'Khalifa Port 20FT Day 6+',        250.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DEMURRAGE', 'Khalifa Port 40FT Day 1-5',       250.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DEMURRAGE', 'Khalifa Port 40FT Day 6+',        400.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DEMURRAGE', 'Mina Zayed 20FT Day 1-5',         100.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DEMURRAGE', 'Mina Zayed 20FT Day 6+',          180.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DEMURRAGE', 'Mina Zayed 40FT Day 1-5',         200.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DEMURRAGE', 'Mina Zayed 40FT Day 6+',          320.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DEMURRAGE', 'Khalifa Port Reefer Day 1-3',     500.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DEMURRAGE', 'Khalifa Port Reefer Day 4+',       800.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DEMURRAGE', 'Khalifa Port OOG',                 600.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('DEMURRAGE', 'Mussafah Port 20FT',                80.00, 'PER_DAY', '2025-06-01', '2026-12-31'),

-- ======================================================================
-- STORAGE (WAREHOUSE / YARD) — 12 entries
-- ======================================================================
('STORAGE',   'KIZAD Warehouse Dry',      100.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('STORAGE',   'KIZAD Warehouse AC',       180.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('STORAGE',   'Mussafah Yard',            250.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('STORAGE',   'Mirfa Laydown Heavy',      500.00, 'PER_DAY', '2025-06-01', '2026-12-31'),
('STORAGE',   'Mirfa Laydown Light',      350.00, 'PER_DAY', '2025-06-01', '2026-12-31'),
('STORAGE',   'Barakah Laydown',          450.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('STORAGE',   'Shuweihat Yard',           300.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('STORAGE',   'Ruwais Laydown',           550.00, 'PER_DAY', '2025-01-01', '2027-06-30'),
('STORAGE',   'Khalifa Port CFS',         150.00, 'PER_CBM', '2025-01-01', '2026-12-31'),
('STORAGE',   'Bonded Warehouse KIZAD',   200.00, 'PER_DAY', '2025-03-01', '2026-12-31'),
('STORAGE',   'Open Yard Mussafah',       120.00, 'PER_DAY', '2025-01-01', '2026-12-31'),
('STORAGE',   'Covered Storage Mirfa',    380.00, 'PER_DAY', '2025-06-01', '2026-12-31'),

-- ======================================================================
-- HANDLING (SPECIAL) — 15 entries
-- ======================================================================
('HANDLING',  'Heavy Lift 20-50T',        5000.00, 'PER_LIFT',   '2025-01-01', '2026-12-31'),
('HANDLING',  'Heavy Lift 50-100T',       9000.00, 'PER_LIFT',   '2025-01-01', '2026-12-31'),
('HANDLING',  'Heavy Lift 100-200T',     18000.00, 'PER_LIFT',   '2025-01-01', '2026-12-31'),
('HANDLING',  'Heavy Lift 200T+',        35000.00, 'PER_LIFT',   '2025-01-01', '2026-12-31'),
('HANDLING',  'Forklift 3T',              250.00, 'PER_HOUR',   '2025-01-01', '2026-12-31'),
('HANDLING',  'Forklift 8T',              450.00, 'PER_HOUR',   '2025-01-01', '2026-12-31'),
('HANDLING',  'Forklift 16T',             750.00, 'PER_HOUR',   '2025-01-01', '2026-12-31'),
('HANDLING',  'Dangerous Goods Class 1',  3500.00, 'PER_SHIPMENT','2025-01-01', '2026-12-31'),
('HANDLING',  'Dangerous Goods Class 2-4',2500.00, 'PER_SHIPMENT','2025-01-01', '2026-12-31'),
('HANDLING',  'Dangerous Goods Class 5-9',1800.00, 'PER_SHIPMENT','2025-01-01', '2026-12-31'),
('HANDLING',  'OOG Cargo Surcharge',      2200.00, 'PER_UNIT',    '2025-01-01', '2026-12-31'),
('HANDLING',  'Manual Handling Crew',      150.00, 'PER_HOUR',   '2025-01-01', '2026-12-31'),
('HANDLING',  'Spreader Bar Rental',      1200.00, 'PER_DAY',    '2025-01-01', '2026-12-31'),
('HANDLING',  'Sling Set Rental',          500.00, 'PER_DAY',    '2025-01-01', '2026-12-31'),
('HANDLING',  'Shift Supervisor',          350.00, 'PER_HOUR',   '2025-01-01', '2026-12-31'),

-- ======================================================================
-- CRANE — 15 entries
-- ======================================================================
('CRANE',     'Mobile Crane 25T',         1200.00, 'PER_HOUR',  '2025-01-01', '2026-12-31'),
('CRANE',     'Mobile Crane 50T',         1800.00, 'PER_HOUR',  '2025-01-01', '2026-12-31'),
('CRANE',     'Mobile Crane 100T',        3200.00, 'PER_HOUR',  '2025-01-01', '2026-12-31'),
('CRANE',     'Mobile Crane 200T',        5500.00, 'PER_HOUR',  '2025-01-01', '2026-12-31'),
('CRANE',     'Mobile Crane 300T',        8500.00, 'PER_HOUR',  '2025-01-01', '2026-12-31'),
('CRANE',     'Mobile Crane 500T',       14000.00, 'PER_HOUR',  '2025-01-01', '2026-12-31'),
('CRANE',     'Crawler Crane 250T',       7500.00, 'PER_HOUR',  '2025-01-01', '2026-12-31'),
('CRANE',     'Crawler Crane 400T',      11000.00, 'PER_HOUR',  '2025-01-01', '2026-12-31'),
('CRANE',     'Crawler Crane 600T',      18000.00, 'PER_HOUR',  '2025-06-01', '2026-12-31'),
('CRANE',     'Tower Crane Assembly',    25000.00, 'PER_JOB',   '2025-01-01', '2026-12-31'),
('CRANE',     'Tower Crane Dismantle',   22000.00, 'PER_JOB',   '2025-01-01', '2026-12-31'),
('CRANE',     'Crane Mobilization',       5000.00, 'PER_TRIP',  '2025-01-01', '2026-12-31'),
('CRANE',     'Crane Demobilization',     5000.00, 'PER_TRIP',  '2025-01-01', '2026-12-31'),
('CRANE',     'Crane Standby Rate',       1000.00, 'PER_HOUR',  '2025-01-01', '2026-12-31'),
('CRANE',     'Crane Operator Premium',    250.00, 'PER_HOUR',  '2025-01-01', '2026-12-31'),

-- ======================================================================
-- ESCORT (POLICE / SECURITY) — 10 entries
-- ======================================================================
('ESCORT',    'Police Escort Standard',    2200.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('ESCORT',    'Police Escort OOG',         4500.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('ESCORT',    'Police Escort Night',       3500.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('ESCORT',    'Police Escort Weekend',     4000.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('ESCORT',    'Private Escort Vehicle',    1200.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('ESCORT',    'Pilot Car Standard',         800.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('ESCORT',    'Pilot Car Night',           1200.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('ESCORT',    'Route Survey Pre-Run',      1800.00, 'PER_TRIP', '2025-01-01', '2026-12-31'),
('ESCORT',    'Traffic Management Plan',   2500.00, 'PER_JOB',  '2025-01-01', '2026-12-31'),
('ESCORT',    'NOC Processing ADM',        1500.00, 'PER_NOC',  '2025-01-01', '2026-12-31'),

-- ======================================================================
-- INSPECTION — 10 entries
-- ======================================================================
('INSPECTION','Pre-Shipment Inspection',   2500.00, 'PER_JOB',  '2025-01-01', '2026-12-31'),
('INSPECTION','MIL Inspection KOC',        4500.00, 'PER_JOB',  '2025-01-01', '2026-12-31'),
('INSPECTION','Third Party Inspection',    3200.00, 'PER_JOB',  '2025-01-01', '2026-12-31'),
('INSPECTION','DNV / BV Survey',          12000.00, 'PER_JOB',  '2025-01-01', '2026-12-31'),
('INSPECTION','Radiographic Testing',      6500.00, 'PER_JOB',  '2025-01-01', '2026-12-31'),
('INSPECTION','Ultrasonic Testing',        3500.00, 'PER_JOB',  '2025-01-01', '2026-12-31'),
('INSPECTION','Dye Penetrant Testing',     1800.00, 'PER_JOB',  '2025-01-01', '2026-12-31'),
('INSPECTION','Visual Inspection Only',    1200.00, 'PER_JOB',  '2025-01-01', '2026-12-31'),
('INSPECTION','Cargo Arrival Inspection',  1500.00, 'PER_JOB',  '2025-01-01', '2026-12-31'),
('INSPECTION','Container Condition Survey', 800.00, 'PER_CONTAINER','2025-01-01','2026-12-31'),

-- ======================================================================
-- PERMIT (ROAD / PORT) — 10 entries
-- ======================================================================
('PERMIT',    'Overweight Permit AD',       850.00, 'PER_PERMIT','2025-01-01','2026-12-31'),
('PERMIT',    'Overweight Permit Dubai',   1000.00, 'PER_PERMIT','2025-01-01','2026-12-31'),
('PERMIT',    'Overweight Permit Al Ain',   600.00, 'PER_PERMIT','2025-01-01','2026-12-31'),
('PERMIT',    'Road Closure Permit',       3500.00, 'PER_PERMIT','2025-01-01','2026-12-31'),
('PERMIT',    'Night Movement Permit',     1200.00, 'PER_PERMIT','2025-01-01','2026-12-31'),
('PERMIT',    'Port Entry Permit',          500.00, 'PER_PERMIT','2025-01-01','2026-12-31'),
('PERMIT',    'Site Access Permit ADNOC',  2000.00, 'PER_PERMIT','2025-01-01','2026-12-31'),
('PERMIT',    'Security Gate Pass',         300.00, 'PER_CARD',  '2025-01-01','2026-12-31'),
('PERMIT',    'Hazardous Material Permit',  1800.00, 'PER_PERMIT','2025-01-01','2026-12-31'),
('PERMIT',    'Restricted Area Access',    2500.00, 'PER_PERMIT','2025-06-01','2026-12-31'),

-- ======================================================================
-- ADMIN (DOCUMENTATION) — 10 entries
-- ======================================================================
('ADMIN',     'BL Issuance Fee',            250.00, 'PER_BL',   '2025-01-01','2026-12-31'),
('ADMIN',     'Certificate of Origin',      350.00, 'PER_DOC',  '2025-01-01','2026-12-31'),
('ADMIN',     'Legalization Embassy',      1200.00, 'PER_DOC',  '2025-01-01','2026-12-31'),
('ADMIN',     'Chamber of Commerce Stamp',  450.00, 'PER_DOC',  '2025-01-01','2026-12-31'),
('ADMIN',     'Document Courier Intl',      350.00, 'PER_SHIPMENT','2025-01-01','2026-12-31'),
('ADMIN',     'Document Courier Local',     150.00, 'PER_SHIPMENT','2025-01-01','2026-12-31'),
('ADMIN',     'Manifest Amendment',         500.00, 'PER_AMENDMENT','2025-01-01','2026-12-31'),
('ADMIN',     'BL Surrender Fee',           200.00, 'PER_BL',   '2025-01-01','2026-12-31'),
('ADMIN',     'Translation Service',        300.00, 'PER_PAGE', '2025-01-01','2026-12-31'),
('ADMIN',     'Electronic Data Interchange', 100.00, 'PER_SHIPMENT','2025-01-01','2026-12-31'),

-- ======================================================================
-- PACKING (EXPORT) — 10 entries
-- ======================================================================
('PACKING',   'Standard Export Pallet',     150.00, 'PER_PALLET','2025-01-01','2026-12-31'),
('PACKING',   'Heavy Duty Pallet',          280.00, 'PER_PALLET','2025-01-01','2026-12-31'),
('PACKING',   'ISPM-15 Heat Treatment',     180.00, 'PER_PALLET','2025-01-01','2026-12-31'),
('PACKING',   'Wooden Case Small',          450.00, 'PER_CASE',  '2025-01-01','2026-12-31'),
('PACKING',   'Wooden Case Medium',         850.00, 'PER_CASE',  '2025-01-01','2026-12-31'),
('PACKING',   'Wooden Case Large',         1500.00, 'PER_CASE',  '2025-01-01','2026-12-31'),
('PACKING',   'VCI Wrapping',              350.00, 'PER_UNIT',  '2025-01-01','2026-12-31'),
('PACKING',   'Shrink Wrapping',            120.00, 'PER_PALLET','2025-01-01','2026-12-31'),
('PACKING',   'Vacuum Sealing',             650.00, 'PER_UNIT',  '2025-01-01','2026-12-31'),
('PACKING',   'Desiccant Packing',          200.00, 'PER_PALLET','2025-01-01','2026-12-31'),

-- ======================================================================
-- LASHING (CARGO SECURING) — 10 entries
-- ======================================================================
('LASHING',   'Standard Container Lashing', 350.00, 'PER_CONTAINER','2025-01-01','2026-12-31'),
('LASHING',   'Heavy Cargo Lashing',       1200.00, 'PER_UNIT',     '2025-01-01','2026-12-31'),
('LASHING',   'Breakbulk Lashing',          45.00, 'PER_CBM',      '2025-01-01','2026-12-31'),
('LASHING',   'Flat Rack Securing',         850.00, 'PER_UNIT',     '2025-01-01','2026-12-31'),
('LASHING',   'Chain Lashing Set',          180.00, 'PER_SET',      '2025-01-01','2026-12-31'),
('LASHING',   'Webbing Strap Set',          120.00, 'PER_SET',      '2025-01-01','2026-12-31'),
('LASHING',   'Dunnage Material',           250.00, 'PER_CBM',      '2025-01-01','2026-12-31'),
('LASHING',   'Welding Securing Point',     450.00, 'PER_POINT',    '2025-01-01','2026-12-31'),
('LASHING',   'Lashing Survey',            1800.00, 'PER_JOB',      '2025-01-01','2026-12-31'),
('LASHING',   'Lashing Certificate',        800.00, 'PER_JOB',      '2025-01-01','2026-12-31'),

-- ======================================================================
-- SURVEY — 6 entries
-- ======================================================================
('SURVEY',    'Draft Survey',              2500.00, 'PER_JOB',  '2025-01-01','2026-12-31'),
('SURVEY',    'Cargo Damage Survey',        3200.00, 'PER_JOB',  '2025-01-01','2026-12-31'),
('SURVEY',    'Tally Survey Loading',       1800.00, 'PER_DAY',  '2025-01-01','2026-12-31'),
('SURVEY',    'Tally Survey Discharge',     1800.00, 'PER_DAY',  '2025-01-01','2026-12-31'),
('SURVEY',    'Marine Warranty Survey',    15000.00, 'PER_JOB',  '2025-01-01','2026-12-31'),
('SURVEY',    'Offloading Supervision',    2500.00, 'PER_DAY',  '2025-01-01','2026-12-31'),

-- ======================================================================
-- AGENCY — 4 entries
-- ======================================================================
('AGENCY',    'Shipping Agency Fee',       1200.00, 'PER_CALL',  '2025-01-01','2026-12-31'),
('AGENCY',    'Port Agency Representation', 3500.00, 'PER_MONTH','2025-01-01','2026-12-31'),
('AGENCY',    'Husbandry Services',         2500.00, 'PER_CALL',  '2025-01-01','2026-12-31'),
('AGENCY',    'PDA Processing',            1500.00, 'PER_CALL',  '2025-01-01','2026-12-31'),

-- ======================================================================
-- BAF (BUNKER ADJUSTMENT) — 5 entries
-- ======================================================================
('BAF',       'Asia→UAE BAF Q1 2025',        350.00, 'PER_CONTAINER','2025-01-01','2025-03-31'),
('BAF',       'Asia→UAE BAF Q2 2025',        380.00, 'PER_CONTAINER','2025-04-01','2025-06-30'),
('BAF',       'Asia→UAE BAF Q3 2025',        420.00, 'PER_CONTAINER','2025-07-01','2025-09-30'),
('BAF',       'Asia→UAE BAF Q4 2025',        400.00, 'PER_CONTAINER','2025-10-01','2025-12-31'),
('BAF',       'Europe→UAE BAF',              550.00, 'PER_CONTAINER','2025-01-01','2026-12-31'),

-- ======================================================================
-- WHARFAGE (PORT DUES) — 5 entries
-- ======================================================================
('WHARFAGE',  'Khalifa Port General',        18.00, 'PER_CBM',  '2025-01-01','2026-12-31'),
('WHARFAGE',  'Khalifa Port Container 20FT', 120.00, 'PER_CONTAINER','2025-01-01','2026-12-31'),
('WHARFAGE',  'Khalifa Port Container 40FT', 200.00, 'PER_CONTAINER','2025-01-01','2026-12-31'),
('WHARFAGE',  'Mina Zayed General',          15.00, 'PER_CBM',  '2025-01-01','2026-12-31'),
('WHARFAGE',  'Mina Zayed Container 40FT', 180.00, 'PER_CONTAINER','2025-01-01','2026-12-31');
