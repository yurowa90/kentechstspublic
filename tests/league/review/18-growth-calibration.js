"use strict";
// F40 reproducible analysis of the unmodified bots36.py JSON output.
// Usage: node tests/league/review/18-growth-calibration.js /tmp/.../bots36.json
// The complete review suite does not require external scratch artifacts.
const fs=require("node:fs"),assert=require("node:assert/strict");
if(!process.argv[2]) { console.log("F40 analysis: supply bots36.json to recalculate growth scales and debt distribution"); }
else {
 const data=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
 const sum=xs=>xs.reduce((a,b)=>a+b,0),quantile=(xs,p)=>{const a=xs.slice().sort((a,b)=>a-b),i=(a.length-1)*p;return a[Math.floor(i)]+(i%1)*(a[Math.ceil(i)]-a[Math.floor(i)]);};
 const scales={};
 for(const m of [12,24,36]) {
  scales[m]={};
  for(const key of ["pop","ind"]){
   const gs=data.runs.flatMap(r=>{
    const cs=Object.values(r.hist[m-1].cities),ratio=sum(cs.map(c=>c[key]))/sum(cs.map(c=>c[key+"0"]));
    return cs.map(c=>Math.abs(c[key]/c[key+"0"]/ratio-1));
   });
   assert.ok(gs.length===54&&gs.every(Number.isFinite),"9 rotations × 6 cities");
   const B=quantile(gs,.975); scales[m][key]={n:gs.length,B,K:50/B};
  }
 }
 const samples=data.runs.flatMap(r=>r.hist.flatMap(h=>Object.values(h.fiscal).map(f=>Math.max(0,-f.cashAfter)/f.debtCap)));
 const final=data.runs.flatMap(r=>Object.values(r.hist.at(-1).fiscal).map(f=>Math.max(0,-f.cashAfter)/f.debtCap));
 const dist=xs=>({n:xs.length,median:quantile(xs,.5),p95:quantile(xs,.95),max:Math.max(...xs),over1:xs.filter(x=>x>1).length,over2:xs.filter(x=>x>2).length,over4:xs.filter(x=>x>4).length});
 const strategies={};
 for(const strategy of data.strategies){
  const rows=data.runs.flatMap(r=>r.rows.filter(row=>row.strategy===strategy)),scores=rows.map(r=>r.score),mean=sum(scores)/scores.length;
  strategies[strategy]={n:rows.length,mean,variance:sum(scores.map(s=>(s-mean)**2))/scores.length,sd:Math.sqrt(sum(scores.map(s=>(s-mean)**2))/scores.length),min:Math.min(...scores),max:Math.max(...scores)};
 }
 const winners={};
 for(const id of data.ids){const rows=data.runs.flatMap(r=>r.rows.filter(row=>row.id===id)),best=Math.max(...rows.map(r=>r.score));winners[id]=rows.filter(r=>r.score===best).map(r=>r.strategy);}
 const unrest=data.runs.flatMap(r=>r.hist.flatMap(h=>Object.values(h.cities)));
 console.log(JSON.stringify({scales,debt:{all:dist(samples),final:dist(final)},strategies,winners,unrest:{months:unrest.length,active:unrest.filter(c=>c.unrest>0).length},failures:data.checks.filter(c=>!c[0])},null,2));
}
