'use strict';
// 기대값: rev14b/spec.md A1–A4만. 구현의 배분/Map/머리/서식을 oracle에 사용하지 않는다.
// tied·cardMin은 범위 밖 판정이며 공개 API로만 받는다.
const assert = require('node:assert/strict');
const digits = a => a.target !== 'grid' ? 2 : a.unit !== 'MWh/일' ? 1 :
  Number.isFinite(a.trial ?? a.base) && Math.abs(a.trial ?? a.base) < 2 ? 2 : 1;
const total = a => a.total ?? (a.actual - (a.trial ?? a.base));
// rev14b A2: 기본 params의 계통 .05 / 정전 .005. P는 구현 함수와 독립 구성한다.
const replayShown = (a,v) => Number.isFinite(v) && Math.abs(v) >=
  (a.target==='grid'?Math.min(.05,.5/10**digits(a)):.005);
const rounded = (v,d) => Number(v.toFixed(d))+0;
const tick = (v,d) => Math.round(rounded(v,d)*10**d)+0;
const plain = html => String(html).replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|#39|#x27|nbsp);/g,
  x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&#x27;':"'",'&nbsp;':' '}[x]));
const value = (v,unit,signed,d) => (signed && v ? v>0?'+':'−':'')+
  Math.abs(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})+
  (unit==='MWh/일'||unit==='MWh'?' ':'')+unit;
