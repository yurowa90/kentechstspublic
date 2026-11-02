'use strict';
// 결정문 D-73(B80)·D-74(C1)·D-79(H2)의 독립 회귀 검사. 브라우저/네트워크 없음.
// 옛 .4567/선형100점/수입0/HVDC손실.012 → 결정의 .4173/B80/C1/용량1.5.
// KCP_ROOT=<git show fa472b4로 꺼낸 폴더>로 같은 검사와 같은 기대값을 실행한다.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createHash } = require('node:crypto');
const { withoutD90, withoutGroupOwn } = require('./d90-public-contract');
const ROOT = process.env.KCP_ROOT || path.resolve(__dirname, '../../..');
const clone = x => structuredClone(x);
const plain = x => JSON.parse(JSON.stringify(x));
const read = name => fs.readFileSync(path.join(ROOT, 'ui', `${name}.js`), 'utf8');
function expose(source, code) {
  assert.match(source, /\}\)\(\);\s*$/);
  return source.replace(/\}\)\(\);\s*$/, `${code}\n})();`);
}
function load({ techParam } = {}) {
  const storage = new Map();
  const ctx = vm.createContext({ console, structuredClone, performance,
    document: { documentElement: {}, addEventListener() {} }, addEventListener() {},
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    KCP: { route() {}, on() {}, esc: s => String(s), leagueNet: {} } });
  ctx.window = ctx;
  vm.runInContext('Math.random = () => { throw Error("unseeded random"); };', ctx);
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core', 'league']) {
    let source = read(name);
    if (name === 'tech-data' && techParam) {
      // 자료 초기화 전에 param 하나만 변경. 카드 문구나 기대 산식은 고치지 않는다.
      const re = new RegExp(`(${techParam.key}: p\\()([\\d.]+)`);
      assert.match(source, re, '기술 param fixture 연결점');
      source = source.replace(re, (_, prefix) => prefix + techParam.value);
    }
    if (name === 'build') {
      // 실제 startRun의 계산·rememberTrial까지 실행하고 애니메이션 직전 반환한다.
      // GUI mount를 대신하는 메모리 어댑터뿐이며 계산 분기·함수 본문은 그대로다.
      const boundary = '// 화면용: 디젤 건물 번호 → 비트 위치';
      assert.equal(source.split(boundary).length, 2);
      source = source.replace(boundary, `return res;\n    ${boundary}`);
      source = expose(source, `KCP.__trial = (st, opts) => {
        S = { st, opts, run: null, root: { querySelector: () => null }, alive: false };
        return startRun(7);
      };`);
    }
    if (name === 'econ') source = expose(source, 'KCP.__carbonScore = carbonScore;');
    if (name === 'league-core') source = expose(source, 'KCP.__lastRun = () => lastRun;');
    if (name === 'league') source = expose(source, 'KCP.__techEffectText = techEffectText;');
    vm.runInContext(source, ctx, { filename: `ui/${name}.js` });
  }
  const K = ctx.KCP;
  return { K, B: K.buildGame, C: K.leagueCore, D: K.ECON_DATA, T: K.TECH_DATA, storage };
}
const app = load(), { K, B, C, D, T } = app;
const R = C.regionOf('south'), ids = R.teams.map(t => t.id);
const results = [];
let assertions = 0;
const eq = (a, b, label) => { assert.deepEqual(plain(a), plain(b), label); assertions++; };
const ok = (v, label) => { assert.ok(v, label); assertions++; };
const near = (a, b, label, eps = 1e-9) => {
  ok(Number.isFinite(a) && Math.abs(a - b) <= eps, `${label}: ${a} / ${b} (±${eps})`);
};
function test(group, name, fn) {
  try { fn(); results.push({ group, name, pass: true }); }
  catch (e) { results.push({ group, name, pass: false, error: e.message }); console.error(`FAIL ${group} ${name}: ${e.message}`); }
}
// D-73의 세 기준점을 잇는 꺾은선. 구현의 carbonScore/점수 결과를 oracle로 읽지 않는다.
function line(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [right, y1] = points[i], [left, y0] = points[i - 1];
    if (x <= right) return y0 + (x - left) * (y1 - y0) / (right - left);
  }
  return points.at(-1)[1];
}
function carbon(I, I0) {
  const absolute = line([[0, 100], [.25038, 80], [.82, 0]], I);
  const relative = Number.isFinite(I0) && I0 > 0 ? line([[0, 0], [.4, 80], [1, 100]], 1 - I / I0) : 0;
  return Math.max(absolute, relative);
}
for (const [key, value, grade] of [
  ['co2IntDef', .4173, 'O'], ['normalCo2', .4173, 'O'], ['co2IntRef', .4173, 'O'],
  ['scoreCo2Best', .25038, 'M'], ['scoreCo2Mid', 80, 'G'], ['scoreCo2RelCut', .4]
]) test('D73-params', key, () => {
  near(D.params[key]?.v, value, `${key} 결정 근거값`);
  if (grade) eq(D.params[key].grade, grade, `${key} 근거 등급`);
});
const Icases = [.82, .25038, 0, -.01, .82 - 1e-8, .82 + 1e-8, .25038 - 1e-8, .25038 + 1e-8];
for (const I of Icases) for (const I0 of [undefined, null, 0, -1, .4173, 1.2])
  test('D73-score', `I=${I}, I0=${I0}`, () => near(K.__carbonScore({ co2Intensity: I, co2Intensity0: I0 }, D), carbon(I, I0), '독립 B80'));
