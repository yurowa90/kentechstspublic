/* 지도 유휴 프레임 상한(단위6) 검사. 명세: (비공개 작업 지시서) 브라우저는 실행하지 않는다. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const context = vm.createContext({ window: { KCP: { route() {}, on() {} } }, document: { documentElement: {} } });
for (const name of ["build-maps.js", "build.js"]) {
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../../ui", name), "utf8"), context);
}
const fx = context.window.KCP.buildGame.mapMotion;
const idle = { run: null, mapFx: [], floaters: [] };
const events = [{ run: { done: false } }, { mapFx: [{ kind: "place" }] }, { floaters: [{ t0: 1 }] }];

test("frameDelay가 공개되고 needsFrame 계약은 그대로다", () => {
  assert.equal(typeof fx.frameDelay, "function");
  assert.equal(fx.needsFrame(idle, false, false), true, "빈 지도의 바다는 계속 움직인다(test-fx-map 54행 계약)");
  assert.equal(fx.needsFrame(idle, true, false), false);
});

test("유휴 장면은 낮은 빈도로 지연 예약한다(명세 1: AMBIENT_FPS 12)", () => {
  const ms = fx.frameDelay(idle, false, false, true);
  assert.equal(typeof ms, "number");
  // 명세 값 1000/12≈83ms. 끊겨 보이지 않을 하한·부하를 줄일 상한 사이인지 본다(정확한 값은 G 계수).
  assert.ok(ms >= 50 && ms <= 200, `유휴 지연 ${ms}ms`);
});

test("이벤트가 있으면 바로 정상 프레임(0)", () => {
  for (const e of events) {
    assert.equal(fx.frameDelay({ ...idle, ...e }, false, false, true), 0, JSON.stringify(e));
    // needsFrame 계약(61행)처럼 감속 설정·숨김과 관계없이 이벤트는 끝까지 그린다.
    for (const [rm, hidden, visible] of [[true, false, true], [false, true, true], [false, false, false], [true, true, false]])
      assert.equal(fx.frameDelay({ ...idle, ...e }, rm, hidden, visible), 0, `${JSON.stringify(e)} rm=${rm} hidden=${hidden} visible=${visible}`);
  }
});

test("움직임 줄이기·문서 숨김·화면 밖이면 유휴 프레임을 걸지 않는다(명세 2·4)", () => {
  for (const [rm, hidden, visible] of [[true, false, true], [false, true, true], [false, false, false]]) {
    const out = fx.frameDelay(idle, rm, hidden, visible);
    assert.equal(out, null, `rm=${rm} hidden=${hidden} visible=${visible}`);
  }
});

test("유휴 frame은 타이머 하나만 걸고, request()는 타이머를 지우고 rAF 하나, 옛 화면 타이머는 깨우지 않는다", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../ui/build.js"), "utf8");
  // test-fx-map의 frame 검사처럼 실제 frame·request·clearAmbientFrame을 돌리고 그리기·시간 경계만 대체한다.
  const body = src.slice(src.indexOf("  function frame(now) {"), src.indexOf("\n  /* =====================================================================\n   * 6. 조작"));
  const timers = new Map(); let nextId = 0, rafs = 0, painted = 0;
  const state = { alive: true, raf: 0, ambientTimer: 0, mapVisible: true, opts: {}, root: {}, mapFx: [], floaters: [], run: null, born: 0,
    base: {}, g: { setTransform() {}, drawImage() { painted++; } } };
  const box = { S: state, V: { W: 390, H: 800 }, document: { hidden: false }, KCP: {}, mapMotion: fx, reduced: () => false, dprOf: () => 1,
    curHour() {}, paintSea() {}, paintDynamic() {}, paintCursor() {}, paintLeagueLayers() {}, paintMapMood() {}, placeBanners() {},
    requestAnimationFrame() { rafs++; return rafs; },
    setTimeout(f, ms) { timers.set(++nextId, { f, ms }); return nextId; }, clearTimeout(id) { timers.delete(id); } };
  vm.createContext(box); vm.runInContext(body, box);
  vm.runInContext("frame(100)", box);
  assert.equal(painted, 1); assert.equal(rafs, 0, "유휴 프레임 뒤 rAF를 바로 걸지 않는다"); assert.equal(timers.size, 1, "타이머 하나");
  assert.ok([...timers.values()][0].ms >= 50 && [...timers.values()][0].ms <= 200);
  vm.runInContext("request()", box);
  assert.equal(timers.size, 0, "request가 유휴 타이머를 지운다"); assert.equal(rafs, 1, "rAF 하나");
  vm.runInContext("request()", box); assert.equal(rafs, 1, "중복 예약 없음");
  // 타이머가 울리면 rAF 하나
  state.raf = 0; vm.runInContext("frame(200)", box); assert.equal(timers.size, 1);
  const [id, t] = [...timers.entries()][0]; timers.delete(id); t.f(); assert.equal(rafs, 2, "타이머 만료 뒤 rAF 하나");
  // 옛 화면 타이머는 새 화면을 깨우지 않는다
  state.raf = 0; vm.runInContext("frame(300)", box); const old = [...timers.values()][0]; timers.clear();
  box.S = { ...state, raf: 0, ambientTimer: 0 }; vm.runInContext("S = globalThis.S", box);
  old.f(); assert.equal(rafs, 2, "S가 바뀐 뒤 옛 타이머는 rAF를 걸지 않는다");
  // 화면 밖이면 유휴 프레임을 걸지 않는다
  const hiddenState = { ...state, raf: 0, ambientTimer: 0, mapVisible: false }; box.S = hiddenState; vm.runInContext("S = globalThis.S", box);
  vm.runInContext("frame(400)", box); assert.equal(timers.size, 0); assert.equal(rafs, 2);
});

test("정리 경로: 언마운트가 유휴 타이머와 관찰자를 끊고, 효과 등록은 request를 부른다", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../ui/build.js"), "utf8");
  const teardown = src.slice(src.indexOf("S.alive = false;"), src.indexOf("S.alive = false;") + 600);
  assert.match(teardown, /clearAmbientFrame\(\)/); assert.match(teardown, /S\.io\)?\s*S?\.?io\.disconnect\(\)|S\.io\.disconnect\(\)/);
  const mapEffect = src.slice(src.indexOf("function mapEffect("), src.indexOf("function mapEffect(") + 200);
  assert.match(mapEffect, /request\(\)/);
});

test("frame()이 frameDelay로 다음 프레임을 정하고 유휴 지연은 타이머로 건다", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../ui/build.js"), "utf8");
  const frame = src.slice(src.indexOf("  function frame(now) {"), src.indexOf("  function request()"));
  assert.match(frame, /frameDelay\(/, "frame이 frameDelay를 쓴다");
});
