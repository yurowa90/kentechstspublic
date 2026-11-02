/* fxTurn 실제 모듈의 소리 콜백 검사. 브라우저 대신 최소 DOM·시계·재생 경계만 제공한다. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const source = fs.readFileSync(path.resolve(__dirname, "../../ui/fx-turn.js"), "utf8");

function setup(width, unsPct = 0, still = false) {
  const elements = [], timers = new Map(), sounds = [], frames = new Map(), listeners = {}, observers = [];
  let clock = 0, id = 0, replay;
  class Element {
    constructor(tag) {
      this.tagName = tag; this.className = ""; this.dataset = {}; this.children = []; this.listeners = {};
      this.style = { removeProperty(k) { delete this[k]; } };
      this.classList = { contains: name => this.className.split(" ").includes(name),
        add: name => { this.className += ` ${name}`; } };
      elements.push(this);
    }
    get isConnected() { return this === root || !!this.parent?.isConnected; }
    append(...nodes) { nodes.forEach(n => { n.parent = this; this.children.push(n); }); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); this.parent = null; }
    contains(n) { return n === this || this.children.some(c => c.contains(n)); }
    set textContent(value) { this.textWrites = (this.textWrites || 0) + 1; this.text = value; }
    get textContent() { return this.text; }
    setAttribute(name, value) { this[name] = value; }
    getBoundingClientRect() { return this.rect || { left: 0, top: 0, right: width, bottom: 800 }; }
    getClientRects() { return this.isConnected ? [this.getBoundingClientRect()] : []; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
      const selectors = selector.split(",").map(s => s.trim());
      return elements.filter(n => n !== this && this.contains(n) && selectors.some(s =>
        s.startsWith(".") ? n.classList.contains(s.slice(1)) : s.startsWith("#") ? n.id === s.slice(1) : n.tagName === s));
    }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    removeEventListener(name, fn) { this.listeners[name] = (this.listeners[name] || []).filter(f => f !== fn); }
    click() { (this.listeners.click || []).forEach(fn => fn({ target: this })); }
  }
  const root = new Element("main"); root.id = "bd-root"; root.className = "lg-team-map";
  const stage = new Element("div"); stage.className = "bd-stage"; root.append(stage);
  const document = { documentElement: new Element("html"), createElement: tag => new Element(tag),
    querySelector: selector => selector === ".lg-team-map" ? root : root.querySelector(selector),
    getElementById: id => document.querySelector(`#${id}`), // rev18: 기존 조회를 재사용하며 코치가 없으면 null.
    addEventListener(name, fn) { (listeners[`doc:${name}`] ||= []).push(fn); },
    removeEventListener(name, fn) { listeners[`doc:${name}`] = (listeners[`doc:${name}`] || []).filter(f => f !== fn); } };
  const KCP = { v2: { reduced: () => still }, leagueCore: { replayOf: () => ({ res: {}, source: "engine" }) },
    buildGame: { skipReplay() {}, replayMonth(res, options) { replay = options; return true; } } };
  const window = { KCP, innerWidth: width, innerHeight: 800,
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
    removeEventListener(name, fn) { listeners[name] = (listeners[name] || []).filter(f => f !== fn); } };
  class Observer {
    constructor(fn) { this.fn = fn; this.active = false; observers.push(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
  }
  window.ResizeObserver = window.MutationObserver = Observer;
  vm.runInNewContext(source, { window, document, performance: { now: () => clock },
    ResizeObserver: Observer, MutationObserver: Observer,
    requestAnimationFrame(fn) { const key = ++id; frames.set(key, fn); return key; }, cancelAnimationFrame(key) { frames.delete(key); },
    setTimeout(fn, ms) { const key = ++id; timers.set(key, { at: clock + ms, fn }); return key; },
    clearTimeout(key) { timers.delete(key); } });
  const options = { round: 1, team: "fake-city", monthLabel: "1월", result: { team: { "fake-city": { unsPct } } },
    cards: [1, 2, 3].map(n => ({ tag: "사건", title: `가상 카드 ${n}`, body: "가상 사건", big: "확정" })),
    summary: [], hud: [], sound: kind => sounds.push(kind) };
  function advance(ms) {
    const end = clock + ms;
    while (true) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); clock = next[1].at; next[1].fn();
    }
    clock = end;
  }
  function resize(nextWidth) {
    width = nextWidth; window.innerWidth = width;
    (listeners.resize || []).forEach(fn => fn());
    const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(clock));
  }
  return { fx: KCP.fxTurn, options, sounds, elements, root, KCP, advance, resize, replay: () => replay,
    resources: () => ({ observers: observers.filter(o => o.active).length,
      listeners: Object.values(listeners).reduce((n, list) => n + list.length, 0), timers: timers.size, frames: frames.size }),
    dispatch: (name, event) => (listeners[`doc:${name}`] || []).forEach(fn => fn(event)) };
}

test("재생 뒤 정전 달 결과는 outage, 정전 없는 결과는 done을 한 번 보낸다", () => {
  for (const [unsPct, expected] of [[0, "done"], [2, "outage"]]) {
    const e = setup(1024, unsPct);
    assert.equal(e.fx.monthEnd(e.options), true);
    e.replay().onDone(); e.replay().onDone();
    assert.deepEqual(e.sounds, [expected]);
  }
});

test("좁은 화면의 숨은 카드는 소리를 내지 않고 처음 선택되어 보일 때만 한 번 낸다", () => {
  const e = setup(390);
  e.fx.monthEnd(e.options); e.replay().onDone(); e.advance(6700);
  assert.equal(e.sounds.filter(k => k === "card").length, 1);
  const articles = e.elements.filter(n => n.classList.contains("fx-turn-card"));
  articles[0].querySelectorAll("button")[1].click();
  assert.equal(e.sounds.filter(k => k === "card").length, 2);
  articles[1].querySelectorAll("button")[0].click();
  articles[0].querySelectorAll("button")[1].click();
  assert.equal(e.sounds.filter(k => k === "card").length, 2, "이미 펼친 카드 재선택은 무음");
  articles[1].querySelectorAll("button")[1].click();
  assert.equal(e.sounds.filter(k => k === "card").length, 3);
});

test("넓은 화면에서는 각 카드가 펼쳐질 때 한 번씩 소리를 보낸다", () => {
  const e = setup(1024);
  e.fx.monthEnd(e.options); e.replay().onDone(); e.advance(6000);
  assert.equal(e.sounds.filter(k => k === "card").length, 0);
  e.advance(100); assert.equal(e.sounds.filter(k => k === "card").length, 1);
  e.advance(260); assert.equal(e.sounds.filter(k => k === "card").length, 2);
  e.advance(260); assert.equal(e.sounds.filter(k => k === "card").length, 3);
});

test("화면을 넓혀 처음 보이는 카드도 한 번 소리를 보내고 다시 크기를 바꿔도 반복하지 않는다", () => {
  const e = setup(390);
  e.fx.monthEnd(e.options); e.replay().onDone(); e.advance(6700);
  assert.equal(e.sounds.filter(k => k === "card").length, 1);
  e.resize(1024); assert.equal(e.sounds.filter(k => k === "card").length, 3);
  e.resize(390); e.resize(1024); assert.equal(e.sounds.filter(k => k === "card").length, 3);
});


// 중복 방지 누락, 잘못된 사건 분위기, reduced 지연·앞면 노출을 잡는다.
const forecast = id => ({ id, tag: "사건 예보", title: "가상 사건", body: "사건 자료 문장", big: "기존 예보 문장" });
test("계획 예보는 즉시 열고 클릭·Esc·8초로 닫으며 같은 방·월 재마운트로 반복하지 않는다", () => {
  const e = setup(390), options = { ...e.options, view: { room: "FAKE-A", sid: "fake" }, cards: [forecast("coldwave_heating")] };
  assert.equal(typeof e.fx.monthStart, "function");
  assert.equal(e.fx.monthStart(options), true);
  assert.equal(e.fx.state().forecastOpen, true);
  e.advance(100);
  e.elements.find(n => n.classList.contains("fx-turn-card")).click();
  assert.equal(e.fx.state().forecastOpen, false);
  e.fx.clearForMap(e.root);
  assert.equal(e.fx.monthStart(options), false);
  assert.equal(e.fx.state().forecastOpen, false);
  assert.equal(e.fx.monthStart({ ...options, view: { room: "FAKE-A", sid: "refreshed", salt: 9 } }), false);
  e.fx.monthStart({ ...options, round: 2 });
  e.dispatch("keydown", { key: "Escape" });
  assert.equal(e.fx.state().forecastOpen, false);
  e.fx.monthStart({ ...options, round: 3 });
  e.advance(7999); assert.equal(e.fx.state().forecastOpen, true);
  e.advance(1); assert.equal(e.fx.state().forecastOpen, false);
  assert.equal(e.fx.monthStart({ ...options, view: { room: "FAKE-B" } }), true);
  e.dispatch("click", { target: e.root });
  assert.equal(e.fx.state().forecastOpen, false, "지도 클릭도 조작을 막지 않고 닫는다");
});

test("사건 id에 맞는 분위기를 지도에 보내고 사건 없는 달에는 끈다", () => {
  const e = setup(1024);
  let shown;
  e.KCP.buildGame.setMapMood = mood => { shown = mood; };
  const cases = [["heatwave_peak", "heat"], ["evening_peak_tropical_night", "heat"], ["coldwave_heating", "cold"],
    ["heavy_snow_solar", "snow"], ["typhoon_coast", "storm"], ["monsoon_cloud", "cloud"], ["heavy_rain", "rain"],
    ["spring_dust_haze", "haze"], ["finedust_coal_cap", "haze"], ["unknown", null]];
  cases.forEach(([id, mood], i) => {
    e.fx.monthStart({ ...e.options, round: i + 1, cards: [forecast(id)] });
    assert.equal(e.fx.state().mood, mood, id); assert.equal(shown, mood, id);
  });
  e.fx.monthStart({ ...e.options, round: 20, cards: [] });
  assert.equal(e.fx.state().mood, null); assert.equal(e.fx.state().forecastOpen, false);
});

test("reduced는 예보를 지연 없이 보이고 결과 카드의 확정 면을 즉시 노출한다", () => {
  const e = setup(390, 0, true), card = forecast("typhoon_coast");
  e.fx.monthStart({ ...e.options, cards: [card] });
  let article = e.elements.find(n => n.isConnected && n.classList.contains("fx-turn-card"));
  assert.ok(article.classList.contains("fx-revealed"));
  e.fx.monthEnd({ ...e.options, cards: [{ ...card, tag: "사건", body: "기존 확정 문장", forecast: card }] });
  assert.equal(e.fx.state().playing, false); assert.equal(e.fx.state().ms, 0);
  article = e.elements.find(n => n.isConnected && n.classList.contains("fx-turn-card"));
  assert.ok(article, "reduced는 요약 대기 없이 확정 카드를 즉시 보인다");
  assert.ok(article.classList.contains("fx-revealed"));
  assert.equal(article.querySelector(".fx-turn-front").hidden, true);
  assert.equal(article.querySelector(".fx-turn-back").hidden, false);
  assert.equal(article.querySelector(".fx-turn-back").querySelector("p").textContent, "기존 확정 문장");
});

test("문제 칩·서랍이 차지하는 사각형을 카드 배치에서 제외한다", () => {
  const e = setup(390);
  const chip = new e.root.constructor("aside"); chip.id = "lg-issue-check";
  chip.rect = { left: 8, right: 382, top: 8, bottom: 200 }; e.root.append(chip);
  e.fx.monthStart({ ...e.options, cards: [forecast("coldwave_heating")] });
  const layer = e.elements.find(n => n.isConnected && n.classList.contains("fx-turn-layer"));
  assert.ok(parseFloat(layer.style.top) >= 208);
  assert.ok(parseFloat(layer.style.width) <= 374);
});


test("지도 재연결은 내 도시 사건만 적용하고 관전·다른 도시·숨긴 지도에서는 끈다", () => {
  const e = setup(1024);
  const view = { phase: "plan", round: 2, region: "fake", events: [
    { id: "heatwave_peak", round: 1 }, { id: "typhoon_coast", round: 2 }, { id: "coldwave_heating", round: 2 }] };
  const session = { team: "fake-city", snap: view };
  e.KCP.league = { state: () => session };
  Object.assign(e.KCP.leagueCore, { regionOf: () => ({}), eventDef: (_, id) => ({ id }), hits: (_, event) => event.id !== "typhoon_coast" });
  let mood;
  e.KCP.buildGame.setMapMood = value => { mood = value; };
  assert.equal(typeof e.fx.syncMapMood, "function");
  e.fx.syncMapMood(e.root); assert.equal(mood, "cold");
  e.root.className += " lg-peek";
  e.fx.syncMapMood(e.root); assert.equal(mood, null);
  e.root.className = "lg-team-map";
  const bar = new e.root.constructor("aside"); bar.className = "lg-awaybar"; e.root.append(bar);
  e.fx.syncMapMood(e.root); assert.equal(mood, null);
  bar.remove(); e.fx.syncMapMood(e.root); assert.equal(mood, "cold");
  e.root.hidden = true; e.fx.syncMapMood(e.root); assert.equal(mood, null);
  e.root.hidden = false;
  view.phase = "review"; view.results = [{ round: 2, events: ["coldwave_heating"] }];
  e.fx.syncMapMood(e.root); assert.equal(mood, "cold");
  view.phase = "plan"; view.round = 3;
  e.fx.syncMapMood(e.root); assert.equal(mood, null);
});


test("결과는 계획 때 본 동일 사건의 예보 면을 보존하고 처음 보이는 카드만 뒤집는다", () => {
  const e = setup(390), front = forecast("coldwave_heating");
  e.fx.monthStart({ ...e.options, cards: [front] });
  e.fx.monthEnd({ ...e.options, cards: [{ ...front, tag: "사건", body: "확정 문장", forecast: { ...front, big: "다른 예보" } },
    { ...forecast("heatwave_peak"), tag: "사건", body: "두 번째 확정", forecast: forecast("heatwave_peak") }] });
  e.replay().onDone(); e.advance(6100);
  const articles = e.elements.filter(n => n.isConnected && n.classList.contains("fx-turn-card"));
  assert.equal(articles[0].querySelector(".fx-turn-front").querySelector("strong").textContent, "기존 예보 문장");
  assert.equal(articles[0].querySelector(".fx-turn-back").querySelector("p").textContent, "확정 문장");
  e.advance(600);
  assert.ok(articles[0].classList.contains("fx-revealed"));
  assert.equal(articles[1].classList.contains("fx-revealed"), false, "숨은 면의 뒤집힘을 미리 끝내지 않는다");
  articles[0].querySelectorAll("button")[1].click();
  assert.ok(articles[1].classList.contains("fx-revealed"));
});

test("사건 없는 다음 계획은 이전 결과 카드를 닫고 분위기도 끈다", () => {
  const e = setup(390), view = { room: "FAKE", region: "fake", round: 1, phase: "review", results: [{ round: 1 }], events: [] };
  e.KCP.league = { state: () => ({ team: e.options.team, snap: view }) };
  Object.assign(e.KCP.leagueCore, { regionOf: () => ({}), eventDef: () => null, hits: () => false });
  e.fx.monthEnd({ ...e.options, view }); e.replay().onDone(); e.advance(6700);
  assert.equal(e.fx.state().cardsOpen, true);
  view.phase = "plan"; view.round = 2;
  e.fx.syncMapMood(e.root);
  assert.equal(e.fx.state().cardsOpen, false);
  assert.equal(e.fx.state().mood, null);
});

test("진행자 sid 갱신은 진행 중 재생과 열린 결과 카드를 취소하지 않는다", () => {
  const e = setup(390), view = { room: "FAKE", sid: "before", region: "fake", round: 1,
    phase: "review", events: [], results: [{ round: 1 }] };
  const events = [];
  e.KCP.emit = (name, data) => events.push(data);
  e.KCP.league = { state: () => ({ team: e.options.team, snap: view }) };
  e.KCP.leagueCore.regionOf = () => ({});
  e.fx.monthEnd({ ...e.options, view });
  view.sid = "after"; view.salt = 123;
  e.fx.syncMapMood(e.root);
  assert.equal(e.fx.state().playing, true);
  assert.equal(events.some(event => event.cancelled), false);
  e.replay().onDone(); e.advance(6700);
  view.sid = "after-again";
  e.fx.syncMapMood(e.root);
  assert.equal(e.fx.state().cardsOpen, true);
});

test("결과 카드 본문은 유지하고 닫기·밖 클릭·Esc·자동 닫힘만 묶음을 닫는다", () => {
  for (const method of ["close", "outside", "escape", "timeout"]) {
    const e = setup(390, 0, true);
    e.fx.monthEnd(e.options);
    const card = e.root.querySelector(".fx-turn-card");
    card.click();
    assert.equal(e.fx.state().cardsOpen, true, "결과 본문 클릭은 닫지 않는다");
    if (method === "close") e.root.querySelector(".fx-turn-close").click();
    if (method === "outside") e.dispatch("pointerdown", { target: e.root });
    if (method === "escape") e.dispatch("keydown", { key: "Escape" });
    if (method === "timeout") e.advance(10000);
    assert.equal(e.fx.state().cardsOpen, false, method);
  }
});

test("예보를 닫으면 분위기만 유지하고 덧층·관찰자·리스너·예약을 해제한다", () => {
  for (const method of ["body", "close", "outside", "escape", "timeout"]) {
    const e = setup(390);
    let mood;
    e.KCP.buildGame.setMapMood = value => { mood = value; };
    e.fx.monthStart({ ...e.options, cards: [forecast("coldwave_heating")] });
    assert.equal(e.resources().observers, 2);
    if (method === "body") e.root.querySelector(".fx-turn-card").click();
    if (method === "close") e.root.querySelector(".fx-turn-close").click();
    if (method === "outside") e.dispatch("click", { target: e.root });
    if (method === "escape") e.dispatch("keydown", { key: "Escape" });
    if (method === "timeout") e.advance(8000);
    assert.equal(e.root.querySelector(".fx-turn-layer"), null, method);
    assert.deepEqual(e.resources(), { observers: 0, listeners: 0, timers: 0, frames: 0 }, method);
    assert.equal(mood, "cold"); assert.equal(e.fx.state().mood, "cold");
    e.fx.clearForMap(e.root); assert.equal(mood, null);
  }
});

test("움직임 줄이기는 결과 묶음에 월 요약을 한 번 남겨 읽힌다", () => {
  const e = setup(390, 0, true);
  e.fx.monthEnd({ ...e.options, summary: [{ label: "정전", value: 2, unit: "%", format: String }] });
  e.advance(0);
  const lives = e.elements.filter(n => n.isConnected && n["aria-live"] === "polite");
  assert.equal(lives.length, 1);
  assert.ok(e.root.querySelector(".fx-turn-cards").contains(lives[0]));
  assert.equal(lives[0].textContent, "1월 운영: 정전 2%");
  e.resize(1024); e.advance(600);
  assert.equal(lives[0].textContent, "1월 운영: 정전 2%");
  e.root.querySelector(".fx-turn-card").querySelectorAll("button")[1].click();
  assert.equal(lives[0].textWrites, 1, "카드 탐색과 재배치로 같은 요약을 반복 낭독하지 않는다");
  assert.equal(e.root.querySelector(".fx-turn-summary"), null);
});

test("분위기 설명은 현재 표시 중인 분위기와 같은 사건 카드에만 붙인다", () => {
  const e = setup(1024, 0, true);
  e.fx.monthStart({ ...e.options, cards: [forecast("coldwave_heating"), forecast("heatwave_peak"), forecast("unknown")] });
  const cards = e.root.querySelectorAll(".fx-turn-card");
  assert.ok(cards[0].querySelector(".fx-turn-mood-note"));
  assert.equal(cards[1].querySelector(".fx-turn-mood-note"), null);
  assert.equal(cards[2].querySelector(".fx-turn-mood-note"), null);
});

test("같은 달의 계획에서 운영으로 바뀌어도 예보 덧층을 해제한다", () => {
  const e = setup(390), view = { room: "FAKE", region: "fake", round: 1, phase: "plan", events: [] };
  e.KCP.league = { state: () => ({ team: e.options.team, snap: view }) };
  e.KCP.leagueCore.regionOf = () => ({});
  e.fx.monthStart({ ...e.options, view, cards: [forecast("coldwave_heating")] });
  view.phase = "run";
  e.fx.syncMapMood(e.root);
  assert.equal(e.fx.state().forecastOpen, false);
});

test("review에서 end로 바뀐 같은 결과는 W1처럼 카드와 한 번의 재생을 유지한다", () => {
  const e = setup(390), view = { room: "FAKE", sid: "same", region: "fake", round: 2,
    phase: "review", events: [], results: [{ round: 1 }] };
  e.KCP.league = { state: () => ({ team: e.options.team, snap: view }) };
  e.KCP.leagueCore.regionOf = () => ({});
  e.fx.monthEnd({ ...e.options, view });
  const replay = e.replay(); replay.onDone(); e.advance(6700);
  view.phase = "end";
  e.fx.syncMapMood(e.root);
  assert.equal(e.fx.monthEnd({ ...e.options, view }), true);
  assert.equal(e.replay(), replay);
  assert.equal(e.fx.state().cardsOpen, true);
  assert.equal(e.sounds.filter(kind => kind === "done").length, 1);
});
