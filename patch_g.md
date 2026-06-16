업로드된 [`graph.html`](sandbox:/mnt/data/graph.html)을 기준으로 확인했습니다. 이 파일은 GitHub 소스 전체가 아니라 Graphify 의존성/커뮤니티 그래프라서 실제 코드 라인 단위 리뷰는 불가능하지만, 인보이스 검증 프로세스와 Vercel 배포 구조에서 보이는 개선 포인트는 꽤 명확합니다.

## 확인된 구조 요약

그래프 기준 전체 규모는 다음과 같습니다.

| 항목                 |                                                                                                             값 |
| ------------------ | ------------------------------------------------------------------------------------------------------------: |
| 노드                 |                                                                                                           677 |
| 엣지                 |                                                                                                           452 |
| 커뮤니티               |                                                                                                           677 |
| 단독/고립 컴포넌트         |                                                                                                            많음 |
| 인보이스 검증 핵심 커뮤니티    | `Domestic Invoice Validator`, `Executed Rate Reference`, `Lane Matcher & Cost Guard`, `Domestic Audit Runner` |
| Vercel/API 핵심 커뮤니티 | `API Routes & Error Codes`, `Vercel Blob & CF MCP Client`, `Job Store & FX Check`, `Workbook Row Zod Schemas` |

그래프상 핵심 연결은 크게 두 덩어리로 분리되어 있습니다.

```text
[업로드/API/Job 처리 영역]
API Routes & Error Codes
  → Vercel Blob & CF MCP Client
  → Job Store & FX Check
  → Workbook Row Zod Schemas

[국내 인보이스 검증 영역]
Domestic Invoice Validator
  → Executed Rate Reference
  → Lane Matcher & Cost Guard
  → Domestic Audit Runner
```

가장 눈에 띄는 연결은 다음입니다.

| 연결                                                       | 엣지 수 | 해석                              |
| -------------------------------------------------------- | ---: | ------------------------------- |
| `Domestic Invoice Validator → Executed Rate Reference`   |   46 | 검증기가 실행 요율 참조에 매우 강하게 의존        |
| `API Routes & Error Codes → Vercel Blob & CF MCP Client` |   12 | API가 Blob 업로드/파일 처리와 밀접         |
| `Workbook Row Zod Schemas → Job Store & FX Check`        |   12 | 엑셀/워크북 입력 스키마가 Job 저장/FX 검증과 연결 |
| `API Routes & Error Codes → Job Store & FX Check`        |    9 | API가 Job 상태 저장을 직접 다룸           |
| `Vercel Blob & CF MCP Client → Job Store & FX Check`     |    8 | Blob 처리 결과가 Job Store로 이어짐      |
| `API Routes & Error Codes → Workbook Row Zod Schemas`    |    8 | API 입력 검증은 어느 정도 분리되어 있음        |

## 핵심 문제 1: 업로드/API 영역과 인보이스 검증 영역이 분리되어 있음

그래프상 `Domestic Invoice Validator`가 `API Routes`, `Job Store`, `Workbook Row Zod Schemas`, `Vercel Blob` 쪽과 직접 연결되어 있지 않습니다.

이게 실제 구조라면 위험합니다.

현재 추정 흐름은 다음에 가까워 보입니다.

```text
파일 업로드 / 워크북 입력
  → API Route
  → Blob 저장
  → Job Store 저장
  → 별도 검증 모듈 또는 수동 실행
```

그런데 검증 결과가 Job 상태, API 응답, 감사 로그, 재시도 로직과 명확히 연결되어 있지 않으면 운영 중 이런 문제가 생길 수 있습니다.

```text
업로드는 성공했지만 검증 상태가 갱신되지 않음
검증 실패 사유가 API 사용자에게 일관되게 전달되지 않음
재시도 시 중복 Job 또는 중복 인보이스 생성
검증 결과와 감사 로그가 불일치
Blob에는 파일이 있는데 DB에는 실패 상태가 없음
```

### 개선안

`invoice-core` 또는 `lib/invoice` 같은 단일 검증 서비스 계층을 만들고, API와 Worker가 모두 같은 함수를 사용하게 하는 것이 좋습니다.

