# figma-to-markdown-mcp

언어: [English](./README.md) | [한국어](./README.ko.md)

현재 버전: `2.0.0`

`figma-to-markdown-mcp`는 Figma 링크 기반 작업을 위한 MCP 서버입니다. Figma 디자인 컨텍스트를 서버 내부에서 가져오고 압축한 뒤, 전체 upstream 페이로드 대신 축약된 Markdown을 호출한 에이전트에게 반환합니다.

## 무엇인가요?

이 프로젝트는 에이전트가 Figma 노드 URL을 바탕으로 작업하되, 브리지가 요청을 안전하게 처리할 수 있는 경우에는 호출 모델에 전체 upstream Figma MCP 페이로드를 노출하지 않도록 하기 위한 도구입니다.

의도한 흐름은 단순합니다.

1. 사용자가 에이전트에게 Figma 노드 URL을 전달합니다.
2. 에이전트가 `get_figma_as_markdown`을 호출합니다.
3. 이 서버가 내부적으로 Figma 컨텍스트를 가져옵니다.
4. 서버가 upstream 결과를 압축합니다.
5. 에이전트는 축약된 Markdown을 받아 그 결과를 바탕으로 작업합니다.

## 왜 사용하나요?

이 서버를 사용하는 가장 큰 이유는 토큰 사용량을 줄이기 위해서입니다.

Figma MCP의 원본 응답은 크기가 커서, 실제 구현을 시작하기도 전에 호출 모델의 컨텍스트를 상당 부분 차지할 수 있습니다. 이 브리지는 가능한 경우 upstream 페이로드를 서버 내부에만 보관하고, 먼저 압축한 뒤, 줄어든 결과만 에이전트에게 반환합니다.

- Figma 링크 기반 프롬프트의 토큰 사용량을 줄일 수 있습니다
- 구현을 시작하기 전 모델 컨텍스트가 차지되는 비중을 줄일 수 있습니다
- 에이전트가 구현에 활용하기 좋은 형태로 입력을 정리할 수 있습니다
- 호출 모델의 컨텍스트에 불필요한 upstream 원본 정보가 들어가는 것을 줄일 수 있습니다
- 브리지가 안전하게 처리하지 못하는 경우에도 이어서 작업할 수 있는 fallback 경로가 내장되어 있습니다  

## 동작 방식

이 서버는 에이전트와 로컬 Figma Desktop MCP 서버 사이에서 동작합니다.

```text
Figma 링크가 포함된 사용자 프롬프트
  -> 에이전트가 get_figma_as_markdown 호출
  -> figma-to-markdown-mcp가 로컬 Figma Desktop MCP에 연결
  -> get_design_context / get_metadata 호출
  -> 서버 내부에서 압축
  -> 압축된 Markdown을 에이전트에게 반환
```

공개 진입점은 `get_figma_as_markdown`입니다.

- 필수 입력값: `figma_url`
- 선택 입력값: `include_metadata`
- 선택 입력값: 명확한 출력 길이 제한이 필요할 때 사용하는 `max_output_chars`

브리지가 성공하면 압축된 Markdown을 반환합니다. 브리지가 노드 정보를 안전하게 가져오거나 압축하지 못하면, 에이전트가 기본 Figma MCP 도구로 직접 이어서 진행할 수 있도록 fallback 안내를 반환합니다.

Figma URL 예시:

`https://www.figma.com/design/FILE_KEY/FILE_NAME?node-id=NODE_ID&m=dev`

## 필요 조건

Figma 링크 브리지 흐름을 사용하려면 다음이 필요합니다.

- Figma Desktop
- Figma Desktop에서 Dev Mode 활성화
- Figma Desktop에서 Desktop MCP Server 활성화
- Node.js 18 이상

기본 Figma MCP 연결 주소:

`http://127.0.0.1:3845/mcp`

아래 환경 변수로 연결 주소를 변경할 수 있습니다.

`FIGMA_MCP_URL`

## 설치

전역 설치:

```bash
npm install -g figma-to-markdown-mcp
```

또는 `npx`로 실행:

```bash
npx figma-to-markdown-mcp
```

## MCP 클라이언트 등록

사용 중인 MCP 클라이언트에 이 서버를 등록하세요.

`npx` 사용 예시:

```json
{
  "mcpServers": {
    "figma-to-markdown": {
      "command": "npx",
      "args": ["-y", "figma-to-markdown-mcp"]
    }
  }
}
```

전역 설치 사용 예시:

```json
{
  "mcpServers": {
    "figma-to-markdown": {
      "command": "figma-to-markdown-mcp",
      "args": []
    }
  }
}
```

클라이언트에 따라 JSON, TOML 또는 다른 설정 형식을 사용할 수 있지만, command를 등록한다는 방식은 동일합니다.

## 사용 방법

1. Figma Desktop을 열고 Dev Mode와 Desktop MCP Server를 활성화합니다.
2. MCP 클라이언트에 `figma-to-markdown-mcp`를 등록합니다.
3. 에이전트에게 Figma 노드 URL을 전달합니다.
4. 에이전트가 먼저 `get_figma_as_markdown`을 호출하도록 합니다.
5. 반환된 압축 Markdown을 구현, 점검, 요약에 사용합니다.
6. 서버가 fallback 안내를 반환하면, 같은 노드에 대해 기본 Figma MCP 도구로 이어서 진행합니다.

실제 사용 시에는 다음과 같이 동작합니다.

- 작거나 중간 크기의 컴포넌트는 보통 압축된 Markdown으로 바로 반환됩니다.
- 큰 화면은 필요한 경우 더 긴 출력으로 반환될 수 있습니다.
- `max_output_chars`는 명확한 출력 길이 제한이 필요할 때만 설정하세요.

## 제한 사항

- 최종 도구 라우팅은 MCP host 또는 에이전트에 따라 달라집니다. 이 서버는 사용 방식을 강하게 유도할 수는 있지만, host 측 라우팅을 강제로 바꿀 수는 없습니다.
- 브리지가 요청을 안전하게 처리하지 못하는 경우에는 이 서버 응답을 통해 upstream 원본 페이로드를 그대로 넘기지 않습니다. 대신 간결한 fallback 안내를 반환합니다.

## 기타 정보

- 릴리스 내역: [CHANGELOG.md](./CHANGELOG.md)
- 소스 저장소: https://github.com/s9hn/figma-to-markdown-mcp
- 기여: GitHub에서 이슈와 Pull Request를 환영합니다
- 이슈: [GitHub Issues](https://github.com/s9hn/figma-to-markdown-mcp/issues)
- 라이선스: MIT
