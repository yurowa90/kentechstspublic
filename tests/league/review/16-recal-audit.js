"use strict";
// G2 independent diagnostics. Keep recal.js's oracles unchanged; reproduce its
// disputed rows here with stationary international inputs and full precision.
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const { X, D, IDS, inputsFor } = require("./lib");
const clone = x => JSON.parse(JSON.stringify(x)), sum = xs => xs.reduce((a,b) => a+b,0);
const focal = IDS.reduce((a,b) => (D.start[a].mix.semi || 0) > (D.start[b].mix.semi || 0) ? a : b);
function data() {
  const d = clone(D);
  for (const k of ["gpYear", "giYear", "kappaPopReal"]) d.params[k].v = 0;
  d.params.eduSpeed.v = d.params.eduMemory.v = 1;
  d.params.kappaIndReal.v = .05;
  d.intl.eventP = 0; d.intl.schedule = [];
  for (const k of Object.keys(d.intl.sigma)) d.intl.sigma[k] = 0;
  // H02's endogenous LNG price does not enter the fixed lib energy fixture.
  return d;
}
const source = fs.readFileSync(path.resolve(__dirname,"../../../ui/econ.js"),"utf8");
function engine(variant) {
  let src = source;
  if (variant === "exclude-self") src = src.replace("(pol.taxInd - fin(reg.taxIndAvg, 0))", "(pol.taxInd - (reg.taxIndAvg * 6 - pol.taxInd) / 5)");
  if (variant === "unnormalized") src = src.replace("c100(a / b)", "c100(a)");
  if (variant === "old-price") src = src.replace('P("priceWeightBase") + P("priceSteelMul") * (mix.steel || 0)', '.5 + (mix.steel || 0) + (mix.semi || 0) + (mix.chem || 0)');
  const box = {window:{KCP:{ECON_DATA:D}}}; vm.runInNewContext(src,box); return box.window.KCP.econ;
}
function run(eng, d, tax) {
  let E = eng.initCities(IDS,d,{seed:"recal-0",months:36});
  E = eng.calibrate(E,inputsFor(E,()=>({})),d); E.len = 600;
  let prior;
  for(let m=0;m<600;m++) {
    if(m===575) prior=clone(E);
    E = eng.monthStep(E,inputsFor(E,id=>({p:{taxInd:id===focal?tax:0}})),d).E;
  }
  return {E, drift:Math.max(...IDS.map(id=>Math.abs(E.cities[id].ind-prior.cities[id].ind)/E.totals.ind*100))};
}
const tax = {};
for(const variant of ["current","old-price","exclude-self","unnormalized"]) {
  const eng = variant === "current" ? X : engine(variant), d=data(), a=run(eng,d,0), b=run(eng,d,-1);
  tax[variant]={pct:100*(b.E.cities[focal].ind/a.E.cities[focal].ind-1), maxLast25MonthShareDrift:Math.max(a.drift,b.drift)};
  assert.ok(tax[variant].maxLast25MonthShareDrift<.001,"stationary convergence");
}
// Direct logit prediction from the initial A changes, before land feedback.
const d=data(), E=X.initCities(IDS,d), base=inputsFor(E,()=>({})), cut=inputsFor(E,id=>({p:{taxInd:id===focal?-1:0}}));
const scores = input => IDS.map(id=>{const c=clone(E.cities[id]);c.policy=input[id].policy;return X.industryAttract(c,X.ctxOf(E,Object.fromEntries(IDS.map(key=>[key,X.cleanInput(input[key],E.cities[key],d.start[key])])),d,id));});
const a=scores(base), b=scores(cut), raw=IDS.map((id,i)=>E.cities[id].ind/E.totals.ind*Math.exp(.08*(b[i].score-a[i].score)/10));
const i=IDS.indexOf(focal), direct=100*(raw[i]/sum(raw)/(E.cities[focal].ind/E.totals.ind)-1);
assert.ok(tax.current.pct>=.15 && tax.current.pct<=.45,"G4 G tax weight matches literature conversion; M coefficients unchanged");
// recal 09 uses rounded report Aeff. Read the state to independently reconstruct
// the normalized softmax and integer migration for both time scales.
const migration=[];
for(const speed of [1,4.4]) {
  const dd=clone(D);dd.params.eduSpeed.v=speed;dd.params.gpYear.v=dd.params.giYear.v=0;
  for(const id of IDS){dd.start[id].pop0*=1e6;dd.start[id].ind0*=1e6;}
  let s=X.initCities(IDS,dd);s=X.calibrate(s,inputsFor(s,()=>({})),dd);
  const r=X.monthStep(s,inputsFor(s,id=>id===focal?{e:{uns:100}}:{}),dd), eff=IDS.map(id=>r.E.cities[id].Aeff);
  const weights=IDS.map((id,i)=>s.cities[id].ind/s.totals.ind*Math.exp(.08*eff[i]/10)), z=sum(weights);
  const error=Math.max(...IDS.map((id,i)=>Math.abs(r.E.cities[id].ind-s.cities[id].ind-.005*speed*(weights[i]/z*s.totals.ind-s.cities[id].ind))));
  assert.ok(error<=1,"unrounded state reproduces industry migration within integer rounding");migration.push({speed,error});
}
console.log("R2 tax audit",JSON.stringify({tax,directLogitPct:direct,weightSum:sum(Object.values(a[i].w)),normalizedTaxWeight:a[i].w.tax/sum(Object.values(a[i].w)),migration}));