```text
/lib/invoice/
  schema.ts
  validateInvoice.ts
  validationRules/
    requiredFields.ts
    totals.ts
    duplicate.ts
    rateReference.ts
    laneMatcher.ts
    fx.ts
  statusMachine.ts
  auditLog.ts
```

API Route는 검증 세부 규칙을 직접 알지 않고 아래처럼 호출만 해야 합니다.

```ts
const result = await validateInvoice({
  invoice,
  file,
  rateReferenceVersion,
  jobId,
});

await saveValidationResult(jobId, result);
```

## 핵심 문제 2: `Domestic Invoice Validator → Executed Rate Reference` 결합도가 너무 높음

`Domestic Invoice Validator`에서 `Executed Rate Reference`로 향하는 엣지가 46개로 가장 큽니다. 즉, 국내 인보이스 검증기가 실행 요율 참조 구조에 강하게 묶여 있을 가능성이 큽니다.

이 구조는 초기에 빠르게 만들기에는 좋지만, 다음 변경에 취약합니다.

```text
요율표 버전 변경
계약 단가 manifest 변경
Lane 매칭 기준 변경
운임 항목 추가
할증/할인 정책 변경
통화/환율 검증 추가
고객사별 예외 규칙 추가
```

### 개선안

검증기가 요율 데이터 구조를 직접 import해서 비교하지 말고, `RateReferenceProvider` 인터페이스를 두는 것이 좋습니다.

```ts
export interface RateReferenceProvider {
  getExecutedRate(input: {
    vendorId: string;
    laneCode: string;
    serviceCode: string;
    effectiveDate: string;
    currency: string;
  }): Promise<ExecutedRate | null>;
}
```

검증기는 이렇게 사용합니다.

```ts
export async function validateInvoiceAgainstRates(
  invoice: InvoiceInput,
  rateProvider: RateReferenceProvider
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  for (const line of invoice.lines) {
    const rate = await rateProvider.getExecutedRate({
      vendorId: invoice.vendorId,
      laneCode: line.laneCode,
      serviceCode: line.serviceCode,
      effectiveDate: invoice.issueDate,
      currency: invoice.currency,
    });

    if (!rate) {
      issues.push({
        code: "RATE_NOT_FOUND",
        severity: "error",
        message: "No executed rate found for invoice line",
        path: `lines.${line.index}`,
      });
      continue;
    }

    if (line.amountMinor !== rate.amountMinor) {
      issues.push({
        code: "RATE_MISMATCH",
        severity: "error",
        message: "Invoice amount does not match executed rate",
        path: `lines.${line.index}.amountMinor`,
        expected: rate.amountMinor,
        actual: line.amountMinor,
      });
    }
  }

  return issues;
}
```

이렇게 하면 계약 요율표가 v3.1에서 v3.2로 바뀌어도 검증기 전체를 뜯어고치지 않아도 됩니다.

## 핵심 문제 3: 스키마 모듈들이 검증기에 직접 연결되지 않은 것으로 보임

그래프에 `Workbook Row Zod Schemas`, `Export & Invoice Schemas`, `Domestic Sheet Format`이 존재하지만, `Domestic Invoice Validator`와는 직접 연결되어 있지 않습니다.

특히 `Export & Invoice Schemas`와 `Domestic Sheet Format`은 그래프상 고립되어 있습니다. 이게 실제라면 아래 위험이 있습니다.

```text
API 입력 스키마와 검증기 입력 타입이 다름
엑셀 row 기준 필드명과 인보이스 검증 필드명이 다름
Export 결과와 내부 ValidationResult 구조가 다름
테스트에서는 통과하지만 실제 업로드 파일에서 필드 누락 발생
```

### 개선안

입력 스키마를 하나로 통합하는 것이 좋습니다.

```ts
import { z } from "zod";

export const MoneyMinorSchema = z.object({
  amountMinor: z.number().int(),
  currency: z.string().length(3),
});

export const InvoiceLineSchema = z.object({
  lineNo: z.number().int().positive(),
  description: z.string().min(1),
  laneCode: z.string().optional(),
  serviceCode: z.string().optional(),
  quantity: z.number().positive(),
  unitPriceMinor: z.number().int().nonnegative(),
  amountMinor: z.number().int().nonnegative(),
});

export const InvoiceInputSchema = z.object({
  invoiceNumber: z.string().min(1),
  vendorId: z.string().min(1),
  vendorName: z.string().min(1),
  issueDate: z.string().min(1),
  dueDate: z.string().optional(),
  currency: z.string().length(3),
  subtotalMinor: z.number().int().nonnegative(),
  taxMinor: z.number().int().nonnegative(),
  totalMinor: z.number().int().nonnegative(),
  lines: z.array(InvoiceLineSchema).min(1),
});

export type InvoiceInput = z.infer<typeof InvoiceInputSchema>;
```