const cmp = (a,b) => { for(let i=0;i<3;i++) if(a[i]!==b[i]) return a[i]<b[i]?-1:1; return 0; };
function oracle(a,L) {
  const d=digits(a), s=10**d, H=Math.round(rounded(total(a),d)*s)+0;
  const P=[...a.parts];
  if(!a.replayOutsideSum && replayShown(a,a.replay)) P.push({key:'replay',value:a.replay});
  const r=P.map(p=>p.value*s), near=P.map(p=>tick(p.value,d));
  const base={d,s,H,P,r,near};
  if(!P.length || !Number.isFinite(H) || !r.every(Number.isFinite))
    return {...base,invalid:true,best:null,gaps:new Set([0]),gap:0,feasible:0};
  // rev14b A2 원값 합 가드: 빠진 원인을 표시 반올림 안내로 설명하지 않는다.
  if(Math.abs(P.reduce((n,p)=>n+p.value,0)-total(a))>=.5/s)
    return {...base,guarded:true,best:null,gaps:new Set([0]),gap:0,feasible:0};
  const lo=r.map(x=>Math.floor(x+1e-9)), choices=r.map((x,i)=>x-lo[i]<=1e-9?[lo[i]]:[lo[i],lo[i]+1]);
  const tied=new Set(L.outagePartRanking(a).tied), min=L.outageCardMin(a), nc=a.parts.length;
  const topIndex=a.parts.findIndex(p=>tied.has(p.key));
  function allowed(t) {
    for(let i=0;i<nc;i++) {
      if(Math.abs(a.parts[i].value)>=min && Math.abs(t[i])<1) return false;
      if(topIndex>=0 && (tied.has(a.parts[i].key)?Math.abs(t[i])!==Math.abs(t[topIndex]):Math.abs(t[i])>=Math.abs(t[topIndex]))) return false;
      for(let j=0;j<nc;j++) if(Math.abs(r[i])>Math.abs(r[j])+1e-9 && Math.abs(t[i])<Math.abs(t[j])) return false;
    }
    return true;
  }
  // 비용의 둘째 항은 '0 / 0 아님' 상태가 near와 다른 몫 수다.
  const cost=t=>[Math.abs(H-t.reduce((x,y)=>x+y,0)),t.reduce((n,x,i)=>n+((x===0)!==(near[i]===0)),0),
    t.reduce((n,x,i)=>n+Math.abs(x-r[i]),0)];
  let best=null, sample=null, feasible=0, gaps=new Set();
  const t=[];
  function visit(i) {
    if(i<choices.length) { for(const x of choices[i]) {t[i]=x;visit(i+1);} return; }
    if(!allowed(t)) return;
    feasible++;
    const c=cost(t), relation=best?cmp(c,best):-1, gap=H-t.reduce((x,y)=>x+y,0);
    if(relation<0) {best=c;sample=t.slice();gaps=new Set([gap]);}
    else if(relation===0) gaps.add(gap);
  }
  visit(0);
  const gap=H-near.reduce((x,y)=>x+y,0);
  return {...base,lo,choices,allowed,cost,best,sample,gaps:best?gaps:new Set([gap]),gap,feasible};
}
function actualDisplay(a,L) {
  if(typeof L.outageDisplay==='function') return L.outageDisplay(a);
  assert.equal(typeof L.outageDisplayValues,'function','BLOCKED 함수 없음: outageDisplay / outageDisplayValues');
  const values=L.outageDisplayValues(a), o=oracle(a,L);
  return {values,gap:o.invalid||o.guarded?0:
    o.H-o.P.reduce((n,p)=>n+tick(values.get(p.key)??p.value,o.d),0)};
}
function check(a,L,{html=false}={}) {
  const original=JSON.stringify(a), o=oracle(a,L), out=actualDisplay(a,L), m=out.values;
  assert.equal(Object.prototype.toString.call(m),'[object Map]','A2 values Map');
  if(typeof L.outageDisplay==='function'&&typeof L.outageDisplayValues==='function')assert.equal(L.outageDisplayValues(a),m,'A2 wrapper는 같은 values를 읽음');
  assert.ok(Object.is(L.outageShownTotal(a),rounded(total(a),o.d)),'A1 머리 = 독립 total.toFixed(d)');
  assert.equal(L.outageReplayShown(a,a.replay),replayShown(a,a.replay),'A2 재현 표시 문턱 = 표시 반 눈금');
  if(o.invalid||o.guarded) {
    assert.equal(m.size,0,'A2 비유한/빈 P/원값 합 가드 Map');
    assert.equal(out.gap,0,'A2 비유한/빈 P/원값 합 가드 gap');
    if(o.guarded)assert.deepEqual(o.P.map(p=>tick(m.get(p.key)??p.value,o.d)),o.near,'A2 원값 합 가드: 각자 반올림');
    if(html)checkNote(a,L,o,out);
    assert.equal(JSON.stringify(a),original,'A2 원값·순서 불변');
    return {...o,out};
  }
  const t=o.P.map(p=>tick(m.get(p.key)??p.value,o.d)), sum=t.reduce((x,y)=>x+y,0);
  assert.equal(out.gap+0,o.H-sum,'A2 보고 gap = H − 실제 표시 합');
  if(!o.feasible) {
    assert.equal(m.size,0,'A2 허용 조합 없음: 빈 Map');
    assert.equal(out.gap+0,o.gap,'A2 fallback gap = H − Σnear');
    assert.deepEqual(t,o.near,'A2 허용 조합 없음: 각자 반올림');
  } else {
    assert.equal(m.size,o.P.length,'A2 허용 조합 있음: 전체 P Map');
    assert.ok(o.P.every(p=>m.has(p.key)),'A2 key 누락 없음');
    assert.ok(o.allowed(t),'A4 c1 크기 순서 / c2 원인 공동 최대 / c3 N1');
    for(let i=0;i<t.length;i++) {
      const shown=m.get(o.P[i].key);
      assert.equal(shown,t[i]/o.s||0,'A4 정수 눈금');
      assert.ok(o.choices[i].includes(t[i]),'A4 lo 또는 lo+1 / 눈금 위 값 보존');
      assert.ok(t[i]*o.r[i]>=0,'A4 부호 반전 없음');
      // 1e-9 이내 눈금 잡음은 A2의 고정 눈금 규칙을 따른다.
      assert.ok(Math.abs(t[i]-o.r[i])<1 || o.choices[i].length===1,'A4 오차 < 1눈금');
    }
    const c=o.cost(t);
    assert.equal(c[0],o.best[0],'A2 |gap| 최소');assert.equal(c[1],o.best[1],'A2 near와 0/비0 상태 변화 최소');
    assert.equal(c[2],o.best[2],'A2 총 눈금 오차 최소');
    assert.ok(o.gaps.has(out.gap+0),'A2 최적 조합 gap');
  }
  if(html) checkNote(a,L,o,out);
  assert.equal(JSON.stringify(a),original,'A2 원값·순서 불변');
  return {...o,out,t};
}
function checkNote(a,L,o=oracle(a,L),out=actualDisplay(a,L)) {
  const html=L.outageWaterfallHTML(a), notes=[...html.matchAll(/<p\b([^>]*\bid="lg-outage-round-note"[^>]*)>([^]*?)<\/p>/g)];
  const enabled=!o.guarded&&!o.invalid;
  const w2=enabled&&out.gap!==0, w1=enabled&&!w2&&Number.isFinite(a.trial)&&Number.isFinite(a.actual)&&tick(a.trial,o.d)+o.H!==tick(a.actual,o.d);
  assert.equal(notes.length,w2||w1?1:0,'A3 W1/W2 배타적 존재 조건');
  assert.equal((html.match(/\bid="lg-outage-round-note"/g)||[]).length,notes.length,'A3 안내 p 중복 없음');
  if(notes.length) {
    assert.match(notes[0][1],new RegExp(`data-round-note="${w2?'w2':'w1'}"`),'A3 data-round-note');
    assert.match(notes[0][1],/class="lg-hint"/);
    const unit=a.target==='grid'?(a.unit||'MWh'):'%p', diff=value(rounded(total(a),o.d),unit,true,o.d);
    const want=w2?`몫마다 표시 눈금에 맞춰 보여서, 몫의 합(${value((o.H-out.gap)/o.s,unit,true,o.d)})이 차이(${diff})와 ${value(Math.abs(out.gap)/o.s,unit,false,o.d)} 달라요.`:
      `몫의 합은 ${diff}에 맞췄어요. 시작·끝 값은 따로 반올림해 ${value(1/o.s,unit,false,o.d)}만큼 어긋날 수 있어요.`;
    assert.equal(plain(notes[0][2]),want,'A3 W1/W2 글자·세 자리 채움');
    // 폭포 루트의 닫힘 바로 뒤여야 한다. 태그 종류는 명세 밖이므로 고정하지 않는다.
    const root=/<([a-z][\w-]*)\b[^>]*\bid="lg-outage-waterfall"[^>]*>/i.exec(html);
    assert.ok(root,'A3 폭포 루트');
    const tags=new RegExp(`<(/?)${root[1]}\\b[^>]*>`,'gi'); tags.lastIndex=root.index+root[0].length;
    let depth=1, token; while((token=tags.exec(html))) {depth+=token[1]?-1:1;if(!depth)break;}
    assert.equal(depth,0,'A3 폭포 닫힘');
    assert.match(html.slice(tags.lastIndex),/^\s*<p\b[^>]*\bid="lg-outage-round-note"/,'A3 안내는 폭포 바로 뒤');
  }
  return {w1,w2};
}
module.exports={digits,total,replayShown,rounded,tick,plain,value,oracle,actualDisplay,check,checkNote};
