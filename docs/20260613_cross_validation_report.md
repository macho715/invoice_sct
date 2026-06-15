# Track 1 (shpiment) vs Track 2 (SCT_ONTOLOGY-main) 교차 검증 보고서

> 2026-06-13 · SWARM: SCOUT 5 + REVIEW 3 agents
> 기준: shpiment/DSV_SHIPMENT_FULL_PACKAGE_v3_2_PRO_INTERNAL 9게이트 검증 시스템

## 총평: PARTIAL — 핵심 검증 로직은 존재하나 운영 게이트 6/9 불완전

Track 2는 Track 1의 7개 검증 게이트 중 **3개 완전 구현, 4개 부분 구현, 1개 미구현, 1개 구성 상이**.

---

## 9-Gate Coverage

| # | Gate | Coverage | Gap |
|---|------|----------|-----|
| 1 | Source Audit | **FULL** | — |
| 2 | Contract Audit | **FULL** | check_rate_card dead code (항상 AMBER) |
| 3 | Evidence Audit | **FULL** | — |
| 4 | Final Reconciliation | **PARTIAL** | 3-way tie-out 미존재 (2-way only) |
| 5 | Security/DLP | **PARTIAL** | Export pipe에 DLP 비통합 |
| 6 | HS/UAE Compliance | **PARTIAL** | HS code 분류, BOE valid 미존재 |
| 7 | DEM/DET & Storage | **PARTIAL** | 계산 레이어 없음 (evidence only) |
| 8 | Workbook Contract | **FULL** | 13-sheet ≠ 8-sheet (호환성 갭) |
| 9 | Harness/RTM Release | **MISSING** | 통합 orchestrator 부재 |

---

## CRITICAL 갭 (6건)

| # | 갭 | 위치 | 영향 |
|---|-----|------|------|
| 1 | **Rate lookup dead code** | `check_rate_card.ts:68` — `appliedRate` 항상 null | 모든 rate 체크가 AMBER 반환 |
| 2 | **Evidence confidence 미구현** | `check_evidence_required.ts:35` — `present: []` 하드코딩 | 모든 evidence 체크가 항상 missing |
| 3 | **3-way reconciliation tie-out** | Track 1: Final Subtotal = Line_Audit = TYPE-B (±0.01). Track 2: none | 핵심 회계 검증 부재 |
| 4 | **HS/UAE Customs 미구현** | HS code, BOE, 관세 검증 전무 | 컴플라이언스 리스크 |
| 5 | **DEM/DET 계산 미구현** | free days, per-diem, calendar-day 산정 없음 | 최종 정산 위험 |
| 6 | **DLP export gate 미통합** | DLP scanner 있으나 export 시점 호출 안됨 | PII 유출 가능 |

## HIGH 갭 (8건)

| # | 갭 |
|---|-----|
| 1 | InvoiceHeader/Lines parser 미완성 (shipment_ref, job_number, rate_basis, type_b 미채움) |
| 2 | workbook 13-sheet ≠ 8-sheet (03_Type_B_Summary 누락) |
| 3 | TYPE-B classification MCP 파이프라인 미연결 (harness only) |
| 4 | Numeric integrity verdict 불일치 (worker: AMBER vs MCP: ZERO) |
| 5 | Approval workflow에 dry-run/rollback 부재 |
| 6 | Evidence status completeness check 부재 |
| 7 | workbook sheet order runtime enforcement 부재 (CI only) |
| 8 | Rate card DB seed 부재 (250-record contract 미로딩) |

## MEDIUM 갭 (5건)

| # | 갭 |
|---|-----|
| 1 | PASS WITH WARNINGS verdict tier 부재 |
| 2 | DLP category 커버리지 (16→12, vessel/voyage/approval 누락) |
| 3 | RTM traceability 부재 |
| 4 | Formula-text detection 부재 |
| 5 | Actions default: Track 1 OFF vs Track 2 자동실행 |

---

## 데이터 체인 정렬도

| Chain | 정렬 | Severity |
|-------|------|----------|
| TYPE-B Classification | **MATCH** | LOW |
| Invoice → Parse → Normalized | PARTIAL | HIGH |
| Numeric Integrity | PARTIAL | HIGH |
| Rate Lookup | **DIVERGENT** | CRITICAL |
| Evidence → Confidence | **DIVERGENT** | CRITICAL |
| Workbook Output | DIVERGENT | HIGH |

---

## 권장 조치 순서

1. **P0**: check_rate_card.ts dead code 수정 + rate_cards DB seed (250건)
2. **P0**: check_evidence_required.ts confidence scoring 구현
3. **P1**: Final Reconciliation 3-way tie-out 추가
4. **P1**: numeric_integrity.py verdict를 ZERO로 통일
5. **P1**: DLP scanner를 export pipeline에 통합
6. **P2**: HS/UAE Customs, DEM/DET 계산, Harness orchestrator
