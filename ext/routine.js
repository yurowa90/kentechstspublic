(function () {
  const KCP = window.KCP;
  // 목표를 확인했는지: at이 없는 손상된 목표는 확인한 것으로 보지 않는다(goalAckAt 기본값 0과 겹치므로)
  const ackedGoal = (jn, goal) => !!goal && goal.at > 0 && jn.goalAckAt === goal.at;
  const DEF = {
    open: false, out: "", plan: "",
    crit: [{ n: "", w: 0 }, { n: "", w: 0 }, { n: "", w: 0 }],
    pick: "", gain: "", cost: "", goalAckAt: 0,
  };
  const WEIGHTS = ["미정", "낮음", "중간", "높음"];
  const OUT_HINTS = {
    "2022": "예: 발전소 4기의 좌표와 이유, 세 마을 공급 계획",
    "2023": "예: 10년 실행 계획과 이웃 나라 비교",
    "2024": "예: 정착지와 특별 아이템, 탐험 계획 설명",
    "2025": "예: 신문 4부의 발행 순서와 연결 근거",
    "2026": "예: 평가표와 최우수 기술 하나, 추천 이유",
  };
  const PICK_HINTS = {
    "2022": "예: 2번 문제의 공급 방식",
    "2023": "예: 10년 계획의 중심 방향",
    "2024": "예: 고른 정착지와 아이템 조합",
    "2026": "예: 추천한 기술",
  };

  function jnOf(state) {
    const jn = KCP.ext(state, "jn", DEF);
    ["out", "plan", "pick", "gain", "cost"].forEach((key) => {
      if (typeof jn[key] !== "string") jn[key] = "";
    });
    if (typeof jn.open !== "boolean") jn.open = false;
    if (!Number.isFinite(jn.goalAckAt) || jn.goalAckAt < 0) jn.goalAckAt = 0;
    if (!Array.isArray(jn.crit)) jn.crit = DEF.crit.map((item) => ({ ...item }));
    jn.crit.length = 3;
    for (let i = 0; i < 3; i++) {
      if (!jn.crit[i] || typeof jn.crit[i] !== "object" || Array.isArray(jn.crit[i]))
        jn.crit[i] = { n: "", w: 0 };
      if (typeof jn.crit[i].n !== "string") jn.crit[i].n = "";
      if (![0, 1, 2, 3].includes(jn.crit[i].w)) jn.crit[i].w = 0;
    }
    return jn;
  }

  function chipsOf(year) {
    const entry = KCP.CRIT_CHIPS_BY_YEAR && KCP.CRIT_CHIPS_BY_YEAR[year];
    const chips = entry ? entry.chips : KCP.CRIT_CHIPS;
    return {
      official: !!(entry && entry.official),
      chips: Array.isArray(chips) ? chips.filter((chip) => typeof chip === "string") : [],
    };
  }

  function criterionSummary(jn) {
    const names = jn.crit.filter((item) => item.n.trim())
      .map((item) => item.n.trim() + "(" + WEIGHTS[item.w] + ")");
    return names.length ? "기준: " + names.join(", ") : "";
  }

  function orderSentence(pick, gain, cost) {
    const p = pick.trim(), g = gain.trim(), c = cost.trim();
    if (!p || (!g && !c)) return "";
    const head = "제가 정한 순서는 " + p + "입니다.";
    if (g && c) return head + " 가장 단단한 근거는 「" + g + "」, 가장 약한 근거는 「" + c + "」입니다.";
    return head + (g ? " 가장 단단한 근거는 「" + g : " 가장 약한 근거는 「" + c) + "」입니다.";
  }

  function choiceSentence(year, jn) {
    return year === "2025" ? orderSentence(jn.pick, jn.gain, jn.cost) : KCP.tradeSentence(jn);
  }

  function showSentence(element, sentence, hint) {
    element.textContent = sentence;
    if (!sentence) {
      const muted = document.createElement("span");
      muted.className = "muted";
      muted.textContent = hint;
      element.appendChild(muted);
    }
  }

  function field(id, label, value, placeholder, list) {
    return `<div class="field"><label for="${id}">${KCP.esc(label)}</label>
      <input class="note" id="${id}" value="${KCP.esc(value)}" placeholder="${KCP.esc(placeholder)}"${list ? ' list="jn-critlist"' : ""}></div>`;
  }

  KCP.on("prep:render", ({ top, year, state, save }) => {
    if (top.querySelector("#jn-panel")) return;
    const jn = jnOf(state), { official, chips } = chipsOf(year);
    const newspaper = year === "2025", goal = KCP.goal.get();
    const panel = document.createElement("section");
    panel.className = "panel jn-panel";
    panel.id = "jn-panel";
    panel.setAttribute("aria-labelledby", "jn-title");
    panel.innerHTML = `
      <div class="jn-head">
        <h3 id="jn-title">판단 노트</h3>
        <span class="tag-mine">연습용 도구</span>
        <span id="jn-sum" class="small muted"></span>
        <button type="button" class="btn small ghost" id="jn-toggle" aria-controls="jn-body" aria-expanded="${jn.open}">${jn.open ? "접기" : "펼치기"}</button>
      </div>
      <div id="jn-goal" class="jn-goal">${goal
        ? `<p>지난 연습(${KCP.esc(goal.title)})에서 정한 목표: “${KCP.esc(goal.text)}”</p>
          <label><input type="checkbox" id="jn-goalack"${ackedGoal(jn, goal) ? " checked" : ""}>이번 연습에서 이것을 의식한다</label>`
        : '<p class="small muted">지난 목표 없음. 성찰 단계에서 다음 연습에서 바꿀 한 가지를 적으면 여기에 나타납니다.</p>'}
      </div>
      <div id="jn-body"${jn.open ? "" : " hidden"}>
        <div class="jn-grid">
          <div class="jn-col">
            <h4>과제 파악</h4>
            ${field("jn-out", "이 과제가 요구하는 것", jn.out, OUT_HINTS[year] || "")}
            ${field("jn-plan", "시간 배분", jn.plan, "예: 자료 읽기 · 결정 · 말하기 연습에 각각 쓸 시간")}
          </div>
          <div class="jn-col">
            <h4>판단 기준과 무게</h4>
            <div class="jn-chips" role="group" aria-label="${official ? "평가표 항목" : "기준 예시"}">
              ${official ? '<span class="tag-official">평가 기준표</span>' : '<span class="tag-mine">연습용 기준 예시</span>'}
              ${chips.map((chip, i) => `<button type="button" class="btn small" data-jchip="${i}">${KCP.esc(chip)}</button>`).join("")}
            </div>
            <p class="small muted">누르면 비어 있는 첫 기준 칸에 들어갑니다.</p>
            ${[0, 1, 2].map((i) => `<div class="jn-crow">
              <input class="note" id="jn-c${i}" data-jc="${i}" aria-label="기준 ${i + 1}" placeholder="${year === "2026" ? "평가표 항목 가운데 하나" : "기준 이름(짧은 명사)"}" value="${KCP.esc(jn.crit[i].n)}">
              <span class="seg" role="group" aria-label="기준 ${i + 1} 무게">
                ${[3, 2, 1].map((w) => `<button type="button" data-jw="${i}" data-jwv="${w}" aria-pressed="${jn.crit[i].w === w}"${jn.crit[i].n.trim() ? "" : " disabled"}>${WEIGHTS[w]}</button>`).join("")}
              </span>
            </div>`).join("")}
            <p class="jn-sent" id="jn-csent"></p>
            <p class="small muted" id="jn-cnote" hidden>무게를 정하면 문장이 완성됩니다.</p>
            <span id="jn-speak1"></span>
          </div>
          <div class="jn-col">
            <h4>${newspaper ? "정한 순서와 근거" : "고른 것, 얻는 것, 잃는 것"}</h4>
            <p class="small muted">준비를 마칠 무렵 채웁니다.</p>
            ${field("jn-pick", newspaper ? "내가 정한 순서" : "내가 고른 것(결론)", jn.pick,
              newspaper ? "예: 신문 기호를 발행 순서대로" : PICK_HINTS[year] || "")}
            ${field("jn-gain", newspaper ? "가장 단단한 근거" : "얻는 것(기준 이름)", jn.gain,
              newspaper ? "예: 가장 확실한 두 신문 사이의 연결" : chips[0] ? "예: " + chips[0] : "", !newspaper)}
            ${field("jn-cost", newspaper ? "가장 약한 근거" : "잃는 것(기준 이름)", jn.cost,
              newspaper ? "예: 순서가 바뀌어도 설명이 되는 연결" : chips[1] ? "예: " + chips[1] : "", !newspaper)}
            ${newspaper ? "" : '<datalist id="jn-critlist"></datalist>'}
            <p class="jn-sent" id="jn-tsent"></p>
            <span id="jn-speak2"></span>
          </div>
        </div>
        <p id="jn-guide" class="small muted">자료를 먼저 훑은 뒤 기준을 적으세요. 자세한 이유는 아래 과제 화면의 칸에 적고, 여기에는 말을 시작할 재료만 적습니다. 만들어진 문장은 말하기 연습용 틀이며 정답이 아닙니다. 면접에서는 내 말로 바꿔 말하세요.</p>
      </div>`;
    top.appendChild(panel);

    function refresh() {
      panel.querySelector("#jn-sum").textContent = criterionSummary(jn) || "자료를 훑은 뒤 기준과 무게를 적습니다.";
      showSentence(panel.querySelector("#jn-csent"), KCP.critSentence(jn.crit), "기준을 적으면 첫 문장이 여기에 만들어집니다.");
      const named = jn.crit.filter((item) => item.n.trim());
      panel.querySelector("#jn-cnote").hidden = !(named.length >= 2 && named.some((item) => item.w === 0));
      showSentence(panel.querySelector("#jn-tsent"), choiceSentence(year, jn), newspaper
        ? "순서와 근거를 적으면 문장이 만들어집니다."
        : "고른 것과 얻는 것·잃는 것을 적으면 문장이 만들어집니다.");
      const list = panel.querySelector("#jn-critlist");
      if (list) {
        const names = new Set(jn.crit.map((item) => item.n.trim()).concat(chips).filter(Boolean));
        list.innerHTML = Array.from(names).map((name) => `<option value="${KCP.esc(name)}"></option>`).join("");
      }
    }

    function refreshWeights(i) {
      panel.querySelectorAll(`[data-jw="${i}"]`).forEach((button) => {
        button.disabled = !jn.crit[i].n.trim();
        button.setAttribute("aria-pressed", String(jn.crit[i].w === Number(button.dataset.jwv)));
      });
    }

    panel.querySelector("#jn-toggle").addEventListener("click", (event) => {
      if (jn.open) KCP.speakStop();
      jn.open = !jn.open;
      panel.querySelector("#jn-body").hidden = !jn.open;
      event.currentTarget.setAttribute("aria-expanded", String(jn.open));
      event.currentTarget.textContent = jn.open ? "접기" : "펼치기";
      save();
    });
    const ack = panel.querySelector("#jn-goalack");
    if (ack) ack.addEventListener("change", () => {
      jn.goalAckAt = ack.checked ? goal.at : 0;
      save();
    });
    ["out", "plan", "pick", "gain", "cost"].forEach((key) => {
      panel.querySelector("#jn-" + key).addEventListener("input", (event) => {
        jn[key] = event.currentTarget.value;
        refresh();
        save();
      });
    });
    panel.querySelectorAll("[data-jc]").forEach((input) => {
      input.addEventListener("input", () => {
        const i = Number(input.dataset.jc);
        jn.crit[i].n = input.value;
        if (!input.value.trim()) jn.crit[i].w = 0;
        refreshWeights(i);
        refresh();
        save();
      });
    });
    panel.querySelectorAll("[data-jw]").forEach((button) => {
      button.addEventListener("click", () => {
        const i = Number(button.dataset.jw), w = Number(button.dataset.jwv);
        if (!jn.crit[i].n.trim()) return;
        jn.crit[i].w = jn.crit[i].w === w ? 0 : w;
        refreshWeights(i);
        refresh();
        save();
      });
    });
    panel.querySelectorAll("[data-jchip]").forEach((button) => {
      button.addEventListener("click", () => {
        const chip = chips[Number(button.dataset.jchip)];
        if (jn.crit.some((item) => item.n.trim() === chip)) {
          KCP.toast("이미 넣은 기준입니다.");
          return;
        }
        const i = jn.crit.findIndex((item) => !item.n.trim());
        if (i === -1) {
          KCP.toast("기준 칸이 모두 찼습니다. 하나를 지우고 넣으세요.");
          return;
        }
        jn.crit[i].n = chip;
        jn.crit[i].w = 0;
        panel.querySelector("#jn-c" + i).value = chip;
        refreshWeights(i);
        refresh();
        save();
      });
    });
    refresh();
    KCP.speak(panel.querySelector("#jn-speak1"), { rec: "한두 문장" });
    KCP.speak(panel.querySelector("#jn-speak2"), { rec: "한두 문장" });
  });

  KCP.on("room:render", ({ side, year, state, save }) => {
    if (side.querySelector("#jn-side")) return;
    const jn = jnOf(state), goal = KCP.goal.get();
    const criterion = KCP.critSentence(jn.crit), choice = choiceSentence(year, jn);
    const acknowledged = ackedGoal(jn, goal);
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "jn-side";
    panel.innerHTML = `
      <h3>내 판단 노트 <span class="tag-mine">연습용 도구</span></h3>
      ${jn.out.trim() ? `<p>과제: ${KCP.esc(jn.out)}</p>` : ""}
      ${criterion ? `<p class="jn-sent" id="jn-side-c">${KCP.esc(criterion)}</p>` : ""}
      ${choice ? `<p class="jn-sent" id="jn-side-t">${KCP.esc(choice)}</p>` : ""}
      ${acknowledged ? `<p id="jn-side-goal">이번 연습에서 의식할 것: “${KCP.esc(goal.text)}”</p>` : ""}
      ${!jn.out.trim() && !criterion && !choice && !acknowledged ? '<p class="small muted">준비실의 판단 노트를 채우면 여기에 나타납니다.</p>' : ""}
      <p class="small muted">첫 답에서 기준을 먼저 밝힐 때 참고합니다. 문장을 그대로 읽기보다 내 말로 바꿔 말하세요.</p>
      <button type="button" class="btn small ghost" id="jn-edit">준비실에서 고치기</button>`;
    side.appendChild(panel);
    panel.querySelector("#jn-edit").addEventListener("click", () => {
      jn.open = true;
      save();
      if (KCP.goPhase("prep")) {
        const toggle = document.getElementById("jn-toggle");
        if (toggle) toggle.focus();
      }
    });
  });

  KCP.on("export:text", ({ year, state, parts }) => {
    const jn = jnOf(state), lines = [];
    if (jn.out.trim()) lines.push("과제: " + jn.out);
    if (jn.plan.trim()) lines.push("시간 배분: " + jn.plan);
    const summary = criterionSummary(jn), criterion = KCP.critSentence(jn.crit);
    if (summary) lines.push(summary);
    if (criterion) lines.push(criterion);
    const labels = year === "2025" ? ["정한 순서", "가장 단단한 근거", "가장 약한 근거"] : ["고른 것", "얻는 것", "잃는 것"];
    const details = ["pick", "gain", "cost"].map((key, i) => jn[key].trim() ? labels[i] + ": " + jn[key] : "").filter(Boolean);
    if (details.length) lines.push(details.join(" · "));
    const choice = choiceSentence(year, jn);
    if (choice) lines.push(choice);
    if (lines.length) parts.push("\n■ 판단 노트\n" + lines.join("\n"));
  });
})();
