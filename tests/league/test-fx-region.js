"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const { test } = require("node:test");
const context = vm.createContext({ window: { KCP: {} } });
const root = path.resolve(__dirname, "../../ui");
vm.runInContext(fs.readFileSync(path.join(root, "league-data.js"), "utf8"), context);
const source = path.join(root, "fx-region.js");
if (fs.existsSync(source)) vm.runInContext(fs.readFileSync(source, "utf8"), context);
const fx = context.window.KCP.fxRegion;
const board = context.window.KCP.LEAGUE_REGIONS.south.board;
const centers = {};
board.own.forEach((row, r) => [...row].forEach((ch, c) => {
  const id = board.letters[ch];
  if (!id) return;
  const p = centers[id] ||= [0, 0, 0];
  p[0] += Math.sqrt(3) * (c + .5 * (r & 1)) + Math.sqrt(3) / 2;
  p[1] += 1.5 * r + 1; p[2]++;
}));
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

// 같은 중심 아래에 고정하면 여섯 도시 카드·이름표가 충돌한다.
for (const width of [390, 1280]) test(`${width}px: 실제 여섯 도시 중심에서 측정 크기 카드·라벨 교차 0, 경계 안, 결정적`, () => {
  assert.equal(typeof fx?.placeCards, "function", "카드 배치 함수를 제공한다");
  const k = width / (Math.sqrt(3) * (board.cols + .5)), height = (1.5 * (board.rows.length - 1) + 2) * k;
  const cards = Object.entries(centers).map(([id, [x, y, n]], i) => ({ id, x: x / n * k, y: y / n * k,
    width: width < 400 ? 106 + i % 2 * 8 : 142, height: width < 400 ? 68 : 76 }));
  const labels = cards.map(c => ({ x: c.x - 25, y: c.y - 18, width: 50, height: 34 }));
  const input = JSON.stringify({ cards, labels });
  const placed = fx.placeCards(cards, labels, { width, height });
  assert.equal(placed.length, 6);
  assert.equal(new Set(placed.map(c => c.id)).size, 6);
  assert.equal(JSON.stringify(placed), JSON.stringify(fx.placeCards(cards, labels, { width, height })));
  assert.equal(JSON.stringify({ cards, labels }), input, "입력 불변");
  placed.forEach((a, i) => {
    assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.width <= width && a.y + a.height <= height, a.id);
    placed.slice(i + 1).forEach(b => assert.ok(!intersects(a, b), `${a.id}/${b.id}`));
    labels.forEach(b => assert.ok(!intersects(a, b), `${a.id}/이름표`));
  });
});

test("건설 기호는 공개 계획의 새 설비만 세고 전선·기존 설비·결과 대기를 구분한다", () => {
  assert.equal(typeof fx?.newBuildCount, "function");
  const team = { base: [{ k: "b:solar:1" }], plan: { builds: [{ t: "solar", i: 1 }, { t: "wind", i: 2 }], lines: [{ p: [1, 2] }] } };
  assert.equal(fx.newBuildCount(team, 2, "plan"), 1);
  assert.equal(fx.newBuildCount({ ...team, plan: { builds: [{ t: "solar", i: 1 }] } }, 2, "plan"), 0);
  assert.equal(fx.newBuildCount({ plan: null }, 1, "plan"), 0);
  assert.equal(fx.newBuildCount({ ...team, base: [{ k: "b:solar:1" }, { k: "b:wind:2" }], hist: [{ r: 1, n: 1 }, { r: 2, n: 2 }] }, 2, "review"), 1);
  assert.equal(fx.newBuildCount({ ...team, base: [{ k: "b:solar:1" }, { k: "b:wind:2" }] }, 2, "review"), 0, "이전 공개 기록 없으면 추측하지 않는다");
});

