"use strict";
// G4: lib·도시별 근사 원가 격자는 진단 전용. B12 판정은 21-host-policy-grid.js.
const fs = require('node:fs'), path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../balance.js'), 'utf8')
  .replace('function block(key, fn) {', 'function block(key, fn) { return;')
  .split('failures.forEach(message =>')[0];
const {X,D,IDS,run12,run,operating} = new Function('require','__dirname',source + '\nreturn {X,D,IDS,run12,run,operating};')(require,path.resolve(__dirname,'..'));
const clone = x => JSON.parse(JSON.stringify(x));
function measure(id, policy, runner = run12) {
  const r = runner(36, cid => cid === id ? {policy} : {}), s = X.score(r.E,D).by[id], c=r.E.cities[id];
  return {key:[policy.taxRes||0,policy.taxInd||0,policy.service||0].join(','),score:s.score,parts:s.parts,cash:c.cash,annual:operating(r,id),pop:c.pop,ind:c.ind,approval:c.approval};
}
function grid(b3 = false) {
  return Object.fromEntries(IDS.map(id=>{
    const rows=[];
    for(let taxRes=-2;taxRes<=2;taxRes++)for(let taxInd=-2;taxInd<=2;taxInd++)for(let service=-2;service<=2;service++) {
      if (!b3 || taxRes === taxInd) rows.push(measure(id,{taxRes,taxInd,service},run));
    }
    const best=Math.max(...rows.map(r=>r.score)), top=rows.filter(r=>r.score===best);
    return [id,{top,base:rows.find(r=>r.key==='0,0,0'),low:rows.find(r=>r.key==='-2,-2,2')}];
  }));
}
if(require.main===module){
  const overrides=JSON.parse(process.argv[2]||'{}');
  for(const [k,v] of Object.entries(overrides)){
    if(D.params[k]?.grade!=='G')throw Error('G only: '+k);D.params[k].v=v;
  }
  const result=process.argv.includes('--quick')?Object.fromEntries(IDS.map(id=>[id,[-2,-1,0,1,2].flatMap(tax=>[-2,0,2].map(service=>measure(id,{taxRes:tax,taxInd:tax,service})))])):grid(process.argv.includes('--b3'));
  console.log(JSON.stringify({overrides,settings:Object.fromEntries(['fiscalTargetRev','subBase','subPerCap','subEq','tariffMarkup','taxGain','taxYardstick','eduMemory','serviceCurve','wScore'].map(k=>[k,D.params[k].v])),result},null,2));
}
module.exports={X,D,IDS,run12,run,operating,measure,grid,clone};
