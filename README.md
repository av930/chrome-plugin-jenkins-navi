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

## 파일 구조

- `manifest.json` - Extension 설정 파일
- `popup.html` - UI 구조
- `popup.css` - 스타일링
- `popup.js` - 로직 및 이벤트 처리
- `config.list` - 서버 및 액션 URL 설정

## 아이콘 추가

`icon16.png`, `icon48.png`, `icon128.png` 파일을 추가하면 extension 아이콘이 표시됩니다.
