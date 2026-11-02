"use strict";
// G4: ai-check.py's Node path omits tech-data; exercise that additional contract here.
// Exercise research with the real technology module, all styles, 6 cities.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const ctx=vm.createContext({console,document:{documentElement:{}},KCP:{route(){},on(){},esc:x=>x}});ctx.window=ctx;
vm.runInContext('Math.random=()=>{throw Error("unseeded random")}',ctx);
for(const f of ["build-maps","tech-data","build","econ-data","econ","league-data","league-core","league-ai"])
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,`../../../ui/${f}.js`),"utf8"),ctx);
const {leagueCore:C,leagueAI:AI,buildGame:B,ECON_DATA:D,TECH_DATA:T}=ctx.KCP,R=C.regionOf("south"),ids=R.teams.map(t=>t.id),rows=[];
for(const name of ["careful","balanced","bold"]){
 const S=C.newState("ai-check-common",R.id,0,ids,{turns:12}),style=AI.STYLES[name];
 ids.forEach(id=>{S.teams[id].token="test-bot";});
 const row={style:name,ren:Object.fromEntries(ids.map(id=>[id,0])),newStaff:0};
 for(let m=1;m<=12;m++){
  C.host(S,"next",m);
  for(const id of ids){
   B.selectPack(C.teamDef(R,id).pack,"league");
   const old=S.teams[id].plan,answer=AI.plan(S,R,id,B,name),p=answer.plan;
   const added=p.builds.filter(b=>["lab","uni"].includes(b.t)&&!old?.builds.some(x=>x.t===b.t&&x.i===b.i));
   if(added.length){
    row.newStaff+=added.length;
    const age=m-1-style.delay,annual=age===0;
    assert.ok(age>=0&&(annual||age%D.params.aiGridRepairEvery.v===0),"research respects style delay and investment schedule");
    const fixed=C.fixedOf(S,R,id)+C.lossOf(S.teams[id].base,p);
    const committed=S.teams[id].committed??(S.teams[id].base||[]).reduce((s,x)=>s+x.c,0)+fixed;
    const cap=committed+Math.max(0,C.budget(S,id)-committed)*style.invest*(annual?1:D.params.aiRepairInvest.v)-fixed;
    assert.ok(B.capex(p)<=cap+1e-8,"research and electricity share one style investment allowance");
   }
   for(const message of [{type:"econ",...answer.econPol},{type:"plan",rev:S.teams[id].rev+1,plan:p}]){
    const r=C.reduce(S,{team:id,token:"test-bot",...message},m,B);assert.ok(r.ok,r.err);
   }
  }
  const result=C.run(S,B,m);
  for(const id of ids)row.ren[id]+=result.team[id].renPct/12;
 }
 rows.push(row);
}
const rural=ids.reduce((a,b)=>D.start[a].groups.farm>D.start[b].groups.farm?a:b);
assert.ok(rows[0].ren[rural]>rows[1].ren[rural]&&rows[1].ren[rural]>rows[2].ren[rural],"G2 agricultural city renewable share: careful > balanced > bold, including research");
assert.ok(rows.some(r=>r.newStaff>0),"research investment actually exercised");
console.log("R2 AI",JSON.stringify(rows));
