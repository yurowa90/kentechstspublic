// 검토 결함 8·15: 문구·태그 기대값은 요청 하나와 공통 습관 어휘로 갱신. 계산 허용 오차는 그대로 둔다.
// 기대값: 사용자 제공 수정 명세 4.2, 5, 6, 8, 12절. 구현 계산을 복제하지 않는다.
// N7: 직접 명령형까지 포함하고, 인용문 안의 물음은 요청에서 제외한다.
const requestCount = q => (q.replace(/“[^”]*”|‘[^’]*’/g, '').match(/[?？]|(?:주세요|[가-힣]+세요)[.!]/g) || []).length;
if (requestCount('말하세요. 적으세요! 설명하세요. 답은 무엇인가요?') !== 4 ||
    requestCount('“어떻게 하나요?”라는 반문에 답을 말해 주세요.') !== 1)
  throw new Error('N7 요청 수 검사 자체의 종결형·인용문 처리 실패');
import fs from 'node:fs';
import vm from 'node:vm';

const KCP = {
  games: {}, YEARS: {}, ORIGINAL_ORDER: [],
  esc: value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]),
  // app.js와 동일한 종성/ㄹ/비한글 규칙을 독립적으로 구현한다.
  josa(word, pair) {
    const w = String(word).trim();
    const code = w.charCodeAt(w.length - 1);
    const final = code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 : null;
    const endings = {
      '을/를': ['을', '를', '을(를)'], '이/가': ['이', '가', '이(가)'],
      '은/는': ['은', '는', '은(는)'], '와/과': ['과', '와', '과(와)'],
      '이고/고': ['이고', '고', '이고'], '으로/로': ['으로', '로', '(으)로']
    };
    const options = endings[pair];
    if (!options) return w;
    const index = final === null ? 2 : final !== 0 && !(pair === '으로/로' && final === 8) ? 0 : 1;
    return w + options[index];
  }
};
let passed = 0;
const failures = [];
function check(label, actual, wanted, tolerance = 0) {
  const ok = typeof wanted === 'number'
    ? Number.isFinite(actual) && Math.abs(actual - wanted) <= tolerance + 1e-12
    : JSON.stringify(actual) === JSON.stringify(wanted);
  if (ok) passed++;
  else failures.push(`${label}: 기대 ${JSON.stringify(wanted)}, 실제 ${JSON.stringify(actual)}`);
}
function test(label, fn) {
  try { fn(); } catch (error) { failures.push(`${label}: ${error.stack || error}`); }
}
test('모듈 로드', () => vm.runInNewContext(
  fs.readFileSync(new URL('../games/s-island-grid.js', import.meta.url), 'utf8'),
  { window: { KCP }, console }, { filename: 's-island-grid.js' }
));
const game = KCP.games['s-island-grid'];
const model = game?.model;
const clone = x => JSON.parse(JSON.stringify(x));
const scenarios = ['S1', 'S2', 'S3'];
const plan = (bat, n, dr, shed, curt) => ({
  bat, n, dr: Array.from({ length: 8 }, (_, b) => dr.includes(b)), shed, curt, weights: [3, 1.5]
});
const plans = {
  Z: plan(Array(8).fill(0), Array(8).fill(0), [], 'R1', 'C1'),
  H: plan(Array(8).fill(4), Array(8).fill(3), [3, 4], 'R3', 'C1'),
  A: plan([0,0,0,3,2,0,-2,-2], [3,2,1,1,2,3,3,3], [4,5], 'R1', 'C1'),
  B: plan([-1,-1,0,4,4,-1,-2,-2], [2,2,1,0,0,2,3,3], [4,5], 'R2', 'C2'),
  C: plan([0,0,0,2,0,0,-1,0], [3,2,1,1,1,3,3,3], [4,5], 'R3', 'C1'),
  Bprime: plan([-1,-1,0,4,4,-1,-2,-2], [2,2,1,0,1,2,3,3], [4,5], 'R2', 'C2')
};
// 명세 6.2 두 표 전체. 숫자는 명세에 표시된 여섯 자리의 반올림 오차만 허용.
const fields = ['ch','dis','u','heat','diesel','co2','curt','soc','delta',
  'dcharge','cost','ext','coop','h','starts','corrections'];
