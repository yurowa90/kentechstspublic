'use strict';
// W4 H03/H04 독립 수용 검사. 브라우저·네트워크·AI 장기 계산 없이 Node VM만 사용.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const ROOT = path.resolve(__dirname, '../../..');
const plain = x => JSON.parse(JSON.stringify(x));
const clone = structuredClone;
let assertions = 0;
const failures = [];
const ok = (v, label) => { assertions++; assert.ok(v, label); };
const eq = (a, b, label) => { assertions++; assert.deepEqual(plain(a), plain(b), label); };
const near = (a, b, label, eps = 1e-9) => ok(Number.isFinite(a) && Math.abs(a - b) <= eps, `${label}: ${a} / ${b}`);
function test(label, fn) {
  try { fn(); } catch (e) { failures.push({ label, error: e.message }); console.error(`FAIL ${label}: ${e.stack}`); }
}
// 도우미의 CLI/36달 실행은 호출하지 않고 기존 함수를 VM에서 그대로 사용한다.
function helper(name, extra = '') {
  const filename = path.join(ROOT, 'tests/league', name + '.js');
  // measure의 strict 비교는 두 값 모두 Node realm의 JSON 객체로 받아야 한다.
  const ctx = vm.createContext({ console, Buffer, JSON, structuredClone, performance, btoa, atob,
    require: createRequire(filename), module: { exports: {} }, __dirname: path.dirname(filename), process });
  vm.runInContext(fs.readFileSync(filename, 'utf8') + '\n' + extra, ctx, { filename });
  return ctx.module.exports;
}
const size = helper('size-budget', 'module.exports = { engine, measure };');
const proposal = helper('compact-proposal');
const K = size.engine(), { leagueCore: C, buildGame: B, econ: X, ECON_DATA: D, leagueNet: N } = K;
const R = C.regionOf('south'), ids = R.teams.map(t => t.id), P = k => D.params[k].v;
// 명세의 과세 대상 3종을 명시한다. 구현처럼 facilityRate의 모든 키를 합산하지 않는다.
const facility = (gen, data = D) => {
  const p = k => data.params[k].v;
  return p('facilityShare') * ['coal', 'lng', 'smr'].reduce((s, f) => s + p('facilityRate')[f] * (gen[f] || 0), 0)
    * R.mwScale * 1000 / 1e8 / p('moneyScale');
};
function inputs(gen, policy = {}) {
  return Object.fromEntries(ids.map(id => [id, { energy: { genMWh: clone(gen), demMWh: 1000, servedMWh: 1000,
    residentDemandShare: .4, unsPct: 0, hospH: 0, co2: 100, co2Local: 100, costPerMWh: .012,
    opex: 12, spareMW: 2 }, policy: clone(policy) }]));
}
const fresh = () => X.initCities(ids, D, { seed: 'W4-fixture', months: 24 });
function game() {
  const S = C.newState('W4-fixture', R.id, 0, ids, { turns: 24, seedMode: 'fixed' });
  C.host(S, 'next', 0); S.events = [];
  for (const id of ids) S.teams[id].plan = clone(D.normalStartPlans[id]);
  return S;
}
const normal = game();
const normalBefore = clone(normal);
const base = C.run(normal, B, 0); // run 내부의 runRound→econMonth 통합 경로.

