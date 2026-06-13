# Route Decision

## 권장 구조

OpenAPI:

```yaml
servers:
  - url: https://hvdc-ontology-chatgpt-app.mscho715.workers.dev
paths:
  /ontology/resolve:
```

실제 호출 URL:

```text
https://hvdc-ontology-chatgpt-app.mscho715.workers.dev/ontology/resolve
```

## Worker alias

Worker는 아래 두 경로를 모두 지원합니다.

```text
POST /ontology/resolve (Legacy / Deprecated)
POST /mcp/ontology/resolve (Recommended)
```

따라서 기존 GPT Action이 `/ontology/resolve`를 호출해도 성공하지만, 이 경로는 legacy로 분류되어 추후 제거될 수 있으므로 신규 구현 및 연동 시에는 `/mcp/ontology/resolve`를 사용할 것을 적극 권장합니다.