const oracle = {
  Z: [
    [0,0,89.134200,9.489557,0,0,18.996000,8,0,0,0,13.297200,5.698800,0,0,[]],
    [0,0,119.144574,39.269100,0,0,10.752000,8,0,0,0,7.526400,3.225600,0,0,[]],
    [0,0,94.515000,40.858736,0,0,12.717600,8,0,0,0,8.902320,3.815280,0,0,[]]
  ],
  H: [
    [8.421053,0,0,0,122.992853,92.244639,53.433600,16,8,8.421053,135.413905,37.403520,16.030080,24,3,[]],
    [8.421053,0,0,0,139.503227,104.627420,31.689600,16,8,8.421053,151.924279,22.182720,9.506880,24,3,[]],
    [8.421053,0,.062400,.075771,128.311253,96.233439,47.155200,16,8,8.421053,140.732305,33.008640,14.146560,24,3,[]]
  ],
  A: [
    [8.421053,12,0,0,87.406200,65.554650,29.846947,3.368421,-4.631579,0,104.427253,20.892863,8.954084,18,5,[]],
    [8.421053,12,0,0,102.582174,76.936631,6.768547,3.368421,-4.631579,0,119.603227,4.737983,2.030564,18,5,[]],
    // dcharge: 옛 평균 배정 0.683453 → 한계 기준 0. b3은 디젤 최소 출력·출력제한 중이라 충전해도 디젤이 늘지 않음.
    [8.421053,12,0,0,89.801400,67.351050,20.582947,3.368421,-4.631579,0,106.822453,14.408063,6.174884,18,5,[]]
  ],
  B: [
    [15.069252,18,0,0,69.406200,52.054650,11.198748,3.368421,-4.631579,0,87.059663,11.198748,0,15,5,[3,5]],
    [10.752000,15.783680,9.484800,6.731148,86.313694,64.735270,1.437600,1.600000,-6.400000,0,103.640478,1.437600,0,15,5,[3,4]],
    [15.069252,19.651200,0,0,71.801400,53.851050,3.585948,1.630316,-6.369684,0,89.537423,3.585948,0,15,5,[3,5]]
  ],
  C: [
    [6,3,0,0,93.406200,70.054650,29.268000,10.542105,2.542105,0,109.856200,20.487600,8.780400,15,5,[]],
    [6,3,.484800,.588686,111.097374,83.323031,9.189600,10.542105,2.542105,0,127.547374,6.432720,2.756880,15,5,[]],
    [6,3,0,0,95.801400,71.851050,20.004000,10.542105,2.542105,0,112.251400,14.002800,6.001200,15,5,[]]
  ],
  Bprime: [
    [15.069252,18,0,0,72.406200,54.304650,14.198748,3.368421,-4.631579,0,90.059663,14.198748,0,15,5,[3,5]],
    [10.752000,15.783680,.484800,.344052,95.313694,71.485270,1.437600,1.600000,-6.400000,0,112.640478,1.437600,0,15,5,[3,4]],
    [15.069252,19.651200,0,0,74.801400,56.101050,6.585948,1.630316,-6.369684,0,92.537423,6.585948,0,15,5,[3,5]]
  ]
};
const runs = {};
for (const [name, p] of Object.entries(plans)) {
  runs[name] = [];
  scenarios.forEach((s, i) => test(`6.2 ${name}/${s}`, () => {
    const r = model.simulate(clone(p), s, () => true); // 검산 조건: 모든 제안을 명시적으로 승인
    check(`6.2 ${name}/${s} complete`, r.complete, true);
    fields.forEach((key, j) => check(`6.2 ${name}/${s}/${key}`, r[key], oracle[name][i][j],
      ['h','starts','corrections'].includes(key) ? 0 : .0000005));
    runs[name][i] = r;
  }));
}

