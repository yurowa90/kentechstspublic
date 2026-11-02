/* 말하기 힌트와 TIP
 * 1) 면접실 질문 카드마다 [? 힌트] 버튼 하나. 누르면 짧은 탭 세 개(기준 · 말할 것 · 지식)가 열린다.
 *    기준은 그 해·게임 기준표의 중심 문구 한 줄, 말할 것은 세 줄, 지식은 카드마다 한 줄(자세히를 누르면 전체).
 * 2) 화면이 넘어갈 때와 시뮬레이션을 돌릴 때 한 줄 TIP을 몇 초 띄운다(클릭을 막지 않는다).
 * 확장 슬롯(.qx)에는 정해진 모듈만 넣으므로 힌트는 슬롯 바로 뒤, 카드 안에 붙인다.
 * 연 탭은 state.ext.hints[질문 키] = 1~3으로만 기록한다(점수 아님). 자료는 ui/hint-data.js. */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP || typeof KCP.on !== "function" || typeof KCP.hintFor !== "function") return;
  const esc = KCP.esc;
  const TABS = [["crit", "기준"], ["say", "말할 것"], ["sci", "지식"]];
  let gameId = null;

  function record(payload, n) {
    const h = KCP.ext(payload.state, "hints", {});
    const v = Object.hasOwn(h, payload.key) && Number.isInteger(h[payload.key]) ? h[payload.key] : 0;
    if (v >= n) return;
    Object.defineProperty(h, payload.key, { value: n, writable: true, enumerable: true, configurable: true });
    payload.save();
  }

  function center(hint, meta) {
    const rubric = meta && meta.rubric ? meta.rubric : null;
    if (!rubric) return null;
    for (const el of hint.el) {
      const items = Array.isArray(rubric[el]) ? rubric[el] : [];
      for (const re of hint.pick) {
        const t = items.find((x) => re.test(x));
        if (t) return { el, t };
      }
      if (items[0]) return { el, t: items[0] };
    }
    return null;
  }

  function body(tab, hint, meta) {
    if (tab === "crit") {
      const c = center(hint, meta);
      const official = !(meta && meta.original);
      return c ? `<p class="kh-k">${esc(c.el)}</p><p class="kh-line">${esc(c.t)}</p><p class="kh-src">${official ? "그 해 평가 기준표 문구" : "연습용 평가 기준"}</p>` : "<p class=\"kh-line\">기준표가 없습니다.</p>";
    }
    if (tab === "say") {
      return `<ol class="kh-say">${hint.short.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>`
        + (hint.own ? `<p class="kh-own">이 질문만: ${esc(hint.own)}</p>` : "")
        + '<p class="kh-src">연습용 점검 목록 · 대학 채점 기준 아님</p>';
    }
    if (!hint.sci.length) return "<p class=\"kh-line\">자료의 숫자와 문장을 근거로 쓰세요.</p>";
    return hint.sci.map((c, i) => `<div class="kh-fact"><p class="kh-line"><b>${esc(c.t)}</b> · ${esc(c.k || "")}</p>
      <button type="button" class="kh-more" data-kh-more="${i}" aria-expanded="false">자세히</button>
      <p class="kh-full" hidden>${esc(c.b)}</p></div>`).join("");
  }

  KCP.on("room:card", (payload) => {
    const { card, slot, q, key, year, meta } = payload;
    if (!slot || !q) return;
    gameId = String(year);
    const hint = KCP.hintFor(gameId, q, key);
    const id = "kh-" + payload.i;
    const box = document.createElement("div");
    box.className = "kh";
    box.innerHTML = `<button type="button" class="kh-q" aria-expanded="false" aria-controls="${id}"><span class="kh-qmark" aria-hidden="true">?</span>힌트</button>
      <div class="kh-pop" id="${id}" hidden>
        <div class="kh-tabs" role="tablist" aria-label="힌트 종류">${TABS.map(([k, n], i) => `<button type="button" role="tab" class="kh-tab" data-kh-tab="${k}" aria-selected="${i === 0}">${n}</button>`).join("")}</div>
        <div class="kh-body" role="tabpanel"></div>
      </div>`;
    slot.after(box);
    const pop = box.querySelector(".kh-pop"), out = box.querySelector(".kh-body"), toggle = box.querySelector(".kh-q");
    const show = (k) => {
      box.querySelectorAll("[data-kh-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.khTab === k)));
      out.innerHTML = body(k, hint, meta);
      record(payload, TABS.findIndex(([t]) => t === k) + 1);
    };
    toggle.addEventListener("click", () => {
      const open = pop.hidden;
      pop.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      if (open) show("crit");
    });
    box.querySelectorAll("[data-kh-tab]").forEach((b) => b.addEventListener("click", () => show(b.dataset.khTab)));
    out.addEventListener("click", (e) => {
      const m = e.target.closest("[data-kh-more]");
      if (!m) return;
      const full = m.nextElementSibling, open = full.hidden;
      full.hidden = !open;
      m.setAttribute("aria-expanded", String(open));
      m.textContent = open ? "접기" : "자세히";
    });
  });

  /* ---------- TIP 띠 ---------- */
  let tipEl = null, tipTimer = 0;
  function tip(game) {
    const text = KCP.tipFor(game || gameId || "");
    if (!text) return;
    if (!tipEl || !tipEl.isConnected) {
      tipEl = document.createElement("div");
      tipEl.className = "kh-tipbar";
      tipEl.setAttribute("role", "status");
      document.body.append(tipEl);
    }
    tipEl.innerHTML = `<span class="kh-tip-b">TIP</span><span class="kh-tip-t">${esc(text)}</span>`;
    tipEl.dataset.show = "true";
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => { if (tipEl) tipEl.dataset.show = "false"; }, 6000);
  }
  KCP.tip = tip;

  KCP.on("route:change", ({ name }) => {
    if (tipEl) tipEl.dataset.show = "false";
    const m = String(name).match(/^y([a-z0-9-]+)$/);
    gameId = m ? m[1] : null;
  });
  KCP.on("phase:change", ({ year, to }) => {
    gameId = String(year);
    if (to === "room" || to === "reflect") setTimeout(() => tip(gameId), 350);
  });
  // 시뮬레이션을 돌리는 버튼: 섬 시험 운전·하루 재생, 2024 정착 시뮬레이션, 변이 판독 결과 공개.
  document.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest("#ig-test, #igs-play[aria-pressed='true'], #sim, [data-vd-reveal], #vd-reveal");
    if (t && gameId) setTimeout(() => tip(gameId), 120);
  }, true);
})();
