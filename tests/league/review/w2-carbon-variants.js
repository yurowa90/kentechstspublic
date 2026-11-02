"use strict";
// Standalone measurement only: never imported by numbered review checks.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict"), crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "../../..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const ENGINE = read("ui/econ.js");
const LINE = /^  const carbonScore = .*;$/gm;
const VARIANTS = ["A0", "A70", "A80", "A90", "B70", "B80", "B90", "U", "UB80"];
const MODULES = ["build-maps", "tech-data", "build", "econ-data", "econ", "league-data", "league-core", "league-ai"];
const isOutcomeFailure = message => /T5 연구몰빵|6도시 모두 1위 금지|B18 storage 접속용 ESS 실제 관측|B18 storage 실제 ESS 추가|운영 평균 정전|평균 정전/.test(message);
let assertions = 0;
function ok(test, label) { assert.ok(test, label); assertions++; }
function near(a, b, label) { ok(Number.isFinite(a) && Math.abs(a - b) < 1e-9, `${label}: ${a} / ${b}`); }
function variantLine(variant) {
  ok(VARIANTS.includes(variant), `known variant ${variant}`);
  if (variant === "A0" || variant === "U") return ENGINE.match(LINE)[0];
  if (variant === "UB80") variant="B80";
  const x = Number(variant.slice(1));
  // The existing fin/c100/pv helpers remain in the original engine closure.
  return `  const carbonScore = (C, data) => { const W=pv(data,"scoreCo2Worst"), T=pv(data,"scoreCo2Best"), I=fin(C.co2Intensity,fin(C.co2Intensity0,pv(data,"co2IntDef"))), X=${x}; const absolute=c100(I>=W?0:I<=0?100:I>=T?X*(W-I)/(W-T):X+(100-X)*(T-I)/T); ${variant[0] === "A" ? "return absolute;" : 'const I0=fin(C.co2Intensity0,0); if(I0<=0)return absolute; const r=1-I/I0; const relative=c100(r<=0?0:r>=1?100:r<=.4?X*r/.4:X+(100-X)*(r-.4)/.6); return Math.max(absolute,relative);'} };`;
}
function formula(variant) {
  const helpers = ENGINE.slice(ENGINE.indexOf("  const fin ="), ENGINE.indexOf("  const r1 ="));
  return vm.runInNewContext(`${helpers}\nconst pv=(data,k)=>data.params[k].v;\n${variantLine(variant)}\ncarbonScore`);
}
function selfTest() {
  const ctx = vm.createContext({window:{KCP:{}}});
  vm.runInContext(read("ui/econ-data.js"), ctx);
  const data = ctx.window.KCP.ECON_DATA, W = data.params.scoreCo2Worst.v, T = data.params.scoreCo2Best.v;
  for (const v of VARIANTS.slice(1,7)) {
    const f = formula(v), x = Number(v.slice(1));
    near(f({co2Intensity:T,co2Intensity0:T},data),x,`${v} target anchor`);
    near(f({co2Intensity:W,co2Intensity0:W},data),0,`${v} worst anchor`);
    near(f({co2Intensity:0,co2Intensity0:W},data),100,`${v} zero anchor`);
    near(f({co2Intensity:-1,co2Intensity0:W},data),100,`${v} negative intensity`);
    near(f({co2Intensity:W*2,co2Intensity0:W},data),0,`${v} above worst`);
    near(f({co2Intensity:T/2,co2Intensity0:T/2},data),(x+100)/2,`${v} lower segment midpoint`);
    near(f({co2Intensity:(W+T)/2,co2Intensity0:(W+T)/2},data),x/2,`${v} upper segment midpoint`);
    if(v[0]==="B") {
      near(f({co2Intensity:W*3,co2Intensity0:W*5},data),x,`${v} relative 40%`);
      near(f({co2Intensity:W*4,co2Intensity0:W*5},data),x/2,`${v} relative 20%`);
      near(f({co2Intensity:W*1.5,co2Intensity0:W*5},data),(x+100)/2,`${v} relative 70%`);
    }
    for(const bad of [undefined,null,NaN,Infinity,-Infinity,"0.2"]) {
      near(f({co2Intensity:bad,co2Intensity0:T},data),x,`${v} fin intensity fallback`);
      near(f({co2Intensity:T,co2Intensity0:bad},data),x,`${v} invalid start disables relative`);
      near(f({co2Intensity:bad,co2Intensity0:bad},data),f({co2Intensity:data.params.co2IntDef.v},data),`${v} default fallback`);
    }
    for(const i0 of [0,-1]) near(f({co2Intensity:T,co2Intensity0:i0},data),x,`${v} nonpositive start`);
    const changed = JSON.parse(JSON.stringify(data));
    changed.params.scoreCo2Worst.v=2;changed.params.scoreCo2Best.v=1;
    near(f({co2Intensity:1,co2Intensity0:1},changed),x,`${v} reads params`);
  }
  return data;
}
const clone = x => JSON.parse(JSON.stringify(x));
const mean = xs => xs.reduce((a,b)=>a+b,0)/xs.length;
const sha = x => crypto.createHash("sha256").update(x).digest("hex");
// Includes every numeric IEEE-754 bit (including -0), arrays and object keys.
function bitHash(value) {
  const hash=crypto.createHash("sha256"), b=Buffer.alloc(8);
  function walk(x) {
    if(typeof x==="number") { hash.update("n");b.writeDoubleBE(x);hash.update(b); }
    else if(Array.isArray(x)) {hash.update("[");x.forEach(walk);hash.update("]");}
    else if(x && typeof x==="object") {hash.update("{");Object.keys(x).sort().forEach(k=>{walk(k);walk(x[k]);});hash.update("}");}
    else hash.update(`${typeof x}:${JSON.stringify(x)};`);
  }
  walk(value);return hash.digest("hex");
}
const combo = v => typeof v === "string" ? {a:v,c:"C0",h:"H0"} : v;
const comboKey = v => { const {a,c,h}=combo(v); return `${a}-${c}-${h}`; };
const PATCH_LOG = {};
function once(source, needle, replacement, label) {
  const matches=typeof needle==="string"?source.split(needle).length-1:[...source.matchAll(needle)].length;
  ok(matches===1,`${label}: exactly one source site (${matches})`);
  return source.replace(needle,replacement);
}
// Closure-local cache: no additions to S, publicView, messages or saved results.
const GRID_HELPER = `
  const w2Profiles = new Map();
  function w2Supply(o, s, profile, fraction, price, carbon) {
    let total=0;
    for(let k=0;k<s.H;k++) {
      const amount=Math.min(Math.max(0,s.uns[k]-o.del[k]),profile[k%profile.length]*fraction);
      o.del[k]+=amount; total+=amount;
    }
    o.imp+=total; o.fuelX+=total*price; o.co2In+=total*carbon;
    return total;
  }
`;
function fraction(c, month) { return c==="C1"?.5:c==="C3"?.3:c==="C2"?Math.max(0,(12-month)/11):0; }
function sourceFor(name, variant, original=false) {
  const v=combo(variant), raw=read(`ui/${name}.js`);let source=raw;
  ok(VARIANTS.includes(v.a)&&["C0","C1","C2","C3"].includes(v.c)&&["H0","H1","H2"].includes(v.h),"known measurement axes");
  ok(v.h==="H0"||(v.a==="A0"&&v.c==="C0"),"H comparisons only over A0/C0");
  const sites=[];
  const change=(needle,replacement,label)=>{source=once(source,needle,replacement,label);sites.push(label);};
  if(!original) {
    if(name==="econ") { change(LINE,()=>variantLine(v.a),"econ carbonScore"); }
    if(name==="econ-data" && ["U","UB80"].includes(v.a)) for(const [k,n] of Object.entries({co2IntDef:.4173,normalCo2:.4173,scoreCo2Best:.25038}))
      change(new RegExp(`(${k}: p\\()[0-9.]+`,"g"),`$1${n}`,`econ-data ${k}`);
    if(name==="tech-data" && v.h!=="H0")
      change(/(hvdcLoss: p\()[0-9.]+/g,`$1${v.h==="H1"?.025:.01}`,"tech-data hvdcLoss");
    if(name==="league-core" && v.h==="H2")
      change('cap: T.cap * mul * (scable ? tp("scableCap") : 1)',
        'cap: T.cap * mul * (hvdc ? 1.5 : 1) * (scable ? tp("scableCap") : 1)',"effectiveTie HVDC capacity");
    if(name==="league-core" && v.c!=="C0") {
      change('  function runRound(S, bg) {',GRID_HELPER+'  function runRound(S, bg) {',"private grid helper");
      const anchor='    const { out, flow } = settle(built, sims, price, H, rnd.days);';
      change(anchor,anchor+`
    if(S.econ) act.forEach(({id})=>{
      const first=roundsOf(S)[0], key=R.id+":"+id+":"+first.days+":"+first.season;
      if(!w2Profiles.has(key)) preserveMap(bg,()=>{
        const base=simTeam(bg,R,id,KCP.ECON_DATA.normalStartPlans[id]||{},
          {season:first.season,days:first.days,seed:0},Number.MAX_VALUE,{});
        w2Profiles.set(key,Array.from(base.dem));
      });
      const fraction=${v.c==="C1"?'.5':v.c==="C3"?'.3':'Math.max(0,(12-S.round)/11)'};
      w2Supply(out[id],sims[id],w2Profiles.get(key),fraction,
        KCP.ECON_DATA.params.normalCost.v*${v.c==="C3"?2:1.5},KCP.ECON_DATA.params.normalCo2.v);
    });`,"grid after tie settlement");
    }
  }
  if(comboKey(v)==="A0-C0-H0")ok(source===raw,`${name} baseline byte equality`);
  PATCH_LOG[`${comboKey(v)}/${name}`]={sites,original:sha(raw),patched:sha(source)};
  return source;
}
function context(variant, original=false) {
  const ctx=vm.createContext({console,document:{documentElement:{}},KCP:{route(){},on(){},esc:x=>x}});
  ctx.window=ctx;
  vm.runInContext('Math.random=()=>{throw Error("unseeded random");}',ctx);
  for(const n of MODULES) vm.runInContext(sourceFor(n,variant,original),ctx,{filename:n});
  return ctx;
}
function injectionTests() {
  const data=selfTest();
  const supply=vm.runInNewContext(GRID_HELPER+'w2Supply');
  for(const c of ["C1","C2","C3"]) for(const month of [1,6,12,13,36]) {
    const o={del:new Float64Array([30,0,90]),imp:30,sub:0,fuelX:2,co2In:1,co2X:3,byX:{coal:4},saveBy:{},saveCo2:0};
    const keys=Object.keys(o),P=data.params,price=P.normalCost.v*(c==="C3"?2:1.5);
    const expected=[Math.min(50,100*fraction(c,month)),0,Math.min(10,100*fraction(c,month))].reduce((a,b)=>a+b,0);
    const q=supply(o,{H:3,uns:[80,0,100]},[100,100,100],fraction(c,month),price,P.normalCo2.v);
    near(q,expected,`${c}/${month} residual-only import`);near(o.imp,30+expected,"import balance");
    near(o.fuelX,2+expected*price,"operation cost");near(o.co2In,1+expected*P.normalCo2.v,"consumption carbon");
    near(o.co2X,3,"local carbon unchanged");near(o.byX.coal,4,"PM generation unchanged");
    ok(JSON.stringify(keys)===JSON.stringify(Object.keys(o)),"no public row keys");
  }
  for(const a of VARIANTS) for(const c of ["C0","C1","C2","C3"]) {
    // Compile every injection combination, without starting strategy trajectories.
    const v={a,c,h:"H0"};for(const name of MODULES)new vm.Script(sourceFor(name,v));
  }
  for(const h of ["H0","H1","H2"]) {
    const ctx=context({a:"A0",c:"C0",h}),C=ctx.KCP.leagueCore;
    const ids=C.regionOf("south").teams.map(t=>t.id);
    const S={teams:Object.fromEntries(ids.map(id=>[id,{tech:{adopted:[]}}]))};
    const T={a:ids[0],b:ids[1],cap:2,kind:"hvdc"};
    near(C.effectiveTie(S,T).loss,h==="H0"?.012:h==="H1"?.025:.01,`${h} HVDC loss`);
    near(C.effectiveTie(S,T).cap,h==="H2"?3:2,`${h} HVDC cap`);
    near(C.effectiveTie(S,{...T,kind:"ac"}).cap,2,`${h} AC cap unchanged`);
    near(C.effectiveTie(S,{...T,kind:"ac"}).loss,.01,`${h} AC loss unchanged`);
    near(ctx.KCP.TECH_DATA.params.hvdcCost.v,1.3,`${h} cost preserved`);
    S.teams[ids[0]].research={adopted:["hvdc","scable"]};
    const P=ctx.KCP.TECH_DATA.params;
    near(C.effectiveTie(S,T,.8).cap,(h==="H2"?3:2)*.8*P.scableCap.v,`${h} event and scable cap preserved`);
    near(C.effectiveTie(S,T).loss,(h==="H0"?.012:h==="H1"?.025:.01)*P.scableLoss.v,`${h} scable loss preserved`);
    near(C.effectiveTie(S,{...T,kind:"ac"}).loss,.01*P.scableLoss.v,`${h} adopted HVDC never changes AC loss`);
  }
  for(const a of ["U","UB80"]) {
    const ctx=context(a),D=ctx.KCP.ECON_DATA;
    for(const k of ["co2IntDef","normalCo2"])near(D.params[k].v,.4173,`${a}/${k}`);
    near(D.params.scoreCo2Best.v,.25038,`${a}/target`);
    near(formula(a)({co2Intensity:.25038,co2Intensity0:.25038},D),a==="U"?100:80,`${a}/score anchor`);
  }
  const scenarios={};
  for(const c of ["C0","C1","C2","C3"]) {
    const ctx=context({a:"A0",c,h:"H0"}),{leagueCore:C,buildGame:B,econ:X}=ctx.KCP;
    const ids=C.regionOf("south").teams.map(t=>t.id),S=C.newState("w2-grid-probe","south",0,ids,{turns:36});
    C.host(S,"next",100);S.events=[];
    let inputs;const step=X.monthStep;
    X.monthStep=(E,I,...args)=>{inputs=clone(I);return step(E,I,...args);};
    const result=C.run(S,B,150);scenarios[c]={result,inputs,S};
    if(c==="C0")continue;
    const base=scenarios.C0,rd=C.roundsOf(S)[0],wk=rd.mdays/rd.days;
    for(const id of ids) {
      const r=result.team[id],b=base.result.team[id],I=inputs[id].energy,J=base.inputs[id].energy;
      const q=r.imp-b.imp,price=data.params.normalCost.v*(c==="C3"?2:1.5);
      ok(q>=0,`${c}/${id} import nonnegative`);
      if(b.unsPct===100)ok(Math.abs(q-b.dem*fraction(c,1))<=.021,`${c}/${id} actual first-month ceiling`);
      ok(Math.abs((b.uns-r.uns)-q)<=.021,`${c}/${id} import removes blackout (r2 tolerance)`);
      ok(Math.abs(r.cost.fuel-b.cost.fuel-q*price)<=.021,`${c}/${id} grid cost operation only`);
      near(r.pay,b.pay,`${c}/${id} tie purchase unchanged`);
      ok(Math.abs(r.co2Cons-b.co2Cons-q*data.params.normalCo2.v)<=1.01,`${c}/${id} consumed carbon (integer report tolerance)`);
      near(I.co2Local,J.co2Local,`${c}/${id} local CO2 unchanged`);
      ok(JSON.stringify(I.genMWh)===JSON.stringify(J.genMWh),`${c}/${id} PM fuel input unchanged`);
      near(I.opex,Math.round((r.cost.fuel+r.cost.policy)*wk*100)/100,`${c}/${id} monthly operating expense`);
      ok(JSON.stringify(Object.keys(r))===JSON.stringify(Object.keys(b)),`${c}/${id} public result keys unchanged`);
      ok(JSON.stringify(Object.keys(I))===JSON.stringify(Object.keys(J)),`${c}/${id} monthly energy keys unchanged`);
    }
    ok(JSON.stringify(Object.keys(S))===JSON.stringify(Object.keys(base.S)),`${c} state keys unchanged`);
  }
  {
    const ctx=context("A0",true),{leagueCore:C,buildGame:B}=ctx.KCP;
    const ids=C.regionOf("south").teams.map(t=>t.id),S=C.newState("w2-grid-probe","south",0,ids,{turns:36});
    C.host(S,"next",100);S.events=[];const result=C.run(S,B,150);
    ok(bitHash(result)===bitHash(scenarios.C0.result),"A0/C0/H0 first-month result original numeric bits");
    ok(bitHash(S)===bitHash(scenarios.C0.S),"A0/C0/H0 first-month full state original numeric bits");
  }
  return data;
}
function pythonString(file, key) {
  const matches=[...read(file).matchAll(new RegExp(`^${key} = r?"""\\n([\\s\\S]*?)^"""`,"gm"))];
  ok(matches.length===1,`${file} ${key} literal extraction`);
  return matches[0][1];
}
function summarize(rows, strategies, ids) {
  const winners={},firstCounts=Object.fromEntries(strategies.map(s=>[s,0]));
  for(const id of ids) {
    const city=rows.filter(r=>r.id===id);
    ok(city.length===strategies.length && new Set(city.map(r=>r.strategy)).size===strategies.length,`${id} complete strategy matrix`);
    const best=Math.max(...city.map(r=>r.score));
    winners[id]=city.filter(r=>Math.abs(r.score-best)<=1e-9).map(r=>r.strategy);
    winners[id].forEach(s=>firstCounts[s]++);
    city.forEach(r=>{r.strategyRank=1+city.filter(o=>o.score>r.score+1e-9).length;});
  }
  rows.forEach(r=>{r.strategyCityRank=1+rows.filter(o=>o.strategy===r.strategy && o.score>r.score+1e-9).length;});
  const means=Object.fromEntries(strategies.map(s=>[s,mean(rows.filter(r=>r.strategy===s).map(r=>r.score))]));
  return {rows,winners,firstCounts,means,B16:Object.values(firstCounts).every(n=>n<ids.length),
    renewAboveDiesel:means.diesel===undefined?null:means.renew>means.diesel,
    nothingLast:strategies.includes("nothing")?rows.filter(r=>r.strategy==="nothing").every(r=>r.strategyRank===strategies.length):null};
}
function general(variant, seed, months, original=false, fullChecks=false) {
  const ctx=context(variant,original);
  vm.runInContext(pythonString("tests/league/calib.py","AUTO"),ctx);
  let js=pythonString("tests/league/bots36.py","JS");
  const needle='newGame("bots-strategy-common")';
  ok(js.split(needle).length===2,"one general seed site");
  js=js.replace(needle,`newGame(${JSON.stringify(seed)})`);
  const independent=["B9 달 사건 표본","B9 계절 분포 참고","B7 예산과 한도 아래 건설 금지","B10 지원금·철거 현금 연결","B18 renew 접속·유지 경계"];
  for(const label of independent)ok(js.split(`test(${JSON.stringify(label)},`).length===2,`one independent fixture ${label}`);
  js=once(js,'try { fn(); } catch (e)',
    `try { ${fullChecks?"":`if(${JSON.stringify(independent)}.includes(label))return;`} console.log("GENERAL",label); fn(); } catch (e)`,"general fixture/progress wrapper only");
  const raw=vm.runInContext(js,ctx)({months,rotations:9});
  ok(raw.runs.length===9 && raw.runs.every(r=>r.hist.length===months && r.rows.length===6),"complete general trajectories");
  const horizons={};
  for(const month of [12,36].filter(m=>m<=months)) {
    const rows=raw.runs.flatMap(run=>raw.ids.map(id=>{
      const h=run.hist[month-1], city=h.cities[id], score=h.score.by[id];
      return {id,strategy:run.assignment[id],score:score.score,co2:score.parts.co2,parts:score.parts,
        leagueRank:score.rank,approval:city.approval,
        approvalTimeMean:mean(run.hist.slice(0,month).map(h=>h.cities[id].approval)),
        co2Intensity:city.co2Intensity,co2Intensity0:city.co2Intensity0};
    }));
    horizons[month]=summarize(rows,raw.strategies,raw.ids);
  }
  const samples=raw.runs.flatMap(run=>run.hist.flatMap(h=>raw.ids.map(id=>({
    rotation:run.rotation,id,strategy:run.assignment[id],month:h.month,
    unsPct:h.energy[id].unsPct,uns:h.energy[id].uns,dem:h.energy[id].dem,
    approval:h.cities[id].approval,co2Intensity:h.cities[id].co2Intensity,
    cash:h.cities[id].cash,debtCap:h.cities[id].debtCap,debtOver:h.fiscal[id].debtOver,
    importMWh:h.energy[id].imp,operation:h.energy[id].cost.opex,co2Cons:h.energy[id].co2Cons
  }))));
  const C=ctx.KCP.leagueCore,S=C.newState(seed,"south",0,raw.ids,{turns:36});
  const starting=Object.fromEntries(raw.ids.map(id=>[id,{co2:ctx.KCP.econ.score(S.econ).by[id].parts.co2,
    intensity:S.econ.cities[id].co2Intensity0}]));
  return {seed,months,ids:raw.ids,strategies:raw.strategies,horizons,samples,starting,
    hvdcFinalTies:raw.runs.map(run=>({rotation:run.rotation,ties:run.rows[0].ties.filter(t=>t.kind==="hvdc")})),
    sourceChecks:{pass:raw.checks.filter(c=>c[0]).length,fail:raw.checks.filter(c=>!c[0]).map(c=>c[1]),skippedIndependent:fullChecks?[]:independent},
    rawBitHash:bitHash(raw)};
}
function technology(variant,original=false) {
  // Run the complete existing T5 program unchanged; intercept only econ.js evaluation
  // and the report sink. Budget fitting, policies, research and all assertions stay intact.
  let substitutions=0;
  const shimVM={...vm,runInContext(source,...args) {
    for(const name of MODULES) if(source===read(`ui/${name}.js`)) { if(name==="econ")substitutions++;source=sourceFor(name,variant,original);break; }
    return vm.runInContext(source,...args);
  }};
  const shimFS={...fs,writeFileSync(file,data) {ok(file==="/w2-in-memory-tech.json","T5 report-only write");/* The original program serializes its report; retain the live object below. */}};
  const quiet={log(...args) {if(args[0]==="FAIL:" || String(args[0]).startsWith('{"city":')) console.log(...args);}};
  const allowed={"node:fs":shimFS,"node:path":path,"node:vm":shimVM,"node:crypto":crypto};
  const box={console:quiet,__dirname,process:{env:{TECH_BALANCE_OUT:"/w2-in-memory-tech.json"},exitCode:0},
    require(name) {ok(Object.hasOwn(allowed,name),`T5 dependency ${name}`);return allowed[name];}};
  vm.runInNewContext(read("tests/league/review/11-tech-balance.js")+"\nglobalThis.__w2Report=report;",box,{filename:"11-tech-balance.js"});
  ok(substitutions===1,"T5 evaluated exactly one econ source");
  const raw=box.__w2Report;
  ok(box.process.exitCode===(raw.failures.length?1:0),"T5 exit status matches recorded failures");
  ok(raw.runs.length===42 && raw.runs.every(r=>r.months.length===36),"complete T5 42 trajectories");
  const ids=[...new Set(raw.runs.map(r=>r.id))],strategies=Object.keys(raw.strategies);
  const rows=raw.runs.map(r=>({id:r.id,strategy:r.strategy,score:r.score,co2:r.parts.co2,parts:r.parts,
    co2Intensity:r.state.cities[r.id].co2Intensity,co2Intensity0:r.state.cities[r.id].co2Intensity0,
    approval:r.state.cities[r.id].approval,account:r.account,budget:r.budget||null,avgUns:r.avgUns,
    monthlyBudget:r.months.map(m=>({month:m.month,spent:m.cumulativeMatchedSpend,budget:m.budget})),
    monthly:r.months}));
  return {...summarize(rows,strategies,ids),seed:raw.seed,months:36,ids,strategies,names:raw.strategies,
    smrFirstCities:raw.smrFirstCities,researchGain:raw.researchGain,
    saturation:Object.fromEntries(ids.map(id=>[id,{hundred:rows.filter(r=>r.id===id&&r.co2===100).length,zero:rows.filter(r=>r.id===id&&r.co2===0).length}])),
    sourceChecks:{pass:raw.passes,fail:raw.failures},rawBitHash:bitHash(raw)};
}
function controlled(variant,original=false) {
  const ctx=context(variant,original),{leagueCore:C,econ:X,ECON_DATA:D}=ctx.KCP;
  const R=C.regionOf("south"), ids=R.teams.map(t=>t.id),id="dangjin",calibrate=X.calibrate;
  let inputs;
  X.calibrate=(E,raw,...rest)=>{inputs=clone(raw);return calibrate(E,raw,...rest);};
  const S=C.newState("g9-carbon",R.id,0,ids,{turns:36});X.calibrate=calibrate;
  const rows=[];
  for(const reduction of [0,.01,.05,.1,.3]) {
    let E=clone(S.econ);const raw=clone(inputs);
    raw[id].energy.co2*=1-reduction;raw[id].energy.co2Local*=1-reduction;
    const trace=[];
    for(let m=0;m<12;m++) {const step=X.monthStep(E,raw);E=step.E;trace.push(step);}
    const result=X.score(E).by[id];
    rows.push({reduction,score:result.score,co2:result.parts.co2,parts:result.parts,
      intensity:E.cities[id].co2Intensity,realizedReduction:1-E.cities[id].co2Intensity/E.cities[id].co2Intensity0,
      traceBitHash:bitHash(trace)});
  }
  return {id,name:D.start[id].name,seed:"g9-carbon",months:12,scoreHorizon:S.econ.len,
    intensity0:S.econ.cities[id].co2Intensity0,
    startingByCity:Object.fromEntries(ids.map(cid=>[cid,{intensity:S.econ.cities[cid].co2Intensity0,co2:X.score(S.econ).by[cid].parts.co2}])),inputs,rows};
}
function hvdcControlled() {
  const contexts=Object.fromEntries(["H0","H1","H2"].map(h=>[h,context({a:"A0",c:"C0",h})]));
  const {leagueCore:C,buildGame:B,ECON_DATA:D}=contexts.H0.KCP;
  const R=C.regionOf("south"),ids=R.teams.map(t=>t.id),seed="w2w7-hvdc-controlled";
  const input=controlled("A0").inputs;
  const generation=id=>Object.values(input[id].energy.genMWh).reduce((a,b)=>a+b,0);
  const spare=Object.fromEntries(ids.map(id=>[id,C.simTeam(B,R,id,D.normalStartPlans[id],{season:"winter",days:7,seed:0},Number.MAX_VALUE,{}).spareMW]));
  const donor=ids.slice().sort((a,b)=>spare[b]-spare[a])[0];
  ok(spare[donor]>4,"HVDC donor has dispatchable export headroom");
  const route=R.ties.find(t=>t.kind==="land"&&[t.a,t.b].includes(donor)&&generation(t.a===donor?t.b:t.a)===0);
  ok(!!route,"HVDC adjacent generating/non-generating land pair exists");
  const endpoints=[route.a,route.b];
  let common=C.newState(seed,R.id,0,ids,{turns:12});
  const req=(id,m)=>C.reduce(common,{team:id,token:`w2-hvdc-${id}`,...m},100,B);
  C.host(common,"next",100);common.events=[];
  for(const id of ids) {
    ok(req(id,{type:"claim"}).ok,`HVDC claim ${id}`);
    const plan=clone(D.normalStartPlans[id]);
    if(endpoints.includes(id)) {
      B.selectPack(C.teamDef(R,id).pack,"league");
      const other=endpoints.find(x=>x!==id),gate=B.SITES.find(s=>s.to?.includes(other));
      ok(!!gate,`HVDC gate ${id}`);
      const anchors=[...new Set(plan.lines.flatMap(l=>l.p))];
      if(!anchors.includes(gate.tile)) {
        anchors.sort((a,b)=>Math.hypot(B.TILES[a].X-B.TILES[gate.tile].X,B.TILES[a].Y-B.TILES[gate.tile].Y)-Math.hypot(B.TILES[b].X-B.TILES[gate.tile].X,B.TILES[b].Y-B.TILES[gate.tile].Y));
        const p=B.routePath(anchors[0],gate.tile);ok(!!p,`HVDC local route ${id}`);
        for(let i=0;i<p.length-1;i+=79)plan.lines.push({p:p.slice(i,i+80)});
      }
      // Pre-adoption is a controlled fixture, not a claim about research timing.
      common.teams[id].research.adopted=["hvdc"];
    }
    const response=req(id,{type:"plan",rev:1,plan});
    ok(response.ok,`HVDC legal fixed plan ${id}: ${JSON.stringify(response)}`);
  }
  ok(req(donor,{type:"tie",op:"propose",other:endpoints.find(id=>id!==donor),cap:4,kind:"hvdc"}).ok,"HVDC 4MW proposal");
  ok(req(endpoints.find(id=>id!==donor),{type:"tie",op:"accept",other:donor}).ok,"HVDC legal construction budget");
  ok(common.ties.length===1&&common.ties[0].st==="built"&&common.ties[0].kind==="hvdc","exactly one forced HVDC line");
  const tie=clone(common.ties[0]),planBits=bitHash(Object.fromEntries(ids.map(id=>[id,common.teams[id].plan])));
  const runs=Object.fromEntries(["H0","H1","H2"].map(h=>[h,{months:[],effective:contexts[h].KCP.leagueCore.effectiveTie(common,tie)}]));
  for(let month=1;month<=12;month++) {
    if(month>1)C.host(common,"next",month*1000);
    common.events=[]; // Same seasonal weather; discrete event shocks excluded.
    const stateBits=bitHash(common),rd=C.roundsOf(common)[month-1],wk=rd.mdays/rd.days;
    let next;
    for(const h of ["H0","H1","H2"]) {
      const ctx=contexts[h],S=structuredClone(common);
      ok(bitHash(S)===stateBits,`${h}/${month} identical monthly input state bits`);
      ok(bitHash(Object.fromEntries(ids.map(id=>[id,S.teams[id].plan])))===planBits,`${h}/${month} fixed plan bits`);
      const result=ctx.KCP.leagueCore.run(S,ctx.KCP.buildGame,month*1000+50);
      const sent=endpoints.reduce((sum,id)=>sum+result.team[id].exp,0),received=endpoints.reduce((sum,id)=>sum+result.team[id].imp,0);
      ok(sent>0&&received>0,`${h}/${month} actual line transfer`);
      ok(Math.abs(sent-received-sent*runs[h].effective.loss)<.031,`${h}/${month} rounded transmission balance`);
      ok(sent<=runs[h].effective.cap*24*rd.days+.01,`${h}/${month} transmission capacity ceiling`);
      const row={month,days:rd.mdays,representativeDays:rd.days,inputStateBitHash:stateBits,planBitHash:planBits,
        sentMWh:sent*wk,receivedMWh:received*wk,lossMWh:(sent-received)*wk,
        flow:clone(result.flow),cities:Object.fromEntries(endpoints.map(id=>[id,{
          unsPct:result.team[id].unsPct,operation:(result.team[id].cost.fuel+result.team[id].cost.policy+result.team[id].cost.trade)*wk+result.team[id].cost.resp+result.team[id].cost.research,
          consumptionCo2:result.team[id].co2Cons*wk,raw:clone(result.team[id])}]))};
      runs[h].months.push(row);
      if(h==="H0")next=S;
    }
    common=next;
  }
  for(const [h,run] of Object.entries(runs)) {
    run.total=Object.fromEntries(["sentMWh","receivedMWh","lossMWh"].map(k=>[k,run.months.reduce((n,r)=>n+r[k],0)]));
    run.cities=Object.fromEntries(endpoints.map(id=>[id,{
      meanUnsPct:mean(run.months.map(r=>r.cities[id].unsPct)),
      operation:run.months.reduce((n,r)=>n+r.cities[id].operation,0),
      consumptionCo2:run.months.reduce((n,r)=>n+r.cities[id].consumptionCo2,0)}]));
  }
  return {seed,months:12,endpoints,donor,tie,planBitHash:planBits,plans:Object.fromEntries(ids.map(id=>[id,common.teams[id].plan])),
    constructionCost:C.tieCost(R,tie),runs,
    design:"각 달 H0 월초 상태를 세 시안에 복제하는 짝지은 운영 실험. 정상 시작 전선+연결점 전선, 추가 발전 없음, HVDC 사전 도입, 합법 제안·수락 4MW 한 선. H0 결과만 다음 달 입력으로 진행; H1/H2 경제 피드백은 누적하지 않음. 사건 없음, 계절·날씨 씨앗 동일. 월량은 대표 7일×달력일/7. 전력 운영비=(fuel+policy+trade)×달력배수+resp+research, trade는 구매−판매의 순비용. 지방행정 운영비·건설비 제외."};
}
function worker(job) {
  ok(process.env.W2_SERIAL_WORKER==="1","worker only via serial scheduler");
  const began=Date.now();
  const result=job.kind==="hvdc"?hvdcControlled():job.kind==="general"?general(job.variant,job.seed,job.months,job.original,job.fullChecks):technology(job.variant,job.original);
  fs.writeFileSync(job.out,JSON.stringify({result,seconds:(Date.now()-began)/1000,assertions,patches:PATCH_LOG}));
}
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
const loadLog=[];
function loadSample(label) {
  const raw=execFileSync("uptime",[],{encoding:"utf8"}).trim();
  const m=raw.match(/load averages?:\s*([0-9.]+)/);
  ok(!!m,`uptime parsed: ${raw}`);
  const sample={at:new Date().toISOString(),label,oneMinute:Number(m[1]),raw};loadLog.push(sample);return sample.oneMinute;
}
async function loadGate(label) {
  while(loadSample(label)>=150) {console.log(`WAIT load>=150 ${label}`);await delay(15000);}
}
async function runJob(job) {
  await loadGate(`before ${job.key}`);
  console.log(`START ${job.key}`);
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[__filename,"--worker",JSON.stringify(job)],{
      stdio:["ignore","inherit","inherit"],env:{...process.env,W2_SERIAL_WORKER:"1"}});
    let paused=false;
    const timer=setInterval(()=>{
      try {
        const n=loadSample(`during ${job.key}`);
        if(n>=150&&!paused){child.kill("SIGSTOP");paused=true;console.log(`PAUSE ${job.key} load ${n}`);}
        else if(n<150&&paused){child.kill("SIGCONT");paused=false;console.log(`RESUME ${job.key} load ${n}`);}
      } catch(error) {child.kill("SIGCONT");child.kill("SIGTERM");clearInterval(timer);reject(error);}
    },10000);
    const stop=()=>{child.kill("SIGCONT");child.kill("SIGTERM");};
    process.once("SIGINT",stop);process.once("SIGTERM",stop);
    child.on("error",error=>{clearInterval(timer);reject(error);});
    child.on("exit",code=>{
      clearInterval(timer);process.removeListener("SIGINT",stop);process.removeListener("SIGTERM",stop);
      code===0?resolve():reject(Error(`${job.key}: exit ${code}`));
    });
  });
  loadSample(`after ${job.key}`);
  const value=JSON.parse(fs.readFileSync(job.out,"utf8"));
  console.log(`DONE ${job.key} ${value.seconds.toFixed(1)}s`);return value;
}
function enrich(g, baseline) {
  g.sampleUnits={month:"월 번호(1~36)",unsPct:"대표 7일 수요 대비 미공급 %",uns:"대표 7일 게임 MWh",dem:"대표 7일 게임 MWh",importMWh:"대표 7일 게임 MWh",co2Cons:"대표 7일 t; 정수 반올림",operation:"원 cost.opex: 대표 7일 fuel+policy+trade 및 월 resp+research가 섞인 원 엔진 진단값(억); 월 지출 합계로 사용 금지",approval:"월말 지지율",cash:"월말 억",debtCap:"월말 억",co2Intensity:"t/MWh"};
  for(const [month,h] of Object.entries(g.horizons)) {
    const b=baseline.horizons[month],samples=g.samples.filter(s=>s.month<=Number(month));
    h.rows.forEach(row=>{
      const old=b.rows.find(r=>r.id===row.id&&r.strategy===row.strategy);
      row.delta=Object.fromEntries(["score","co2","strategyRank","strategyCityRank"].map(k=>[k,row[k]-old[k]]));
    });
    h.pressure={meanUnsPct:mean(samples.map(s=>s.unsPct)),zeroCityMonthFraction:samples.filter(s=>s.unsPct===0).length/samples.length,
      samples:samples.length,byStrategy:Object.fromEntries(g.strategies.map(s=>{
        const rows=samples.filter(r=>r.strategy===s);return [s,{meanUnsPct:mean(rows.map(r=>r.unsPct)),zeroFraction:rows.filter(r=>r.unsPct===0).length/rows.length}];
      }))};
    h.debt={overCityMonths:samples.filter(s=>s.debtOver).length,
      cities:[...new Set(samples.filter(s=>s.debtOver).map(s=>s.id))],
      byStrategy:Object.fromEntries(g.strategies.map(s=>[s,samples.filter(r=>r.strategy===s&&r.debtOver).length])),
      events:samples.filter(s=>s.debtOver).map(({id,strategy,month,cash,debtCap})=>({id,strategy,month,cash,debtCap}))};
    h.approvalByCity=Object.fromEntries(g.ids.map(id=>{
      const rows=samples.filter(r=>r.id===id),old=baseline.samples.filter(r=>r.id===id&&r.month<=Number(month));
      return [id,{timeMean:mean(rows.map(r=>r.approval)),timeDelta:mean(rows.map(r=>r.approval))-mean(old.map(r=>r.approval))}];
    }));
  }
}
function requestedJobs(tmp,quick) {
  const jobs=[],seen=new Set();
  function add(kind,a,c="C0",h="H0",tier=1,seed="bots-strategy-common",original=false) {
    if(kind==="tech")seed="tech-strategy-common";
    const variant={a,c,h},key=`${original?"original":"measured"}-${kind}-${comboKey(variant)}-${seed}`;
    if(seen.has(key))return;seen.add(key);
    jobs.push({key,kind,variant,seed,original,tier,months:quick?12:36,out:path.join(tmp,`${key}.json`)});
  }
  add("general","A0");jobs[0].fullChecks=true;
  if(!quick) add("tech","A0");
  if(quick)for(const a of ["A80","B80"])add("general",a);
  if(!quick) {
    for(const a of ["A80","B80","UB80"])add("general",a);
    for(const c of ["C1","C2","C3"])add("general","A0",c);
    // 2026-10-17 resumption instruction: H is a forced-line controlled experiment.
    for(const a of VARIANTS)add("general",a);
    // Core technology comparisons fixed before seeing scores.
    for(const a of ["A80","B80","UB80"])add("tech",a);
    for(const c of ["C1","C2","C3"])add("tech","A0",c);
    for(const a of ["A0","A80","B80","UB80"])for(const c of ["C0","C1","C2"])add("general",a,c,"H0",2);
    for(const a of ["B80","UB80"])add("tech",a,"C1","H0",2);
    for(const a of ["A0","B80"])for(const c of ["C0","C1"])for(const seed of ["alpha","beta","gamma","delta","epsilon"])
      add("general",a,c,"H0",3,seed);
  }
  return jobs;
}
async function main() {
  const started=Date.now(),quick=process.argv.includes("--quick"),resumeIndex=process.argv.indexOf("--resume");
  const resumed=resumeIndex>=0?path.resolve(process.argv[resumeIndex+1]||""):null;
  ok(process.argv.slice(2).every((a,i,args)=>a==="--quick"||a==="--resume"||args[i-1]==="--resume"),"known arguments only");
  await loadGate("before self-tests");const data=injectionTests();
  const tmp=resumed||fs.mkdtempSync(path.join(require("node:os").tmpdir(),"w2w7-"));
  const files=[...MODULES.map(n=>`ui/${n}.js`),"tests/league/bots36.py","tests/league/calib.py","tests/league/review/11-tech-balance.js","tests/league/review/w2-carbon-variants.js"];
  const hashes=Object.fromEntries(files.map(f=>[f,sha(read(f))]));
  const uiFiles=execFileSync("git",["ls-files","ui"],{cwd:ROOT,encoding:"utf8"}).trim().split("\n");
  const uiHashes=Object.fromEntries(uiFiles.map(f=>[f,sha(fs.readFileSync(path.join(ROOT,f)))]));
  const head=execFileSync("git",["rev-parse","HEAD"],{cwd:ROOT,encoding:"utf8"}).trim();
  const jobs=requestedJobs(tmp,quick),done={},skipped=[],estimates=[],reductions=[],upgrades=[];
  const requestedPlan=jobs.map(({out,...j})=>clone(j));
  let priorSeconds=0, strategyOnlyProbe=null, resumeSourceAudit=null;
  if(resumed) {
    const prior=JSON.parse(fs.readFileSync(path.join(tmp,"progress.json"),"utf8"));
    ok(prior.head===head,"resume same HEAD");
    const snapshot=fs.readFileSync(path.join(tmp,"execution-source.js"),"utf8"),current=read("tests/league/review/w2-carbon-variants.js");
    const prefix=s=>s.slice(0,s.indexOf("const delay ="));
    ok(sha(snapshot)===prior.hashes["tests/league/review/w2-carbon-variants.js"],"resume saved executed script hash");
    ok(sha(prefix(snapshot))===sha(prefix(current)),"resume computation adapter bytes unchanged");
    resumeSourceAudit={previousScript:sha(snapshot),currentScript:sha(current),computationPrefix:sha(prefix(current)),equal:true};
    for(const file of files.filter(f=>!f.endsWith("w2-carbon-variants.js")))ok(prior.hashes[file]===hashes[file],`resume source ${file}`);
    for(const j of jobs)if(prior.jobMonths?.[j.key])j.months=prior.jobMonths[j.key];
    for(const key of prior.done) {
      const j=jobs.find(j=>j.key===key);ok(!!j,`resume requested job ${key}`);
      if(prior.jobMonths?.[key])j.months=prior.jobMonths[key];
      done[key]=JSON.parse(fs.readFileSync(j.out,"utf8"));priorSeconds+=done[key].seconds;
      ok(done[key].result.months===j.months,`resume horizon ${key}`);
      for(const name of MODULES) {
        const patch=done[key].patches[`${comboKey(j.variant)}/${name}`];
        ok(patch.original===hashes[`ui/${name}.js`],`resume original VM input ${name}`);
        ok(patch.patched===sha(sourceFor(name,j.variant,j.original)),`resume exact injected VM input ${name}`);
      }
    }
    if(prior.strategyOnlyProbe) {
      strategyOnlyProbe=JSON.parse(fs.readFileSync(path.join(tmp,"strategy-only-probe.json"),"utf8"));
      priorSeconds+=strategyOnlyProbe.seconds;
      ok(strategyOnlyProbe.result.sourceChecks.skippedIndependent.length===5,"resume optimized fixture set");
      for(const name of MODULES)ok(strategyOnlyProbe.patches[`A0-C0-H0/${name}`].patched===sha(sourceFor(name,"A0")),`resume probe source ${name}`);
    }
    loadLog.unshift(...(prior.loadLog||[]));
    upgrades.push(...(prior.upgrades||[]));priorSeconds+=upgrades.reduce((n,u)=>n+u.previousSeconds,0);
    reductions.push(...(prior.reductions||[]));skipped.push(...(prior.skipped||[]));estimates.push(...(prior.estimates||[]));
    priorSeconds=Math.max(priorSeconds,prior.elapsedSeconds||0);
  }
  fs.writeFileSync(path.join(tmp,"execution-source.js"),read("tests/league/review/w2-carbon-variants.js"));
  const maxSeconds=90*60;
  fs.writeFileSync(path.join(tmp,"progress.json"),JSON.stringify({head,hashes,done:Object.keys(done),jobMonths:Object.fromEntries(jobs.map(j=>[j.key,j.months])),skipped,reductions,upgrades,estimates,strategyOnlyProbe:!!strategyOnlyProbe,loadLog},null,2));
  const baselineJob=jobs.find(j=>j.kind==="general"&&comboKey(j.variant)==="A0-C0-H0"&&j.seed==="bots-strategy-common");
  async function verifyStrategyOnly() {
    if(strategyOnlyProbe||!done[baselineJob.key])return;
    strategyOnlyProbe=await runJob({...baselineJob,key:"strategy-only-probe",months:12,fullChecks:false,out:path.join(tmp,"strategy-only-probe.json")});
    const prefix=g=>({ids:g.ids,strategies:g.strategies,seed:g.seed,starting:g.starting,horizon:g.horizons[12],samples:g.samples.filter(r=>r.month<=12)});
    const originalBits=bitHash(prefix(done[baselineJob.key].result)),probeBits=bitHash(prefix(strategyOnlyProbe.result));
    ok(originalBits===probeBits,"A0 all 12-month measurement bits: original fixtures vs strategy only");
    strategyOnlyProbe.originalPrefixBitHash=originalBits;strategyOnlyProbe.probePrefixBitHash=probeBits;
    ok(strategyOnlyProbe.result.sourceChecks.fail.every(isOutcomeFailure),"strategy-only probe integrity");
    fs.writeFileSync(path.join(tmp,"strategy-only-probe.json"),JSON.stringify(strategyOnlyProbe));
    console.log(`VERIFIED strategy-only prefix ${originalBits}; ${strategyOnlyProbe.seconds.toFixed(1)}s`);
    fs.writeFileSync(path.join(tmp,"progress.json"),JSON.stringify({head,hashes,done:Object.keys(done),jobMonths:Object.fromEntries(jobs.map(j=>[j.key,j.months])),skipped,reductions,upgrades,estimates,strategyOnlyProbe:true,loadLog},null,2));
  }
  const hvdc=await runJob({key:"controlled-H0-H1-H2",kind:"hvdc",out:path.join(tmp,"hvdc-controlled.json")});
  await verifyStrategyOnly();
  for(let i=0;i<jobs.length;i++) {
    if(done[jobs[i].key]||skipped.some(s=>s.key===jobs[i].key))continue;
    const measured=Object.entries(done).map(([key,d])=>({kind:jobs.find(j=>j.key===key).kind,seconds:d.seconds}));
    if(measured.some(r=>r.kind==="tech")&&measured.some(r=>r.kind==="general")) {
      const generalSeconds=[strategyOnlyProbe.seconds*3,...jobs.filter(j=>j.kind==="general"&&!j.fullChecks&&done[j.key]).map(j=>done[j.key].seconds*36/j.months)];
      const cost=(kind,months=36)=>(kind==="general"?Math.max(...generalSeconds):Math.max(...measured.filter(r=>r.kind===kind).map(r=>r.seconds)))*1.15*(kind==="general"?months/36:1);
      let remaining=jobs.slice(i).filter(j=>!done[j.key]&&!skipped.some(s=>s.key===j.key));
      const elapsed=priorSeconds+(Date.now()-started)/1000;
      // Remove lower-priority tiers first. No change based on ranking/score outcomes.
      for(const tier of [3,2]) {
        if(elapsed+remaining.reduce((n,j)=>n+cost(j.kind,j.months),0)>maxSeconds-120) {
          const removed=remaining.filter(j=>j.tier===tier);
          if(removed.length) {
            const projection=elapsed+remaining.reduce((n,j)=>n+cost(j.kind,j.months),0);
            estimates.push({atJob:i,tier,projectionSeconds:projection,cost:{general:cost("general"),tech:cost("tech")}});
            removed.forEach(j=>skipped.push({...j,reason:`90분 상한: 실측 최대시간×1.15 예측 ${projection.toFixed(1)}초; 우선순위 ${tier} 제외`}));
            remaining=remaining.filter(j=>j.tier!==tier);
            console.log(`SCOPE omit tier ${tier}, ${removed.length} jobs, projection ${projection.toFixed(1)}s`);
          }
        }
      }
      // If single-axis work still exceeds the cap, keep all cities/strategies,
      // shorten non-H general trajectories first, then remove secondary T5 jobs.
      if(elapsed+remaining.reduce((n,j)=>n+cost(j.kind,j.months),0)>maxSeconds-120) {
        for(const j of remaining.filter(j=>j.kind==="general"&&j.variant.h==="H0"&&j.variant.a+"-"+j.variant.c!=="A0-C0"&&j.months===36)) {
          j.months=12;reductions.push({key:j.key,fromMonths:36,toMonths:12,reason:"단독 조합만으로도 90분 초과 예상: 도시·전략은 유지하고 H 이외의 일반 기간을 12달로 축소"});
        }
        console.log("SCOPE shorten remaining non-H general to 12 months");
      }
      for(const target of ["UB80-C0-H0","A0-C3-H0","A80-C0-H0","A0-C2-H0","B80-C0-H0","A0-C1-H0","A0-C0-H2","A0-C0-H1"]) {
        if(elapsed+remaining.reduce((n,j)=>n+cost(j.kind,j.months),0)<=maxSeconds-120)break;
        const j=remaining.find(j=>j.kind==="tech"&&comboKey(j.variant)===target);
        if(j){skipped.push({...j,reason:"씨앗·교차 제외와 일반 12달 축소 후에도 90분 초과 예상: T5 추가 조합 제외"});remaining=remaining.filter(x=>x!==j);console.log(`SCOPE omit ${j.key}`);}
      }
      if(!skipped.some(s=>s.key===jobs[i].key)&&elapsed+cost(jobs[i].kind,jobs[i].months)>maxSeconds-60) {
        skipped.push({...jobs[i],reason:"90분 상한까지 현재 조합을 끝낼 시간이 부족함"});
      }
    }
    if(skipped.some(s=>s.key===jobs[i].key))continue;
    done[jobs[i].key]=await runJob(jobs[i]);
    await verifyStrategyOnly();
    fs.writeFileSync(path.join(tmp,"progress.json"),JSON.stringify({head,hashes,done:Object.keys(done),jobMonths:Object.fromEntries(jobs.map(j=>[j.key,j.months])),skipped,reductions,upgrades,estimates,strategyOnlyProbe:!!strategyOnlyProbe,loadLog},null,2));
  }
  // Reclaim conservative forecast headroom for the highest-priority missing
  // 36-month single-axis metrics. Never select an upgrade by score outcomes.
  for(const target of ["B80-C0-H0","A0-C1-H0","A80-C0-H0","UB80-C0-H0","A0-C2-H0","A0-C3-H0","A70-C0-H0","A90-C0-H0","B70-C0-H0","B90-C0-H0","U-C0-H0"]) {
    if(quick)break;
    const j=jobs.find(j=>j.kind==="general"&&j.seed==="bots-strategy-common"&&comboKey(j.variant)===target);
    if(!j||!done[j.key]||j.months!==12)continue;
    const full=[strategyOnlyProbe.seconds*3,...jobs.filter(x=>x.kind==="general"&&!x.fullChecks&&done[x.key]?.result.months===36).map(x=>done[x.key].seconds)];
    const estimate=Math.max(...full)*1.15;
    if(priorSeconds+(Date.now()-started)/1000+estimate>maxSeconds-120)break;
    const old=done[j.key];fs.copyFileSync(j.out,j.out.replace(/\.json$/,'.12-month.json'));
    j.months=36;console.log(`SCOPE restore ${j.key} to 36 months; forecast ${estimate.toFixed(1)}s`);
    done[j.key]=await runJob(j);
    ok(bitHash(old.result.horizons[12])===bitHash(done[j.key].result.horizons[12]),`${j.key} restored run first-12 score bits`);
    ok(bitHash(old.result.samples)===bitHash(done[j.key].result.samples.filter(s=>s.month<=12)),`${j.key} restored run first-12 monthly bits`);
    upgrades.push({key:j.key,fromMonths:12,toMonths:36,previousSeconds:old.seconds,previousAssertions:old.assertions,
      previousSourceChecks:old.result.sourceChecks,prefixBitEquality:true});
    const reduction=reductions.find(r=>r.key===j.key);if(reduction)reduction.restoredToMonths=36;
    fs.writeFileSync(path.join(tmp,"progress.json"),JSON.stringify({head,hashes,done:Object.keys(done),jobMonths:Object.fromEntries(jobs.map(j=>[j.key,j.months])),skipped,reductions,upgrades,estimates,strategyOnlyProbe:!!strategyOnlyProbe,loadLog},null,2));
  }
  const out={schema:2,generatedAt:new Date().toISOString(),mode:quick?"quick":(skipped.length||reductions.length)?"reduced":"full",
    environment:{node:process.version,platform:process.platform,head},sources:hashes,uiSources:uiHashes,
    names:Object.fromEntries(Object.entries(data.start).map(([id,c])=>[id,c.name])),
    params:Object.fromEntries(["scoreCo2Worst","scoreCo2Best","co2IntDef","normalCo2","normalCost","lambdaSlow"].map(k=>[k,data.params[k]])),
    combinations:{},seeds:{},controlled:{},hvdc:hvdc.result,verification:{pass:0,fail:[],sourceOutcomeFailures:[],jobs:{},patches:PATCH_LOG,resumeSourceAudit},
    scope:{reductions,upgrades,requested:requestedPlan,completed:jobs.filter(j=>done[j.key]).map(({out,...j})=>j),skipped:skipped.map(({out,...j})=>j),estimates,
      t5Core:["A0-C0-H0","A80-C0-H0","B80-C0-H0","UB80-C0-H0","A0-C1-H0","A0-C2-H0","A0-C3-H0","B80-C1-H0","UB80-C1-H0"],
      t5Other:"A70/A90/B70/B90/U 및 나머지 교차는 핵심 조합 한정 규칙에 따라 T5를 실행하지 않음"},
    load:{threshold:150,sampleSeconds:10,concurrency:1,samples:loadLog},intermediateDirectory:tmp};
  out.definitions={carbon:Object.fromEntries(VARIANTS.map(a=>{const P=context(a).KCP.ECON_DATA.params;return [a,{parameters:Object.fromEntries(["scoreCo2Worst","scoreCo2Best","co2IntDef","normalCo2"].map(k=>[k,P[k].v])),formula:variantLine(a)}];})),
    grid:Object.fromEntries(["C0","C1","C2","C3"].map(c=>[c,{fractionByMonth:Array.from({length:36},(_,m)=>fraction(c,m+1)),priceMultiplier:c==="C0"?null:c==="C3"?2:1.5,carbonParameter:"normalCo2",localPM:0}])),
    hvdc:Object.fromEntries(Object.entries(out.hvdc.runs).map(([h,r])=>[h,{...r.effective,nominalMW:4,constructionMultiplier:1.3}]))};
  for(const j of jobs.filter(j=>done[j.key])) {
    const d=done[j.key];
    ok(d.result.seed===j.seed,`${j.key} recorded seed matches execution`);
    const matrices=j.kind==="general"?Object.values(d.result.horizons):[d.result];
    for(const matrix of matrices)for(const row of matrix.rows)
      ok([row.score,row.co2,row.strategyRank,row.strategyCityRank].every(Number.isFinite),`${j.key}/${row.id}/${row.strategy} finite score matrix`);
    if(j.kind==="general") {
      ok(d.result.samples.length===54*j.months,`${j.key} complete monthly measurement matrix`);
      for(const row of d.result.samples)
        ok([row.unsPct,row.approval,row.cash,row.debtCap,row.co2Intensity].every(Number.isFinite),`${j.key}/${row.id}/${row.month} finite monthly metrics`);
    }
    out.verification.jobs[j.key]={seconds:d.seconds,assertions:d.assertions,sourceChecks:d.result.sourceChecks};
    // Efficacy/balance thresholds are measured outcomes, never injection integrity checks.
    const failures=d.result.sourceChecks.fail;
    const integrity=failures.filter(f=>!isOutcomeFailure(f));
    ok(integrity.length===0,`${j.key} source integrity: ${integrity.join("; ")}`);
    if(failures.length)out.verification.sourceOutcomeFailures.push({key:j.key,messages:failures});
    Object.assign(out.verification.patches,d.patches);
    if(j.original)continue;
    const key=comboKey(j.variant);
    if(j.tier===3) {
      out.seeds[key]??={};out.seeds[key][j.seed]=d.result;
    } else {out.combinations[key]??={variant:j.variant};out.combinations[key][j.kind]=d.result;}
  }
  const base=out.combinations["A0-C0-H0"];
  out.verification.baselineBitEquality={firstMonthResult:true,firstMonthFullState:true,
    general12MeasurementBits:true,generalFullRerun:false,technologyFullRerun:false};
  out.verification.strategyOnlyProbe={seconds:strategyOnlyProbe.seconds,assertions:strategyOnlyProbe.assertions,sourceChecks:strategyOnlyProbe.result.sourceChecks,originalPrefixBitHash:strategyOnlyProbe.originalPrefixBitHash,probePrefixBitHash:strategyOnlyProbe.probePrefixBitHash};
  const metricHash=g=>bitHash({seed:g.seed,months:g.months,ids:g.ids,strategies:g.strategies,horizons:g.horizons,samples:g.samples,starting:g.starting,hvdcFinalTies:g.hvdcFinalTies});
  for(const value of Object.values(out.combinations))if(value.general)value.general.measurementBitHash=metricHash(value.general);
  for(const value of Object.values(out.combinations))if(value.general)enrich(value.general,base.general);
  for(const group of Object.values(out.seeds))for(const g of Object.values(group)) {
    // Same-seed baseline preferred; common baseline is only used for missing control (explicit metadata).
    const b=out.seeds["A0-C0-H0"]?.[g.seed]||base.general;
    g.deltaBaseline=b.seed;enrich(g,b);
  }
  for(const a of quick?["A0","A80","B80"]:VARIANTS) {await loadGate(`controlled ${a}`);out.controlled[a]=controlled(a);}
  ok(bitHash(controlled("A0",true))===bitHash(out.controlled.A0),"baseline controlled original numerical bits equal");
  out.verification.baselineBitEquality.controlled=true;
  out.noGenerationAtStart=base.general.ids.filter(id=>Object.values(out.controlled.A0.inputs[id].energy.genMWh).every(x=>x===0));
  for(const f of files)ok(sha(read(f))===hashes[f],`source preserved ${f}`);
  for(const f of uiFiles)ok(sha(fs.readFileSync(path.join(ROOT,f)))===uiHashes[f],`ui preserved ${f}`);
  ok(execFileSync("git",["rev-parse","HEAD"],{cwd:ROOT,encoding:"utf8"}).trim()===head,"HEAD unchanged");
  out.baselineComparison={expected:{renew:68.783,diesel:48.717,B16:true,smrFirstCities:2,researchGain:4.333},
    actual:{renew:base.general.horizons[36]?.means.renew,diesel:base.general.horizons[36]?.means.diesel,
      B16:base.general.horizons[36]?.B16,smrFirstCities:base.tech?.smrFirstCities,researchGain:base.tech?.researchGain}};
  out.baselineComparison.matchesAtRecordedPrecision=Object.fromEntries(Object.entries(out.baselineComparison.expected).map(([k,e])=>{
    const a=out.baselineComparison.actual[k];return [k,a==null?null:typeof e==="number"?a.toFixed(3)===e.toFixed(3):a===e];
  }));
  out.load.maxOneMinute=Math.max(...loadLog.map(s=>s.oneMinute));
  for(const u of upgrades) {
    ok(u.previousSourceChecks.fail.every(isOutcomeFailure),`${u.key} prior 12-month integrity`);
    if(u.previousSourceChecks.fail.length)out.verification.sourceOutcomeFailures.push({key:u.key+" (36달 재측정 전 12달)",messages:u.previousSourceChecks.fail});
  }
  if(strategyOnlyProbe.result.sourceChecks.fail.length)out.verification.sourceOutcomeFailures.push({key:"strategy-only-probe (12달)",messages:strategyOnlyProbe.result.sourceChecks.fail});
  Object.assign(out.verification.patches,hvdc.patches);
  out.verification.jobs["controlled-H0-H1-H2"]={seconds:hvdc.seconds,assertions:hvdc.assertions};
  out.verification.pass=assertions+hvdc.assertions+strategyOnlyProbe.assertions+Object.values(done).reduce((n,d)=>n+d.assertions,0)+upgrades.reduce((n,u)=>n+u.previousAssertions,0);
  out.verification.sourcePass=strategyOnlyProbe.result.sourceChecks.pass+Object.values(done).reduce((n,d)=>n+d.result.sourceChecks.pass,0)+upgrades.reduce((n,u)=>n+u.previousSourceChecks.pass,0);
  out.elapsedSeconds=priorSeconds+(Date.now()-started)/1000;
  out.timing={resumed:!!resumed,priorElapsedSeconds:priorSeconds,currentRunSeconds:(Date.now()-started)/1000,definition:"이번 HEAD의 본 측정 경과 시간(부하 대기 포함); 작성·별도 사전 검사 제외. 재개 시 이전 경과 시간(완료 기록이 없으면 완료 워커 시간)을 합산."};
  fs.writeFileSync(path.join(__dirname,"W2W7-results.json"),JSON.stringify(out,null,2)+"\n");
  fs.writeFileSync(path.join(__dirname,"W2W7-report.md"),report(out));
  const finalProgress=JSON.parse(fs.readFileSync(path.join(tmp,"progress.json"),"utf8"));
  finalProgress.elapsedSeconds=out.elapsedSeconds; finalProgress.loadLog=loadLog;
  fs.writeFileSync(path.join(tmp,"progress.json"),JSON.stringify(finalProgress,null,2));
  console.log(`W2W7 ${out.mode}: assertions ${out.verification.pass} pass / 0 fail; source pass ${out.verification.sourcePass}, outcome observations ${out.verification.sourceOutcomeFailures.reduce((n,r)=>n+r.messages.length,0)}; ${out.elapsedSeconds.toFixed(1)}s; max load ${out.load.maxOneMinute}; ${tmp}`);
}
function report(out) {
  const n=(x,d=3)=>Number.isFinite(x)?x.toFixed(d):"미측정",yn=x=>x==null?"미측정":x?"충족":"미충족";
  const base=out.combinations["A0-C0-H0"],ids=base.general.ids,city=id=>out.names[id];
  const changed=(x,b,d=3)=>{const value=typeof x==="number"?n(x,d):String(x);return x!==b?`**${value}***`:value;};
  const list=xs=>xs.length?xs.map(city).join("·"):"없음";
  const lines=["# W2·W7·D2 시안 측정", "",`HEAD \`${out.environment.head}\`, Node ${out.environment.node}, ${out.environment.platform}. 모드 ${out.mode}, 실행 ${n(out.elapsedSeconds,1)}초, 표본 최대 1분 부하 ${out.load.maxOneMinute}.`,"",
    "엔진 파일은 수정하지 않았다. 시안은 VM이 읽을 원문 문자열에만 주입했다. 각 치환 지점의 유일성, A0·C0·H0의 모든 모듈 원문 바이트 동일성, 원문 실행과 일반 12달 전체 측정값·첫 달 전체 상태·결과 및 12달 통제 입력 결과의 IEEE-754 숫자 비트 해시 동일성을 검사했다. JSON sources/uiSources에 입력 파일 SHA-256, verification.patches에 시안별 치환 지점과 원문·주입문 해시가 있다.","",
    ...[12,36].map(month=>{const hs=Object.values(out.combinations).flatMap(v=>v.general?.horizons[month]?[v.general.horizons[month]]:[]);return `${month}달 일반 측정 ${hs.length}조합: B16 ${hs.filter(h=>h.B16).length}/${hs.length}, 재생 평균>디젤 평균 ${hs.filter(h=>h.renewAboveDiesel).length}/${hs.length}, 무행동 전 도시9위 ${hs.filter(h=>h.nothingLast).length}/${hs.length}. 미측정 조합은 분모에서 제외했다.`;}),"",
    "## 시안 정의와 주입 위치", "",
    `W=params.scoreCo2Worst=${out.params.scoreCo2Worst.v}, T=params.scoreCo2Best=${out.params.scoreCo2Best.v}, I=소비 배출/공급량(t/MWh), I0=시작 보정 집약도. X=70·80·90(G).`,"",
    "| 시안 | 정의 | VM 주입 |","|---|---|---|",
    "| A0 | clamp(100(W−I)/(W−T),0,100) | econ.js carbonScore 원문 그대로 |",
    "| AX | I≥W:0; T≤I<W:X(W−I)/(W−T); 0<I<T:X+(100−X)(T−I)/T; I≤0:100 | carbonScore 한 줄 |",
    "| BX | max(AX,RX), r=1−I/I0. r≤0:0; 0<r≤.4:Xr/.4; .4<r<1:X+(100−X)(r−.4)/.6; r≥1:100 | carbonScore 한 줄 |",
    "| U | A0 식 유지, co2IntDef·normalCo2=.4173(O*), scoreCo2Best=.25038(M) | econ-data.js의 세 값 각각 한 곳 |",
    "| UB80 | U의 세 값 + B80 식 | 위 세 값과 carbonScore 각각 한 곳 |",
    "| C0 | 계통 수입 0 | 원문 그대로 |",
    "| C1 | 시작 시간별 수요 ×.5 상한(G), 단가 normalCost×1.5(G) | league-core.js runRound 연계선 정산 직후 |",
    "| C2 | 시작 시간별 수요 ×max(0,(12−월)/11), 단가 ×1.5 | 같은 지점, 1개월 100%·12개월 0%·이후 0% |",
    "| C3 | 시작 시간별 수요 ×.3 상한(G), 단가 ×2(G) | 같은 지점 |",
    "| H0 | HVDC .012, 일반 연계선 TIE_LOSS=.01 | 원문 그대로 |",
    "| H1 | HVDC 2×.01+.5×TIE_LOSS=.025, 용량 유지 | tech-data.js hvdcLoss 값 한 곳 |",
    "| H2 | HVDC 손실 .01, HVDC 연계선 용량 ×1.5(G) | hvdcLoss 및 effectiveTie 용량식 각각 한 곳 |","",
    "H1·H2는 kind=hvdc인 선에만 적용한다. 일반 교류선은 그대로이며, 기존 초전도 도입 효과와 사건 배수는 계속 곱해진다. 새 HVDC 건설비 ×1.3은 유지했다. H 시안은 A0·C0에서만 측정했다.","",
    "AX·BX는 W/T를 params에서 읽는다. fin 규칙대로 유한 number만 인정한다(null·문자열·NaN·±Infinity는 대체). I가 부적절하면 유효 I0, 그마저 없으면 co2IntDef로 대체한다. I0가 없거나 비유한·0 이하이면 상대 눈금을 쓰지 않는다. 음의 I는 100, W 이상은 절대 0이며 BX의 상대 점수는 살아 있을 수 있다. I0가 유효한 0·음수이면 I 대체에도 그 값을 쓰는 현행 fin 규칙을 유지한다. I=0과 점수 0은 다르다. I=0→100점은 제공된 W2 지시서의 2050 탄소중립 기준에 대응한 G 눈금이다.","",
    "2030 40% 감축률을 게임 시작 대비 감축률로 쓰는 것은 G 단순화이다. 0.82는 직접 연소 계산과 연결된 기준이며, 같은 수치의 LCA 중앙값으로 재해석하지 않았다. U의 .4173은 제공된 RESEARCH-2026-10-14 §1의 2023년 국가 계수 보도 확인 O*다. 이번에는 외부 원문을 조회하지 않았다. U/UB80은 시작 보정·공동 탄소 목표 등 normalCo2 사용처에도 영향을 주므로 점수 눈금만 바꾼 실험이 아니다.","",
    "C 주입은 runRound의 settle(built,sims,price,H,days) 뒤에서 시간마다 min(max(0,자체부족−연계선공급),시작수요×상한)을 보충한다. 첫 달 달력·seed=0·normalStartPlans·운영 배수 없음으로 simTeam(...).dem을 얻어 모듈 내부 Map에만 보관한다. 기존 시작 보정과 동일한 수요 프로필이며, 이후 계절·성장·정책 변화로 상한을 늘리지 않는다. 프로필보다 긴 운영 구간은 첫 달 프로필을 주기적으로 반복한다.","",
    "공급은 기존 o.imp와 o.del에 더하고, 비용은 o.fuelX에 normalCost×할증으로 더해 cost.fuel→energy.opex로 전달한다. 탄소는 o.co2In→co2Cons→energy.co2에만 들어간다. co2X·byX·지역 생산량은 늘리지 않아 지역 CO₂·PM 기여는 0이다. econMonth의 원래 재정산은 연계선 수출 연료·PM 발전량만 계산하므로 그대로 두어 계통 수입비를 수출 연료로 차감하지 않는다. 새 공개·저장·전송 필드는 없다. 병원 정전 시간은 기존 del 배분 규칙을 따른다. AI 계획의 simTeam 기반 연료·거래 예상과 시험 운전에는 계통 수입을 추가하지 않았다. 봇은 원래 계획 로직을 쓰며 실제 정산 뒤 재정·지지율 변화에는 반응한다. 기업 유치의 spareMW 예측에도 계통 상한을 더하지 않았다. 공동 탄소 목표의 판정은 기존 econ.js처럼 지역 생산 co2Local 합계이므로 계통 수입 탄소를 포함하지 않지만, 도시 소비 탄소 점수에는 포함한다. 정전 완화에 따른 공동 보너스 변화도 총점에 포함된다.","",
    "## 범위·검증", "",
    `측정기 단언 ${out.verification.pass} 통과 / ${out.verification.fail.length} 실패. 재사용 원 검사 통과 ${out.verification.sourcePass}건. 측정기 통과 수에는 치환·행렬 완주·유한값·부하 파싱·해시 보존 단언을 포함한다. 아래 전략 효용 관측 실패는 측정 무결성 단언과 구분한다.`,"",
    "워커는 직렬 1개이다. 시작 전·계산 중 10초마다 uptime을 읽으며 1분 부하 ≥150이면 새 작업을 기다리거나 실행 중 워커를 SIGSTOP으로 멈추고, 부하가 내려가면 이어 간다. 별도 워커 timeout은 설정하지 않았고 비정상 종료 결과는 수용하지 않는다. 90분은 실측 기반 범위 축소 기준이며 실행 중 강제 종료 시각은 아니다. 최대 부하는 10초 표본의 최대값으로 순간 피크를 보장하지 않는다.","",
    "12달 표는 36턴으로 초기화한 상태 궤적의 12달 시점에 len=12 점수 눈금을 적용한 것이다. 축소 실행은 그 시점에서 멈춘다. 독립된 12턴 새 게임 비교가 아니다. 일반 전략은 bots36.py의 9회전 전략 코드와 회전별 검사를 재사용한다. A0 기준은 원문 전체 검사를 실행했고, 후속 시안은 독립 장치 5개(B9의 별도 방 400개 표본·B7·B10·B18 단위 장치)만 생략했다. 그 생략 실행의 A0 12달 전체 측정값을 원문 전체 검사 결과와 비트 대조했다. 실제 전략의 계획·예산·정산·ESS 대조 검사는 유지한다. T5는 11-tech-balance.js 전체를 사용해 같은 예산 사전 맞춤·월 누계 검사를 유지한다. T5의 42개 최종 궤적만 표에 집계하며 예산 반복은 budget.fitHistory에 보존한다. A0 원문/주입 전체 전략을 중복 재실행하지 않았고, 바이트 보존·일반 12달 전체 측정값·첫 달 전체 상태·통제 12달의 독립 실행으로 동일성을 검사했다.","",
    "계획한 T5 핵심 조합(실제 완료 여부는 아래 표·scope.completed 참조): "+out.scope.t5Core.join(", ")+". "+out.scope.t5Other+".","",
    out.scope.skipped.length?`시간 제한으로 ${out.scope.skipped.length}개 작업을 제외했다. 실측 최대 작업시간에 15% 여유를 더해 예상하고, 씨앗(3) → 교차(2) 순서로 줄였다. 상세 예측값과 제외 작업은 JSON scope에 있다. 실측이 예측보다 빨라 여유가 생기면 B80·C1 등의 단독 일반 전략부터 36달로 재측정하며 첫 12달 수치의 비트 동일성을 확인한다.`:"시간 제한으로 제외한 작업은 없다.","",
    "| 제외 작업 | 이유 |","|---|---|",
    ...out.scope.skipped.map(j=>`| ${j.key} | ${j.reason} |`),...out.scope.reductions.map(j=>`| ${j.key} | ${j.fromMonths}→${j.toMonths}달${j.restoredToMonths?" → 여유 시간에 36달 재측정":""}: ${j.reason} |`),"",
    "## 기존 기록 대조", "", "| 지표 | 기록 | 현재 | 차이 |", "|---|---:|---:|---:|",
    ...Object.entries(out.baselineComparison.expected).map(([k,v])=>{const a=out.baselineComparison.actual[k];return `| ${k} | ${typeof v==="number"?n(v):v} | ${a==null?"미측정":typeof a==="number"?n(a):a} | ${a==null?"미측정":typeof a==="number"?n(a-v):a===v?"같음":"다름"} |`;}),"",
    "수치 기록은 소수 셋째 자리로 비교한다. G10의 연구 이득 +4.483과 이번 과제의 S8b 이후 기준 +4.333은 기록 시점이 다르다. 현재 HEAD에는 W1 자료·설명 변경(5ff0aa0)이 포함되어 있다. 실제 차이가 있는 항목은 아래 실행 표와 JSON 원문 동일성 검사로 구분하며, 원문과 시안 주입 경로가 같다는 사실만으로 과거 HEAD와의 인과 차이를 입증하지 않는다.","",
    "## 일반 전략 요약", "", "굵은 값 뒤 *는 A0·C0·H0의 같은 달과 다른 값이다(표시 반올림 전 수치로 판정). 정전 평균은 도시×전략×월을 같은 무게로 평균하며 0 비율은 공개 unsPct가 0인 표본 비율이다. 지방채 초과는 원 fiscal.debtOver를 쓴다. JSON 일반 samples의 importMWh·co2Cons·uns·dem은 대표 7일 값이며 월량이 아니다. operation은 대표 7일 연료·정책·거래비와 월 대응·연구비가 섞인 원 엔진 진단값으로 월 지출 합계에 쓰지 않는다(sampleUnits 참조). H 통제 표는 따로 달력 환산한 월량이다.","",
    "| 조합 | 달 | B16 | 재생 평균 | 디젤 평균 | 재생>디젤 | nothing 전 도시 9/9 | 초과 도시·달 | 정전 평균 % | 정전0 비율 |", "|---|---:|---|---:|---:|---|---|---:|---:|---:|"];
  for(const [key,v] of Object.entries(out.combinations))if(v.general)for(const [month,h] of Object.entries(v.general.horizons)) {
    const b=base.general.horizons[month];
    lines.push(`| ${key} | ${month} | ${changed(yn(h.B16),yn(b.B16))} | ${changed(h.means.renew,b.means.renew)} | ${changed(h.means.diesel,b.means.diesel)} | ${changed(yn(h.renewAboveDiesel),yn(b.renewAboveDiesel))} | ${changed(yn(h.nothingLast),yn(b.nothingLast))} | ${changed(h.debt.overCityMonths,b.debt.overCityMonths,0)} | ${changed(h.pressure.meanUnsPct,b.pressure.meanUnsPct)} | ${changed(h.pressure.zeroCityMonthFraction,b.pressure.zeroCityMonthFraction)} |`);
  }
  lines.push("","## 도시별 시작·첫 달·지지율","","시작 탄소 점수 / base 1월 정전% / nothing 1월 정전% / 36개월 평균 지지율(기준 대비 차이). 발전소 없는 도시는 시작 보정 연료별 발전량 0으로 식별하며 이름은 자료에서 읽었다.","","| 조합 | 도시 | 시작 탄소 | base 1월 정전% | nothing 1월 정전% | 36달 평균 지지율 | 변화 |","|---|---|---:|---:|---:|---:|---:|");

  for(const [key,v] of Object.entries(out.combinations))if(v.general)for(const id of ids) {
    const g=v.general,b=base.general,get=(x,s)=>x.samples.find(r=>r.id===id&&r.strategy===s&&r.month===1).unsPct;
    const ap=g.horizons[36]?.approvalByCity[id];
    lines.push(`| ${key} | ${city(id)} | ${changed(g.starting[id].co2,b.starting[id].co2)} | ${changed(get(g,"base"),get(b,"base"))} | ${changed(get(g,"nothing"),get(b,"nothing"))} | ${n(ap?.timeMean)} | ${n(ap?.timeDelta)} |`);
  }
  lines.push("", `시작 연료별 발전량이 0인 도시: ${list(out.noGenerationAtStart)}.`, "");
  function matrix(title,g,baseline,tech=false) {
    lines.push("",`### ${title}`,"","각 칸: 총점 / 탄소 부분점수 / 도시 안 전략 순위 / 전략 안 도시 순위. 동점은 공동 순위(다음 순위는 건너뜀).","",`| 도시 | ${g.strategies.join(" | ")} | 1위 전략 |`,`|---|${g.strategies.map(()=>"---").join("|")}|---|`);
    for(const id of ids) {
      const cells=g.strategies.map(strategy=>{
        const r=g.rows.find(r=>r.id===id&&r.strategy===strategy),b=baseline.rows.find(r=>r.id===id&&r.strategy===strategy);
        return ["score","co2","strategyRank","strategyCityRank"].map((k,i)=>changed(r[k],b[k],i<2?3:0)).join(" / ");
      });
      lines.push(`| ${city(id)} | ${cells.join(" | ")} | ${changed(g.winners[id].join("·"),baseline.winners[id].join("·"))} |`);
    }
    if(!tech) {
      lines.push("",`지방채 초과 도시: ${list(g.debt.cities)}. 전략별 초과 도시·달: ${Object.entries(g.debt.byStrategy).map(([s,n])=>`${s}=${n}`).join(", ")}.`,"",
        "| 전략 | 평균 정전% | 정전0 비율 |","|---|---:|---:|",
        ...Object.entries(g.pressure.byStrategy).map(([s,r])=>`| ${s} | ${changed(r.meanUnsPct,baseline.pressure.byStrategy[s].meanUnsPct)} | ${changed(r.zeroFraction,baseline.pressure.byStrategy[s].zeroFraction)} |`));
    }
  }
  lines.push("","## 도시×전략 상세");
  for(const [key,v] of Object.entries(out.combinations))if(v.general)for(const [month,h] of Object.entries(v.general.horizons))matrix(`${key}, ${month}달`,{...h,strategies:v.general.strategies},base.general.horizons[month]);
  lines.push("", "## D2 강제 HVDC 12달 통제 실험", "",out.hvdc.design,"",
    `연결 도시: ${list(out.hvdc.endpoints)}. 건설비 ${n(out.hvdc.constructionCost)}억(각 절반), 명목 4MW. 시작 수출 여유가 가장 큰 도시와 무발전 육상 이웃을 선택했다. H0/H1/H2 모든 달에서 송전량>0 및 손실·용량 상한을 단언했다. 손실 MWh는 원 엔진이 .01 MWh로 반올림한 송출−수입의 차이를 달력 환산한 값이다.`,"",
    `일반 기준 9회전의 최종 HVDC 선 수 ${base.general.hvdcFinalTies.reduce((n,r)=>n+r.ties.length,0)}개. T5 기준에서 HVDC 준공을 관측한 궤적 ${base.tech?base.tech.rows.filter(r=>r.monthly.some(m=>m.ties.some(t=>t.kind==="hvdc"&&t.st==="built"))).length:"미측정"}/42. H 봇 비교는 재개 지시에 따라 제외했다.`,"",
    "| 시안 | 실효 MW | 손실률 | 12달 송출 MWh | 도착 MWh | 손실 MWh |", "|---|---:|---:|---:|---:|---:|");
  const hb=out.hvdc.runs.H0;
  for(const [h,r] of Object.entries(out.hvdc.runs))lines.push(`| ${h} | ${changed(r.effective.cap,hb.effective.cap)} | ${changed(r.effective.loss,hb.effective.loss)} | ${changed(r.total.sentMWh,hb.total.sentMWh)} | ${changed(r.total.receivedMWh,hb.total.receivedMWh)} | ${changed(r.total.lossMWh,hb.total.lossMWh)} |`);
  lines.push("","| 시안 | 도시 | 12달 평균 정전% | 전력 운영비 합계(억) | 소비 탄소 합계(t) |","|---|---|---:|---:|---:|");
  for(const [h,r] of Object.entries(out.hvdc.runs))for(const id of out.hvdc.endpoints) {
    const a=r.cities[id],b=hb.cities[id];lines.push(`| ${h} | ${city(id)} | ${changed(a.meanUnsPct,b.meanUnsPct)} | ${changed(a.operation,b.operation)} | ${changed(a.consumptionCo2,b.consumptionCo2)} |`);
  }
  lines.push("","| 시안 | 월 | 송출 MWh | 도착 MWh | 손실 MWh | 도시 | 정전% | 전력 운영비(억) | 소비 탄소(t) |","|---|---:|---:|---:|---:|---|---:|---:|---:|");
  for(const [h,r] of Object.entries(out.hvdc.runs))for(const row of r.months)for(const id of out.hvdc.endpoints) {
    const b=hb.months[row.month-1],a=row.cities[id],c=b.cities[id];
    lines.push(`| ${h} | ${row.month} | ${changed(row.sentMWh,b.sentMWh)} | ${changed(row.receivedMWh,b.receivedMWh)} | ${changed(row.lossMWh,b.lossMWh)} | ${city(id)} | ${changed(a.unsPct,c.unsPct)} | ${changed(a.operation,c.operation)} | ${changed(a.consumptionCo2,c.consumptionCo2)} |`);
  }
  lines.push("","## T5 기술 전략 36달","","| 조합 | SMR 1위 도시 수 | 연구 몰빵−연구0 | B16 | HVDC 준공을 한 번이라도 관측한 궤적 수 |","|---|---:|---:|---|---:|");
  for(const [key,v] of Object.entries(out.combinations))if(v.tech)lines.push(`| ${key} | ${changed(v.tech.smrFirstCities,base.tech.smrFirstCities,0)} | ${changed(v.tech.researchGain,base.tech.researchGain)} | ${changed(yn(v.tech.B16),yn(base.tech.B16))} | ${v.tech.rows.filter(r=>r.monthly.some(m=>m.ties.some(t=>t.kind==="hvdc"&&t.st==="built"))).length} |`);
  if(base.tech)lines.push("",...Object.entries(out.combinations).filter(([key,v])=>v.tech&&key!=="A0-C0-H0").map(([key,v])=>`${key}: T5 전체 원자료 비트 해시가 기준과 ${v.tech.rawBitHash===base.tech.rawBitHash?"동일":"다름"}. 이는 측정된 전략·씨앗 범위의 결과이다.`),"");
  if(base.tech)lines.push("",Object.entries(base.tech.names).map(([k,v])=>`${k}: ${v}`).join(" / "),"");
  for(const [key,v] of Object.entries(out.combinations))if(v.tech) {
    matrix(key,v.tech,base.tech,true);
    lines.push("","| 도시 | 탄소100 전략 수/7 | 탄소0 전략 수/7 |","|---|---:|---:|",
      ...ids.map(id=>`| ${city(id)} | ${changed(v.tech.saturation[id].hundred,base.tech.saturation[id].hundred,0)} | ${changed(v.tech.saturation[id].zero,base.tech.saturation[id].zero,0)} |`));
  }
  lines.push("", "## D-73 모든 시안의 시작 탄소 부분점수", "", `| 도시 | ${Object.keys(out.controlled).join(" | ")} |`, `|---|${Object.keys(out.controlled).map(()=>"---:").join("|")}|`);
  for(const id of ids)lines.push(`| ${city(id)} | ${Object.values(out.controlled).map(g=>changed(g.startingByCity[id].co2,out.controlled.A0.startingByCity[id].co2)).join(" | ")} |`);
  const focal=out.controlled.A0.name;
  lines.push("",`## ${focal} 작은 감축 신호`,"","G9 통제 입력: 다른 입력을 고정하고 co2·co2Local을 같은 비율로 줄여 12달 유지. 시작 보정값은 유지한다. 총점은 원 G9처럼 36달 점수 눈금이다. 완화된 상태 집약도 때문에 실제 상태 감축률은 입력 감축률보다 작을 수 있다.","","| 시안 | 입력 감축률 | 탄소 부분점수 | 총점 | 실현 집약도 감축률 |","|---|---:|---:|---:|---:|");
  for(const [a,g] of Object.entries(out.controlled))for(const r of g.rows) {
    const b=out.controlled.A0.rows.find(x=>x.reduction===r.reduction);
    lines.push(`| ${a} | ${n(r.reduction*100,0)}% | ${changed(r.co2,b.co2)} | ${changed(r.score,b.score)} | ${n(r.realizedReduction*100)}% |`);
  }
  lines.push("","## 씨앗 강건성","","완료된 씨앗 조합만 아래 표에 싣는다(요청 범위: 일반 9전략×6도시×36달). 상세 12·36달 점수·탄소·양쪽 순위·초과 달·지지율·첫 달·월별 수치는 JSON seeds에 보존한다. delta는 같은 씨앗 A0·C0·H0 기준이다.","","| 조합 | 씨앗 | B16 | 재생 | 디젤 | 재생>디젤 | nothing 9/9 | 초과 도시·달 | base 초과 도시·달 | 정전 평균% | 정전0 비율 |","|---|---|---|---:|---:|---|---|---:|---:|---:|---:|");
  for(const [key,seeds] of Object.entries(out.seeds))for(const [seed,g] of Object.entries(seeds)) {
    const h=g.horizons[36];lines.push(`| ${key} | ${seed} | ${yn(h.B16)} | ${n(h.means.renew)} | ${n(h.means.diesel)} | ${yn(h.renewAboveDiesel)} | ${yn(h.nothingLast)} | ${h.debt.overCityMonths} | ${h.debt.byStrategy.base} | ${n(h.pressure.meanUnsPct)} | ${n(h.pressure.zeroCityMonthFraction)} |`);
  }
  if(!Object.keys(out.seeds).length)lines.push("","씨앗 강건성은 미측정이다.");
  lines.push("","## 원 검사의 효용 관측 실패","","아래 항목은 시안의 정전 압력·ESS 버림 감소 관측·연구 이득·전략 지배 결과이며 실패를 통과로 바꾸지 않았다. 합법 계획·예산·계약·완주 등의 무결성 실패는 실행을 실패 처리한다. JSON verification.sourceOutcomeFailures에 원문 전체를 남겼다. 원래 36달용 평균 정전 ≤5%와 ESS 접속 후 버림 감소 관측 기준도 12달에서 멈춘 실행에 그대로 적용되므로, 그 미충족을 36달 결과로 확대하지 않는다.","","| 작업 | 원 검사 관측 실패 수 |","|---|---:|",...out.verification.sourceOutcomeFailures.map(r=>`| ${r.key} | ${r.messages.length} |`));
  if(!out.verification.sourceOutcomeFailures.length)lines.push("| 전체 | 0 |");
  lines.push("","## 해석 한계","",
    `- T5 추가 시안 미측정 작업은 ${out.scope.skipped.filter(j=>j.kind==="tech").length}개다. 해당 조합의 탄소 포화·SMR 1위 도시 수·연구 이득 변화는 판단하지 않았다.`,
    "- 일반 9전략은 한 도시씩 독립 실험이 아니라 같은 회전에서 이웃 전략도 함께 바뀐다. 순위·지지율 차이는 정책·투자·이주·거래의 피드백을 포함한다. T5는 나머지 다섯 도시를 균형 AI로 둔다.",
    "- 일반 봇의 기본 씨앗과 T5의 씨앗은 각각 bots-strategy-common·tech-strategy-common이다. 단일 공통 씨앗의 결과를 전체 씨앗에 일반화하지 않는다.",
    "- H 통제 실험은 매달 H0 상태를 복제하므로 H1/H2의 지지율·이주·재투자 피드백을 누적하는 독립 게임 비교가 아니다. 연구 시간·비용은 사전 도입으로 제외하고, 선 건설비 ×1.3과 합법 건설 예산은 확인했다. 일반 최종 HVDC 목록과 T5 월별 ties/adopted는 JSON에 보존했다.",
    "- H1은 변환소 손실과 선로 손실의 제안식이며 개별 노선 실측 예측이 아니다. H2의 계통 안정은 전송 용량 확대로만 표현하고 전압·주파수·과도 안정도를 계산하지 않는다.",
    "- 수입은 도시 내부 배전망의 위치 제약 없이 도시 잔여 부족분을 보충하는 G 근사다. 상한·할증의 시군구 실측 근거는 없다. 시작 보정은 여전히 부족분을 전량 정상 계통 공급으로 보며 C1/C3의 제한 운영과 완전히 같아지지 않는다.",
    "- 정전%는 원 엔진의 소수 둘째 자리 반올림값, 탄소 부분점수·총점도 원 엔진 반올림값이다. 정전0 비율은 미공급량이 수학적으로 정확히 0임을 뜻하지 않을 수 있다. 비용·탄소 보존 검사는 원 보고 정밀도(.01억·1t)에 맞춘 허용 오차를 쓴다.",
    "- U/UB80의 최신 계수는 보도 확인 O*이며 이번 작업에서 공식 원문으로 등급을 올리지 않았다. 법·정책 목표를 게임의 전력 집약도에 대응시키는 해석은 G이다.",
    "- 이전 세션 중간 산출물은 HEAD가 달라 사용하지 않았다. 이번 HEAD에서 모든 수치를 직렬로 다시 계산했다. 보고용 단위 메타데이터 보완 뒤 재집계할 때에는 실행 원본 스냅샷과 계산 함수 전체의 바이트 동일성, HEAD·엔진 해시·시안 주입문 해시를 대조하고 완료 워커 결과를 재사용했다. 부하 로그는 본 실행 시작부터 기록한다.",
    "- 브라우저·외부 네트워크·운영 데이터·커밋은 실행하지 않았다. ui 전체 해시와 HEAD를 보존 검사했다. test-econ·balance·recal 별도 전체 회귀는 이번 VM 시안 측정에 포함하지 않았다.","",
    "재현: `node tests/league/review/w2-carbon-variants.js`. 자체 검사만: `node tests/league/review/w2-carbon-variants.js --self-test`. `--quick`은 A0/A80/B80 12달 예비 범위이며 T5·C·씨앗은 제외하고 H 통제 실험은 유지한다. 재실행은 W2W7-results.json과 W2W7-report.md를 덮어쓴다. 이전 회차 결과는 사용하지 않았다. 같은 HEAD·입력 해시로 이번 회차에 새로 만든 중간 결과는 `--resume <중간 디렉터리>`로 이어갈 수 있다. 결과 선택·추천은 포함하지 않는다.","");
  return lines.join("\n");
}
if (require.main===module) {
  if(process.argv[2]==="--worker")worker(JSON.parse(process.argv[3]));
  else if(process.argv[2]==="--self-test")loadGate("self-test").then(()=>{injectionTests();console.log(`self-test ${assertions}/0`);}).catch(e=>{console.error(e);process.exitCode=1;});
  else if(process.argv[2]==="--hvdc-only")runJob({key:"hvdc-only",kind:"hvdc",out:"/tmp/w2w7-hvdc-probe.json"}).then(d=>console.log(JSON.stringify({assertions:d.assertions,results:Object.fromEntries(Object.entries(d.result.runs).map(([h,r])=>[h,r.total]))}))).catch(e=>{console.error(e);process.exitCode=1;});
  else if(process.argv[2]==="--pilot-tech")runJob({key:"pilot-tech-A0-C0-H0",kind:"tech",variant:{a:"A0",c:"C0",h:"H0"},seed:"tech-strategy-common",months:36,out:"/tmp/w2w7-pilot-tech.json"}).then(()=>fs.writeFileSync("/tmp/w2w7-pilot-tech-load.json",JSON.stringify(loadLog))).catch(e=>{console.error(e);process.exitCode=1;});
  else if(process.argv[2]==="--pilot")runJob({key:"pilot-A0-C0-H0",kind:"general",variant:{a:"A0",c:"C0",h:"H0"},seed:"bots-strategy-common",months:36,out:"/tmp/w2w7-pilot.json"}).catch(e=>{console.error(e);process.exitCode=1;});
  else main().catch(e=>{console.error(e);process.exitCode=1;});
}
