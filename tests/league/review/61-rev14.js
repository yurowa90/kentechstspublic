'use strict';
// 기대값 근거: rev14b/spec.md A·E가 옛 배분/꼬리 계약을 대체하며 나머지는 앞 명세를 유지한다.
// ui 원문은 VM 로드·기존 함수 연결·명세가 요구한 원문 단언에만 사용한다.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const ROOT = path.resolve(__dirname, '../../..');
const read = name => fs.readFileSync(path.join(ROOT, `ui/${name}.js`), 'utf8');
const source = read('league'), build = read('build');
const O = require('./rev14b-contract.cjs');
const G1 = '남은 특별교부세 {n}억은 새 설비·선로·재난 대응에 써요. 계획에 쓰고 남은 돈은 이달 말에 사라져요.';
const H1 = '오후 냉방 수요가 늘고 LNG·일반 태양광 출력이 조금 줄며 공공시설 보수비가 한 번 들어요. 재난이라 특별교부세가 나와요.';
const T1 = '(내 예측과 같은 쪽)', T2 = '(내 예측과 반대쪽)';
let assertions = 0, failures = 0;
function test(label, run) {
  assertions++;
  try { run(); } catch (error) {
    failures++;
    console.error(`${error.blocked ? 'BLOCKED' : 'FAIL'} ${label}: ${error.message.split('\n')[0]}`);
  }
}
function blocked(message) { throw Object.assign(new Error(message), { blocked: true }); }
const body = name => source.match(new RegExp(`^  function ${name}\\([^]*?^  }`, 'm'))?.[0] || '';
const memory = new Map(), storage = {
  getItem: k => memory.get(k) ?? null, setItem: (k,v) => memory.set(k,v), removeItem: k => memory.delete(k),
};
const ctx = vm.createContext({ console, performance, structuredClone, URL,
  document: { documentElement: {}, addEventListener() {}, getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [] },
  addEventListener() {}, setTimeout() { return 0; }, clearTimeout() {},
  localStorage: storage, sessionStorage: storage,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  KCP: { route() {}, on() {}, esc: String, gradeWords: String, leagueNet: { expandSnapshot: x => x } } });