test('4.2 발전량', () => {
  const pv = [
    [0,.987,7.879200,13.884000,14.048000,7.744800,.777600,0],
    [0,.987,7.879200,13.884000,6.638400,2.790942,.389600,0],
    [0,.987,7.879200,13.759200,13.920000,7.677600,.771200,0]
  ];
  scenarios.forEach((s, i) => pv[i].forEach((v, b) => check(`4.2 ${s}/b${b} PV`, model.weather(s,b).pv, v, .0000005)));
});
test('6.3 B/S2전체 구간', () => {
  const keys = ['L','pv','r','before','capCh','capDis','x0','ch','dis','x','g','u','curt','soc'];
  const rows = [
    [6.7,0,.9,8,0,1,4.8,0,1,4.8,4.8,0,0,4.842105],
    [7,.987,1.887,4.842105,0,1,4.113,0,1,4.113,4.113,0,0,1.684211],
    [9.2,7.879200,8.679200,1.684211,0,0,.520800,0,0,.520800,1,0,.479200,1.684211],
    [11,13.884,14.584,1.684211,4,0,.416,3.584,0,0,0,0,0,11.898611],
    [10.5,6.638400,7.338400,11.898611,1.439084,0,4.600684,0,0,3.161600,0,3.161600,0,11.898611],
    [10.1,2.790942,3.590942,11.898611,0,1,5.509058,0,1,5.509058,5.509058,0,0,8.740716],
    [9.9,.389600,1.289600,8.740716,0,2,6.610400,0,2,6.610400,6.610400,0,0,2.424926],
    [8,0,1,2.424926,0,.261227,6.738773,0,.261227,6.738773,6.738773,0,0,1.6]
  ];
  rows.forEach((row,b) => keys.forEach((key,j) => check(`6.3 b${b}/${key}`, runs.B[1].rows[b][key], row[j], .0000005)));
  check('6.3 b4 Tcell', runs.B[1].rows[4].cell, 44.5, .0000005);
  const b4 = runs.B[1].rows[4];
  check('6.3 b4 최대 방전', Math.min(4,(b4.before-1.6)*.95/3),3.261227,.0000005);
  check('6.3 b4 F3', b4.cut[2]*3,6.731148,.0000005);
  check('6.3 b4 F4', b4.cut[3]*3,2.753652,.0000005);
  check('6.3 b7 SOC 제한', runs.B[1].rows[7].clip,true);
});
test('6.4 B/Bprime평균', () => {
  for (const [name, u, diesel, co2, maxU] of [
    ['B',2.845440,74.957488,56.218116,9.484800],
    ['Bprime',.145440,79.757488,59.818116,.484800]
  ]) {
    const e = model.expected(runs[name]);
    for (const [k,v] of Object.entries({u,diesel,co2})) check(`6.4 ${name}/${k}`,e[k],v,.0000005);
    check(`6.4 ${name}/최악`,Math.max(...runs[name].map(r=>r.u)),maxU,.0000005);
  }
  check('6.4 평균 디젤 증가',model.expected(runs.Bprime).diesel-model.expected(runs.B).diesel,4.8,.0000005);
  check('6.4 평균 CO₂ 증가',model.expected(runs.Bprime).co2-model.expected(runs.B).co2,3.6,.0000005);
  for (const i of [0,2]) for (const k of ['diesel','curt']) check(`6.4 S${i+1}/${k}증가`,runs.Bprime[i][k]-runs.B[i][k],3,.0000005);
});
test('6.5 분배와 가중치 민감도', () => {
  const cuts = [[.903314,2.980937,3.974583,1.625966],[0,0,6.731148,2.753652],[0,4.064914,5.419886,0]];
  const heat = [11.155931,6.731148,11.517257], changed = [11.164965,6.731148,10.297783];
  ['R1','R2','R3'].forEach((shed,i) => {
    const p = {...clone(plans.B),shed};
    const r = model.simulate(p,'S2',()=>true);
    cuts[i].forEach((v,f)=>check(`6.5 ${shed}/F${f+1}`,r.cut[f],v,.0000005));
    check(`6.5 ${shed}/heat`,r.heat,heat[i],.0000005);
    for (const [k,v] of Object.entries({u:9.484800,diesel:86.313694,co2:64.7352705,curt:1.437600,soc:1.6}))
      check(`6.5 ${shed}/${k}`,r[k],v,k==='co2'?.00000005:.0000005);
    const r2 = model.simulate({...p,weights:[4,1.2]},'S2',()=>true);
    check(`6.5 ${shed}/가중치 변경`,r2.heat,changed[i],.0000005);
    check(`6.5 ${shed}/물리 차단 불변`,r2.cut,r.cut);
  });
});

