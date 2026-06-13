import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const CORPUS_DIR = path.join(ROOT, "data", "corpus");
const REPORT_PATH = path.join(ROOT, "docs", "traceability", "sct-card", "source-corpus-pii-nda-audit.md");
const GENERATED_AT = new Date().toISOString();

const rawDetectors = [
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

const reviewMarkers = [
  { id: "PII_POLICY_MARKER", label: "PII policy marker", pattern: /\bPII\b|개인정보|phone\/e-mail|phone|e-mail|email/gi },
  { id: "NDA_POLICY_MARKER", label: "NDA/restricted marker", pattern: /\bNDA\b|\bP2\b|confidential|restricted|보안등급|내부 링크|계약 단가/gi },
  { id: "PERSON_NAME_MARKER", label: "person-name evidence marker", pattern: /조직도\s*실명|실명|개인 이름|personnel names/gi }
];

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function countMatches(content, detector) {
  return [...content.matchAll(detector.pattern)].map((match) => ({
    index: match.index ?? 0,
    lineNumber: lineNumberAt(content, match.index ?? 0)
  }));
}

function summarizeByFile(findings) {
  const grouped = new Map();
  for (const finding of findings) {
    const key = `${finding.file}|${finding.detectorId}`;
    const existing = grouped.get(key) ?? {
      file: finding.file,
      detectorId: finding.detectorId,
      label: finding.label,
      count: 0,
      firstLine: finding.lineNumber
    };
    existing.count += 1;
    existing.firstLine = Math.min(existing.firstLine, finding.lineNumber);
    grouped.set(key, existing);
  }
  return [...grouped.values()].sort((a, b) => a.file.localeCompare(b.file) || a.detectorId.localeCompare(b.detectorId));
}

async function main() {
  const entries = await readdir(CORPUS_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(CORPUS_DIR, entry.name))
    .sort((a, b) => a.localeCompare(b));

  const rawFindings = [];
  const markerFindings = [];

  for (const filePath of files) {
    const relativePath = toPosix(path.relative(ROOT, filePath));
    const content = await readFile(filePath, "utf8");

    for (const detector of rawDetectors) {
      for (const match of countMatches(content, detector)) {
        rawFindings.push({
          file: relativePath,
          detectorId: detector.id,
          label: detector.label,
          lineNumber: match.lineNumber
        });
      }
    }

    for (const marker of reviewMarkers) {
      for (const match of countMatches(content, marker)) {
        markerFindings.push({
          file: relativePath,
          detectorId: marker.id,
          label: marker.label,
          lineNumber: match.lineNumber
        });
      }
    }
  }

  const rawSummary = summarizeByFile(rawFindings);
  const markerSummary = summarizeByFile(markerFindings);
  const status = rawFindings.length === 0 ? "PASS_NO_RAW_PATTERN" : "FAIL_RAW_PATTERN";

  const rawRows = rawSummary.length === 0
    ? "| None | None | 0 | None |\n"
    : rawSummary.map((row) => `| ${row.file} | ${row.detectorId} | ${row.count} | ${row.firstLine} |`).join("\n");
  const markerRows = markerSummary.length === 0
    ? "| None | None | 0 | None |\n"
    : markerSummary.map((row) => `| ${row.file} | ${row.detectorId} | ${row.count} | ${row.firstLine} |`).join("\n");

  const report = `# Source Corpus PII/NDA Audit

- generatedAt: ${GENERATED_AT}
- command: npm run audit:source-pii
- scope: data/corpus/*.md
- status: ${status}
- scannedFiles: ${files.length}
- rawFindingCount: ${rawFindings.length}
- reviewMarkerCount: ${markerFindings.length}

## Scope

This audit checks the source corpus that is indexed into the worker assets from \`data/corpus/*.md\`.
It reports raw sensitive patterns as blocking findings and policy/person markers as review inventory.
It does not print raw matched values.

## Raw Sensitive Pattern Findings

| File | Detector | Count | First line |
| --- | --- | ---: | ---: |
${rawRows}
## Review Marker Inventory

These markers indicate where source evidence discusses PII, NDA, or person-name handling.
They are not treated as leakage by themselves.

| File | Marker | Count | First line |
| --- | --- | ---: | ---: |
${markerRows}
## Result

${status === "PASS_NO_RAW_PATTERN"
  ? "No raw email address, UAE phone number, OpenAI token-like secret, or JWT-like token was detected in data/corpus/*.md."
  : "Raw sensitive patterns were detected in data/corpus/*.md. Review and mask before publishing or re-indexing external outputs."}

## Limitations

This audit is regex-based.
It does not prove that every personal name is unnecessary or that every NDA-sensitive concept has been semantically classified.
`;

  await writeFile(REPORT_PATH, report, "utf8");
  console.log(`Source corpus PII/NDA audit: ${status}`);
  console.log(`- scanned files: ${files.length}`);
  console.log(`- raw findings: ${rawFindings.length}`);
  console.log(`- review markers: ${markerFindings.length}`);
  console.log(`- report: ${REPORT_PATH}`);
  if (rawFindings.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