그리고 API, Worker, 검증기, Export가 모두 이 타입을 공유해야 합니다.

```text
API Route
  → InvoiceInputSchema.parse()

Worker
  → InvoiceInputSchema.parse()

Domestic Invoice Validator
  → InvoiceInput 타입 사용

Export
  → ValidationResult 타입 사용
```

## 핵심 문제 4: Vercel Blob 사용은 좋아 보이나, 업로드 보안 단계가 약할 수 있음

그래프에 `Vercel Blob & CF MCP Client`가 있고 API와 Job Store에 연결되어 있는 점은 좋습니다. Vercel 환경에서는 파일을 로컬 디스크에 저장하면 안 되므로 Blob/S3/R2 계열 외부 저장소를 쓰는 방향이 맞습니다.

다만 그래프상 `DLP Guard & MCP Server`가 고립되어 있습니다. 업로드 파일이 인보이스라면 개인정보, 사업자번호, 계좌번호, 거래처 정보가 포함될 수 있기 때문에 DLP 또는 파일 안전성 검사가 업로드 경로에 붙어야 합니다.

권장 업로드 흐름은 다음입니다.

```text
POST /api/invoices/upload-url
  → 권한 확인
  → 파일 크기/타입 제한
  → Blob 업로드 URL 발급

Client
  → Blob 업로드

POST /api/invoices
  → blobUrl, fileHash, metadata 저장
  → Job 생성
  → status = UPLOADED

Worker
  → Blob에서 파일 읽기
  → PDF/Excel 파싱
  → DLP 검사
  → Zod schema 검증
  → 인보이스 금액/요율 검증
  → Job 상태 업데이트
  → Audit log 저장
```

업로드 시 최소한 아래 필드는 DB에 저장하는 것이 좋습니다.

```text
blob_url
file_name
file_size
content_type
sha256_hash
uploaded_by
uploaded_at
invoice_id
job_id
status
```

파일 해시는 중복 업로드 방지에 중요합니다.

```ts
import crypto from "crypto";

export function createSha256Hash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
```

## 핵심 문제 5: Worker DB Connection Pool이 고립되어 있음

그래프상 `Worker DB Connection Pool`은 큰 커뮤니티인데 연결이 0으로 보입니다. 실제로 사용 중인데 Graphify가 동적 import를 못 잡은 것일 수도 있지만, 확인이 필요합니다.

Vercel/서버리스/Worker 구조에서는 DB 연결 관리가 매우 중요합니다.

위험한 패턴은 다음입니다.

```ts
const client = new DatabaseClient();

export async function handler(req: Request) {
  await client.connect();
  // ...
}
```

요청마다 새 연결이 생기면 Vercel 서버리스 환경에서 DB connection 폭증이 생길 수 있습니다.

### 개선안

DB 클라이언트는 싱글턴 또는 풀링된 클라이언트로 관리해야 합니다.

```ts
declare global {
  // eslint-disable-next-line no-var
  var dbClient: DatabaseClient | undefined;
}

export const db =
  globalThis.dbClient ??
  new DatabaseClient({
    connectionString: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.dbClient = db;
}
```

Prisma를 쓴다면 Vercel에서는 connection pooling 계층을 별도로 고려하는 것이 좋습니다.

## 핵심 문제 6: 검증 상태 머신이 필요함

인보이스 검증은 단순히 `valid: true/false`로 끝내면 안 됩니다. 파일 업로드, 파싱, 스키마 검증, 요율 검증, 감사 로그, 승인/반려가 모두 다른 단계이기 때문입니다.

추천 상태는 다음입니다.

```ts
export type InvoiceJobStatus =
  | "UPLOADED"
  | "PARSING"
  | "PARSE_FAILED"
  | "VALIDATING"
  | "VALIDATION_FAILED"
  | "NEEDS_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "EXPORTED";
```

