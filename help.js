// Jenkins Shortcuts Help Modal Data
// Edit this file to customize the help modal content

const HELP_MODAL_DATA = {
  title: "Jenkins 단축키 도움말",
  subtitle: "키보드 단축키로 빠르게 Jenkins를 탐색하세요",
  footer: "? 또는 ESC 키를 눌러 닫기",
  columns: [
    {
      sections: [
        {
          title: "기본 탐색",
          shortcuts: [
            { key: "F", description: "단축키 모드 토글\n(기능 trigger)" },
            { key: "?", description: "이 도움말 표시" },
            { key: "Q", description: "상위 URL로 이동\n(누를때마다 상위로 이동)" },
            { key: "W", description: "브레드크럼으로 다른 view나 job으로 이동(토글)" },
            { key: "A", description: "이전 페이지" },
            { key: "ESC", description: "F 모드 종료" }
          ]
        },
      ]
    },
    {
      sections: [
        {
          title: "메뉴 단축키",
          shortcuts: [
            { key: "F> E", description: "현재TAB 왼쪽에 복제" },
            { key: "F> B", description: "빌드 실행" },
            { key: "F> R", description: "빌드 재실행 \n(Retrigger > Retry > Rebuild 순으로 시도)" },
            { key: "F> C/T", description: "콘솔 출력/Text 로그 \n(토글할때마다 포멧변환)" },
            { key: "F> X", description: "구성 (build에서도 동작)" },
            { key: "F> D", description: "빌드 삭제/ 노드 연결끊기" },
            { key: "F> H", description: "구성 히스토리" },
            { key: "F> Z", description: "통계/라벨" }
          ]
        }
      ]
    },
    {
      sections: [
        {
          title: "스크롤 & 빌드 탐색",
          shortcuts: [
            { key: "F> G", description: "페이지 다운" },
            { key: "F> T", description: "페이지 업\n(G key이후에만 동작)" },
            { key: "F> P", description: "이전 빌드" },
            { key: "F> N", description: "다음 빌드" },
            { key: "F> O", description: "실행노드 열기" }
          ]
        }
      ]
    }
  ]
};
