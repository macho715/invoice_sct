import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "docs", "traceability", "sct-card");
const REPORT_PATH = path.join(OUT_DIR, "pii-nda-scan-report.md");
const GENERATED_AT = new Date().toISOString();

const SCAN_TARGETS = [
  "docs/QA_REPORT.md",
  "docs/plans/sct-ontology-card-upgrade-progress-2026-05-18.md",
  "docs/traceability/sct-card",
  "public/hvdc-answer-widget.html",
  "server/src/generated/widget-html.ts",
  "tests/fixtures/widget-browser-smoke.html"
];

const SKIP_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf"]);
const TEXT_EXTENSIONS = new Set([".html", ".js", ".json", ".md", ".mjs", ".ts", ".txt", ".yml", ".yaml"]);

const detectors = [
  {
    id: "RAW_EMAIL",
    label: "raw email address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
  },
  {
    id: "UAE_PHONE",
    label: "UAE phone number",
    pattern: /\b(?:\+971|00971|971|0)\s*[-.]?\s*(?:2|3|4|5\d|6|7|9)\s*[-.]?\s*\d{3}\s*[-.]?\s*\d{4}\b/g
  },
  {
    id: "OPENAI_TOKEN",
    label: "OpenAI token-like secret",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g
  },
  {
    id: "JWT_TOKEN",
    label: "JWT-like token",
    pattern: /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g
  }
];

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function isAllowedMatch(detectorId, matchText, relativePath, line) {
  const text = matchText.toLowerCase();
  const safeLine = line.toLowerCase();

  if (text.includes("masked-")) return true;
  if (relativePath.endsWith("widget-browser-smoke.html") && safeLine.includes("data:,")) return true;
  if (detectorId === "RAW_EMAIL" && /example\.(com|org|net)$/i.test(matchText)) return true;
  return false;
}

async function collectFiles(targetPath) {
  const absolutePath = path.join(ROOT, targetPath);
  const fileStat = await stat(absolutePath).catch(() => null);
  if (!fileStat) return [];
  if (fileStat.isFile()) return [absolutePath];
  if (!fileStat.isDirectory()) return [];

  const files = [];
  const entries = await readdir(absolutePath, { withFileTypes: true });
  for (const entry of entries) {
    const child = path.join(absolutePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(path.relative(ROOT, child)));
      continue;
    }
    if (entry.isFile()) files.push(child);
  }
  return files;
}

function scanText(content, relativePath) {
  const findings = [];
  const lines = content.split(/\r?\n/);
  for (const detector of detectors) {
    for (const match of content.matchAll(detector.pattern)) {
      const index = match.index ?? 0;
      const lineNumber = content.slice(0, index).split(/\r?\n/).length;
      const line = lines[lineNumber - 1] ?? "";
      const matchText = match[0];
      if (isAllowedMatch(detector.id, matchText, relativePath, line)) continue;
      findings.push({
        detectorId: detector.id,
        label: detector.label,
        relativePath,
        lineNumber,
        preview: line.trim().slice(0, 180)
      });
    }
  }
  return findings;
}

async function main() {
  const discoveredFiles = [];
  for (const target of SCAN_TARGETS) discoveredFiles.push(...await collectFiles(target));
  const uniqueFiles = [...new Set(discoveredFiles)]
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();
      if (SKIP_EXTENSIONS.has(ext)) return false;
      return TEXT_EXTENSIONS.has(ext);
    })
    .sort((a, b) => a.localeCompare(b));

  const allFindings = [];
  for (const file of uniqueFiles) {
    const relativePath = toPosix(path.relative(ROOT, file));
    const content = await readFile(file, "utf8");
    allFindings.push(...scanText(content, relativePath));
  }

  const status = allFindings.length === 0 ? "PASS" : "FAIL";
  const rows = allFindings.length === 0
    ? "| None | None | None | None |\n"
    : allFindings.map((finding) =>
      `| ${finding.detectorId} | ${finding.relativePath}:${finding.lineNumber} | ${finding.label} | ${finding.preview.replace(/\|/g, "\\|")} |`
    ).join("\n");

  const report = `# SCT Card PII/NDA Output Surface Scan

- generatedAt: ${GENERATED_AT}
- command: npm run scan:sct-pii
- status: ${status}
- scannedFiles: ${uniqueFiles.length}
- findingCount: ${allFindings.length}

## Scope

This scanner checks SCT card user-facing output surfaces and generated traceability artifacts.
It intentionally excludes source corpus content and binary artifacts because source evidence can contain raw operational material that must be handled by retrieval-time masking rather than repository-wide deletion.

Scanned targets:

${SCAN_TARGETS.map((target) => `- ${target}`).join("\n")}

## Detectors

- raw email address
- UAE phone number
- OpenAI token-like secret
- JWT-like token

## Findings

| Detector | Location | Label | Preview |
| --- | --- | --- | --- |
${rows}
## Result

${status === "PASS"
  ? "No raw email address, UAE phone number, OpenAI token-like secret, or JWT-like token was found in the scanned SCT output surfaces."
  : "One or more raw sensitive patterns were found. Do not publish the scanned SCT output surfaces until they are masked or removed."}

## Limitations

This is an output-surface scan.
It does not claim that every source corpus or evidence file in the repository is free of PII/NDA material.
`;

  await writeFile(REPORT_PATH, report, "utf8");
  console.log(`SCT PII/NDA output surface scan: ${status}`);
  console.log(`- scanned files: ${uniqueFiles.length}`);
  console.log(`- findings: ${allFindings.length}`);
  console.log(`- report: ${REPORT_PATH}`);
  if (allFindings.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
