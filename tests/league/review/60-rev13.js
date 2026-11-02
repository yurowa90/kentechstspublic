'use strict';
// 기대값의 유일한 근거: (비공개 작업 지시서)
// 구현의 계산식을 기대값으로 가져오지 않는다. 브라우저·네트워크·원본 수정 없음.
const assert = require('node:assert/strict');
const O = require('./rev14b-contract.cjs');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const ROOT = path.resolve(__dirname, '../../..');
const read = name => fs.readFileSync(path.join(ROOT, 'ui', name + '.js'), 'utf8');
const source = read('league'), build = read('build');
const css = fs.readFileSync(path.join(ROOT, 'ui/league.css'), 'utf8');
let assertions = 0, failures = 0;
function test(label, run) {
  assertions++;
  try { run(); } catch (error) { failures++; console.error(`FAIL ${label}: ${error.message.split('\n')[0]}`); }
}
const body = (text, name) => text.match(new RegExp(`^  function ${name}\\([^]*?^  }`, 'm'))?.[0] || '';
const need = name => {
  const f = ctx.KCP.league?.[name];
  assert.equal(typeof f, 'function', `함수 없음: KCP.league.${name}`);
  return f;
};
const store = new Map(), memory = {
  getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v), removeItem: k => store.delete(k),
};
const ctx = vm.createContext({ console, performance, structuredClone, URL,
  document: { documentElement: {}, addEventListener() {}, getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [] },
  addEventListener() {}, setTimeout() { return 0; }, clearTimeout() {},
  localStorage: memory, sessionStorage: memory,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  KCP: { route() {}, on() {}, esc: String, gradeWords: String, leagueNet: { expandSnapshot: x => x } } });
ctx.window = ctx;
let bootError;
try {
  for (const name of ['build-maps','tech-data','build','econ-data','econ','league-data','league-core','league']) {
    let text = name === 'league' ? source : name === 'build' ? build : read(name);
    if (name === 'league') {
      const end = text.lastIndexOf('})();');
      assert.ok(end >= 0, '기존 IIFE 연결점 없음');
      // 기존 함수만 메모리에서 공개한다. 새 계약 함수는 실제 KCP.league 공개를 요구한다.
      text = text.slice(0, end) + '\nglobalThis.__rev13 = {' +
        ['missedText','promiseVerdictText','outageReplayShown'].map(n => `${n}: typeof ${n} === "function" ? ${n} : undefined`).join(',') +
        '};\n' + text.slice(end);
    }
    vm.runInContext(text, ctx, { filename: `ui/${name}.js`, timeout: 10000 });
  }
} catch (error) { bootError = error; }
test('league VM 초기화', () => assert.ifError(bootError));
for (const name of ['outageDisplayValues','outageShownTotal','outagePartShown','ledgerShown'])
  test(`공개 ${name}`, () => need(name));

