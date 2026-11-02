'use strict';
// 기대값: rev17 명세 문구 표·#55·#33·#74-3/5/6·#76-1/2·#28·#29(#20은 개정 3으로 보류, 단언 없음).
// 실행: node tests/league/review/65-rev17.js (기준판은 REV17_ROOT로 지정).
// 실제 소스 그대로 VM 적재, 공개 API만 호출. N9b는 최소 DOM 배치, 실제 브라우저 배치는 rev17.py가 담당한다.
// N8 전수 8318회: Node v24.21.0에서 5.410초 실측(기준점은 크기별 독립 계산·재사용).
const COPY = {
  M1: '지도에 덧입힌 옅은 색은 사건 종류 표시(효과 크기 무관)',
  Q1: '미연결 설비: {목록}', Q2: '외 {n}기'
};
const fill = (key, values = {}) => COPY[key].replace(/\{([^}]+)\}/g, (_, k) => String(values[k]));
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const ROOT = process.env.REV17_ROOT ? path.resolve(process.env.REV17_ROOT) : path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
let assertions = 0, failures = 0;
function test(label, fn) {
  assertions++;
  try { fn(); console.log('PASS ' + label); }
  catch (e) {
    failures++;
    const detail = Object.hasOwn(e, 'actual') ? ` actual=${JSON.stringify(e.actual)} expected=${JSON.stringify(e.expected)}` : '';
    console.log(`${e.message.includes('BLOCKED') ? 'BLOCKED' : 'FAIL'} ${label}: ${e.message.split('\n')[0]}${detail}`);
  }
}
let ctx, fx;
test('실제 파일 VM 적재', () => {
  const store = new Map(), storage = { getItem:k=>store.get(k)??null, setItem:(k,v)=>store.set(k,String(v)), removeItem:k=>store.delete(k) };
  ctx = vm.createContext({ console, performance, structuredClone, URL,
    document:{ documentElement:{}, addEventListener(){}, getElementById:()=>null, querySelector:()=>null, querySelectorAll:()=>[] },
    addEventListener(){}, setTimeout(){return 0;}, clearTimeout(){}, requestAnimationFrame(){},
    localStorage:storage, sessionStorage:storage, matchMedia:()=>({matches:false,addEventListener(){}}),
    KCP:{route(){},on(){},esc:String,gradeWords:String,leagueNet:{expandSnapshot:x=>x}} });
  ctx.window=ctx;
  for (const name of ['build-maps','tech-data','build','econ-data','econ','league-data','league-core','league','fx-end'])
    vm.runInContext(read(`ui/${name}.js`),ctx,{filename:`ui/${name}.js`,timeout:10000});
  // test-fx-turn-audio.js의 최소 DOM: 공개 순수 함수만 부르므로 mount/재생은 하지 않는다.
  const document={documentElement:{},addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[]};
  const window={KCP:{},document,addEventListener(){},innerWidth:1280,innerHeight:900};
  vm.runInNewContext(read('ui/fx-turn.js'),{window,document,performance,
    requestAnimationFrame(){},cancelAnimationFrame(){},setTimeout(){return 0;},clearTimeout(){},
    MutationObserver:class{observe(){} disconnect(){}},ResizeObserver:class{observe(){} disconnect(){}}}, {timeout:10000});
  fx=window.KCP.fxTurn;
});
const call = (name,...args) => {
  const f=ctx?.KCP?.league?.uiMath?.[name];
  assert.equal(typeof f,'function',`BLOCKED 공개 uiMath.${name} 없음`);
  return f(...args);
};
const fxCall = (...args) => {
  assert.equal(typeof fx?.deckPresentation,'function','BLOCKED 공개 fxTurn.deckPresentation 없음');
  return fx.deckPresentation(...args);
};
// 존재 검사를 표보다 먼저 하나씩. 기준판에는 새 공개 함수가 없어 BLOCKED.
for (const name of ['gridLevelShown','outageValue','perDayText','dailyCitationNumbers','learningVerdict','promiseVerdictText','issueNamesLine','issueMarks','previewLabelLayout'])
  test(`공개 uiMath.${name}`,()=>assert.equal(typeof ctx?.KCP?.league?.uiMath?.[name],'function',`BLOCKED 공개 uiMath.${name} 없음`)); // 새 API 없음
 test('공개 fxTurn.deckPresentation',()=>assert.equal(typeof fx?.deckPresentation,'function','BLOCKED 공개 fxTurn.deckPresentation 없음')); // 기준판 함수 없음
 test('공개 fxTurn.DECK_COVER_MAX',()=>{assert.ok(fx&&Object.hasOwn(fx,'DECK_COVER_MAX'),'BLOCKED 공개 fxTurn.DECK_COVER_MAX 없음');assert.equal(fx.DECK_COVER_MAX,.40);}); // 기준판 상수 없음

