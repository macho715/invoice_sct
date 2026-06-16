# Google Vision GCP 인증 및 연결 작업 로그

작성일: 2026-06-15
작업 위치: `C:\Users\jichu\OneDrive\문서\invoice\SCT_ONTOLOGY-main`
대상 프로젝트: `dsv-invoice`
상태: PARTIAL

## 1. 작업 목적

SCT Invoice Audit worker의 Google Vision OCR 경로를 실제 GCP 인증과 연결한다.

목표 범위:

- Python worker가 Google Vision client library를 import할 수 있게 한다.
- 로컬 ADC 인증을 완료한다.
- gcloud CLI 인증을 완료한다.
- `dsv-invoice` project에 필요한 API를 활성화한다.
- OCR용 service account와 기본 IAM 권한을 준비한다.
- 가능하면 GCS bucket 생성과 live OCR smoke까지 진행한다.

## 2. 코드 연결 상태

Google Vision client stub을 실제 GCP client 흐름으로 변경했다.

변경된 주요 동작:

- `VISION_ENABLED=false` 또는 미설정이면 Google client를 만들지 않는다.
- `VISION_ENABLED=true`이면 ADC를 사용해 Vision/Storage client를 초기화한다.
- `start_async_text_detection()`은 GCS PDF/TIFF 입력과 GCS OCR 출력 prefix를 사용한다.
- `get_operation_status()`는 Vision async operation 완료 상태와 output prefix를 읽는다.
- `collect_result()`는 GCS output JSON을 읽고 page count와 평균 confidence를 계산한다.

관련 파일:

```text
apps/worker-py/app/services/vision_client.py
apps/worker-py/app/routes/vision.py
apps/worker-py/app/services/vision_normalizer.py
apps/worker-py/app/services/v_vision_rules.py
apps/worker-py/tests/test_vision_client.py
apps/worker-py/tests/test_vision_normalizer.py
apps/worker-py/tests/test_v_vision_rules.py
```

## 3. 로컬 패키지 설치

Python Google client 패키지를 설치했다.

실행:

```powershell
python -m pip install "google-cloud-vision>=3.7" "google-cloud-storage>=2.16"
```

확인 결과:

```text
google.cloud.vision=installed
google.cloud.storage=installed
google.auth=installed
```

## 4. Google Cloud SDK 설치

초기 상태에서는 `gcloud`가 PATH에 없었다.

설치 시도:

```powershell
winget install --id Google.CloudSDK --exact --silent --accept-package-agreements --accept-source-agreements
```

`winget` 명령은 timeout 되었지만 SDK 파일은 설치되었다.

확인된 경로:

```text
C:\Users\jichu\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd
```

확인된 버전:

```text
Google Cloud SDK 572.0.0
```

## 5. ADC 인증

Python client library용 Application Default Credentials 인증을 완료했다.

실행 방식:

```powershell
gcloud auth application-default login --no-launch-browser
```

브라우저 승인 후 verification code를 gcloud helper에 전달했다.

결과:

```text
Credentials saved to file:
C:\Users\jichu\AppData\Roaming\gcloud\application_default_credentials.json

Quota project "dsv-invoice" was added to ADC.
```

확인:

```powershell
gcloud auth application-default print-access-token
```

결과:

```text
ADC_TOKEN_OK
```

주의:

인증 코드와 access token은 문서에 저장하지 않는다.

## 6. gcloud CLI 인증

관리 명령 실행을 위해 gcloud CLI 인증도 별도로 완료했다.

실행 방식:

```powershell
gcloud auth login --no-launch-browser
```

결과:

```text
You are now logged in as [mscho715@gmail.com].
Your current project is [dsv-invoice].
```

확인:

```powershell
gcloud auth list
gcloud config get-value project
```

결과:

```text
active account: mscho715@gmail.com
project: dsv-invoice
```

## 7. API 활성화

다음 API를 활성화했다.

실행:

```powershell
gcloud services enable vision.googleapis.com iam.googleapis.com cloudresourcemanager.googleapis.com --project dsv-invoice
```

확인된 enabled services:

```text
bigquerystorage.googleapis.com
cloudresourcemanager.googleapis.com
iam.googleapis.com
storage.googleapis.com
vision.googleapis.com
```