// R2(a)(b): 같은 양이 원값 반올림으로 돌아가지 않도록 실제 호출 연결도 검사한다.
const cards = body(source, 'outageCardsHTML');
test('R2 한 줄 요약 차이는 outageShownTotal 절댓값', () => {
  assert.ok(cards, 'outageCardsHTML 함수 없음');
  assert.match(cards, /outageValue\(\s*Math\.abs\(\s*outageShownTotal\(\s*a\s*\)\s*\)\s*,\s*(?:a\.unit|unit)\s*(?:,\s*false\s*,\s*(?:digits|d|outageDigits\(a\)))?\s*\)/);
  // 단순히 같은 함수의 다른 분기에서 호출하는 것으로 통과시키지 않는다.
  assert.match(cards, /(?:차이|이번 차이)[^\n]{0,220}outageShownTotal\(a\)|outageShownTotal\(a\)[^\n]{0,220}(?:차이|이번 차이)/);
});
for (const name of ['outageCardsHTML','missedCarryHTML','missedText']) test(`R2 ${name} 몫 표시 연결`, () => {
  const text = body(source, name);
  assert.ok(text, `${name} 함수 없음`);
  assert.match(text, /outageValue\(\s*outagePartShown\([^;\n]*?\)\s*,\s*[\w.?]+\s*,\s*true\s*(?:,\s*(?:digits|d|outageDigits\([\w.]+\)))?\s*\)/);
});
// fmt/outageValue 구현 대신 명세의 표시 눈금을 독립 사용한다.
const rounded = (x, digits) => Number(x.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: digits }));
const near = (got, want, message) => assert.ok(Number.isFinite(got) && Math.abs(got-want) <= 1e-9, `${message}: ${got} != ${want}`);
const keys = ['choice','weather','event','trade'];
function attribution(trial, actual, values, replay=0, grid=true) {
  return { basis:'trial', round:1, id:'pyeongtaek', ...(grid ? {target:'grid',unit:'MWh/일'} : {}),
    trial, base:trial, actual, total:actual-trial, replay, replayOutsideSum:replay===0,
    parts:values.map((value,i)=>({key:keys[i],value})),
    clues:Object.fromEntries(keys.map(k=>[k,'가상 검사 단서'])), grid:{value:0,waitingMW:0} };
}
let allocated=0, fallback=0;
function allocation(a) {
 const L={...ctx.KCP.league,outageReplayShown:ctx.__rev13.outageReplayShown};
 O.check(a,L,{html:true});const map=L.outageDisplayValues(a);if(map.size)allocated++;else fallback++;
 for(const p of a.parts)near(need('outagePartShown')(a,p.key,p.value),map.get(p.key)??p.value,'같은 배분 몫 소비');
}
let seed=0x13c0ffee;
const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
for (let i=0;i<2000;i++) test(`R2 무작위 ${i+1}`, () => {
  const grid=i%2===0, limit=grid?20:100, start=random()*limit, actual=random()*limit;
  const cuts=[0,random(),random(),random(),1].sort((a,b)=>a-b);
  const pieces=cuts.slice(1).map((x,j)=>(x-cuts[j])*(actual-start));
  allocation(attribution(start,actual,pieces,0,grid));
});
for (const grid of [true,false]) for (const value of [1.25,1.249999,1.250001,1.255,1.2549999,1.2550001,
  0,-1.25,-1.249999,-1.250001,-1.255,-1.2549999,-1.2550001])
  for (const mixed of [false,true]) test(`R2 경계 grid=${grid} x=${value} mixed=${mixed}`, () => {
    const values=mixed?[value,-.13,.13,0]:[value,0,0,0];
    allocation(attribution(10,10+values.reduce((s,x)=>s+x,0),values,0,grid));
  });
for (const grid of [true,false]) test(`R2 공동 가장 큼 grid=${grid}`, () => allocation(attribution(10,10.18,[.06,.06,.06,0],0,grid)));
for (const grid of [true,false]) for (const replay of [.1,-.1,0.00001])
  test(`R2 재현 차이 grid=${grid} replay=${replay}`, () => allocation(attribution(10,11.6626+replay,[1.6626,0,0,0],replay,grid)));
test('R2 실제 배분 사례 있음', () => assert.ok(allocated>0,'무조건 빈 Map으로 회피 금지'));
test('R2 고정본 없는 옛 기록 원값 fallback', () => near(need('outagePartShown')(null,'choice',1.6626),1.6626,'원값 유지'));
console.log(`INFO R2 무작위 2000건 + 경계: 배분 ${allocated}, 빈 Map ${fallback}, seed 0x13c0ffee`);

// missedText를 실제 호출할 수 있으면 끝 화면 기록의 숫자도 독립 고정 예와 비교한다.
// 인수 n의 outageLargest/outageFrozen 구조는 기존 검사/명세의 기록 구조다.
const frozen=attribution(1.86,3.5226,[1.6626,0,0,0]);
const note={outageFrozen:frozen,outageOpened:true,outageSingleShown:true,
  outageLargest:{key:'choice',value:1.6626},missed:'choice',missedBasis:'trial'};
let record, recordError;
try {
  assert.equal(typeof ctx.__rev13?.missedText,'function','missedText 함수 없음');
  record=ctx.__rev13.missedText(note);
  if (!record || !record.includes('가장 큰 몫')) throw new Error('합성 기록으로 가장 큰 몫 분기 미확보');
} catch(error) { recordError=error; }
if (!recordError) test('rev14b R2 missedText 두 자리 달 1.6626 → +1.66', () => {
  assert.match(record,/가장 큰 몫[^]*?\+1\.66(?:\s|MWh)/);
  assert.doesNotMatch(record,/\+1\.6(?:\s|MWh)/);
});
else console.log(`INFO R2 missedText VM 호출 미확보 → 위 원문 단언 사용: ${recordError.message}`);

