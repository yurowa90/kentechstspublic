'use strict';

// S3: 운영 수요로 목표를 다시 계산하거나 월/대표 주 단위를 혼동하면 실패한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({
  console, document: { documentElement: {} }, KCP: { route() {}, on() {}, esc: value => value }
});
context.window = context;
vm.runInContext('Math.random = () => { throw Error("unseeded random"); };', context);
for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core']) {
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, `../../../ui/${name}.js`), 'utf8'), context);
}
const { leagueCore: core, buildGame: build, ECON_DATA: data } = context.KCP;
const region = core.regionOf('south');
const clone = value => JSON.parse(JSON.stringify(value));
let checks = 0;
function equal(actual, expected, label) {
  assert.deepEqual(clone(actual), clone(expected), label);
  checks++;
}
function near(actual, expected, label) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-8, `${label}: ${actual} / ${expected}`);
  checks++;
}

function play(ids) {
  let state = core.newState('plan-co2', region.id, 0, ids, { turns: 36, seedMode: 'fixed' });
  // 첫 달 보정과 같은 시작 지도·씨앗을 별도로 운전해 수요만 확인한다.
  let initialDemand = 0;
  for (const id of ids) {
    build.selectPack(core.teamDef(region, id).pack, 'league');
    const plan = build.sanitize(data.normalStartPlans[id], Number.MAX_VALUE);
    initialDemand += build.simulate({ ...plan, season: 'winter', seed: 0 }, 7, { league: true }).tot.dem * 31 / 7;
  }
  const planned = [];
  let previousDaily = 0;
  for (let month = 1; month <= 36; month++) {
    core.host(state, 'next', month * 1000);
    const savedBeforeView = JSON.stringify(state);
    const goals = clone(core.publicView(state, month * 1000).goals);
    equal(JSON.stringify(state), savedBeforeView, '공개 조회는 상태를 변경하지 않음');
    assert.ok(goals.co2Plan > 0, `${month}달: 0이 아닌 계획 목표`);
    checks++;
    // F20: 2027=.70, 2028=2/3, 2029=19/30. 직전 달 실제 일평균 수요 × 이번 달 일수(일수 차이만 보정).
    const factor = [0.7, 2 / 3, 19 / 30][Math.floor((month - 1) / 12)];
    const expectedDemand = month === 1 ? initialDemand : previousDaily * core.roundsOf(state)[month - 1].mdays;
    // D-73: 목표의 국가 계수 .4567→.4173; 수요·연도별 감축 경로 유지.
    near(goals.co2Plan, expectedDemand * data.params.normalCo2.v * factor, `${month}달 수요·연도별 감축 경로`);
    equal(goals.co2Basis, month === 1 ? '첫 달 보정 운영 수요' : '지난달 수요(일수 보정)', '목표 산출 근거');
    equal(state.goalPlan[month].co2Plan, goals.co2Plan, '계획 진입 즉시 상태에 보존');
    planned.push(goals.co2Plan);

    // 학생 정책·사건·수요가 변하고 저장을 다시 읽어도 목표는 고정되어야 한다.
    for (const id of ids) {
      state.teams[id].plan = { ...clone(data.normalStartPlans[id]), policies: month % 2 ? ['save'] : [] };
      state.econ.cities[id].pop *= month % 2 ? 1.01 : 0.99;
    }
    state.events = [{ id: 'heatwave_peak', round: month, x: month % 2 ? 0.5 : 1.5 }];
    state = clone(state);
    equal(core.publicView(state, month * 1000 + 1).goals, goals, '계획 변경·저장 복원 뒤 목표 고정');
    equal(core.goalsOf(state, 1e9).co2Plan, goals.co2Plan, '운영 수요 인수로 목표를 덮어쓰지 않음');
    const operating = clone(state);
    operating.phase = 'run';
    equal(core.publicView(operating, month * 1000 + 2).goals, goals, '운영 단계 공개 목표 고정');
    const result = core.run(state, build, month * 1000 + 3);
    const monthly = result.econ.region;
    equal(monthly.goal.co2, goals.co2Plan, `${month}달 계획 = 실제 평가 목표`);
    equal(monthly.met.co2, monthly.co2 <= goals.co2Plan, '월 CO2 달성 판정');
    equal(result.region.ok.co2, result.region.co2 <= goals.co2, '대표 주 CO2 달성 판정');
    equal(core.publicView(state, month * 1000 + 4).goals, goals, '평가 단계 공개 목표 고정');
    equal(Object.values(state.goalPlan).map(goal => goal.co2Plan), planned, '지난달 확정 목표 보존');
    const round = core.roundsOf(state)[month - 1];
    near(goals.co2 * round.mdays / round.days, goals.co2Plan, '기존 대표 주 필드와 월 계약 단위 호환');
    previousDaily = Object.values(result.team).reduce((total, team) => total + team.dem / result.days, 0);
  }
  core.host(state, 'next', 40000);
  equal(core.publicView(state, 40001).goals.co2Plan, planned.at(-1), '종료 단계 마지막 목표 보존');
  return { planned, results: clone(state.results) };
}

const ids = region.teams.map(team => team.id);
equal(play(ids), play(ids), '같은 씨앗·입력의 36달 목표와 결과 결정성');
play(['pyeongtaek', 'anseong']);

// 목표 보존 필드가 없던 첫 달 저장도 새 계획 목표를 운영 전에 고정한다.
const legacy = core.newState('legacy-plan-co2', region.id, 0, ids, { turns: 12 });
delete legacy.goalDemand0;
legacy.round = 1;
legacy.phase = 'plan';
const legacyBefore = JSON.stringify(legacy);
const legacyGoal = clone(core.publicView(legacy, 0).goals);
equal(JSON.stringify(legacy), legacyBefore, '옛 저장의 보정 수요 복원은 상태를 변경하지 않음');
assert.ok(legacyGoal.co2Plan > 0, '옛 저장 첫 달 목표도 0이 아님');
checks++;
equal(core.run(legacy, build, 1).econ.region.goal.co2, legacyGoal.co2Plan, '옛 저장의 계획 = 평가 목표');
const detached = core.publicView(legacy, 2).goals;
detached.co2Plan = 0;
equal(core.publicView(legacy, 3).goals, legacyGoal, '공개 목표 객체 변경이 내부 확정값을 바꾸지 않음');

const seasonal = core.newState('seasonal', region.id, 0, ids);
const original = clone(seasonal.goals);
core.host(seasonal, 'next', 1);
equal(core.publicView(seasonal, 2).goals, original, '비경제 계절 모드 목표 보존');
console.log(`S3 plan CO2 checks ${checks} fail 0`);
