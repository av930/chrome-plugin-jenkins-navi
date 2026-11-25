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

## Job 검색 (search)

config의 `run` 섹션에서 값이 `Config`, `Log`, `Name` 중 하나인 버튼(예: `"search": "Config"`)을 누르면 검색 창이 뜬다. 값은 `Action`의 default가 된다. `Action` 값은 대소문자와 앞뒤 공백/따옴표를 가리지 않는다(`log`, `NaMe`, `"Config" ` 모두 가능).

```
Action=Config          #[Config|Log|Name|History]
SearchPattern=""        #Regexp(ex: .*_build)
FilterIn=""             #Regexp(ex1:^trigger_*(di|ci)_release, ex2: 27~36|~36|27~ )
```

Execute 하면 job을 trigger하지 않고 창을 연 시점의 현재 page를 대상으로 직접 검색한다.

- 현재 page가 view/folder: 보이는 모든 job이 대상. `FilterIn`은 job name RegExp (비우면 전체).
- 현재 page가 job/build: 해당 job이 대상. `FilterIn`은 build 범위 (`27~36`, `~36`, `27~`, `40`; `,` `|` 공백으로 여러 개, 비우면 전체). 범위 구분자는 `~`이다.
- `Config`: job의 `config.xml`. `Log`: build `consoleText` (view/folder에서는 각 job의 lastBuild만). `Name`: build 표시 이름과 description.
- `History`: job page에서만. `<job>/jobConfigHistory/`의 각 version(`configOutput?type=raw&timestamp=...`)의 config를 검색한다. `FilterIn`은 날짜 범위(`2024-07-02_19-12-25~2026-07-23_17-04-12`, `2024-07-02_19-12-25~`, `~2026-07-23`, 단일 값; 앞부분만 써도 되고 끝값은 그 구간 전체 포함; `,` `|` 공백으로 여러 개, 비우면 전체 version).
- `SearchPattern`은 문자열 검색과 RegExp 검색 중 하나라도 맞는 줄을 찾는다. RegExp가 잘못되면 문자열 검색만 한다.

결과는 `Usage & Result`에 match된 줄(강조 표시)과 바로가기 link로 표시된다. link는 일반 browser 창의 새 tab에서 열린다. 결과가 길면 창을 화면 최대 높이로 늘리고 결과 영역에 scroll bar가 생긴다.

## Build history 삭제 (RemoveHistory)

config의 `run` 섹션에서 값이 `RemoveHistory`인 버튼(예: `"rmBHist": "RemoveHistory"`)을 누르면 삭제 창이 뜬다. 현재 보고 있는 job(또는 그 build page)의 build history에서 `Target` 범위의 build를 삭제한다.

```
Action=RemoveHistory
Target="1000~"          #build 범위 (ex: 27~36|~36|27~|40), 필수
```

- view/folder page에서는 실행되지 않는다(job page에서만).
- `Target`이 비어 있으면 실행하지 않는다.
- Execute 하면 삭제 대상 개수와 범위를 보여주고 확인(confirm) 후 삭제한다. 삭제는 되돌릴 수 없다.
- 각 build에 `POST <build>/doDelete`를 보내며 CSRF crumb은 `crumbIssuer`에서 받아 붙인다. 실패한 build는 error로 표시한다.

## Job 실행 (job)

config의 `run` 섹션에서 값이 `job`인 버튼(예: `"trigger": "job"`)을 누르면 job 실행 창이 뜬다. Enter Parameters에 job URL을 shell 연산자로 엮어 쓰면 순차/병렬로 실행하고 각 build의 완료 결과를 `Usage & Result`에 실시간으로 표시한다. 입력은 Execute 시 저장되어 다음에 복원된다.

```
http://host/job/build_A/ BRANCH=main && http://host/job/test_A/
( http://host/job/test_1/ & http://host/job/test_2/ ) && http://host/job/deploy/
```

