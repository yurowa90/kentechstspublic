'use strict';
// 기대값 출처: spec-C.md M1·M2·M3·M5·M5b·M6·M10, impl-C.md 및 rev9 R4.
// M5 배분은 rev14b/spec.md A의 완전 탐색·최소 비용·W2로 대체한다.
// --head는 git show만 사용한다. 기본 실행은 구현 병합 후 작업판 검증용이다.
// 잡는 회귀: 월 길이에 뒤집히는 깜빡임, 교부세 용도 오안내, 음수 부호,
// 표시 합계 불일치·원값 변형, 문턱/같음 정밀도, 현금 음수 위험 오분류.
// 41/32번 VM 방식. 원본 ui/** 수정 없음. 브라우저·네트워크 실행 없음.
// API 부재는 BLOCKED 실패이며 skip 없음. 작업판은 다른 세션에서 실행한다.
const assert = require('node:assert/strict');
const O = require('./rev14b-contract.cjs');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const ROOT = path.resolve(__dirname, '../../..');
const { execFileSync } = require('node:child_process');
const head = process.argv.includes('--head');
const readUI = name => head
  ? execFileSync('git', ['show', `HEAD:ui/${name}.js`], { cwd: ROOT, encoding: 'utf8' })
  : fs.readFileSync(path.join(ROOT, `ui/${name}.js`), 'utf8');
