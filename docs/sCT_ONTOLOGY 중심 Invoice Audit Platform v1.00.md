## SCT_ONTOLOGY 중심 Invoice Audit Platform v1.00

---

## 1. Overview

### 1.1 최종 판정

| 항목                 | 판정                                                               |
| ------------------ | ---------------------------------------------------------------- |
| 전체 구현 가능성          | **조건부 가능**                                                       |
| SCT_ONTOLOGY 단독 구현 | **불가 / FAIL**                                                    |
| 권장 구조              | **SCT_ONTOLOGY 단일 판단 MCP + Vercel Orchestrator + Python Worker** |
| MVP 범위             | **Upload → Parse → SCT Validate → JSON Result → XLSX Export**    |
| 실제 배포/runtime 검증   | **아직 미수행 / AMBER**                                               |
| 최종 명칭              | **SCT_ONTOLOGY 중심 Invoice Audit Platform**                       |

### 1.2 문서 확인 결과

기존 문서의 핵심 흐름은 **Upload → Dry-run Audit → AMBER/ZERO → Excel Audit Pack Export**이며, invoice 검증, contract rate 비교, evidence mapping, TYPE-B matrix, final subtotal reconciliation, 8-sheet Excel Audit Pack export가 중심이다. 이 구조는 유지하되, 이번 정정에 따라 **SCT_ONTOLOGY는 파일 수집·PDF/OCR·Excel 생성까지 담당하는 통합 MCP가 아니라 판단 엔진으로 한정**한다. 

### 1.3 구현 가능성 근거

Next.js Route Handler는 `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` 같은 HTTP method handler를 route file에서 만들 수 있으므로 `/api/files/upload`, `/api/invoice-audit/run`, `/api/audit/status`, `/api/export/download` 같은 Vercel API Orchestrator 구현이 가능하다. ([nextjs.org][1])

Vercel Blob은 private/public access를 명시해 파일을 저장할 수 있고, `request.formData()`로 받은 파일을 `put()`으로 private Blob에 저장하는 예제를 제공한다. 다만 Vercel Function의 request/response payload 한도는 **4.5MB**이므로 대용량 invoice/evidence 파일은 Function body에 직접 싣지 않고 Blob upload 구조로 처리해야 한다. ([Vercel][2])

Vercel Python Runtime은 Python Function과 FastAPI dependency 구성을 지원하지만, OCR·장시간 parsing·대형 workbook generation은 Function duration, memory, bundle size 제약을 받을 수 있으므로 Python Worker로 분리한다. Vercel Functions는 응답 지연 시 timeout이 발생할 수 있고, Python Function bundle size도 제한된다. ([Vercel][3])

FastAPI는 `UploadFile` 기반 multipart file upload와 `FileResponse` 기반 file streaming response를 지원하므로 Python Worker에서 parser input과 xlsx export output을 처리할 수 있다. ([fastapi.tiangolo.com][4])

---

## 2. Goals

| No | Goal                        | 완료 기준                                                                                                         |
| -: | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| G1 | Vercel Next.js UI 구축        | 파일 업로드, dry-run 결과, 사용자 승인, export 화면 제공                                                                      |
| G2 | Next.js API Orchestrator 구축 | upload, run, status, download endpoint 동작                                                                     |
| G3 | Private Blob 저장             | 원본 invoice/evidence/supporting docs를 private Blob에 저장                                                         |
| G4 | Python Worker 구축            | parsing, MasterData 생성, JSON result 생성, xlsx export 수행                                                        |
| G5 | SCT_ONTOLOGY 판단 연결          | type_b classify, rate existence check, evidence requirement map, gate check, dry-run validate, audit trace 수행 |
| G6 | MVP audit flow 구현           | `upload → parse → SCT validate → JSON result → xlsx export` end-to-end 완료                                     |
| G7 | AMBER/ZERO gate 구현          | evidence/final subtotal/contract scope 부족 시 PASS 차단                                                           |
| G8 | 8-sheet Audit Pack 생성       | 승인 후 xlsx 다운로드 가능                                                                                             |
| G9 | 실제 runtime 검증               | Vercel deployment + Worker execution + sample file test 완료                                                    |