## 8. Service Account 생성

OCR worker용 service account를 생성했다.

실행:

```powershell
gcloud iam service-accounts create svc-invoice-parser `
  --project dsv-invoice `
  --display-name "Invoice Parser Vision OCR"
```

생성 결과:

```text
svc-invoice-parser@dsv-invoice.iam.gserviceaccount.com
```

부여한 IAM:

```text
roles/storage.objectViewer
roles/storage.objectCreator
```

확인:

```text
roles/storage.objectCreator  serviceAccount:svc-invoice-parser@dsv-invoice.iam.gserviceaccount.com
roles/storage.objectViewer   serviceAccount:svc-invoice-parser@dsv-invoice.iam.gserviceaccount.com
```

참고:

`roles/vision.user`는 project resource에 지원되지 않아 부여 실패했다.

## 9. 검증 결과

Worker 전체 pytest:

```powershell
cd apps/worker-py
python -m pytest
```

결과:

```text
159 passed in 17.48s
```

추가 구현 후 재검증:

```powershell
cd apps/worker-py
python -m pytest tests/test_v_vision_rules.py tests/test_vision_normalizer.py
python -m pytest
```

결과:

```text
targeted Vision parser tests: 12 passed
worker full tests: 169 passed
```

Python Vision client 초기화 확인:

```powershell
$env:VISION_ENABLED='true'
$env:GOOGLE_CLOUD_PROJECT='dsv-invoice'
python -c "from app.services.vision_client import VisionClient; c=VisionClient(); print('available=', c.available)"
```

결과:

```text
available= True
```

## 10. 차단 지점

GCS bucket 생성에서 billing 미연결로 차단되었다.

실행:

```powershell
gcloud storage buckets create gs://dsv-invoice-source --project dsv-invoice --location=asia-northeast3 --uniform-bucket-level-access
gcloud storage buckets create gs://dsv-invoice-ocr --project dsv-invoice --location=asia-northeast3 --uniform-bucket-level-access
```

실패:

```text
HTTPError 403:
The billing account for the owning project is disabled in state absent.
```

의미:

`dsv-invoice` 프로젝트에 결제 계정이 연결되어 있지 않다.
Billing이 연결되지 않으면 GCS bucket 생성과 Vision OCR live smoke를 진행할 수 없다.

## 11. Billing 스킵 후 진행한 잔여 작업

사용자 결정:

```text
빌링은 나중에 연결한다.
빌링은 스킵하고 잔여 작업을 진행한다.
```

이에 따라 실제 GCS bucket 생성과 Vision async OCR live smoke는 보류했다.
대신 billing 없이 가능한 worker 내부 연결 작업을 완료했다.

추가 구현:

- `v_vision_rules.py` 모듈을 추가했다.
- Google Vision OCR 텍스트를 DSV 파서 규칙으로 변환한다.
- 문서 종류, shipment/container/DO/invoice key, line item, TYPE_B, evidence 후보, parser gate를 산출한다.
- `vision_normalizer.py`가 OCR 텍스트 추출 후 `parse_vision_text()`를 호출하도록 연결했다.
- DSV 규칙 파서 결과는 `dsv_parse_result`에 저장한다.
- 기존 simple evidence 추출은 유지하고, DSV evidence candidate를 추가 병합한다.

검증한 synthetic Vision OCR fixture:

```text
RHS carrier invoice -> CARRIER_RHS / PASS / Inspection / total 136.50
Allied inspection -> PORT_ALLIED / MATCHED_AMOUNT / container + total
BOE customs debit -> BOE_CUSTOMS / AMBER / CUSTOMS_FINAL_REVIEW_REQUIRED
Delivery order -> DELIVERY_ORDER / NOT_APPLICABLE / DO number
Bank/TRN amount exclusion -> only service amount kept
Unknown low confidence -> AMBER
```

## 12. 완료된 항목