for (const r of [0, .4 - 1e-8, .4, .4 + 1e-8, 1]) test('D73-score', `r=${r}`, () => {
  const I0 = 1.2, I = I0 * (1 - r);
  near(K.__carbonScore({ co2Intensity: I, co2Intensity0: I0 }, D), carbon(I, I0), '독립 상대 눈금 경계');
});
test('D73-score', '당진형 10% 감축도 보상', () => {
  const I0 = 1.2, score = K.__carbonScore({ co2Intensity: I0 * .9, co2Intensity0: I0 }, D);
  near(score, 20, '절대 최악 .82보다 높아도 상대10%/.4×80=20'); ok(score > 0);
});
function state(monthly = true, plans = 'empty', ties = false) {
  const S = C.newState('D737479', R.id, 0, ids, monthly ? { turns: 12, seedMode: 'fixed' } : undefined);
  C.host(S, 'next', 0); S.events = [];
  for (const id of ids) {
    S.teams[id].plan = plans === 'empty' ? { builds: [], lines: [], policies: [] } : clone(D.normalStartPlans[id]);
    S.teams[id].price = .02;
  }
  if (ties) S.ties = R.ties.filter(t => t.a === 'dangjin' && t.b === 'pyeongtaek' || t.b === 'dangjin' && t.a === 'pyeongtaek')
    .map(t => ({ ...clone(t), id: C.tieId(t), st: 'built', cap: 2 }));
  return S;
}
function hourlyImports(raw, share) {
  const amounts = [];
  for (let k = 0; k < raw.H; k++) {
    let shortage = 0;
    for (let ti = 0; ti < raw.NT; ti++) shortage += raw.hrUns[k * raw.NT + ti];
    amounts.push(Math.min(Math.fround(shortage), raw.hrDem[k] * share));
  }
  return amounts;
}
const total = a => a.reduce((s, x) => s + x, 0);
for (const [key, value] of [['gridImportShare', .5], ['gridImportMarkup', 1.5]]) test('D74-params', key, () => {
  near(D.params[key]?.v, value, 'C1 근거값'); eq(D.params[key].grade, 'G', '수입 상한·할증은 게임 가정');
});
// 시간별 실제 운영은 lastRun의 기존 메모리 배열과 독립 settle 결과를 비교한다.
// 새 공개 필드나 수입량을 읽는 테스트 전용 구현 필드는 만들지 않는다.
const operations = [];
for (const connected of [false, true]) test('D74-operation', connected ? '이웃 거래 뒤 계통' : '거래 없는 6도시', () => {
  const S = state(true, connected ? 'normal' : 'empty', connected);
  const before = clone(S); C.refreshGrid(before, B, true);
  const rd = C.roundsOf(before)[before.round - 1], rnd = { season: rd.season, days: rd.days, seed: 7013 };
  const sims = {}, prices = {};
  for (const id of ids) {
    const plan = before.teams[id].plan;
    sims[id] = C.simTeam(B, R, id, plan, rnd, Math.max(C.budget(before, id), C.capexOf(B, R, id, plan)), C.modsFor(before, R, id));
    prices[id] = before.teams[id].price;
  }
  const neighbors = C.settle(before.ties.filter(t => t.st === 'built').map(t => C.effectiveTie(before, t)), sims, prices, 168, 7);
  const result = C.runRound(S, B), hourly = K.__lastRun();
  operations.push({ connected, sims, neighbors, result, hourly });
  let neighborFill = 0, capped = 0, fullyFilled = 0;
  for (const id of ids) {
    const s = sims[id], n = neighbors.out[id], actual = hourly.teams[id], imports = [];
    for (let k = 0; k < s.H; k++) {
      const remainder = Math.max(0, s.uns[k] - n.del[k]);
      const amount = actual.del[k] - n.del[k];
      const expected = Math.min(remainder, s.dem[k] * .5);
      // D-74의 시간별 상한 자체는 수요×.5로 독립 고정; Float32 del 배열 반올림만 허용.
      near(amount, expected, `${id}/${k} 시간별 이웃 뒤 수입`, 3e-6);
      ok(amount >= -3e-6 && amount <= s.dem[k] * .5 + 3e-6 && amount <= remainder + 3e-6, '상한·남은 부족만 보충');
      neighborFill += n.del[k];
      if (remainder > s.dem[k] * .5 + .01) capped++;
      if (remainder > .01 && remainder < s.dem[k] * .5 - .01) fullyFilled++;
      imports.push(expected);
    }
    const imported = total(imports), r = result.team[id];
    // D-74는 계통 수입을 공개 imp에 합칠지 정하지 않는다. imp 의미를 가정하지 않고
    // 시간별 이웃 뒤 보충과 최종 부족의 보존으로 총 계통 공급량을 검산한다.
    near(r.uns, Math.max(0, s.k.uns - total(n.del) - imported), '총 계통 보충 뒤 남은 부족', .0051);
    near(r.cost.fuel, s.k.fuel + n.fuelX - n.saveFuel + imported * D.params.normalCost.v * 1.5, '수입량×기준원가×1.5', .0051);
    eq(r.co2Prod, Math.round(s.k.co2 + n.co2X - n.saveCo2), '지역 생산 배출에 계통 기여0');
    eq(r.co2Cons, Math.round(s.k.co2 - n.saveCo2 + n.co2In + imported * .4173), '국가 계수는 소비 배출만');
    const input = C.econInput(S, R, id, r, 1).energy;
    ok(!Object.hasOwn(input.genMWh, 'import'), 'PM용 발전량에 외부 계통 없음');
    if (!connected) {
      // H03의 호스트 내부 생산 입력에는 무발전 SMR도 명시적 0으로 포함된다.
      eq(input.genMWh, { coal: 0, lng: 0, diesel: 0, biomass: 0, smr: 0 }, '빈 도시 생산·PM 발전량0');
      eq(r.co2Prod, 0, '계통 소비를 지역 생산으로 세지 않음');
    }
  }
  ok(capped > 0, '시간별 수입 상한에 걸리는 시간 실제 실행');
  if (connected) { ok(neighborFill > 0, '실제 이웃 부족 보충 실행'); ok(fullyFilled > 0, '50%보다 작은 남은 부족 보충 실행'); }
});
// 비용·소비 탄소를 별도 사례로 검사하여 시간별 단언 실패가 회계 검사를 가리지 않게 한다.
for (const op of operations) {
  const imported = id => {
    const s = op.sims[id], n = op.neighbors.out[id];
    return total(Array.from({ length: s.H }, (_, k) => Math.min(Math.max(0, s.uns[k] - n.del[k]), s.dem[k] * .5)));
  };
  test('D74-cost', `${op.connected ? '이웃 뒤' : '거래 없음'} 수입 단가`, () => {
    for (const id of ids) {
      const s = op.sims[id], n = op.neighbors.out[id];
      near(op.result.team[id].cost.fuel, s.k.fuel + n.fuelX - n.saveFuel + imported(id) * D.params.normalCost.v * 1.5,
        `${id} 수입 비용 독립 검산`, .0051);
    }
  });
  test('D74-carbon', `${op.connected ? '이웃 뒤' : '거래 없음'} 소비 배출만 국가 계수`, () => {
    for (const id of ids) {
      const s = op.sims[id], n = op.neighbors.out[id], r = op.result.team[id];
      eq(r.co2Cons, Math.round(s.k.co2 - n.saveCo2 + n.co2In + imported(id) * .4173), `${id} 수입 소비 배출`);
      eq(r.co2Prod, Math.round(s.k.co2 + n.co2X - n.saveCo2), `${id} 수입 생산 배출0`);
    }
  });
}
test('D74-pm', '운영 수입은 지역 생산·PM 증가0', () => {
  const S = state(), result = C.run(S, B, 0);
  for (const id of ids) {
    ok(result.team[id].uns < result.team[id].dem, '빈 계획의 외부 공급 발생(imp 필드 의미와 독립)');
    eq(result.team[id].co2Prod, 0, '지역 생산 배출0');
    near(result.econ.cities[id].pm25.own, 0, '수입의 지역 PM 기여0');
  }
});
for (const monthly of [true, false]) for (const plans of ['empty', 'normal'])
  test('D74-trial', `${monthly ? '경제' : '계절4라운드'} ${plans}`, () => {
    // 계절 모드는 봄·여름·가을·겨울 네 라운드 모두 실제/시험 수입0 확인.
    for (const round of monthly ? [1] : [1, 2, 3, 4]) {
      const S = state(monthly, plans); S.round = round;
      const result = C.runRound(clone(S), B);
      const operating = clone(S); if (monthly) C.refreshGrid(operating, B, true);
      const rd = C.roundsOf(operating)[round - 1];
      for (const id of ids) {
        B.selectPack(C.teamDef(R, id).pack, 'league');
        const plan = B.sanitize(clone(S.teams[id].plan), 1e9);
        Object.assign(plan, { seed: 7000 + round * 13, season: rd.season });
        const mods = C.modsFor(operating, R, id);
        const raw = B.simulate(clone(plan), 7, { league: true, mods });
        const trial = K.__trial(plan, { league: true, trialScope: id, leagueRound: () => rd, leagueMods: () => C.trialMods(C.publicView(S, 0), R, id) });
        // 실제 공개 결과의 정전율은 0.01%p 반올림; 시간별 상한은 위에서 별도 엄격 검사.
        near(100 * trial.unsTotal / trial.tot.dem, result.team[id].unsPct, `${id} 실제 startRun 시험=운영`, .0051);
        const expected = monthly ? total(hourlyImports(raw, .5)) : 0;
        near(trial.unsTotal, Math.max(0, raw.unsTotal - expected), `${id} 모드별 시험 잔여 부족`, 1e-7);
        if (!monthly) {
          near(total(K.__lastRun().teams[id].del), 0, '계절 실제 공급 보충0(이웃 없는 조건)');
          near(result.team[id].imp, 0, '계절 실제 이웃 수입0');
        }
        const saved = Object.values(JSON.parse(app.storage.get('kcp-build-trial-v1'))).find(t => t.scope === id);
        near(saved.unsPct, 100 * trial.unsTotal / trial.tot.dem, '시험 저장 경로도 보정값');
      }
    }
  });
