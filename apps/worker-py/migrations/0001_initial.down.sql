-- 0001_initial.down.sql
-- Reverse 0001_initial.sql - drop tables in reverse dependency order

DROP TABLE IF EXISTS approvals;
DROP TABLE IF EXISTS audit_traces;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS source_files;
DROP TABLE IF EXISTS jobs;
