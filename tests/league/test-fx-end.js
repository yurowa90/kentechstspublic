/* 끝 화면의 공개 이력·월 환산·누락값·접근성을 브라우저 없이 검사한다. */
"use strict";
// 검사 환경(rev11): Node v24.21에서 이 파일만 간헐 exit 139(세그폴트, 출력 0줄)가 났다. 13번째 검사가 vm 맥락을
// 13번째로 만드는 순간 죽었고(동기 표지로 확인), 기본 15회 중 6회 재현 → --no-maglev 0/15, --no-concurrent-marking 0/15,
// --jitless 0/5. 검사 코드가 아니라 V8 Maglev 컴파일과 동시 표시 GC가 겹친 실행기 결함으로 보인다(추정, V8 내부는 미확인).
// 단언은 그대로 두고 이 파일 안에서만 Maglev를 끈다. 실패를 숨기지 않도록 다른 V8 플래그·재시도는 쓰지 않는다.
require("node:v8").setFlagsFromString("--no-maglev");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}
function setup(frames = [], osReduced = false, sessionStorage = memoryStorage()) {
  const KCP = { route() {}, on() {}, esc: x => String(x).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;"),
    leagueNet: {}, leagueCore: { roundsOf: V => V.rounds, regionOf: () => ({ teams: [] }), teamDef: (_, id) => ({ color: { a: "#d86fa8", b: "#e0a030", c: "#5fae6e" }[id] }) }, buildGame: {} };
  const window = { KCP, sessionStorage, addEventListener() {}, requestAnimationFrame: fn => frames.push(fn),
    // 등장이 끝난 뒤 '이미 연출함'을 적는 타이머(fx-end mount). 검사에서는 settle()로 직접 돌린다.
    setTimeout: fn => (frames.timers ||= []).push(fn), matchMedia: () => ({ matches: osReduced }) };
  const context = vm.createContext({ window, document: { documentElement: {}, addEventListener() {} } });
  for (const file of ["build-maps.js", "build.js", "econ-data.js", "fx-turn.js", "league.js"]) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../../ui", file), "utf8"), context);
  }
  const file = path.resolve(__dirname, "../../ui/fx-end.js");
  if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, "utf8"), context);
  assert.equal(typeof KCP.fxEnd?.html, "function", "끝 화면 HTML API가 있어야 한다");
  return KCP;
}
function fixture(n = 3) {
  const rounds = Array.from({ length: n }, (_, i) => ({ year: 2026 + Math.floor(i / 12), month: i % 12 + 1, mdays: 28 }));
  const hist = (appr, pop) => Array.from({ length: n }, (_, t) => ({ t, appr: appr + t, pop: pop + t * 100 }));
  return { room: "TESTROOM", phase: "end", round: n, region: "south", rounds, active: ["a", "b", "c"], teams: { a: {}, b: {}, c: {}, inactive: {} },
    econ: { cities: { a: { name: "내 도시", pop0: 1000, hist: hist(40, 1000) }, b: { name: "이웃 하나", pop0: 2000, hist: hist(60, 2000) },
      c: { name: "이웃 둘", pop0: 4000, hist: hist(80, 4000) }, inactive: { hist: hist(100, 999999) } } },
    events: [{ id: "coldwave_heating", round: 1 }, { id: "other", round: 2 }],
    results: Array.from({ length: n }, (_, i) => ({ round: i + 1, days: 7, team: {
      a: { unsPct: i ? 0 : 77.7, co2Prod: 10 + i, outH: i ? 0 : 2 },
      b: { unsPct: 10, co2Prod: 20, outH: 1 }, c: { unsPct: 14, co2Prod: 40, outH: 1 },
      inactive: { unsPct: 100, co2Prod: 999999, outH: 7 } } })) };
}
const graph = (html, key) => html.match(new RegExp(`<article[^>]*data-fx-metric="${key}"[\\s\\S]*?</article>`))[0];
test("5개 그래프에 첫·마지막 값과 활성 이웃 평균, 하루 평균 단위가 나온다", () => {
  const K = setup(), V = fixture(), before = JSON.stringify(V), html = K.fxEnd.html(V, "a");
  assert.equal((html.match(/role="img"/g) || []).length, 5);
  assert.match(html, /aria-label="지표 그래프 5개 ·/);
  assert.match(graph(html, "uns"), /aria-label="정전, 2026년 1월 77.7% → 2026년 3월 0%, 이웃 평균 12%/);
  assert.match(graph(html, "appr"), /1월 40% → 2026년 3월 42%, 이웃 평균 72%/);
  assert.match(graph(html, "pop"), /주민 · 시작 대비 변화, 2026년 1월 0% → 2026년 3월 \+20%, 이웃 평균 \+7.5%/);
  // 대표 7일: 내 도시 10/7 → 12/7, 이웃 (20+40)/2/7 t/일(소수 1자리).
  assert.match(graph(html, "co2"), /1월 1.4 t\/일 → 2026년 3월 1.7 t\/일, 이웃 평균 4.3 t\/일/);
  assert.match(html, /모형 계산 · 게임 가정/);
  assert.doesNotMatch(html, />\s*[OPMG](?:\*|\s)*<|\([OPMG]\)/);
  assert.equal(JSON.stringify(V), before, "화면 생성은 공개 상태를 변경하지 않는다");
});
test("빈 달은 보간하지 않고 내 도시·이웃 선을 끊으며 0은 보존한다", () => {
  const K = setup(), V = fixture();
  delete V.results[1].team.a.unsPct;
  delete V.results[1].team.b.co2Prod; delete V.results[1].team.c.co2Prod;
  V.econ.cities.a.hist.splice(1, 1);
  const html = K.fxEnd.html(V, "a");
  for (const key of ["appr", "pop", "uns"]) {
    const d = graph(html, key).match(/data-fx-series="a"[^>]* d="([^"]*)"/)[1];
    assert.equal((d.match(/M/g) || []).length, 2, key + " 누락 달 양쪽은 별도 선분");
  }
  const d = graph(html, "co2").match(/data-fx-series="neighbors"[^>]* d="([^"]*)"/)[1];
  assert.equal((d.match(/M/g) || []).length, 2);
  assert.match(graph(html, "uns"), /3월 0%/);
  assert.match(html, /없는 달은 선을 끊/);
});
test("36달 띠는 달마다 비조작 칸 하나와 사건·정전 대안을 갖는다", () => {
  const K = setup(), html = K.fxEnd.html(fixture(36), "a");
  assert.equal((html.match(/data-fx-month="/g) || []).length, 36);
  assert.match(html, /한파/); assert.match(html, /일반 사건/); assert.match(html, /정전 있음/);
  assert.doesNotMatch(html, /<button|role="button"/);
  assert.match(html, /2028년 12월/);
});
test("heavy_rain 한 달은 ☂·집중호우로, monsoon_cloud는 ☁·구름으로 표시한다", () => {
  const K = setup();
  for (const [id, symbol, name] of [["heavy_rain", "☂", "집중호우"], ["monsoon_cloud", "☁", "구름"]]) {
    const V = fixture(1);
    V.events = [{ id, round: 1 }];
    const html = K.fxEnd.html(V, "a");
    assert.equal((html.match(/data-fx-month="/g) || []).length, 1, `${id}: 사건이 든 달 하나`);
    assert.ok(html.includes(symbol), `${id}: 기호 ${symbol}`);
    assert.ok(html.includes(name), `${id}: 이름 ${name}`);
  }
});
test("진행자 모드는 모든 활성 도시 궤적과 도시 이름을 제공한다", () => {
  const K = setup(), html = K.fxEnd.html(fixture(), null, { allCities: true });
  assert.equal((html.match(/data-fx-series="[abc]"/g) || []).length, 15);
  assert.doesNotMatch(html, /data-fx-series="inactive"/);
  assert.match(html, /이웃 하나/); assert.match(html, /이웃 둘/);
});
test("생략된 과거 CO₂와 이웃 결측은 0으로 바꾸거나 평균 분모에 넣지 않는다", () => {
  const K = setup(), V = fixture();
  delete V.results[0].team.a.co2Prod;
  V.results[2].team.b.unsPct = null;
  const html = K.fxEnd.html(V, "a");
  assert.match(graph(html, "co2"), /1월 자료 없음 → 2026년 3월 1.7 t\/일/); // 12/7
  assert.match(graph(html, "uns"), /이웃 평균 14%/);
});
const settle = frames => (frames.timers || []).splice(0).forEach(fn => fn());
function element() {
  const classes = new Set();
  return { isConnected: true, classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) } };
}
test("mount는 기존 막대 값·구조를 유지하며 한 번 등장하고 다시 mount해도 반복하지 않는다", () => {
  const frames = [], K = setup(frames), block = element(), meter = { ...element(), value: 72 };
  const root = { offsetWidth: 300, querySelectorAll: s => s === ".lg-fx-end" ? [block] : [meter] };
  K.fxEnd.mount(root);
  assert.equal(block.classList.contains("lg-fx-enter"), true);
  assert.equal(meter.classList.contains("lg-fx-rank-enter"), true);
  frames.shift()();
  assert.equal(block.classList.contains("lg-fx-enter"), false);
  assert.equal(meter.classList.contains("lg-fx-rank-enter"), false);
  assert.equal(meter.value, 72);
  settle(frames);
  K.fxEnd.mount(root); assert.equal(frames.length, 0);
});
test("앱과 OS의 움직임 줄이기는 프레임 대기 없이 최종 상태로 둔다", () => {
  for (const os of [false, true]) {
    const frames = [], K = setup(frames, os), block = element();
    if (!os) K.v2 = { reduced: () => true };
    K.fxEnd.mount({ querySelectorAll: () => [block], get offsetWidth() { assert.fail("레이아웃 대기 없음"); } });
    assert.equal(block.classList.contains("lg-fx-enter"), false);
    assert.equal(frames.length, 0);
  }
});

// publicView는 최근 두 달 이전의 co2Prod를 생략한다.
function publicFixture(full) {
  const V = JSON.parse(JSON.stringify(full));
  V.results.slice(0, -2).forEach(r => Object.values(r.team).forEach(t => delete t.co2Prod));
  return V;
}
test("압축된 공개 사본은 CO₂ 빈 달을 끊고 그래프 아래에 한계를 알린다", () => {
  const K = setup(), V = publicFixture(fixture(12)), before = JSON.stringify(V);
  const co2 = graph(K.fxEnd.html(V, "a"), "co2");
  assert.equal((co2.match(/<circle/g) || []).length, 4);
  assert.match(co2, /1월 자료 없음/);
  assert.match(co2, /공개 상태에는 최근 두 달의 CO₂만 있어 빈 달이 있어요/);
  assert.equal(JSON.stringify(V), before);
});
test("월별 수신값은 탭 저장으로 모든 도시 CO₂를 복원하며 방·도시와 환산 일수를 보존한다", () => {
  const storage = memoryStorage(), K = setup([], false, storage), full = fixture(12);
  const before = JSON.stringify(full);
  full.results.slice(0, -2).forEach(r => K.fxEnd.remember(full, r));
  assert.equal(JSON.stringify(full), before, "수신 결과나 리그 상태에 사본을 붙이지 않는다");
  const reloaded = setup([], false, storage), V = publicFixture(full), snapshot = JSON.stringify(V);
  const co2 = graph(reloaded.fxEnd.html(V, "a"), "co2");
  assert.equal((co2.match(/<circle/g) || []).length, 24, "다른 도시도 보충되어 이웃 평균이 이어진다");
  assert.match(co2, /1월 1.4 t\/일 → 2026년 12월 3 t\/일, 이웃 평균 4.3 t\/일/); // 10/7, 21/7, 30/7
  assert.doesNotMatch(co2, /공개 상태에는 최근 두 달/);
  assert.equal(JSON.stringify(V), snapshot);
  const all = graph(reloaded.fxEnd.html(V, null, { allCities: true }), "co2");
  assert.equal((all.match(/<circle/g) || []).length, 36);
  V.room = "OTHERROOM";
  assert.equal((graph(reloaded.fxEnd.html(V, "a"), "co2").match(/<circle/g) || []).length, 4);
  // 동일 방에서 다른 도시만 먼저 받았어도 내 도시 값을 대신 쓰면 안 된다.
  const partial = fixture(12); partial.room = "PARTIAL";
  partial.results.slice(0, -2).forEach(r => K.fxEnd.remember(partial, { round: r.round, days: 14, team: { b: r.team.b } }));
  const missing = graph(reloaded.fxEnd.html(publicFixture(partial), "a"), "co2");
  assert.match(missing, /1월 자료 없음/);
  assert.match(missing, /이웃 평균 4.3 t\/일/); // 마지막 달 공개 값 (20+40)/2/7
  assert.match(missing, /이웃 평균 2026년 1월 1.4 t\/일<\/title>/, "저장된 대표 14일의 20/14 t/일");
  assert.match(missing, /공개 상태에는 최근 두 달/);
});
test("CO₂ 저장 실패·깨진 사본은 화면을 막거나 빈 달을 0으로 만들지 않는다", () => {
  for (const storage of [
    { getItem() { throw Error("disabled"); }, setItem() { throw Error("disabled"); } },
    { getItem: () => "{broken", setItem() {} },
    { getItem: () => "[]", setItem() {} },
    { getItem: () => '{"1":{"co2Prod":null,"days":0}}', setItem() {} }
  ]) {
    const K = setup([], false, storage), V = publicFixture(fixture(12));
    assert.doesNotThrow(() => K.fxEnd.remember(V, V.results.at(-1)));
    assert.match(graph(K.fxEnd.html(V, "a"), "co2"), /1월 자료 없음/);
  }
});
test("새 DOM으로 서랍을 다시 만들어도 같은 방·도시·끝 라운드 연출을 반복하지 않는다", () => {
  const frames = [], K = setup(frames);
  const root = (V = fixture(), team = "a", opts = {}) => {
    const block = element(), html = K.fxEnd.html(V, team, opts);
    // 브라우저가 HTML 속성을 dataset으로 읽는 경계만 대신한다.
    block.dataset = { fxEndKey: html.match(/data-fx-end-key="([^"]*)"/)[1].replaceAll("&quot;", '"') };
    const meter = element();
    return { block, meter, offsetWidth: 300, querySelectorAll: s => s === ".lg-fx-end" ? [block] : [meter] };
  };
  K.fxEnd.mount(root()); frames.shift()(); settle(frames);
  const next = root(); K.fxEnd.mount(next);
  assert.equal(next.block.classList.contains("lg-fx-enter"), false);
  assert.equal(next.meter.classList.contains("lg-fx-rank-enter"), false);
  assert.equal(frames.length, 0);
  const otherRoom = fixture(); otherRoom.room = "OTHERROOM";
  for (const different of [root(otherRoom), root(fixture(), "b"), root(fixture(12)), root(fixture(), null, { allCities: true })]) {
    K.fxEnd.mount(different);
    assert.equal(different.block.classList.contains("lg-fx-enter"), true, "새 방·도시·끝 라운드·진행자는 처음 연출한다");
    frames.shift()(); settle(frames);
  }
  const hostAgain = root(fixture(), null, { allCities: true }); K.fxEnd.mount(hostAgain);
  assert.equal(hostAgain.block.classList.contains("lg-fx-enter"), true, "진행자는 기존 DOM 단위 연출을 유지한다");
});
test("진행자 도시 색은 팀 자료를 따르고 점선·수평선과 정전 범례를 구분한다", () => {
  const K = setup(), V = fixture(), html = K.fxEnd.html(V, null, { allCities: true });
  for (const [id, color] of [["a", "#d86fa8"], ["b", "#e0a030"], ["c", "#5fae6e"]]) {
    assert.match(html, new RegExp(`data-fx-series="${id}"[^>]*--fx-line:${color}`));
  }
  assert.doesNotMatch(html, /--fx-line:var\(--ui-danger\)/);
  assert.match(html, /stroke-dasharray="6 3"/);
  assert.match(html, /정전 표시/); assert.doesNotMatch(html, /빨간 점/);
  const month = html.match(/<li data-fx-month="1">[\s\S]*?<\/li>/)[0];
  assert.match(month, /<span aria-hidden="true">2026년 1월<\/span>/);
  V.events.push({ id: "heavy_snow_solar", round: 2 });
  const strip = K.fxEnd.html(V, "a");
  const cold = strip.match(/data-fx-month="1"[\s\S]*?class="lg-fx-icons"[^>]*>([^<]+)/)[1];
  const snow = strip.match(/data-fx-month="2"[\s\S]*?class="lg-fx-icons"[^>]*>([^<]+)/)[1];
  assert.notEqual(cold, snow);
});

test("탭 CO₂ 사본의 0은 보존하고 현재 공개값을 사본보다 우선한다", () => {
  const K = setup(), full = fixture(12);
  full.results[0].team.a.co2Prod = 0;
  full.results.forEach(r => K.fxEnd.remember(full, r));
  const V = publicFixture(full);
  V.results.at(-1).team.a.co2Prod = 100;
  const co2 = graph(K.fxEnd.html(V, "a"), "co2");
  assert.match(co2, /1월 0 t\/일 → 2026년 12월 14.3 t\/일/); // 공개값 100/7, 사본 21/7보다 우선
  assert.doesNotMatch(co2, /공개 상태에는 최근 두 달/);
});

function gridFixture() {
  const V = fixture();
  V.rounds = [31, 29, 31].map((mdays, i) => ({ year: 2028, month: i + 1, mdays }));
  V.results.forEach((r, i) => {
    r.days = [7, 14, 5][i];
    Object.assign(r.team.a, { isolated: { uns: 25 }, uns: 4, imp: 3, sub: 2 }); // 20 MWh
    Object.assign(r.team.b, { isolated: { uns: 39 }, uns: 3, imp: 5, sub: 4 }); // 35 MWh
    Object.assign(r.team.c, { isolated: { uns: 60 }, uns: 4, imp: 2, sub: 2 }); // 56 MWh
  });
  return V;
}
function omitGrid(r) {
  for (const key of ["isolated", "uns", "imp", "sub"]) delete r[key];
}
const pointTitles = article => [...article.matchAll(/<circle\b[^>]*><title>([^<]*)<\/title>/g)].map(m => m[1]);
function dailyPoints(article, name) {
  return pointTitles(article).filter(s => s.startsWith(name + " ")).map(s => {
    const match = s.match(/ ([\d.]+) MWh\/일$/);
    assert.ok(match, "계통 점의 하루 평균 단위");
    return Number(match[1]);
  });
}
const linePath = (article, id) => article.match(new RegExp(`data-fx-series="${id}"[^>]* d="([^"]*)"`))[1];
const oneDecimal = n => Number(n.toFixed(1));

test("공개 계통 결과는 구매·대체분을 반영하고 윤년 2월도 대표 기간의 하루 평균이다", () => {
  const K = setup(), V = gridFixture();
  V.results[2].team.a.isolated.uns = 1; // 1-4-3+2 < 0: 음수는 0
  const grid = graph(K.fxEnd.html(V, "a"), "grid");
  // 1월 20×(31/7)/31, 윤년 2월 20×(29/14)/29, 3월 max(0,-4)/5.
  assert.deepEqual(dailyPoints(grid, "내 도시"), [oneDecimal(20 / 7), oneDecimal(20 / 14), 0]);
  assert.deepEqual(dailyPoints(grid, "이웃 평균"), [7, 14, 5].map(days => oneDecimal((35 + 56) / 2 / days)));
  assert.match(grid, /2028년 2월 1.4 MWh\/일/);
  assert.doesNotMatch(grid, /data-fx-gap="grid"/);
});

test("팀 savedGrid는 월 환산 MWh를 윤년 일수로 나누고 내 도시만 보충한다", () => {
  const K = setup(), V = gridFixture(), savedGrid = { 1: { grid: 62 }, 2: { grid: 87 }, 3: { grid: 124 } };
  V.results.forEach(r => Object.values(r.team).forEach(omitGrid));
  // 이웃 하나만 2월 값을 공개한다. 1·3월 이웃은 내 기기의 값으로 채워지면 안 된다.
  Object.assign(V.results[1].team.b, { isolated: { uns: 28 }, uns: 0, imp: 0, sub: 0 });
  const grid = graph(K.fxEnd.html(V, "a", { savedGrid }), "grid");
  assert.deepEqual(dailyPoints(grid, "내 도시"), [62 / 31, 87 / 29, 124 / 31]);
  assert.deepEqual(dailyPoints(grid, "이웃 평균"), [28 / 14], "값 있는 이웃 하나만 평균 분모에 포함");
  assert.match(grid, /이웃 평균 2028년 2월 2 MWh\/일/);
  assert.equal((linePath(grid, "neighbors").match(/M/g) || []).length, 1);
  assert.match(grid, /data-fx-gap="grid"/);
  // 모든 이웃 값이 없으면 평균선 전체가 비어야 한다.
  omitGrid(V.results[1].team.b);
  const empty = graph(K.fxEnd.html(V, "a", { savedGrid }), "grid");
  assert.deepEqual(dailyPoints(empty, "이웃 평균"), []);
  assert.equal(linePath(empty, "neighbors"), "");
});

test("remember 계통 사본은 대표 기간 MWh·days로 복원하고 공개값·기기 기록을 우선한다", () => {
  const storage = memoryStorage(), K = setup([], false, storage), V = gridFixture();
  V.results.forEach(r => K.fxEnd.remember(V, r));
  V.results.forEach(r => {
    Object.values(r.team).forEach(omitGrid);
    r.days = 1; // 복원은 이 축약 사본의 days 대신 remember가 보관한 7·14·5일을 사용해야 한다.
  });
  const reloaded = setup([], false, storage);
  const all = graph(reloaded.fxEnd.html(V, null, { allCities: true }), "grid");
  assert.deepEqual(dailyPoints(all, "내 도시"), [7, 14, 5].map(days => oneDecimal(20 / days)));
  assert.deepEqual(dailyPoints(all, "이웃 하나"), [7, 14, 5].map(days => oneDecimal(35 / days)));
  assert.deepEqual(dailyPoints(all, "이웃 둘"), [7, 14, 5].map(days => oneDecimal(56 / days)));
  assert.doesNotMatch(all, /data-fx-gap="grid"/);
  const opts = { savedGrid: { 1: { grid: 93 }, 2: { grid: 116 } } };
  Object.assign(V.results[0].team.a, { isolated: { uns: 6 }, uns: 1, imp: 2, sub: 1 });
  const grid = graph(reloaded.fxEnd.html(V, "a", opts), "grid");
  assert.deepEqual(dailyPoints(grid, "내 도시"), [4, 116 / 29, oneDecimal(20 / 5)]);
  assert.deepEqual(dailyPoints(grid, "이웃 평균"), [7, 14, 5].map(days => oneDecimal((35 + 56) / 2 / days)));
  V.room = "OTHERROOM";
  assert.deepEqual(dailyPoints(graph(reloaded.fxEnd.html(V, "a"), "grid"), "내 도시"), [4], "다른 방의 계통 사본 제외");
});

test("계통 빈 달 안내는 그린 선의 결측만 보고 CO₂는 도시 하나의 결측도 알린다", () => {
  const K = setup();
  for (const [kind, missing, segments] of [["one-neighbor", false, 1], ["own", true, 2], ["neighbors", true, 2], ["zero", false, 1]]) {
    const V = gridFixture();
    if (kind === "one-neighbor" || kind === "neighbors") omitGrid(V.results[1].team.b);
    if (kind === "neighbors") omitGrid(V.results[1].team.c);
    if (kind === "own") omitGrid(V.results[1].team.a);
    if (kind === "zero") Object.values(V.results[1].team).forEach(r => Object.assign(r, { isolated: { uns: 0 }, uns: 0, imp: 0, sub: 0 }));
    delete V.results[1].team.b.co2Prod;
    const html = K.fxEnd.html(V, "a"), grid = graph(html, "grid");
    assert.equal(grid.includes('data-fx-gap="grid"'), missing, kind);
    const id = kind === "own" || kind === "zero" ? "a" : "neighbors";
    assert.equal((linePath(grid, id).match(/M/g) || []).length, segments, kind + " 선분 수");
    assert.equal(dailyPoints(grid, "내 도시").length, kind === "own" ? 2 : 3);
    assert.equal(dailyPoints(grid, "이웃 평균").length, kind === "neighbors" ? 2 : 3);
    if (kind === "one-neighbor") assert.equal(dailyPoints(grid, "이웃 평균")[1], 56 / 14);
    if (kind === "zero") {
      assert.match(grid, /<circle cx="119" cy="106"[^>]*><title>내 도시 2028년 2월 0 MWh\/일/);
      assert.equal(dailyPoints(grid, "이웃 평균")[1], 0);
    }
    assert.match(graph(html, "co2"), /공개 상태에는 최근 두 달의 CO₂만 있어 빈 달이 있어요/, kind);
    const host = graph(K.fxEnd.html(V, null, { allCities: true }), "grid");
    assert.equal(host.includes('data-fx-gap="grid"'), kind !== "zero", "진행자는 도시별 결측을 안내: " + kind);
  }
});

test("remember는 CO₂ 없는 계통 결과를 복원해도 그 달 CO₂를 0으로 그리지 않는다", () => {
  const storage = memoryStorage(), K = setup([], false, storage), V = gridFixture();
  delete V.results[1].team.a.co2Prod;
  V.results.forEach(r => K.fxEnd.remember(V, r));
  V.results.forEach(r => Object.values(r.team).forEach(omitGrid));
  const html = setup([], false, storage).fxEnd.html(V, "a");
  assert.deepEqual(dailyPoints(graph(html, "grid"), "내 도시"), [7, 14, 5].map(days => oneDecimal(20 / days)));
  const co2 = graph(html, "co2"), ownTitles = pointTitles(co2).filter(s => s.startsWith("내 도시 "));
  assert.equal(ownTitles.length, 2);
  assert.ok(ownTitles.every(s => !s.includes("2028년 2월")));
  assert.equal((linePath(co2, "a").match(/M/g) || []).length, 2);
  assert.match(co2, /공개 상태에는 최근 두 달의 CO₂만 있어 빈 달이 있어요/);
});

test("작은 계통 눈금은 중복 없이 실제 위치 값의 소수 1자리 반올림과 일치한다", async t => {
  for (const perDay of [0.3, 2.3]) await t.test(`${perDay} MWh/일`, () => {
    const K = setup(), V = gridFixture();
    V.results.forEach(r => Object.values(r.team).forEach(v => Object.assign(v, { isolated: { uns: perDay * r.days }, uns: 0, imp: 0, sub: 0 })));
    const grid = graph(K.fxEnd.html(V, null, { allCities: true }), "grid");
    const ticks = [...grid.matchAll(/<path class="lg-fx-gridline" d="M40,([\d.]+) H198"\/><text[^>]*>([^<]+)<\/text>/g)];
    assert.equal(ticks.length, 3);
    // 0선(y=106)에서 입력값의 점까지 거리로 눈금의 실제 값을 독립적으로 복원한다.
    const pointY = Number(grid.match(/<circle[^>]* cy="([^"]+)"/)[1]);
    const valuesAtTicks = ticks.map(m => perDay * (106 - Number(m[1])) / (106 - pointY));
    ticks.forEach((m, i) => assert.ok(Math.abs(Number(m[2]) - valuesAtTicks[i]) <= 0.05 + 1e-9,
      `${perDay}: 눈금 ${m[2]}, 위치의 실제 값 ${valuesAtTicks[i]}`));
    assert.equal(new Set(ticks.map(m => m[2])).size, 3, "서로 다른 눈금에 같은 글자 없음");
  });
});

test("CO₂ 범위별 눈금은 구별되며 지지·정전·주민 눈금의 기존 형식을 유지한다", async t => {
  for (const [perDay, expected] of [[0, null], [20, ["0", "11", "22"]]]) {
    await t.test(`${perDay} t/일`, () => {
      const K = setup(), V = fixture();
      V.results.forEach(r => Object.values(r.team).forEach(v => { v.co2Prod = perDay * r.days; }));
      V.active.forEach(id => {
        const city = V.econ.cities[id];
        city.hist.forEach((h, i) => { h.pop = city.pop0 + i * city.pop0 / 20; });
      });
      const html = K.fxEnd.html(V, null, { allCities: true });
      const ticks = key => [...graph(html, key).matchAll(/<path class="lg-fx-(?:gridline|zero)"[^>]*\/><text[^>]*>([^<]+)<\/text>/g)].map(m => m[1]);
      // 20 t/일: 기존 정상 범위 hi=22.4, 중간=11.2 → 0·11·22.
      const co2Ticks = ticks("co2");
      // 지시서 T F12: 0뿐인 축은 특정 상한/중간 눈금 값을 고정하지 않는다.
      // 눈금 중복 금지가 계약이며, 20 t/일의 기존 수치 검사는 유지한다.
      if (perDay) assert.deepEqual(co2Ticks, expected);
      else {
        assert.equal(Number(co2Ticks[0]), 0);
        assert.ok(co2Ticks.every(x => Number.isFinite(Number(x))));
        assert.ok(co2Ticks.every((x, i) => i === 0 || Number(x) > Number(co2Ticks[i - 1])));
      }
      assert.equal(new Set(co2Ticks).size, 3, "CO₂ 세 눈금의 글자가 모두 다르다");
      for (const key of ["appr", "uns"]) assert.deepEqual(ticks(key), ["0", "50", "100"], key + " 0~100% 눈금");
      // 주민은 매달 시작 인구의 5%씩 늘어 최대 +10%: 양끝 눈금은 ±(10×1.15)=±11.5.
      assert.deepEqual(ticks("pop"), ["-11.5", "0", "+11.5"]);
    });
  }
});