function drawingFixture(width, reduced = false, clock = performance) {
  const KCP = { route() {}, on() {}, gradeWords: String, esc: String, buildGame: {}, leagueNet: {} };
  const window = { KCP, addEventListener() {}, devicePixelRatio: 2, matchMedia: () => ({ matches: reduced }) };
  const document = { documentElement: {}, addEventListener() {} };
  const ctx = vm.createContext({ window, document,
    getComputedStyle: () => ({ getPropertyValue: () => "sans-serif" }), performance: clock });
  for (const name of ["build-maps.js", "build.js", "econ-data.js", "league-data.js", "league-core.js", "fx-region.js", "league.js"]) {
    let js = fs.readFileSync(path.join(root, name), "utf8");
    if (name === "build.js") js = js.replace(/\}\)\(\);\s*$/, "window.cityPalette = PAL; })();");
    if (name === "league.js") js = js.replace(/\}\)\(\);\s*$/, "window.regionDrawing = { renderBoard, boardInfo, boardHit, updateTeamRegion, useRegion(snap, zoom) { L = { snap, regionZoom: zoom }; } }; })();");
    vm.runInContext(js, ctx);
  }
  const commands = [], saved = [], g = { font: "12px sans-serif", lineDashOffset: 0,
    measureText(text) { const size = +(this.font.match(/([\d.]+)px/)?.[1] || 12); return { width: text.length * size }; },
    save() { saved.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, font: this.font, lineDashOffset: this.lineDashOffset }); },
    restore() { Object.assign(this, saved.pop()); } };
  for (const name of ["setTransform", "clearRect", "beginPath", "moveTo", "lineTo", "closePath", "arc", "fill", "stroke", "fillRect", "strokeRect", "setLineDash", "strokeText", "fillText", "roundRect"]) {
    g[name] = function (...args) { commands.push({ name, args, fill: this.fillStyle, stroke: this.strokeStyle, lineWidth: this.lineWidth, offset: this.lineDashOffset }); };
  }
  const cv = { width: 0, height: 0, clientWidth: width, get clientHeight() { return parseFloat(this.style.height); },
    style: {}, dataset: {}, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, getContext: () => g, getBoundingClientRect: () => ({ left: 0, top: 0, width }) };
  const reg = KCP.LEAGUE_REGIONS.south;
  const V = { active: reg.teams.map(t => t.id), round: 1, phase: "plan", ties: [], teams: Object.fromEntries(reg.teams.map(t => [t.id, { seated: true, plan: { builds: [], lines: [] } }])) };
  const result = { team: Object.fromEntries(reg.teams.map((t, i) => [t.id, { unsPct: i ? 0 : 10 }])), flow: {} };
  return { KCP, window, document, cv, V, result, commands, reg, ctx };
}

test("광역 육지·강·호수 대응표는 실제 도시 PAL의 같은 지형색을 사용한다", () => {
  const e = drawingFixture(390);
  for (const [ch, terrain] of Object.entries({ b: "beach", p: "plain", f: "forest", h: "hill", m: "mount", u: "urban", r: "river", l: "lake", g: "grid" })) {
    const city = e.window.cityPalette[terrain];
    const hex = "#" + Array.from(city, n => n.toString(16).padStart(2, "0")).join("");
    assert.equal(e.KCP.fxRegion.terrain[ch], hex, terrain);
  }
});

for (const width of [390, 600, 1280]) test(`${width}px: 실제 renderBoard의 이름·정전·기호 영역을 피하고 기존 클릭 좌표를 유지한다`, () => {
  const e = drawingFixture(width), id = e.reg.teams[0].id;
  e.V.teams[id].plan.builds.push({ t: "solar", i: 1 });
  const before = JSON.stringify(e.V), boxes = e.window.regionDrawing.renderBoard(e.cv, e.V, e.result, false);
  assert.equal(boxes.filter(b => b.kind === "city").length, 6);
  const G = e.window.regionDrawing.boardInfo(), k = +e.cv.dataset.k;
  const cards = e.reg.teams.map(t => ({ id: t.id, x: G.cen[t.id][0] * k, y: G.cen[t.id][1] * k,
    width: width === 390 ? 114 : 142, height: width === 390 ? 68 : 76 }));
  const placed = e.KCP.fxRegion.placeCards(cards, boxes, { width, height: e.cv.clientHeight });
  assert.equal(placed.length, 6);
  placed.forEach((a, i) => { boxes.filter(b => !b.soft).forEach(b => assert.ok(!intersects(a, b))); placed.slice(i + 1).forEach(b => assert.ok(!intersects(a, b))); });
  assert.ok(e.commands.some(c => c.name === "fill" && c.fill === "#b52b32"), "정전은 빨간 번개 원");
  assert.ok(e.commands.some(c => c.name === "fillRect" && c.fill === "#12634c"), "새 설비는 플러스 사각형");
  assert.ok(e.commands.some(c => c.name === "fill" && c.fill === "#3a7fb8"), "호수 원색 유지");
  assert.ok(e.commands.some(c => c.name === "stroke" && c.stroke === "#3f8fc4"), "강 원색 유지");
  const cell = G.cells.find(c => c.team === id);
  assert.equal(e.window.regionDrawing.boardHit(e.cv, { clientX: cell.x * k, clientY: cell.y * k }), id);
  assert.equal(JSON.stringify(e.V), before, "그리기는 공개 상태를 바꾸지 않는다");
});

