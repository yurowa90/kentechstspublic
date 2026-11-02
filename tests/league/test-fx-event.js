/* 실제 phaseChanged가 예보/확정 문장과 내 도시 사건을 연출 훅에 전달하는지 검사한다. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function setup() {
  const E = { id: "coldwave_heating", name: "가상 한파", text: "가상 사건 자료", effect: { demandMul: 1.1 }, fc: .5 };
  const region = { teams: [], events: [E] }, calls = [];
  const KCP = { route() {}, on() {}, leagueNet: {}, gradeWords: id => id,
    leagueCore: { regionOf: () => region, teamDef: () => null, MUL: ["demandMul"], roundsOf: () => [{ season: "winter" }],
      eventDef: (_, id) => id === E.id ? E : id === "other" ? { ...E, id } : null,
      hits: (_, event) => event.id !== "other" },
    buildGame: { toast() {}, clearTrialDisplay() {} },
    fxTurn: { monthStart: options => calls.push(options), monthEnd: options => { calls.push(options); return false; } } };
  let source = fs.readFileSync(path.resolve(__dirname, "../../ui/league.js"), "utf8");
  // 서랍·소리·경제 부수 작업 경계만 대체한다. phaseChanged와 사건 문장 함수는 실제 코드를 실행한다.
  source = source.replace(/\}\)\(\);\s*$/, `
    signal = () => {}; closePanel = () => {}; openPanel = () => {}; warnUnsentPlan = () => {};
    window.eventHookTest = {
      run(view, away = null) { L = { team: "fake-city", snap: view, away }; phaseChanged(view); },
      forecast(view) { L = { team: "fake-city", snap: view }; forecastStart(view); }
    };
  })();`);
  const window = { KCP, addEventListener() {} }, document = { addEventListener() {}, getElementById: () => null, querySelector: () => null };
  // forecastStart는 배치가 자리 잡도록 두 프레임 뒤에 부른다. 검사에서는 프레임 콜백을 바로 실행한다.
  const context = vm.createContext({ window, document, matchMedia: () => ({ matches: false }), requestAnimationFrame: fn => fn() });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../../ui/econ-data.js"), "utf8"), context);
  vm.runInContext(source, context);
  const view = { room: "FAKE", round: 1, phase: "plan", teams: { "fake-city": { fcx: { [E.id]: [.8, 1.2] } } },
    events: [{ id: E.id, round: 1 }, { id: "other", round: 1 }, { id: E.id, round: 2 }], results: [] };
  return { run: window.eventHookTest.run, forecast: window.eventHookTest.forecast, calls, view, event: E };
}

test("계획 훅은 해당 월·내 도시만 골라 기존 evSize의 예보 범위를 보낸다", () => {
  const e = setup(); e.run(e.view);
  assert.equal(e.calls.length, 1);
  assert.equal(e.calls[0].cards.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(e.calls[0].cards[0])), {
    id: "coldwave_heating", tag: "사건 예보", title: "가상 한파", body: "가상 사건 자료", big: "수요 +8~12%"
  });
});

test("관전과 해당 사건 없는 계획은 예보 훅을 부르지 않는다", () => {
  const e = setup(); e.run(e.view, "other-city");
  e.run({ ...e.view, events: [{ id: "other", round: 1 }] });
  assert.equal(e.calls.length, 0);
});

test("결과 훅은 동일 사건 id·예보 면과 evReveal의 확정 문장을 보낸다", () => {
  const e = setup();
  const result = { round: 1, team: {}, days: 7, events: ["coldwave_heating"] };
  e.run({ ...e.view, phase: "review", events: [{ id: "coldwave_heating", round: 1, x: 1.2 }], results: [result] });
  const card = e.calls[0].cards[1];
  assert.equal(card.id, "coldwave_heating");
  assert.equal(card.forecast.big, "수요 +8~12%");
  assert.equal(card.forecast.body, "가상 사건 자료");
  assert.equal(card.body, "예보 수요 +8~12% → 확정 수요 +12%");
  assert.equal(card.big, "수요 +12%");
});

test("다른 도시 사건의 결과는 예보 앞면 없는 단면 카드다", () => {
  const e = setup();
  e.run({ ...e.view, phase: "review", events: [{ id: "other", round: 1, x: 1.2 }],
    results: [{ round: 1, team: {}, days: 7, events: ["other"] }] });
  const card = e.calls[0].cards[1];
  assert.equal(card.id, "other");
  assert.equal(card.forecast, undefined);
  assert.ok(card.body);
});

test("경제 모드 예보 본문은 결과 서랍처럼 라운드를 달로 표시한다", () => {
  const e = setup(); e.event.text = "이번 라운드 · 다음 라운드";
  e.view.econ = {}; e.view.phase = "review";
  e.view.events = [{ id: e.event.id, round: 1, x: 1.2 }];
  e.view.results = [{ round: 1, team: {}, days: 7, events: [e.event.id] }];
  e.run(e.view);
  assert.equal(e.calls[0].cards[1].forecast.body, "이번 달 · 다음 달");
  e.forecast({ ...e.view, phase: "plan" });
  assert.equal(e.calls[1].cards[0].body, "이번 달 · 다음 달");
});