const n1=[[1,3.5486,'3.55 MWh/일'],[1,3.5,'3.50 MWh/일'],[1,1234.567,'1,234.57 MWh/일'],[2.5,3.5486,'3.5 MWh/일'],[1,.03,'0.1 MWh/일 미만'],[undefined,1,'1 MWh/일']];
for(const source of ['base','shownBasePerDay']) test(`N1 #55 수준값 표 ${source}`,()=> {
  for(const [base,perDay,expected] of n1) {
    const grid={perDay,...(base===undefined?{}:source==='base'?{base:{perDay:base}}:{shownBasePerDay:base,base:{perDay:99}})};
    assert.equal(call('gridLevelShown',grid),expected);
  }
}); // 기준판 gridLevelShown 없음
let seed=0x17c0ffee;
const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
const samples=Array.from({length:10000},()=>({base:random()*2,value:.05+random()*49.95}));
test('N2 #55 2자리 10000개 독립 Intl·S7 일치',()=> {
  for(const {base,value} of samples) {
    const expected=value.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2})+' MWh/일';
    assert.equal(call('gridLevelShown',{base:{perDay:base},perDay:value}),expected);
    assert.equal(call('outageValue',value,'MWh/일',false,2),expected);
  }
}); // 기준판 새 API 없음
 test('N2 #55 1자리 10000개 기존 perDayText 일치',()=> {
  for(const {base,value} of samples) assert.equal(call('gridLevelShown',{shownBasePerDay:base+2,perDay:value}),call('perDayText',value));
}); // 기준판 새 API 없음
const citations=[[3.5486,['3.5','4','3.55']],[.15,['0.2','0','0.1','0.15']],[.0749,['0.1','0','0.07']],[1234.567,['1234.6','1235','1234.57']],[.03,[]],[NaN,[]],[-1,[]]];
for(const [v,expected] of citations) test(`N3 #55 인용 후보 ${v}`,()=>assert.deepEqual(plain(call('dailyCitationNumbers',v)),expected)); // 기준판 함수 없음
const mission=(askReason,resultNumbers)=>({operatingPlan:{},followingPlanChanged:false,followingPlanBasis:'ready',resultNumbers,
 evidence:{key:'grid'},topic:'grid',pred:{grid:'same'},compared:true,answer:'keep',askReason}); // 48d7d98 prerec-node.js mission()
for(const text of ['3.55','3.5','4','3.54','3.549','0']) test(`N4 #55 유지 인용 ${text}`,()=> {
 const numbers=call('dailyCitationNumbers',3.5486);
 assert.equal(call('learningVerdict',mission(`${text} MWh/일이어서 유지해요`,numbers)),['3.55','3.5','4'].includes(text)?'achieved':'uncited');
}); // 기준판 공개 API 없음
 test('N4 옛 후보 기록은 재계산하지 않음',()=>assert.equal(call('learningVerdict',mission('3.55 MWh/일이어서 유지해요',['3.5'])),'uncited')); // 기준판 공개 API 없음