- job은 full URL(`http(s)://…/job/<name>/`)이다. 서버가 달라도 된다. 뒤에 `KEY=VALUE`로 build parameter를 주며, 값에 공백이 있으면 `KEY="a b"`. parameter가 있는 job은 `buildWithParameters`, 없는 job은 `build`로 실행한다.
- `a ; b`(줄바꿈 포함) 순차, `a && b` a 성공 시에만 b, `a || b` a 실패 시에만 b, `a & b` 동시 실행, `( … )` 그룹. `&&` `||`가 `;` `&`보다 먼저 묶이므로 `a & b && c`는 `a & (b && c)`이다. "a, b 모두 성공 후 c"는 `( a & b ) && c`로 쓴다.
- 그룹과 식 끝에서는 `&`로 시작한 job을 모두 기다린다. 그룹은 안의 문장이 모두 성공해야 성공이다.
- `sleep N`: N분 대기하는 항으로, job과 똑같이 연산자로 엮는다 (소수 가능, 항상 성공, 대기 중에는 남은 시간 표시). `a && sleep 10 && b`는 a 성공 10분 뒤 b, `a ; sleep 20 ; b`는 a가 끝나고 20분 뒤 b(성공 여부 무관), `a & ( sleep 10 && b )`는 a를 시작하고 10분 뒤 b를 시작한다(a는 기다리지 않음). `Stop`은 대기 중인 `sleep`도 즉시 중단한다.
- 성공은 build result가 `SUCCESS`일 때뿐이다. `UNSTABLE`, `FAILURE`, `ABORTED`는 실패이고, 실행 불가(job 없음/disabled/요청 실패)는 `ERROR`로 표시하며 실패로 본다.
- 연산자는 공백으로 띄워 쓴다. 단어 끝에 붙은 `;` `&` `&&` `||` `)`와 앞에 붙은 `(`도 연산자로 인식하고, URL 안의 `&`는 URL로 취급한다. `#` 로 시작하는 단어부터 줄 끝은 주석이다.
- Execute 하면 바로 실행한다. 문법 오류는 실행 전에 위치(줄)와 함께 표시한다.
- `Stop`(또는 실행 중 `Cancel`)은 실행 예정 job은 시작하지 않고, queue 대기 job은 `queue/cancelItem`, 실행 중 build는 `<build>/stop`으로 모두 중단한다.
- 실행을 조율하는 쪽은 이 창이다. 창을 닫으면(`Cancel` 외의 방법) 이후 job이 스케줄되지 않는다.

## 화면 폭 확장 (wide-width)

config의 `run` 섹션에 `"wide-width"`를 넣으면 `▶ wide-width` 버튼이 생기고, Jenkins 화면 폭을 넓힐 수 있다. 값은 **기본으로 확장할 카테고리**이다(대소문자 무시).

| 값 | 기본 확장 |
|---|---|
| `config` | `…/configure` 화면(job/folder/view/node)을 화면 폭 전체로 확장 |
| `Bhistory` | 왼쪽 하단 Build History(`#buildHistory`)를 오른쪽 끝까지 확장 (main-panel 위에 겹쳐 표시) |
| `all` | 둘 다 |

버튼을 누르면 **현재 보이는 화면에 해당하는 카테고리**(configure 화면 → `config`, `#buildHistory`가 있는 화면 → `Bhistory`)를 확장/축소로 토글한다. 해당 항목이 없는 화면이면 안내 메시지만 표시한다.
토글한 상태는 카테고리별로 저장되어 모든 job/화면에 동일하게 적용된다. 저장된 상태가 없으면 위 기본값을 따른다. 다른 탭은 즉시 반영되고, 새로 여는 화면은 로드 시 적용된다.

## 파일 구조

- `manifest.json` - Extension 설정 파일
- `popup.html` - UI 구조
- `popup.css` - 스타일링
- `popup.js` - 로직 및 이벤트 처리
- `config.list` - 서버 및 액션 URL 설정

## 아이콘 추가

`icon16.png`, `icon48.png`, `icon128.png` 파일을 추가하면 extension 아이콘이 표시됩니다.
