(function () {
  const KCP = window.KCP;
  const DEF = { cur: 0, obs: {}, overall: "" };
  const mem = { open: false, pos: {} };
  const plain = (v) => v && typeof v === "object" && !Array.isArray(v);
  const short = (text, limit) => text.length > limit ? text.slice(0, limit) + "…" : text;

  function getPeer(state, qs) {
    const peer = KCP.ext(state, "peer", DEF);
    if (!Number.isInteger(peer.cur) || peer.cur < 0) peer.cur = 0;
    peer.cur = Math.min(peer.cur, Math.max(0, qs.length - 1));
    if (!plain(peer.obs)) peer.obs = {};
    if (typeof peer.overall !== "string") peer.overall = "";
    return peer;
  }

  function observation(value) {
    const v = plain(value) ? value : {};
    return {
      q: typeof v.q === "string" ? v.q : "",
      c: v.c === true, t: v.t === true, r: v.r === true, d: v.d === true,
      note: typeof v.note === "string" ? v.note : "",
    };
  }

  function readObs(peer, key) {
    return observation(Object.hasOwn(peer.obs, key) ? peer.obs[key] : null);
  }

  const hasObs = (o) => o.c || o.t || o.r || o.d || !!o.note.trim();
  const names = (o) => KCP.HABITS.filter((h) => o[h.k]).map((h) => h.n).join(" · ") || "표시 없음";

  function records(peer, qs) {
    const keys = new Set(qs.map((q) => KCP.qkey(q)));
    const current = qs.map((q, i) => ({ q: q.q, i, o: readObs(peer, KCP.qkey(q)) }))
      .filter((v) => hasObs(v.o));
    const old = Object.keys(peer.obs).filter((key) => !keys.has(key))
      .map((key) => { const o = readObs(peer, key); return { q: o.q, o }; })
      .filter((v) => hasObs(v.o));
    return { current, old };
  }

  function habitLines(current) {
    return KCP.HABITS.map((h) => {
      const count = current.filter((v) => v.o[h.k]).length;
      return h.n + ": " + (count ? "질문 " + count + "개에서 표시" : "표시 없음");
    });
  }

  function stripOffset() {
    const strip = document.getElementById("strip");
    return strip ? strip.offsetHeight + (parseFloat(getComputedStyle(strip).top) || 0) : 0;
  }

  function scrollBelowStrip(el) {
    window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - stripOffset() - 8));
  }

  function resetMemory() {
    mem.open = false;
    mem.pos = {};
  }
  KCP.on("route:change", resetMemory);
  KCP.on("phase:change", resetMemory);
  KCP.on("storage:clear", resetMemory);

  KCP.on("room:render", ({ alt, tools, qs, year, state, save }) => {
    mem.open = false;
    const peer = getPeer(state, qs);
    const row = document.createElement("div");
    row.className = "row";
    row.id = "pv-tools";
    row.innerHTML = `<button type="button" class="btn small" id="pv-open"${qs.length ? "" : " disabled"}>면접위원 보기</button>
      <span class="chip" id="pv-count" hidden></span>
      <span class="small muted">짝이 면접위원을 맡을 때 질문을 하나씩 크게 띄웁니다.</span>`;
    tools.appendChild(row);
    const openButton = row.querySelector("#pv-open");
    const count = row.querySelector("#pv-count");
    const find = (selector) => alt.querySelector(selector);
    const currentQ = () => qs[peer.cur];
    const posKey = () => year + "|" + KCP.qkey(currentQ());

    function paintCount() {
      const n = records(peer, qs).current.length;
      count.hidden = n === 0;
      count.textContent = n ? "짝 관찰 " + n + "개" : "";
    }

    function paintNumbers() {
      alt.querySelectorAll("[data-pv-go]").forEach((button, i) => {
        const has = hasObs(readObs(peer, KCP.qkey(qs[i])));
        if (i === peer.cur) button.setAttribute("aria-current", "true");
        else button.removeAttribute("aria-current");
        button.classList.toggle("pv-has", has);
        button.setAttribute("aria-label", "질문 " + (i + 1) + (has ? ", 관찰 있음" : ""));
      });
    }

    function paintProbe() {
      const q = currentQ(), deck = KCP.probeDeck(q.tag, year);
      const p = mem.pos[posKey()];
      const card = Number.isInteger(p) ? deck[p] : null;
      find("#pv-probebox").hidden = !card;
      find("#pv-probe").textContent = card ? "다른 반문" : "반문 카드 보기";
      find("#pv-probe").disabled = !deck.length;
      find("#pv-probetype").textContent = card ? "반문 · " + card.typeName : "";
      find("#pv-probetext").textContent = card ? card.text : "";
    }

    function paintQuestion() {
      const q = currentQ(), o = readObs(peer, KCP.qkey(q));
      paintNumbers();
      find("#pv-meta").innerHTML = KCP.esc("질문 " + (peer.cur + 1) + " / " + qs.length + (q.tag ? " · " + q.tag : ""))
        + " " + KCP.srcTag(q);
      find("#pv-q").textContent = q.q;
      find("#pv-time").hidden = !q.time;
      find("#pv-time").textContent = q.time ? "권장 답변 시간: " + q.time : "";
      find("#pv-rec").hidden = !q.rec;
      find("#pv-rec").textContent = q.rec || "";
      find("#pv-prev").disabled = peer.cur === 0;
      find("#pv-next").disabled = peer.cur === qs.length - 1;
      alt.querySelectorAll("[data-pv-h]").forEach((button) => {
        button.setAttribute("aria-pressed", String(o[button.dataset.pvH]));
      });
      find("#pv-note").value = o.note;
      paintProbe();
    }

    function move(i) {
      if (!mem.open || !Number.isInteger(i) || i < 0 || i >= qs.length || i === peer.cur) return;
      const focused = document.activeElement;
      const numbered = focused && focused.hasAttribute("data-pv-go");
      peer.cur = i;
      paintQuestion();
      find("#pv-live").textContent = "질문 " + (i + 1) + " / " + qs.length;
      if (numbered) find(`[data-pv-go="${i}"]`).focus({ preventScroll: true });
      else if (focused === find("#pv-prev") && focused.disabled) find("#pv-next").focus({ preventScroll: true });
      else if (focused === find("#pv-next") && focused.disabled) find("#pv-prev").focus({ preventScroll: true });
      save();
    }

    function changeObservation(patch) {
      const q = currentQ(), key = KCP.qkey(q);
      const o = Object.assign(readObs(peer, key), patch, { q: q.q });
      if (hasObs(o)) Object.defineProperty(peer.obs, key, { value: o, enumerable: true, configurable: true, writable: true });
      else delete peer.obs[key];
      alt.querySelectorAll("[data-pv-h]").forEach((button) => {
        button.setAttribute("aria-pressed", String(o[button.dataset.pvH]));
      });
      paintNumbers();
      paintCount();
      save();
    }

    function close() {
      if (!mem.open) return;
      KCP.roomAlt(false);
      alt.innerHTML = "";
      mem.open = false;
      paintCount();
      openButton.focus({ preventScroll: true });
      const rect = openButton.getBoundingClientRect();
      if (rect.top < stripOffset() || rect.bottom > window.innerHeight) scrollBelowStrip(openButton);
      if (records(peer, qs).current.length) KCP.toast("관찰 기록은 성찰 단계에서 볼 수 있습니다");
    }

    openButton.addEventListener("click", () => {
      if (!qs.length) return;
      KCP.speakStop();
      if (!KCP.roomAlt(true)) return;
      alt.innerHTML = `<section class="panel" id="pv-view" aria-labelledby="pv-title">
        <div class="row pv-head">
          <h3 id="pv-title" tabindex="-1">면접위원 보기</h3>
          <span class="tag-mine">연습용 짝 면접</span><span class="spacer"></span>
          <button type="button" class="btn small" id="pv-close">지원자 보기로</button>
        </div>
        <p class="small muted">지원자의 메모는 이 화면에 보이지 않습니다. 기기를 짝에게 건네거나 화면을 크게 띄워 씁니다. 시간은 위쪽 띠의 시계로 봅니다.</p>
        <details id="pv-guide"><summary>진행 순서</summary>
          <ol><li>질문을 그대로 읽는다</li><li>답을 끝까지 듣는다</li>
            <li>반문 카드에서 하나를 골라 묻거나, 답에 맞는 반문을 직접 한다</li><li>들은 것을 누르고 한 줄 남긴다</li></ol>
          <p>힌트는 줄 수 있지만 답을 대신 말하지 않습니다.</p>
        </details>
        <div id="pv-nums" role="group" aria-label="질문 번호">${qs.map((q, i) =>
          `<button type="button" class="btn small" data-pv-go="${i}">${i + 1}</button>`).join("")}</div>
        <p class="small muted" id="pv-meta"></p><p id="pv-q"></p>
        <p class="small muted" id="pv-time" hidden></p><p class="small muted" id="pv-rec" hidden></p>
        <div class="row pv-nav">
          <button type="button" class="btn" id="pv-prev"><span aria-hidden="true">◀</span> 이전</button>
          <button type="button" class="btn" id="pv-next">다음 <span aria-hidden="true">▶</span></button>
        </div>
        <section class="pv-sec">
          <h4>반문 <span class="tag-mine">연습용 반문</span></h4>
          <p class="small muted">질문 종류에 따라 미리 정해 둔 문장입니다. 답에 맞는 반문이 떠오르면 직접 물어도 됩니다.</p>
          <button type="button" class="btn small ghost" id="pv-probe">반문 카드 보기</button>
          <div id="pv-probebox" hidden><p class="small" id="pv-probetype"></p><p id="pv-probetext"></p></div>
        </section>
        <section class="pv-sec">
          <h4>들은 것 <span class="tag-mine">연습용 관찰 항목</span></h4>
          <p class="small muted">앞의 세 항목은 연습 중인 세 습관, 마지막은 자료 인용입니다. 들은 것만 누릅니다. 점수가 아닙니다.</p>
          <div id="pv-hab">${KCP.HABITS.map((h) =>
            `<button type="button" class="btn small" data-pv-h="${KCP.esc(h.k)}" aria-pressed="false">${KCP.esc(h.n)}</button>`).join("")}</div>
          <div class="field"><label for="pv-note">관찰 메모</label>
            <input type="text" class="note" id="pv-note" placeholder="예: 기준을 말했지만 무게는 말하지 않음"></div>
        </section>
        <section class="pv-sec">
          <div class="field"><label for="pv-overall">면접 총평(한두 문장)</label>
            <textarea class="note" id="pv-overall" placeholder="들은 것을 사실대로: 잘된 점 하나, 바꿀 점 하나">${KCP.esc(peer.overall)}</textarea></div>
          <p class="small muted">사람이 아니라 말한 내용을 적습니다. 답안 복사 글에 함께 들어갑니다.</p>
        </section>
        <div class="sr-only" id="pv-live" aria-live="polite"></div>
      </section>`;
      paintQuestion();
      mem.open = true;
      find("#pv-close").addEventListener("click", close);
      find("#pv-prev").addEventListener("click", () => move(peer.cur - 1));
      find("#pv-next").addEventListener("click", () => move(peer.cur + 1));
      alt.querySelectorAll("[data-pv-go]").forEach((button) => {
        button.addEventListener("click", () => move(Number(button.dataset.pvGo)));
      });
      find("#pv-probe").addEventListener("click", () => {
        const q = currentQ(), key = KCP.qkey(q), deck = KCP.probeDeck(q.tag, year);
        if (!deck.length) return;
        const previous = mem.pos[posKey()];
        const p = Number.isInteger(previous) ? (previous + 1) % deck.length : 0;
        mem.pos[posKey()] = p;
        paintProbe();
        KCP.emit("peer:probe", { year, state, save, q, key, id: deck[p].id });
      });
      alt.querySelectorAll("[data-pv-h]").forEach((button) => {
        button.addEventListener("click", () => {
          const key = button.dataset.pvH;
          changeObservation({ [key]: !readObs(peer, KCP.qkey(currentQ()))[key] });
        });
      });
      find("#pv-note").addEventListener("input", (e) => changeObservation({ note: e.target.value }));
      find("#pv-overall").addEventListener("input", (e) => { peer.overall = e.target.value; save(); });
      find("#pv-title").focus({ preventScroll: true });
      scrollBelowStrip(find("#pv-view"));
    });

    alt.addEventListener("keydown", (e) => {
      if (!mem.open || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey
        || e.target.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        move(peer.cur + (e.key === "ArrowLeft" ? -1 : 1));
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });
    paintCount();
  });

  KCP.on("reflect:render", ({ left, qs, state, save, meta }) => {
    const peer = getPeer(state, qs);
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.id = "pv-reflect";
    panel.setAttribute("aria-labelledby", "pv-rtitle");
    panel.innerHTML = `<h3 id="pv-rtitle" tabindex="-1">짝의 관찰 <span class="tag-mine">연습용 기록</span></h3>
      <p class="small muted">짝이 면접위원 보기에서 들은 대로 누른 표시입니다. 점수가 아닙니다.</p>
      <div id="pv-rbody"></div>`;
    left.appendChild(panel);
    const body = panel.querySelector("#pv-rbody");

    function list(items, current) {
      return `<ul class="pv-list">${items.map((v) => `<li>
        <p>${KCP.esc((current ? "Q" + (v.i + 1) + ". " : "") + short(v.q, 60))}</p>
        <p>${KCP.esc(names(v.o))}</p>${v.o.note.trim() ? `<p>메모: ${KCP.esc(v.o.note)}</p>` : ""}
      </li>`).join("")}</ul>`;
    }

    function paint() {
      const { current, old } = records(peer, qs);
      if (!current.length && !old.length && !peer.overall.trim()) {
        body.innerHTML = '<p class="small muted" id="pv-empty">면접실의 [면접위원 보기]에서 짝이 기록하면 여기에 나타납니다.</p>';
        return;
      }
      body.innerHTML = `<ul class="pv-habits">${habitLines(current).map((line) => `<li>${KCP.esc(line)}</li>`).join("")}</ul>
        <h4>질문별 기록</h4>${list(current, true)}
        ${old.length ? `<h4>준비실을 바꾸기 전 질문</h4>
          <p class="small muted">지금 질문 목록에 없는 질문의 기록입니다. 위의 개수에 넣지 않았습니다.</p>${list(old, false)}` : ""}
        ${peer.overall.trim() ? `<p id="pv-roverall">총평: ${KCP.esc(peer.overall)}</p>` : ""}
        <div class="row"><button type="button" class="btn small ghost" id="pv-clear">짝 관찰 지우기</button></div>
        <div class="caution" id="pv-clear-confirm" hidden>${meta && meta.original ? "이 게임의" : "이 학년도의"} 짝 관찰 기록(표시, 메모, 총평)이 지워집니다.
          <div class="row"><button type="button" class="btn small" id="pv-clear-yes">지우기</button>
            <button type="button" class="btn small ghost" id="pv-clear-no">취소</button></div>
        </div>`;
      const confirm = body.querySelector("#pv-clear-confirm");
      body.querySelector("#pv-clear").addEventListener("click", () => {
        confirm.hidden = false;
        body.querySelector("#pv-clear-no").focus({ preventScroll: true });
      });
      body.querySelector("#pv-clear-no").addEventListener("click", () => {
        confirm.hidden = true;
        body.querySelector("#pv-clear").focus({ preventScroll: true });
      });
      body.querySelector("#pv-clear-yes").addEventListener("click", () => {
        Object.keys(peer).forEach((key) => delete peer[key]);
        Object.assign(peer, JSON.parse(JSON.stringify(DEF)));
        save();
        paint();
        panel.querySelector("#pv-rtitle").focus({ preventScroll: true });
      });
    }
    paint();
  });

  KCP.on("export:text", ({ qs, state, parts }) => {
    const peer = getPeer(state, qs), { current, old } = records(peer, qs);
    if (!current.length && !old.length && !peer.overall.trim()) return;
    const line = (v, prefix) => prefix + short(v.q, 40) + ": " + names(v.o)
      + (v.o.note.trim() ? " / 메모: " + v.o.note : "");
    const lines = habitLines(current).map((text) => "- " + text);
    current.forEach((v) => lines.push(line(v, "Q" + (v.i + 1) + ". ")));
    if (old.length) {
      lines.push("(준비실을 바꾸기 전 질문)");
      old.forEach((v) => lines.push(line(v, "- ")));
    }
    if (peer.overall.trim()) lines.push("총평: " + peer.overall);
    parts.push("\n■ 짝 관찰\n" + lines.join("\n") + "\n");
  });
})();
