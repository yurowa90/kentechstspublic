// 검토 결함 8·15: 문구·태그 기대값은 요청 하나와 공통 습관 어휘로 갱신. 계산 허용 오차는 그대로 둔다.
/* 기대값 출처: 사용자 제공 구현 명세 v2의 5·6·8·12절.
 * 구현 소스는 vm 로드 및 공개 model API 호출에만 사용한다.
 * 실행: node tests/model_s-cement-carbon.mjs (의존성 없음)
 */
// N7: 직접 명령형까지 포함하고, 인용문 안의 물음은 요청에서 제외한다.
const requestCount = q => (q.replace(/“[^”]*”|‘[^’]*’/g, '').match(/[?？]|(?:주세요|[가-힣]+세요)[.!]/g) || []).length;
if (requestCount('말하세요. 적으세요! 설명하세요. 답은 무엇인가요?') !== 4 ||
    requestCount('“어떻게 하나요?”라는 반문에 답을 말해 주세요.') !== 1)
  throw new Error('N7 요청 수 검사 자체의 종결형·인용문 처리 실패');
import fs from 'node:fs';
import vm from 'node:vm';

let passed = 0;
const failures = [];
function check(id, actual, expected, tolerance = 0) {
  const ok = typeof expected === 'number'
    ? typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance
    : JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++;
  else failures.push(`${id}: 기대 ${JSON.stringify(expected)}, 실제 ${JSON.stringify(actual)}${tolerance ? `, 허용 오차 ${tolerance}` : ''}`);
}
function truth(id, value) { check(id, Boolean(value), true); }
function attempt(id, fn) {
  try { fn(); } catch (error) { failures.push(`${id}: ${error.stack || error}`); }
}

// app.js KCP.josa 계약과 같은 규칙을 검사 대역에 직접 구현한다.
function josa(word, pair) {
  const w = String(word).trim();
  const code = w.charCodeAt(w.length - 1);
  const jong = code >= 0xAC00 && code <= 0xD7A3 ? (code - 0xAC00) % 28 : null;
  const endings = {
    '을/를': ['을', '를', '을(를)'], '이/가': ['이', '가', '이(가)'],
    '은/는': ['은', '는', '은(는)'], '와/과': ['과', '와', '과(와)'],
    '이고/고': ['이고', '고', '이고'], '으로/로': ['으로', '로', '(으)로'],
  };
  if (!Object.hasOwn(endings, pair)) return w;
  return w + endings[pair][jong === null ? 2 : jong && !(pair === '으로/로' && jong === 8) ? 0 : 1];
}
const KCP = {
  esc: value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c])),
  games: {}, YEARS: {}, ORIGINAL_ORDER: [], ORDER: ['2022', '2023', '2024', '2025', '2026'], josa,
};
const sandbox = vm.createContext({window: {KCP}, console});
attempt('API 로드', () => vm.runInContext(fs.readFileSync(new URL('../games/s-cement-carbon.js', import.meta.url), 'utf8'), sandbox));
const model = KCP.games['s-cement-carbon']?.model;
// vm의 순수 객체 판정이 검사 대역의 realm에 영향을 받지 않게 입력을 vm 안에서 생성한다.
const realmJSON = vm.runInContext('JSON', sandbox);
const realm = value => realmJSON.parse(JSON.stringify(value));
const invoke = (name, ...args) => model[name](...args.map(realm));
const DEFAULT = {d:0,c:80,bio:0,elec:0,capture:0,mineral:0,syn:0,acct:0,support:false};
const PLANS = {
  A: {...DEFAULT},
  B: {...DEFAULT,d:30,c:50,bio:40,elec:30,capture:90,mineral:100},
  C: {...DEFAULT,c:75,bio:20,capture:90,mineral:10,support:true},
  D: {...DEFAULT,d:30,c:50,bio:40,elec:30,support:true},
  E: {...DEFAULT,d:10,c:65,bio:30,elec:10,capture:60,mineral:20,support:true},
  F: {...DEFAULT,d:25,c:65,bio:30,elec:10,capture:60,mineral:20,support:true},
  G0: {...DEFAULT,c:75,capture:60,syn:80},
  G1: {...DEFAULT,c:75,capture:60,syn:80,acct:100},
  C10: {...DEFAULT,d:10,c:75,bio:20,capture:90,mineral:10,support:true},
  D30: {...DEFAULT,d:30,c:50,bio:40,elec:30,capture:30,support:true},
  H: {...DEFAULT,d:5,c:75,bio:20,elec:10,capture:90},
  I: {...DEFAULT,capture:60,syn:90},
  // 포집 없이 세 미래 모두 목표 미달(52.7·38.8·51.3%)인 계획: 목표 대비 차이 질문이 개수 제한에서 빠지지 않아야 한다.
  D2: {...DEFAULT,d:30,c:50,support:true},
};
function locked(plan, value = 'below', revisited = false, criteria = ['sure','price']) {
  return {game: {version:1,plan:{...plan},step:2,fut:'smooth',dataTab:'baseline',criteria,
    prediction:{value,plan:{...plan}},predictDraft:value,revisited,oneLine:'가상 검사 계획',
    locked:{version:1,plan:{...plan},criteria,prediction:{value,plan:{...plan}},oneLine:'가상 검사 계획',revisited}}};
}

