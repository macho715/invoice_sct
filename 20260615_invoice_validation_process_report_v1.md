# HVDC 인보이스 검증 프로세스 보고

- **작성일**: 2026-06-15
- **대상**: SCT Invoice Audit Platform (Samsung C&T HVDC Abu Dhabi)
- **요약**: 업로드(Excel OR PDF) → 파싱 → 다중 검증 → 게이트 판정 → 13-sheet Excel 감사팩 산출 파이프라인이 라이브 동작 중. 이번 세션에 DSV 매트릭스 파서·markitdown 변환을 검증·배선했고, 워커 인증 갭(P1) 1건이 미해결로 표기됨.

---

## 1. 처리 흐름 (Rule #0 — 무조건 최종 Excel 산출)

```
업로드 (Excel 인보이스 OR PDF 증빙, 또는 둘 다)
  ↓ 인보이스 소스 결정 (OR): xlsx/md/txt 있으면 그것 / 없으면 첫 PDF
  ↓ 파싱  (worker-py /v1/parse)
  ↓ 검증 최대화 (14개 MCP 도구)
  ↓ 게이트 판정 (PASS / AMBER / ZERO / FAILED)
  ↓ 13-sheet Excel 감사팩 (worker-py /v1/export) — 무조건 다운로드 가능
```

**Rule #0**: Excel 청구서 단독, PDF 증빙 단독, 또는 둘 다 — 어느 경우든 최종 Excel을 산출한다. 판정이 PASS/AMBER/ZERO 무엇이든 최종 Excel은 항상 나오며, 미검증·위반 항목은 워크북 안에서 표기될 뿐 산출물 제공 자체를 막지 않는다.

## 2. 3-앱 역할 (라이브 상태)

| 앱 | 역할 | 상태 |
|----|------|------|
| **apps/web** (Vercel) | 업로드·오케스트레이션·**최종 감사 판정**·워크북 조립 | ✅ Live (`sct-ontology-invoice-audit.vercel.app`) |
| **apps/worker-py** (Cloud Run) | `/v1/parse`·`/v1/export`·`/v1/notebooklm/run` | ✅ Live (`hvdc-invoice-parser`, `dsv-invoice`/`asia-northeast3`) |
| **markitdown-mcp** (Cloud Run) | PDF→markdown (NotebookLM 1차용, 선택) | ✅ 2026-06-15 배포·검증 |
| apps/mcp-server (Cloud Run) | 외부 클라이언트(ChatGPT/Claude Desktop)용 standalone | ⬜ 미배포 (감사 플로우 불필요) |

## 3. 검증 게이트 10단계 (Track 2)

| # | 게이트 | 판정 |
|---|--------|------|
| 1 | Schema (필수 컬럼·타입) | FAILED 가능 |
| 2 | Numeric Integrity (`qty × rate = amount`) | AMBER |
| 3 | Duplicate Invoice | **ZERO** |
| 4 | Contract Rate (요율카드) | AMBER/ZERO |
| 5 | Shipment Match (job/lane/doc) | AMBER/ZERO |
| 6 | Evidence Required (증빙 PDF) | AMBER |
| 7 | Tax/VAT | AMBER/ZERO |
| 8 | FX Policy (AED/USD) | AMBER |
| 9 | Policy (금지 charge) | **ZERO** |
| 10 | Parser confidence < 0.85 | AMBER + human review |

→ 14개 MCP 도구로 실행 (`packages/tools` 단일 소스): `route_question`, `normalize_invoice_lines`, `check_duplicate_invoice`, `match_shipment_reference`, `check_rate_card(+batch)`, `check_contract_validity`, `check_evidence_required`, `check_tax_vat`, `check_fx_policy`, `check_cost_guard`, `build_validation_explanation`, `classify_type_b`, `check_hs_uae_compliance`, `check_dem_det`.

## 4. 핵심 검증 규칙

- **3-way 정합성**: `Final Subtotal = Line_Audit total = TYPE-B Matrix total` (±0.01) — 불일치 시 FAIL
- **Δ > 2%** → 빨간 하이라이트 + 사유 메모
- **13-sheet 계약**: `00_Decision` → `01_Action_Items` → `02_Final_Recon` → `03_Header_Check` → `04_Line_View` → `05_Duplicate_Check` → `06_Rate_Check` → `07_Tax_FX_Check` → `08_Shipment_Match` → `90_Source_Data` → `91_Audit_Detail` → `92_Evidence_Issues` → `99_Manifest` (순서 고정)
- **판정 → export**: PASS = 최종 승인 워크북 / AMBER = 승인 후 / ZERO = Review Pack (차단 라벨, 다운로드는 항상 가능)
- **통화**: AED/USD만, FX 정책 준수. 숫자 소수점 2자리·천단위 콤마. 날짜 YYYY-MM-DD.

## 5. 이번 세션 검증 결과 (2026-06-15 fresh evidence)

| 항목 | 결과 |
|------|------|
| **Excel → 13-sheet E2E** | ✅ DSV 매트릭스 인보이스 → 13개 charge 라인 분해, recon **PASS 15,339.87 USD** |
| **DSV summary-matrix 파서** | ✅ charge=열·shipment=행 → 라인 분해 (PR #28) |
| **markitdown PDF→md 변환** | ✅ 실측 PASS (`text-pdf-001.pdf` → 인보이스 내용 정확 추출) |
| **테스트 baseline (클린 체크아웃)** | apps/web 167 · apps/worker-py 165 · apps/mcp-server 186 = **518 passing** |

## 6. 알려진 미해결 / 예정 항목

| 항목 | 상태 |
|------|------|
| **⚠ 워커 인증 갭 (P1)** | 워커가 `--allow-unauthenticated` + `PARSER_WORKER_TOKEN` 미검증 + `blob_url` 서버사이드 fetch (SSRF). 문서엔 표기, **실제 하드닝 미적용** |
| 워커 prod `DATABASE_URL` 미설정 | `/health/ready=503` (degraded). parse/export 경로엔 무영향 |
| PDF 단독 라인 실추출 | 🔜 Phase 2.5 (현재 PDF 단독은 0라인 → AMBER 표기) |
| `EXPORT_FAILED` prod | 🔜 워커 `/v1/export` 도달·환경변수 확인 필요 (Rule #0 다운로드 보장 전제) |

## 7. 한 줄 요약

업로드 → 파싱 → 10단계 검증 → 게이트 → 13-sheet Excel의 인보이스 감사 파이프라인이 라이브로 동작하며 Excel E2E·DSV 매트릭스·markitdown 변환까지 실측 검증됨. 잔여 리스크는 워커 공개-인증 갭(P1)과 PDF 단독 라인추출·prod export 환경 2건.

---

*근거: 본 보고의 수치·상태는 2026-06-15 세션에서 직접 실측·배포·테스트로 검증됨 (clean worktree `pytest -q` 165 passed, Cloud Run 배포 로그, convert 스모크 PASS).*