```text
[x] Google Cloud SDK 설치 확인
[x] Python google-cloud-vision 설치
[x] Python google-cloud-storage 설치
[x] ADC 인증 완료
[x] gcloud CLI 인증 완료
[x] project dsv-invoice 설정
[x] Vision API 활성화
[x] IAM API 활성화
[x] Cloud Resource Manager API 활성화
[x] service account 생성
[x] storage object viewer/creator 권한 부여
[x] Google Vision client 실제 ADC 초기화 경로 구현
[x] Vision collect 결과 JSON 수집 코드 구현
[x] v_vision_rules.py DSV OCR 규칙 파서 추가
[x] vision_normalizer.py -> v_vision_rules.py 연결
[x] synthetic Vision OCR fixture 테스트 추가
[x] targeted Vision parser tests 12 passed
[x] worker pytest 169 passed
```

## 13. 미완료 항목

```text
[ ] billing account 연결 - 사용자가 나중에 처리
[ ] GCS source bucket 생성 - billing 연결 후 가능
[ ] GCS OCR bucket 생성 - billing 연결 후 가능
[ ] sample PDF 업로드 - bucket 생성 후 가능
[x] /v1/vision/start live smoke
[x] /v1/vision/collect live smoke
[x] 실제 OCR JSON 수집 확인
[ ] 실제 Vision OCR JSON 기반 DSV 규칙 보강 - live sample 수집 후 진행
```

## 14. 다음 실행 명령

Billing 연결 전에는 아래 명령을 실행하지 않는다.
Billing 연결 후 아래부터 이어서 실행한다.

```powershell
$g = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"

& $g storage buckets create gs://dsv-invoice-source `
  --project dsv-invoice `
  --location=asia-northeast3 `
  --uniform-bucket-level-access

& $g storage buckets create gs://dsv-invoice-ocr `
  --project dsv-invoice `
  --location=asia-northeast3 `
  --uniform-bucket-level-access
```

Worker local env 예시:

```powershell
$env:VISION_ENABLED = "true"
$env:GOOGLE_CLOUD_PROJECT = "dsv-invoice"
$env:GCS_SOURCE_BUCKET = "dsv-invoice-source"
$env:GCS_OCR_BUCKET = "dsv-invoice-ocr"
```

## 15. 최종 판정

현재 상태는 PARTIAL이다.

이유:

- 인증, API 활성화, service account 준비는 완료했다.
- Python client는 ADC를 사용해 초기화된다.
- Google Vision OCR 결과를 DSV 규칙 파서로 넘기는 worker 내부 경로는 구현 및 테스트 완료했다.
- billing은 사용자가 나중에 연결하기로 했으므로 GCS bucket 생성과 live OCR smoke는 의도적으로 보류했다.

다음 완료 조건:

```text
Billing account 연결
GCS bucket 생성
sample PDF 업로드
Vision async OCR start/collect 성공
OCR JSON 수집 확인
실제 OCR JSON으로 DSV 규칙 보강
```

## 16. Billing 해결 후 잔여 작업 재시도 기록

재시도일: 2026-06-15

사용자 요청:

```text
빌링문제 해결 나머지 작업 실행
```

현재 세션에서 billing 상태를 다시 확인했다.

실행:

```powershell
gcloud billing projects describe dsv-invoice --format="yaml(billingAccountName,billingEnabled)"
gcloud billing accounts list --format="table(name,displayName,open)"
```

결과:

```text
billingAccountName: ''
billingEnabled: false

ACCOUNT_ID            NAME                  OPEN
010037-E11C63-F4A1CE  My Billing Account 1  False
015332-91D28B-AE1C79  My Billing Account    False
018011-F9E815-C0D01C  내 결제 계정 2        False
018D2A-971531-9142DF  내 결제 계정          False
01E0AE-92607B-4B7216  내 결제 계정 1        False
```

GCS source bucket 생성을 재시도했다.

실행:

```powershell
gcloud storage buckets create gs://dsv-invoice-source `
  --project dsv-invoice `
  --location=asia-northeast3 `
  --uniform-bucket-level-access