function comparison(base,value) {return {topic:'grid',actual:'up',hit:true,grid:{base:{label:'시험 1주 대비',perDay:base},perDay:value,deltaPerDay:value-base,tolPerDay:Math.max(.05,base*.05),mwh:110,cost:12.3}};}
const note={pred:{grid:'up'}};
test('N5 #55 2자리 수준값·Δ',()=> {
 const text=call('promiseVerdictText',comparison(1,3.5486),note);
 assert.ok(text.includes('이번 달 하루 평균 3.55 MWh/일'));
 assert.match(text,/하루 평균 \+2\.55 MWh\/일 변화/);
}); // 기준판 수준값은 3.5 / 공개 함수 없음
 test('N5 #55 1자리 전체 글자 유지',()=> {
 // 48d7d98 promiseVerdictText(1993~), perDayText·gridDeltaText의 식으로 독립 생성.
 const c=comparison(2.5,3.5486), level='3.5 MWh/일';
 assert.equal(call('promiseVerdictText',c,note),`계통 예측: 늘 것 / 실제 결과: 시험 1주 대비 늘어남(하루 평균 +1.0 MWh/일 변화) · 예상과 같음(이번 달 하루 평균 ${level} · 월 합계 110 MWh · 월 비용 약 12.3억)`);
}); // 기준판 공개 함수 없음
 test('N5 #55 비교 없음 1자리',()=> {
 const c=comparison(1,1); c.grid={perDay:1,deltaPerDay:null,base:{label:'비교 없음(첫 결과)'}};
 assert.equal(call('promiseVerdictText',c,note),'계통 예측: 늘 것 / 실제 결과: 이번 달 하루 평균 1 MWh/일(비교 없음(첫 결과))');
}); // 기준판 공개 함수 없음
const items=names=>names.map((name,i)=>({t:'fixture',i:10+i,name}));
const nameRows=[[[], ''],[['디젤'],fill('Q1',{목록:'디젤'})],[['태양광','태양광','디젤'],fill('Q1',{목록:'태양광 2기, 디젤'})],
 [['디젤','태양광','태양광','풍력','바이오매스'],fill('Q1',{목록:'디젤, 태양광 2기, 풍력 '+fill('Q2',{n:1})})],
 [['가','나','다','라','마','바'],fill('Q1',{목록:'가, 나, 다 '+fill('Q2',{n:3})})]];
