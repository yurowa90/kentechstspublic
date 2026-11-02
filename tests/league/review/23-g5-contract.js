"use strict";
// G5: 시작 탄소 실운전, SMR 축척·복수 착공, 부채 단계의 사람과 같은 정책 요청.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '../../..'), clone = x => JSON.parse(JSON.stringify(x));
function load(ai = true) {
  const ctx = vm.createContext({ console, document: { documentElement: {} }, KCP: { route() {}, on() {}, esc: x => x } }); ctx.window = ctx;
  vm.runInContext('Math.random=()=>{throw Error("unseeded random")}', ctx);
  for (const f of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core', ...(ai ? ['league-ai'] : [])])
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'ui', f + '.js'), 'utf8'), ctx);
  return ctx.KCP;
}
const K = load(), { leagueCore: C, buildGame: B, econ: X, ECON_DATA: D, TECH_DATA: T, leagueAI: AI } = K;
const R = C.regionOf('south'), ids = R.teams.map(t => t.id);
let checks = 0;
const ok = (v, text) => { assert.ok(v, text); checks++; };
const near = (a, b, label, tolerance = 1e-9) => ok(Number.isFinite(a) && Math.abs(a - b) < tolerance, `${label}: ${a}/${b}`);
const S = C.newState('g5-contract', R.id, 0, ids, { turns: 36 }), starts = {};
const noAI = load(false).leagueCore.newState('g5-other-seed', R.id, 0, ids, { turns: 12 });
for (const id of ids) {
  B.selectPack(C.teamDef(R, id).pack, 'league');
  const plan = D.normalStartPlans[id], clean = B.sanitize(clone(plan), Number.MAX_VALUE);
  ok(JSON.stringify(clean.builds) === JSON.stringify(plan.builds), '시작 기준 합법 설비 보존 ' + id);
  ok(JSON.stringify(clean.lines) === JSON.stringify(plan.lines), '시작 기준 합법 전선 보존 ' + id);
  // 모델의 반올림 전 실제 공급·탄소를 독립적으로 읽는다.
  const sim = B.simulate({ ...clean, season: 'winter', seed: 0 }, 7, { league: true });
  const supplied = Math.max(0, sim.tot.dem - sim.unsTotal), intensity = (sim.co2 + sim.unsTotal * D.params.normalCo2.v) / sim.tot.dem;
  ok(plan.builds.length === 0 && (supplied > 1e-6) === B.SITES.some(s => s.kind === 'plant'), '지도 기존 설비 유무와 공급 일치 ' + id);
  near(supplied + sim.unsTotal, sim.tot.dem, '공급·미공급 총량 보존 ' + id);
  near(S.econ.cities[id].co2Intensity0, intensity, '실제 소비 탄소/공급 MWh ' + id);
  near(noAI.econ.cities[id].co2Intensity0, intensity, '씨앗·게임 길이·AI 로드 독립 ' + id);
  ok(S.teams[id].plan === null, '기준 계획은 플레이어 자산에 설치하지 않음 ' + id);
  starts[id] = { intensity, carbonPart: X.score(S.econ).by[id].parts.co2, co2: sim.co2, supplied };
}
// 공급0인 달에는 직전 탄소 성과를 유지한다.
const initial = clone(S.econ), empty = Object.fromEntries(ids.map(id => [id, { energy: { demMWh: 100, servedMWh: 0, co2: 0, unsPct: 100 } }]));
for (const id of ids) initial.cities[id].co2Intensity = 0.1;
const zero = X.monthStep(initial, empty);
for (const id of ids) near(zero.E.cities[id].co2Intensity, .1, '공급0 직전 탄소 집약도 유지 ' + id);
near(T.params.smrMW.v, 4 * 170 / 230, 'SMR 발전소 4모듈 축척');
near(T.params.smrCost.v / T.params.smrMW.v, (150 / 20) * (8000 / 4500), 'G7 DOE FOAK MW당 환산 단가');
near(T.params.smrMin.v, .8, '최소 출력비 유지');
const card = T.cards.find(c => c.id === 'smr'), oldMW = T.params.smrMW.v;
ok(card.need === 36 && card.numbers.need.v === 36 && card.numbers.need.grade === 'G', 'G7 SMR need36·등급·메타데이터 복원');
ok(T.params.smrCost.grade === 'M' && T.params.smrCost.refs.includes('I34'), 'G7 FOAK 비용 M·DOE 출처 연결');
try { T.params.smrMW.v = 4.25; ok(card.eff.includes('4.25'), 'SMR 카드 현재 자료값 참조'); B.selectPack('pyeongtaek', 'league'); ok(B.BLD.smr.spec.includes('4.25'), '설비 현재 자료값 참조'); }
finally { T.params.smrMW.v = oldMW; }
C.host(S, 'next', 100);
for (const id of ids) S.teams[id].token = 'g5-test-token';
const target = ids[1];
S.econ.cities[target].cash = 10000;
S.teams[target].research.stage.smr = 'done'; S.teams[target].research.adoptR.smr = 1;
B.selectPack(target, 'league');
const sites = B.TILES.filter(tile => !B.siteRule('smr', tile)).slice(0, 2);
const multi = C.reduce(S, { type: 'plan', team: target, token: 'g5-test-token', rev: 1, plan: { builds: sites.map(t => ({ t: 'smr', i: t.i })), lines: [] } }, 101, B);
ok(multi.ok && Object.keys(S.teams[target].construction).length === 2, '도시당 1기 제한 없음: 2개 발전소 별도 착공');
for (const style of ['careful', 'balanced', 'bold']) for (const stage of ['warn', 'crisis']) {
  const draft = clone(S), city = draft.econ.cities[target];
  city.cash = -city.revYear * (stage === 'warn' ? D.params.debtWarnRatio.v + .01 : D.params.debtCapRatio.v + .01);
  draft.teams[target].econPol = { taxRes: 0, taxInd: -2, service: 2, incentive: 0 };
  const before = JSON.stringify(draft), answer = AI.plan(draft, R, target, B, style);
  ok(JSON.stringify(draft) === before, 'AI 원 상태 불변');
  ok(X.debtStage(city) === stage, '재정 보고와 AI 동일 단계');
  ok(answer.econPol.taxRes === 1 && answer.econPol.taxInd === 1, '부채시 증세');
  ok(answer.econPol.service === D.params.aiDebtPolicy.v[style][stage], '성향별 서비스 대응');
  if (stage === 'crisis') ok(JSON.stringify(answer.plan.builds) === JSON.stringify(draft.teams[target].plan.builds), '위기시 새 건설 보류');
  ok(answer.plan.rq.length === 0 && !answer.ties.some(t => ['accept', 'propose'].includes(t.type)), '새 연구·연계선 보류');
  for (const msg of [{ type: 'econ', ...answer.econPol }, { type: 'plan', rev: draft.teams[target].rev + 1, plan: answer.plan }])
    ok(C.reduce(draft, { team: target, token: 'g5-test-token', ...msg }, 102, B).ok, '사람과 같은 요청으로 승인');
}
const safe = clone(S);
safe.teams[target].plan = AI.plan(safe, R, target, B, 'balanced').plan;
safe.econ.cities[target].cash = -safe.econ.cities[target].revYear * (D.params.debtWarnRatio.v + .01);
const held = AI.plan(safe, R, target, B, 'balanced').plan;
ok(JSON.stringify(held.builds) === JSON.stringify(safe.teams[target].plan.builds), '주의·충분한 공급이면 선택 건설 보류');
console.log('G5 시작 탄소', JSON.stringify(starts));
console.log(`G5 contract pass ${checks} fail 0`);
module.exports = { load };
