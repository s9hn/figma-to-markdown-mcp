# figma-compaction-mcp

Languages: [English](./README.md) | [Korean](./README.ko.md)

Current version: `3.0.0`

`figma-compaction-mcp`는 Figma 링크 기반 작업 흐름을 위한 MCP 서버입니다.  
이 서버는 상위 Figma 디자인 컨텍스트를 내부적으로 가져온 뒤, 이를 compact plain-text context로 정리하고, 전체 상위 payload 대신 축약된 결과를 호출한 에이전트에 반환합니다.

## What It Is

이 프로젝트는 에이전트가 Figma node URL을 기반으로 작업할 때, 브릿지가 요청을 안전하게 처리할 수 있는 경우 원본 Figma MCP 출력 전체가 호출 모델의 컨텍스트에 직접 들어가지 않도록 하려는 팀을 위한 것입니다.

기본 흐름은 다음과 같습니다.

1. 사용자가 에이전트에게 Figma node URL을 제공합니다.
2. 에이전트가 `get_figma_compact_context`를 호출합니다.
3. 이 서버가 내부적으로 상위 Figma 컨텍스트를 가져옵니다.
4. 서버가 상위 결과를 작은 line-based DSL 형태로 압축합니다.
5. 에이전트는 압축된 구현 컨텍스트를 받아 이를 기반으로 작업합니다.

## Why Use It

이 서버를 사용하는 가장 큰 이유는 구현에 중요한 정보를 잃지 않으면서 토큰 사용량을 줄이기 위해서입니다.

원본 Figma MCP 응답은 구현을 시작하기도 전에 호출 모델의 컨텍스트 중 상당 부분을 차지할 만큼 클 수 있습니다.  
이 브릿지는 가능한 경우 상위 payload를 서버 내부에 유지한 상태에서 먼저 압축하고, 축약된 결과만 에이전트에 반환합니다.

주요 장점은 다음과 같습니다.

- Figma 링크 기반 프롬프트의 토큰 사용량 감소
- 구현 시작 전 모델 컨텍스트 점유량 축소
- 에이전트를 위한 더 깔끔한 구현 입력 제공
- 호출 컨텍스트 내 원본 상위 노이즈 감소
- node id, typography token, asset reference, warning, fallback hint 등을 포함한 추적 가능한 출력 제공
- 브릿지가 안전하게 완료할 수 없는 경우를 위한 내장 fallback 경로 제공

## How It Works

이 서버는 에이전트와 로컬 Figma Desktop MCP 서버 사이에서 동작합니다.

```text
User prompt with Figma link
  -> Agent calls get_figma_compact_context
  -> figma-compaction-mcp connects to local Figma Desktop MCP
  -> get_design_context / get_metadata
  -> internal compaction
  -> compact plain-text context returned to the agent
```

공개 진입점은 `get_figma_compact_context`입니다.

- `figma_url`: 필수값, 전체 Figma node URL
- `mode`: 선택값, 압축 모드. `minimal`, `balanced`, `debug` 중 하나
- `task`: 선택값, 작업 의도 힌트. `implement`, `inspect`, `summarize` 중 하나
- `include_assets`: 선택값, 기본값 `true`
- `include_text_specs`: 선택값, 기본값 `true`
- `include_trace_ids`: 선택값, 기본값 `true`
- `include_metadata`: 선택값, 기본값 `true`
- `max_output_chars`: 선택값, 명시적인 출력 길이 예산

브릿지가 성공하면 압축된 plain-text context와 함께 통계, 추적성, 경고, 진단 정보를 담은 구조화 필드를 반환합니다.

브릿지가 node를 안전하게 가져오거나 압축할 수 없는 경우에는 fallback handoff를 반환합니다.  
이 경우 에이전트는 동일한 node에 대해 표준 Figma MCP 도구를 사용해 계속 진행할 수 있습니다.

압축 출력 예시는 다음과 같습니다.

```text
src|figma|get_design_context|4:5100|FILE_KEY
sum|Example screen|frame|375x876|535,258
el|4:5107|field_card|w343;layout:column;r20;p:16,20,20,20;bg:#ffffff
tx|4:5106|Section title|t1
ty|t1|Inter|600|20|24|#333333
as|imgAsset|asset|4:5107|asset_slot|/assets/example-image.png
```