test('D74-gridFill', '원본 불변·시간별 보충·회계·필드 집합', () => {
  const S = state(), id = 'pyeongtaek'; B.selectPack(C.teamDef(R, id).pack, 'league');
  const raw = B.simulate({ ...B.sanitize(S.teams[id].plan, 1e9), seed: 7013, season: 'winter' }, 7, { league: true });
  const before = clone(raw), expected = hourlyImports(raw, .5), filled = C.gridFill(raw), imported = total(expected);
  assert.deepEqual(clone(raw), before, 'gridFill 입력의 모든 중첩 값·배열 불변'); assertions++;
  ok(filled !== raw && filled.hrUns !== raw.hrUns, '별도 결과·배열');
  eq(Object.keys(filled).sort(), Object.keys(raw).sort(), '시뮬레이션 필드 집합 불변');
  near(raw.unsTotal - filled.unsTotal, imported, '독립 시간별 수입 합계');
  near(filled.cost.total - raw.cost.total, imported * D.params.normalCost.v * 1.5, '시험 수입 비용');
  near(filled.co2 - raw.co2, imported * .4173, '시험 소비 배출');
  near(filled.tot.co2, raw.tot.co2, '시험 지역 생산 배출 불변');
  eq(filled.tot.by, { ...raw.tot.by, import: raw.tot.by.import + imported }, '수입만 증가, 지역 연료 발전 불변');
  for (let k = 0; k < raw.H; k++) near(filled.hrSup[k] - raw.hrSup[k], expected[k], `시험 공급 ${k}`, 3e-6);
});
// 공개 스키마는 fa472b4의 동일 경제 모드 fixture에서 추출한 고정 키 집합과 비교한다.
// 숫자·파생식 기대값과 달리 호환성 검사의 기준은 변경 전 공개 형식이다.
function allPublicKeyPaths(value) {
  const keys = new Set();
  const walk = (x, prefix) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach(item => walk(item, prefix + '[]')); return; }
    for (const [key, child] of Object.entries(x)) {
      const at = prefix + '.' + key; keys.add(at); walk(child, at);
    }
  };
  walk(value, ''); return [...keys].sort();
}
function publicKeys(V, allowed = new Set()) {
  const allKeys = allPublicKeyPaths(V).filter(key => !allowed.has(key));
  const r = V.results.at(-1), id = ids[0];
  return { allKeyCount: allKeys.length, allKeyHash: createHash('sha256').update(JSON.stringify(allKeys)).digest('hex'),
    ...Object.fromEntries(Object.entries({ root: V, team: V.teams[id], result: r, resultTeam: r.team[id],
    econ: V.econ, city: V.econ.cities[id], cost: r.team[id].cost }).map(([k, v]) => [k, Object.keys(v).sort()])) };
}
if (process.argv.includes('--public-keys')) {
  const S = state(); C.run(S, B, 0); console.log(JSON.stringify(publicKeys(C.publicView(S, 0)))); process.exit(0);
}
const LEGACY_KEYS = {
  "root": ["active","econ","ends","events","goals","grid","log","now","phase","region","results","rev","room","round","rounds","sid","teams","ties","v"],
  "team": ["base","budget","crit","econPol","fcx","fixed","hist","left","online","plan","price","ready","research","resp","rev","rs","seatVersion","seated","trialGrid"],
  "result": ["co2Attribution","days","demandBefore","econ","events","flow","month","region","round","season","seed","team","tieDown","year"],
  "resultTeam": ["bioCo2","co2Cons","co2NoEvent","co2Prod","cost","cp","cpList","curt","curtailMWh","dem","earn","exp","exportFuel","grid","hospH","idle","imp","isolated","ledger","loss","outH","pay","renPct","residentDemandShare","sat","spareMW","sub","unlinked","uns","unsPct"],
  "econ": ["before","cities","eduSpeed","intl","intlActive","month","offers","previousScore","report","score","scoreState","speeds","t","totals","year"],
  "city": ["A","L","approval","approval0","cash","co2pc","curtailMWh","debtCap","grid","groupParts","groups","hist","ind","ind0","lagA","lagL","name","policy","pop","pop0","research","shares","unsS"],
  "cost": ["capex","fuel","inv","loss","opex","policy","research","resp","rfix","stock","ties","total","trade"],
  "allKeyCount": 5161,
  "allKeyHash": "9a4825d2426c95f50f75e4c844831c23910f5da6a78a3d53eab8faa1cc43a148"
};
test('D74-public', '승인된 rev.facility·D-90 정산·집단 전용 항 이외 새 공개 필드0', () => {
  const S = state(); C.run(S, B, 0);
  const V = C.publicView(S, 0);
  // H03의 rev.facility 경로와 검증된 D-90 정산·집단 전용 항만 승인한다.
  // 나머지는 fa472b4의 해시를 그대로 써서 예상 밖 중첩 공개 키도 계속 검출한다.
  const allowed = new Set(ids.flatMap(id => [`.econ.report.fiscal.${id}.rev.facility`, `.results[].econ.fiscal.${id}.rev.facility`]));
  const actual = new Set(allPublicKeyPaths(V));
  ok([...allowed].every(key => actual.has(key)), '승인된 facility 경로도 실제로 공개됨');
  eq(publicKeys(withoutGroupOwn(withoutD90(V)), allowed), LEGACY_KEYS,
    'fa472b4 대비 rev.facility·D-90 정산·집단 전용 항만 허용(배열 인덱스 정규화)');
});
for (const [key, value] of [['hvdcCap', 1.5], ['hvdcCost', 1.3]]) test('D79-params', key, () => near(T.params[key]?.v, value, 'H2 근거값'));
function tieFixture() {
  const S = state(), [a, b] = ids;
  S.teams[a].research = { adopted: ['hvdc'] };
  const ordinary = { a, b, cap: 4, kind: 'land' };
  return { S, a, ordinary, hvdc: { ...ordinary, kind: 'hvdc' } };
}
test('D79-line', 'HVDC 종류 선만1.5배, 일반선 불변', () => {
  const { S, ordinary, hvdc } = tieFixture();
  for (const kind of [undefined, 'land', 'sea', 'HVDC', 'hvdc-other'])
    near(C.effectiveTie(S, { ...ordinary, kind }).cap, 4, `${kind}: 정확히 hvdc인 선 이외 불변`);
  near(C.effectiveTie(S, hvdc).cap, 4 * 1.5, 'HVDC 선만1.5배');
});
test('D79-loss', 'HVDC 손실=기본 손실, 초전도 결합', () => {
  const { S, a, hvdc } = tieFixture();
  near(C.effectiveTie(S, hvdc).loss, C.TIE_LOSS, 'HVDC 기본 손실');
  S.teams[a].research.adopted.push('scable');
  near(C.effectiveTie(S, hvdc).loss, C.TIE_LOSS * T.params.scableLoss.v, '초전도 결합 손실');
});
test('D79-cap', '초전도·사건 배수 결합', () => {
  const { S, a, ordinary, hvdc } = tieFixture();
  S.teams[a].research.adopted.push('scable');
  near(C.effectiveTie(S, hvdc, .8).cap, 4 * 1.5 * T.params.scableCap.v * .8, 'HVDC·초전도·사건 곱');
  near(C.effectiveTie(S, ordinary).cap, 4 * T.params.scableCap.v, '일반선에는 초전도만 적용');
});
test('D79-cost', '새 HVDC 건설비1.3 유지', () => {
  const { ordinary, hvdc } = tieFixture();
  ok(C.tieCost(R, ordinary) > 0, '건설비0인 가짜 선으로 검사를 통과하지 않음');
  near(C.tieCost(R, hvdc), Math.round(C.tieCost(R, ordinary) * 1.3 * 100) / 100, '새 HVDC 건설비1.3');
});
for (const [key, value] of [['hvdcCap', 1.7], ['hvdcCost', 1.8]]) test('D79-copy', `${key} 변경이 자료·학생 문구에 반영`, () => {
  const changed = load({ techParam: { key, value } }), c = changed.C.techCards().find(c => c.id === 'hvdc');
  const text = `연계선 용량 ×${changed.T.params.hvdcCap?.v ?? 1.5}로 송전 용량을 늘리고 계통 제약을 푼다, 새 선 건설비 ×${changed.T.params.hvdcCost.v}`;
  eq(c.eff, text, '자료 문구는 params에서 생성');
  eq(changed.K.__techEffectText(c, { tech: { params: changed.T.params } }), text, '학생 문구도 params에서 생성');
});
const groups = {};
for (const r of results) { groups[r.group] ||= { pass: 0, fail: 0 }; groups[r.group][r.pass ? 'pass' : 'fail']++; }
const failures = results.filter(r => !r.pass).length;
console.log(JSON.stringify({ suite: '35-d73-d74-d79', root: ROOT, assertions, tests: results.length, failures, groups }));
process.exitCode = failures ? 1 : 0;
