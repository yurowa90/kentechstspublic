'use strict';
// Q8 독립 계약 검사. 기대값은 사용자 계약·고정 fixture·교부세 전 편집기 공식에서만 온다.
// ui/는 읽기 전용이다. 비공개 함수 노출과 변이는 VM 문자열 사본에만 주입한다.
// node tests/league/review/44-grant.js — 브라우저·네트워크·장기 전략 실험 없음.
const rawAssert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../../..');
const names = ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core', 'league-ai', 'league'];
const source = Object.fromEntries(names.map(n => [n, fs.readFileSync(path.join(ROOT, `ui/${n}.js`), 'utf8')]));
const clone = x => JSON.parse(JSON.stringify(x));
const IDS = ['hwaseong', 'pyeongtaek', 'anseong', 'dangjin', 'asan', 'cheonan'];
const COAST = ['hwaseong', 'pyeongtaek', 'dangjin', 'asan'];
const DISASTERS = ['typhoon_coast', 'heavy_snow_solar', 'coldwave_heating', 'heatwave_peak', 'spring_dust_haze', 'heavy_rain'];
const TOKEN = 'q8-synthetic-token', ID = 'hwaseong';
const empty = () => ({ builds: [], lines: [], policies: [], rq: [] });
let assertions = 0, passed = 0, failed = 0, detected = 0;
const groups = new Map();
const a = new Proxy(rawAssert, { get(target, key) {
  return typeof target[key] !== 'function' ? target[key] : (...args) => { assertions++; return target[key](...args); };
} });
function test(group, label, fn) {
  const counts = groups.get(group) || { passed: 0, failed: 0 }; groups.set(group, counts);
  try { fn(); passed++; counts.passed++; }
  catch (e) { failed++; counts.failed++; console.error(`FAIL [${group}] ${label}: ${e.stack}`); }
}
function near(actual, expected, label) { a.ok(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-6, `${label}: 실제 ${actual}, 기대 ${expected}`); }
function replaceOne(text, from, to) {
  a.equal(text.split(from).length, 2, `VM 연결점 하나: ${from}`);
  return text.replace(from, to);
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function load({ core = source['league-core'], build = source.build, league = source.league, grant = 10, noMetadata = false } = {}) {
  const L = { team: ID, role: 'team' };
  // T F1: 기존 칩 주석 계약은 760px 초과 화면이다. 390 정보창/높이는 score1.py에서 검사한다.
  const ctx = vm.createContext({ console, performance, structuredClone, session: L, addEventListener() {}, matchMedia: () => ({ matches: false }),
    document: { documentElement: {}, addEventListener() {} },
    KCP: { route() {}, on() {}, esc, gradeWords: String, leagueNet: {} } });
  ctx.window = ctx;
  vm.runInContext('Math.random = () => { throw Error("씨앗 없는 난수 금지"); };', ctx);
  for (const name of names) {
    let text = name === 'league-core' ? core : name === 'build' ? build : name === 'league' ? league : source[name];
    if (name === 'build') text = replaceOne(text, '  let S = null;',
      '  let S = null; globalThis.editor = { set: s => S = s, canPlace, withinBudget: p => withinBudget(p), showConfirm, refreshHUD, updateAria, budgetShortfall: typeof budgetShortfall === "function" ? budgetShortfall : null, fmt };');
    if (name === 'league') {
      const start = text.indexOf('  function mountCity(');
      const callback = text.slice(text.indexOf('      budget:', start)).split('\n')[0].trim().slice(8).replace(/,$/, '');
      a.ok(start >= 0 && callback.length > 0, '실제 팀 편집기 예산 어댑터 연결');
      text = replaceOne(text, 'let L = null;', 'let L = globalThis.session;');
      text = replaceOne(text, '  // 검사용\n', `  globalThis.view = { cityHTML, budget: ${callback}, note: typeof grantMoneyNote === 'function' ? grantMoneyNote : () => '', region: typeof R === 'function' ? R : null };\n  // 검사용\n`);
    }
    vm.runInContext(text, ctx, { filename: `VM:ui/${name}.js`, timeout: 5000 });
    if (name === 'econ-data') ctx.KCP.ECON_DATA.params.disasterGrant.v = grant;
    if (name === 'league-data' && noMetadata) {
      for (const R of Object.values(ctx.KCP.LEAGUE_REGIONS)) for (const E of R.events) delete E.grant;
    }
  }
  return { ctx, L, C: ctx.KCP.leagueCore, B: ctx.KCP.buildGame, D: ctx.KCP.ECON_DATA,
    AI: ctx.KCP.leagueAI, R: ctx.KCP.leagueCore.regionOf('south'), ui: ctx.view, editor: ctx.editor, league };
}
function setup(h, { id = ID, over = true, general = 0, events = ['heatwave_peak'], monthly = true } = {}) {
  const S = h.C.newState('Q8-contract', 'south', 0, IDS, monthly ? { turns: 12 } : undefined);
  a.equal(h.C.host(S, 'next', 1), true, 'fixture 계획 단계 진입');
  for (const who of IDS) {
    Object.assign(S.teams[who], { token: TOKEN, plan: empty(), base: [], committed: 0, resp: {} });
    if (S.econ) S.econ.cities[who].cash = 0;
  }
  S.events = events.map(ev => ({ id: ev, round: S.round, x: 1 }));
  if (S.econ) { const c = S.econ.cities[id]; c.cash = -c.debtCap + (over ? -100 : general); }
  return S;
}
function request(h, S, message, id = ID) {
  return h.C.reduce(S, { team: id, token: TOKEN, ...message }, 2, h.B);
}
function submit(h, S, plan, id = ID) { return request(h, S, { type: 'plan', rev: S.teams[id].rev + 1, plan }, id); }
function tiles(h, id = ID) {
  h.B.selectPack(h.C.teamDef(h.R, id).pack, 'league');
  return h.B.TILES.filter(t => !h.B.siteRule('solar', t)).slice(0, 6).map(t => t.i);
}
function solar(h, n = 1, id = ID) { return { ...empty(), builds: tiles(h, id).slice(0, n).map(i => ({ t: 'solar', i })) }; }
function line(h, id = ID) {
  tiles(h, id);
  // 화성 팩 첫 인접 구간은 6억. 도시별 기존 자산 원가는 회귀 fixture에서 따로 읽는다.
  const t = h.B.TILES.find(t => !t.out && t.nb.some(i => !h.B.TILES[i].out));
  return { p: [t.i, t.nb.find(i => !h.B.TILES[i].out)] };
}
function attach(h, S, plan, id = ID) {
  h.L.team = id; h.L.snap = h.C.publicView(S, 3);
  tiles(h, id); h.editor.set({ st: clone(plan), opts: { budget: h.ui.budget } });
}
// 갱신 4: syncMoney와 별개인 build.js의 실제 소비 경로를 실행한다.
// DOM 쓰기만 대역 처리하고 예산 어댑터·금액 계산·지도/돈 칸 문구는 바꾸지 않는다.
function buildMoney(h, S, legacyLeft) {
  attach(h, S, S.teams[ID].plan);
  const st = h.B.sanitize(S.teams[ID].plan, 1e9);
  const element = () => ({ textContent: '', dataset: {}, classList: { toggle() {}, remove() {} },
    setAttribute(k, v) { this[k] = String(v); } });
  const values = {}, labels = {}, caps = {};
  for (const key of ['budget', 'power', 'time', 'co2', 'cp']) {
    values[key] = element(); labels[key] = element(); caps[key] = element();
    caps[key].querySelector = selector => {
      if (selector === '[data-v]') return values[key];
      throw Error(`지원하지 않는 돈 칸 선택자: ${selector}`);
    };
  }
  const root = { querySelector(selector) {
    if (selector === '#bd-undo') return null;
    const match = selector.match(/^\[data-cap="(budget|power|time|co2|cp)"\](?: (\[data-v\]|\.v2-cap-k))?$/);
    if (!match) throw Error(`지원하지 않는 HUD 선택자: ${selector}`);
    return match[2] === '[data-v]' ? values[match[1]] : match[2] === '.v2-cap-k' ? labels[match[1]] : caps[match[1]];
  } };
  const canvas = element();
  // 3fdcee5의 숫자형 콜백에는 같은 일반 잔액 fixture를 준다(옛 렌더러와 새 판정 객체 호환 비교).
  const budget = legacyLeft === undefined ? h.ui.budget : () => h.B.capex(st) + legacyLeft;
  h.editor.set({ st, root, canvas, net: h.B.network(st), opts: { league: true, budget }, run: null, result: null });
  h.editor.refreshHUD(); h.editor.updateAria();
  return { title: values.budget.title, value: values.budget.textContent, aria: canvas['aria-label'] };
}
function buildDescriptionContract(h, which, withGrant) {
  const S = setup(h, { over: false, general: 50, events: withGrant ? ['heatwave_peak'] : [] });
  const actual = buildMoney(h, S);
  // spec-C §M2: 이 고정 사례의 heatwave_peak에는 repairParam이 있어 기존 꼬리를 유지한다.
  const description = '남은 돈 50.0억 (빚 한도 포함) · 이번 달 특별교부세 10.0억(새 설비·선로·재난 대응, 남으면 보수비)';
  if (which === 'title') a.equal(actual.title, withGrant ? description : '50억', 'build refreshHUD 돈 값 title');
  else a.ok(actual.aria.endsWith(`${withGrant ? description : '예산 잔액 50.0억'}.`), 'build updateAria 지도 예산 문구');
}
function comparePlan(h, S, plan, want, label, id = ID) {
  const before = clone(S); attach(h, S, S.teams[id].plan, id);
  a.equal(h.C.fundingOf(h.B, S, h.R, id, plan).ok, want, `${label} 호스트 fundingOf`);
  a.equal(h.C.fundingOf(h.B, h.L.snap, h.R, id, plan).ok, want, `${label} 공개 fundingOf`);
  a.equal(h.editor.withinBudget(plan), want, `${label} 실제 편집기 후보 판정`);
  const result = submit(h, before, clone(plan), id);
  a.equal(result.ok, want, `${label} reduce: ${result.err || '승인'}`);
  if (want) {
    a.deepEqual(clone(before.teams[id].plan.builds), clone(plan.builds), `${label} 승인 때 설비 삭제 없음`);
    a.deepEqual(clone(before.teams[id].plan.lines), clone(plan.lines), `${label} 승인 때 선로 삭제 없음`);
  } else a.deepEqual(clone(before.teams[id].plan), clone(S.teams[id].plan), `${label} 거절 때 계획 보존`);
}
function responseContract(h, amount, want) {
  h.D.params.disasterGrant.v = amount;
  const S = setup(h), candidate = clone(S);
  candidate.teams[ID].resp[`${S.round}:heatwave_peak`] = 'dr'; // 고정 비용 4억
  a.equal(h.C.fundingOf(h.B, candidate, h.R, ID, candidate.teams[ID].plan, { kind: 'respond' }).ok, want, '4억 대응 공통 판정');
  const before = clone(S.teams[ID].resp), r = request(h, S, { type: 'respond', ev: 'heatwave_peak', opt: 'dr' });
  a.equal(r.ok, want, '4억 대응 실제 승인');
  if (!want) a.deepEqual(S.teams[ID].resp, before, '대응 거절 때 기존 선택 보존');
  else near(h.C.grantOf(S, h.R, ID, h.B).left, amount - 4, '대응 후 전용 잔액');
  a.equal(request(h, S, { type: 'respond', ev: 'heatwave_peak', opt: 'none' }).ok, true, '무료 취소 허용');
}
// 실제 월 운영·econ 장부. 세입 전액 선지급/이월 변이가 이 오라클을 깨야 한다.
// REF 19.1·D-89/D-90의 순서. 구현 장부·grantOf의 출력으로 기대값을 만들지 않는다.
function settlementExpected(awarded, planUsed, repair, otherBonus = 0) {
  const cents = value => Math.round(value * 100) / 100;
  const repairUsed = Math.min(awarded - planUsed, repair);
  return { grant: { awarded, planUsed, repairUsed, used: cents(planUsed + repairUsed),
    expired: cents(awarded - planUsed - repairUsed), netRepair: cents(repair - repairUsed) },
    bonus: cents(otherBonus + planUsed + repairUsed) };
}
function assertSettlement(h, S, expected, repair) {
  const f = S.econRep.fiscal[ID], r = S.results.at(-1).team[ID];
  a.deepEqual(clone(r.disasterGrant), expected.grant, '계획 → 보수 → 소멸의 정확한 정산 필드·값');
  near(r.cost.repair, repair, '대표기간 결과에도 월 보수 한 번');
  near(f.exp.repair, repair, '별도 세출의 월 보수비');
  near(f.rev.bonus, expected.bonus, '기타 지원금 + 계획 사용 + 보수 사용만 세입');
  near(Object.values(f.exp).reduce((sum, value) => sum + value, 0), f.expTotal, '보수 포함 세출 합');
}
function settleContract(h, mode, used) {
  const S = setup(h, { over: false, general: 50 });
  if (mode === 'solar') a.equal(submit(h, S, solar(h)).ok, true);
  if (mode === 'line') a.equal(submit(h, S, { ...empty(), lines: [line(h)] }).ok, true);
  if (mode === 'response') a.equal(request(h, S, { type: 'respond', ev: 'heatwave_peak', opt: 'dr' }).ok, true);
  if (mode === 'research') {
    tiles(h);
    const i = h.B.TILES.find(t => !h.B.siteRule('lab', t)).i;
    S.teams[ID].plan.builds = [{ t: 'lab', i }];
    const cost = h.B.capex(S.teams[ID].plan);
    S.teams[ID].base = [{ k: `b:lab:${i}`, c: cost }]; S.teams[ID].committed = cost;
    S.teams[ID].plan.rq = ['grid'];
    S.teams[ID].research = { queue: ['grid'], prog: { grid: 8 } };
  }
  const before = S.econ.cities[ID].cash;
  // 폭염 x=1·ΔT와 별개인 보수 4억. dr은 수요만 줄이므로 보수비는 그대로다.
  const expected = settlementExpected(10, used, 4);
  near(h.C.grantOf(S, h.R, ID, h.B).used, used, `${mode} 정산 전 적격 사용액`);
  near(h.C.grantOf(S, h.R, ID, h.B).left, 10 - used, `${mode} 계획 잔액에서 보수 미리 차감 없음`);
  near(h.C.fundingOf(h.B, S, h.R, ID, S.teams[ID].plan).grant.used, used, `${mode} 승인에는 계획 사용만 포함`);
  h.C.run(S, h.B, 4);
  const f = S.econRep.fiscal[ID];
  assertSettlement(h, S, expected, 4);
  near(f.cashBefore, before, `${mode} 현금 선지급 없음`);
  near(f.cashBefore + f.revTotal - f.expTotal, f.cashAfter, `${mode} 현금 항등식`);
  near(S.econ.cities[ID].cash, f.cashAfter, `${mode} 장부와 실제 현금 동일`);
  near(h.C.grantOf(S, h.R, ID, h.B).left, 0, `${mode} 월말 미사용액 소멸`);
  if (mode === 'research') a.ok(f.exp.capex >= 4, '실증비가 실제 발생한 일반비용 음성 대조');
  a.equal(h.C.host(S, 'next', 5), true, '다음 달 진입');
  S.events = [];
  near(h.C.grantOf(S, h.R, ID, h.B).awarded, 0, '다음 달 교부 한도 이월 없음');
  near(S.econ.cities[ID].cash, f.cashAfter, '다음 달 현금에 미사용 교부세 가산 없음');
  return f;
}
function researchContract(h) {
  const S = setup(h, { over: false, general: 0 });
  const plan = { ...empty(), rq: ['grid'] }; // 고정 실증 예약 4억, 교부세 10억으로 불가
  near(h.C.researchReserve(S, ID, h.B, plan), 4, 'grid 실증 fixture');
  comparePlan(h, S, plan, false, '교부세로 연구 예약 불가');
  const building = { ...solar(h), rq: ['grid'] };
  comparePlan(h, S, building, false, '8억 건설 후 남은2억도 실증비로 전용 불가');
  comparePlan(h, setup(h), building, false, '한도 초과 건설 예외도 연구 예약까지 감당하지 않음');
  comparePlan(h, setup(h, { over: false, general: 4 }), building, true, '연구 예약은 일반4억, 건설은 교부8억으로 분리');
  const before = clone(S.teams[ID]);
  a.equal(request(h, S, { type: 'research', queue: ['grid'] }).ok, false, '직접 연구 승인도 거절');
  a.deepEqual(S.teams[ID].plan, before.plan, '연구 거절 시 계획 복원');
  a.deepEqual(clone(S.teams[ID].research), clone(before.research), '연구 거절 시 연구 상태 복원');
}
// 갱신 3: 철거 회수가 있어도 초과 부채를 교부세로 덮어 연구 예약을 허용하면 안 된다.
function salvageResearchContract(h) {
  const balances = [];
  for (const events of [[], ['heatwave_peak']]) {
    const S = setup(h, { events }), initial = solar(h, 3), plan = { ...solar(h), rq: ['grid'] };
    S.teams[ID].plan = initial;
    S.teams[ID].base = initial.builds.map(b => ({ k: `b:solar:${b.i}`, c: 8 }));
    S.teams[ID].committed = 24;
    near(h.C.researchReserve(S, ID, h.B, plan), 4, '실증 예약 4억');
    near(h.C.lossOf(S.teams[ID].base, plan), 11.2, '2기 철거: 원가16억 중 회수4.8억·손실11.2억');
    comparePlan(h, S, plan, false, `${events.length ? '교부세 달' : '사건 없는 달'} 철거+실증 예약`);
    // 같은 후보를 편집 중인 공개 화면에서도 일반 예산·남은 돈이 바뀌지 않아야 한다.
    S.teams[ID].plan = plan;
    attach(h, S, plan);
    near(h.C.budget(S, ID), -76, '초과100억 + 기존 투자24억 = 일반 예산−76억');
    near(h.L.snap.teams[ID].budget, -76, '공개 일반 예산');
    near(h.C.fundingOf(h.B, S, h.R, ID, plan).left, -99.2, '예약 후 일반 잔액−99.2억');
    near(h.L.snap.teams[ID].left, -99.2, '화면 남은 돈: 교부 유무와 무관한 일반 잔액');
    near(h.C.grantOf(S, h.R, ID, h.B).used, 0, '철거·연구는 교부 사용0');
    near(h.C.grantOf(S, h.R, ID, h.B).left, events.length ? 10 : 0, '미사용 교부 몫 별도');
    balances.push(h.L.snap.teams[ID].left);
  }
  a.equal(balances[0], balances[1], '같은 도시·계획의 publicView left가 교부 유무와 무관하게 동일');
}
// 갱신 3: 같은 달에 재난이 있어도 비재난 대응비는 일반 비용이다(독립 고정 비용 3억).
function nonDisasterResponseContract(h, over) {
  for (const disasterResponse of [false, true]) {
    const S = setup(h, { over, general: 50, events: ['heatwave_peak', 'evening_peak_tropical_night'] });
    if (disasterResponse) a.equal(request(h, S, { type: 'respond', ev: 'heatwave_peak', opt: 'dr' }).ok, true, '재난 대응4억은 교부로 승인');
    const candidate = clone(S), key = `${S.round}:evening_peak_tropical_night`;
    candidate.teams[ID].resp[key] = 'dr';
    const used = disasterResponse ? 4 : 0;
    near(h.C.respCost(candidate, h.R, ID, S.round), used + 3, '총 대응비 장부에는 열대야3억 포함');
    for (const state of [candidate, h.C.publicView(candidate, 3)]) {
      const grant = h.C.grantOf(state, h.R, ID, h.B);
      near(grant.awarded, 10, '폭염 지급10억');
      near(grant.eligible, used, '폭염 대응만 적격·열대야 대응 제외');
      near(grant.used, used, '열대야로 교부 사용액 증가 없음');
      near(grant.left, 10 - used, '비재난 대응 후에도 교부 몫 보존');
      const funding = h.C.fundingOf(h.B, state, h.R, ID, state.teams[ID].plan, { kind: 'respond' });
      a.equal(funding.ok, !over, '호스트·공개: 초과 도시는 거절·일반50억 도시는 승인');
      near(funding.left, over ? -103 : 47, '열대야3억은 일반 잔액에서 차감');
    }
    const before = clone(S.teams[ID].resp);
    a.equal(request(h, S, { type: 'respond', ev: 'evening_peak_tropical_night', opt: 'dr' }).ok, !over, '실제 비재난 대응 승인 경로');
    if (over) a.deepEqual(clone(S.teams[ID].resp), before, '거절 시 재난 대응 포함 기존 선택 복원');
    else {
      a.equal(S.teams[ID].resp[key], 'dr', '일반 재원으로 승인한 비재난 대응 저장');
      h.C.run(S, h.B, 4);
      const fiscal = S.econRep.fiscal[ID];
      assertSettlement(h, S, settlementExpected(10, used, 4), 4);
      near(fiscal.rev.bonus, used + 4, '비재난 대응3억은 제외·폭염 보수4억은 별도 인정');
      near(fiscal.cashBefore + fiscal.revTotal - fiscal.expTotal, fiscal.cashAfter, '혼합 사건 현금 항등식');
    }
  }
}
function boundaryContract(h) {
  h.D.params.disasterGrant.v = 7;
  comparePlan(h, setup(h), solar(h), false, '새 설비 8억 > 교부 7억');
}
function mutation(label, changes, contract) {
  test('변이', label, () => {
    // 로드·연결점 오류는 여기서 던져 일반 FAIL이다. 계약의 AssertionError만 탐지로 센다.
    const mutant = load(changes);
    let error;
    try { contract(mutant); } catch (e) { if (!(e instanceof rawAssert.AssertionError)) throw e; error = e; }
    a.ok(error, `${label}: 계약 단언에서 잡혀야 함`);
    detected++; console.log(`DETECTED ${label}: ${error.message.split('\n')[0]}`);
  });
}

try {
  const h = load();
  for (const ev of h.R.events) for (const id of IDS) test('지급 대상', `${ev.id}/${id}`, () => {
    const S = setup(h, { id, events: [ev.id] });
    const want = DISASTERS.includes(ev.id) && (!['typhoon_coast', 'heavy_snow_solar'].includes(ev.id) || COAST.includes(id)) ? 10 : 0;
    near(h.C.grantAmount(S, h.R, id), want, '독립 대상 목록·해안 도시 목록에 따른 지급');
    near(h.C.grantOf(S, h.R, id, h.B).awarded, want, '실제 전용 한도');
  });
  test('지급 액수', 'params·월·복수 사건·계절 모드', () => {
    near(h.D.params.disasterGrant.v, 10, '기본 교부액');
    h.D.params.disasterGrant.v = 12.5;
    for (const ev of DISASTERS) {
      const configured = setup(h, { events: [ev] });
      near(h.C.grantAmount(configured, h.R, ID), 12.5, `${ev}도 params 변경 반영`);
    }
    const S = setup(h, { events: ['heatwave_peak', 'coldwave_heating'] });
    near(h.C.grantAmount(S, h.R, ID), 25, '두 재난 params 합산');
    S.events.push({ id: 'spring_dust_haze', round: S.round - 1 });
    near(h.C.grantAmount(S, h.R, ID), 25, '지난 달 사건 제외');
    near(h.C.grantAmount(S, h.R, ID, S.round - 1), 12.5, '지정한 달 지급액');
    near(h.C.grantAmount(setup(h, { monthly: false }), h.R, ID), 0, '계절 모드는 교부 없음');
    h.D.params.disasterGrant.v = 10;
  });
  test('추첨', '씨앗별 누적 사건 목록·실현 크기 불변', () => {
    const noGrant = load({ noMetadata: true }), zero = load({ grant: 0 });
    let seen = 0;
    // 운영 없이 drawEvents만 검사한다. 같은 이전 사건까지 누적하여 연속 배제 규칙도 통과한다.
    for (let seed = 0; seed < 20; seed++) {
      const states = [h, noGrant, zero].map(x => x.C.newState(`draw-${seed}`, 'south', 0, IDS, { turns: 36 }));
      for (let round = 1; round <= 36; round++) {
        const lists = [h, noGrant, zero].map((x, i) => {
          states[i].round = round; x.C.drawEvents(states[i], x.R); return clone(states[i].events);
        });
        a.deepEqual(lists[0], lists[1], `${seed}/${round} 메타데이터 유무`);
        a.deepEqual(lists[0], lists[2], `${seed}/${round} params 0`);
        seen += lists[0].filter(e => e.round === round && DISASTERS.includes(e.id)).length;
      }
    }
    a.ok(seen > 0, '재난을 실제로 뽑은 음성 대조');
  });
  for (const [mode, used] of [['unused', 0], ['solar', 8], ['line', 6], ['response', 4], ['research', 0]])
    test('정산', mode, () => settleContract(h, mode, used));
  test('정산', '기타 지원금과 재난 교부 사용액을 별도로 합산', () => {
    // 실제 금액을 읽어 기대값으로 삼지 않는 가상 지원금 7억 fixture.
    h.R.events.push({ id: 'synthetic_support', scope: 'region', effect: { budgetAdd: 7 } });
    try {
      const S = setup(h, { over: false, general: 50, events: ['heatwave_peak', 'synthetic_support'] });
      h.C.run(S, h.B, 4);
      assertSettlement(h, S, settlementExpected(10, 0, 4, 7), 4);
    } finally { h.R.events.pop(); }
  });
  test('계획 승인', '실제 재난 크기·월말 보수비가 grantOf/fundingOf에 들어가지 않음', () => {
    for (const ev of ['heatwave_peak', 'heavy_rain']) {
      const S = setup(h, { events: [ev] }), plan = solar(h), values = [];
      S.teams[ID].plan = plan;
      for (const x of [.7, 1, 1.3]) {
        S.events[0].x = x;
        const grant = h.C.grantOf(S, h.R, ID, h.B), funding = h.C.fundingOf(h.B, S, h.R, ID, plan);
        a.deepEqual(clone(grant), { awarded: 10, eligible: 8, used: 8, left: 2 }, '새 설비8억만 적격·보수 선차감 없음');
        a.equal(funding.ok, true, '한도 초과 예외는 계획 적격액만으로 승인');
        values.push(clone(funding));
      }
      a.deepEqual(values[0], values[1], '숨은 x 차이가 승인 형식·금액에 영향 없음');
      a.deepEqual(values[1], values[2], '보수비가 큰 x도 같은 승인');
    }
  });
  for (const [opt, response, repair] of [['none', 0, 12], ['inspect', 1.5, 9.6], ['drain', 4, 6.6]])
    test('정산', `호우/${opt}: 보수에 남은 교부만 사용`, () => {
      // REF 19.1: 12억×x(1)×dev(1/.8/.55), 월 한 번. 금액은 독립 고정값.
      const S = setup(h, { over: false, general: 50, events: ['heavy_rain'] });
      if (opt !== 'none') a.equal(request(h, S, { type: 'respond', ev: 'heavy_rain', opt }).ok, true);
      near(h.C.grantOf(S, h.R, ID, h.B).used, response, '호우 계획에서는 대응비만 사용');
      h.C.run(S, h.B, 4);
      assertSettlement(h, S, settlementExpected(10, response, repair), repair);
      const f = S.econRep.fiscal[ID];
      near(f.cashBefore + f.revTotal - f.expTotal, f.cashAfter, '호우 보수·지원 후 현금 항등식');
    });
  test('일반 비용', '미사용 교부세로 연구 예약·직접 연구 불가', () => researchContract(h));
  test('일반 비용', '초과 부채·기존 설비 철거 회수·연구 예약은 교부 유무 모두 거절', () => salvageResearchContract(h));
  for (const over of [true, false]) test('대응 적격', `${over ? '한도 초과' : '일반50억'}: 폭염과 열대야 동시 발생`, () => nonDisasterResponseContract(h, over));
  for (const [amount, want] of [[8, true], [7.99, false], [7, false], [0, false]]) test('한도 초과', `설비8/교부${amount}`, () => {
    h.D.params.disasterGrant.v = amount;
    comparePlan(h, setup(h), solar(h), want, '태양광 후보');
    const S = setup(h); attach(h, S, empty());
    a.equal(h.editor.canPlace('solar', tiles(h)[0]).ok, want, '실제 설비 배치 버튼');
  });
  h.D.params.disasterGrant.v = 10;
  test('한도 초과', '누적 사용·남은 0·취소·기존 설비 유지·철거·정책', () => {
    const S = setup(h), p = solar(h);
    a.equal(submit(h, S, p).ok, true, '8억 건설');
    near(h.C.grantOf(S, h.R, ID, h.B).left, 2, '2억 남음');
    comparePlan(h, S, solar(h, 2), false, '분할 요청도 총16억 거절');
    a.equal(request(h, S, { type: 'respond', ev: 'heatwave_peak', opt: 'save' }).ok, true, '1억 대응');
    near(h.C.grantOf(S, h.R, ID, h.B).left, 1, '건설·대응 공동 잔액');
    a.equal(request(h, S, { type: 'respond', ev: 'heatwave_peak', opt: 'dr' }).ok, false, '4억으로 변경 초과 거절');
    a.equal(S.teams[ID].resp[`${S.round}:heatwave_peak`], 'save', '거절 시 이전 대응 유지');
    a.equal(request(h, S, { type: 'respond', ev: 'heatwave_peak', opt: 'none' }).ok, true, '취소 복구');
    near(h.C.grantOf(S, h.R, ID, h.B).left, 2, '취소 후 2억 복구');
    h.D.params.disasterGrant.v = 8;
    near(h.C.grantOf(S, h.R, ID, h.B).left, 0, '정확히 전액 소진');
    a.equal(request(h, S, { type: 'respond', ev: 'heatwave_peak', opt: 'save' }).ok, false, '남은0 유료 거절');
    a.equal(request(h, S, { type: 'respond', ev: 'heatwave_peak', opt: 'none' }).ok, true, '남은0 무료 취소');
    comparePlan(h, S, p, true, '기존 계획 유지');
    S.teams[ID].base = [{ k: `b:solar:${p.builds[0].i}`, c: 8 }]; S.teams[ID].committed = 8;
    near(h.C.grantOf(S, h.R, ID, h.B).used, 0, '월초 자산 재지원 없음');
    comparePlan(h, S, empty(), true, '기존 자산 철거');
    const pol = { ...p, policies: ['save'] }; comparePlan(h, S, pol, true, '정책 변경');
    a.equal(request(h, S, { type: 'econ', taxRes: 1, service: 1 }).ok, true, '도시 정책 변경');
    h.D.params.disasterGrant.v = 10;
    comparePlan(h, S, { ...empty(), builds: solar(h, 3).builds.slice(1) }, false, '철거 회수로 교부 한도 늘릴 수 없음');
  });
  for (const [amount, want] of [[4, true], [3.99, false], [3, false], [0, false]])
    test('한도 초과 대응', `4억/교부${amount}`, () => responseContract(h, amount, want));
  h.D.params.disasterGrant.v = 10;
  test('일반 예산', '교부와 분리·혼합 분담 경계', () => {
    for (const [general, want] of [[6, true], [5.99, false]]) {
      const S = setup(h, { over: false, general }); near(h.C.budget(S, ID), general, 'budget은 일반 돈만');
      comparePlan(h, S, solar(h, 2), want, '일반+전용 16억 후보');
    }
    // 갱신 3: 교부세 달에도 일반 예산을 0으로 깔지 않고 실제 초과100억을 보존한다.
    const S = setup(h); near(h.C.budget(S, ID), -100, '초과 도시 일반 예산−100억·교부와 분리');
  });
  test('연계선', '초과 도시는 잔여 교부세가 커도 수락 거절', () => {
    h.D.params.disasterGrant.v = 100;
    const S = setup(h), other = 'pyeongtaek';
    a.equal(request(h, S, { type: 'tie', op: 'propose', other: ID, cap: 2 }, other).ok, true);
    a.equal(h.C.fundingOf(h.B, S, h.R, ID, empty(), { kind: 'tie', extra: 5 }).ok, false);
    a.equal(request(h, S, { type: 'tie', op: 'accept', other }).ok, false);
    a.equal(S.ties.find(t => [t.a, t.b].includes(ID)).st, 'prop', '거절 후 제안 유지');
    const ordinary = setup(h, { over: false, general: 0 });
    a.equal(request(h, ordinary, { type: 'tie', op: 'propose', other: ID, cap: 2 }, other).ok, true);
    a.equal(request(h, ordinary, { type: 'tie', op: 'accept', other }).ok, false, '한도 안도 교부로 일반 연계선 비용 불가');
    h.D.params.disasterGrant.v = 10;
  });
  for (const [amount, existing, want] of [[6, 0, true], [5.99, 0, false], [0, 0, false], [10, 1, false], [14, 1, true]])
    test('선로 편집기', `교부${amount}/태양광${existing}`, () => {
      h.D.params.disasterGrant.v = amount;
      const S = setup(h), current = solar(h, existing); S.teams[ID].plan = current;
      const l = line(h), plan = { ...current, lines: [l] };
      near(h.B.capex({ ...empty(), lines: [l] }), 6, '독립 고정 선로비 6억');
      comparePlan(h, S, plan, want, '선로 후보');
      attach(h, S, current);
      const el = { innerHTML: '', querySelector: () => ({}) };
      const state = { st: clone(current), opts: { budget: h.ui.budget }, pending: { p: l.p, end: l.p[1], cost: 6 },
        undo: [], root: { querySelector: () => el } };
      h.editor.set(state); h.editor.showConfirm();
      a.equal(!el.innerHTML.includes(' disabled'), want, '선로 확인 버튼');
      // 실제 확정 함수의 금액·계획 변경은 그대로. 그리기·효과음·저장만 제외한다.
      const start = source.build.indexOf('  function confirmLine()'), end = source.build.indexOf('  function cancelLine()', start);
      let toast = '';
      vm.runInNewContext(source.build.slice(start, end) + ';confirmLine();', { S: state, withinBudget: h.editor.withinBudget,
        budgetShortfall: h.editor.budgetShortfall, fmt: h.editor.fmt, toast: msg => { toast = msg; }, undoTurn: () => null, mapEffect() {}, floater() {}, showConfirm() {}, changed() {}, hideTouchTip() {} });
      a.equal(state.st.lines.length, want ? 1 : 0, '실제 선로 확정 결과');
      a.equal(Boolean(toast), !want, '거절 안내');
      if (!want) {
        // T F6 예외: 이 fixture는 setup(over=true)로 이미 빚 한도 100억 초과다.
        // debt 거절은 종전 문구 유지. 일반 부족액 문구는 score1-node.js에서 별도 검증한다.
        a.equal(toast, '예산 부족(6.0억)', '빚 한도 초과 선로 거절 문구 유지');
      }
    });
  h.D.params.disasterGrant.v = 10;
  let randomCandidates = 0, withinCandidates = 0, overCandidates = 0;
  const legacyCases = [];
  function rng(seed) { let n = seed >>> 0; return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; }; }
  for (const zeroMode of ['사건 없음', 'params 0']) for (const id of IDS) for (const headroom of [-0.01, 0, 9, 80]) test('교부세0 회귀', `${zeroMode}/${id}/일반여력${headroom}`, () => {
    h.D.params.disasterGrant.v = zeroMode === 'params 0' ? 0 : 10;
    const S = setup(h, { id, over: false, general: headroom, events: zeroMode === 'params 0' ? ['heatwave_peak'] : [] });
    const basePlan = solar(h, 2, id); basePlan.lines = [line(h, id)];
    S.teams[id].plan = clone(basePlan);
    const lineCost = h.B.capex({ ...empty(), lines: basePlan.lines });
    S.teams[id].base = [
      ...basePlan.builds.map(b => ({ k: `b:solar:${b.i}`, c: h.B.capex({ ...empty(), builds: [b] }) })),
      { k: `l:${basePlan.lines[0].p.join('-')}`, c: lineCost }
    ];
    S.teams[id].sunk = 3; S.teams[id].committed = S.teams[id].base.reduce((sum, item) => sum + item.c, 0) + 3;
    attach(h, S, basePlan, id);
    const V = h.L.snap, me = V.teams[id], legal = tiles(h, id), rnd = rng(IDS.indexOf(id) * 91 + Math.round(headroom * 100) + 371);
    const linePool = h.B.TILES.flatMap(t => t.out ? [] : t.nb.filter(i => i > t.i && !h.B.TILES[i].out).map(i => ({ p: [t.i, i] })));
    near(h.C.grantAmount(V, h.R, id), 0, '교부세 없는 달');
    const candidates = [empty(), basePlan];
    for (let j = 0; j < 80; j++) candidates.push(h.B.sanitize({ ...empty(),
      builds: legal.filter(() => rnd() < .45).map(i => ({ t: 'solar', i })),
      lines: rnd() < .65 ? [clone(linePool[Math.floor(rnd() * linePool.length)])] : [],
      policies: rnd() < .5 ? ['save'] : [], rq: rnd() < .3 ? ['grid'] : [] }, 1e9));
    // 갱신 2: 한도 안에서는 옛 공식을 보존한다. 초과 도시는 유지·철거 예외까지
    // 호스트와 맞춰야 하므로 fundingOf와 실제 reduce가 편집기 허용 판단의 계약이다.
    const city = S.econ.cities[id], over = city.cash < -city.debtCap;
    a.equal(over, headroom < 0, '지방채 한도 경계 fixture(정확히 0은 한도 안)');
    let allowed = 0, rejected = 0;
    for (const plan of candidates) {
      // 교부세 도입 전 공개 편집기 공식 그대로. fundingOf/grantOf로 기대값을 재구성하지 않는다.
      const limit = me.budget - me.fixed - h.C.researchReserve(V, id, h.B, plan) - h.C.lossOf(me.base, plan);
      const legacyWant = h.B.capex(plan) <= limit;
      const want = over ? h.C.fundingOf(h.B, S, h.R, id, plan).ok : legacyWant;
      comparePlan(h, S, plan, want, `${over ? '초과: 호스트 계약' : '한도 안: 옛 공식'}/${randomCandidates}`, id);
      want ? allowed++ : rejected++; randomCandidates++;
      if (over) {
        overCandidates++;
        // 종전 36후보를 버리지 않고 과거 코드의 실제 편집기/호스트 비교 입력으로 보존한다.
        if (legacyWant !== want) legacyCases.push({ S: clone(S), plan: clone(plan), id, legacyWant, limit });
      } else withinCandidates++;
    }
    if (headroom <= 9) a.ok(rejected > 0, '거절 후보도 실제 비교');
    a.ok(allowed > 0, '유지·철거를 포함한 허용 후보도 실제 비교');
  });
  h.D.params.disasterGrant.v = 10;
  console.log(`교부세0 후보 ${randomCandidates}개: 한도 안 옛 공식 ${withinCandidates}개, 한도 초과 호스트 일치 ${overCandidates}개`);
  test('과거 정보', 'fc9e17a의 같은 36후보에서 옛 편집기와 옛 호스트 불일치 재현', () => {
    // 갱신 2: 교부세 도입(e885a02) 전 작업 줄기의 실제 두 파일만 VM 사본으로 읽는다.
    // 현재 구현 실패를 뜻하지 않으며, 옛 편집기 공식을 초과 도시에 강제하지 않는 근거다.
    const historical = load({
      league: execFileSync('git', ['show', 'fc9e17a:ui/league.js'], { cwd: ROOT, encoding: 'utf8' }),
      core: execFileSync('git', ['show', 'fc9e17a:ui/league-core.js'], { cwd: ROOT, encoding: 'utf8' })
    });
    a.equal(legacyCases.length, 36, '종전 불일치 36후보 모두 보존');
    let mismatches = 0, editorOnly = 0, hostOnly = 0;
    for (const { S, plan, id, legacyWant } of legacyCases) {
      // 옛 숫자형 콜백은 BG.current()를 읽으므로 비교할 후보를 실제 편집 상태로 둔다.
      attach(historical, S, plan, id);
      const editor = historical.editor.withinBudget(plan);
      a.equal(editor, legacyWant, '옛 VM 편집기와 독립 옛 공식 일치');
      const host = submit(historical, clone(S), clone(plan), id).ok;
      if (editor !== host) { mismatches++; editor ? editorOnly++ : hostOnly++; }
    }
    a.ok(mismatches > 0, '정보 단언: 같은 36후보 안에 옛 편집기 ≠ 옛 호스트가 실제 존재');
    console.log(`INFO 과거 fc9e17a: 36후보 중 옛 편집기 ≠ 옛 호스트 ${mismatches}개(편집기만 허용 ${editorOnly}, 호스트만 허용 ${hostOnly}); 현재 구현 실패 아님`);
  });
  test('AI 공통 판정', '실제 AI 후보와 최종 계획·호스트 승인', () => {
    for (const over of [false, true]) {
      const S = setup(h, { over, general: 6 }), calls = [], funding = h.C.fundingOf;
      h.C.fundingOf = (...args) => { const result = funding(...args); calls.push({ plan: clone(args[4]), ok: result.ok }); return result; };
      let result;
      try { result = h.AI.plan(S, h.R, ID, h.B, 'balanced'); } finally { h.C.fundingOf = funding; }
      a.ok(calls.length > 0, 'AI가 실제 fundingOf 호출');
      a.equal(funding(h.B, S, h.R, ID, result.plan).ok, true, '실제 AI 최종 계획 자금 가능');
      comparePlan(h, S, result.plan, true, 'AI 최종 계획');
      if (over) a.deepEqual(clone(result.plan.builds), [], '위기 AI 기존 조기 반환은 유지');
    }
  });
  // UI 비교 기준: 화면 연결 변경 전 실제 Git 파일. ui 사본을 다시 쓰거나 브라우저를 띄우지 않는다.
  const beforeLeague = execFileSync('git', ['show', '3fdcee5:ui/league.js'], { cwd: ROOT, encoding: 'utf8' });
  const old = load({ league: beforeLeague });
  function hud(harness) {
    const value = { textContent: '', dataset: {} }, label = { textContent: '' };
    let note = null;
    const money = { querySelector: selector => selector === '[data-v]' ? value : selector === '.v2-cap-k' ? label :
      selector === '.v2-cap-txt' ? { append: el => { note = el; } } :
      note && ((selector.includes('[data-money-note]') && Object.hasOwn(note.dataset, 'moneyNote')) ||
        (selector.includes('.lg-debt-note') && note.className === 'lg-debt-note')) ? note : null,
      getAttribute(k) { return this[k] ?? null; }, setAttribute(k, v) { this[k] = v; } };
    const syncStart = harness.league.indexOf('    const syncMoney = () => {');
    const start = harness.league.lastIndexOf('    const money = root.querySelector', syncStart);
    const end = harness.league.indexOf("    root.querySelectorAll('[data-cap]')", syncStart);
    a.ok(start >= 0 && syncStart > start && end > syncStart, '실제 HUD 주석 생성·syncMoney 함수 연결');
    harness.ctx.hudMoney = money;
    // 갱신 3: 주석 생성부터 실행해 0 달에 data-money-note를 붙이는 회귀도 잡는다.
    // DOM 쓰기만 대역 처리한다. 생성·자금·문구 계산은 실제 함수 그대로다.
    vm.runInContext(`{ const L = session, id = L.team, root = { querySelector: s => s === '[data-cap="budget"]' ? hudMoney : null },
      document = { createElement: tag => ({ tagName: tag, textContent: '', dataset: {}, className: '' }) },
      fmt = KCP.league.uiMath.fmt, grantMoneyNote = view.note, syncLastOutage = () => {},
      // 묶음 2(F1b): syncMoney가 좁은 화면 셋째 줄 금액을 실제 grantOf로 읽는다. 실제 모듈 값을 그대로 넘긴다.
      C = KCP.leagueCore, BG = KCP.buildGame, R = view.region || (() => KCP.leagueCore.regionOf(session.snap.region));
      ${harness.league.slice(start, end).replace('const syncMoney', 'globalThis.syncMoney')} }`, harness.ctx);
    harness.ctx.syncMoney();
    return { money, note, value, label, plain: `${label.textContent} ${value.textContent} ${note.textContent}`,
      dom: () => clone({ title: money.title, ariaLabel: money['aria-label'], value, label, note }) };
  }
  const py = fs.readFileSync(path.join(ROOT, 'tests/league/econui.py'), 'utf8');
  const debtPattern = py.match(/debt_note = r'([^']+)'/);
  a.ok(debtPattern, '실제 econui 정규식 읽기');
  // Python과 JS에서 같은 의미인 현행 패턴을 그대로 적용한다(브라우저 검사 실행 아님).
  const econuiRegex = new RegExp(debtPattern[1]);
  for (const [kind, amount, response, count, left] of [
    ['미지급', 10, false, 0, 0], ['전액 남음', 10, false, 0, 10],
    ['대응 후', 10, true, 0, 6], ['건설 후', 10, false, 1, 2], ['전액 사용', 16, false, 2, 0]
  ]) test('화면', kind, () => {
    h.D.params.disasterGrant.v = amount;
    const S = setup(h, { over: false, general: 50, events: kind === '미지급' ? [] : ['heatwave_peak'] });
    S.teams[ID].plan = solar(h, count);
    if (response) S.teams[ID].resp[`${S.round}:heatwave_peak`] = 'dr';
    attach(h, S, S.teams[ID].plan);
    const html = h.ui.cityHTML(h.L.snap), plain = html.replace(/<[^>]+>/g, ''), bar = hud(h);
    a.match(plain, /남은 돈에는 지방채 한도\(빚\)를 포함해요/, '서랍 기존 설명 유지');
    a.match(plain, econuiRegex, 'econui.py 실제 정규식 계속 일치');
    const n = (50 - count * 8 + Math.min(amount, count * 8 + (response ? 4 : 0)) - (response ? 4 : 0)).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
    // 일반 돈 50억, 적격 비용은 교부세 먼저 사용. UI 함수 반환값을 기대 문자열로 쓰지 않는다.
    const suffix = left ? ` · 이번 달 특별교부세 ${left}억(새 설비·선로·재난 대응, 남으면 보수비)` : '';
    const text = `남은 돈 ${n}억 (빚 한도 포함)${suffix}`;
    a.equal(bar.plain, text, '팀 돈 칸 확정 전체 문구');
    a.equal(bar.money.title, text, 'HUD title'); a.equal(bar.money['aria-label'], text, 'HUD aria');
    // 갱신 3: paragraph는 이름을 붙이지 않는다. 문단 자체의 title과 aria-label 부재를 확인한다.
    const paragraph = html.match(/<p class="lg-left"[^>]*>/)?.[0];
    a.ok(paragraph, '도시 서랍 남은 돈 문단 존재');
    a.doesNotMatch(paragraph, /\baria-label\s*=/, 'lg-left paragraph에는 aria-label 없음');
    if (left > 0) {
      a.ok(plain.includes(text), '도시 서랍 확정 전체 문구');
      a.ok(paragraph.includes(`title="${text}"`), '서랍 paragraph title은 확정 전체 문구');
      // 갱신 4: TIP 본문 클래스 재사용 대신 교부세 전용 주석 계약.
      a.equal(bar.note.className, 'lg-grant-note', '교부세 전용 클래스로 주석 표시');
      a.equal(bar.note.dataset.moneyNote, '', '교부세가 남은 달만 data-money-note 있음');
      h.L.snap.events = []; h.ctx.syncMoney();
      a.equal(bar.note.textContent, '(빚 한도 포함)', '교부세 소멸 시 주석 복귀');
      a.equal(bar.note.className, 'lg-debt-note', '교부세 소멸 시 클래스 복귀');
      a.equal(Object.hasOwn(bar.note.dataset, 'moneyNote'), false, '교부세 소멸 시 data-money-note 제거');
      old.D.params.disasterGrant.v = amount; attach(old, S, S.teams[ID].plan);
      old.L.snap.events = [];
      a.deepEqual(bar.dom(), hud(old).dom(), '교부세가 사라진 HUD 돈 칸 DOM도 종전 상태로 복귀');
    } else {
      old.D.params.disasterGrant.v = amount; attach(old, S, S.teams[ID].plan);
      a.deepEqual(Buffer.from(html), Buffer.from(old.ui.cityHTML(old.L.snap)), '교부세0/전액사용 서랍 HTML 바이트 동일');
      const previous = hud(old);
      a.equal(bar.plain, previous.plain, '교부세0 HUD 보이는 글자 동일');
      a.equal(bar.money.title, previous.money.title, '교부세0 HUD title 동일');
      a.equal(bar.money['aria-label'], previous.money['aria-label'], '교부세0 HUD aria 동일');
      a.equal(bar.note.className, previous.note.className, '교부세0 HUD 주석 클래스 동일');
      a.equal(bar.note.className, 'lg-debt-note', '교부세0 HUD는 기존 빚 주석 클래스');
      a.equal(Object.hasOwn(bar.note.dataset, 'moneyNote'), false, '교부세0 HUD에 data-money-note 없음');
      a.deepEqual(bar.dom(), previous.dom(), '교부세0 HUD 돈 칸 DOM 속성·텍스트 동일');
      a.ok(!plain.includes('이번 달 특별교부세'), '교부세0 서랍 안내 없음');
    }
  });
  const beforeBuild = execFileSync('git', ['show', '3fdcee5:ui/build.js'], { cwd: ROOT, encoding: 'utf8' });
  const oldBuild = load({ build: beforeBuild });
  for (const [kind, over, general, amount, response, count, left, money, grant] of [
    ['미지급', false, 50, 10, false, 0, 50, '50.0', ''],
    ['전액 남음', false, 50, 10, false, 0, 50, '50.0', '10.0'],
    ['대응 후', false, 50, 10, true, 0, 50, '50.0', '6.0'],
    ['건설 후', false, 50, 10, false, 1, 50, '50.0', '2.0'],
    ['전액 사용', false, 50, 16, false, 2, 50, '50.0', ''],
    ['음수 0 달', true, 0, 10, false, 0, -100, '-100.0', ''],
    ['소수 0 달', false, 50.25, 10, false, 0, 50.25, '50.3', ''],
    ['음수 교부세 달', true, 0, 10, false, 0, -100, '-100.0', '10.0']
  ]) test('build 화면', kind, () => {
    h.D.params.disasterGrant.v = amount;
    const S = setup(h, { over, general, events: grant || kind === '전액 사용' ? ['heatwave_peak'] : [] });
    S.teams[ID].plan = solar(h, count);
    if (response) S.teams[ID].resp[`${S.round}:heatwave_peak`] = 'dr';
    const actual = buildMoney(h, S), previous = buildMoney(oldBuild, S, left);
    const value = Number.isInteger(left) ? `${left}억` : `${money}억`;
    a.equal(actual.value, value, 'refreshHUD 표시 잔액에 미사용 교부세 합산 없음');
    const description = grant ? `남은 돈 ${money}억 (빚 한도 포함) · 이번 달 특별교부세 ${grant}억(새 설비·선로·재난 대응, 남으면 보수비)` : '';
    a.equal(actual.title, description || value, 'refreshHUD가 실제 쓴 [data-v] title');
    a.ok(previous.aria.endsWith(`예산 잔액 ${money}억.`), '3fdcee5 지도 문구 fixture');
    a.equal(actual.aria, grant ? previous.aria.replace(`예산 잔액 ${money}억.`, `${description}.`) : previous.aria,
      'updateAria가 실제 쓴 canvas aria-label 전체');
    if (!grant) a.deepEqual(actual, previous, '교부세0 build 돈 값/title·지도 라벨은 3fdcee5와 동일');
  });
  h.D.params.disasterGrant.v = 10;
  mutation('미사용분을 현금 세입으로 이월', { core: replaceOne(source['league-core'],
    '(grantUsed ?? r.disasterGrant?.used ?? grantOf(S, R, id).used)', 'grantAmount(S, R, id)') }, mutant => settleContract(mutant, 'unused', 0));
  mutation('연구 예약을 교부세로 감당', { core: replaceOne(source['league-core'],
    'const generalSpend = r2(spent + extra - grant.used)', 'const generalSpend = r2(spent + extra - grant.awarded)') }, researchContract);
  mutation('한도 초과 예외 경계 +1억', { core: replaceOne(source['league-core'],
    'grant.eligible <= grant.awarded + 1e-6', 'grant.eligible <= grant.awarded + 1 + 1e-6') }, boundaryContract);
  mutation('설비 편집기 판정 객체 무조건 허용', { build: replaceOne(source.build,
    'capex(plan) <= value + 1e-9 : value.ok', 'capex(plan) <= value + 1e-9 : true') }, mutant => {
      mutant.D.params.disasterGrant.v = 7;
      const S = setup(mutant); attach(mutant, S, empty());
      a.equal(mutant.editor.canPlace('solar', tiles(mutant)[0]).ok, false, '교부7억/설비8억 편집기 거절');
    });
  mutation('모든 사건 대응비를 교부 적격으로 되돌림', { core: replaceOne(source['league-core'],
    '(!grantOnly || E.grant)', 'true') }, mutant => nonDisasterResponseContract(mutant, true));
  // 0 달 조기 반환 제거를 두 소비 경로가 각각 잡고, 교부세 달의 연결 누락도 각각 잡아야 한다.
  for (const which of ['title', 'aria']) mutation(`build 교부세0 설명 회귀/${which}`, { build: replaceOne(source.build,
    'if (typeof value === "number" || !(value.grant.left > 0)) return "";',
    'if (typeof value === "number") return "";') }, mutant => buildDescriptionContract(mutant, which, false));
  mutation('build 교부세 달 돈 값 title 연결 누락', { build: replaceOne(source.build,
    'moneyValue.title = budgetDescription() || moneyValue.textContent',
    'moneyValue.title = moneyValue.textContent') }, mutant => buildDescriptionContract(mutant, 'title', true));
  mutation('build 교부세 달 지도 설명 연결 누락', { build: replaceOne(source.build,
    'LG && budgetDescription() || `예산 잔액 ${fmt(budgetLeft(), 1)}억`',
    '`예산 잔액 ${fmt(budgetLeft(), 1)}억`') }, mutant => buildDescriptionContract(mutant, 'aria', true));
} catch (e) { test('하네스', '준비·VM 실행', () => { throw e; }); }
for (const [group, counts] of groups) console.log(`${group}: 통과 ${counts.passed} / 실패 ${counts.failed}`);
console.log(`검사 ${passed + failed}건: 통과 ${passed} / 실패 ${failed}; 단언 실행 ${assertions}회; 변이 DETECTED ${detected}/9`);
process.exitCode = failed ? 1 : 0;
