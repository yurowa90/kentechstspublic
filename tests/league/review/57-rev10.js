'use strict';
// rev10 R2·R3·R5·R6·R7·R9: 기대값은 rev10-fix/spec.md R1~R9/REV10_COPY.
// 실행: node tests/league/review/57-rev10.js --head (작성 세션 전용)
// --head 없이 실행하는 작업판 검사는 구현 담당자가 별도로 실행한다.
// 실행: node tests/league/review/57-rev10.js [--head] [구현 사본 경로]
// 작성 세션은 --head만 실행. 브라우저·통신·원본 변경 없음.
// 41/32번 VM 방식. 원본 ui/** 수정 없음. 브라우저·네트워크 실행 없음.
// 선택 인자는 기준판/변이 사본 경로. API 부재는 BLOCKED 실패이며 skip 없음.
const assert = require('node:assert/strict');
const O = require('./rev14b-contract.cjs');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const ROOT = path.resolve(__dirname, '../../..');
// rev10 R2: --head는 동시 수정 중인 ui 작업판을 읽지 않는 검증 경로.
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
    // rev10 R3: 실제 danger class 토글을 관찰한다.
    const classes=new Set((attrs.class||'').split(/\s+/).filter(Boolean));
    this.classList = {add: c=>classes.add(c), remove: c=>classes.delete(c), contains:c=>classes.has(c),
      toggle(c,force) {const on=force??!classes.has(c);if(on) classes.add(c);else classes.delete(c);return on;}};
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
const storage = new Map(), L = { role: 'solo', room: 'REV10TEST', team: 'pyeongtaek', rev: 0 };
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
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core']) {
    let source = readUI(name);
    if (name === 'build') {
      // rev10 R3: VM 안에서만 실제 함수·화면 상태 연결. 계산/렌더 함수 본문은 교체하지 않는다.
      const names = [...new Set([
        ...[...source.matchAll(/^  function (\w+)\(/gm)].map(m=>m[1]),
        ...[...source.matchAll(/^  const (\w+)\s*=\s*(?:\([^;\n]*\)|\w+)\s*=>/gm)].map(m=>m[1])
      ])];
      source = source.replace('KCP.buildGame = {', `globalThis.__buildHooks = {
        ${names.map(n => `get ${n}() {return typeof ${n} === 'undefined' ? undefined : ${n};}`).join(',')},
        state: value => { S = value; }
      }; KCP.buildGame = {`);
    }
    vm.runInContext(source, ctx, { filename: name });
  }
  const source = readUI('league');
  console.log('implementation sha256 ' + require('node:crypto').createHash('sha256').update(source).digest('hex'));
  if (source.split('let L = null;').length !== 2 || source.split('KCP.league = {').length !== 2)
    blocked('기준판 VM 연결점이 없어 화면 함수 실행 불가');
  // 기준판에 존재하는 진입점만 메모리에서 노출한다. 새 구현의 함수명을 추측하지 않는다.
  const names = ['outageDisplay','outageShownTotal','outagePartRanking','outageCardMin','outageReplayShown','outageWaterfallHTML','outageCardsHTML', 'outageShareThresholdText', 'outageEvidenceSummary', 'outageDisplayValues',
    'promiseVerdictText', 'direction', 'rev10Copy', 'rev11Copy', 'rev8Copy', 'outageRememberIntl', 'outageSnapshot', 'outageAttribution', 'outageAttributionMonthly', 'cityHTML', 'groupCauseHTML', 'hostOverviewHTML', 'trialGoals', 'promiseTopic', 'predictionHTML', 'promiseComparison', 'promiseResultHTML', // rev11 REV11_COPY.C4 (rev10 R5 N2 대체) 접근 함수.
    'reasonStartsHTML', 'evidenceCandidates', 'evidenceFocusHTML', 'outageEvidenceText',
    'outageEventClue', 'resultHTML', 'decisionsHTML', 'evidenceEffect', 'OUTAGE_EVIDENCE_LINKS'];
  const hooks = names.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(',');
  vm.runInContext(source.replace('let L = null;', 'let L = globalThis.__session;')
    .replace('KCP.league = {', `globalThis.__hooks = {${hooks}}; KCP.league = {`), ctx, { filename: 'league-under-test' });
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
  Object.assign(L, { role: 'solo', team: city, S, snap: S, rev: 0, panel: null, away: false, awaitReady: false,
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
const keys=['choice','weather','event','progress','growth','trade'];
function attribution(values, target='grid') {
  const total=values.reduce((a,b)=>a+b,0);
  return {basis:'monthly',round:2,id,target,unit:target==='grid'?'MWh/일':'%p',trial:10,base:10,actual:10+total,total,
    replay:0,replayOutsideSum:true,parts:values.map((value,i)=>({key:keys[i],value})),
    clues:Object.fromEntries(keys.map(k=>[k,'가상 단서'])),grid:{value:0,waitingMW:0}};
}
// rev10 R2: +0.30/up은 표시 함수에 이미 정해진 actual을 넣는 문구 계약이다.
// direction(+0.3)을 up으로 바꾸라는 기대가 아니다. 경계 판정은 별도로 -.49/-.5를 실행한다.
const words = { up:'늘어남', same:'같음', down:'줄어듦' };
// 명세 R2: Δ는 기존 정전 표시와 같은 signed(delta, 2)(소수 2자리 반올림, 끝 0 없음). 총괄 판정(rev10).
const sign = x => (x < 0 ? '−' : x > 0 ? '+' : '') + String(Number(Math.abs(x).toFixed(2)));
for (const label of ['지난달 대비','시험 1주 대비']) {
  for (const [delta, actual] of [[.3,'up'],[.2,'same'],[-.49,'same'],[-.5,'down']])
    test(`R2 ${label} ${delta}/${actual} 판정 문장`, () => {
      setup();
      const text = api('promiseVerdictText')({topic:'uns',comparison:{label},delta,actual,hit:true,r:{unsPct:10}}, {pred:{uns:actual}});
      const want = `정전 예측: ${actual==='up'?'늘 것':actual==='down'?'줄 것':'같을 것'} / 실제 결과: ${label} ${words[actual]}(${actual==='same'?'±0.5%p 안, ':''}${sign(delta)}%p) · 예상과 같음`;
      assert.equal(text,want);
    });
}
for (const [delta,want] of [[.2,'same'],[-.49,'same'],[-.5,'down']])
  test(`R2 실제 direction ${delta}`,()=>{ setup(); assert.equal(api('direction')(delta),want); });
for (const round of [1,2]) test(`R2 N1 채움/예측 자세히 안 ${round===1?'시험':'지난달'}`,()=>{
  const {S,n}=setup({round,phase:'review',topic:'uns',uns:10,actualUns:10.2,
    trial:{unsPct:10,perDay:0}, note:{evidence:{key:'evening',text:'저녁 수요',value:100},pred:{uns:'same'}}});
  const calc=element(api('promiseResultHTML')(S,n),'#lg-promise-uns-calc');
  const basis=round===1?'시험 1주 대비':'지난달 대비';
  assert.equal(calc.textContent,`판정 계산: ${basis} Δ +0.2%p · '같음' 범위 ±0.5%p 미만(게임 비교 기준)`);
  assert.equal(calc.tagName,'P'); assert.ok(calc.classList.contains('lg-hint'));
  // rev16 #72-1: 숫자·N1 문구는 그대로, 예측 자세히 안 상세 판정 줄 뒤로 이동.
  // promiseResultHTML의 section 연결만 검산. details 포장은 rev16.py가 검사한다.
  const ancestors=[]; for(let p=calc.parentElement;p;p=p.parentElement) ancestors.push(p);
  assert.ok(ancestors.some(p=>p.getAttribute('id')==='lg-promise-result'));
  assert.doesNotMatch(calc.textContent,/[{}]/);
});
const N1="판정 계산: {기준} Δ {Δ}%p · '같음' 범위 ±{tol}%p 미만(게임 비교 기준)";
// rev11 REV11_COPY.C4 (rev10 R5): N2 자리를 새 표/접근 함수로 옮긴다.
// rev12 C4: 기존 키와 n 치환 계약은 유지한다.
const C4="이번 달 '전선에 안 닿은 설비'가 {n}기 있었어요. 다음 달 계획 지도 칩과 '시험 1주'에서 설비·접속 상태를 확인해요.";
for (const [key,values,want] of [
  ['N1',{기준:'지난달 대비',Δ:'+0.20',tol:'0.5'},N1.replace('{기준}','지난달 대비').replace('{Δ}','+0.20').replace('{tol}','0.5')],
  ['N3',{n:3},'이번 달 볼 것 3개 더 보기']
]) test(`R${key==='N1'?2:4} REV10_COPY ${key} 글자/치환`,()=>{
  setup(); assert.equal(api('rev10Copy')(key,values),want);
});
// rev11 REV11_COPY.C4 (rev10 R5): 옛 rev10Copy('N2') 호출을 요구하지 않는다.
test('rev11 REV11_COPY C4 글자/치환',()=>{
  setup(); assert.equal(api('rev11Copy')('C4',{n:6}),C4.replace('{n}','6'));
});

// rev10 R6·R5: 실제 core 운영과 화면 사본 함수를 연결한다. 결과/단서를 생성해 넣지 않는다.
function game(city=id) {
  setup({},city);
  const S=C.newState(L.room,'south',0,[city,city===id?'dangjin':id],{turns:12,seedMode:'fixed'});
  C.host(S,'next',0);
  for(const tid of Object.keys(S.teams)) S.teams[tid].plan=copy(D.normalStartPlans[tid]);
  Object.assign(L,{role:'fixture',S,snap:S,outCache:{},outFailures:{},outRender:0});
  B.selectPack(C.teamDef(C.regionOf('south'),city).pack,'league');
  return S;
}
function operate(S) {
  Object.assign(L,{S,snap:S,outCache:{},outFailures:{},outRender:(L.outRender||0)+1});
  api('outageRememberIntl')(C.publicView(S,0));
  const res=C.run(S,B,0), V=copy(C.publicView(S,0)); L.snap=V;
  const snapshot=api('outageSnapshot')(V,res,L.team);
  if(!snapshot) blocked('실제 운영 사본 생성 불가');
  return {res,snapshot,V};
}
for (const [basis,cut,policy] of [['monthly',true,false],['monthly',true,true],['monthly',false,true],['trial',true,false],['trial',true,true],['trial',false,true]])
  test(`R6 ${basis} lines ${cut?'21→0':'동일'} 정책 ${policy}`,()=>{
    const S=game(), p=S.teams[id].plan;
    // 정상 시작 계획의 실제 길이를 사용하고, 기대 문구는 명세의 숫자 형식으로 만든다.
    // 21→0은 아래 fixture의 선 배열을 21개로 맞춰 별도로 보장한다(계획만 조정).
    p.lines=p.lines.slice(0,21);
    while(p.lines.length && p.lines.length<21) p.lines.push(copy(p.lines[0]));
    assert.equal(p.lines.length,21,'21개 전선 계획 전제');
    const old=copy(p);
    if(basis==='monthly') { operate(S); C.host(S,'next',0); }
    else {
      const rd=S.rounds[0], seed=12345, raw=B.simulate({...B.sanitize(copy(p),1e9),seed,season:rd.season},7,{league:true,mods:C.trialMods(S,C.regionOf('south'),id)});
      const filled=C.gridFill(raw);
      trialRecord={...rd,map:C.teamDef(C.regionOf('south'),id).pack,scope:JSON.stringify([L.room,id]),
        days:7,unsPct:100*filled.unsTotal/filled.tot.dem,gridMWh:filled.tot.by.import-raw.tot.by.import,plan:old,seed,season:rd.season};
    }
    S.teams[id].plan=copy(old);
    if(cut) S.teams[id].plan.lines=[];
    if(policy) S.teams[id].plan.policies=['save'];
    const {res,V}=operate(S);
    const a=api(basis==='monthly'?'outageAttributionMonthly':'outageAttribution')(V,res,id,{});
    if(!a) blocked(`${basis} 원인 단서 함수 결과 없음`);
    const clue=a.clues.choice;
    assert.ok(clue.startsWith(`${basis==='monthly'?'지난달':'시험'} 뒤 설비 0개 추가 / 0개 제거`),clue);
    if(cut) assert.ok(clue.includes(' · 전선 21 → 0개'),clue);
    else assert.doesNotMatch(clue,/전선/);
    if(policy) assert.ok(clue.endsWith(' · 정책 변경'),clue);
    assert.doesNotMatch(clue,/전선 변경|전선·정책 변경/);
  });

// rev14 M1 §1·2: 기대 목표는 원 Δ를 반올림한 눈금 수.
function checkSum(a,requireMap=false) {
 const L=Object.fromEntries(['outageDisplay','outageDisplayValues','outageShownTotal','outagePartRanking','outageCardMin','outageReplayShown','outageWaterfallHTML'].map(n=>[n,api(n)]));
 O.check(a,L,{html:true});const m=L.outageDisplayValues(a);if(requireMap)assert.ok(m.size,'허용 조합 있음');return m.size>0;
}
for(const row of [
  {start:1.886,values:[1.663,0,0,0,0,0],target:'grid'},
  {start:1.886,values:[2.363,-.7,0,0,0,0],target:'grid'},
  {start:1.886,values:[1.263,0,0,0,0,0],replay:.4,target:'grid'},
  {start:1.886,values:[.01663,0,0,0,0,0],target:'uns'}
]) test(`R7 고정 ${JSON.stringify(row)}`,()=>{
  setup(); const a=attribution(row.values,row.target); a.trial=a.base=row.start;
  a.replay=row.replay||0;a.replayOutsideSum=!row.replay;
  a.actual=row.start+row.values.reduce((s,v)=>s+v,0)+a.replay;
  a.total=a.actual-a.trial;
  checkSum(a,true);
  if(row.values[0]===1.663) assert.equal(api('outageDisplayValues')(a).get('choice'),1.66,'rev14b 두 자리 달 원 Δ 1.663 → 1.66');
});
// rev10 R7: 같은 배분 맵을 카드·폭포 낭독·근거 한 줄이 함께 사용한다.
test('R7 비어 있지 않은 배분의 카드/낭독/한 줄 일치',()=>{
  const {S,n}=setup({phase:'review',note:{evidence:{key:'wind',text:'풍속',value:5}}});
  const a=attribution([.5,.963,.2,0,0,0]);
  a.trial=a.base=1.886;a.actual=3.549;a.total=1.663;a.hasConnectedWind=true;
  checkSum(a,true); const m=api('outageDisplayValues')(a);
  n.outageFrozen=a;n.outageOpened=true;n.missed='weather';
  const html=api('outageCardsHTML')(S,S.results.at(-1),id,n), root=htmlTree(html);
  for(const key of ['choice','weather','event']) {
    const shown=(m.get(key)>0?'+':m.get(key)<0?'−':'')+Math.abs(m.get(key)).toFixed(O.digits(a))+' MWh/일';
    assert.equal(element(html,`[data-missed="${key}"] .lg-out-size`).textContent,shown);
    assert.ok(element(html,`[data-out-step="${key}"]`).textContent.includes(shown));
    assert.ok((root.querySelector('#lg-outage-waterfall').getAttribute('aria-label')||'').includes(shown));
  }
  for(const fn of ['outageEvidenceSummary','outageEvidenceText']) {
    const text=api(fn)(n,a,a.parts[1]);
    assert.ok(text.includes('+0.96 MWh/일'),text);
    assert.doesNotMatch(text,/\+1\.0 MWh\/일/);
  }
});
test('R7 rev14b 두 자리 동점: 허용 조합·카드/폭포/낭독 일치',()=>{
  const {S,n}=setup({phase:'review'}), a=attribution([.26,.26,0,0,0,0]);
  a.trial=a.base=1.96;a.actual=2.48;a.total=.52;
  checkSum(a,true); const m=api('outageDisplayValues')(a); assert.equal(m.get('choice'),.26); assert.equal(m.get('weather'),.26);
  n.outageFrozen=a;n.outageOpened=true;n.missed='choice';
  const root=htmlTree(api('outageCardsHTML')(S,S.results.at(-1),id,n));
  for(const key of ['choice','weather']) {
    assert.match(element(root.innerHTML||api('outageCardsHTML')(S,S.results.at(-1),id,n),`[data-missed="${key}"] .lg-out-size`).textContent,/\+0\.26 MWh\/일/);
    const row=element(api('outageCardsHTML')(S,S.results.at(-1),id,n),`[data-out-step="${key}"]`);
    assert.ok((row.getAttribute('aria-label')||row.textContent).includes('+0.26'),row.textContent);
  }
});
test('R7 고정 난수 2,000건: 비어 있지 않은 모든 표시 맵 합',()=>{
  setup(); api('outageDisplayValues'); // rev10 R7: 함수 부재는 난수 루프 전 BLOCKED.
  let seed=0x10c0ffee, nonempty=0, errors=[];
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  for(let i=0;i<2000;i++) {
    const target=i%2?'grid':'uns', values=keys.map(()=>Math.round((random()-.5)*200000)/10000);
    const a=attribution(values,target);a.trial=a.base=random()*30;
    a.replay=i%3===0?(random()-.5):0;a.replayOutsideSum=i%3!==0;
    a.actual=a.trial+values.reduce((s,v)=>s+v,0)+(!a.replayOutsideSum?a.replay:0); a.total=a.actual-a.trial;
    try {if(checkSum(a)) nonempty++;} catch(e) {errors.push(`case ${i}: ${e.message}`);}
  }
  console.log(`R7 randomized cases 2000 nonempty-valid ${nonempty} failed ${errors.length}`);
  assert.equal(errors.length,0,errors.slice(0,3).join(' / '));
  assert.ok(nonempty>0,'빈 Map만으로 통과하지 않음');
});

// rev10 R3: hrDem/hrSup 가상 시간 자료. 도시 함수는 rememberTrial과 칩이 공유해야 한다.
function buildAPI(name) {
  if(bootError) blocked(`VM 초기화 실패: ${bootError.message}`);
  const f=ctx.__buildHooks?.[name]; if(typeof f!=='function') blocked(`build 화면 함수 접근 불가: ${name}`);
  return f;
}
function hourly(days) {
  const H=days*24;
  return {days,H,map:'pyeongtaek',season:'winter',seed:1,hrDem:Array.from({length:H},(_,i)=>i%4===0?0:50),
    hrSup:Array.from({length:H},(_,i)=>i%4===0?0:i%4===1?49:i%4===2?48:50),
    outTotal:H*6,tot:{dem:100,loss:0,idle:0},unsTotal:10,co2:0,cost:{total:0,capex:0},cp:{issues:0}};
}
test('R3 도시 정전 시간 공통 함수/7일·30일 상한',()=>{
  setup();
  // 함수명은 명세에 고정되지 않았다. 저장 경로 outH에서 호출하는 함수만 연결한다.
  const remember=buildAPI('rememberTrial').toString(), hud=buildAPI('refreshHUD').toString();
  const called=Object.keys(ctx.__buildHooks).find(n=>n!=='rememberTrial'&&n!=='refreshHUD'&&
    new RegExp(`\\b${n}\\s*\\(`).test(remember)&&new RegExp(`\\b${n}\\s*\\(`).test(hud)&&/hrDem|hrSup/.test(String(ctx.__buildHooks[n])));
  if(!called) blocked('rememberTrial outH의 공통 도시 시간 함수 호출 접근 불가');
  const f=buildAPI(called);
  for(const days of [7,30]) {
    const r=hourly(days), n=f(r);
    assert.equal(n,days*6);assert.ok(n<=days*24);
    // 공통 함수 호출 여부는 위에서 두 실제 함수 본문에 대해 확인했다.
    buildAPI('rememberTrial')(r,currentPlan,{year:2027,month:1});
    const saved=Object.values(JSON.parse(storage.get('kcp-build-trial-v1')||'{}')).find(t=>t.days===days);
    assert.ok(saved,'실제 저장 경로 실행'); assert.equal(saved.outH,n);
  }
});
for(const league of [true,false]) test(`R3 ${league?'리그':'#build'} 시험 칩 실제 렌더`,()=>{
  const {pack}=setup();B.selectPack(pack,league?'league':undefined);
  const root=htmlTree('<span data-cap="power"><b data-v></b><i class="v2-cap-k"></i></span>');
  const res=hourly(7);
  buildAPI('state')({root,opts:{league},st:currentPlan,result:res,run:null,undo:[],redo:[],net:B.network(currentPlan)});
  try {buildAPI('refreshHUD')();} catch(e) {blocked(`칩 화면 함수 실행 불가: ${e.message}`);}
  assert.equal(root.querySelector('[data-v]').textContent,`정전 ${league?42:1008}h`);
  assert.ok(root.querySelector('[data-cap="power"]').classList.contains('tone-danger'),'양수 정전 danger');
  res.hrSup=[...res.hrDem]; // 수요지 합계는 양수인 채로 도시 부족 시간만 0인 자료.
  buildAPI('refreshHUD')();
  assert.equal(root.querySelector('[data-v]').textContent,`정전 ${league?0:1008}h`);
  assert.equal(root.querySelector('[data-cap="power"]').classList.contains('tone-danger'),!league,'danger도 같은 값 기준');
});

// rev10 R5: 실제 운영 사본에 미연결 6기인 계획만 둔다. 다음 달 편집과 독립적이어야 한다.
for(const n of [6,0]) test(`R5 운영 계획 미연결 ${n}기/C4·①②③`,()=>{
  const S=game('hwaseong'),p=S.teams.hwaseong.plan;
  p.builds=[];p.lines=[];p.policies=[];
  const spots=B.TILES.filter(t=>!t.out&&t.site<0&&!B.siteRule('diesel',t)).slice(0,n);
  assert.equal(spots.length,n);p.builds=spots.map(t=>({t:'diesel',i:t.i}));
  const unlinked=B.network(B.sanitize(p,1e9)).nodes.filter(x=>x.kind!=='town'&&x.kind!=='import'&&!x.live).length;
  assert.equal(unlinked,n,'운영 미연결 수 독립 전제');
  const {res,V}=operate(S), a={...attribution([0,0,0,0,0,0],'uns'),id:'hwaseong',round:1,basis:'trial',trial:50,base:50,actual:50,total:0};
  const note={outageFrozen:a,outageSingleShown:true,outageOpened:true};
  const summary=()=>element(api('outageCardsHTML')(V,res,'hwaseong',note),'#lg-outage-single').textContent;
  // rev11 REV11_COPY.C4 (rev10 R5): 미연결 양수일 때의 새 재점검 문장.
  const want=n?C4.replace('{n}',String(n)):'지금 설비·접속이 수요를 못 따라가는 상태를 살펴봐요. 1주 시험과 자리 판단(접속 여유)에서 다시 봐요';
  const text=summary(); assert.ok(text.includes(`정전 자체는 커요: ${n ? '시험에도 정전이 컸어요. ' : '시험에도 정전이 컸으니 이번 달 변화보다 '}${want}`),text);
  // ①②③: 높은 기준값/작은 차이의 선택적 앞말 조합을 모두 이어 붙여 검사한다.
  for(const [before,after,total,prefix] of [[50,50,0,'시험에도 정전이 컸으니 이번 달 변화보다 '],[1,50,49,''],[50,51,1,'시험에도 정전이 컸으니 '],[4.99,5.01,.02,'이번 달 변화보다 ']]) {
    Object.assign(a,{trial:before,base:before,actual:after,total});
    // rev12 E5-a: 미연결 양수면 P1만 붙이고 변화 비교/연결 어미를 빼야 한다.
    const expectedPrefix=n ? (before>=5 ? '시험에도 정전이 컸어요. ' : '') : prefix;
    assert.ok(summary().includes(`정전 자체는 커요: ${expectedPrefix}${want}`),summary());
  }
  Object.assign(a,{trial:50,base:50,actual:50,total:0});
  // 운영 사본이 만들어진 뒤 현재 계획만 바꾼다(결과/사본 불변).
  V.teams.hwaseong.plan=copy(D.normalStartPlans.hwaseong);currentPlan=V.teams.hwaseong.plan;
  assert.equal(summary(),text,'다음 계획을 고쳐도 운영 당시 n 유지');
});
// rev10 검토 M1(총괄 추가): 숨은 음수 재현 차이로 나머지가 음수면 영향 없는 0 몫에 −1눈금을 찍지 않는다.
test('R7 숨은 음수 재현 차이: 0 몫 불변',()=>{
  setup(); const a=attribution([.61,0,0,0,0,0],'grid');
  Object.assign(a,{basis:'trial',trial:1.26,base:1.26,replay:-.04,replayOutsideSum:false,actual:1.83,total:.57});
  const m=api('outageDisplayValues')(a);
  for(const p of a.parts.slice(1)) assert.ok(!m.has(p.key)||m.get(p.key)===0,`${p.key} ${m.get(p.key)}`);
  const b=attribution([0,.0485,0,0,0,0],'uns'); Object.assign(b,{trial:0,base:0,actual:.0485,total:.0485});
  const mb=api('outageDisplayValues')(b);
  for(const p of b.parts) if(p.value===0) assert.ok(!mb.has(p.key)||mb.get(p.key)===0,`${p.key} ${mb.get(p.key)}`);
});
test('R9 C10 글자 그대로',()=>{
  setup();assert.equal(api('rev8Copy')('C10'),'시험에는 폭염 때 줄어드는 LNG·일반 태양광 출력과 월말 공공시설 보수비도 들어 있지 않아요.');
});
console.log(`assertions ${assertions} failures ${failures}`);
process.exitCode=failures?1:0;
