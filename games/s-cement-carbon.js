(function () {
  const KCP = window.KCP;
  const esc = KCP.esc;
  const ID = "s-cement-carbon";
  const EPS = 1e-12;
  const FUT = {smooth:{supply:.45,uptime:.9,grid:.15,elecMax:.3,leak:.00001},scarce:{supply:.15,uptime:.9,grid:.25,elecMax:.3,leak:.00005},delay:{supply:.35,uptime:.6,grid:.35,elecMax:.1,leak:.0005}};
  const FN = {smooth:"순조로운 전환",scarce:"원료 부족",delay:"기술 지연"};
  const BASE = 2*.8*.65*44/56+2*.8*3.4*.095;
  const DEFAULT = {d:0,c:80,bio:0,elec:0,capture:0,mineral:0,syn:0,acct:0,support:false};
  const seq = (start, end, step) => Array.from({length:(end-start)/step+1}, (_,i) => start+i*step);
  const VALUES = {d:seq(0,30,5),c:seq(50,80,5),bio:seq(0,40,10),elec:seq(0,30,10),capture:[0,30,60,90],mineral:seq(0,100,10),syn:seq(0,100,10),acct:[0,50,100]};
  const CRITERIA = {sure:"확실한 감축",local:"일자리·지역 경제",price:"가격 부담",risk:"기술 위험 분산",honest:"장부와 실제의 일치"};
  const CRIT_DESC = ["장부상 감축률과 물리적 대기 배출을 함께 확인하고, 조건이 달라져도 배출을 줄일 근거를 찾습니다.","생산과 지역의 생활 기반, 일을 바꿔야 하는 사람의 비용을 무겁게 봅니다.","시멘트 가격에 더해지는 부담과 그 비용을 나눌 방법을 무겁게 봅니다.","원료나 한 설비에 대한 의존을 줄이고, 예상과 다를 때 바꿀 방법을 마련합니다.","장부에 기록되는 변화와 대기로 가는 탄소의 차이를 드러내는 규칙을 무겁게 봅니다."];
  const plain = v => v !== null && typeof v === "object" && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
  const clone = v => JSON.parse(JSON.stringify(v));
  const validPlan = p => plain(p) && Object.keys(VALUES).every(k => typeof p[k] === "number" && VALUES[k].includes(p[k])) && typeof p.support === "boolean" && p.mineral+p.syn<=100;
  function planOf(raw) {
    const p = plain(raw) ? raw : {};
    const out = {...DEFAULT};
    Object.keys(VALUES).forEach(k => { if (typeof p[k] === "number" && VALUES[k].includes(p[k])) out[k] = p[k]; });
    if (typeof p.support === "boolean") out.support = p.support;
    if (out.mineral+out.syn>100) out.mineral = out.syn = 0;
    return out;
  }
  const validCriteria = c => Array.isArray(c) && c.length===2 && c.every(k => typeof k==="string" && Object.hasOwn(CRITERIA,k)) && c[0]!==c[1];
  const validPrediction = p => plain(p) && ["reach","below"].includes(p.value) && validPlan(p.plan);
  const predictionOf = p => validPrediction(p) ? {value:p.value,plan:planOf(p.plan)} : null;
  const validLocked = L => plain(L) && L.version===1 && validPlan(L.plan) && validCriteria(L.criteria) && validPrediction(L.prediction) && typeof L.revisited==="boolean" && typeof L.oneLine==="string" && L.oneLine.length<=300 && L.oneLine.trim().length>0;
  const snapshot = L => ({version:1,plan:planOf(L.plan),criteria:L.criteria.slice(),prediction:predictionOf(L.prediction),oneLine:L.oneLine,revisited:L.revisited});
  function fresh() {
    return {version:1,plan:{...DEFAULT},step:1,fut:"smooth",dataTab:"baseline",criteria:["",""],predictDraft:"",prediction:null,revisited:false,oneLine:"",locked:null};
  }
  function normalized(raw) {
    if (!plain(raw) || raw.version!==1) return fresh();
    const g = fresh();
    g.plan = planOf(raw.plan);
    if (Array.isArray(raw.criteria) && raw.criteria.length===2 && raw.criteria.every(k => typeof k==="string" && (k==="" || Object.hasOwn(CRITERIA,k))) && (!raw.criteria[0] || raw.criteria[0]!==raw.criteria[1])) g.criteria = raw.criteria.slice();
    g.predictDraft = ["reach","below"].includes(raw.predictDraft) ? raw.predictDraft : "";
    g.prediction = predictionOf(raw.prediction);
    g.revisited = typeof raw.revisited==="boolean" ? raw.revisited : false;
    g.oneLine = typeof raw.oneLine==="string" ? raw.oneLine.slice(0,300) : "";
    g.step = raw.step===2 && g.prediction ? 2 : 1;
    g.fut = g.step===2 && typeof raw.fut==="string" && Object.hasOwn(FUT,raw.fut) ? raw.fut : "smooth";
    if (["baseline","tech","people","rubric"].includes(raw.dataTab)) g.dataTab=raw.dataTab;
    if (validLocked(raw.locked)) {
      g.locked = snapshot(raw.locked);
      Object.assign(g,{plan:clone(g.locked.plan),criteria:g.locked.criteria.slice(),prediction:clone(g.locked.prediction),oneLine:g.locked.oneLine,revisited:g.locked.revisited,step:2,predictDraft:g.locked.prediction.value});
      g.fut = typeof raw.fut==="string" && Object.hasOwn(FUT,raw.fut) ? raw.fut : "smooth";
    }
    return g;
  }
  function normalize(state) {
    const clean = normalized(state.game);
    // 질문 조회 뒤에도 준비실 이벤트가 같은 저장 객체를 갱신하도록 참조를 유지한다.
    if (plain(state.game)) {
      Object.keys(state.game).forEach(k => { delete state.game[k]; });
      Object.assign(state.game,clean);
    } else state.game = clean;
    return state.game;
  }
  function calc(raw, fid) {
    const p=planOf(raw), f=FUT[typeof fid==="string" && Object.hasOwn(FUT,fid)?fid:"smooth"],d=p.d/100,c=p.c/100,b=p.bio/100,ePlan=p.elec/100,r=p.capture/100*f.uptime;
    const P=2*(1-d),need=P*(1-c),scm=Math.min(need,f.supply),clay=Math.min(Math.max(0,need-scm),.35),K=P-scm-clay,cActual=K/P;
    const e=Math.min(ePlan,f.elecMax),coalShare=1-b-e,H=K*3.4,process=K*.65*44/56,coal=(H*coalShare+clay*2)*.095,bio=H*b*.085,G0=process+coal+bio,Hw=K*.8;
    const X=Math.max(0,.056*(r*G0*3-Hw)/(1-r*3*.056)),G=G0+X,C=r*G,stack=G-C;
    const mineral=Math.min(C*p.mineral/100,.1),overflow=Math.max(0,C*p.mineral/100-.1),syn=C*p.syn/100,store=C*(100-p.mineral-p.syn)/100+overflow,leak=store*f.leak,retained=store-leak;
    const h2=syn*6/44,heatPower=H*e/3.6,compressPower=C*.1,h2Power=h2*55,basePower=P*.1,power=heatPower+compressPower+h2Power+basePower,extra=power-.2,indirect=power*f.grid;
    const bioCredit=bio*.5*(1-r),ledger=stack-bioCredit+syn*(1-p.acct/100),reduction=100*(1-ledger/BASE),gap=reduction-60,physical=stack+syn+leak;
    const supportCost=p.support?4*P:0,price=(30*C+8*store+10*mineral+40*syn+10*clay-3*scm+.3*H*b+12*heatPower+supportCost)/P+.6;
    const carbonIn=G*12/44,carbonOut=(physical+mineral+retained)*12/44,balance=carbonIn-carbonOut;
    // 명세 5.4(10)·12.4: 반올림 전 탄소 수지 오류는 개발 assert로만 검출한다.
    // 학생 화면의 선택 오류나 12자리 오차 표시로 바꾸지 않는다.
    if (Math.abs(balance)>1e-9) throw new Error("Carbon balance assertion failed");
    return {P,need,scm,clay,K,cActual,e,coalShare,H,process,coal,bio,G0,Hw,r,X,G,C,stack,mineral,overflow,syn,store,leak,retained,h2,heatPower,compressPower,h2Power,basePower,power,extra,indirect,bioCredit,ledger,reduction,gap,physical,supportCost,price,carbonIn,carbonOut,balance,warnC:cActual>c+EPS,warnE:e<ePlan-EPS};
  }
  const reaches = r => r.reduction >= 60-EPS;
  const fmt = (x,n) => (Math.abs(x)<.5*10**(-n)?0:x).toFixed(n);
  // 학생 화면의 음수 기호는 모두 수학 기호 −(U+2212)로 맞춘다.
  const minus = t => t.replace("-","−");
  const signed = (x,n) => minus((x>0 && Math.abs(x)>=.5*10**(-n)?"+":"")+fmt(x,n));
  const fmtRed = x => minus(x>=59.95 && x<60-EPS ? (Math.floor(x*100)/100).toFixed(2) : fmt(x,1));
  const fmtGap = g => minus((g>-.05 && g<-EPS)?(Math.floor(g*100)/100).toFixed(2):signed(g,1));
  function captureParts(p) {
    const on=calc(p,"smooth"),off=calc({...planOf(p),capture:0},"smooth");
    return {delta:off.ledger-on.ledger,total:BASE-on.ledger};
  }
  function captureShare(p) {
    const {delta,total}=captureParts(p);
    return total>EPS ? 100*delta/total : null;
  }
  // 포집이 장부 배출을 늘리거나 기준 대비 감소가 아주 작으면 비율 대신 사실을 적는다.
  function captureShareText(p) {
    const {delta,total}=captureParts(p);
    if(delta<-EPS) return `포집이 장부 배출을 ${fmt(-delta,3)} Mt/년 늘림(포집만 끈 같은 계획 대비)`;
    if(total<=EPS) return "계산하지 않음: 기준 대비 장부 배출 감소 없음";
    if(total<.01) return "계산하지 않음: 기준 대비 감소가 너무 작음";
    return fmt(100*delta/total,1)+"%";
  }
  // 물리적 대기 배출의 현재 대비 변화와 전력 간접 배출을 더한 값을 함께 보인다.
  // 현재의 전력 배출 계수는 정하지 않았으므로 간접 배출 포함 합계는 현재와 비교하지 않는다.
  function physicalLine(r) {
    const diff=r.physical-BASE,rise=diff>=.0005,flip=rise && r.reduction>0;
    return `현재 ${fmt(BASE,3)} 대비 ${signed(diff,3)} Mt/년${flip?" · 장부상 감축과 달리 실제 대기 배출은 늘어남":rise?" · 현재보다 늘어남":""} · 전력 간접 배출을 더하면 ${fmt(r.physical+r.indirect,3)} Mt/년`;
  }
  KCP.ORIGINAL_ORDER = KCP.ORIGINAL_ORDER || [];
  KCP.YEARS[ID] = {
    title:"시멘트 공장의 탄소 장부",desc:"탄소 흐름의 밸브를 조절하고, 세 미래에서 장부상 감축률과 물리적 대기 배출을 비교합니다.",format:"탄소 흐름 설계",prep:25,answer:15,mode:"창작 · 탄소 흐름 밸브 조절과 세 미래 비교",original:true,
    topics:["에너지·환경·기후","탄소 포집","산업 전환"],concepts:["탄산칼슘의 열분해","화학 반응식과 양적 관계","몰 질량비","질량 보존","에너지 전환","탄소 순환","지중 저장과 광물 탄산화","자료 해석과 의사결정"],
    rubric:{
      "발산적 사고력":["시멘트를 덜 쓰면서 건물의 기능을 유지하는 서로 다른 방법을 제안했는가.","미래 조건이 바뀔 때 계획을 수정할 방법이나 조건부 약속을 제안했는가.","재탄산화처럼 모형 밖의 현상을 새로운 장부 규칙이나 검증 방법으로 연결했는가."],
      "문제해결 능력":["공정 배출의 화학적 원인과 탄소 보존을 식이나 수치로 설명했는가.","세 미래의 계산 결과와 모형의 한계를 구분하여 근거로 사용했는가.","먼저 밝힌 기준의 우선순위와 선택이 일치하는지 점검했는가."],
      "인문적 통찰 역량":["노동자·주민·어민 등 전환 비용을 지는 사람에게 구체적인 대책을 제안했는가.","반문을 듣고 계획을 고치거나 유지하는 이유에 얻는 것과 잃는 것을 함께 담았는가.","장부상 감축률과 물리적 대기 배출의 차이를 숨기지 않고 설명했는가."]
    },
    intent:["화학 반응식이 연료 전환만으로 줄일 수 없는 배출을 설명하게 한다.","탄소 흐름의 보존과 장부 규칙의 차이를 조작으로 확인하게 한다.","기준을 먼저 정하고 세 미래의 수치로 계획을 검토하게 한다.","전환 비용을 지는 사람을 짚고, 얻는 것과 잃는 것을 함께 말하게 한다.","반문 이후의 수정과 조건부 약속에 필요한 제도를 생각하게 한다."]
  };
  const BRIEF = `<div class="scenario">
  <p class="label">상황과 역할</p>
  <p>가상 산업도시 Y의 시멘트 공장은 현재 해마다 시멘트 200만 t을 만듭니다. 공장과 광산은 지역의 일자리와 세수에서 큰 몫을 차지합니다. 가상 정부는 2040년까지 공장 직접 배출의 장부값을 현재보다 60% 줄이라는 목표를 제시했습니다. 협의회는 그 목표를 어떤 장부 규칙으로 확인할지도 검토합니다.</p>
  <p>당신은 공장·노조·주민·지자체가 함께 만든 전환 협의회의 기술 위원입니다. 감축 계획을 만들고, 서로 다른 세 미래에서 계획이 어떻게 달라지는지 설명하세요.</p>
  <ul class="rules">
    <li>단순화한 모형입니다. 2040년의 1년 운영을 비교하며, 세 미래에 확률을 붙이지 않습니다.</li>
    <li>먼저 수요 감축, 클링커 비율, 연료 혼합, 포집률을 정합니다. 1단계를 확정하면 포집한 탄소의 행선지, 장부 규칙, 전환 지원을 정할 수 있습니다.</li>
    <li>합성연료는 그해 모두 사용되어 탄소가 대기로 돌아온다고 가정합니다. 폐기물·바이오 혼합연료 탄소의 절반을 생물 기원으로 보고 굴뚝으로 나간 그 몫을 장부에서 빼더라도, 실제 굴뚝 배출이 사라지는 것은 아닙니다.</li>
    <li>장부상 감축률과 물리적 대기 배출을 함께 보세요. 전력 생산의 간접 배출은 별도로 표시합니다. 종합 점수나 하나의 정답은 없습니다.</li>
    <li>계획은 확정 후에도 ‘다시 계획하기’로 고칠 수 있습니다. 자료에 없는 대안은 과학적 근거와 가정을 구분하여 제안해도 됩니다.</li>
  </ul>
</div>
<div class="task">
  <b>준비할 답</b>
  <ol>
    <li>첫째·둘째 기준을 정하고 네 밸브를 조절하세요. 기술 지연 미래에서 장부상 감축률이 60%에 이를지 먼저 예측하세요.</li>
    <li>포집한 탄소의 행선지와 장부 규칙을 정하고 세 미래를 비교하세요. 목표 대비 차이와 비용을 지는 사람을 확인하세요.</li>
    <li>“나는 ○○을 더 무겁게 보아 이 계획을 골랐다. ○○을 얻지만 ○○을 잃는다.”를 참고하여 한 문장으로 정리하세요.</li>
    <li>반문을 들으면 계획을 고치거나 유지하는 이유와 추가로 확인할 자료를 말하세요.</li>
  </ol>
</div>`;
  const TECH = {
    "수요 감축":"건물의 기능과 안전을 유지하면서 시멘트를 덜 쓰는 계획입니다. 줄인 물량을 수입으로 대체하지 않는다고 가정합니다.",
    "클링커 비율":"클링커 일부를 기존 혼합재와 소성 점토로 바꿉니다. 기존 혼합재부터 쓰고 부족분을 점토로 채웁니다. 점토는 해마다 최대 0.350 Mt까지 소성합니다. 그래도 부족하면 실제 클링커 비율이 올라갑니다.",
    "공정 배출":"CaCO₃ → CaO + CO₂. 클링커의 CaO 질량 비율을 65%로 두며, 그 CaO는 모두 탄산칼슘에서 온다고 가정합니다. 탄산칼슘 100, CaO 56, CO₂ 44의 몰 질량은 학습용으로 반올림한 실제 화학량론입니다.",
    "연료 혼합":"비율은 가마에 공급하는 열을 기준으로 합니다. 폐기물·바이오와 전기를 늘리면 석탄 몫이 줄어듭니다. 점토 소성 열은 별도의 석탄으로 공급합니다.",
    "폐기물·바이오":"이 혼합연료의 물리 배출 계수는 0.085 t CO₂/GJ로 정했습니다. 생물 기원 탄소 비율 50%는 탄소 기준이며, 열 비율이 아닙니다. 생물 기원 탄소를 배출로 세지 않는 것은 장부 처리 규칙입니다. 물리적 대기 배출에는 포함합니다. 나머지 50%는 플라스틱 같은 화석 기원 탄소이며, 석탄과 똑같이 장부에 셉니다. 이 혼합연료의 계수가 석탄보다 조금 낮은 것은 수소가 많은 폐플라스틱이 섞였다고 가정했기 때문입니다. 목재 같은 순수 바이오매스는 같은 열을 낼 때 석탄보다 CO₂를 더 많이 내기도 합니다.",
    "전기 가열":"가마의 전기 가열 효율을 100%로 가정합니다. 미래의 상한을 넘는 계획분은 석탄으로 채웁니다. 전력 생산의 배출은 공장 밖 간접 배출로 따로 표시합니다.",
    "포집":"선택 포집률에 설비 가동률을 곱한 값이 1년 평균 실효 포집률입니다. 공정·가마 연료·점토 소성·포집열용 가스의 CO₂를 같은 실효 비율로 포집한다고 가정합니다.",
    "포집 에너지":"포집한 CO₂ 1 t마다 재생 열 3.0 GJ가 필요합니다. 가마 폐열을 먼저 쓰고, 부족한 열은 가스로 공급합니다. 가스가 내는 CO₂ 일부도 다시 포집하므로 추가 열을 함께 계산합니다.",
    "지중 저장":"CO₂를 암석의 공극에 넣고 덮개암으로 이동을 막습니다. 이 모형은 올해 보낸 물량의 첫 1년 누출만 계산합니다. 이전 연도에 저장한 탄소의 재고는 다루지 않습니다.",
    "광물화":"탄소를 탄산염 고체로 고정합니다. 해마다 CO₂ 0.100 Mt까지 처리하며, 넘친 물량은 지중 저장으로 보냅니다. 반응 원료는 새로 석회석을 태워 만든 생석회가 아닌 잔여 반응성 물질로 가정합니다.",
    "합성연료":"여기서는 메탄올을 만듭니다. CO₂ + 3H₂ → CH₃OH + H₂O. CO₂ 44 t마다 H₂ 6 t이 필요하며, 수소 1 t 생산에 전력 55 MWh를 씁니다. 선택한 CO₂는 모두 전환되고 그해 연료로 쓰여 대기로 돌아옵니다.",
    "장부 규칙":"합성연료 탄소를 감축으로 인정하는 비율을 0%, 50%, 100% 중 고릅니다. 인정 비율을 바꿔도 탄소 흐름과 전력은 바뀌지 않습니다. 실제 화석연료 대체 효과는 계산하지 않았습니다. 실제 EU 배출권거래제는 포집한 탄소가 제품에 영구히 화학적으로 결합되어 사용·폐기 뒤에도 대기로 나가지 않을 때만 포집한 시설의 배출에서 빼 줍니다. 연료처럼 다시 배출되는 탄소는 포집한 시설의 배출로 그대로 셉니다. 따라서 50%·100% 인정은 토론을 위한 가상 규칙입니다.",
    "전환 지원":"재배치·교육과 훈련 중 소득 보완을 공동 기금으로 지원합니다. 켜면 가격 영향에 4.0%p가 더해집니다. 배출이나 고용 방향 표시는 바뀌지 않으며, 취업을 보장한다는 뜻도 아닙니다."
  };
  const PEOPLE = [
    ["공장 노동자와 노조","필요한 전환이라면 함께 준비하겠습니다. 생산이 줄 때 소득과 숙련을 잃는 사람에게 누가 교육 시간과 이동 비용을 보장합니까?"],
    ["경영진","설비 투자와 제품 가격을 함께 봐야 합니다. 포집 설비가 자주 멈추거나 제품 수요가 줄 때 비용을 누가 나눌지 정하고 싶습니다."],
    ["지자체","세수와 인구 변화는 학교와 생활 서비스에도 이어집니다. 새 일자리가 생기는 시점과 기존 일이 줄어드는 시점이 같다고 볼 수는 없습니다."],
    ["건설사와 주택 구입자","시멘트값이 오르면 공사비와 분양가가 얼마나 오를지, 그 부담을 누가 나눌지 알고 싶습니다. 건물의 안전과 수명도 함께 확인해 주세요."],
    ["점토 채굴 예정지 주민","대체 원료를 얻는 동안 토지와 경관이 바뀝니다. 채굴 범위, 복구 계획, 주민의 참여 방법을 먼저 공개해 주세요."],
    ["저장소 해역 어민","저장 자체뿐 아니라 파이프라인 경로와 공사 기간도 생업에 영향을 줍니다. 장기 감시와 사고 대응의 책임 주체를 정해 주세요."],
    ["연소 시설 인근 주민","폐기물·바이오 연료의 출처와 품질을 알고 싶습니다. CO₂가 줄어든다는 계산만으로 다른 대기오염물질도 줄었다고 할 수는 없습니다."],
    ["환경단체","포집이 화석연료 사용을 오래 유지하게 할 수 있다는 우려와, 남는 공정 배출을 다루는 수단이 필요하다는 의견이 함께 있습니다. 포집량과 실제 대기 배출을 따로 공개해 주세요."],
    ["가상 정부","목표 대비 차이와 장부 규칙의 근거를 공개해 주세요. 합성연료의 탄소를 공장과 사용자 모두가 자기 감축으로 세는 일은 피해야 합니다."],
    ["전력망 담당자","가마와 수소 생산에 쓰는 전력은 다른 부문의 전환과 연결됩니다. 공급을 늘리는 데 걸리는 시간과 비용도 논의해야 합니다."]
  ];
  const CONSTANTS = `<details class="reveal cc-constants"><summary>계산에 쓴 상수와 가정</summary>
    <p>실제 화학량론과 단위: CO₂/CaO 44/56 t/t · H₂/CO₂ 6/44 t/t · C/CO₂ 12/44 t/t. 반응식과 학습용 반올림 몰 질량에서 얻은 비입니다. 1 TWh=3.6 PJ는 단위 정의입니다.</p>
    <p>공개 기술 자료를 참고한 대표값: 가마 열 3.4 GJ/t 클링커 · 국제 에너지 기구 자료의 대표 수준. 석탄 0.095·가스 0.056 t CO₂/GJ · 국제 온실가스 산정 지침 기본값을 반올림한 순발열량 기준. 수소 55 MWh/t H₂ · 현재 물 전기분해 설비 수준. 압축 0.1 MWh/t CO₂ · 공개 시험 평가의 규모. 포집 재생 열 3.0 GJ/t CO₂ · 개선된 아민 흡수제에 대한 공개 기술 평가 범위 2.8~3.2의 대표값. 오래 쓰여 온 MEA(모노에탄올아민) 공정은 약 3.5~4 GJ/t로 더 많은 열이 듭니다. 공장과 운전 조건에 따라 달라지며 모든 설비의 실측값은 아닙니다.</p>
    <p>이 게임에서 정한 값: 현재 생산 2.000 Mt/년·클링커 80%, 클링커 CaO 65%, 혼합연료 0.085 t CO₂/GJ·생물 기원 탄소 50%·화석 기원 탄소 50%. 수소가 많은 폐플라스틱이 섞인 혼합연료를 가정했으며 순수 바이오매스의 일반 계수가 아닙니다. 가마 이용 가능 폐열 0.8 GJ/t 클링커, 점토 소성 열 2.0 GJ/t·상한 0.350 Mt/년, 광물화 상한 0.100 Mt CO₂/년, 분쇄 등 전력 0.1 MWh/t 시멘트입니다. 전기 가열·가스 열 공급 효율, 합성연료 전환·그해 사용률은 모두 100%로 두었습니다. 미래별 공급·가동률·전력 계수·전기 상한·저장 누출률은 ‘현재와 세 미래’의 가상 조건표를 따르며, 각 값은 미래마다 따로 정했습니다. 목표는 장부상 감축률 60%이며 반올림 전 값으로 비교합니다.</p>
    <p>가격도 가상 가정입니다. U는 화폐가 아닌 Mt 시멘트·%p 단위입니다. CO₂ 1 Mt당 포집 30 U·저장 8 U·광물화 10 U·합성연료 40 U, 점토 1 Mt당 10 U·기존 혼합재 1 Mt당 −3 U, 혼합연료 열 1 PJ당 0.3 U·가마 전력 1 TWh당 12 U를 합합니다. 전환 지원을 켜면 시멘트 1 Mt당 4 U를 더합니다. 전체를 시멘트 생산량으로 나누고 현재 가격을 0%로 맞추는 보정 +0.6%p를 더합니다. 수요 감축 자체의 비용, 곧 생산이 줄어 t당 고정비가 오르는 몫과 시멘트를 덜 쓰는 설계·검증 비용은 넣지 않았습니다. 그래서 수요 감축만 바꾸면 가격 영향이 0%로 보이며, 이는 비용이 없다는 뜻이 아닙니다. 실제 가격이나 순고용을 예측하는 값은 아닙니다.</p>
  </details>`;
  const DERIVATION = [
    "생산 P를 줄이고, 계획 혼합재 수요 P(1−c)를 기존 혼합재→점토 순서로 채운다. 점토 상한 뒤 남는 물량은 클링커다. K+scm+clay=P, cActual=K/P. 경고는 계획을 수정한 것이 아니라 가능한 실제 결과를 알린다.",
    "process=K×0.65×44/56. 가마 열 H=K×3.4. 실제 전기 비율은 미래 상한까지이며 부족한 몫을 석탄으로 대체한다. 점토 소성 열 clay×2는 가마 열 H와 별개다.",
    "coal=(H×석탄비율+clay×2)×0.095, bio=H×바이오비율×0.085, G0=process+coal+bio. 점토 소성 연소도 공장 안 통합 포집계통에 연결한 것으로 가정한다.",
    "실효 포집률 r=선택 포집률×가동률. 폐열 Hw=K×0.8. C=r(G0+X), 가스열=max(0,3C−Hw), X=0.056×가스열. 양의 가지에서 X=0.056[3r(G0+X)−Hw]이므로 X(1−3r×0.056)=0.056(3rG0−Hw). 따라서 코드의 닫힌 식이 된다. 분모 최솟값은 0.86392로 0보다 크다. 폐열로 충분하면 X=0. 가마 폐열을 전기 생산에도 중복 사용하지 않는다.",
    "G=G0+X, C=rG, stack=G−C. 광물화 계획량이 상한을 넘으면 넘침을 저장에 더한다. store+mineral+syn=C를 보장한다.",
    "leak=store×ℓ, retained=store−leak. 합성연료 syn은 메탄올 제품 질량이 아니라 그 안으로 간 CO₂ 기준 탄소량이다. 수소 h2=syn×6/44에 전기분해 전력 55를 곱한다.",
    "power=H×실제 전기비율/3.6+C×0.1+h2×55+P×0.1. extra=power−0.2, indirect=power×미래 전력계수. extra가 음수면 음수 그대로 표시한다. 간접 배출은 extra가 아니라 총전력에 곱한다.",
    "bioCredit=bio×0.5×(1−r). ledger=stack−bioCredit+syn×(1−acct/100). 굴뚝에서 나온 생물 기원 몫만 공제한다. 포집된 바이오를 음의 배출로 추가 공제하지 않고, 합성연료에 포함된 바이오 기원 비율도 별도 추적하지 않는 장부 규칙이다. reduction=100(1−ledger/BASE)는 항상 장부상 감축률로 부른다. 분모 BASE를 표시 반올림값 1.334로 바꾸지 않는다.",
    "physical=stack+syn+leak. physical−ledger=bioCredit+syn×acct/100+leak. 이 차이 자체를 점수로 쓰지 않는다.",
    "carbonIn=G×12/44, carbonOut=(physical+mineral+retained)×12/44. 각 항은 표시 반올림 때문에 마지막 자리가 다를 수 있다."
  ];
  const dl = rows => rows.map(([k,v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
  const table = rows => `<table class="cc-table"><thead><tr><th>흐름 / 양</th><th>값</th></tr></thead><tbody>${rows.map(([k,v])=>`<tr><th scope="row">${esc(k)}</th><td class="num">${esc(v)}</td></tr>`).join("")}</tbody></table>`;
  function people(p,r) {
    const support=p.support ? "지원안을 골랐습니다. 공동 기금의 가격 반영분은 +4.0%p입니다. 교육 중 소득, 재배치의 선택권, 기금 관리에 노동자가 참여하는 방법까지 제안해 주세요." : "현재 계획에는 공동 기금 비용이 없습니다. 소득 보완과 재배치가 필요한 사람에게 누가 어떤 비용을 부담할지 별도로 제안해 주세요.";
    const items=[];
    if(r.clay>=.2-EPS) items.push("점토 채굴 확대: 채굴 범위와 복구 비용을 논의하세요.");
    if(r.store>=.3-EPS) items.push("저장소 해역: 파이프라인 경로와 장기 감시 책임을 논의하세요.");
    if(p.bio>=30) items.push("폐기물·바이오 연료: 원료의 출처와 주변 대기질 감시를 논의하세요.");
    if(r.extra>=1-EPS) items.push("전력 수요 증가: 다른 부문의 전환과 공급 확대 비용을 함께 논의하세요.");
    return `<p class="small muted">발언은 모두 역할에 맞춰 만든 문장입니다.</p>${PEOPLE.map(([n,d],i)=>`<section class="cc-person"><h4>${n}</h4><p>“${d}”</p>${i===0?`<p>${support}</p>`:""}</section>`).join("")}<div class="cc-work-directions"><p>시멘트 생산 업무: ${p.d>0?"줄어듦":"유지"}</p><p>석회석 채굴·클링커 소성 업무: ${r.K<1.6-EPS?"줄어듦":r.K>1.6+EPS?"늘어남":"유지"} · 선택 미래 클링커 ${fmt(r.K,3)} Mt/년, 현재 1.600</p><p>전환 설비·대체 원료 업무: ${p.capture>0||r.clay>EPS||p.bio>0||p.elec>0?"늘어남":"유지"}</p><p class="small muted">세 업무의 규모와 필요한 숙련이 달라 순고용 증감은 계산하지 않습니다.</p></div><h4>지역 검토 항목</h4>${items.length?`<ul>${items.map(s=>`<li>${s}</li>`).join("")}</ul>`:"<p>이 조건표에 해당하는 추가 검토 항목이 없습니다. 영향이 없다는 뜻은 아닙니다.</p>"}`;
  }
  function baseline() {
    const cols=["기존 혼합재 공급 Mt/년","포집 가동률","전력 계수 t CO₂/MWh","전기 가열 상한","저장 누출률 /년"];
    const rows=Object.entries(FUT).map(([k,f])=>[FN[k],[fmt(f.supply,2),fmt(f.uptime*100,0)+"%",fmt(f.grid,2),fmt(f.elecMax*100,0)+"%",fmt(f.leak*100,3)+"%"]]);
    return `<p>가상 자료 · 현재 기준: 시멘트 2.000 Mt/년, 클링커 비율 80%, 클링커 1.600 Mt/년, 석탄 가열 100%, 포집 없음, 기존 혼합재 0.400 Mt/년, 점토 소성 없음. 공정 CO₂ 0.817143 Mt/년 + 연료 CO₂ 0.516800 Mt/년 = 기준 직접 배출 1.333943 Mt/년. 현재 전력 0.200 TWh/년. 60% 목표의 장부 배출 한도는 0.533577 Mt/년입니다.</p><p class="small muted">현재 기준은 별도의 고정 비교점이며, 현재 입력을 세 미래에 넣은 값이 아닙니다. 원료 부족 미래에서는 현재 계획을 유지해도 점토 소성이 추가되므로 배출이 증가할 수 있습니다. 현재의 전력 배출 계수는 설정하지 않습니다.</p><div id="cc-condition-table"><table class="cc-table"><thead><tr><th>미래</th>${cols.map(c=>`<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map(([n,v])=>`<tr><th>${n}</th>${v.map(x=>`<td>${x}</td>`).join("")}</tr>`).join("")}</tbody></table></div><div id="cc-condition-cards" hidden>${rows.map(([n,v])=>`<h4>${n}</h4><dl>${dl(cols.map((c,i)=>[c,v[i]]))}</dl>`).join("")}</div><p>세 미래의 값은 모두 이 게임에서 정했습니다. 순조로운 전환에서는 혼합재와 설비를 비교적 안정적으로 확보합니다. 원료 부족에서는 다른 산업의 전환으로 슬래그·플라이애시 공급이 줄어듭니다. 기술 지연에서는 포집 가동률과 전기 가열 가능 비율이 낮아지고, 전력 계수가 더 높으며 저장 누출률도 더 큰 부지를 가정합니다. 전력 계수와 누출률은 미래마다 따로 정한 값입니다. 예를 들어 원료 부족 미래의 전력 계수 0.25는 혼합재 공급 감소와는 별도의 가정으로 순조로운 전환의 0.15보다 높게 정했습니다. 이 묶음은 예보가 아니며, 어느 미래가 더 일어날 법한지는 주어지지 않았습니다.</p>`;
  }
  const jo = (w,p) => KCP.josa(w,p).slice(w.length);
  function questionList(L) {
    if(!L) return [];
    const p=L.plan,s=calc(p,"smooth"),m=calc(p,"scarce"),t=calc(p,"delay");
    const predicted=calc(L.prediction.plan,"delay"),matched=(L.prediction.value==="reach")===reaches(predicted);
    const share=captureShare(p),depends=share!==null && share>=50-EPS;
    const crit1=CRITERIA[L.criteria[0]],crit2=CRITERIA[L.criteria[1]];
    const intensities=[["수요 감축",p.d/30],["클링커 대체",(80-p.c)/30],["연료 전환",(p.bio+p.elec)/70],["포집",p.capture/90]];
    const biggest=Math.max(...intensities.map(a=>a[1]));
    const open=biggest<=EPS?"현재 조건에서 네 밸브를 바꾸지 않았습니다.":`허용 범위에 비해 가장 많이 움직인 밸브는 ${intensities.filter(a=>Math.abs(a[1]-biggest)<EPS).map(a=>a[0]).join(", ")}입니다.`;
    // 면접 카드는 공통 5개 + 개별 최대 2개(6~7개)이며, 카드마다 주된 요청을 하나로 둔다.
    // 핵심 습관(기준 먼저·얻는 것과 잃는 것·반문 뒤 수정/유지)은 공통 1과 공통 4에 표시한다.
    const rebuttal="반문을 듣고 계획을 고치거나 유지할 이유를 말해 주세요.";
    const qs=[
      {k:"cc-c1",tag:"공통 1 · 기준 먼저 · 얻는 것과 잃는 것",q:`${open} 첫째 기준 ‘${crit1}’${jo(crit1,"와/과")} 둘째 기준 ‘${crit2}’ 가운데 어떤 기준을 앞세웠는지 먼저 밝히고, 이 계획으로 얻는 것과 잃는 것을 한 문장으로 말해 주세요. 조절 비율은 감축 기여도를 뜻하지 않습니다.`},
      {k:"cc-c2",tag:"공통 2 · 화학",q:"연료를 모두 재생 전기로 바꾸는 생각 실험을 해도 남는 배출이 있습니다. CaO가 질량의 65%인 클링커 1 t에서 나오는 공정 CO₂를 석회석의 화학 반응식으로 어림해 보세요."},
      {k:matched?"cc-c3-match":"cc-c3-diff",tag:"공통 3 · 예측",q:`${L.revisited?"결과를 본 뒤 다시 한 예측입니다. ":""}기술 지연 상황에서 목표에 ${L.prediction.value==="reach"?"이를":"못 미칠"} 것으로 예측했습니다. 예측 당시 계획의 장부상 감축률은 ${fmtRed(predicted.reduction)}%이며, 목표 도달 여부는 예측과 ${matched?"일치했습니다":"달랐습니다"}. 최종 계획을 기술 지연 상황에 적용한 장부상 감축률은 ${fmtRed(t.reduction)}%입니다. 예측 뒤에 바꾼 행선지·장부 규칙의 영향은 빼고, 어떤 조건을 근거로 예상했는지 말해 주세요.`},
      depends?{k:"cc-c4-env",tag:"공통 4 · 고침·유지와 이유",q:`환경단체 대표가 “포집 설비에 기대면 화석연료 사용이 오래 이어지지 않습니까?”라고 묻습니다. ${rebuttal}`}:p.d>=15?{k:"cc-c4-union",tag:"공통 4 · 고침·유지와 이유",q:`노조 대표가 “시멘트 수요를 줄일 때 노동자의 소득과 숙련이 사라지는 비용은 누가 집니까?”라고 묻습니다. ${rebuttal}`}:{k:"cc-c4-choice",tag:"공통 4 · 고침·유지와 이유",q:`다음은 두 이해관계자의 반문입니다. 환경단체: “포집 설비에 기대면 화석연료 사용이 오래 이어지지 않습니까?” 노조: “생산이 줄면 노동자의 소득과 숙련을 누가 지킵니까?” 둘 중 하나에 대해 ${rebuttal}`},
      {k:"cc-c5-outside",tag:"공통 5 · 발산",q:"이 모형 밖에서 배출을 줄일 수단 하나를 계획이나 장부에 넣기 전에 확인할 조건과 함께 제안해 주세요. 건물의 기능·안전을 지키며 시멘트를 덜 쓰는 설계나, 콘크리트가 CO₂를 다시 흡수하는 재탄산화의 장부 규칙도 생각할 수 있습니다."}
    ];
    const indiv=[];
    // 목표에 못 미친 계획은 목표 대비 차이 질문을 맨 앞에 두어 개수 제한에서 빠지지 않게 한다.
    if(!reaches(s)) indiv.push({k:"cc-i-gap",tag:"개별 · 목표 대비 차이",q:`순조로운 전환의 장부상 감축률은 ${fmtRed(s.reduction)}%, 목표 대비 차이는 ${fmtGap(s.gap)}%p이고 물리적 대기 배출은 ${fmt(s.physical,3)} Mt/년입니다. 이 차이를 메우려면 어느 밸브를 바꾸겠습니까? 밸브 대신 목표의 시점이나 비용 분담을 다시 제안해도 됩니다.`});
    if(s.syn>EPS) {
      if(p.acct===100) indiv.push({k:"cc-i-ledger-100",tag:"개별 · 장부",q:`합성연료 탄소를 전부 감축으로 인정했습니다. 순조로운 전환에서 장부상 감축률은 ${fmtRed(s.reduction)}%, 물리적 대기 배출은 ${fmt(s.physical,3)} Mt/년입니다. 인정률을 0%로 바꾸면 무엇이 달라지고 무엇이 그대로인지 협의회에 설명해 주세요.`});
      else if(p.acct===0) indiv.push({k:"cc-i-ledger-0",tag:"개별 · 장부",q:`합성연료로 보낸 CO₂ ${fmt(s.syn,3)} Mt/년을 감축으로 인정하지 않았습니다. 이 연료가 다른 화석연료를 대신한다면, 그 대체 효과를 어떤 자료로 확인해야 할까요?`});
      else indiv.push({k:"cc-i-ledger-50",tag:"개별 · 장부",q:`합성연료 탄소의 절반을 감축으로 인정했습니다. 장부상 감축률은 ${fmtRed(s.reduction)}%, 물리적 대기 배출은 ${fmt(s.physical,3)} Mt/년입니다. 공장과 연료 사용자가 같은 탄소를 이중으로 세지 않으려면 나머지 절반을 누구의 장부에 보고해야 할까요?`});
    }
    const dd=s.reduction-t.reduction;
    const move=dd>=.05?`${fmt(dd,1)}%p 낮아집니다`:dd<=-.05?`${fmt(-dd,1)}%p 높아집니다`:"거의 같습니다";
    if(depends) indiv.push({k:"cc-i-capture",tag:"개별 · 포집 의존",q:`포집만 끈 같은 계획과 비교하면, 순조로운 전환에서 줄어든 장부 배출의 ${fmt(share,1)}%가 포집을 켠 데서 나옵니다. 장부상 감축률은 순조 ${fmtRed(s.reduction)}%, 기술 지연 ${fmtRed(t.reduction)}%로 ${move}. 이 차이에는 미래의 다른 조건도 포함됩니다. 포집 가동률이 기대보다 낮을 때를 대비해 어떤 약속을 미리 정하겠습니까?`});
    if(p.d>=15) indiv.push(p.support?{k:"cc-i-jobs-support",tag:"개별 · 노동과 지원",q:`시멘트 수요를 ${p.d}% 줄이고 전환 지원을 켰습니다. 가격 영향 중 4.0%p가 공동 기금입니다. 지원을 해도 노동자에게 남는 비용 하나를 짚고, 그 비용을 줄일 방법을 제안해 주세요.`}:{k:"cc-i-jobs-nosupport",tag:"개별 · 노동과 지원",q:`시멘트 수요를 ${p.d}% 줄이고 공동 기금 지원은 선택하지 않았습니다. 그러면 일과 소득이 바뀌는 노동자의 전환 비용은 누가 지게 되나요?`});
    if(m.warnC) indiv.push({k:"cc-i-scm",tag:"개별 · 원료",q:`원료 부족에서 클링커 비율이 계획 ${fmt(p.c,1)}%에서 실제 ${fmt(m.cActual*100,1)}%로 올라갑니다. 다른 산업의 탈탄소가 혼합재 공급을 줄이는 이 연결에 어떻게 대비하겠습니까?`});
    if(s.extra>=1-EPS) indiv.push({k:"cc-i-power",tag:"개별 · 전력",q:`순조로운 전환에서 총전력은 ${fmt(s.power,3)} TWh/년, 현재 대비 증가는 ${fmt(s.extra,3)} TWh/년, 전력 간접 배출은 ${fmt(s.indirect,3)} Mt/년입니다. 이 전기를 냉난방이나 교통 전환에 쓰는 선택과 비교하려면 어떤 정보가 더 필요할까요?`});
    if(p.bio>=30) indiv.push({k:"cc-i-bio",tag:"개별 · 폐기물·바이오",q:"폐기물·바이오 연료에서 나온 탄소의 절반을 생물 기원으로 가정하고, 그중 굴뚝으로 나간 몫을 장부에서 뺐습니다. 이런 처리가 설득력을 가지려면 연료의 출처와 재성장에 대해 무엇을 확인해야 할까요?"});
    if(s.store>=.3-EPS) indiv.push({k:"cc-i-storage",tag:"개별 · 저장",q:`순조로운 전환에서 CO₂ ${fmt(s.store,3)} Mt/년을 저장합니다. 파이프라인 경로와 생업을 걱정하는 어민의 의견을 들어, 저장소의 장기 감시와 사고 대응 책임을 누구에게 맡기겠습니까?`});
    return qs.concat(indiv.slice(0,2));
  }
  function resultRows(r) {
    return [["장부상 감축률",fmtRed(r.reduction)+"%"],["물리적 대기 배출",fmt(r.physical,3)+" Mt CO₂/년"],["물리적 대기 배출 현재 대비",signed(r.physical-BASE,3)+" Mt CO₂/년"],["물리적 + 전력 간접 배출",fmt(r.physical+r.indirect,3)+" Mt CO₂/년"],["목표 대비 차이",fmtGap(r.gap)+"%p"],["총전력",fmt(r.power,3)+" TWh/년"],["현재 대비 전력 증감",signed(r.extra,3)+" TWh/년"],["전력 간접 배출",fmt(r.indirect,3)+" Mt CO₂/년"],["시멘트 가격 영향",signed(r.price,1)+"%"]];
  }
  function recap(state) {
    const L=normalize(state).locked;
    if(!L) return [{t:"계획 상태",d:"아직 확정하지 않았습니다. 준비실에서 계획을 확정하면 면접 질문이 만들어집니다."}];
    const p=L.plan,s=calc(p,"smooth"),predicted=calc(L.prediction.plan,"delay"),final=calc(p,"delay");
    return [
      {t:"계획 상태",d:"계획 확정됨 · 단순화한 모형"},
      {t:"기준의 순서",d:`첫째: ${CRITERIA[L.criteria[0]]} · 둘째: ${CRITERIA[L.criteria[1]]}. 첫째 기준을 더 무겁게 고려했습니다.`},
      {t:"생산과 소재",d:`수요 감축 ${p.d}% · 계획 클링커 ${p.c}% · 생산 ${fmt(s.P,3)} Mt/년`},
      {t:"가마와 포집",d:`석탄 ${100-p.bio-p.elec}% · 폐기물·바이오 ${p.bio}% · 전기 ${p.elec}% · 선택 포집률 ${p.capture}%`},
      {t:"행선지와 장부",d:`계획 저장 ${100-p.mineral-p.syn}% · 광물화 ${p.mineral}% · 합성연료 ${p.syn}% · 합성연료 인정 ${p.acct}%`},
      {t:"전환 지원",d:`${p.support?"켬: 공동 기금 비용 +4.0%p":"끔: 공동 기금 비용 미반영"}. 순고용 증감은 계산하지 않습니다.`},
      ...Object.keys(FUT).map(fid=>{const r=calc(p,fid);return {t:FN[fid],d:`장부상 감축률 ${fmtRed(r.reduction)}% · 물리적 대기 배출 ${fmt(r.physical,3)} Mt/년(현재 대비 ${signed(r.physical-BASE,3)}) · 목표 대비 차이 ${fmtGap(r.gap)}%p · 총전력 ${fmt(r.power,3)} TWh/년 · 현재 대비 ${signed(r.extra,3)} TWh/년 · 간접 배출 ${fmt(r.indirect,3)} Mt/년 · 가격 영향 ${signed(r.price,1)}%`};}),
      {t:"예측 확인",d:`예측: ${L.prediction.value==="reach"?"60% 이상":"60% 미만"}. 예측 당시 기술 지연 장부상 감축률 ${fmtRed(predicted.reduction)}% · 최종 계획 ${fmtRed(final.reduction)}%.${L.revisited?" (다시 계획한 뒤의 예측)":""}`},
      {t:"한 문장 정리",d:L.oneLine,text:L.oneLine}
    ];
  }
  function ports(center,values) {
    const widths=values.map(v=>v>0?Math.max(1,36*v):0);
    let x=center-widths.reduce((a,b)=>a+b,0)/2;
    return widths.map(w=>{const pos=x+w/2;x+=w;return pos;});
  }
  function flows(r) {
    const [jL,jC,jB,jG]=ports(180,[r.process,r.coal,r.bio,r.X]);
    const [sS,sC]=ports(180,[r.stack,r.C]),[cS,cM,cY]=ports(220,[r.store,r.mineral,r.syn]);
    return [
      ["limestone","석회석 탄소",r.process,`M45 80 C45 130 ${jL} 130 ${jL} 180`],
      ["coal","석탄 가마·점토",r.coal,`M135 80 C135 125 ${jC} 135 ${jC} 180`],
      ["bio","폐기물·바이오",r.bio,`M225 80 C225 125 ${jB} 135 ${jB} 180`],
      ["gas","포집열 가스",r.X,`M315 80 C315 130 ${jG} 130 ${jG} 180`],
      ["total","발생 CO₂",r.G,"M180 180 L180 260"],
      ["stack","굴뚝",r.stack,`M${sS} 260 C${sS} 300 36 300 36 350`],
      ["capture","포집",r.C,`M${sC} 260 C${sC} 300 220 310 220 350`],
      ["store","저장",r.store,`M${cS} 350 C${cS} 390 100 390 100 450`],
      ["mineral","광물화",r.mineral,`M${cM} 350 C${cM} 390 200 390 200 450`],
      ["syn","합성연료",r.syn,`M${cY} 350 C${cY} 390 300 390 300 450`],
      ["stack-out","굴뚝 대기",r.stack,"M36 350 L36 570"],
      ["leak","저장 누출",r.leak,"M100 450 C100 500 108 520 108 570"],
      ["retained","저장 잔류",r.retained,"M100 450 C100 500 180 520 180 570"],
      ["mineral-out","광물 고정",r.mineral,"M200 450 C200 500 252 520 252 570"],
      ["syn-out","연료 대기",r.syn,"M300 450 C300 500 324 520 324 570"]
    ];
  }
  const leakText = v => v>0 && v<.0000005 ? "<0.000001" : fmt(v,6);
  function sankey(r,fid) {
    const fs=flows(r);
    const nodes=[
      [45,80,45,22,["석회석","탄소"],45,60,r.process],[135,80,135,22,["석탄","가마·점토"],135,60,r.coal],
      [225,80,225,22,["폐기물·","바이오"],225,60,r.bio],[315,80,315,22,["포집열","가스"],315,60,r.X],
      [180,180,255,174,["발생 CO₂"],255,190,r.G,68],[180,260,100,244,["대기·포집 분기"],0,0,null,68],
      [36,350,86,356,["굴뚝"],86,372,r.stack],[220,350,278,323,["포집"],278,339,r.C,68],
      [100,450,100,410,["저장"],100,426,r.store],[200,450,200,410,["광물화"],200,426,r.mineral],[300,450,332,390,["합성연료"],332,406,r.syn],
      [36,570,36,602,["굴뚝","대기"],36,638,r.stack],[108,570,108,602,["저장","누출"],108,638,r.leak],
      [180,570,180,602,["저장","잔류"],180,638,r.retained],[252,570,252,602,["광물","고정"],252,638,r.mineral],[324,570,324,602,["연료","대기"],324,638,r.syn]
    ];
    const accent=["capture","store","mineral","syn","retained","mineral-out"];
    return `<svg id="cc-flow-svg" class="cc-flow-svg" viewBox="0 0 360 660" role="img" aria-labelledby="cc-flow-title cc-flow-desc"><title id="cc-flow-title">${FN[fid]}의 탄소 흐름</title><desc id="cc-flow-desc">단순화한 모형. 굴뚝, 연료 사용, 저장 누출의 탄소는 대기로 갑니다. 나머지는 저장 재고와 광물로 남습니다. 상세 수치는 뒤의 표에 있습니다.</desc><defs><pattern id="cc-bio-hatch" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 6L6 0" stroke="var(--ink)" stroke-width="1"/></pattern></defs>${fs.filter(a=>a[2]>0).map(([k,n,v,d])=>`<path id="cc-flow-${k}" class="cc-flow" data-cc-flow="${k}" d="${d}" stroke="var(${accent.includes(k)?"--accent":k==="gas"?"--ink-3":"--ink-2"})" stroke-width="${Math.max(1,36*v)}" stroke-linecap="butt" fill="none"${["leak","syn-out"].includes(k)?' stroke-dasharray="4 3"':""}/>${k==="bio"?`<path class="cc-hatch" d="${d}" stroke="url(#cc-bio-hatch)" stroke-width="${Math.max(1,36*v)}" stroke-linecap="butt" fill="none" pointer-events="none" aria-hidden="true"/>`:""}`).join("")}${nodes.map(([x,y,,,,,,,w])=>`<rect x="${x-(w||48)/2}" y="${y-3}" width="${w||48}" height="6" fill="var(--sheet-2)" stroke="var(--ink-2)"/>`).join("")}${nodes.map(([, ,x,y,labels,vx,vy,v],i)=>`<text x="${x}" y="${y}" text-anchor="middle">${labels.map((l,j)=>`<tspan x="${x}" dy="${j?14:0}">${l}</tspan>`).join("")}</text>${v===null?"":`<text x="${vx}" y="${vy}" text-anchor="middle">${esc(i===12?leakText(v):fmt(v,3))}</text>`}`).join("")}</svg>`;
  }
  const FIELD_NAMES = {d:"수요 감축",c:"클링커 비율",bio:"폐기물·바이오",elec:"전기 가열",capture:"포집률",mineral:"광물화",syn:"합성연료",acct:"합성연료 인정",support:"전환 지원"};
  const GROUPS = {d:"demand",c:"clinker",bio:"fuel",elec:"fuel",capture:"capture",mineral:"dest",syn:"dest",acct:"acct",support:"support"};
  const GROUP_NAMES = {demand:"수요 감축",clinker:"클링커 비율",fuel:"연료 혼합",capture:"포집률",dest:"포집 CO₂ 행선지",acct:"장부 규칙",support:"전환 지원"};
  const stepTwo = k => ["mineral","syn","acct","support"].includes(k);
  function range(k) {
    const indexed=["capture","acct"].includes(k),v=VALUES[k];
    return `<div class="cc-control"><label for="cc-${k}">${FIELD_NAMES[k]} <output id="cc-${k}-value" for="cc-${k}"></output></label><div class="cc-range-row"><button type="button" id="cc-${k}-minus" class="btn cc-stepper" data-cc-step="${k}" data-cc-dir="-1" aria-label="${FIELD_NAMES[k]} 한 단계 줄이기" aria-controls="cc-${k}">−</button><input type="range" id="cc-${k}" class="cc-range" data-cc-field="${k}" min="${indexed?0:v[0]}" max="${indexed?v.length-1:v[v.length-1]}" step="${indexed?1:v[1]-v[0]}" aria-describedby="cc-${k}-value"><button type="button" id="cc-${k}-plus" class="btn cc-stepper" data-cc-step="${k}" data-cc-dir="1" aria-label="${FIELD_NAMES[k]} 한 단계 늘리기" aria-controls="cc-${k}">+</button></div></div>`;
  }
  function valve(group,inner,tech) {
    return `<fieldset id="cc-valve-${group}" class="cc-valve"${["dest","acct","support"].includes(group)?" hidden":""}><legend>${GROUP_NAMES[group]}</legend>${inner}<p class="small muted">${TECH[tech]}</p><p id="cc-actual-${group}" class="small muted num"></p></fieldset>`;
  }
  const DETAIL_GROUPS = [
    ["소재 · Mt/년",[["P","생산"],["need","계획 혼합재 수요"],["scm","기존 혼합재"],["clay","소성 점토"],["K","클링커"]]],
    ["열 · PJ/년",[["H","가마 열"],["Hw","이용 가능 폐열"]]],
    ["CO₂ · Mt/년",[["process","공정"],["coal","석탄(점토 포함)"],["bio","혼합연료"],["G0","추가 가스 전 배출"],["X","포집열 가스"],["G","총 발생"],["C","포집"],["stack","굴뚝 대기"],["mineral","광물화"],["overflow","광물화 넘침"],["syn","합성연료 행선"],["store","저장 주입"],["leak","첫 1년 누출"],["retained","저장 재고 증가"],["indirect","전력 간접 배출"],["bioCredit","생물 기원 장부 공제"],["ledger","장부 배출"],["physical","물리적 대기 배출"]]],
    ["수소 · Mt H₂/년",[["h2","수소"]]],
    ["전력 · TWh/년",[["heatPower","가마 가열"],["compressPower","포집 압축"],["h2Power","수소 생산"],["basePower","분쇄 등"],["power","총전력"],["extra","현재 대비 전력 증감"]]],
    ["탄소 · Mt C/년",[["carbonIn","들어온 탄소"],["carbonOut","나간 탄소·재고 증가"]]],
    ["가격",[["supportCost","지원 비용 U/년"],["price","가격 영향 %"]]]
  ];
  function details(r,p) {
    return DETAIL_GROUPS.map(([title,keys])=>`<h4>${title}</h4>${table(keys.map(([k,n])=>[`${n} (${k})`,k==="price"?signed(r[k],1):k==="extra"?signed(r[k],3):k==="leak"?leakText(r[k]):fmt(r[k],3)]))}`).join("")+`<h4>비율과 목표 대비 차이</h4>${table([["실제 클링커 비율",fmt(r.cActual*100,1)+"%"],["실제 전기 비율",fmt(r.e*100,0)+"%"],["실제 석탄 비율",fmt(r.coalShare*100,0)+"%"],["실효 포집률",fmt(r.r*100,1)+"%"],["장부상 감축률",fmtRed(r.reduction)+"%"],["목표 대비 차이",fmtGap(r.gap)+"%p"],["클링커 조정",r.warnC?"있음":"없음"],["전기 대체",r.warnE?"있음":"없음"]])}<p>물리적 대기 배출 − 장부 배출 = 생물 기원 장부 공제 + 합성연료 인정 + 누출: ${fmt(r.physical-r.ledger,3)} = ${fmt(r.bioCredit,3)} + ${fmt(r.syn*p.acct/100,3)} + ${leakText(r.leak)} Mt CO₂/년</p><p id="cc-capture-share">포집 기여 몫: ${captureShareText(p)}</p><p class="small muted">최종 행선지·장부 규칙을 고정하고 포집만 없앤 반사실 비교입니다. 포집이 추가로 줄인 장부 배출의 몫이며 물리적 기여도라는 뜻이 아닙니다. 한 밸브의 기여는 적용 순서·비교 조건에 따라 달라집니다.</p>`;
  }
  let disposePrep = null;
  function renderPrep(root,state,save,next) {
    if(disposePrep) disposePrep();
    const incompatible=plain(state.game) && Object.keys(state.game).length>0 && state.game.version!==1;
    let g=normalize(state),activeGroup="",clamped=false,newWarning=false;
    const $ = s => root.querySelector(s);
    const $$ = s => Array.from(root.querySelectorAll(s));
    const text = (id,s) => { $("#"+id).textContent=s; };
    const tabs = (prefix,items,panel) => `<div id="${prefix==="future"?"cc-futures":"cc-data-tabs"}" class="tabs cc-tabs" role="tablist" aria-label="${prefix==="future"?"미래":"자료"}">${Object.entries(items).map(([k,n])=>`<button type="button" id="cc-${prefix}-${k}" role="tab" data-cc-${prefix}="${k}" aria-controls="${panel}" aria-selected="false" tabindex="-1">${n}</button>`).join("")}</div>`;
    root.innerHTML=`<div id="cc-root" class="cc-layout">
      <section id="cc-criteria" class="panel cc-criteria"><h3>기준의 순서 <span class="tag-mine">연습용 기준 예시</span></h3>${incompatible?'<p class="small muted">이 기록은 현재 계산 규칙과 맞지 않아 계획을 초기값으로 열었습니다.</p>':""}<p class="small muted">첫째 기준은 둘째보다 더 무겁게 고려합니다.</p>${[1,2].map(i=>`<div class="field"><label for="cc-crit${i}">${i===1?"첫째":"둘째"} 기준</label><select id="cc-crit${i}" class="cc-select" data-cc-criterion="${i-1}"><option value="">기준 선택</option>${Object.entries(CRITERIA).map(([k,n])=>`<option value="${k}">${n}</option>`).join("")}</select></div>`).join("")}<dl class="cc-criteria-descriptions">${dl(Object.values(CRITERIA).map((n,i)=>[n,CRIT_DESC[i]]))}</dl></section>
      <section id="cc-workbench" class="panel cc-workbench"><p id="cc-step-label" class="small cc-step-label"></p><p class="small muted">단순화한 모형 · CO₂만 계산합니다. Mt는 백만 t, PJ는 10¹⁵ J, TWh는 10¹² Wh입니다. 탄소 흐름도는 탄소량을 ‘그 탄소가 CO₂가 되었을 때의 질량’으로 환산합니다. 온실가스들의 CO₂환산량(CO₂e)과는 다릅니다.</p>${tabs("future",FN,"cc-future-panel")}<div id="cc-future-panel" role="tabpanel" aria-labelledby="cc-future-smooth"><div id="cc-sankey" class="cc-sankey"></div><p id="cc-flow-active" class="small muted"></p><p class="small muted cc-legend">청록: 포집된 탄소와 그 행선지 · 회색: 대기로 가거나 아직 나뉘기 전의 흐름 · 점선: 다른 때·다른 곳에서 대기로 가는 흐름 · 빗금: 폐기물·바이오 혼합연료(생물 기원 탄소 50% 가정).</p><p class="small muted">청록은 친환경 여부를 뜻하지 않습니다. 아주 작은 흐름은 1px로 표시하여 폭의 합이 정확히 맞지 않을 수 있습니다. 보존은 수치로 확인하세요.</p><details class="reveal cc-flow-data"><summary>탄소 흐름 상세 · Mt CO₂/년</summary><div id="cc-flow-table" class="cc-flow-table"></div></details><p id="cc-balance" class="cc-balance num"></p><p class="small muted">각 항은 표시 반올림 때문에 마지막 자리가 다를 수 있습니다.</p><div id="cc-mini" class="cc-mini num" aria-hidden="true"><div id="cc-mini-main"></div><div id="cc-mini-flow"></div></div><div id="cc-valves" class="cc-valves">
      ${valve("demand",range("d"),"수요 감축")}${valve("clinker",range("c"),"클링커 비율")}${valve("fuel",range("bio")+range("elec")+'<p>석탄 <output id="cc-coal-value"></output></p>',"연료 혼합")}${valve("capture",range("capture"),"포집")}
      ${valve("dest",range("mineral")+range("syn")+'<p>저장 <output id="cc-store-value"></output></p><p id="cc-zero-capture" class="small muted" hidden>포집량 0: 비율을 바꿔도 현재 흐름은 없습니다.</p>',"광물화")}
      ${valve("acct",range("acct")+'<p id="cc-zero-syn" class="small muted" hidden>합성연료로 보낸 탄소가 없어 인정 비율을 바꿔도 장부가 바뀌지 않습니다.</p>',"장부 규칙")}
      ${valve("support",'<label for="cc-support"><input type="checkbox" id="cc-support" data-cc-field="support"> 공동 기금으로 재배치·교육 지원</label> <output id="cc-support-value" for="cc-support"></output>',"전환 지원")}</div>
      <div id="cc-prediction" class="cc-prediction"><p>기술 지연에서 장부상 감축률 60%에 이를까요?</p><p id="cc-predict-setting" class="small muted"></p><p id="cc-revisited" class="small muted" hidden>다시 계획하기: 앞서 결과를 본 뒤의 재예측입니다.</p><label><input type="radio" id="cc-predict-reach" name="cc-predict" value="reach"> 60% 이상</label> <label><input type="radio" id="cc-predict-below" name="cc-predict" value="below"> 60% 미만</label><p id="cc-predict-hidden" class="small muted">기술 지연 결과는 예측을 기록한 뒤 공개합니다.</p><p id="cc-predict-result" class="small muted" hidden></p></div><button type="button" id="cc-stage1" class="btn primary cc-action" disabled>1단계 확정·다음</button><button type="button" id="cc-back1" class="btn ghost cc-action" hidden>1단계 다시 조절</button></div></section>
      <section id="cc-materials" class="panel cc-materials"><h3>자료 <span class="tag-mine">연습용 자료</span></h3>${tabs("data",{baseline:"현재와 세 미래",tech:"기술과 계산",people:"이해관계자",rubric:"연습용 평가 기준"},"cc-data-panel")}<div id="cc-data-panel" role="tabpanel" aria-labelledby="cc-data-baseline"></div></section>
      <section id="cc-results" class="panel cc-results"><h3 id="cc-result-title"></h3><div id="cc-main-pair" class="cc-main-pair"><div class="cc-metric"><h4>장부상 감축률</h4><p id="cc-ledger-reduction" class="cc-metric-value num"></p><p class="cc-metric-note num"><span id="cc-gap"></span> · <span id="cc-ledger"></span></p></div><div class="cc-metric"><h4>물리적 대기 배출</h4><p id="cc-physical" class="cc-metric-value num"></p><div class="cc-metric-note"><p id="cc-physical-delta"></p><p>굴뚝 + 합성연료 사용 + 올해 저장분 누출 · 위 값은 전력 간접 배출 제외</p></div></div></div><div id="cc-warnings" class="cc-warnings"></div></section>
      <section id="cc-power" class="panel cc-power"><h3>전력 사용 구성 · TWh/년</h3><p class="small muted">이 막대는 탄소 흐름이 아니라 공장에서 사용하는 전력의 구성입니다. ‘현재 대비 전력 증감’은 총전력에서 현재의 0.200 TWh/년을 뺀 값입니다.</p><div id="cc-power-chart"></div><dl id="cc-power-values"></dl><p>총전력 <span id="cc-power-total" class="num cc-power-value"></span></p><p>현재 대비 전력 증감 <span id="cc-power-extra" class="num cc-power-value"></span></p><p>전력 간접 배출 <span id="cc-indirect" class="num cc-power-value"></span></p></section>
      <section id="cc-cost" class="panel cc-cost"><h3>시멘트 가격 영향 <span id="cc-price" class="num"></span> · 이 게임의 비용 모형</h3><p class="small muted">현재 기준 가격을 0%로 맞춘 가상 비교입니다. 실제 가격·집값·투자비를 예측하지 않습니다.</p><p id="cc-price-scope" class="small muted">수요 감축의 비용(생산이 줄어 t당 고정비가 오르는 몫, 시멘트를 덜 쓰는 설계·검증 비용)은 이 가격 영향에 넣지 않았습니다. 수요 감축만 늘리면 가격 영향이 그대로인 것은 그 때문입니다.</p><p id="cc-support-cost"></p></section>
      <section id="cc-compare" class="panel cc-compare" hidden><h3>세 미래 비교</h3>${Object.keys(FUT).map(f=>`<h4>${FN[f]}</h4><dl id="cc-compare-${f}" class="cc-compare-card"></dl>`).join("")}</section>
      <details id="cc-calc-detail" class="reveal cc-calc-detail"><summary>계산 과정과 상수</summary><ol>${DERIVATION.map(s=>`<li>${esc(s)}</li>`).join("")}</ol>${CONSTANTS}<div id="cc-detail-values"></div></details>
      <section class="panel cc-summary"><div class="field"><label for="cc-oneline">기준, 얻는 것과 잃는 것</label><textarea id="cc-oneline" class="note cc-oneline" maxlength="300" placeholder="나는 ○○을 더 무겁게 보아 이 계획을 골랐다. ○○을 얻지만 ○○을 잃는다.">${esc(g.oneLine)}</textarea></div><p id="cc-ready" class="small muted cc-ready"></p><button type="button" id="cc-lock" class="btn primary cc-action" disabled>계획 확정</button><button type="button" id="cc-unlock" class="btn ghost cc-action" hidden>다시 계획하기</button><p class="small muted">다시 계획하면 질문이 달라질 수 있습니다. 기존 답변 메모는 남습니다.</p></section><div id="cc-memo-wrap" class="cc-memo-wrap">${KCP.memoPanel(state,save,"cc-memo")}</div><div class="cc-next-wrap"><button type="button" id="cc-next" class="btn primary cc-action" disabled>면접실로 이동</button></div><div id="cc-live" class="sr-only cc-live" role="status" aria-live="polite" aria-atomic="true"></div></div>`;
    const canLock = () => g.step===2 && validPrediction(g.prediction) && validCriteria(g.criteria) && g.oneLine.trim().length>0 && g.oneLine.length<=300;
    const canEdit = k => !g.locked && (stepTwo(k)?g.step===2:g.step===1);
    function syncControls() {
      Object.keys(VALUES).forEach(k=>{
        const indexed=["capture","acct"].includes(k),el=$("#cc-"+k),value=g.plan[k];
        el.value=indexed?VALUES[k].indexOf(value):value;
        el.disabled=!canEdit(k);
        el.setAttribute("aria-valuetext",value+"%");
        text("cc-"+k+"-value",value+"%");
        $("#cc-"+k+"-minus").disabled=!canEdit(k)||value===VALUES[k][0];
        $("#cc-"+k+"-plus").disabled=!canEdit(k)||value===VALUES[k].at(-1)||(["mineral","syn"].includes(k)&&g.plan.mineral+g.plan.syn===100);
      });
      $("#cc-support").checked=g.plan.support;
      $("#cc-support").disabled=!canEdit("support");
      text("cc-support-value",g.plan.support?"켬":"끔");
      text("cc-coal-value",100-g.plan.bio-g.plan.elec+"%");
      text("cc-store-value",100-g.plan.mineral-g.plan.syn+"%");
      [1,2].forEach(i=>{
        const el=$("#cc-crit"+i);el.value=g.criteria[i-1];el.disabled=!!g.locked;
        Array.from(el.options).forEach(o=>{o.disabled=!!o.value && o.value===g.criteria[2-i];});
      });
      $$("input[name=cc-predict]").forEach(el=>{el.checked=el.value===g.predictDraft;el.disabled=g.step!==1||!!g.locked;});
      ["dest","acct","support"].forEach(k=>{$("#cc-valve-"+k).hidden=g.step!==2;});
      $("#cc-oneline").readOnly=!!g.locked;
      if($("#cc-oneline").value!==g.oneLine) $("#cc-oneline").value=g.oneLine;
      $("#cc-stage1").hidden=g.step!==1;
      $("#cc-stage1").disabled=!validCriteria(g.criteria)||!["reach","below"].includes(g.predictDraft)||!!g.locked;
      $("#cc-back1").hidden=g.step!==2||!!g.locked;
      $("#cc-lock").hidden=!!g.locked;$("#cc-lock").disabled=!canLock();
      $("#cc-unlock").hidden=!g.locked;$("#cc-next").disabled=!validLocked(g.locked);
      $("#cc-compare").hidden=g.step!==2;
      text("cc-step-label",g.locked?"계획 확정됨":g.step===1?"1단계 · 생산과 포집":"2단계 · 행선지와 장부");
      text("cc-ready",g.locked?"확정한 계획으로 면접 질문을 만듭니다.":"기준 두 개, 예측, 한 문장을 정하고 계획을 확정하세요.");
      text("cc-predict-setting",`예측에 포함되는 현재 설정: 저장 ${100-g.plan.mineral-g.plan.syn}%, 광물화 ${g.plan.mineral}%, 합성연료 ${g.plan.syn}%, 인정 ${g.plan.acct}%, 지원 ${g.plan.support?"켬":"끔"}`);
      $("#cc-revisited").hidden=!g.revisited;$("#cc-predict-hidden").hidden=g.step!==1;
      $("#cc-predict-result").hidden=g.step!==2;
      if(g.step===2) text("cc-predict-result",`예측 당시 기술 지연 장부상 감축률 ${fmtRed(calc(g.prediction.plan,"delay").reduction)}% · 최종 계획의 기술 지연 장부상 감축률 ${fmtRed(calc(g.plan,"delay").reduction)}%`);
      $$("[data-cc-future]").forEach(b=>{const k=b.dataset.ccFuture;b.disabled=g.step===1&&k!=="smooth";b.setAttribute("aria-selected",String(k===g.fut));b.tabIndex=k===g.fut?0:-1;});
      $("#cc-future-panel").setAttribute("aria-labelledby","cc-future-"+g.fut);
    }
    function responsive() {
      if(!root.isConnected) { cleanup(); return; }
      const strip=document.getElementById("strip");
      $("#cc-mini").style.top=(strip?strip.offsetHeight:0)+"px";
      const compact=window.innerWidth<980;
      if($("#cc-condition-table")) $("#cc-condition-table").hidden=compact;
      if($("#cc-condition-cards")) $("#cc-condition-cards").hidden=!compact;
    }
    function paintMaterials() {
      $$("[data-cc-data]").forEach(b=>{const on=b.dataset.ccData===g.dataTab;b.setAttribute("aria-selected",String(on));b.tabIndex=on?0:-1;});
      $("#cc-data-panel").setAttribute("aria-labelledby","cc-data-"+g.dataTab);
      $("#cc-data-panel").innerHTML=g.dataTab==="baseline"?baseline():g.dataTab==="tech"?Object.entries(TECH).map(([n,d])=>`<h4>${n}</h4><p>${d}</p>`).join(""):g.dataTab==="people"?people(g.plan,calc(g.plan,g.fut)):Object.entries(KCP.YEARS[ID].rubric).map(([n,items])=>`<h4>${n}</h4><ul>${items.map(s=>`<li>${s}</li>`).join("")}</ul>`).join("");
      responsive();
    }
    function emphasis() {
      const groups={fuel:["coal","bio","gas","total","stack","capture","store","mineral","syn","stack-out","leak","retained","mineral-out","syn-out"],capture:["gas","total","stack","capture","store","mineral","syn","stack-out","leak","retained","mineral-out","syn-out"],dest:["store","mineral","syn","leak","retained","mineral-out","syn-out"]};
      const affecting=activeGroup && !["acct","support"].includes(activeGroup);
      $$(".cc-flow").forEach(path=>{
        const on=!!affecting && (!groups[activeGroup]||groups[activeGroup].includes(path.dataset.ccFlow));
        path.classList.toggle("cc-emphasis",on);path.style.opacity=affecting&&!on?"0.35":"1";
      });
      if ($(".cc-hatch")) $(".cc-hatch").style.opacity = $("#cc-flow-bio").style.opacity;
      $$(".cc-valve legend").forEach(l=>l.classList.toggle("cc-active-legend",l.parentElement.id==="cc-valve-"+activeGroup));
      text("cc-flow-active",activeGroup?["acct","support"].includes(activeGroup)?"이 조작은 탄소 흐름을 바꾸지 않습니다.":"조작 중: "+GROUP_NAMES[activeGroup]:"");
      const r=calc(g.plan,g.fut);
      text("cc-mini-flow",!activeGroup?"":activeGroup==="demand"||activeGroup==="clinker"?`생산 ${fmt(r.P,3)} · 클링커 ${fmt(r.K,3)} Mt/년`:activeGroup==="fuel"?`석탄 ${fmt(r.coal,3)} · 혼합연료 ${fmt(r.bio,3)} Mt`:["acct","support"].includes(activeGroup)?"이 조작은 탄소 흐름을 바꾸지 않습니다.":`포집 ${fmt(r.C,3)} → 저장 ${fmt(r.store,3)} · 광물화 ${fmt(r.mineral,3)} · 합성연료 ${fmt(r.syn,3)} Mt`);
    }
    function paint() {
      const p=g.plan,r=calc(p,g.fut),f=FUT[g.fut];
      syncControls();
      $("#cc-sankey").innerHTML=sankey(r,g.fut);
      $("#cc-flow-table").innerHTML=table(flows(r).map(([k,n,v])=>[n,k==="leak"?leakText(v):fmt(v,3)]));
      text("cc-balance",`들어온 탄소 ${fmt(r.carbonIn,3)} Mt C(= CO₂ ${fmt(r.G,3)} Mt × 12/44) = 대기로 간 탄소 ${fmt(r.physical*12/44,3)} + 저장 재고 증가 ${fmt(r.retained*12/44,3)} + 광물 ${fmt(r.mineral*12/44,3)} Mt C`);
      text("cc-mini-main",`장부상 감축률 ${fmtRed(r.reduction)}% · 물리적 대기 배출 ${fmt(r.physical,3)} Mt/년(현재 대비 ${signed(r.physical-BASE,3)})`);
      text("cc-result-title","선택 미래 · "+FN[g.fut]);
      text("cc-ledger-reduction",fmtRed(r.reduction)+"%");text("cc-physical",fmt(r.physical,3)+" Mt CO₂/년");text("cc-physical-delta",physicalLine(r));
      text("cc-gap","목표 대비 차이 "+fmtGap(r.gap)+"%p");text("cc-ledger","장부 배출 "+fmt(r.ledger,3)+" Mt/년");
      text("cc-actual-demand",`실제 생산 ${fmt(r.P,3)} Mt/년`);
      text("cc-actual-clinker",`계획 ${fmt(p.c,1)}% · 실제 ${fmt(r.cActual*100,1)}%`);
      text("cc-actual-fuel",`실제 석탄 ${fmt(r.coalShare*100,0)}% · 폐기물·바이오 ${p.bio}% · 전기 ${fmt(r.e*100,0)}%`);
      text("cc-actual-capture",`선택 ${p.capture}% × 가동률 ${fmt(f.uptime*100,0)}% = 실효 ${fmt(r.r*100,1)}%`);
      text("cc-actual-dest",`실제 저장 ${fmt(r.store,3)} · 광물화 ${fmt(r.mineral,3)} · 합성연료 ${fmt(r.syn,3)} Mt CO₂/년`);
      $("#cc-zero-capture").hidden=r.C>EPS;$("#cc-zero-syn").hidden=r.syn>EPS;
      const warnings=[
        [r.warnC,"clinker","clinker",`혼합재·점토 상한: 계획 클링커 ${fmt(p.c,1)}% → ${fmt(r.cActual*100,1)}%로 계산했습니다.`],
        [r.warnE,"electric","fuel",`전기 가열 상한: 계획 ${p.elec}% → ${fmt(r.e*100,0)}%. 부족한 몫은 석탄으로 채웠습니다.`],
        [r.overflow>EPS,"mineral","dest",`광물화 상한: 넘친 ${fmt(r.overflow,3)} Mt/년을 저장으로 보냈습니다.`],
        [r.reduction>0 && r.physical-BASE>=.0005,"physical",null,`장부와 실제의 엇갈림: 장부상 감축률은 ${fmtRed(r.reduction)}%이지만 물리적 대기 배출은 현재보다 ${fmt(r.physical-BASE,3)} Mt/년 많습니다.`]
      ];
      const prior=!!$("#cc-warn-clinker");
      $("#cc-warnings").innerHTML=warnings.some(a=>a[0])?warnings.filter(a=>a[0]).map(([,id,,s])=>`<p id="cc-warn-${id}" class="small muted cc-warning">${s}</p>`).join(""):'<p class="small muted">설정한 비율대로 계산됩니다.</p>';
      newWarning=newWarning||(!prior&&r.warnC);
      warnings.forEach(([on,id,group])=>{if(!group) return;const el=$("#cc-valve-"+group);if(on) el.setAttribute("aria-describedby","cc-warn-"+id);else el.removeAttribute("aria-describedby");});
      const powerRows=[["가마 가열",r.heatPower],["포집 압축",r.compressPower],["수소 생산",r.h2Power],["분쇄 등",r.basePower]];
      const powerChart=KCP.hbar(powerRows.map(([label,v])=>({label,v})),{max:Math.max(.25,Math.ceil(Math.max(...powerRows.map(a=>a[1]))*4)/4),unit:"",w:360,labelW:80,c1:"var(--accent)",aria:"전력 사용 구성, 단위 TWh/년"});
      // 막대 길이는 원래 값으로 두고 숫자 표기만 반올림한다.
      $("#cc-power-chart").innerHTML=powerChart.replace(/<text([^>]*)>([^<]*)<\/text>/g,(all,attrs,value)=>powerRows.some(([,v])=>String(v)===value)?`<text${attrs}>${fmt(Number(value),3)}</text>`:all);
      $("#cc-power-values").innerHTML=dl(powerRows.map(([n,v])=>[n,fmt(v,3)+" TWh/년"]));
      text("cc-power-total",fmt(r.power,3)+" TWh/년");text("cc-power-extra",signed(r.extra,3)+" TWh/년");text("cc-indirect",fmt(r.indirect,3)+" Mt CO₂/년");
      text("cc-price",signed(r.price,1)+"%");text("cc-support-cost",p.support?"그중 전환 지원 +4.0%p":"전환 지원 반영 0.0%p");
      Object.keys(FUT).forEach(fid=>{$("#cc-compare-"+fid).innerHTML=g.step===2?dl(resultRows(calc(p,fid))):"";});
      $("#cc-detail-values").innerHTML=details(r,p);
      if(g.dataTab==="people") paintMaterials();
      emphasis();
    }
    function announce(k) {
      if(clamped) { text("cc-live","남은 저장 몫이 없습니다. 다른 행선지를 먼저 줄이세요.");clamped=false;return; }
      const r=calc(g.plan,g.fut);
      text("cc-live",`${FIELD_NAMES[k]} ${k==="support"?(g.plan.support?"켬":"끔"):g.plan[k]+"%"}. 장부상 감축률 ${fmtRed(r.reduction)}%, 물리적 대기 배출 ${fmt(r.physical,3)} Mt/년, 현재 대비 ${signed(r.physical-BASE,3)}.${newWarning?" 원료 상한으로 실제 클링커 비율이 바뀌었습니다.":""}`);
      newWarning=false;
    }
    function changeField(k,value,done) {
      if(!canEdit(k)) {syncControls();return;}
      if(k!=="support" && !VALUES[k].includes(value)) {syncControls();return;}
      if(k==="mineral"||k==="syn") {
        const clipped=Math.min(value,100-g.plan[k==="mineral"?"syn":"mineral"]);
        if(clipped!==value) {clamped=true;text("cc-live","남은 저장 몫이 없습니다. 다른 행선지를 먼저 줄이세요.");}
        value=clipped;
      }
      g.plan[k]=value;paint();save();if(done) announce(k);
    }
    function tabSelect(kind,key) {
      if(kind==="future") {if(!Object.hasOwn(FUT,key)||(g.step===1&&key!=="smooth")) return;g.fut=key;paint();}
      else {if(!["baseline","tech","people","rubric"].includes(key)) return;g.dataTab=key;paintMaterials();}
      save();
    }
    function back() {
      Object.assign(g,{step:1,locked:null,prediction:null,predictDraft:"",fut:"smooth",revisited:true});
      paint();save();$("#cc-d").focus();
    }
    root.addEventListener("input",onInput);
    function onInput(ev) {
      const el=ev.target,k=el.dataset.ccField;
      if(k && k!=="support") changeField(k,["capture","acct"].includes(k)?VALUES[k][Number(el.value)]:Number(el.value),false);
      if(el.id==="cc-oneline") {if(g.locked) {el.value=g.oneLine;return;}g.oneLine=el.value.slice(0,300);syncControls();save();}
    }
    function onChange(ev) {
      const el=ev.target,k=el.dataset.ccField;
      if(k) {if(k==="support") changeField(k,el.checked,true);else if(canEdit(k)) announce(k);else syncControls();}
      if(el.dataset.ccCriterion!==undefined) {
        if(g.locked) {syncControls();return;}
        const i=Number(el.dataset.ccCriterion),v=el.value;
        if((v===""||Object.hasOwn(CRITERIA,v)) && (!v||v!==g.criteria[1-i])) g.criteria[i]=v;
        syncControls();save();
      }
      if(el.name==="cc-predict") {
        if(g.locked||g.step!==1) {syncControls();return;}
        if(["reach","below"].includes(el.value)) g.predictDraft=el.value;
        syncControls();save();
      }
    }
    function onClick(ev) {
      const b=ev.target.closest("button");if(!b||!root.contains(b)||b.disabled) return;
      if(b.dataset.ccStep) {const k=b.dataset.ccStep,i=VALUES[k].indexOf(g.plan[k])+Number(b.dataset.ccDir);if(i>=0&&i<VALUES[k].length) changeField(k,VALUES[k][i],true);return;}
      if(b.dataset.ccFuture) tabSelect("future",b.dataset.ccFuture);
      if(b.dataset.ccData) tabSelect("data",b.dataset.ccData);
      if(b.id==="cc-stage1" && !g.locked && g.step===1 && validCriteria(g.criteria) && ["reach","below"].includes(g.predictDraft)) {
        g.prediction={value:g.predictDraft,plan:clone(g.plan)};g.step=2;paint();save();$("#cc-mineral").focus();
      }
      if(b.id==="cc-back1" && !g.locked && g.step===2) back();
      if(b.id==="cc-unlock" && g.locked) back();
      if(b.id==="cc-lock" && !g.locked && canLock()) {g.locked=snapshot(g);paint();save();text("cc-live","확정한 계획으로 면접 질문을 만듭니다.");$("#cc-next").focus();}
      if(b.id==="cc-next") {g=normalize(state);if(validLocked(g.locked)) next();}
    }
    function onKey(ev) {
      const b=ev.target.closest("[role=tab]");if(!b||!root.contains(b)||!["ArrowLeft","ArrowRight","Home","End"].includes(ev.key)) return;
      ev.preventDefault();const buttons=Array.from(b.parentElement.querySelectorAll("[role=tab]")).filter(el=>!el.disabled),i=buttons.indexOf(b);
      const n=ev.key==="Home"?0:ev.key==="End"?buttons.length-1:(i+(ev.key==="ArrowRight"?1:-1)+buttons.length)%buttons.length;
      const target=buttons[n];target.focus();tabSelect(target.dataset.ccFuture?"future":"data",target.dataset.ccFuture||target.dataset.ccData);
    }
    function focusIn(ev) {const field=ev.target.closest(".cc-valve");if(!field) return;activeGroup=field.id.slice("cc-valve-".length);emphasis();}
    function focusOut(ev) {if(!$("#cc-valves").contains(ev.relatedTarget)) {activeGroup="";emphasis();}}
    root.addEventListener("change",onChange);root.addEventListener("click",onClick);root.addEventListener("keydown",onKey);root.addEventListener("focusin",focusIn);root.addEventListener("focusout",focusOut);
    window.addEventListener("resize",responsive);
    const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(responsive):null;
    const strip=document.getElementById("strip");if(observer&&strip) observer.observe(strip);
    let offPhase=null,offRoute=null;
    function cleanup() {
      window.removeEventListener("resize",responsive);if(observer) observer.disconnect();
      root.removeEventListener("input",onInput);root.removeEventListener("change",onChange);root.removeEventListener("click",onClick);root.removeEventListener("keydown",onKey);root.removeEventListener("focusin",focusIn);root.removeEventListener("focusout",focusOut);
      if(offPhase) offPhase();if(offRoute) offRoute();if(disposePrep===cleanup) disposePrep=null;
    }
    if(KCP.on) {offPhase=KCP.on("phase:change",cleanup);offRoute=KCP.on("route:change",cleanup);}
    disposePrep=cleanup;
    paintMaterials();paint();responsive();newWarning=false;
  }
  const REFLECT = `<div class="cc-reflect">
  <p class="small">아래는 서로 다른 기준을 택한 가상의 답입니다. 선택을 따라 하기보다 기준, 근거, 얻는 것과 잃는 것, 반문 뒤의 판단을 비교하세요.</p>
  <details class="reveal cc-example">
    <summary>산업 유지와 포집 중심 <span class="tag-mine">가상의 답</span></summary>
    <p><b>기준과 무게.</b> 첫째는 일자리·지역 경제에 높은 무게, 둘째는 확실한 감축에 중간 무게를 두었습니다. 생산을 유지할 이유와 배출을 줄일 책임을 함께 설명하겠습니다. 가격이 더 오르는 약점은 받아들이되, 그 비용을 제품 구매자와 지역 주민에게 일방적으로 넘기지 않도록 분담을 협의하겠습니다.</p>
    <p><b>선택.</b> 수요 감축 0%, 클링커 75%, 석탄·폐기물바이오·전기 80·20·0%, 포집 90%, 저장·광물화·합성연료 90·10·0%, 인정 0%를 골랐습니다. 전환 지원도 켰습니다.</p>
    <p><b>얻는 것과 잃는 것.</b> 생산 2.000 Mt/년을 유지하면서 장부상 감축률은 순조·원료 부족·기술 지연에서 81.1·80.2·55.9%입니다. 물리적 대기 배출은 0.260·0.273·0.608 Mt/년입니다. 생산을 지키지만 포집 가동과 장기 저장 관리에 의존합니다.</p>
    <p><b>비용과 약점.</b> 가격 영향은 +25.5·+28.5·+18.6%이고, 순조 미래에는 1.009 Mt/년을 저장합니다. 총전력은 0.311·0.316·0.271 TWh/년, 전력 간접 배출은 0.047·0.079·0.095 Mt/년입니다. 기술 지연에서는 목표보다 4.1%p 낮습니다. 고용 유지가 저절로 보장되는 것은 아니므로 지원 기금과 감시 책임을 협약에 담겠습니다.</p>
    <p><b>반문 뒤의 판단.</b> 포집이 화석연료 사용을 오래 유지할 수 있다는 지적을 받아들입니다. 우선 생산 유지 계획을 택하되 가동 자료와 물리 배출을 공개하겠습니다. 클링커 감소는 광산과 가마의 업무도 줄이므로 노동자 협의를 거치겠습니다. 가동률이 낮아지면 생산 유지의 우선순위도 재검토하겠습니다.</p>
    <p><b>조건이 달라지면.</b> 기술 지연이 확인되면 수요 감축 10%를 더하겠습니다. 그 계산은 기술 지연 장부상 감축률 60.6%, 물리적 대기 배출 0.544 Mt/년, 가격 영향 +18.3%이며, 생산은 1.800 Mt/년으로 줄어듭니다.</p>
  </details>
  <details class="reveal cc-example">
    <summary>수요와 소재 중심 <span class="tag-mine">가상의 답</span></summary>
    <p><b>기준과 무게.</b> 첫째는 가격 부담에 높은 무게, 둘째는 기술 위험 분산에 중간 무게를 두었습니다. 포집 설비와 장기 저장에 기대지 않아 가격과 관리 부담을 줄이고, 생산이 줄어드는 지역의 비용도 계획에 넣겠습니다.</p>
    <p><b>선택.</b> 수요 감축 30%, 클링커 50%, 석탄·폐기물바이오·전기 30·40·30%, 포집 0%, 행선지는 저장 100%, 인정 0%를 골랐습니다. 실제 포집 물량은 없으며 전환 지원은 켰습니다.</p>
    <p><b>얻는 것과 잃는 것.</b> 생산은 1.400 Mt/년이고 장부상 감축률은 순조·원료 부족·기술 지연에서 61.5·50.1·56.7%입니다. 물리적 대기 배출은 0.554·0.717·0.618 Mt/년입니다. 포집 에너지와 저장 부담을 피하지만 원료와 연료 공급에 의존합니다.</p>
    <p><b>비용과 약점.</b> 가격 영향은 +7.3·+9.2·+7.1%이지만 생산이 줄어 t당 고정비가 오르는 몫은 빠져 있습니다. 원료 부족에서는 클링커가 계획 50%에서 실제 64.3%로 올라갑니다. 생물 기원 탄소의 장부 공제를 물리 감축과 구분하겠습니다. 공장의 물리적 대기 배출은 포집 중심 계획보다 많습니다(순조 0.554 대 0.260, 기술 지연 0.618 대 0.608 Mt/년). 전력 간접 배출을 더하면 기술 지연에서는 0.690 대 0.703 Mt/년으로 순서가 뒤집힙니다.</p>
    <p><b>반문 뒤의 판단.</b> 줄어드는 생산의 비용을 노동자에게만 맡겨서는 안 됩니다. 수요·소재 방향은 유지하되 훈련 중 소득과 재배치 선택권을 보장할 공동 기금을 제안합니다. 수요를 줄이는 설계가 건물의 안전·수명을 지키는지, 혼합연료가 지속적으로 조달되는지도 검증하겠습니다.</p>
    <p><b>조건이 달라지면.</b> 원료 부족이 확인되어도 이 계획에는 더 열 밸브가 없습니다. 포집 30%를 더하면 원료 부족에서 63.6%가 되지만 이 답의 기준과 맞지 않으므로, 목표 시점이나 수입·재탄산화처럼 모형 밖의 수단을 협의회에 제안하겠습니다.</p>
  </details>
  <details class="reveal cc-example">
    <summary>단계적 혼합과 조건부 약속 <span class="tag-mine">가상의 답</span></summary>
    <p><b>기준과 무게.</b> 첫째는 기술 위험 분산에 높은 무게, 둘째는 일자리·지역 경제에 중간 무게를 두었습니다. 여러 수단을 쓰되 조건이 달라지면 어느 수단을 바꿀지 미리 정하겠습니다.</p>
    <p><b>선택.</b> 수요 감축 10%, 클링커 65%, 석탄·폐기물바이오·전기 60·30·10%, 포집 60%, 저장·광물화·합성연료 80·20·0%, 인정 0%와 지원 켬을 골랐습니다.</p>
    <p><b>얻는 것과 잃는 것.</b> 생산 1.800 Mt/년에서 장부상 감축률은 순조·원료 부족·기술 지연 67.3·62.6·55.1%입니다. 물리적 대기 배출은 0.459·0.525·0.631 Mt/년입니다. 전력 간접 배출은 0.052·0.091·0.114 Mt/년입니다. 부담을 나누지만 가격 영향 +17.3·+20.4·+14.1%와 여러 설비의 관리 책임이 함께 남습니다.</p>
    <p><b>비용과 약점.</b> 조건부 변경을 실행하면 생산이 1.500 Mt/년으로 줄어 노동자의 전환 부담이 커집니다. 약속을 발동할 가동률을 누가 어떤 기간에 걸쳐 검증하는지도 합의해야 합니다. 잠깐 멈춘 설비와 장기적인 성능 부족을 구분할 자료가 필요하며, 독립 검증과 감시를 지속하는 부담도 남습니다.</p>
    <p><b>반문 뒤의 판단.</b> 조건부 약속만으로 미래를 보장할 수 없다는 지적을 받아들입니다. 가동률의 독립 검증, 발동 시점, 노동자 협의, 수요 절감 계약과 지원 기금을 제도에 담겠습니다. 두 계산은 서로 다른 고정 계획의 비교이며 실제 전환 기간과 지연 비용은 아직 계산하지 못했습니다.</p>
    <p><b>조건이 달라지면.</b> 포집 가동률이 80% 미만으로 확인되면 수요 감축을 25%로 늘리겠습니다. 다른 선택을 그대로 둔 기술 지연 계산은 장부상 감축률 63.2%, 물리적 대기 배출 0.519 Mt/년, 가격 영향 +13.5%입니다. 이 조건을 선택하는 이유와 생산 감소의 분담안을 협의회에 함께 제시하겠습니다.</p>
  </details>
  <details class="reveal cc-science">
    <summary>반응식과 공정 배출</summary>
    <p>탄산칼슘은 열을 받으면 CaCO₃ → CaO + CO₂로 분해됩니다. 반올림한 몰 질량은 100 → 56 + 44 g/mol입니다. CaO 1 t을 얻을 때 CO₂는 44/56 t, CaO가 65%인 클링커 1 t에서는 0.65×44/56 ≈ 0.511 t입니다. 이 관계는 임의의 정책 계수가 아니라 실제 화학 반응에서 나옵니다.</p>
    <p>가마를 데우는 연료에서 나오는 CO₂와 원료가 분해될 때 나오는 CO₂는 원인이 다릅니다. 재생 전기로 열을 공급해도 같은 양의 탄산칼슘을 분해하면 공정 배출이 남습니다. 이 게임은 모든 CaO가 탄산칼슘에서 온다고 두며, 클링커의 다른 산화물·원료 불순물·공정 분진 등은 생략했습니다. 그래서 실제 공장의 정밀 배출계산식은 아닙니다.</p>
  </details>
  <details class="reveal cc-science">
    <summary>탄소 보존과 도표의 경계</summary>
    <p>도표는 석회석과 연료에 들어 있던 탄소를 따라갑니다. 산소와 수소가 더해져 분자가 달라져도 탄소 원자의 양은 보존됩니다. 모든 흐름을 같은 CO₂ 기준 질량으로 환산하므로 서로 더할 수 있습니다. 입력 CO₂ 기준량에 12/44를 곱하면 실제 탄소 질량이 됩니다.</p>
    <p>들어온 탄소는 굴뚝 배출, 합성연료 사용, 저장 누출, 저장 재고 증가, 광물 속 탄소로 나뉩니다. 장부의 공제액을 물리 흐름에서 빼면 질량 보존이 깨집니다. 전력 자체는 탄소가 아니며, 발전소의 탄소는 이 공장 흐름도의 밖에서 간접 배출로 따로 계산합니다. 아주 작은 흐름은 1px로 보여 주므로 선 폭의 합보다 숫자 수지를 확인해야 합니다.</p>
  </details>
  <details class="reveal cc-science">
    <summary>포집의 에너지 부담</summary>
    <p>포집은 CO₂를 없애는 반응이 아니라 모으는 과정입니다. 흡수제를 재생할 열이 필요하며 이 모형에서는 폐열을 먼저 쓰고 부족분을 가스로 공급합니다. 추가 가스가 CO₂를 내고 그 일부를 다시 포집하므로 필요한 열도 증가합니다.</p>
    <p>추가 가스 CO₂를 X, 원래 발생량을 G₀, 실효 포집률을 r, 폐열을 H<sub>w</sub>라 하면 C=r(G₀+X), X=0.056×max(0,3C−H<sub>w</sub>)입니다. 이를 풀면 X=max(0,0.056(3rG₀−H<sub>w</sub>)/(1−0.168r))입니다. 이 식은 추가 가스의 배출도 같은 포집계통에 넣는다는 가정에서만 성립합니다. 현실의 설비 배치와 열 회수 조건을 확인해야 합니다.</p>
  </details>
  <details class="reveal cc-science">
    <summary>합성연료와 장부 규칙</summary>
    <p>이 게임의 합성연료는 메탄올입니다. CO₂ + 3H₂ → CH₃OH + H₂O이므로 CO₂ 44 t을 전환할 때 H₂ 6 t이 필요합니다. 물을 전기분해해 그 수소를 만들며, 전력 55 MWh/t H₂를 적용했습니다. 수율과 그해 사용률은 모두 100%로 단순화했습니다.</p>
    <p>메탄올을 사용하면 탄소는 다시 대기로 갑니다. 클링커 75%, 포집 60%, 합성연료 80%인 같은 계획에서 인정률만 0%에서 100%로 바꾸면 순조로운 전환의 장부상 감축률이 12.3%에서 54.8%로 바뀌지만 물리적 대기 배출은 1.170 Mt/년, 총전력은 4.521 TWh/년으로 같습니다. 인정은 배출의 측정이 아니라 장부 규칙의 선택입니다.</p>
    <p>그렇다고 합성연료의 모든 용도가 무의미하다는 결론은 아닙니다. 실제로 대신 쓰지 않게 된 화석연료, 전력의 출처, 공장과 연료 사용자 사이의 이중 계산을 함께 확인해야 합니다. 이 모형은 그 대체 편익을 계산하지 않아 합성연료의 전체 가치를 평가할 수 없습니다.</p>
  </details>
  <details class="reveal cc-science">
    <summary>지중 저장과 광물화</summary>
    <p>지중 저장은 CO₂를 다공성 암석의 공극에 넣고 위의 덮개암 등으로 이동을 제한하는 방법입니다. 빈 동굴에 넣는 모형이 아닙니다. 부지 조사, 주입, 압력 관리, 장기 감시와 책임의 지속이 필요합니다. 광물화는 탄산염 고체로 탄소를 고정하는 반응이며, 예로 CaO + CO₂ → CaCO₃를 들 수 있습니다.</p>
    <p>새 CaO를 만들려고 석회석을 태우면 CO₂가 먼저 나옵니다. 따라서 이 게임의 광물화 원료는 이미 존재하는 반응성 잔여 물질로 한정하고 연간 처리 상한을 둡니다. 광물화 준비·분쇄·수송과 장기 용출은 계산하지 않았으므로 전 과정의 순감축이라고 읽으면 안 됩니다.</p>
    <p>연누출률 ℓ가 일정하고 추가 주입이 없다면 한 번 저장한 물량의 n년 누적 누출 비율은 1−(1−ℓ)ⁿ입니다. 게임의 기술 지연 값 ℓ=0.0005를 1,000년 그대로 적용하는 생각 실험에서는 약 39.4%입니다. 이는 실제 저장소의 누출 예측이 아닙니다. IPCC 특별보고서(2005)는 적절히 고르고 관리한 저장소라면 1,000년 동안 99% 넘게 남아 있을 가능성이 높다고 평가했고, 이는 연누출률 약 0.00001 이하에 해당합니다. 이 게임의 원료 부족(0.00005)과 기술 지연(0.0005)은 그보다 5배·50배 새는 부지를 일부러 가정한 값입니다. 이 생각 실험의 값은 올해 저장분의 1년 누출을 넣는 기본 결과와 섞어 더하지 않습니다.</p>
  </details>
  <details class="reveal cc-science">
    <summary>생물 기원 탄소와 빠른·느린 순환</summary>
    <p>식물의 성장과 분해·연소는 비교적 빠른 탄소 순환에, 지질 저장과 암석의 형성·풍화는 긴 시간 규모의 순환에 연결됩니다. 바이오 연료도 타는 순간 CO₂를 냅니다. 재성장으로 흡수될 가능성과 지금 굴뚝에서 나오는 양은 다른 문제입니다.</p>
    <p>이 게임은 혼합연료 탄소의 50%를 생물 기원으로 두고 그중 포집되지 않은 굴뚝 배출을 장부에서 공제합니다. 토지 이용 변화, 자원 재생 속도, 시간 지연, 운송, 다른 용도로 쓸 가능성을 조사한 결과가 아니라 고정 가정입니다. 물리적 대기 배출에서는 이 탄소를 빼지 않습니다. 생물 기원 CO₂를 포집했다고 음의 배출을 추가 인정하지도 않습니다. 나머지 50%는 플라스틱 같은 화석 기원 탄소이며, 석탄과 똑같이 장부에 셉니다. 이 혼합연료의 계수가 석탄보다 조금 낮은 것은 수소가 많은 폐플라스틱이 섞였다고 가정했기 때문입니다. 목재 같은 순수 바이오매스는 같은 열을 낼 때 석탄보다 CO₂를 더 많이 내기도 합니다.</p>
  </details>
  <details class="reveal cc-limits">
    <summary>모형이 단순화한 것과 빠진 것</summary>
    <ul>
      <li>이 게임의 상한(수요 감축 30%, 클링커 비율 하한 50%, 바이오 40%, 전기 30%)에서는 포집 없이 세 미래 모두 장부상 감축률 60%에 이르는 계획이 없습니다. 기술 지연 미래(가동률 60%)에서 ‘산업 유지와 포집 중심’ 예시 계획의 물리적 대기 배출 0.608 Mt/년은 포집 없는 계획의 최솟값 0.618 Mt/년보다 적습니다. 그러나 전력 간접 배출까지 더하면 이 예시는 0.703 Mt/년으로, 포집 없는 계획의 최솟값 0.690 Mt/년보다 많아집니다. 이 비교는 생산 2.000 Mt인 포집 예시와 수요를 30% 줄인 1.400 Mt 계획의 총량 비교입니다. 포집 예시에도 같은 수요 감축을 더하면 물리적 배출과 전력 간접 배출의 합은 0.482 Mt/년입니다. 시멘트 1 t당으로는 예시 A 0.352, 예시 B 0.493 t으로 순위가 뒤집히지 않습니다. 비교할 때는 배출 경계와 함께 총량인지 원단위인지 밝혀야 합니다. 이 결과는 공정 배출의 화학과 이 게임이 정한 가동률·전력 계수에서 나왔습니다. 기술 지연에서 장부상 감축률이 오르는 계획도 있습니다. 미래마다 전력 계수와 저장 누출률 등이 달라지므로, 포집 가동률 하나만으로 그 차이를 설명할 수 있는지 성찰해 보세요. 실제 포집 설비의 장기 가동 실적과 저장소 확보는 불확실하며, 목표의 수준·시점과 모형 밖의 수단도 논의 대상입니다.</li>
      <li>한 해의 일정한 가동 조건을 계산하므로 2040년까지의 건설·투자·전환 순서, 설비 가동의 시간대 차이, 누적 배출을 보여 주지 않습니다. 저장 재고는 그해 증가분만 계산합니다.</li>
      <li>클링커를 CaO 함량만으로 다루고 다른 산화물, 원료의 실제 조성, 강도·내구성·분쇄성의 차이를 뺐습니다. 혼합재 비율만 맞으면 어떤 건물에도 사용할 수 있다는 뜻은 아닙니다.</li>
      <li>전기 가열과 포집열용 가스의 열 공급 효율을 100%로 두었습니다. 폐열의 온도·회수 손실과 포집·광물화·메탄올 합성의 모든 보조 동력·물 소비를 자세히 계산하지 않았습니다.</li>
      <li>콘크리트가 수십 년에 걸쳐 CO₂를 다시 흡수하는 재탄산화를 뺐습니다. 공정 배출이 영구히 전혀 흡수되지 않는다는 뜻은 아닙니다. 한 연구(Xi 외, 2016)는 1930~2013년 세계 시멘트가 그동안 나온 공정 배출의 약 43%를 수십 년에 걸쳐 다시 흡수했다고 추정했습니다. 흡수량과 시점·노출 면적·검증 방법을 정해야 장부에 반영할 수 있습니다.</li>
      <li>광산·채굴·수송·설비 건설의 수명주기 배출, 메탄·아산화질소·대기오염물질, 발전 설비 증설과 송전 제약을 뺐습니다. 전력 간접 배출만 더한다고 완전한 수명주기 평가가 되지 않습니다.</li>
      <li>수요 절감은 같은 서비스와 안전을 유지하고 수입으로 대체하지 않는다고 가정했습니다. 실제 수요 추세, 가격에 따른 수요 반응, 국제 탄소 가격, 수입 시멘트 경쟁은 계산하지 않았습니다.</li>
      <li>가격과 지원 비용은 만든 계수입니다. 수요 감축으로 t당 고정비가 오르는 몫과 설계·검증 비용은 가격에 넣지 않아, 가격 부담을 기준으로 삼으면 수요 감축이 실제보다 유리해 보일 수 있습니다. 업무 방향 세 줄은 인원수·순고용 예측이 아니며, 생물 기원 50% 장부 공제와 합성연료 인정률도 합의가 필요한 규칙입니다.</li>
      <li>세 미래는 가능한 조건을 묶은 예시이며 확률이나 위험의 모든 조합이 아닙니다. 파레토 점검에 남는 계획도 정답이 아닙니다. 모형 밖 비용과 권리를 더하면 판단은 달라질 수 있습니다.</li>
    </ul>
  </details>
</div>`;
  KCP.games[ID] = {
    brief: () => BRIEF,
    renderPrep,
    questions(state) { return questionList(normalize(state).locked); },
    recap,
    reflectExtra: () => REFLECT,
    model: {
      calc,compute:calc,captureShare,captureShareText,physicalLine,reaches,fmt,fmtRed,fmtGap,signed,
      normalize:normalized,normalizePlan:planOf,validPlan,validLocked,
      questionKeys:state=>questionList(normalized(state && state.game).locked).map(q=>q.k),
      questions:state=>questionList(normalized(state && state.game).locked),
      flows,ports,BASE,EPS,FUT:clone(FUT),DEFAULT:{...DEFAULT}
    }
  };
  if(!KCP.ORIGINAL_ORDER.includes(ID)) KCP.ORIGINAL_ORDER.push(ID);
})();
