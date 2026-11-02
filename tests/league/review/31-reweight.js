'use strict';
// W-weighttest: 끝 화면 '가중치를 바꾸면?'이 공식 점수식과 같은지 독립 검사한다.
// 기대값은 명세(ui/econ.js score 계약: 부분 점수를 하한 scorePartFloor로 자른 뒤
// wScore 가중 기하평균 + 공동 보너스, 0~100, 소수 첫째 자리, 동점은 도시 순서)에서
// 이 파일 안에서 직접 계산한다. ui/league.js의 reweightScore 식을 옮겨 쓰지 않는다.
// 실행: node tests/league/review/31-reweight.js (브라우저 없음)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const lib = require('./lib');

const clone = x => JSON.parse(JSON.stringify(x));
const KEYS = ['pop', 'ind', 'fin', 'co2', 'appr', 'rel'];
let checks = 0;
const ok = (x, label) => { assert.ok(x, label); checks++; };
const info = [];

// ---------- 명세 식(독립 구현) ----------
const jsRound1 = x => Math.round(x * 10) / 10;           // 소수 첫째 자리(JS 반올림 규칙)
function specScore(parts, coop, w, floor) {
  let num = 0, den = 0;
  for (const k of KEYS) {
    const wk = Math.max(0, Number(w[k]) || 0);
    if (!wk) continue;
    num += wk * Math.log(Math.max(floor, parts[k]));
    den += wk;
  }
  if (!den) return null;                                    // 가중 합 0: 명세 없음
  const raw = Math.exp(num / den) + (Number(coop) || 0);
  return { raw: Math.min(100, Math.max(0, raw)), score: jsRound1(Math.min(100, Math.max(0, raw))) };
}
// 반올림 경계(…x5)에서는 덧셈 순서 차이로 0.1 갈릴 수 있으므로 경계만 따로 센다.
const nearHalf = raw => Math.abs(raw * 10 - Math.floor(raw * 10) - 0.5) < 1e-7;
function specRank(scoreObj, order, w, floor) {
  const rows = scoreObj.rank.map(r => {
    const s = specScore(r.parts, r.coop, w, floor);
    return { id: r.id, name: r.name, score: s ? s.score : null, raw: s ? s.raw : null };
  });
  return rows.sort((a, b) => b.score - a.score || order.indexOf(a.id) - order.indexOf(b.id));
}

// ---------- 앱 파일 로드(30-s7과 같은 DOM 없는 vm 연결) ----------
const storage = new Map();
const session = { room: 'W31FIXTURE', team: 'pyeongtaek', outCache: {} };
const ctx = vm.createContext({ console, performance, structuredClone, __session: session,
  document: { documentElement: {}, addEventListener() {} }, addEventListener() {},
  localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
  KCP: { route() {}, on() {}, esc: s => String(s), leagueNet: {} } });
ctx.window = ctx;
vm.runInContext('Math.random = () => { throw Error("unseeded random"); };', ctx);
for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core']) {
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, `../../../ui/${name}.js`), 'utf8'), ctx);
}
const source = fs.readFileSync(path.resolve(__dirname, '../../../ui/league.js'), 'utf8');
assert.equal(source.split('let L = null;').length, 2, 'VM 세션 연결점 1개');
vm.runInContext(source.replace('let L = null;', 'let L = globalThis.__session;'), ctx);
const { leagueCore: C, ECON_DATA: VD, econ: VX, league } = ctx.KCP;
const uiMath = league.uiMath;
ok(typeof uiMath.reweightScore === 'function' && typeof uiMath.weightSimulation === 'function',
  '공개 검사 API reweightScore·weightSimulation');

const D = lib.D;
const floor = D.params.scorePartFloor.v;
const W0 = clone(D.params.wScore.v);
ok(floor === 1, `명세: 부분 점수 하한 scorePartFloor = 1 (현재 ${floor})`);
ok(KEYS.every(k => Number.isFinite(W0[k]) && W0[k] > 0) && Object.keys(W0).sort().join() === KEYS.slice().sort().join(),
  '명세: wScore는 부분 점수 6종 가중');
ok(JSON.stringify(VD.params.wScore.v) === JSON.stringify(W0) && VD.params.scorePartFloor.v === floor,
  'vm 앱과 검사의 자료 파일 같은 판');