test('12.4 미승인과 임시 미리보기', () => {
  const r = model.simulate(plans.B,'S2');
  check('12.4 미승인 complete',r.complete,false);
  check('12.4 첫 b',r.pending.b,3);
  check('12.4 제안 충전',r.pending.proposed,3.584,1e-9);
  check('12.4 후속 SOC 없음',r.rows.length,3);
  for (const k of ['u','heat','diesel','co2','curt','soc','delta','cost']) check(`12.4 미승인 지표 없음/${k}`,Object.hasOwn(r,k),false);
  const next = model.simulate(plans.B,'S2',q=>q.b===3);
  check('12.4 다음 b',next.pending.b,4);
  check('12.4 다음 충전0',next.pending.proposed,0,1e-9);
  check('12.4 승인 뒤에도 부족',model.simulate(plans.B,'S2',()=>true).u,9.4848,1e-9);
  const preview = model.simulate(plans.B,'S1',()=>false,{preview:true});
  check('12.4 preview complete',preview.complete,false);
  check('12.4 preview rows',preview.rows.length,8);
  check('12.4 미리보기 경계 9점',1+preview.rows.length,9);
  check('12.4 미리보기 임시 시작',preview.provisionalFrom,3);
  for (const k of ['u','heat','diesel','co2','curt','soc','delta','cost']) check(`12.4 미리보기 지표 없음/${k}`,Object.hasOwn(preview,k),false);
  const proposal = r.pending;
  check('5.4 승인 키',model.correctionKey('S2',3,'charge',4),'S2:3:charge:4');
  check('5.4 같은 제안 재사용',model.approvalMatches([{key:proposal.key,proposed:3.584}],proposal),true);
  check('5.4 제안 변경 재승인',model.approvalMatches([{key:proposal.key,proposed:3.5}],proposal),false);
  check('5.4 옛 revision 키 불가',model.approvalMatches([{key:'0:S2:3:charge:4',proposed:3.584}],proposal),false);
});
test('5.3 표시/최악/기준선', () => {
  for (const [x,s] of [[0,'0.00'],[-0,'0.00'],[.004,'0.01 미만'],[-.004,'−0.01 미만'],[-6.4,'−6.40']]) check(`display2 ${x}`,model.display2(x),s);
  check('모두0이면 none',model.worstIds(runs.A),['none']);
  check('B 최악',model.worstIds(runs.B),['S2']);
  check('동률 모두 열거',model.worstIds([{u:1},{u:1},{u:0}]),['S1','S2']);
  check('반올림으로 동률 판정 안 함',model.worstIds([{u:1.001},{u:1.002},{u:0}]),['S2']);
  check('작은 양수는 none 아님',model.worstIds([{u:.004},{u:0},{u:0}]),['S1']);
  check('B 예측 일치',model.predictionMatches('S2',runs.B),true);
  check('B 예측 불일치',model.predictionMatches('S1',runs.B),false);
  check('A 모두0 예측',model.predictionMatches('none',runs.A),true);
  check('B 기준선 이내',model.meetsBaseline({scenario:'S2',limit:10},runs.B),true);
  check('B 기준선 초과',model.meetsBaseline({scenario:'S2',limit:9},runs.B),false);
  const e=model.expected(runs.B);
  for(const key of ['u','heat','diesel','co2','curt','soc','delta','cost']) {
    const index=fields.indexOf(key);
    const wanted=oracle.B[0][index]*.5+oracle.B[1][index]*.3+oracle.B[2][index]*.2;
    check(`5.3 B 평균/${key}`,e[key],wanted,.0000005);
  }
});

