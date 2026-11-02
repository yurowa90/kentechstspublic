'use strict';
// rev9 R4~R7·R10~R12·R14·R16~R19: 기대값은 rev9-fix/spec.md와 REV9_COPY에서 독립 작성.
// 실행: node tests/league/review/55-rev9.js [--head] [구현 사본 경로]
// 작성 세션은 --head만 실행. 브라우저·통신·원본 변경 없음.
// 41/32번 VM 방식. 원본 ui/** 수정 없음. 브라우저·네트워크 실행 없음.
// 선택 인자는 기준판/변이 사본 경로. API 부재는 BLOCKED 실패이며 skip 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const ROOT = path.resolve(__dirname, '../../..');
// rev9 R4: --head는 동시 수정 중인 ui 작업판을 읽지 않는 검증 경로.
const { execFileSync } = require('node:child_process');
const readUI = name => process.argv.includes('--head')
  ? execFileSync('git', ['show', `HEAD:ui/${name}.js`], { cwd: ROOT, encoding: 'utf8' })
  : fs.readFileSync(name === 'league' && process.argv[2] || path.join(ROOT, `ui/${name}.js`), 'utf8');
const copy = x => x === undefined ? undefined : structuredClone(x);
const decode = s => String(s).replace(/&(?:amp|lt|gt|quot|#39|#x27);/g,
  x => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" }[x]));
const escape = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let assertions = 0, failures = 0;
function test(label, fn) {
  assertions++;
  try { fn(); console.log(`PASS ${label}`); }
  catch (e) { failures++; console.error(`${e.blocked ? 'BLOCKED' : 'FAIL'} ${label}: ${e.message}`); }
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
const storage = new Map(), L = { role: 'solo', room: 'REV9TEST', team: 'pyeongtaek', rev: 0 };
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
    vm.runInContext(name === 'build' ? readUI(name).replace('KCP.buildGame = {',
      `globalThis.__buildHooks = {gridWaitInfo: typeof gridWaitInfo === 'undefined' ? undefined : gridWaitInfo, gridAdvice: typeof gridAdvice === 'undefined' ? undefined : gridAdvice}; KCP.buildGame = {`) : readUI(name), ctx, { filename: name });
  const source = readUI('league');
  console.log('implementation sha256 ' + require('node:crypto').createHash('sha256').update(source).digest('hex'));
  if (source.split('let L = null;').length !== 2 || source.split('KCP.league = {').length !== 2)
    blocked('기준판 VM 연결점이 없어 화면 함수 실행 불가');
  // 기준판에 존재하는 진입점만 메모리에서 노출한다. 새 구현의 함수명을 추측하지 않는다.
  const names = ['outageCardsHTML', 'outageShareThresholdText', 'outageEvidenceSummary', 'outageDisplayValues',
    'cityHTML', 'groupCauseHTML', 'hostOverviewHTML', 'trialGoals', 'promiseTopic', 'predictionHTML', 'promiseComparison', 'promiseResultHTML',
    'reasonStartsHTML', 'evidenceCandidates', 'evidenceFocusHTML', 'outageEvidenceText',
    'outageEventClue', 'resultHTML', 'decisionsHTML', 'evidenceEffect', 'OUTAGE_EVIDENCE_LINKS'];
  const hooks = names.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(',');
  vm.runInContext(source.replace('let L = null;', 'let L = globalThis.__session;')
    .replace('KCP.league = {', `globalThis.__hooks = {${hooks}}; KCP.league = {`), ctx, { filename: 'league-under-test' });
  // rev9 R5: 판정은 기준 HEAD 함수와 대조. 기대 문구를 HEAD에서 읽지는 않는다.
  const baseline = execFileSync('git', ['show', 'HEAD:ui/league.js'], {cwd: ROOT, encoding: 'utf8'});
  vm.runInContext(baseline.replace('let L = null;', 'let L = globalThis.__session;')
    .replace('KCP.league = {', 'globalThis.__headHooks = {promiseComparison, evidenceEffect}; KCP.league = {'), ctx);
} catch (e) { bootError = e; }
function api(name) {
  if (bootError) blocked(`VM 초기화 실패: ${bootError.message}`);
  const f = ctx.__hooks?.[name];
  if (typeof f !== 'function') blocked(`기준판 진입점 접근 불가: ${name}`);
  return f;
}
const C = ctx.KCP.leagueCore, B = ctx.KCP.buildGame, D = ctx.KCP.ECON_DATA;
const id = L.team, ids = [id, 'dangjin'];
const values = { evening: 100, wind: 5, grid: 20, fuel: 100, neighbor: 10 };
let currentPlan, trialRecord;
function setup(o = {}, city = id) {
  if (bootError) blocked(`VM 초기화 실패: ${bootError.message}`);
  storage.clear();
  const S = C.newState(L.room, 'south', 0, [...new Set([...ids, city])], { turns: 12, seedMode: 'fixed' });
  C.host(S, 'next', 0);
  S.round = o.round ?? 2; S.phase = o.phase || 'plan'; S.events = [];
  const R = C.regionOf(S.region), pack = C.teamDef(R, city).pack;
  B.selectPack(pack, 'league');
  currentPlan = B.sanitize(copy(D.normalStartPlans[city]), 1e9);
  S.teams[city].plan = copy(currentPlan);
  B.current = () => currentPlan;
  B.lastTrial = () => trialRecord;
  B.refresh = () => {}; B.closeDrawer = () => {};
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

const keys=['choice','weather','event','progress','growth','trade'];
function attribution(values, target='grid') {
  const total=values.reduce((a,b)=>a+b,0);
  return {basis:'monthly',round:2,id,target,unit:target==='grid'?'MWh/일':'%p',trial:10,base:10,actual:10+total,total,
    replay:0,replayOutsideSum:true,parts:values.map((value,i)=>({key:keys[i],value})),
    clues:Object.fromEntries(keys.map(k=>[k,'가상 단서'])),grid:{value:0,waitingMW:0}};
}
// rev9 R4: 사전에 정한 십진 곱과 표시·올림 기대값. 소수 4자리 이상 금지.
for (const [total, unit, want] of [
  [11.3959, 'MWh/일', '5%(0.6 MWh/일)'],
  [2.38286, 'MWh/일', '5%(0.1, 표시 눈금으로 올려 0.2 MWh/일)'],
  [2.38286, '%p', '5%(0.12%p)'],
  [2.2222, '%p', '5%(0.11, 표시 눈금으로 올려 0.12%p)']
]) test(`R4 Δ ${total} ${unit}`, () => {
  const {S,n}=setup({phase:'review'});
  const text = api('outageShareThresholdText')(.05 * total, unit);
  n.outageFrozen=attribution([total,0,0,0,0,0],unit==='MWh/일'?'grid':'uns');
  n.outageOpened=true;
  const summary=htmlTree(api('outageCardsHTML')(S,S.results.at(-1),id,n)).textContent;
  assert.equal(text, want);
  assert.doesNotMatch(text, /\d+\.\d{4,}/);
  assert.ok(summary.includes(want),summary);
  assert.doesNotMatch(summary,/\d+\.\d{4,}/,'S7 요약 전체에도 소수 4자리 이상 없음');
});

// rev9 R5: 효과 −1/+1, actual same 분기와 HEAD의 판정·근거 부호 보존.
for (const row of [
  {topic:'cash', key:'fuel', name:'LNG 지수', before:1.67, now:1.79, delta:-2.88, expected:'↓', actual:'down', end:'같음'},
  {topic:'cash', key:'fuel', name:'LNG 지수', before:1.05, now:1.09, delta:46.26, expected:'↓', actual:'up', end:'반대'},
  {topic:'cash', key:'fuel', name:'LNG 지수', before:1.05, now:1.09, delta:.1, expected:'↓', actual:'same'},
  {topic:'uns', key:'evening', name:'저녁 수요', before:100, now:120, delta:2, expected:'↑', actual:'up', end:'같음'}
]) test(`R5 ${row.topic}/${row.key} 실제 ${row.actual}`, () => {
  const {S,n} = setup({phase:'review', topic:row.topic, cash:10, uns:10, actualUns:12,
    oldNote:{s1EvidenceValues:{[row.key]:row.before}},
    note:{s1EvidenceValues:{[row.key]:row.now}, evidence:{key:row.key,text:row.name,value:row.now}, pred:{[row.topic]:'up'}}});
  S.econ.before[id].cash = 10; S.econ.cities[id].cash = 10 + row.delta;
  const compared = api('promiseComparison')(S,n), baseline = ctx.__headHooks.promiseComparison(S,n);
  assert.equal(compared.actual, row.actual);
  assert.equal(compared.actual, baseline.actual); assert.equal(compared.hit, baseline.hit);
  assert.equal(api('evidenceEffect')(row.key,{topic:row.topic}).sign, ctx.__headHooks.evidenceEffect(row.key,{topic:row.topic}).sign);
  const target = row.topic === 'cash' ? '현금' : '정전';
  const ending = row.actual === 'same' ? `실제 ${target} '같음' 범위 안 → 근거 쪽으로 안 움직임` :
    `실제 ${target} ${row.actual === 'up' ? '↑' : '↓'} → 근거가 가리킨 쪽과 ${row.end}`;
  const want = `고른 근거도 같은 쪽으로 움직였나요: ${row.name} ↑ → ${target} ${row.expected} 쪽 예상 · ${ending}(게임 안 단순 비교)`;
  assert.equal(element(api('promiseResultHTML')(S,n), '#lg-evidence-direction').textContent, want);
});

// rev9 R6: 현금 Δ의 두 자리·양수 부호, tol은 끝자리 0 없는 0.5.
test('R6 현금 계산 +4.19 / tol 0.5, 예측 자세히 안', () => {
  const {S,n}=setup({phase:'review',topic:'cash',cash:10,
    note:{evidence:{key:'fuel',text:'LNG 지수',value:120},pred:{cash:'up'}}});
  S.econ.cities[id].cash=14.19;
  const calc=element(api('promiseResultHTML')(S,n),'#lg-promise-cash-calc');
  assert.equal(calc.textContent,"판정 계산: 운영 전 대비 Δ +4.19억 · '같음' 범위 ±0.5억 미만(게임 비교 기준)");
  // rev16 #72-1: 계산 내용은 유지하고 상세 섹션으로 이동한다.
  // promiseResultHTML은 section까지 생성한다. details 포장은 실제 화면(rev16.py)에서 확인.
  const ancestors=[]; for(let p=calc.parentElement;p;p=p.parentElement) ancestors.push(p);
  assert.ok(ancestors.some(p=>p.getAttribute('id')==='lg-promise-result'));
});
// rev9 R7: 최대 나머지 배분이 원값 반올림과 다른 고정 입력. 원값·정렬 불변.
for(const fn of ['outageEvidenceSummary','outageEvidenceText']) test(`R7 ${fn} −3.254 → −3.2`,()=>{
  const {n}=setup({note:{evidence:{key:'wind',text:'풍속',value:5}}});
  const a=attribution([0,-3.254,.644,0,5.61,0]); a.hasConnectedWind=true;
  const before=JSON.stringify(a);
  assert.equal(api('outageDisplayValues')(a).get('weather'),-3.2,'입력의 배분값 전제');
  const text=api(fn)(n,a,a.parts[4]);
  assert.match(text,/날씨·계절·운전 기간 −3\.2 MWh\/일/);
  assert.doesNotMatch(text,/−3\.3 MWh\/일/); assert.equal(JSON.stringify(a),before);
});
// rev9 R10: 월간 결과의 정전 시간 행만 K6; 같은 일수·첫 시험에는 꼬리 없음.
for(const [round,before,after,want] of [[3,28,31,true],[2,31,31,false],[1,0,31,false]])
  test(`R10 ${before}→${after}일`,()=>{
    const {S}=setup({phase:'review',round,topic:'uns',trial:{unsPct:1,perDay:1}});
    if(round>1) S.rounds[round-2].mdays=before;
    S.rounds[round-1].mdays=after;
    for(const res of S.results) res.team[id].outH=2;
    const root=htmlTree(api('resultHTML')(S,S.results.at(-1)));
    const rows=root.querySelectorAll('#lg-result-deltas div');
    const row=rows.find(e=>e.querySelector('dt')?.textContent==='정전 시간(이번 달)');
    assert.ok(row); assert.equal(row.textContent.includes(`(달 일수 ${before}→${after}일)`),want);
    assert.equal(rows.filter(e=>e.textContent.includes('(달 일수')).length,want?1:0);
  });

// rev9 R11(문구는 독립 사실 검토 뒤 고친 spec K7 '깎는 몫'·'개'): 공개 shares·groupOwn(Lag)만으로 가중합, 입지 수는 집단 최댓값.
for(const row of [
  {label:'전부 입지',own:[{complaint:-10,complaintN:2,sitingN:2},{complaint:-4,complaintN:3,sitingN:3}],lag:[-2,-1],want:'민원(입지 3개)이 깎는 몫: 지금 −1.25%p · 다 반영되면 −5.5%p'},
  {label:'혼합',own:[{complaint:-10,complaintN:4,sitingN:2},{complaint:-4,complaintN:3,sitingN:3}],lag:[-2,-1],want:'민원(입지 3개 포함)이 깎는 몫: 지금 −1.25%p · 다 반영되면 −5.5%p'},
  {label:'입지 없음',own:[{complaint:-10,complaintN:4},{complaint:-4,complaintN:3}],lag:[-2,-1],want:'민원이 깎는 몫: 지금 −1.25%p · 다 반영되면 −5.5%p'},
  {label:'양쪽 0.005 미만',own:[{complaint:-.004,complaintN:1},{complaint:0}],lag:[-.004,0],want:null},
  {label:'final만 경계',own:[{complaint:-.02,complaintN:1},{complaint:0}],lag:[0,0],want:'민원이 깎는 몫: 지금 0%p · 다 반영되면 −0.01%p'}
]) test(`R11 ${row.label}`,()=>{
  const {S}=setup({phase:'review'}), c=S.econ.cities[id], gs=Object.keys(c.groups);
  c.shares=Object.fromEntries(gs.map((g,i)=>[g,i===0?.25:i===1?.75:0]));
  c.groupOwn=Object.fromEntries(gs.map((g,i)=>[g,row.own[i]||{}]));
  c.groupOwnLag=Object.fromEntries(gs.map((g,i)=>[g,{complaint:row.lag[i]||0}]));
  S.econ.report={groups:{[id]:{why:'가상 공개 이유',whyGrade:'G'}},cities:{},fiscal:{},flows:{}};
  const text=element(api('cityHTML')(S),'#lg-approval-why').textContent;
  if(row.want) assert.ok(text.endsWith(' · '+row.want),text);
  else assert.doesNotMatch(text,/민원.*깎는 몫:/);
});
// rev9 R12: 혼합 민원은 상한 포함, 정확 경계·상한 아래 모두 K8 검사.
for(const value of [-20,-10]) test(`R12 cap 20 / ${value}`,()=>{
  const {S}=setup(),c=S.econ.cities[id],g=Object.keys(c.groups)[0];
  assert.equal(D.params.complaintCap.v,20);
  c.groupOwn={[g]:{complaint:value,complaintN:4,sitingN:2}};
  c.groupOwnLag={[g]:{complaint:-2}};
  const text=htmlTree(api('groupCauseHTML')(c,g,null,null)).textContent;
  assert.ok(text.includes(`민원 요인 4개 중 입지 2개 · 상한 20점${value===-20?'에 걸림':''}`),text);
  assert.equal(text.includes('20점에 걸림'),value===-20); assert.doesNotMatch(text,/민원 항목/);
});
// rev9 R14: K10은 공개 월말 현금 / 빚 포함 left를 각각 사용하며 끝 공백 유지.
for(const topic of ['cash','uns','grid']) test(`R14 ${topic} 시작 칩`,()=>{
  const {S}=setup({phase:'review',topic,cash:-7.81}); S.teams[id].left=12.34;
  const chips=htmlTree(api('reasonStartsHTML')(S)).querySelectorAll('[data-reason-start]');
  assert.equal(chips.length,3);
  const want=topic==='cash'?'월말 현금 −7.81억이라 ':'남은 돈(빚 한도 포함) 12.3억이라 ';
  assert.equal(chips[2].textContent,want);assert.equal(chips[2].getAttribute('data-reason-start'),want);
});
// rev9 R17(검토 반영: build.js fmt(…,2)는 끝자리 0을 남김 — 기존 말풍선 '0.00 MW'와 같은 형식, spec R17): 월 처리량으로 3달이지만 상한 안인 입력과 진짜 blocked를 구별.
for(const row of [
  {label:'3달',room:20,monthly:1,ahead:2,months:3,ess:false},
  {label:'blocked',room:0,monthly:1,ahead:2,months:null,ess:true},
  {label:'1달',room:20,monthly:10,ahead:0,months:1,ess:false},
  {label:'처리량 0',room:20,monthly:0,ahead:2,months:null,ess:true}
]) test(`R17 ${row.label}`,()=>{
  setup();
  const advice=ctx.__buildHooks?.gridAdvice, info=ctx.__buildHooks?.gridWaitInfo;
  if(typeof advice!=='function'||typeof info!=='function') blocked('build gridAdvice/gridWaitInfo 접근 불가');
  const type='solar',tile=101,mw=B.BLD[type].mw;
  assert.equal(mw,2,'공개 설비 자료의 태양광 2 MW');
  // 2 MW 설비 + 앞선 4 MW를 월 2 MW씩 처리: 상한 20 MW 안에서 3달.
  const monthly=row.monthly===1?2:row.monthly, ahead=row.ahead*2;
  const grid={headroomMW:row.room,monthlyMW:monthly,waitingMW:ahead,reservedMW:0,
    entries:ahead?[{key:'solar:100',mw:ahead,allocatedMW:0}]:[]};
  const detail=info(type,tile,grid),text=advice(type,tile,grid);
  assert.equal(detail.months,row.months);
  if(row.label==='3달') assert.equal(text,'이번 달 접속 가능 0.00 MW · 앞선 대기 4.00 MW · 월 2.00 MW 처리로 3달 대기');
  if(row.label==='1달') assert.equal(text,'이번 달 접속 가능 10.00 MW · 이 설비 1달 대기');
  assert.equal(text.includes('ESS 필요'),row.ess);
});
// rev9 R18: 끝 화면과 S6가 같은 fmt(2) 숫자; 정수와 끝자리 0 모두 제거.
for(const repair of [0,2.5]) test(`R18 끝 화면 교부세 / 보수 ${repair}`,()=>{
  const {S}=setup({phase:'end',round:7}),res=S.results.at(-1);
  res.team[id].disasterGrant={awarded:10,planUsed:3.2,repairUsed:repair?1:0,expired:repair?5.8:6.8};
  res.team[id].cost.repair=repair;
  const end=htmlTree(api('decisionsHTML')(S)).querySelectorAll('li').filter(e=>e.textContent.includes('특별교부세'));
  assert.equal(end.length,1);
  const tokens=end[0].textContent.match(/\d+(?:\.\d+)?억/g);
  assert.deepEqual(tokens,repair?['10억','3.2억','1억','5.8억','2.5억']:['10억','3.2억','6.8억']);
  const s6=element(api('resultHTML')(S,res),'#lg-result-grant').textContent;
  for(const t of tokens) assert.ok(s6.includes(t),t);
  assert.doesNotMatch(end[0].textContent,/\d+\.\d*0억/);
});
// rev9 R16: 계획의 지난달 표시는 보존, 결과·끝 칩과 낭독은 K11.
for(const phase of ['plan','review','end']) test(`R16 진행자 공동목표 ${phase}`,()=>{
  const {S}=setup({phase}),res=S.results.at(-1);
  res.econ={region:{unsPct:4,co2:123,goal:{uns:5,co2:200}}};
  const root=htmlTree(api('hostOverviewHTML')(S,res)),chips=root.querySelectorAll('.lg-goal-chip');
  assert.equal(chips.length,2);
  const want=phase==='plan'?`지난달 실제 (${res.month}월)`:`이번 달 실제 (${res.month}월)`;
  for(const chip of chips) assert.ok(chip.textContent.includes(want),chip.textContent);
  const co2=chips[1].getAttribute('aria-label');
  assert.ok(co2.includes(phase==='plan'?'지난달 실제':'이번 달 실제'),co2);
  const meters=root.querySelectorAll('[role="meter"]');
  assert.equal(meters.length,2);
  for(const meter of meters) {
    const aria=meter.getAttribute('aria-label');
    assert.ok(aria.includes(phase==='plan'?'지난달':'이번 달 실제'),aria);
    if(phase!=='plan') assert.ok(!aria.includes('지난달'),aria);
  }
});
// rev9 R19: 확정 호우와 우리 도시 계획의 네 태양광 종류로 K13a/b 선택.
for(const type of [null,'solar','roof','tandem','tandem_roof']) test(`R19 호우 / ${type||'태양광 없음'}`,()=>{
  const {S,R,pack}=setup({round:7});
  S.events=[{id:'heavy_rain',round:S.round,x:1}];
  assert.ok(C.hits(R,C.eventDef(R,'heavy_rain'),id),'우리 도시에 해당하는 확정 호우');
  currentPlan.builds=currentPlan.builds.filter(b=>!['solar','roof','tandem','tandem_roof'].includes(b.t));
  if(type) currentPlan.builds.push({t:type,i:101});
  S.teams[id].plan=copy(currentPlan);
  const goals=api('trialGoals')({map:pack,seed:1,days:7,tot:{dem:100,co2:1,by:{import:7}},unsTotal:0});
  assert.ok(Array.isArray(goals?.notes),'시험 안내 notes 필요');
  const want=type?'시험에는 호우 때 줄어드는 태양광 출력과 월말 공공시설 보수비도 들어 있지 않아요.':
    '시험에는 월말 공공시설 보수비가 들어 있지 않아요. 우리 도시엔 태양광이 없어 호우로 출력이 줄지는 않아요.';
  const at=goals.notes.indexOf(want);
  assert.ok(at>=0,JSON.stringify(goals.notes));
  assert.ok(!goals.noteDetails?.[at] || goals.noteDetails[at].visible===want,'호우 안내는 접힘 밖');
});
console.log(`assertions ${assertions} failures ${failures}`);
process.exitCode=failures?1:0;