// ---------- 시나리오: 엔진 상태(lib.js) → 리그 공개 상태 ----------
const SIX = ['hwaseong', 'pyeongtaek', 'anseong', 'dangjin', 'asan', 'cheonan'];
const scenarios = [
  { name: '보통 6도시 12달', ids: SIX, seed: 'w31-a', f: () => ({}) },
  { name: '정전·원가 차이 6도시', ids: SIX, seed: 'w31-b',
    f: (id) => ({ e: { uns: { pyeongtaek: 8, dangjin: 0.5, asan: 3 }[id] || 0,
      costMul: { hwaseong: 1.6, cheonan: 0.7 }[id] || 1, co2Mul: { dangjin: 2.2, asan: 0.3, anseong: 0.6 }[id] || 1,
      ren: { asan: 60, anseong: 40 }[id] ?? 15 } }) },
  { name: '세율·서비스 극단 3도시', ids: ['pyeongtaek', 'dangjin', 'asan'], seed: 'w31-c',
    f: (id) => ({ p: { pyeongtaek: { taxRes: 2, taxInd: 2, service: -2 }, dangjin: { taxRes: -2, taxInd: -2, service: 2 } }[id] || {},
      e: { uns: id === 'asan' ? 15 : 0, co2Mul: id === 'dangjin' ? 3 : 1 } }) },
  // 도시 사이는 ', '로 구분한다. 자료 이름 '화성·오산'에 이미 가운뎃점이 있어 '·'로 이으면 세 도시처럼 읽힌다.
  { name: `2도시 ${['pyeongtaek', 'hwaseong'].map(id => C.teamDef(C.regionOf('south'), id).name).join(', ')}`, ids: ['hwaseong', 'pyeongtaek'], seed: 'w31-d',
    f: (id) => ({ e: { uns: id === 'hwaseong' ? 4 : 0, co2Mul: id === 'pyeongtaek' ? 0.2 : 1.5 } }) }
];
// 0점 부분(재정·신뢰·탄소)을 강제로 만든 상태: 하한(floor)이 실제로 작동하는지 본다.
function extremes(E) {
  const S = clone(E), ids = S.order;
  Object.assign(S.cities[ids[0]], { cash: -2 * Math.abs(S.cities[ids[0]].debtCap || 1) - 1, unsS: 1e6,
    co2Intensity: D.params.scoreCo2Worst.v * 2 });
  if (ids[1]) Object.assign(S.cities[ids[1]], { co2Intensity: D.params.scoreCo2Best.v / 2 });
  return S;
}

// 결정적 의사난수(LCG): Math.random 금지
let seed = 20261011;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const step = x => Math.round(x / 0.05) * 0.05;          // 슬라이더 step 0.05
const weightSets = [
  ['기본', clone(W0)],
  ['탄소 1·나머지 기본', { ...W0, co2: 1 }],
  ['신뢰 0', { ...W0, rel: 0 }],
  ['주민만 1', { pop: 1, ind: 0, fin: 0, co2: 0, appr: 0, rel: 0 }],
  ['재정만 0.05', { pop: 0, ind: 0, fin: 0.05, co2: 0, appr: 0, rel: 0 }],
  ['동일 가중 1', Object.fromEntries(KEYS.map(k => [k, 1]))],
  ['기본을 슬라이더 칸에 맞춘 값', Object.fromEntries(KEYS.map(k => [k, step(W0[k])]))]
];
for (let i = 0; i < 12; i++) weightSets.push([`무작위 ${i + 1}`, Object.fromEntries(KEYS.map(k => [k, step(rnd())]))]);