test('params 값·등급', () => {
  for (const [key, value, grade] of [['facilityShare', .65, 'O'], ['facilityRate', { coal: .7, lng: .6, smr: 1 }, 'O'],
    ['outageHomeWon', 3564, 'P'], ['outageIndustryUsd', [.35, .8], 'P']]) {
    eq(P(key), value, `${key} 명세값`); eq(D.params[key].grade, grade, `${key} 등급`);
  }
  ok(['O', 'O*', 'P', 'M', 'G'].includes(D.params.outageFx.grade), 'outageFx 등급 존재');
  near(P('outageFx'), 3564 / 2.76, '문헌 환산');
});
test('시작 지도 보정·운영 세액', () => {
  const initial = C.newState('W4-start', R.id, 0, ids, { turns: 24 });
  for (const id of ids) {
    B.selectPack(C.teamDef(R, id).pack, 'league');
    const sim = B.simulate(B.sanitize({ ...clone(D.normalStartPlans[id]), season: 'winter', seed: 0 }, 1e9), 7, { league: true });
    const gen = Object.fromEntries(Object.entries(sim.tot.by).map(([f, mwh]) => [f, mwh * 31 / 7]));
    const city = initial.econ.cities[id];
    // 시작에는 세입 이력이 없어 지원금 상쇄가 0이다. subsidy 필드는 첫 1월까지 0이므로
    // 시작 인구·재정자립도와 기존 정액 보정에서 연 지원금을 계산한다.
    const subBase = P('subBase') + P('subPerCap') * city.pop + P('subEq') * city.pop *
      Math.max(0, P('fsrRef') - Math.max(.1, Math.min(.9, D.start[id].fsr0)));
    const equalize = Math.floor(Math.min(city.equalize, subBase * P('equalizeMaxShare') / (1 - P('equalizeMaxShare'))) * 1000) / 1000;
    const subsidy = Math.round((subBase + equalize) * 1000) / 1000;
    // 시작 세입은 표준 주민·산업세 + H03 연환산 + 지원금이다. 출력 세액을 역산하지 않는다.
    near(city.revYear, 12 * (Math.round(city.pop * P('resTax') * 1000) / 1000 +
      Math.round(city.ind * P('indTax') * 1000) / 1000 + facility(gen)) + subsidy, `${id} 시작 revYear`);
    const rd = C.roundsOf(normal)[0];
    const op = C.simTeam(B, R, id, normalBefore.teams[id].plan, { season: base.season, days: base.days, seed: base.seed },
      1e9, C.modsFor(normalBefore, R, id));
    const monthly = Object.fromEntries(Object.entries(op.k.by).map(([f, n]) => [f, n * rd.mdays / rd.days]));
    near(base.econ.fiscal[id].rev.facility, facility(monthly), `${id} 정상 시작 지도 월 세액`);
  }
});
test('임의 생산·배제 연료·SMR 비율·세율 단계 독립', () => {
  for (const gen of [{ coal: 123.45, lng: 67.89, smr: 42, diesel: 999, biomass: 888 }, { diesel: 1e5, biomass: 2e5 },
    {}, { coal: 1 }, { smr: 1 }, { lng: 1 }, { smr: 1e-6 }]) {
    const out = X.monthStep(fresh(), inputs(gen), D);
    for (const id of ids) near(out.report.fiscal[id].rev.facility, facility(gen), `${id} ${JSON.stringify(gen)}`, 1e-12);
  }
  const coal = X.monthStep(fresh(), inputs({ coal: 1 }), D).report.fiscal[ids[0]].rev.facility;
  const smr = X.monthStep(fresh(), inputs({ smr: 1 }), D).report.fiscal[ids[0]].rev.facility;
  near(smr / coal, 1 / .7, 'SMR/석탄 1MWh 세액비');
  const gen = { coal: 100, lng: 200, smr: 300 };
  for (const level of [-2, 2]) {
    const out = X.monthStep(fresh(), inputs(gen, { taxRes: level, taxInd: level }), D);
    near(out.report.fiscal[ids[0]].rev.facility, facility(gen), '세율 단계 대상 아님');
  }
  // params를 VM 사본에서 바꿔도 산식의 모든 계수를 실제로 읽어야 한다.
  const data = clone(D); data.params.facilityShare.v = .4; data.params.moneyScale.v = 35;
  data.params.facilityRate.v = { coal: .8, lng: .5, smr: 1.2 };
  near(X.monthStep(fresh(), inputs(gen), data).report.fiscal[ids[0]].rev.facility, facility(gen, data), 'params 변형');
});
test('장부·12달 세입·다음 1월 revYear/지방채', () => {
  let E = fresh(); const totals = Object.fromEntries(ids.map(id => [id, { withFacility: 0, without: 0, facility: 0 }]));
  for (let m = 0; m < 12; m++) {
    const gen = { coal: 100 + m, lng: 50, smr: 10 * m }, before = E;
    const out = X.monthStep(E, inputs(gen), D); E = out.E;
    for (const id of ids) {
      const f = out.report.fiscal[id], t = totals[id], tax = facility(gen);
      near(f.cashBefore, before.cities[id].cash, '기초 현금');
      near(f.cashBefore + f.revTotal - f.expTotal, f.cashAfter, '현금 항등식');
      near(Object.values(f.rev).reduce((s, v) => s + v, 0), f.revTotal, 'Σrev = revTotal');
      const recurring = f.rev.resTax + f.rev.indTax + f.rev.subsidy;
      t.withFacility += recurring + tax; t.without += recurring; t.facility += tax;
      near(E.cities[id].revenueHistory.at(-1), recurring + tax, '월 세입 이력에 명세 세액 포함');
    }
  }
  eq(E.month, 1, '12달 후 다음 1월');
  for (const id of ids) near(E.cities[id].revenueHistory.reduce((s, v) => s + v, 0), totals[id].withFacility, '직전 12달 합');
  const january = X.monthStep(E, inputs({}), D);
  for (const id of ids) {
    near(january.E.cities[id].revYear, totals[id].withFacility, '1월 연 세입 확정');
    near(january.E.cities[id].revYear - totals[id].without, totals[id].facility, 'facility 12달 합 포함');
    near(january.E.cities[id].debtCap, Math.round(totals[id].withFacility * P('debtCapRatio') * 10) / 10, '연초 지방채 한도');
  }
});
test('SMR만 바꾼 입력의 PM·air 불변', () => {
  const a = X.monthStep(fresh(), inputs({ coal: 100, lng: 200, diesel: 30, biomass: 40, smr: 0 }), D);
  const b = X.monthStep(fresh(), inputs({ coal: 100, lng: 200, diesel: 30, biomass: 40, smr: 10000 }), D);
  ok(!Object.hasOwn(P('pmFuelW'), 'smr'), 'PM 가중에 SMR 없음');
  for (const id of ids) {
    eq(a.report.cities[id].pm25, b.report.cities[id].pm25, 'SMR 증산에도 PM 동일');
    eq(a.report.cities[id].Lparts.air, b.report.cities[id].Lparts.air, '이주용 air 동일');
    eq(a.E.cities[id].groupParts.air, b.E.cities[id].groupParts.air, '집단 air 동일');
  }
});
test('호스트 runRound 통합: SMR 생산 도시·석탄 도시 과세', () => {
  const S = game(), id = 'pyeongtaek'; B.selectPack(C.teamDef(R, id).pack, 'league');
  const plan = S.teams[id].plan, anchor = B.SITES.find(s => s.dem).tile;
  const tile = B.TILES.find(t => !t.out && t.site < 0 && !plan.builds.some(b => b.i === t.i) && !B.siteRule('smr', t) && B.routePath(anchor, t.i));
  ok(tile, '합법 SMR 입지'); plan.builds.push({ t: 'smr', i: tile.i }); plan.lines.push({ p: B.routePath(anchor, tile.i) });
  S.teams[id].research = { adopted: ['smr'] };
  S.teams[id].construction = { [`smr:${tile.i}`]: { startRound: 0, readyRound: 1 } };
  const before = clone(S), res = C.run(S, B, 0), wk = C.roundsOf(before)[0].mdays / res.days;
  const sim = C.simTeam(B, R, id, before.teams[id].plan, { season: res.season, days: res.days, seed: res.seed }, 1e9, C.modsFor(before, R, id));
  ok(sim.k.by.smr > 0, '실제 SMR 생산 > 0');
  const gen = Object.fromEntries(Object.entries(sim.k.by).map(([f, n]) => [f, n * wk]));
  near(res.econ.fiscal[id].rev.facility, facility(gen), 'SMR 생산 월 세액 전달');
  ok(res.econ.fiscal[id].rev.facility > facility({ ...gen, smr: 0 }), 'SMR 기여 > 0');
  ok(res.econ.fiscal.dangjin.rev.facility > 0, '석탄 도시 기여 > 0');
});
test('연계선 판매 후 생산지 과세·수입 제외', () => {
  const S = game(); S.teams.dangjin.price = .005;
  S.ties = R.ties.map(t => ({ ...clone(t), id: C.tieId(t), st: 'built', cap: 2 })); C.refreshGrid(S, B, true);
  const rd = C.roundsOf(S)[0], rnd = { season: rd.season, days: rd.days, seed: 7013 + (S.salt || 0) };
  const sims = Object.fromEntries(ids.map(id => [id, C.simTeam(B, R, id, S.teams[id].plan, rnd, 1e9, C.modsFor(S, R, id))]));
  const { out } = C.settle(S.ties.map(t => C.effectiveTie(S, t)), sims, Object.fromEntries(ids.map(id => [id, S.teams[id].price])), rd.days * 24, rd.days);
  const res = C.run(S, B, 0); let exporters = 0, importers = 0;
  for (const id of ids) {
    const gen = Object.fromEntries(['coal', 'lng', 'smr'].map(f => [f, Math.max(0, (sims[id].k.by[f] || 0) + (out[id].byX[f] || 0) - (out[id].saveBy[f] || 0)) * rd.mdays / rd.days]));
    near(res.econ.fiscal[id].rev.facility, facility(gen), `${id} 거래 후 생산 기준`);
    const isolated = facility(Object.fromEntries(Object.entries(sims[id].k.by).map(([f, n]) => [f, n * rd.mdays / rd.days])));
    if (out[id].co2X > out[id].saveCo2) { ok(res.econ.fiscal[id].rev.facility > isolated, '판매 추가 생산 과세'); exporters++; }
    if (out[id].saveCo2 > out[id].co2X) { ok(res.econ.fiscal[id].rev.facility < isolated, '수입 대체 감발만큼 감소'); importers++; }
  }
  ok(exporters > 0 && importers > 0, '판매·구매 사례 실제 실행');
  const empty = game(); for (const id of ids) empty.teams[id].plan = { builds: [], lines: [] };
  const off = C.run(empty, B, 0);
  for (const id of ids) near(off.econ.fiscal[id].rev.facility, 0, '자체 공급 0: 계통 수입 과세 없음');
});
// 별도 UI VM. 실제 두 서랍 함수를 노출할 뿐 계산 함수·경제 모드 분기를 대체하지 않는다.
const uiCtx = vm.createContext({ console, structuredClone, performance, document: { documentElement: {}, addEventListener() {} },
  addEventListener() {}, KCP: { route() {}, on() {}, esc: String, leagueNet: {}, gradeWords: x => x } });
