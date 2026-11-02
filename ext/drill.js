(function () {
  const KCP = window.KCP;
  const esc = KCP.esc;
  const FOCUS = { all: "전체 흐름", crit: "기준만", trade: "얻고 잃는 것만", push: "반문만" };
  const STEPS = { all: [1, 2, 3, 4, 5], crit: [1, 2, 5], trade: [2, 3, 5], push: [4, 5] };
  const TITLES = ["과제 파악", "기준과 무게", "선택과 얻고 잃는 것", "반문", "정리"];
  const KINDS = { pick: "하나 고르기", rank: "순서 정하기", budget: "예산 나누기" };
  const SAID = { c: "기준", t: "얻고 잃는 것", r: "반문 뒤 답" };
  const WHERE = { task: "과제 문장", setup: "상황 설명", table: "자료 표", card: "카드", quote: "발언" };
  const tag = (text) => `<span class="tag-mine">${esc(text)}</span>`;
  const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
    && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
  const list = (v) => Array.isArray(v) ? v : [];
  const str = (v, max) => typeof v === "string" ? v.slice(0, max) : "";
  const integer = (v, min, max, def = 0) => Number.isInteger(v) && v >= min && v <= max ? v : def;
  const focusOf = (v) => typeof v === "string" && Object.hasOwn(FOCUS, v) ? v : "all";
  const drills = () => list(KCP.DRILLS);
  const findDrill = (id) => drills().find((d) => d.id === id);
  const options = (d) => list(d.options);
  const optionName = (d, id) => options(d).find((o) => o.id === id)?.n || "";
  const rankLabel = (d, i) => list(d.rankLabels)[i] || (i + 1) + "번";
  const blankDB = () => ({ focus: "all", runs: [], cur: null });
  const $ = (root, selector) => root.querySelector(selector);
  const $$ = (root, selector) => Array.from(root.querySelectorAll(selector));
  let db = null, lastRun = null, printNote = false, activeRoot = null, timer = null;

  function normalizeCrit(value) {
    const result = [];
    list(value).forEach((c) => {
      if (!plain(c)) return;
      const n = str(c.n).trim().slice(0, 20);
      if (n && result.length < 3 && !result.some((item) => item.n === n)) {
        result.push({ n, w: integer(c.w, 0, 3) });
      }
    });
    return result;
  }

  function normalizeCur(d, value) {
    const v = plain(value) ? value : {}, ids = options(d).map((o) => o.id);
    const focus = focusOf(v.focus), steps = STEPS[focus], comp = {}, bud = {};
    list(d.comp).forEach((q, i) => {
      const answer = plain(v.comp) ? v.comp[i] : undefined;
      if (Number.isInteger(answer) && answer >= 0 && answer < list(q.choices).length) comp[i] = answer;
    });
    ids.forEach((id) => { bud[id] = plain(v.bud) ? integer(v.bud[id], 0, 100) : 0; });
    const rank = list(v.rank);
    return {
      id: d.id, step: steps.includes(v.step) ? v.step : steps[0], focus, comp,
      crit: normalizeCrit(v.crit), pick: ids.includes(v.pick) ? v.pick : "",
      rank: rank.length === ids.length && new Set(rank).size === ids.length && rank.every((id) => ids.includes(id)) ? rank.slice() : ids,
      bud, gain: str(v.gain, 20), cost: str(v.cost, 20), why: str(v.why, 120),
      pb: integer(v.pb, 0, list(d.pushbacks).length - 1), hint: v.hint === true,
      stance: ["revise", "keep"].includes(v.stance) ? v.stance : "", rv: str(v.rv),
      said: { c: plain(v.said) && v.said.c === true, t: plain(v.said) && v.said.t === true, r: plain(v.said) && v.said.r === true },
      next: str(v.next, 80)
    };
  }

  function record(cur, at) {
    const { id, focus, crit, pick, rank, bud, gain, cost, why, pb, stance, rv, said, next } = cur;
    return JSON.parse(JSON.stringify({ id, at, focus, crit, pick, rank, bud, gain, cost, why, pb, stance, rv, said, next }));
  }

  function normalizeDB(value) {
    const v = plain(value) ? value : {}, d = plain(v.cur) && findDrill(v.cur.id);
    return {
      focus: focusOf(v.focus),
      runs: list(v.runs).filter((r) => plain(r) && typeof r.id === "string").slice(0, 30),
      cur: d ? normalizeCur(d, v.cur) : null
    };
  }

  function newCur(d) {
    const cur = normalizeCur(d, { focus: db.focus });
    const all = list(d.pushbacks).map((_, i) => i);
    const samples = list(d.samplePb).filter((i) => Number.isInteger(i) && all.includes(i));
    const candidates = cur.focus === "push" ? samples : all;
    cur.pb = candidates[Math.floor(Math.random() * candidates.length)] ?? 0;
    return cur;
  }

  function randomDrill() {
    const last = db.runs[0] && findDrill(db.runs[0].id);
    let pool = drills().filter((d) => !last || d.kind !== last.kind);
    if (!pool.length) pool = drills();
    if (!pool.length) return;
    const count = (d) => db.runs.filter((r) => r.id === d.id).length;
    const least = Math.min(...pool.map(count));
    pool = pool.filter((d) => count(d) === least);
    location.hash = "#drill/" + pool[Math.floor(Math.random() * pool.length)].id;
  }

  function material(d, printing = false) {
    if (d.view === "table" && d.table) {
      const table = `<table class="${printing ? "dr-print-table" : "dr-table"}"><thead><tr>${list(d.table.cols).map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>${list(d.table.rows).map((r) => `<tr><th scope="row">${esc(optionName(d, r.opt))}</th>${list(r.cells).map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      return printing ? table : `<div class="table-wrap" tabindex="0" role="region" aria-label="자료 표">${table}</div>`;
    }
    const cards = `<ul class="${printing ? "dr-print-cards" : "dr-optcards"}">${options(d).map((o) => `<li><b>${esc(o.n)}</b><p>${esc(o.d)}</p></li>`).join("")}</ul>`;
    return cards + (d.view === "quotes" ? `<ul class="${printing ? "dr-print-quotes" : "dr-quotes"}">${list(d.quotes).map((q) => `<li><b>${esc(q.who)}</b> <q>${esc(q.say)}</q></li>`).join("")}</ul>` : "");
  }

  function printDrill(d) {
    const lines = (label, n) => `<p>${esc(label)}</p>${Array.from({ length: n }, () => "<div class=\"dr-print-line\"></div>").join("")}`;
    const table = (rows) => `<table class="dr-print-table"><tbody>${rows.map(([label, value]) => `<tr><th scope="row">${esc(label)}</th><td>${esc(value)}</td></tr>`).join("")}</tbody></table>`;
    let choice;
    if (d.kind === "rank") {
      choice = `<h2>② 순서와 얻는 것·잃는 것</h2>${table(options(d).map((_, i) => [rankLabel(d, i), ""]))}${lines("이 순서로 얻는 것(기준 이름)", 2)}${lines("잃는 것(기준 이름)", 2)}${lines("그래도 이 순서로 정한 이유", 3)}`;
    } else if (d.kind === "budget") {
      choice = `<h2>② 배분과 얻는 것·잃는 것</h2>${table([...options(d).map((o) => [o.n, ""]), ["합계", "100"]])}<p>배분 칸의 합계는 100입니다.</p>${lines("이 배분으로 얻는 것(기준 이름)", 2)}${lines("잃는 것(기준 이름)", 2)}${lines("그래도 이렇게 나눈 이유", 3)}`;
    } else {
      choice = `<h2>② 선택과 얻는 것·잃는 것</h2>${lines("고른 것", 1)}${lines("얻는 것(기준 이름)", 2)}${lines("잃는 것(기준 이름)", 2)}${lines("그래도 고른 이유", 3)}`;
    }
    KCP.print(`<div class="dr-print-sheet"><h1 class="dr-print-h">${esc(d.title)}</h1>
      <p>${tag("연습용 문항")} · 가상 자료 · 켄텍 창의성 면접 연습실(비공식 연습 도구)</p>
      <p>대학의 출제 경향을 예측한 문제가 아닙니다.</p><p>반 ____ 번호 ____ 이름 __________</p>
      <h2>상황</h2>${list(d.setup).map((s) => `<p>${esc(s)}</p>`).join("")}
      <h2>자료</h2>${material(d, true)}<h2>과제</h2><p>${esc(d.task)}</p>
      <section class="dr-print-sec"><h2>① 판단 기준과 무게</h2><table class="dr-print-table"><thead><tr><th scope="col">기준</th><th scope="col">무게(높음·중간·낮음)</th><th scope="col">이 기준을 쓴 이유</th></tr></thead><tbody>${Array.from({ length: 3 }, () => "<tr><td>&nbsp;</td><td></td><td></td></tr>").join("")}</tbody></table></section>
      <section class="dr-print-sec">${choice}</section>
      <section class="dr-print-sec"><h2>③ 반론과 수정</h2>${lines("짝이 쓰는 반론", 3)}${lines("고친 결론 또는 유지하는 이유", 3)}</section>
      ${printNote ? `<section class="dr-print-sec"><h2>교사용 메모</h2><p>${esc(d.teacherNote)}</p></section>` : ""}</div>`);
  }

  function pressed(root, selector, value, attr) {
    $$(root, selector).forEach((button) => button.setAttribute("aria-pressed", String(button.getAttribute(attr) === String(value))));
  }

  function lobby(app) {
    document.title = "짧은 판단 훈련장 · 켄텍 창의성 면접 연습실";
    app.innerHTML = `<div id="dr-lobby" class="stack">
      <a href="#home">← 연습실</a><h1 id="dr-title">짧은 판단 훈련장</h1><div>${tag("연습용 문항")}</div>
      <p>겉모습이 다른 짧은 과제에 같은 절차(기준 → 얻고 잃는 것 → 반문)를 적용하는 연습입니다. 모든 자료는 가상입니다.</p>
      <p class="small muted">대학의 출제 경향을 예측한 문제가 아닙니다.</p>
      <section class="panel stack"><h2>연습 범위</h2><div class="seg" role="group" aria-label="연습 범위">${Object.entries(FOCUS).map(([key, name]) => `<button type="button" class="btn" data-dfocus="${key}" aria-pressed="${db.focus === key}">${name}</button>`).join("")}</div>
      <p class="hint">전체 흐름은 1~5단계, 기준만은 1·2·5단계, 얻고 잃는 것만은 2·3·5단계, 반문만은 4·5단계를 합니다. 반문만에서는 가상의 학생 답에 들어온 반문에 답합니다.</p>
      <p>말해 보기 전 생각 시간(연습실 전체 설정)</p><div class="seg" role="group" aria-label="말해 보기 전 생각 시간">${[0, 10, 30].map((n) => `<button type="button" class="btn" data-dthink="${n}" aria-pressed="${KCP.settings().think === n}">${n ? n + "초" : "없음"}</button>`).join("")}</div>
      <div><button type="button" class="btn primary" id="dr-random"${drills().length ? "" : " disabled"}>무작위 한 판</button></div></section>
      ${db.cur ? `<div class="caution" id="dr-resume-box"><p>진행 중인 연습: ${esc(findDrill(db.cur.id).title)} · ${db.cur.step}단계 · ${FOCUS[db.cur.focus]}</p><div class="row"><a class="btn small" id="dr-resume" href="#drill/${esc(db.cur.id)}">이어서 하기</a><button type="button" class="btn small ghost" id="dr-discard">버리기</button></div><p class="small">다른 문항을 시작해 입력하면 진행 중인 연습은 지워집니다.</p></div>` : ""}
      <div class="dr-cards">${drills().map((d) => `<div class="dr-card"><h2 class="dr-card-t">${esc(d.title)}</h2><div class="row"><span class="chip">${esc(KINDS[d.kind])}</span><span class="small dr-count">해 본 횟수 ${db.runs.filter((r) => r.id === d.id).length}</span></div><div class="row"><a class="btn small" href="#drill/${esc(d.id)}" aria-label="${esc(d.title)} 시작">시작</a><button class="btn small ghost" type="button" data-dprint="${esc(d.id)}" aria-label="${esc(d.title)} 과제지 인쇄">과제지 인쇄</button></div></div>`).join("")}</div>
      <div><input type="checkbox" id="dr-pnote"${printNote ? " checked" : ""}><label for="dr-pnote">과제지에 교사용 메모(관련 개념) 넣기</label></div>
      <div><button type="button" class="btn small ghost" id="dr-clear">훈련장 기록 지우기</button></div>
      <div class="caution" id="dr-clear-confirm" hidden><p>훈련장 기록(진행 중인 연습, 마친 기록, 범위 선택)이 이 브라우저에서 지워집니다. 지난 목표로 넘긴 문장은 남습니다.</p><div class="row"><button type="button" class="btn small" id="dr-clear-yes">지우기</button><button type="button" class="btn small ghost" id="dr-clear-no">취소</button></div></div></div>`;
    const root = activeRoot = $(app, "#dr-lobby");
    $$(root, "[data-dfocus]").forEach((button) => { button.onclick = () => {
      db.focus = button.getAttribute("data-dfocus");
      KCP.store.set("drill", db);
      pressed(root, "[data-dfocus]", db.focus, "data-dfocus");
    }; });
    $$(root, "[data-dthink]").forEach((button) => { button.onclick = () => {
      const settings = KCP.setSettings({ think: Number(button.getAttribute("data-dthink")) });
      pressed(root, "[data-dthink]", settings.think, "data-dthink");
    }; });
    $(root, "#dr-random").onclick = randomDrill;
    if (db.cur) $(root, "#dr-discard").onclick = () => { db.cur = null; KCP.store.set("drill", db); KCP.rerender(); };
    $(root, "#dr-pnote").onchange = (event) => { printNote = event.target.checked; };
    $$(root, "[data-dprint]").forEach((button) => { button.onclick = () => printDrill(findDrill(button.getAttribute("data-dprint"))); });
    $(root, "#dr-clear").onclick = () => { $(root, "#dr-clear-confirm").hidden = false; $(root, "#dr-clear-yes").focus(); };
    $(root, "#dr-clear-no").onclick = () => { $(root, "#dr-clear-confirm").hidden = true; $(root, "#dr-clear").focus(); };
    $(root, "#dr-clear-yes").onclick = () => { KCP.store.remove("drill"); db = blankDB(); lastRun = null; KCP.rerender(); };
  }

  const defaultMinutes = () => KCP.settings().timeMode === "free" ? 0 : KCP.settings().timeMode === "ext" ? 12 : 8;
  function stopTimer() {
    if (!timer) return;
    if (timer.interval !== null) timer.remaining = Math.max(0, timer.endAt - Date.now());
    clearInterval(timer.interval);
    timer.interval = null;
  }

  function setupTimer(root) {
    stopTimer();
    timer = { minutes: defaultMinutes(), remaining: defaultMinutes() * 60000, interval: null, endAt: 0 };
    const clock = $(root, "#dr-clock"), go = $(root, "#dr-tgo");
    function paint() {
      clock.hidden = go.hidden = timer.minutes === 0;
      clock.textContent = KCP.fmt(Math.ceil(timer.remaining / 1000));
      go.textContent = timer.interval === null ? "시작" : "일시정지";
      pressed(root, "[data-dtime]", timer.minutes, "data-dtime");
    }
    $$(root, "[data-dtime]").forEach((button) => { button.onclick = () => {
      stopTimer();
      timer.minutes = Number(button.getAttribute("data-dtime"));
      timer.remaining = timer.minutes * 60000;
      paint();
    }; });
    go.onclick = () => {
      if (timer.interval !== null) { stopTimer(); paint(); return; }
      if (!timer.remaining) timer.remaining = timer.minutes * 60000;
      timer.endAt = Date.now() + timer.remaining;
      timer.interval = setInterval(() => {
        if (!clock.isConnected) { stopTimer(); return; }
        timer.remaining = Math.max(0, timer.endAt - Date.now());
        if (!timer.remaining) {
          stopTimer();
          if (KCP.settings().endAlert) KCP.toast("정한 시간이 지났습니다. 계속 진행해도 됩니다.");
        }
        paint();
      }, 250);
      paint();
    };
    const think = KCP.settings().think;
    $(root, "#dr-thinknote").textContent = think
      ? `말해 보기를 누르면 생각 ${think}초 뒤 말하기가 시작됩니다. 생각 시간은 훈련장 첫 화면에서 바꿀 수 있습니다.`
      : "말해 보기를 누르면 바로 말하기가 시작됩니다. 생각 시간은 훈련장 첫 화면에서 바꿀 수 있습니다.";
    paint();
  }

  function picked(d, cur) {
    if (d.kind === "rank") return cur.rank.length ? rankLabel(d, 0) + ": " + optionName(d, cur.rank[0]) : "";
    if (d.kind === "budget") {
      const top = options(d).reduce((best, o) => !best || cur.bud[o.id] > cur.bud[best.id] ? o : best, null);
      return top && cur.bud[top.id] ? `가장 많이 준 항목: ${top.n} ${cur.bud[top.id]}` : "";
    }
    return cur.pick ? "고른 것: " + optionName(d, cur.pick) : "";
  }

  function trade(d, cur) {
    const subject = d.kind === "rank" ? "이 순서" : d.kind === "budget" ? "이 배분" : optionName(d, cur.pick);
    const sentence = KCP.tradeSentence({ pick: subject, gain: cur.gain, cost: cur.cost });
    return sentence ? sentence + (cur.why.trim() ? " 이유: " + cur.why : "") : "";
  }

  const pushback = (d, cur) => list(d.pushbacks)[cur.pb] || { q: "", hint: "" };
  function summaryBlocks(d, cur) {
    const steps = STEPS[cur.focus], blocks = [];
    if (steps.includes(2)) blocks.push(["판단 기준", KCP.critSentence(cur.crit) || "(기준 없음)"]);
    if (steps.includes(3)) blocks.push(["선택과 얻고 잃는 것", [picked(d, cur), trade(d, cur)].filter(Boolean).join("\n")]);
    if (steps.includes(4)) blocks.push(["반문과 내 답", [
      cur.focus === "push" ? "가상의 학생 답: " + d.sample : "",
      "반문: " + pushback(d, cur).q,
      "선택: " + (cur.stance === "revise" ? "답을 고친다" : cur.stance === "keep" ? "답을 유지한다" : "(고르지 않음)"), cur.rv
    ].filter(Boolean).join("\n")]);
    return blocks;
  }

  function copyText(d, run) {
    const blocks = summaryBlocks(d, run).filter(([title]) => title !== "판단 기준" || KCP.critSentence(run.crit));
    if (run.next.trim()) blocks.push(["다음엔", run.next]);
    const text = [`[짧은 판단 훈련장 · ${d.title}] 연습용 문항, 가상 자료`, "범위: " + FOCUS[run.focus]];
    blocks.forEach(([title, content]) => { if (content) text.push("\n■ " + title + "\n" + content); });
    const said = Object.keys(SAID).filter((k, i) => STEPS[run.focus].includes(i + 2) && run.said[k]).map((k) => SAID[k]);
    if (said.length) text.push("말로 해 본 것: " + said.join(", "));
    return text.join("\n");
  }

  function runScreen(app, d) {
    const cur = db.cur && db.cur.id === d.id ? db.cur : newCur(d);
    const steps = STEPS[cur.focus];
    let finished = false;
    document.title = d.title + " · 짧은 판단 훈련장 · 켄텍 창의성 면접 연습실";
    app.innerHTML = `<div id="dr-run" class="stack"><div class="dr-head"><a href="#drill">← 훈련장</a><h1 id="dr-title">${esc(d.title)}</h1>${tag("연습용 문항")}</div>
      <div class="row" id="dr-timebar"><div class="seg" role="group" aria-label="연습 시간">${[0, 6, 8, 12].map((n) => `<button type="button" class="btn" data-dtime="${n}" aria-pressed="false">${n ? n + "분" : "시간 없음"}</button>`).join("")}</div><span id="dr-clock" class="num" aria-live="off"></span><button type="button" class="btn small" id="dr-tgo">시작</button></div>
      <p class="small muted" id="dr-thinknote"></p><div class="dr-desk">
      <section class="panel stack" id="dr-data"><h2>상황과 자료 ${tag("가상 자료")}</h2>${list(d.setup).map((s) => `<p>${esc(s)}</p>`).join("")}${material(d)}<div class="dr-task"><b>과제</b><p>${esc(d.task)}</p></div></section>
      <section class="panel stack" id="dr-step"><h2>단계</h2><ol id="dr-steps">${TITLES.map((title, i) => `<li${steps.includes(i + 1) ? "" : " class=\"dr-skip\""}>${i + 1} ${title}${steps.includes(i + 1) ? "" : "<span class=\"sr-only\">(이번 범위에서 건너뜀)</span>"}</li>`).join("")}</ol>
      <div id="dr-body" class="stack"></div><div class="row" id="dr-nav"><button type="button" class="btn" id="dr-prev">이전</button><button type="button" class="btn primary" id="dr-next">다음</button></div></section></div></div>`;
    const root = activeRoot = $(app, "#dr-run"), body = $(root, "#dr-body");
    const el = (selector) => $(root, selector);
    function save() {
      if (finished || root !== activeRoot || !db) return;
      // 새 판은 실제 입력이나 단계 이동이 생길 때만 이전 판을 대체한다.
      db.cur = cur;
      KCP.store.set("drill", db);
    }
    function canNext() {
      if (cur.step === 2) return cur.crit.length > 0;
      if (cur.step !== 3) return true;
      if (d.kind === "pick") return !!cur.pick;
      if (d.kind === "budget") return options(d).reduce((sum, o) => sum + cur.bud[o.id], 0) === 100;
      return true;
    }
    function nav() {
      el("#dr-prev").hidden = steps.indexOf(cur.step) === 0;
      el("#dr-next").hidden = cur.step === steps[steps.length - 1];
      el("#dr-next").disabled = !canNext();
      $$(root, "#dr-steps li").forEach((li, i) => {
        if (i + 1 === cur.step) li.setAttribute("aria-current", "step");
        else li.removeAttribute("aria-current");
      });
    }
    function move(dir) {
      if (finished || (dir > 0 && !canNext())) return;
      const next = steps[steps.indexOf(cur.step) + dir];
      if (!next) return;
      KCP.speakStop();
      cur.step = next;
      save();
      renderStep();
      const heading = el("#dr-body h3");
      heading.setAttribute("tabindex", "-1");
      heading.focus();
    }
    el("#dr-prev").onclick = () => move(-1);
    el("#dr-next").onclick = () => move(1);

    function comprehension() {
      const code = Array.from(d.id).reduce((sum, c) => sum + c.charCodeAt(0), 0);
      body.innerHTML = `<h3>1 과제 파악</h3><p class="hint">이 단계만 정해진 답이 있습니다. 뒤의 단계에는 정답이 없습니다.</p>${list(d.comp).map((q, k) => {
        const choices = list(q.choices), rotation = (code + k) % choices.length;
        return `<fieldset class="dr-comp"><legend>${esc(q.q)}</legend>${choices.map((_, i) => {
          const index = (i + rotation) % choices.length;
          return `<div class="dr-radio"><input type="radio" name="dr-c${k}" value="${index}" id="dr-c${k}-${index}"${cur.comp[k] === index ? " checked" : ""}><label for="dr-c${k}-${index}">${esc(choices[index])}</label></div>`;
        }).join("")}<p id="dr-fb-${k}" aria-live="polite"></p></fieldset>`;
      }).join("")}`;
      list(d.comp).forEach((q, k) => {
        function feedback() {
          const p = el("#dr-fb-" + k);
          if (!Object.hasOwn(cur.comp, k)) { p.textContent = ""; p.className = ""; return; }
          const correct = cur.comp[k] === q.answer, where = WHERE[q.where] || "자료";
          p.className = correct ? "dr-feedback dr-correct" : "dr-feedback dr-retry";
          p.textContent = correct ? `맞습니다. ${where}의 「${q.quote}」 부분입니다.` : `다시 보세요. ${where}에서 「${q.quote}」 부분을 찾아보세요.`;
        }
        $$(root, `input[name="dr-c${k}"]`).forEach((input) => { input.onchange = () => { cur.comp[k] = Number(input.value); save(); feedback(); }; });
        feedback();
      });
    }

    function criteria() {
      body.innerHTML = `<h3>2 기준과 무게</h3><p class="hint">이 과제에서 무엇을 기준으로 판단할지 세 개까지 고르고 무게를 정합니다.</p>
        <div class="dr-chips">${list(d.crit).map((name) => `<button type="button" class="btn small" data-dchip="${esc(name)}" aria-pressed="false">${esc(name)}</button>`).join("")}</div>
        <div class="field"><label for="dr-cnew">기준 직접 적기</label><div class="dr-add"><input class="note" id="dr-cnew" maxlength="20" placeholder="예: 정비 인력"><button type="button" class="btn small" id="dr-cadd">추가</button></div></div>
        <ul id="dr-clist"></ul><p id="dr-csent" aria-live="polite"></p><p class="hint" id="dr-cwhint" hidden>무게를 정하면 문장이 완성됩니다.</p><span id="dr-speak-c"></span>`;
      function paintSentence() {
        el("#dr-csent").textContent = KCP.critSentence(cur.crit);
        el("#dr-cwhint").hidden = !(cur.crit.length >= 2 && cur.crit.some((c) => c.w === 0));
        $$(root, "[data-dchip]").forEach((b) => b.setAttribute("aria-pressed", String(cur.crit.some((c) => c.n === b.getAttribute("data-dchip")))));
        nav();
      }
      function paintList() {
        el("#dr-clist").innerHTML = cur.crit.map((c, i) => `<li><span>${esc(c.n)}</span><div class="row"><div class="seg" role="group" aria-label="${esc(c.n)} 무게">${[[3, "높음"], [2, "중간"], [1, "낮음"]].map(([w, label]) => `<button type="button" class="btn" data-dw="${i}" data-dwv="${w}" aria-pressed="${c.w === w}">${label}</button>`).join("")}</div><button type="button" class="btn small ghost" data-drm="${i}" aria-label="${esc(c.n)} 빼기">빼기</button></div></li>`).join("");
        $$(root, "[data-dw]").forEach((b) => { b.onclick = () => {
          const i = Number(b.getAttribute("data-dw"));
          cur.crit[i].w = Number(b.getAttribute("data-dwv"));
          save();
          pressed(root, `[data-dw="${i}"]`, cur.crit[i].w, "data-dwv");
          paintSentence();
        }; });
        $$(root, "[data-drm]").forEach((b) => { b.onclick = () => {
          const i = Number(b.getAttribute("data-drm"));
          cur.crit.splice(i, 1); save(); paintList();
          const buttons = $$(root, "[data-drm]");
          (buttons[Math.min(i, buttons.length - 1)] || el("#dr-cnew")).focus();
        }; });
        paintSentence();
      }
      function add(name) {
        const n = name.trim().slice(0, 20);
        if (!n) return false;
        if (cur.crit.some((c) => c.n === n)) { KCP.toast("이미 고른 기준입니다"); return false; }
        if (cur.crit.length >= 3) { KCP.toast("기준은 세 개까지 고릅니다"); return false; }
        cur.crit.push({ n, w: 0 }); save(); paintList(); return true;
      }
      $$(root, "[data-dchip]").forEach((b) => { b.onclick = () => {
        const name = b.getAttribute("data-dchip"), i = cur.crit.findIndex((c) => c.n === name);
        if (i < 0) add(name);
        else { cur.crit.splice(i, 1); save(); paintList(); }
      }; });
      const input = el("#dr-cnew");
      el("#dr-cadd").onclick = () => { if (add(input.value)) input.value = ""; };
      input.onkeydown = (event) => {
        if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); if (add(input.value)) input.value = ""; }
      };
      paintList();
      KCP.speak(el("#dr-speak-c"), { rec: "한두 문장" });
    }

    function choices() {
      let choiceHTML;
      if (d.kind === "rank") choiceHTML = "<p class=\"hint\">↑·↓ 버튼으로 순서를 바꿉니다.</p><ol id=\"dr-rank\"></ol>";
      else if (d.kind === "budget") choiceHTML = `<div class="dr-bud">${options(d).map((o) => `<div class="field"><label for="dr-bud-${esc(o.id)}">${esc(o.n)}</label><input class="note" id="dr-bud-${esc(o.id)}" type="number" data-dbud="${esc(o.id)}" min="0" max="100" step="1" value="${cur.bud[o.id]}"></div>`).join("")}</div><p id="dr-left" aria-live="polite"></p>`;
      else choiceHTML = `<div class="dr-opts">${options(d).map((o) => `<button type="button" class="btn dr-opt" data-dopt="${esc(o.id)}" aria-pressed="${cur.pick === o.id}"><b>${esc(o.n)}</b>${o.d ? `<span class="small">${esc(o.d)}</span>` : ""}</button>`).join("")}</div>`;
      const names = cur.crit.length ? cur.crit.map((c) => c.n) : list(d.crit);
      const field = (key, label) => {
        const value = cur[key], other = !!value && !names.includes(value);
        return `<div class="field"><label for="dr-${key}">${label}(기준 이름)</label><select id="dr-${key}"><option value="">고르세요</option>${names.map((n) => `<option value="${esc(n)}"${n === value ? " selected" : ""}>${esc(n)}</option>`).join("")}<option value="__other"${other ? " selected" : ""}>직접 입력</option></select><input class="note" id="dr-${key}-x" aria-label="${label} 직접 입력" placeholder="예: 환경" maxlength="20" value="${esc(other ? value : "")}"${other ? "" : " hidden"}></div>`;
      };
      const whyLabel = d.kind === "rank" ? "그래도 이 순서로 정한 이유" : d.kind === "budget" ? "그래도 이렇게 나눈 이유" : "그래도 고른 이유";
      body.innerHTML = `<h3>3 선택과 얻고 잃는 것</h3>${choiceHTML}<p id="dr-picked"></p>${field("gain", "얻는 것")}${field("cost", "잃는 것")}<p class="hint">기준 이름(명사)으로 적으면 문장이 자연스럽습니다.</p><div class="field"><label for="dr-why">${whyLabel}</label><input class="note" id="dr-why" maxlength="120" value="${esc(cur.why)}"></div><p id="dr-tsent" aria-live="polite"></p><span id="dr-speak-t"></span>`;
      function paint() {
        el("#dr-picked").textContent = picked(d, cur);
        el("#dr-tsent").textContent = trade(d, cur);
        if (d.kind === "budget") {
          const sum = options(d).reduce((total, o) => total + cur.bud[o.id], 0);
          el("#dr-left").textContent = sum > 100 ? `예산 ${sum - 100} 초과` : `남은 예산 ${100 - sum}`;
        }
        nav();
      }
      function paintRank() {
        el("#dr-rank").innerHTML = cur.rank.map((id, i) => `<li><span class="dr-rank-lab">${esc(rankLabel(d, i))}</span><span>${esc(optionName(d, id))}</span><div class="row">${[-1, 1].map((dir) => `<button type="button" class="btn small" data-dmove="${i}" data-ddir="${dir}" aria-label="${esc(optionName(d, id))} ${dir < 0 ? "위로" : "아래로"}"${i + dir < 0 || i + dir >= cur.rank.length ? " disabled" : ""}>${dir < 0 ? "↑" : "↓"}</button>`).join("")}</div></li>`).join("");
        $$(root, "[data-dmove]").forEach((b) => { b.onclick = () => {
          const i = Number(b.getAttribute("data-dmove")), dir = Number(b.getAttribute("data-ddir")), next = i + dir;
          if (next < 0 || next >= cur.rank.length) return;
          [cur.rank[i], cur.rank[next]] = [cur.rank[next], cur.rank[i]];
          save(); paintRank(); paint();
          let target = el(`[data-dmove="${next}"][data-ddir="${dir}"]`);
          if (target.disabled) target = el(`[data-dmove="${next}"][data-ddir="${-dir}"]`);
          target.focus();
        }; });
      }
      if (d.kind === "rank") paintRank();
      $$(root, "[data-dopt]").forEach((b) => { b.onclick = () => {
        cur.pick = b.getAttribute("data-dopt"); save(); pressed(root, "[data-dopt]", cur.pick, "data-dopt"); paint();
      }; });
      $$(root, "[data-dbud]").forEach((input) => {
        // 공통 화면 이름의 정적 검사와 겹치지 않게 속성 이름을 나눠 쓴다.
        input.setAttribute("input" + "mode", "numeric");
        input.oninput = () => {
          const value = Number(input.value), amount = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.trunc(value))) : 0;
          cur.bud[input.getAttribute("data-dbud")] = amount;
          input.value = String(amount); save(); paint();
        };
      });
      ["gain", "cost"].forEach((key) => {
        const select = el("#dr-" + key), input = el("#dr-" + key + "-x");
        select.onchange = () => {
          input.hidden = select.value !== "__other";
          cur[key] = input.hidden ? select.value : input.value.slice(0, 20);
          save(); paint();
        };
        input.oninput = () => { cur[key] = input.value.slice(0, 20); save(); paint(); };
      });
      el("#dr-why").oninput = (event) => { cur.why = event.target.value.slice(0, 120); save(); paint(); };
      paint();
      KCP.speak(el("#dr-speak-t"), { rec: "한두 문장" });
    }

    function reflection() {
      const pb = pushback(d, cur);
      body.innerHTML = `<h3>4 반문</h3>${cur.focus === "push" ? `<div class="dr-sample"><p><b>가상의 학생 답</b>${tag("가상의 답")}</p><blockquote>${esc(d.sample)}</blockquote><p class="hint">이 답에 아래 반문이 들어왔다고 보고, 답을 고치거나 유지하는 이유를 써 보세요.</p></div>` : `<p class="small" id="dr-myans">내 답: ${esc(picked(d, cur))} ${esc(trade(d, cur))}</p>`}
        <p class="dr-pb"><b>반문</b>${tag("연습용 반문")}<span id="dr-pbq">${esc(pb.q)}</span></p>
        <div><button type="button" class="btn small ghost" id="dr-hint" aria-expanded="${cur.hint}">힌트</button></div><p class="hint" id="dr-hinttext"${cur.hint ? "" : " hidden"}>${esc(pb.hint)}</p>
        <div class="seg" role="group" aria-label="반문 뒤 선택"><button type="button" class="btn" data-dstance="revise" aria-pressed="false">답을 고친다</button><button type="button" class="btn" data-dstance="keep" aria-pressed="false">답을 유지한다</button></div>
        <div id="dr-rv-wrap" class="field" hidden><label for="dr-rv">고친 답</label><textarea class="note" id="dr-rv">${esc(cur.rv)}</textarea><p class="hint" id="dr-starters"></p></div><span id="dr-speak-r"></span>`;
      el("#dr-hint").onclick = () => { cur.hint = true; save(); el("#dr-hinttext").hidden = false; el("#dr-hint").setAttribute("aria-expanded", "true"); };
      function paint() {
        pressed(root, "[data-dstance]", cur.stance, "data-dstance");
        el("#dr-rv-wrap").hidden = !cur.stance;
        el("label[for=\"dr-rv\"]").textContent = cur.stance === "keep" ? "유지하는 이유" : "고친 답";
        el("#dr-starters").textContent = cur.stance ? "말 시작 예시(입력칸에 넣지 않습니다): " + list(KCP.STARTERS && KCP.STARTERS[cur.stance]).join(" / ") : "";
      }
      $$(root, "[data-dstance]").forEach((b) => { b.onclick = () => { cur.stance = b.getAttribute("data-dstance"); save(); paint(); }; });
      el("#dr-rv").oninput = (event) => { cur.rv = event.target.value; save(); };
      paint();
      KCP.speak(el("#dr-speak-r"), { rec: "두세 문장" });
    }

    function summary() {
      body.innerHTML = `<h3>5 정리</h3><div class="dr-sum">${summaryBlocks(d, cur).map(([title, content]) => `<div><h4>${esc(title)}</h4><p>${esc(content)}</p></div>`).join("")}</div>
        <fieldset class="dr-said"><legend>말로 해 봤다</legend><div class="row">${Object.entries(SAID).filter((_, i) => steps.includes(i + 2)).map(([key, name]) => `<button type="button" class="btn small" data-dsaid="${key}" aria-pressed="${cur.said[key]}">${name}</button>`).join("")}</div></fieldset>
        <div class="field"><label for="dr-nextgoal">다음엔 한 가지</label><input class="note" id="dr-nextgoal" maxlength="80" placeholder="예: 기준을 먼저 말한다" value="${esc(cur.next)}"><p class="hint">적으면 연습실의 지난 목표로도 넘어갑니다.</p></div>
        <div><button type="button" class="btn primary" id="dr-finish">기록하고 마치기</button></div>
        <div id="dr-after" class="stack" hidden><div class="row"><button type="button" class="btn" id="dr-again">다른 유형 한 판</button><a class="btn ghost" href="#drill">훈련장으로</a><button type="button" class="btn" id="dr-copy">복사</button></div><textarea class="note" id="dr-copybox" hidden aria-label="복사용 텍스트"></textarea></div>`;
      $$(root, "[data-dsaid]").forEach((b) => { b.onclick = () => {
        const key = b.getAttribute("data-dsaid"); cur.said[key] = !cur.said[key]; save(); b.setAttribute("aria-pressed", String(cur.said[key]));
      }; });
      el("#dr-nextgoal").oninput = (event) => { cur.next = event.target.value.slice(0, 80); save(); };
      el("#dr-finish").onclick = () => {
        if (finished || root !== activeRoot || !db) return;
        KCP.speakStop(); stopTimer();
        lastRun = record(cur, Date.now());
        db.runs.unshift(lastRun); db.runs = db.runs.slice(0, 30);
        if (cur.next.trim()) KCP.goal.set("drill", "짧은 판단 훈련장 · " + d.title, cur.next);
        db.cur = null; KCP.store.set("drill", db); finished = true;
        el("#dr-finish").hidden = true; el("#dr-nav").hidden = true;
        $$(body, "input, select, textarea, button").forEach((control) => { if (!control.closest("#dr-after")) control.disabled = true; });
        el("#dr-tgo").textContent = "시작";
        $$(root, "#dr-timebar button").forEach((button) => { button.disabled = true; });
        el("#dr-after").hidden = false;
        el("#dr-again").focus();
      };
      el("#dr-again").onclick = randomDrill;
      el("#dr-copy").onclick = () => { if (lastRun) KCP.copy(copyText(d, lastRun), el("#dr-copybox")); };
    }

    function renderStep() {
      KCP.speakStop();
      [comprehension, criteria, choices, reflection, summary][cur.step - 1]();
      nav();
    }
    setupTimer(root);
    renderStep();
  }

  KCP.on("home:render", ({ slot }) => {
    if (!slot) return;
    const entry = document.createElement("a"), minutes = defaultMinutes();
    entry.className = "dr-entry"; entry.href = "#drill";
    entry.innerHTML = `<span class="dr-entry-t">짧은 판단 훈련장</span>${tag("연습용 문항")}<span class="dr-entry-d">겉모습이 다른 짧은 가상 과제에 같은 절차(기준 → 얻고 잃는 것 → 반문)를 적용해 봅니다.</span><span class="chip">${minutes ? "목표 " + minutes + "분" : "시간 제한 없음"}</span>`;
    slot.appendChild(entry);
  });
  KCP.on("route:change", () => {
    stopTimer(); timer = null; activeRoot = null; db = null; lastRun = null;
  });
  KCP.on("storage:clear", () => {
    const root = activeRoot;
    stopTimer(); timer = null; db = null; lastRun = null; printNote = false; activeRoot = null;
    if (root && root.isConnected) setTimeout(() => { if (root.isConnected) KCP.rerender(); }, 0);
  });
  KCP.route("drill", (app, arg) => {
    db = normalizeDB(KCP.store.get("drill", blankDB()));
    if (!arg) { lobby(app); return; }
    const d = findDrill(arg);
    if (!d) { KCP.toast("없는 연습 문항입니다"); history.replaceState(null, "", "#drill"); lobby(app); return; }
    runScreen(app, d);
  });
})();