---

## 3. Scope

### 3.1 In Scope

| Module                   | In Scope                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Vercel Next.js UI        | Upload 화면, Dry-run 결과 화면, JSON result 화면, Export 버튼                                                                  |
| Next.js API Orchestrator | `/files/ingest`, `/invoice-audit/run`, `/audit/status`, `/export/download`                                           |
| Private Blob             | 업로드 원본 파일 저장, file reference 관리                                                                                      |
| DB / Queue               | audit job id, file id, job status, JSONL audit log 관리                                                                |
| Python FastAPI Worker    | invoice parser, evidence parser, MasterData 생성, xlsx export                                                          |
| SCT_ONTOLOGY MCP         | 판단 엔진 역할: TYPE-B classify, rate existence check, evidence requirement map, gate check, dry-run validate, audit trace |
| MVP Input                | `.xlsx`, `.md`, `.txt`                                                                                               |
| MVP Output               | JSON result, 8-sheet Audit Pack `.xlsx`                                                                              |
| Decision Gate            | PASS / AMBER / ZERO                                                                                                  |
| Human Approval           | dry-run 결과 확인 후 xlsx export 허용                                                                                       |
| Audit Trace              | source hash, parser result, SCT validation result, gate result 기록                                                    |

### 3.2 Out of Scope

| 항목                                        | 제외 사유                                 |
| ----------------------------------------- | ------------------------------------- |
| SCT_ONTOLOGY MCP 단독으로 전체 처리               | 파일 수집, PDF/OCR, Excel 생성은 현재 MCP 기능 밖 |
| OCR 이미지 PDF 즉시 MVP 포함                     | 별도 OCR 서비스 필요                         |
| Google Drive folder ingest 즉시 포함          | OAuth/권한 설계 필요                        |
| 자동 이메일/ERP action                         | 승인 gate 없으면 audit 통제 위험               |
| Vercel Function 하나에 OCR/Excel/Drive 전부 포함 | duration, memory, payload risk        |
| Contract rate full table public 노출        | rate leakage risk                     |
| 승인 없는 final export                        | 자동 확정 금지 원칙 위반                        |
| Evidence 없는 PASS                          | false PASS risk                       |

---

## 4. Constraints

### 4.1 기술 제약

| Constraint                    | 적용 규칙                                                             |
| ----------------------------- | ----------------------------------------------------------------- |
| Vercel Function payload 4.5MB | 대용량 파일은 Function body 직접 업로드 금지                                   |
| Vercel Function duration      | OCR, 장시간 parsing, 대형 xlsx export는 Worker에서 처리                     |
| Blob access                   | invoice/evidence는 private Blob 기본                                 |
| Environment Variables 64KB    | token/key만 env에 저장, contract/rate master 원문은 env 저장 금지            |
| FastAPI file handling         | Worker에서 `UploadFile` 또는 Blob reference 기반 처리                     |
| Export response               | Worker에서 xlsx 생성 후 `FileResponse` 또는 Blob 저장 후 signed download 처리 |
| Actual deployment             | 아직 runtime test 미수행이므로 AMBER로 관리                                  |

Vercel environment variables는 deployment 기준 전체 64KB 제한이 있으므로 contract rate JSON, ontology dump, audit rule dump 같은 대형 데이터는 environment variable에 넣지 않는다. ([Vercel][5])

### 4.2 Audit 제약

| Constraint         | 적용 규칙                                        |
| ------------------ | -------------------------------------------- |
| 자동 확정 금지           | dry-run 결과 확인 후 사용자 승인                       |
| Evidence 부족        | PASS 금지, AMBER 또는 ZERO                       |
| Final subtotal 누락  | final approval 차단                            |
| Contract scope 불명확 | AMBER 또는 ZERO                                |
| SCT 판단 결과          | 최종 확정값이 아니라 audit decision input으로 기록        |
| Formula-like text  | xlsx export 시 live formula로 변환 금지            |
| Audit trace        | 판단 근거, source id, confidence, gate result 기록 |

