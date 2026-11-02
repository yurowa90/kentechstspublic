"use strict";
// G10 확정 코드에서 G 손잡이만 바꾸는 진단. 근거 자료·점수식·파일은 수정하지 않는다.
const {hostTape,replay,axes}=require('./21-host-policy-grid');
const variants={current:{},'reserve-low':{aiSupplyReserve:0.05,aiSafeReserve:0.1},
 'research-borrow':{aiResearchDebtShare:1},'local-weight-1':{aiLocalFuelWeight:1}};
function measure(variant,withGrid=false) {
 if(!Object.hasOwn(variants,variant))throw Error(`알 수 없는 진단 ${variant}`);
 const fixture=hostTape(variants[variant]), neutral=replay(fixture), out={variant,overrides:variants[variant]};
 out.cities=Object.fromEntries(fixture.ids.map(id=>[id,{
  cash:neutral.E.cities[id].cash,debtCap:neutral.E.cities[id].debtCap,
  overMonths:neutral.reports.filter(r=>r.fiscal[id].debtOver).length,
  minHeadroom:Math.min(...neutral.reports.map(r=>r.fiscal[id].cashAfter+r.fiscal[id].debtCap)),
  maxUns:Math.max(...fixture.tape.map(input=>input[id].energy.unsPct)),score:neutral.scored.by[id].score
 }]));
 if(withGrid) {
  const result={};
  for(const id of fixture.ids) {
   const rows=[];
   for(let taxRes=-2;taxRes<=2;taxRes++)for(let taxInd=-2;taxInd<=2;taxInd++)for(let service=-2;service<=2;service++) {
    const scored=replay(fixture,id,{taxRes,taxInd,service}).scored.by[id];
    rows.push({taxRes,taxInd,service,score:scored.score});
   }
   const best=Math.max(...rows.map(r=>r.score)); result[id]={top:rows.filter(r=>r.score===best)};
  }
  out.top=Object.fromEntries(fixture.ids.map(id=>[id,result[id].top])); out.axes=axes(result);
  out.families=Object.fromEntries([-1,1].map(sign=>[sign<0?'cut':'raise',fixture.ids.filter(id=>result[id].top.some(r=>
   sign*r.taxRes>=0&&sign*r.taxInd>=0&&sign*(r.taxRes+r.taxInd)>0)).length]));
 }
 return out;
}
module.exports={measure};
if(require.main===module&&process.argv[2])console.log(JSON.stringify(measure(process.argv[2],process.argv.includes('--grid')),null,2));
