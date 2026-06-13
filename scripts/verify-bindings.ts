/**
 * Layer A: Schema drift + binding existence + migration gap check.
 * Run via: npm run verify:bindings
 * CI: runs on main after test job; requires CF_API_TOKEN.
 *
 * Exit codes:
 *   0 — all checks pass
 *   1 — FAIL (binding missing or undocumented table present)
 *   2 — WARN only (migration gap, non-blocking)
 */
import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const DB = "hvdc-mcp-audit";
const MIGRATIONS_DIR = path.resolve("migrations");

// Tables that must exist (from migration 0001-0004)
const EXPECTED_TABLES = new Set([
  "mcp_audit_logs",
  "mcp_upload_tokens",
  "mcp_uploaded_files",
  "mcp_file_attachments",
  "mcp_write_proposals",
  "identifier_index",
  "milestone_event",
  "team_role_matrix",
  // operations tables documented in 0005 (may not exist yet — soft-warn)
  "shipment_unit",
  "destination_requirement",
  "receipt_event",
  "action_queue",
  "validation_log",
]);

// Tables that are definitively part of CF internal infrastructure — not a drift signal
const CF_INTERNAL = new Set(["d1_migrations", "_cf_KV"]);

type Row = Record<string, unknown>;

function d1Query(sql: string): Row[] {
  const out = execSync(
    `npx wrangler d1 execute ${DB} --remote --command "${sql.replace(/"/g, '\\"')}" --json`,
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
  const parsed = JSON.parse(out) as Array<{ results: Row[] }>;
  return parsed[0]?.results ?? [];
}

function localMigrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

let warnings = 0;
let failures = 0;

function ok(label: string) {
  console.log(`  ✓  ${label}`);
}
function warn(label: string, detail: string) {
  console.warn(`  ⚠  ${label}: ${detail}`);
  warnings++;
}
function fail(label: string, detail: string) {
  console.error(`  ✗  ${label}: ${detail}`);
  failures++;
}

// ─── Stage 1: Binding existence ───────────────────────────────────────────────
console.log("\n[Stage 1] Binding existence");
try {
  const rows = d1Query("SELECT 1 AS alive");
  if (rows.length > 0) {
    ok(`${DB} reachable via --remote`);
  } else {
    fail("D1 binding", "query returned no rows");
  }
} catch (e) {
  fail("D1 binding", `cannot reach ${DB}: ${(e as Error).message.slice(0, 120)}`);
}

// ─── Stage 2: Migration gap ───────────────────────────────────────────────────
console.log("\n[Stage 2] Migration gap (local vs d1_migrations)");
const localMigs = localMigrationNames();
let appliedMigs: string[] = [];
try {
  const rows = d1Query("SELECT name FROM d1_migrations ORDER BY name");
  appliedMigs = rows.map((r) => String(r.name));
} catch {
  warn("d1_migrations", "table not accessible — cannot verify applied migrations");
}

for (const local of localMigs) {
  // CF stores migration names without .sql extension
  const baseName = local.replace(/\.sql$/, "");
  if (!appliedMigs.includes(baseName)) {
    warn("migration not applied remotely", `${local} → run: npx wrangler d1 migrations apply ${DB} --remote`);
  } else {
    ok(`migration applied: ${local}`);
  }
}

// ─── Stage 3: Schema drift ────────────────────────────────────────────────────
console.log("\n[Stage 3] Schema drift (expected tables vs live D1)");
let liveTables: string[] = [];
try {
  const rows = d1Query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  liveTables = rows.map((r) => String(r.name));
} catch (e) {
  fail("sqlite_master", `cannot list tables: ${(e as Error).message.slice(0, 120)}`);
}

// Tables expected but missing
for (const expected of EXPECTED_TABLES) {
  if (!liveTables.includes(expected)) {
    warn("table missing from live D1", `${expected} — check migrations or ops provisioning`);
  } else {
    ok(`table present: ${expected}`);
  }
}

// Tables present but not in EXPECTED_TABLES and not CF internal
const undocumented = liveTables.filter(
  (t) => !EXPECTED_TABLES.has(t) && !CF_INTERNAL.has(t)
);
for (const t of undocumented) {
  fail("undocumented table in live D1", `${t} — add to migrations/ and EXPECTED_TABLES`);
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n─── Summary ───────────────────────────────────────────────────`);
console.log(`  Warnings : ${warnings}`);
console.log(`  Failures : ${failures}`);

if (failures > 0) {
  console.error("\nResult: FAIL — schema drift or binding issue detected");
  process.exit(1);
} else if (warnings > 0) {
  console.warn("\nResult: WARN — migration gap(s) detected (non-blocking)");
  process.exit(2);
} else {
  console.log("\nResult: PASS");
  process.exit(0);
}