### 4.3 가정

* 가정: SCT_ONTOLOGY의 9개 MCP 함수는 이미 discover된 상태이나, 각 함수의 request/response schema는 별도 확정이 필요하다.
* 가정: MVP input은 사용자가 지정한 `.xlsx/.md/.txt`부터 시작한다.
* 가정(참조 정보로 전환): PDF text extraction은 원래 MVP 이후 Phase 3로 계획되었으나, Python Worker(`apps/worker-py/app/parsers/pdf_text.py`)에 `pdfplumber` 기반으로 이미 완전히 구현 및 가동 검증되어 구현 가능성이 PASS로 확정되었습니다. OCR 이미지 PDF는 별도 OCR 서비스 선정 후 Phase 4에서 처리한다.
* 가정: Google Drive ingest는 OAuth/권한 설계 완료 전까지 MVP 범위에 넣지 않는다.
* 가정: xlsx export는 기존 8-sheet Audit Pack 기준을 따른다.

---

## 5. Phases

### Phase 0. Final Scope Freeze

| 항목            | 내용                                                         |
| ------------- | ---------------------------------------------------------- |
| 목적            | SCT_ONTOLOGY 역할과 Vercel/Worker 책임 경계를 확정                   |
| 상태            | 즉시 수행                                                      |
| Output        | final scope, endpoint list, job flow, schema baseline      |
| Exit Criteria | “SCT 단독 MCP” 표현 제거, “SCT 판단 엔진 + Orchestrator + Worker” 확정 |

#### Phase 0 Tasks

| Task ID | Task            | 완료 기준                                                       |
| ------- | --------------- | ----------------------------------------------------------- |
| P0-T1   | 명칭 확정           | `SCT_ONTOLOGY 중심 Invoice Audit Platform`으로 문서명 확정           |
| P0-T2   | 책임 경계 확정        | SCT = 판단, Vercel = orchestration, Worker = parsing/export   |
| P0-T3   | MVP flow 확정     | `upload → parse → SCT validate → JSON result → xlsx export` |
| P0-T4   | Out of Scope 확정 | OCR, Drive ingest, email/ERP action은 MVP 제외                 |
| P0-T5   | Gate 확정         | PASS / AMBER / ZERO 기준 확정                                   |

---

### Phase 1. Upload + Parse + SCT Validate MVP

| 항목            | 내용                                                             |
| ------------- | -------------------------------------------------------------- |
| 목적            | `.xlsx/.md/.txt` 파일 업로드 후 parser와 SCT validation 결과를 JSON으로 반환 |
| 구현 가능성        | **즉시 가능 / PASS**                                               |
| Output        | uploaded file record, parsed JSON, SCT validation JSON         |
| Exit Criteria | sample `.xlsx/.md/.txt` end-to-end JSON result 생성              |

#### Phase 1 Tasks

| Task ID | Task                   | 완료 기준                                          |
| ------- | ---------------------- | ---------------------------------------------- |
| P1-T1   | Upload UI 구현           | 사용자가 파일 선택 후 audit job 생성 가능                   |
| P1-T2   | Private Blob upload 구현 | 원본 파일이 private Blob에 저장                        |
| P1-T3   | Audit job 생성           | job id, file id, status 저장                     |
| P1-T4   | Parser call 구현         | Worker가 Blob reference를 읽어 structured JSON 생성  |
| P1-T5   | SCT validate call 구현   | parsed JSON을 SCT_ONTOLOGY MCP로 전달              |
| P1-T6   | JSON result 저장         | validation result, gate result, trace 저장       |
| P1-T7   | Status API 구현          | job status polling 가능                          |
| P1-T8   | Error handling         | parser fail, SCT fail, timeout을 AMBER/FAIL로 기록 |

---

### Phase 2. 8-Sheet XLSX Export