// 8절 질문용 상태도 명세 스키마로 만든다. 결과 수치 캐시는 넣지 않는다.
function questionState(p, crit, baseline = {scenario:'S2',limit:10}, predict = 'S2') {
  const corrections = [];
  scenarios.forEach(s=>model.simulate(p,s,q=>{
    corrections.push(Object.fromEntries(['key','s','b','type','requested','capBefore','proposed','beforeSOC'].map(k=>[k,q[k]])));
    return true;
  }));
  corrections.forEach(c=>{c.rev=0;});
  const run = {seq:1,modelVersion:'ig-8-v2',rev:0,plan:clone(p),crit:clone(crit),baseline:clone(baseline),
    approvalKeys:corrections.map(c=>c.key),corrections:clone(corrections)};
  const g = {version:2,modelVersion:'ig-8-v2',...clone(p),crit:clone(crit),baseline:clone(baseline),
    predict,firstPredict:predict,firstRun:clone(run),rev:0,approvals:corrections.map(({key,proposed})=>({key,proposed})),
    correctionLog:clone(corrections),tests:1,history:[clone(run)],latestRun:clone(run),locked:clone(run),
    oneLine:'공급 여유를 얻는 대신 배출 부담을 늘렸다.',tab:'weather',activeRow:'bat',activeB:{bat:0,n:0,dr:0}};
  return {game:g,memo:'',answers:{},answerQ:{},rubric:{},compare:{before:'',open:false}};
}
test('8.3 A/B/Z 분기 예시', () => {
  const boundary = {...clone(plans.Z),n:[2,2,2,0,0,0,0,0]};
  const cases = [
    ['A',plans.A,['outage','fair'],['ig-b-reserve','ig-b-tomorrow']],
    ['B',plans.B,['emission','fair'],['ig-b-outage','ig-b-correction']],
    ['Z 경계',boundary,['outage','fair'],['ig-b-outage','ig-b-curtail']]
  ];
  for (const [name,p,crit,wanted] of cases) {
    const rs = scenarios.map(s=>model.simulate(p,s,()=>true));
    const state = questionState(p,crit);
    check(`8.3 ${name}개별 두 칸`,model.individualKeys(p,crit,rs,state.game.locked.corrections.length),wanted);
    const keys = model.questionKeys(state);
    // 답변 15분에 맞춰 공통 3 + 개별 2 + 반문 1 + 발산 1 = 일곱 문항.
    check(`8 ${name}질문 일곱 개`,keys.length,7);
    check(`8 ${name}중복 없음`,new Set(keys).size,7);
    check(`8 ${name}개별 순서`,keys.slice(3,5),wanted);
  }
  const b = questionState(plans.B,['emission','fair']);
  check('12.3 B 전체 순서',model.questionKeys(b),['ig-c1','ig-c2-in','ig-c3-hit','ig-b-outage','ig-b-correction','ig-r-r2','ig-storage-alt']);
  const questions = game.questions(b);
  check('8 질문 속성 k/tag/q만',questions.every(q=>Object.keys(q).sort().join(',')==='k,q,tag'),true);
  const outage = questions.find(q=>q.k==='ig-b-outage')?.q || '';
  for (const word of ['S2','9.48','F3','6.73','12–15시','11.90','디젤을 한 대도 켜 두지 않았습니다']) check(`8 B 정전 질문/${word}`,outage.includes(word),true);
  for (const [key,wanted] of [['S1','ig-c3-miss'],['S2','ig-c3-hit']]) check(`8 첫 예측${key}`,model.questionKeys(questionState(plans.B,['emission','fair'],undefined,key))[2],wanted);
  check('8 기준선 초과',model.questionKeys(questionState(plans.B,['emission','fair'],{scenario:'S2',limit:9}))[1],'ig-c2-over');
  for (const shed of ['R1','R3']) check(`8 반문${shed}`,model.questionKeys(questionState({...clone(plans.B),shed},['emission','fair']))[5],`ig-r-${shed.toLowerCase()}`);
  check('8 가중치 우선',model.questionKeys(questionState({...clone(plans.B),weights:[4,1.2]},['cost','fair']))[4],'ig-b-weights');
  check('8 cost 기준',model.questionKeys(questionState(plans.B,['cost','fair']))[4],'ig-b-cost');
  // 폭염 구간 차단이 없으면 가중치를 바꿔도 지수가 0으로 같으므로 가중치 질문을 내지 않는다.
  check('8 가중치 질문은 폭염 차단이 있을 때만',model.questionKeys(questionState({...clone(plans.A),weights:[4,1.2]},['outage','fair'],{scenario:'S2',limit:0},'none'))[4],'ig-b-tomorrow');
  const first = clone(b.game.firstRun);
  b.game.firstPredict = 'S2';
  b.game.firstRun = questionState(plans.A,['outage','fair']).game.firstRun;
  check('8 첫 시험에 예측 대조',model.questionKeys(b)[2],'ig-c3-miss'); // 첫 A는 none, 최신 B는 S2
  b.game.firstRun=first;
  b.game.firstPredict='S2';
  const before = model.questionKeys(b);
  b.game.bat[0]=4;
  check('12.4 locked 깊은 복제',model.questionKeys(b),before);
  check('12.3 미확정 질문 없음',model.questionKeys({game:{}}),[]);
  const snapshot=model.planSnapshot(plans.B);
  snapshot.bat[0]=4;snapshot.n[0]=0;snapshot.dr[4]=false;snapshot.weights[0]=4;
  check('12.4 planSnapshot 원본 배열 독립',[plans.B.bat[0],plans.B.n[0],plans.B.dr[4],plans.B.weights[0]],[-1,2,true,3]);
});
test('8.3 전체 후보의 우선순위와 경계', () => {
  // 조건 선택만 확인하는 독립 입력이며 실제 시험 결과로 저장하지 않는다.
  const base = {u:0,delta:0,dcharge:0,curt:0,h:9,heat:0};
  const choose = (patch={},p={},crit=['outage','fair'],count=0) => {
    const rs = [0,1,2].map(()=>({...base,...patch}));
    return model.individualKeys({...clone(plans.Z),...p},crit,rs,count);
  };
  const all = {delta:-3,dcharge:1,curt:5,h:15,heat:1};
  check('8.3 uncertainty 대체',choose(),['ig-b-reserve','ig-b-uncertainty']);
  check('8.3 outage',choose({u:1})[0],'ig-b-outage');
  check('8.3 weights 최우선',choose(all,{weights:[4,1.5]},['cost','fair'],1)[1],'ig-b-weights');
  check('8.3 weights는 폭염 차단 없으면 제외',choose({...all,heat:0},{weights:[4,1.5]},['cost','fair'],1)[1],'ig-b-cost');
  check('8.3 cost 다음',choose(all,{},['cost','fair'],1)[1],'ig-b-cost');
  check('8.3 correction 다음',choose(all,{},undefined,1)[1],'ig-b-correction');
  check('8.3 tomorrow 경계',choose({delta:-2,dcharge:1,curt:5})[1],'ig-b-tomorrow');
  check('8.3 dcharge 우선',choose({dcharge:1,curt:5})[1],'ig-b-dcharge');
  check('8.3 curtail 경계',choose({curt:4})[1],'ig-b-curtail');
  check('8.3 long 경계',choose({h:15})[1],'ig-b-diesel-long');
  check('8.3 short 경계',choose({h:6})[1],'ig-b-diesel-short');
  check('8.3 DR 대체',choose({h:9},{dr:[true,false,false,false,false,false,false,false]})[1],'ig-b-dr');
});

