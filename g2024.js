/* 2024학년도 기출 게임 자리(공개 사본용 대체 파일).
 * 공개 사본에는 기출 문항·제시문·자료를 넣지 않는다. 원래 파일과 같은 이름(KCP.games["2024"])으로
 * 등록해 홈 카드·리그의 '기출로 연습하기' 연결이 예외 없이 열리게 하고, 안내 문장만 보인다.
 */
(function () {
  const KCP = window.KCP;
  if (!KCP || !KCP.games) return;
  const YEAR = "2024";
  const notice = () => `<div class="caution" data-public-mirror-notice="${YEAR}">
      <p><b>이 공개 사본에는 ${YEAR}학년도 기출 원문이 없습니다.</b></p>
      <p class="small">문항·제시문·자료는 저작권 때문에 공개 사본에서 뺐습니다. 기출 원문은 대학이 공개하는 선행학습 영향평가 보고서에서 확인하세요.
        창작 게임, 짧은 판단 훈련장, 전력 리그는 그대로 쓸 수 있습니다.</p>
      <p class="small"><a href="#home">연습실 홈으로</a></p>
    </div>`;
  KCP.games[YEAR] = {
    brief() { return `<p class="small muted" data-public-mirror-brief="${YEAR}">이 공개 사본에는 ${YEAR}학년도 기출 원문이 없습니다.</p>`; },
    renderPrep(root) { root.innerHTML = notice(); },
    questions() { return []; },
    recap() { return []; },
    reflectExtra() { return ""; },
  };
})();