test("지어진 연계선만 공개 순거래 방향·크기로 그리며 움직임 줄이기에서도 정지 화살표가 남는다", () => {
  const e = drawingFixture(390, true), D = e.reg.ties[0], T = { ...D, cap: 2, st: "built" }, key = D.a + "~" + D.b;
  e.V.ties = [T];
  const draw = (ab, ba) => {
    e.commands.length = 0; e.result.flow = { [key]: { ab, ba } };
    e.window.regionDrawing.renderBoard(e.cv, e.V, e.result, false);
    return e.commands.filter(c => c.name === "stroke" && c.stroke === "#ffd23f");
  };
  const small = draw(10, 0), large = draw(100, 0);
  assert.equal(e.cv.dataset.flows, "1");
  assert.ok(large[0].lineWidth > small[0].lineWidth);
  assert.equal(large[0].offset, 0);
  assert.equal(e.commands.filter(c => c.name === "fill" && c.fill === "#ffd23f").length, 2, "방향 화살촉 둘");
  const startForward = e.commands.findIndex(c => c.name === "stroke" && c.stroke === "#ffd23f");
  const forward = e.commands.slice(startForward - 2, startForward).map(c => c.args);
  draw(0, 100);
  const startReverse = e.commands.findIndex(c => c.name === "stroke" && c.stroke === "#ffd23f");
  const reverse = e.commands.slice(startReverse - 2, startReverse).map(c => c.args);
  assert.deepEqual(forward[0], reverse[1]); assert.deepEqual(forward[1], reverse[0]);
  e.window.matchMedia = () => ({ matches: false }); e.KCP.v2 = { reduced: () => true };
  assert.equal(draw(100, 0)[0].offset, 0, "앱의 움직임 줄이기도 정지");
  T.st = "prop"; assert.equal(draw(100, 0).length, 0);
  T.st = "built"; assert.equal(draw(undefined, undefined).length, 0);
  delete e.result.flow;
  e.window.regionDrawing.renderBoard(e.cv, e.V, e.result, false);
  assert.equal(e.cv.dataset.flows, "0", "공개 flow가 없으면 생략");
});

// 캐시가 없거나 입력 변경을 놓치면 동일 객체 재사용·새 장애물 회피가 깨진다.
test("배치는 같은 입력을 재사용하고 크기·장애물·경계 변경은 다시 계산한다", () => {
  const cards = [{ id: "a", x: 80, y: 80, width: 40, height: 30 }], bounds = { width: 200, height: 160 };
  const a = fx.placeCards(cards, [], bounds);
  assert.strictEqual(fx.placeCards(structuredClone(cards), [], { ...bounds }), a);
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a[0]), "공유한 캐시를 호출자가 오염시키지 못한다");
  const changed = fx.placeCards([{ ...cards[0], width: 50 }], [], bounds);
  assert.equal(changed[0].width, 50);
  const blocked = fx.placeCards(cards, [a[0]], bounds);
  assert.ok(blocked.length && !intersects(blocked[0], a[0]));
  assert.equal(fx.placeCards(cards, [], { width: 20, height: 20 }).length, 0);
});

test("물 이름표는 빈 곳이 없을 때도 카드를 숨기는 장애물이 되지 않는다", () => {
  const cards = [{ id: "a", x: 50, y: 50, width: 40, height: 30 }];
  const p = fx.placeCards(cards, [{ x: 0, y: 0, width: 100, height: 100, soft: true }], { width: 100, height: 100 });
  assert.equal(p.length, 1);
});