for(const [names,expected] of nameRows) test(`N6 #33 이름 ${names.length}기`,()=>assert.equal(call('issueNamesLine',items(names)),expected)); // 기준판 함수 없음
test('N6 #33 남은 1묶음 2기',()=>assert.equal(call('issueNamesLine',items(['디젤','태양광','풍력','바이오매스','바이오매스'])),fill('Q1',{목록:'디젤, 태양광, 풍력 '+fill('Q2',{n:2})}))); // 48d7d98 공개 함수 없음; 1124308 통과(남은 기 수 계약 보강)
test('N6 #33 남은 2묶음 3기',()=>assert.equal(call('issueNamesLine',items(['가','나','다','라','라','마'])),fill('Q1',{목록:'가, 나, 다 '+fill('Q2',{n:3})}))); // 48d7d98 공개 함수 없음; 1124308 통과(남은 기 수 계약 보강)
for(const n of [0,1,2,4,5,6]) test(`N7 #33 표지 ${n}기`,()=> {
 const input=items(Array.from({length:n},(_,i)=>`가상${i}`));
 assert.deepEqual(plain(call('issueMarks',input)),input.slice(0,4).map(x=>({tile:x.i,text:x.name})));
}); // 기준판 함수 없음
const widthModels = [
 {id:'가 UTF-16',width:name=>name.length*13+4},
 {id:'나 글자별',width:name=>Array.from(name).reduce((n,ch)=>n+(/\p{Extended_Pictographic}/u.test(ch)?16:/\s/u.test(ch)?4:12),0)}
];
function previewStates() {
 const ids=Array.from(ctx.KCP.leagueCore.regionOf('south').teams,t=>t.id),lobby=[],seat=[];
 const subset=(pool,mask)=>pool.filter((_,i)=>mask&(1<<i));
 for(let mask=0;mask<64;mask++)lobby.push({mode:'host',player:null,active:subset(ids,mask),taken:[]});
 lobby.push({mode:'join',player:null,active:ids,taken:[]});
 for(const player of ids)for(let mask=0;mask<32;mask++)
  lobby.push({mode:'solo',player,active:[player,...subset(ids.filter(id=>id!==player),mask)],taken:[]});
 for(const player of [null,...ids])for(let code=0;code<3**6;code++) {
  const active=[],taken=[];
  ids.forEach((id,i)=>{const status=Math.floor(code/3**i)%3;if(status)active.push(id);if(status===1)taken.push(id);});
  if(player&&!active.includes(player))continue;
  seat.push({mode:'seat',player,active,taken});
 }
 return {lobby,seat};
}
const previewGeometry=new Map();
function previewAnchors(w,h) {
 const key=`${w}x${h}`;
 if(previewGeometry.has(key))return previewGeometry.get(key);
 const R=ctx.KCP.leagueCore.regionOf('south'),B=R.board,sums={};
 // 48d7d98 league.js boardInfo 4636~4650 / renderBoard 4663~,4785~4801.
 B.rows.forEach((row,r)=>[...row].forEach((_,c)=>{const id=B.letters[B.own[r][c]]; if(!id)return;
 const s=sums[id]||=[0,0,0];s[0]+=Math.sqrt(3)*(c+.5*(r&1))+Math.sqrt(3)/2;s[1]+=1.5*r+1;s[2]++;}));
 const gw=Math.sqrt(3)*(B.cols+.5),gh=1.5*(B.rows.length-1)+2,k=Math.min(w/gw,h/gh),ox=(w-gw*k)/2,oy=(h-gh*k)/2;
 const anchors=Object.fromEntries(Object.entries(sums).map(([id,s])=>[id,{ax:ox+s[0]/s[2]*k,ay:oy+s[1]/s[2]*k}]));
 previewGeometry.set(key,anchors);
 return anchors;
}
function preview(w,h,state,model=widthModels[0]) {
 const R=ctx.KCP.leagueCore.regionOf('south'),anchors=previewAnchors(w,h);
 // 항등 배치 근거의 기존 구성은 유지한다. 전수 구성은 개정 1과 기준판 부가 글자 식만 쓴다.
 state ||= {mode:'solo',player:R.teams[0].id,active:[R.teams[0].id,R.teams[1].id],taken:[]};
 return Array.from(R.teams,t=>{
 const active=state.active.includes(t.id),inactive=state.mode==='seat'&&!active,
 own=!inactive&&t.id===state.player,locked=state.mode!=='seat'&&(R.must||[]).includes(t.id),taken=state.taken.includes(t.id);
 const sub=state.mode==='seat'?(inactive?'이번 방 아님':taken?'다른 팀':own?'고른 도시':'비어 있음'):
  own?'내 도시':!active?'제외':state.mode==='solo'?'컴퓨터':'참가 도시';
 const name=(locked?'🔒 ':'')+t.name;
 return {id:t.id,...anchors[t.id],w:Math.max(model.width(name),sub.length*10)+32,h:sub?43:29,priority:own?2:locked?1:0};});
}
const collisions=rows=>rows.reduce((n,a,i)=>n+rows.slice(i+1).filter(b=>a.x<b.x+b.w+2&&b.x<a.x+a.w+2&&a.y<b.y+b.h+2&&b.y<a.y+a.h+2).length,0);
const distance=a=>Math.hypot(Math.max(a.x-a.ax,0,a.ax-a.x-a.w),Math.max(a.y-a.ay,0,a.ay-a.y-a.h));
test('N8 기준 항등 배치 교차 ≥ 1쌍',()=>assert.ok(collisions(preview(370,210).map(a=>({...a,x:a.ax-a.w/2,y:a.ay-21})))>=1));
// 개정 1: 모형별 lobby 257 + seat 3645 + 넓은 lobby 257 = 총 8318회 공개 API 호출.
const previewStarted=performance.now(),states=previewStates();
function previewFailures(model,scenarios,w,h,wide=false) {
 const checks=wide?{unmoved:(out,input)=>out.length===input.length&&out.every(a=>a.moved===false)}:{
  clear:out=>collisions(out)===0,
  inside:out=>out.every(a=>a.w>0&&a.h>0&&a.x>=0&&a.y>=0&&a.x+a.w<=w&&a.y+a.h<=h),
  distance:out=>out.every(a=>!a.moved||distance(a)<=64),
  preserved:(out,input,expected)=>{
   assert.deepEqual(input,expected); // 순수 함수: 호출자 입력도 바꾸지 않는다.
   assert.deepEqual(out.map(a=>a.id).sort(),expected.map(a=>a.id).sort());
   return out.every(a=>{const b=expected.find(b=>b.id===a.id);return b&&['w','h','ax','ay'].every(k=>a[k]===b[k])&&typeof a.moved==='boolean';});
  }
 },first={};
 for(const state of scenarios) {
  const label=`mode=${state.mode} player=${state.player??'없음'} participants=${JSON.stringify(state.active)} taken=${JSON.stringify(state.taken)} model=${model.id}`;
  let input,expected,out;
  try {
   input=preview(w,h,state,model);expected=plain(input);
   out=plain(call('previewLabelLayout',input,{w,h},{gap:2}));
   assert.ok(Array.isArray(out),'배열 출력 필요');
  } catch(e) {
   for(const key of Object.keys(checks))first[key] ||= `${label}: ${e.message.split('\n')[0]}`;
   continue;
  }
  for(const [key,check] of Object.entries(checks))try {
   if(!check(out,input,expected))first[key] ||= label;
  } catch(e) {first[key] ||= `${label}: ${e.message.split('\n')[0]}`;}
 }
 return first;
}
for(const model of widthModels) {
 for(const [group,w,h] of [['lobby',370,210],['seat',368,308]]) {
  let first;
  for(const [key,label] of [['clear','교차 0 (2px)'],['inside','캔버스 안'],['distance','moved 거리 ≤64'],['preserved','입력 보존']])
   test(`N8 #74-6 ${model.id} ${w}×${h} ${group} ${label}`,()=>{
    first ||= previewFailures(model,states[group],w,h);
    assert.ok(!first[key],first[key]);
   });
 }
 test(`N8 #74-6 ${model.id} 1180×600 host·join·solo 모두 원위치`,()=>{
  const first=previewFailures(model,states.lobby,1180,600,true);
  assert.ok(!first.unmoved,first.unmoved);
 });
}
console.log(`INFO N8 전수 lobby ${states.lobby.length} seat ${states.seat.length} 두 모형 ${((performance.now()-previewStarted)/1000).toFixed(3)}s`);
for(const [label,input,expected] of [
 ['row 경계',{rowArea:400,pagedArea:200,mapArea:1000},'row'],['paged',{rowArea:401,pagedArea:400,mapArea:1000},'paged'],
 ['strip',{rowArea:401,pagedArea:401,mapArea:1000},'strip'],['row 넘침',{rowArea:200,pagedArea:300,mapArea:1000,rowOverflow:true},'paged'],
 ['paged 넘침',{rowArea:401,pagedArea:300,mapArea:1000,pagedOverflow:true},'strip'],['지도 0',{rowArea:0,pagedArea:0,mapArea:0},'strip'],['지도 NaN',{rowArea:0,pagedArea:0,mapArea:NaN},'strip']])
 test(`N9 #74-3 ${label}`,()=>assert.equal(fxCall({...input,cap:.4}),expected)); // 기준판 함수 없음
