"use strict";
// 실제 컴퓨터 도시: 건설뿐 아니라 AI 정책·연계선 요청까지 같은 호스트에 적용한다.
// G5_AI_BASELINE=8d3fc8f 로 읽기 전용 Git 기준선 재현 가능. 작업 트리는 바꾸지 않는다.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../../..'), baseline = process.env.G5_AI_BASELINE;
const ctx = vm.createContext({ console, document: { documentElement: {} }, KCP: { route() {}, on() {}, esc: x => x } }); ctx.window = ctx;
vm.runInContext('Math.random=()=>{throw Error("unseeded random")}', ctx);
for (const name of ['build-maps','tech-data','build','econ-data','econ','league-data','league-core','league-ai']) {
  const file = `ui/${name}.js`;
  vm.runInContext(baseline ? execFileSync('git', ['show', `${baseline}:${file}`], { cwd: ROOT, encoding: 'utf8' }) : fs.readFileSync(path.join(ROOT,file),'utf8'), ctx);
}
const { leagueCore:C, leagueAI:AI, buildGame:B, econ:X } = ctx.KCP, R=C.regionOf('south'), ids=R.teams.map(t=>t.id);
const clone=x=>JSON.parse(JSON.stringify(x)), runs=[]; let checks=0;
for (const style of ['careful','balanced','bold']) {
  const S=C.newState('bots-strategy-common',R.id,0,ids,{turns:36}), hist=[], tieRequests=[];
  ids.forEach(id=>{ S.teams[id].token='g5-ai-token'; });
  for (let month=1;month<=36;month++) {
    C.host(S,'next',month*100000);
    const answers=Object.fromEntries(ids.map(id=>[id,AI.plan(S,R,id,B,style)]));
    for (const id of ids) {
      const a=answers[id], ask=msg=>C.reduce(S,{team:id,token:'g5-ai-token',...msg},month*100000+1,B);
      for (const msg of [{type:'econ',...a.econPol},{type:'plan',rev:S.teams[id].rev+1,plan:a.plan}]) {
        const result=ask(msg); assert.ok(result.ok,`${style}/${id}/${month}: ${JSON.stringify(result)}`); checks++;
      }
      // 제안·수락은 타 도시의 동시 계획 때문에 거부될 수 있다. 결과를 숨기지 않는다.
      for (const t of a.ties) tieRequests.push({month,id,request:t,result:ask({...t,type:'tie',op:t.type})});
    }
    const result=C.run(S,B,month*100000+50);
    for (const id of ids) {
      const f=result.econ.fiscal[id];
      assert.ok(Math.abs(f.cashBefore+f.revTotal-f.expTotal-f.cashAfter)<1e-6,'현금 항등식'); checks++;
      assert.ok(Math.abs(f.cashAfter-S.econ.cities[id].cash)<1e-6,'보고·상태 일치'); checks++;
    }
    hist.push(clone({month,fiscal:result.econ.fiscal,energy:result.team,cities:S.econ.cities,
      policies:Object.fromEntries(ids.map(id=>[id,answers[id].econPol]))}));
  }
  const final=hist.at(-1), over=ids.filter(id=>final.fiscal[id].debtOver);
  const maxUns=Math.max(...hist.flatMap(h=>ids.map(id=>h.energy[id].unsPct)));
  runs.push({style,hist,tieRequests,score:X.score(S.econ)});
  console.log('G5 AI',JSON.stringify({style,over,maxUns,cash:Object.fromEntries(ids.map(id=>[id,final.cities[id].cash]))}));
}
const out=process.env.G5_AI_OUT || '/tmp/g5-ai-debt.json';
fs.writeFileSync(out,JSON.stringify({baseline:baseline||'worktree',runs,checks},null,2));
console.log(`G5 AI pass ${checks} fail 0; ${out}`);
