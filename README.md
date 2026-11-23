# Jenkins Navigator Chrome Extension

Jenkins 및 기타 도구로 빠르게 이동할 수 있는 Chrome Extension입니다.

## 설치 방법

1. Chrome 브라우저에서 `chrome://extensions/` 로 이동
2. 우측 상단의 "개발자 모드" 활성화
3. "압축해제된 확장 프로그램을 로드합니다" 클릭
4. 이 디렉토리(`chrome-extension`) 선택

## 사용 방법

1. Chrome 툴바의 extension 아이콘 클릭
2. 원하는 서버(V1, V2, V3, V4, L1, E1, C1) 선택
3. 원하는 액션 버튼(config, node, setting, account, trigger) 클릭
4. 자동으로 해당 URL로 이동

## 설정 파일

`config.list` 파일에서 각 서버의 URL과 액션 경로를 설정할 수 있습니다.

```json
{
  "V1": {
    "base": "http://jenkins.rge.com/jenkins",
    "config": "configure",
    "node": "computer",
    ...
  }
}
```

## Job config 비교 (compare)

popup의 `compare` 버튼(config의 `run` 섹션, 값은 임의 문자열 가능)을 누르면 파라미터 창이 뜬다.

```
ACTION=compare_jobconfig
PARAM1=<job URL A>
PARAM2=<job URL B>
```

Execute 하면 각 job의 `<job>/configure` 페이지 DOM을 읽어 `compare_page.html`에서 좌/우 pane으로 항목별 정렬 비교한다 (한 scroll로 동시 스크롤, 차이는 노란 배경+빨간 글씨).
비교 대상: section/chunk 제목, input, checkbox/radio, select, textarea(pipeline script, shell, description 등), SCM, build parameter, trigger 등 configure form의 모든 입력 요소.

보기 방식: `원문으로 비교`(기본, Jenkins configure 원문 형식) / `Table로 비교`(전체 entry) / `Table diff only`.
`▼ diff ▲` 버튼으로 다음/이전 차이로 이동한다.

값이 다른 여러 줄 입력(script, description 등)은 줄 단위 diff block으로 표시된다. block을 click하면 같은 자리·같은 높이에서 바로 편집할 수 있고(click한 줄에 caret), 다른 곳을 click하면 diff를 다시 계산해 표시한다.
원문 view에서 값을 편집한 뒤 각 pane의 `Save`를 누르면 바뀐 항목만 해당 Jenkins job에 저장한다. 로딩 중과 저장 중에만 Save가 비활성화된다.
새 tab이나 기존 job tab이 필요하지 않다. 저장 중에는 비교 화면 안의 처리용 iframe에 실제 Jenkins configure 페이지를 로드하고, Jenkins JS 초기화가 끝나면 변경값만 form에 넣는다.
그 다음 Jenkins 저장 버튼을 누르지 않고, form의 `onsubmit`(`buildFormTree`)으로 json/crumb을 채운 뒤 `configSubmit`에 직접 POST한다. 따라서 Jenkins 버전별 저장 버튼 형태와 관계없이 동작한다.
저장 후 configure를 다시 읽어 바꾼 항목이 실제로 반영됐는지 확인하고 결과를 표시한다. 다시 읽은 값은 다음 저장의 기준값이 된다.
compare 이후 Jenkins에서 원래 값이 바뀐 항목은 덮어쓰지 않으며, 실패 시 이유를 표시한다.
Job Config History도 자동으로 새 tab에 열지 않는다. 필요하면 직접 접근한다. password/hidden 항목은 저장 대상에서 제외된다.
Jenkins의 iframe 차단(`X-Frame-Options`, `Content-Security-Policy`) header는 저장 중인 compare tab의 해당 Jenkins host sub_frame 응답에서만 제거하고, 완료/실패/tab 닫기 시 규칙을 지운다.

## 파일 구조

- `manifest.json` - Extension 설정 파일
- `popup.html` - UI 구조
- `popup.css` - 스타일링
- `popup.js` - 로직 및 이벤트 처리
- `config.list` - 서버 및 액션 URL 설정

## 아이콘 추가

`icon16.png`, `icon48.png`, `icon128.png` 파일을 추가하면 extension 아이콘이 표시됩니다.
