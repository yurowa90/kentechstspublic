"use strict";
// 원본 호스트/봇 하네스 실행. ui 변경 없음. 출력은 stdout 또는 OS scratch만.
// 종료 0은 측정 수집 성공이다. 내부 검사 통과 여부는 checks의 exitCode와 bots.failures로 판정한다.
// node tests/league/review/D-debt-diag.js --all
// node tests/league/review/D-debt-diag.js --job host baseline epsilon
// node tests/league/review/D-debt-diag.js --job bots fiscal epsilon
// node tests/league/review/D-debt-diag.js --job checks fiscal
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const os = require('node:os'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const {spawn, execFileSync} = require('node:child_process');
const ROOT = path.resolve(__dirname, '../../..');
const SEEDS = ['bots-strategy-common', 'alpha', 'beta', 'gamma', 'delta', 'epsilon'];
const MODULES = ['build-maps','tech-data','build','econ-data','econ','league-data','league-core','league-ai'];
const CANDIDATES = {
  // 3차 D-84: 기존 후보는 보존하며 --d84는 아래 3×3 격자만 실행한다.
  ...Object.fromEntries([0, 1, 3].flatMap(loss => [0, 0.5, 0.75].map(grid =>
    [`r3_l${loss}_g${grid}`, {params: {aiLossWeight: loss, aiGridFirmShare: grid},
      meaning: `D-84 손실 가중 ${loss}, 계통 확정 공급 인정 몫 ${grid}. 기존 재정·연구·근거 계수 보존.`}]))),
  // 2차 후보. 기존 source()의 after 표현식으로 조합도 같은 VM에서만 적용한다.
  // 추가 대입마다 G/기존값을 확인한다. 2차 실행은 r2_ 키만 선택하며 fiscal은 제외한다.
  r2_labs_reserve: {data:'TECH_DATA', key:'aiLabs', before:2, after:'(()=>{const q=window.KCP.TECH_DATA.params.aiResearchReserve;if(q.grade!=="G"||q.v!==2)throw Error("G/value guard");q.v=12;return 1;})()', meaning:'연구소 목표 1곳과 운영비 12달 예약. 연구를 없애지 않고 지속 운영 가능한 규모를 먼저 확보한다.'},
  r2_unis0: {data:'TECH_DATA', key:'aiUnis', before:1, after:0, meaning:'대학 신설 목표 0곳. 연구소 인력만으로 연구하는 소규모 연구 운영 가정이며 대학 인력 이득을 포기한다.'},
  r2_fuel12: {data:'ECON_DATA', key:'aiFuelMonths', before:36, after:12, meaning:'현재 대표 주 연료비를 1년까지만 외삽한다. 실제 단가를 바꾸지 않고 AI가 현재 가격을 신뢰하는 기간을 줄인다.'},
  r2_fuel6: {data:'ECON_DATA', key:'aiFuelMonths', before:36, after:6, meaning:'현재 대표 주 연료비를 반년까지만 외삽한다. 짧은 가격 전망을 쓰는 AI의 민감도 대조다.'},
  r2_local1: {data:'ECON_DATA', key:'aiLocalFuelWeight', before:4, after:1, meaning:'바이오매스의 축산 인접 입지 가산을 중립화한다. 실제 연료비·민원은 유지하고 종류 안의 입지 비교만 바꾼다.'},
  r2_tie12: {data:'ECON_DATA', key:'aiTieMonths', before:6, after:12, meaning:'연계선 비용 회수 판단을 반년에서 1년으로 늘린다. 거래 편익·양쪽 자금·접속 조건은 유지한다.'},
  r2_small: {"data":"TECH_DATA","key":"aiLabs","before":2,"after":"(()=>{for(const [key,before,after] of [[\"aiResearchReserve\",2,12],[\"aiUnis\",1,0]]){const q=window.KCP.TECH_DATA.params[key];if(q.grade!==\"G\"||q.v!==before)throw Error(\"G/value guard\");q.v=after;}return 1;})()","meaning":"연구소1·예약12·대학0. 연구 규모를 줄이고 그 규모의 1년 운영 여유를 확보한다."},
  r2_research_fuel: {"data":"ECON_DATA","key":"aiFuelMonths","before":36,"after":"(()=>{if(window.KCP.TECH_DATA)for(const [key,before,after] of [[\"aiLabs\",2,1],[\"aiResearchReserve\",2,12]]){const q=window.KCP.TECH_DATA.params[key];if(q.grade!==\"G\"||q.v!==before)throw Error(\"G/value guard\");q.v=after;}return 12;})()","meaning":"연구소1·예약12와 연료 전망12달을 결합한다. 연구 지속비와 가격 전망 기간을 함께 보수적으로 판단한다."},
  r2_small_fuel: {"data":"ECON_DATA","key":"aiFuelMonths","before":36,"after":"(()=>{if(window.KCP.TECH_DATA)for(const [key,before,after] of [[\"aiLabs\",2,1],[\"aiResearchReserve\",2,12],[\"aiUnis\",1,0]]){const q=window.KCP.TECH_DATA.params[key];if(q.grade!==\"G\"||q.v!==before)throw Error(\"G/value guard\");q.v=after;}return 12;})()","meaning":"연구소1·예약12·대학0과 연료 전망12달. 소규모 연구 운영과 1년 연료 전망을 함께 쓰는 가정이다."},
  baseline: null,
  labs: {data:'TECH_DATA', key:'aiLabs', before:2, after:1, meaning:'AI 연구소 목표를 한 곳으로 낮춰 반복 운영비를 줄인다. 36달 수업에서 연구 규모를 작게 잡는 가정이다.'},
  research: {data:'TECH_DATA', key:'aiResearchReserve', before:2, after:12, meaning:'연구소 신설 전에 1년 운영비를 남긴다. 지속 지출의 사전 부담 능력을 보수적으로 판단한다.'},
  supply: {data:'ECON_DATA', key:'aiSupplyReserve', before:.35, after:.1, meaning:'확정 공급 기본 여유를 피크의 10%로 낮춘다. balanced의 추가 여유 10%는 유지하며 부족 시 계통 비용을 부담한다.'},
  renew: {data:'ECON_DATA', key:'aiRenewTarget', before:1.6, after:2.4, meaning:'선택 재생 목표를 높여 연료 노출을 줄인다. balanced 목표는 피크의 0.9배에서 1.3배로 늘고 접속·예산 제약은 유지한다.'},
  fiscal: {data:'ECON_DATA', key:'fiscalTargetRev', before:.3, after:.5, meaning:'시작 보통 조건의 연 운영 잉여 목표를 연 세입의 30%에서 50%로 늘린다. 수업용 초기 이전재원 규모의 가정이며 실제 지원금·한도가 함께 변한다.'}
};
const read = f => fs.readFileSync(path.resolve(ROOT,f),'utf8');
const clone = x => JSON.parse(JSON.stringify(x));
const sum = a => a.reduce((s,x)=>s+x,0);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function once(s,a,b) { assert.equal(s.split(a).length,2,`single site: ${a}`); return s.replace(a,b); }
function pyString(file,key) {
  const m = [...read(file).matchAll(new RegExp(`^${key} = r?"""\\n([\\s\\S]*?)^"""`,'gm'))];
  assert.equal(m.length,1); return m[0][1];
}
function hashes() {
  const files=execFileSync('git',['ls-files','ui'],{cwd:ROOT,encoding:'utf8'}).trim().split('\n');
  files.push('tests/league/bots36.py','tests/league/calib.py','tests/league/review/q8-host-debt.js');
  return Object.fromEntries(files.map(f=>[f,sha(read(f))]));
}
function source(file, candidate, observe=false) {
  let s = fs.readFileSync(file,'utf8');
  const c=CANDIDATES[candidate];
  if(c?.params && path.resolve(file)===path.join(ROOT,'ui/econ-data.js')) {
    s += `\nfor(const [key,v] of Object.entries(${JSON.stringify(c.params)})){const p=window.KCP.ECON_DATA.params[key];if(p.grade!=='G')throw Error('G guard');p.v=v;}\n`;
  }
  if(c?.data && path.resolve(file)===path.join(ROOT,'ui',c.data==='ECON_DATA'?'econ-data.js':'tech-data.js')) {
    s += `\n{const p=window.KCP.${c.data}.params[${JSON.stringify(c.key)}]; if(p.grade!=='G'||p.v!==${c.before}) throw Error('G/value guard'); p.v=${c.after};}\n`;
  }
  if(observe && path.resolve(file)===path.join(ROOT,'ui/league-core.js')) {
    s=once(s,'if (S.econ) act.forEach(({ id }) => gridSupply(out[id], sims[id]));',
      `if (S.econ) act.forEach(({ id }) => { const before=out[id].fuelX; const amount=gridSupply(out[id], sims[id]); globalThis.__grid(S,id,amount,out[id].fuelX-before,sims[id].k.fuel+before-out[id].saveFuel); });`);
  }
  return s;
}
function fileProxy(candidate,observe=false) {
  return {...fs, readFileSync(file,encoding) {
    if(typeof file==='string' && path.resolve(file).startsWith(path.join(ROOT,'ui')+path.sep) && file.endsWith('.js')) {
      const s=source(file,candidate,observe); return encoding ? s : Buffer.from(s);
    }
    return fs.readFileSync(file,encoding);
  }};
}
function host(candidate,seed,observe=true) {
  const traces={}, grid={}; let active=null, checks=0;
  const near=(a,b,label,tol=1e-6)=>{assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=tol,`${label}: ${a}/${b}`);checks++;};
  const attach=ctx=>{
    if(!observe)return;
    ctx.__grid=(S,id,amount,cost,localFuel)=>{if(S===active&&!Object.hasOwn(grid,id))grid[id]={amount,cost,localFuel};};
    const {leagueCore:C,leagueAI:AI,econ:X}=ctx.KCP;
    const plan=AI.plan,run=C.run,step=X.monthStep;
    AI.plan=(S,R,id,B,persona)=>{
      const c=S.econ.cities[id],old=S.teams[id].plan||{builds:[],lines:[]},answer=plan(S,R,id,B,persona);
      (traces[id] ||= []).push({month:S.round,before:clone(c),stageBefore:X.debtStage(c),proposedPolicy:clone(answer.econPol),actualPolicy:clone(S.teams[id].econPol),added:clone(answer.plan.builds.filter(b=>!old.builds.some(o=>o.t===b.t&&o.i===b.i))),researchProposed:clone(answer.plan.rq||[]),intl:clone(S.econ.intl.cur)});
      return answer;
    };
    X.monthStep=(E,inp,...args)=>{
      const result=step(E,inp,...args);
      const D=ctx.KCP.ECON_DATA;
      const clean=Object.fromEntries(E.order.map(id=>[id,X.cleanInput(inp[id],E.cities[id],D.start[id]||{},D)]));
      const actual=X.regionCtx(E,clean,D).otherCost;
      for(const id of E.order) {
        const row=traces[id].at(-1); row.input=clone(inp[id]); row.fiscal=clone(result.report.fiscal[id]); row.after=clone(result.E.cities[id]);
        row.salePrice={actualOtherCost:actual[id],estimateOtherCost:D.params.normalCost.v,
          actual:actual[id]*(1+D.params.tariffMarkup.v),estimate:D.params.normalCost.v*(1+D.params.tariffMarkup.v)};
      }
      return result;
    };
    C.run=(S,B,at)=>{
      active=S; Object.keys(grid).forEach(k=>delete grid[k]);
      const res=run(S,B,at);
      for(const id of Object.keys(S.teams)) {
        const row=traces[id].at(-1),r=res.team[id],f=row.fiscal,g=grid[id];
        assert.ok(g,'grid hook');
        const rd=C.roundsOf(S)[S.round-1],weeks=rd.mdays/res.days,power=f.tariffGross-f.rev.tariff;
        near(r.cost.fuel,Math.round((g.localFuel+g.cost)*100)/100,'fuel split');
        const exp={construction:f.exp.capex,fuel:(r.cost.fuel-g.cost)*weeks,grid:g.cost*weeks,purchase:r.pay*weeks,service:f.exp.service,research:r.cost.research||0,energyPolicy:r.cost.policy*weeks,response:r.cost.resp||0,interest:f.exp.interest,incentive:f.exp.incentive,policyChange:f.exp.policy};
        exp.rounding=f.expTotal+power-sum(Object.values(exp));
        assert.ok(Math.abs(exp.rounding)<.02,'gross residual must be rounding, not an omitted cost');
        const rev={...f.rev,tariff:f.tariffGross};
        near(sum(Object.values(rev))-sum(Object.values(exp)),f.cashAfter-f.cashBefore,'gross ledger');
        near(f.cashAfter,row.after.cash,'cash state');
        const rows=traces[id]; if(rows.length>1) near(rows.at(-2).after.cash,row.before.cash,'month continuity');
        assert.ok(['taxRes','taxInd','service','incentive'].every(k=>row.actualPolicy[k]===0));checks++;
        row.rev=rev;row.exp=exp;row.gridMWh=g.amount*weeks;row.events=clone(res.events);row.energy={unsPct:r.unsPct,renPct:r.renPct,co2Cons:r.co2Cons};
        row.builds=clone(S.teams[id].plan.builds);
        row.electricNet=rev.tariff+rev.trade-exp.fuel-exp.grid-exp.purchase;
      }
      active=null; return res;
    };
  };
  let script=read('tests/league/review/q8-host-debt.js').split('\nconst seeds=')[0];
  script=once(script,"const R=C.regionOf('south')","__attach(ctx); const R=C.regionOf('south')");
  const proxy=fileProxy(candidate,observe);
  const box={console,__dirname,require:n=>n==='fs'?proxy:require(n),__attach:attach};
  const result=vm.runInNewContext(script+`\nrunSeed(${JSON.stringify(seed)},36,'balanced');`,box);
  return {result:clone(result),traces,checks};
}
function bots(candidate,seed) {
  const ctx=vm.createContext({console,document:{documentElement:{}},KCP:{route(){},on(){},esc:x=>x}});ctx.window=ctx;
  vm.runInContext('Math.random=()=>{throw Error("unseeded random")}',ctx);
  MODULES.forEach(n=>vm.runInContext(source(path.join(ROOT,'ui',n+'.js'),candidate),ctx,{filename:n}));
  vm.runInContext(pyString('tests/league/calib.py','AUTO'),ctx);
  let js=pyString('tests/league/bots36.py','JS');
  js=once(js,'const S = newGame("bots-strategy-common"); claim(S);',`const S = newGame(${JSON.stringify(seed)}); console.error('bots ${candidate} ${seed} rotation', rotation); claim(S);`);
  const raw=vm.runInContext(js,ctx)({months:36,rotations:9});
  assert.equal(raw.runs.length,9); assert.ok(raw.runs.every(r=>r.hist.length===36));
  const rows=raw.runs.flatMap(run=>run.rows.map(row=>({...row,over:run.hist.filter(h=>h.fiscal[row.id].debtOver).length,minHead:Math.min(...run.hist.map(h=>h.fiscal[row.id].cashAfter+h.fiscal[row.id].debtCap))})));
  assert.equal(rows.length,54);
  const horizons={};
  for(const month of [12,24,36]) {
    const data=raw.runs.flatMap(run=>raw.ids.map(id=>({id,strategy:run.assignment[id],score:run.hist[month-1].score.by[id].score})));
    const wins=Object.fromEntries(raw.strategies.map(s=>[s,0])),nothingRanks={},winners={};
    for(const id of raw.ids) {
      const city=data.filter(r=>r.id===id); assert.equal(city.length,9);
      const best=Math.max(...city.map(r=>r.score)); winners[id]=city.filter(r=>r.score===best).map(r=>r.strategy);
      winners[id].forEach(s=>wins[s]++);
      const nothing=city.find(r=>r.strategy==='nothing').score;
      nothingRanks[id]=1+city.filter(r=>r.score>nothing).length;
    }
    const means=Object.fromEntries(raw.strategies.map(s=>[s,sum(data.filter(r=>r.strategy===s).map(r=>r.score))/6]));
    horizons[month]={wins,winners,nothingRanks,means,B16:Object.values(wins).every(n=>n<6),renewOverDiesel:means.renew>means.diesel,nothingLast:Object.values(nothingRanks).every(n=>n===9)};
  }
  // bots36.py main()의 후처리 계약도 포함한다. 원 JS 단언은 그대로 유지한다.
  const postChecks=[[raw.ids.every(id=>rows.filter(r=>r.id===id).length===raw.strategies.length),'D61 모든 도시 전략 비교']];
  for(const [strategy,wins] of Object.entries(horizons[36].wins))postChecks.push([wins<raw.ids.length,`D61 ${strategy} 도시별 1위 ${wins}/6: 독식 없음`]);
  for(const [month,h] of Object.entries(horizons)) {
    for(const [id,rank] of Object.entries(h.nothingRanks))postChecks.push([rank===9,`G10 ${month}달 ${id} nothing 점수 ${rank}/9위: 꼴찌`]);
    for(const [strategy,wins] of Object.entries(h.wins))postChecks.push([wins<6,`B16 ${month}달 ${strategy} 도시1위 ${wins}/6: 독식 없음`]);
  }
  for(const row of rows.filter(r=>r.strategy==='base'))postChecks.push([row.over===0,`G10 정책0 base ${row.id} 지방채 초과 ${row.over}달`]);
  postChecks.push([horizons[36].renewOverDiesel,'G10 36달 재생 평균 > 디젤 평균']);
  const allChecks=[...raw.checks,...postChecks];
  return {seed,rows:rows.map(({id,strategy,score,parts,over,minHead,unsPct})=>({id,strategy,score,parts,over,minHead,unsPct})),horizons,passes:allChecks.filter(c=>c[0]).length,failures:allChecks.filter(c=>!c[0]).map(c=>c[1]),rawHash:sha(JSON.stringify(raw))};
}
// CommonJS와 내부 VM 모두 같은 params 사본을 읽게 한다. 테스트 코드는 원문 그대로.
function checks(candidate, tests = ['test-econ','balance','recal']) {
  const out={};
  for(const test of tests) {
    console.error('checks',candidate,test);
    const logs=[],cache=new Map(),proxy=fileProxy(candidate),proc={env:{TECH_BALANCE_OUT:path.join(os.tmpdir(),`D84-T5-${candidate}.json`)},exitCode:0,version:process.version,argv:[],exit(code){this.exitCode=code;throw {testExit:true};}};
    const ctx=vm.createContext({console:{log:(...a)=>logs.push(a.join(' ')),error:(...a)=>logs.push(a.join(' '))},process:proc,Buffer});ctx.global=ctx;
    function load(file) {
      file=path.resolve(file);if(!path.extname(file))file+='.js';if(cache.has(file))return cache.get(file).exports;
      const mod={exports:{}};cache.set(file,mod);
      const req=n=> n==='fs'||n==='node:fs'?proxy:n.startsWith('.')||path.isAbsolute(n)?load(path.resolve(path.dirname(file),n)):require(n);
      vm.runInContext(`(function(require,module,exports,__dirname,__filename){${source(file,candidate)}\n})`,ctx,{filename:file})(req,mod,mod.exports,path.dirname(file),file);
      return mod.exports;
    }
    try {load(path.join(ROOT,'tests/league',test+'.js'));} catch(e) {if(!e.testExit)throw e;}
    out[test]={exitCode:proc.exitCode,logs};
  }
  return out;
}
async function guarded(args,file) {
  const loads=[];const sample=()=>{const n=os.loadavg()[0];loads.push(n);return n;};
  while(sample()>80){console.error('WAIT load >80');await new Promise(r=>setTimeout(r,15000));}
  const start=Date.now();
  await new Promise((resolve,reject)=>{
    const fd=fs.openSync(file,'w'),child=spawn(process.execPath,[__filename,'--job',...args],{stdio:['ignore',fd,'inherit']});fs.closeSync(fd);
    let paused=false;const timer=setInterval(()=>{const l=sample();if(l>80&&!paused){child.kill('SIGSTOP');paused=true;console.error('PAUSE',l);}if(l<=80&&paused){child.kill('SIGCONT');paused=false;}},10000);
    const stop=()=>{child.kill('SIGCONT');child.kill('SIGTERM');};process.once('SIGINT',stop);process.once('SIGTERM',stop);
    child.on('error',e=>{clearInterval(timer);reject(e);});
    child.on('exit',code=>{clearInterval(timer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);code===0?resolve():reject(Error(`job ${args} exit ${code}`));});
  });
  return {args,file,seconds:(Date.now()-start)/1000,maxLoad:Math.max(...loads)};
}
async function main() {
  if(process.argv[2]==='--job') {
    const [, , ,kind,candidate='baseline',seed='epsilon']=process.argv;assert.ok(Object.hasOwn(CANDIDATES,candidate));
    // --job is for one guarded child, or manual execution after checking load.
    while(os.loadavg()[0]>80){console.error('WAIT load >80');await new Promise(r=>setTimeout(r,15000));}
    const start=Date.now(),before=hashes();
    const data=kind==='host'?host(candidate,seed):kind==='plain'?host(candidate,seed,false):kind==='bots'?bots(candidate,seed):kind==='checks'?checks(candidate):kind==='t5'?checks(candidate,['review/11-tech-balance']):null;
    assert.ok(data,'unknown job');assert.deepEqual(hashes(),before);
    console.log(JSON.stringify({kind,candidate,seed,seconds:(Date.now()-start)/1000,node:process.version,head:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),sourceHashes:before,data}));return;
  }
  const d84=process.argv[2]==='--d84';
  assert.ok(d84 || process.argv[2]==='--all','use --all, --d84 or --job');
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'D-debt-')),start=Date.now(),jobs=[];
  console.error('scratch',scratch);
  const run=async(...args)=>{const file=path.join(scratch,args.join('-')+'.json');const meta=await guarded(args,file);jobs.push(meta);console.error('done',args.join(' '),meta.seconds+'s');fs.writeFileSync(path.join(scratch,'manifest.json'),JSON.stringify({scratch,seconds:(Date.now()-start)/1000,candidates:CANDIDATES,jobs},null,2));return JSON.parse(fs.readFileSync(file,'utf8'));};
  const passed=[];
  const candidates=Object.keys(CANDIDATES).filter(c=>d84 ? c.startsWith('r3_') : !c.startsWith('r3_'));
  for(const candidate of candidates) {
    let over=0;
    for(const seed of SEEDS){const r=await run('host',candidate,seed);over+=sum(Object.values(r.data.result.over));}
    if(!over)passed.push(candidate);
  }
  const baseline=d84?'r3_l0_g0':'baseline';
  const plain=await run('plain',baseline,'epsilon');
  const observed=JSON.parse(fs.readFileSync(path.join(scratch,`host-${baseline}-epsilon.json`),'utf8'));
  assert.deepEqual(plain.data.result,observed.data.result,'observer preserves original host result');
  for(const candidate of candidates)await run('checks',candidate);
  // D-84는 탈락 후보도 같은 격자로 측정해 운영 수지·정전·순위의 부작용을 함께 남긴다.
  for(const candidate of d84 ? candidates : [baseline,...passed.filter(c=>c!==baseline)]) {
    for(const seed of SEEDS)await run('bots',candidate,seed);
    if(d84)await run('t5',candidate);
  }
  console.log(JSON.stringify({scratch,seconds:(Date.now()-start)/1000,passed,jobs}));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={CANDIDATES,SEEDS,guarded,host,bots,checks};