// 결함 2: 문구의 총량·원단위 비교를 독립 질량/에너지 수지로 확인했다.
// A: K=1.5, clay=.15, H=5.1, G0=K*.65*44/56+(H*.8+clay*2)*.095+H*.2*.085.
// C=.54*(G0-.056*K*.8)/(1-.168*.54); 물리=G0+.056*(3*C-K*.8)-C+.9*C*.0005.
// 간접=(.2+.1*C)*.35. 같은 수요 감축은 P=1.4,K=1.05,clay=0으로 독립 계산.
// B: K=.7,H=2.38,clay=.35,e=.1; 물리=.61797, 간접=(.14+H*.1/3.6)*.35.
attempt('결함 2 총량과 원단위',()=>{
  const a=invoke('calc',PLANS.C,'delay'), b=invoke('calc',PLANS.D,'delay');
  const reduced=invoke('calc',{...PLANS.C,d:30},'delay');
  check('결함 2 A 총량',a.physical+a.indirect,.7032179892882281,1e-12);
  check('결함 2 B 총량',b.physical+b.indirect,.6901088888888889,1e-12);
  check('결함 2 같은 수요 감축 총량',reduced.physical+reduced.indirect,.4817399859889143,1e-12);
  check('결함 2 A 원단위',(a.physical+a.indirect)/2,.35160899464411405,1e-12);
  check('결함 2 B 원단위',(b.physical+b.indirect)/1.4,.4929349206349206,1e-12);
});

