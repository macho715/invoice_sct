# shpiment 원본 동기화 계획

## Phase 1: Business Review

### 1.1 문제 정의

현재 상태: `SCT_ONTOLOGY-main/scripts/shpt_v3_harness`에는 `shpiment` 원본 로직이 일부 복사되어 있지만 4개 파일이 원본과 다르다.

목표 상태: 실행 호환성을 해치지 않는 범위에서 원본과 동일하게 맞출 파일을 확정하고, 차이가 필요한 파일은 의도된 SCT адаптация로 남긴다.

영향 범위:
- 비교 대상 파일: 4개
- 실제 로직 차이: 3개
- 줄바꿈만 다른 파일: 1개
- 단독 harness 검증 영향: 있음

### 1.2 제안 옵션

| 옵션 | 설명 | 공수(일) | 리스크 | 비용(AED) |
|------|------|---------|--------|----------|
| A | 4개 파일 모두 `shpiment` 원본과 동일하게 덮어쓴다. | 0.25 | SCT 컬럼명 허용, 평평한 harness 경로 호환성 손실 가능 | 0 |
| B | `dlp_scan.py`와 `TYPE_B_Rules_v3.1_PRO.csv`만 원본과 동일하게 맞추고, `harness_validate_package.py`, `workbook_output_validate.py`는 SCT 호환 변경으로 유지한다. | 0.25 | 원본과 100% 동일 상태는 아님 | 0 |
| C | 파일은 수정하지 않고 차이 사유 문서만 남긴다. | 0.1 | 이후 재검증 때 계속 불일치로 표시됨 | 0 |

### 1.3 추천 & 근거

추천: 옵션 B.

원본과 동일하게 맞출 파일:
- `scripts/shpt_v3_harness/dlp_scan.py`
- `scripts/shpt_v3_harness/rules/TYPE_B_Rules_v3.1_PRO.csv`

유지할 파일:
- `scripts/shpt_v3_harness/harness_validate_package.py`: SCT의 평평한 폴더 구조 실행을 위해 경로 fallback이 필요하다.
- `scripts/shpt_v3_harness/workbook_output_validate.py`: SCT workbook 컬럼명과 PDF source_data 행 수 차이를 허용하기 위해 완화가 필요하다.

롤백 전략: 변경 전 `git diff --no-index` 결과와 Git 상태를 기준으로 두 파일만 되돌린다.

### 1.4 승인 요청

[ ] Phase 1 승인
