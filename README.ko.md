# figma-to-markdown-mcp

언어: [English](./README.md) | [한국어](./README.ko.md)

현재 버전: `2.0.0`

`figma-to-markdown-mcp`는 Figma 링크 워크플로우를 위한 MCP 브리지입니다. 에이전트가 `get_figma_as_markdown`을 호출하면 raw upstream Figma MCP payload 대신 줄여진 Markdown을 받게 됩니다.

## 이 MCP가 하는 일

- 로컬 Figma desktop MCP 서버에서 Figma MCP 컨텍스트를 내부적으로 가져옵니다
- 결과를 호출한 에이전트에게 보내기 전에 압축합니다
- 브리지가 성공한 경우 raw upstream payload를 에이전트 컨텍스트 밖에 유지합니다
- 브리지가 안전하게 fetch 또는 compaction 하지 못하면 일반 Figma MCP로 넘기는 fallback handoff를 반환합니다

## 요구사항

- Figma Desktop
- Figma Desktop에서 Dev Mode 활성화
- Figma Desktop에서 Desktop MCP server 활성화
- Node.js 18+

기본 upstream MCP endpoint:

`http://127.0.0.1:3845/mcp`

다른 endpoint를 쓰려면:

`FIGMA_MCP_URL`

## 설치

```bash
npm install -g figma-to-markdown-mcp
```

## 기본 도구

### `get_figma_as_markdown`

사용자가 Figma 노드 URL을 주고 구현, 점검, 요약을 요청할 때 가장 먼저 사용해야 하는 도구입니다.

파라미터:

- `figma_url`: 필수 전체 Figma 노드 URL. 예: `https://www.figma.com/design/FILE_KEY/FILE_NAME?node-id=NODE_ID&m=dev`
- `include_metadata`: 선택값, 기본 `true`. `get_metadata` 기반의 compact node outline 포함
- `max_output_chars`: 선택값. 명시적으로 output budget을 주고 싶을 때만 사용하세요. 생략하면 브리지가 기본 동작에서 강제 truncation을 하지 않습니다

동작:

- `@https://...` 형태를 포함한 전체 Figma URL을 받을 수 있습니다
- 내부적으로 upstream `get_design_context`와 선택적으로 `get_metadata`를 호출합니다
- raw upstream MCP payload 대신 compacted Markdown을 반환합니다
- 브리지가 실패하면, 같은 노드에 대해 일반 Figma MCP 도구를 직접 쓰라는 fallback handoff를 반환합니다

## 권장 에이전트 동작

1. 프롬프트에 Figma 노드 URL이 있으면 먼저 `get_figma_as_markdown`을 호출합니다.
2. 브리지가 compacted Markdown을 반환하면 그 결과를 기준으로 구현합니다.
3. 브리지가 fallback handoff를 반환하면, 같은 노드에 대해 일반 Figma MCP 도구로 이어서 진행합니다.

## 참고

- 이 서버는 토큰 절감을 우선하지만, 큰 스크린에 대해 기본적으로 출력을 강제로 작게 자르지는 않습니다. `max_output_chars`를 직접 지정한 경우에만 명시적 budget이 적용됩니다.
- agent-aware 저장소 환경을 위해 `AGENTS.md`가 포함되어 있습니다.
- 릴리스 이력은 [CHANGELOG.md](./CHANGELOG.md)에서 볼 수 있습니다.
