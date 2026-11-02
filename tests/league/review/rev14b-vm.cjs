'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {performance}=require('node:perf_hooks');
const ROOT=path.resolve(__dirname,'../../..');
const read=name=>fs.readFileSync(path.join(ROOT,`ui/${name}.js`),'utf8');
// 기존 비공개 소비 함수의 호출 연결만 메모리에 노출한다. 배분/판정 본문은 읽거나 변경하지 않는다.
function load(leagueSource=read('league')) {
  const store=new Map(),storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
  const ctx=vm.createContext({console,performance,structuredClone,URL,
    document:{documentElement:{},addEventListener(){},getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]},
    addEventListener(){},setTimeout(){return 0;},clearTimeout(){},requestAnimationFrame(){},
    localStorage:storage,sessionStorage:storage,matchMedia:()=>({matches:false,addEventListener(){}}),
    KCP:{route(){},on(){},esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),gradeWords:String,leagueNet:{expandSnapshot:x=>x}}});
  ctx.window=ctx;
  for(const name of ['build-maps','tech-data','build','econ-data','econ','league-data','league-core','league','fx-end']) {
    let src=name==='league'?leagueSource:read(name);
    if(name==='league') {
      const end=src.lastIndexOf('})();');
      if(end<0)throw Error('BLOCKED VM IIFE 연결점 없음');
      const names=['outageReplayShown','outageShareThresholdText','gridReliance','promiseGridReliance','gridDeltaText','promiseVerdictText','missedText','missedCarryHTML','evCards','eventText','trialGoals','bindInfoTips'];
      src=src.slice(0,end)+'\nglobalThis.__rev14b={'+names.map(n=>`${n}:typeof ${n}==='function'?${n}:undefined`).join(',')+',bind:value=>{L=value;}};\n'+src.slice(end);
    }
    vm.runInContext(src,ctx,{filename:`ui/${name}.js`,timeout:10000});
  }
  const session={role:'solo',room:'REV14B',team:'pyeongtaek',rev:0,interview:{months:{}},outCache:{},outFailures:{}};
  ctx.__rev14b.bind(session);
  const L=Object.assign({},ctx.__rev14b,ctx.KCP.league.uiMath,ctx.KCP.league);
  const need=name=>{if(typeof L[name]!=='function')throw Error(`BLOCKED 함수 없음: ${name}`);return L[name];};
  return {ctx,L,need,store,session};
}
module.exports={load,read,ROOT};
