// 검토 결함 8·15: 문구·태그 기대값은 요청 하나와 공통 습관 어휘로 갱신. 계산 허용 오차는 그대로 둔다.
// 기대값은 사용자 제공 수정 명세 5·6·8·12절에서만 옮겼다.
// 실행: node tests/model_s-riverdeal.mjs (전수 탐색도 기본 실행)
// 전수 탐색은 같은 파일을 worker_threads로 나눠 실행한다. 조항 28개를 번갈아 나누므로 탐색 영역은 그대로다.
// RD_SWEEP_WORKERS=1 이면 worker 하나로 순서대로 실행한다.
// N7: 직접 명령형까지 포함하고, 인용문 안의 물음은 요청에서 제외한다.
const requestCount = q => (q.replace(/“[^”]*”|‘[^’]*’/g, '').match(/[?？]|(?:주세요|[가-힣]+세요)[.!]/g) || []).length;
if (requestCount('말하세요. 적으세요! 설명하세요. 답은 무엇인가요?') !== 4 ||
    requestCount('“어떻게 하나요?”라는 반문에 답을 말해 주세요.') !== 1)
  throw new Error('N7 요청 수 검사 자체의 종결형·인용문 처리 실패');
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const source = fileURLToPath(new URL('../games/s-riverdeal.js', import.meta.url));
const KCP = {
  games: {}, YEARS: {}, ORIGINAL_ORDER: [],
  esc: s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  // app.js KCP.josa의 조사 규칙을 독립적으로 구현한다.
  josa(word, pair) {
    const w = String(word).trim(), code = w.charCodeAt(w.length - 1);
    const jong = code >= 0xAC00 && code <= 0xD7A3 ? (code - 0xAC00) % 28 : null;
    const endings = {'을/를':['을','를','을(를)'], '이/가':['이','가','이(가)'],
      '은/는':['은','는','은(는)'], '와/과':['과','와','과(와)'],
      '이고/고':['이고','고','이고'], '으로/로':['으로','로','(으)로']};
    const choices = Object.hasOwn(endings, pair) ? endings[pair] : null;
    return choices ? w + choices[jong === null ? 2 : jong && !(pair === '으로/로' && jong === 8) ? 0 : 1] : w;
  }
};
let total = 0, failures = 0;
function test(label, fn) {
  total++;
  try { fn(); } catch (e) { failures++; console.error(`실패 ${label}: ${e.message}`); }
}
const plain = x => JSON.parse(JSON.stringify(x));
function eq(actual, expected) {
  if (!isDeepStrictEqual(plain(actual), plain(expected)))
    throw new Error(`기대 ${JSON.stringify(expected)}, 실제 ${JSON.stringify(actual)}`);
}
function near(actual, expected, digits = 6) {
  if (expected === null) return eq(actual, null);
  // 표에 명시한 소수 여섯 자리의 반올림 오차만 허용한다.
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.5 * 10 ** -digits + 1e-12)
    throw new Error(`기대 ${expected} (±${0.5 * 10 ** -digits}), 실제 ${actual}`);
}
try {
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), {window: {KCP}}, {filename: source});
} catch (e) { console.error(`실패 모듈 로드: ${e.stack}`); process.exit(1); }
const game = KCP.games['s-riverdeal'], m = game?.model;
if (!m) { console.error('실패 공개 model 없음'); process.exit(1); }
for (const name of ['simulate','evaluate','response','doSat','masksFromDecisions','questionKeys'])
  test(`API ${name}`, () => eq(typeof m[name], 'function'));