상태 변경은 아무 곳에서나 직접 업데이트하지 말고 전이 규칙을 둬야 합니다.

```ts
const allowedTransitions: Record<InvoiceJobStatus, InvoiceJobStatus[]> = {
  UPLOADED: ["PARSING", "REJECTED"],
  PARSING: ["VALIDATING", "PARSE_FAILED"],
  PARSE_FAILED: ["PARSING", "REJECTED"],
  VALIDATING: ["APPROVED", "VALIDATION_FAILED", "NEEDS_REVIEW"],
  VALIDATION_FAILED: ["VALIDATING", "REJECTED", "NEEDS_REVIEW"],
  NEEDS_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["EXPORTED"],
  REJECTED: [],
  EXPORTED: [],
};

export function assertCanTransition(
  from: InvoiceJobStatus,
  to: InvoiceJobStatus
): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new Error(`Invalid status transition: ${from} -> ${to}`);
  }
}
```

## 핵심 문제 7: 감사 로그와 재현 가능한 검증 결과가 필요함

`Domestic Audit Runner`가 보이는 것은 좋습니다. 다만 검증기와 감사 실행기가 약하게만 연결되어 있는 것으로 보입니다.

인보이스 검증 결과는 나중에 반드시 재현 가능해야 합니다.

검증 결과에는 최소한 아래 정보가 들어가야 합니다.

```text
invoice_id
job_id
validator_version
rate_manifest_version
executed_rate_snapshot_id
input_file_hash
validation_started_at
validation_finished_at
result_status
issues[]
```

`issues[]`는 문자열 배열보다 구조화된 객체가 좋습니다.

```ts
export type ValidationIssue = {
  code:
    | "REQUIRED_FIELD_MISSING"
    | "TOTAL_MISMATCH"
    | "TAX_MISMATCH"
    | "DUPLICATE_INVOICE"
    | "RATE_NOT_FOUND"
    | "RATE_MISMATCH"
    | "LANE_NOT_FOUND"
    | "FX_RATE_MISSING"
    | "UNSUPPORTED_CURRENCY";
  severity: "error" | "warning" | "info";
  message: string;
  path?: string;
  expected?: unknown;
  actual?: unknown;
};
```

## Vercel 배포 관점 개선점

Vercel에서 이 프로젝트를 안정적으로 운영하려면 아래를 우선 확인해야 합니다.

| 영역           | 권장 사항                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------- |
| 파일 저장        | 로컬 `fs` 영구 저장 금지. Vercel Blob/S3/R2 사용                                                              |
| PDF/Excel 파싱 | 무거운 작업은 API Route 안에서 오래 실행하지 말고 Worker/Queue로 분리                                                   |
| Runtime      | PDF 파싱, Buffer, Node 라이브러리 사용 시 Edge Runtime보다 Node.js Runtime 권장                                   |
| Job 처리       | 업로드 요청은 즉시 Job 생성 후 반환, 검증은 비동기로 처리                                                                 |
| DB 연결        | 서버리스 connection 폭증 방지. Pooling 또는 managed pool 사용                                                   |
| 환경변수         | `BLOB_READ_WRITE_TOKEN`, `DATABASE_URL`, `RATE_MANIFEST_VERSION` 등 Vercel Environment Variables로 관리 |
| 재시도          | Job idempotency key 필요                                                                              |
| 보안           | 파일 크기 제한, MIME 검증, hash 저장, 권한 체크, 감사 로그                                                            |
| 응답 설계        | 검증 실패 사유는 `code`, `field`, `severity` 포함                                                            |

권장 API 구조는 다음입니다.

```text
app/api/invoices/upload-url/route.ts
app/api/invoices/route.ts
app/api/invoices/[invoiceId]/route.ts
app/api/jobs/[jobId]/route.ts
app/api/jobs/[jobId]/retry/route.ts
app/api/admin/invoices/[invoiceId]/approve/route.ts
app/api/admin/invoices/[invoiceId]/reject/route.ts
```

## 테스트 보강 우선순위

현재 그래프 기준으로는 검증 로직이 여러 커뮤니티에 흩어져 있으므로 테스트가 특히 중요합니다.

반드시 필요한 테스트는 다음입니다.