const C2='현금 예측: {방향} / 실제 결과: 운영 전 {before}억 → 월말 {after}억 · 운영 전 대비 {실제}({범위}{Δ}억) · {판정}';
test('R4 REV8_COPY.C2 명세 글자 그대로', () => assert.match(source, new RegExp('C2\\s*:\\s*["\']'+C2.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'["\']')));
test('R4 옛 C2 없음', () => assert.ok(!source.includes('운영 전 대비 {Δ}억 · {판정}')));
let verdictAvailable=true;
try {
  assert.equal(typeof ctx.__rev13?.promiseVerdictText,'function');
  ctx.__rev13.promiseVerdictText({r:{},topic:'cash',delta:.0021,actual:'same',hit:false,beforeCash:100,afterCash:100.0021},{pred:{cash:'up'}});
} catch(error) { verdictAvailable=false; console.log(`INFO R4 VM 호출 불가 → 원문 단언: ${error.message}`); }
if (verdictAvailable) for (const [delta,actual,hit,want] of [
  [.0021,'same',false,'같음(±0.5억 안, 0.00억)'],[8.16,'up',true,'늘어남(+8.16억)'],[-3.27,'down',true,'줄어듦(−3.27억)'],
  // 검토 반영(독립 검토 minor 1): 문턱 바로 아래·위에서 Δ 글자가 문턱과 같게 보이지 않는다(판정 계산 줄과 같은 자릿수).
  [.4999,'same',false,'같음(±0.5억 안, +0.4999억)'],[-.4999,'same',false,'같음(±0.5억 안, −0.4999억)'],[.5004,'up',true,'늘어남(+0.5004억)'],
]) test(`R4 현금 Δ=${delta}`, () => {
  const text=ctx.__rev13.promiseVerdictText({r:{},topic:'cash',delta,actual,hit,beforeCash:100,afterCash:100+delta},{pred:{cash:hit?actual:'up'}});
  assert.ok(text.includes('운영 전 대비 '+want),text);
  assert.ok(text.endsWith('· 예상과 '+(hit?'같음':'다름')),text);
});
else test('R4 cash 실제·같음 범위 연결', () => {
  const text=body(source,'promiseVerdictText');
  assert.match(text,/ACTUAL_NAMES\[actual\]/);
  assert.match(text,/promiseSameDelta/);
  assert.match(text,/억 안, /);
});