function countedClock(read) {
  let calls = 0;
  return { now: () => read(calls++), get calls() { return calls; } };
}

function placementFixture(clock) {
  const ctx = vm.createContext({ window: { KCP: {} }, performance: clock });
  vm.runInContext(fs.readFileSync(source, "utf8"), ctx);
  return { ctx };
}

function placeWithinLimit(e, { cards, labels, bounds }) {
  e.ctx.placementInput = [cards, labels, bounds];
  try {
    // node:test의 제한 시간만으로는 동기 무한 루프를 끊을 수 없다.
    // 모의 시계와 독립적인 VM의 2초 제한으로 멈춘 시계의 종료도 검증한다.
    return vm.runInContext("window.KCP.fxRegion.placeCards(...placementInput)", e.ctx, { timeout: 2000 });
  } finally {
    delete e.ctx.placementInput;
  }
}

// 구현의 비공개 상수 PLACE_WORK_BUDGET=500000, SAFETY_CHECK=16384에 따른 상한:
// 시작 1회 + floor(500000 / 16384) = 31회. 5ms 시계도 최대 경과 150ms로
// SAFETY_MS=200에 닿지 않는다. 예산만 해제한 임시 사본에서 아래 입력은
// 1,230,878회 판정·76회 시계 읽기로 실패해, 자연 종료로는 이 상한을 지키지 못했다.
const maxClockReads = 1 + Math.floor(500000 / 16384);
function expensivePlacementInput() {
  // 패딩을 뺀 382×329에서 카드 중심의 허용 범위는 242×189다. 이를 이등분한
  // 네 구역은 각각 121×94.5여서 같은 구역의 140×140 카드 둘은 반드시 겹친다.
  // 따라서 최대 네 장뿐이며 여섯 장은 불가능하다. 가장자리 장애물 40개는
  // 변 주변 후보를 늘려 50만 판정 예산을 소진하게 한다.
  return {
    cards: Array.from({ length: 6 }, (_, i) => ({ id: String(i), x: 195, y: 168, width: 140, height: 140 })),
    labels: Array.from({ length: 40 }, (_, i) => i % 2
      ? { x: i % 4 === 1 ? 0 : 382, y: 10 + i * 307 / 40, width: 8, height: 8 }
      : { x: 10 + i * 360 / 40, y: i % 4 === 0 ? 0 : 329, width: 8, height: 8 }),
    bounds: { width: 390, height: 337 }
  };
}

test("되돌아가기 탐색은 유한한 예산 안에 멈추고 같은 실패 결과를 재사용한다", () => {
  const clock = countedClock(n => n), e = placementFixture(clock), input = expensivePlacementInput();
  const placed = placeWithinLimit(e, input);
  assert.equal(JSON.stringify(placed), "[]", "부분 배치를 반환하지 않는다");
  assert.ok(Object.isFrozen(placed), "실패 결과도 동결한다");
  assert.ok(clock.calls > 0 && clock.calls <= maxClockReads, `시계 읽기가 과도하다: ${clock.calls}`);
  const previous = clock.calls;
  assert.strictEqual(placeWithinLimit(e, structuredClone(input)), placed, "같은 입력의 실패 객체도 기억한다");
  assert.equal(clock.calls, previous, "캐시된 실패는 시계를 읽지 않는다");
});

test("탐색 중 첫 안전 확인에서 중단한 실패는 정상 반환·동결되고 시계 읽기 없이 재사용된다", () => {
  const clock = countedClock(n => n === 0 ? 0 : 1e6), e = placementFixture(clock);
  const input = expensivePlacementInput();
  let placed;
  assert.doesNotThrow(() => { placed = placeWithinLimit(e, input); }, "안전 상한의 중단 신호가 밖으로 새지 않는다");
  assert.equal(JSON.stringify(placed), "[]", "부분 배치를 반환하지 않는다");
  assert.ok(Object.isFrozen(placed), "안전 상한으로 중단한 실패도 동결한다");
  assert.equal(clock.calls, 2, "시작과 16384번째 판정의 첫 안전 확인에서만 시계를 읽는다");
  assert.strictEqual(placeWithinLimit(e, structuredClone(input)), placed, "같은 입력은 같은 실패 객체를 반환한다");
  assert.equal(clock.calls, 2, "캐시된 실패는 시계를 더 읽지 않는다");
});