```text
1. 필수 필드 누락
2. subtotal, tax, total 불일치
3. line item 합계 불일치
4. 중복 invoiceNumber
5. 동일 파일 hash 재업로드
6. rate reference 미존재
7. executed rate와 invoice amount 불일치
8. lane code 미매칭
9. 통화/환율 누락
10. dueDate가 issueDate보다 빠른 경우
11. 파싱 실패 시 Job 상태 변경
12. 검증 실패 후 retry
13. 승인/반려 권한 체크
14. 감사 로그 생성 여부
```

예시 테스트입니다.

```ts
describe("validateInvoice", () => {
  it("rejects invoice when total does not match subtotal plus tax", async () => {
    const result = await validateInvoice({
      invoiceNumber: "INV-001",
      vendorId: "VENDOR-1",
      vendorName: "DSV",
      issueDate: "2026-06-16",
      currency: "KRW",
      subtotalMinor: 100_000,
      taxMinor: 10_000,
      totalMinor: 120_000,
      lines: [
        {
          lineNo: 1,
          description: "Freight",
          quantity: 1,
          unitPriceMinor: 100_000,
          amountMinor: 100_000,
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "TOTAL_MISMATCH",
          severity: "error",
        }),
      ])
    );
  });
});
```

## 개선 우선순위

가장 먼저 손대야 할 순서는 아래가 좋아 보입니다.

```text
1. API/Job/Validator를 하나의 명시적 검증 서비스로 연결
2. InvoiceInputSchema, ValidationResult 타입 통합
3. Domestic Invoice Validator와 Executed Rate Reference 결합도 낮추기
4. Blob 업로드 후 fileHash, jobId, status 저장 보장
5. 상태 머신과 감사 로그 추가
6. Worker/Queue 기반 비동기 검증 구조 정리
7. DLP Guard를 업로드/파싱 플로우에 연결
8. Release Gate Rules를 CI 테스트에 실제 연결
9. Vercel 서버리스 DB connection pooling 점검
10. 금액/요율/중복/상태 전이에 대한 단위 테스트 추가
```

## PR 형태로 정리하면

### PR 1: 인보이스 검증 코어 분리

```text
- lib/invoice/schema.ts 추가
- lib/invoice/validateInvoice.ts 추가
- lib/invoice/rules/* 추가
- API Route와 Worker에서 동일한 validateInvoice 사용
- 기존 API 내부 검증 로직 제거
```

### PR 2: Job 상태 머신과 감사 로그 추가

```text
- InvoiceJobStatus 타입 추가
- 상태 전이 규칙 추가
- 승인/반려/retry API에서 상태 전이 검증
- invoice_audit_logs 테이블 추가
```

### PR 3: Vercel Blob 업로드 안정화

```text
- 업로드 URL 발급 API 분리
- Blob metadata 저장
- sha256 fileHash 저장
- 중복 파일 업로드 방지
- 파일 크기/content-type 검증
```

### PR 4: 요율 참조 인터페이스화

```text
- RateReferenceProvider 인터페이스 추가
- DomesticInvoiceValidator에서 직접 rate manifest 접근 제거
- rate manifest version을 ValidationResult에 기록
```

### PR 5: 테스트 및 Release Gate 연결

```text
- vitest/jest 기반 validator unit test 추가
- API route integration test 추가
- Domestic Audit Runner를 CI gate에 연결
- Release Gate Rules가 실제 PR check에서 실행되도록 연결
```

## 결론

현재 그래프만 놓고 보면, 프로젝트는 기능별 모듈은 꽤 잘 나뉘어 있지만 **업로드/API/Job 처리 영역**과 **국내 인보이스 검증 영역**이 느슨하게 분리되어 있고, `Domestic Invoice Validator`가 `Executed Rate Reference`에 과도하게 의존하는 구조로 보입니다.

가장 중요한 개선은 “검증 로직을 더 추가하는 것”보다 먼저, 아래 세 가지입니다.

```text
검증 입력 스키마 통합
검증 결과/상태 저장 표준화
API, Worker, Audit, Export가 같은 검증 코어를 사용하도록 연결
```

실제 저장소 ZIP이나 `app/api`, `lib`, `package.json`, DB schema 파일을 올려주시면 다음 단계로 실제 코드 기준의 수정안과 PR 설명문까지 구체화할 수 있습니다.