ctx.window = ctx;
let bootError;
try {
  for (const name of ['build-maps','tech-data','build','econ-data','econ','league-data','league-core','league']) {
    let text = name === 'league' ? source : name === 'build' ? build : read(name);
    if (['build','league-core','league'].includes(name)) {
      const end = text.lastIndexOf('})();');
      assert.ok(end >= 0, '기존 IIFE 연결점');
      // 기존 소비 함수만 메모리 노출. 새 계약 함수는 실제 공개 API를 요구한다.
      const [hook, functions] = name === 'build' ? ['__rev14Build',['cityOutageHours']] :
        name === 'league-core' ? ['__rev14Core',['outageFloor','isOutHour']] :
        ['__rev14',['missedText','outageHoursDef','outageReplayShown']];
      text = text.slice(0,end) + `\nglobalThis.${hook} = {` +
        functions.map(n => `${n}: typeof ${n} === "function" ? ${n} : undefined`).join(',') +
        '};\n' + text.slice(end);
    }
    vm.runInContext(text, ctx, { filename: `ui/${name}.js`, timeout:10000 });
  }
} catch (error) { bootError = error; }
const need = name => {
  if (bootError) blocked(`VM 초기화: ${bootError.message}`);
  const fn = ctx.KCP.league?.[name];
  if (typeof fn !== 'function') blocked(`함수 없음: KCP.league.${name}`);
  return fn;
};
test('VM 초기화', () => assert.ifError(bootError));
const names=['outageShownTotal','outageDisplayValues','outagePartShown','outageWaterfallHTML','outagePartRanking','outageCardMin'];
for(const name of [...names,'outageEvidenceSummary'])test('공개 '+name,()=>need(name));
const A=()=>({...ctx.KCP.league,outageReplayShown:ctx.__rev14.outageReplayShown});
const keys=['choice','weather','event','progress','growth','trade'];
function attribution(start,values,grid=true,replay=0,outside=true) {
 const total=values.reduce((n,x)=>n+x,0)+(outside?0:replay);
 return {basis:'monthly',round:2,id:'pyeongtaek',target:grid?'grid':'uns',unit:grid?'MWh/일':'%p',trial:start,base:start,actual:start+total,total,replay,replayOutsideSum:outside,
 parts:values.map((value,i)=>({key:keys[i],value})),clues:Object.fromEntries(keys.map(k=>[k,'가상 검사 단서'])),grid:{value:0,waitingMW:0}};
}
let seed=0x14c0ffee,allocated=0,fallback=0,w1=0,w2=0;
const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
function allocation(a,html=true) {
 const o=O.check(a,A(),{html}),out=O.actualDisplay(a,A());
 if(out.values.size)allocated++;else fallback++;
 if(html){const notes=O.checkNote(a,A(),o,out);w1+=+notes.w1;w2+=+notes.w2;}
 a.parts.forEach(p=>assert.equal(need('outagePartShown')(a,p.key,p.value),out.values.get(p.key)??p.value,'공유 표시 몫'));
}
for(let i=0;i<2400;i++)test('A rev14b 무작위 '+i,()=>{
 const grid=i%2===0,start=grid&&i%8===0?random()*1.99:random()*100;
 const a=attribution(start,keys.map(()=>(random()-.5)*(grid?40:8)),grid,(random()-.5)*(grid?2:.2),i%4<2);
 if(i%19===0)a.parts=[];
 if(i%23===0&&a.parts.length){const t=grid?.26:.026;Object.assign(a,attribution(start,[t,t,0,0,0,0],grid));}
 allocation(a);
});
for(const [label,start,values,grid,replay,outside] of [
 ['0.8의 허용 조합/최소 gap',20,[.27,.24,.24,0,0,0],true,0,true],
 ['N1',14.5,[0,.16,0,0,.08,0],true,0,true],
 ['양수 동점',20,[.26,.26,0,0,0,0],true,0,true],
 ['음수 동점',20,[-.26,-.26,0,0,0,0],true,0,true],
 ['눈금 위와 0',20,[.29,-.29,0,.3,0,0],false,0,true],
 ['탐욕 실패도 완전 탐색',20,[.042,.094,-.209,-.151],true,0,true],
 ['재현 > 직접 원인',4,[-.116856,-.00316,0,0],false,.215,false],
 ['W1 한 자리',10.06,[.06,0,0,0,0,0],true,0,true],
 ['W1 두 자리',1.006,[.006,0,0,0,0,0],true,0,true]
])test('A rev14b 고정 '+label,()=>allocation(attribution(start,values,grid,replay,outside)));
// 성질 표본 60,000개: 눈금·0·부호 반전·합 안 재현·두 자리 달을 별도 검증한다.
seed=0x14d2cafe;
for(let i=0;i<15000;i++) {
 const raw=keys.map(()=>random()<.2?0:random()<.4?Math.floor(random()*81)-40:(random()-.5)*80),start=i%4===0?random()*1.99:random()*20;
 if(i%6===0)raw[0]=-raw[1];if(i%6===1)raw[0]=raw[1];
 for(const grid of [true,false])for(const sign of [1,-1])test('A 성질 '+i+'/'+grid+'/'+sign,()=>{
  const scale=grid&&start>=2?10:100,a=attribution(start,raw.map(x=>sign*x/scale),grid,sign*[.4,.7,-.4,-1.6][i%4]/scale,i%2===0);
  if(i%3===0){a.basis='trial';a.round=1;}
  allocation(a,false);
 });
}
test('A 배분/W1/W2 관측',()=>assert.ok(allocated>0&&w1>0&&w2>0));
console.log('INFO rev14b seed=0x14c0ffee/0x14d2cafe random=2400 property=60000 Map='+allocated+' fallback='+fallback+' W1='+w1+' W2='+w2);
for(const name of ['outageCardsHTML','missedCarryHTML','missedText'])test('A1 공유 표시 연결 '+name,()=>assert.match(body(name),/outagePartShown\(/));
test('A1 끝 화면 두 자리 기록',()=>{
 const a=attribution(1.886,[1.663,0,0,0,0,0]);
 const text=ctx.__rev14.missedText({outageFrozen:a,outageOpened:true,outageSingleShown:true,outageLargest:{key:'choice',value:1.663},missed:'choice',missedBasis:'monthly'});
 assert.match(text,/가장 큰 몫[^]*?\+1\.66 MWh\/일/);
});
test('A 옛 기록 원값 fallback',()=>assert.equal(need('outagePartShown')(null,'choice',1.663),1.663));

test('M2 G1 글자 그대로',()=>assert.equal(ctx.KCP.ECON_DATA.disasterFacts.grant.textNoRepair,G1));
const C=ctx.KCP.leagueCore;
for(const [id,want] of [['heavy_rain',true],['heatwave_peak',true],['coldwave_heating',false]])
  test(`M2 보수비 분기 ${id}`,()=>{
    const fn=ctx.KCP.league?.grantHasRepair;
    if(typeof fn!=='function') {
      // 명세 M2의 대체 수용: ! 팝업이 textNoRepair를 고르는 분기 원문.
      assert.match(body('renderBar'),/textNoRepair/,'보수비 판단 함수 부재; ! 팝업 textNoRepair 분기 필요');
      assert.match(body('renderBar'),/\.lg-money-info[^]*?(?:\?|if\s*\()[^]*?textNoRepair/);
      console.log(`INFO M2 ${id} 함수 없음 → 원문 분기만 단언`); return;
    }
    const S=C.newState('R14CHECK','south',0,['pyeongtaek','dangjin'],{turns:12,seedMode:'room'});
    S.round=id==='coldwave_heating'?1:7; S.events=[{id,round:S.round,x:1}];
    assert.equal(fn(S,'pyeongtaek'),want);
    S.events=[{id,round:S.round-1,x:1}]; assert.equal(fn(S,'pyeongtaek'),false,'이전 달 보수비 제외');
  });
test('M3 운영 띠 B1',()=>{
  assert.ok(build.includes('" · 무더위"'),'B1 원문');
  assert.doesNotMatch(build,/wx\.hot\s*\?\s*" · 폭염"/);
});

// 명세 m3의 54조합. wind는 기존 검사에서 weather 직접 연결 근거로 확인했다.
for(const pred of ['up','down','same']) for(const sign of [1,-1,0])
  for(const topic of ['grid','uns','cash']) for(const target of ['grid','uns'])
    test(`m3 ${pred}/${sign}/${topic}/${target}`,()=>{
      const a=attribution(10,[0,sign*2,0,0,0,0],target==='grid'); a.hasConnectedWind=true;
      const n={topic,pred:{[topic]:pred},evidence:{key:'wind',text:'풍속',value:5}};
      const original=JSON.stringify({a,n}), text=need('outageEvidenceSummary')(n,a);
      const direction=pred==='up'?1:pred==='down'?-1:0;
      const sameTarget=topic==='grid'?target==='grid':topic==='uns'&&target!=='grid';
      const tail=direction&&sign&&sameTarget?(direction===sign?T1:T2):'';
      if(tail) { assert.match(text,/직접 연결 몫/,'연결 분기 확보'); assert.ok(text.includes(' '+tail),text); const v=/직접 연결 몫[^]*?([+−]?[\d,.]+(?: MWh\/일|%p))/.exec(text); assert.ok(v&&text.includes(v[1]+' '+tail),text); if(/외 \d+개/.test(text))assert.ok(text.indexOf(tail)<text.indexOf('외 '),text); }
      else assert.ok(!text.includes(T1)&&!text.includes(T2),text);
      assert.equal(JSON.stringify({a,n}),original,'m3 기록 불변');
    });
for(const kind of ['근거 없음','연결 없음','반올림 0','예측 없음']) test(`m3 꼬리 없음 ${kind}`,()=>{
  const a=attribution(10,[0,kind==='반올림 0'?.001:2,0,0,0,0]); a.hasConnectedWind=true;
  const n={topic:'grid',pred:{grid:'up'},evidence:{key:'wind',text:'풍속',value:5}};
  if(kind==='근거 없음') delete n.evidence;
  if(kind==='연결 없음') n.evidence.key='unlinked';
  if(kind==='예측 없음') delete n.pred;
  const text=need('outageEvidenceSummary')(n,a);
  assert.ok(!text.includes(T1)&&!text.includes(T2),text);
});

test('m4 H1·속성 불변',()=>{
  const R=C.regionOf('south'), heat=R.events.find(e=>e.id==='heatwave_peak');
  assert.equal(heat.text,H1);
  // 불변 계약의 기준 데이터만 HEAD에서 읽는다. 계산 구현/기대 알고리즘은 가져오지 않는다.
  const oldCtx=vm.createContext({KCP:{}}); oldCtx.window=oldCtx;
  vm.runInContext(execFileSync('git',['show','HEAD:ui/league-data.js'],{cwd:ROOT,encoding:'utf8'}),oldCtx);
  const old=JSON.parse(JSON.stringify(oldCtx.KCP.LEAGUE_REGIONS));
  const find=x=>x&&typeof x==='object'?(x.id==='heatwave_peak'?x:Object.values(x).map(find).find(Boolean)):null;
  const baseline=find(old); assert.ok(baseline,'기준 heatwave_peak 자료');
  const current=JSON.parse(JSON.stringify(heat));
  assert.ok(Object.values(current.effect).includes(1.12),'명세 effect 1.12 유지');
  const S=C.newState('R14HEAT','south',0,['pyeongtaek','dangjin'],{turns:12,seedMode:'room'});
  S.round=7; S.events=[{id:'heatwave_peak',round:7,x:1}];
  assert.deepEqual(Array.from(C.modsFor(S,R,'pyeongtaek').demandHours),[13,19]);
  delete current.text; delete baseline.text; delete current.textSeason; delete baseline.textSeason;
  assert.deepEqual(current,baseline,'text 외 effect·hours·grant·repairParam 포함 모든 속성 불변');
});

// rev14-B: 기대 판정식·변이값은 총괄 명세에서 직접 작성한다.
// 운영 함수의 본문은 바꾸지 않고 기존 도시 시간/설명/정산 판정만 VM에서 호출한다.
test('rev14-B 정전 시간 계수 변이: 실제 운영·도시 합계·설명·정산 일치',()=>{
  assert.ifError(bootError);
  const B=ctx.KCP.buildGame, P=ctx.KCP.ECON_DATA.params;
  const A=ctx.__rev14Build, E=ctx.__rev14Core, U=ctx.__rev14;
  assert.equal(typeof B?.simulate,'function','Node에서 실제 build 운영 실행');
  for(const [label,fn] of [['도시 시간',A?.cityOutageHours],['정산 판정선',E?.outageFloor],
    ['정산 시간 판정',E?.isOutHour],['정의 문장',U?.outageHoursDef]])
    assert.equal(typeof fn,'function',label);
  const savedShare=P.outageHourShare.v, savedMin=P.outageHourMinMW.v;
  const previousPack=B.PK.id;
  let baseline;
  try {
    assert.equal(savedShare,.02,'명세 기본 비율');
    assert.equal(savedMin,.005,'명세 기본 최소 MW');
    B.selectPack('pyeongtaek','league');
    // 디젤 1기와 도시 수요지를 연결: 2%~20% 사이 부족 시간이 있어 비율 변이도 관측된다.
    const tile=B.TILES.find(t=>!B.siteRule('diesel',t));
    assert.ok(tile,'합법 디젤 위치');
    const lines=B.TOWNS.flatMap(t=>{
      const p=B.routePath(tile.i,t.tile);
      assert.ok(p&&p.length<=80,'수요지 연결 경로');
      return p.length>1?[{p}]:[];
    });
    const plan=B.sanitize({seed:1402,season:'summer',builds:[{t:'diesel',i:tile.i}],
      lines,policies:[],missions:[]},1e9);
    assert.equal(plan.builds.length,1,'디젤 1기 보존');
    assert.equal(plan.lines.length,lines.length,'선로 보존');
    const run=(share,min)=>{
      P.outageHourShare.v=share; P.outageHourMinMW.v=min;
      const res=B.simulate(structuredClone(plan),7,{league:true});
      assert.equal(res.H,168,'고정 씨앗 7일 운영');
      assert.equal(res.seed,1402,'씨앗 유지');
      assert.equal(res.hrDem.length,res.H); assert.equal(res.hrSup.length,res.H);
      const expected=Array.from(res.hrDem).reduce((n,dem,k)=>
        n+(dem-res.hrSup[k]>Math.max(min,share*dem)?1:0),0);
      const actual=A.cityOutageHours(res);
      assert.equal(actual,expected,`도시 시간 독립 계산: share=${share}, min=${min}`);
      // simulate가 실제 기록한 수요지별 outH도 같은 자료 계수를 읽어야 한다.
      const detail=B.gridFillContext(res);
      assert.ok(detail?.townDemand,'실제 운영의 시간별 수요지 수요');
      res.town.forEach((town,ti)=>{
        let hours=0;
        for(let k=0;k<res.H;k++) {
          const at=k*res.NT+ti;
          if(res.hrUns[at]>Math.max(min,share*detail.townDemand[at])) hours++;
        }
        assert.equal(town.outH,hours,`운영 수요지 ${ti} 시간`);
      });
      for(let k=0;k<res.H;k++) {
        const dem=res.hrDem[k], shortage=dem-res.hrSup[k];
        assert.equal(E.outageFloor(dem),Math.max(min,share*dem),'정산 판정선 독립 계산');
        assert.equal(E.isOutHour([shortage],[0],[dem],0),
          shortage>min&&shortage>share*dem,'정산도 두 판정선을 모두 초과할 때만');
      }
      // 실제 운영에 정확한 경계값이 없어도 >가 >=로 변하는 것을 잡는다.
      for(const dem of [0,.01,10]) {
        const floor=Math.max(min,share*dem);
        for(const shortage of [floor-1e-6,floor,floor+1e-6])
          assert.equal(E.isOutHour([shortage],[0],[dem],0),shortage>min&&shortage>share*dem);
      }
      const sentence=U.outageHoursDef(7);
      const pct=sentence.match(/수요의\s*([\d,.]+)%/), mw=sentence.match(/최소 판정선\s*([\d,.]+)\s*MW/);
      assert.ok(pct,`설명 비율: ${sentence}`); assert.ok(mw,`설명 최소 MW: ${sentence}`);
      assert.equal(Number(pct[1].replace(/,/g,'')),share*100,'설명 %도 변이된 자료');
      assert.equal(Number(mw[1].replace(/,/g,'')),min,'설명 MW도 변이된 자료');
      if(baseline) {
        assert.deepEqual(Array.from(res.hrDem),Array.from(baseline.res.hrDem),'계수만 바꿔 수요 동일');
        assert.deepEqual(Array.from(res.hrSup),Array.from(baseline.res.hrSup),'계수만 바꿔 공급 동일');
        assert.ok(actual<=baseline.hours,'판정선 상승 시 도시 정전 시간 증가 금지');
        assert.ok(res.outTotal<=baseline.res.outTotal,'판정선 상승 시 수요지 정전 시간 증가 금지');
      }
      return {res,hours:actual,sentence};
    };
    baseline=run(savedShare,savedMin);
    assert.ok(baseline.hours>0,'정전이 있는 기본 운영으로 1000 MW 변이를 검증');
    const shareChanged=run(.2,savedMin); // 최소 MW는 기본값으로 유지.
    assert.ok(shareChanged.hours<baseline.hours,'비율 변이로 실제 도시 정전 시간 감소 관측');
    const minChanged=run(savedShare,1000); // 비율은 기본값으로 복구하고 따로 변이.
    assert.equal(minChanged.hours,0,'1000 MW면 도시 정전 0시간');
    assert.equal(minChanged.res.outTotal,0,'1000 MW면 모든 수요지 정전 0시간');
    const restored=run(savedShare,savedMin);
    assert.equal(restored.hours,baseline.hours,'기본 계수 복구 후 도시 정전 시간 재현');
    assert.equal(restored.res.outTotal,baseline.res.outTotal,'기본 계수 복구 후 운영 시간 재현');
    assert.equal(restored.sentence,baseline.sentence,'기본 계수 복구 후 설명 재현');
    console.log(`INFO rev14-B seed=1402 도시 정전 시간 기본=${baseline.hours} share=0.2:${shareChanged.hours} min=1000:${minChanged.hours}`);
  } finally {
    P.outageHourShare.v=savedShare; P.outageHourMinMW.v=savedMin;
    B.selectPack(previousPack,'league');
  }
});
console.log(`assertions ${assertions} failures ${failures}`);
process.exitCode=failures?1:0;
