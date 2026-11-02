'use strict';
// rev14 M1 §1·2: 원 Δ 반올림이 목표. ui 함수·표시 맵을 읽지 않는다.
module.exports = function displayContract(a) {
  const digits=a.target==='grid'?1:2, scale=10**digits;
  const parts=[...a.parts];
  if(!a.replayOutsideSum && Number.isFinite(a.replay) && Math.abs(a.replay)>=(digits===1?.05:.005))
    parts.push({key:'replay',value:a.replay});
  const start=a.trial??a.base;
  if(!parts.length||![start,a.actual,...parts.map(p=>p.value)].every(Number.isFinite)) return new Map();
  const target=Math.round((Number(a.total.toFixed(digits))+0)*scale);
  const ticks=parts.map(p=>Math.floor(p.value*scale)), left=target-ticks.reduce((s,x)=>s+x,0);
  // rev10 검토 M1(총괄 수정): 음수 나머지는 내림 아래로 깎지 않고 각자 반올림(빈 Map).
  if(left<0||left>parts.length) return new Map();
  const order=parts.map((p,i)=>({i,r:p.value*scale-ticks[i]})).sort((a,b)=>b.r-a.r||a.i-b.i);
  for(const {i} of order.slice(0,left)) ticks[i]+=1;
  const out=new Map(parts.map((p,i)=>[p.key,ticks[i]/scale||0]));
  const max=Math.max(...a.parts.map(p=>Math.abs(p.value)));
  const minimum=a.target==='grid'?Math.max(Math.max(.05,.05*Math.abs(start))/10,.05):.05;
  const threshold=Math.max(minimum,.05*Math.abs(a.total??a.actual-start));
  const tied=a.parts.filter(p=>Math.abs(p.value)>=threshold&&
    Math.abs(Number(p.value.toFixed(digits)))===Number(max.toFixed(digits))).map(p=>p.key);
  if(tied.length) {
    const largest=Math.abs(out.get(tied[0]));
    if(parts.some(p=>tied.includes(p.key)?Math.abs(out.get(p.key))!==largest:Math.abs(out.get(p.key))>=largest)) return new Map();
  }
  return out;
};
