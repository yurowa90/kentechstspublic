// 검토 결함 8·15: 문구·태그 기대값은 요청 하나와 공통 습관 어휘로 갱신. 계산 허용 오차는 그대로 둔다.
// 기대값의 원본: 사용자 제공 수정 명세 4~6절, 8절. 앱의 데이터/식을 복사하지 않는다.
// N7: 직접 명령형까지 포함하고, 인용문 안의 물음은 요청에서 제외한다.
const requestCount = q => (q.replace(/“[^”]*”|‘[^’]*’/g, '').match(/[?？]|(?:주세요|[가-힣]+세요)[.!]/g) || []).length;
if (requestCount('말하세요. 적으세요! 설명하세요. 답은 무엇인가요?') !== 4 ||
    requestCount('“어떻게 하나요?”라는 반문에 답을 말해 주세요.') !== 1)
  throw new Error('N7 요청 수 검사 자체의 종결형·인용문 처리 실패');
import fs from 'node:fs';
import vm from 'node:vm';
import {isDeepStrictEqual} from 'node:util';

function josa(word, pair) {
  const w = String(word).trim(), code = w.charCodeAt(w.length - 1);
  const jong = code >= 0xAC00 && code <= 0xD7A3 ? (code - 0xAC00) % 28 : null;
  const endings = {'을/를':['을','를','을(를)'], '이/가':['이','가','이(가)'],
    '은/는':['은','는','은(는)'], '와/과':['과','와','과(와)'],
    '이고/고':['이고','고','이고'], '으로/로':['으로','로','(으)로']};
  const choices = Object.hasOwn(endings, pair) ? endings[pair] : null;
  return choices ? w + choices[jong === null ? 2 : jong && !(pair === '으로/로' && jong === 8) ? 0 : 1] : w;
}
const KCP = {games:{}, YEARS:{}, ORIGINAL_ORDER:[], josa,
  esc:s=>String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
const context = vm.createContext({window:{KCP}, KCP});
vm.runInContext(fs.readFileSync(new URL('../games/s-variant-desk.js', import.meta.url), 'utf8'), context);
// 객체의 prototype을 검사하는 API도 실제 앱과 같은 realm의 입력을 받게 한다.
const rawModel = KCP.games['s-variant-desk'].model;
const realm = value => value !== null && typeof value === 'object'
  ? vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`, context) : value;
const m = Object.fromEntries(Object.entries(rawModel).filter(([,fn])=>typeof fn==='function')
  .map(([name,fn])=>[name,(...args)=>fn(...args.map(realm))]));
const plain = x => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
let passed = 0, failed = 0;
function check(label, actual, expected, tolerance) {
  const ok = tolerance === undefined ? isDeepStrictEqual(plain(actual), expected)
    : Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
  if (ok) passed++;
  else { failed++; console.error(`실패 ${label}: 기대 ${JSON.stringify(expected)}, 실제 ${JSON.stringify(actual)}`); }
}
function test(label, fn) {
  try { fn(); } catch (e) { failed++; console.error(`실패 ${label}: ${e.message || e}`); }
}

// 명세 4.2의 고정 자료만 전사. 기대 계산은 이 배열로 독립 수행한다.
// 검토 H1: P-11·P-12는 드물지만(빈도 +1·+2) 강한 반대 근거(가계 −2, 기능 −2)를 가진 비병원성 카드다.
const vectors = [[3,2,3,1,2],[2,2,3,2,1],[2,1,2,2,2],[1,2,3,1,2],
  [0,0,0,1,0],[0,1,0,0,0],[-1,-2,-2,3,0],[0,-1,-2,3,0],
  [0,0,0,1,0],[0,1,0,0,0],[-2,1,-1,-1,-1],[-1,2,-2,0,-1],
  [1,1,0,2,0],[0,2,1,-1,1],[-1,1,2,0,1],[0,0,1,1,-1]];
const pens = [[40,70],[50,80],[30,60],[30,60],[20,40],[40,70],[20,50],[10,30],
  [20,40],[40,70],[30,50],[20,50],[20,60],[30,70],[10,40],[20,50]];
const actions = [[1,1,0,1],[1,0,1,0],[1,0,0,1],[0,0,0,1],[1,0,0,0],[0,0,1,1],
  [1,1,0,0],[0,0,0,0],[1,0,0,0],[0,0,1,1],[1,0,0,0],[1,0,1,0],
  [1,0,0,0],[0,0,1,1],[1,0,1,0],[0,0,0,1]];
const ids = ns => ns.map(n=>`P-${String(n).padStart(2,'0')}`);
const cards = vectors.map((e,i)=>({id:ids([i+1])[0], e, pen:pens[i], a:actions[i],
  truth:i<6?'P':i<12?'B':'U', secondary:[2,3,11].includes(i), minor:[2,10].includes(i),
  noCare:[3,7].includes(i), family:[0,8].includes(i), refused:i===0}));
const policy = (a,b,c,d)=>({secondary:a,minors:b,noCare:c,relatives:d});
// 기본 무게: 드물다는 근거가 약하다는 점을 반영해 빈도 무게를 1로 둔다(검토 H1).
const base = extra=>({version:1,weights:[2,1,3,1,1],t1:12,t2:1,overrides:{},
  policyMode:'skip',policy:policy(null,null,null,null),piPct:1,piTouched:false,
  replannedAfterReveal:false,plan:'',...extra});
const cases = {
  A:base({weights:[3,3,3,3,3],t1:-30,t2:-31}),
  B:base({weights:[3,3,3,3,3],t1:47,t2:46}), C:base(),
  D:base({weights:[0,0,0,3,0],t1:6,t2:1,policyMode:'apply',policy:policy(true,false,false,true)}),
  E:base({weights:[0,0,0,0,0],t1:1,t2:0}),
  F:base({overrides:{'P-05':{to:'R',reason:'추가 확인의 기회를 남기겠습니다.'},
    'P-06':{to:'R',reason:'판독 근거의 한계를 설명하며 보고하겠습니다.'}}}),
  G:base({policyMode:'apply',policy:policy(true,true,true,true)}),
  X1:base({weights:[3,2,3,1,1],t1:1,t2:0,policyMode:'apply',policy:policy(true,true,true,true)}),
  X2:base({weights:[2,3,3,0,1],t1:18,t2:10,policyMode:'apply',policy:policy(false,false,false,false)}),
  X3:base({weights:[2,2,2,1,1],t1:22,t2:0})};
const cm = a=>Object.fromEntries(['TP','FP','FN','TN'].map((k,i)=>[k,a[i]]));
// 명세 6.1~6.5의 표: 장수, 목록, 제외, 조치, 참여자, 혈족, 수요, R/RC/f, PPV,
// 재검토·재연락 등록(보고한 미확정), 비병원성인데 보고, 상담에서 제외(정책 필터, 검토 M3).
const all = Array.from({length:16},(_,i)=>i+1);
const universal = '1.0%(범위 없음 — 전부 양성인 규칙에서는 π와 같습니다)';
const none = '양성 판정이 없어 계산하지 않음';
const tables = {
  // 결함 0·7: P-13~16의 [2,0,2,2]를 기존 합에 더함: [10,2,6,7].
  A:[[16,0,0],all,[],[10,2,6,7],16,0,16,[6,6,0,0],[6,6,0,0],[6,6,0,0],universal,universal,[13,14,15,16],[7,8,9,10,11,12],[]],
  B:[[0,0,16],[],[],[0,0,0,0],0,0,0,[0,0,6,6],[0,0,6,6],[0,0,6,6],none,none,[],[],[]],
  C:[[4,8,4],[1,2,3,4],[],[3,1,1,3],12,0,12,[4,0,2,6],[6,2,0,4],[4,0,2,6],'0.7~100.0%','0.8~9.5%',[],[],[]],
  // 결함 0·7: P-02 [1,0,1,0] + P-07 [1,1,0,0] + P-13 [1,0,0,0].
  D:[[5,5,6],[2,7,13],[3,8],[3,1,1,0],7,2,9,[2,2,4,4],[5,3,1,3],[1,1,5,5],'0.1~6.9%','0.5~5.0%',[13],[7],[4]],
  E:[[0,16,0],[],[],[0,0,0,0],16,0,16,[0,0,6,6],[6,6,0,0],[0,0,6,6],none,universal,[],[],[]],
  F:[[6,6,4],[1,2,3,4,5,6],[],[4,1,2,4],12,0,12,[6,0,0,6],[6,2,0,4],[6,0,0,6],'1.5~100.0%','0.8~9.5%',[],[],[]],
  G:[[4,8,4],[1,2,3,4],[],[3,1,1,3],12,2,14,[4,0,2,6],[6,2,0,4],[4,0,2,6],'0.7~100.0%','0.8~9.5%',[],[],[]],
  // 결함 0·7: 모두 켬 사례도 미확정 4장의 [2,0,2,2]를 더해 [7,1,5,7].
  X1:[[12,0,4],[1,2,3,4,5,6,9,10,13,14,15,16],[],[7,1,5,7],12,2,14,[6,2,0,4],[6,2,0,4],[6,2,0,4],'0.8~9.5%','0.8~9.5%',[13,14,15,16],[9,10],[]],
  X2:[[3,2,11],[1,2],[4],[2,1,1,1],3,0,3,[3,0,3,6],[4,0,2,6],[2,0,4,6],'0.4~100.0%','0.7~100.0%',[],[],[3]],
  X3:[[0,12,4],[],[],[0,0,0,0],12,0,12,[0,0,6,6],[6,2,0,4],[0,0,6,6],none,'0.8~9.5%',[],[],[]]};

// 명세 5.2 Wilson/Bayes 규범식을 독립 구현. UI 표시 반올림은 바깥 방향.
function wilson(k,n) {
  if (!n) return null;
  const z2=1.96**2, p=k/n, d=1+z2/n, mid=(p+z2/(2*n))/d;
  const half=1.96*Math.sqrt(p*(1-p)/n+z2/(4*n*n))/d;
  return [k===0?0:Math.max(0,mid-half),k===n?1:Math.min(1,mid+half)];
}
function range(c,s,t) {
  if (!c.TP&&!c.FP) return null;
  const p=s.piPct/100;
  // 가능한 최소 점수: 가계·빈도·기능 −2, 예측·같은 위치 −1(검토 Low: 이전 −2×합은 너무 낮았다).
  const w=s.weights;
  if (!Object.keys(s.overrides).length && t<=-2*(w[0]+w[1]+w[2])-(w[3]+w[4])) return [p,p];
  const se=wilson(c.TP,6), sp=wilson(c.TN,6);
  return [0,1].map(i=>{const a=se[i]*p, d=a+(1-sp[i])*(1-p);return d?a/d:i;});
}
function pct(a) {return a ? `${(Math.floor(a[0]*1000+1e-10)/10).toFixed(1)}~${(Math.ceil(a[1]*1000-1e-10)/10).toFixed(1)}%`:'계산하지 않음';}
function oracle(s) {
  const rows=cards.map(v=>{const score=v.e.reduce((sum,e,k)=>sum+e*s.weights[k],0);
    const auto=score>=s.t1?'R':score>=s.t2?'C':'N';return {...v,score,auto,group:s.overrides[v.id]?.to||auto};});
  const select=gs=>rows.filter(v=>gs.includes(v.group)).map(v=>v.id);
  const report=select(['R']), inclusive=select(['R','C']);
  const ok=v=>s.policyMode!=='apply'||(s.policy.secondary||!v.secondary)&&(s.policy.minors||!v.minor)&&(s.policy.noCare||!v.noCare);
  const final=rows.filter(v=>v.group==='R'&&ok(v)).map(v=>v.id);
  const consult=rows.filter(v=>v.group==='C'&&ok(v)).map(v=>v.id);
  const family=s.policyMode==='apply'&&s.policy.relatives?rows.filter(v=>v.family&&v.group!=='N').map(v=>v.id):[];
  const counts=list=>{const a={TP:0,FP:0,FN:0,TN:0};for(const v of rows) if(v.truth!=='U') a[v.truth==='P'?(list.includes(v.id)?'TP':'FN'):(list.includes(v.id)?'FP':'TN')]++;return a;};
  const r=counts(report), rc=counts(inclusive);
  const ranges={r:range(r,s,s.t1),rc:range(rc,s,s.t2)};
  const distinct=[...new Map(rows.filter(v=>final.includes(v.id)&&v.truth!=='U').map(v=>[v.pen.join('-'),v.pen]))]
    .sort((a,b)=>a[1][0]-b[1][0]||a[1][1]-b[1][1]);
  const actions=[0,0,0,0];rows.filter(v=>final.includes(v.id)).forEach(v=>v.a.forEach((n,k)=>{actions[k]+=n;}));
  return {rows,report,inclusive,final,consult,actions,demand:final.length+consult.length+family.length,family,r,rc,ranges,onset:distinct.map(([key,pen])=>({key,pen,
    range:ranges.r?ranges.r.map((v,i)=>v*pen[i]/100):null}))};
}
for (const [name,s] of Object.entries(cases)) test(name,()=>{
  const before=JSON.stringify(s), r=m.compute(s), o=oracle(s), t=tables[name];
  check(`${name} 순수 연산`,JSON.stringify(s),before);
  check(`${name} 장수`,[r.groups.R,r.groups.C,r.groups.N],t[0]);
  for (const [field,expected] of [['final',ids(t[1])],['removed',ids(t[2])],['actions',t[3]],
    ['demand',t[6]],['waiting',t[6]>8],['r',cm(t[7])],['rc',cm(t[8])],['f',cm(t[9])]]) check(`${name} ${field}`,r[field],expected);
  check(`${name} 참여자`,r.participantConsult.length,t[4]);check(`${name} 혈족`,r.family.length,t[5]);
  check(`${name} 재검토·재연락`,r.recontact,ids(t[12]));check(`${name} 비병원성 보고`,r.overreported,ids(t[13]));
  check(`${name} 상담 제외`,r.consultRemoved,ids(t[14]));
  check(`${name} 조치·수요 독립 계산`,[r.actions,r.demand],[o.actions,o.demand]);
  check(`${name} 거부 경고`,r.refusalWarning,['D','G','X1'].includes(name));
  check(`${name} R PPV`,m.ppvText(r.ranges.r),t[10]);check(`${name} RC PPV`,m.ppvText(r.ranges.rc),t[11]);
  check(`${name} U ID`,r.uncertain.map(v=>v.id),ids([13,14,15,16]));
  for (const field of ['report','inclusive','family']) check(`${name} ${field}`,r[field],o[field]);
  check(`${name} 점수/자동/수동 분류`,r.rows.map(v=>[v.id,v.score,v.auto,v.group]),o.rows.map(v=>[v.id,v.score,v.auto,v.group]));
  check(`${name} 침투율 행`,r.onset.map(v=>[v.key,plain(v.pen),m.pctRange(v.range)]),o.onset.map(v=>[v.key,v.pen,pct(v.range)]));
  for (const k of ['r','rc']) if(o.ranges[k]) for(let i=0;i<2;i++) check(`${name} ${k} 내부범위 ${i}`,r.ranges[k][i],o.ranges[k][i],1e-14);
});
const scoreTables={A:[33,30,27,27,3,3,-6,0,3,3,-12,-6,12,9,9,3],
  C:[20,18,15,16,1,1,-7,-4,1,1,-8,-7,5,5,6,3],D:[3,6,6,3,3,0,9,9,3,0,-3,0,6,-3,0,3],E:Array(16).fill(0)};
for(const [name,scores] of Object.entries(scoreTables)) test(`점수 ${name}`,()=>check(`6.1 ${name}`,m.compute(cases[name]).rows.map(v=>v.score),scores));
const wilsonTable=[[0,.390343],[.030053,.563509],[.096769,.700012],[.187613,.812387],[.299988,.903231],[.436491,.969947],[.609657,1]];
wilsonTable.forEach((v,k)=>test(`Wilson ${k}`,()=>v.forEach((x,i)=>check(`6.4 Wilson ${k}/6 ${i}`,m.wilson(k,6)[i],x,0.0000005))));
for(const [name,key,expected] of [['A','40-70','0.4~0.7%'],['C','40-70','0.3~70.0%'],['G','40-70','0.3~70.0%'],
  ['C','50-80','0.3~80.0%'],['C','30-60','0.2~60.0%'],['D','50-80','0.0~5.5%'],['D','20-50','0.0~3.5%'],['X1','40-70','0.3~6.7%']])
  test(`발병 ${name}/${key}`,()=>check(`6.4 ${name}/${key}`,m.pctRange(m.compute(cases[name]).onset.find(v=>v.key===key).range),expected));
for(const [piPct,expected] of [[.2,['0.1~100.0%','0.1~2.1%']],[1,['0.7~100.0%','0.8~9.5%']],[5,['3.8~100.0%','4.3~35.3%']]]) test(`π ${piPct}`,()=>{
  const r=m.compute(base({piPct}));check(`6.4 π ${piPct} PPV`,[m.ppvText(r.ranges.r),m.ppvText(r.ranges.rc)],expected);
  check(`6.4 π ${piPct} 불변`,[plain(r.groups),r.final.length,plain(r.actions),r.demand],[{R:4,C:8,N:4},4,[3,1,1,3],12]);
});
for(const [p,n,d] of [[policy(true,true,false,true),4,10],[policy(true,true,true,true),5,12],[policy(false,true,true,true),4,10]])
  test('D 정책 변형',()=>{const r=m.compute({...cases.D,policy:p});check('6.2 D 정책 목록/수요',[r.final.length,r.demand],[n,d]);});

// 8절 질문 규칙(검토 반영)을 명세 조건식으로 독립 구성한다. 면접 카드는 6~7장, 카드마다 주된 물음 하나.
// 세 습관: 공통 1(기준 먼저), 오류 질문(얻는 것·잃는 것 한 문장), 반문(고침/유지와 이유).
// 명세의 카드판 표시 순서. 질문 속 ID 나열도 이 순서를 따른다.
const ORDER=ids([1,7,13,2,9,14,3,8,15,4,10,16,5,11,6,12]);
// 명세 4.2의 표식·8.4의 갈등 순서 + 총괄 B: 정책 전 분류로만 후보를 정한다.
// 게임의 POLICY_FLAGS/선택 함수를 복사하지 않고 카드 ID로 후보 표를 독립 구성한다.
function policyPick(s,r) {
  const active=new Set(r.rows.filter(v=>v.group!=='N').map(v=>v.id));
  const buckets=[['relatives',['P-01'],active.has('P-01')],['minors',['P-11'],true],
    ['noCare',['P-08'],true],['secondary',['P-03','P-04','P-12'],true],
    ['relatives',['P-09'],true]];
  for(const [k,candidates,eligible] of buckets) if(eligible&&candidates.some(id=>active.has(id))) {
    const members=k==='relatives'?['P-01','P-09']:candidates;
    return {key:`vd-${k.toLowerCase()}-${s.policy[k]?'on':'off'}`,ids:ORDER.filter(id=>members.includes(id)&&active.has(id))};
  }
  return {key:'vd-policy-reason',ids:[]};
}
const topic = key => key.replace(/-(on|off)$/, '');
function questionKeys(s) {
  const r=oracle(s);
  const result=r.r.TP>=5&&r.r.TN<=2?'vd-error-more-report':r.r.TP<=2&&r.rc.TP>=5?'vd-error-consult':r.r.TN>=5&&r.r.TP<=2?'vd-error-more-miss':'vd-error-balance';
  const w=s.weights;
  const evidence=Object.keys(s.overrides).length?'vd-manual':w[3]>0&&w[3]>Math.max(w[0],w[2])?'vd-prediction':
    w[1]>0&&w[1]>Math.max(w[0],w[2])?'vd-frequency':w[0]===0?'vd-segregation-zero':'vd-evidence-pair';
  const assumption=s.replannedAfterReveal?'vd-replanned':s.piTouched?'vd-pi-moved':'vd-pi-unmoved';
  return ['vd-c1',result,evidence,...(s.policyMode==='apply'?[policyPick(s,r).key]:[]),assumption,'vd-counter-capacity','vd-divergent-system'];
}
function questionTexts(s) {
  const r=oracle(s), group=id=>({R:'보고',C:'상담 후 결정',N:'보고하지 않음'}[r.rows.find(v=>v.id===id).group]);
  const lose='이 기준이 얻는 것과 잃는 것을 한 문장으로 말해 보세요.', pp=policyPick(s,r), ids=pp.ids.join(', ');
  const outside=pp.ids.filter(id=>['P-04','P-08'].includes(id));
  const guidance='실제 ACMG SF는 참여자가 거부하지 않으면 조치 가능한 유전자에 한해 2차 발견을 보고하도록 권고합니다.'+
    (outside.length?` 예방·치료법이 없는 ${outside.join(', ')} 카드는 이 권고 밖입니다.`:'');
  const text={
    // N6: 무게 0 설명을 요청 앞에 둔다.
    'vd-c1':s.weights.every(w=>w===0)?'무게를 모두 0으로 두어 증거에 무게를 두지 않았습니다. 두 문턱의 위치를 정한 판단 기준을 먼저 말해 주세요.':'가장 큰 무게를 둔 증거와 두 문턱의 위치를 정한 판단 기준을 먼저 말해 주세요.',
    'vd-error-more-report':`정책 적용 전 보고 분류에서 병원성 ${r.r.TP}장과 함께 비병원성 ${r.r.FP}장도 보고했습니다. 불필요한 관찰이나 수술 상담을 검토하게 될 사람을 떠올리며, ${lose}`,
    'vd-error-consult':`정책 적용 전 보고 분류에서는 병원성 ${r.r.TP}장만 바로 보고했고, 보고와 상담을 함께 세면 병원성 ${r.rc.TP}장과 비병원성 ${r.rc.FP}장이 상담 후 결정까지 올라왔습니다. 결정을 상담으로 미룬 ${lose}`,
    'vd-error-more-miss':(r.r.FP===0?`정책 적용 전 보고 분류에서 비병원성은 한 장도 보고하지 않았지만 병원성 ${r.r.FN}장도 보고하지 않았습니다.`:
      `정책 적용 전 보고 분류에서 비병원성 ${r.r.FP}장을 보고하고 병원성 ${r.r.FN}장은 보고하지 않았습니다.`)+` 그중 한 사람이 10년 뒤 진단받는다고 할 때, ${lose}`,
    'vd-error-balance':`정책 적용 전 보고 분류에서는 놓침 ${r.r.FN}장과 과보고 ${r.r.FP}장이 남았고, 보고와 상담을 함께 세면 상담까지 올라간 비병원성 ${r.rc.FP}장, 어느 쪽에도 들지 않은 병원성 ${r.rc.FN}장입니다. 어느 쪽 오류를 더 감수했는지 드러나게, ${lose}`,
    'vd-manual':`${Object.keys(s.overrides).length}장을 저울과 별도로 분류하고 이유를 남겼습니다. 그 이유를 다른 카드에도 적용할 규칙으로 바꾸겠습니까, 예외로 남기겠습니까?`,
    'vd-prediction':`컴퓨터 예측에 가계 근거·기능 실험보다 큰 무게를 두었습니다. 예측만 높은 P-07은 ‘${group('P-07')}’, P-08은 ‘${group('P-08')}’입니다. 기능 실험과 예측이 다른 방향일 때 무엇을 추가로 확인하겠습니까?`,
    'vd-frequency':`집단 내 빈도에 가계 근거·기능 실험보다 큰 무게를 두었습니다. 드물지만 비병원성으로 설정된 P-11은 ‘${group('P-11')}’, P-12는 ‘${group('P-12')}’입니다. ‘드물다’는 근거를 어디까지 믿겠습니까?`,
    'vd-segregation-zero':'가계 내 공동분리에 무게를 두지 않았습니다. 가계 자료를 빼서 어떤 불확실성을 줄이려 했습니까?',
    'vd-evidence-pair':`같은 증거를 가진 P-05와 P-09는 각각 ‘${group('P-05')}’${group('P-05')==='보고'?'와':'과'} ‘${group('P-09')}’입니다. 이 게임이 정한 분류가 서로 다른 두 카드를 구별하려면 어떤 자료가 새로 필요합니까?`,
    'vd-relatives-on':pp.ids.includes('P-01')?'연락을 거부한 P-01의 참여자가 있는데도 혈족 고지를 검토 대상으로 삼았습니다. 본인의 비밀과 혈족의 위험·선택권 가운데 무엇을 앞세웠습니까?':
      `참여자가 거부해도 혈족 고지를 검토하기로 했습니다(${ids}). 앞으로 연락을 거부하는 참여자가 생기면 이 원칙을 어떻게 설명하겠습니까?`,
    'vd-relatives-off':`사업이 혈족에게 따로 연락하지 않기로 했습니다. 같은 변이를 가질 수 있는 ${ids} 카드 참여자의 혈족이 나중에 이 사실을 알게 된다면 어떻게 설명하겠습니까?`,
    'vd-minors-on':`미성년 참여자(${ids})의 보호자에게 성인기 위험을 알리기로 했습니다. 해당 참여자가 성인이 되어 듣고 싶지 않았다고 말한다면 어떻게 설명하겠습니까?`,
    'vd-minors-off':`미성년이라는 이유로 ${ids} 카드를 보고와 상담에서 뺐습니다. 보호자가 지금 준비할 기회를 원한다면 어떻게 답하겠습니까?`,
    'vd-nocare-on':`예방·치료법이 없는 ${ids} 카드도 보고와 상담 대상에 남겼습니다. 듣지 않을 권리를 원하는 참여자에게 어떻게 설명하겠습니까?`,
    'vd-nocare-off':`예방·치료법이 없다는 이유로 ${ids} 카드를 보고와 상담에서 뺐습니다. 생활 계획을 위해 정보를 원하는 참여자에게 어떻게 설명하겠습니까?`,
    // N5: 켬에도 실제 영향 카드와 듣지 않을 권리의 반문을 포함한다.
    'vd-secondary-on':`2차 발견이라는 이유로는 ${ids} 카드를 보고와 상담에서 제외하지 않기로 했습니다. ${guidance} 목적 밖의 정보는 듣고 싶지 않다는 해당 참여자에게 어떻게 설명하겠습니까?`,
    'vd-secondary-off':`검사 목적과 무관하다는 이유로 2차 발견 표식 카드(${ids})를 보고와 상담에서 뺐습니다. ${guidance} 이런 정보도 받겠다고 동의한 참여자에게 어떻게 설명하겠습니까?`,
    'vd-policy-reason':'네 보고 정책을 함께 적용한 결과를 바탕으로, 다른 카드 묶음에서도 유지할 원칙을 한 문장으로 말해 주세요.',
    'vd-replanned':'결과를 본 뒤 기준을 다시 계획했습니다. 답을 보고 고친 기준은 이 12장에만 잘 맞는 과적합일 수 있습니다. 새 카드 묶음에서도 이 기준을 유지할 근거는 무엇입니까?',
    'vd-pi-unmoved':'‘검사한 변이 중 병원성 변이의 비율 π’를 바꿔 보지 않았습니다. 게임의 기본값을 실제 판독 대상 변이 집단의 비율로 볼 수 있습니까?',
    'vd-pi-moved':`검사한 변이 중 병원성 변이의 비율 π를 바꾸어 보았고, 확정값은 ${s.piPct.toFixed(1)}%입니다. 카드 분류는 그대로인데 양성예측도 범위가 달라지는 이유를 설명해 주세요.`,
    'vd-counter-capacity':'상담 인력이 절반으로 줄어 한 차례에 4건만 맡을 수 있다면, 원래 기준을 고치거나 유지할 이유를 말해 주세요.',
    'vd-divergent-system':'미확정 4장처럼 지금 자료로는 판단할 수 없는 정보를 다룰 제도를 저울과 문턱 밖에서 하나 제안해 보세요. 단계별 동의, 새 증거에 따른 재분류 통보, 상담 배분 규칙 등을 생각할 수 있습니다.'};
  return questionKeys(s).map(k=>text[k]);
}
function verifyQuestions(label,s) {
  const before=JSON.stringify(s), qs=m.questionsFromSnapshot(s), keys=qs.map(q=>q.k);
  check(`${label} 질문 키/순서`,keys,questionKeys(s));
  qs.forEach((q,i)=>check(`${label} ${q.k} 전문/보간`,q.q,questionTexts(s)[i]));
  qs.forEach(q=>check(`결함 8 ${label}/${q.k} 요청 하나`,requestCount(q.q),1));
  check(`${label} 질문 수`,qs.length,s.policyMode==='apply'?7:6);
  check(`${label} 세 습관 질문`,['vd-c1','vd-counter-capacity'].every(k=>keys.includes(k))&&keys.some(k=>k.startsWith('vd-error-'))&&qs.find(q=>q.k.startsWith('vd-error-')).q.endsWith('얻는 것과 잃는 것을 한 문장으로 말해 보세요.'),true);
  check(`${label} 키 유일`,new Set(keys).size,qs.length);
  check(`${label} 출처/시간 생략`,qs.every(q=>q.src===undefined&&q.time===undefined),true);
  check(`${label} 결정적 질문`,qs,plain(m.questionsFromSnapshot(s)));
  check(`${label} 질문 순수성`,JSON.stringify(s),before);
  check(`${label} state 어댑터`,m.questionKeys({game:{...s,locked:s}}),questionKeys(s));
  check(`${label} 무게0 문구`,qs[0].q.startsWith('무게를 모두 0으로 두어 증거에 무게를 두지 않았습니다.'),s.weights.every(w=>w===0));
  const pi=qs.find(q=>q.k.startsWith('vd-pi-'));
  if(s.piTouched&&!s.replannedAfterReveal) check(`${label} π 보간`,pi.q.includes(`확정값은 ${s.piPct.toFixed(1)}%입니다.`),true);
  if(keys.includes('vd-error-consult')) check(`${label} 상담 보간`,qs[1].q,
    `정책 적용 전 보고 분류에서는 병원성 ${oracle(s).r.TP}장만 바로 보고했고, 보고와 상담을 함께 세면 병원성 ${oracle(s).rc.TP}장과 비병원성 ${oracle(s).rc.FP}장이 상담 후 결정까지 올라왔습니다. 결정을 상담으로 미룬 이 기준이 얻는 것과 잃는 것을 한 문장으로 말해 보세요.`);
}
for(const [name,s] of Object.entries(cases)) test(`질문 ${name}`,()=>verifyQuestions(`8 ${name}`,s));
// 명세 4.2 독립 점수: [0,0,0,1,2]에서 P-01=5, P-03=6, P-04=5. 상담선 6이면 P-03만 후보다.
// 총괄 B: 미성년 스위치가 꺼져도 후보에서 빠지지 않아 2차 발견 양쪽을 물어야 한다.
test('N3·N5 2차 발견 실제 카드와 균형',()=>{
  for(const on of [true,false]) {
    const s=base({weights:[0,0,0,1,2],t1:7,t2:6,policyMode:'apply',policy:policy(on,false,false,false)});
    const q=m.questionsFromSnapshot(s)[3];
    verifyQuestions(`N3 자연 분류 2차 발견 ${on}`,s);
    check(`N5 ${on} 실제 영향 카드`,q.q.includes('P-03'),true);
    check(`N5 ${on} 상담선 아래 P-04는 질문에서 제외`,q.q.includes('P-04'),false);
    check(`N5 ${on} ACMG 조건 동일`,q.q.includes('참여자가 거부하지 않으면 조치 가능한 유전자에 한해 2차 발견'),true);
    check(`N5 ${on} 반문`,q.q.includes(on?'듣고 싶지 않다는':'받겠다고 동의한'),true);
  }
});
test('π 조작 질문',()=>verifyQuestions('8 C π 조작',base({piTouched:true,piPct:1})));
test('가계0 질문',()=>verifyQuestions('8 가계0',base({weights:[0,2,3,1,1]})));
test('예측 동률',()=>verifyQuestions('8 예측 동률',base({weights:[3,2,3,3,1]})));
test('수동 우선',()=>verifyQuestions('8 수동 우선',{...cases.D,overrides:cases.F.overrides}));
test('빈도 우선',()=>verifyQuestions('8 빈도 우선',base({weights:[1,3,2,1,1]})));
test('다시 계획 질문',()=>{const s=base({replannedAfterReveal:true,piTouched:true});verifyQuestions('8 다시 계획',s);
  check('8 다시 계획은 π 질문 대신',m.questionKeys({game:{...s,locked:s}}).filter(k=>/^vd-(pi|replanned)/.test(k)),['vd-replanned']);});
// 총괄 B: 네 스위치 각각을 뒤집어도 주제 키는 같다. 선택된 스위치만 켬/끔 접미사가 바뀐다.
// family 같은 정책 결과가 같은 상태라는 조건은 두지 않는다. 수동 변경·중복 표식도 포함한다.
test('정책 질문 네 스위치 대칭과 카드 갈등 우선',()=>{
  const fixtures=[...Object.values(cases), ...['P-01','P-03','P-04','P-08','P-09','P-11','P-12'].map(id=>
    base({t1:47,t2:46,overrides:{[id]:{to:'R',reason:'이 카드의 정책 갈등을 검토합니다.'}}}))];
  for(const input of fixtures) for(let bits=0;bits<16;bits++) {
    const s={...input,policyMode:'apply',policy:policy(...[0,1,2,3].map(k=>Boolean(bits&(1<<k))))};
    const q=m.questionsFromSnapshot(s)[3];
    check('B 카드 상태 독립 oracle',q.k,policyPick(s,oracle(s)).key);
    for(const field of ['secondary','minors','noCare','relatives']) {
      const other={...s,policy:{...s.policy,[field]:!s.policy[field]}};
      const next=m.questionsFromSnapshot(other)[3];
      check(`B ${field} 반전 주제 불변`,topic(next.k),topic(q.k));
      check(`B ${field} 반전 문안 방향`,next.k,policyPick(other,oracle(other)).key);
      if(topic(q.k)!==`vd-${field.toLowerCase()}`) check(`B ${field} 비선택 스위치 문안 불변`,next.q,q.q);
    }
    verifyQuestions('B 정책 양방향',s);
  }
  // 8.4 및 성찰 10절: P-04는 2차 발견이지만 조치 불가능하여 ACMG SF 권고 밖이다.
  for(const on of [true,false]) {
    const s=base({t1:47,t2:46,overrides:{'P-03':{to:'C',reason:'상담으로 남깁니다.'},'P-04':{to:'R',reason:'근거를 검토합니다.'}},policyMode:'apply',policy:policy(on,false,false,false)});
    const q=m.questionsFromSnapshot(s)[3];
    check('B 중복 표식도 2차 발견 양방향',q.k,`vd-secondary-${on?'on':'off'}`);
    check('ACMG 조치 불가 카드 명시',q.q.includes('예방·치료법이 없는 P-04 카드는 이 권고 밖입니다.'),true);
    check('두 카드 단수 지시어 없음',q.q.includes('이 카드의 참여자'),false);
    check('중복 표식 한 요청',requestCount(q.q),1);
  }
});
// 결함 9: 예시 가는 X1에서 미성년·혈족만 끈 혼합 정책. P-03의 [1,0,0,1]을 뺀 독립 합계.
test('가 예시 혼합 정책',()=>{
  const r=m.compute({...cases.X1,policy:policy(true,false,true,false)});
  check('결함 9 가 보고/조치/상담',[r.final.length,r.actions,r.demand,r.family.length],[11,[6,1,5,6],11,0]);
  check('결함 0·7 미확정 요청 별도 표시',r.uncertainActions,[2,0,2,2]);
  const snapshot={...cases.X1,policy:policy(true,false,true,false)};
  const recap=KCP.games['s-variant-desk'].recap(realm({game:{...snapshot,locked:snapshot}}));
  check('9 recap 미확정 요청 항목명',recap.find(x=>x.t==='조치 검토 요청').d.includes(
    '미확정 카드에서 나온 요청 정기 영상 검사 2건 / 예방적 수술 상담 0건 / 약물 2건 / 추가 가족 검사 2건'),true);
});
test('나 예시: 미성년 정책이 상담 칸에도 적용',()=>{const r=m.compute(cases.X2);
  check('M3 X2 P-03 상담 제외',[r.participantConsult.includes('P-03'),r.consultRemoved],[false,['P-03']]);});
test('미확정 질문',()=>check('8 확정 전',m.questionKeys({game:{}}),[]));
for(let bits=0;bits<16;bits++) for(const [name,input] of Object.entries(cases)) test(`정책 ${name}/${bits}`,()=>{
  const s={...input,policyMode:'apply',policy:policy(...[0,1,2,3].map(k=>Boolean(bits&(1<<k))))},r=m.compute(s),o=oracle(s);
  // 결함 0·7: 숨은 분류와 무관한 전체 요청 합과, 미확정 요청의 부분합을 각각 독립 검산.
  check(`결함 0·7 ${name}/${bits} 조치`,r.actions,o.actions);
  const u=cards.filter(v=>v.truth==='U'&&o.final.includes(v.id));
  check(`결함 0·7 ${name}/${bits} 미확정 부분합`,r.uncertainActions,[0,1,2,3].map(k=>u.reduce((sum,v)=>sum+v.a[k],0)));
  check(`5 ${name}/${bits} AND 필터`,r.final,o.final);
  check(`5 ${name}/${bits} 혈족`,r.family,o.family);
  check(`5 ${name}/${bits} 정책 PPV 불변`,r.ranges,plain(m.compute({...s,policyMode:'skip'}).ranges));
  check(`5 ${name}/${bits} 발병 행`,r.onset.map(v=>[v.key,m.pctRange(v.range)]),o.onset.map(v=>[v.key,pct(v.range)]));
  verifyQuestions(`8 ${name}/${bits}`,s);
});
test('6.5 자동 전수',()=>{
  let checked=0,minError=12,perfect=0;
  for(let n=0;n<1024;n++) {const w=Array.from({length:5},(_,k)=>(n>>(2*k))&3);
    for(let t=-31;t<=47;t++) {let err=0;
      for(const v of cards.filter(v=>v.truth!=='U')) {const score=v.e.reduce((a,e,k)=>a+e*w[k],0);
        if((m.classify(score,{t1:t,t2:t-1})==='R')!==(v.truth==='P')) err++;}
      minError=Math.min(minError,err);if(!err)perfect++;checked++;
    }
  }
  check('6.5 이진 조합 수',checked,80896);check('6.5 최소 FP+FN',minError,2);check('6.5 완전 구분',perfect,0);
});
// 검토 H1: 증거 하나만 쓸 때의 최소 오분류. 빈도만으로는 강한 근거 조합(최소 2)을 따라가지 못한다.
test('6.5 단일 증거',()=>{
  const best=k=>{let min=12;for(let t=-3;t<=4;t++){let e=0;for(const v of cards.filter(v=>v.truth!=='U')) if((v.e[k]>=t)!==(v.truth==='P')) e++;min=Math.min(min,e);}return min;};
  check('6.5 단일 증거 최소 오분류(가계·빈도·기능·예측·같은 위치)',[0,1,2,3,4].map(best),[2,4,2,4,2]);
  const appBest=k=>{let min=12;for(let t=-31;t<=47;t++){const w=[0,0,0,0,0];w[k]=1;const r=m.compute(base({weights:w,t1:t,t2:t-1}));min=Math.min(min,r.r.FP+r.r.FN);}return min;};
  check('6.5 앱 분류로 빈도만 쓴 최소 오분류',appBest(1),4);
});
test('경계/null',()=>{
  check('5 Wilson n0',m.wilson(0,0),null);check('5 Bayes 분모0',m.bayes(0,1,.01),null);
  check('5 U만 보고 PPV',m.compute(base({t1:47,t2:46,overrides:{'P-13':{to:'R',reason:'미확정 자료의 한계를 설명합니다.'}}})).ranges.r,null);
  check('5 현재 카드만 전부 양성 예외 금지',m.compute(base({weights:[3,3,3,3,3],t1:-21,t2:-22})).universal.r,false);
  check('5 가능한 최소 점수 바닥 −24에서 전부 양성',[m.compute(base({weights:[3,3,3,3,3],t1:-24,t2:-25})).universal.r,m.compute(base({weights:[3,3,3,3,3],t1:-23,t2:-24})).universal.r],[true,false]);
  // 결함 0·7: P-13 한 장의 요청 벡터는 [1,0,0,0].
  check('5 미확정 보고도 조치에 포함',m.compute(base({t1:47,t2:46,overrides:{'P-13':{to:'R',reason:'미확정 자료의 한계를 설명합니다.'}}})).actions,[1,0,0,0]);
  check('5 등호 T1',m.classify(12,base()),'R');// 결함 13: 기본 상담선 1의 등호와 바로 아래 0을 직접 검사.
  check('5 등호 T2',m.classify(1,base()),'C');check('5 T2 바로 아래',m.classify(0,base()),'N');
  check('5 원래 분모',m.fraction(6,6),'6/6');
});
// N3: 4^5 무게 × 일곱 문턱 값 중 T1>T2인 21쌍 × 16정책 = 344,064상태.
// 보고에 원래 표본의 문턱 범위가 없으므로 아래 표본을 명시해 재현 가능하게 센다.
// --distribution은 전수 집계가 필요할 때만 실행한다.
if(process.argv.includes('--distribution')) test('N3 정책 질문 전수 분포',()=>{
  const thresholds=[-30,-10,0,1,6,12,47], counts={};
  let total=0, wrong=0, conflict=0, symmetryErrors=0, flips=0;
  for(let n=0;n<1024;n++) {
    const weights=Array.from({length:5},(_,k)=>(n>>(2*k))&3);
    for(let hi=1;hi<thresholds.length;hi++) for(let lo=0;lo<hi;lo++) {
      const seed=base({weights,t1:thresholds[hi],t2:thresholds[lo],policyMode:'apply'});
      const r=oracle(seed), refusal=r.rows.some(v=>v.id==='P-01'&&v.group!=='N'), keys=[];
      for(let bits=0;bits<16;bits++) {
        const s={...seed,policy:policy(...[0,1,2,3].map(k=>Boolean(bits&(1<<k))))};
        const expected=policyPick(s,r), q=m.questionsFromSnapshot(s)[3];
        keys.push(q.k); counts[q.k]=(counts[q.k]||0)+1; total++;
        if(q.k!==expected.key || requestCount(q.q)!==1) wrong++;
        if(refusal) {conflict++; if(topic(q.k)!=='vd-relatives') wrong++;}
      }
      for(let bits=0;bits<16;bits++) for(let bit=0;bit<4;bit++) {
        flips++;
        if(topic(keys[bits])!==topic(keys[bits^(1<<bit)])) symmetryErrors++;
      }
    }
  }
  check('B 전수 네 스위치 반전 수',flips,344064*4);
  check('B 전수 네 스위치 주제 불변',symmetryErrors,0);
  check('N3 전수 상태 수',total,344064);
  check('N3 전수 우선순위·단일 요청 오류',wrong,0);
  // 명세 4.2: P-01 − P-11 = [5,1,4,2,3]. 무게가 음수가 아니므로 P-11이 R/C면 P-01도 R/C다.
  // 총괄 B의 거부 갈등 우선으로 수동 변경 없는 격자에서는 미성년 질문이 0건이다.
  check('B P-01 점수의 P-11 지배',vectors[0].map((v,k)=>v-vectors[10][k]),[5,1,4,2,3]);
  for(const suffix of ['on','off']) check(`B 자동 분류 미성년 ${suffix} 없음`,counts[`vd-minors-${suffix}`]||0,0);
  for(const k of ['relatives','nocare','secondary'])
    for(const suffix of ['on','off']) check(`N3 전수 ${k}/${suffix} 도달`,(counts[`vd-${k}-${suffix}`]||0)>0,true);
  for(const k of ['relatives','minors','nocare','secondary'])
    check(`B 전수 ${k} 켬/끔 수 동일`,counts[`vd-${k}-on`]||0,counts[`vd-${k}-off`]||0);
  console.log('N3 분포 '+JSON.stringify({thresholds,total,conflict,flips,symmetryErrors,counts}));
});
if(failed) {console.error(`통과 ${passed}건 · 실패 ${failed}건`);process.exitCode=1;}
else console.log(`통과 ${passed}건`);
