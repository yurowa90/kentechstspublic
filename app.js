/* 공통 엔진: 라우팅, 저장, 타이머, 면접실·성찰 단계, 차트 도구.
 * 확장 계약: 모듈은 이벤트와 빈 DOM 슬롯을 사용하고, 저장은 키별로 대기한다.
 * ext CSS는 쉼표로 나눈 각 선택자를 자기 접두어로 시작하고 한 줄에 하나씩 쓴다.
 * #strip의 id와 sticky 배치는 유지한다. 모듈은 offsetHeight와 계산된 top만 읽는다.
 */
(function () {
  const KCP = window.KCP;
  KCP.games = KCP.games || {};

  /* ---------- 작은 도구 ---------- */
  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  KCP.esc = esc;
  KCP.$ = (sel, root) => (root || document).querySelector(sel);
  KCP.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // 선택을 그리는 쪽에서 sync()를 호출한다. 관찰자 없이, 목록이 사라지면 함께 수거된다.
  const tabLists = new WeakMap();
  KCP.tabs = function (list, panel, opts = {}) {
    if (tabLists.has(list)) {
      const tabs = tabLists.get(list);
      tabs.sync();
      return tabs;
    }
    const buttons = () => KCP.$$(opts.selector || '[role="tab"]', list);
    const ensureId = (element, base) => {
      if (element.id) return;
      let id = base, suffix = 1;
      while (document.getElementById(id)) id = `${base}-${suffix++}`;
      element.id = id;
    };
    const syncPanel = () => {
      // 순차 초점 후보. 음수 tabindex·disabled·hidden·inert·닫힌 details 안은 세지 않는다(독립 검토 minor).
      const hasFocusable = KCP.$$('a[href], button, input, select, textarea, summary, iframe, audio[controls], video[controls], [tabindex], [contenteditable]:not([contenteditable="false"])', panel)
        .some((el) => el.tabIndex >= 0 && !el.matches(':disabled, input[type="hidden"]') && !el.closest('[hidden], [inert]')
          && !(el.closest('details:not([open])') && !el.matches('details > summary')));
      if (hasFocusable) panel.removeAttribute("tabindex");
      else panel.setAttribute("tabindex", "0");
    };
    const sync = () => {
      ensureId(panel, "tabs-panel");
      panel.setAttribute("role", "tabpanel");
      const all = buttons();
      const selected = all.find((b) => b.getAttribute("aria-selected") === "true") || all[0];
      all.forEach((b, i) => {
        ensureId(b, `tab-${panel.id}-${i + 1}`);
        b.setAttribute("aria-controls", panel.id);
        b.setAttribute("tabindex", b === selected ? "0" : "-1");
      });
      if (selected) panel.setAttribute("aria-labelledby", selected.id);
      else panel.removeAttribute("aria-labelledby");
      syncPanel();
      // 기존 paint는 sync() 뒤 내용을 바꾸므로, DOM 갱신이 끝난 직후에도 판정한다.
      queueMicrotask(syncPanel);
    };
    list.addEventListener("keydown", (e) => {
      // Alt·Ctrl·Meta 조합(브라우저 뒤로 가기 등)은 가로채지 않는다.
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const all = buttons(), index = all.indexOf(e.target.closest('[role="tab"]'));
      if (index === -1) return;
      let next;
      if (e.key === "ArrowLeft") next = (index + all.length - 1) % all.length;
      else if (e.key === "ArrowRight") next = (index + 1) % all.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = all.length - 1;
      else return;
      e.preventDefault();
      all[next].focus();
      all[next].click();
      sync();
    });
    const tabs = { sync };
    tabLists.set(list, tabs);
    sync();
    return tabs;
  };

  KCP.toast = function (msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  };

  /* ---------- 저장 (브라우저 로컬, 실패해도 동작) ---------- */
  const KEY = (y) => "kcp:v1:" + y;
  const plain = (v) => v && typeof v === "object" && !Array.isArray(v);
  const clone = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const pending = new Map();
  // 저장에 실패한 키와 그 값. 다시 그려도 화면의 답변이 옛 저장값으로 돌아가지 않게 read가 먼저 읽는다.
  // 실패하면 경고를 한 번만 띄우고, 실패한 키가 모두 다시 저장되면 경고를 내린다(다음 실패 때 다시 알림).
  const unsaved = new Map();
  function saveWarn() {
    if (document.getElementById("kcp-save-warn") || !document.body) return;
    const t = document.createElement("div");
    t.id = "kcp-save-warn";
    t.className = "kcp-save-warn";
    t.setAttribute("role", "alert");
    t.textContent = "쓴 내용을 이 브라우저에 저장하지 못했어요. 창을 닫기 전에 쓴 내용을 복사해 따로 옮겨 두세요. 다시 저장되면 이 알림은 사라져요.";
    document.body.appendChild(t);
  }
  function saveSettle(key) {
    unsaved.delete(key);
    if (!unsaved.size) document.getElementById("kcp-save-warn")?.remove();
  }
  function cancel(key) {
    const entry = pending.get(key);
    if (entry) clearTimeout(entry.timer);
    pending.delete(key);
  }
  function run(key) {
    const entry = pending.get(key);
    if (!entry) return;
    cancel(key);
    try {
      localStorage.setItem(key, JSON.stringify(entry.value));
      saveSettle(key);
      // 저장이 되살아났으면, 드물게 저장되는 다른 실패 키(목표·설정 등)도 한 번 더 써 본다.
      unsaved.forEach((value, other) => {
        if (pending.has(other)) return;
        try {
          localStorage.setItem(other, JSON.stringify(value));
          saveSettle(other);
        } catch (e) {}
      });
    } catch (e) {
      unsaved.set(key, entry.value);
      saveWarn();
    }
  }
  function schedule(key, value) {
    cancel(key);
    pending.set(key, { value, timer: setTimeout(() => run(key), 250) });
  }
  function read(key, def) {
    try {
      if (pending.has(key)) return clone(pending.get(key).value);
      if (unsaved.has(key)) {
        // 직렬화가 안 되는 값이면 아래의 마지막 저장값으로 넘어간다.
        try { return clone(unsaved.get(key)); } catch (e) {}
      }
      const value = localStorage.getItem(key);
      if (value !== null) return JSON.parse(value);
    } catch (e) {}
    return clone(def);
  }
  function remove(key) {
    cancel(key);
    saveSettle(key);
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  }
  KCP.load = function (year) {
    const base = { phase: "prep", memo: "", answers: {}, rubric: {}, game: {}, timer: null,
      answerQ: {}, compare: { before: "", open: false, better: "", gap: "" }, ext: {} };
    const state = Object.assign(base, read(KEY(year), null) || {});
    ["answers", "rubric", "game", "answerQ", "ext"].forEach((key) => {
      if (!plain(state[key])) state[key] = {};
    });
    state.compare = Object.assign({ before: "", open: false, better: "", gap: "" }, plain(state.compare) ? state.compare : {});
    return state;
  };
  KCP.save = function (year, state) {
    schedule(KEY(year), state);
  };
  KCP.flush = function () {
    Array.from(pending.keys()).forEach(run);
  };
  // 검사 도우미가 대기 저장이 끝났는지 확인할 때만 읽는다(동작은 바꾸지 않음).
  KCP.savePending = () => pending.size;
  KCP.reset = function (year) {
    remove(KEY(year));
    const goal = KCP.goal.get();
    if (goal && String(goal.src) === String(year)) remove(KEY("x:goal"));
  };
  KCP.clearAll = function () {
    Timer.stop();
    KCP.speakStop();
    Array.from(pending.keys()).forEach(cancel);
    Array.from(unsaved.keys()).forEach(saveSettle);
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith("kcp:")) localStorage.removeItem(key);
      }
    } catch (e) {}
    KCP.emit("storage:clear", {});
  };
  KCP.store = {
    get(name, def) {
      return String(name).startsWith("s-") ? clone(def) : read(KEY("x:" + name), def);
    },
    set(name, value) {
      if (!String(name).startsWith("s-")) schedule(KEY("x:" + name), value);
    },
    remove(name) {
      if (!String(name).startsWith("s-")) remove(KEY("x:" + name));
    },
  };
  KCP.ext = function (state, name, defaults) {
    if (!plain(state.ext)) state.ext = {};
    if (!plain(state.ext[name])) state.ext[name] = clone(defaults);
    else Object.keys(defaults).forEach((key) => {
      if (state.ext[name][key] === undefined) state.ext[name][key] = clone(defaults[key]);
    });
    return state.ext[name];
  };
  // 성찰 입력을 비우면 그 해가 정한 목표는 지워진다.
  KCP.goal = {
    get() {
      const v = KCP.store.get("goal", null);
      return plain(v) && typeof v.text === "string" && v.text !== ""
        ? { src: String(v.src || ""), title: String(v.title || ""), text: v.text, at: Number(v.at) || 0 } : null;
    },
    set(src, title, text) {
      const t = String(text == null ? "" : text).trim();
      if (t) KCP.store.set("goal", { src: String(src), title: String(title), text: t, at: Date.now() });
    },
  };
  window.addEventListener("pagehide", KCP.flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") KCP.flush();
  });

  /* ---------- 이벤트와 설정 ---------- */
  const listeners = new Map();
  KCP.on = function (evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, []);
    const entry = { fn };
    listeners.get(evt).push(entry);
    return () => {
      const list = listeners.get(evt);
      const i = list.indexOf(entry);
      if (i !== -1) list.splice(i, 1);
    };
  };
  KCP.emit = function (evt, payload) {
    (listeners.get(evt) || []).slice().forEach(({ fn }) => {
      try { fn(payload); } catch (e) { setTimeout(() => { throw e; }); }
    });
  };
  const DEF = { timeMode: "real", prep: 15, answer: 8, think: 0, endAlert: true };
  const validSetting = {
    timeMode: (v) => ["real", "ext", "custom", "free"].includes(v),
    prep: (v) => Number.isInteger(v) && v >= 1 && v <= 90,
    answer: (v) => Number.isInteger(v) && v >= 1 && v <= 90,
    think: (v) => [0, 10, 30].includes(v),
    endAlert: (v) => typeof v === "boolean",
  };
  function applySettings(target, patch) {
    if (plain(patch)) Object.keys(DEF).forEach((key) => {
      if (validSetting[key](patch[key])) target[key] = patch[key];
    });
    return target;
  }
  const norm = (v) => applySettings(Object.assign({}, DEF), v);
  function urlTimes() {
    const params = new URLSearchParams(location.search);
    const prep = params.get("prep"), answer = params.get("answer");
    return /^[0-9]{1,2}$/.test(prep) && /^[0-9]{1,2}$/.test(answer)
      && validSetting.prep(Number(prep)) && validSetting.answer(Number(answer))
      ? { prep: Number(prep), answer: Number(answer) } : null;
  }
  KCP.settings = function () {
    const s = norm(KCP.store.get("settings", null)), u = urlTimes();
    if (u) return { timeMode: s.timeMode === "ext" || s.timeMode === "free" ? s.timeMode : "custom",
      prep: u.prep, answer: u.answer, think: s.think, endAlert: s.endAlert, fromUrl: true };
    return Object.assign(s, { fromUrl: false });
  };
  KCP.setSettings = function (patch) {
    const cur = applySettings(norm(KCP.store.get("settings", null)), patch);
    KCP.store.set("settings", cur);
    KCP.emit("settings:change", { settings: KCP.settings() });
    return KCP.settings();
  };
  KCP.minutes = function (year, of) {
    if (!Object.hasOwn(KCP.YEARS, year)) return null;
    const meta = KCP.YEARS[year];
    if (!meta) return null;
    const s = KCP.settings(), key = of === "answer" ? "answer" : "prep";
    if (s.timeMode === "free") return null;
    if (s.timeMode === "custom") return s[key];
    if (s.timeMode === "ext") return (s.fromUrl ? s[key] : meta[key]) * 1.5;
    return meta[key];
  };

  /* ---------- 문자열과 게임 이름 ---------- */
  KCP.fmt = (s) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  KCP.mss = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  KCP.qkey = function (q) {
    if (typeof q.k === "string" && q.k !== "") return q.k;
    const text = (q.tag || "") + "|" + q.q;
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  };
  KCP.srcTag = (q) => q && q.src === "report"
    ? '<span class="tag-official">보고서 문항</span>' + (q.frame ? ' <span class="tag-mine">내 계획으로 채움</span>' : '') : '<span class="tag-mine">연습용 질문</span>';
  KCP.josa = function (word, pair) {
    const w = String(word).trim(), code = w.charCodeAt(w.length - 1);
    const jong = code >= 0xAC00 && code <= 0xD7A3 ? (code - 0xAC00) % 28 : null;
    const endings = {
      "을/를": ["을", "를", "을(를)"], "이/가": ["이", "가", "이(가)"],
      "은/는": ["은", "는", "은(는)"], "와/과": ["과", "와", "과(와)"],
      "이고/고": ["이고", "고", "이고"], "으로/로": ["으로", "로", "(으)로"],
    };
    const choices = Object.hasOwn(endings, pair) ? endings[pair] : null;
    if (!choices) return w;
    return w + choices[jong === null ? 2 : jong && !(pair === "으로/로" && jong === 8) ? 0 : 1];
  };
  KCP.critSentence = function (crit) {
    if (!Array.isArray(crit)) return "";
    const items = crit.map((v) => ({ n: String(v && v.n || "").trim(), w: v && [1, 2, 3].includes(v.w) ? v.w : 0 }))
      .filter((v) => v.n).slice(0, 3);
    if (!items.length) return "";
    const head = "제가 판단 기준으로 삼은 것은 ";
    if (items.length === 1 || items.some((v) => !v.w)) return head + items.map((v) => v.n).join(", ") + "입니다.";
    const max = Math.max(...items.map((v) => v.w)), top = items.filter((v) => v.w === max);
    let tail;
    if (top.length === 1) tail = KCP.josa(top[0].n, "을/를") + " 가장 무겁게 두었습니다.";
    else if (top.length === items.length) tail = (items.length === 2 ? "두 기준을" : "세 기준을") + " 같은 무게로 두었습니다.";
    else tail = KCP.josa(top[0].n, "와/과") + " " + KCP.josa(top[1].n, "을/를") + " 똑같이 가장 무겁게 두었습니다.";
    return head + items.slice(0, -1).map((v) => v.n + ", ").join("") + KCP.josa(items[items.length - 1].n, "이고/고") + ", " + tail;
  };
  KCP.tradeSentence = function (o) {
    const pick = String(o && o.pick || "").trim(), gain = String(o && o.gain || "").trim(), cost = String(o && o.cost || "").trim();
    if (!pick || (!gain && !cost)) return "";
    const p = KCP.josa(pick, "은/는") + " ";
    if (gain && cost) return p + gain + " 면에서 유리하지만 " + cost + " 면에서는 불리합니다.";
    return gain ? p + gain + " 면에서 유리합니다." : p + cost + " 면에서 불리합니다.";
  };
  KCP.findCriterion = function (year, re) {
    if (!Object.hasOwn(KCP.YEARS, year)) return null;
    const meta = KCP.YEARS[year];
    return meta ? Object.values(meta.rubric).flat().find((text) => {
      re.lastIndex = 0;
      return re.test(text);
    }) || null : null;
  };
  KCP.gameLabel = (id) => KCP.YEARS[id].original ? KCP.YEARS[id].title : id + "학년도 " + KCP.YEARS[id].title;
  KCP.gameShort = (id) => KCP.YEARS[id].original ? KCP.YEARS[id].title : id + " " + KCP.YEARS[id].title;

  /* ---------- 말해 보기와 인쇄 ---------- */
  let active = null;
  const speakers = new WeakMap();
  KCP.speak = function (container, opts) {
    const previous = speakers.get(container);
    if (previous) previous.end(false);
    const o = opts || {};
    container.innerHTML = '<span class="speak"><button type="button" class="btn small speak-go" aria-pressed="false">말해 보기</button><span class="speak-t small num" aria-live="off"></span><span class="sr-only" aria-live="polite"></span></span>';
    const button = KCP.$(".speak-go", container), display = KCP.$(".speak-t", container), live = KCP.$(".sr-only", container);
    let phase = "idle", started = 0, think = 0, timer = null;
    const elapsed = () => Math.max(0, Math.floor((Date.now() - started) / 1000));
    function end(notify = true) {
      const talking = phase === "talk", seconds = Math.min(600, elapsed());
      clearInterval(timer);
      timer = null;
      phase = "idle";
      if (active === widget) active = null;
      button.textContent = "말해 보기";
      button.setAttribute("aria-pressed", "false");
      display.textContent = "";
      live.textContent = "";
      if (!notify || !talking) return;
      const minutes = Math.floor(seconds / 60);
      live.textContent = "말하기 끝, " + (minutes ? minutes + "분 " : "") + (seconds % 60) + "초";
      if (typeof o.onEnd === "function") o.onEnd(seconds);
      else display.textContent = "방금 " + KCP.mss(seconds);
    }
    function paintTalk() {
      display.textContent = "말하는 중 " + KCP.mss(Math.min(600, elapsed())) + (o.rec ? " · 권장 " + o.rec : "");
    }
    function talk() {
      phase = "talk";
      started = Date.now();
      button.textContent = "끝";
      button.setAttribute("aria-pressed", "true");
      live.textContent = "말하기 시작";
      paintTalk();
    }
    function tick() {
      if (!container.isConnected) { end(false); return; }
      if (phase === "think") {
        const left = Math.max(0, think - elapsed());
        if (!left) talk();
        else display.textContent = "생각 " + KCP.mss(left);
      } else if (phase === "talk") {
        if (elapsed() >= 600) end();
        else paintTalk();
      }
    }
    const widget = { end, container };
    speakers.set(container, widget);
    button.onclick = () => {
      if (phase === "talk") { end(); return; }
      if (phase === "think") { talk(); return; }
      if (active) active.end();
      active = widget;
      think = KCP.settings().think;
      live.textContent = "";
      if (think > 0) {
        phase = "think";
        started = Date.now();
        button.textContent = "바로 말하기";
        button.setAttribute("aria-pressed", "false");
        display.textContent = "생각 " + KCP.mss(think);
      } else talk();
      timer = setInterval(tick, 250);
    };
    return { stop() { if (active === widget) end(); } };
  };
  KCP.speakStop = function () {
    if (active) active.end();
  };
  KCP.print = function (html) {
    let sheet = document.getElementById("printSheet");
    if (!sheet) {
      sheet = document.createElement("div");
      sheet.id = "printSheet";
      document.body.appendChild(sheet);
    }
    sheet.innerHTML = html;
    document.documentElement.classList.add("kcp-printing");
    window.print();
  };
  window.addEventListener("afterprint", () => {
    document.documentElement.classList.remove("kcp-printing");
    const sheet = document.getElementById("printSheet");
    if (sheet) sheet.innerHTML = "";
  });
  KCP.roomAlt = function (open) {
    const main = document.getElementById("room-main"), alt = document.getElementById("room-alt");
    if (!main || !alt) return false;
    main.hidden = !!open;
    alt.hidden = !open;
    return true;
  };

  /* ---------- 클립보드 ---------- */
  KCP.copy = function (text, fallbackEl) {
    const done = () => KCP.toast("복사했습니다");
    const fail = () => {
      if (fallbackEl) {
        fallbackEl.hidden = false;
        fallbackEl.value = text;
        fallbackEl.focus();
        fallbackEl.select();
        KCP.toast("아래 상자의 글을 직접 복사하세요");
      }
    };
    try {
      navigator.clipboard.writeText(text).then(done, fail);
    } catch (e) {
      fail();
    }
  };

  /* ---------- 차트 ---------- */
  // 가로 막대: rows [{label, v, v2?}], max, opts {unit, c1, c2, legend}
  KCP.hbar = function (rows, opts) {
    const o = Object.assign({ max: 100, unit: "", c1: "var(--accent)", c2: "var(--ink-3)", w: 460 }, opts || {});
    const lw = o.labelW || 110;
    const bh = o.v2 ? 9 : 14;
    const rowH = o.v2 ? 30 : 24;
    const top = 18;
    const h = top + rows.length * rowH + 8;
    const cw = o.w - lw - 44;
    const x = (v) => lw + (v / o.max) * cw;
    let g = "";
    const ticks = o.ticks || [0, o.max / 2, o.max];
    ticks.forEach((t) => {
      g += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${top - 4}" y2="${h - 6}"/>`;
      g += `<text x="${x(t)}" y="${top - 7}" text-anchor="middle">${t}</text>`;
    });
    rows.forEach((r, i) => {
      const y = top + i * rowH + 4;
      g += `<text x="${lw - 6}" y="${y + (o.v2 ? 12 : 11)}" text-anchor="end">${esc(r.label)}</text>`;
      if (o.v2) {
        if (r.v2 != null) g += `<rect x="${lw}" y="${y}" width="${Math.max(0, x(r.v2) - lw)}" height="${bh}" fill="${o.c2}"/>`;
        g += `<rect x="${lw}" y="${y + bh + 1}" width="${Math.max(0, x(r.v) - lw)}" height="${bh}" fill="${o.c1}"/>`;
      } else {
        g += `<rect x="${lw}" y="${y}" width="${Math.max(0, x(r.v) - lw)}" height="${bh}" fill="${o.c1}" rx="1"/>`;
        g += `<text x="${x(r.v) + 4}" y="${y + 11}">${r.v}${o.unit}</text>`;
      }
    });
    return `<svg class="chart" viewBox="0 0 ${o.w} ${h}" role="img" aria-label="${esc(o.aria || "막대 그래프")}">${g}</svg>`;
  };

  // 세로 막대: cats [labels], series [{name, color, data}], opts {max, err}
  KCP.vbar = function (cats, series, opts) {
    const o = Object.assign({ max: 100, w: 460, h: 220, ticks: [0, 20, 40, 60, 80, 100] }, opts || {});
    const L = 34, R = 8, T = 12, B = 30;
    const cw = o.w - L - R, ch = o.h - T - B;
    const y = (v) => T + ch - (v / o.max) * ch;
    const gw = cw / cats.length;
    const bw = Math.min(26, (gw * 0.7) / series.length);
    let g = "";
    o.ticks.forEach((t) => {
      g += `<line class="grid" x1="${L}" x2="${o.w - R}" y1="${y(t)}" y2="${y(t)}"/>`;
      g += `<text x="${L - 5}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
    });
    cats.forEach((c, i) => {
      const cx = L + gw * i + gw / 2;
      g += `<text x="${cx}" y="${o.h - 12}" text-anchor="middle">${esc(c)}</text>`;
      series.forEach((s, j) => {
        const v = s.data[i];
        if (v == null) return;
        const bx = cx - (series.length * bw) / 2 + j * bw;
        g += `<rect x="${bx}" y="${y(v)}" width="${bw - 2}" height="${Math.max(0, y(0) - y(v))}" fill="${s.color}"/>`;
        if (o.err && o.err[i]) {
          const e = o.err[i];
          const ex = bx + (bw - 2) / 2;
          g += `<line x1="${ex}" x2="${ex}" y1="${y(v + e)}" y2="${y(Math.max(0, v - e))}" stroke="var(--bad)" stroke-width="1.5"/>`;
          g += `<line x1="${ex - 3}" x2="${ex + 3}" y1="${y(v + e)}" y2="${y(v + e)}" stroke="var(--bad)" stroke-width="1.5"/>`;
        }
      });
    });
    g += `<line class="axis" x1="${L}" x2="${o.w - R}" y1="${y(0)}" y2="${y(0)}"/>`;
    if (o.xlabel) g += `<text x="${o.w - R}" y="${o.h - 1}" text-anchor="end">${esc(o.xlabel)}</text>`;
    if (o.ylabel) g += `<text x="2" y="9">${esc(o.ylabel)}</text>`;
    let leg = "";
    if (series.length > 1 || o.legend) {
      leg = `<div class="legend small">${series
        .map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`)
        .join("")}</div>`;
    }
    return `<svg class="chart" viewBox="0 0 ${o.w} ${o.h}" role="img" aria-label="${esc(o.aria || "막대 그래프")}">${g}</svg>${leg}`;
  };

  // 선/계단 그래프: series [{name,color,data,step}], xs [numbers], opts {min,max,ticks}
  KCP.lines = function (xs, series, opts) {
    const o = Object.assign({ w: 460, h: 220, min: 0, max: 100 }, opts || {});
    const L = 34, R = 10, T = 12, B = 28;
    const cw = o.w - L - R, ch = o.h - T - B;
    const x0 = o.xmin != null ? o.xmin : xs[0];
    const x1 = o.xmax != null ? o.xmax : xs[xs.length - 1];
    const X = (v) => L + ((v - x0) / (x1 - x0)) * cw;
    const Y = (v) => T + ch - ((v - o.min) / (o.max - o.min)) * ch;
    let g = "";
    (o.ticks || []).forEach((t) => {
      g += `<line class="grid" x1="${L}" x2="${o.w - R}" y1="${Y(t)}" y2="${Y(t)}"/>`;
      g += `<text x="${L - 5}" y="${Y(t) + 4}" text-anchor="end">${t}</text>`;
    });
    (o.xticks || xs).forEach((t) => {
      g += `<text x="${X(t)}" y="${o.h - 10}" text-anchor="middle">${t}</text>`;
    });
    if (o.hline != null) g += `<line x1="${L}" x2="${o.w - R}" y1="${Y(o.hline)}" y2="${Y(o.hline)}" stroke="var(--bad)" stroke-width="1"/>`;
    series.forEach((s) => {
      let d = "";
      s.data.forEach((v, i) => {
        if (v == null) return;
        const px = X(s.xs ? s.xs[i] : xs[i]);
        const py = Y(v);
        if (!d) d = `M${px},${py}`;
        else if (s.step) {
          const prev = s.data[i - 1];
          d += ` L${px},${Y(prev)} L${px},${py}`;
        } else d += ` L${px},${py}`;
      });
      if (s.step && s.data.length) d += ` L${X(x1)},${Y(s.data[s.data.length - 1])}`;
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.2}" ${s.dash ? 'stroke-dasharray="5 4"' : ""}/>`;
    });
    if (o.xlabel) g += `<text x="${o.w - R}" y="${o.h}" text-anchor="end">${esc(o.xlabel)}</text>`;
    if (o.ylabel) g += `<text x="2" y="9">${esc(o.ylabel)}</text>`;
    const leg = `<div class="legend small">${series
      .filter((s) => s.name)
      .map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`)
      .join("")}</div>`;
    return `<svg class="chart" viewBox="0 0 ${o.w} ${o.h}" role="img" aria-label="${esc(o.aria || "선 그래프")}">${g}</svg>${leg}`;
  };

  /* ---------- 타이머 ---------- */
  function makeTimer(year, of) {
    const mins = KCP.minutes(year, of);
    const total = mins === null ? 0 : Math.round(mins * 60);
    const timer = { of, mode: KCP.settings().timeMode, running: false, left: total, total };
    if (mins === null) timer.used = 0;
    return timer;
  }
  const timerInProgress = (timer) => timer.running || (timer.mode === "free" ? timer.used > 0 : timer.left < timer.total);
  function timerDiffers(year, timer) {
    const current = makeTimer(year, timer.of);
    return timer.mode !== current.mode || timer.total !== current.total;
  }
  const Timer = {
    id: null,
    tick: null,
    start(state, year, onTick) {
      this.stop();
      const timer = state.timer;
      const free = timer.mode === "free";
      timer.running = true;
      if (free) timer.startAt = Date.now() - (timer.used || 0) * 1000;
      else timer.endAt = Date.now() + timer.left * 1000;
      this.tick = () => {
        const old = free ? timer.used : timer.left;
        if (free) timer.used = Math.max(0, Math.floor((Date.now() - timer.startAt) / 1000));
        else timer.left = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
        const finished = !free && timer.left === 0;
        if (finished) {
          timer.running = false;
          delete timer.endAt;
          this.stop();
          if (KCP.settings().endAlert) KCP.toast(timer.of === "prep" ? "준비 시간이 끝났습니다. 면접실로 이동하세요." : "면접 시간이 끝났습니다.");
        }
        if (old !== (free ? timer.used : timer.left) || finished) {
          onTick();
          KCP.save(year, state);
        }
      };
      this.id = setInterval(this.tick, 250);
    },
    stop() {
      if (this.id) clearInterval(this.id);
      this.id = null;
      this.tick = null;
    },
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Timer.id && Timer.tick) Timer.tick();
  });

  /* ---------- 홈 ---------- */
  function renderHome(app) {
    Timer.stop();
    document.title = "켄텍 창의성 면접 연습실";
    const cards = KCP.ORDER.map((y) => {
      const m = KCP.YEARS[y];
      const st = KCP.load(y);
      const touched = st && (st.memo || Object.keys(st.game || {}).length);
      const card = `<a class="pkg" href="#y${y}">
        <span class="flap" aria-hidden="true"></span>
        <span class="label">${y}학년도 수시</span>
        <span class="yr">${y}</span>
        <span class="fmt">${esc(m.title)}</span>
        <span class="desc">${esc(m.desc)}</span>
        <span class="meta">
          <span class="chip">${esc(m.format)}</span>
          <span class="chip num">준비 ${m.prep}분 · 답변 ${m.answer}분</span>
          ${touched ? '<span class="chip accent">이어서 하기</span>' : ""}
        </span>
      </a>`;
      if (y !== "2022" || !KCP.routes?.league) return card;
      return `<section class="home-power-pair" aria-label="2022 기출과 전력 리그 확장판">${card}<article class="home-league-card"><figure class="home-league-map"><canvas id="home-league-map" role="img" aria-label="전력 리그 광역 지도"></canvas></figure><div class="home-league-copy"><span class="label">창작 게임</span><h2>2022 확장판 · 전력 리그</h2><p>2022 문항의 발전소 배치를 여러 도시로 넓혔어요. 한 달에 한 번 짓고 운영하며, 주민·기업·탄소를 두고 이웃 도시와 겨룹니다.</p><div class="home-league-actions"><a class="v2-btn primary" href="#league">혼자 하기<small>컴퓨터 도시와 · 한 탭</small></a><a class="v2-btn" href="#league/multi">멀티<small>진행자 + 팀 2~6</small></a></div><div class="meta"><span class="chip">12·24·36달</span><span class="chip">1턴 = 1달</span></div></div></article></section>`;
    }).join("");
    const originals = (KCP.ORIGINAL_ORDER || []).map((id) => {
      const m = KCP.YEARS[id], st = KCP.load(id);
      const touched = st.memo || Object.keys(st.game).length;
      return `<a class="opkg" href="#y${esc(id)}">
        <span class="fmt">${esc(m.title)}</span>
        <span class="desc">${esc(m.desc)}</span>
        <span class="meta">${(m.topics || []).map((topic) => `<span class="chip">${esc(topic)}</span>`).join("")}
          <span class="chip num">준비 ${esc(m.prep)}분 · 답변 ${esc(m.answer)}분</span>
          ${touched ? '<span class="chip accent">이어서 하기</span>' : ""}
        </span>
      </a>`;
    }).join("");

    app.innerHTML = `
      <header class="masthead">
        <span class="label">한국에너지공과대학교 수시 일반전형 2단계</span>
        <h1>켄텍 창의성 면접 <em>연습실</em></h1>
        <p class="lede">2022~2026학년도 기출 다섯 해를 각각 게임으로 옮겼습니다. 준비실에서 자료를 조작하며 답을 만들고, 면접실에서 후속 질문에 답한 뒤, 성찰 단계에서 공식 평가 기준으로 스스로 점검합니다.</p>
        <p class="disclaimer">대학의 선행학습 영향평가 보고서(2022~2026)에 공개된 문항과 자료를 학습용으로 재구성한 비공식 연습 도구입니다. 2024학년도 시뮬레이션의 내부 계산식처럼 공개되지 않은 부분은 공개 자료와 예시 답안에 맞춰 새로 설계했고, 화면에 '재구성'이라고 표시했습니다. 입력한 내용은 이 브라우저에만 저장됩니다.</p>
      </header>
      <div class="home-grid">${cards}</div>
      <div id="home-slot" class="stack ext-slot"></div>
      ${originals ? `<section id="home-originals">
        <h2>창작 쟁점 게임 <span class="tag-mine">창작 게임 · 대학 출제와 무관</span></h2>
        <p class="small muted">기출을 옮긴 게임이 아니라, 과학·사회 쟁점과 기술 정책을 다루도록 연습실이 새로 만든 게임입니다. 배경과 수치는 가상입니다.</p>
        <div class="original-grid">${originals}</div>
      </section>` : ""}
      <div class="home-notes">
        <section>
          <h2>면접 공통 원칙</h2>
          <ul>
            <li>고교 교육과정 범위 안에서 이해하고 해결할 수 있는 열린 문항입니다. 정답이나 모범 답안이 없습니다.</li>
            <li>지원자 1명을 면접위원 2명이 평가하며, 답변에 대한 후속 질의응답으로 생각을 전개해 나가는 과정을 봅니다.</li>
            <li>평가 요소는 매년 같습니다. 발산적 사고력, 문제해결 능력, 인문적 통찰 역량입니다.</li>
            <li>대학은 매해 다른 유형을 출제해 기출 정형화에 따른 사교육 효과를 차단하겠다고 밝혔습니다.</li>
          </ul>
        </section>
        <section>
          <h2>이 연습실 쓰는 법</h2>
          <ul>
            <li><b>준비실</b>에서 타이머를 켜고 자료를 조작하며 답을 만듭니다.</li>
            <li><b>면접실</b>에서는 내 계획에 맞춰 나오는 후속 질문에 말로 답해 보고, 핵심을 적어 둡니다.</li>
            <li><b>성찰</b>에서 공식 평가 기준 9개 항목으로 자기 평가를 하고, 출제 의도와 예시 답안을 비교합니다.</li>
            <li>수업에서는 짝이 면접위원 역할을 맡아 면접실의 [면접위원 보기]로 질문을 하나씩 읽고 반문해 주면 실제 형식에 가깝습니다.</li>
            <li>시간이 부족하면 게임 화면 위 띠의 [시간 설정]에서 연장 1.5배나 시간 제한 없음으로 연습할 수 있습니다.</li>
            <li>짧은 판단 훈련장에서는 가상 과제로 같은 절차(기준 → 얻고 잃는 것 → 반문)를 연습합니다.</li>
            <li>창작 쟁점 게임은 기출과 같은 순서로 진행하며, 과학·사회 쟁점에서 같은 습관을 연습합니다.</li>
          </ul>
        </section>
        <section>
          <h2>표시 읽는 법</h2>
          <ul>
            <li><span class="tag-official">보고서 요약</span>, <span class="tag-official">보고서 문항</span>처럼 청록 테두리 표시는 선행학습 영향평가 보고서에서 옮기거나 요약한 내용입니다.</li>
            <li><span class="tag-mine">재구성</span>, <span class="tag-mine">연습용 질문</span>처럼 황색 테두리 표시는 이 연습실이 새로 만든 질문·계산식·해설·척도·연습 도구입니다. 대학의 평가 기준이 아닙니다.</li>
            <li>색을 구분하기 어려우면 태그 글자를 보세요. 새로 만든 내용의 태그는 연습용으로 시작하거나 재구성, 비공식 해설, 가상 자료, 가상의 답 가운데 하나입니다.</li>
          </ul>
        </section>
      </div>
      <section class="evo">
        <h2 style="font-size:17px;margin-bottom:8px">다섯 해 형식 변화</h2>
        <table>
          <thead><tr><th>학년도</th><th>과제 형식</th><th>시간</th><th>면접 구성</th><th>핵심 사고 <span class="tag-mine">연습용 정리</span></th></tr></thead>
          <tbody>
            <tr><td class="num">2022</td><td>카드·지도·데이터로 발전소 배치</td><td class="num">30 + 25분</td><td>학생부 30 · 창의성 70</td><td>공간 자료 통합, 얻는 것과 잃는 것</td></tr>
            <tr><td class="num">2023</td><td>경로도를 따라 10년 실행 계획</td><td class="num">35 + 25분</td><td>창의성 70 · 학생부 30</td><td>시간축 의사결정, 경쟁국 비교</td></tr>
            <tr><td class="num">2024</td><td>온라인 정착 시뮬레이션, 맞춤형 질문 최대 8개</td><td class="num">35 + 25분</td><td>창의성 70 · 학생부 30</td><td>균형과 집중, 가설 검증</td></tr>
            <tr><td class="num">2025</td><td>가상 신문 4부 발행 순서 추론</td><td class="num">30 + 15분</td><td>창의성 100</td><td>인과 추론, 기술과 사회</td></tr>
            <tr><td class="num">2026</td><td>평가위원이 되어 홍보자료 비판적 평가</td><td class="num">30 + 15분</td><td>창의성 100</td><td>데이터 문해력, 다기준 판단</td></tr>
          </tbody>
        </table>
      </section>
      <footer class="home-foot">
        <p class="small muted">입력한 내용은 이 브라우저에만 저장됩니다. 학교 공용 컴퓨터라면 연습을 마친 뒤 지우세요.</p>
        <button class="btn small ghost" id="wipeAll" type="button">이 기기 기록 모두 지우기</button>
        <button type="button" id="fb-open-home" class="btn small ghost">테스터 의견 보내기</button>
        <div id="wipeConfirm" class="caution" hidden>이 브라우저에 저장된 연습실 기록이 모두 지워집니다(다섯 해${(KCP.ORIGINAL_ORDER || []).length ? "와 창작 게임" : ""}의 입력과 판단 노트·반문·짝 관찰, 훈련장 기록, 지난 목표, 시간 설정, 의견 보내기에 쓰던 글). 되돌릴 수 없습니다.
          <div class="row"><button class="btn small" id="wipeYes" type="button">지우기</button><button class="btn small ghost" id="wipeNo" type="button">취소</button></div>
        </div>
      </footer>`;
    KCP.$("#fb-open-home", app).onclick = e => KCP.feedback?.open(undefined, e.currentTarget);
    KCP.$("#wipeAll", app).onclick = () => {
      KCP.$("#wipeConfirm", app).hidden = false;
      KCP.$("#wipeNo", app).focus();
    };
    KCP.$("#wipeNo", app).onclick = () => {
      KCP.$("#wipeConfirm", app).hidden = true;
      KCP.$("#wipeAll", app).focus();
    };
    KCP.$("#wipeYes", app).onclick = () => {
      KCP.clearAll();
      KCP.rerender();
      KCP.toast("이 기기의 기록을 지웠습니다");
    };
    KCP.emit("home:render", { app, slot: KCP.$("#home-slot", app) });
  }

  /* ---------- 게임 화면 ---------- */
  function renderGame(app, year) {
    Timer.stop();
    KCP.speakStop();
    const meta = KCP.YEARS[year];
    const game = KCP.games[year];
    const state = KCP.load(year);
    if (!plain(state.timer)) state.timer = makeTimer(year, "prep");
    if (!state.timer.mode) state.timer.mode = "real";
    state.timer.running = false;
    delete state.timer.endAt;
    delete state.timer.startAt;
    if (!timerInProgress(state.timer) && timerDiffers(year, state.timer)) state.timer = makeTimer(year, state.timer.of);
    const save = () => KCP.save(year, state);
    document.title = `${KCP.gameShort(year)} · 켄텍 창의성 면접 연습실`;

    app.innerHTML = `
      <div class="strip" id="strip">
        <a href="#home">← 연습실</a>
        <span class="ttl">${esc(KCP.gameShort(year))}<small>${esc(meta.format)}</small></span>
        <span class="chip tmode" id="tmode" hidden></span>
        <div class="phases" role="group" aria-label="단계">
          <button data-phase="prep">준비실</button>
          <button data-phase="room">면접실</button>
          <button data-phase="reflect">성찰</button>
        </div>
        <div class="timer">
          <span class="label" id="tlabel" style="color:inherit;opacity:.7"></span>
          <span class="clock" id="clock" aria-live="off"></span>
          <button id="tgo">시작</button>
          <button id="treset" title="시간 초기화">↺</button>
          <button id="tset" type="button" aria-expanded="false" aria-controls="timeset">시간 설정</button>
        </div>
        <div class="progress" id="tbar"></div>
      </div>
      <section class="panel timeset" id="timeset" hidden aria-labelledby="timeset-h">
        <h3 id="timeset-h">시간 설정</h3>
        <div class="field">
          <span class="small">시간 모드</span>
          <div class="seg" role="group" aria-label="시간 모드">
            <button type="button" data-tm="real" aria-pressed="false">실전</button>
            <button type="button" data-tm="ext" aria-pressed="false">연장 1.5배</button>
            <button type="button" data-tm="custom" aria-pressed="false">직접 정하기</button>
            <button type="button" data-tm="free" aria-pressed="false">시간 제한 없음</button>
          </div>
          <div class="row" id="tm-custom" hidden>
            <label class="field" for="tm-prep">준비(분)<input class="note" type="number" id="tm-prep" min="1" max="90" step="1"></label>
            <label class="field" for="tm-answer">답변(분)<input class="note" type="number" id="tm-answer" min="1" max="90" step="1"></label>
          </div>
        </div>
        <div class="field">
          <span class="small">질문마다 생각 시간</span>
          <div class="seg" role="group" aria-label="질문마다 생각 시간">
            <button type="button" data-think="0" aria-pressed="false">없음</button>
            <button type="button" data-think="10" aria-pressed="false">10초</button>
            <button type="button" data-think="30" aria-pressed="false">30초</button>
          </div>
          <p class="small muted">말해 보기를 누른 뒤 말하기 전에 주는 시간입니다.</p>
        </div>
        <label class="small"><input type="checkbox" id="tm-alert"> 시간이 끝나면 알림</label>
        <p class="small muted">처음에는 연장이나 시간 제한 없이 형식에 익숙해지고, 시험이 가까워지면 실전 시간으로 연습하세요. <span class="tag-mine">연습용 조언</span></p>
        <div id="tm-confirm" class="caution" hidden>진행 중인 시간이 처음부터 다시 시작됩니다.
          <div class="row"><button class="btn small" id="tm-yes" type="button">바꾸기</button><button class="btn small ghost" id="tm-no" type="button">취소</button></div>
        </div>
        <p class="small muted" id="tm-url" hidden></p>
        <div class="row fb-entry"><button type="button" id="fb-open-settings" class="btn small ghost">테스터 의견 보내기</button></div>
      </section>
      <div class="brief">${meta.original ? '<p class="small original-notice"><span class="tag-mine">창작 게임 · 가상 자료</span></p>' : ""}${game.brief(state)}</div>
      <p class="small muted tm-tip" id="tm-tip">시간이 부족하면 [시간 설정]에서 연장하거나 시간 제한 없이 연습할 수 있습니다. <span class="tag-mine">연습용 조언</span></p>
      <main id="phase"></main>`;

    const clock = KCP.$("#clock");
    const tgo = KCP.$("#tgo");
    const tbar = KCP.$("#tbar");
    const tlabel = KCP.$("#tlabel");
    const tmode = KCP.$("#tmode");
    const timeset = KCP.$("#timeset");
    KCP.$("#fb-open-settings", timeset).onclick = e => KCP.feedback?.open(undefined, e.currentTarget);
    const tset = KCP.$("#tset");
    let timePatch = null;
    const paintTimeMode = () => {
      const s = KCP.settings();
      let text = "";
      if (timerInProgress(state.timer) && timerDiffers(year, state.timer)) text = "이전 설정으로 진행 중";
      else if (s.fromUrl) {
        text = s.timeMode === "free" ? "수업 주소 · 시간 제한 없음"
          : `수업 주소 ${s.prep}·${s.answer}분` + (s.timeMode === "ext" ? " · 연장 1.5배" : "");
      } else if (s.timeMode === "ext") text = "연장 1.5배";
      else if (s.timeMode === "custom") text = `직접 ${s.prep}·${s.answer}분`;
      else if (s.timeMode === "free") text = "시간 제한 없음";
      tmode.textContent = text;
      tmode.hidden = !text;
      KCP.$("#tm-tip").hidden = s.timeMode !== "real" || s.fromUrl;
    };
    const paintSettings = () => {
      const s = KCP.settings();
      KCP.$$("[data-tm]", timeset).forEach((b) => {
        const mode = b.dataset.tm;
        b.setAttribute("aria-pressed", String(s.fromUrl && mode === "real" ? s.timeMode === "custom" : !(s.fromUrl && mode === "custom") && s.timeMode === mode));
        b.disabled = s.fromUrl && mode === "custom";
        if (mode === "real") b.textContent = s.fromUrl ? "수업 주소 시간" : "실전";
      });
      KCP.$("#tm-custom", timeset).hidden = s.timeMode !== "custom" || s.fromUrl;
      ["prep", "answer"].forEach((of) => {
        const input = KCP.$("#tm-" + of, timeset);
        // 확인을 기다리는 값이 있으면 사용자가 방금 쓴 값을 그대로 보여 준다
        input.value = timePatch && of in timePatch ? timePatch[of] : s[of];
        input.disabled = s.fromUrl;
      });
      KCP.$$("[data-think]", timeset).forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.think) === s.think)));
      KCP.$("#tm-alert", timeset).checked = s.endAlert;
      const url = KCP.$("#tm-url", timeset);
      url.hidden = !s.fromUrl;
      url.textContent = s.fromUrl ? `수업 주소에 지정된 시간(준비 ${s.prep}분 · 답변 ${s.answer}분)을 쓰는 중입니다. 연장이나 시간 제한 없음은 그대로 고를 수 있습니다.` : "";
      paintTimeMode();
    };
    const paintTimer = () => {
      const free = state.timer.mode === "free";
      clock.textContent = KCP.fmt(free ? state.timer.used || 0 : state.timer.left);
      clock.classList.toggle("low", !free && state.timer.left <= 300);
      tgo.textContent = state.timer.running ? "일시정지" : "시작";
      tlabel.textContent = (state.timer.of === "prep" ? "준비" : "답변") + (free ? " 경과" : "");
      tbar.hidden = free;
      tbar.style.width = (state.timer.total ? 100 * (1 - state.timer.left / state.timer.total) : 0).toFixed(1) + "%";
      paintTimeMode();
    };
    const setTimerFor = (of) => {
      Timer.stop();
      state.timer = makeTimer(year, of);
      paintTimer();
      save();
    };
    tgo.onclick = () => {
      if (state.timer.running) {
        if (Timer.tick) Timer.tick();
        state.timer.running = false;
        delete state.timer.endAt;
        delete state.timer.startAt;
        Timer.stop();
      } else Timer.start(state, year, paintTimer);
      paintTimer();
      save();
    };
    KCP.$("#treset").onclick = () => setTimerFor(state.phase === "room" ? "answer" : "prep");
    const applyTimePatch = (patch) => {
      KCP.setSettings(patch);
      setTimerFor(state.timer.of);
      timePatch = null;
      KCP.$("#tm-confirm", timeset).hidden = true;
      paintSettings();
      focusPressedMode();
    };
    // 확인창을 닫으면 포커스를 패널 안의 눌린 모드 버튼으로 돌린다(Escape로 패널을 닫을 수 있게)
    const focusPressedMode = () => {
      const pressed = KCP.$('[data-tm][aria-pressed="true"]', timeset) || KCP.$("[data-tm]", timeset);
      if (pressed && !timeset.hidden) pressed.focus();
    };
    const requestTimePatch = (patch) => {
      if (timerInProgress(state.timer)) {
        timePatch = patch;
        KCP.$("#tm-confirm", timeset).hidden = false;
        paintSettings();
        KCP.$("#tm-yes", timeset).focus();
      } else applyTimePatch(patch);
    };
    KCP.$$("[data-tm]", timeset).forEach((b) => {
      b.onclick = () => requestTimePatch({ timeMode: b.dataset.tm });
    });
    ["prep", "answer"].forEach((of) => {
      KCP.$("#tm-" + of, timeset).onchange = (e) => {
        const value = Number(e.target.value);
        if (!KCP.settings().fromUrl && validSetting[of](value)) requestTimePatch({ [of]: value });
        else paintSettings();
      };
    });
    KCP.$("#tm-yes", timeset).onclick = () => { if (timePatch) applyTimePatch(timePatch); };
    KCP.$("#tm-no", timeset).onclick = () => {
      timePatch = null;
      KCP.$("#tm-confirm", timeset).hidden = true;
      paintSettings();
      focusPressedMode();
    };
    KCP.$$("[data-think]", timeset).forEach((b) => {
      b.onclick = () => { KCP.setSettings({ think: Number(b.dataset.think) }); paintSettings(); };
    });
    KCP.$("#tm-alert", timeset).onchange = (e) => { KCP.setSettings({ endAlert: e.target.checked }); paintSettings(); };
    const closeSettings = () => {
      timeset.hidden = true;
      tset.setAttribute("aria-expanded", "false");
      tset.focus({ preventScroll: true });
    };
    tset.onclick = () => {
      if (!timeset.hidden) { closeSettings(); return; }
      paintSettings();
      timeset.hidden = false;
      tset.setAttribute("aria-expanded", "true");
      window.scrollTo({ top: 0 });
      KCP.$('[data-tm][aria-pressed="true"]', timeset).focus({ preventScroll: true });
    };
    timeset.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); closeSettings(); }
    });
    paintSettings();
    paintTimer();

    const phaseEl = KCP.$("#phase");
    let cur = null;
    const showPhase = (p) => {
      KCP.speakStop();
      KCP.emit("phase:change", { year, from: cur, to: p, state });
      cur = p;
      state.phase = p;
      KCP.$$(".phases button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.phase === p)));
      if (p === "room" && state.timer.of !== "answer") setTimerFor("answer");
      if (p === "prep" && state.timer.of !== "prep" && !state.timer.running) setTimerFor("prep");
      save();
      phaseEl.innerHTML = "";
      if (p === "prep") {
        phaseEl.innerHTML = `<div id="prep-top" class="stack ext-slot"></div><div id="prep-body" data-prep-year="${esc(year)}"></div>`;
        const top = KCP.$("#prep-top", phaseEl), body = KCP.$("#prep-body", phaseEl);
        game.renderPrep(body, state, save, () => showPhase("room"));
        KCP.emit("prep:render", { root: phaseEl, top, body, year, meta, state, save });
      }
      if (p === "room") renderRoom(phaseEl, state, save, year, () => showPhase("reflect"));
      if (p === "reflect") renderReflect(phaseEl, state, save, year);
      window.scrollTo({ top: 0 });
    };
    KCP.$$(".phases button").forEach((b) => (b.onclick = () => showPhase(b.dataset.phase)));
    showPhase(state.phase || "prep");
    currentGo = showPhase;
  }

  /* ---------- 면접실 ---------- */
  const hasAnswer = (state, key) => String(state.answers[key] || "").trim() !== "";
  const staleAnswer = (state, q, i) => hasAnswer(state, i) && state.answerQ[i] && state.answerQ[i] !== q.q;
  const orphanKeys = (state, qs) => Object.keys(state.answers)
    .filter((key) => /^[0-9]+$/.test(key) && Number(key) >= qs.length && hasAnswer(state, key))
    .sort((a, b) => Number(a) - Number(b));
  const legacyAnswers = (state) => Object.keys(state.answers).some((key) => hasAnswer(state, key) && !state.answerQ[key]);
  function renderRoom(root, state, save, year, next) {
    const game = KCP.games[year];
    const meta = KCP.YEARS[year];
    const qs = game.questions(state);
    const recap = game.recap(state);
    const orphans = orphanKeys(state, qs);
    const folded = qs.filter((q, i) => q.fold && !hasAnswer(state, i)).length;
    const c = KCP.findCriterion(year, /비판적 의견|한계점/);
    const f = KCP.findCriterion(year, /유연한 사고/);
    let advice = "반문을 받으면 답을 고치거나, 유지한다면 그 이유를 말합니다.";
    if (!meta.original && c) advice += ` 이 해의 평가 기준: “${esc(c)}” <span class="tag-official">평가 기준</span>`;
    else if (!meta.original && f) advice += ` 이 해의 평가 기준표에는 비판 수용 항목이 따로 없습니다. 조건이 바뀔 때의 대응은 다음 기준과 가깝다고 봅니다. <span class="tag-mine">연습용 해석</span> “${esc(f)}” <span class="tag-official">평가 기준</span>`;
    root.innerHTML = `
      <div id="room-main">
      <div class="desk">
        <div class="stack">
          <section class="panel">
            <h3>면접 질문 카드 <span class="chip num">${qs.length}개</span></h3>
            <p class="small muted room-tip" style="margin-bottom:10px">${meta.roomTip || "질문을 소리 내어 읽고 1~3분 안에 말로 답해 보세요. 짝이 있다면 짝이 면접위원이 되어 읽어 줍니다. 답한 뒤 핵심만 적어 둡니다."}</p>
            <p class="small muted room-sources">${meta.roomSources || (meta.original
              ? "이 게임의 질문은 모두 연습실이 준비실 결과에 맞춰 만든 연습용 질문입니다. 실제 면접에서는 면접위원이 답을 들으며 후속 질문을 이어 갑니다."
              : "'보고서 문항'은 보고서에 실린 과제나 질문 예시를 면접 질문 형태로 바꾼 것입니다(일부는 내가 고른 내용이 들어갑니다)." + (qs.some((q) => q.frame) ? " '내 계획으로 채움'이 붙은 질문은 보고서 질문의 틀에 내 계획을 넣어 만든 것입니다." : "") + " '연습용 질문'은 이 연습실이 준비실 결과에 맞춰 고르거나 만든 질문이며, 일부는 보고서의 질문 예시를 바탕으로 했습니다. 실제 면접에서는 면접위원이 답을 들으며 후속 질문을 이어 갑니다.")}</p>
            ${legacyAnswers(state) ? '<p class="small muted" id="room-legacy">질문이 기록되기 전에 쓴 옛 메모가 있습니다. 준비실 내용이 바뀌었다면 다른 질문 아래에 보일 수 있습니다.</p>' : ""}${folded ? `<p class="small muted" id="room-folds">가벼운 질문 ${folded}개는 처음에 접혀 있습니다. '질문 보기'를 누르면 열립니다.</p>` : ""}
            <div id="room-tools" class="stack ext-slot"></div>
            ${qs.length ? "" : `<div class="caution room-empty" id="room-empty">아직 질문이 없습니다. 준비실에서 계획을 확정하면 내 선택에 맞춘 질문이 만들어집니다.
              <div class="row" style="margin-top:6px"><button class="btn small" type="button" id="room-to-prep">준비실로 돌아가기</button></div></div>`}
            <div class="qdeck">
              ${qs
                .map(
                  (q, i) => `<div class="qcard${q.fold ? " qfold" : ""}">
                    <div class="who"${q.fold ? ` id="qwho-${esc(year)}-${i}"` : ""}>질문 ${i + 1}${q.tag ? " · " + esc(q.tag) : ""} ${KCP.srcTag(q)}</div>${q.fold ? `
                    <button type="button" class="btn small qfold-toggle" aria-expanded="${hasAnswer(state, i)}" aria-controls="qfold-${esc(year)}-${i}" aria-describedby="qwho-${esc(year)}-${i}" style="min-height:44px;min-width:44px">${hasAnswer(state, i) ? "질문 접기" : "질문 보기"}</button>
                    <div class="qfold-body" id="qfold-${esc(year)}-${i}"${hasAnswer(state, i) ? "" : " hidden"}>` : ""}
                    <div class="q">${esc(q.q)}</div>
                    ${q.time ? `<div class="rec">권장 답변 시간: ${esc(q.time)}</div>` : ""}
                    ${q.rec ? `<div class="rec">${esc(q.rec)}</div>` : ""}
                    ${staleAnswer(state, q, i) ? `<div class="stale caution small" data-stale="${i}">
                      이 메모를 쓴 뒤 질문이 바뀌었습니다. 준비실 내용을 바꾸면 질문도 바뀝니다. 메모를 쓸 때의 질문: '${esc(String(state.answerQ[i]).slice(0, 60))}${String(state.answerQ[i]).length > 60 ? "…" : ""}'
                      <div class="row"><button class="btn small" type="button" data-stale-keep="${i}">지금 질문의 메모로 쓰기</button><button class="btn small ghost" type="button" data-stale-clear="${i}">메모 비우기</button></div>
                    </div>` : ""}
                    <textarea class="note" data-a="${i}" id="ans-${year}-${i}" aria-label="질문 ${i + 1} 답변 메모" placeholder="답변의 핵심 한두 문장">${esc(
                      state.answers[i] || ""
                    )}</textarea>
                    <div class="qx ext-slot" data-qx="${i}"></div>${q.fold ? `
                    </div>` : ""}
                  </div>`
                )
                .join("")}
            </div>
            ${orphans.length ? `<div id="room-orphans" class="caution small">
              <h4>질문 목록에서 빠진 메모</h4>
              <p>준비실 내용이 바뀌어 질문 수가 줄었습니다. 필요한 내용은 지금 질문 칸으로 옮겨 적으세요.</p>
              <ul>${orphans.map((key) => `<li>${state.answerQ[key] ? `(메모를 쓸 때의 질문: ${esc(state.answerQ[key])}) ` : ""}${esc(state.answers[key])}</li>`).join("")}</ul>
              <button class="btn small ghost" id="orphan-clear" type="button">빠진 메모 지우기</button>
            </div>` : ""}
          </section>
        </div>
        <div class="stack">
          <section class="panel">
            <h3>준비실에서 만든 답</h3>
            <dl class="recap">${recap.map((r) => `<dt>${esc(r.t)}</dt><dd>${r.html ? r.d : esc(r.d || "(비어 있음)")}</dd>`).join("")}</dl>
          </section>
          <div id="room-side" class="stack ext-slot"></div>
          <section class="panel answer-tips">
            <h3 class="h-wrap">답변 요령 <span class="tag-mine">연습용 조언</span></h3>
            <ul class="small muted" style="margin:0;padding-left:1.1em">
              <li>결론을 먼저 말하고 근거를 두세 개 붙입니다.</li>
              <li>자료의 숫자나 문장을 짚어 근거로 씁니다.</li>
              <li>${advice}</li>
            </ul>
            <div class="row" style="margin-top:12px"><button class="btn primary" id="toReflect">성찰로 이동</button></div>
          </section>
        </div>
      </div>
      </div><div id="room-alt" hidden></div>`;
    const untilFound = "onbeforematch" in document.body;
    const setFold = (b, body, closed) => {
      if (closed) {
        body.setAttribute("hidden", untilFound ? "until-found" : "");
        if (untilFound) body.style.setProperty("display", "block", "important");
      } else body.hidden = false;
      if (!closed || !untilFound) body.style.removeProperty("display");
      b.setAttribute("aria-expanded", String(!closed));
      b.textContent = closed ? "질문 보기" : "질문 접기";
    };
    const refreshFolds = () => {
      const count = KCP.$$(".qfold-body", root).filter((body) => body.hidden).length;
      let notice = KCP.$("#room-folds", root);
      if (!count) { notice?.remove(); return; }
      if (!notice) {
        notice = document.createElement("p");
        notice.id = "room-folds";
        notice.className = "small muted";
        KCP.$("#room-tools", root).before(notice);
      }
      notice.textContent = `가벼운 질문 ${count}개는 처음에 접혀 있습니다. '질문 보기'를 누르면 열립니다.`;
    };
    KCP.$$(".qfold-toggle", root).forEach((b) => {
      const body = KCP.$(".qfold-body", b.parentElement);
      setFold(b, body, !!body.hidden);
      b.onclick = () => {
        const closed = !body.hidden;
        if (closed && active && body.contains(active.container)) active.end();
        setFold(b, body, closed);
        refreshFolds();
        b.focus();
      };
      if (untilFound) body.addEventListener("beforematch", () => {
        setFold(b, body, false);
        refreshFolds();
      });
    });
    const refreshLegacy = () => {
      if (!legacyAnswers(state)) KCP.$("#room-legacy", root)?.remove();
    };
    KCP.$$("textarea[data-a]", root).forEach((t) =>
      t.addEventListener("input", () => {
        state.answers[t.dataset.a] = t.value;
        state.answerQ[t.dataset.a] = qs[Number(t.dataset.a)].q;
        KCP.$(`[data-stale="${t.dataset.a}"]`, root)?.remove();
        refreshLegacy();
        save();
      })
    );
    KCP.$$("[data-stale-keep]", root).forEach((b) => {
      b.onclick = () => {
        const i = b.dataset.staleKeep;
        state.answerQ[i] = qs[Number(i)].q;
        save();
        KCP.$(`[data-stale="${i}"]`, root).remove();
        refreshLegacy();
        KCP.$(`textarea[data-a="${i}"]`, root)?.focus();
      };
    });
    KCP.$$("[data-stale-clear]", root).forEach((b) => {
      b.onclick = () => {
        const i = b.dataset.staleClear;
        delete state.answers[i];
        delete state.answerQ[i];
        KCP.$(`textarea[data-a="${i}"]`, root).value = "";
        save();
        KCP.$(`[data-stale="${i}"]`, root).remove();
        refreshLegacy();
        KCP.$(`textarea[data-a="${i}"]`, root)?.focus();
      };
    });
    if (orphans.length) KCP.$("#orphan-clear", root).onclick = () => {
      orphans.forEach((key) => { delete state.answers[key]; delete state.answerQ[key]; });
      save();
      KCP.$("#room-orphans", root).remove();
      refreshLegacy();
      const notes = KCP.$$(".qdeck textarea[data-a]", root);
      if (notes.length) notes[notes.length - 1].focus();
    };
    KCP.$("#toReflect", root).onclick = next;
    // 계획을 확정해야 질문이 생기는 게임은 확정 전에 질문이 0개다. 빈 카드 묶음 대신 돌아갈 길을 보여 준다.
    if (!qs.length) KCP.$("#room-to-prep", root).onclick = () => KCP.goPhase("prep");
    KCP.$$(".qdeck .qcard", root).forEach((card, i) => {
      const q = qs[i], slot = KCP.$(`.qx[data-qx="${i}"]`, card);
      KCP.emit("room:card", { card, slot, q, i, key: KCP.qkey(q), year, meta, state, save });
    });
    KCP.$$(".qfold-toggle", root).forEach((b) => {
      const body = KCP.$(".qfold-body", b.parentElement);
      if (body.hidden && (KCP.$('[aria-expanded="true"]', body) ||
        KCP.$$("textarea, input", body).some((t) => t.value.trim() !== ""))) {
        setFold(b, body, false);
      }
    });
    refreshFolds();
    KCP.emit("room:render", { root, main: KCP.$("#room-main", root), alt: KCP.$("#room-alt", root),
      tools: KCP.$("#room-tools", root), side: KCP.$("#room-side", root), qs, year, meta, state, save });
  }

  /* ---------- 성찰 ---------- */
  function renderReflect(root, state, save, year) {
    const meta = KCP.YEARS[year];
    const game = KCP.games[year];
    const levels = ["미흡", "보통", "잘함"];
    const rubricKeys = [];
    const compare = state.compare;
    const placeholders = {
      "2022": "예: 주민 건강을 발전 비용보다 앞에 두었다",
      "2023": "예: 환경 지수를 과학 지수보다 앞에 두었다",
      "2024": "예: 정착민의 건강을 에너지 여유보다 앞에 두었다",
      "2025": "예: 창간호를 처음에 둔 근거",
      "2026": "예: 안전성을 기능/효과보다 무겁게 보았다",
    };
    let rows = "";
    Object.entries(meta.rubric).forEach(([dom, items]) => {
      items.forEach((it, i) => {
        const key = dom + i;
        rubricKeys.push(key);
        const v = state.rubric[key];
        rows += `<tr>
          ${i === 0 ? `<td class="dom" rowspan="${items.length}">${esc(dom)}</td>` : ""}
          <td>${esc(it)}</td>
          <td><span class="seg" role="group" aria-label="${esc(it)}">${levels
            .map((l, j) => `<button data-k="${esc(key)}" data-v="${j + 1}" aria-pressed="${v === j + 1}">${l}</button>`)
            .join("")}</span></td>
        </tr>`;
      });
    });
    root.innerHTML = `
      <div class="desk">
        <div class="stack">
          <section class="panel">
            <h3 class="h-wrap">자기 평가 ${meta.original ? '<span class="tag-mine">연습용 평가 기준</span>' : '<span class="tag-official">기준 문구: 보고서</span>'} <span class="tag-mine">연습용 척도</span></h3>
            <p class="small num" id="rsum"></p>
            <div class="table-wrap"><table class="rubric">
              <thead><tr><th>평가 요소</th><th>평가 기준</th><th>나의 수준</th></tr></thead>
              <tbody>${rows}</tbody>
            </table></div>
            <p class="small muted rubric-note">이 연습실은 대학의 채점 단계나 배점을 옮기지 않았습니다. 세 단계는 스스로 돌아보기 위한 구분입니다.</p>
          </section>
          <section class="panel">
            <h3>다음 연습에서 바꿀 한 가지</h3>
            <textarea class="note" id="nextstep-${year}" aria-label="다음 연습 목표" placeholder="예: 결론을 먼저 말하고, 자료의 수치를 하나 이상 인용한다">${esc(state.nextstep || "")}</textarea>
          </section>
          <div id="reflect-left" class="stack ext-slot"></div>
        </div>
        <div class="stack">
          <section class="panel">
            <h3 class="h-wrap">${meta.original ? '설계 의도 <span class="tag-mine">연습실 설계</span>' : '출제 의도 <span class="tag-official">보고서 원문 요약</span>'}</h3>
            <ul class="intent small" style="margin:0;padding-left:1.1em">${meta.intent.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
          </section>
          <section class="panel compare-panel">
            <h3>비교해 보기</h3>
            <p class="small muted">${meta.original ? "아래 예시 판단은 연습실이 만든 가능한 판단의 일부입니다." : "보고서는 이 면접 문항에 정답이나 모범 답안이 없다고 밝힙니다. 아래 예시 답안은 보고서가 소개한 가능한 답의 일부입니다."}</p>
            <div class="field">
              <label for="before-${year}">예시를 열기 전에 · 내 답에서 가장 무겁게 본 판단 기준 한 줄</label>
              <textarea class="note" id="before-${year}" placeholder="${esc(placeholders[year] || "예: 안전을 비용보다 무겁게 보았다")}">${esc(compare.before || "")}</textarea>
            </div>
            <div class="row" id="ex-open-row"${compare.open === true ? " hidden" : ""}>
              <button class="btn" id="openEx" type="button"${String(compare.before || "").trim().length < 10 ? " disabled" : ""}>${meta.original ? "예시 판단과 해설 열기" : "예시 답안과 해설 열기"}</button>
              <span class="hint">한 줄(10자 이상)을 쓰면 열립니다</span>
            </div>
            <p id="ex-skip-row"${compare.open === true ? " hidden" : ""}><button id="skipEx" class="ex-skip small" type="button">교사 시연용: 적지 않고 열기</button></p>
            <div id="exwrap"${compare.open === true ? "" : " hidden"}>${game.reflectExtra(state)}</div>
            <div id="exafter"${compare.open === true ? "" : " hidden"}>
              <div class="field">
                <label for="better-${year}">${meta.original ? "예시 판단이" : "예시 답안이"} 내 답보다 나은 점 하나</label>
                <textarea class="note" id="better-${year}">${esc(compare.better || "")}</textarea>
              </div>
              <div class="field">
                <label for="gap-${year}">${meta.original ? "예시 판단의" : "예시 답안의"} 빈틈이나 자료와 맞지 않는 곳 하나</label>
                <textarea class="note" id="gap-${year}">${esc(compare.gap || "")}</textarea>
              </div>
              ${year !== "2026" ? '<p class="small muted">예시 답안도 자료와 대조해 읽습니다.</p>' : ""}
            </div>
          </section>
          <section class="panel">
            <h3>내 답안 내보내기</h3>
            <p class="small muted">준비실 답과 면접실 메모, 자기 평가를 글로 묶어 복사합니다. 수업 과제 제출이나 교사 피드백에 쓰세요.</p>
            <div class="row" style="margin-top:8px">
              <button class="btn primary" id="copyAll">답안 복사</button>
              <button class="btn ghost" id="resetAll">${meta.original ? "이 게임 기록 지우기" : "이 해 기록 지우기"}</button>
            </div>
            <div id="confirmReset" hidden class="caution" style="margin-top:8px">${meta.original ? "이 게임에" : "이 학년도에"} 입력한 내용과, 여기서 정한 다음 연습 목표가 지워집니다.
              <div class="row" style="margin-top:6px"><button class="btn small" id="doReset">지우기</button><button class="btn small ghost" id="noReset">취소</button></div>
            </div>
            <textarea class="note copybox" id="copyFallback-${year}" hidden aria-label="복사용 텍스트"></textarea>
          </section>
          <div id="reflect-right" class="stack ext-slot"></div>
        </div>
      </div>`;
    const paintSum = () => {
      const vals = rubricKeys.map((key) => state.rubric[key]).filter((v) => [1, 2, 3].includes(v));
      KCP.$("#rsum", root).textContent = `점검 ${vals.length}/${rubricKeys.length} · 잘함 ${vals.filter((v) => v === 3).length} · 보통 ${vals.filter((v) => v === 2).length} · 미흡 ${vals.filter((v) => v === 1).length}`;
    };
    paintSum();
    KCP.$$(".seg button[data-k][data-v]", root).forEach((b) =>
      b.addEventListener("click", () => {
        state.rubric[b.dataset.k] = Number(b.dataset.v);
        KCP.$$(`.seg button[data-k="${CSS.escape(b.dataset.k)}"]`, root).forEach((x) =>
          x.setAttribute("aria-pressed", String(x === b))
        );
        paintSum();
        save();
      })
    );
    ["before", "better", "gap"].forEach((key) => {
      KCP.$(`#${key}-${year}`, root).addEventListener("input", (e) => {
        compare[key] = e.target.value;
        if (key === "before") KCP.$("#openEx", root).disabled = compare.before.trim().length < 10;
        save();
      });
    });
    const openExamples = () => {
      compare.open = true;
      save();
      KCP.$("#exwrap", root).hidden = false;
      KCP.$("#exafter", root).hidden = false;
      KCP.$("#ex-open-row", root).hidden = true;
      KCP.$("#ex-skip-row", root).hidden = true;
      KCP.$("#exwrap summary", root)?.focus();
    };
    KCP.$("#openEx", root).onclick = openExamples;
    KCP.$("#skipEx", root).onclick = openExamples;
    KCP.$(`#nextstep-${year}`, root).addEventListener("input", (e) => {
      state.nextstep = e.target.value;
      save();
      if (state.nextstep.trim()) KCP.goal.set(year, KCP.gameShort(year), state.nextstep);
      else if (KCP.goal.get()?.src === String(year)) KCP.store.remove("goal");
    });
    if (game.afterReflect) game.afterReflect(root, state, save);
    KCP.emit("reflect:render", { root, left: KCP.$("#reflect-left", root), right: KCP.$("#reflect-right", root),
      qs: game.questions(state), year, meta, state, save });
    KCP.$("#copyAll", root).onclick = () => {
      const qs = game.questions(state);
      let out = meta.original ? `[${meta.title} · 창작 쟁점 게임 연습]\n\n` : `[${year}학년도 KENTECH 창의성 면접 연습 · ${meta.title}]\n\n`;
      out += "■ 준비실 답안\n";
      game.recap(state).forEach((r) => (out += `- ${r.t}: ${r.text != null ? r.text : r.d || "(비어 있음)"}\n`));
      out += "\n■ 면접실 답변 메모\n";
      qs.forEach((q, i) => {
        out += `Q${i + 1}. [${q.src === "report" ? "보고서 문항" + (q.frame ? " · 내 계획으로 채움" : "") : "연습용 질문"}] ${q.q}\n`;
        out += `→ ${staleAnswer(state, q, i) ? `(메모를 쓸 때의 질문: ${state.answerQ[i]}) ` : ""}${state.answers[i] || "(미작성)"}\n`;
      });
      orphanKeys(state, qs).forEach((key) => {
        out += `- 질문 목록에서 빠진 메모: ${state.answerQ[key] ? `(메모를 쓸 때의 질문: ${state.answerQ[key]}) ` : ""}${state.answers[key]}\n`;
      });
      out += "\n■ 자기 평가\n";
      Object.entries(meta.rubric).forEach(([dom, items]) =>
        items.forEach((it, i) => {
          const v = state.rubric[dom + i];
          out += `- [${dom}] ${it}: ${v ? levels[v - 1] : "-"}\n`;
        })
      );
      const comparison = [["내 기준", compare.before], ["예시가 나은 점", compare.better], ["예시의 빈틈", compare.gap]]
        .filter(([, value]) => String(value || "").trim())
        .map(([label, value]) => `${label}: ${value}`);
      if (comparison.length) out += "\n■ 예시와 비교\n" + comparison.join("\n") + "\n";
      const parts = [];
      KCP.emit("export:text", { year, meta, state, qs, parts });
      out += parts.join("");
      if (state.nextstep) out += `\n■ 다음 연습 목표\n${state.nextstep}\n`;
      if (state.memo) out += `\n■ 메모\n${state.memo}\n`;
      KCP.copy(out, KCP.$(`#copyFallback-${year}`, root));
    };
    KCP.$("#resetAll", root).onclick = () => (KCP.$("#confirmReset", root).hidden = false);
    KCP.$("#noReset", root).onclick = () => (KCP.$("#confirmReset", root).hidden = true);
    KCP.$("#doReset", root).onclick = () => {
      Timer.stop();
      KCP.speakStop();
      KCP.reset(year);
      location.hash = "#home";
    };
  }

  /* ---------- 공통 조각: 메모장 ---------- */
  KCP.memoPanel = function (state, save, id) {
    setTimeout(() => {
      const t = document.getElementById(id);
      if (t) t.addEventListener("input", () => { state.memo = t.value; save(); });
    });
    return `<section class="panel"><h3>메모장</h3>
      <textarea class="note" id="${id}" style="min-height:110px" aria-label="메모장" placeholder="문제 풀이 중 떠오른 생각을 적어 두세요. 면접 때 설명 자료로 활용할 수 있습니다.">${esc(state.memo || "")}</textarea></section>`;
  };

  /* ---------- 라우터 ---------- */
  let currentGo = null;
  KCP.goPhase = function (p) {
    if (!currentGo || !["prep", "room", "reflect"].includes(p)) return false;
    currentGo(p);
    return true;
  };
  KCP.routes = {};
  KCP.route = function (name, fn) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || name === "home" || /^y[0-9]{4}$/.test(name)) return false;
    KCP.routes[name] = fn;
    return true;
  };
  KCP.rerender = () => route();
  function route() {
    const app = document.getElementById("app");
    const h = (location.hash || "").replace(/^#/, ""), slash = h.indexOf("/");
    const name = slash === -1 ? h : h.slice(0, slash);
    let arg = slash === -1 ? "" : h.slice(slash + 1);
    try { arg = decodeURIComponent(arg); } catch (e) {}
    KCP.flush();
    Timer.stop();
    KCP.speakStop();
    KCP.emit("route:change", { name, arg });
    KCP.flush();
    currentGo = null;
    const m = name.match(/^y([a-z0-9-]+)$/);
    if (m && Object.hasOwn(KCP.games, m[1]) && Object.hasOwn(KCP.YEARS, m[1])) renderGame(app, m[1]);
    else if (Object.hasOwn(KCP.routes, name)) {
      app.innerHTML = "";
      document.title = "켄텍 창의성 면접 연습실";
      KCP.routes[name](app, arg);
      window.scrollTo(0, 0);
      if (!document.activeElement || document.activeElement === document.body) {
        const heading = KCP.$("h1", app);
        if (heading) {
          heading.setAttribute("tabindex", "-1");
          heading.focus({ preventScroll: true });
        }
      }
    }
    else renderHome(app);
  }
  KCP.boot = function () {
    window.addEventListener("hashchange", route);
    route();
  };
})();