test('N9b 공개 fxTurn.DECK_NARROW_MIN = 600',()=>{
 assert.ok(fx&&Object.hasOwn(fx,'DECK_NARROW_MIN'),'BLOCKED 공개 fxTurn.DECK_NARROW_MIN 없음');
 assert.equal(fx.DECK_NARROW_MIN,600);
}); // 48d7d98·1124308 공개 상수 없음
for(const [label,input,expected] of [
 ['compact 경계',{rowArea:0,pagedArea:400},'compact'], // 48d7d98 공개 함수 없음; 1124308 narrow 무시 → row
 ['compact 초과',{rowArea:0,pagedArea:401},'strip'], // 48d7d98 공개 함수 없음; 1124308 narrow 무시 → row
 ['row 무시',{rowArea:100,pagedArea:500},'strip'], // 48d7d98 공개 함수 없음; 1124308 narrow 무시 → row
 ['compact 넘침',{rowArea:0,pagedArea:100,pagedOverflow:true},'strip'], // 48d7d98 공개 함수 없음; 1124308 narrow 무시 → row
 ['지도 0',{rowArea:0,pagedArea:0,mapArea:0},'strip'] // 48d7d98 공개 함수 없음; 1124308 통과(지도 0 계약 유지)
]) test(`N9b #74-3 좁은 자리 ${label}`,()=>assert.equal(fxCall({mapArea:1000,...input,narrow:true,cap:.4}),expected)); // 48d7d98 BLOCKED; 1124308 위 표별 사유