const K = 1e6 / (90 * 86400), EPS = 1e-9;
const orders = {proportional:null, agFirst:['ag','city','env'], cityFirst:['city','env','ag'], envFirst:['env','ag','city']};
const parties = ['dam','ag','city','eco'];
const names = ['은여울댐 공사','들녘 농민조합','여울시 상수도사업소','하구 어민·생태 단체'];
const plan = (ag,city,env,f=0,save=false,link=false,pulse=false,order='proportional') => ({ag,city,env,f,save,link,pulse,order});
// 12.4-7 전수 탐색 한 조각: 유효 조항 조합 가운데 index%parts===part인 것만 계산한다.
// 건조 감량은 공사의 공통 조건이므로 순서와 무관한 shortage만 전달한다.
// 평년 감량이 없으면 네 순서의 평년·습윤 결과가 같아 4배로 집계한다.
// 평년 감량이 있으면 네 순서를 모두 실제 계산한다. 탐색 영역은 축소하지 않는다.
function sweepPart(part,parts) {
  const hn=new Array(256).fill(0),hw=new Array(256).fill(0),bits=a=>a.reduce((v,s,i)=>v|(s==='accept'?1<<i:0),0);
  let count=0,clauses=0,index=-1,maxSevere=0;
  function histogram(p,dry,rn,rw,mult) {
    hn[bits(m.response(rn,dry,0))*16+bits(m.response(rn,dry,15))]+=mult;
    hw[bits(m.response(rw,dry,0))*16+bits(m.response(rw,dry,15))]+=mult;
    // 평년 심각 미달 당사자 수(기준 상승과 무관). 개별 질문 3자리 보장의 근거.
    const sev=m.severe(rn).filter(Boolean).length;if(sev>maxSevere)maxSevere=sev;
    count+=mult;
  }
  for(const f of [0,.1,.2,.3])for(const save of [false,true])for(const link of [false,true])for(const pulse of [false,true]) {
    if(150*f+5*Number(save)+25*Number(link)>60)continue;
    if(++index%parts!==part)continue;
    clauses++;
    for(let ag=0;ag<=80;ag++)for(let city=0;city<=80;city++)for(let env=0;env<=80;env++) {
      const p=plan(ag,city,env,f,save,link,pulse),rp=ag+city+env+(pulse?4:0);
      const dry={shortage:Math.max(0,rp-(99+(link?10:0)))};
      const normalCuts=rp>139+(link?10:0),wetCuts=rp>184+(link?10:0);
      const rn=m.simulate(p,55),rw=m.simulate(p,100);
      if(!normalCuts)histogram(p,dry,rn,rw,4);
      else for(const order of Object.keys(orders)) {
        p.order=order;
        histogram(p,dry,order==='proportional'?rn:m.simulate(p,55),wetCuts&&order!=='proportional'?m.simulate(p,100):rw,1);
      }
    }
  }
  return {hn,hw,count,clauses,maxSevere};
}
if(!isMainThread) parentPort.postMessage(sweepPart(workerData.part,workerData.parts));
else {
const plans = {
  Z:plan(0,0,0), X:plan(80,80,80,0,false,false,true,'envFirst'),
  N:plan(50,35,20), D:plan(50,35,20), L:plan(43,33,15,.2,true,false,true),
  E:plan(37,31,28,.3,true), F:plan(30,21,12,0,false,false,false,'agFirst'),
  T:plan(42,36,0,.2,false,true), C:plan(50,35,0)
};
// 6절의 모든 열. 순서는 아래 fields와 동일하다. null을 0으로 치환하지 않는다.
const fields = ['cost','Rplan','rawEnd','shortage','v.ag','v.city','v.env','cut.ag','cut.city','cut.env','pulseActual','R','end',
  'needAg','ratioAg','Y','income','needCity','supply','Vc','L','C',
  'Qdam','Qc','Ve','Qe','T','sat','consumption','doRaw','DO','H','MWh'];
const table = {
  Z:[0,0,179,0,0,0,0,0,0,0,0,0,179,55,0,0,0,36,0,0,20,null,0,0,0,0,30,7.6,null,null,null,37.175,0],
  X:[0,244,-65,105,59,80,0,21,0,84,0,139,40,55,1,1,1,36,1,94.75,49.5,.522427,17.875514,12.184928,38.75,4.983282,25.016718,8.297659,3.174194,5.123466,5.123466,26.75,8603.617361],
  N:[0,105,74,0,50,35,20,0,0,0,0,105,74,55,.909091,.890909,.890909,36,.972222,67.5,45,.666667,13.503086,8.680556,43,5.529835,24.470165,8.384774,2.337209,6.047564,6.047564,29.3,7118.679167],
  D:[0,105,34,6,47.142857,33,18.857143,2.857143,2,1.142857,0,99,40,55,.857143,.828571,.828571,36,.916667,63.642857,43.571429,.684624,12.731481,8.184524,40.542857,5.213845,24.786155,8.334215,2.393587,5.940628,5.940628,26.75,6127.75625],
  L:[35,95,84,0,43,33,19,0,0,0,4,95,84,44,.977273,.972727,.898182,32.4,1,62.75,41.5,.661355,12.217078,8.069702,39.65,5.099023,24.900977,8.315844,2.343001,5.972842,5.972842,30.05,6605.574306],
  E:[50,96,83,0,37,31,28,0,0,0,0,96,83,38.5,.961039,.953247,.847273,32.4,.95679,68.25,38.5,.564103,12.345679,8.777006,46.55,5.986368,24.013632,8.457819,1.853921,6.603898,6.603898,29.975,6658.446667],
  F:[0,63,116,0,30,21,12,0,0,0,0,63,116,55,.545455,.454545,.454545,36,.583333,40.5,35,.864198,8.101852,5.208333,25.8,3.317901,26.682099,8.064506,2.957364,5.107142,5.107142,32.45,4730.39875],
  T:[55,78,111,0,42,36,0,0,0,0,0,78,111,44,.954545,.945455,.876364,36,1,46.5,41,.88172,10.030864,5.979938,21.3,2.739198,27.260802,7.983488,4.356808,3.62668,3.62668,32.075,5789.002917],
  C:[0,85,94,0,50,35,0,0,0,0,0,85,94,55,.909091,.890909,.890909,36,.972222,47.5,45,.947368,10.93107,6.108539,23,2.957819,27.042181,8.014095,4.369565,3.644529,3.644529,30.8,6057.761111]
};
const reactions = {
  Z:['accept','reject','reject','reject'], X:['reject','accept','accept','accept'],
  N:['reject','accept','accept','accept'], D:['reject','conditional','conditional','accept'],
  L:['conditional','accept','accept','accept'], E:['conditional','conditional','accept','accept'],
  F:['accept','reject','reject','conditional'], T:['accept','accept','accept','reject'], C:['conditional','accept','conditional','reject']
};
for (const [id,p] of Object.entries(plans)) {
  const r = m.simulate(p, id === 'D' ? 15 : 55), dry = m.simulate(p,15);
  fields.forEach((field,i) => test(`6 ${id} ${field}`, () => near(field.split('.').reduce((a,k)=>a[k],r),table[id][i])));
  test(`6 ${id} 반응`, () => eq(m.response(r,dry,0),reactions[id]));
  test(`6 ${id} 펄스 완전 이행`, () => eq(r.pulseEffective,id==='L'));
}

// 독립 oracle: 5.2절 규범식을 그대로 옮겼으며 구현 결과를 참조하지 않는다.
function sat(t) {
  const rows = [[0,14.6],[10,11.3],[20,9.1],[25,8.3],[30,7.6]];
  t=Math.max(0,Math.min(30,t));
  for(let i=1;i<rows.length;i++) if(t<=rows[i][0]) {
    const [x,y]=rows[i-1], [x1,y1]=rows[i]; return y+(y1-y)*(t-x)/(x1-x);
  }
  return 7.6;
}
function simulate(p,inflow) {
  const cost=150*p.f+5*Number(p.save)+25*Number(p.link);
  const req={ag:p.ag,city:p.city,env:p.env+(p.pulse?4:0)}, Rplan=req.ag+req.city+req.env;
  const rawEnd=130+inflow+(p.link?10:0)-6-Rplan, shortage=Math.max(0,40-rawEnd), v={...req};
  if(shortage>0) {
    if(p.order==='proportional') for(const k of ['ag','city','env']) v[k]*=(Rplan-shortage)/Rplan;
    else {let rem=shortage; for(const k of orders[p.order]) {const d=Math.min(rem,v[k]);v[k]-=d;rem-=d;}}
  }
  const cut={ag:req.ag-v.ag,city:req.city-v.city,env:req.env-v.env};
  const pulseActual=p.pulse?Math.max(0,4-cut.env):0, pulseEffective=!!p.pulse&&pulseActual>=4-EPS;
  const R=v.ag+v.city+v.env, end=130+inflow+(p.link?10:0)-6-R;
  const needAg=55*(1-p.f), ratioAg=Math.min(1,v.ag/needAg), Y=Math.max(0,1-1.2*(1-ratioAg));
  const income=(1-p.f)*Y+p.f*.6,needCity=36*(p.save?.9:1),supply=Math.min(1,v.city/needCity);
  const Vc=v.city+v.env+.25*v.ag,L=.5*v.ag+20,C=Vc>0?L/Vc:null;
  const Ve=v.env+.25*v.ag+.30*v.city,Qe=Ve*K,T=30-6*Math.min(1,Qe/6),s=sat(T);
  const consumption=Ve>0?2*(L+.15*v.city)/Ve:null,doRaw=Ve>0?s-consumption:null,DO=doRaw===null?null:Math.max(0,doRaw);
  const H=20+.15*((130+end)/2-40),MWh=1000*9.8*H*R*1e6*.85/3.6e9;
  return {cost,req,Rplan,rawEnd,shortage,v,cut,pulseActual,pulseEffective,R,end,needAg,ratioAg,Y,income,needCity,supply,Vc,Qc:Vc*K,L,C,Ve,Qe,T,sat:s,consumption,doRaw,DO,H,MWh,Qdam:R*K};
}
function response(r,dry,mask=0) {
  const up=i=>(mask>>i)&1;
  const checks=[[r.end>=110+up(0)-EPS,dry.shortage<=EPS],[r.income>=.85+.01*up(1)-EPS],
    [r.supply>=.95+.01*up(2)-EPS,r.C!==null&&r.C<=.90-.01*up(2)+EPS],
    [r.Qe>=(r.pulseEffective?3:4)+.1*up(3)-EPS,r.DO!==null&&r.DO>=5+.1*up(3)-EPS]];
  const severe=[r.end<80-EPS,r.income<.70-EPS,r.supply<.85-EPS||(r.C!==null&&r.C>1+EPS),
    r.Qe<(r.pulseEffective?2:3)-EPS||(r.DO!==null&&r.DO<4-EPS)];
  return checks.map((a,i)=>{const n=a.filter(x=>!x).length;return !n?'accept':n>=2||severe[i]?'reject':'conditional';});
}
function evaluate(p,mask=0) {
  const dry=simulate(p,15);
  return Object.fromEntries([['dry',dry],['normal',simulate(p,55)],['wet',simulate(p,100)]].map(([k,r])=>[k,{...r,responses:response(r,dry,mask)}]));
}
for (const t of [-10,0,5,10,15,20,22.5,25,27.5,30,40]) test(`5 DO_sat ${t}`,()=>near(m.doSat(t),sat(t),12));
for(const [id,p] of Object.entries(plans)) for(let mask=0;mask<16;mask++) {
  const expected=evaluate(p,mask), actual=m.evaluate(p,mask);
  for(const sc of ['dry','normal','wet']) {
    test(`5 ${id}/${mask}/${sc} 판정`,()=>eq(actual[sc].responses,expected[sc].responses));
    test(`5 ${id}/${mask}/${sc} 물 수지`,()=> {
      const r=actual[sc],inflow={dry:15,normal:55,wet:100}[sc];
      near(r.end+r.R,130+inflow+(p.link?10:0)-6,9);
      near(r.Ve+.75*r.v.ag+.70*r.v.city,r.R,9);
    });
  }
}
const nScenarios={dry:[34,6,40,reactions.D],normal:[74,0,74,reactions.N],wet:[119,0,119,['conditional','accept','accept','accept']]};
for(const [s,[rawEnd,shortage,end,responses]] of Object.entries(nScenarios)) test(`6 N ${s} 전망표`,()=> {
  const r=m.evaluate(plans.N,0)[s];eq([r.rawEnd,r.shortage,r.end,r.responses],[rawEnd,shortage,end,responses]);
});
test('6 L 습윤 합의',()=>eq(m.evaluate(plans.L,0).wet.responses,['accept','accept','accept','accept']));
test('6 T mask15',()=>eq(m.evaluate(plans.T,15).normal.responses,['accept','accept','accept','reject']));

// 12.3 심각 미달의 정확한 경계, EPS 안·밖, 상승과 무관한 경계.
const good={end:120,income:1,supply:1,C:.5,Qe:6,DO:7,pulseEffective:false};
for(const [key,bound,sign,index,extra] of [['end',80,-1,0,{}],['income',.70,-1,1,{}],['supply',.85,-1,2,{}],
  ['C',1,1,2,{}],['Qe',3,-1,3,{}],['Qe',2,-1,3,{pulseEffective:true}],['DO',4,-1,3,{}]])
  for(const offset of [0,.5*EPS,2*EPS]) for(const mask of [0,15]) test(`12.3-2 심각 ${key}/${bound}/${offset}/${mask}`,()=> {
    // 다른 기준은 충족시켜 심각 미달 하나만 분리한다.
    const r={...good,...extra,[key]:bound+sign*offset};
    eq(m.response(r,{shortage:0},mask)[index],offset>EPS?'reject':'conditional');
  });
test('12.3-1 음수 DO 제한',()=> {const r=m.simulate(plan(1,0,0),55);eq(r.DO,0);eq(r.doRaw<0,true);});

const reject=party=>({action:'reject',party,reason:'가상 기준을 유지한다.'});
const apply=party=>({action:'apply',party});
const histories=[
  [[reject('dam'),reject('dam')],{used:[0,0],next:1}],
  [[reject('dam'),reject('dam'),reject('dam')],{used:[0,0,1],next:1}],
  [[reject('dam'),apply('dam'),reject('dam')],{used:[0,0,0],next:0}],
  [[reject('dam'),reject('ag'),reject('dam')],{used:[0,0,0],next:0}],
  [[reject('dam'),null,reject('dam')],{used:[0,0,0],next:0}],
  [[reject('eco'),reject('eco'),null],{used:[0,0,8],next:8}]
];
histories.forEach(([ds,expected],i)=>test(`12.2-4 거절 이력 ${i+1}`,()=>eq(m.masksFromDecisions(ds.map(decision=>({decision}))),expected)));

function lockedState(p,mode='auto',human=null,rounds=null,mask=0) {
  const humanDefault=Object.fromEntries(parties.map(k=>[k,{status:'accept',line:''}]));
  const baseRound={n:1,proposal:plain(p),mask:0,human:mode==='role'?(human||humanDefault):null,decision:null};
  if(mode==='auto'&&evaluate(p).normal.responses.some(s=>s!=='accept'))
    baseRound.decision={id:'rd-r1-decision',...reject(parties[evaluate(p).normal.responses.findIndex(s=>s!=='accept')]),
      option:null,beforeP:plain(p),afterP:plain(p),beforeMask:0};
  const history=rounds||[baseRound];
  const final={mode:mode==='role'?'unanimous':'administrative',gain:'가상 공급을 지킨다.',loss:'가상 비축을 줄인다.',text:'가상 합의문이다.',hardDecisionId:history.filter(r=>r.decision).at(-1)?.decision.id||''};
  const L={version:'rd-v2',proposal:plain(p),mode,criterion:'가상 생활과 미래 부담을 비교한다.',mask,rounds:history,final};
  return {game:{version:'rd-v2',mode,tab:'basin',scenario:'normal',criterion:L.criterion,stage:'locked',proposal:plain(p),mask,
    rounds:plain(L.rounds),humanDraft:humanDefault,counter:null,final:plain(final),locked:L,previousLocked:null}};
}
// 8절 질문 규범. 문자열도 명세로부터 독립적으로 옮긴다.
function expectedQuestions(state) {
  const L=state.game?.locked;if(!L)return [];
  const E=evaluate(L.proposal,L.mask),N=E.normal,D=E.dry,W=E.wet,last=L.rounds.at(-1);
  const actual=L.mode==='role'?parties.map(k=>last.human[k].status):N.responses;
  const diss=names.filter((_,i)=>actual[i]!=='accept'),missing=i=>N.responses[i]!=='accept';
  const f=(x,d=3)=>x===null?'계산 불가':x.toFixed(d);
  const decisions=L.rounds.map(r=>r.decision).filter(Boolean),rejects=decisions.filter(d=>d.action==='reject');
  const latestReject=rejects.at(-1),hard=decisions.find(d=>d.id===L.final.hardDecisionId)||decisions.at(-1),applied=decisions.filter(d=>d.action==='apply').length;
  const hardText=hard?`${names[parties.indexOf(hard.party)]}의 역제안을 가장 다루기 어려운 요구로 골랐습니다. 이를 ${hard.action==='apply'?'반영':'거절'}했습니다.`:'이번 역할극에서는 역제안 처리 없이 동의가 모였습니다.';
  // 명세 8절: 가장 어려운 결정과 최신 거절이 같으면 당사자·거절 행동을 중복 서술하지 않는다.
  const rejectText=latestReject?` ${latestReject.id===hard?.id?"그때 거절 이유로":names[parties.indexOf(latestReject.party)]+"의 요구를 거절하며"} “${latestReject.reason}”라고 적었습니다.`:'';
  // N4·N6: 기준 먼저, 미래 비용·과학 추론 요청 및 실제 감량 선택 문안을 검증한다.
  const qs=[{k:'rd-c1',tag:'공통 1 · 기준 먼저 · 얻는 것과 잃는 것',q:'어떤 배분 기준을 앞세웠는지 먼저 밝히고, 이 안으로 얻는 것과 잃는 것을 한 문장으로 말해 주세요.'},
    {k:'rd-c2',tag:'공통 2 · 고침·유지와 이유',q:hardText+rejectText+' 상대가 다시 반문한다면, 수용·거절 기준 하나에 비추어 이 안을 고치거나 유지할 이유를 말해 주세요.'},
    {k:'rd-c3',tag:'공통 3',q:'물고기와 갯벌 생물은 협상 테이블에서 말할 수 없습니다. 이 안에서 그들의 몫을 대변한 방식의 한계는 무엇인가요?'}];
  const indiv=[],situ=[],damMissing=Number(N.end<110+(L.mask&1)-EPS)+Number(D.shortage>EPS),cityMissing=[];
  if(N.supply<.95+.01*((L.mask>>2)&1)-EPS)cityMissing.push('공급량 부족');
  if(N.C===null||N.C>.90-.01*((L.mask>>2)&1)+EPS)cityMissing.push('수질 기준 미달');
  const issue=cityMissing.length===2?KCP.josa(cityMissing[0],'와/과')+' '+cityMissing[1]:cityMissing[0]||'';
  // 8절 개정: 당사자 질문은 심각도(심각 미달 0 < 거부 1 < 조건부 2) → 기준과의 상대 거리(큰 것 먼저) → 당사자 순.
  const up=i=>(L.mask>>i)&1, rel=(v,t,upper)=>v===null?Infinity:upper?(v-t)/t:(t-v)/t;
  const crit=[[[N.end,110+up(0),false],[D.shortage,0,'dry']],[[N.income,.85+.01*up(1),false]],
    [[N.supply,.95+.01*up(2),false],[N.C,.90-.01*up(2),true]],[[N.Qe,(N.pulseEffective?3:4)+.1*up(3),false],[N.DO,5+.1*up(3),false]]];
  const unmetGap=([v,t,kind])=>kind==='dry'?(v>EPS?v/D.Rplan:null):v===null?Infinity:(kind?v>t+EPS:v<t-EPS)?rel(v,t,kind):null;
  const isSevere=[N.end<80-EPS,N.income<.70-EPS,N.supply<.85-EPS||(N.C!==null&&N.C>1+EPS),N.Qe<(N.pulseEffective?2:3)-EPS||(N.DO!==null&&N.DO<4-EPS)];
  const others=[1,2,3].some(missing);
  const pq=[
    {k:'rd-dam-future',tag:'개별 · 미래 비용',q:`평년 기말 저수량은 ${f(N.end,2)}백만 m³이며 공사의 모형 기준 2개 가운데 ${damMissing}개를 채우지 못했습니다. ${others?"미래 사용자는 직접 반대할 수 없습니다. 가을에도 비가 오지 않을 때 그들이 질 비용을 고려해, 비축을 깎는 것이 지금 당사자들 사이에서 쉬운 타협이 되지 않았는지 설명해 주세요.":"가을에도 비가 오지 않으면 이 결정의 비용은 누가 지나요?"}`},
    {k:'rd-ag',tag:'개별 · 생계 부담',q:`농가 소득 지수는 ${f(N.income)}입니다. 이 배분에서 농가가 지는 부담을 줄일 대안 하나를 제안해 주세요.`},
    {k:'rd-city',tag:'개별 · 생활 부담',q:`도시 공급률은 ${f(100*N.supply,1)}%, 취수 수질 지표는 ${f(N.C)}입니다. 이 안의 미충족 항목인 ${KCP.josa(issue,'을/를')} 감수할 때 가장 먼저 영향을 받는 시민은 누구인가요?`},
    {k:'rd-eco',tag:'개별 · 생태 부담',q:`하구 모형 유량은 ${f(N.Qe)}m³/s, 수온은 ${f(N.T,2)}℃, DO는 ${N.DO===null?'계산 불가':f(N.DO)+'mg/L'}입니다. ${N.DO === null ? "물이 흐르지 않아 DO를 계산할 수 없다는 한계를 근거로," : "수온·유량·산소 소모가 이 DO 값에 미친 영향을 근거로,"} 생물과 어업인에게 돌아가는 부담을 설명해 주세요.`}];
  const order=[0,1,2,3].filter(missing).map(i=>({i,rank:isSevere[i]?0:N.responses[i]==='reject'?1:2,gap:Math.max(...crit[i].map(unmetGap).filter(g=>g!==null))}))
    .sort((a,b)=>a.rank-b.rank||b.gap-a.gap||a.i-b.i);
  const partyQs=order.map(o=>pq[o.i]);
  const must=Math.max(order.filter(o=>o.rank===0).length,Math.min(2,order.length));
  if(missing(0)&&!others)situ.push({k:'rd-dam-structure',tag:'개별 · 비축의 대표성',q:'미래를 위한 비축을 깎는 것이 지금의 당사자들 사이에서 쉬운 타협이 될 수 있습니다. 미래 사용자의 몫을 고려해 이 안을 고치거나 유지할 이유를 말해 주세요.'});
  if(L.mask)situ.push({k:'rd-repeat',tag:'개별 · 반복 거절',q:`${names.filter((_,i)=>(L.mask>>i)&1).join(', ')}의 요구를 연속으로 거절해 모형 기준이 올랐습니다. 같은 쪽의 요구를 거듭 거절한 이유는 무엇인가요?`});
  if(applied>=3)situ.push({k:'rd-applied-three',tag:'개별 · 조정의 일관성',q:`역제안을 ${applied}번 반영했습니다. 요구를 받아들이면서도 유지하려 한 기준은 무엇인가요?`});
  const dissentText=L.mode==='role'?`최종 역할극 반응에서 ${KCP.josa(diss.join(', '),'이/가')} 수용하지 않았습니다.`:`최종 자동 반응에서 ${diss.join(', ')}의 모형 기준을 채우지 못했습니다.`;
  if(diss.length)situ.push({k:'rd-dissent',tag:'개별 · 상정 절차',q:dissentText+' 그 당사자가 수용하지 않은 안을 상정할 절차적 근거는 무엇인가요?'});
  if(D.shortage>EPS)situ.push({k:'rd-dry-cut',tag:'개별 · 건조 감량',q:`건조 전망에서 계획대로 방류하면 사수위 저수량(40백만 m³)보다 ${f(D.shortage,2)}백만 m³가 부족해 그만큼 감량됩니다. ${L.proposal.order==='proportional'?'같은 비율로 줄이는 방식을':{agFirst:'농업부터 줄이는 순서를',cityFirst:'도시부터 줄이는 순서를',envFirst:'하천유지부터 줄이는 순서를'}[L.proposal.order]} 택했습니다. 감량 부담을 지는 사람·생물에게 이 방식의 근거를 설명해 주세요.`});
  if(N.cost>=50)situ.push({k:'rd-tax',tag:'개별 · 테이블 밖 비용',q:`대책비 ${f(N.cost,0)}억 원을 쓰는 안입니다. 유역 밖 납세자에게 어떤 참여 기회를 제공하겠습니까?`});
  if(W.responses.every(x=>x==='accept')&&!N.responses.every(x=>x==='accept')&&!D.responses.every(x=>x==='accept'))situ.push({k:'rd-wet-only',tag:'개별 · 비에 기대는 합의',q:'이 안은 습윤 전망에서만 네 당사자의 모형 기준을 모두 채웁니다. 비가 적으면 비용을 누가 지도록 약속하겠습니까?'});
  // 개별 질문은 최대 3개: 반드시 묻는 당사자 → 상황 질문 → 남은 당사자.
  indiv.push(...partyQs.slice(0,must),...situ,...partyQs.slice(must));
  indiv.length=Math.min(indiv.length,3);
  if(indiv.length<2)indiv.push({k:'rd-order-reason',tag:'개별 · 감량의 원칙',q:`부족 시 ‘${{proportional:'미지정(비례 감량)',agFirst:'농업→도시→하천',cityFirst:'도시→하천→농업',envFirst:'하천→농업→도시'}[L.proposal.order]}’ 방식으로 감량하기로 했습니다. 이 방식 때문에 계획을 세우기 어려워지는 부담은 누가 지나요?`});
  // 명세 8절 rd-divergent/rd-science·10절 한계: 재폭기·분해 및 회귀수·희석을 보존하고 요청은 하나로 묶는다.
  const lastQ=applied>0||L.mask!==0?{k:'rd-divergent',tag:'발산 · 모형 밖 대안',q:'대기에서 산소가 다시 녹아드는 재폭기와 산소를 소비하는 유기물 분해는 이 모형에서 빠져 있습니다. 이 과정이나 하수 재이용·해수 담수화 중 하나를 고려해, 이 안을 고치거나 유지할 이유를 말해 주세요.'}:
    {k:'rd-science',tag:'과학 · 회귀수와 희석',q:'같은 물이라도 도시가 쓸 때와 농업이 쓸 때 이 모형의 하구로 돌아오는 양이 다릅니다. 회귀수와 희석을 근거로, 회귀수 비율이 달라질 때 자신의 배분을 고치거나 유지할 이유를 말해 주세요.'};
  return qs.concat(indiv,lastQ);
}
function checkQuestions(label,state,keys=null) {
  const before=JSON.stringify(state),expected=expectedQuestions(state),actual=game.questions(state);
  for(const q of actual) test(`결함 8 ${label}/${q.k} 요청 하나`,()=>eq(requestCount(q.q),1)); // 결함 8: 모든 검산 사례에 같은 요청 수 검사
  test(`${label} 키`,()=>eq(m.questionKeys(state),keys||expected.map(q=>q.k)));
  test(`${label} 문장·수치·우선순위`,()=>eq(actual,expected));
  test(`${label} 비수정`,()=>eq(JSON.stringify(state),before));
  test(`${label} src·중복·개수`,()=> {eq(actual.every(q=>!Object.hasOwn(q,'src')),true);eq(new Set(actual.map(q=>q.k)).size,actual.length);eq(actual.length>=6&&actual.length<=7,true);});
}
const common=['rd-c1','rd-c2','rd-c3'];
// 개정 전 N은 rd-dry-cut, L은 rd-wet-only까지 8문항이었다. 개별 질문 상한 3개로 줄었다.
for(const [id,individual] of [['N',['rd-dam-future','rd-dam-structure','rd-dissent']],
  ['L',['rd-dam-future','rd-dam-structure','rd-dissent']],['T',['rd-eco','rd-dissent','rd-tax']]])
  checkQuestions(`8 ${id} 자동`,lockedState(plans[id]),[...common,...individual,'rd-science']);
checkQuestions('8 역할극 보충',lockedState(plan(0,35,22),'role'),[...common,'rd-ag','rd-order-reason','rd-science']);
for(const [id,p] of Object.entries(plans)) for(const mode of ['auto','role']) checkQuestions(`8 ${id}/${mode}`,lockedState(p,mode));
test('12.3-7 미확정 질문',()=>eq(game.questions({game:{locked:null}}),[]));
// 반복 거절 mask는 실제로 도달 가능한 이력으로 만든다(4회 이내).
for(const party of parties) {
  const p=party==='dam'?plans.N:plans.F,mask=1<<parties.indexOf(party),human=null;
  const rounds=[1,2,3].map((n)=>({n,proposal:plain(p),mask:n===3?mask:0,human,
    decision:{id:`rd-r${n}-decision`,...reject(party),option:null,beforeP:plain(p),afterP:plain(p),beforeMask:n===3?mask:0}}));
  checkQuestions(`8 기준 상승 ${party}`,lockedState(p,'auto',null,rounds,mask));
}
// 실제로 3회 개선 반영한 유효한 한 판: 농업 공급 → 하구 유량 → 도시 공급.
const appliedPlans=[plan(30,21,12),plan(31,21,12),plan(31,21,13),plan(31,22,13)];
const appliedParties=['ag','eco','city'];
const appliedRounds=appliedPlans.map((p,i)=>({n:i+1,proposal:p,mask:0,human:null,decision:i<3?
  {id:`rd-r${i+1}-decision`,action:'apply',party:appliedParties[i],option:'a',beforeP:p,afterP:appliedPlans[i+1],reason:'가상 부담을 조정한다.',beforeMask:0}:
  {id:'rd-r4-decision',...reject('ag'),option:null,beforeP:p,afterP:p,beforeMask:0}}));
checkQuestions('8 3회 반영 후보 우선순위',lockedState(appliedPlans[3],'auto',null,appliedRounds));
const hostile=lockedState(plans.N);
hostile.game.locked.rounds[0].decision.reason='<img src=x onerror=alert(1)>';
hostile.game.rounds[0].decision.reason='<img src=x onerror=alert(1)>';
checkQuestions('12.3-9 가상 HTML 원문',hostile);
test('12.3-9 질문 키 안정',()=>eq(game.questions(hostile).map(q=>q.k),game.questions(lockedState(plans.N)).map(q=>q.k)));

// 8절 개정 공정성: 고정 순서(하구→도시→농업)로 한 자리만 주던 방식에서 농민 질문이 빠지던 재현 사례.
{
  const p=plan(20,0,80,.3),keys=m.questionKeys(lockedState(p));
  test('8 공정성 재현 농민 심각 미달 질문 포함',()=>{eq(m.evaluate(p).normal.responses,['reject','reject','reject','accept']);eq(keys.includes('rd-ag'),true);});
  test('8 공정성 재현 공사 비축 질문 합침',()=>{eq(keys.includes('rd-dam-structure'),false);eq(keys.length,7);});
}
// 8절 개정 전수 격자(4 간격, 28개 조항, 자동·역할극): 심각 미달 당사자는 모두 질문을 받고,
// 미충족 당사자가 둘 이상이면 당사자 질문이 둘 이상이며, 총 문항은 6~7개다. 키는 독립 규범과 대조한다.
{
  const partyKey=['rd-dam-future','rd-ag','rd-city','rd-eco'];
  let grid=0,bad=[];
  for(const f of [0,.1,.2,.3])for(const save of [false,true])for(const link of [false,true])for(const pulse of [false,true]) {
    if(150*f+5*Number(save)+25*Number(link)>60)continue;
    for(let ag=0;ag<=80;ag+=4)for(let city=0;city<=80;city+=4)for(let env=0;env<=80;env+=4) {
      const p=plan(ag,city,env,f,save,link,pulse),N=evaluate(p).normal,sev=m.severe(N);
      for(const mode of ['auto','role']) {
        const st=lockedState(p,mode),keys=m.questionKeys(st);grid++;
        const unmet=[0,1,2,3].filter(i=>N.responses[i]!=='accept'),asked=unmet.filter(i=>keys.includes(partyKey[i]));
        const ok=keys.length>=6&&keys.length<=7&&unmet.every(i=>!sev[i]||keys.includes(partyKey[i]))&&asked.length>=Math.min(2,unmet.length)
          &&JSON.stringify(keys)===JSON.stringify(expectedQuestions(st).map(q=>q.k));
        if(!ok&&bad.length<3)bad.push([p,mode,keys]);
      }
    }
  }
  test('8 전수 격자 심각 미달 보장·상한·규범 일치',()=>eq([grid,bad],[518616,[]]));
}
// 명세 5절 무유량 분기·8절 생태 질문: 계산 불가를 수치처럼 해석시키지 않는다.
for(const [label,p,isNull] of [['무유량',plan(0,0,0),true],['유량 있음',plan(0,35,0),false]]) {
  test(`8 DO ${label} 질문`,()=>{
    const q=game.questions(lockedState(p)).find(q=>q.k==='rd-eco');
    eq(q.q.includes('물이 흐르지 않아 DO를 계산할 수 없다는 한계'),isNull);
    eq(q.q.includes('이 DO 값에 미친 영향'),!isNull);
    eq(requestCount(q.q),1);
  });
}
// 7.4 개정: 반올림하면 기준과 같아 보이는 미충족 값은 자릿수를 늘리거나 반올림 전 미달을 밝힌다.
{
  const at=(p,key)=>m.checks(m.simulate(p,55),m.simulate(p,15),0).flat().find(c=>c.key===key);
  for(const [p,key,text] of [[plan(3,59,2),'DO','4.99997 / 5.00000 (이상) · −0.00003 · 미충족'],
    [plan(55,0,39),'C','0.9005 / 0.9000 (이하) · 초과량 0.0005 · 미충족'],
    [plan(54,22,80),'income','0.8498 / 0.8500 (이상) · −0.0002 · 미충족'],
    [plan(61,46,80),'supply','94.98% / 95.00% (이상) · −0.02% · 미충족']])
    test(`7.4 반올림 동률 미충족 ${key}`,()=>eq(m.checkText(at(p,key)),text));
  test('7.4 6자리에서도 같으면 반올림 전 미달',()=>eq(m.checkText({key:'DO',value:5-2e-9,threshold:5,upper:false,met:false}),'5.000000 / 5.000000 (이상) · −0.000000 · 미충족 (반올림 전 미달)'));
  test('7.4 충족 값은 자릿수 유지',()=>eq(m.checkText({key:'DO',value:6.0475,threshold:5,upper:false,met:true}),'6.048 / 5.000 (이상) · +1.048 · 충족'));
}
// 7.1 개정: 학생이 고른 가장 어려운 역제안 기록은 다음 결정이 덮어쓰지 않는다.
{
  let g=m.fresh();g.mode='auto';g.criterion='가상 기준 한 줄이다.';
  const T=a=>{g=m.transition(g,a).game;};
  T({type:'submit'});T({type:'reject',party:'dam',reason:'가상 이유 하나다.'});
  test('7.1 첫 결정은 기본 선택',()=>eq(g.final.hardDecisionId,'rd-r1-decision'));
  T({type:'submit'});T({type:'reject',party:'dam',reason:'가상 이유 둘이다.'});
  test('7.1 다음 결정이 기존 선택 유지',()=>eq(g.final.hardDecisionId,'rd-r1-decision'));
  g.final.hardDecisionId='rd-r2-decision';
  test('7.1 학생이 바꾼 선택 유지',()=>eq(g.final.hardDecisionId,'rd-r2-decision'));
  let h=m.fresh();h.mode='auto';h.criterion='가상 기준 한 줄이다.';h.final.hardDecisionId='rd-r9-decision';
  for(const a of [{type:'submit'},{type:'reject',party:'dam',reason:'가상 이유 하나다.'}])h=m.transition(h,a).game;
  test('7.1 유효하지 않은 선택은 새 결정으로 채움',()=>eq(h.final.hardDecisionId,'rd-r1-decision'));
}
// 성찰 개정: 예시 4(농가 생계 우선)의 수치는 모형에서 다시 계산하고, 3자 합의 비율은 전수 탐색표에서 계산한다.
{
  const html=game.reflectExtra(lockedState(plans.N)),farm=plan(55,33,12,0,true,true,false,'cityFirst'),E=m.evaluate(farm);
  test('성찰 예시 4 수치',()=>{
    const want=[`${E.normal.cost}억`,E.normal.income.toFixed(3),(100*E.normal.supply).toFixed(1)+'%',E.normal.Qe.toFixed(3),E.normal.DO.toFixed(3),E.normal.end.toFixed(2),E.dry.end.toFixed(2)];
    eq([want,E.normal.responses,E.wet.responses,E.dry.shortage],[['30억','1.000','100.0%','4.585','5.299','89.00','49.00'],['conditional','accept','accept','accept'],['accept','accept','accept','accept'],0]);
    const body=html.slice(html.indexOf('id="rd-example-farm"'),html.indexOf('</details>',html.indexOf('id="rd-example-farm"')));
    for(const w of [...want,'올해 농가 생계 우선','다수 합의안'])if(!body.includes(w))throw new Error(`예시 4에 ${w} 없음`);
  });
  globalThis.__rdReflection=html;
}
// 6절 mask15 증인: 어느 한 곳만 항상 빠지는 구조가 아님을 독립 기대값으로 검사.
for(const [p,expected] of [[plan(49,35,10),['conditional','accept','accept','accept']],
  [plan(0,35,22),['accept','reject','accept','accept']], [plan(49,0,14,0,false,false,true),['accept','accept','reject','accept']],
  [plan(42,35,1,.2,false,true),['accept','accept','accept','reject']]])
  test('6 mask15 단독 제외 증인 '+JSON.stringify(p),()=>eq(m.evaluate(p,15).normal.responses,expected));
test('6 mask15 습윤 증인',()=>eq(m.evaluate(plan(49,35,10),15).wet.responses,['accept','accept','accept','accept']));

// 12.4-7 전체 전수 탐색표. 앱 model의 simulate/response로 다시 계산한다(sweepPart 참고).
const expectedCounts=[
 [0,10931917,585172,85072,316,193132],[0,10931917,525724,70680,160,193132],
 [0,10788681,585172,79368,132,183180],[0,10788681,525724,65616,40,183180],
 [0,10777435,560968,85072,240,181628],[0,10777435,503224,70680,108,181628],
 [0,10635802,560968,79368,108,172028],[0,10635802,503224,65616,32,172028],
 [0,10627957,541028,73576,316,171048],[0,10627957,484544,60720,160,171048],
 [0,10485689,541028,68384,132,161776],[0,10485689,484544,56136,40,161776],
 [0,10475735,518112,73576,240,160492],[0,10475735,463292,60720,108,160492],
 [0,10335054,518112,68384,108,151556],[0,10335054,463292,56136,32,151556]
];
console.log('12.4-7 전수 탐색 시작: 59,521,392개 제안, 마스크 0~15 전체 표');
const parts=Math.max(1,Math.min(28,Number(process.env.RD_SWEEP_WORKERS)||(os.availableParallelism?os.availableParallelism():os.cpus().length)));
console.log(`전수 탐색 worker ${parts}개`);
const started=Date.now();
const pieces=await Promise.all(Array.from({length:parts},(_,part)=>new Promise((resolve,reject)=>{
  const w=new Worker(new URL(import.meta.url),{workerData:{part,parts}});
  w.once('message',r=>{console.log(`전수 탐색 조각 ${part+1}/${parts} 완료 (조항 ${r.clauses}개)`);resolve(r);});
  w.once('error',reject);
  w.once('exit',code=>{if(code)reject(new Error(`worker ${part} 종료 코드 ${code}`));});
})));
console.log(`전수 탐색 ${((Date.now()-started)/1000).toFixed(1)}초`);
const hn=new Float64Array(256),hw=new Float64Array(256);
let count=0,clauses=0,maxSevere=0;
for(const r of pieces){r.hn.forEach((v,i)=>{hn[i]+=v;});r.hw.forEach((v,i)=>{hw[i]+=v;});count+=r.count;clauses+=r.clauses;maxSevere=Math.max(maxSevere,r.maxSevere);}
test('8 평년 심각 미달 당사자 최대 3곳(개별 질문 3자리 안에 모두 보장)',()=>eq(maxSevere,3));
test('12.4-7 탐색 영역',()=>eq([clauses,count],[28,59521392]));
const counts=Array.from({length:16},()=>[0,0,0,0,0,0]);
for(let mask=0;mask<16;mask++)for(let b=0;b<16;b++)for(let h=0;h<16;h++) {
  const actual=(b&(~mask&15))|(h&mask),i=b*16+h;
  if(actual===15){counts[mask][0]+=hn[i];counts[mask][5]+=hw[i];}
  const absent=[14,13,11,7].indexOf(actual);if(absent>=0)counts[mask][absent+1]+=hn[i];
}
counts.forEach((row,mask)=>row.forEach((value,column)=>test(`12.4-7 mask${mask} 열${column}`,()=>eq(value,expectedCounts[mask][column]))));
// 성찰 개정: 평년 3자 합의안 비율(기준 상승 없음)을 전수 탐색표에서 계산해 성찰 문장과 대조한다.
{
  const row=expectedCounts[0],three=row[1]+row[2]+row[3]+row[4],pct=(x,d)=>(100*x/three).toFixed(d)+'%';
  const want=[three.toLocaleString('en-US'),pct(row[1],1),pct(row[2],1),pct(row[3],1),pct(row[4],3)];
  test('성찰 3자 합의 비율',()=>{eq(want,['11,602,477','94.2%','5.0%','0.7%','0.003%']);for(const w of want)if(!globalThis.__rdReflection.includes(w))throw new Error(`성찰에 ${w} 없음`);});
}
if(failures) {console.error(`통과 ${total-failures}건, 실패 ${failures}건`);process.exitCode=1;}
else console.log(`통과 ${total}건`);
}