// 6.2: 행 순서와 6사례의 252칸. 6자리 표의 반올림 허용 오차만 적용한다.
const INTERMEDIATE = {
  P:[2,1.4,2,1.4,2,2], need:[.4,.7,.5,.7,.5,.5], scm:[.4,.45,.45,.45,.45,.45],
  clay:[0,.25,.05,.25,.05,.05], K:[1.6,.7,1.5,.7,1.5,1.5], cActual:[.8,.5,.75,.5,.75,.75],
  e:[0,.3,0,.3,0,0], coalShare:[1,.3,.8,.3,1,1], H:[5.44,2.38,5.1,2.38,5.1,5.1],
  process:[.817143,.357500,.766071,.357500,.766071,.766071],
  coal:[.516800,.115330,.397100,.115330,.494000,.494000], bio:[0,.080920,.086700,.080920,0,0],
  G0:[1.333943,.553750,1.249871,.553750,1.260071,1.260071], Hw:[1.28,.56,1.2,.56,1.2,1.2],
  r:[0,.81,.81,0,.54,.54], X:[0,.050924,.119088,0,.051814,.051814],
  G:[1.333943,.604674,1.368959,.553750,1.311886,1.311886],
  C:[0,.489786,1.108857,0,.708418,.708418], stack:[1.333943,.114888,.260102,.553750,.603467,.603467],
  mineral:[0,.1,.1,0,0,0], overflow:[0,.389786,.010886,0,0,0], syn:[0,0,0,0,.566735,.566735],
  store:[0,.389786,1.008857,0,.141684,.141684], leak:[0,.000004,.000010,0,.000001,.000001],
  retained:[0,.389782,1.008847,0,.141682,.141682], h2:[0,0,0,0,.077282,.077282],
  heatPower:[0,.198333,0,.198333,0,0], compressPower:[0,.048979,.110886,0,.070842,.070842],
  h2Power:[0,0,0,0,4.250510,4.250510], basePower:[.2,.14,.2,.14,.2,.2],
  power:[.2,.387312,.310886,.338333,4.521351,4.521351], extra:[0,.187312,.110886,.138333,4.321351,4.321351],
  indirect:[.03,.058097,.046633,.050750,.678203,.678203], bioCredit:[0,.007687,.008236,.040460,0,0],
  ledger:[1.333943,.107201,.251866,.513290,1.170202,.603467],
  reduction:[0,91.963624,81.118697,61.520840,12.274950,54.760624],
  gap:[-60,31.963624,21.118697,1.520840,-47.725050,-5.239376],
  physical:[1.333943,.114892,.260112,.553750,1.170203,1.170203], supportCost:[0,0,8,5.6,0,0],
  price:[0,16.762476,25.496286,7.325429,22.702701,22.702701],
  carbonIn:[.363803,.164911,.373353,.151023,.357787,.357787],
  carbonOut:[.363803,.164911,.373353,.151023,.357787,.357787],
};
// 6.3: reduction/gap/physical/power/extra/indirect/price, 뒤의 C/E/M은 경고 조건.
const FINAL = {
  A:['0.0|−60.0|1.334|0.200|0.000|0.030|0.0|','−3.6|−63.6|1.381|0.200|0.000|0.050|1.6|','−0.7|−60.7|1.343|0.200|0.000|0.070|0.3|'],
  B:['92.0|+32.0|0.115|0.387|0.187|0.058|16.8|M','89.6|+29.6|0.149|0.458|0.258|0.115|22.6|CM','79.1|+19.1|0.297|0.241|0.041|0.084|12.7|EM'],
  C:['81.1|+21.1|0.260|0.311|0.111|0.047|25.5|M','80.2|+20.2|0.273|0.316|0.116|0.079|28.5|M','55.9|−4.1|0.608|0.271|0.071|0.095|18.6|'],
  D:['61.5|+1.5|0.554|0.338|0.138|0.051|7.3|','50.1|−9.9|0.717|0.395|0.195|0.099|9.2|C','56.7|−3.3|0.618|0.206|0.006|0.072|7.1|E'],
  E:['67.3|+7.3|0.459|0.344|0.144|0.052|17.3|M','62.6|+2.6|0.525|0.364|0.164|0.091|20.4|CM','55.1|−4.9|0.631|0.326|0.126|0.114|14.1|'],
  F:['73.3|+13.3|0.375|0.286|0.086|0.043|16.4|','70.7|+10.7|0.411|0.293|0.093|0.073|20.0|C','63.2|+3.2|0.519|0.271|0.071|0.095|13.5|'],
  G0:['12.3|−47.7|1.170|4.521|4.321|0.678|22.7|','8.1|−51.9|1.226|4.728|4.528|1.182|25.7|','10.3|−49.7|1.197|3.033|2.833|1.061|15.6|'],
  G1:['54.8|−5.2|1.170|4.521|4.321|0.678|22.7|','52.6|−7.4|1.226|4.728|4.528|1.182|25.7|','38.1|−21.9|1.197|3.033|2.833|1.061|15.6|'],
  C10:['83.1|+23.1|0.232|0.279|0.079|0.042|25.0|','82.2|+22.2|0.245|0.284|0.084|0.071|28.3|M','60.6|+0.6|0.544|0.244|0.044|0.085|18.3|'],
  D30:['71.9|+11.9|0.404|0.353|0.153|0.053|11.4|','63.6|+3.6|0.524|0.414|0.214|0.104|14.5|C','64.5|+4.5|0.507|0.217|0.017|0.076|10.1|E'],
  H:['82.9|+22.9|0.236|0.425|0.225|0.064|21.1|','82.0|+22.0|0.249|0.431|0.231|0.108|24.3|','59.99|−0.01|0.553|0.389|0.189|0.136|14.7|'],
  I:['1.6|−58.4|1.313|5.335|5.135|0.800|25.0|','−2.2|−62.2|1.363|5.528|5.328|1.382|27.6|','2.2|−57.8|1.305|3.538|3.338|1.238|16.6|'],
};
const futures = ['smooth','scarce','delay'];
attempt('12.1-메타', () => {
  for (const name of ['calc','captureShare','reaches','fmt','fmtRed','fmtGap','questions']) truth(`API ${name}`, typeof model?.[name] === 'function');
  for (const name of ['brief','renderPrep','questions','recap','reflectExtra']) truth(`등록 ${name}`, typeof KCP.games['s-cement-carbon'][name] === 'function');
  check('original', KCP.YEARS['s-cement-carbon'].original, true);
  check('prep', KCP.YEARS['s-cement-carbon'].prep, 25);
  check('answer', KCP.YEARS['s-cement-carbon'].answer, 15);
  check('rubric', Object.values(KCP.YEARS['s-cement-carbon'].rubric).map(a=>a.length), [3,3,3]);
  check('intent', KCP.YEARS['s-cement-carbon'].intent.length, 5);
  check('ORIGINAL_ORDER', KCP.ORIGINAL_ORDER.filter(x=>x==='s-cement-carbon').length, 1);
  check('ORDER', KCP.ORDER, ['2022','2023','2024','2025','2026']);
});
for (const [i,name] of ['A','B','C','D','G0','G1'].entries()) attempt(`6.2 ${name}`, () => {
  const r = invoke('calc', PLANS[name], 'smooth');
  for (const [key,values] of Object.entries(INTERMEDIATE)) check(`6.2 ${name}.${key}`, r[key], values[i], .0000005 + 1e-15);
});
for (const [name,rows] of Object.entries(FINAL)) for (const [i,row] of rows.entries()) attempt(`6.3 ${name}.${futures[i]}`, () => {
  const r = invoke('calc', PLANS[name], futures[i]);
  const values = row.split('|');
  for (const [j,key] of ['reduction','gap','physical','power','extra','indirect','price'].entries()) {
    // 경계값은 5.3의 내림 표시 계약이므로 fmtRed/fmtGap을 문자열로 비교한다.
    if (key === 'reduction' || key === 'gap') check(`6.3 ${name}.${futures[i]}.${key}`, invoke(key==='reduction'?'fmtRed':'fmtGap',r[key]), values[j]);
    else check(`6.3 ${name}.${futures[i]}.${key}`, r[key], Number(values[j]), key==='price' ? .05+1e-14 : .0005+1e-14);
  }
  check(`6.3 ${name}.${futures[i]}.경고`, `${r.warnC?'C':''}${r.warnE?'E':''}${r.overflow>1e-12?'M':''}`, values[7]);
});
attempt('6.3 추가 경계', () => {
  const b = invoke('calc',PLANS.B,'scarce');
  check('B 원료 cActual',b.cActual,.642857142857,.5e-12);
  check('B 원료 clay',b.clay,.350,1e-12); check('B 원료 mineral',b.mineral,.100,1e-12);
  check('B 원료 store',b.store,.534814582699,.5e-12);
  const t=invoke('calc',PLANS.B,'delay');
  check('B 지연 e',t.e,.1,1e-12); check('B 지연 coalShare',t.coalShare,.5,1e-12);
  const h=invoke('calc',PLANS.H,'delay');
  check('H 반올림 전 값',h.reduction,59.997371238515,.5e-12);
  check('H reaches',invoke('reaches',h),false);
  check('fmtRed(60)',invoke('fmtRed',60),'60.0'); check('fmtGap(0)',invoke('fmtGap',0),'0.0');
  check('reaches(60)',invoke('reaches',{reduction:60}),true);
  check('기여 없음',invoke('captureShare',PLANS.A),null);
  check('I 포집 기여',invoke('captureShare',PLANS.I),100,1e-12);
  check('음의 작은 0',invoke('fmt',-1e-16,3),'0.000');
  // 학생 화면의 음수 기호는 fmtRed·fmtGap·signed 모두 −(U+2212)로 같다.
  check('음수 기호 fmtRed',invoke('fmtRed',-3.6),'−3.6'); check('음수 기호 signed',invoke('signed',-.05,3),'−0.050');
  check('음수 기호 fmtGap',invoke('fmtGap',-63.6),'−63.6');
  // 포집 기여 표시: 포집이 장부 배출을 늘리면 음의 백분율 대신 늘어난 양을 적는다.
  const synAll={...DEFAULT,d:5,elec:10,capture:90,syn:100};
  check('포집 증가 계획의 원시 몫은 음수',invoke('captureShare',synAll)<0,true);
  check('포집 증가 표시',invoke('captureShareText',synAll),'포집이 장부 배출을 0.113 Mt/년 늘림(포집만 끈 같은 계획 대비)');
  check('포집 증가·기준 초과 표시',invoke('captureShareText',{...DEFAULT,capture:90,syn:100}),'포집이 장부 배출을 0.127 Mt/년 늘림(포집만 끈 같은 계획 대비)');
  check('포집 기여 없음 표시',invoke('captureShareText',PLANS.A),'계산하지 않음: 기준 대비 장부 배출 감소 없음');
  check('포집 기여 정상 표시',invoke('captureShareText',PLANS.I),'100.0%');
  // 물리적 대기 배출의 현재 대비 변화와 간접 배출 포함 합계. 장부는 줄었는데 실제 배출이 늘면 드러낸다.
  const rise=invoke('calc',{...DEFAULT,capture:90,syn:100,acct:100},'smooth');
  check('역전 계획 장부 감축',invoke('fmtRed',rise.reduction),'79.2');
  check('역전 계획 물리 배출',rise.physical,1.461088,.0000005); check('역전 계획 간접',rise.indirect,1.379168,.0000005);
  check('역전 표시',invoke('physicalLine',rise),'현재 1.334 대비 +0.127 Mt/년 · 장부상 감축과 달리 실제 대기 배출은 늘어남 · 전력 간접 배출을 더하면 2.840 Mt/년');
  check('증가 표시',invoke('physicalLine',invoke('calc',PLANS.A,'scarce')),'현재 1.334 대비 +0.048 Mt/년 · 현재보다 늘어남 · 전력 간접 배출을 더하면 1.431 Mt/년');
  check('감소 표시',invoke('physicalLine',invoke('calc',PLANS.C,'smooth')),'현재 1.334 대비 −1.074 Mt/년 · 전력 간접 배출을 더하면 0.307 Mt/년');
  // 경계 비교(성찰 자료): 기술 지연에서 공장 경계 순위와 간접 배출 포함 순위가 뒤집힌다.
  let noCapPhys=Infinity,noCapTotal=Infinity;
  for(let d=0;d<=30;d+=5) for(let c=50;c<=80;c+=5) for(let bio=0;bio<=40;bio+=10) for(let elec=0;elec<=30;elec+=10) {
    const r=invoke('calc',{...DEFAULT,d,c,bio,elec},'delay');
    noCapPhys=Math.min(noCapPhys,r.physical); noCapTotal=Math.min(noCapTotal,r.physical+r.indirect);
  }
  const cDelay=invoke('calc',PLANS.C,'delay');
  check('지연 포집없음 최소 물리',noCapPhys,.61797,.0005); check('지연 포집없음 최소 물리+간접',noCapTotal,.68958,.0005);
  check('지연 C 물리+간접',cDelay.physical+cDelay.indirect,.70318,.0005);
  truth('지연 경계 역전',cDelay.physical<noCapPhys&&cDelay.physical+cDelay.indirect>noCapTotal);
  const dDelay=invoke('calc',PLANS.D,'delay');
  check('지연 D 물리+간접',dDelay.physical+dDelay.indirect,.69010,.0005);
  check('C 총전력',futures.map(f=>invoke('fmt',invoke('calc',PLANS.C,f).power,3)),['0.311','0.316','0.271']);
  check('C 간접',futures.map(f=>invoke('fmt',invoke('calc',PLANS.C,f).indirect,3)),['0.047','0.079','0.095']);
  // 수요 감축만으로는 가격 영향이 바뀌지 않는다(화면·상수·한계에 공개한 단순화).
  check('수요 감축 가격 0',invoke('calc',{...DEFAULT,d:30},'smooth').price,0,1e-12);
});

