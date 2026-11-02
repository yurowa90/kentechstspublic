'use strict';
// 유일한 기대값 근거: rev14b 명세(배분 계약 A1~A4·S6 표시 B·끝 화면 C·계절 문구 D·꼬리 E·이름 F·390 G). 불변 문구는 앞 명세.
// ui/**는 VM 로드/함수 연결/문턱 변이만. 브라우저·네트워크·커밋 없음.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const O=require('./rev14b-contract.cjs'),{load,read,ROOT}=require('./rev14b-vm.cjs');
let assertions=0,failures=0;const errors=new Map();
function test(label,fn,group=label) {assertions++;try{return fn();}catch(e){failures++;const n=errors.get(group)||0;errors.set(group,n+1);
 if(n<3)console.error(`${e.message.includes('BLOCKED')?'BLOCKED':'FAIL'} ${label}: ${e.message.split('\n')[0]}`);}}
let h;test('VM 초기화',()=>{h=load();});
const rng=seed=>()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
const normal=r=>Math.sqrt(-2*Math.log(1-r()))*Math.cos(2*Math.PI*r());
const sign=r=>r()<.5?-1:1, keys=['choice','weather','event','progress','growth','trade'];
function monthly(start,values,grid=true) {
 const total=values.reduce((n,x)=>n+x,0);
 return {basis:'monthly',round:2,id:'pyeongtaek',target:grid?'grid':'uns',unit:grid?'MWh/일':'%p',trial:start,base:start,actual:start+total,total,
 replay:0,replayOutsideSum:true,parts:values.map((value,i)=>({key:keys[i],value})),clues:Object.fromEntries(keys.map(k=>[k,'가상 검사 단서'])),grid:{value:0,waitingMW:0}};
}
function first(start,values,replay,grid=true) {
 const a=monthly(start,values,grid);a.basis='trial';a.round=1;a.parts.forEach((p,i)=>p.key=['choice','weather','event','trade'][i]);
 a.base=start+replay;a.actual=a.base+values.reduce((n,x)=>n+x,0);a.total=a.actual-start;a.replay=replay;a.replayOutsideSum=false;return a;
}
// 설계 참고는 bench.js GEN뿐. METHODS/check는 읽어 기대값으로 사용하지 않았다.
const GEN={
 U(r,i) {const grid=i%2===0,start=grid&&i%8===0?r()*1.99:r()*100;
  return monthly(start,keys.map(()=> (r()-.5)*(grid?40:8)),grid);},
 T(r,i) {const grid=i%2===0,start=grid&&i%8===0?r()*1.99:r()*20,s=grid&&start>=2?10:100;
  let t=keys.map(()=>{const q=r();return q<.2?0:q<.4?Math.floor(r()*81)-40:(r()-.5)*80;});
  switch(i%6){case 0:t[0]=0;t[1]=29;break;case 1:t=[2.7,2.4,.3,.2,.2,.2];break;
   case 2:{const x=5+r()*35;t=[x,-x,x,...t.slice(3)];break;}case 3:t=t.map(x=>x/10);break;
   case 4:t=[0,0,-29,29,r()-.5,r()-.5];break;case 5:t[0]*=10;t[1]=-t[0]+r();}
  const v=t.map(x=>x* (i%4<2?1:-1)/s);return i%3===0?first(start,v.slice(0,4),[.4,.7,-.4,-1.6][(i>>3)%4]/s,grid):monthly(start,v,grid);},
 R(r,i) {const grid=i%2===0,start=grid&&i%8===0?r()*1.99:r()*(grid?120:15),u=grid?1:.1;
  return monthly(start,[[.35,3],[0,3],[.4,4],[.5,1],[0,.3],[.3,1.5]].map(([p,m])=>r()<p?0:sign(r)*u*m*Math.exp(1.5*normal(r))),grid);},
 Q(r,i) {const grid=i%2===0,start=grid&&i%8===0?r()*1.99:r()*(grid?120:15),u=grid?1:.1;
  return first(start,[[.2,3],[0,2],[.5,4],[.3,1.5]].map(([p,m])=>r()<p?0:sign(r)*u*m*Math.exp(1.5*normal(r))),sign(r)*u*.04*Math.exp(1.5*normal(r)),grid);},
 N(r,i) {const grid=i%2===0,start=grid&&i%8===0?r()*1.99:r()*(grid?60:8),s=grid&&start>=2?10:100,n=i%3===0?4:6;
  const top=1+r()*6,t=[sign(r)*top,sign(r)*Math.max(0,top-r()*1.2)];for(let k=2;k<n;k++)t.push(r()<.3?0:sign(r)*r()*1.6);
  for(let k=n-1;k>0;k--){const j=Math.floor(r()*(k+1));[t[k],t[j]]=[t[j],t[k]];}
  return n===4?first(start,t.map(x=>x/s),sign(r)*r()*.9/s,grid):monthly(start,t.map(x=>x/s),grid);}
};
const crypto=require('node:crypto');const hashes=()=>Object.fromEntries(['league','build','league-data','fx-end'].map(n=>[n,crypto.createHash('sha256').update(read(n)).digest('hex')]));
const startedHashes=hashes();console.log('INFO ui sha256 '+JSON.stringify(startedHashes));
const stats={};
if(h) {
 const {L,ctx,need}=h;
 for(const name of ['gridDigitsFor','outageDigits','outageShownTotal','outagePartRanking','outageCardMin','outageReplayShown','outagePartShown','outageWaterfallHTML'])test(`공개 ${name}`,()=>need(name));
 // new outageDisplay 부재는 명세의 허용 fallback(Map+HTML)을 실제로 검사한다.
 test('A2 배분 API',()=>assert.ok(typeof L.outageDisplay==='function'||typeof L.outageDisplayValues==='function','BLOCKED 함수 없음: outageDisplay / outageDisplayValues'));
 for(const [g,gen] of Object.entries(GEN)) {
  const r=rng(0x14b00000+g.charCodeAt(0)),s=stats[g]={cases:0,grid:0,uns:0,twoDigits:0,feasible:0,fallback:0,guarded:0,guardedMismatch:0,gap:0,w1:0,w2:0};
  for(let i=0;i<100000;i++) {
   const a=gen(r,i);s.cases++;s[a.target]++;if(a.target==='grid'&&O.digits(a)===2)s.twoDigits++;
   // rev14b A2: total/actual은 보존하고, 원인 몫 하나가 빠진 옛 사본을 각 분포에 섞는다.
   if(i%17===0&&a.parts.length) {
    const largest=a.parts.reduce((j,p,k)=>Math.abs(p.value)>Math.abs(a.parts[j].value)?k:j,0);
    a.parts.splice(largest,1);
    if(i%3===0)a.total=null;else if(i%3===1)delete a.total;
   }
   test(`A/${g}/${i}`,()=>{const o=O.check(a,L);s[o.feasible?'feasible':'fallback']++;
    if(o.guarded){s.guarded++;s.guardedMismatch+=+(o.near.reduce((n,x)=>n+x,0)!==o.H);}
    if(o.out?.gap)s.gap++;
    // 가드된 옛 사본은 표시 합≠H여도 gap 0·안내 없음(A2); 비영 gap은 W2(A3).
    if(o.guarded || o.out?.gap || i<100){const n=O.checkNote(a,L,o,o.out);s.w1+=+n.w1;s.w2+=+n.w2;}
   },`A/${g}`);
  }
  test(`A/${g} 원인 누락 가드 관측`,()=>assert.ok(s.guarded>0&&s.guardedMismatch>0,'가드된 옛 사본과 표시 합≠H 사례 포함'));
  console.log(`INFO A ${g} seed=${(0x14b00000+g.charCodeAt(0)).toString(16)} ${JSON.stringify(s)}`);
 }
 for(const [base,want] of [[0,2],[1.999999,2],[-1.999999,2],[2,1],[-2,1],[NaN,1],[Infinity,1]])test('A1 gridDigitsFor '+base,()=>assert.equal(need('gridDigitsFor')(base),want));
 for(const [target,unit,trial,base,want] of [['grid','MWh/일',undefined,1.5,2],['grid','MWh',.5,.5,1],['uns','%p',100,100,2]])test('A1 outageDigits '+unit+'/'+trial,()=>assert.equal(need('outageDigits')({target,unit,trial,base}),want));
 const fixturePath=path.join(__dirname,'fixtures/rev14b-engine.json'),engine=JSON.parse(fs.readFileSync(fixturePath));
 test('엔진 fixture <=600건/120KB/두 대상/비영 몫',()=>{assert.ok(engine.length<=600&&engine.length>0);assert.ok(fs.statSync(fixturePath).size<=120000);
  assert.deepEqual([...new Set(engine.map(a=>a.target))].sort(),['grid','uns']);assert.ok(engine.every(a=>a.parts.some(p=>p.value!==0)));});
 engine.forEach((a,i)=>test(`A/engine/${i}`,()=>O.check(a,L,{html:true}),'A/engine'));
 const fixed=[
  ['월간 +0.9',monthly(20,[.84835,-1.47325,0,0,1.54948,-.0003])],
  ['월간 +3.1',monthly(20,[0,1.55714,0,0,1.55347,.00082])],
  ['합 .8 순서/단독 최대',monthly(20,[.27,.24,.24,0,0,0])],
  ['N1 두 카드 비영',monthly(14.5,[0,.16,0,0,.08,0])],
  ['재현 > 원인 최대',first(4,[-.116856,-.00316,0,0],.215,false)],
  ['원인 없이 재현만 보이는 P',first(4,[],.215,false)],
  ['W1 1자리',monthly(10.06,[.06,0,0,0,0,0])],
  ['W1 2자리',monthly(1.006,[.006,0,0,0,0,0])],
  ['W1 정전',monthly(10.006,[.006,0,0,0,0,0],false)],
 ];
 for(const [label,a] of fixed)test(`A 고정 ${label}`,()=>{O.check(a,L,{html:true});if(label==='N1 두 카드 비영'){
  const out=O.actualDisplay(a,L);for(const key of ['weather','growth'])assert.ok(Math.abs(out.values.get(key)??O.rounded(a.parts.find(p=>p.key===key).value,1))>=.1,'N1 카드 후보 표시 >= .1');}});
 for(const missing of [null,undefined])test(`A2 total ${missing} 옛 기록`,()=>{const a=monthly(10,[.26,.26,0,0,0,0]);a.total=missing;O.check(a,L,{html:true});});
 for(const grid of [true,false])for(const start of [1.006,10.06])for(const missing of [false,null,undefined])test(`A2 원인 하나 누락 ${grid}/${start}/total=${missing}`,()=>{
  const a=monthly(start,[grid?.16:.016,grid?.06:.006,0,0,0,0],grid);a.parts.shift();if(missing!==false)a.total=missing;
  const o=O.check(a,L,{html:true});assert.ok(o.guarded,'A2 원값 합 가드 작동');
  assert.notEqual(o.near.reduce((n,x)=>n+x,0),o.H,'표시 합≠H여도 gap 0·안내 없음');
 });
 for(const [grid,start] of [[true,20],[true,1.5],[false,10]])for(const sign of [1,-1])for(const factor of [.999,1,1.001])test(`A2 반 눈금 가드 경계 ${grid}/${start}/${sign}/${factor}`,()=>{
  const a=monthly(start,[0,0,0,0,0,0],grid);a.total=sign*factor*.5/10**O.digits(a);a.actual=a.trial+a.total;
  const o=O.check(a,L,{html:true});assert.equal(!!o.guarded,factor>=1,'A2 >= 반 눈금부터 가드');
 });
 test('A2 두 자리 첫 달 작은 합 안 재현: 폭포 줄·배분 포함',()=>{
  const a=first(1.5,[.12,0,0,0],.007),o=O.check(a,L,{html:true});
  assert.equal(o.d,2);assert.ok(.005<=a.replay&&a.replay<.05);
  assert.deepEqual(o.P.map(p=>p.key),['choice','weather','event','trade','replay']);
  assert.ok(!o.guarded&&o.feasible>0);assert.ok(o.out.values.has('replay'),'P 전체 배분에 replay 포함');
  const html=need('outageWaterfallHTML')(a),row=/data-out-step="replay"[^]*?<b>([^<]+)<\/b>/.exec(html);
  assert.ok(row,'합 안 재현 폭포 줄 있음');assert.equal(O.plain(row[1]),O.value(o.out.values.get('replay'),'MWh/일',true,2));
 });
 for(const [grid,start,min] of [[true,20,.05],[true,1.5,.005],[false,10,.005]])for(const sign of [1,-1])for(const factor of [.999,1,1.001])test(`A2 재현 표시 경계 ${grid}/${start}/${sign}/${factor}`,()=>{
  const a=first(start,[.12,0,0,0],sign*min*factor,grid),o=O.check(a,L,{html:true});
  assert.equal(o.P.some(p=>p.key==='replay'),factor>=1,'재현 반 눈금 이상 P 포함');
  assert.equal(/data-out-step="replay"/.test(need('outageWaterfallHTML')(a)),factor>=1,'재현 반 눈금 이상 폭포 줄 포함');
 });
 for(const bad of [NaN,Infinity,-Infinity])test(`A2 비유한 ${bad}`,()=>{const a=monthly(20,[0,0,0,0,0,0]);a.total=bad;O.check(a,L);});
 for(const bad of [NaN,Infinity,-Infinity])test('A2 비유한 몫 '+bad,()=>{const a=monthly(20,[0,0,0,0,0,0]);a.parts[1].value=bad;O.check(a,L);});
 test('A2 빈 P',()=>{const a=monthly(20,[]);O.check(a,L);});
 test('A2 같은 객체 캐시 / 값 변경 후 재계산',()=>{
  const a=monthly(14.5,[0,.16,0,0,.08,0]);const one=O.actualDisplay(a,L),two=O.actualDisplay(a,L);
  assert.equal(two.values,one.values,'같은 객체는 같은 Map 캐시');
  a.parts[1].value=.76;a.total=.84;a.actual=15.34;O.check(a,L,{html:true});
  a.replay=.215;a.replayOutsideSum=false;a.total+=.215;a.actual+=.215;O.check(a,L,{html:true});
  a.trial=1.45;O.check(a,L,{html:true});
 });
 const id='pyeongtaek',C=ctx.KCP.leagueCore,pack=C.teamDef(C.regionOf('south'),id).pack;
 const fill=r=>Math.max(0,r.isolated.uns-r.uns-r.imp+r.sub);
 function pair(old,now,month=2,firstMonth=false,mdays=28,trialMWh=34.65) {
  const rd=(m,days)=>({year:2027,month:m,season:m<3?'winter':m<6?'spring':'summer',days:7,mdays:days});
  const rounds=firstMonth?[rd(1,mdays)]:[rd(month-1,31),rd(month,mdays)];
  const prev={...rounds[0],round:1,team:{[id]:old}},res={...rounds.at(-1),round:firstMonth?1:2,team:{[id]:now}};
  const V={room:'REV14B',region:'south',round:res.round,rounds,results:firstMonth?[res]:[prev,res]};
  const trial={map:pack,scope:JSON.stringify([V.room,id]),year:res.year,month:res.month,season:res.season,days:7,gridMWh:trialMWh,unsPct:old.unsPct??0,seed:1402,outH:0,co2:0,cost:0,plan:{builds:[],lines:[],policies:[]}};
  const n={topic:'grid',confirmed:true,pred:{grid:'up'},trial};
  h.store.set('kcp-build-trial-v1',JSON.stringify({[JSON.stringify([trial.scope,pack])]:trial}));
  h.session.snap=V;return {V,res,n,base:firstMonth?trial.gridMWh/trial.days:fill(old)/prev.days,actual:fill(now)/res.days};
 }
 const readNumber=text=>{const m=String(text).match(/([+−-]?\d[\d,]*(?:\.\d+)?)\s*(?:MWh\/일|%p)/);assert.ok(m,`표시 숫자 추출: ${text}`);return Number(m[1].replaceAll(',','').replace('−','-'))+0;};
 function gridCheck(f) {
  const {V,res,n,base,actual}=f,a={target:'grid',unit:'MWh/일',total:actual-base,trial:base},d=O.digits(a),want=O.rounded(actual-base,d);
  const head=readNumber(need('outageValue')(need('outageShownTotal')(a),'MWh/일',true,need('outageDigits')(a)));
  assert.equal(head,want,'B S7 = 명세 원식 반올림');
  for(const [name,args] of [['gridReliance',[V,res,id]],['promiseGridReliance',[V,res,id,n]]]) {
   const g=need(name)(...args);
   assert.equal(g.shownDeltaPerDay,actual-base,`B ${name} 표시 전용 Δ 연산 순서`);
   assert.equal(g.shownBasePerDay,base,`B ${name} 표시 기준`);
   const text=need('gridDeltaText')(g);assert.equal(readNumber(text),want,`B ${name} S6 = S7`);
   assert.match(text,new RegExp(`\\.\\d{${d}} MWh/일`),'A1 S6 자릿수');
  }
 }
 function unsCheck(delta) {
  const a={target:'uns',total:delta,trial:12},want=O.rounded(delta,2);
  const head=readNumber(need('outageValue')(need('outageShownTotal')(a),'%p',true,need('outageDigits')(a)));
  const verdict=need('promiseVerdictText')({r:{},topic:'uns',delta,actual:delta>.5?'up':delta<-.5?'down':'same',hit:false,tol:.5,comparison:{label:'지난달 실제'}},{pred:{uns:'up'}});
  const all=[...String(verdict).matchAll(/([+−-]?\d[\d,]*(?:\.\d+)?)\s*%p/g)];
  assert.ok(all.length,'B 정전 S6 판정 Δ 숫자');
  const v=Number(all.at(-1)[1].replaceAll(',','').replace('−','-'))+0;
  assert.equal(v,want,'B 정전 S6 signed(delta,2)');assert.equal(head,v,'B 정전 S6 = S7');
 }
 const r=rng(0xb14b2026);let gridMonths=0,unsMonths=0,boundaries=0,smallBase=0,firstMonths=0;
 const row=()=>({uns:Math.floor(r()*10000)/100,imp:Math.floor(r()*50000)/100,sub:Math.floor(r()*10000)/100,isolated:{uns:Math.floor(r()*100000)/100},unsPct:Math.floor(r()*10000)/100});
 for(let i=0;i<300000;i++) {
  if(i%3===2){unsMonths++;const old=row(),now=row();test(`B uns/${i}`,()=>unsCheck(now.unsPct-old.unsPct),'B uns');}
  else {gridMonths++;const old=row(),now=row(),f=pair(old,now,2+i%10,i%4<2,28+i%4,i%8<2?Math.floor(r()*1399)/100:Math.floor(r()*100000)/100);
   if(f.base<2)smallBase++;if(i%4<2)firstMonths++;
   test(`B grid/${i}`,()=>gridCheck(f),'B grid');}
 }
 // r2 입력의 대표 7일 차이 .35의 홀수배: 하루 값 x.x5 경계 24,000건.
 for(let i=0;i<24000;i++) {
  const cents=10000+(i%1000)*70,change=(2*(i%99)+1)*35*(i%2?1:-1),old={uns:0,imp:0,sub:0,isolated:{uns:cents/100}},now={uns:0,imp:0,sub:0,isolated:{uns:(cents+change)/100}};
  boundaries++;test(`B boundary/${i}`,()=>gridCheck(pair(old,now,2+i%10,false,28+i%4)),'B boundary');
 }
 for(const [label,old,now,m] of [
  ['2월',{isolated:{uns:346.47},uns:4.96,imp:28.88,sub:7.69},{isolated:{uns:292.29},uns:1.32,imp:48.09,sub:9.89},2],
  ['7월',{isolated:{uns:582.28},uns:0,imp:0,sub:0},{isolated:{uns:711.43},uns:0,imp:0,sub:0},7]
 ])test(`B 고정 ${label}`,()=>gridCheck(pair(old,now,m)));
 test('B 첫 달 n.trial 우선순위와 각 시험 원기간',()=>{
  const f=pair({uns:0,imp:0,sub:0,isolated:{uns:70}},{uns:0,imp:0,sub:0,isolated:{uns:140}},1,true,31,70);
  f.n.trial={...f.n.trial,days:14};
  for(const [name,args,base] of [['gridReliance',[f.V,f.res,id],10],['promiseGridReliance',[f.V,f.res,id,f.n],5]]) {
   const g=need(name)(...args),a={target:'grid',unit:'MWh/일',trial:base,total:20-base};
   assert.equal(g.shownBasePerDay,base,'B '+name+' 시험 기준');assert.equal(g.shownDeltaPerDay,20-base);
   assert.equal(readNumber(need('gridDeltaText')(g)),readNumber(need('outageValue')(need('outageShownTotal')(a),'MWh/일',true,need('outageDigits')(a))));
  }
 });
 console.log(`INFO B seed=0xb14b2026 grid=${gridMonths} uns=${unsMonths} boundary=${boundaries} first=${firstMonths} base<2=${smallBase}`);
 // 문턱 변이: 함수 본문을 메모리에서만 대체. 원문 정규식 불일치는 실패다.
 test('A1 단일 출처 gridDigitsFor 변이 S6/S7 동시 변경',()=>{
  const src=read('league'),pattern=/(?:const|let) gridDigitsFor\s*=\s*[^;\n]+;/;
  assert.ok(pattern.test(src),'BLOCKED 변이 정규식 불일치: gridDigitsFor');
  const changed=src.replace(pattern,'const gridDigitsFor = basePerDay => 2;');assert.notEqual(changed,src);
  const mh=load(changed),f=pair({isolated:{uns:140},uns:0,imp:0,sub:0},{isolated:{uns:142.59},uns:0,imp:0,sub:0});
  const a={target:'grid',unit:'MWh/일',trial:f.base,total:f.actual-f.base};
  mh.session.snap=f.V;const render=x=>({s6:x.need('gridDeltaText')(x.need('gridReliance')(f.V,f.res,id)),s7:x.need('outageValue')(x.need('outageShownTotal')(a),'MWh/일',true,x.need('outageDigits')(a))});
  const before=render(h),after=render(mh);
  for(const [x,d] of [[before,1],[after,2]]) {assert.match(x.s6,new RegExp(`\\.\\d{${d}} MWh/일`));assert.match(x.s7,new RegExp(`\\.\\d{${d}} MWh/일`));assert.equal(readNumber(x.s6),readNumber(x.s7));}
  assert.notEqual(before.s6,after.s6);assert.notEqual(before.s7,after.s7);
 });
 // 실제 카드/폭포/끝 기록 소비자가 자릿수를 버리는 회귀를 잡는다.
 for(const [label,start,grid,d] of [['계통2',1.5,true,2],['계통1',14.5,true,1],['정전',10,false,2]])test(`A1 소비 화면 ${label}`,()=>{
  const a=monthly(start,[0,.367,0,0,.08,0],grid),m=O.actualDisplay(a,L).values;
  assert.equal(need('outageDigits')(a),d);const n={topic:grid?'grid':'uns',pred:{[grid?'grid':'uns']:'up'},outageFrozen:a,outageOpened:true,outageSingleShown:true,outageLargest:{key:'weather',value:.367},missed:'weather',missedBasis:'monthly',missedCarry:true};
  const S=C.newState('R14BDIG','south',0,[id,'dangjin'],{turns:12,seedMode:'fixed'});S.round=2;S.phase='review';
  const res={round:2,days:7,team:{[id]:{unsPct:0}}};h.session.snap=S;h.session.S=S;h.session.interview.months[1]=n;h.session.interview.months[2]=n;
  const html=need('outageCardsHTML')(S,res,id,n),water=need('outageWaterfallHTML')(a),unit=grid?'MWh/일':'%p';
  const part=O.value(m.get('weather')??O.rounded(.367,d),unit,true,d);
  assert.ok(O.plain(html).includes(part),'A1 카드 몫 자릿수');
  for(const [key,raw] of [['previous',a.trial],['weather',m.get('weather')??.367],['actual',a.actual]]){
   const row=[...water.matchAll(/data-out-step="([^"]+)"[^]*?<b>([^<]+)<\/b>/g)].find(x=>x[1]===key);assert.ok(row,`A1 폭포 ${key}`);
   assert.match(O.plain(row[2]),new RegExp(`\\.\\d{${d}}(?: MWh/일|%p?)`));
  }
  const record=need('missedText')(n);assert.ok(record.includes(part),'A1 끝 missedText 몫');
  // missedText는 다음 달 carry와 같은 저장 몫을 읽는 명세 허용 경로다.
  const head=O.value(O.rounded(a.total,d),unit,true,d);assert.ok(O.plain(html).includes(head),'A1 S7 머리 숫자 자릿수');
  const minText=need('outageShareThresholdText')(need('outageCardMin')(a),unit,d);if(d===2)assert.match(O.plain(minText),/\.\d{2}(?: MWh\/일|%p)/,'A1 카드 최소 크기 두 자리');
 });
 const HS='오후 냉방 수요가 늘고 LNG·일반 태양광 출력이 조금 줄어요.';
 const H1='오후 냉방 수요가 늘고 LNG·일반 태양광 출력이 조금 줄며 공공시설 보수비가 한 번 들어요. 재난이라 특별교부세가 나와요.';
 const R=C.regionOf('south');
 test('D heatwave 자료 HS / H1 / 기존 속성 불변',()=>{
  const heat=C.eventDef(R,'heatwave_peak');assert.equal(heat.textSeason,HS);assert.equal(heat.text,H1);
  const old=vm.createContext({KCP:{}});old.window=old;
  vm.runInContext(execFileSync('git',['show','5d5e57a:ui/league-data.js'],{cwd:ROOT,encoding:'utf8'}),old);
  const find=x=>x&&typeof x==='object'?(x.id==='heatwave_peak'?x:Object.values(x).map(find).find(Boolean)):null;
  const baseline=JSON.parse(JSON.stringify(find(old.KCP.LEAGUE_REGIONS))),current=JSON.parse(JSON.stringify(heat));
  delete current.textSeason;assert.deepEqual(current,baseline,'D text/effect/grant/repairParam/opts 등 불변');
 });
 for(const econ of [false,true])for(const event of ['heatwave_peak','coldwave_heating','heavy_rain'])test(`D evCards ${econ}/${event}`,()=>{
  const S=C.newState('R14BEV','south',0,[id,'dangjin'],{turns:12,seedMode:'fixed'});S.round=7;S.events=[{id:event,round:7,x:1}];if(!econ)delete S.econ;
  const E=C.eventDef(R,event),want=event==='heatwave_peak'?econ?H1:HS:E.text;
  const raw=need('evCards')(S,7,id);let depth=0;const front=raw.replace(/<\/?details\b[^>]*>|[^<]+|<[^>]*>/gi,x=>{if(/^<details\b/i.test(x)){depth++;return '';}if(/^<\/details/i.test(x)){depth--;return '';}return depth?'':x;});const html=O.plain(front);assert.ok(html.includes(want),`D 앞면 문구: ${want}`);
  if(!econ&&event==='heatwave_peak'){assert.ok(!html.includes('보수비'));assert.ok(!html.includes('교부세'));}
  if(typeof L.eventText==='function')assert.equal(L.eventText(E,S),want,'D eventText 직접');
 });
 for(const pred of ['up','down'])test(`E 꼬리 위치 ${pred}`,()=>{
  const a=monthly(20,[0,2,1,0,0,0]);a.hasConnectedWind=true;
  const n={topic:'grid',pred:{grid:pred},evidence:{key:'wind',text:'풍속',value:5}};
  const text=need('outageEvidenceSummary')(n,a),tail=pred==='up'?'(내 예측과 같은 쪽)':'(내 예측과 반대쪽)';
  assert.match(text,/외 \d+개/,'E 여러 직접 연결 몫 분기 확보');
  assert.ok(text.indexOf(tail)<text.indexOf('외 '),'E 꼬리 < 외 n개');
  const part=O.value(O.actualDisplay(a,L).values.get('weather')??2,'MWh/일',true,1);
  assert.ok(text.includes(part+' '+tail+' 외 '),'E 최대 직접 연결 값 바로 뒤 공백 하나');
 });
 // F6 실제 leagueCore 사건 정의를 읽는 끝 화면 렌더러. 아이콘은 기준판과 대조한다.
 let oldFx;
 test('F6 아이콘 불변 기준판 로드',()=>{
  oldFx=load();vm.runInContext(execFileSync('git',['show','5d5e57a:ui/fx-end.js'],{cwd:ROOT,encoding:'utf8'}),oldFx.ctx);
 });
 for(const [event,want] of [['evening_peak_tropical_night','해질녘 피크·열대야'],['heatwave_peak','역대급 폭염 피크'],['unknown-rev14b','일반 사건']])test('F6 낭독 이름 '+event,()=>{
  const V={room:'REV14BFX',phase:'end',round:1,region:'south',active:[id],teams:{[id]:{}},rounds:[{year:2027,month:7,mdays:31}],
   events:[{id:event,round:1}],econ:{cities:{[id]:{name:'가상 도시',pop0:1000,hist:[{t:0,appr:50,pop:1000}]}}},
   results:[{round:1,days:7,team:{[id]:{unsPct:0,co2Prod:10,outH:0}}}]};
  const html=ctx.KCP.fxEnd.html(V,id),old=oldFx.ctx.KCP.fxEnd.html(V,id);
  const sr=[...html.matchAll(/<[^>]*class="lg-sr"[^>]*>([^]*?)<\/span>/g)].map(m=>O.plain(m[1]));
  assert.ok(sr.some(t=>t.includes(' · '+want+' · ')),'F6 .lg-sr 사건 이름: '+JSON.stringify(sr));
  const icons=t=>[...t.matchAll(/<[^>]*data-fx-month="1"[^>]*>([^]*?)<\/[^>]+>/g)].map(m=>O.plain(m[1].replace(/<span[^>]*class="lg-sr"[^>]*>[^]*?<\/span>/g,'')));
  assert.ok(icons(html).length,'F6 달 아이콘 관측');assert.deepEqual(icons(html),icons(old),'F6 보이는 아이콘은 기준판 그대로');
 });
 const C10s='시험에는 폭염 때 줄어드는 LNG·일반 태양광 출력이 들어 있지 않아요.';
 const C10='시험에는 폭염 때 줄어드는 LNG·일반 태양광 출력과 월말 공공시설 보수비도 들어 있지 않아요.';
 for(const econ of [false,true])test('D trialGoals 폭염 '+(econ?'경제 C10':'계절 C10s'),()=>{
  const t=load(),B=t.ctx.KCP.buildGame,C=t.ctx.KCP.leagueCore;
  const S=C.newState('R14BTRIAL','south',0,[id,'dangjin'],{turns:econ?12:0,seedMode:'fixed'});
  const rounds=C.roundsOf(S);S.round=rounds.findIndex(r=>r.season==='summer')+1;S.phase='plan';
  assert.ok(S.round>0,'여름 라운드 있음');assert.equal(!!S.econ,econ);
  if(!econ)assert.equal(rounds.length,4,'계절 4라운드 fixture');
  S.events=[{id:'heatwave_peak',round:S.round,x:1}];
  Object.assign(t.session,{S,snap:S});B.selectPack(pack,'league');
  B.current=()=>({builds:[],lines:[],policies:[],rq:[]});
  const report=t.need('trialGoals')({map:pack,seed:1,days:7,tot:{dem:1000,co2:100,by:{import:7}},unsTotal:0},id);
  const want=econ?C10:C10s,index=report.notes.findIndex(n=>n.startsWith(want));
  assert.ok(index>=0,'trialGoals 안내 줄이 명세 문장으로 시작');
  // 성적표는 notes와 같은 인덱스의 noteDetails.visible/detail을 읽는다(입출력 구조만 확인).
  const fold=report.noteDetails?.[index];assert.ok(fold,'폭염 안내의 ! 설명 데이터 있음');
  assert.equal(fold.visible,want,'보이는 폭염 안내는 C10/C10s까지');
  assert.ok(typeof fold.detail==='string'&&fold.detail.trim().length>0,'근거·한계 설명은 ! 안 데이터에 있음');
  if(!econ)assert.ok(!report.notes[index].includes('보수비'),'계절 안내 보수비 없음');
 });
 // G V4 덧붙임의 문서 이벤트 계약. 연결점만 호출하고 실제 리스너를 실행한다.
 // 배치·실제 터치 전파는 rev14b.py의 브라우저 검사 대상이다.
 test('G V4 문서 pointerdown/click 관통·외부 click·중복 등록',()=>{
  const t=load(),listeners=new Map();let narrow=true,actions=0;
  const summary={contains:target=>target===summary},pop={contains:target=>target===pop},
   info={open:true,dataset:{pinned:'true'},querySelector:s=>s==='summary'?summary:s==='.lg-info-pop'?pop:null};
  t.ctx.matchMedia=()=>({matches:narrow});
  t.ctx.document.addEventListener=(type,fn,capture)=>{
   if(!listeners.has(type))listeners.set(type,[]);
   listeners.get(type).push({fn,capture});
  };
  t.ctx.document.querySelectorAll=s=>s==='.lg-money-info[open]'&&info.open?[info]:[];
  const root={querySelectorAll:()=>[]};
  t.need('bindInfoTips')(root);t.need('bindInfoTips')(root);
  for(const type of ['pointerdown','click']){
   assert.equal(listeners.get(type)?.length,1,type+' 문서 리스너 하나');
   assert.equal(listeners.get(type)[0].capture,true,type+' 대상 전에 처리');
  }
  function fire(type,target,timeStamp) {
   const e={target,timeStamp,defaultPrevented:false,stopped:false,
    preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}};
   for(const {fn} of listeners.get(type)||[])fn(e);
   if(type==='click'&&!e.defaultPrevented&&!e.stopped)actions++;
   return e;
  }
  const opened=()=>{info.open=true;info.dataset.pinned='true';};
  fire('pointerdown',pop,1000);
  assert.equal(info.open,false,'설명 안 pointerdown은 닫음');assert.equal(info.dataset.pinned,undefined,'고정 해제');
  const blocked=fire('click',{id:'lg-ready'},1001);
  assert.equal(blocked.defaultPrevented,true);assert.equal(blocked.stopped,true);assert.equal(actions,0,'준비 click 실행 없음');
  const next=fire('click',{id:'journal-tab'},1002);
  assert.equal(next.defaultPrevented,false);assert.equal(next.stopped,false);assert.equal(actions,1,'바로 다음 click 하나만 차단');
  opened();fire('pointerdown',{id:'journal-tab'},2000);
  assert.equal(info.open,false);assert.equal(info.dataset.pinned,undefined);
  const outside=fire('click',{id:'journal-tab'},2001);
  assert.equal(outside.defaultPrevented,false);assert.equal(outside.stopped,false);assert.equal(actions,2,'설명 밖 보이는 요소 정상 동작');
  opened();fire('pointerdown',summary,3000);
  assert.equal(info.open,true,'summary 누름은 바깥 닫기로 처리하지 않음');
  const own=fire('click',summary,3001);assert.equal(own.defaultPrevented,false);assert.equal(own.stopped,false);
  narrow=false;opened();fire('pointerdown',pop,4000);assert.equal(info.open,true,'넓은 화면 열림 유지');
  const wide=fire('click',pop,4001);assert.equal(wide.defaultPrevented,false);assert.equal(wide.stopped,false);
 });
 for(const event of ['heatwave_peak','unknown-rev14b'])test('F6 regionOf null 예외·일반 사건 fallback '+event,()=>{
  const t=load(),core=t.ctx.KCP.leagueCore;
  // 덧붙임 F6: 지역을 찾지 못하는 경계값을 강제한다.
  core.regionOf=()=>null;assert.equal(core.regionOf('missing-rev14b'),null);
  const V={room:'REV14BNULL',phase:'end',round:1,region:'missing-rev14b',active:[id],teams:{[id]:{}},
   rounds:[{year:2027,month:7,mdays:31}],events:[{id:event,round:1}],
   econ:{cities:{[id]:{name:'가상 도시',pop0:1000,hist:[{t:0,appr:50,pop:1000}]}}},
   results:[{round:1,days:7,team:{[id]:{unsPct:0,co2Prod:10,outH:0}}}]};
  const html=t.ctx.KCP.fxEnd.html(V,id),sr=[...html.matchAll(/<[^>]*class="lg-sr"[^>]*>([^]*?)<\/span>/g)].map(m=>O.plain(m[1]));
  assert.ok(sr.some(s=>s.includes(' · 일반 사건 · ')),'지역·기분 이름표 없음은 일반 사건: '+JSON.stringify(sr));
 });
 test('F5 powerChipDefinition PC 괄호',()=>{
  const fn=ctx.KCP.buildGame.powerChipDefinition;let text;
  if(typeof fn==='function')text=fn();else if(typeof fn==='string')text=fn;
  else {const m=read('build').match(/function powerChipDefinition\([^]*?\n  \}/);assert.ok(m,'BLOCKED 함수 없음: powerChipDefinition');text=m[0];}
  assert.match(text,/\((?:\d+|\$\{PLAIN_DAY\.m \+ 1\})월, 무더위·사건 제외\)/,'F5 PC 괄호');
  assert.ok(!text.includes('한파')&&!text.includes('폭염'),'F5 PC 한파·폭염 없음');
 });
}
console.log('INFO ui sources stable '+(JSON.stringify(startedHashes)===JSON.stringify(hashes())));
console.log(`INFO failures by group ${JSON.stringify(Object.fromEntries(errors))}`);
console.log(`assertions ${assertions} failures ${failures}`);process.exitCode=failures?1:0;