function centerPlacementInput(width) {
  const k = width / (Math.sqrt(3) * (board.cols + .5));
  const cards = Object.entries(centers).map(([id, [x, y, n]], i) => ({ id, x: x / n * k, y: y / n * k,
    width: width < 400 ? 106 + i % 2 * 8 : 142, height: width < 400 ? 68 : 76 }));
  return { cards, labels: cards.map(c => ({ x: c.x - 25, y: c.y - 18, width: 50, height: 34 })),
    bounds: { width, height: (1.5 * (board.rows.length - 1) + 2) * k } };
}

function renderedPlacementInput(e, traffic) {
  const width = e.cv.clientWidth;
  if (traffic) {
    const D = e.reg.ties[0];
    e.V.ties = [{ ...D, st: "built", cap: 2 }];
    e.result.flow[D.a + "~" + D.b] = { ab: 100, ba: 0 };
    e.V.econ = { report: { flows: { pop: [{ from: D.a, to: D.b, n: 10 }] } } };
  } else {
    e.V.teams[e.reg.teams[0].id].plan.builds.push({ t: "solar", i: 1 });
  }
  const labels = e.window.regionDrawing.renderBoard(e.cv, e.V, e.result, false);
  if (traffic) for (const [kind, count] of [["flow-text", 1], ["flow-arrow", 2], ["migration-mid", 1]]) {
    assert.equal(labels.filter(b => b.kind === kind && !b.soft).length, count, kind);
  }
  const G = e.window.regionDrawing.boardInfo(), k = +e.cv.dataset.k;
  const cards = e.reg.teams.map(t => ({ id: t.id, x: G.cen[t.id][0] * k, y: G.cen[t.id][1] * k,
    width: traffic ? 140 : width === 390 ? 114 : 142, height: traffic ? 60 : width === 390 ? 68 : 76 }));
  return { cards, labels, bounds: { width, height: e.cv.clientHeight } };
}

function assertSixCards(placed, input) {
  assert.equal(placed.length, 6, "여섯 도시를 모두 배치한다");
  assert.equal(new Set(placed.map(c => c.id)).size, 6, "도시가 중복되지 않는다");
  assert.deepEqual(Array.from(placed, c => c.id), Array.from(input.cards, c => c.id), "카드 순서를 유지한다");
  assert.ok(Object.isFrozen(placed) && placed.every(Object.isFrozen), "배열과 각 배치를 동결한다");
}

// 시계마다 구현·그리기를 별도 VM에 실어 캐시를 공유하지 않고 같은 입력을 만든다.
for (const [name, width, makeInput] of [
  ...[390, 1280].map(width => [`${width}px 실제 여섯 도시 중심`, width, () => centerPlacementInput(width)]),
  ...[390, 600, 1280].map(width => [`${width}px 실제 그리기 영역`, width, e => renderedPlacementInput(e, false)]),
  ["694px 거래량·화살촉·이주 중점", 694, e => renderedPlacementInput(e, true)]
]) test(`${name}: 느린 시계·멈춘 시계에서도 실제 시계와 같은 6/6 배치`, () => {
  let expected, expectedInput;
  for (const [clockName, clock] of [["실제 시계", performance], ["5ms 시계", countedClock(n => n * 5)], ["멈춘 시계", countedClock(() => 0)]]) {
    const e = drawingFixture(width, false, clock), input = makeInput(e), before = JSON.stringify(input);
    const placed = placeWithinLimit(e, input);
    assertSixCards(placed, input);
    if (expected === undefined) { expected = JSON.stringify(placed); expectedInput = before; }
    assert.equal(before, expectedInput, `${clockName}: 입력이 같다`);
    assert.equal(JSON.stringify(placed), expected, `${clockName}: 좌표까지 같다`);
    assert.equal(JSON.stringify(input), before, "입력을 변경하지 않는다");
  }
});

