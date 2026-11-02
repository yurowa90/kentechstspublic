'use strict';
// 학생 점수와 다른 탄소식, 민원 무시, 예상 상태의 원본 오염을 잡는다.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ctx = vm.createContext({ console, document: { documentElement: {} }, KCP: { route() {}, on() {} } });
ctx.window = ctx;
vm.runInContext('Math.random=()=>{throw Error("hidden random")}', ctx);
for (const n of ['build-maps','tech-data','build','econ-data','econ','league-data','league-core','league-ai'])
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, `../../../ui/${n}.js`), 'utf8'), ctx);
const {econ:X, ECON_DATA:D, leagueCore:C, leagueAI:AI, buildGame:B} = ctx.KCP;
const R=C.regionOf('south'), ids=R.teams.map(t=>t.id);
const S=C.newState('d87-score',R.id,0,ids,{turns:36});
assert.equal(typeof X.projectEnergyScore, 'function', '점수 예측 경로 필요');
const before=JSON.stringify(S), e={demMWh:100,servedMWh:100,co2:82,cpList:[]};
const dirty=X.projectEnergyScore(S.econ,'hwaseong',e,36);
const clean=X.projectEnergyScore(S.econ,'hwaseong',{...e,co2:37},36);
const near=X.projectEnergyScore(S.econ,'hwaseong',{...e,co2:37,cpList:[{kind:'siting',score:20}]},36);
assert.ok(clean.parts.co2>dirty.parts.co2 && clean.score>dirty.score, '같은 공급의 LNG 탄소 점수가 석탄보다 높음');
assert.ok(near.parts.appr<clean.parts.appr && near.score<clean.score, '입지 민원이 지지와 총점을 낮춤');
assert.deepEqual(X.projectEnergyScore(S.econ,'hwaseong',e,0),X.score(S.econ).by.hwaseong,'0달은 현 점수');
assert.equal(JSON.stringify(S),before,'예측은 원본 불변');
const noSupply=X.projectEnergyScore(S.econ,'hwaseong',{...e,demMWh:0,servedMWh:0,co2:999},36);
assert.equal(noSupply.parts.co2,X.score(S.econ).by.hwaseong.parts.co2,'공급0은 이전 탄소집약도 보존');
const capped=X.projectEnergyScore(S.econ,'hwaseong',{...e,co2:37,cpList:[{kind:'siting',score:200}]},36);
assert.equal(capped.parts.appr,near.parts.appr,'민원 상한 20 이후 추가 감점 없음');
for(const kind of ['noise','view','smoke','forest']) {
  const complained=X.projectEnergyScore(S.econ,'hwaseong',{...e,co2:37,cpList:[{kind,score:20}]},36);
  assert.ok(complained.parts.appr<clean.parts.appr,`${kind} 기존 민원도 지지에 반영`);
}

// 손계산: 1시간 수요100/부족20, gridImportShare 한도만큼 보충.
const sim={H:1,dem:[100],uns:[20],k:{dem:100,uns:20,co2:8},cpList:[]};
const energy=C.planningEnergy(sim), fill=Math.min(20,100*D.params.gridImportShare.v);
assert.equal(energy.servedMWh,80+fill);
assert.equal(energy.co2,8+fill*D.params.normalCo2.v,'소비CO2에 계통 보충 포함');
assert.equal(sim.uns[0],20,'보충 예측 원본 불변');
C.host(S,'next',1000);
const state=JSON.stringify(S);
D.params.aiScoreValue.v=0;
const zero=AI.plan(S,R,'hwaseong',B,'balanced');
D.params.aiScoreValue.v=30;
const positive=AI.plan(S,R,'hwaseong',B,'balanced');
const count=(p,t)=>p.plan.builds.filter(b=>b.t===t).length;
assert.ok(count(positive,'coal')<count(zero,'coal'),'점수 비용이 실제 석탄 선택을 줄임');
assert.equal(JSON.stringify(S),state,'계획은 원본 불변');
const hidden=JSON.parse(state); hidden.events=[{id:'coal_phaseout',round:1}]; hidden.salt=98765;
assert.deepEqual(AI.plan(hidden,R,'hwaseong',B,'balanced'),positive,'숨은 사건·난수 무관');
console.log('PASS D87 score: carbon, complaints, grid consumption, zero horizon, immutable, selection, hidden events');
