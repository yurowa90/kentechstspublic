"use strict";
// 은퇴(2026-10-10): G9(재보정 9차) 동안 범위 밖 파일이 바뀌지 않았는지 보던 차수 전용 가드다. 기준 커밋 4aad101.
// 이후 승인된 변경(2022 전선 D-68, H01·S8 대기 연결)으로 비교 대상 파일이 바뀌어 역할이 끝났다. 기대값을 바꿔 통과시키지 않는다.
// 기본 실행은 건너뛰고 0으로 끝난다. 당시 상태 재현은 KCP_RUN_RETIRED=1로 실행한다.
// 다음 재보정 차수가 생기면 그 차수 시작 커밋을 기준으로 새 가드 파일을 만든다.
if (require.main === module && !process.env.KCP_RUN_RETIRED) { console.log("은퇴, 건너뜀: G9(재보정 9차) 차수 전용 가드(기준 4aad101). KCP_RUN_RETIRED=1로 실행 가능"); process.exit(0); }
// G9 보존 + S4 승인 H01 신규 근거 키. 기존 근거·기술·recal 보존은 유지.
const fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process'),assert=require('node:assert/strict');
const base='4aad101';
const original=file=>cp.execFileSync('git',['show',`${base}:${file}`],{encoding:'utf8'});
function load(source){const c=vm.createContext({KCP:{}});c.window=c;vm.runInContext(source,c);return c.KCP;}
const old=load(original('ui/econ-data.js')).ECON_DATA,now=load(fs.readFileSync('ui/econ-data.js','utf8')).ECON_DATA;
let checks=0;const equal=(a,b,label)=>{assert.equal(JSON.stringify(a),JSON.stringify(b),label);checks++;};
for(const [key,p] of Object.entries(old.params)) if(p.grade!=='G') equal(now.params[key],p,`O·P·M 자료 그대로 ${key}`);
const h01 = { airBase: 'G', airSlope: 'M', kPM: 'M', pmFuelW: 'M', airSpill: 'M', eduAir: 'G' };
for(const key of Object.keys(now.params)) if(!old.params[key]) equal(now.params[key].grade,h01[key] || 'G',`새 키 등급(H01 외 G) ${key}`);
for(const key of Object.keys(old)) if(!['params','normalStartPlans'].includes(key))equal(now[key],old[key],`도시·자료 ${key}`);
for(const id of Object.keys(old.normalStartPlans))equal(now.normalStartPlans[id].lines,old.normalStartPlans[id].lines,`시작 전선 배치 보존 ${id}`);
const a=load(original('ui/tech-data.js')).TECH_DATA,b=load(fs.readFileSync('ui/tech-data.js','utf8')).TECH_DATA;
for(const key of Object.keys(a.params)){
 const {note:oldNote,...oldValue}=a.params[key],{note:newNote,...newValue}=b.params[key];
 equal(newValue,oldValue,`기술 note 밖 불변 ${key}`);
}
for(const key of Object.keys(a))if(key!=='params')equal(b[key],a[key],`기술 구성 불변 ${key}`);
equal(fs.readFileSync('tests/league/recal.js','utf8'),original('tests/league/recal.js'),'recal.js 바이트 불변');
console.log(`G9 preservation pass ${checks} fail 0`);
