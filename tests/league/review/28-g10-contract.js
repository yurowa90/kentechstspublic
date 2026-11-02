"use strict";
// 은퇴(2026-10-10): G10(재보정 10차) 동안 범위 밖 파일이 바뀌지 않았는지 보던 차수 전용 가드다. 기준 커밋 cc8fd25.
// 이후 승인된 변경(2022 전선 D-68, H01·S8 대기 연결)으로 비교 대상 파일이 바뀌어 역할이 끝났다. 기대값을 바꿔 통과시키지 않는다.
// 기본 실행은 건너뛰고 0으로 끝난다. 당시 상태 재현은 KCP_RUN_RETIRED=1로 실행한다.
// 다음 재보정 차수가 생기면 그 차수 시작 커밋을 기준으로 새 가드 파일을 만든다.
if (require.main === module && !process.env.KCP_RUN_RETIRED) { console.log("은퇴, 건너뜀: G10(재보정 10차) 차수 전용 가드(기준 cc8fd25). KCP_RUN_RETIRED=1로 실행 가능"); process.exit(0); }
const fs = require('node:fs'), vm = require('node:vm'), cp = require('node:child_process');
const assert = require('node:assert/strict'), {axes, check} = require('./21-host-policy-grid');
let checks = 0;
const equal = (a,b,label) => { assert.deepEqual(a,b,label); checks++; };
const original = file => cp.execFileSync('git',['show',`cc8fd25:${file}`],{encoding:'utf8'});
function data(source) { const ctx=vm.createContext({KCP:{}}); ctx.window=ctx; vm.runInContext(source,ctx); return JSON.parse(JSON.stringify(ctx.KCP.ECON_DATA)); }
const before=data(original('ui/econ-data.js')), after=data(fs.readFileSync('ui/econ-data.js','utf8'));
for(const [key,entry] of Object.entries(before.params)) if(entry.grade!=='G') equal(after.params[key],entry,`근거 ${key} 불변`);
for(const key of Object.keys(before)) if(key!=='params') equal(after[key],before[key],`자료 ${key} 불변`);
// S4는 econ의 H01 변경을 승인했다. 점수 함수·공개 API는 여전히 바이트 보존.
const scoreSection = source => source.slice(source.indexOf('  /* ---------- 점수 · 순위 ---------- */'));
equal(scoreSection(fs.readFileSync('ui/econ.js','utf8')),scoreSection(original('ui/econ.js')),'H01과 별개인 점수식·공개 API 보존');
for(const file of ['ui/tech-data.js','ui/build.js','tests/league/recal.js'])
 equal(fs.readFileSync(file,'utf8'),original(file),`${file} 점수·근거·recal 바이트 불변`);
// 혼합 세율은 동방향 계열에는 없지만 한 축의 6도시 독식을 만들 수 있다.
const ids=['a','b','c','d','e','f'];
function fixture(top) {
 return Object.fromEntries(ids.map((id,i)=>[id,{top:top(i),rows:Array.from({length:125},()=>({score:1}))}]));
}
const mixed=fixture(i=>[{key:`2,-${i%2+1},${i}`,taxRes:2,taxInd:-(i%2+1)}]);
equal(axes(mixed),{taxResDown:0,taxResUp:6,taxIndDown:6,taxIndUp:0},'혼합 세율 축별 집계');
assert.throws(()=>check(mixed),/한 방향 6도시 독식 금지/); checks++;
// 공동 1위 양 방향을 모두 세고, 같은 도시의 같은 방향은 한 번만 센다.
const tied=fixture(i=>[{key:`${i}`,taxRes:i<3?1:-1,taxInd:i<3?-1:1},
 {key:`tie${i}`,taxRes:i<3?2:-2,taxInd:0}]);
equal(axes(tied),{taxResDown:3,taxResUp:3,taxIndDown:3,taxIndUp:3},'공동 1위 도시 중복 제거');
check(tied); checks++;
const both=fixture(i=>[{key:`up${i}`,taxRes:1,taxInd:0},{key:`down${i}`,taxRes:-1,taxInd:0}]);
equal(axes(both),{taxResDown:6,taxResUp:6,taxIndDown:0,taxIndUp:0},'공동 1위 양 방향 모두 집계');
assert.throws(()=>check(both),/한 방향 6도시 독식 금지/); checks++;
// 모든 후보 바이오매스 입지의 연료 조건이 같으면 입지 배수를 바꿔도 종류 선택은 같아야 한다.
// 과거 종류 간 socialCost 사용은 이 검사에서 탄소 0 설비 쏠림을 만든다.
const ctx=vm.createContext({console,document:{documentElement:{}},KCP:{route(){},on(){},esc:x=>x}}); ctx.window=ctx;
for(const name of ['build-maps','tech-data','build','econ-data','econ','league-data','league-core','league-ai']) {
 // G10_OLD_AI=1은 검사 민감도 진단이며 종류 격리 단언에서 실패해야 한다.
 const oldAI=process.env.G10_OLD_AI==='1' && name==='league-ai';
 if(oldAI)ctx.KCP.ECON_DATA.params.aiDebtRepair=before.params.aiDebtRepair;
 vm.runInContext(oldAI?original('ui/league-ai.js'):fs.readFileSync(`ui/${name}.js`,'utf8'),ctx);
}
const {leagueCore:C,buildGame:B,leagueAI:AI,ECON_DATA:D}=ctx.KCP, R=C.regionOf('south');
const select=B.selectPack;
B.selectPack=(...args)=>{const result=select(...args); B.TILES.forEach(t=>{t.livestock=true;}); return result;};
const state=C.newState('g10-site-isolation',R.id,0,R.teams.map(t=>t.id),{turns:36}); C.host(state,'next',1000);
const snapshot=JSON.stringify(state), plans=[];
for(const weight of [1,4,1000]) {
 D.params.aiLocalFuelWeight.v=weight;
 plans.push(JSON.stringify(AI.plan(state,R,'asan',B,'balanced').plan));
}
equal(plans[1],plans[0],'같은 입지 연료 조건: 가중 1/4 종류 비교 불변');
equal(plans[2],plans[0],'같은 입지 연료 조건: 가중 1/1000 종류 비교 불변');
equal(JSON.stringify(state),snapshot,'AI 예상 운전은 호스트 상태를 바꾸지 않음');
console.log(`G10 contract pass ${checks} fail 0`);