test("390px 실제 그리기 영역의 되돌아가기 성공은 실제·5ms·멈춘 시계에서 좌표까지 같은 6/6 배치다", () => {
  // 연계선·이주·새 건설 없는 기본 계획을 renderBoard로 그린 390×337 장면이다.
  // 임시 사본의 계측에서 탐욕 실패 뒤 되돌아가기로 258,517회 판정에 성공했다.
  // 상수만 바꾼 사본도 258,516에서는 [], 258,517에서는 6/6이었다. 즉 예산이
  // 약 25.85만 미만이면 이 입력은 []가 되어, 25만으로 낮추는 회귀를 잡는다.
  let expected, expectedInput;
  for (const [name, clock] of [["실제 시계", countedClock(() => performance.now())], ["5ms 시계", countedClock(n => n * 5)], ["멈춘 시계", countedClock(() => 0)]]) {
    const e = drawingFixture(390, false, clock);
    const labels = e.window.regionDrawing.renderBoard(e.cv, e.V, e.result, false);
    const G = e.window.regionDrawing.boardInfo(), k = +e.cv.dataset.k;
    const cards = e.reg.teams.map(t => ({ id: t.id, x: G.cen[t.id][0] * k, y: G.cen[t.id][1] * k, width: 114, height: 74 }));
    const input = { cards, labels, bounds: { width: 390, height: e.cv.clientHeight } }, before = JSON.stringify(input);
    const placed = placeWithinLimit(e, input);
    assertSixCards(placed, input);
    assert.ok(clock.calls >= 2 && clock.calls <= maxClockReads, `${name}: 탐색 중 안전 확인을 실제로 거친다: ${clock.calls}`);
    if (expected === undefined) { expected = JSON.stringify(placed); expectedInput = before; }
    assert.equal(before, expectedInput, `${name}: 입력이 같다`);
    assert.equal(JSON.stringify(placed), expected, `${name}: 카드 순서와 좌표까지 같다`);
    assert.equal(JSON.stringify(input), before, "입력을 변경하지 않는다");
  }
});

test("작업 예산은 실제 시계·느린 시계·멈춘 시계의 비싼 실패 탐색을 유한하게 끊는다", () => {
  let expected;
  for (const [name, clock] of [["실제 시계", countedClock(() => performance.now())], ["5ms 시계", countedClock(n => n * 5)], ["멈춘 시계", countedClock(() => 0)]]) {
    const e = placementFixture(clock), placed = placeWithinLimit(e, expensivePlacementInput());
    assert.equal(JSON.stringify(placed), "[]", `${name}: 완전한 배치가 없으면 빈 배열`);
    if (expected === undefined) expected = JSON.stringify(placed);
    assert.equal(JSON.stringify(placed), expected, `${name}: 같은 결과`);
    assert.ok(clock.calls > 1 && clock.calls <= maxClockReads, `${name}: 탐색 중에도 시계를 드물게 읽는다: ${clock.calls}`);
  }
});

test("탐욕 단계에서 찾은 여섯 도시 배치는 첫 시각 뒤 크게 뛰는 시계에서도 버리지 않는다", () => {
  // 894회 판정으로 끝나 탐색 중 시계를 다시 읽지 않는다. 옛 12ms 구현은
  // 탐욕 단계에서도 시계를 확인해, 첫 읽기 뒤 크게 뛰면 이 입력을 []로 버린다.
  const input = centerPlacementInput(1280), expected = placeWithinLimit(placementFixture(performance), input);
  const clock = countedClock(n => n === 0 ? 0 : 1e6);
  const placed = placeWithinLimit(placementFixture(clock), structuredClone(input));
  assertSixCards(placed, input);
  assert.equal(JSON.stringify(placed), JSON.stringify(expected));
  assert.equal(clock.calls, 1, "탐욕 성공까지 첫 시각만 읽는다");
});

for (const [pct, count] of [[0, 0], [.001, 0], [.0499, 0], [.05, 1], [.051, 1]]) test(`정전 ${pct}%의 번개 개수는 ${count}`, () => {
  const e = drawingFixture(390);
  e.result.team[e.reg.teams[0].id].unsPct = pct;
  e.window.regionDrawing.renderBoard(e.cv, e.V, e.result, false);
  assert.equal(e.commands.filter(c => c.name === "fill" && c.fill === "#b52b32").length, count);
});

