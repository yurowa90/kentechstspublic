"use strict";
// B12 v1.9: 마지막 총점 반올림 전 값으로 판정. 학생 표시 점수는 그대로 둔다.
// leagueAI 기본 건설 계획 → 실제 호스트 econInput 월별 기록 → 정책만 교체.
// 에너지·사건·건설 입력은 동일하게 고정한다. 정책별 재투자 차이까지 포함하는 검사는 bots36.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const clone = x => JSON.parse(JSON.stringify(x));
function hostTape(overrides = {}) {
  const ctx = vm.createContext({ console, document: { documentElement: {} }, KCP: { route() {}, on() {}, esc: x => x } });
  ctx.window = ctx;
  vm.runInContext('Math.random = () => { throw Error("unseeded random"); };', ctx);
  for (const name of ['build-maps','tech-data','build','econ-data','econ','league-data','league-core','league-ai'])
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, `../../../ui/${name}.js`), 'utf8'), ctx);
  const {leagueCore:C,buildGame:B,leagueAI:AI,econ:X,ECON_DATA:D} = ctx.KCP;
  for(const [key,value] of Object.entries(overrides)) { assert.equal(D.params[key].grade,'G'); D.params[key].v=value; }
  const R=C.regionOf('south'), ids=R.teams.map(t=>t.id), seed='bots-strategy-common';
  const S=C.newState(seed,R.id,0,ids,{turns:36}), tape=[];
  ids.forEach(id=>{ S.teams[id].token='grid-test'; });
  let start, firstResults, firstState;
  const step=X.monthStep;
  X.monthStep=(E,inputs,...args)=>{ if(!start) start=clone(E); tape.push(clone(inputs)); return step(E,inputs,...args); };
  for(let m=1;m<=36;m++) {
    const at=m*100000; C.host(S,'next',at);
    const request=(id,msg)=>{ const r=C.reduce(S,{team:id,token:'grid-test',...msg},at+1,B); assert.ok(r.ok,JSON.stringify(r)); };
    ids.forEach(id=>request(id,{type:'econ',taxRes:0,taxInd:0,service:0,incentive:0}));
    const plans=Object.fromEntries(ids.map(id=>{const p=AI.plan(S,R,id,B,'balanced').plan;return [id,{builds:clone(p.builds),lines:clone(p.lines)}];}));
    ids.forEach(id=>request(id,{type:'plan',rev:S.teams[id].rev+1,plan:plans[id]}));
    const res=C.run(S,B,at+50);
    if(m===1) {firstResults=clone(res.team);firstState=clone(S);}
  }
  X.monthStep=step;
  assert.equal(tape.length,36);
  return {X,D,C,R,B,AI,ids,start,tape,seed,end:clone(S.econ),firstResults,firstState};
}
function replay(fixture,id,policy) {
  const {X,D,tape}=fixture; let E=clone(fixture.start); const reports=[];
  for(const raw of tape) {
    const inputs=clone(raw); if(id) inputs[id].policy={...inputs[id].policy,...policy};
    const r=X.monthStep(E,inputs,D); E=r.E; reports.push(r.report);
    for (const offer of r.report.offers || []) {
      if (r.report.t < offer.until - 1 || !offer.eval) continue;
      const best = offer.eval.rank.find(key => offer.eval.by[key]?.ok);
      if (best) { const accepted = X.acceptOffer(E, offer.id, best, D); if (accepted.ok) E = accepted.E; }
    }
  }
  const scored=X.score(E,D);
  return {E,reports,scored};
}
// 실제 score의 반올림된 부분점수·가중·하한으로 마지막 반올림 직전만 복원한다.
function preRound(scored, aggregation) {
  const {weights:w,floor}=aggregation;
  const raw=Math.max(0,Math.min(100,Math.exp(Object.keys(w).reduce((s,k)=>
    s+w[k]*Math.log(Math.max(floor,scored.parts[k])),0)/Object.values(w).reduce((a,b)=>a+b,0))))+scored.coop;
  assert.equal(Math.round(raw*10)/10,scored.score,'B12 반올림 전 값의 표시 점수 복원');
  return raw;
}
function topRows(rows, field='preRound') {
  const best=Math.max(...rows.map(r=>r[field]));
  // 허용 오차로 공동 1위 범위를 넓히지 않는다.
  return rows.filter(r=>r[field]===best);
}
function families(result) {
  return Object.fromEntries([-1,1].map(sign=>[sign<0?'down':'up',Object.values(result).filter(c=>c.top.some(r=>
    sign*r.taxRes>=0 && sign*r.taxInd>=0 && sign*(r.taxRes+r.taxInd)>0)).length]));
}
function grid(fixture=hostTape()) {
  const neutral=replay(fixture);
  for(const id of fixture.ids) for(const key of ['pop','ind','cash','approval'])
    assert.ok(Math.abs(neutral.E.cities[id][key]-fixture.end.cities[id][key])<1e-6, `호스트 입력 재생 정책0 일치: ${id}/${key}`);
  for (const id of fixture.ids) assert.ok(neutral.reports.every(r => !r.fiscal[id].debtOver),
    `G9 정책0 기본 계획 36달 모든 달 지방채 한도 내: ${id}`);
  if (process.env.G9_HOST_OUT) fs.writeFileSync(process.env.G9_HOST_OUT, JSON.stringify(fixture.ids.map(id => ({
    id, cash: neutral.E.cities[id].cash, debtCap: neutral.E.cities[id].debtCap,
    overMonths: neutral.reports.filter(r => r.fiscal[id].debtOver).length,
    minHeadroom: Math.min(...neutral.reports.map(r => r.fiscal[id].cashAfter + r.fiscal[id].debtCap))
  })), null, 2));
  const result={};
  for(const id of fixture.ids) {
    const rows=[];
    for(let taxRes=-2;taxRes<=2;taxRes++)for(let taxInd=-2;taxInd<=2;taxInd++)for(let service=-2;service<=2;service++) {
      const r=replay(fixture,id,{taxRes,taxInd,service});
      const scored=r.scored.by[id];
      rows.push({key:`${taxRes},${taxInd},${service}`,taxRes,taxInd,service,score:scored.score,
        preRound:preRound(scored,r.scored.aggregation),cash:r.E.cities[id].cash});
    }
    const ranked=rows.slice().sort((a,b)=>b.preRound-a.preRound);
    const gap=ranked[0].preRound-ranked[1].preRound;
    result[id]={top:topRows(rows),roundedTop:topRows(rows,'score'),gap,base:rows.find(r=>r.key==='0,0,0'),low:rows.find(r=>r.key==='-2,-2,2'),rows};
    console.log('B12 실제 호스트',id,JSON.stringify({...result[id],rows:undefined}));
  }
  const rounded=Object.fromEntries(Object.entries(result).map(([id,c])=>[id,{top:c.roundedTop}]));
  console.log('B12 반올림 전·후 집계',JSON.stringify({aiScoreValue:fixture.D.params.aiScoreValue.v,seed:fixture.seed,
    preRound:{families:families(result),axes:axes(result)},rounded:{families:families(rounded),axes:axes(rounded)}}));
  console.log('B12 1·2위 차 < 0.1점인 도시 목록(경합)',JSON.stringify(Object.entries(result).filter(([,c])=>c.gap<0.1)
    .map(([id,c])=>({id,gap:c.gap,top:c.top.map(r=>r.key),second:c.rows.slice().sort((a,b)=>b.preRound-a.preRound)[1]}))));
  return result;
}
function axes(result) {
  return Object.fromEntries(['taxRes','taxInd'].flatMap(axis => [-1,1].map(sign =>
    [`${axis}${sign < 0 ? 'Down' : 'Up'}`, Object.keys(result).filter(id => result[id].top.some(r => sign*r[axis]>0)).length])));
}
function check(result) {
  const ids=Object.keys(result), common=result[ids[0]].top.filter(r=>ids.every(id=>result[id].top.some(p=>p.key===r.key)));
  assert.ok(ids.length===6 && ids.every(id=>result[id].rows.length===125 && result[id].rows.every(r=>Number.isFinite(r.score)&&Number.isFinite(r.preRound))));
  for(const id of ids) assert.deepEqual(result[id].top,topRows(result[id].rows),'B12 반올림 전 완전 동일 점수만 공동1위: '+id);
  assert.equal(common.length,0,'B12 모든 도시 공통 1위 금지');
  const counts=axes(result); console.log('B12 세율 축별 1위 도시 수', JSON.stringify(counts));
  for(const [axis,count] of Object.entries(counts)) assert.ok(count<6, `B12 ${axis} 한 방향 6도시 독식 금지: ${count}`);
  for (const [family,count] of Object.entries(families(result))) assert.ok(count<=3,
    `B12 ${family==='down'?'감세':'증세'} 계열(두 세율 같은 방향·하나 이상 변경) 1위 ≤3: ${count}`);
}
module.exports={hostTape,replay,grid,check,axes,preRound,topRows,families};
if(require.main===module) {
  const result=grid();
  if(process.env.G4_GRID_OUT) fs.writeFileSync(process.env.G4_GRID_OUT,JSON.stringify(result,null,2));
  check(result); console.log('B12 host grid 750 combinations; fail 0');
}