```

결과:

```text
Creating gs://dsv-invoice-source/...
ERROR: (gcloud.storage.buckets.create) HTTPError 403:
The billing account for the owning project is disabled in state absent.
```

판정:

```text
NOT DONE
```

이유:

- `dsv-invoice` 프로젝트는 여전히 `billingEnabled: false`이다.
- 현재 계정에서 보이는 billing account는 모두 `OPEN=False`이다.
- 따라서 GCS bucket 생성, sample PDF 업로드, Vision async OCR start/collect smoke는 아직 실행할 수 없다.

다음 조건:

```text
Google Cloud Console에서 열린 billing account를 만들거나 기존 billing account를 다시 열어야 한다.
그 billing account를 dsv-invoice 프로젝트에 연결해야 한다.
그 뒤 이 문서의 14번 bucket 생성 명령부터 다시 실행한다.
```

## 17. 대체 Google Cloud 프로젝트 확인 기록

재확인일: 2026-06-15

사용자가 Google Cloud Console URL을 제공했다.

URL 내 project id:

```text
gen-lang-client-0563280120
```

프로젝트 확인:

```powershell
gcloud projects describe gen-lang-client-0563280120 --format="yaml(projectId,name,projectNumber,lifecycleState)"
```

결과:

```text
lifecycleState: ACTIVE
name: iran
projectId: gen-lang-client-0563280120
projectNumber: '432160104726'
```

Billing 확인:

```powershell
gcloud billing projects describe gen-lang-client-0563280120 --format="yaml(billingAccountName,billingEnabled)"
```

결과:

```text
billingAccountName: billingAccounts/018D2A-971531-9142DF
billingEnabled: false
```

API 확인 및 Vision 활성화:

```powershell
gcloud services list --enabled --project gen-lang-client-0563280120
gcloud services enable vision.googleapis.com --project gen-lang-client-0563280120
```

결과:

```text
storage.googleapis.com enabled
iam.googleapis.com enabled
vision.googleapis.com enable operation finished successfully
```

GCS bucket 생성 재시도:

```powershell
gcloud storage buckets create gs://gen-lang-client-0563280120-dsv-invoice-source `
  --project gen-lang-client-0563280120 `
  --location=asia-northeast3 `
  --uniform-bucket-level-access
```

결과:

```text
ERROR: (gcloud.storage.buckets.create) HTTPError 403:
The billing account for the owning project is disabled in state closed.
```

판정:

```text
NOT DONE
```

의미:

- 대체 프로젝트 `gen-lang-client-0563280120`도 접근은 가능하다.
- Vision API 활성화는 완료했다.
- 하지만 billing account가 closed 상태라 GCS bucket 생성은 실패했다.
- 따라서 이 프로젝트도 현재 상태로는 Vision async PDF OCR smoke에 사용할 수 없다.

## 18. Billing 해결 후 live Vision OCR smoke 완료 기록

실행일: 2026-06-15

사용자 요청:

```text
직접하라
```

Billing account 상태가 열린 상태로 바뀐 것을 확인했다.

실행:

```powershell
gcloud billing accounts list --format="table(name,displayName,open)"
gcloud billing projects link gen-lang-client-0563280120 --billing-account=018D2A-971531-9142DF
gcloud billing projects link dsv-invoice --billing-account=018D2A-971531-9142DF
```

결과:

```text
018D2A-971531-9142DF  내 결제 계정  True

gen-lang-client-0563280120 billingEnabled: true
dsv-invoice billingEnabled: true
```

GCS bucket 생성:

```powershell
gcloud storage buckets create gs://dsv-invoice-source `
  --project dsv-invoice `
  --location=asia-northeast3 `
  --uniform-bucket-level-access

gcloud storage buckets create gs://dsv-invoice-ocr `
  --project dsv-invoice `
  --location=asia-northeast3 `
  --uniform-bucket-level-access
```

결과:

```text
dsv-invoice-source  ASIA-NORTHEAST3  uniformBucketLevelAccess=True
dsv-invoice-ocr     ASIA-NORTHEAST3  uniformBucketLevelAccess=True
```

Bucket-level IAM:

```text
serviceAccount:svc-invoice-parser@dsv-invoice.iam.gserviceaccount.com
roles/storage.objectViewer
roles/storage.objectCreator
```

Smoke input:

```text
local file:
C:\Users\jichu\OneDrive\문서\invoice\SCT_ONTOLOGY-main\dsv docs\dsv docs\HVDC-ADOPT-SCT-0122_DO.pdf