test('1 디젤 배정 충전량 재현(A/S3 09–12시)', () => {
  const row = runs.A[2].rows[3];
  check('A/S3 b3 충전',row.ch,2.807018,.0000005);
  check('A/S3 b3 디젤 최소 출력',row.g,1,1e-9);
  check('A/S3 b3 출력제한',row.curt,.772182,.0000005);
  check('A/S3 b3 디젤 배정 0',row.dcharge,0,1e-12);
  check('H/S1 b0 디젤 배정 = 충전 전량',runs.H[0].rows[0].dcharge,runs.H[0].rows[0].ch,1e-9);
  check('A dcharge 질문 없음',model.individualKeys(plans.A,['emission','fair'],runs.A,0)[1],'ig-b-tomorrow');
});
test('3 배터리가 부족을 메우는 대안 계산(B/S2)', () => {
  // 명세 밖 비교값: 같은 계획에서 남은 잔량을 부족에 먼저 쓰는 운영. 모형 weather만 빌리고 급전은 독립 계산.
  let soc = 8, U = 0;
  const p = plans.B;
  for (let b = 0; b < 8; b++) {
    const {r,d} = model.weather('S2',b), n = p.n[b], L = d - (p.dr[b] ? 1.5 : 0), v = p.bat[b];
    let ch = v>0 ? Math.min(v,4,(16-soc)/(.95*3)) : 0, dis = v<0 ? Math.min(-v,4,(soc-1.6)*.95/3) : 0;
    const x0 = L+ch-r-dis;
    if (x0>3*n && ch>0) ch -= Math.min(ch,x0-3*n); else if (x0<n && dis>0) dis -= Math.min(dis,n-x0);
    const g = n ? Math.max(n,Math.min(3*n,L+ch-r-dis)) : 0;
    let u = Math.max(0,L+ch-r-dis-g);
    const extra = Math.min(u,Math.min(4,(soc-1.6)*.95/3)-dis);
    if (extra>0) { dis += extra; u -= extra; }
    soc = Math.max(1.6,Math.min(16,soc+ch*.95*3-dis*3/.95));
    U += u*3;
  }
  check('3 대안 S2 미공급',U,1.228,.0005);
  const html = game.reflectExtra(questionState(plans.B,['emission','fair']));
  for (const word of ['9.48','11.90','1.23','12–15시','15–18시']) check(`3 예시 B·한계에 ${word}`,html.includes(word),true);
  check('3 예시 B 약점에 1.23',/id="ig-example-b"[\s\S]*약점[\s\S]*1\.23[\s\S]*<\/details>/.test(html.split('id="ig-example-c"')[0]),true);
});
test('4·저장·예시 표 공개', () => {
  const html = game.reflectExtra(questionState(plans.B,['emission','fair']));
  const limits = html.slice(html.indexOf('id="ig-limits"'), html.indexOf('id="ig-values"'));
  for (const word of ['순환 정전','통째로','필수 부하','전날 밤 가동 대수를 0기']) check(`4 한계에 ${word}`,limits.includes(word),true);
  // 16 MWh = 5.76×10¹⁰ J, 100 m 양수에 필요한 물 m = E/(gh)
  check('저장 어림 산술',16000*3.6e6/(9.8*100)/1000,58775.5,.1);
  for (const word of ['5.76×10¹⁰','5.9만 톤','0.2722 kWh']) check(`저장 해설에 ${word}`,html.includes(word),true);
  for (const [k,p] of [['A',plans.A],['B',plans.B],['C',plans.C]]) {
    const part = html.slice(html.indexOf(`id="ig-example-${k.toLowerCase()}"`));
    const caption = `계획 ${k} · 구간별 요청`;
    check(`예시 ${k} 계획 표`,part.includes(caption),true);
    const tableHtml = part.slice(part.indexOf(caption), part.indexOf('</table>'));
    check(`예시 ${k} 표 8구간`,(tableHtml.match(/<tr>/g)||[]).length,9);
    // 표가 6.2 검산 계획과 같은 값을 보여 준다.
    const rows = [...tableHtml.matchAll(/<tr><th scope="row">([^<]+)<\/th><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)];
    check(`예시 ${k} 디젤`,rows.map(m=>Number(m[3])),p.n);
    check(`예시 ${k} 배터리`,rows.map(m=>m[2]),p.bat.map(v=>`${v>0?'충전':v<0?'방전':'정지'} ${Math.abs(v)} MW`));
    check(`예시 ${k} 수요반응`,rows.map(m=>m[4]==='켬'),p.dr);
  }
});
test('5·낮음 질문 문안', () => {
  const qs = st => {const rows=game.questions(st);
    for(const q of rows) check(`결함 8 ${q.k} 요청 하나`,requestCount(q.q),1);
    return Object.fromEntries(rows.map(q=>[q.k,q.q]));};
  const b = qs(questionState(plans.B,['emission','fair']));
  check('5 c1 얻는 것·잃는 것 한 문장',b['ig-c1'].includes('얻는 것과 잃는 것을 한 문장으로'),true);
  // N4·N6: 두 기준 중 무엇을 앞세웠는지 먼저 밝히는 문안.
  check('5 c1 조사',b['ig-c1'].includes('‘배출·대기오염 최소’와 둘째 기준 ‘피해의 공정한 분배’ 가운데 어떤 기준을 앞세웠는지 먼저 밝히고'),true);
  check('c3-hit 조사',b['ig-c3-hit'].includes('‘S2 오후 구름’은 처음'),true);
  const s1 = qs(questionState(plans.B,['emission','fair'],undefined,'S1'))['ig-c3-miss'];
  for (const word of ['‘S1 예보대로’를 골랐습니다','‘S2 오후 구름’입니다','어느 날씨에 몰릴지','첫 시험 계획과 같습니다']) check(`c3-miss 다른 날씨/${word}`,s1.includes(word),true);
  check('c3-miss 과소평가 단정 없음',/과소평가/.test(s1),false);
  const under = qs(questionState(plans.B,['emission','fair'],undefined,'none'))['ig-c3-miss'];
  for (const word of ['‘세 날씨 모두 정전 없음’을','작게 본']) check(`c3-miss 과소/${word}`,under.includes(word),true);
  const overState = questionState(plans.A,['outage','fair'],{scenario:'S2',limit:0},'S3');
  const over = qs(overState)['ig-c3-miss'];
  for (const word of ['‘S3 더 더움’을','세 날씨 모두 정전이 없었습니다','크게 본']) check(`c3-miss 과대/${word}`,over.includes(word),true);
  const replanned = questionState(plans.B,['emission','fair'],undefined,'S2');
  replanned.game.firstRun = questionState(plans.A,['outage','fair']).game.firstRun;
  check('c3-miss 고친 계획',qs(replanned)['ig-c3-miss'].includes('첫 시험 뒤 고친 계획'),true);
  const w = qs(questionState({...clone(plans.B),weights:[4,1.2]},['emission','fair']))['ig-b-weights'];
  for (const word of ['S2 오후 구름','6.73','현재 가중치','기본값']) check(`가중치 질문/${word}`,w.includes(word),true);
  check('가중치 질문 0.00 아님',/현재 가중치에서 0\.00/.test(w),false);
  check('가중치 질문 같은 값 설명',w.includes('두 값이 같지만'),true);
  const w1 = qs(questionState({...clone(plans.B),shed:'R1',weights:[4,1.2]},['emission','fair']))['ig-b-weights'];
  check('가중치 질문 R1 값 다름(11.1650 대 11.1559)',w1.includes('11.16')&&!w1.includes('두 값이 같지만'),true);
  // N4: 계산 보조 물음 대신 저장 대안 제안과 규모 근거를 한 요청으로 복원.
  const alt = b['ig-storage-alt'];
  // 명세 8절 발산 질문: 저장 방법 하나와 섬에서의 규모 어림을 한 요청으로 묻는다.
  for (const word of ['16 MWh','100 m','저장 방법 하나를','그 규모가 섬에서 현실적인지 어림한 근거와 함께 제안해 주세요']) check(`발산/${word}`,alt.includes(word),true);
  for (const word of ['9.8×10⁵','0.27 kWh','5.9']) check(`발산 답 미노출/${word}`,alt.includes(word),false);
  check('발산 요청 하나',requestCount(alt),1);
  check('반문 물음표',['R1','R2','R3'].every(shed=>/고치거나 유지할 이유를 말해 주세요\.$/.test(qs(questionState({...clone(plans.B),shed},['emission','fair']))[`ig-r-${shed.toLowerCase()}`])),true);
  const dcs = questionState(plans.H,['emission','fair'],{scenario:'S2',limit:0},'S3');
  const dq = game.questions(dcs).find(q=>q.k==='ig-b-dcharge');
  check('dcharge 질문 문안',!!dq && dq.q.includes('충전하지 않았다면') && !dq.q.includes('재생 발전이 남지 않는'),true);
});