| 항목            | 내용                                                          |
| ------------- | ----------------------------------------------------------- |
| 목적            | SCT validation 결과와 audit trace를 8-sheet Audit Pack으로 export |
| 구현 가능성        | **가능 / PASS**                                               |
| Output        | `.xlsx` Audit Pack                                          |
| Exit Criteria | 승인 후 xlsx download 가능                                       |

#### Phase 2 Tasks

| Task ID | Task                     | 완료 기준                               |
| ------- | ------------------------ | ----------------------------------- |
| P2-T1   | Export schema 확정         | 8개 sheet column 확정                  |
| P2-T2   | Worker xlsx generator 구현 | JSON result → workbook 변환           |
| P2-T3   | Formula text protection  | formula-like text를 문자열로 보존          |
| P2-T4   | Export route 구현          | `/export/download`에서 xlsx 반환        |
| P2-T5   | Approval gate 연결         | 승인 전 export 차단                      |
| P2-T6   | Export audit log         | export time, job id, approved_by 기록 |
| P2-T7   | Regression test          | 동일 input 재실행 시 동일 total/result 생성   |

#### 8-Sheet Audit Pack

| No | Sheet                |
| -: | -------------------- |
|  1 | `00_Decision`        |
|  2 | `01_Action_Items`    |
|  3 | `02_Final_Recon`     |
|  4 | `03_Type_B_Summary`  |
|  5 | `04_Line_View`       |
|  6 | `90_Source_Data`     |
|  7 | `91_Audit_Detail`    |
|  8 | `92_Evidence_Issues` |

---

### Phase 3. PDF Text Extraction

| 항목            | 내용                                                 |
| ------------- | -------------------------------------------------- |
| 목적            | text-based PDF invoice/evidence를 parser input으로 추가 |
| 구현 가능성        | **가능 / PASS (구현 완료)**                           |
| Output        | PDF text/table candidate JSON                      |
| Exit Criteria | text PDF에서 invoice/evidence fields 추출              |

> **구현 현황**: `pdfplumber`를 이용한 PDF 파싱 모듈이 Python Worker (`apps/worker-py/app/parsers/pdf_text.py`)에 이미 완전히 구현되어 연동 검증이 완료되었습니다. 자세한 구현 정보는 코드를 참조해 주십시오. (기존 Phase 3 설계 상의 가정은 코드 구현 검증용 참조 정보로 격하됨)


#### Phase 3 Tasks

| Task ID | Task               | 완료 기준                                      |
| ------- | ------------------ | ------------------------------------------ |
| P3-T1   | PDF file type 허용   | upload validation에 PDF 추가                  |
| P3-T2   | Text extraction 구현 | text PDF에서 raw text 추출                     |
| P3-T3   | Table candidate 생성 | amount/ref/date/line item 후보 생성            |
| P3-T4   | SCT validation 연결  | PDF parser result를 SCT validate input으로 전달 |
| P3-T5   | Low confidence 처리  | confidence 낮으면 AMBER                       |
| P3-T6   | Trace 저장           | PDF page, text block, extracted field 기록   |

---

### Phase 4. OCR 이미지 PDF

| 항목            | 내용                                   |
| ------------- | ------------------------------------ |
| 목적            | scanned PDF/image invoice 처리를 추가     |
| 구현 가능성        | **별도 OCR 서비스 필요 / AMBER**            |
| Output        | OCR line/block/table JSON            |
| Exit Criteria | OCR confidence 기반 AMBER/ZERO gate 동작 |

#### Phase 4 Tasks

| Task ID | Task                | 완료 기준                               |
| ------- | ------------------- | ----------------------------------- |
| P4-T1   | OCR 서비스 선정          | OCR provider 또는 local OCR worker 결정 |
| P4-T2   | OCR queue 처리        | 장시간 OCR job 비동기 처리                  |
| P4-T3   | Confidence 저장       | field-level confidence 저장           |
| P4-T4   | Low confidence gate | confidence 기준 미달 시 PASS 차단          |
| P4-T5   | Human review 연결     | OCR 불확실 항목 action item 생성           |