uiCtx.window = uiCtx;
for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core', 'league']) {
  let source = fs.readFileSync(path.join(ROOT, 'ui', name + '.js'), 'utf8');
  if (name === 'league') source = source.replace(/\}\)\(\);\s*$/, `
    const fixture = (V, id) => { L = { team: id, room: V.room, snap: V, role: 'solo', interview: {} }; };
    KCP.__result = (V, res, id) => { fixture(V, id); return resultHTML(V, res); };
    KCP.__city = (V, id) => { fixture(V, id); return cityHTML(V); };
  })();`);
  vm.runInContext(source, uiCtx, { filename: `ui/${name}.js` });
}
function damageLine(html) { return html.match(/<p id="lg-outage-damage">([^<]*)<\/p>/)?.[1]; }
function range(line) { return line?.match(/([\d,.]+)~([\d,.]+)억 원/)?.slice(1).map(x => Number(x.replaceAll(',', ''))); }
const displayNumber = (v, digits) => v.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
test('H04 경제 모드 resultHTML: 범위·월 환산·기기 표시만', () => {
  const V = plain(C.publicView(normal, 0)), res = V.results.at(-1), id = ids[0];
  ok(V.econ && res.month, '경제 모드 fixture');
  res.team[id].residentDemandShare = .4;
  // 명세의 월 환산·원/kWh 식에서 먼저 구한다. 렌더링 결과를 기대값으로 쓰지 않는다.
  const perMWh = P('outageIndustryUsd').map(usd => C.roundsOf(V)[res.round - 1].mdays / res.days *
    R.mwScale * 1000 * (.4 * P('outageHomeWon') + .6 * usd * P('outageFx')) / 1e8);
  const straddling = 10 / ((perMWh[0] + perMWh[1]) / 2);
  for (const [uns, side] of [[12.5, '이상'], [.125, '미만'], [straddling, '경계 혼합']]) {
    res.team[id].uns = uns;
    const expected = perMWh.map(v => v * uns);
    ok(side === '이상' ? expected.every(v => v >= 10) : side === '미만' ? expected.every(v => v < 10) :
      expected[0] < 10 && expected[1] > 10, `10억 ${side} fixture`);
    const before = clone(V), html = uiCtx.KCP.__result(V, res, id), line = damageLine(html), values = range(line);
    ok(line && values?.length === 2, '실제 경제 resultHTML에 정전 피해 한 줄');
    eq((html.match(/id="lg-outage-damage"/g) || []).length, 1, '피해 줄 중복 없음');
    ok(values[0] <= values[1], '하한 ≤ 상한');
    const formatted = expected.map(v => displayNumber(v, v >= 10 ? 0 : 1));
    eq(values, formatted.map(v => Number(v.replaceAll(',', ''))), `10억 ${side} 산식·반올림`);
    ok(line.startsWith(`정전 피해 추정 ${formatted.join('~')}억 원`), '범위 문자열도 표시 자릿수 일치');
    ok(line.includes('현금에는 안 들어감'), '현금 제외 문구');
    ok(line.includes('가구 대상 지불의사 설문 Jin(2025)·제조업 조사 Jin 외(2024)'), '지정 출처 문구');
    eq(V, before, '표시 후 공개 값·현금 전체 불변');
  }
});
test('H04 미공급 0·음수는 없음 한 줄, 자료 누락은 별도', () => {
  const V = plain(C.publicView(normal, 0)), res = V.results.at(-1), id = ids[0];
  res.team[id].residentDemandShare = .4;
  for (const uns of [0, -1]) {
    res.team[id].uns = uns;
    const before = clone(V), html = uiCtx.KCP.__result(V, res, id);
    eq(damageLine(html), '정전 피해 추정: 이번 달 미공급 없음', `uns=${uns} 없음 문구`);
    eq((html.match(/id="lg-outage-damage"/g) || []).length, 1, '없음도 한 줄');
    eq(V, before, '없음 표시 후 공개 값·현금 불변');
  }
  res.team[id].uns = 1;
  delete res.team[id].residentDemandShare;
  ok(damageLine(uiCtx.KCP.__result(V, res, id))?.includes('자료 없음'), '옛 결과의 몫 누락은 피해 0과 구별');
});
test('H03 결과·도시 서랍: 시설세 0 생략·양수 표시', () => {
  const V = plain(C.publicView(normal, 0)), res = V.results.at(-1), id = ids[0];
  const positive = facility({ coal: 123.45, lng: 67.89, smr: 42 });
  ok(positive > 0, '명세 산식으로 양수 세액 fixture');
  for (const value of [0, positive]) {
    res.econ.fiscal[id].rev.facility = value;
    V.econ.report.fiscal[id].rev.facility = value;
    const before = clone(V), result = uiCtx.KCP.__result(V, res, id), city = uiCtx.KCP.__city(V, id);
    const resultLine = result.match(/<p id="lg-result-facility">([^<]*)<\/p>/)?.[1];
    const facilityRow = city.match(/<div><dt>지역자원시설세[^<]*<\/dt><dd>([^<]*)<\/dd><\/div>/)?.[1];
    eq(!!resultLine, value > 0, `시설세 ${value}: 결과 줄 표시 여부`);
    eq(!!facilityRow, value > 0, `시설세 ${value}: 도시 장부 행 표시 여부`);
    if (value > 0) {
      ok(resultLine.startsWith(`지역자원시설세 ${displayNumber(positive, 3)}억`), '결과 세액 표시 반올림');
      eq(facilityRow, `${displayNumber(positive, 2)}억`, '도시 세액 표시 반올림');
    } else {
      ok(!city.includes('지역자원시설세'), '0이면 도시의 시설세 이름도 생략');
    }
    eq(V, before, '두 서랍 표시 후 공개 값·현금 불변');
  }
});
test('D77 생산 축약·시안2 행 사전의 econ 값에 facility 무손실', () => {
  const V = plain(C.publicView(normal, 0)), before = clone(V);
  // size-budget.measure는 production compact→canonical→expand 전체 깊은 비교를 수행한다.
  const measured = size.measure(K, normal), prod = measured.compact;
  // 이 fixture는 _cp: 2, _refs: 5로 econ.report.score·econ.scoreState.totals를 접는다.
  // econ.report.offers는 빈 배열이라 접지 않는다. 참조 없는 봉투는 옛 판 1을 유지한다.
  ok(prod._cp === 1 && !Object.hasOwn(prod, '_refs') ||
    prod._cp === 2 && Number.isInteger(prod._refs) && prod._refs >= 1, '생산 압축 판수·참조 비트 형식');
  ok(prod.keys.some(keys => keys.includes('econ')), '생산 행 사전에 보고서 econ 키');
  const restored = N.expandSnapshot(JSON.parse(N.canonical(prod)));
  eq(restored, V, '생산 공개 상태 전체 무손실');
  const packed = proposal.compactV2(V), proposalRestored = proposal.expandV2(JSON.parse(N.canonical(packed)), N);
  ok(packed._cp.keys.some(keys => keys.includes('econ')), '시안2 행 사전에 보고서 econ 키');
  eq(proposalRestored, V, '시안2 전체 무손실');
  for (const out of [restored, proposalRestored]) for (const id of ids) {
    ok(Object.hasOwn(out.results.at(-1).econ.fiscal[id].rev, 'facility'), '중첩 rev.facility 존재');
    near(out.results.at(-1).econ.fiscal[id].rev.facility, base.econ.fiscal[id].rev.facility, '결과 보고서 금액 보존');
    near(out.econ.report.fiscal[id].rev.facility, base.econ.fiscal[id].rev.facility, '현재 보고서 금액 보존');
  }
  eq(V, before, '축약 함수 원본 보존');
});
console.log(JSON.stringify({ suite: '36-h03-h04', assertions, failures: failures.length, details: failures }));
process.exitCode = failures.length ? 1 : 0;
