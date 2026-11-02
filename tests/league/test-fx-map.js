/* 지도 효과 상태·흐름과 Canvas 명령을 검사한다. 브라우저는 실행하지 않는다. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const context = vm.createContext({ window: { KCP: { route() {}, on() {} } }, document: { documentElement: {} } });
for (const name of ["build-maps.js", "build.js"]) {
  let source = fs.readFileSync(path.resolve(__dirname, "../../ui", name), "utf8");
  // 비공개 그리기 함수의 Canvas 경계만 대체한다. 제품에는 검사 전용 API를 넣지 않는다.
  if (name === "build.js") source = source.replace(/\}\)\(\);\s*$/, `
    window.mapPaintTest = { paintPowerFlow, paintMapMood: typeof paintMapMood === "function" ? paintMapMood : null, useView(view) { Object.assign(V, view); }, useState(state) { S = state; } };
  })();`);
  vm.runInContext(source, context);
}
const fx = context.window.KCP.buildGame.mapMotion;

test("같은 칸 연속 조작은 교체하고 철거 전 모양·경로는 복사한다", () => {
  assert.ok(fx, "지도 효과 상태 함수가 제공된다");
  const building = { kind: "place", i: 3, t: "wind" };
  let state = fx.register([], building, 10, false);
  building.t = "solar";
  assert.equal(state[0].t, "wind");
  state = fx.register(state, { kind: "remove", i: 3, t: "wind" }, 30, false);
  assert.equal(state.length, 1);
  assert.equal(state[0].kind, "remove");
  const p = [3, 4, 5];
  state = fx.register(state, { kind: "line", p }, 40, false);
  p[0] = 9;
  assert.equal(state[1].p[0], 3);
  assert.equal(fx.active(state, 329, false).length, 2);
  assert.equal(fx.active(state, 330, false).length, 1);
  assert.equal(fx.active(state, 340, false).length, 0);
});

test("움직임 줄이기는 새 효과·진행 중 효과를 즉시 비운다", () => {
  assert.ok(fx);
  const state = fx.register([], { kind: "place", i: 3, t: "solar" }, 0, false);
  assert.equal(fx.register(state, { kind: "remove", i: 3, t: "solar" }, 10, true).length, 0);
  assert.equal(fx.active(state, 10, true).length, 0);
});

test("기존 비용 글자도 수명대로 만료하고 움직임 줄이기 전환 때 남지 않는다", () => {
  const floaters = [{ t0: 0, text: "가상 비용" }];
  assert.equal(fx.active(floaters, 1099, false, 1100).length, 1);
  assert.equal(fx.active(floaters, 1100, false, 1100).length, 0);
  assert.equal(fx.active(floaters, 10, true, 1100).length, 0);
});

test("빈 지도·관전도 보이는 동안 프레임을 유지하고 효과·운전 진행은 별도로 이어간다", () => {
  assert.equal(typeof fx.needsFrame, "function", "프레임 지속 여부를 검사할 수 있다");
  const idle = { mapFx: [], floaters: [], rec: { hubs: [], stacks: [] }, lineStart: null };
  assert.equal(fx.needsFrame(idle, false, false), true, "빈 지도의 바다도 계속 움직인다");
  assert.equal(fx.needsFrame({ ...idle, opts: { league: true } }, false, false), true);
  assert.equal(fx.needsFrame(idle, true, false), false);
  assert.equal(fx.needsFrame(idle, false, true), false);
  for (const change of [{ mapFx: [{}] }, { run: {} }, { floaters: [{}] }]) {
    assert.equal(fx.needsFrame({ ...idle, ...change }, false, false), true);
    assert.equal(fx.needsFrame({ ...idle, ...change }, true, false), true);
    assert.equal(fx.needsFrame({ ...idle, ...change }, false, true), true);
  }
});

test("설치는 바닥에서 솟아 넘쳤다 복귀하고 철거는 꺼지며 사라진다", () => {
  assert.ok(fx);
  const a = { kind: "place", t0: 0 }, b = { kind: "remove", t0: 0 };
  assert.equal(fx.pose(a, 0).scale, 0);
  assert.ok(fx.pose(a, 200).scale > 1);
  assert.equal(fx.pose(a, 300).scale, 1);
  assert.equal(fx.pose(b, 0).alpha, 1);
  assert.ok(fx.pose(b, 150).drop > 0);
  assert.ok(fx.pose(b, 150).scale < 1);
  assert.equal(fx.pose(b, 300).alpha, 0);
});

test("실제 선별·시간별 부호와 크기로 방향·밀도·속도를 정하고 정전 경로는 줄인다", () => {
  assert.ok(fx);
  const res = { E: 3, NT: 1, edges: [[1, 2], [2, 3], [3, 4]],
    flow: [1, -8, 20, -3, 0, 0], hrUns: [1, 0] };
  const routes = { live: new Set([0, 1]), towns: [[{ ti: 0, dir: 1 }], [], []] };
  const marks = fx.flowMarks(res, 0, routes, false, 0.05);
  assert.equal(marks.length, 2, "live 경로만 그린다");
  assert.equal(marks[0].from, 1); assert.equal(marks[0].to, 2);
  assert.equal(marks[1].from, 3); assert.equal(marks[1].to, 2);
  assert.equal(marks[0].outage, true);
  const healthy = fx.flowMarks({ ...res, hrUns: [0, 0] }, 0, routes, false, 0.05);
  assert.ok(marks[0].count < healthy[0].count);
  assert.ok(healthy[1].count > healthy[0].count);
  assert.ok(healthy[1].speed > healthy[0].speed);
  assert.equal(fx.flowMarks(res, 1, routes, false, 0.05)[0].from, 2);
  const still = fx.flowMarks(res, 0, routes, true, 0.05);
  assert.equal(still.length, 2, "움직임 줄이기에서도 통전 선은 남는다");
  assert.ok(still.every(m => m.speed === 0));
  assert.equal(fx.flowMarks({ ...res, flow: null }, 0, routes, false, 0.05).length, 0);
});

test("입자는 선분당 6개·전체 200개를 넘지 않으며 정전된 무흐름 선도 표시한다", () => {
  assert.ok(fx);
  const edges = Array.from({ length: 100 }, (_, i) => [i, i + 1]);
  const res = { E: 100, NT: 1, edges, flow: edges.map(() => 100), hrUns: [0] };
  const routes = { live: new Set(edges.map((_, i) => i)), towns: [] };
  const marks = fx.flowMarks(res, 0, routes, false, 0.05);
  assert.ok(marks.every(m => m.count <= 6));
  assert.equal(marks.reduce((sum, m) => sum + m.count, 0), 200);
  const dark = fx.flowMarks({ E: 1, NT: 1, edges: [[1, 2]], flow: [0], hrUns: [2] }, 0,
    { live: new Set([0]), towns: [[{ ti: 0, dir: 1 }]] }, false, 0.05);
  assert.equal(dark[0].outage, true);
  assert.equal(dark[0].count, 0);
});

test("여러 선분으로 된 송전선도 입자 합계 6개를 넘지 않는다", () => {
  const res = { E: 3, NT: 1, edges: [[1, 2], [2, 3], [3, 4]], flow: [8, 8, 8], hrUns: [0] };
  const marks = fx.flowMarks(res, 0,
    { live: new Set([0, 1, 2]), towns: [], owners: [[0], [0, 1], [1]] }, false, 0.05);
  assert.ok(marks[0].count + marks[1].count <= 6);
  assert.ok(marks[1].count + marks[2].count <= 6);
  assert.ok(marks.every(m => m.count > 0), "한 선분이 예산을 독점하지 않는다");
});

test("긴 송전선은 선분 수까지 예산을 늘려 마지막 선분에도 입자를 놓는다", () => {
  const edges = Array.from({ length: 12 }, (_, i) => [i, i + 1]);
  const res = { E: 12, NT: 1, edges, flow: edges.map(() => 100), hrUns: [0] };
  const net = { edges, comps: [{ RL: [{ g: { live: true }, l: { live: true, kind: "town", ti: 0 },
    path: edges.map((_, i) => [i, 1]) }], RB: [], BL: [], DL: [] }] };
  const routes = fx.flowRoutes(net, res, [{ p: Array.from({ length: 13 }, (_, i) => i) }]);
  const marks = fx.flowMarks(res, 0, routes, false, 0.05);
  assert.equal(marks.length, 12);
  assert.ok(marks.every(m => m.count >= 1), "앞 6칸만 채우지 않는다");
  assert.equal(marks.reduce((sum, m) => sum + m.count, 0), 12);
  const weak = fx.flowMarks({ ...res, flow: edges.map(() => 1), hrUns: [0.1] }, 0, routes, false, 0.05);
  assert.ok(weak.every(m => m.count >= 1), "흐름이 적고 정전 중이어도 통전 선분은 최소 1개를 받는다");
});

test("재생은 흐름 부호만 쓰고 양·정전 여부에 따라 입자 밀도와 속도를 바꾸지 않는다", () => {
  const res = { E: 3, NT: 1, edges: [[1, 2], [2, 3], [3, 4]], flow: [1, -100, 8], hrUns: [0.001] };
  const routes = { live: new Set([0, 1, 2]), towns: [[{ ti: 0, dir: 1 }], [], []] };
  const marks = fx.flowMarks(res, 0, routes, false, 0, true, () => true);
  assert.equal(marks[0].outage, true, "재생 정전은 시험 운전 문턱보다 작은 부족도 포함한다");
  assert.equal(marks[1].from, 3);
  assert.ok(marks.every(m => m.count === marks[0].count));
  assert.ok(marks.every(m => m.speed === marks[0].speed));
  assert.ok(marks.every(m => m.amount === marks[0].amount), "선 굵기와 점 크기도 양을 나타내지 않는다");
  const healthy = fx.flowMarks(res, 0, routes, false, 0, true, () => false);
  assert.ok(healthy.every(m => !m.outage), "outHour가 거짓이면 붉은 선도 그리지 않는다");
});

test("창문과 선에 쓰는 정전 판정은 재생 outHour와 시험 운전 문턱을 구분한다", () => {
  const res = { NT: 1, hrUns: [0.001, 0.1, 0] };
  assert.equal(fx.townOutage(res, 0, 0, 0.05), false);
  assert.equal(fx.townOutage(res, 1, 0, 0.05), true);
  assert.equal(fx.townOutage(res, 0, 0, 0, () => true), true);
  assert.equal(fx.townOutage(res, 1, 0, 0, () => false), false);
  assert.equal(fx.townOutage(res, 2, 0, 0, () => true), false);
  assert.equal(fx.townOutage(res, 0, 0, 0), true, "outHour가 없으면 보정된 부족으로 판정한다");
});

test("움직임 줄이기에서도 빛띠와 고정 점을 그리고 시간만 흘러도 위치는 바뀌지 않는다", () => {
  const res = { E: 1, NT: 1, edges: [[1, 2]], flow: [100], hrUns: [0] };
  const net = { edges: res.edges, comps: [{ RL: [{ g: { live: true }, l: { live: true, kind: "town", ti: 0 },
    path: [[0, 1]] }], RB: [], BL: [], DL: [] }] };
  const state = { net, st: { lines: [{ p: [1, 2] }] }, rec: { pylons: new Map([[1, [0, 0]], [2, [100, 0]]]) } };
  const { paintPowerFlow, useState } = context.window.mapPaintTest;
  useState(state);
  const strokes = [], points = [];
  const g = { save() {}, restore() {}, beginPath() {}, moveTo() {}, quadraticCurveTo() {}, fill() {},
    stroke() { strokes.push({ color: this.strokeStyle, width: this.lineWidth }); },
    arc(x, y, r) { points.push([x, y, r]); } };
  paintPowerFlow(g, 1, { res }, { k: 0 }, false);
  points.length = 0; strokes.length = 0;
  paintPowerFlow(g, 2, { res }, { k: 0 }, true);
  assert.equal(strokes.length, 2, "움직임 줄이기에서도 빛띠 두 겹을 그린다");
  assert.equal(strokes[1].color, "rgba(200,250,255,0.9)", "기존 안쪽 빛띠 색을 보존한다");
  assert.ok(points.length > 0);
  assert.ok(points.every(p => p[2] === 4.6), "큰 흐름은 기존 입자 크기 상한까지 표시한다");
  const fixed = points.slice();
  points.length = 0;
  paintPowerFlow(g, 20, { res }, { k: 0 }, true);
  assert.deepEqual(points, fixed);
});

test("기존 망 경로에서 live 경로·부족 마을·선 소속을 찾고 반대 방향에는 정전을 묻히지 않는다", () => {
  const res = { E: 2, NT: 1, edges: [[1, 2], [2, 3]], flow: [-1, 1], hrUns: [1] };
  const net = { edges: [[2, 3], [1, 2]], comps: [{
    RL: [{ g: { live: true }, l: { kind: "town", ti: 0, live: true }, path: [[0, 1]] }],
    RB: [], BL: [], DL: [{ g: { live: false }, l: { live: true }, path: [[1, 1]] }]
  }] };
  const routes = fx.flowRoutes(net, res, [{ p: [1, 2, 3] }]);
  assert.deepEqual([...routes.live], [1], "결과의 선 인덱스에 대응한다");
  assert.equal(routes.towns[1][0].ti, 0);
  assert.deepEqual([...routes.owners[1]], [0]);
  assert.equal(fx.flowMarks(res, 0, routes, false, 0.05)[0].outage, true);
  res.flow[1] = -1;
  assert.equal(fx.flowMarks(res, 0, routes, false, 0.05)[0].outage, false);
});


// 실 Canvas 대신 명령 경계만 기록해 전체 합성 상한과 입자·reduced 동작을 확인한다.
function moodPainter() {
  const { paintMapMood, useState, useView } = context.window.mapPaintTest;
  const commands = [];
  const ink = {};
  for (const method of ["clearRect", "beginPath", "fillRect", "fill", "stroke", "moveTo", "lineTo", "arc", "ellipse"]) {
    ink[method] = (...args) => commands.push([method, ...args]);
  }
  for (const method of ["createRadialGradient", "createLinearGradient"]) {
    ink[method] = (...args) => {
      commands.push([method, ...args]);
      return { addColorStop: (...stop) => commands.push(["addColorStop", ...stop]) };
    };
  }
  for (const prop of ["fillStyle", "strokeStyle", "lineWidth", "globalAlpha"]) {
    Object.defineProperty(ink, prop, { set(value) { commands.push([prop, value]); } });
  }
  context.document.createElement = () => ({ width: 0, height: 0, getContext: () => ink });
  useView({ W: 390, H: 800, area: { l: 0, r: 390, t: 0, b: 800 } });
  useState({ alive: true, raf: 1 });
  const composites = [];
  const g = { save() {}, restore() {}, drawImage() { composites.push(this.globalAlpha); } };
  const bg = context.window.KCP.buildGame;
  assert.equal(typeof bg.setMapMood, "function");
  return (mood, t, reduced) => {
    commands.length = 0; composites.length = 0;
    bg.setMapMood(mood); paintMapMood(g, t, reduced);
    return { commands: commands.slice(), composites: composites.slice() };
  };
}

// moveTo→lineTo로 만든 선분 중 실제 stroke된 것만 빗줄기로 센다.
function rainSegments(commands) {
  const lines = [];
  let point, pending = [];
  for (const [method, ...args] of commands) {
    if (method === "beginPath") { point = null; pending = []; }
    if (method === "moveTo") point = args;
    if (method === "lineTo" && point) {
      pending.push([args[0] - point[0], args[1] - point[1]]);
      point = args;
    }
    if (method === "stroke") { lines.push(...pending); pending = []; }
  }
  return lines;
}

test("rain을 포함한 사건 분위기는 0.06 이하로 한 번 합성하고 눈 60개·storm 빗줄기 80개를 그린다", () => {
  const paint = moodPainter();
  assert.equal(paint("snow", 3, false).commands.filter(([method]) => method === "arc").length, 60);
  assert.equal(rainSegments(paint("storm", 3, false).commands).length, 80);
  for (const mood of ["heat", "cold", "snow", "storm", "cloud", "haze", "rain"]) {
    for (const reduced of [false, true]) {
      const { composites } = paint(mood, 50, reduced);
      assert.equal(composites.length, 1, `${mood}, reduced=${reduced}: 한 번 합성한다`);
      assert.ok(composites.every(a => Number.isFinite(a) && a > 0 && a <= 0.06), `${mood}: 합성 투명도 상한`);
    }
  }
  // rain은 정지 빗줄기를 남기는 예외이므로 아래 반복문에서 빼고 별도 검사한다.
  for (const mood of ["heat", "cold", "snow", "storm", "cloud", "haze"]) {
    const { commands } = paint(mood, 50, true);
    assert.equal(commands.filter(([method]) => ["moveTo", "lineTo", "arc", "ellipse"].includes(method)).length,
      0, `${mood}: reduced에서는 물결·입자·구름을 그리지 않는다`);
  }
  for (const mood of [null, "invalid"]) {
    assert.equal(paint(mood, 3, false).composites.length, 0, "null과 잘못된 분위기는 그리지 않는다");
  }
});

test("rain은 움직이는 구름 띠와 storm보다 적고 거의 수직인 빗줄기를 그린다", () => {
  const paint = moodPainter();
  const storm = rainSegments(paint("storm", 3, false).commands);
  const rain = paint("rain", 3, false).commands;
  const lines = rainSegments(rain);
  const clouds = commands => commands.filter(([method]) => method === "ellipse");
  assert.ok(clouds(rain).length > 0, "rain의 구름 띠가 있다");
  assert.ok(lines.length > 0 && lines.length < 80 && lines.length < storm.length, "rain 빗줄기는 1~79개이며 storm보다 적다");
  const slope = ([dx, dy]) => Math.abs(dx) / Math.abs(dy);
  // '거의 수직'의 독립 기준: 가로 이동량은 세로의 1/4 이하.
  assert.ok(lines.every(line => Number.isFinite(slope(line)) && slope(line) <= 0.25), "rain은 거의 수직이다");
  assert.ok(Math.max(...lines.map(slope)) < Math.min(...storm.map(slope)), "rain의 가로/세로 기울기는 storm보다 작다");
  const later = paint("rain", 50, false).commands;
  assert.notDeepEqual(clouds(later), clouds(rain), "움직임 있음에서 구름 위치가 달라진다");
  const rainPaths = commands => commands.filter(([method]) => method === "moveTo" || method === "lineTo");
  assert.notDeepEqual(rainPaths(later), rainPaths(rain), "움직임 있음에서 빗줄기 위치가 달라진다");
});

test("rain은 움직임 줄이기에서 구름 없이 정지 빗줄기 1~6개만 남기고 시각이 달라도 명령이 같다", () => {
  const paint = moodPainter();
  const still = paint("rain", 3, true);
  const lines = rainSegments(still.commands);
  assert.ok(lines.length > 0 && lines.length <= 6, "rain 예외: 정지 빗줄기를 몇 개 남긴다");
  assert.equal(still.commands.filter(([method]) => method === "ellipse" || method === "arc").length, 0, "구름·눈 입자는 없다");
  for (const t of [0, 50, 500]) {
    assert.deepEqual(paint("rain", t, true), still, `reduced rain은 t=${t}에서도 같은 명령·투명도를 쓴다`);
  }
});

test("분위기 동기화 예외 뒤에도 프레임을 그리고 정지 상태에서 다시 예약할 수 있다", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../ui/build.js"), "utf8");
  // 실제 frame/request를 실행하고 Canvas 그리기 경계만 대체한다.
  const frameSource = source.slice(source.indexOf("  function frame(now) {"), source.indexOf("\n  /* =====================================================================\n   * 6. 조작"));
  for (const [moving, fail] of [[false, true], [true, true], [false, false], [true, false]]) {
    let scheduled = 0, painted = 0;
    const state = { alive: true, raf: 1, opts: { league: true }, root: {}, mapFx: [], floaters: [], born: 0,
      base: {}, g: { setTransform() {}, drawImage() { painted++; } } };
    const boundary = { S: state, V: { W: 390, H: 800 }, document: { hidden: false },
      KCP: { fxTurn: { syncMapMood() {
        if (fail) throw new Error("가상 동기화 실패");
        // setMapMood의 재그리기 요청도 현재 프레임과 중복 예약하지 않는다.
        boundary.request();
      } } },
      mapMotion: { active: list => list, needsFrame: () => moving, frameDelay: () => (moving ? 0 : null) }, reduced: () => false, dprOf: () => 1,
      curHour() {}, paintSea() {}, paintDynamic() {}, paintCursor() {}, paintLeagueLayers() {}, paintMapMood() {}, placeBanners() {},
      requestAnimationFrame() { return ++scheduled; } };
    vm.createContext(boundary);
    vm.runInContext(frameSource, boundary);
    assert.doesNotThrow(() => vm.runInContext("frame(100)", boundary));
    assert.equal(painted, 1);
    assert.equal(state.raf, moving ? 1 : 0);
    vm.runInContext("request()", boundary);
    assert.equal(scheduled, 1, "다음 프레임은 한 번만 예약한다");
  }
});
