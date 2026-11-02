/* 달 시작 예보·달 끝 연출: 엔진 자료 또는 기기 안 재계산을 재생한다. 저장·전송 없음(D-65). */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP) return;
  const REV11_COPY = { C2v: "사건 닫기" };
  const REV17_COPY = { M1: "지도에 덧입힌 옅은 색은 사건 종류 표시(효과 크기 무관)" };
  const DECK_COVER_MAX = 0.40; // G: 자동 표시 덱이 보이는 지도를 덮는 비율 상한.
  const DECK_NARROW_MIN = 600; // 기준판 compact 문턱.
  function deckPresentation({ rowArea, pagedArea, mapArea, rowOverflow = false, pagedOverflow = false, cap = DECK_COVER_MAX, narrow = false }) {
    if (!Number.isFinite(mapArea) || mapArea <= 0) return "strip";
    const fits = (area, overflow) => Number.isFinite(area) && area >= 0 && area <= cap * mapArea && !overflow;
    if (narrow) return fits(pagedArea, pagedOverflow) ? "compact" : "strip";
    return fits(rowArea, rowOverflow) ? "row" : fits(pagedArea, pagedOverflow) ? "paged" : "strip";
  }
  let status = { playing: false, skipped: false, ms: 0, replayed: false, cardsOpen: false,
    source: null, fallback: null, recomputeMs: 0, forecastOpen: false, mood: null, strip: false, deferred: false };
  let layer = null, toast = null, deck = null, timers = [], off = [], raf = 0, layoutRaf = 0, epoch = 0;
  let lastMonth = null, advanceSummary = null, syncCardSounds = null;
  let stripBar = null, expanded = false, expandedWithDrawer = false, armCards = null;
  let expandFocus = null, currentResult = null, currentForecast = null, forecastVisible = null, deferredNotice = null;
  // 사건의 종류만 읽는다. 효과 크기·예보 범위로 농도나 입자 수를 바꾸지 않는다(D-65).
  const EVENT_MOOD = Object.freeze({ heatwave_peak: "heat", evening_peak_tropical_night: "heat",
    coldwave_heating: "cold", heavy_snow_solar: "snow", typhoon_coast: "storm", monsoon_cloud: "cloud", heavy_rain: "rain",
    spring_dust_haze: "haze", finedust_coal_cap: "haze" });
  const MOOD_ICON = { heat: "☀", cold: "✧", snow: "❄", storm: "🌀", cloud: "☁", rain: "☂", haze: "≋" };
  const EVENT_ICON = Object.freeze({ ...Object.fromEntries(Object.entries(EVENT_MOOD).map(([id, mood]) => [id, MOOD_ICON[mood]])),
    light_load_curtailment: "◐", line_opposition_delay: "⚑", semiconductor_fab_expansion: "⚙", datacenter_siting: "▤",
    planned_maintenance: "⚒", coal_phaseout: "⊘", re100_buyer: "♧", regional_tariff: "₩" });
  const eventIcon = id => Object.hasOwn(EVENT_ICON, id) ? EVENT_ICON[id] : "◆";
  const moodOf = cards => cards.map(c => Object.hasOwn(EVENT_MOOD, c.id) ? EVENT_MOOD[c.id] : null).find(Boolean) || null;
  const forecastMonths = new Set();
  // 예보 카드를 이미 본 달: 새로고침 뒤에도 다시 띄우지 않으려고 이 탭의 sessionStorage에만 적는다(리그 상태·전송 아님, D-65).
  const SEEN = "kcp-fx-forecast-v1:";
  const seenForecast = key => { try { return sessionStorage.getItem(SEEN + key) === "1"; } catch (_) { return false; } };
  const markForecast = key => { try { sessionStorage.setItem(SEEN + key, "1"); } catch (_) {} };
  let moodRoot = null, forecastCards = new Map(), forecastMonth = null, activeMonth = null, activePhase = null;
  // review → end는 W1과 같이 같은 결과 연출이다.
  const phaseOf = phase => phase === "end" ? "review" : phase;
  const moodNote = REV17_COPY.M1;
  function setMood(mood, root) {
    if (moodRoot !== root || status.mood !== mood) KCP.buildGame?.setMapMood?.(mood);
    moodRoot = root; status.mood = mood;
  }
  // 재마운트·새로고침 때는 카드를 다시 열지 않고 지도 분위기만 복원한다.
  // league.state에는 away가 없으므로 실제 지도 DOM으로 관전을 구별한다.
  function syncMapMood(root) {
    const session = KCP.league?.state?.(), V = session?.snap || session?.S, C = KCP.leagueCore;
    if (!V || !C?.regionOf) return;
    const own = root.isConnected && !root.hidden && root.classList.contains("lg-team-map") &&
      !root.classList.contains("lg-peek") && !root.querySelector(".lg-awaybar");
    const round = ["review", "end"].includes(V.phase) ? V.results?.at(-1)?.round : V.round;
    if (layer && (!own || activeMonth !== monthKey({ round, team: session.team, view: V }) ||
        activePhase !== phaseOf(V.phase))) clear();
    const reg = C.regionOf(V.region);
    const cards = own && ["plan", "run", "review", "end"].includes(V.phase) ? (V.events || [])
      .filter(ev => ev.round === round && C.eventDef(reg, ev.id) && C.hits(reg, C.eventDef(reg, ev.id), session.team)) : [];
    setMood(moodOf(cards), root);
  }
  const reduced = () => KCP.v2?.reduced?.() ?? !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const threshold = dem => Math.max(0.005, 0.02 * dem);
  const sum = values => values.reduce((total, value) => total + value, 0);
  // 표시 규칙(G): 시간별 거래를 추정하지 않고 공개된 도시 합계·정전 시간에 표시값을 맞춘다.
  function calibrate(u, dem, U, N) {
    if (!Number.isFinite(U) || U < 0 || !Number.isInteger(N) || N < 0 || N > u.length) return null;
    const count = r => r.reduce((n, value, k) => n + (value > threshold(dem[k]) ? 1 : 0), 0);
    if (Math.abs(U - sum(u)) <= 0.01 && count(u) === N) return u.slice();
    // 부족이 큰 순서로 공개 정전 시간 N개를 고른다(O). 나머지 부족 시간(P)은 문턱 아래에 둔다.
    // N = 0이어도(문턱 아래 작은 부족만 남은 달) 합계 U는 P 시간에 나눠 담는다.
    const order = Array.from(u.keys()).filter(k => u[k] > 0).sort((a, b) => u[b] - u[a] || a - b);
    if (order.length < N) return null;
    const inO = new Uint8Array(u.length); order.slice(0, N).forEach(k => { inO[k] = 1; });
    const lo = k => inO[k] ? threshold(dem[k]) * 1.001 : 0;
    const hi = k => inO[k] ? Infinity : threshold(dem[k]) * 0.999;
    const total = sum(u), r = new Float64Array(u.length);
    if (total <= 0) return U <= 0.01 && N === 0 ? r : null;
    order.forEach(k => { r[k] = Math.min(hi(k), Math.max(lo(k), u[k] * U / total)); });
    // 경계 안에서 남는 차이를 움직일 수 있는 시간에 부족 크기 비율로 다시 나눈다(최대 50회).
    for (let pass = 0; pass < 50; pass++) {
      const diff = U - sum(r);
      if (Math.abs(diff) <= 1e-9) break;
      const free = order.filter(k => diff > 0 ? r[k] < hi(k) : r[k] > lo(k));
      const weight = free.reduce((a, k) => a + u[k], 0);
      if (!free.length || weight <= 0) break;
      free.forEach(k => { r[k] = Math.min(hi(k), Math.max(lo(k), r[k] + diff * u[k] / weight)); });
    }
    return Math.abs(sum(r) - U) <= 0.01 && count(r) === N ? r : null;
  }
  function recomputeReplay(V, res, id) {
    // 검사용 (round, id)도 같은 계산 경로다. 재생·DOM·소리는 조작하지 않는다.
    const inspect = typeof V === "number";
    if (inspect) {
      const round = V, session = KCP.league?.state?.();
      id = res; V = session?.snap || session?.S;
      res = V?.results?.find(r => r.round === round);
    }
    const started = performance.now();
    status.fallback = null;
    try {
      const raw = V && res && KCP.league?.uiMath?.replaySimulation(V, res, id), team = res?.team?.[id];
      if (!raw || !team) { status.fallback = "unavailable"; return null; }
      const u = new Float64Array(raw.H);
      for (let k = 0; k < raw.H; k++) {
        for (let ti = 0; ti < raw.NT; ti++) u[k] += raw.hrUns[k * raw.NT + ti];
      }
      if (!Number.isFinite(team.isolated?.uns) || !u.every(v => Number.isFinite(v) && v >= 0) ||
          Math.abs(sum(u) - team.isolated.uns) > 0.01) {
        status.fallback = "mismatch"; return null;
      }
      const dem = raw.hrDem;
      if (!(dem?.length === u.length && dem.every(v => Number.isFinite(v) && v >= 0))) { status.fallback = "calibrate"; return null; }
      // D-74 계통 수입: 엔진은 이웃 거래 정산 뒤 남은 부족을 시간마다 수요×gridImportShare까지 메운다
      // (league-core gridSupply). 같은 식·같은 32비트 저장 순서로 적용한 뒤 보정한다. 이웃 거래가 없는 달은
      // 이것만으로 엔진의 시간별 남은 부족(uns−del)과 같다. 거래가 있는 달의 시간별 순서는 보정 규칙(G).
      const share = V.econ ? KCP.ECON_DATA?.params?.gridImportShare?.v : null, g = new Float64Array(u.length);
      for (let k = 0; k < u.length; k++) {
        const uF = Math.fround(u[k]);
        const fill = Number.isFinite(share) ? Math.fround(Math.min(Math.max(0, uF), dem[k] * share)) : 0;
        g[k] = uF - fill;
      }
      const r = calibrate(g, dem, team.uns, team.outH);
      if (!r) { status.fallback = "calibrate"; return null; }
      const data = { r, outH: team.outH, sum: sum(r), source: "device" };
      return inspect ? data : { ...data, res: raw, outHour: k => r[k] > threshold(dem[k]) };
    } catch (e) {
      status.fallback = "unavailable"; return null;
    } finally {
      status.recomputeMs = performance.now() - started;
    }
  }
  const later = (ms, fn) => { const token = epoch; timers.push(setTimeout(() => {
    if (token === epoch && keepCurrentCards()) fn();
  }, ms)); };
  const listen = (target, name, fn, opts) => {
    target.addEventListener(name, fn, opts);
    off.push(() => target.removeEventListener(name, fn, opts));
  };
  // Esc 한 번에 하나만 닫는다. 다른 처리기가 이미 쓴 Esc(defaultPrevented)와 열린 대화상자에는 양보한다.
  const escFree = e => e.key === "Escape" && !e.defaultPrevented && !document.querySelector("dialog[open]");
  // 층 순서(D-83): 대화상자 → 코치 → 재생 건너뛰기 → 펼친 덱(초점이 덱 안 포함) → 리그 서랍·확인 상자 →
  // 펼치지 않은 덱·접힌 띠. 코치가 보이면 window 캡처 단계에서 먼저 가로채지 않고 리그 처리기에 넘긴다.
  const coachUp = () => !!document.getElementById("lg-coach")?.getClientRects().length;
  // 펼친 카드는 서랍 위를 덮는 맨 위 층이고, 초점이 덱 안이면 학생이 카드를 보고 있다. 이때는 window 캡처
  // 단계에서 리그 처리기보다 먼저 받아 카드만 닫고 서랍 쪽으로 넘기지 않는다.
  const topEscape = (e, close) => {
    const active = document.activeElement, focused = !!deck?.contains(active);
    // rev18 #85: 학생이 펼쳐 코치 위에 뜬 덱만 body·지도 초점에서도 먼저 닫는다.
    // D-83 각주 2의 코치·서랍·확인 상자 안 초점 우선과 펼치지 않은 덱의 순서는 그대로 둔다.
    const overCoach = coachUp() && layer?.dataset.coachOver === "true" &&
      (focused || active === document.body || active?.matches("#bd-canvas"));
    // D-83 각주 2: 키보드 초점이 덱 안이면 코치보다 먼저 덱이 받는다.
    if (!escFree(e) || (coachUp() && !focused && !overCoach) || !deck || status.deferred || !(expanded || focused)) return;
    e.preventDefault(); e.stopPropagation(); close();
  };
  // 덱 안 초점은 어떻게 닫히든 복귀시킨다(자동 닫힘·화면 낭독기 훑기·달 불일치·단계 전환 포함). 이미 body로
  // 떨어진 초점은 Esc·닫기처럼 사용자가 직접 닫을 때만 옮긴다. 마지막 외부 요소, 결과 탭, 막대의 보이는 단추 순서로
  // 찾고, 사용자 동작이 아닌 닫힘에서는 입력 칸을 빼서 모바일 가상 키보드가 갑자기 뜨지 않게 한다.
  function focusBack(userClose) {
    const box = deck || layer, active = document.activeElement;
    if (!box || !(box.contains(active) || (userClose && (!active || active === document.body)))) return null;
    const typing = el => el.isContentEditable || !!el.matches?.("input, textarea, select, [contenteditable]");
    return [expandFocus, document.querySelector('#lg-bar [data-panel="result"]'),
      ...(document.querySelector("#lg-bar")?.querySelectorAll("button") || [])].find(target =>
      target?.isConnected && target !== document.body && !box.contains(target) && visibleRect(target) &&
      (userClose || !typing(target))) || null;
  }
  function closeCards(restoreFocus = false) {
    const focus = focusBack(restoreFocus);
    if (status.forecastOpen) { removeLayer(focus); return; }
    deck?.remove(); deck = null; syncCardSounds = null; status.cardsOpen = status.forecastOpen = false;
    stripBar = armCards = null; expanded = status.strip = status.deferred = false;
    expandedWithDrawer = false;
    expandFocus = forecastVisible = deferredNotice = null;
    if (layer) layer.dataset.strip = layer.dataset.chip = layer.dataset.over = layer.dataset.summaryOver = "false";
    if (layer) layer.dataset.coachOver = "false"; // rev18 #85: 접힌 뒤에는 원래 층으로 돌아간다.
    syncLayerVisibility();
    focus?.focus?.({ preventScroll: true });
  }
  function currentMonth(opts) {
    const session = KCP.league?.state?.(), state = session?.snap || session?.S;
    return !session || (!session.away && session.team === opts.team &&
      ["review", "end"].includes(state?.phase) && state?.results?.at(-1)?.round === opts.round);
  }
  function keepCurrentCards() {
    if (currentResult && !currentResult()) { closeCards(); hideSummary(); return false; }
    if (currentForecast && !currentForecast()) { removeLayer(); return false; }
    return true;
  }
  // 보류 중에는 타이머·배치가 돌지 않아도 단계 전환에서 결과 연출을 즉시 걷는다.
  // 끝 화면은 같은 달이어도 별도 화면이라 마지막 달 카드를 걷는다(lastMonth는 남겨 다시 띄우지 않는다).
  function phase(nextPhase, round) {
    if (currentResult && (nextPhase === "end" || phaseOf(nextPhase) !== "review" || lastMonth?.round !== round)) clear();
  }
  const visibleRect = el => {
    if (!el || el.hidden || !el.getClientRects().length) return null;
    const style = window.getComputedStyle?.(el), p = el.getBoundingClientRect();
    return style?.visibility === "hidden" || style?.display === "none" || p.right <= p.left || p.bottom <= p.top ? null : p;
  };
  const openDrawers = root => [root.querySelector("#lg-panel"), root.querySelector("#bd-drawer")].filter(el => visibleRect(el));
  const insideStripDrawer = (root, target) => status.strip && !expanded && openDrawers(root).some(el => el.contains(target));
  function hideSummary() {
    toast?.remove(); toast = null; advanceSummary = null;
    if (raf) cancelAnimationFrame(raf); raf = 0;
    syncLayerVisibility();
  }
  function syncLayerVisibility() {
    const hidden = !toast && (!deck || status.deferred);
    if (layer && layer.hidden !== hidden) layer.hidden = hidden;
  }
  // 분위기와 재생은 유지하고, 예보를 닫은 뒤 빈 덧층과 관찰·리스너만 해제한다.
  function removeLayer(focus = focusBack(false)) {
    epoch++;
    timers.forEach(clearTimeout); timers = [];
    off.forEach(fn => fn()); off = [];
    if (raf) cancelAnimationFrame(raf); raf = 0;
    if (layoutRaf) cancelAnimationFrame(layoutRaf); layoutRaf = 0;
    layer?.remove(); layer = toast = deck = null;
    activeMonth = activePhase = null;
    syncCardSounds = null;
    stripBar = armCards = null; expanded = status.strip = status.deferred = false;
    expandedWithDrawer = false;
    expandFocus = currentResult = currentForecast = forecastVisible = deferredNotice = null;
    advanceSummary = null;
    status.cardsOpen = status.forecastOpen = false;
    focus?.focus?.({ preventScroll: true });
  }
  function clear() {
    removeLayer();
    // onDone는 이전 달 연출을 다시 열지 못한다.
    KCP.buildGame?.skipReplay?.();
    const cut = status.playing;
    status.playing = false; status.cardsOpen = status.forecastOpen = false;
    setMood(null, null);
    if (cut) emitReplay("end", replayOpts, true);
  }
  // 재생 시작·끝을 알린다(UX 갈래가 좁은 화면에서 재생 동안 결과 서랍을 접는 데 쓴다).
  // KCP.on("fx:replay", d => …) — d = { state: "start" | "end", round, team, ms, source, skipped, cancelled }
  let replayOpts = null;
  function emitReplay(state, o, cancelled = false) {
    KCP.emit?.("fx:replay", { state, round: o?.round ?? null, team: o?.team ?? null, ms: status.ms,
      source: status.source, skipped: status.skipped, cancelled });
  }
  function clearForMap(root) { if ((layer && root.contains(layer)) || moodRoot === root) clear(); }
  function schedulePlace(root) {
    if (layoutRaf) return;
    const token = epoch;
    layoutRaf = requestAnimationFrame(() => {
      layoutRaf = 0;
      if (token === epoch) place(root);
    });
  }
  const node = (tag, cls, text) => {
    const el = document.createElement(tag); el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  // 실제 막대·도구·서랍 사각형을 제외한 지도 영역. 390px에서도 서랍 아래 공간을 쓴다.
  function place(root) {
    if (!root.isConnected) { clear(); return; }
    if (!layer) return;
    if (!keepCurrentCards()) return;
    const stage = root.querySelector(".bd-stage")?.getBoundingClientRect();
    if (!stage) return;
    const desktop = window.innerWidth >= 761;
    let box = { left: Math.max(8, stage.left + 8), right: Math.min(window.innerWidth - 8, stage.right - 8),
      top: Math.max(8, stage.top + 8), bottom: Math.min(window.innerHeight - 8, stage.bottom - 8) };
    // #lg-map-result: 지도 왼쪽 위 'N월 실제' 요약 줄. 요약 띠가 이것을 덮지 않게 그 아래에서 시작한다.
    for (const sel of ["#bd-hud", ".lg-bar", "#bd-mapbar", "#lg-map-result"]) {
      const el = root.querySelector(sel);
      if (el && el.getClientRects().length) box.top = Math.max(box.top, el.getBoundingClientRect().bottom + 8);
    }
    for (const sel of ["#bd-dock"]) {
      const el = root.querySelector(sel);
      if (el && !el.hidden && el.getClientRects().length) box.bottom = Math.min(box.bottom, el.getBoundingClientRect().top - 8);
    }
    const mapBox = { ...box }, panels = [], drawers = openDrawers(root);
    // 넓은 화면에서 서랍 없이 펼친 덱은 닫힐 때까지 유지한다.
    if (expanded && !drawers.length && (!desktop || expandedWithDrawer)) expanded = false;
    let guidanceBox = null, keysBox = null;
    const overlaps = (b, p) => p.left < b.right && p.right > b.left && p.top < b.bottom && p.bottom > b.top;
    const area = b => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
    const spacesAround = (b, p, gap = 8) => [
      { ...b, right: Math.min(b.right, p.left - gap) }, { ...b, left: Math.max(b.left, p.right + gap) },
      { ...b, bottom: Math.min(b.bottom, p.top - gap) }, { ...b, top: Math.max(b.top, p.bottom + gap) }
    ].filter(b => area(b) > 0);
    for (const sel of [".lg-map-guidance", "#lg-plan-issues", "#lg-issue", "#lg-issue-check", "#lg-coach", "#lg-panel", "#bd-drawer", ...(desktop ? [".lg-map-keys"] : [])]) {
      const p = visibleRect(root.querySelector(sel));
      if (!p) continue;
      panels.push(p);
      if (sel === ".lg-map-guidance") guidanceBox = p;
      if (sel === ".lg-map-keys") keysBox = p;
      if (overlaps(box, p)) {
        box = spacesAround(box, p).sort((a, b) => area(b) - area(a))[0] ||
          { ...box, right: box.left, bottom: box.top };
      }
    }
    // 이전의 넉넉한 배치는 유지한다. 부족할 때만 모든 빈 사각형을 남겨 큰 틈을 놓치지 않는다.
    const freeSpaces = (bounds, gap = 8, obstacles = panels) => obstacles.reduce((spaces, p) => spaces.flatMap(b =>
      overlaps(b, p) ? spacesAround(b, p, gap) : [b]), [bounds]).sort((a, b) => area(b) - area(a));
    // 카드 240px 외에 덱 inset(8)·닫기(44)·간격(6)을 확보한다.
    const fits = b => b.right - b.left >= 280 && b.bottom - b.top >= 298;
    let spaces = null;
    if (deck && drawers.length && !expanded && !fits(box)) {
      spaces = freeSpaces(mapBox);
      box = spaces.find(fits) || spaces[0] || { ...mapBox, right: mapBox.left, bottom: mapBox.top };
    }
    const wasStrip = status.strip, wasDeferred = status.deferred;
    status.deferred = false;
    layer.dataset.chip = "false";
    layer.dataset.over = "false";
    if (deck && (expanded || (!drawers.length && !fits(box)))) {
      const over = { left: Math.max(8, stage.left + 8), right: Math.min(window.innerWidth - 8, stage.right - 8), top: Math.max(8, stage.top + 8), bottom: 0 };
      for (const sel of ["#bd-hud", ".lg-bar", "#bd-mapbar"]) {
        const el = root.querySelector(sel);
        if (el && el.getClientRects().length) over.top = Math.max(over.top, el.getBoundingClientRect().bottom + 8);
      }
      const dock = root.querySelector("#bd-dock");
      over.bottom = Math.min(window.innerHeight - 8, stage.bottom - 8, dock && !dock.hidden && dock.getClientRects().length ? dock.getBoundingClientRect().top - 8 : Infinity);
      // 학생이 펼친 덧창은 기존 자리가 모자랄 때만 도구 막대 위까지 쓴다.
      if (desktop && expanded && !fits(over)) over.bottom = Math.min(window.innerHeight - 8, stage.bottom - 8);
      if (fits(over)) { box = over; layer.dataset.over = "true"; }
    }
    const run = root.querySelector("#bd-run");
    if (run && !run.hidden) {
      // 운영 띠의 위치는 build.layout의 V.area가 맡는다. 사건은 그 위의 빈 공간만 쓴다.
      box.bottom = Math.min(box.bottom, run.getBoundingClientRect().top - 8);
    }
    let compact = box.right - box.left < 600;
    // 학생이 띠를 펼쳤으면 기존 서랍 위 펼침(over) 배치를 그대로 쓴다(검토 major 2, D-83 ④).
    let presentation = null;
    layer.dataset.autoDeck = String(!!(deck && desktop && !expanded));
    if (deck && (!desktop || expanded)) layer.dataset.paged = String(deck.querySelectorAll(".fx-turn-card").length > 3);
    if (deck && desktop && !expanded) {
      // 자동 덱은 좁은 자리면 compact 한 장만, 넓은 자리면 한 줄·한 장 순서로 실측한다.
      // 덱의 빈 여백만 걷어 왼쪽 아래로 붙이고 범례·서랍·코치를 피한다.
      const bounds = { ...mapBox, bottom: Math.min(mapBox.bottom,
        run && !run.hidden ? run.getBoundingClientRect().top - 8 : Infinity) };
      const candidates = freeSpaces(bounds);
      const leftOf = list => list.filter(fits).sort((a, b) => a.left - b.left || b.bottom - a.bottom)[0];
      const leftLimit = bounds.left + (bounds.right - bounds.left) / 3;
      let corner = leftOf(candidates);
      // 코치 띠와 범례 사이가 좁아 왼쪽에 자리가 없으면, 지도 가운데로 가는 대신 범례 위를 덮는다(범례가 지도 핵심부보다 덜 중요).
      if (keysBox && (!corner || corner.left > leftLimit)) {
        const overKeys = leftOf(freeSpaces(bounds, 8, panels.filter(p => p !== keysBox)));
        if (overKeys && overKeys.left <= leftLimit) corner = overKeys;
      }
      if (corner) {
        const narrow = corner.right - corner.left < DECK_NARROW_MIN;
        const articles = [...deck.querySelectorAll(".fx-turn-card")], count = articles.length;
        const canvas = root.querySelector("#bd-canvas")?.getBoundingClientRect() || stage;
        const visibleMap = { left: Math.max(0, canvas.left), right: Math.min(window.innerWidth, canvas.right),
          top: Math.max(0, canvas.top), bottom: Math.min(window.innerHeight, canvas.bottom) };
        const obstacles = panels.filter(p => p !== keysBox);
        for (const sel of ["#bd-hud", ".lg-bar", "#bd-mapbar", "#bd-dock", "#bd-run"]) {
          const p = visibleRect(root.querySelector(sel)); if (p) obstacles.push(p);
        }
        // 8px 격자의 같은 표본으로 분모·각 후보의 지도 안 겹침을 센다. 범례는 지도에 포함한다.
        const points = [];
        for (let y = visibleMap.top + 4; y < visibleMap.bottom; y += 8)
          for (let x = visibleMap.left + 4; x < visibleMap.right; x += 8)
            if (!obstacles.some(p => x >= p.left && x < p.right && y >= p.top && y < p.bottom)) points.push([x, y]);
        const row = deck.querySelector(".fx-turn-card-row"), close = deck.querySelector(".fx-turn-close");
        // hidden을 토글하면 관찰자가 매 프레임 재배치를 예약하므로 실측 중에만 display를 덮는다.
        for (const [el, display] of [[layer, "block"], [row, "grid"], [close, "block"]]) el.style.setProperty?.("display", display, "important");
        const measure = mode => {
          layer.dataset.strip = "false"; layer.dataset.compact = String(mode === "compact"); layer.dataset.paged = String(mode === "paged");
          const rowWidth = mode !== "row" ? 360 : count === 1 ? 280 : count === 2 ? 520 : 794;
          const candidate = { left: corner.left, right: Math.min(corner.right, corner.left + rowWidth + 8),
            top: corner.bottom - 298, bottom: corner.bottom };
          Object.assign(layer.style, { left: `${candidate.left}px`, top: `${candidate.top}px`,
            width: `${candidate.right - candidate.left}px`, height: "298px" });
          // .fx-turn-cards의 inset 4px를 반영한 후보 사각형(최소 DOM에서도 같은 기하).
          const rect = { left: candidate.left + 4, right: candidate.right - 4, top: candidate.top + 4, bottom: candidate.bottom - 4 };
          const covered = points.filter(([x, y]) => x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom).length;
          // 다음 단추로 보일 카드도 같은 폭에서 넘치지 않아야 한다(visibility 숨김은 실측 가능).
          const overflow = articles.some(a => [a, ...a.querySelectorAll(".fx-turn-face")].some(el =>
            Number.isFinite(el.scrollHeight) && Number.isFinite(el.clientHeight) && el.scrollHeight > el.clientHeight + 1));
          return { box: candidate, area: covered, overflow: overflow || (mode === "row" && count > 3) };
        };
        const rowMeasure = narrow ? null : measure("row"), pagedMeasure = measure(narrow ? "compact" : "paged");
        for (const el of [layer, row, close]) el.style.removeProperty("display");
        presentation = deckPresentation({ narrow, rowArea: rowMeasure?.area ?? 0, pagedArea: pagedMeasure.area, mapArea: points.length,
          rowOverflow: rowMeasure?.overflow, pagedOverflow: pagedMeasure.overflow });
        layer.dataset.paged = String(presentation === "paged");
        compact = presentation === "compact";
        box = presentation === "row" ? rowMeasure.box : pagedMeasure.box;
      } else {
        presentation = "strip";
        box = candidates[0] || { ...bounds, right: bounds.left, bottom: bounds.top };
      }
      layer.dataset.over = "false";
    }
    status.strip = !!(deck && (presentation === "strip" || !fits(box)));
    layer.dataset.strip = String(status.strip);
    if (status.strip) { expanded = false; layer.dataset.over = "false"; }
    if (status.strip) {
      // 지도 틈과 대체 자리 모두 실제 조작 사각형을 제외한다. 덧층 자신의 단추는 제외 대상이 아니다.
      const rectOf = visibleRect;
      const controls = [...root.querySelectorAll("button, a, [role=button]")]
        .filter(el => !layer.contains(el) && !drawers.some(drawer => drawer.contains(el))).map(rectOf).filter(Boolean);
      if (run && root.classList.contains("bd-replaying") && !run.hidden) {
        const p = rectOf(run);
        if (p) controls.push(p);
      }
      const choose = candidates => candidates.find(b => b.right - b.left >= 180 && b.bottom - b.top >= 44) ||
        candidates.filter(b => b.right - b.left >= 44 && b.bottom - b.top >= 44)
          .sort((a, b) => a.top - b.top || a.left - b.left)[0];
      const obstacles = [...panels, ...controls];
      const viewport = { left: 8, right: window.innerWidth - 8, top: 8, bottom: window.innerHeight - 8 };
      const inSlot = (bounds, blocked = obstacles) => bounds && choose(freeSpaces({
        left: Math.max(viewport.left, bounds.left), right: Math.min(viewport.right, bounds.right),
        top: Math.max(viewport.top, bounds.top), bottom: Math.min(viewport.bottom, bounds.bottom)
      }, 0, blocked));
      let slot = choose((spaces || freeSpaces(mapBox)).flatMap(b => freeSpaces(b, 0, controls)));
      const mapbar = root.querySelector("#bd-mapbar"), bar = rectOf(mapbar);
      if (!slot && bar) {
        const buttons = [...mapbar.querySelectorAll("button, a, [role=button]")].map(rectOf).filter(Boolean);
        const last = buttons.at(-1);
        if (last) slot = inSlot({ left: Math.max(...buttons.filter(p => p.top < last.bottom && p.bottom > last.top).map(p => p.right)),
          right: viewport.right, top: last.top, bottom: Math.min(bar.bottom, last.top + 44) });
      }
      if (!slot && bar) {
        const leagueBar = rectOf(root.querySelector(".lg-bar"));
        if (leagueBar) slot = inSlot({ ...viewport, top: leagueBar.bottom, bottom: bar.top });
      }
      if (!slot) {
        const result = rectOf(root.querySelector("#lg-map-result"));
        // 안내 묶음의 투명한 여백은 쓸 수 있지만 실제 결산 글과 다른 패널은 덮지 않는다.
        if (result) slot = inSlot({ left: viewport.right - 44, right: viewport.right,
          top: result.top, bottom: result.top + 44 }, [...obstacles.filter(p => p !== guidanceBox), result]);
      }
      status.deferred = !slot;
      const chip = !slot || slot.right - slot.left < 180;
      layer.dataset.chip = String(chip);
      box = slot ? { ...slot, right: chip ? slot.left + 44 : slot.right,
        bottom: slot.top + (chip ? 44 : Math.min(52, slot.bottom - slot.top)) } :
        { left: mapBox.left, right: mapBox.left, top: mapBox.top, bottom: mapBox.top };
    }
    // rev18 #85: 자리 계산은 유지하고 코치가 보이는 실제 펼침(over) 동안에만 코치 위 층을 쓴다.
    layer.dataset.coachOver = String(!!(coachUp() && expanded && layer.dataset.over === "true" && !status.deferred));
    if (stripBar) {
      // hidden은 실제 전환 때만 쓴다(MutationObserver가 재배치를 예약하므로).
      if (stripBar.hidden !== !status.strip) stripBar.hidden = !status.strip;
      for (const el of [deck.querySelector(".fx-turn-card-row"), deck.querySelector(".fx-turn-close")]) {
        if (el.hidden !== status.strip) el.hidden = status.strip;
      }
      stripBar.querySelector("button").setAttribute("aria-expanded", String(expanded));
      const stripClose = stripBar.querySelector(".fx-turn-strip-close"), chip = layer.dataset.chip === "true";
      if (stripClose.hidden !== chip) stripClose.hidden = chip;
    }
    // 덱 없는 요약 띠만 좁은 틈을 벗어나 지도 머리 아래의 전체 폭을 쓴다.
    const summaryOver = !!(!deck && toast && box.right - box.left < 240);
    // 지도 안내 묶음(z 47) 위 층(z 48)으로 올린다. 지도 결과 줄(#lg-map-result)은 요약 띠가 떠 있는 동안(6초 또는 한 번 누름)만 덮는다.
    // data-over는 덱 펼침의 뜻으로 검사·배치가 읽으므로 요약 띠는 별도 속성을 쓴다.
    layer.dataset.summaryOver = String(summaryOver);
    if (summaryOver) {
      box = { left: Math.max(8, stage.left + 8), right: Math.min(window.innerWidth - 8, stage.right - 8),
        top: Math.max(8, stage.top + 8), bottom: 0 };
      for (const sel of ["#bd-hud", ".lg-bar", "#bd-mapbar"]) {
        const el = root.querySelector(sel);
        if (el && el.getClientRects().length) box.top = Math.max(box.top, el.getBoundingClientRect().bottom + 8);
      }
      // 아직 hidden인 첫 배치에서도 최종 숫자의 줄바꿈을 포함해 한 장 높이를 자연스럽게 확보한다.
    }
    const width = Math.max(0, box.right - box.left), height = Math.max(0, box.bottom - box.top);
    Object.assign(layer.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${width}px`, height: summaryOver ? "auto" : `${height}px` });
    layer.dataset.compact = String(desktop && deck && !status.strip ? compact : width < 600);
    syncLayerVisibility();
    if (status.deferred && !wasDeferred) deferredNotice?.();
    if (wasStrip !== status.strip || wasDeferred !== status.deferred) armCards?.();
    syncCardSounds?.();
    forecastVisible?.();
  }
  function showCards(cards, sound, root, forecast = false, summary = null) {
    if (!cards.length || !layer?.isConnected || !root.isConnected) return;
    hideSummary();
    expandedWithDrawer = false;
    deck = node("section", "fx-turn-cards");
    deck.setAttribute("aria-label", "이번 달 사건 카드");
    let summaryLive = null, summaryAnnounced = false;
    const announceSummary = () => {
      if (summaryAnnounced || status.deferred || !summaryLive?.isConnected) return;
      summaryAnnounced = true; summaryLive.textContent = summary;
    };
    if (summary != null) {
      summaryLive = node("span", "bd-sr");
      summaryLive.setAttribute("aria-live", "polite"); summaryLive.setAttribute("aria-atomic", "true");
      deck.append(summaryLive);
    }
    const close = node("button", "fx-turn-close", REV11_COPY.C2v); close.type = "button";
    close.addEventListener("click", () => closeCards(true)); deck.append(close);
    const row = node("div", "fx-turn-card-row"); deck.append(row);
    stripBar = node("div", "fx-turn-strip"); stripBar.setAttribute("role", "status");
    const events = cards.filter(c => c.id), first = events[0] || cards[0];
    const rest = events.length > 1 ? ` 외 ${events.length - 1}장` : "";
    const icon = node("span", "fx-turn-strip-icon", first.id ? eventIcon(first.id) : first.icon || "◆"); icon.setAttribute("aria-hidden", "true");
    stripBar.append(icon, node("span", "fx-turn-strip-title", first.title),
      node("span", "fx-turn-strip-count", rest.trim()));
    const expand = node("button", "fx-turn-expand", "펼치기"); expand.type = "button";
    expand.setAttribute("aria-expanded", "false");
    expand.setAttribute("aria-label", `${first.title}${rest} 펼치기`);
    expand.addEventListener("click", () => {
      expandedWithDrawer = openDrawers(root).length > 0;
      expanded = true;
      place(root); if (deck && expanded) close.focus?.({ preventScroll: true });
    });
    const stripClose = node("button", "fx-turn-strip-close", "×"); stripClose.type = "button";
    stripClose.setAttribute("aria-label", "사건 카드 닫기");
    stripClose.addEventListener("click", () => closeCards(true));
    stripBar.append(expand, stripClose); deck.append(stripBar);
    const sounded = new WeakSet(), ready = new WeakSet();
    const visible = article => !status.strip && !((layer?.dataset.compact === "true" || layer?.dataset.paged === "true") && article.dataset.active !== "true");
    const cardSound = article => {
      if (sounded.has(article) || !article.classList.contains("fx-revealed") || !visible(article)) return;
      sounded.add(article); sound?.("card");
    };
    const revealCard = article => {
      if (!ready.has(article) || !visible(article)) return;
      if (!article.classList.contains("fx-revealed")) article.classList.add("fx-revealed");
      cardSound(article);
      forecastVisible?.();
    };
    const articles = cards.map((card, i) => {
      const article = node("article", "fx-turn-card");
      article.dataset.forecast = String(forecast);
      article.dataset.still = String(reduced());
      article.dataset.active = String(i === 0);
      const face = (data, cls) => {
        const el = node("div", `fx-turn-face ${cls}`);
        // 사건 카드에만 사건 기호를 붙인다(결산 카드는 id가 없어 제목만).
        const heading = node("h3", ""), eventId = data.id || card.id;
        if (eventId) {
          const icon = node("span", "bd-event-icon", eventIcon(eventId)); icon.setAttribute("aria-hidden", "true");
          heading.append(icon, node("span", "", data.title));
        } else heading.textContent = data.title;
        el.append(node("span", "fx-turn-tag", data.tag), heading,
          node("p", "", data.body), node("strong", "fx-turn-big", data.big));
        return el;
      };
      if (!forecast && card.forecast) {
        article.classList.add("fx-turn-flip");
        const rotor = node("div", "fx-turn-rotor");
        const front = face(card.forecast, "fx-turn-front"), back = face(card, "fx-turn-back");
        front.hidden = reduced(); back.hidden = false;
        front.setAttribute("aria-hidden", "true");
        // 확정 면을 DOM 앞에 둔다: 화면 낭독·문서 순서로는 확정 내용이 먼저 읽히고, 뒤집힌 예보 면은 aria-hidden.
        rotor.append(back, front); article.append(rotor);
      } else article.append(face(card, ""));
      if (Object.hasOwn(EVENT_MOOD, card.id) && EVENT_MOOD[card.id] === status.mood)
        article.append(node("small", "fx-turn-mood-note", moodNote));
      const nav = node("div", "fx-turn-card-nav");
      const prev = node("button", "", "이전"), next = node("button", "", "다음");
      prev.type = next.type = "button"; prev.disabled = i === 0; next.disabled = i === cards.length - 1;
      const select = n => articles.forEach((a, k) => { a.dataset.active = String(k === n); if (k === n) revealCard(a); });
      prev.addEventListener("click", () => select(i - 1)); next.addEventListener("click", () => select(i + 1));
      nav.append(prev, node("span", "", `${i + 1} / ${cards.length}`), next);
      if (forecast) article.addEventListener("click", e => { if (!nav.contains(e.target)) closeCards(true); });
      article.append(nav); row.append(article); return article;
    });
    layer.append(deck); status.cardsOpen = true; status.forecastOpen = forecast;
    layer.dataset.paged = String(cards.length > 3);
    syncCardSounds = () => articles.forEach(revealCard);
    let announced = false;
    deferredNotice = () => {
      const live = root.querySelector("#bd-live");
      if (announced || !live) return;
      announced = true;
      const prefix = summary != null && !summaryAnnounced ? `${summary}. ` : "";
      live.textContent = `${prefix}사건 카드 ${events.length}장 — 서랍을 접으면 보여요`;
      if (prefix) summaryAnnounced = true;
    };
    // 삽입으로 바뀐 영역을 같은 틱에 확정한 뒤 카드를 공개한다.
    place(root);
    if (!deck?.isConnected) return;
    articles.forEach((article, i) => {
      const reveal = () => {
        if (!deck) return;
        ready.add(article); revealCard(article);
      };
      if (reduced()) reveal(); else later(80 + i * 260, reveal);
    });
    // 자동 닫힘: 카드를 넘기거나 누르는 동안에는 다시 센다. 좁은 화면에서 서랍 접힘·펼침(UX U10, 최대 6초)과
    // 겹쳐 읽는 도중에 닫히는 일을 막는다. 덧층이 걷히면(clear) 타이머도 함께 무시된다(epoch).
    const owner = deck;
    let closeAt = 0;
    const arm = () => {
      if (status.deferred) { closeAt = 0; return; }
      if (summaryLive && !summaryAnnounced) later(0, announceSummary);
      const wait = status.strip ? 10000 : forecast ? 8000 : 10000;
      const at = closeAt = performance.now() + wait;
      later(wait, () => { if (deck === owner && closeAt === at) closeCards(); });
    };
    armCards = arm;
    deck.addEventListener("pointerdown", arm);
    deck.addEventListener("keydown", arm);
    arm();
  }
  const monthKey = opts => {
    const session = KCP.league?.state?.(), V = opts.view || session?.snap || session?.S;
    return JSON.stringify([opts.round, opts.team, V?.room ?? session?.room ?? null]);
  };
  function mountLayer(root, key, phase) {
    activeMonth = key; activePhase = phaseOf(phase);
    layer = node("div", "fx-turn-layer"); root.querySelector(".bd-stage").append(layer); place(root);
    expandFocus = document.activeElement;
    listen(document, "focusin", e => { if (!deck?.contains(e.target) && e.target !== document.body) expandFocus = e.target; });
    listen(window, "resize", () => schedulePlace(root));
    if (window.visualViewport) listen(window.visualViewport, "resize", () => schedulePlace(root));
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => schedulePlace(root));
      // 운영 띠(#bd-run)는 관찰하지 않는다: 띠 크기는 layout()이 서랍 관찰(panelObserver) 고리 안에서 동기로 쓸 수 있어
      // 같은 깊이의 관찰 대상이 되면 WebKit 'ResizeObserver loop'가 난다. 띠 표시·펼침은 아래 MutationObserver(hidden)가 잡는다.
      [root, ...root.querySelectorAll("#lg-panel, #bd-drawer, .lg-bar, #bd-hud, #bd-mapbar, #bd-dock, .lg-map-guidance, .lg-map-keys, #lg-issue-check")].forEach(el => ro.observe(el));
      off.push(() => ro.disconnect());
    }
    if (window.MutationObserver) {
      const mo = new MutationObserver(() => { if (keepCurrentCards()) schedulePlace(root); });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      // 새 문제 칩·서랍과 접힘·펼침도 다시 배치한다. style 쓰기는 관찰하지 않는다.
      mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class", "data-folded"] });
      off.push(() => mo.disconnect());
    }
  }
  function monthStart(opts) {
    const root = document.querySelector(".lg-team-map"), session = KCP.league?.state?.();
    if (!root || root.hidden || root.classList.contains("lg-peek") || root.querySelector(".lg-awaybar")) return false;
    const cards = opts.cards || [], key = monthKey(opts);
    setMood(moodOf(cards), root);
    if (forecastMonths.has(key) || seenForecast(key) || (activeMonth === key && status.forecastOpen)) return false;
    clear(); setMood(moodOf(cards), root);
    if (!cards.length) return false;
    forecastMonth = key;
    forecastCards = new Map(cards.map(card => [card.id, { ...card }]));
    mountLayer(root, key, opts.view?.phase || session?.snap?.phase || session?.S?.phase || "plan");
    currentForecast = () => {
      const session = KCP.league?.state?.(), view = session?.snap || session?.S;
      return !session || (!session.away && session.team === opts.team && phaseOf(view?.phase) === activePhase &&
        monthKey({ round: view?.round, team: session.team, view }) === key);
    };
    forecastVisible = () => {
      if (forecastMonths.has(key) || !layer?.isConnected || layer.hidden !== false || status.deferred ||
          layer.dataset.chip === "true" || !deck) return;
      const target = status.strip ? stripBar : [...deck.querySelectorAll(".fx-turn-card")].find(article =>
        article.classList.contains("fx-revealed") &&
        (!(layer.dataset.compact === "true" || layer.dataset.paged === "true") || article.dataset.active === "true"));
      const rect = visibleRect(target);
      if (!rect || (rect.width ?? rect.right - rect.left) <= 0 || (rect.height ?? rect.bottom - rect.top) <= 0 ||
          rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) return;
      // 등장 직후 opacity 0인 프레임에서는 저장하지 않고, 다음 배치 프레임에 다시 확인한다.
      if (window.getComputedStyle?.(target).opacity === "0") { schedulePlace(root); return; }
      forecastMonths.add(key); markForecast(key);
    };
    showCards(cards, opts.sound, root, true);
    if (!status.forecastOpen) return false;
    // 어느 클릭도 막지 않고 카드만 닫는다. 이전·다음은 카드 안에서 처리한다.
    listen(document, "click", e => {
      // 결과 서랍의 접기·펼치기는 예보 카드를 닫지 않는다(결과 단계 drawerFold와 같은 예외).
      if (!status.deferred && !deck?.contains(e.target) && !insideStripDrawer(root, e.target) && !e.target.closest?.("#lg-panel-fold")) closeCards();
    }, true);
    // 리그 처리기(캡처 단계)가 서랍·코치·확인 상자를 닫으면 전파가 멈춰 예보까지 오지 않는다. 그래서 서랍에
    // 가려 보류된 예보는 Esc1에 서랍이 닫힌 뒤 보이고, Esc2에 닫힌다. 예보 처리는 버블 단계에서 하고, 다른
    // 처리기가 이미 쓴 Esc(지도 선택 팝업, 도구 묶음 등)면 남긴다. 닫을 때는 preventDefault로 뒤 처리기에 알린다.
    // 서랍 없이 보류된 예보를 보이기 전에 Esc로 닫으면 기록하지 않아 새로고침 뒤 다시 뜬다.
    listen(window, "keydown", e => topEscape(e, () => closeCards(true)), true);
    listen(document, "keydown", e => { if (escFree(e)) { e.preventDefault?.(); closeCards(true); } });
    return true;
  }
  function showSummary(opts, root) {
    if (!layer?.isConnected || !root.isConnected) return;
    toast = node("div", "fx-turn-summary");
    const visual = node("div", "fx-turn-summary-values"); visual.setAttribute("aria-hidden", "true");
    visual.append(node("span", "fx-turn-tag", `${opts.monthLabel} 운영`));
    const fields = (opts.summary || []).map(item => {
      const part = node("span", "fx-turn-stat"), value = node("b", "num");
      part.append(node("span", "", item.label), value, node("span", "", item.unit)); visual.append(part);
      return { item, value };
    });
    const live = node("span", "bd-sr"); live.setAttribute("aria-live", "polite"); live.setAttribute("aria-atomic", "true");
    toast.append(visual, live); layer.append(toast);
    place(root);
    for (const { el, direction } of opts.hud || []) {
      if (!el || !["up", "down"].includes(direction)) continue;
      const cls = `fx-flash-${direction}`; el.classList.add(cls);
      const remove = () => el.classList.remove(cls); off.push(remove); later(1000, remove);
    }
    const token = epoch;
    const final = () => {
      if (token !== epoch || !keepCurrentCards()) return;
      fields.forEach(({ item, value }) => { value.textContent = item.format(item.value); });
      if (!reduced() || !opts.cards?.length) live.textContent = summaryText(opts);
    };
    if (status.skipped === true || reduced()) final();
    else {
      const t0 = performance.now();
      const count = now => {
        if (token !== epoch || !keepCurrentCards()) return;
        const p = Math.min(1, (now - t0) / 400), eased = 1 - Math.pow(1 - p, 3);
        fields.forEach(({ item, value }) => { value.textContent = item.format(item.value * eased); });
        if (p < 1) raf = requestAnimationFrame(count); else { raf = 0; final(); }
      };
      raf = requestAnimationFrame(count);
    }
    // 타임아웃과 사용자 클릭은 같은 한 번의 전환을 쓴다.
    advanceSummary = () => {
      if (token !== epoch || !keepCurrentCards() || !toast) return;
      hideSummary();
      if (opts.cards?.length && currentMonth(opts)) showCards(opts.cards, opts.sound, root, false, reduced() ? summaryText(opts) : null);
    };
    if (reduced() && opts.cards?.length) advanceSummary();
    else later(6000, () => advanceSummary?.());
  }
  const summaryText = opts => `${opts.monthLabel} 운영: ${(opts.summary || []).map(s => `${s.label} ${s.format(s.value)}${s.unit}`).join(" · ")}`;
  function monthEnd(opts) {
    opts = { ...opts, cards: (opts.cards || []).map(card => ({ ...card,
      forecast: forecastMonth === monthKey(opts) && forecastCards.get(card.id) || card.forecast })) };
    const session = KCP.league?.state?.();
    const room = opts.view?.room ?? session?.room ?? null;
    const salt = opts.view?.salt ?? (session?.S ? session.S.salt ?? 0 : null);
    const sid = opts.view?.sid ?? session?.S?.created ?? null;
    // review → end는 같은 달이다. true로 반환해 호출부의 완료 소리도 막는다.
    if (lastMonth?.round === opts.round && lastMonth.room === room && lastMonth.salt === salt &&
        lastMonth.sid === sid && lastMonth.team === opts.team) return true;
    clear();
    const token = epoch, root = document.querySelector(".lg-team-map");
    // 준비부터 요약 숫자가 최종값이 될 때까지 3초 안(시각 기준표 V3·§4): 재생 뒤 숫자 굴림 400ms와 운영 계산·첫 프레임(헤드리스 1배 약 130ms)을 더한다.
    status = { playing: false, skipped: false, ms: reduced() ? 0 : opts.round === 1 ? 2200 : 2000,
      replayed: false, cardsOpen: false, source: null, fallback: null, recomputeMs: 0, forecastOpen: false, mood: null, strip: false, deferred: false };
    if (!root) return false;
    currentResult = () => currentMonth(opts);
    lastMonth = { round: opts.round, room, salt, sid, team: opts.team };
    setMood(moodOf(opts.cards.filter(card => card.id)), root);
    syncMapMood(root);
    mountLayer(root, monthKey(opts), opts.view?.phase || session?.snap?.phase || session?.S?.phase || "review");
    let pointerSkipped = false, pending = false, deferred = false;
    const skip = () => {
      if (pending) { pending = false; status.skipped = true; status.ms = 0; done(); }
      else if (status.playing) { status.skipped = true; KCP.buildGame.skipReplay(); }
    };
    // 운영 띠의 '그래프 열기/접기'와 펼친 영역은 재생을 끝내지 않는다(그래프를 보려고 누른 것).
    const stripControl = e => !!e.target.closest?.("#bd-run-toggle, #bd-run-detail");
    // 결과 서랍의 접기·펼치기는 서랍 크기만 바꾼다. 그 사이 띠↔카드 배치가 바뀌어도 사건 카드(예보 포함)를 닫지 않는다.
    const drawerFold = e => !!e.target.closest?.("#lg-panel-fold");
    listen(document, "pointerdown", e => {
      if (stripControl(e)) { pointerSkipped = false; return; }
      if (status.playing || pending) {
        pointerSkipped = true;
        // 지도에서 시작한 건너뛰기는 bindCanvas의 down을 만들지 않아 뒤 pointerup도 act로 가지 않는다.
        // 단추는 같은 click을 계속 받아야 하므로 지도 캔버스의 pointerdown만 소비한다.
        if (e.target === root.querySelector("#bd-canvas")) e.stopPropagation();
        skip(); return;
      }
      pointerSkipped = false;
      if (status.cardsOpen && !status.deferred && !deck?.contains(e.target) && !insideStripDrawer(root, e.target) && !drawerFold(e)) closeCards();
      if (toast) { pointerSkipped = true; advanceSummary?.(); }
    }, true);
    // 키보드로 발생한 클릭도 기존 동작을 유지하면서 재생을 끝낸다.
    listen(document, "click", e => {
      if (pointerSkipped) { pointerSkipped = false; return; }
      if (stripControl(e)) return;
      if ((status.playing || pending) && e.target.closest("button, a, [role=button]")) { skip(); return; }
      if (status.cardsOpen && !status.deferred && !deck?.contains(e.target) && !insideStripDrawer(root, e.target) && !drawerFold(e)) closeCards();
      if (toast && !e.target.closest("#bd-skip")) advanceSummary?.();
    }, true);
    // 보류 중에는 Esc로 화면 밖 덱을 닫지 않는다.
    // 예보와 같은 규칙: 다른 처리기가 쓴 Esc(결과 서랍 닫기 등)로는 카드 닫기를 함께 하지 않는다.
    // 재생이 도는 동안(대기 포함)은 지금 화면을 움직이는 재생 덧층이 맨 위 층이다(총괄 결정 10-21).
    // Esc1은 리그 처리기보다 먼저 받아 재생만 건너뛰고 서랍은 남긴다. Esc2부터는 아래 규칙대로.
    listen(window, "keydown", e => {
      if (escFree(e) && !coachUp() && (status.playing || pending)) { e.preventDefault(); e.stopPropagation(); skip(); return; }
      topEscape(e, () => { closeCards(true); hideSummary(); });
    }, true);
    listen(document, "keydown", e => {
      if (!escFree(e)) return;
      if (status.playing || pending) { e.preventDefault?.(); skip(); }
      else if (!status.deferred && (status.cardsOpen || toast)) { e.preventDefault?.(); closeCards(true); hideSummary(); }
    });
    let finished = false;
    const done = info => {
      if (token !== epoch || !keepCurrentCards()) return;
      if (info?.cancelled || !root.isConnected) { clear(); return; }
      if (finished) return;
      finished = true;
      const wasPlaying = status.playing;
      status.playing = false;
      if (wasPlaying || status.replayed) emitReplay("end", opts);
      if (status.replayed || deferred) opts.sound?.(opts.result?.team?.[opts.team]?.unsPct > 0 ? "outage" : "done");
      showSummary(opts, root);
    };
    const start = replay => {
      status.source = replay.source || "engine";
      status.playing = true; status.replayed = true;
      const started = KCP.buildGame?.replayMonth(replay.res, { ms: status.ms, label: `${opts.monthLabel} 실제 운영 · 재생`,
        del: replay.del, r: replay.r, outHour: replay.outHour, onDone: done,
        note: [replay.source === "device" ? "이 기기에서 다시 계산한 재생 · 합계는 실제 결과와 같음" : "", status.mood ? moodNote : ""].filter(Boolean).join(" · "),
        onDay: () => { if (token === epoch) opts.sound?.("tick"); }, onOutage: () => { if (token === epoch) opts.sound?.("outage"); } });
      if (started) { place(root); replayOpts = opts; emitReplay("start", opts); return true; }
      status.playing = false; status.replayed = false;
      return false;
    };
    const replay = KCP.leagueCore?.replayOf(opts.round, opts.team, salt, room);
    if (status.ms > 0) {
      if (replay) { if (start(replay)) return true; }
      else {
        pending = deferred = true;
        // 결과 서랍 DOM은 이미 열렸다. 기기 안 재계산·보정은 다음 틱에만 한다.
        later(0, () => {
          if (!root.isConnected) { clear(); return; }
          if (!pending) return;
          pending = false;
          const session = KCP.league?.state?.(), view = session?.snap || session?.S;
          if (session && (session.team !== opts.team || !["review", "end"].includes(view?.phase) ||
              view?.results?.at(-1)?.round !== opts.round)) { status.ms = 0; return; }
          status.source = "device";
          const data = recomputeReplay(opts.view, opts.result, opts.team);
          if (data && start(data)) return;
          status.ms = 0; done();
        });
        return true;
      }
    }
    status.ms = 0;
    done();
    return false;
  }
  KCP.on?.("route:change", clear);
  KCP.fxTurn = { deckPresentation, DECK_COVER_MAX, DECK_NARROW_MIN, eventMood: EVENT_MOOD, eventIcon, monthStart, monthEnd, phase, syncMapMood, recomputeReplay, clearForMap, state: () => ({ ...status }) };
})();
