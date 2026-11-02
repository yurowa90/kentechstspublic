(function () {
  const KCP = window.KCP;
  const views = new Map();
  const fresh = new Set();
  let currentState = null;

  const plain = (value) => value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const text = (value) => typeof value === "string" ? value : "";
  const probeCard = (id) => KCP.PROBES.find((card) => card.id === id);

  function normalize(value, deck) {
    if (!plain(value)) return null;
    return {
      q: text(value.q),
      card: deck && Number.isInteger(value.card) && value.card >= 0 && value.card < deck.length ? value.card : 0,
      pid: probeCard(value.pid) ? value.pid : "",
      own: text(value.own),
      stance: ["", "revise", "keep"].includes(value.stance) ? value.stance : "",
      why: text(value.why),
      talk: Array.isArray(value.talk) ? value.talk.filter((sec) => typeof sec === "number"
        && Number.isFinite(sec) && sec >= 1 && sec <= 600).slice(0, 5).map(Math.floor) : [],
    };
  }

  function read(state, key, deck) {
    const probe = KCP.ext(state, "probe", {});
    return normalize(Object.hasOwn(probe, key) ? probe[key] : null, deck);
  }

  function entry(payload, deck) {
    return read(payload.state, payload.key, deck)
      || { q: text(payload.q.q), card: 0, pid: "", own: "", stance: "", why: "", talk: [] };
  }

  function record(payload, deck, patch) {
    currentState = payload.state;
    const probe = KCP.ext(payload.state, "probe", {});
    const value = Object.assign(entry(payload, deck), patch, { q: text(payload.q.q) });
    Object.defineProperty(probe, payload.key, { value, writable: true, enumerable: true, configurable: true });
    payload.save();
    return value;
  }

  function paintTime(el, key, value) {
    if (!el.isConnected) return;
    const talk = value ? value.talk : [];
    el.textContent = talk.length ? (fresh.has(key) ? "방금 " : "최근 ") + KCP.mss(talk[0])
      + (talk.length > 1 ? " · 지난번 " + KCP.mss(talk[1]) : "") : "";
  }

  function paintCard(box, value, deck) {
    const card = deck[value.card];
    if (!card) return;
    box.querySelector(".pb-head").innerHTML = "반문 · " + KCP.esc(card.typeName)
      + " <span class=\"tag-mine\">연습용 반문</span>";
    box.querySelector(".pb-card").textContent = card.text;
    paintWas(box, value, deck);
  }

  function paintWas(box, value, deck) {
    const was = box.querySelector(".pb-was");
    const previous = probeCard(value.pid);
    const show = !value.own && previous && deck[value.card] && value.pid !== deck[value.card].id
      && (value.stance || value.why);
    was.hidden = !show;
    was.textContent = show ? "적어 둔 선택과 이유는 앞서 본 반문 “" + previous.text + "”에 대한 것입니다." : "";
  }

  function paintChoice(box, value) {
    box.querySelectorAll("[data-pb-stance]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.pbStance === value.stance));
    });
    const why = box.querySelector("[data-pb-why]");
    why.parentElement.hidden = !value.stance;
    why.placeholder = value.stance === "revise" ? "무엇을 놓쳤고, 답을 어떻게 바꾸나요?"
      : "반문이 짚은 점을 어떻게 다루고, 그래도 유지하는 이유는 무엇인가요?";
    const starters = box.querySelector(".pb-starters");
    starters.hidden = !value.stance;
    starters.textContent = value.stance ? "말 시작 예시: "
      + KCP.STARTERS[value.stance].map((sentence) => "“" + sentence + "”").join(" · ") : "";
  }

  function fillBox(box, payload, deck) {
    const { i, year, meta } = payload;
    const value = entry(payload, deck);
    const original = !!(meta && meta.original);
    // 창작 게임은 연습용 평가 기준만 있으므로 공식 표시를 붙이지 않는다
    const criterion = original
      ? Object.values(meta.rubric || {}).flat().find((text) => /한계|고치|유지|비판/.test(text)) || null
      : KCP.findCriterion(year, /비판적 의견|한계점/);
    box.innerHTML = `
      <p class="pb-head"></p>
      <p class="pb-card" aria-live="polite"></p>
      <div class="row"><button type="button" class="btn small ghost" data-pb-next="${i}">다른 반문</button></div>
      <p class="small pb-was" hidden></p>
      <div class="field">
        <label for="pb-own-${i}">짝이 직접 한 반문(있으면)</label>
        <input class="note" id="pb-own-${i}" data-pb-own="${i}" placeholder="짝이 한 반문을 그대로 적기" value="${KCP.esc(value.own)}">
      </div>
      <div class="seg" role="group" aria-label="반문에 대한 내 선택">
        <button type="button" data-pb-stance="revise" data-pb-i="${i}" aria-pressed="false">답을 고친다</button>
        <button type="button" data-pb-stance="keep" data-pb-i="${i}" aria-pressed="false">답을 유지한다</button>
      </div>
      <div class="field" hidden>
        <label for="pb-why-${i}">이유</label>
        <textarea class="note" id="pb-why-${i}" data-pb-why="${i}">${KCP.esc(value.why)}</textarea>
      </div>
      <p class="hint pb-starters" hidden></p>
      <p class="hint">고치는 것과 유지하는 것 모두 이유가 있으면 됩니다. 반문의 뜻이 모호하면 먼저 되물어도 됩니다.</p>
      ${criterion ? `<p class="small pb-crit">관련 평가 기준: “${KCP.esc(criterion)}” ${original ? '<span class="tag-mine">연습용 평가 기준</span>' : '<span class="tag-official">평가 기준</span>'}</p>`
        : original ? "" : "<p class=\"small pb-nocrit\">이 해의 평가 기준표에는 비판 수용이나 한계 인정 항목이 따로 없습니다.</p>"}`;
    paintCard(box, value, deck);
    paintChoice(box, value);
    box.querySelector("[data-pb-next]").addEventListener("click", () => {
      const value = entry(payload, deck);
      paintCard(box, record(payload, deck, { card: (value.card + 1) % deck.length }), deck);
    });
    box.querySelector("[data-pb-own]").addEventListener("input", (event) => {
      paintWas(box, record(payload, deck, { own: event.target.value }), deck);
    });
    box.querySelectorAll("[data-pb-stance]").forEach((button) => {
      button.addEventListener("click", () => {
        const value = entry(payload, deck);
        const changed = record(payload, deck, { stance: button.dataset.pbStance, pid: deck[value.card].id });
        paintWas(box, changed, deck);
        paintChoice(box, changed);
      });
    });
    box.querySelector("[data-pb-why]").addEventListener("input", (event) => {
      const value = entry(payload, deck);
      paintWas(box, record(payload, deck, { why: event.target.value, pid: deck[value.card].id }), deck);
    });
  }

  KCP.on("room:card", (payload) => {
    const { slot, q, i, key, state, year } = payload;
    currentState = state;
    const deck = KCP.probeDeck(q.tag, String(year));
    const row = document.createElement("div");
    row.className = "pb-row row";
    row.innerHTML = `<span id="pb-speak-${i}"></span><span id="pb-time-${i}" class="pb-time small muted num"></span>
      <button type="button" class="btn small ghost" data-pb-open="${i}" aria-expanded="false" aria-controls="pb-box-${i}"${deck.length ? "" : " disabled"}>반문 카드</button>`;
    const box = document.createElement("div");
    box.className = "pb-box";
    box.id = "pb-box-" + i;
    box.hidden = true;
    slot.append(row, box);
    views.set(key, { i, slot });
    const time = slot.querySelector("#pb-time-" + i);
    paintTime(time, key, read(state, key, deck));
    KCP.speak(slot.querySelector("#pb-speak-" + i), {
      rec: q.time || "1~3분",
      onEnd(sec) {
        const s = Math.floor(sec);
        if (!Number.isFinite(s) || s < 1 || s > 600) return;
        const value = entry(payload, deck);
        fresh.add(key);
        const changed = record(payload, deck, { talk: [s].concat(value.talk).slice(0, 5) });
        paintTime(time, key, changed);
      },
    });
    const open = slot.querySelector("[data-pb-open]");
    const value = read(state, key, deck);
    if (deck.length && value && (value.own || value.stance || value.why)) {
      fillBox(box, payload, deck);
      box.hidden = false;
      open.setAttribute("aria-expanded", "true");
    }
    open.addEventListener("click", () => {
      if (!deck.length) return;
      if (!box.querySelector(".pb-head")) fillBox(box, payload, deck);
      box.hidden = !box.hidden;
      open.setAttribute("aria-expanded", String(!box.hidden));
    });
  });

  KCP.on("room:render", ({ tools, state }) => {
    currentState = state;
    if (tools.querySelector("#pb-note")) return;
    const note = document.createElement("p");
    note.id = "pb-note";
    note.className = "small muted";
    note.textContent = "반문 카드는 질문 종류에 따라 미리 정해 둔 문장입니다. 내 메모를 읽고 고른 것이 아닙니다. 짝과 연습한다면 짝이 직접 반문하세요. 말한 시간은 기록만 하고 판정하지 않습니다.";
    tools.append(note);
  });

  KCP.on("peer:probe", (payload) => {
    if (!payload || !plain(payload.state) || typeof payload.save !== "function" || !plain(payload.q)
      || typeof payload.key !== "string" || !payload.key || typeof payload.id !== "string" || !payload.id) return;
    const deck = KCP.probeDeck(payload.q.tag, String(payload.year));
    const card = deck.findIndex((value) => value.id === payload.id);
    if (card < 0) return;
    const value = record(payload, deck, { card });
    const view = views.get(payload.key);
    if (!view) return;
    const box = view.slot.querySelector("#pb-box-" + view.i);
    if (box && box.querySelector(".pb-head")) paintCard(box, value, deck);
  });

  function splitRecords(state, qs, year) {
    const keys = new Set(qs.map((q) => KCP.qkey(q)));
    const current = qs.map((q) => read(state, KCP.qkey(q), KCP.probeDeck(q.tag, String(year))))
      .filter((value) => value && value.stance);
    const probe = KCP.ext(state, "probe", {});
    const old = Object.keys(probe).filter((key) => !keys.has(key)).map((key) => read(state, key))
      .filter((value) => value && value.stance);
    return { current, old };
  }

  function probeLine(value) {
    if (value.own) return "반문(짝): " + value.own;
    const card = probeCard(value.pid);
    if (!card) return "반문: (기록 없음)";
    const type = KCP.PROBE_TYPES.find((item) => item.k === card.k);
    return "반문(카드 · " + (type ? type.n : "") + "): " + card.text;
  }

  function listHTML(items) {
    return "<ul class=\"pb-list\">" + items.map((value) => `<li class="pb-item">
      <p>질문: ${KCP.esc(value.q.length > 60 ? value.q.slice(0, 60) + "…" : value.q)}</p>
      <p>${KCP.esc(probeLine(value))}</p>
      <p>선택: ${value.stance === "revise" ? "고침" : "유지"}</p>
      <p>이유: ${KCP.esc(value.why || "(비어 있음)")}</p>
    </li>`).join("") + "</ul>";
  }

  KCP.on("reflect:render", ({ left, state, qs, year }) => {
    currentState = state;
    const { current, old } = splitRecords(state, qs, year);
    const panel = document.createElement("section");
    panel.id = "pb-reflect";
    panel.className = "panel";
    panel.innerHTML = "<h3>반문 뒤의 선택 <span class=\"tag-mine\">연습용 기록</span></h3>"
      + (current.length ? listHTML(current)
        : "<p class=\"small muted pb-empty\">면접실에서 반문 카드를 열고 고치거나 유지한 이유를 적으면 여기에 모입니다.</p>")
      + (old.length ? "<h4 class=\"pb-old\">준비실을 바꾸기 전 질문</h4><p class=\"small muted\">질문 목록이 바뀌어 지금 면접실에는 없는 질문의 기록입니다.</p>" + listHTML(old) : "");
    left.append(panel);
  });

  KCP.on("export:text", ({ state, qs, year, parts }) => {
    const { current, old } = splitRecords(state, qs, year);
    const line = (value) => "- 질문: " + value.q + " / " + probeLine(value) + " / 선택: "
      + (value.stance === "revise" ? "고침" : "유지") + " / 이유: " + (value.why || "(비어 있음)");
    if (current.length || old.length) {
      const lines = current.map(line);
      if (old.length) lines.push("(준비실을 바꾸기 전 질문)", ...old.map(line));
      parts.push("\n■ 반문과 답 수정\n" + lines.join("\n"));
    }
    const times = [];
    qs.forEach((q, i) => {
      const value = read(state, KCP.qkey(q), KCP.probeDeck(q.tag, String(year)));
      if (value && value.talk.length) times.push("Q" + (i + 1) + ". "
        + value.talk.map((sec, index) => KCP.mss(sec) + (index === 0 ? "(최근)" : "")).join(", "));
    });
    if (times.length) parts.push("\n■ 말한 시간\n" + times.join("\n"));
  });

  function clearView() {
    views.clear();
    fresh.clear();
    currentState = null;
  }

  KCP.on("route:change", clearView);
  KCP.on("phase:change", clearView);
  KCP.on("storage:clear", () => {
    // 화면의 입력 처리기가 같은 상태를 계속 쓰므로, 삭제 뒤 이전 기록이 함께 저장되지 않게 비운다.
    if (currentState) {
      const probe = KCP.ext(currentState, "probe", {});
      Object.keys(probe).forEach((key) => { delete probe[key]; });
    }
    clearView();
  });
})();