// 고정 시드 물리 검사. 식은 12.4의 불변 조건뿐이고 급전 계산은 구현에 맡긴다.
function conservation(p,s,r,label) {
  const sum = xs => xs.reduce((a,b)=>a+b,0);
  r.rows.forEach((v,b)=>{
    const prefix=`${label}/${s}/b${b}`;
    check(`${prefix} SOC 범위`,v.soc>=1.6-1e-9&&v.soc<=16+1e-9,true);
    check(`${prefix} 충방전 범위`,v.ch>=-1e-9&&v.dis>=-1e-9&&v.ch<=4+1e-9&&v.dis<=4+1e-9&&v.ch*v.dis<=1e-9,true);
    check(`${prefix} 디젤 범위`,v.n===0?Math.abs(v.g)<=1e-9:v.g>=v.n-1e-9&&v.g<=3*v.n+1e-9,true);
    const load=[1,.3*(v.d-1),.4*(v.d-1),.3*(v.d-1)-(p.dr[b]?1.5:0)];
    check(`${prefix} 차단 한도`,v.cut.every((x,i)=>x>=-1e-9&&x<=load[i]+1e-9),true);
    check(`${prefix} 사업자 한도`,v.ext>=-1e-9&&v.coop>=-1e-9&&v.ext<=v.pv*.7+1e-9&&v.coop<=v.pv*.3+1e-9,true);
    check(`${prefix} 차단 보존`,sum(v.cut),v.u,1e-9);
    check(`${prefix} 제한 보존`,v.ext+v.coop,v.curt,1e-9);
    check(`${prefix} 전력 보존`,v.r-v.curt+v.dis+v.g,v.L-v.u+v.ch,1e-9);
    check(`${prefix} 효율 SOC`,v.soc,v.before+v.ch*.95*3-v.dis*3/.95,1e-9);
    check(`${prefix} SOC 연속`,v.before,b?r.rows[b-1].soc:8,1e-9);
    // 디젤 배정 충전량: 충전하지 않았다면 줄었을 디젤 발전량(한계 기준).
    const noCharge = v.n ? Math.max(v.n,Math.min(3*v.n,v.L-v.r-v.dis)) : 0;
    check(`${prefix} 디젤 배정 충전 정의`,v.dcharge,Math.max(0,v.g-noCharge),1e-9);
    check(`${prefix} 디젤 배정 충전 범위`,v.dcharge>=-1e-9&&v.dcharge<=v.ch+1e-9,true);
    if (v.curt>1e-9) check(`${prefix} 출력제한 중 디젤 배정 충전 없음`,v.dcharge,0,1e-9);
  });
  for (const [total,row] of [['u','u'],['heat','heat'],['diesel','g'],['curt','curt'],['ext','ext'],['coop','coop'],['ch','ch'],['dis','dis'],['dcharge','dcharge']])
    check(`${label}/${s}/합계${total}`,r[total],sum(r.rows.map(v=>v[row]*3)),1e-9);
  for(let i=0;i<4;i++)check(`${label}/${s}/합계F${i+1}`,r.cut[i],sum(r.rows.map(v=>v.cut[i]*3)),1e-9);
  check(`${label}/${s}/끝 SOC`,r.soc,r.rows[7].soc,1e-9);
  check(`${label}/${s}/잔량 변화`,r.delta,r.soc-8,1e-9);
  check(`${label}/${s}/2기 이상 시간`,r.h,3*p.n.filter(n=>n>=2).length,1e-9);
  check(`${label}/${s}/CO2`,r.co2,r.diesel*.75,1e-9);
  check(`${label}/${s}/새 기동 대수`,r.starts,sum(p.n.map((n,b)=>Math.max(0,n-(b?p.n[b-1]:0)))),1e-9);
  check(`${label}/${s}/운영비`,r.cost,r.diesel+2*r.starts+3*p.dr.filter(Boolean).length+.05*(r.ch+r.dis),1e-9);
}
test('12.4 대표 계획 보존',()=>Object.entries(plans).forEach(([name,p])=>scenarios.forEach((s,i)=>conservation(p,s,runs[name][i],name))));
let seed=20261002;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
for(let i=0;i<256;i++)test(`12.4 고정 입력${i}`,()=>{
  const dr=[];
  const count=Math.floor(random()*3);
  while(dr.length<count){const b=Math.floor(random()*8);if(!dr.includes(b))dr.push(b);}
  const p=plan(Array.from({length:8},()=>Math.floor(random()*9)-4),Array.from({length:8},()=>Math.floor(random()*4)),dr,
    ['R1','R2','R3'][Math.floor(random()*3)],['C1','C2'][Math.floor(random()*2)]);
  p.weights=[[2,3,4][Math.floor(random()*3)],[1.2,1.5,2][Math.floor(random()*3)]];
  scenarios.forEach(s=>conservation(p,s,model.simulate(p,s,()=>true),`seed:${i}`));
});

for (const failure of failures) console.error(`실패 ${failure}`);
console.log(`통과 ${passed}건${failures.length ? ` / 실패 ${failures.length}건` : ''}`);
process.exitCode = failures.length ? 1 : 0;