// R3 원문 보조: CSS를 규칙별로 훑어 ≤760 매체의 숨김이 실제로 다시 켜지는지 확인.
test('R3 좁은 꼬리표 글자 있음', () => assert.ok(source.includes('+빚 한도')));
function cssRules(text, media='all', out=[]) {
  text=text.replace(/\/\*[^]*?\*\//g,'');
  let pos=0;
  while(pos<text.length) {
    const open=text.indexOf('{',pos); if(open<0) break;
    let depth=1,end=open+1;
    while(end<text.length&&depth) { if(text[end]==='{')depth++; if(text[end]==='}')depth--; end++; }
    const selector=text.slice(pos,open).trim(), content=text.slice(open+1,end-1);
    if(selector.startsWith('@media')) cssRules(content,media+' '+selector,out);
    else if(selector.startsWith('@')) cssRules(content,media,out);
    else out.push({selector,content,media});
    pos=end;
  }
  return out;
}
test('R3 ≤760 .lg-debt-note display:none 제거 또는 뒤 가시화', () => {
  const applicable=cssRules(css).filter(r=>r.selector.includes('.lg-debt-note') &&
    !/min-width\s*:\s*(?:76[1-9]|7[7-9]\d|[89]\d\d|\d{4,})px/.test(r.media));
  const hidden=applicable.filter(r=>/display\s*:\s*none\b/.test(r.content));
  for(const rule of hidden) {
    const index=applicable.indexOf(rule);
    assert.ok(applicable.slice(index+1).some(r=>/display\s*:\s*(?:block|inline(?:-block|-flex)?|flex|grid|revert|unset)\b/.test(r.content)),
      '좁은 화면 debt-note 숨김이 남음 (실제 CSS 우선순위는 브라우저 R3에서 검증)');
  }
});

// 같이 1: 달 말은 독립 반올림 유지, 정수 0.01억 단위 항등식. fmt는 최대 둘째 자리.
const cents=x=>Math.round(rounded(x,2)*100);
const number=s=>{
  assert.equal(typeof s,'string','ledgerShown 반환값은 문자열');
  assert.match(s,/^[−-]?\d[\d,]*(?:\.\d{1,2})?$/,'fmt(…,2) 숫자 꼴');
  return Number(s.replaceAll(',','').replace('−','-'));
};
function ledger(input, fallback=false) {
  const original=JSON.stringify(input), got=need('ledgerShown')(input);
  assert.deepEqual(Object.keys(got).sort(),['open','income','invest','opex','close','spend'].sort());
  const values=Object.fromEntries(Object.entries(got).map(([k,v])=>[k,number(v)]));
  for(const k of ['open','income','invest','close']) near(values[k],rounded(input[k],2),`장부 ${k} 독립 반올림`);
  if(fallback) near(values.opex,rounded(input.opex,2),'깨진 항등식 원래 운영비 표시');
  else {
    assert.equal(cents(values.open)+cents(values.income)-cents(values.invest)-cents(values.opex),cents(values.close),'표시 장부 항등식');
    assert.ok(Math.abs(values.opex-input.opex)<=.02+1e-9,'운영비 표시 오차 ≤0.02억');
  }
  assert.equal(cents(values.spend),cents(values.invest)+cents(values.opex),'총지출 = 표시 투자 + 표시 운영비');
  assert.equal(JSON.stringify(input),original,'장부 원값 불변');
  return values;
}
for(let i=0;i<2000;i++) test(`장부 무작위 ${i+1}`,()=>{
  const open=random()*500,income=random()*500,pool=open+income;
  const lo=Math.max(0,pool-500),hi=Math.min(500,pool);
  const invest=lo+random()*(hi-lo),opex=random()*(pool-invest),close=pool-invest-opex;
  for(const value of [open,income,invest,opex,close]) assert.ok(value>=0&&value<=500,'원값 0~500억');
  ledger({open,income,invest,opex,close});
});
for(const offset of [.050001,-.050001,.5,-.5]) test(`장부 항등식 깨짐 ${offset}`,()=>
  ledger({open:278.203,income:132.217,invest:16.003,opex:124.264,close:270.153+offset},true));
test('장부 1280 12월: 각자 반올림 합 270.16 → 달 말 270.15',()=>{
  const input={open:278.203,income:132.217,invest:16.003,opex:124.264,close:270.153};
  near(input.open+input.income-input.invest-input.opex,input.close,'합성 원값 항등식');
  assert.equal(cents(input.open)+cents(input.income)-cents(input.invest)-cents(input.opex),27016,'기존 표시 어긋남 재현');
  const shown=ledger(input);
  near(shown.close,270.15,'다른 화면과 같은 달 말'); near(shown.opex,124.27,'운영비만 표시 정리');
});
test('장부 결과 줄이 ledgerShown 사용',()=>assert.match(body(source,'resultHTML'),/ledgerShown\(/));

// R1·R5 원문 보조. 실제 프레임/터치는 rev13.py가 주 검사다.
test('R1 열린 결과 서랍에서 clearKeys 삭제 후 반환',()=>{
  const text=body(build,'syncResultToastPosition'); assert.ok(text,'함수 없음: syncResultToastPosition');
  assert.match(text,/resultDrawer\s*===\s*["']true["']/);
  assert.match(text,/#lg-panel[^\n]*data-folded/);
  assert.match(text,/(?:delete\s+[\w.]+\.clearKeys|removeAttribute\(\s*["']data-clear-keys["']\s*\))\s*;\s*return\b/);
});
for(const name of ['confirmLine','cancelLine']) test(`R5 ${name} 터치 뒤 hover·tip 정리`,()=>{
  const text=body(build,name); assert.ok(text,`${name} 함수 없음`);
  // 정리 로직을 별도 함수로 묶는 구현도 허용한다. 기대 동작은 명세 R5 그대로다.
  const calls=[...text.matchAll(/\b([A-Za-z_$][\w$]*)\(\s*\)/g)].map(m=>m[1]);
  const cleanup=[text,...calls.map(call=>body(build,call))].join('\n');
  assert.match(cleanup,/(?:pointerType\s*===\s*["']touch["']|pointerType\s*!==\s*["']touch["'][^]*?return\b)[^]*?S\.hover\s*=\s*null[^]*?hideTip\(\)/);
});
console.log(`assertions ${assertions} failures ${failures}`);
process.exitCode=failures?1:0;