// test-fx-turn-audio.js의 최소 DOM·가짜 시계. 사각형은 명세 P1~P4만 주입한다.
// scrollHeight/clientHeight는 제공하지 않는다(명세 #74-3: 최소 DOM의 넘침 판정은 만족).
function placedDeck(width,height,panelRect) {
 const elements=[],timers=new Map(),frames=new Map(),listeners={};
 let clock=0,serial=0,replay,layoutFrames=0;
 class Element {
  constructor(tag) {
   this.tagName=tag;this.className='';this.dataset={};this.children=[];this.listeners={};
   this.style={setProperty(k,v){this[k]=v;},removeProperty(k){delete this[k];}};
   this.classList={contains:name=>this.className.split(' ').includes(name),add:name=>{this.className+=' '+name;}};
   elements.push(this);
  }
  get isConnected(){return this===root||!!this.parent?.isConnected;}
  append(...nodes){nodes.forEach(n=>{n.parent=this;this.children.push(n);});}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;}
  contains(n){return n===this||this.children.some(c=>c.contains(n));}
  setAttribute(k,v){this[k]=v;}
  getBoundingClientRect(){return this.rect||{left:0,top:0,right:width,bottom:height,width,height};}
  getClientRects(){return this.isConnected&&!this.hidden?[this.getBoundingClientRect()]:[];}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  querySelectorAll(selector){
   const selectors=selector.split(',').map(s=>s.trim());
   return elements.filter(n=>n!==this&&this.contains(n)&&selectors.some(s=>
    s.startsWith('.')?n.classList.contains(s.slice(1)):s.startsWith('#')?n.id===s.slice(1):n.tagName===s));
  }
  addEventListener(name,fn){(this.listeners[name]||=[]).push(fn);}
  removeEventListener(name,fn){this.listeners[name]=(this.listeners[name]||[]).filter(f=>f!==fn);}
 }
 const root=new Element('main');root.id='bd-root';root.className='lg-team-map';
 const stage=new Element('div');stage.className='bd-stage';stage.rect={left:0,top:0,right:width,bottom:height,width,height};root.append(stage);
 const panel=new Element('aside');panel.id='lg-panel';panel.rect=panelRect;root.append(panel);
 const add=(name,fn)=>{(listeners[name]||=[]).push(fn);};
 const remove=(name,fn)=>{listeners[name]=(listeners[name]||[]).filter(f=>f!==fn);};
 const document={documentElement:new Element('html'),createElement:tag=>new Element(tag),
  querySelector:selector=>selector==='.lg-team-map'?root:root.querySelector(selector),
  querySelectorAll:selector=>root.querySelectorAll(selector),getElementById:id=>root.querySelector('#'+id),
  addEventListener:(name,fn)=>add('doc:'+name,fn),removeEventListener:(name,fn)=>remove('doc:'+name,fn)};
 const KCP={v2:{reduced:()=>false},leagueCore:{replayOf:()=>({res:{},source:'engine'})},
  buildGame:{skipReplay(){},replayMonth(res,options){replay=options;return true;}}};
 const window={KCP,innerWidth:width,innerHeight:height,addEventListener:add,removeEventListener:remove};
 class Observer{observe(){} disconnect(){}}
 window.ResizeObserver=window.MutationObserver=Observer;
 vm.runInNewContext(read('ui/fx-turn.js'),{window,document,performance:{now:()=>clock},
  ResizeObserver:Observer,MutationObserver:Observer,
  requestAnimationFrame(fn){const key=++serial;frames.set(key,fn);return key;},cancelAnimationFrame:key=>frames.delete(key),
  setTimeout(fn,ms){const key=++serial;timers.set(key,{at:clock+ms,fn});return key;},clearTimeout:key=>timers.delete(key)}, {timeout:10000});
 const api=KCP.fxTurn;
 assert.equal(typeof api?.monthEnd,'function','BLOCKED 공개 fxTurn.monthEnd 없음');
 assert.equal(typeof api?.state,'function','BLOCKED 공개 fxTurn.state 없음');
 const options={round:1,team:'fake-city',monthLabel:'1월',result:{team:{'fake-city':{unsPct:0}}},
  cards:[{tag:'결산',title:'1월',body:'가상 결산',big:'확정'},
   ...[1,2].map(n=>({id:`fake-event-${n}`,tag:'사건',title:`가상 사건 ${n}`,body:'가상 사건 자료',big:'확정'}))],summary:[],hud:[]};
 assert.equal(api.monthEnd(options),true);
 assert.equal(typeof replay?.onDone,'function','BLOCKED 결과 재생 완료 콜백 없음');
 replay.onDone();
 // 기존 검사와 같은 6700ms: 요약 6초·카드 세 장 등장 뒤, 자동 닫힘 전.
 while(true){
  const next=[...timers].filter(([,t])=>t.at<=6700).sort((a,b)=>a[1].at-b[1].at)[0];
  if(!next)break;
  timers.delete(next[0]);clock=next[1].at;next[1].fn();
 }
 clock=6700;
 assert.equal(api.state().cardsOpen,true,'결과 카드가 열린 상태 필요');
 assert.equal(root.querySelectorAll('.fx-turn-card').length,3,'결산 + 가상 사건 2장 필요');
 (listeners.resize||[]).forEach(fn=>fn());
 const pending=[...frames.values()];frames.clear();
 pending.forEach(fn=>{fn(clock);layoutFrames++;});
 assert.ok(layoutFrames>0,'resize 뒤 배치 rAF 실행 필요');
 const layer=root.querySelector('.fx-turn-layer');assert.ok(layer,'결과 덧층 필요');
 const rect=Object.fromEntries(['left','top','width','height'].map(k=>[k,parseFloat(layer.style[k])]));
 assert.ok(Object.values(rect).every(Number.isFinite),'덧층 style 사각형 유한값 필요');
 return {data:{...layer.dataset},...rect,right:rect.left+rect.width};
}
for(const [label,width,height,panelLeft,panelTop] of [
 ['P1',820,1180,452,60], // 48d7d98 통과(기존 compact 계약); 1124308 compact=false
 ['P2',768,1024,400,60], // 48d7d98 통과(기존 compact 계약); 1124308 compact=false
 ['P3',780,440,412,8], // 48d7d98 상한 없이 compact → strip=false; 1124308 통과
 ['P4',1280,900,912,60] // 48d7d98·1124308 통과(넓은 자리 유지)
]) test(`N9b #74-3 place ${label}`,()=>{
 const placed=placedDeck(width,height,{left:panelLeft,right:width-8,top:panelTop,bottom:height-8});
 console.log(`INFO N9b place ${label} ${JSON.stringify(placed)}`);
 if(label==='P3')assert.equal(placed.data.strip,'true');
 else {
  assert.equal(placed.data.compact,label==='P4'?'false':'true');
  assert.equal(placed.data.strip,'false');
  // 개정 2-1: 좁은 자리(P1·P2)와 넓은 자리(P4) 모두 paged 'false'. P4는 세 장 한 줄(약 0.28 ≤ 0.40)이라 한 장 폭(368)보다 넓다.
  assert.equal(placed.data.paged,'false');
  if(label==='P4')assert.ok(placed.width>368,`넓은 자리 폭 ${placed.width} >368`);
  else {
   assert.ok(placed.width<=368,`폭 ${placed.width} ≤368`);
   assert.ok(placed.right<=panelLeft-8,`오른쪽 ${placed.right} ≤${panelLeft-8}`);
   assert.ok(placed.left>=8,`왼쪽 ${placed.left} ≥8`);
  }
 }
}); // 48d7d98·1124308 위 P별 사유(기대값은 개정 2-1)

