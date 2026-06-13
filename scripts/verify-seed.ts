/**
 * Layer B: Operational seed health check against live D1.
 * Run via: npm run verify:seed
 *
 * Verifies that key HVDC operational data is present in production D1.
 * Exit codes:
 *   0 — all checks pass
 *   1 — one or more checks failed
 */
import { execSync } from "node:child_process";

const DB = "hvdc-mcp-audit";

type Row = Record<string, unknown>;

function d1Query(sql: string): Row[] {
  const out = execSync(
    `npx wrangler d1 execute ${DB} --remote --command "${sql.replace(/"/g, '\\"')}" --json`,
    { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
  );
  const parsed = JSON.parse(out) as Array<{ results: Row[] }>;
  return parsed[0]?.results ?? [];
}

interface SeedCheck {
  label: string;
  sql: string;
  expect: (val: number) => boolean;
  hint: string;
}

const CHECKS: SeedCheck[] = [
  {
    label: "identifier_index seeded (≥100 rows)",
    sql: "SELECT COUNT(*) AS cnt FROM identifier_index",
    expect: (cnt) => cnt >= 100,
    hint: "run: npm run seed:remote",
  },
  {
    label: "milestone_event seeded (≥200 rows)",
    sql: "SELECT COUNT(*) AS cnt FROM milestone_event",
    expect: (cnt) => cnt >= 200,
    hint: "run: npm run seed:remote",
  },
  {
    label: "HVDC-ADOPT shipment_units present (≥100)",
    sql: "SELECT COUNT(*) AS cnt FROM shipment_unit WHERE shipment_unit_id LIKE 'HVDC-ADOPT-%'",
    expect: (cnt) => cnt >= 100,
    hint: "shipment_unit missing HVDC-ADOPT entries — check ops provisioning script",
  },
  {
    label: "M130-M140 team_role_matrix entries present (≥1)",
    sql: "SELECT COUNT(*) AS cnt FROM team_role_matrix WHERE milestone_range = 'M130-M140'",
    expect: (cnt) => cnt >= 1,
    hint: "M130-M140 site role missing — re-run team_role_matrix seed",
  },
  {
    label: "milestone_event has M50_ETD entries (≥1)",
    sql: "SELECT COUNT(*) AS cnt FROM milestone_event WHERE milestone_code = 'M50_ETD'",
    expect: (cnt) => cnt >= 1,
    hint: "No M50_ETD milestones found — check milestone_event seed content",
  },
  {
    label: "receipt_event has data (≥100 rows)",
    sql: "SELECT COUNT(*) AS cnt FROM receipt_event",
    expect: (cnt) => cnt >= 100,
    hint: "receipt_event appears unpopulated — check ops provisioning",
  },
  {
    label: "WH Status Excel cases projected (≥7560)",
    sql: "SELECT COUNT(*) AS cnt FROM shipment_unit WHERE shipment_unit_id LIKE 'WHCASE-%'",
    expect: (cnt) => cnt >= 7560,
    hint: "run: npm run d1:seed-wh-status",
  },
  {
    label: "WH Status Case No identifiers projected (≥7560)",
    sql: "SELECT COUNT(*) AS cnt FROM identifier_index WHERE source_system = 'hvdc_wh_status.xlsx' AND identifier_scheme = 'CASE_NO'",
    expect: (cnt) => cnt >= 7560,
    hint: "run: npm run d1:seed-wh-status",
  },
  {
    label: "WH Status case cards projected (≥7560)",
    sql: "SELECT COUNT(*) AS cnt FROM wh_status_case_card",
    expect: (cnt) => cnt >= 7560,
    hint: "run migrations then: npm run d1:seed-wh-status",
  },
  {
    label: "WH Status case map projected (≥7560)",
    sql: "SELECT COUNT(*) AS cnt FROM ref_case_map WHERE source_file = 'hvdc_wh_status.xlsx'",
    expect: (cnt) => cnt >= 7560,
    hint: "run migrations then: npm run d1:seed-wh-status",
  },
  {
    label: "WH Status canonical events projected (≥20000)",
    sql: "SELECT COUNT(*) AS cnt FROM canonical_shipment_events WHERE source_file = 'hvdc_wh_status.xlsx'",
    expect: (cnt) => cnt >= 20000,
    hint: "run migrations then: npm run d1:seed-wh-status",
  },
  {
    label: "WH Status ingest audit projected (≥1)",
    sql: "SELECT COUNT(*) AS cnt FROM ingest_audit WHERE source_file = 'hvdc_wh_status.xlsx'",
    expect: (cnt) => cnt >= 1,
    hint: "run migrations then: npm run d1:seed-wh-status",
  },
  {
    label: "WH Status row index projected (≥20000)",
    sql: "SELECT COUNT(*) AS cnt FROM row_index WHERE source_file = 'hvdc_wh_status.xlsx'",
    expect: (cnt) => cnt >= 20000,
    hint: "run migrations then: npm run d1:seed-wh-status",
  },
];

let failures = 0;

console.log(`\n[Layer B] HVDC Seed Health Check — ${DB} (remote)\n`);

for (const check of CHECKS) {
  try {
    const rows = d1Query(check.sql);
    const cnt = Number(rows[0]?.cnt ?? 0);
    if (check.expect(cnt)) {
      console.log(`  ✓  ${check.label} (count=${cnt})`);
    } else {
      console.error(`  ✗  ${check.label} (count=${cnt}) — ${check.hint}`);
      failures++;
    }
  } catch (e) {
    console.error(`  ✗  ${check.label} — query error: ${(e as Error).message.slice(0, 100)}`);
    failures++;
  }
}

console.log(`\n─── Summary ───────────────────────────────────────────────────`);
console.log(`  Failures : ${failures} / ${CHECKS.length}`);

if (failures > 0) {
  console.error("\nResult: FAIL — operational data missing or below minimum");
  process.exit(1);
} else {
  console.log("\nResult: PASS — all seed checks satisfied");
  process.exit(0);
}