Figma URL 형식 예시는 다음과 같습니다.

`https://www.figma.com/design/FILE_KEY/FILE_NAME?node-id=NODE_ID&m=dev`

## Requirements

Figma 링크 브릿지 흐름을 사용하려면 다음 환경이 필요합니다.

- Figma Desktop
- Figma Desktop에서 Dev Mode 활성화
- Figma Desktop에서 Desktop MCP server 활성화
- Node.js 18 이상

기본 상위 Figma MCP endpoint는 다음과 같습니다.

`http://127.0.0.1:3845/mcp`

다음 환경 변수로 endpoint를 변경할 수 있습니다.

`FIGMA_MCP_URL`

## Installation

전역 설치 방식은 다음과 같습니다.

```bash
npm install -g figma-compaction-mcp
```

또는 `npx`로 실행할 수 있습니다.

```bash
npx figma-compaction-mcp
```

## MCP Client Registration

사용 중인 MCP 클라이언트에 이 서버를 등록합니다.

`npx`를 사용하는 등록 예시는 다음과 같습니다.

```json
{
  "mcpServers": {
    "figma-compaction": {
      "command": "npx",
      "args": ["-y", "figma-compaction-mcp"]
    }
  }
}
```

전역 설치를 사용하는 등록 예시는 다음과 같습니다.

```json
{
  "mcpServers": {
    "figma-compaction": {
      "command": "figma-compaction-mcp",
      "args": []
    }
  }
}
```

사용하는 클라이언트에 따라 JSON, TOML 또는 다른 설정 형식을 사용할 수 있습니다.  
다만 command를 등록하는 기본 방식은 동일합니다.

## How To Use It

사용 절차는 다음과 같습니다.

1. Figma Desktop을 열고 Dev Mode와 desktop MCP server를 활성화합니다.
2. MCP 클라이언트에 `figma-compaction-mcp`를 등록합니다.
3. 에이전트에게 Figma node URL을 제공합니다.
4. 에이전트가 먼저 `get_figma_compact_context`를 호출하도록 합니다.
5. 반환된 압축 컨텍스트를 구현, 검토 또는 요약에 사용합니다.
6. 서버가 fallback handoff를 반환하면 동일한 node에 대해 표준 Figma MCP 도구로 계속 진행합니다.

실무적으로는 다음과 같이 이해하면 됩니다.

- 작거나 중간 규모의 컴포넌트는 보통 압축 컨텍스트를 바로 반환합니다.
- 큰 화면은 유지해야 할 구조, 텍스트, asset이 중요한 경우 더 큰 출력을 반환할 수 있습니다.
- 일반적인 구현 작업에는 `balanced` 모드가 기본값입니다.
- 의도적으로 강한 출력 길이 제한이 필요한 경우에만 `max_output_chars`를 설정하는 것이 좋습니다.

## Limitations

이 서버에는 다음과 같은 제한 사항이 있습니다.

- 최종 도구 라우팅은 여전히 MCP host 또는 에이전트에 따라 달라집니다. 이 서버는 사용 방향을 강하게 안내할 수 있지만, host 측 라우팅을 강제로 덮어쓸 수는 없습니다.
- 브릿지가 요청을 안전하게 완료할 수 없는 경우, 이 서버 응답을 통해 원본 상위 payload를 그대로 전달하지 않고 압축된 fallback handoff를 반환합니다.
- 압축은 구현 관련성을 기준으로 최적화되어 있습니다. 따라서 순수 장식용 wrapper나 chrome 성격의 node는 inspect 중심 흐름이 아닌 경우 가지치기될 수 있습니다.

## Other Information

- Release history: [CHANGELOG.md](./CHANGELOG.md)
- Compact contract draft: [SPEC.md](./SPEC.md)
- Source repository: https://github.com/s9hn/figma-compaction-mcp
- Contributions: GitHub에서 issue와 pull request를 환영합니다.
- Issues: [GitHub Issues](https://github.com/s9hn/figma-compaction-mcp/issues)
- License: MIT