---

### Phase 5. Google Drive Folder Ingest

| 항목            | 내용                                     |
| ------------- | -------------------------------------- |
| 목적            | Drive folder에서 invoice/evidence 파일을 수집 |
| 구현 가능성        | **OAuth/권한 설계 후 가능 / AMBER**           |
| Output        | Drive ingest job                       |
| Exit Criteria | 승인된 folder에서만 file ingest 가능           |

#### Phase 5 Tasks

| Task ID | Task                 | 완료 기준                              |
| ------- | -------------------- | ---------------------------------- |
| P5-T1   | OAuth scope 정의       | 필요한 최소 권한 확정                       |
| P5-T2   | Folder permission 검토 | 접근 가능한 folder만 ingest              |
| P5-T3   | Ingest mapping       | Drive file → source_file record 생성 |
| P5-T4   | Duplicate detection  | sha256 또는 file id 기준 중복 방지         |
| P5-T5   | Ingest audit log     | 누가, 언제, 어떤 folder에서 가져왔는지 기록       |

---

### Phase 6. Automatic Email / ERP Action

| 항목            | 내용                         |
| ------------- | -------------------------- |
| 목적            | 자동 email/ERP action 가능성 검토 |
| 구현 가능성        | **MVP 제외**                 |
| 적용 조건         | 별도 승인 gate 필수              |
| Exit Criteria | 현재 없음                      |

#### Phase 6 Tasks

| Task ID | Task             | 완료 기준                               |
| ------- | ---------------- | ----------------------------------- |
| P6-T1   | MVP 제외 기록        | 자동 email/ERP action이 기본 동작에 포함되지 않음 |
| P6-T2   | 승인 gate 조건 기록    | 향후 포함 시 human approval mandatory    |
| P6-T3   | Action log 기준 작성 | 실제 외부 action 수행 전 별도 설계 필요          |

---

## 6. Tasks

### 6.1 System Flow Tasks

| Step | Component                | Task              | Output              |
| ---: | ------------------------ | ----------------- | ------------------- |
|    1 | Vercel UI                | 파일 업로드            | selected files      |
|    2 | Next.js API Orchestrator | audit job 생성      | job id              |
|    3 | Private Blob             | 원본 파일 저장          | blob reference      |
|    4 | DB / Queue               | processing job 등록 | status = queued     |
|    5 | Python Worker            | parser 실행         | parsed JSON         |
|    6 | SCT_ONTOLOGY MCP         | validation 실행     | SCT result JSON     |
|    7 | Next.js API Orchestrator | result 저장/조회      | job result          |
|    8 | Vercel UI                | dry-run 결과 표시     | PASS / AMBER / ZERO |
|    9 | User Approval            | export 승인         | approved status     |
|   10 | Python Worker            | xlsx 생성           | 8-sheet Audit Pack  |
|   11 | API Download             | xlsx 반환           | downloaded file     |

### 6.2 API Tasks

| Method | Endpoint                 | 목적                                | MVP 포함       |
| ------ | ------------------------ | --------------------------------- | ------------ |
| POST   | `/api/files/ingest`      | 파일 업로드 job 생성 및 Blob reference 저장 | Yes          |
| POST   | `/api/invoice-audit/run` | parser + SCT validate 실행 요청       | Yes          |
| GET    | `/api/audit/status`      | job status 조회                     | Yes          |
| GET    | `/api/audit/result`      | JSON result 조회                    | Yes          |
| POST   | `/api/audit/approve`     | 사용자 승인                            | Yes          |
| GET    | `/api/export/download`   | xlsx 다운로드                         | Yes          |
| GET    | `/api/audit/trace`       | audit trace 조회                    | Yes          |
| POST   | `/api/drive/ingest`      | Drive folder ingest               | No / Phase 5 |

### 6.3 Worker Tasks

