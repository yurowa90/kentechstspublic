/* 면접실 반문 카드·관찰 항목·말 시작 예시·기준 칩. 연습용으로 새로 만든 문장이며 보고서의 질문이 아니다. 편집 검토 뒤 이 파일만 고친다. */
(function () {
  const KCP = window.KCP;
  KCP.ORIGINAL_ORDER = KCP.ORIGINAL_ORDER || [];
  KCP.PROBE_TYPES = [
    { k: "E", n: "근거" }, { k: "C", n: "기준" }, { k: "T", n: "얻고 잃는 것" },
    { k: "F", n: "조건 변경" }, { k: "L", n: "약한 고리" },
  ];
  KCP.PROBES = [
    { id: "E1", k: "E", text: "그 판단의 근거가 된 자료의 숫자나 문장을 하나만 정확히 짚어 주세요." },
    { id: "E2", k: "E", text: "그 근거가 틀렸다면 결론도 바뀌나요?" },
    { id: "C1", k: "C", text: "가장 무겁게 본 판단 기준 하나는 무엇이고, 다른 기준보다 앞에 둔 이유는 무엇인가요?" },
    { id: "C2", k: "C", text: "그 기준을 다르게 보는 사람은 누구이고, 왜 그럴까요?" },
    { id: "T1", k: "T", text: "그 선택으로 얻는 것과 잃는 것을 한 문장에 담아 말해 주세요." },
    { id: "T2", k: "T", text: "그 선택으로 가장 손해를 보는 사람에게 어떻게 설명하겠습니까?" },
    { id: "F1", k: "F", text: "가장 중요하게 본 조건이 반대로 바뀌면 결론도 바뀌나요?" },
    { id: "F2", k: "F", text: "쓸 수 있는 자원이 절반이라면 무엇부터 포기하겠습니까?" },
    { id: "L1", k: "L", text: "이 계획이 실패한다면 가장 먼저 무너질 곳은 어디일까요?" },
    { id: "L2", k: "L", text: "내 답에서 가장 약한 고리를 스스로 하나 꼽아 보세요." },
  ];
  KCP.probeDeck = function (tag, year) {
    const t = String(tag || ""), newspaper = year === "2025";
    const cycle = newspaper ? ["E", "L", "C", "F", "T"] : ["E", "C", "T", "F", "L"];
    const first = /발산|유연|추론/.test(t) ? "F" : /인문/.test(t) ? "T"
      : newspaper || /문제해결|수학|자료/.test(t) ? "E" : "C";
    const start = cycle.indexOf(first), deck = [];
    for (let i = 0; i < cycle.length; i++) {
      const k = cycle[(start + i) % cycle.length];
      const typeName = KCP.PROBE_TYPES.find((type) => type.k === k).n;
      KCP.PROBES.forEach((card) => {
        if (card.k === k && !(newspaper && ["T2", "F2"].includes(card.id)))
          deck.push({ id: card.id, k, typeName, text: card.text });
      });
    }
    return deck;
  };
  // 세 습관과 자료 인용
  KCP.HABITS = [
    { k: "c", n: "기준을 먼저 말했다" },
    { k: "t", n: "얻는 것과 잃는 것을 함께 말했다" },
    { k: "r", n: "반문 뒤 답을 고치거나 유지하는 이유를 말했다" },
    { k: "d", n: "자료의 수치나 문장을 짚었다" },
  ];
  KCP.STARTERS = {
    revise: ["그 점은 놓쳤습니다. 다시 보면 …", "기준은 유지하되 … 점은 보완하겠습니다.", "그 조건이라면 결론을 바꾸겠습니다. 이유는 …"],
    keep: ["그 점을 따져 봐도 결론은 유지합니다. 이유는 …", "그 우려는 … 방법으로 줄일 수 있어서 선택을 바꾸지 않겠습니다."],
  };
  KCP.CRIT_CHIPS = ["효율", "비용", "안전", "형평성", "환경", "지속가능성", "주민 수용성", "실현 가능성"];
  // official이면 평가 기준표 항목
  KCP.CRIT_CHIPS_BY_YEAR = {
    "2022": { official: false, chips: KCP.CRIT_CHIPS.slice() },
    "2023": { official: false, chips: ["과학 지수", "행복 지수", "환경 지수", "이웃 나라와의 격차", "실행 시점"] },
    "2024": { official: false, chips: ["에너지 자급", "건강", "안전", "행복", "교육", "환경"] },
    "2025": { official: false, chips: ["기사 속 시간 표현", "기술 수준의 변화", "자원 상태", "사회 반응", "인과 연결"] },
    "2026": { official: true, chips: ["기능/효과", "안전성", "사회/윤리", "환경/에너지", "사용자 경험"] },
  };
})();