// 면접 부담 조정: 공통 5개 + 개별 최대 2개(6~7개). 목표 미달 계획은 목표 대비 차이 질문이 맨 앞.
const QUESTION_CASES = [
  ['A','below',false,6,'cc-c4-choice',['cc-i-gap']],
  ['B','below',false,7,'cc-c4-union',['cc-i-jobs-nosupport','cc-i-scm']],
  ['C','below',false,7,'cc-c4-env',['cc-i-capture','cc-i-storage']],
  ['D','below',false,7,'cc-c4-union',['cc-i-jobs-support','cc-i-scm']],
  ['E','below',false,7,'cc-c4-env',['cc-i-capture','cc-i-scm']],
  ['F','below',false,7,'cc-c4-union',['cc-i-jobs-support','cc-i-scm']],
  ['G0','below',false,7,'cc-c4-env',['cc-i-gap','cc-i-ledger-0']],
  ['G1','below',false,7,'cc-c4-env',['cc-i-gap','cc-i-ledger-100']],
  ['C10','reach',false,7,'cc-c4-env',['cc-i-capture','cc-i-storage']],
  ['D30','reach',false,7,'cc-c4-union',['cc-i-jobs-support','cc-i-scm']],
  ['H','reach',false,7,'cc-c4-env',['cc-i-capture','cc-i-storage']],
  ['I','below',false,7,'cc-c4-env',['cc-i-gap','cc-i-ledger-0']],
  ['D','below',true,7,'cc-c4-union',['cc-i-jobs-support','cc-i-scm']],
  ['D2','below',false,7,'cc-c4-union',['cc-i-gap','cc-i-jobs-support']],
];
for (const [name,value,revisited,count,c4,individual] of QUESTION_CASES) attempt(`8 ${name}/${value}/${revisited}`, () => {
  const qs=invoke('questions',locked(PLANS[name],value,revisited));
  check(`8 ${name} 문항수`,qs.length,count);
  check(`8 ${name} 공통 순서`,qs.slice(0,5).map(q=>q.k), ['cc-c1','cc-c2',name==='H'?'cc-c3-diff':name==='B'||name==='F'?'cc-c3-diff':'cc-c3-match',c4,'cc-c5-outside']);
  check(`8 ${name} 후보 순서`,qs.slice(5).map(q=>q.k),individual);
  check(`8 ${name} 핵심 표시`,qs.map(q=>/기준 먼저|고침·유지와 이유/.test(q.tag)),[true,false,false,true,false,...individual.map(()=>false)]);
  // 결함 8: 인용한 반문을 제외하고 물음표와 요청 종결을 함께 세어 정확히 하나인지 검사.
  truth(`8 ${name} 카드당 요청 하나`,qs.every(q=>requestCount(q.q)===1));
  check(`8 ${name} 고유 k`,new Set(qs.map(q=>q.k)).size,qs.length);
  truth(`8 ${name} plain/src/유한 문구`,qs.every(q=>!Object.hasOwn(q,'src')&&!/<[^>]*>|NaN|undefined/.test(q.q)));
  check(`8 ${name} 재예측`,qs[2].q.startsWith('결과를 본 뒤 다시 한 예측입니다.'),revisited);
  // 명세 5절 목표 판정·8절 예측: H는 반올림 전 목표 미달이므로 도달 예측과 다르다.
  if(name==='H') truth('8 H 경계 문구',qs[2].q.includes('장부상 감축률은 59.99%이며, 목표 도달 여부는 예측과 달랐습니다')&&!qs[2].q.includes('60.0%'));
  // I류 상승 계획은 목표 미달이라 목표 대비 차이·장부 질문이 먼저 오고 포집 의존 질문은 개수 제한으로 빠진다.
  if(name==='I') truth('8 I 목표 차이 우선',qs[5].q.includes('장부상 감축률은 1.6%, 목표 대비 차이는 −58.4%p')&&!qs.some(q=>q.k==='cc-i-capture'));
  if(name==='C') truth('8 C 포집 의존 하락 분기',qs.find(q=>q.k==='cc-i-capture').q.includes('순조 81.1%, 기술 지연 55.9%로 25.2%p 낮아집니다'));
  if(name==='D2') truth('8 D2 목표 차이 수치',qs[5].q.includes('장부상 감축률은 52.7%, 목표 대비 차이는 −7.3%p'));
  if(name==='C10'||name==='D30'||name==='D') truth(`8 ${name} 예측 수치`,qs[2].q.includes(`${name==='C10'?'60.6':name==='D30'?'64.5':'56.7'}%`));
});
// N2: 예시 B의 중복 원단위 문장을 뺀 실제 길이와 세 예시의 균형 계약을 유지한다.
attempt('N2 예시 길이 계약',()=>{
  const html=KCP.games['s-cement-carbon'].reflectExtra(realm(locked(PLANS.A)));
  const examples=[...html.matchAll(/<details class="reveal cc-example">([\s\S]*?)<\/details>/g)];
  const lengths=examples.map(([,body])=>[...body.matchAll(/<p>([\s\S]*?)<\/p>/g)]
    .reduce((sum,[,p])=>sum+p.replace(/<[^>]+>/g,'').length,0));
  check('N2 실제 예시 본문 길이',lengths,[906,928,890]);
  truth('N2 예시 길이 비율 ≤ 1.05',Math.max(...lengths)/Math.min(...lengths)<=1.05);
  truth('N2 원단위 수치는 예시 B에서 제외',!examples[1][1].includes('0.493'));
});
attempt('8 기타 분기', () => {
  for (const [name,p,key] of [
    ['바이오만30',{...DEFAULT,bio:30},'cc-i-bio'],
    ['수요15 지원끔',{...DEFAULT,d:15},'cc-i-jobs-nosupport'],
    ['광물화100 포집0',{...DEFAULT,mineral:100},'cc-i-gap'],
    ['인정50',{...PLANS.G0,acct:50},'cc-i-ledger-50'],
  ]) {
    const qs=invoke('questions',locked(p));
    truth(`8 ${name} 후보`,qs.some(q=>q.k===key));
    truth(`8 ${name} 6~7문항`,qs.length>=6&&qs.length<=7);
  }
  check('미확정 questions',invoke('questions',{game:{version:1,plan:DEFAULT}}),[]);
  for (const [key,title,wa,ul] of [['sure','확실한 감축','과','을'],['local','일자리·지역 경제','와','를'],['price','가격 부담','과','을'],['risk','기술 위험 분산','과','을'],['honest','장부와 실제의 일치','와','를']]) {
    const other=key==='sure'?'price':'sure';
    truth(`조사 ${key} 첫째`,invoke('questions',locked(PLANS.A,'below',false,[key,other]))[0].q.includes(`${title}’${wa}`));
    // N4·N6: 둘째 기준 뒤 목적격 조사 대신 두 기준 가운데 우선순위를 먼저 밝힌다.
    truth(`기준 ${key} 둘째`,invoke('questions',locked(PLANS.A,'below',false,[other,key]))[0].q.includes(`${title}’ 가운데 어떤 기준을 앞세웠는지 먼저 밝히고`));
  }
});