const now = 1790000000000;
let tieSkips = 0, boundary = 0, fallbackTieOrder = 0, snappedScore = 0, snappedOrder = 0, cases = 0;
for (const sc of scenarios) {
  const { E: E0 } = lib.run({ seed: sc.seed, months: 12, ids: sc.ids, f: sc.f });
  for (const [variant, E] of [['', E0], [' + 0점 부분', extremes(E0)]]) {
    const label = sc.name + variant;
    // 리그 상태에 엔진 상태를 넣고 공개 상태(진행자·팀이 받는 값)를 만든다.
    const S = C.newState('W31' + sc.seed.slice(-1).toUpperCase() + (variant ? 'X' : 'N'), 'south', now, sc.ids, { turns: 12 });
    S.econ = clone(E);
    const V = clone(C.publicView(S, now)).econ;     // JSON 직렬화를 거친 실제 전송 형태
    const official = lib.X.score(clone(E), D);
    ok(V && V.score && V.scoreState, `${label}: 공개 상태에 score·scoreState`);
    ok(JSON.stringify(V.score.rank.map(r => [r.id, r.score])) === JSON.stringify(official.rank.map(r => [r.id, r.score])),
      `${label}: 공개 점수 = 엔진 score()`);
    const order = V.scoreState.order;
    ok(JSON.stringify(order) === JSON.stringify(E.order), `${label}: 공개 scoreState.order = 엔진 도시 순서`);
    ok(V.score.rank.some(r => KEYS.some(k => r.parts[k] !== V.score.rank[0].parts[k])), `${label}: 도시마다 다른 부분 점수(검사 의미 있음)`);
    if (variant) ok(V.score.rank.some(r => KEYS.some(k => r.parts[k] < floor)), `${label}: 하한 아래 부분 점수가 실제로 있음`);

    // (1) 명세 식 = 공식 점수(기본 가중), 공식 순위 = 명세 순위
    for (const r of V.score.rank) {
      const s = specScore(r.parts, r.coop, W0, floor);
      const same = Math.abs(s.score - r.score) <= 1e-9;
      if (!same && nearHalf(s.raw)) { boundary++; continue; }
      ok(same, `${label}: ${r.id} 명세 식 ${s.score} = 공식 ${r.score}`);
    }
    // 판별력: 2026-10-10 결함(산술평균)이라면 이 상태에서 공식 점수와 갈려야 한다.
    const arith = r => jsRound1(Math.min(100, KEYS.reduce((a, k) => a + W0[k] * r.parts[k], 0) / KEYS.reduce((a, k) => a + W0[k], 0) + (r.coop || 0)));
    ok(V.score.rank.some(r => Math.abs(arith(r) - r.score) > 0.05), `${label}: 산술평균이면 공식 점수와 달라짐(검사 판별력)`);
    const sr = specRank(V.score, order, W0, floor);
    ok(sr.map(r => r.id).join() === V.score.rank.map(r => r.id).join(), `${label}: 공식 순위 = 명세 순위(점수 내림차순·동점 도시 순서)`);

    // (2) 슬라이더 가중별: 화면 계산 두 경로를 명세 식과 비교
    for (const [wname, w] of weightSets) {
      cases++;
      const exp = specRank(V.score, order, w, floor);
      const expBy = Object.fromEntries(exp.map(r => [r.id, r]));
      const sim = uiMath.weightSimulation(clone(V), clone(w));     // 공개 상태(scoreState 있음) 경로
      const fb = uiMath.reweightScore(clone(V.score), clone(w));   // scoreState 없는 대체 경로
      for (const [pathName, got] of [['scoreState 경로', sim], ['대체 경로', fb]]) {
        ok(Array.isArray(got) && got.length === exp.length && got.every(r => Number.isFinite(r.score) && r.score >= 0 && r.score <= 100),
          `${label} [${wname}] ${pathName}: 행 수·유한·0~100`);
        for (const r of got) {
          const e = expBy[r.id];
          const same = e && Math.abs(r.score - e.score) <= 1e-9;
          if (!same && e && nearHalf(e.raw)) { boundary++; continue; }
          ok(same, `${label} [${wname}] ${pathName}: ${r.id} ${r.score} = 명세 ${e && e.score}`);
          ok(r.name === e.name, `${label} [${wname}] ${pathName}: ${r.id} 이름`);
        }
        ok(got.every((r, i) => !i || got[i - 1].score >= r.score), `${label} [${wname}] ${pathName}: 점수 내림차순`);
        const tie = exp.some((r, i) => i && exp[i - 1].score === r.score);
        const sameOrder = got.map(r => r.id).join() === exp.map(r => r.id).join();
        if (tie) {
          tieSkips++;
          // 동점 처리: 명세는 도시 순서. scoreState 경로는 엔진 그대로라 단언하고, 대체 경로는 관찰만 한다.
          if (pathName === 'scoreState 경로') ok(sameOrder, `${label} [${wname}] ${pathName}: 동점은 도시 순서`);
          else if (!sameOrder) fallbackTieOrder++;
        } else ok(sameOrder, `${label} [${wname}] ${pathName}: 순위 = 명세 순위`);
      }
      if (wname === '기본을 슬라이더 칸에 맞춘 값') {
        const base = specRank(V.score, order, W0, floor);
        if (exp.map(r => r.id + ':' + r.score).join() !== base.map(r => r.id + ':' + r.score).join()) snappedScore++;
        if (exp.map(r => r.id).join() !== base.map(r => r.id).join()) snappedOrder++;
      }
    }

    // (3) 가중이 모두 0일 때: 명세 없음 → 동작만 기록(단언은 유한·행 수만)
    const zero = Object.fromEntries(KEYS.map(k => [k, 0]));
    const z1 = uiMath.weightSimulation(clone(V), zero), z2 = uiMath.reweightScore(clone(V.score), zero);
    ok([z1, z2].every(z => z.length === V.score.rank.length && z.every(r => Number.isFinite(r.score))),
      `${label}: 가중 모두 0이어도 NaN·빈 목록 없음`);
    const offi = V.score.rank.map(r => r.id + ':' + r.score).join();
    info.push(`${label}: 모두 0 → scoreState 경로 ${z1.map(r => r.id + ':' + r.score).join() === offi ? '공식 순위·점수 그대로' : '공식과 다름'}, 대체 경로 ${z2.map(r => r.id + ':' + r.score).join() === offi ? '공식 순위·점수 그대로' : '공식과 다름'}`);
  }
}
info.push(`반올림 경계로 건너뛴 비교 ${boundary}건, 명세 순위에 동점이 있던 비교 ${tieSkips}건(그중 대체 경로 동점 순서가 도시 순서와 다른 경우 ${fallbackTieOrder}건)`);
const f2 = x => +x.toFixed(4);
info.push(`기본 가중을 슬라이더 칸(0.05)에 맞추면(재정 ${W0.fin}→${f2(step(W0.fin))}, 탄소 ${W0.co2}→${f2(step(W0.co2))}) 점수가 달라진 상태 ${snappedScore}/${scenarios.length * 2}개, 순위가 달라진 상태 ${snappedOrder}/${scenarios.length * 2}개 — 브라우저의 range 값 정리 방향은 화면 검사에서 확인`);
info.forEach(x => console.log('INFO ' + x));
console.log(`31 가중치 다시 계산: 가중 ${weightSets.length}종 × 상태 ${scenarios.length * 2}개 = ${cases}경우, ${checks} 통과, 0 실패`);