const copy = x => x === undefined ? undefined : structuredClone(x);
const decode = s => String(s).replace(/&(?:amp|lt|gt|quot|#39|#x27);/g,
  x => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" }[x]));
const escape = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let assertions = 0, failures = 0;
function test(label, fn) {
  assertions++;
  try { fn(); console.log(`PASS ${label}`); }
  catch (e) { if (process.argv.includes('--debug')) console.error(e.stack); failures++; console.error(`${e.blocked ? 'BLOCKED' : 'FAIL'} ${label}: ${e.message}`); }
}
function blocked(message) { throw Object.assign(new Error(message), { blocked: true }); }
class Element {
  constructor(tag = 'root', attrs = {}, parent = null) {
    this.tagName = tag.toUpperCase(); this.attrs = attrs; this.parentElement = parent;
    this.children = []; this.parts = []; this._html = ''; this.style = {}; this.hidden = false;
    this.dataset = Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-'))
      .map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]));
    this.classList = { add() {}, remove() {}, toggle() {}, contains: c => (attrs.class || '').split(/\s+/).includes(c) };
  }
  get textContent() { return this.parts.map(x => typeof x === 'string' ? decode(x) : x.textContent).join(''); }
  set textContent(v) { this.parts = [String(v)]; }
  get innerHTML() { return this._html; }
  set innerHTML(value) {
    this._html = String(value); const root = htmlTree(this._html);
    this.children = root.children; this.parts = root.parts;
    for (const child of this.children) child.parentElement = this;
  }
  getAttribute(k) { return this.attrs[k] ?? null; }
  hasAttribute(k) { return Object.hasOwn(this.attrs, k); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  matches(selector) {
    if (selector === '*') return true;
    return selector.split(',').some(part => {
      part = part.trim();
      const bits = part.split(/\s+(?![^\[]*\])/);
      if (bits.length > 1) {
        if (!this.matches(bits.at(-1))) return false;
        let ancestor = this.parentElement, at = bits.length - 2;
        while (ancestor && at >= 0) { if (ancestor.matches(bits[at])) at--; ancestor = ancestor.parentElement; }
        return at < 0;
      }
      if (!part || /[ :>]/.test(part.replace(/\[[^\]]*\]/g, ''))) return false;
      const tag = part.match(/^[a-z][\w-]*/i)?.[0];
      if (tag && tag.toUpperCase() !== this.tagName) return false;
      const id = part.match(/#([\w-]+)/)?.[1];
      if (id && this.attrs.id !== id) return false;
      for (const [, cls] of part.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(cls)) return false;
      for (const [, key, , value] of part.matchAll(/\[([\w-]+)(?:=(["']?)(.*?)\2)?\]/g)) {
        if (!this.hasAttribute(key) || (value !== undefined && this.attrs[key] !== value)) return false;
      }
      return true;
    });
  }
  querySelectorAll(selector) { return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

}
function htmlTree(html) {
  const root = new Element(), stack = [root];
  for (const token of String(html).match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || []) {
    if (token.startsWith('<!--')) continue;
    if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
    if (token.startsWith('<')) {
      const tag = token.match(/^<([\w-]+)/)?.[1]; if (!tag) continue;
      const attrs = {};
      for (const [, k, a, b, c] of token.slice(tag.length + 1, -1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[k] = decode(a ?? b ?? c ?? '');
      const parent = stack.at(-1), el = new Element(tag, attrs, parent);
      parent.children.push(el); parent.parts.push(el);
      if (!/^(?:br|hr|input|img|meta|link|wbr)$/i.test(tag) && !token.endsWith('/>')) stack.push(el);
    } else stack.at(-1).parts.push(token);
  }
  return root;
}
const storage = new Map(), L = { role: 'solo', room: 'REV8CTEST', team: 'pyeongtaek', rev: 0 };
const document = { documentElement: {}, addEventListener() {}, getElementById: () => null,
  querySelector: () => null, querySelectorAll: () => [], createElement: tag => new Element(tag) };
const mem = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
const ctx = vm.createContext({ console, performance, structuredClone, URL, __session: L, document,
  addEventListener() {}, setTimeout() { return 0; }, clearTimeout() {},
  localStorage: mem, sessionStorage: mem,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  KCP: { route() {}, on() {}, gradeWords: String, esc: escape, leagueNet: { expandSnapshot: x => x } } });
ctx.window = ctx;
let bootError;
try {
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core'])
    {
      let input = readUI(name);
      if (name === 'build') input = input.replace('  let S = null;',
        '  let S = null; globalThis.__editor = {set: s => S = s, budgetDescription: () => typeof budgetDescription === "function" ? budgetDescription() : undefined};');
      vm.runInContext(input, ctx, { filename: name });
    }
  const source = readUI('league');
  console.log('implementation sha256 ' + require('node:crypto').createHash('sha256').update(source).digest('hex'));
  if (source.split('let L = null;').length !== 2 || source.split('KCP.league = {').length !== 2)
    blocked('기준판 VM 연결점이 없어 화면 함수 실행 불가');
  // 기준판에 존재하는 진입점만 메모리에서 노출한다. 새 구현의 함수명을 추측하지 않는다.
  const names = ['phaseChanged', 'grantMoneyNote', 'cityHTML', 'resultHTML', 'promiseVerdictText',
    'promiseResultHTML', 'outageWaterfallHTML', 'outageCardsHTML', 'outagePartRanking',
    'outageShownTotal', 'outageDisplayValues', 'outageDisplay', 'outageCardMin', 'outageReplayShown',
    'hostRisk', 'hostRiskHTML', 'trialCompareHTML', 'mountCity'];
  const start = source.indexOf('  function mountCity(');
  const adapter = source.slice(start).split('\n').find(x => x.trim().startsWith('budget:'));
  const budgetHook = adapter ? ',editorBudget: ' + adapter.trim().slice(7).replace(/,$/, '') : '';
  const hooks = names.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(',');
  vm.runInContext(source.replace('let L = null;', 'let L = globalThis.__session;')
    .replace('KCP.league = {', `globalThis.__hooks = {${hooks}${budgetHook}}; KCP.league = {`), ctx, { filename: 'league-under-test' });
} catch (e) { bootError = e; }
function api(name) {
  if (bootError) blocked(`VM 초기화 실패: ${bootError.message}`);
  const f = ctx.__hooks?.[name] || ctx.KCP.league?.uiMath?.[name];
  if (typeof f !== 'function') blocked(`기준판 진입점 접근 불가: ${name}`);
  return f;
}
const C = ctx.KCP.leagueCore, B = ctx.KCP.buildGame, D = ctx.KCP.ECON_DATA;
const id = L.team, ids = [id, 'dangjin'];
const values = { evening: 100, wind: 5, grid: 20, fuel: 100, neighbor: 10 };
let currentPlan, trialRecord;
function setup(o = {}, city = id) {
  if (bootError) blocked(`VM 초기화 실패: ${bootError.message}`);
  storage.clear(); ctx.__editor?.set(null);
  const S = C.newState(L.room, 'south', 0, [...new Set([...ids, city])], { turns: 12, seedMode: 'fixed' });
  C.host(S, 'next', 0);
  S.round = o.round ?? 2; S.phase = o.phase || 'plan'; S.events = [];
  const R = C.regionOf(S.region), pack = C.teamDef(R, city).pack;
  B.selectPack(pack, 'league');
  currentPlan = B.sanitize(copy(D.normalStartPlans[city]), 1e9);
  S.teams[city].plan = copy(currentPlan);
  B.current = () => currentPlan;
  B.lastTrial = () => trialRecord;
  B.refresh = () => {}; B.closeDrawer = () => {}; B.toast = () => {};
  trialRecord = o.trial ? { ...S.rounds[S.round - 1], map: pack, scope: JSON.stringify([L.room, city]),
    days: 7, unsPct: o.trial.unsPct, gridMWh: o.trial.perDay * 7 } : null;
  S.econ.cities[city].cash = o.cash ?? 3.2;
  S.econ.before ||= {}; S.econ.before[city] = { ...S.econ.cities[city], cash: o.cash ?? 3.2 };
  const result = (round, unsPct, perDay) => ({ ...S.rounds[round - 1], round, days: 7,
    team: { dangjin: { unsPct: 10 }, [city]: { unsPct, uns: 0, imp: 0, sub: 0, isolated: { uns: perDay * 7 },
      co2Cons: 1, co2Prod: 1, outH: 0, cost: { total: 0, repair: 0 } } } });
  S.results = S.round > 1 ? [result(S.round - 1, o.uns ?? 0, o.perDay ?? 0)] : [];
  if (['review', 'end'].includes(S.phase)) S.results.push(result(S.round, o.actualUns ?? 0, o.actualGrid ?? 0));
  const n = { s1EvidenceValues: copy(values), s1EvidenceNeighborId: 'dangjin', ...copy(o.note || {}) };
  if (o.topic) Object.assign(n, { topic: o.topic, confirmed: o.confirmed ?? true });
  const months = { [S.round]: n, ...(S.round > 1 ? { [S.round - 1]: {
    s1EvidenceValues: copy(values), s1EvidenceNeighborId: 'dangjin', ...copy(o.oldNote || {}) } } : {}) };
  Object.assign(L, { team: city, S, snap: S, rev: 0, panel: null, away: false, awaitReady: false,
    outCache: {}, outFailures: {}, outShownPending: null, viewing: null,
    doc: { map: pack, maps: { [pack]: currentPlan }, runs: [], journal: {} },
    interview: { docs: {}, journal: {}, interview: { months } } });
  return { S, n, months, R, pack };
}
function element(html, selector) {
  const el = htmlTree(html).querySelector(selector);
  assert.ok(el, `요소 필요: ${selector}`);
  return el;
}
const cashText = value => `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)}억`;
const cashTokens = text => text.match(/[+−-]?\d[\d,]*\.\d{2}억/g) || [];
const signedCash = value => `${value < 0 ? '−' : value > 0 ? '+' : ''}${Math.abs(value).toFixed(2)}억`;

// M1: 월 합계와 일평균 부호가 반대인 31→28→31, 31→30→31 경계.
for (const [round, before, after, want] of [
  [2, 70, 72, 'up'], [2, 70, 69, 'down'], [2, 70, 70, ''],
  [3, 72, 70, 'down'], [4, 70, 72, 'up'], [5, 72, 70, 'down']
]) for (const topic of ['grid', 'uns', 'cash']) test(`M1 ${topic} ${round - 1}→${round}월 하루 평균 ${want || '동일'}`, () => {
  const { S } = setup({ round, phase: 'review', topic });
  assert.equal(S.rounds[round - 2].mdays, round === 3 ? 28 : round === 5 ? 30 : 31, '비교 달 일수');
  assert.equal(S.rounds[round - 1].mdays, round === 2 ? 28 : round === 4 ? 30 : 31, '이번 달 일수');
  S.results[0].team[id].co2Prod = before;
  S.results[1].team[id].co2Prod = after;
  const chip = new Element('span'); chip.innerHTML = '<span data-v>10</span>';
  document.querySelector = selector => selector === '[data-cap="co2"]' ? chip : null;
  let observed;
  ctx.KCP.fxTurn = { monthEnd: data => { observed = data; return false; } };
  try {
    api('phaseChanged')(S);
    assert.ok(observed, '실제 monthEnd 호출');
    assert.equal(observed.hud.find(h => h.el === chip)?.direction, want);
    const row = htmlTree(api('resultHTML')(S, S.results.at(-1)))
    // rev11 R5: S6 생산 줄 이름이 'CO₂ 생산(이번 달)'로 바뀌어 찾는 낱말만 맞춘다(기대값 불변).
      .querySelectorAll('#lg-result-deltas div').find(e => e.textContent.includes('CO₂ 생산'));
    assert.ok(row, 'S6 생산 CO₂ 행');
    const delta = row.querySelector('small').textContent.match(/Δ\s*([+−-]?\d[\d,.]*)/);
    assert.ok(delta, 'S6 표시 Δ');
    const sign = Math.sign(Number(delta[1].replace('−', '-').replaceAll(',', '')));
    assert.equal(sign, want === 'up' ? 1 : want === 'down' ? -1 : 0);
  } finally { document.querySelector = () => null; delete ctx.KCP.fxTurn; }
});
test('M1 값 —인 CO₂ 칩은 방향 없음', () => {
  const { S } = setup({ phase: 'review', topic: 'grid' });
  S.results[0].team[id].co2Prod = 1; S.results[1].team[id].co2Prod = 2;
  const chip = new Element('span'); chip.innerHTML = '<span data-v>—</span>';
  document.querySelector = selector => selector === '[data-cap="co2"]' ? chip : null;
  let observed;
  ctx.KCP.fxTurn = { monthEnd: data => { observed = data; return false; } };
  try {
    api('phaseChanged')(S);
    assert.ok(observed, 'monthEnd 호출');
    assert.ok(!observed.hud.find(h => h.el === chip)?.direction, '값 없음은 깜빡이지 않음');
  } finally { document.querySelector = () => null; delete ctx.KCP.fxTurn; }
});

// M2: repairParam 있는 폭염/없는 황사 모두 교부세가 있는 달이다.
for (const [event, tail] of [
  ['heatwave_peak', '(새 설비·선로·재난 대응, 남으면 보수비)'],
  ['spring_dust_haze', '(새 설비·선로·재난 대응, 남으면 사라져요)']
]) for (const location of ['머리', '지도']) test(`M2 ${location} 꼬리 ${event}`, () => {
  const { S } = setup({ round: event === 'heatwave_peak' ? 7 : 3 });
  S.events = [{ id: event, round: S.round, x: 1 }];
  S.teams[id].plan = { builds: [], lines: [], policies: [], rq: [] };
  L.doc.maps[L.doc.map] = S.teams[id].plan;
  assert.ok(C.grantOf(S, C.regionOf(S.region), id, B).left > 0, '교부세 달 전제');
  if (location === '머리') {
    assert.ok(api('grantMoneyNote')(S, id).endsWith(tail), '머리 칩 꼬리');
    return;
  }
  // 44-grant의 실제 mountCity 예산 어댑터 방식. 함수 결과를 기대값으로 쓰지 않는다.
  const budget = api('editorBudget');
  if (!ctx.__editor) blocked('build budgetDescription 노출 불가');
  ctx.__editor.set({ st: S.teams[id].plan, opts: { budget } });
  const description = ctx.__editor.budgetDescription();
  if (description === undefined) blocked('build budgetDescription 노출 불가');
  assert.ok(description.endsWith(tail), '지도 칩 꼬리');
});
test('M2 교부세가 없는 달은 꼬리 없음', () => {
  const { S } = setup(); assert.equal(api('grantMoneyNote')(S, id), '');
});
for (const repair of [0, 3.45]) test(`M2 결과 교부세 보수비 전체 ${repair}`, () => {
  const { S } = setup({ phase: 'review' }), res = S.results.at(-1);
  res.team[id].disasterGrant = { awarded: 10, planUsed: 3, repairUsed: repair ? 2 : 0, expired: repair ? 5 : 7 };
  res.team[id].cost.repair = repair;
  const line = element(api('resultHTML')(S, res), '#lg-result-grant').textContent;
  assert.match(line, new RegExp(`보수비에 쓴 교부세 ${repair ? 2 : 0}(?:\\.00)?억`));
  assert.equal(line.includes('보수비 전체'), repair > 0);
  if (repair) assert.match(line, /\(보수비 전체 3\.45억\)/);
});

// M3: 도시 장부의 두 이름·모든 세입/세출 음수와 전기요금 차익 U+2212.
test('M2·M3 도시 세입·세출 이름과 음수 부호', () => {
  const { S } = setup();
  C.run(S, B, 0);
  const V = C.publicView(S, 0); L.snap = V;
  const f = V.econ.report.fiscal[id];
  f.rev.bonus = 2; f.rev.tariff = -2.34; f.rev.trade = -1.23;
  f.exp.opex = -3.45;
  const root = htmlTree(api('cityHTML')(V));
  const rows = root.querySelectorAll('.lg-money div');
  for (const [name, value] of [['사건 지원금(특별교부세 포함)', '2억'],
    ['기타 운영', '−3.45억'], ['전기요금 차익', '−2.34억'], ['전력 판매', '−1.23억']]) {
    const row = rows.find(e => e.querySelector('dt')?.textContent === name);
    assert.ok(row, name); assert.equal(row.querySelector('dd').textContent, value);
  }
});
test('M3 결과 장부 연료·운영비', () => {
  const { S } = setup({ phase: 'review' }), res = S.results.at(-1);
  res.team[id].ledger = { open: 10, income: 2, invest: 3, opex: 4, close: 5 };
  assert.match(element(api('resultHTML')(S, res), '#lg-result-ledger').textContent, /연료·운영비 4(?:\.00)?(?: |$)/);
});

const keys = ['choice', 'weather', 'event', 'progress', 'growth', 'trade'];
function attribution(values, target = 'grid', base = 10) {
  const total = values.reduce((x, y) => x + y, 0);
  return { basis: 'monthly', round: 2, id, target, unit: target === 'grid' ? 'MWh/일' : '%p', trial: base, base, total, actual: base + total,
    replay: 0, replayOutsideSum: true, parts: values.map((value, i) => ({ key: keys[i], value })),
    clues: Object.fromEntries(keys.map(k => [k, '가상 검사 단서'])), grid: { value: 0, waitingMW: 0 } };
}
function shownParts(a) {
  const rows = htmlTree(api('outageWaterfallHTML')(a)).querySelectorAll('[data-out-step]');
  assert.deepEqual(rows.map(e => e.dataset.outStep), ['previous', ...a.parts.map(p => p.key), 'actual']);
  return rows.slice(1, -1).map(e => {
    const text = e.querySelector('b').textContent;
    const m = text.match(/^([+−-]?\d[\d,]*(?:\.\d+)?)/);
    assert.ok(m, text); return Number(m[1].replace('−', '-').replaceAll(',', ''));
  });
}
function contractAPI() {return Object.fromEntries(['outageShownTotal','outageDisplayValues','outageDisplay','outageCardMin','outagePartRanking','outageReplayShown','outageWaterfallHTML'].map(n=>[n,api(n)]));}
function checkAllocation(a) {
 const L=contractAPI(),o=O.check(a,L,{html:true}),out=O.actualDisplay(a,L);
 const shown=shownParts(a),d=O.digits(a);
 assert.deepEqual(shown,a.parts.map(p=>O.rounded(out.values.get(p.key)??p.value,d)),'폭포 줄 = A2 선택 조합/각자 반올림');
 return shown;
}
// M5·C6: 음수·혼합·동률에서 합계 배분 또는 판정 일치를 위한 각자 반올림을 확인한다.
for (const values of [[.06, .06, .06], [-.06, -.06, -.06], [1.24, -.17, .06, -.12, .01, .02]])
  for (const target of ['grid', 'uns']) test(`M5 ${target} 고정 ${values}`, () => checkAllocation(attribution(values, target)));
test('M5 고정 씨앗 무작위 1,000건 모두 (a)(b)·조건부 합계·원값 순서', () => {
  let seed = 0x8c2026;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const errors = [];
  for (let i = 0; i < 1000; i++) {
    const values = keys.map(() => (random() - .5) * 20);
    const a = attribution(values, i % 2 ? 'grid' : 'uns', 100), before = JSON.stringify(a);
    try { checkAllocation(a); }
    catch (e) { errors.push(`사례 ${i}: ${e.message}`); }
    try { assert.equal(JSON.stringify(a), before, '표시 처리 전후 원값 불변'); }
    catch (e) { errors.push(`사례 ${i}: ${e.message}`); }
  }
  assert.equal(errors.length, 0, `1,000건 검사 중 ${errors.length}개 단언 실패; ${errors.slice(0, 3).join('; ')}`);
});
for(const [label,values,target,start] of [
 ['공동 최대',[.524,.521,.003,0,0,0],'uns',20],
 ['카드 비영',[.5251,.5211,.006,0,0,0],'uns',20],
 ['부호 혼합',[-.524,.5235,.103,.103,.103,0],'uns',20],
 ['합 .8 순서 보호',[.27,.24,.24,0,0,0],'grid',20],
 ['옛 탐욕 한계',[.042,.094,-.209,-.151],'grid',20],
 ['부호 반전',[-.042,-.094,.209,.151],'grid',20],
 ['두 자리 달',[.042,.094,-.209,-.151],'grid',0]
])test('M5 rev14b '+label,()=>checkAllocation(attribution(values,target,start)));
test('M5 rev14 목표는 표시 끝−시작 대신 원 total 반올림', () => {
  const endpoint = attribution([.06, 0, 0, 0, 0, 0], 'grid', 100.06);
  assert.equal(Math.round(Number(endpoint.actual.toFixed(1)) * 10) -
    Math.round(Number(endpoint.trial.toFixed(1)) * 10), 0, '독립 반올림한 시작·끝 눈금 차이는 0');
  assert.deepEqual(checkAllocation(endpoint), [.1, 0, 0, 0, 0, 0], 'total 0.06의 머리는 0.1');
  const a = attribution([.15, 0, 0, 0, 0, 0], 'grid', 100.06);
  assert.equal(Number((a.actual - a.trial).toFixed(1)), .2, '끝−시작 재계산의 부동소수 차이는 total과 다른 반올림');
  assert.deepEqual(checkAllocation(a), [.1, 0, 0, 0, 0, 0], 'total 0.15의 toFixed(1)은 0.1');
});
for (const missing of [null, undefined]) test(`M5 rev14 보완 3 total=${missing} 옛 기록`, () => {
  const a = attribution([1.06, 0, 0, 0, 0, 0]);
  a.total = missing;
  assert.deepEqual(checkAllocation(a), [1.1, 0, 0, 0, 0, 0], 'total 부재 시 끝−시작 반올림');
});
test('M5 C6 공동 가장 큼 꼬리표·판정 숫자 = 폭포 표시', () => {
  const { S, n } = setup({ phase: 'review', topic: 'uns' });
  const a = attribution([.524, .521, .003, 0, 0, 0], 'uns');
  n.outageFrozen = a; n.outageOpened = true; n.missed = 'weather';
  const before = JSON.stringify(a), shown = shownParts(a);
  const root = htmlTree(api('outageCardsHTML')(S, S.results.at(-1), id, n));
  const cards = root.querySelectorAll('[data-missed]');
  assert.deepEqual(cards.filter(c => c.querySelector('[data-out-tag="largest"]')?.textContent === '공동 가장 큼')
    .map(c => c.dataset.missed).sort(), ['choice', 'weather']);
  const verdict = root.querySelector('#lg-outage-verdict');
  assert.ok(verdict, '판정 문장 존재');
  for (const key of ['choice', 'weather']) {
    const card = cards.find(c => c.dataset.missed === key);
    const token = card.querySelector('.lg-out-size').textContent;
    assert.equal(Number(token.match(/[+−-]?\d[\d,.]*/)[0].replace('−', '-')), shown[keys.indexOf(key)]);
    assert.equal(shown[keys.indexOf(key)], .52);
    const name = card.querySelector('strong').textContent;
    assert.ok(verdict.textContent.includes(`${name} ${token}`), `판정 문장도 ${name} ${token}`);
  }
  assert.match(verdict.textContent, /가장 큰 것\(크기 같음 2개\)/);
  assert.equal(JSON.stringify(a), before);
});
test('M5 카드 표시 = 폭포 표시, 후보·최대 순서는 원값 기준', () => {
  const { S, n } = setup({ phase: 'review' });
  const a = attribution([1.06, .76, .56, .01, .01, 0]);
  n.outageFrozen = a; n.outageOpened = true; n.missed = 'choice';
  const shown = checkAllocation(a), before = JSON.stringify(a);
  const cards = htmlTree(api('outageCardsHTML')(S, S.results.at(-1), id, n)).querySelectorAll('[data-missed]');
  assert.deepEqual(cards.map(e => e.dataset.missed), ['choice', 'weather', 'event']);
  for (const card of cards) {
    const value = Number(card.querySelector('.lg-out-size').textContent.match(/[+−-]?\d[\d,.]*/)[0].replace('−', '-'));
    assert.equal(value, shown[keys.indexOf(card.dataset.missed)]);
  }
  assert.equal(api('outagePartRanking')(a).largest.key, 'choice');
  assert.equal(JSON.stringify(a), before);
});

// rev9 R4: 계통 실제값은 소수 1자리. 0.12→0.1과 올림 0.2를 함께 보인다.
for (const [total, want] of [[2.4, '5%(0.1, 표시 눈금으로 올려 0.2)'], [4, '5%(0.2)']])
  test(`M5b 문턱 Δ=${total}`, () => {
    const { S, n } = setup({ phase: 'review' });
    n.outageFrozen = attribution([total - .05, .01, .01, .01, .01, .01]); n.outageOpened = true;
    const text = htmlTree(api('outageCardsHTML')(S, S.results.at(-1), id, n)).textContent.replace(/ MWh\/일/g, '');
    assert.ok(text.includes(want), `필수 문턱 ${want}: ${text.slice(0, 400)}`);
    assert.equal(text.includes('표시 눈금으로 올려'), total === 2.4);
  });
// M5c·확정 문구: 분해 대상과 별도로 약속 주제에 따라 시험/실제 안내를 바꾼다.
for (const topic of ['grid', 'uns']) test(`M5c ${topic} 시험/실제 안내`, () => {
  const { S, n } = setup({ phase: 'review', topic, trial: { unsPct: 1, perDay: 1 } });
  Object.assign(trialRecord, { outH: 1, co2: 1, opex: 1 });
  n.outageFrozen = attribution([1, 0, 0, 0, 0, 0], topic); n.outageOpened = true;
  const text = htmlTree(api('trialCompareHTML')(S, S.results.at(-1), id)).textContent;
  const subject = topic === 'grid' ? '바깥 계통에 기댄 전기' : '정전';
  assert.ok(text.includes(`원인 카드는 지난달 실제 → 이번 달 실제의 ${subject} 변화를 나눠요. 위 시험 / 실제 차이와는 기준이 달라요.`));
});
// M6: 판정 계산과 같은 최대 소수 둘째 자리. 정수/끝자리 0을 강제로 덧붙이지 않는다.
for (const tol of [.05, .1, .25, 1]) test(`M6 같음 tol=${tol} 소수 둘째 자리`, () => {
  setup();
  const text = api('promiseVerdictText')({ r: {}, topic: 'grid', actual: 'same', hit: true,
    grid: { deltaPerDay: 0, tolPerDay: tol, perDay: 10, mwh: 300, cost: 1,
      base: { label: '지난달 대비', perDay: 10 } } }, { pred: { grid: 'same' } });
  assert.ok(text.includes(`±${tol} 안`), text);
});
// M10: 빚 한도 안 현금 음수만 있는 도시는 위험이 아니라 주의.
for (const [cash, left, level] of [[-1, 10, 'caution'], [0, 10, null], [1, 10, null], [-1, -1, 'risk']])
  test(`M10 현금 ${cash}, 남은 돈 ${left}`, () => {
    const { S } = setup();
    for (const city of Object.values(S.econ.cities)) { city.cash = 1; city.approval = city.approval0; }
    for (const team of Object.values(S.teams)) team.left = 10;
    S.grid = {}; S.econ.cities[id].cash = cash; S.teams[id].left = left;
    assert.equal(api('hostRisk')(S, null, id).includes('현금 음수'), cash < 0);
    const chips = htmlTree(api('hostRiskHTML')(S, null)).querySelectorAll('.lg-risk-chip');
    assert.equal(chips.length, level ? 1 : 0);
    if (level) {
      assert.equal(chips[0].dataset.level, level);
      assert.match(chips[0].textContent, level === 'caution' ? /● 주의/ : /▲ 위험/);
      const reasons = chips[0].querySelector('span').textContent.split(' · ');
      assert.ok(reasons.includes('현금'), '짧은 사유 현금');
      if (left < 0) assert.ok(reasons.includes('남은 돈'));
      else assert.deepEqual(reasons, ['현금']);
    }
  });
console.log(`assertions ${assertions} failures ${failures}`);
process.exitCode = failures ? 1 : 0;

