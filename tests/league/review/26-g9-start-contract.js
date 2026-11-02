"use strict";
// G9 시작 배치·원가 일치, 무공급 기억, 도시별 감축 신호. 실제 지도와 독립 대조.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const ctx = vm.createContext({console, document:{documentElement:{}}, KCP:{route(){},on(){},esc:x=>x}});ctx.window=ctx;
for(const n of ['build-maps','tech-data','build','econ-data','econ','league-data','league-core'])
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,`../../../ui/${n}.js`),'utf8'),ctx);
const {leagueCore:C,buildGame:B,econ:X,ECON_DATA:D}=ctx.KCP, clone=x=>JSON.parse(JSON.stringify(x));
const R=C.regionOf('south'), ids=R.teams.map(t=>t.id), calibrate=X.calibrate;
let inputs; X.calibrate=(E,raw,...rest)=>{inputs=clone(raw);return calibrate(E,raw,...rest);};
const S=C.newState('g9-carbon',R.id,0,ids,{turns:36}); X.calibrate=calibrate;
let checks=0;const ok=(p,m)=>{assert.ok(p,m);checks++;};
const near=(a,b,m)=>ok(Number.isFinite(a)&&Math.abs(a-b)<1e-8,`${m}: ${a}/${b}`);
const rows=[];
for(const id of ids){
 B.selectPack(C.teamDef(R,id).pack,'league');
 const plan=B.sanitize(D.normalStartPlans[id],Number.MAX_VALUE);
 const sim=B.simulate({...plan,season:'winter',seed:0},7,{league:true});
 const served=Math.max(0,sim.tot.dem-sim.unsTotal), hasSupply=served>1e-6;
 const missing=Math.max(0,sim.tot.dem-served);
 const intensity=(sim.co2+missing*D.params.normalCo2.v)/sim.tot.dem;
 const cost=(sim.cost.fuel+missing*D.params.normalCost.v)/sim.tot.dem;
 ok(plan.builds.length===0,'가상 신규 발전소 없음');
 near(S.econ.cities[id].co2Intensity0,intensity,'지도 구성 기준 탄소');
 near(inputs[id].energy.costPerMWh,cost,'탄소와 같은 운전의 원가');
 near(inputs[id].energy.co2/inputs[id].energy.servedMWh,intensity,'보통 조건 환산 탄소 보존');
 let E=clone(S.econ);const before=X.score(E).by[id].parts.co2;
 const raw=clone(inputs);raw[id].energy.co2*=.7;raw[id].energy.co2Local*=.7;
 for(let m=0;m<12;m++)E=X.monthStep(E,raw).E;
 const after=X.score(E).by[id].parts.co2;
 ok(after>before,`${id} 30% 감축 12달 탄소 부분점수 상승 ${before}→${after}`);
 const zero=clone(raw);zero[id].energy.servedMWh=0;zero[id].energy.unsPct=100;zero[id].energy.co2=0;zero[id].energy.co2Local=0;
 const retained=X.monthStep(clone(E),zero).E;
 near(retained.cities[id].co2Intensity,E.cities[id].co2Intensity,'공급0 직전 집약도 보존');
 near(X.score(retained).by[id].parts.co2,after,'공급0 직전 탄소 부분점수 보존');
 const small=clone(S.econ);small.cities[id].co2Intensity=intensity*.99;
 rows.push({id,sources:B.SITES.filter(s=>s.kind==='plant').map(s=>s.fuel||'lng'),fallback:!hasSupply,
  supplied:served,intensity,cost,before,after,onePercentCut:X.score(small).by[id].parts.co2});
}
if(process.env.G9_CARBON_OUT)fs.writeFileSync(process.env.G9_CARBON_OUT,JSON.stringify(rows,null,2));
console.log('G9 시작 탄소',JSON.stringify(rows));console.log(`G9 carbon pass ${checks} fail 0`);