test("거래량·거래 화살촉·이주 중점은 장애물이며 물 이름표는 감점 영역이다", () => {
  const e = drawingFixture(694), D = e.reg.ties[0];
  e.V.ties = [{ ...D, st: "built", cap: 2 }]; e.result.flow[D.a + "~" + D.b] = { ab: 100, ba: 0 };
  e.V.econ = { report: { flows: { pop: [{ from: D.a, to: D.b, n: 10 }] } } };
  const boxes = e.window.regionDrawing.renderBoard(e.cv, e.V, e.result, false);
  for (const [kind, count] of [["flow-text", 1], ["flow-arrow", 2], ["migration-mid", 1]]) {
    assert.equal(boxes.filter(b => b.kind === kind && !b.soft).length, count, kind);
  }
  assert.ok(boxes.some(b => b.kind === "water" && b.soft));
  const G = e.window.regionDrawing.boardInfo(), k = +e.cv.dataset.k;
  const cards = e.reg.teams.map(t => ({ id: t.id, x: G.cen[t.id][0] * k, y: G.cen[t.id][1] * k, width: 140, height: 60 }));
  const placed = e.KCP.fxRegion.placeCards(cards, boxes, { width: e.cv.clientWidth, height: e.cv.clientHeight });
  assert.equal(placed.length, 6);
  placed.forEach(card => boxes.filter(b => !b.soft).forEach(b => assert.ok(!intersects(card, b), b.kind)));
});

test("마지막 그리기 좌표는 도시 id·화면 원점을 포함하고 외부에서 수정되지 않는다", () => {
  const e = drawingFixture(390), id = e.reg.teams[0].id;
  e.V.teams[id].plan.builds = [{ t: "solar", i: 1 }];
  e.window.regionDrawing.renderBoard(e.cv, e.V, e.result, false);
  const a = e.KCP.fxRegion.lastLayout();
  assert.equal(a.names.length, 6);
  assert.deepEqual(Array.from(a.icons, p => [p.id, p.kind]), [[id, "outage"], [id, "build"]]);
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.icons[0]));
  e.cv.getBoundingClientRect = () => ({ left: 30, top: -20, width: 390 });
  const b = e.KCP.fxRegion.lastLayout();
  assert.equal(b.names[0].x, a.names[0].x + 30);
  assert.equal(b.names[0].y, a.names[0].y - 20);
});