test('N14 공개 uiMath.gridFillHTML',()=>assert.equal(typeof ctx?.KCP?.league?.uiMath?.gridFillHTML,'function','BLOCKED 공개 uiMath.gridFillHTML 없음')); // 48d7d98·1124308 공개 함수 없음
for(const [label,firstOwn,secondOwn,expected] of [
 ['2자리 달',7,3.5486*7,'3.55 MWh/일'], // 48d7d98·1124308 공개 없음(비공개 기존 dd는 3.5)
 ['1자리 달',17.5,3.5486*7,'3.5 MWh/일'], // 48d7d98·1124308 공개 없음(기존 글자 유지)
 ['0.05 미만',7,.21,''] // 48d7d98·1124308 공개 없음(기존 칸 생략 유지)
]) test(`N14 #55 결과 dd ${label}`,()=>{
 const C=ctx.KCP.leagueCore,ids=Array.from(C.regionOf('south').teams).slice(0,2).map(t=>t.id),id=ids[0];
 const V=C.newState('REV17-FAKE','south',0,ids,{turns:12,seedMode:'fixed'});
 V.results=[firstOwn,secondOwn].map((own,index)=>({...V.rounds[index],round:index+1,days:7,
  team:{[id]:{uns:0,imp:0,sub:0,isolated:{uns:own},unsPct:0,co2Cons:0,co2Prod:0}}}));
 const html=call('gridFillHTML',V,V.results[1],id);
 const dd=html.match(/<dt>계통이 메운 전기<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/);
 assert.equal(dd?dd[1].replace(/<[^>]*>/g,'').trim():'',expected);
}); // 48d7d98·1124308 공개 함수 없어 BLOCKED(개정 2-4(a))
// 중괄호 짝으로 함수·CSS 블록을 추출. CSS 문자열/주석의 괄호는 깊이에 넣지 않는다.
function blocks(source) {
 const out=[],stack=[];let start=0,quote=null,comment=false;
 for(let i=0;i<source.length;i++) {const c=source[i],n=source[i+1];
 if(comment){if(c==='*'&&n==='/'){comment=false;i++;start=stack.length?start:i+1;}continue;}
 if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote=null;continue;}
 if(c==='/'&&n==='*'){comment=true;i++;continue;}if(c==='"'||c==="'"){quote=c;continue;}
 if(c==='{'){stack.push({head:source.slice(start,i).trim(),begin:i+1});start=i+1;}
 else if(c==='}'){const s=stack.pop();if(s)out.push({head:s.head,body:source.slice(s.begin,i)});start=i+1;}
 else if(c===';')start=i+1;
 }return out;
}
test('N10 #74-5 M1 정확히 1회',()=>assert.equal(read('ui/fx-turn.js').split(COPY.M1).length-1,1)); // 48d7d98·1124308 개정 2-2 확정 전 문구
 test('N10 #74-5 ui 옛 문구 0',()=> {
 const walk=dir=>fs.readdirSync(path.join(ROOT,dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):e.isFile()?[dir+'/'+e.name]:[]);
 assert.deepEqual(walk('ui').filter(f=>read(f).includes('지도 분위기는 사건 표시용')),[]);
}); // 기준판 옛 글 있음
 test('N10 분위기 합성 alpha 유지',()=> {
 const src=read('ui/build.js'),begin=src.indexOf('function paintMapMood(');assert.ok(begin>=0);
 const body=blocks(src.slice(begin)).find(b=>b.head.startsWith('function paintMapMood('));assert.ok(body);
 assert.equal((body.body.match(/g\.globalAlpha\s*=\s*0\.06\b/g)||[]).length,1);
});
test('N11 #76-2 사건 출처·등급·효과',()=> {
 const E=ctx.KCP.leagueCore.eventDef(ctx.KCP.leagueCore.regionOf('south'),'spring_dust_haze');
 const sources=['https://www.seoul.co.kr/news/2019/05/01/20190501500031','https://doi.org/10.1088/1748-9326/ab905b'];
 assert.deepEqual(plain(E.sources),sources); // 기준판 기사 하나뿐
 // 48d7d98 league.js externalLinks(1137~1140)의 정규식 그대로.
 assert.ok(sources.every(s=>/^https?:\/\/[^\s]+$/.test(s)));
 assert.equal(E.grade,'P');assert.deepEqual(plain(E.effect),{solarMul:.85});assert.ok(E.gradeNote.includes('[P58]'));
});
test('N11 #76-2 V26 두 행 sources 2개',()=> {
 const rows=read('docs/EXPLAIN-AUDIT-model.md').split('\n').filter(s=>s.includes('spring_dust_haze')&&s.includes('V26'));
 assert.equal(rows.length,2);assert.ok(rows.every(s=>s.includes('sources 2개')));
}); // 기준판 sources 1개
 test('N12 #76-1 관찰 절·재현·표·경로',()=> {
 const src=read('docs/ECON-BALANCE.md'),heads=[...src.matchAll(/^## rev17 관찰: 안성.*$/gm)];assert.equal(heads.length,1);
 const tail=src.slice(heads[0].index+heads[0][0].length),section=tail.split(/^## /m)[0];
 assert.ok(section.includes('D73-measure.js'));assert.match(section,/^\|.*\|\s*\n\|\s*:?-{3,}/m);
 assert.doesNotMatch(src,/\/Users\/|~\//);
}); // 기준판 절 없음
function cssRule(media,selector,property,value) {
 const outer=blocks(read('ui/league.css')).filter(b=>b.head.startsWith('@media')&&b.head.includes(media));
 return outer.some(b=>blocks(b.body).some(r=>r.head.includes(selector)&&new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*${value}\\s*(?:;|$)`).test(r.body)));
}
 test('N13 #28 모바일 기준 줄 2행',()=>assert.ok(cssRule('(max-width: 760px)','#lg-promise-baseline','grid-row','2'))); // 기준판 4행
 test('N13 #29 모바일 계획 알림 bottom',()=>assert.ok(cssRule('(max-width: 760px)','#bd-toast[data-phase="plan"]','bottom','[^;]+'))); // 기준판 규칙 없음
console.log(`assertions ${assertions} failures ${failures}`);
process.exitCode=failures?1:0;