| Worker Task             | 설명                               | Output            |
| ----------------------- | -------------------------------- | ----------------- |
| `parse_xlsx`            | invoice/evidence xlsx parser     | normalized JSON   |
| `parse_md_txt`          | md/txt evidence parser           | text-derived JSON |
| `build_masterdata`      | parser result를 MasterData 형태로 변환 | MasterData JSON   |
| `call_sct_validate`     | SCT_ONTOLOGY MCP 호출              | validation JSON   |
| `build_decision`        | PASS/AMBER/ZERO 결정               | decision JSON     |
| `build_audit_pack_xlsx` | 8-sheet workbook 생성              | `.xlsx`           |
| `write_jsonl_log`       | audit trace append               | JSONL log         |

### 6.4 SCT_ONTOLOGY Tasks

| SCT Function Group         | 역할                         | 결과                   |
| -------------------------- | -------------------------- | -------------------- |
| `type_b classify`          | charge/type classification | TYPE-B result        |
| `rate existence check`     | contract/rate 존재 여부 확인     | rate status          |
| `evidence requirement map` | 필요한 evidence 정의            | evidence requirement |
| `gate check`               | PASS/AMBER/ZERO 판단         | gate result          |
| `dry-run validate`         | 확정 전 검증                    | dry-run result       |
| `audit trace`              | 판단 근거 기록                   | trace entry          |

가정: 현재 문서에는 “9개 MCP 함수 discover 완료”로 되어 있으나, 함수명·parameter·return schema는 final implementation 전에 별도 schema freeze가 필요하다.

### 6.5 Data Tasks

| Entity                  | 필수 필드                                                       |
| ----------------------- | ----------------------------------------------------------- |
| `audit_job`             | job_id, status, verdict, created_at, approved_at            |
| `source_file`           | file_id, job_id, file_type, blob_ref, sha256, parser_status |
| `parse_result`          | job_id, file_id, parsed_json, confidence, parser_version    |
| `sct_validation_result` | job_id, sct_result_json, gate_result, reason                |
| `audit_trace`           | job_id, step, input_ref, output_ref, timestamp              |
| `export_file`           | job_id, xlsx_blob_ref, generated_at, approved_by            |

---

## 7. Risks

| Risk                      | Status     | 원인                                    | 영향                      | 대응                               |
| ------------------------- | ---------- | ------------------------------------- | ----------------------- | -------------------------------- |
| SCT_ONTOLOGY 단독 구현 시도     | ZERO       | MCP 기능 범위 밖 작업 포함                     | 파일/OCR/Excel 처리 불가      | SCT는 판단 엔진으로 한정                  |
| Vercel Function 하나에 전체 처리 | AMBER      | payload/duration/memory 제약            | timeout, 413, export 실패 | Worker 분리                        |
| 실제 배포 미검증                 | AMBER      | repo 생성·deploy·runtime test 미수행       | 운영 가능성 미확정              | Phase 1에서 runtime smoke test     |
| OCR 이미지 PDF               | AMBER      | 별도 OCR 필요                             | 낮은 정확도, 장시간 처리          | Phase 4로 분리                      |
| Google Drive ingest       | AMBER      | OAuth/권한 복잡                           | 접근 실패, 권한 과다            | Phase 5로 분리                      |
| Evidence 부족               | ZERO 가능    | supporting docs 누락                    | false PASS              | PASS 차단, action item 생성          |
| Final subtotal 누락         | ZERO 가능    | invoice subtotal 추출 실패                | recon 불가                | final approval 차단                |
| Contract scope 불명확        | AMBER/ZERO | rate existence 확인 불가                  | 과지급/오판                  | SCT gate에서 검토 필요 처리              |
| xlsx formula 변환           | AMBER      | formula-like text가 live formula로 변환   | export integrity 훼손     | text-preserve export             |
| DLP leakage               | ZERO 가능    | rate table, TRN, BL, BOE, email 원문 노출 | 보안 사고                   | masking, private Blob, trace 최소화 |

---

## 8. Review Criteria

### 8.1 MVP Acceptance Criteria