function luminance(color) {
  const rgb = color.startsWith("#") ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)) : color.match(/[\d.]+/g).slice(0, 3).map(Number);
  return rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s, v, i) => s + v * [.2126, .7152, .0722][i], 0);
}
const contrast = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
test("바깥 땅·비참가 경계·이름의 실제 그리기 색이 대비 기준을 만족한다", () => {
  const e = drawingFixture(390);
  e.V.active = [e.reg.teams[0].id];
  e.window.regionDrawing.renderBoard(e.cv, e.V, e.result, false);
  const G = e.window.regionDrawing.boardInfo(), colors = e.commands.filter(c => c.name === "fill" && /^rgb\(/.test(c.fill));
  assert.equal(colors.length, G.cells.filter(c => !["~", "l"].includes(c.ch)).length);
  let i = 0; const outer = [], forest = [];
  for (const cell of G.cells) {
    if (["~", "l"].includes(cell.ch)) continue;
    const lum = luminance(colors[i++].fill);
    if (!e.V.active.includes(cell.team)) outer.push(lum);
    else if (cell.ch === "f") forest.push(lum);
  }
  const border = e.commands.find(c => c.name === "stroke" && c.stroke === "#c2d2c6");
  const name = e.commands.find(c => c.name === "fillText" && c.args[0] === e.reg.teams[1].name);
  assert.ok(border, "비참가 경계가 밝은 회녹색이다");
  for (const out of outer) {
    for (const f of forest) assert.ok(contrast(out, f) >= 1.5);
    assert.ok(contrast(out, luminance(border.stroke)) >= 3);
    assert.ok(contrast(out, luminance(name.fill)) >= 4.5);
  }
  assert.ok(e.commands.some(c => c.name === "strokeRect" && c.lineWidth === .16), "외부 전력망 연결 기호");
});

// DOM은 측정 경계만 대체한다. 배치·확대·캡션·그리기는 실제 updateTeamRegion을 실행한다.
function regionFixture(width = 695, height = 600, cardHeight = 60) {
  const e = drawingFixture(width), viewport = { clientWidth: width, clientHeight: height };
  const board = { style: {} }, caption = {}, overlay = { style: {}, markup: "" };
  let nodes = [];
  Object.defineProperty(overlay, "innerHTML", {
    set(html) {
      this.markup = html;
      nodes = [...html.matchAll(/<span class="lg-regionlabel" /g)].map(() => ({
        style: {}, hidden: false,
        get offsetWidth() { return this.style.width ? parseFloat(this.style.width) : Math.min(140, parseFloat(overlay.style.width) * .32); },
        get offsetHeight() { return cardHeight; }
      }));
    }
  });
  Object.defineProperty(e.cv, "clientWidth", { get: () => Math.round(parseFloat(board.style.width) || width) });
  e.cv.getBoundingClientRect = () => ({ left: 10, top: 25, width: e.cv.clientWidth });
  const selectors = { ".lg-regionviewport": viewport, ".lg-regionboard": board, canvas: e.cv,
    ".lg-regionlabels": overlay, "#lg-regioncap": caption };
  const region = { querySelector: s => selectors[s], querySelectorAll: s => s === ".lg-regionlabel" ? nodes : [] };
  e.document.getElementById = id => id === "lg-region" ? region : null;
  e.V.results = [e.result];
  const update = (zoom = 1) => { e.window.regionDrawing.useRegion(e.V, zoom); e.window.regionDrawing.updateTeamRegion(); };
  return { ...e, update, viewport, overlay, caption, nodes: () => nodes };
}

test("스냅·크기 통지·1→1.5→3배 확대는 배율 1 배치를 재사용하고 공개 좌표만 확대한다", () => {
  const e = regionFixture(), placed = [], original = e.KCP.fxRegion.placeCards;
  e.KCP.fxRegion.placeCards = (...args) => { const p = original(...args); placed.push(p); return p; };
  e.update();
  const first = e.KCP.fxRegion.lastLayout();
  const firstScale = parseFloat(e.overlay.style.transform.slice(6));
  assert.equal(first.cards.length, 6);
  assert.equal(placed.length, 1);
  for (const zoom of [1, 1.5, 3, 1]) {
    e.update(zoom);
    assert.strictEqual(placed.at(-1), placed[0], "확대·반복 알림에도 재탐색하지 않는다");
    const last = e.KCP.fxRegion.lastLayout(), scale = parseFloat(e.overlay.style.transform.slice(6)) / firstScale;
    for (const key of ["cards", "names", "icons"]) last[key].forEach((b, i) => {
      assert.ok(Math.abs(b.x - 10 - (first[key][i].x - 10) * scale) < .001, key);
      assert.ok(Math.abs(b.y - 25 - (first[key][i].y - 25) * scale) < .001, key);
      assert.ok(Math.abs(b.width - first[key][i].width * scale) < .001, key);
    });
  }
  e.viewport.clientHeight = 500; e.update();
  assert.notStrictEqual(placed.at(-1), placed[0], "실제 경계가 바뀌면 다시 계산한다");
});

test("카드 이름은 자료 name의 생성 텍스트이며 캡션·aria에 기호 뜻을 함께 제공한다", () => {
  const e = regionFixture(); e.update();
  for (const t of e.reg.teams) {
    assert.ok(e.overlay.markup.includes(`class="lg-regionlabel-name" aria-hidden="true" aria-label="${t.name}"></span>`), t.id);
  }
  for (const text of ["번개", "0.05%", "계획 단계", "설비 수 늘어남", "결과 단계"]) {
    assert.ok(e.caption.textContent.includes(text)); assert.ok(e.cv.attributes["aria-label"].includes(text));
  }
  assert.ok(!e.caption.textContent.includes("지도 아래 도시 목록에서 보기"));
});

test("배치 실패는 카드를 숨기고 캡션에서 도시 목록으로 안내한다", () => {
  const e = regionFixture(190, 100, 120); e.update();
  assert.ok(e.nodes().every(n => n.hidden));
  assert.equal(e.KCP.fxRegion.lastLayout().cards.length, 0);
  assert.ok(e.caption.textContent.split("\n").includes("지도 아래 도시 목록에서 보기"));
});
