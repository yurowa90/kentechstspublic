'use strict';
// 독립 기대값: D-87 1단계 지시서·ECON-REFERENCES §18·기존 학생 점수 계약.
// 45/46번을 import하지 않는다. 변이는 파일을 쓰지 않고 새 VM에서만 실행한다.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const ROOT = path.resolve(__dirname, '../../..');
const files = ['build-maps','tech-data','build','econ-data','econ','league-data','league-core','league-ai'];
const read = n => fs.readFileSync(path.join(ROOT, 'ui', n + '.js'), 'utf8');
// 동시 UI 작업 중에도 한 실행의 VM들은 같은 소스 사본을 비교한다.
const currentSource = Object.fromEntries(files.map(n=>[n,read(n)]));
const base = n => execFileSync('git', ['show', `a7f93be:ui/${n}.js`], {cwd: ROOT, encoding:'utf8'});
const json = x => JSON.parse(JSON.stringify(x));
function load(change = {}, historical = false) {
  const ctx = vm.createContext({console, document:{documentElement:{}}, KCP:{route(){},on(){}}}); ctx.window=ctx;
  vm.runInContext('Math.random=()=>{throw Error("비공개 난수 접근")}',ctx);
  for (const n of files) {
    let src = historical ? base(n) : currentSource[n];
    if (change[n]) src = change[n](src);
    // 비공개 함수의 호출 장치만 노출. 함수 본문과 기대값은 바꾸지 않는다.
    if (n==='league-ai') src=src.replace('  function build(', '  KCP.d87Build = build;\n  function build(');
    if (n==='build') src=src.replace('  function toolGroups() {',
      '  KCP.d87Tools = league => { S = { opts: { league } }; return { flat: toolsOf(), groups: toolGroups() }; };\n  function toolGroups() {');
    vm.runInContext(src,ctx,{filename:n+'.js'});
  }
  return ctx.KCP;
}
const near = (a,b,label) => assert.ok(Number.isFinite(a)&&Math.abs(a-b)<1e-7,`${label}: ${a} != ${b}`);
let checks=0, failures=0;
function test(label, fn) { checks++; try {fn(); console.log('PASS '+label);} catch(e) {failures++; console.error('FAIL '+label+': '+e.stack); process.exitCode=1;} }
const K=load(), {buildGame:B, leagueCore:C, econ:X, ECON_DATA:D}=K;
const R=C.regionOf('south');
// REF 18.2의 산업부 2019-03-05·2017-09-01 p.1 원천값을 먼저 고정 검증한다.
function pmWeights(k) {
  const f=k.ECON_DATA.thermalFacts.pm,w=k.ECON_DATA.params.pmFuelW.v;
  for(const [key,value] of Object.entries({coalReference:.120,coalNew:.044,lngReference:.015,lngNew:.007}))
    near(f[key],value,'산업부 PM 원천 '+key);
  near(w.coal,1,'기존 석탄 가중 보존');near(w.lng,.05,'기존 LNG 가중 보존');
  return {coal:w.coal*f.coalNew/f.coalReference,lng:w.lng*f.lngNew/f.lngReference};
}
test('PM 화면 약 37%·약 47%는 원천 신규/평균 비율과 일치',()=>{
  const f=D.thermalFacts.pm,w=pmWeights(K);
  for(const fuel of ['coal','lng']) near(D.params.pmNewFuelW.v[fuel],w[fuel],fuel+' 신규 가중');
  const ratios=['coal','lng'].map(fuel=>f[fuel+'New']/f[fuel+'Reference']);
  assert.deepEqual(ratios.map(n=>Math.round(n*1000)/1000),[.367,.467]);
  const displayed=[...f.text.matchAll(/약\s*(\d+)%/g)].map(m=>Number(m[1]));
  assert.deepEqual(displayed,ratios.map(n=>Math.round(n*100)),'같은 연료 평균 대비 화면 비율');
});
function thermalTools(k,league) {
  const leaguePacks=new Set(k.leagueCore.regionOf('south').teams.map(t=>t.pack));
  // #build의 기본 지도 선택은 PACK_IDS 전체이므로 모든 팩을 비리그 모드로 확인한다.
  const packs=Object.values(k.buildGame.PACKS).filter(p=>!league||leaguePacks.has(p.id));
  assert.ok(packs.length>0,'검사할 팩 존재');
  for(const pack of packs) {
    k.buildGame.selectPack(pack.id,league?'league':undefined);
    const tools=k.d87Tools(league),visible=pack.groups?tools.groups.flatMap(g=>g.tools):tools.flat;
    for(const fuel of ['coal','lng']) {
      assert.equal(visible.includes(fuel),league,pack.id+'/'+fuel+' 화면 도구');
      assert.equal(tools.flat.includes(fuel),league,pack.id+'/'+fuel+' 허용 도구');
    }
  }
  console.log((league?'리그':'#build 비리그')+' 도구 검사 팩',packs.map(p=>p.id).join(','));
}
test('#build 모든 비리그 팩에 석탄·LNG 신설 도구 없음',()=>thermalTools(load(),false));
test('리그 팩에 석탄·LNG 신설 도구 있음',()=>thermalTools(load(),true));
test('실제 지도에서 빈 해안·하천 재계수, 용량·CAPEX·기존 가격',()=>{
  const old=load({},true), counts=[79,40,22,28,19,1]; let prices=0;
  R.teams.forEach((t,j)=>{
    B.selectPack(t.pack,'league'); old.buildGame.selectPack(t.pack,'league');
    const cells=B.TILES.filter(t=>!t.out&&t.site<0&&['beach','river'].includes(t.t));
    assert.equal(cells.length,counts[j],t.id+' 지도 후보');
    for(const fuel of ['coal','lng']) {
      const mw=({coal:1040,lng:561})[fuel]/R.mwScale;
      near(B.BLD[fuel].mw,mw,'MW 실제값/축척');
      near(B.BLD[fuel].cost,(7.5/4500)*({coal:1809,lng:1275})[fuel]*mw,'CAPEX');
      assert.deepEqual(json(B.TILES.filter(t=>!B.siteRule(fuel,t)).map(t=>t.i)),json(cells.map(t=>t.i)));
      const duplicate=B.sanitize({builds:[{t:fuel,i:cells[0].i},{t:fuel,i:cells[0].i}],lines:[],policies:[],missions:[]},1e6);
      assert.equal(duplicate.builds.length,1,'이미 지은 칸 중복 건설 금지');
      const node=B.network({builds:[{t:fuel,i:cells[0].i}],lines:[]}).nodes.find(n=>n.bi===0);
      near(node.cap,mw,'신규 cap');
    }
    for(const [key,b] of Object.entries(old.buildGame.BLD)) {near(B.BLD[key].cost,b.cost,t.id+'/'+key+' 기존 가격'); prices++;}
    const nodes=B.network({builds:[],lines:[]}).nodes;
    B.SITES.filter(s=>s.kind==='plant').forEach(s=>near(nodes.find(n=>n.tile===s.tile).cap,s.cap,'기존 cap'));
  });
  assert.ok(prices>=90,'기존 가격 비교 누락 방지');
  const scale=R.mwScale; R.mwScale=scale/2; B.selectPack(R.teams[0].pack,'league');
  near(B.BLD.coal.mw,1040/(scale/2),'축척 변경'); R.mwScale=scale;
});
function fixture(k, demand=0, oldPlant=true) {
  const b=k.buildGame,r=k.leagueCore.regionOf('south');
  b.PACKS.d87oracle={id:'d87oracle',budget:1000,rows:['bbbbbbbbb'],legend:{b:'beach'},
    climate:b.PACKS.pyeongtaek.climate,goals:{costBase:100,costPerDay:1,co2Day:100},attachAny:true,
    groups:[{id:'thermal',tools:['coal','lng','smr']}],
    sites:[{kind:'city',c:0,r:0,dem:{base:demand}},...(oldPlant?[{kind:'plant',fuel:'coal',cap:2,c:8,r:0}]:[])],
    gates:[{c:7,r:0,to:['other']}]};
  r.teams.push({id:'d87oracle',pack:'d87oracle'}); b.selectPack('d87oracle','league');
  return {builds:[],lines:[{p:[0,1,2,3,4,5,6,7,8]}],policies:[],missions:[],seed:17};
}
function siting(k) {
  const b=k.buildGame,p=fixture(k);
  for(const fuel of ['coal','lng','smr']) for(const [i,w] of [[1,1],[2,.6],[3,.3],[4,0]]) {
    const q={...p,builds:[{t:fuel,i}]};
    for(const frac of [[0],[1]]) near(b.complaints(q,frac).items.reduce((s,c)=>s+c.pts,0),10*w,fuel+' siting d='+i);
  }
  assert.equal(b.complaints(p,[]).items.length,0,'기존 plant 소급 없음');
}
test('siting 거리 경계·세 전원 동등·가동률 독립·기존 제외',()=>siting(K));
function pm(k) {
  const x=k.econ,d=k.ECON_DATA;
  const w=pmWeights(k);
  const E=x.initCities(['hwaseong'],d,{seed:'independent',months:12});
  const gen={coal:130,lng:110}, book={coal:40,coalNew:90,lng:30,lngNew:80};
  const own=energy=>x.monthStep(E,{hwaseong:{energy}},d).report.cities.hwaseong.pm25.own;
  near(own({genMWh:gen}),7e-6*(130+110*.05),'옛 입력 가중');
  near(own({genMWh:gen,pmGenMWh:book}),7e-6*(40+90*w.coal+30*.05+80*w.lng),'신구 PM');
  const result=x.monthStep(E,{hwaseong:{energy:{genMWh:gen,pmGenMWh:book}}},d).report;
  near(result.fiscal.hwaseong.rev.facility,.65*(130*.7+110*.6)*230*1000/1e8/28,'과세는 신구 합산 총발전량');
}
test('기존·신설 PM 독립 가중',()=>pm(K));
test('급전 총량·최소출력·PM·연료·CO2 보존',()=>{
  const p=fixture(K,.01,false);
  for(const fuel of ['coal','lng']) {
    const s=B.simulate({...p,builds:[{t:fuel,i:1}]},1,{league:true});
    near(s.tot.by.coal,fuel==='coal'?1040/R.mwScale*.3*24:0,'신규 석탄 최소출력');
    if(fuel==='lng') assert.ok(s.tot.by.lng>0&&s.tot.by.lng<(561/R.mwScale)*.3*24,'LNG는 작은 수요만 생산, 최소0');
    assert.ok(Object.values(s.tot.by).every(Number.isFinite));
  }
  fixture(K,.01);
  near(B.simulate(p,1,{league:true}).tot.by.coal,2*.3*24,'기존 석탄 최소출력');
  fixture(K,8);
  const s=B.simulate({...p,builds:[{t:'coal',i:1},{t:'lng',i:2}]},1,{league:true});
  assert.ok(s.tot.pmBy.coal>0&&s.tot.pmBy.coalNew>0);
  for(const f of ['coal','lng']) near(s.tot.by[f],(s.tot.pmBy[f]||0)+(s.tot.pmBy[f+'New']||0),'신구 총량 '+f);
  near(s.tot.fuel,s.tot.by.coal*.0045+s.tot.by.lng*.008,'총 연료');
  near(s.tot.co2,s.tot.by.coal*.82+s.tot.by.lng*.37,'총 CO2');
  for(const g of s.gx) for(const f of ['coal','lng']) {
    near(g.byHead[f]||0,(g.pmHead[f]||0)+(g.pmHead[f+'New']||0),'수출 비중');
    for(let h=0;h<24;h++) near(g.byDisp[f]?.[h]||0,(g.pmDisp[f]?.[h]||0)+(g.pmDisp[f+'New']?.[h]||0),'대체 비중');
  }
});
test('거래 sent/got의 신구 PM 가중합·생산 총량 보존',()=>{
  const gate=to=>({to:[to],def:[0],ren:[0],head:[0],disp:[0],dmc:[0],dco2:[0],mc:.0045,co2i:.82});
  const seller={...gate('b'),head:[20],byHead:{coal:1},pmHead:{coal:.4,coalNew:.6}};
  const buyer={...gate('a'),disp:[18],dmc:[.008],dco2:[.37],byDisp:{lng:[1]},pmDisp:{lng:[.25],lngNew:[.75]}};
  const t=C.settle([{id:'a~b',a:'a',b:'b',cap:20,loss:.1}],{a:{gx:[seller]},b:{gx:[buyer]}},{a:.005,b:.02},1,1).out;
  for(const [a,b,label] of [[t.a.pmX.coal,8,'구석탄'],[t.a.pmX.coalNew,12,'신석탄'],[t.b.savePM.lng,4.5,'구LNG'],[t.b.savePM.lngNew,13.5,'신LNG'],[t.a.byX.coal,20,'총수출'],[t.b.saveBy.lng,18,'총감발'],[t.a.fuelX,.09,'수출연료'],[t.b.saveFuel,.144,'감발연료'],[t.a.co2X,16.4,'수출탄소'],[t.b.saveCo2,6.66,'감발탄소']]) near(a,b,label);
  const w=pmWeights(K),weight=q=>(q.coal||0)+(q.coalNew||0)*w.coal+(q.lng||0)*.05+(q.lngNew||0)*w.lng;
  near(weight(t.a.pmX)-weight(t.b.savePM),8+12*w.coal-4.5*.05-13.5*w.lng,'거래 후 가중 변화');
});
// 실제 학생 score를 별도로 만든 상태에 호출한다. 예측 구현을 복제하지 않는다.
function scoreFixture(k) {
  const d=k.ECON_DATA,x=k.econ,E=x.initCities(['hwaseong'],d,{seed:'score-oracle',months:12}),c=E.cities.hwaseong;
  d.params.lambdaSlow.v=1;
  for(const g of Object.keys(d.params.groupW.v)) d.params.groupW.v[g]={};
  for(const g of Object.keys(c.groups)) {c.groups[g].sat=50;c.groupContrib[g]={other:50};}
  c.approval=50;c.approvalHistory=[50];c.co2Intensity=c.co2Intensity0=.82;
  return E;
}
function scoreCheck(k) {
  const E=scoreFixture(k),x=k.econ,c=E.cities.hwaseong;
  const e={demMWh:100,servedMWh:100,co2:37,cpList:[{kind:'siting',score:200}]};
  const expected=json(E),s=expected.cities.hwaseong;
  s.co2Intensity=.37;
  const affected=c.groups.senior.share+c.groups.youth.share;
  s.approvalHistory=[50,50-20*affected];
  const actual=x.projectEnergyScore(E,'hwaseong',e,1);
  assert.deepEqual(json(actual),json(x.score(expected).by.hwaseong),'한 달 탄소·민원 손계산');
  const uncapped=x.projectEnergyScore(E,'hwaseong',{...e,cpList:[{kind:'siting',score:20}]},1);
  assert.deepEqual(json(actual),json(uncapped),'민원 상한20');
}
test('학생 점수식으로 탄소·지지 이력 손계산 및 민원 상한',()=>scoreCheck(K));
// 예외는 이전 AI가 성향 조건으로 건너뛴 후보에 대한 추가 제안뿐이다.
function zeroPlanContract(now,first,skipped) {
  assert.deepEqual(now.plan,first.plan,'계수0 설비·연구 계획 동일');
  assert.deepEqual(now.econPol,first.econPol,'계수0 정책 동일');
  const extra=[],remaining=[...now.ties];
  for(const action of first.ties) {
    const i=remaining.findIndex(a=>JSON.stringify(a)===JSON.stringify(action));
    assert.ok(i>=0,'이전 제안·수락·취소의 제거·변경 금지');remaining.splice(i,1);
  }
  const seen=new Set();
  for(const action of remaining) {
    const candidate=skipped.find(s=>s.other===action.other);
    assert.ok(candidate&&!candidate.incoming&&!candidate.existing&&!candidate.gridTight&&candidate.risk!==candidate.boldRisk,
      '연계선 차이는 이전 gridTight·risk 건너뛰기 후보에서만 허용');
    assert.deepEqual(action,{type:'propose',other:candidate.other,cap:candidate.cap,kind:candidate.kind},'승인 예외는 해당 후보의 추가 제안');
    assert.ok(!seen.has(action.other),'같은 후보 중복 제안 금지');seen.add(action.other);
    extra.push({...candidate,action});
  }
  return extra;
}
test('계수0 비교 계약은 설비·기존 행동·skip 외 연계선 변이를 거절',()=>{
  const first={plan:{builds:[],lines:[]},econPol:{service:0},ties:[]};
  const action={type:'propose',other:'pyeongtaek',cap:2,kind:'ac'};
  const now={...json(first),ties:[action]};
  const candidate={other:'pyeongtaek',incoming:false,existing:false,gridTight:false,risk:0,boldRisk:1,cap:2,kind:'ac'};
  assert.equal(zeroPlanContract(now,first,[candidate]).length,1,'승인된 추가 제안은 허용');
  for(const change of [{incoming:true},{existing:true},{gridTight:true},{risk:1}])
    assert.throws(()=>zeroPlanContract(now,first,[{...candidate,...change}]),assert.AssertionError);
  assert.throws(()=>zeroPlanContract(now,first,[]),assert.AssertionError,'skip 외 후보');
  for(const change of [{type:'accept'},{type:'cancel'},{cap:3},{kind:'hvdc'},{other:'asan'}])
    assert.throws(()=>zeroPlanContract({...now,ties:[{...action,...change}]},first,[candidate]),assert.AssertionError);
  assert.throws(()=>zeroPlanContract({...now,plan:{builds:[{t:'coal',i:1}],lines:[]}},first,[candidate]),assert.AssertionError);
  assert.throws(()=>zeroPlanContract({...now,econPol:{service:1}},first,[candidate]),assert.AssertionError);
  assert.throws(()=>zeroPlanContract(first,now,[candidate]),assert.AssertionError,'기존 제안 제거 금지');
  assert.throws(()=>zeroPlanContract({...now,ties:[action,action]},first,[candidate]),assert.AssertionError,'중복 제안 금지');
});
function zeroScoreComparison() {
  const legacyAI=()=>{
    const source=base('league-ai');
    const guard='if (!incoming && (existing || style.risk !== value("aiStyles").bold.risk && !gridTight)) continue;';
    assert.equal(source.split(guard).length,2,'a7f93be 성향별 skip 관측 위치 1곳');
    // 원래 분기와 반환 행동은 유지하고, 실제로 건너뛴 후보만 기록한다.
    return source.replace(guard,`if (!incoming && !existing && style.risk !== value("aiStyles").bold.risk && !gridTight)
      KCP.d87Skipped.push({other, incoming, existing:!!existing, gridTight:!!gridTight,
        risk:style.risk, boldRisk:value("aiStyles").bold.risk, cap:TIE_CAP,
        kind:C.techOf(S,id).includes("hvdc")?"hvdc":def.kind});
      ${guard}`);
  };
  const now=load(),first=load({'league-ai':legacyAI});first.d87Skipped=[];
  for(const k of [now,first]) k.ECON_DATA.params.aiScoreValue.v=0;
  const ids=now.leagueCore.regionOf('south').teams.map(t=>t.id),differences=[],approved=[];
  let monthlyPlans=0,candidatePlans=0;
  const compare=(a,b,skipped,label)=>{
    try {for(const candidate of zeroPlanContract(a,b,skipped)) approved.push({label,...candidate});}
    catch(e) {differences.push({label,error:e.message,now:a,first:b,skipped});}
  };
  // 같은 공개 상태를 두 VM에 입력한다. 이전 AI의 실제 운영 경로를 6달 진행한다.
  for(const style of ['careful','balanced','bold']) {
    const c=first.leagueCore,r=c.regionOf('south');
    const S=c.newState('d87-first','south',0,ids,{turns:12});
    for(const id of ids) assert.equal(c.reduce(S,{type:'claim',team:id,token:'d87-first-'+id},0,first.buildGame).ok,true,'월 운영용 도시 자리 확보');
    for(let month=1;month<=6;month++) {
      c.host(S,'next',month*100);
      for(const id of ids) {
        const before=JSON.stringify(S);
        first.d87Skipped=[];
        compare(json(now.leagueAI.plan(json(S),now.leagueCore.regionOf('south'),id,now.buildGame,style)),
          json(first.leagueAI.plan(json(S),r,id,first.buildGame,style)),json(first.d87Skipped),`${style}/${id}/${month}달 실제 지도`);
        assert.equal(JSON.stringify(S),before,'계획 비교 원본 상태 불변');monthlyPlans++;
      }
      for(const repliesOnly of [false,true]) {
        const requests=c.computerPlans(S,first.buildGame,null,style,repliesOnly);
        assert.ok(requests.length>0&&requests.every(r=>r.ok),`이전 AI 계획·응답 요청 실제 승인: ${style}/${month}/${repliesOnly} ${JSON.stringify(requests.filter(r=>!r.ok))}`);
      }
      c.run(S,first.buildGame,month*100+1);
      assert.equal(S.results.length,month,'실제 월 운영 누락 없음');
    }
  }
  // 연결·자금과 현금 편익을 갖춘 후보로 이전 성향별 skip을 실제 실행한다.
  // 망·급전 입력만 고정하고 plan·settle·worth·성향 분기는 원본을 실행한다.
  function connected(k) {
    k.TECH_DATA=null;
    const c=k.leagueCore,pair=['hwaseong','pyeongtaek'],[a,b]=pair;
    const S=c.newState('d87-zero-tie','south',0,pair,{turns:12});
    const H=168,arr=n=>new Array(H).fill(n);
    const gate=to=>({to:[to],def:arr(0),ren:arr(0),head:arr(0),disp:arr(0),
      dmc:arr(0),dco2:arr(0),mc:0,co2i:0});
    const sims={
      [a]:{H,dem:arr(1000/H),uns:arr(0),k:{dem:1000,uns:0,co2:0},cpList:[],gx:[{...gate(b),ren:arr(2)}]},
      [b]:{H,dem:arr(1000/H),uns:arr(0),k:{dem:1000,uns:0,co2:820},cpList:[],
        gx:[{...gate(a),disp:arr(2),dmc:arr(.02),dco2:arr(.82)}]}
    };
    S.teams[a].price=.015;S.teams[b].price=.02;
    const def={id:a+'~'+b,a,b,cap:2,kind:'ac',loss:.1};
    const r={teams:pair.map(id=>({id,pack:id})),ties:[def]};
    const bg={PACKS:{},BLD:{},TILES:[],capex:()=>0,selectPack(id){this.id=id;},peakDemand:()=>10,
      get SITES(){return [{kind:'gridpt',tile:1,to:[this.id===a?b:a]}];},
      network:()=>({nodes:[{kind:'plant',cap:100,tile:0,comp:0,live:true},
        {kind:'gridpt',tile:1,comp:0}],comps:[{towns:[{comp:0}]}]})};
    let tight=false;
    Object.assign(c,{roundsOf:()=>Array.from({length:12},(_,i)=>({month:i+1,days:7,mdays:30})),
      budget:()=>1000,gridStatus:()=>({peakMW:10,headroomMW:tight?0:100,waitingMW:0,reservedMW:0,monthlyMW:1}),
      fundingOf:()=>({ok:true,grant:{awarded:0}}),fixedOf:()=>0,lossOf:()=>0,researchReserve:()=>0,
      techOf:()=>[],tieCost:()=>1,effectiveTie:(s,t)=>t,modsFor:()=>({}),trialMods:()=>({}),simTeam:(bg,r,id)=>sims[id]});
    return {k,S,r,bg,def,setTight:v=>{tight=v;}};
  }
  const candidateNow=load(),candidateFirst=load({'league-ai':legacyAI});candidateFirst.d87Skipped=[];
  for(const k of [candidateNow,candidateFirst]) k.ECON_DATA.params.aiScoreValue.v=0;
  const fixtures=[connected(candidateNow),connected(candidateFirst)];
  const coverage={careful:0,balanced:0,bold:0};
  for(let month=1;month<=6;month++) for(const style of Object.keys(coverage))
    for(const tight of [false,true]) for(const state of ['candidate','incoming','built']) {
      candidateFirst.d87Skipped=[];
      const plans=fixtures.map(f=>{
        f.S.round=month;f.setTight(tight);
        f.S.ties=state==='candidate'?[]:[{...f.def,st:state==='built'?'built':'prop',by:'pyeongtaek'}];
        const before=JSON.stringify(f.S);
        const answer=json(f.k.leagueAI.plan(f.S,f.r,'hwaseong',f.bg,style));
        assert.equal(JSON.stringify(f.S),before,'연결 후보 비교 원본 상태 불변');
        return answer;
      });
      const want=state==='built'||state==='candidate'&&!tight&&style!=='bold'?[]:
        [{type:state==='incoming'?'accept':'propose',other:'pyeongtaek',cap:2,kind:'ac'}];
      assert.deepEqual(plans[1].ties,want,'이전 AI: 연결·현금 양수 후보의 성향별 skip/제안/수락/준공 경로');
      compare(plans[0],plans[1],json(candidateFirst.d87Skipped),`${style}/${month}달/${tight?'접속 부족':'접속 여유'}/${state}`);
      coverage[style]++;candidatePlans++;
    }
  assert.equal(monthlyPlans,108);assert.equal(candidatePlans,108);
  assert.deepEqual(coverage,{careful:36,balanced:36,bold:36});
  console.log('계수0 이전 AI 비교',JSON.stringify({monthlyPlans,candidatePlans,coverage,
    approvedSkipDifferences:approved.length,forbiddenDifferences:differences.length}));
  for(const difference of approved) console.log('계수0 승인된 skip 후보 차이',JSON.stringify(difference));
  if(differences.length) console.error('계수0 이전 AI 불일치',JSON.stringify(differences));
  assert.equal(differences.length,0,'계수0: 설비·정책 동일, 연계선은 이전 성향별 skip 후보 외 차이 금지');
  assert.equal(approved.filter(d=>d.label.endsWith('/candidate')).length,12,'기존 12건 모두 승인된 후보 차이로 분류');
}
test('계수0: a7f93be와 6달 설비 계획 동일·연계선 차이는 성향별 skip 후보 한정',zeroScoreComparison);
function comparison(k) {
  const E=scoreFixture(k),x=k.econ,d=k.ECON_DATA,c=E.cities.hwaseong;
  const row=(co2,complaint)=>{
    const draft=json(E),city=draft.cities.hwaseong;city.co2Intensity=co2;
    city.approvalHistory=[50,50-complaint*(c.groups.senior.share+c.groups.youth.share)];
    return x.score(draft).by.hwaseong.score;
  };
  const before=row(.82,0),dirty=row(.82,20),clean=row(.37,0);
  const threshold=10/(clean-dirty);assert.ok(threshold>0);
  const tiles=[0,1,2].map(i=>({i,nb:[0,1,2].filter(j=>j!==i),site:i===0?0:-1}));
  const bg={BLD:{coal:{cls:'disp',mw:1,cost:10},lng:{cls:'disp',mw:1,cost:20}},TILES:tiles,
    SITES:[{tile:0,dem:{base:.5}}],PACKS:{synthetic:{}},selectPack(){},peakDemand:()=>.5,
    siteRule:(t,p)=>p.i===0?'occupied':'',complaints:()=>({items:[]}),
    capex:p=>p.builds.reduce((s,b)=>s+({coal:10,lng:20})[b.t],0),
    network:p=>({nodes:[{kind:'town',tile:0,comp:0,att:[[0,0]],bf:{dist:new Map([[0,0],[1,0],[2,0]])}},
      ...p.builds.map(b=>({kind:b.t,cap:1,tile:b.i,comp:0,att:[[b.i,0]],live:true}))],comps:[{towns:[{comp:0}]}]})};
  const rounds=[{month:1,days:1,mdays:1}],S={round:1,room:'synthetic',econ:E,teams:{hwaseong:{plan:{builds:[],lines:[]},base:[],committed:0}}};
  Object.assign(k.leagueCore,{roundsOf:()=>rounds,budget:()=>1000,fixedOf:()=>0,lossOf:()=>0,researchReserve:()=>0,
    fundingOf:()=>({ok:true,grant:{awarded:0}}),techOf:()=>[],gridStatus:()=>({peakMW:.5,headroomMW:100,waitingMW:0,reservedMW:0,monthlyMW:100}),
    trialMods:()=>({}),simTeam:(bg,r,id,p)=>({H:1,dem:[100],uns:[0],cpList:p.builds[0]?.t==='coal'?[{kind:'siting',score:20}]:[],
      k:{dem:100,uns:0,fuel:0,co2:p.builds[0]?.t==='lng'?37:82}})});
  for(const value of [0,threshold/2,threshold*2,30]) {
    d.params.aiScoreValue.v=value;
    const cost={coal:10-value*(dirty-before),lng:20-value*(clean-before)};
    const want=cost.coal<cost.lng?'coal':'lng';
    const p=k.d87Build(S,{teams:[{id:'hwaseong',pack:'synthetic'}]},'hwaseong',bg,{invest:1,risk:0,delay:0},{builds:[],lines:[]});
    assert.equal(p.builds[0]?.t,want,`총점 변화×계수 ${value}, 손계산 비용 ${JSON.stringify(cost)}`);
  }
}
test('작은 후보 두 개: 학생 총점 변화×계수의 선택 전환 경계',()=>comparison(load()));
function hiddenCheck(k) {
  const c=k.leagueCore,r=c.regionOf('south'),ids=r.teams.map(t=>t.id),s=c.newState('hidden','south',0,ids,{turns:12});
  c.host(s,'next',1);
  const before=JSON.stringify(s),normal=k.leagueAI.plan(s,r,ids[0],k.buildGame,'balanced');
  const hidden=json(s);hidden.salt=999;hidden.events=[{id:'lng_spike',round:1,get x(){throw Error('숨은 사건 x를 읽음');}}];
  let answer;
  assert.doesNotThrow(()=>{answer=k.leagueAI.plan(hidden,r,ids[0],k.buildGame,'balanced');},'숨은 x 접근 금지');
  assert.deepEqual(json(answer),json(normal));
  assert.equal(JSON.stringify(s),before,'계획 원본 불변');
}
test('비공개 사건 x·salt 변이와 접근 금지 getter',()=>hiddenCheck(load()));
const mutate=(from,to)=>s=>{assert.ok(s.includes(from),'변이 위치 존재: '+from);return s.replace(from,to);};
for(const [name,change,probe] of [
  ['신규 석탄 PM=1',{'econ-data':mutate('coal: pmFuelW.coal * (pmFacts.coalNew / pmFacts.coalReference)','coal: 1')},pm],
  ['신규 LNG를 옛 직접비 0.007/0.120으로 복원',{'econ-data':mutate('lng: pmFuelW.lng * (pmFacts.lngNew / pmFacts.lngReference)','lng: 0.007 / 0.120')},pm],
  ['기존 석탄 PM=.367',{'econ-data':mutate('coal: 1, diesel:','coal: .367, diesel:')},pm],
  ['siting에 PM 가중 곱',{'build':mutate('KCP.ECON_DATA.params.sitingBase.v * weights[d]','KCP.ECON_DATA.params.sitingBase.v * weights[d] * (B.t === "coal" ? .044/.120 : B.t === "lng" ? .007/.120 : 1)')},siting],
  ['점수 비교 끄기',{'league-ai':mutate('value("aiScoreValue") * scoreDelta','0 * scoreDelta')},comparison],
  ['숨은 사건 x 읽기',{'league-ai':mutate('  function plan(S, R, id, bg, style) {','  function plan(S, R, id, bg, style) { (S.events || []).forEach(ev => void ev.x);')},hiddenCheck],
  ['민원 상한 제거',{'econ-data':mutate('complaintCap: p(20,','complaintCap: p(200,')},scoreCheck],
]) test('변이 탐지: '+name,()=>{
  const k=load(change);assert.throws(()=>probe(k),assert.AssertionError,'같은 계약 검사에서 실패해야 함');
});
test('B18 접속 대기 감소·접속용 ESS 전체 제거 급전·개별 효과는 정보',()=>{
  const k=load(),b=k.buildGame,c=k.leagueCore,r=c.regionOf('south'),id=r.teams[0].id;
  const S=c.newState('b18-small','south',0,r.teams.map(t=>t.id),{turns:12}); S.round=1;
  b.PACKS.d87b18={id:'d87b18',budget:1000,rows:['bbbbbbbbb'],legend:{b:'beach'},
    climate:b.PACKS.pyeongtaek.climate,goals:{costBase:100,costPerDay:1,co2Day:100},attachAny:true,
    groups:[{id:'storage',tools:['solar','battery']}],sites:[{kind:'city',c:0,r:0,dem:{base:2}}]};
  r.teams.find(t=>t.id===id).pack='d87b18'; b.selectPack('d87b18','league');
  const plan={builds:[1,2,3].map(i=>({t:'solar',i})).concat([4,5,8].map(i=>({t:'battery',i}))),
    lines:[{p:[0,1,2,3,4,5]}],policies:[],missions:[]};
  assert.ok(plan.builds.every(x=>!b.siteRule(x.t,b.TILES[x.i])),'합성 장치 합법 입지');
  const storageKeys=['battery:4','battery:5'],key=x=>`${x.t}:${x.i}`;
  const without=keys=>({...plan,builds:plan.builds.filter(x=>!keys.includes(key(x)))});
  S.teams[id].plan=plan;
  // 접속용 ESS가 있을 때 합법인 기존 접속 이력을 주입한다. 월 처리량·계수는 바꾸지 않는다.
  S.grid[id]={peakMW:2,round:1,entries:plan.builds.filter(x=>x.t==='solar').map(x=>
    ({key:key(x),t:x.t,i:x.i,mw:b.BLD.solar.mw,allocatedMW:b.BLD.solar.mw}))};
  S.grid[id]=c.gridStatus(S,r,b,id);
  const removed=without(storageKeys),draft={...S,teams:{...S.teams,[id]:{...S.teams[id],plan:removed}}};
  const noStorage=c.gridStatus(draft,r,b,id);
  assert.equal(S.grid[id].waitingMW,0,'접속용 ESS가 있으면 전량 접속');
  assert.ok(noStorage.waitingMW>S.grid[id].waitingMW,'접속용 ESS가 대기를 줄임');
  assert.deepEqual(removed.builds.filter(x=>x.t==='battery').map(key),['battery:8'],'기존·일반 ESS는 남김');
  assert.equal(removed.lines,plan.lines,'선로 고정');
  const before=JSON.stringify(S),mods=c.modsFor(S,r,id),rnd={...c.roundsOf(S)[0],seed:17};
  // 제거 뒤 접속 상한을 다시 계산한 mods를 쓰지 않는다. 같은 발전·수요·날씨로 저장 기여만 분리한다.
  const spill=p=>{const s=c.simTeam(b,r,id,p,rnd,1e9,mods);return s.k.curt+(s.curtailMWh||0);};
  const actualMWh=spill(plan),sourceMWh=spill(removed);
  const individual=storageKeys.map(key=>spill(without([key]))-actualMWh);
  assert.ok(Number.isFinite(sourceMWh)&&Number.isFinite(actualMWh)&&sourceMWh-actualMWh>1e-6,
    '접속용 ESS 전체 제거 시 버림 증가');
  assert.ok(individual.every(x=>Math.abs(x)<=1e-6),'개별 제거 효과는 중복 흡수로 0인 장치');
  assert.equal(JSON.stringify(S),before,'제거 대조가 상태·계획을 바꾸지 않음');
  const changes=storageKeys.map((key,i)=>({storageKeys:[key],observedMonths:1,
    capturedMWh:individual[i],...(individual[i]>1e-6?{verifiedAtMonth:1}:{})}));
  const row={id,month:1,connected:S.grid[id].waitingMW<=1e-6,storageKeys,sourceMWh,actualMWh};
  console.log('B18 합성 급전',JSON.stringify({waitingMW:S.grid[id].waitingMW,
    withoutStorageWaitingMW:noStorage.waitingMW,sourceMWh,actualMWh,individual}));
  const output=execFileSync('python3',['-B','-c',`
import importlib.util,json,sys,copy,subprocess,tempfile,contextlib,io
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('bots36','tests/league/bots36.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
data=json.load(sys.stdin)
def fixture(changes,rows):
    return {'checks':[], 'runs':[{'planRequests':[{'strategy':'storage','changes':changes}],
                                'storageObservations':rows}]}
good=fixture(data['changes'],[data['row']])
none=copy.deepcopy(good)
for change in none['runs'][0]['planRequests'][0]['changes']:
    change['observedMonths']=0
none['runs'][0]['storageObservations']=[]
bad=copy.deepcopy(good)
bad['runs'][0]['storageObservations'][0]['actualMWh']=data['row']['sourceMWh']
missing=copy.deepcopy(good)
missing['runs'][0].pop('storageObservations')
with contextlib.redirect_stdout(io.StringIO()):
    counts=m.b18_observation_report([none,bad,good,missing])
print('B18 합성 집계(실패 장치는 기대된 검출)',counts)
assert counts == {'통과':1,'실패':2,'관측 없음':1}, counts
assert not none['checks']
assert bad['checks'][0][0] is False and good['checks'][0][0] is True
assert missing['checks'][0][0] is False
assert good['b18Observation']['improvedBundles']==0, '개별 효과 0도 묶음 양수면 통과'
assert good['b18Observation']['collectiveImprovedMonths']==1
# 실행 전체가 미관측이면 일반 집계와 CLI 모두 실패해야 한다.
with tempfile.TemporaryDirectory() as directory:
    paths={}
    for name,out in [('none',none),('bad',bad),('good',good),('missing',missing)]:
        path=Path(directory)/(name+'.json')
        path.write_text(json.dumps(out),encoding='utf-8');paths[name]=str(path)
    for names,want in [(('none',),1),(('none','none'),1),(('none','good'),0),
                       (('good',),0),(('good','bad'),1),(('bad',),1),(('missing',),1)]:
        result=subprocess.run([sys.executable,'-B','tests/league/bots36.py','--b18-only',
                               *(paths[name] for name in names)],capture_output=True,text=True)
        assert result.returncode==want, (names,result.returncode,result.stdout,result.stderr)
        assert ('FAIL' in result.stdout)==bool(want), (names,result.stdout)
    only_none=copy.deepcopy(none)
    with contextlib.redirect_stdout(io.StringIO()):
        empty_counts=m.b18_observation_report([only_none])
    assert empty_counts == {'통과':0,'실패':0,'관측 없음':1}, empty_counts
    assert any(passed is False for passed,_ in only_none['checks']), '일반 실행도 무관측 실패 단언 필요'
    # 긴 Node 시뮬레이션만 대체하고 일반 main의 집계·저장·종료 판정을 실행한다.
    raw={'months':12,'rotations':2,'strategies':['storage'],'ids':[],'names':{},'runs':[],'checks':[]}
    target=Path(directory)/'normal'
    with (
        patch.object(m.subprocess,'run',return_value=SimpleNamespace(stdout=json.dumps(raw))),
        patch.object(sys,'argv',['bots36.py','--node','--quick','--output-dir',str(target)]),
        contextlib.redirect_stdout(io.StringIO())
    ):
        code=m.main()
    result=json.loads((target/'bots36.json').read_text())
    assert code==1 and result['b18Observation']['status']=='관측 없음'
    assert any(passed is False and '관측된 씨앗 없음' in label for passed,label in result['checks'])
print('B18 일반 main·집계 무관측 실패·CLI 7경로 종료 코드 확인')
`],{cwd:ROOT,encoding:'utf8',input:JSON.stringify({changes,row})});
  console.log(output.trim());
});
console.log(`47-d87 checks ${checks} fail ${failures}`);
