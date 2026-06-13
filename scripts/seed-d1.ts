import { execSync } from "node:child_process";
import path from "node:path";

const DB = process.env.D1_DB_NAME ?? "MCP_AUDIT_DB";
const REMOTE = process.argv.includes("--remote");
const DRY_RUN = process.env.SEED_DRY_RUN !== "false";

const seedFiles = [
  path.resolve("seeds/identifier_index.sql"),
  path.resolve("seeds/milestone_event.sql")
];

for (const file of seedFiles) {
  const cmd = [
    "wrangler d1 execute", DB,
    REMOTE ? "--remote" : "--local",
    `--file="${file}"`
  ].join(" ");

  console.log(`[seed] ${DRY_RUN ? "DRY-RUN: " : ""}${cmd}`);
  if (!DRY_RUN) {
    execSync(cmd, { stdio: "inherit" });
  }
}