| No | Test                    | PASS 기준                                                   |
| -: | ----------------------- | --------------------------------------------------------- |
|  1 | Upload `.xlsx/.md/.txt` | Private Blob 저장, job id 생성                                |
|  2 | Parse                   | structured JSON 생성                                        |
|  3 | SCT validate            | SCT_ONTOLOGY result JSON 반환                               |
|  4 | JSON result             | UI/API에서 result 조회 가능                                     |
|  5 | AMBER/ZERO              | evidence/final subtotal/contract issue 발생 시 PASS 차단       |
|  6 | Approval                | 사용자 승인 전 xlsx export 불가                                   |
|  7 | XLSX export             | 8-sheet Audit Pack 생성                                     |
|  8 | Audit trace             | source file id, parser output, SCT result, gate result 기록 |
|  9 | Error handling          | parser fail/SCT fail/timeout이 silent fail 되지 않음           |
| 10 | Runtime test            | Vercel deploy + Worker call + sample file E2E 실행          |

### 8.2 Gate Criteria

| Gate         | PASS                                          | AMBER                               | ZERO                                      |
| ------------ | --------------------------------------------- | ----------------------------------- | ----------------------------------------- |
| File Upload  | file stored, hash created                     | unsupported but recoverable format  | no file / corrupted upload                |
| Parse        | required fields extracted                     | partial extraction / low confidence | no usable data                            |
| SCT Validate | classification and evidence requirement clear | ambiguous rate/evidence/type        | SCT unavailable or required logic missing |
| Evidence     | required evidence matched                     | partial evidence                    | required evidence missing                 |
| Final Recon  | subtotal tie-out                              | small variance / review needed      | final subtotal missing                    |
| Export       | approved and generated                        | generated with warnings             | approval missing                          |

---

## 9. Deliverables

| Deliverable                      | 내용                                                                | 완료 기준                                 |
| -------------------------------- | ----------------------------------------------------------------- | ------------------------------------- |
| D1. Final PLAN                   | 본 문서                                                              | SCT 단독 불가 / Orchestrator+Worker 구조 반영 |
| D2. Scope Baseline               | In Scope / Out of Scope                                           | MVP 범위 고정                             |
| D3. Architecture Spec            | Vercel UI, API Orchestrator, Blob, DB/Queue, Worker, SCT_ONTOLOGY | 책임 경계 명확                              |
| D4. API Spec                     | ingest, run, status, result, approve, download, trace             | endpoint 정의 완료                        |
| D5. Worker Spec                  | parser, SCT call, JSON result, xlsx export                        | task contract 정의                      |
| D6. SCT Contract Spec            | function group, input/output schema                               | schema freeze 가능 상태                   |
| D7. MVP Implementation           | `.xlsx/.md/.txt` upload → parse → SCT validate → JSON result      | E2E sample PASS                       |
| D8. XLSX Export                  | 8-sheet Audit Pack                                                | 승인 후 다운로드 가능                          |
| D9. AMBER/ZERO Log               | gate result, reason, action item                                  | false PASS 차단                         |
| D10. Runtime Verification Report | Vercel deploy, Worker call, sample audit run                      | 실제 구현 가능성 검증 완료                       |

---

## 최종 확정 문장

**C안은 구현 가능하다. 단, 확정 구조는 “SCT_ONTOLOGY 통합 MCP”가 아니라 “SCT_ONTOLOGY 중심 Invoice Audit Platform”이며, SCT_ONTOLOGY는 판단 엔진으로 유지하고 Vercel Orchestrator와 Python Worker가 파일 업로드·파싱·상태관리·xlsx export를 담당한다.**

[1]: https://nextjs.org/docs/app/api-reference/file-conventions/route "File-system conventions: route.js | Next.js"
[2]: https://vercel.com/docs/vercel-blob/using-blob-sdk "@vercel/blob"
[3]: https://vercel.com/docs/functions/limitations "Vercel Functions Limits"
[4]: https://fastapi.tiangolo.com/tutorial/request-files/ "Request Files - FastAPI"
[5]: https://vercel.com/docs/environment-variables "Environment variables"