// 6.4 전수: 명세 루프를 재현한다. 각 오류 유형의 첫 사례와 발생 건수를 남긴다.
// 수백만 건 실패가 생겨도 출력 자체가 검사를 마비시키지 않게 유형별 집계한다.
attempt('6.4 전수/파레토/질문', () => {
  const defects=new Map(), record=(key,ok,p,f)=>{
    if(ok) return;
    const item=defects.get(key)||{count:0,first:JSON.stringify(p)+` / ${f}`}; item.count++; defects.set(key,item);
  };
  let plans=0,evals=0,maxError=0,minDen=1,near=0,meet=0,nearBoundary=0,rising=0;
  const histogram={6:0,7:0}, robust={0:0,30:0,60:0,90:0}, points=[];
  const noCaptureMax=[-Infinity,-Infinity,-Infinity];
  const p=realm(DEFAULT), state=realm(locked(DEFAULT));
  for(let d=0;d<=30;d+=5) for(let c=50;c<=80;c+=5)
  for(let bio=0;bio<=40;bio+=10) for(let elec=0;elec<=30;elec+=10)
  for(const capture of [0,30,60,90]) {
    Object.assign(p,{d,c,bio,elec,capture,mineral:0,syn:0,acct:0,support:false});
    const stepResults=futures.map(f=>model.calc(p,f));
    if(!capture) {
      if(stepResults[0].reduction>=55) near++;
      if(stepResults[0].reduction>=60) meet++;
      stepResults.forEach((r,i)=>noCaptureMax[i]=Math.max(noCaptureMax[i],r.reduction));
    }
    // 별도 고정점 반복은 닫힌 식의 구현을 다시 복사하지 않는다.
    for(const [i,r] of stepResults.entries()) {
      let x=0;
      for(let n=0;n<100;n++) x=.056*Math.max(0,3*r.r*(r.G0+x)-r.Hw);
      record('추가 가스 고정점',Math.abs(r.X-x)<1e-12,p,futures[i]);
    }
    for(let mineral=0;mineral<=100;mineral+=10) for(let syn=0;syn<=100-mineral;syn+=10) {
      Object.assign(p,{mineral,syn,acct:0,support:true});
      const rr=futures.map(f=>model.calc(p,f));
      points.push({d,capture,x:Math.round(Math.max(...rr.map(r=>r.physical+r.indirect))*1e9)/1e9,
        y:Math.round(Math.max(...rr.map(r=>r.price))*1e9)/1e9,z:-rr[0].P});
      if(rr.every(r=>model.reaches(r))) robust[capture]++;
      for(const acct of [0,50,100]) for(const support of [false,true]) {
        Object.assign(p,{acct,support}); plans++;
        let boundary=false;
        for(const [i,f] of futures.entries()) {
          const r=model.calc(p,f); evals++;
          record('유한 반환값',Object.values(r).every(v=>typeof v!=='number'||Number.isFinite(v)),p,f);
          maxError=Math.max(maxError,Math.abs(r.balance));
          record('탄소 보존',Math.abs(r.carbonIn-r.carbonOut)<1e-9&&Math.abs(r.balance)<1e-12,p,f);
          record('행선지 보존',Math.abs(r.C-r.store-r.mineral-r.syn)<1e-12,p,f);
          record('열 보존',Math.abs(r.X/.056-Math.max(0,3*r.C-r.Hw))<1e-12,p,f);
          record('물량 경계',r.ledger>=-1e-12&&r.store>=-1e-12&&r.clay<=.35+1e-12&&r.mineral<=.1+1e-12,p,f);
          record('장부 물리 불변',Math.abs(r.physical-rr[i].physical)<1e-12&&Math.abs(r.power-rr[i].power)<1e-12,p,f);
          record('지원 +4%p',Math.abs((r.price-rr[i].price)-(support?0:-4))<1e-12,p,f);
          record('장부-물리 차이',Math.abs(r.physical-r.ledger-r.bioCredit-r.syn*acct/100-r.leak)<1e-12,p,f);
          minDen=Math.min(minDen,1-r.r*3*.056);
          boundary ||= r.reduction>=59.95&&r.reduction<60;
        }
        if(boundary) nearBoundary++;
        Object.assign(state.game.locked.plan,p);
        Object.assign(state.game.locked.prediction.plan,p);
        const qs=model.questions(state), keys=qs.map(q=>q.k);
        histogram[qs.length]=(histogram[qs.length]||0)+1;
        record('질문 6~7/고유/src/plain',qs.length>=6&&qs.length<=7&&new Set(keys).size===qs.length&&
          qs.every(q=>!Object.hasOwn(q,'src')&&!/NaN|undefined|<[^>]*>/.test(q.q))&&keys[4]==='cc-c5-outside',p,'전체');
        record('목표 미달이면 목표 차이 질문',model.reaches(model.calc(p,'smooth'))||keys[5]==='cc-i-gap',p,'전체');
        record('포집 기여 표시에 음의 백분율 없음',!/[−-]\d[\d.]*%/.test(model.captureShareText(p)),p,'전체');
        if(qs.some(q=>q.k==='cc-i-capture'&&q.q.includes('높아집니다'))) rising++;
      }
    }
  }
  for(const [key,item] of defects) failures.push(`6.4 ${key}: 실패 ${item.count}건, 첫 사례 ${item.first}`);
  if(defects.size===0) passed+=10;
  check('6.4 plans',plans,1552320); check('6.4 evals',evals,4656960);
  check('6.4 near',near,34); check('6.4 meet',meet,2);
  truth('6.4 탄소 최대 오차',maxError<=1e-12); check('6.4 최소 분모',minDen,.86392,1e-12);
  check('6.4 질문 분포',histogram,{6:30438,7:1521882});
  check('6.4 경계 계획',nearBoundary,4666);
  check('6.4 전 미래 도달',robust,{0:0,30:264,60:7156,90:23250});
  for(const [i,max] of noCaptureMax.entries()) check(`6.4 포집0 최댓값 ${futures[i]}`,max,[61.5,50.1,56.7][i],.05);
  // 상승 계획(I류, 장부·지원 조합 포함 4개)은 모두 순조 목표 미달이다. 목표 대비 차이와 장부 질문이
  // 먼저 오므로 개수 제한(개별 2개)에서 '높아집니다' 포집 의존 질문은 나오지 않는다.
  check('6.4 의존 질문 상승 계획',rising,0);
  const unique=new Map();
  for(const a of points) {const k=[a.x,a.y,a.z].join('|'); if(!unique.has(k)) unique.set(k,a);}
  const ordered=[...unique.values()].sort((a,b)=>a.x-b.x||a.y-b.y||a.z-b.z), best=Array(7).fill(Infinity), front=[];
  for(const a of ordered) {
    const i=a.d/5; let dominated=false;
    for(let j=0;j<=i;j++) if(best[j]<=a.y) {dominated=true;break;}
    if(!dominated) front.push(a);
    best[i]=Math.min(best[i],a.y);
  }
  const byCapture={}; for(const a of front) byCapture[a.capture]=(byCapture[a.capture]||0)+1;
  check('6.4 후보',points.length,258720); check('6.4 고유',unique.size,75587); check('6.4 파레토',front.length,523);
  check('6.4 파레토 포집별',byCapture,{0:173,30:274,60:51,90:25});
  for(const [p0,x,y,z] of [
    [{...PLANS.D},.816142857,9.226571429,1.4],
    [{...PLANS.D30,mineral:60},.627293872,14.626893367,1.4],
    [{...PLANS.D,elec:0,capture:60,mineral:50},.472237031,19.503575077,1.4],
    [{...PLANS.D,elec:0,capture:90,mineral:30},.369995165,26.633784351,1.4],
  ]) {
    const rr=futures.map(f=>invoke('calc',p0,f));
    check('6.4 대표 최악배출',Math.max(...rr.map(r=>r.physical+r.indirect)),x,.5e-9);
    check('6.4 대표 최악가격',Math.max(...rr.map(r=>r.price)),y,.5e-9);
    check('6.4 대표 생산',rr[0].P,z,1e-12);
  }
});

for(const failure of failures) console.error(`실패 ${failure}`);
console.log(`통과 ${passed}건${failures.length ? ` · 실패 ${failures.length}건` : ''}`);
process.exitCode=failures.length ? 1 : 0;