source sha256:
B3988112551C75B6DA072BFD1E8F7014D75A5C15FEF855A1E7ACBA8B5FFA9F36

uploaded object:
gs://dsv-invoice-source/smoke/HVDC-ADOPT-SCT-0122_DO.pdf
```

Vision async OCR 실행:

```text
source_gcs_uri:
gs://dsv-invoice-source/smoke/HVDC-ADOPT-SCT-0122_DO.pdf

output_gcs_prefix:
gs://dsv-invoice-ocr/smoke/20260615-203800/

start_status:
STARTED

poll result:
RUNNING -> RUNNING -> RUNNING -> RUNNING -> DONE
```

OCR output:

```text
gs://dsv-invoice-ocr/smoke/20260615-203800/output-1-to-1.json
gs://dsv-invoice-ocr/smoke/20260615-203800/output-2-to-2.json
gs://dsv-invoice-ocr/smoke/20260615-203800/output-3-to-3.json
gs://dsv-invoice-ocr/smoke/20260615-203800/output-4-to-4.json
```

Collect result:

```text
collect_status: COLLECTED
page_count: 4
confidence: 0.9609
json_count: 4
combined_ocr_json_sha256:
a2d62c12100346fb3cb454b59c536cb97025e4f3e42abc023140ef04a7cbfa10
```

DSV parser smoke summary:

```text
normalizer_page_count: 4
normalizer_confidence: 0.9609
evidence_candidate_count: 39
dsv_doc_type: DELIVERY_ORDER
dsv_parser_verdict: PASS
dsv_type_b: DO
dsv_evidence_status: NOT_APPLICABLE
dsv_line_item_count: 0
dsv_issue_codes: []
```

중요:

- Raw PDF 내용과 raw OCR 텍스트는 콘솔에 출력하지 않았다.
- 출력한 값은 GCS URI, hash, page count, confidence, parser summary뿐이다.
- Delivery Order 문서는 금액 라인 추출 대상이 아니므로 `line_item_count: 0`과 `evidence_status: NOT_APPLICABLE`이 정상이다.

최종 판정:

```text
DONE
```

## 19. FastAPI route-level Vision OCR smoke 완료 기록

실행일: 2026-06-15

목적:

```text
서비스 함수 직접 호출이 아니라 FastAPI route 수준에서
/v1/vision/start 와 /v1/vision/collect 를 live GCP에 연결해 검증한다.
```

실행 조건:

```text
VISION_ENABLED=true
GOOGLE_CLOUD_PROJECT=dsv-invoice
source_gcs_uri=gs://dsv-invoice-source/smoke/HVDC-ADOPT-SCT-0122_DO.pdf
output_gcs_prefix=gs://dsv-invoice-ocr/route-smoke/20260615-204301/
```

실행 방식:

```text
FastAPI TestClient(app)
POST /v1/vision/start
POST /v1/vision/collect repeated polling
```

Start 결과:

```text
start_http_status: 200
start_status: STARTED
operation_name_present: true
error_code: null
```

Collect polling 결과:

```text
poll 1: RUNNING
poll 2: RUNNING
poll 3: RUNNING
poll 4: RUNNING
poll 5: RUNNING
poll 6: COLLECTED
```

Final collect result:

```text
route_smoke_result: PASS
final_status: COLLECTED
page_count: 4
confidence: 0.9609
ocr_json_gcs_uri:
gs://dsv-invoice-ocr/route-smoke/20260615-204301/output-1-to-1.json
```

GCS output 확인:

```text
gs://dsv-invoice-ocr/route-smoke/20260615-204301/output-1-to-1.json
gs://dsv-invoice-ocr/route-smoke/20260615-204301/output-2-to-2.json
gs://dsv-invoice-ocr/route-smoke/20260615-204301/output-3-to-3.json
gs://dsv-invoice-ocr/route-smoke/20260615-204301/output-4-to-4.json
```

주의:

```text
DATABASE_URL is not set; audit logging disabled (fail-soft)
audit_traces insert skipped (no DB pool)
```

위 메시지는 route smoke에서 DB audit logging이 비활성이라는 의미이다.
Vision route 동작 자체는 성공했다.

최종 판정:

```text
DONE
```
