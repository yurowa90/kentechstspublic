"use strict";
const assert=require('node:assert/strict');
const {hostTape}=require('./21-host-policy-grid');
const {X,D,C,R,B,AI,ids,start,tape,firstResults,firstState}=hostTape();
const clone=x=>JSON.parse(JSON.stringify(x)),sum=xs=>xs.reduce((s,x)=>s+x,0);
let checks=0;
const near=(a,b,label,tol=1e-9)=>{assert.ok(Number.isFinite(a)&&Math.abs(a-b)<=tol,`${label}: ${a}/${b}`);checks++;};
const base=X.monthStep(start,tape[0],D), P=D.params;
const shocks=clone(tape[0]);
const wk=C.roundsOf(firstState)[0].mdays/7;
for(const id of ids) {
 const input=tape[0][id],f=base.report.fiscal[id],c=base.E.cities[id],share=input.energy.residentDemandShare;
 assert.ok(share>0 && share<1,'실제 호스트 주민·산업 수요 모두 존재');checks++;
 const expected=(f.rev.resTax+(c.subsidy-c.subsidyFixed)/12+share*f.rev.tariff-f.exp.service)/c.pop;
 near(f.perResidentNet,expected,'B14 주민 몫 전기 차익 포함');
 // 주민 몫만 0→1로 바꿔 차익의 부호·크기가 그대로 보고되는지 확인한다.
 const variants=[0,1].map(value=>{const ins=clone(tape[0]);ins[id].energy.residentDemandShare=value;return X.monthStep(start,ins,D);});
 near((variants[1].report.fiscal[id].perResidentNet-variants[0].report.fiscal[id].perResidentNet)*c.pop,f.rev.tariff,'B14 차익 배분 부호',1e-7);
 const r=clone(firstResults[id]);r.cost.fuel*=1.5;r.exportFuel*=1.5;
 shocks[id]=C.econInput(firstState,R,id,r,wk);
}
const shock=X.monthStep(start,shocks,D);
// 도시별 시작 탄소집약도가 서로 달라도 첫 달 무공급으로 바뀌지 않는다.
const initialInputs=clone(tape[0]);
ids.forEach((id,i)=>{initialInputs[id].energy.unsPct=0;initialInputs[id].energy.servedMWh=100;initialInputs[id].energy.co2=50+6*i;});
const carbonStart=X.calibrate(X.initCities(ids,D),initialInputs,D),empty=clone(initialInputs);
ids.forEach(id=>{empty[id].energy.servedMWh=0;empty[id].energy.unsPct=100;empty[id].energy.co2=0;});
for(const previous of [null,.1,.9]) {
 const E=clone(carbonStart); ids.forEach(id=>{if(previous===null)delete E.cities[id].co2Intensity;else E.cities[id].co2Intensity=previous;});
 const zero=X.monthStep(E,empty,D);
 for(const id of ids){near(zero.E.cities[id].co2Intensity,previous ?? carbonStart.cities[id].co2Intensity0,'F19 공급0 직전 탄소 보존');near(X.score(zero.E,D).by[id].parts.co2,X.score(E,D).by[id].parts.co2,'F19 공급0 탄소점수 변화 없음');}
}
const speeds=C.publicView(firstState,0).econ.speeds;
for(const key of ['eduSpeed','eduMemory','reviewEvery','eduCbam','eduConn','eduCurtail','hazardFreq'])near(speeds[key],P[key].v,'공개 배속 '+key);
near(speeds.smrConstruction,P.eduSpeed.v,'SMR 동일 시간 압축');near(speeds.smrTurns,Math.round(55/P.eduSpeed.v),'SMR 현실55개월 환산');
assert.equal(speeds.items.length,14);checks++;
// F37: 공통 지지율 하락은 상쇄하고 자기 도시만의 하락에는 대응한다.
const response=common=>{
 const S=clone(firstState);S.phase='plan';S.round=2;
 for(const id of ids){S.econ.cities[id].cash=10000;S.econ.cities[id].approval=S.econ.cities[id].approval0-(common||id===ids[0]?12:0);}
 return AI.plan(S,R,ids[0],B,{...AI.STYLES.balanced,invest:0}).econPol;
};
near(response(true).taxRes,0,'F37 공통 하락 상쇄');near(response(false).taxRes,-1,'F37 상대 하락에 감세 대응');
// F24: .92를 코드 상수로 되살리는 회귀 방지.
const tariff=R.events.find(e=>e.id==='regional_tariff'),old=tariff.effect.industryPriceMul;
try {
 tariff.effect.industryPriceMul=.83;
 const S=clone(firstState);S.events=[{id:'regional_tariff',round:S.round}];
 const id=ids.find(id=>C.teamDef(R,id).prov==='충남');
 near(C.econInput(S,R,id,firstResults[id],wk).energy.priceMul,.83,'F24 자료 효과값 변경 반영');
} finally {tariff.effect.industryPriceMul=old;}
const field=sum(ids.map(id=>base.report.fiscal[id].perResidentNet*base.E.cities[id].pop))/sum(ids.map(id=>base.E.cities[id].pop))*1e8;
console.log('G4 실제 호스트 첫달',JSON.stringify({perResidentNetWon:field,residentDemandShares:Object.fromEntries(ids.map(id=>[id,tape[0][id].energy.residentDemandShare])),fuelShockCashEok:sum(ids.map(id=>shock.E.cities[id].cash-base.E.cities[id].cash)),startCarbon:Object.fromEntries(ids.map(id=>[id,start.cities[id].co2Intensity0]))}));
console.log(`G4 contract pass ${checks} fail 0`);
