(function () {
  "use strict";
  const KCP = window.KCP;
  const ID = "s-variant-desk";
  const esc = value => KCP.esc(String(value));
  const CARDS = [
    {id:"P-01", e:[3,2,3,1,2], truth:"P", gene:"AD", pen:[40,70], secondary:false, minor:false, noCare:false, family:true, refused:true, a:[1,1,0,1], miss:"m1"},
    {id:"P-02", e:[2,2,3,2,1], truth:"P", gene:"AR", pen:[50,80], secondary:false, minor:false, noCare:false, family:false, refused:false, a:[1,0,1,0], miss:"m2"},
    {id:"P-03", e:[2,1,2,2,2], truth:"P", gene:"XH", pen:[30,60], secondary:true, minor:true, noCare:false, family:false, refused:false, a:[1,0,0,1], miss:"m3"},
    {id:"P-04", e:[1,2,3,1,2], truth:"P", gene:"AD", pen:[30,60], secondary:true, minor:false, noCare:true, family:false, refused:false, a:[0,0,0,1], miss:"m4"},
    {id:"P-05", e:[0,0,0,1,0], truth:"P", gene:"AD", pen:[20,40], secondary:false, minor:false, noCare:false, family:false, refused:false, a:[1,0,0,0], miss:"m5"},
    {id:"P-06", e:[0,1,0,0,0], truth:"P", gene:"AR", pen:[40,70], secondary:false, minor:false, noCare:false, family:false, refused:false, a:[0,0,1,1], miss:"m6"},
    {id:"P-07", e:[-1,-2,-2,3,0], truth:"B", gene:"AD", pen:[20,50], secondary:false, minor:false, noCare:false, family:false, refused:false, a:[1,1,0,0], miss:"m1"},
    {id:"P-08", e:[0,-1,-2,3,0], truth:"B", gene:"AD", pen:[10,30], secondary:false, minor:false, noCare:true, family:false, refused:false, a:[0,0,0,0], miss:"m4"},
    {id:"P-09", e:[0,0,0,1,0], truth:"B", gene:"AD", pen:[20,40], secondary:false, minor:false, noCare:false, family:true, refused:false, a:[1,0,0,0], miss:"m5"},
    {id:"P-10", e:[0,1,0,0,0], truth:"B", gene:"AR", pen:[40,70], secondary:false, minor:false, noCare:false, family:false, refused:false, a:[0,0,1,1], miss:"m6"},
    {id:"P-11", e:[-2,1,-1,-1,-1], truth:"B", gene:"XH", pen:[30,50], secondary:false, minor:true, noCare:false, family:false, refused:false, a:[1,0,0,0], miss:"m3"},
    {id:"P-12", e:[-1,2,-2,0,-1], truth:"B", gene:"AD", pen:[20,50], secondary:true, minor:false, noCare:false, family:false, refused:false, a:[1,0,1,0], miss:"m2"},
    {id:"P-13", e:[1,1,0,2,0], truth:"U", gene:"AD", pen:[20,60], secondary:false, minor:false, noCare:false, family:false, refused:false, a:[1,0,0,0], miss:"m5"},
    {id:"P-14", e:[0,2,1,-1,1], truth:"U", gene:"AR", pen:[30,70], secondary:false, minor:false, noCare:false, family:false, refused:false, a:[0,0,1,1], miss:"m6"},
    {id:"P-15", e:[-1,1,2,0,1], truth:"U", gene:"XX", pen:[10,40], secondary:false, minor:false, noCare:false, family:false, refused:false, a:[1,0,1,0], miss:"m2"},
    {id:"P-16", e:[0,0,1,1,-1], truth:"U", gene:"AD", pen:[20,50], secondary:false, minor:false, noCare:false, family:false, refused:false, a:[0,0,0,1], miss:"m4"}
  ];
  const DISPLAY_ORDER = ["P-01","P-07","P-13","P-02","P-09","P-14","P-03","P-08","P-15","P-04","P-10","P-16","P-05","P-11","P-06","P-12"];
  const MISS = {
    m1:"병원성인데 보고하지 않으면 정기 관찰과 예방적 개입을 검토할 기회가 늦어질 수 있습니다.",
    m2:"병원성인데 보고하지 않으면 약물 사용 가능성과 경과 관찰을 검토할 기회가 늦어질 수 있습니다.",
    m3:"병원성인데 보고하지 않으면 성인기 관찰 계획을 미리 의논할 기회가 줄어들 수 있습니다.",
    m4:"병원성인데 보고하지 않으면 생활 계획과 향후 정보 수신 여부를 의논할 기회가 줄어들 수 있습니다.",
    m5:"병원성인데 보고하지 않으면 변화가 생겼을 때 관찰을 시작하는 시점이 늦어질 수 있습니다.",
    m6:"병원성인데 보고하지 않으면 약물 검토와 가족의 추가 검사 선택을 의논할 기회가 늦어질 수 있습니다."
  };
  const WEIGHT_NAMES = ["가계 내 공동분리","집단 내 빈도","기능 실험","컴퓨터 예측","같은 위치의 다른 변이 보고"];
  const GROUP_NAMES = {R:"보고", C:"상담 후 결정", N:"보고하지 않음"};
  const ACTION_NAMES = ["정기 영상 검사","예방적 수술 상담","약물","추가 가족 검사"];
  const POLICY_KEYS = ["secondary","minors","noCare","relatives"];
  const DEFAULTS = {weights:[2,1,3,1,1], t1:12, t2:1, overrides:{}, policyMode:"pending", policy:{secondary:null,minors:null,noCare:null,relatives:null}, piPct:1, piTouched:false, replannedAfterReveal:false};
  const SNAP_KEYS = ["version","weights","t1","t2","overrides","policyMode","policy","piPct","piTouched","replannedAfterReveal","plan"];
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const validReason = value => typeof value === "string" && value.trim().length > 0 && value.trim().length <= 280 && !/[\r\n\u2028\u2029]/.test(value);
  const ordered = ids => DISPLAY_ORDER.filter(id => ids.includes(id));
  const idText = ids => ordered(ids).join(", ") || "없음";
  const ready = s => s.policyMode === "skip" || (s.policyMode === "apply" && POLICY_KEYS.every(key => typeof s.policy[key] === "boolean"));
  function normalizeSettings(raw) {
    const s = object(raw) ? raw : {};
    const weights = Array.isArray(s.weights) && s.weights.length === 5 && s.weights.every(Number.isInteger) ? s.weights.map(w => clamp(w,0,3)) : [...DEFAULTS.weights];
    const t1 = finite(s.t1) ? clamp(Math.round(s.t1),-30,47) : DEFAULTS.t1;
    let t2 = finite(s.t2) ? clamp(Math.round(s.t2),-31,46) : DEFAULTS.t2;
    if (t2 >= t1) t2 = t1 - 1;
    const policy = {};
    POLICY_KEYS.forEach(key => { const v = object(s.policy) && own(s.policy,key) ? s.policy[key] : null; policy[key] = typeof v === "boolean" ? v : null; });
    const overrides = {};
    CARDS.forEach(v => {
      const ov = object(s.overrides) && own(s.overrides,v.id) ? s.overrides[v.id] : null;
      if (Object.keys(overrides).length < 3 && object(ov) && typeof ov.to === "string" && own(GROUP_NAMES,ov.to) && validReason(ov.reason)) overrides[v.id] = {to:ov.to, reason:ov.reason.trim()};
    });
    return {version:1,weights,t1,t2,overrides,policyMode:["pending","skip","apply"].includes(s.policyMode) ? s.policyMode : "pending",policy,
      piPct:finite(s.piPct) ? Math.round(clamp(s.piPct,0.2,5)*10)/10 : 1, piTouched:s.piTouched === true,
      replannedAfterReveal:s.replannedAfterReveal === true, plan:typeof s.plan === "string" ? s.plan.slice(0,1000) : ""};
  }
  function validSnapshot(s) {
    if (!object(s) || SNAP_KEYS.some(key => !own(s,key)) || s.version !== 1) return false;
    if (!Array.isArray(s.weights) || s.weights.length !== 5 || !s.weights.every(w => Number.isInteger(w) && w >= 0 && w <= 3)) return false;
    if (!Number.isInteger(s.t1) || s.t1 < -30 || s.t1 > 47 || !Number.isInteger(s.t2) || s.t2 < -31 || s.t2 > 46 || s.t2 >= s.t1) return false;
    if (!finite(s.piPct) || s.piPct < 0.2 || s.piPct > 5 || Math.abs(s.piPct*10-Math.round(s.piPct*10)) > 1e-9) return false;
    if (typeof s.piTouched !== "boolean" || typeof s.replannedAfterReveal !== "boolean" || typeof s.plan !== "string" || s.plan.length > 1000) return false;
    if (!["skip","apply"].includes(s.policyMode) || !object(s.policy) || POLICY_KEYS.some(key => !own(s.policy,key) || (typeof s.policy[key] !== "boolean" && !(s.policyMode === "skip" && s.policy[key] === null)))) return false;
    if (!object(s.overrides) || Object.keys(s.overrides).length > 3) return false;
    return Object.keys(s.overrides).every(id => CARDS.some(v => v.id === id) && object(s.overrides[id]) && typeof s.overrides[id].to === "string" && own(GROUP_NAMES,s.overrides[id].to) && validReason(s.overrides[id].reason) && s.overrides[id].reason === s.overrides[id].reason.trim());
  }
  function snapshot(s) { return Object.fromEntries(SNAP_KEYS.map(key => [key,clone(s[key])])); }
  function normalizeGame(raw) {
    const old = object(raw) ? raw : {};
    const g = {...normalizeSettings(old),stage1Confirmed:old.stage1Confirmed === true,revealed:old.revealed === true,truthSeen:old.truthSeen === true,
      locked:null,tab:old.tab === "voices" ? "voices" : "evidence",selectedId:CARDS.some(v => v.id === old.selectedId) ? old.selectedId : null,overrideDraft:null};
    const draft = old.overrideDraft;
    if (object(draft) && CARDS.some(v => v.id === draft.id) && typeof draft.to === "string" && own(GROUP_NAMES,draft.to) && typeof draft.reason === "string" && draft.reason.length <= 280) g.overrideDraft = {id:draft.id,to:draft.to,reason:draft.reason};
    if (old.version !== 1 || (old.locked != null && !validSnapshot(old.locked))) {
      g.stage1Confirmed = false; g.revealed = false; g.policyMode = "pending";
    } else if (validSnapshot(old.locked)) {
      g.locked = snapshot(old.locked);
      Object.assign(g,clone(g.locked),{stage1Confirmed:true,revealed:true,truthSeen:true});
    }
    if (!g.stage1Confirmed) { g.policyMode = "pending"; g.revealed = false; }
    if (!ready(g)) g.revealed = false;
    if (g.revealed) g.truthSeen = true;
    return g;
  }
  function ensureGame(state) {
    state.game = normalizeGame(state.game);
    return state.game;
  }
  function classify(score, s) { return score >= s.t1 ? "R" : score >= s.t2 ? "C" : "N"; }
  function classifyRows(s) {
    return CARDS.map(v => {
      const score = v.e.reduce((sum,e,k) => sum+e*s.weights[k],0);
      const auto = classify(score,s), ov = s.overrides[v.id];
      return {...v,e:[...v.e],pen:[...v.pen],a:[...v.a],score,auto,group:ov ? ov.to : auto,manual:!!ov};
    });
  }
  function confusion(rows, positiveIds) {
    const out = {TP:0,FP:0,FN:0,TN:0};
    for (const v of rows) { if (v.truth === "U") continue; const yes = positiveIds.has(v.id); out[v.truth === "P" ? (yes ? "TP" : "FN") : (yes ? "FP" : "TN")]++; }
    return out;
  }
  function wilson(k,n) {
    if (n === 0) return null;
    const z = 1.96, z2 = z*z, p = k/n, den = 1+z2/n;
    const center = (p+z2/(2*n))/den, half = z*Math.sqrt(p*(1-p)/n+z2/(4*n*n))/den;
    return [k === 0 ? 0 : Math.max(0,center-half),k === n ? 1 : Math.min(1,center+half)];
  }
  function bayes(se,sp,pi) { const numerator = se*pi, denominator = numerator+(1-sp)*(1-pi); return denominator === 0 ? null : numerator/denominator; }
  function ppvRange(cm,pi,universal=false) {
    if (cm.TP+cm.FP === 0) return null;
    if (universal) return [pi,pi];
    const se = wilson(cm.TP,cm.TP+cm.FN), sp = wilson(cm.TN,cm.TN+cm.FP);
    if (!se || !sp) return null;
    const lo = bayes(se[0],sp[0],pi), hi = bayes(se[1],sp[1],pi);
    return [lo === null ? 0 : lo,hi === null ? 1 : hi];
  }
  function pctRange(range) {
    if (!range) return "계산하지 않음";
    return `${(Math.floor(range[0]*1000+1e-10)/10).toFixed(1)}~${(Math.ceil(range[1]*1000-1e-10)/10).toFixed(1)}%`;
  }
  function ppvText(range) {
    if (!range) return "양성 판정이 없어 계산하지 않음";
    return range[0] === range[1] ? `${(range[0]*100).toFixed(1)}%(범위 없음 — 전부 양성인 규칙에서는 π와 같습니다)` : pctRange(range);
  }
  function fraction(a,b) { return b ? `${a}/${b}` : "계산 불가"; }
  function compute(input) {
    const s = validSnapshot(input && input.locked) ? snapshot(input.locked) : normalizeSettings(input);
    if (!ready(s)) return null;
    const rows = classifyRows(s), ids = groups => new Set(rows.filter(v => groups.includes(v.group)).map(v => v.id));
    const report = ids(["R"]), inclusive = ids(["R","C"]), row = id => rows.find(v => v.id === id);
    // 정책 스위치는 '보고'와 '상담 후 결정' 두 칸에 같은 제외 규칙을 적용한다.
    const allowed = v => s.policyMode !== "apply" || ((s.policy.secondary || !v.secondary) && (s.policy.minors || !v.minor) && (s.policy.noCare || !v.noCare));
    const final = new Set([...report].filter(id => allowed(row(id)))), consult = new Set([...ids(["C"])].filter(id => allowed(row(id))));
    const family = s.policyMode === "apply" && s.policy.relatives ? rows.filter(v => v.family && v.group !== "N").map(v => v.id) : [];
    // 검토 결함 0·7: 보고 시점의 요청은 숨은 추적 결과와 무관하게 센다. 미확정 카드의 몫은 사후에 따로 표시한다.
    const actions = [0,0,0,0], uncertainActions = [0,0,0,0], recontact = rows.filter(v => final.has(v.id) && v.truth === "U").map(v => v.id);
    rows.filter(v => final.has(v.id)).forEach(v => v.a.forEach((n,k) => { actions[k] += n; if (v.truth === "U") uncertainActions[k] += n; }));
    const participantConsult = new Set([...final,...consult]), demand = participantConsult.size+family.length;
    const r = confusion(rows,report), rc = confusion(rows,inclusive), f = confusion(rows,final), pi = s.piPct/100;
    // 증거값의 최솟값은 가계·빈도·기능 −2, 예측·같은 위치 −1이다. 이 점수까지 양성이면 어떤 카드든 양성인 규칙이다.
    const w = s.weights, noManual = Object.keys(s.overrides).length === 0, minScore = -2*(w[0]+w[1]+w[2])-(w[3]+w[4]);
    const universalR = noManual && s.t1 <= minScore, universalRC = noManual && s.t2 <= minScore;
    const ranges = {r:ppvRange(r,pi,universalR),rc:ppvRange(rc,pi,universalRC)};
    const pens = new Map();
    rows.filter(v => final.has(v.id) && v.truth !== "U").forEach(v => pens.set(v.pen.join("-"),v.pen));
    const onset = [...pens].sort((a,b) => a[1][0]-b[1][0] || a[1][1]-b[1][1]).map(([key,pen]) => ({key,pen,range:!ranges.r ? null : [ranges.r[0]*pen[0]/100,ranges.r[1]*pen[1]/100]}));
    return {rows,report:[...report],inclusive:[...inclusive],final:[...final],removed:[...report].filter(id => !final.has(id)),family,
      consultRemoved:[...ids(["C"])].filter(id => !consult.has(id)),recontact,overreported:rows.filter(v => v.truth === "B" && final.has(v.id)).map(v => v.id),
      refusalWarning:family.some(id => rows.find(v => v.id === id).refused),actions,uncertainActions,participantConsult:[...participantConsult],demand,waiting:demand>8,
      groups:{R:report.size,C:ids(["C"]).size,N:ids(["N"]).size},r,rc,f,ranges,onset,universal:{r:universalR,rc:universalRC},
      missed:rows.filter(v => v.truth === "P" && !final.has(v.id)).map(v => ({id:v.id,group:v.group,text:MISS[v.miss]})),
      uncertain:rows.filter(v => v.truth === "U").map(v => ({id:v.id,group:v.group,reported:final.has(v.id)}))};
  }
  const EVIDENCE = [
    {3:"가상 가계의 여러 구성원에서 변이와 성인기 증상이 함께 관찰되었습니다.",2:"가상 가계의 일부 구성원에서 변이와 성인기 증상이 함께 관찰되었습니다.",1:"함께 관찰된 사례가 있으나 가계 자료가 적습니다.",0:"공동분리를 판단할 가계 자료가 부족합니다.","-1":"증상이 있는 가상 가계 구성원 가운데 이 변이가 없는 사람이 한 명 있습니다.","-2":"증상이 있는 가상 가계 구성원 여러 명에게서 이 변이가 발견되지 않았습니다."},
    {2:"가상 비교 자료에서 대립유전자 빈도는 0.01%입니다.",1:"가상 비교 자료에서 대립유전자 빈도는 0.10%입니다.",0:"빈도를 판단할 비교 자료가 없습니다.","-1":"가상 비교 자료에서 대립유전자 빈도는 2.00%입니다.","-2":"가상 비교 자료에서 대립유전자 빈도는 8.00%입니다."},
    {3:"반복한 가상 세포 실험에서 관련 단백질 기능 저하가 관찰되었습니다.",2:"한 종류의 가상 실험에서 관련 단백질 기능 저하가 관찰되었습니다.",1:"가상 실험의 기능 변화가 작거나 재현 자료가 적습니다.",0:"해석 가능한 기능 실험 자료가 없습니다.","-1":"가상 실험에서 기능 저하가 뚜렷하지 않았습니다.","-2":"반복한 가상 실험에서 측정한 기능이 유지되었습니다."},
    {3:"가상 예측 도구는 기능 영향 가능성을 높게 표시했습니다.",2:"가상 예측 도구는 기능 영향 가능성을 다소 높게 표시했습니다.",1:"가상 예측 도구는 약한 영향 가능성을 표시했습니다.",0:"예측 자료가 없거나 도구 간 방향이 다릅니다.","-1":"가상 예측 도구는 기능 영향 가능성을 낮게 표시했습니다."},
    {2:"같은 위치의 다른 변이와 관련된 기능 저하 보고가 여러 건 있습니다.",1:"같은 위치의 다른 변이에 관한 기능 저하 보고가 한 건 있습니다.",0:"같은 위치의 다른 변이에 관한 해석 가능한 보고가 없습니다.","-1":"같은 위치의 다른 변이에서 기능 유지가 보고되었습니다."}
  ];
  const EVIDENCE_NOTES = [
    "변이가 있는데 증상이 없는 구성원은 침투율이 낮거나 아직 발병 전일 수 있어, 이 게임에서는 반대 근거로 세지 않았습니다. 다른 원인으로 같은 증상이 생길 수도 있어 이것도 확정 근거는 아닙니다.",
    "이 값은 질환 유병률도, 검사한 변이 중 병원성 변이의 비율 π도 아닙니다. 드물다는 사실만으로 병원성이 입증되지는 않습니다. 사람마다 드문 변이를 많이 가지고 있고, 그 대부분은 병원성이 아닙니다.",
    "세포에서 측정한 기능이 유지되어도 모든 조직·시기·기능에서 영향이 없다는 뜻은 아닙니다.","",
    "다른 변이의 보고는 참고 근거입니다. 같은 위치라는 이유만으로 효과가 같다고 단정할 수 없습니다."
  ];
  const MATERIAL = "모든 카드의 질환은 성인기에 발병할 수 있다는 설정입니다. 변이가 실제로 병원성이고 카드에 적힌 유전형을 가졌을 때, 예방적 개입 전 성인기 관찰 기간에 발병하는 비율을 ‘침투율’로 둡니다. 기간은 모든 카드에서 성인기 전체로 통일한 가정이며 정확한 발병 시점은 계산하지 않습니다. 비병원성·미확정 카드에 적힌 침투율도 ‘병원성이라고 가정할 경우’의 조건부 자료입니다. 예방 수단의 효과 크기와 검사·치료의 실제 필요성은 계산하지 않습니다.";
  const GENES = {AD:"상염색체 우성·해당 변이 이형접합",AR:"상염색체 열성·상동 염색체의 다른 쪽 사본에 별도의 병원성 변이가 확인된 배치(이 변이가 병원성이라면 두 변이가 서로 다른 사본에 하나씩 있는 복합 이형접합이 되는 배치)",XH:"X 연관·X가 한 개인 유전형의 해당 변이",XX:"X 연관·X가 두 개인 유전형의 이형접합"};
  const VOICES = [
    ["대비하고 싶은 참여자","확실하지 않은 부분도 듣고 준비하고 싶습니다. 다만 가능성을 확정된 미래처럼 말하지 말아 주세요."],
    ["듣지 않을 권리를 원하는 참여자","지금 바꿀 수 없는 위험은 듣고 싶지 않습니다. 받을 정보의 범위를 제가 고르게 해 주세요."],
    ["참여자의 혈족","저도 같은 변이를 가질 수 있습니다. 미리 알아서 대비할 수 있다면 알고 싶지만, 제가 동의하지 않은 검사 결과가 어떤 경로로 전해질지는 걱정됩니다."],
    ["혈족 연락을 원하지 않는 참여자","제 검사 결과는 제 정보입니다. 가족에게 언제, 어떻게 말할지는 제가 정하고 싶습니다. 가족 사이에는 사업이 모르는 사정도 있습니다."],
    ["미성년 참여자의 보호자","미리 준비할 기회가 필요합니다. 아이가 성인이 되어 직접 결정할 기회도 남겨 두고 싶습니다."],
    ["임상 유전 상담사와 의료진","보고가 늘면 불필요한 검사 검토가 늘 수 있고, 보고가 줄면 대비 기회를 놓칠 수 있습니다. 불확실성을 설명할 시간이 필요합니다."],
    ["사업 운영진","한 차례에 상담 8건을 맡을 수 있습니다. 대기하는 사람에게 순서와 이유를 설명할 운영 방안이 필요합니다."],
    ["차별을 걱정하는 참여자 모임","정보가 보험이나 고용에서 불리하게 쓰일까 걱정합니다. 법으로 유전정보에 의한 차별을 금지해도 실제로 지켜지는지는 따로 살펴야 합니다. 열람 범위와 보관 기간을 정해 주세요."],
    ["연구자","미확정 사례에 새 증거가 쌓이면 해석이 바뀔 수 있습니다. 재검토에 참여할지와 다시 연락받을지를 따로 선택하게 해 주세요."]
  ];
  const POLICIES = {
    secondary:["검사 목적과 무관한 2차 발견도 보고","2차 발견 표식 카드(P-03·P-04·P-12)도 1단계 분류대로 보고하거나 상담합니다. 증거로 ‘보고’에 들지 않은 카드를 정책으로 올리지 않습니다. 실제 ACMG 2차 발견 목록은 예방·치료 조치가 가능한 유전자만 담습니다.","2차 발견 표식 카드는 1단계에서 ‘보고’나 ‘상담 후 결정’으로 분류되었더라도 최종 보고 목록과 참여자 상담에서 뺍니다."],
    minors:["미성년 참여자(보호자)에게 성인기 위험 보고","성인이 된 뒤 직접 선택할 기회와 현재의 준비 기회를 함께 검토하세요.","P-03·P-11이 보고 목록이나 상담 후 결정 칸에 있으면 둘 다에서 제외합니다."],
    noCare:["현재 예방·치료법이 없는 질환도 보고","정보로 생활을 계획할 수 있지만 바꿀 수 없는 위험을 듣는 부담도 있습니다.","P-04·P-08이 보고 목록이나 상담 후 결정 칸에 있으면 둘 다에서 제외합니다."],
    relatives:["참여자가 거부해도 혈족 고지를 검토","P-01·P-09 가운데 1단계에서 ‘보고하지 않음’이 아닌 카드에 혈족 고지 검토 대상이 생깁니다. P-01은 연락 거부 사례입니다.","사업이 혈족에게 별도로 연락하지 않는 안입니다. 참여자에게 선택지를 설명할 수 있습니다."]
  };
  const UNCERTAIN = "현재 자료로는 판단할 수 없다 — 이 게임이 정한 추적 뒤에도 판단하지 못한 가상 사례";
  const VUS_RULE = "의미불명 변이(VUS)는 보고 시점의 증거로 정하는 분류이며, 실제 지침(Richards 외 2015, ACMG/AMP)은 이를 임상 결정에 쓰지 말라고 권고합니다. 이 게임의 보고·상담·미보고는 변이 등급이 아닙니다. 보고한 카드는 모두 조치 검토 요청에 넣고, 추적 뒤에도 미확정인 카드의 요청은 따로 표시합니다. 이는 VUS를 조치 근거로 오해하면 생길 수 있는 요청을 살피는 가정이며, 지침이 권하는 조치가 아닙니다. 재검토·재연락 등록도 함께 셉니다.";
  const OVER_HARM = "비병원성인데 보고하면 불필요한 정기 관찰이나 예방적 수술 상담을 검토하게 되고, 불안과 보험·고용에 대한 걱정이 생길 수 있습니다.";
  const FAMILY_WARNING = "P-01은 혈족 연락을 거부했습니다. 본인의 비밀과 혈족의 선택권을 함께 검토하세요.";
  const PHASE_NOTICE = "면접실과 성찰은 기준 확정 뒤 열립니다.";
  const SOURCE = '<span class="tag-mine vd-source">가상 자료</span>';
  // 명세 8.4 + 3차 검토 B: 후보·갈등 강도는 정책 적용 전 카드 상태만으로 정한다.
  // 거부한 혈족 사례 > 목적 안 미성년 > 목적 안 조치 없음 > 2차 발견 > 기타 혈족.
  // 중복 표식 P-03·P-04는 2차 발견에서 다룬다. 정책 값은 선택 뒤 문안에만 쓴다.
  const POLICY_FLAGS = {relatives:"family",minors:"minor",noCare:"noCare",secondary:"secondary"};
  function secondaryGuidance(rows) {
    const outside = rows.filter(v => v.noCare).map(v => v.id);
    return "실제 ACMG SF는 참여자가 거부하지 않으면 조치 가능한 유전자에 한해 2차 발견을 보고하도록 권고합니다." +
      (outside.length ? ` 예방·치료법이 없는 ${idText(outside)} 카드는 이 권고 밖입니다.` : "");
  }
  const POLICY_Q = {
    relatives:[(ids,rows) => rows.some(v => v.refused) ? "연락을 거부한 P-01의 참여자가 있는데도 혈족 고지를 검토 대상으로 삼았습니다. 본인의 비밀과 혈족의 위험·선택권 가운데 무엇을 앞세웠습니까?" : `참여자가 거부해도 혈족 고지를 검토하기로 했습니다(${ids}). 앞으로 연락을 거부하는 참여자가 생기면 이 원칙을 어떻게 설명하겠습니까?`,
      ids => `사업이 혈족에게 따로 연락하지 않기로 했습니다. 같은 변이를 가질 수 있는 ${ids} 카드 참여자의 혈족이 나중에 이 사실을 알게 된다면 어떻게 설명하겠습니까?`,"혈족 고지"],
    minors:[ids => `미성년 참여자(${ids})의 보호자에게 성인기 위험을 알리기로 했습니다. 해당 참여자가 성인이 되어 듣고 싶지 않았다고 말한다면 어떻게 설명하겠습니까?`,
      ids => `미성년이라는 이유로 ${ids} 카드를 보고와 상담에서 뺐습니다. 보호자가 지금 준비할 기회를 원한다면 어떻게 답하겠습니까?`,"미성년"],
    noCare:[ids => `예방·치료법이 없는 ${ids} 카드도 보고와 상담 대상에 남겼습니다. 듣지 않을 권리를 원하는 참여자에게 어떻게 설명하겠습니까?`,
      ids => `예방·치료법이 없다는 이유로 ${ids} 카드를 보고와 상담에서 뺐습니다. 생활 계획을 위해 정보를 원하는 참여자에게 어떻게 설명하겠습니까?`,"보고 원칙"],
    secondary:[(ids,rows) => `2차 발견이라는 이유로는 ${ids} 카드를 보고와 상담에서 제외하지 않기로 했습니다. ${secondaryGuidance(rows)} 목적 밖의 정보는 듣고 싶지 않다는 해당 참여자에게 어떻게 설명하겠습니까?`,
      (ids,rows) => `검사 목적과 무관하다는 이유로 2차 발견 표식 카드(${ids})를 보고와 상담에서 뺐습니다. ${secondaryGuidance(rows)} 이런 정보도 받겠다고 동의한 참여자에게 어떻게 설명하겠습니까?`,"2차 발견"]
  };
  function policyQuestion(s,r) {
    const affected = key => r.rows.filter(v => v[POLICY_FLAGS[key]] && v.group !== "N" &&
      (!["minors","noCare"].includes(key) || !v.secondary));
    const refusal = affected("relatives").some(v => v.refused);
    const priority = refusal ? ["relatives","minors","noCare","secondary"] : ["minors","noCare","secondary","relatives"];
    const key = priority.find(key => affected(key).length > 0);
    if (!key) return ["vd-policy-reason","개별 · 보고 원칙","네 보고 정책을 함께 적용한 결과를 바탕으로, 다른 카드 묶음에서도 유지할 원칙을 한 문장으로 말해 주세요."];
    const on = s.policy[key] === true, rows = affected(key);
    return [`vd-${key.toLowerCase()}-${on ? "on" : "off"}`,`개별 · ${POLICY_Q[key][2]}`,POLICY_Q[key][on ? 0 : 1](idText(rows.map(v => v.id)),rows)];
  }
  function questionsFromSnapshot(s) {
    if (!validSnapshot(s)) return [];
    const r = compute(s), qs = [], add = (k,tag,q) => qs.push({k,tag,q});
    const group = id => GROUP_NAMES[r.rows.find(v => v.id === id).group];
    const lose = "이 기준이 얻는 것과 잃는 것을 한 문장으로 말해 보세요.";
    add("vd-c1","공통 1 · 기준 먼저",(s.weights.every(w => w === 0) ? "무게를 모두 0으로 두어 증거에 무게를 두지 않았습니다. 두 문턱의 위치를 정한 판단 기준을 먼저 말해 주세요." : "가장 큰 무게를 둔 증거와 두 문턱의 위치를 정한 판단 기준을 먼저 말해 주세요."));
    if (r.r.TP >= 5 && r.r.TN <= 2) add("vd-error-more-report","공통 2 · 얻는 것과 잃는 것",`정책 적용 전 보고 분류에서 병원성 ${r.r.TP}장과 함께 비병원성 ${r.r.FP}장도 보고했습니다. 불필요한 관찰이나 수술 상담을 검토하게 될 사람을 떠올리며, ${lose}`);
    else if (r.r.TP <= 2 && r.rc.TP >= 5) add("vd-error-consult","공통 2 · 얻는 것과 잃는 것",`정책 적용 전 보고 분류에서는 병원성 ${r.r.TP}장만 바로 보고했고, 보고와 상담을 함께 세면 병원성 ${r.rc.TP}장과 비병원성 ${r.rc.FP}장이 상담 후 결정까지 올라왔습니다. 결정을 상담으로 미룬 ${lose}`);
    else if (r.r.TN >= 5 && r.r.TP <= 2) add("vd-error-more-miss","공통 2 · 얻는 것과 잃는 것",(r.r.FP === 0 ? `정책 적용 전 보고 분류에서 비병원성은 한 장도 보고하지 않았지만 병원성 ${r.r.FN}장도 보고하지 않았습니다.` : `정책 적용 전 보고 분류에서 비병원성 ${r.r.FP}장을 보고하고 병원성 ${r.r.FN}장은 보고하지 않았습니다.`)+` 그중 한 사람이 10년 뒤 진단받는다고 할 때, ${lose}`);
    else add("vd-error-balance","공통 2 · 얻는 것과 잃는 것",`정책 적용 전 보고 분류에서는 놓침 ${r.r.FN}장과 과보고 ${r.r.FP}장이 남았고, 보고와 상담을 함께 세면 상담까지 올라간 비병원성 ${r.rc.FP}장, 어느 쪽에도 들지 않은 병원성 ${r.rc.FN}장입니다. 어느 쪽 오류를 더 감수했는지 드러나게, ${lose}`);
    if (Object.keys(s.overrides).length) add("vd-manual","개별 · 수동 판단",`${Object.keys(s.overrides).length}장을 저울과 별도로 분류하고 이유를 남겼습니다. 그 이유를 다른 카드에도 적용할 규칙으로 바꾸겠습니까, 예외로 남기겠습니까?`);
    else if (s.weights[3] > 0 && s.weights[3] > Math.max(s.weights[0],s.weights[2])) add("vd-prediction","개별 · 예측 근거",`컴퓨터 예측에 가계 근거·기능 실험보다 큰 무게를 두었습니다. 예측만 높은 P-07은 ‘${group("P-07")}’, P-08은 ‘${group("P-08")}’입니다. 기능 실험과 예측이 다른 방향일 때 무엇을 추가로 확인하겠습니까?`);
    else if (s.weights[1] > 0 && s.weights[1] > Math.max(s.weights[0],s.weights[2])) add("vd-frequency","개별 · 빈도 근거",`집단 내 빈도에 가계 근거·기능 실험보다 큰 무게를 두었습니다. 드물지만 비병원성으로 설정된 P-11은 ‘${group("P-11")}’, P-12는 ‘${group("P-12")}’입니다. ‘드물다’는 근거를 어디까지 믿겠습니까?`);
    else if (s.weights[0] === 0) add("vd-segregation-zero","개별 · 가계 근거","가계 내 공동분리에 무게를 두지 않았습니다. 가계 자료를 빼서 어떤 불확실성을 줄이려 했습니까?");
    else add("vd-evidence-pair","개별 · 같은 증거",`같은 증거를 가진 P-05와 P-09는 각각 ‘${group("P-05")}’${KCP.josa(group("P-05"), "와/과").slice(group("P-05").length)} ‘${group("P-09")}’입니다. 이 게임이 정한 분류가 서로 다른 두 카드를 구별하려면 어떤 자료가 새로 필요합니까?`);
    if (s.policyMode === "apply") add(...policyQuestion(s,r));
    if (s.replannedAfterReveal) add("vd-replanned","개별 · 다시 계획","결과를 본 뒤 기준을 다시 계획했습니다. 답을 보고 고친 기준은 이 12장에만 잘 맞는 과적합일 수 있습니다. 새 카드 묶음에서도 이 기준을 유지할 근거는 무엇입니까?");
    else if (!s.piTouched) add("vd-pi-unmoved","개별 · 확인하지 않은 가정","‘검사한 변이 중 병원성 변이의 비율 π’를 바꿔 보지 않았습니다. 게임의 기본값을 실제 판독 대상 변이 집단의 비율로 볼 수 있습니까?");
    else add("vd-pi-moved","개별 · 바꾼 가정",`검사한 변이 중 병원성 변이의 비율 π를 바꾸어 보았고, 확정값은 ${s.piPct.toFixed(1)}%입니다. 카드 분류는 그대로인데 양성예측도 범위가 달라지는 이유를 설명해 주세요.`);
    add("vd-counter-capacity","반문 · 고침·유지와 이유","상담 인력이 절반으로 줄어 한 차례에 4건만 맡을 수 있다면, 원래 기준을 고치거나 유지할 이유를 말해 주세요.");
    add("vd-divergent-system","발산 · 제도 제안","미확정 4장처럼 지금 자료로는 판단할 수 없는 정보를 다룰 제도를 저울과 문턱 밖에서 하나 제안해 보세요. 단계별 동의, 새 증거에 따른 재분류 통보, 상담 배분 규칙 등을 생각할 수 있습니다.");
    return qs;
  }
  function questions(state) { return questionsFromSnapshot(normalizeGame(state && state.game).locked); }
  function countText(cm,word="보고") { return `맞게 ${word} ${cm.TP} · 비병원성을 ${word} ${cm.FP} · 병원성을 ${word}하지 않음 ${cm.FN} · 비병원성을 ${word}하지 않음 ${cm.TN}`; }
  function manualText(s) { return ordered(Object.keys(s.overrides)).map(id => `${id} → ${GROUP_NAMES[s.overrides[id].to]}: ${s.overrides[id].reason}`).join("\n") || "없음"; }
  function missedText(v) { return `${v.id}: ${v.text}${v.group === "C" ? " 상담 후 결정에 남음" : ""}`; }
  function listTitle(s) { return s.policyMode === "apply" ? "최종 보고 목록" : "1단계 보고 분류(정책 판단 보류)"; }
  function onsetText(v) { return `병원성일 때 침투율 ${v.pen[0]}~${v.pen[1]}% / 다른 변이 집단 예시 ${pctRange(v.range)}`; }
  function recap(state) {
    const s = normalizeGame(state && state.game).locked;
    if (!s) return [{t:"상태",d:"아직 기준을 확정하지 않았습니다. 준비실에서 기준을 확정하면 선택에 맞춘 질문이 만들어집니다."}];
    const r = compute(s), out = [], add = (t,d) => out.push({t,d});
    add("상태",`기준 확정 · ${s.policyMode === "apply" ? "정책 단계 검토" : "정책 판단 보류"}${s.replannedAfterReveal ? " · 결과 공개 뒤 다시 계획함" : ""}`);
    add("증거의 무게",WEIGHT_NAMES.map((name,k) => `${name} ${s.weights[k]}`).join(" / "));
    add("분류선",`보고선 T1 ${s.t1} / 상담선 T2 ${s.t2}`);
    add("카드판",`보고 ${r.groups.R}장 / 상담 후 결정 ${r.groups.C}장 / 보고하지 않음 ${r.groups.N}장`);
    out.push({t:"수동 변경",d:manualText(s),text:manualText(s)});
    add("보고 정책",s.policyMode === "skip" ? "정책 판단 보류 — 목록은 1단계 분류 그대로이며 미성년·예방치료법 없음·2차 발견 카드의 전달 여부는 정하지 않음" : POLICY_KEYS.map(key => `${POLICIES[key][0]}: ${s.policy[key] ? "보고함" : "보고하지 않음"}`).join(" / "));
    for (const key of ["r","rc"]) add(key === "r" ? "보고만 양성" : "보고·상담 양성",`${countText(r[key],key === "r" ? "보고" : "보고·상담")} / 민감도 ${fraction(r[key].TP,6)} / 특이도 ${fraction(r[key].TN,6)} / 양성예측도 ${ppvText(r.ranges[key])}`);
    add(listTitle(s),`${r.final.length}장: ${idText(r.final)}${s.policyMode === "apply" ? ` / 보고에서 제외 ${idText(r.removed)}` : ""}`);
    add(s.policyMode === "apply" ? "최종 목록의 비교" : "1단계 보고 분류 비교(정책 판단 보류)",`미확정 제외: ${countText(r.f)}`);
    add("미확정",`P-13, P-14, P-15, P-16 — ${UNCERTAIN}. 2×2 집계에서 제외.`);
    add("가정한 병원성 비율",`검사한 변이 중 병원성 변이의 비율 π ${s.piPct.toFixed(1)}% / ${s.piTouched ? "직접 바꿔 봄" : "기본값 유지(미조작)"}`);
    add("침투율과 발병 범위",`${r.onset.map(onsetText).join("\n") || "발병 예시 없음"}\nU는 추정하지 않음\n개인의 발병 예측이 아닌 가정 계산`);
    add("조치 검토 요청",`${ACTION_NAMES.map((name,k) => `${name} ${r.actions[k]}건`).join(" / ")} / 미확정 카드에서 나온 요청 ${ACTION_NAMES.map((name,k) => `${name} ${r.uncertainActions[k]}건`).join(" / ")}(위 총수에 포함) / 재검토·재연락 등록 ${r.recontact.length}건`);
    add("상담과 혈족 고지",`참여자 ${r.participantConsult.length}건 + 혈족 검토 ${r.family.length}건 = ${r.demand}건 / 동시 8건 / ${r.waiting ? "대기 발생" : "대기 없음"}${r.refusalWarning ? " / P-01 연락 거부 사례 포함" : ""}`);
    add(s.policyMode === "apply" ? "최종 보고하지 않은 병원성 카드" : "1단계 보고에 들지 않은 병원성 카드",ordered(r.missed.map(v => v.id)).map(id => missedText(r.missed.find(v => v.id === id))).join("\n") || "이 카드 묶음에서는 없음");
    add(s.policyMode === "apply" ? "비병원성인데 최종 보고한 카드" : "비병원성인데 1단계 보고에 든 카드",`${idText(r.overreported)}${r.overreported.length ? ` — ${OVER_HARM}` : ""}`);
    add("기준에 대한 설명",s.plan || "작성하지 않음");
    add("계산의 한계","단순화한 모형. 카드 12장에서 센 값이라 흔들림이 큽니다. 실제 변이 해석은 증거를 강도별로 조합하며 가중합과 같지 않습니다.");
    return out;
  }
  function brief(state) {
    const g = ensureGame(state);
    if (!g.locked && ["room","reflect"].includes(state.phase)) state.phase = "prep";
    return `<div class="scenario">
      <p class="label">문제 상황</p>
      <p>가상의 공공 유전체 사업 ‘하늘빛 코호트’가 참여자에게 변이 해석 결과를 알리려 합니다. 성인이 중심인 사업이지만, 보호자 동의로 등록한 미성년 참여자도 있습니다. 여기서는 16명의 가상 참여자에게서 나온 생식세포 변이 하나씩을 살펴봅니다.</p>
      <p>이 사업은 참여자가 등록할 때 동의한 성인기 질환군(가상)의 변이를 해석해 알리는 것을 1차 목적으로 둔다고 가정합니다. 그 질환군 밖의 유전자에서 함께 찾은 변이를 ‘2차 발견’이라고 부릅니다.</p>
      <p>당신은 판독 기준 소위원회 위원입니다. 어떤 증거를 얼마나 중하게 볼지 정하고, 보고할 정보와 남겨 둘 불확실성을 설명하세요.</p>
      <ul class="rules">
        <li>자료에 없는 운영 방안은 가정할 수 있습니다. 가정과 카드에 주어진 사실을 구별하세요.</li>
        <li>카드의 증거와 수치는 바꾸지 않습니다. 분류를 손으로 바꾸는 카드는 최대 3장이고 이유를 한 문장 남깁니다.</li>
        <li>병원성 변이가 있다는 것과 발병한다는 것은 다릅니다. 미확정 4장은 끝까지 모르는 상태로 남습니다.</li>
        <li>이 게임은 단순화한 모형입니다. 실제 해석은 증거를 강도별로 조합하며, 여기의 가중합과 같지 않습니다.</li>
      </ul>
      <p class="small muted vd-care">불편하면 2단계 정책 스위치를 건너뛰어도 됩니다. 게임 전체를 준비실까지만 하거나 언제든 연습실로 돌아가도 됩니다. 실제 본인이나 가족의 유전 정보·병력은 입력하지 마세요.</p>
    </div>
    <div class="task"><b>준비할 답</b><ol>
      <li>증거의 무게와 두 문턱을 정하고, 가장 중하게 본 기준을 설명하세요.</li>
      <li>이 기준이 얻는 것과 잃는 것을 한 문장으로 정리하세요.</li>
      <li>미확정 정보를 어떻게 전달할지 정하세요. 정책 단계는 원하는 경우에만 검토하세요.</li>
      <li>결과를 확인한 뒤 기준을 확정하고, 상담 인력이 줄어들 때의 대응과 저울 밖의 제도를 생각하세요.</li>
    </ol></div>`;
  }
  function syncPhases(state) {
    const locked = !!normalizeGame(state.game).locked;
    document.querySelectorAll('.phases button[data-phase="room"], .phases button[data-phase="reflect"]').forEach(button => {
      button.disabled = !locked;
      if (locked) button.removeAttribute("title"); else button.title = PHASE_NOTICE;
    });
  }
  function rangeGraph(cm,piPct,universal) {
    const data = [{label:"π 0.2%",pi:0.002},{label:"현재 π",pi:piPct/100},{label:"π 5.0%",pi:0.05}].map(v => ({...v,range:ppvRange(cm,v.pi,universal)}));
    return `<h4>가정한 비율에 따른 양성예측도 범위</h4>
      <svg class="vd-ppv-svg" viewBox="0 0 320 112" role="img" aria-label="가정한 비율에 따른 양성예측도 범위">
        <line x1="86" y1="96" x2="298" y2="96" stroke="var(--line)"/>
        ${[0,50,100].map(p => `<text x="${86+2.12*p}" y="109" text-anchor="middle" fill="var(--ink-2)" font-size="10">${p}%</text>`).join("")}
        ${data.map((v,i) => {
          const y = 28+28*i;
          const line = v.range ? (() => { const lo = 86+212*v.range[0], hi = 86+212*v.range[1]; return `<path d="M${lo} ${y}H${hi} M${lo} ${y-4}V${y+4} M${hi} ${y-4}V${y+4}" stroke="var(--accent)" fill="none" stroke-width="2"/>`; })() : "";
          return `<text x="2" y="${y+4}" fill="var(--ink-2)" font-size="12">${esc(v.label)}</text>${line}`;
        }).join("")}
      </svg><ul class="vd-ranges">${data.map(v => `<li>${esc(v.label)}: ${esc(ppvText(v.range))}</li>`).join("")}</ul>`;
  }
  function matrixHTML(r,key,s) {
    const cm = r[key], word = key === "r" ? "보고" : "보고·상담";
    return `<section class="panel vd-matrix-block"><h3>${key === "r" ? "보고만 양성" : "보고·상담 양성"}</h3>
      <table id="vd-matrix-${key}" class="vd-matrix">
        <caption>양성 판정: ${word} · 미확정 4장 제외</caption>
        <thead><tr><th scope="col">이 게임이 정한 분류(가상의 추적 결과)</th><th scope="col">병원성</th><th scope="col">비병원성</th></tr></thead>
        <tbody><tr><th scope="row">양성 판정</th><td><span data-vd-cell="TP">${cm.TP}</span><br>맞게 ${word}</td><td><span data-vd-cell="FP">${cm.FP}</span><br>비병원성을 ${word}</td></tr>
        <tr><th scope="row">음성 판정</th><td><span data-vd-cell="FN">${cm.FN}</span><br>병원성을 ${word}하지 않음</td><td><span data-vd-cell="TN">${cm.TN}</span><br>비병원성을 ${word}하지 않음</td></tr></tbody>
      </table>
      <p class="vd-metrics" id="vd-metrics-${key}">민감도 <span data-vd-metric="se">${fraction(cm.TP,6)}</span> · 특이도 <span data-vd-metric="sp">${fraction(cm.TN,6)}</span> · 양성예측도 <span data-vd-metric="ppv">${esc(ppvText(r.ranges[key]))}</span></p>
      ${r.universal[key] ? "<p>전부 양성인 규칙에서는 새 구별 정보가 없어 π와 같습니다.</p>" : ""}
      ${rangeGraph(cm,s.piPct,r.universal[key])}
    </section>`;
  }
  function skipNotice(r) {
    const parts = [["미성년","minor"],["예방·치료법 없음","noCare"],["2차 발견","secondary"]].map(([name,key]) => {
      const ids = r.rows.filter(v => r.final.includes(v.id) && v[key]).map(v => v.id);
      return ids.length ? `${name} ${idText(ids)}` : "";
    }).filter(Boolean);
    return `정책 단계를 건너뛰어 아래 목록은 1단계 분류 그대로입니다.${parts.length ? ` ${parts.join(", ")}을 실제로 전할지는 정하지 않았습니다.` : ""}`;
  }
  function resultHTML(s,r) {
    return `<div class="vd-results-grid">${matrixHTML(r,"r",s)}${matrixHTML(r,"rc",s)}</div>
      <p>두 집계에서 양성이라고 부르는 범위가 다릅니다. 어느 지표도 성적이 아닙니다. 여기서 ‘양성 판정’은 보고 쪽으로 분류했다는 뜻(陽性)이며, 변이가 해롭지 않다는 ‘양성(良性)’과 다릅니다.</p>
      <p>‘드물다’는 근거만으로는 이 카드 묶음에서도 드물지만 비병원성인 P-11·P-12를 걸러 내지 못합니다. 집단 내 빈도 하나만 쓰면 어떤 문턱에서도 12장 가운데 4장 이상을 잘못 분류합니다. 가계 내 공동분리나 기능 실험 하나만 쓸 때(최소 2장)보다 많습니다.</p>
      <p>하한이 가정한 π보다 낮게 나올 수 있습니다. 카드가 적어, 이 기준이 아무렇게나 고르는 것보다 낫다는 것조차 확신할 수 없기 때문입니다. 상한 100.0%는 확실하다는 뜻이 아니라, 비병원성 6장을 모두 걸러 낸 표본이 작아 범위를 좁히지 못했다는 뜻입니다. π의 영향은 보고·상담 집계 행에서 더 잘 보입니다.</p>
      <p class="small muted">P(H|+) = Se·π / [Se·π + (1−Sp)·(1−π)]. H는 병원성 변이, +는 양성 판정입니다. Wilson 식으로 민감도와 특이도의 범위를 구하고 두 하한·두 상한을 대입한 교육용 불확실성 범위입니다. 실제 95% 신뢰구간이 아니며 선택 편향과 과적합을 보정하지 않습니다.</p>
      <section class="panel vd-final"><h3>${listTitle(s)} · <span class="vd-count num" id="vd-final-count">${r.final.length}</span>장</h3>
        ${s.policyMode === "skip" ? `<p>${esc(skipNotice(r))}</p><p class="small muted">조치·상담·미보고 비교는 이 분류를 유지할 경우의 가상 검토량이며 전달 결정이 아닙니다.</p>` : `<p>보고에서 제외: ${esc(idText(r.removed))} · 상담에서 제외: <span id="vd-consult-removed">${esc(idText(r.consultRemoved))}</span></p>`}
        <ul id="vd-final-list" class="vd-final-list">${ordered(r.final).map(id => `<li data-vd-final="${esc(id)}">${esc(id)}</li>`).join("") || "<li>없음</li>"}</ul>
        <p id="vd-metrics-f" class="vd-metrics">${s.policyMode === "apply" ? "최종 목록 비교(미확정 제외)" : "1단계 보고 분류 비교(정책 판단 보류) · 미확정 제외"}: ${countText(r.f)}</p>
      </section>
      <section class="vd-uncertain panel" id="vd-uncertain"><h3>미확정 ${SOURCE}</h3><p>${UNCERTAIN}</p>
        <ul>${ordered(r.uncertain.map(v => v.id)).map(id => { const v = r.uncertain.find(v => v.id === id); return `<li>${esc(id)} · ${GROUP_NAMES[v.group]} · ${s.policyMode === "apply" ? "최종 보고 목록" : "1단계 보고 분류"}: ${v.reported ? "포함(조치 요청과 재검토·재연락 등록)" : "포함하지 않음"} · 미확정 — 발병 범위를 추정하지 않음</li>`; }).join("")}</ul>
        <p class="small muted">${VUS_RULE}</p>
      </section>
      <section class="vd-onset panel" id="vd-onset"><h3>${listTitle(s)}에 든 변이 한 건 — π를 가정한 다른 변이 집단의 예시</h3>
        <ul>${r.onset.map(v => `<li data-vd-onset="${esc(v.key)}">${esc(onsetText(v))}</li>`).join("") || "<li>발병 예시 없음</li>"}</ul>
        <p>아래 행은 이 목록에 든 카드의 침투율 범위입니다. 정책은 어떤 카드를 전할지 정할 뿐, 변이가 병원성일 가능성을 바꾸지 않습니다. 그래서 발병 범위에는 1단계 보고 분류의 양성예측도를 씁니다.</p>
        <p>P(해당 변이로 인한 발병 | 1단계 보고 분류) = P(H|1단계 보고 분류) × P(발병 | H, 해당 유전형, 1단계 보고 분류)</p>
        <p class="small muted">오른쪽 두 번째 항을 침투율 범위로 놓는 동질성 가정입니다. 서로 다른 질환·증거·유전형의 실제 사람에게 이 가정이 성립하지 않을 수 있습니다. 비병원성 원인·환경·다른 유전자의 발병은 제외했습니다.</p>
        <p>이 곱은 조건부확률을 살펴보는 예시입니다. 카드의 개인이나 실제 사람의 발병 예측이 아닙니다. 미확정은 범위를 추정하지 않았습니다.</p>
        ${r.onset.some(v => pctRange(v.range).startsWith("0.0~")) ? "<p>표시 자릿수 때문에 하한이 0.0%로 보일 수 있습니다. 위험이 없다는 뜻은 아닙니다.</p>" : ""}
      </section>
      <section class="panel vd-actions"><h3>보고 목록에 따른 조치 검토 요청</h3>
        <ul>${ACTION_NAMES.map((name,k) => `<li>${name} <span class="vd-action num" id="vd-action-${["image","surgery","drug","family"][k]}">${r.actions[k]}</span>건</li>`).join("")}</ul>
        <p id="vd-uncertain-actions">위 요청 중 미확정으로 남은 카드에서 나온 요청: ${ACTION_NAMES.map((name,k) => `${name} ${r.uncertainActions[k]}건`).join(" / ")}. VUS를 조치 근거로 오해할 때의 부담을 나타내는 가정입니다.</p>
        <p>재검토·재연락 등록 <span class="vd-recontact num" id="vd-recontact">${r.recontact.length}</span>건${r.recontact.length ? ` (${esc(idText(r.recontact))})` : ""} — 조치 요청과 별도로 셉니다.</p>
        <p>한 카드가 여러 요청을 만들 수 있습니다. 서로 다른 요청을 합산 점수로 만들지 않습니다. 혈족에게 연락할지 검토하는 건수와 추가 가족 검사는 다른 항목입니다.</p>
        <p>참여자 상담 ${r.participantConsult.length}건 · 혈족 고지 검토 ${r.family.length}건 · 상담 수요 <span class="vd-demand num" id="vd-demand">${r.demand}</span>건 / 동시 8건 <span class="vd-wait" id="vd-wait"${r.waiting ? "" : " hidden"}>대기 발생</span></p>
        <p>혈족 고지 검토: ${esc(idText(r.family))}</p>
      </section>
      <section class="panel vd-missed-panel"><h3>${s.policyMode === "apply" ? "병원성으로 설정했지만 최종 보고하지 않은 카드" : "병원성으로 설정했지만 1단계 보고에 들지 않은 카드"}</h3>
        <ul id="vd-missed" class="vd-missed">${ordered(r.missed.map(v => v.id)).map(id => `<li data-vd-missed="${esc(id)}">${esc(missedText(r.missed.find(v => v.id === id)))}</li>`).join("") || "<li>이 카드 묶음에서는 없음</li>"}</ul>
      </section>
      <section class="panel vd-over-panel"><h3>${s.policyMode === "apply" ? "비병원성으로 설정했지만 최종 보고한 카드" : "비병원성으로 설정했지만 1단계 보고에 든 카드"}</h3>
        <ul id="vd-over" class="vd-missed">${ordered(r.overreported).map(id => `<li data-vd-over="${esc(id)}">${esc(id)}</li>`).join("") || "<li>이 카드 묶음에서는 없음</li>"}</ul>
        <p>${OVER_HARM}</p>
      </section>
      <section class="panel vd-manual-panel"><h3>수동 변경</h3><ul id="vd-manual-log" class="vd-manual-log">${ordered(Object.keys(s.overrides)).map(id => `<li>${esc(id)} → ${GROUP_NAMES[s.overrides[id].to]}: ${esc(s.overrides[id].reason)}</li>`).join("") || "<li>없음</li>"}</ul></section>`;
  }
  function renderPrep(root,state,save,next) {
    const g = ensureGame(state), $ = selector => root.querySelector(selector), $$ = selector => [...root.querySelectorAll(selector)];
    const setting = () => g.locked || g;
    const blocked = () => !!g.locked || g.stage1Confirmed;
    let rows = classifyRows(setting());
    root.innerHTML = `<div id="vd-prep" class="vd-prep stack">
      <div id="vd-tabs" class="vd-tabs tabs" role="tablist" aria-label="자료">
        <button type="button" id="vd-tab-evidence" class="vd-tab" data-vd-tab="evidence" role="tab" aria-controls="vd-material-evidence">증거 안내</button>
        <button type="button" id="vd-tab-voices" class="vd-tab" data-vd-tab="voices" role="tab" aria-controls="vd-material-voices">이해관계자</button>
      </div>
      <section id="vd-material-evidence" class="vd-material panel" role="tabpanel" aria-labelledby="vd-tab-evidence"><h3>증거 안내 ${SOURCE}</h3>
        <p>${MATERIAL}</p><p>보고 / 상담 후 결정 / 보고하지 않음은 이 게임의 보고 분류입니다. 변이 자체의 임상 등급 이름이 아닙니다.</p>
        <p class="small muted">점수·빈도·침투율·조치 건수·참값은 전부 이 게임에서 만든 값입니다. 0은 정상이라는 뜻이 아니라 판정 근거 부족인 경우가 있습니다.</p>
        ${WEIGHT_NAMES.map((name,k) => `<p><b>${name}</b>${EVIDENCE_NOTES[k] ? `<br>${EVIDENCE_NOTES[k]}` : ""}</p>`).join("")}
      </section>
      <section id="vd-material-voices" class="vd-material panel" role="tabpanel" aria-labelledby="vd-tab-voices" hidden><h3>이해관계자 ${SOURCE}</h3><div class="vd-voices">${VOICES.map(([role,quote]) => `<section class="vd-voice"><h4>${role}</h4><p>“${quote}”</p></section>`).join("")}</div></section>
      <p class="vd-notice" id="vd-replanned"${g.truthSeen ? "" : " hidden"}>비교 자료를 이미 본 상태에서 다시 계획하고 있습니다.</p>
      <div class="vd-workspace">
        <section class="vd-controls panel"><h3>1단계</h3><fieldset id="vd-weights" class="vd-controls panel"><legend>증거 저울</legend>
          ${WEIGHT_NAMES.map((name,k) => `<div class="vd-weight-row"><span>${name}</span><div class="vd-weight-steps"><button type="button" class="vd-step btn" id="vd-w-${k}-minus" data-vd-weight="${k}" data-vd-delta="-1" aria-label="${name} 무게 줄이기">−</button><output class="vd-weight num" id="vd-w-${k}-value">${g.weights[k]}</output><button type="button" class="vd-step btn" id="vd-w-${k}-plus" data-vd-weight="${k}" data-vd-delta="1" aria-label="${name} 무게 늘리기">+</button></div></div>`).join("")}
        </fieldset><p class="vd-notice" id="vd-zero" hidden>저울에 무게를 하나도 두지 않았습니다.</p>
        <div class="field"><label for="vd-t1">보고선 T1 <output class="vd-threshold num" id="vd-t1-value">${g.t1}</output></label><input class="vd-range" id="vd-t1" type="range" min="-30" max="47" step="1" value="${g.t1}"></div>
        <div class="field"><label for="vd-t2">상담선 T2 <output class="vd-threshold num" id="vd-t2-value">${g.t2}</output></label><input class="vd-range" id="vd-t2" type="range" min="-31" max="46" step="1" value="${g.t2}"></div>
        <p id="vd-manual-count" class="vd-count"></p></section>
        <section class="vd-board-panel"><h3>카드판 ${SOURCE}</h3><div id="vd-board" class="vd-board">${Object.entries(GROUP_NAMES).map(([key,name]) => `<section id="vd-col-${key}" class="vd-column panel"><h3>${name} <span id="vd-count-${key}" class="vd-count num"></span></h3><ul class="vd-cardlist" id="vd-list-${key}"></ul></section>`).join("")}</div></section>
        <section id="vd-detail" class="vd-detail panel" role="region" aria-labelledby="vd-detail-title" hidden></section>
      </div>
      <div id="vd-live" class="vd-live sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
      <section class="panel vd-plan-panel"><div class="field"><label for="vd-plan">기준에 대한 설명</label><textarea id="vd-plan" class="vd-plan note" maxlength="1000">${esc(g.plan)}</textarea></div>
        <button type="button" id="vd-stage1-confirm" class="vd-button btn primary">1단계 확정</button><p class="small muted">아직 적용하지 않은 수동 변경은 결과에 포함되지 않습니다.</p></section>
      <section id="vd-policy-choice" class="vd-policy-choice panel" hidden><h3>보고 정책 — 선택 단계</h3><p>1단계의 카드 분류를 유지한 채 최종 보고 목록을 바꿉니다. 각 정책은 처음에는 미선택입니다. 각 줄의 보고함/보고하지 않음 라디오 중 하나를 직접 고르며, 어느 선택도 권장 답이 아닙니다. 혈족 행의 보고함은 고지 검토를 뜻합니다.</p>
        <div class="row"><button type="button" id="vd-policy-open" class="vd-button btn" aria-pressed="false">정책 단계 검토</button><button type="button" id="vd-policy-skip" class="vd-button btn" aria-pressed="false">정책 단계 건너뛰기</button></div>
      </section>
      <section id="vd-policy" class="vd-policy panel" hidden>
        ${POLICY_KEYS.map(key => `<fieldset class="vd-policy-row"><legend>${POLICIES[key][0]}</legend>${[["yes",true,"보고함"],["no",false,"보고하지 않음"]].map(([suffix,value,label]) => `<label class="vd-radio-label" for="vd-policy-${key}-${suffix}"><input id="vd-policy-${key}-${suffix}" class="vd-switch" type="radio" name="vd-policy-${key}" data-vd-policy="${key}" value="${value}">${label}</label>`).join("")}<p id="vd-policy-note-${key}" class="small muted"></p></fieldset>`).join("")}
        <p>네 스위치는 1단계 분류를 바꾸지 않으며, ‘보고’와 ‘상담 후 결정’으로 분류된 카드 가운데 무엇을 실제로 전하거나 상담할지만 정합니다. 보고에서 빼는 카드는 상담에서도 뺍니다. 혈족 고지는 참여자 보고와 별도이며 실제 연락을 보내지 않습니다. ‘보고하지 않음’으로 분류한 변이는 혈족 고지를 검토하지 않습니다.</p>
        <p id="vd-policy-preview" class="vd-policy-preview"></p><p id="vd-family-warning" class="vd-warning" hidden>${FAMILY_WARNING}</p>
      </section>
      <button type="button" id="vd-export" class="vd-button btn" disabled>판독 결과 공개</button>
      <section id="vd-results" class="vd-results stack" hidden></section>
      ${KCP.memoPanel(state,save,"vd-memo")}
      <div class="row"><button type="button" id="vd-lock" class="vd-button btn" disabled>기준 확정</button><button type="button" id="vd-unlock" class="vd-button btn" hidden>다시 계획하기</button><button type="button" id="vd-next" class="vd-button btn primary" disabled>면접실로 이동</button><p id="vd-phase-notice" class="vd-notice">${PHASE_NOTICE}</p></div>
      <div class="row"><button type="button" id="vd-finish-prep" class="vd-button btn">준비실에서 마치기</button><a id="vd-home" class="vd-home btn" href="#home">연습실 돌아가기</a></div>
    </div>`;
    function paintTabs() {
      for (const tab of ["evidence","voices"]) {
        const selected = g.tab === tab, button = $(`#vd-tab-${tab}`);
        button.setAttribute("aria-selected",String(selected)); button.tabIndex = selected ? 0 : -1;
        $(`#vd-material-${tab}`).hidden = !selected;
      }
    }
    function paintBoard() {
      const focusId = root.contains(document.activeElement) ? document.activeElement.id : "";
      for (const key of Object.keys(GROUP_NAMES)) {
        const inGroup = ordered(rows.filter(v => v.group === key).map(v => v.id));
        $(`#vd-count-${key}`).textContent = inGroup.length;
        $(`#vd-list-${key}`).innerHTML = inGroup.map(id => {
          const v = rows.find(v => v.id === id), marks = [[v.secondary,"2차 발견"],[v.minor,"미성년"],[v.family,"혈족 연락 가능 사례"],[v.refused,"연락 거부"],[v.manual,"수동"]].filter(([yes]) => yes).map(([,label]) => label);
          const care = v.noCare ? "성인기 발병 · 현재 예방·치료법 없음" : "성인기 발병 · 예방·치료 수단 있음";
          return `<li><button type="button" id="vd-card-${id}" class="vd-card btn" data-vd-card="${id}" aria-expanded="${g.selectedId === id}" aria-controls="vd-detail" aria-label="${esc([id,care,GROUP_NAMES[v.group],...marks].join(" · "))}"><b>${id}</b><span>${care}</span><span>${GROUP_NAMES[v.group]}</span>${marks.map(label => `<span class="vd-marker">${label}</span>`).join("")}</button></li>`;
        }).join("") || "<li>해당 카드 없음</li>";
      }
      if (focusId.startsWith("vd-card-")) document.getElementById(focusId)?.focus({preventScroll:true});
      $("#vd-manual-count").textContent = `수동 변경 ${Object.keys(setting().overrides).length}/3장`;
    }
    function detailContent(v) {
      const s = setting(), draft = g.overrideDraft && g.overrideDraft.id === v.id ? g.overrideDraft : {id:v.id,to:v.group,reason:s.overrides[v.id]?.reason || ""};
      return `<div class="row"><h3 id="vd-detail-title" class="vd-detail-title" tabindex="-1">${v.id} ${SOURCE}</h3><button type="button" id="vd-detail-close" class="vd-close btn">닫기</button></div>
        <p>${GENES[v.gene]}</p><h4>가상 가계 정보</h4><p>${EVIDENCE[0][v.e[0]]}</p>
        <ol class="vd-evidence-list">${WEIGHT_NAMES.map((name,k) => `<li><b>${name}</b><p>${EVIDENCE[k][v.e[k]]}</p><p class="vd-product num" data-vd-product="${k}">증거값 ${v.e[k]} × 현재 무게 ${s.weights[k]} = ${v.e[k]*s.weights[k]}</p>${EVIDENCE_NOTES[k] ? `<p class="small muted">${EVIDENCE_NOTES[k]}</p>` : ""}</li>`).join("")}</ol>
        <p>분류 점수 S = <output id="vd-card-score" class="vd-score num">${v.score}</output></p>
        <p>병원성일 때의 침투율: ${v.pen[0]}~${v.pen[1]}% · 해당 유전형, 예방적 개입 전</p>
        <h4>병원성으로 보고하면 검토할 조치</h4><p>${v.a.some(Boolean) ? v.a.map((n,k) => n ? `${ACTION_NAMES[k]} 1건 검토` : "").filter(Boolean).join(" · ") : "추가 의료 조치 없이 정보 수신 여부를 상담합니다."}</p>
        <p>보고만으로 검사·수술·약물이 시행되지는 않습니다. 설명과 별도 동의가 필요합니다.</p><p class="small muted">${VUS_RULE}</p><h4>놓치면 생기는 일</h4><p>${MISS[v.miss]}</p>
        <div class="field"><label for="vd-override-to">수동 변경 대상</label><select id="vd-override-to" class="vd-select">${Object.entries(GROUP_NAMES).map(([key,name]) => `<option value="${key}"${draft.to === key ? " selected" : ""}>${name}</option>`).join("")}</select></div>
        <div class="field"><label for="vd-override-reason">기준에 대한 설명 — 바꾸는 이유 한 문장</label><textarea id="vd-override-reason" class="vd-reason note" maxlength="280">${esc(draft.reason)}</textarea></div>
        <p class="vd-error" id="vd-override-error" role="alert" hidden></p>
        <div class="row"><button type="button" id="vd-override-save" class="vd-button btn">수동 변경 적용</button><button type="button" id="vd-override-reset" class="vd-button btn">자동으로 되돌리기</button></div>
        <div id="vd-detail-result"></div>`;
    }
    function paintDetailResult() {
      const el = $("#vd-detail-result");
      if (!el) return;
      const v = rows.find(v => v.id === g.selectedId);
      el.innerHTML = g.revealed && v ? `<p>이 게임이 정한 분류(가상의 추적 결과): ${{P:"병원성",B:"비병원성",U:"미확정"}[v.truth]}</p>${v.truth === "U" ? `<p>${UNCERTAIN}</p><p>미확정 — 발병 범위를 추정하지 않음 · 보고에 따른 조치 요청과 재검토·재연락 등록을 함께 표시</p>` : ""}` : "";
    }
    function paintDetail() {
      const v = rows.find(v => v.id === g.selectedId), el = $("#vd-detail");
      el.hidden = !v;
      if (!v) { el.innerHTML = ""; return; }
      el.innerHTML = detailContent(v);
      paintDetailResult();
      $("#vd-detail-close").onclick = closeDetail;
      const saveDraft = () => {
        if (blocked()) return;
        g.overrideDraft = {id:v.id,to:$("#vd-override-to").value,reason:$("#vd-override-reason").value.slice(0,280)}; save();
      };
      $("#vd-override-to").onchange = saveDraft;
      $("#vd-override-reason").oninput = saveDraft;
      $("#vd-override-save").onclick = () => {
        if (blocked()) return;
        const to = $("#vd-override-to").value, raw = $("#vd-override-reason").value, reason = raw.trim();
        let error = "";
        if (!validReason(raw)) error = "바꾸는 이유를 한 문장으로 적어 주세요.";
        else if (!own(GROUP_NAMES,to)) return;
        else if (!g.overrides[v.id] && to === rows.find(row => row.id === v.id).auto) error = "자동 분류와 같습니다. 바꾸려면 다른 칸을 고르세요.";
        else if (!g.overrides[v.id] && Object.keys(g.overrides).length >= 3) error = "수동 변경은 최대 3장입니다. 먼저 한 장을 자동으로 되돌리세요.";
        $("#vd-override-error").textContent = error; $("#vd-override-error").hidden = !error;
        if (error) return;
        g.overrides[v.id] = {to,reason}; g.overrideDraft = {id:v.id,to,reason};
        updateClassification(); save();
      };
      $("#vd-override-reset").onclick = () => {
        if (blocked()) return;
        delete g.overrides[v.id]; g.overrideDraft = null;
        updateClassification();
        $("#vd-override-to").value = rows.find(row => row.id === v.id).auto;
        $("#vd-override-reason").value = ""; $("#vd-override-error").hidden = true; save();
      };
      paintControls();
    }
    function closeDetail() {
      const id = g.selectedId; g.selectedId = null; save(); paintDetail(); paintBoard();
      if (id) $(`#vd-card-${id}`).focus();
    }
    function paintControls() {
      const s = setting();
      WEIGHT_NAMES.forEach((name,k) => {
        $(`#vd-w-${k}-value`).textContent = s.weights[k];
        $(`#vd-w-${k}-minus`).disabled = blocked() || s.weights[k] === 0;
        $(`#vd-w-${k}-plus`).disabled = blocked() || s.weights[k] === 3;
      });
      for (const key of ["t1","t2"]) { $(`#vd-${key}`).value = s[key]; $(`#vd-${key}`).disabled = blocked(); $(`#vd-${key}-value`).textContent = s[key]; }
      $("#vd-zero").hidden = s.weights.some(w => w !== 0);
      $("#vd-plan").disabled = !!g.locked;
      for (const id of ["to","reason","save","reset"]) { const el = $(`#vd-override-${id}`); if (el) el.disabled = blocked(); }
      $("#vd-stage1-confirm").hidden = g.stage1Confirmed;
      $("#vd-stage1-confirm").disabled = blocked();
      $("#vd-unlock").hidden = !g.stage1Confirmed;
      $("#vd-lock").hidden = !!g.locked; $("#vd-lock").disabled = !!g.locked || !g.revealed || !g.stage1Confirmed || !ready(g);
      $("#vd-export").disabled = !!g.locked || !g.stage1Confirmed || !ready(g);
      $("#vd-next").disabled = !g.locked; $("#vd-phase-notice").hidden = !!g.locked;
      $("#vd-policy-choice").hidden = !g.stage1Confirmed;
      $("#vd-policy").hidden = !g.stage1Confirmed || g.policyMode !== "apply";
      for (const [id,mode] of [["open","apply"],["skip","skip"]]) { $(`#vd-policy-${id}`).disabled = !g.stage1Confirmed || !!g.locked; $(`#vd-policy-${id}`).setAttribute("aria-pressed",String(g.policyMode === mode)); }
      $$('[data-vd-policy]').forEach(el => { el.disabled = !!g.locked || !g.stage1Confirmed || g.policyMode !== "apply"; el.checked = s.policy[el.dataset.vdPolicy] === (el.value === "true"); });
      const pi = $("#vd-pi"); if (pi) pi.disabled = !!g.locked;
      $("#vd-replanned").hidden = !g.truthSeen || !g.replannedAfterReveal || !!g.locked;
      syncPhases(state);
    }
    function updateClassification(prefix="") {
      const previous = rows; rows = classifyRows(setting());
      const moved = rows.filter((v,i) => v.group !== previous[i].group).length;
      paintBoard(); paintControls();
      if (g.selectedId) {
        const v = rows.find(v => v.id === g.selectedId);
        $("#vd-card-score").textContent = v.score;
        $$('[data-vd-product]').forEach(el => { const k = Number(el.dataset.vdProduct); el.textContent = `증거값 ${v.e[k]} × 현재 무게 ${g.weights[k]} = ${v.e[k]*g.weights[k]}`; });
      }
      const n = key => rows.filter(v => v.group === key).length;
      $("#vd-live").textContent = `${prefix}${moved ? `${moved}장이 이동했습니다.` : "이동한 카드가 없습니다."} 보고 ${n("R")}장, 상담 ${n("C")}장, 보고하지 않음 ${n("N")}장.`;
    }
    function paintPolicy() {
      POLICY_KEYS.forEach(key => { const val = setting().policy[key]; $(`#vd-policy-note-${key}`).textContent = val === null ? "" : POLICIES[key][val ? 1 : 2]; });
      const r = g.stage1Confirmed && g.policyMode === "apply" && ready(setting()) ? compute(setting()) : null;
      $("#vd-policy-preview").textContent = r ? `최종 보고 목록 ${r.final.length}장 · 보고에서 제외 ${idText(r.removed)} · 상담에서 제외 ${idText(r.consultRemoved)} · 혈족 고지 검토 ${r.family.length}건 · 상담 수요 ${r.demand}건` : "네 정책을 모두 선택해 주세요.";
      $("#vd-family-warning").hidden = !r || !r.refusalWarning;
      paintControls();
    }
    function paintResults() {
      const el = $("#vd-results"); el.hidden = !g.revealed;
      if (!g.revealed) { el.innerHTML = ""; paintDetailResult(); return; }
      const s = setting(), r = compute(s);
      if (!$("#vd-pi")) {
        el.innerHTML = `<h2 id="vd-results-title" tabindex="-1">판독 결과 ${SOURCE}</h2>
          <p>단순화한 모형 · 이 게임의 분류는 가중합이고 실제 해석 지침은 증거를 강도별로 조합합니다. 아래 비교 기준은 이 게임이 정한 분류입니다. 공개되는 분류는 카드에 적힌 지금의 증거로 내린 판정이 아니라, 이 게임이 ‘나중에 추가 자료로 밝혀진 결과’라고 정해 둔 가상의 답입니다. 그래서 지금 증거가 거의 없는 P-05가 병원성으로, 증거가 더 있는 P-13이 미확정으로 남을 수 있습니다. 실제 사람에게 적용하는 정답표가 아닙니다.</p>
          <p>민감도·특이도는 카드 12장에서 센 값이라 흔들림이 큽니다. 미확정 4장은 집계에서 제외했습니다. 양성예측도 범위는 작은 자료의 불확실성을 보여 주는 가정 계산이며 실제 검사 성능이 아닙니다.</p>
          <p class="small muted">규칙 기반 점검은 참고용입니다.</p>
          <div class="field"><label for="vd-pi">검사한 변이 중 병원성 변이의 비율 π <output id="vd-pi-value" class="vd-pi-value num"></output></label><input id="vd-pi" class="vd-range" type="range" min="2" max="50" step="1" value="${Math.round(s.piPct*10)}"></div>
          <p>질환 유병률이 아닙니다. 이 카드 묶음의 6/12를 그대로 쓰는 값도 아닙니다. 적용할 다른 판독 대상 변이 집단의 비율을 가정하세요. 게임은 맞는 값을 알려 주지 않습니다.</p>
          <div id="vd-result-content" class="vd-result-content stack"></div>`;
        $("#vd-pi").oninput = event => {
          if (g.locked || !g.revealed || !g.stage1Confirmed || !ready(g)) return;
          const value = Number(event.target.value);
          if (!Number.isInteger(value) || value < 2 || value > 50 || value === Math.round(g.piPct*10)) return;
          g.piPct = value/10; g.piTouched = true; save(); paintResults();
        };
      }
      $("#vd-pi-value").textContent = `${s.piPct.toFixed(1)}%`;
      $("#vd-pi").disabled = !!g.locked;
      $("#vd-result-content").innerHTML = resultHTML(s,r);
      paintDetailResult();
    }
    $$('[data-vd-tab]').forEach(button => {
      button.onclick = () => { g.tab = button.dataset.vdTab; save(); paintTabs(); };
      button.onkeydown = event => {
        if (!["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) return;
        event.preventDefault(); g.tab = event.key === "Home" ? "evidence" : event.key === "End" ? "voices" : g.tab === "evidence" ? "voices" : "evidence";
        save(); paintTabs(); $(`#vd-tab-${g.tab}`).focus();
      };
    });
    $("#vd-board").onclick = event => {
      const button = event.target.closest("[data-vd-card]"); if (!button) return;
      g.selectedId = button.dataset.vdCard; save(); paintBoard(); paintDetail(); $("#vd-detail-title").focus();
    };
    $("#vd-prep").onkeydown = event => { if (event.key === "Escape" && g.selectedId) { event.preventDefault(); closeDetail(); } };
    $$('[data-vd-weight]').forEach(button => { button.onclick = () => {
      if (blocked()) return;
      const k = Number(button.dataset.vdWeight), delta = Number(button.dataset.vdDelta);
      if (!Number.isInteger(k) || k < 0 || k > 4 || ![-1,1].includes(delta)) return;
      g.weights[k] = clamp(g.weights[k]+delta,0,3); updateClassification(); save();
    }; });
    for (const key of ["t1","t2"]) $(`#vd-${key}`).oninput = event => {
      if (blocked()) return;
      const val = Number(event.target.value); if (!Number.isInteger(val)) return;
      g[key] = clamp(val,key === "t1" ? -30 : -31,key === "t1" ? 47 : 46);
      let notice = "";
      if (g.t2 >= g.t1) {
        const pushed = key === "t1" ? "t2" : "t1"; g[pushed] = g[key]+(pushed === "t2" ? -1 : 1);
        notice = `두 분류선이 겹치지 않도록 ${KCP.josa(pushed === "t1" ? "보고선" : "상담선","을/를")} ${g[pushed]}에 두었습니다. `;
      }
      updateClassification(notice); save();
    };
    $("#vd-plan").oninput = event => { if (g.locked) return; g.plan = event.target.value.slice(0,1000); save(); };
    $("#vd-stage1-confirm").onclick = () => {
      if (blocked()) return;
      g.stage1Confirmed = true; g.policyMode = "pending"; save(); paintControls(); $("#vd-policy-open").focus();
    };
    for (const [id,mode] of [["open","apply"],["skip","skip"]]) $(`#vd-policy-${id}`).onclick = () => {
      if (g.locked || !g.stage1Confirmed) return;
      if (g.policyMode !== mode) { const hadResult = g.revealed; g.policyMode = mode; g.revealed = false; if (hadResult) $("#vd-live").textContent = "정책이 바뀌었습니다. 판독 결과를 다시 공개하세요."; }
      save(); paintPolicy(); paintResults();
    };
    $$('[data-vd-policy]').forEach(radio => { radio.onchange = () => {
      if (g.locked || !g.stage1Confirmed || g.policyMode !== "apply") return;
      const key = radio.dataset.vdPolicy; if (!POLICY_KEYS.includes(key) || !["true","false"].includes(radio.value)) return;
      if (g.policy[key] !== (radio.value === "true")) { g.policy[key] = radio.value === "true"; if (g.revealed) $("#vd-live").textContent = "정책이 바뀌었습니다. 판독 결과를 다시 공개하세요."; g.revealed = false; }
      save(); paintPolicy(); paintResults();
    }; });
    $("#vd-export").onclick = () => {
      if (g.locked || !g.stage1Confirmed || !ready(g)) return;
      g.revealed = true; g.truthSeen = true; save(); paintResults(); paintControls(); $("#vd-results-title").focus();
    };
    $("#vd-lock").onclick = () => {
      if (g.locked || !g.revealed || !g.stage1Confirmed || !ready(g)) return;
      g.locked = snapshot(g); save(); paintControls(); paintPolicy(); KCP.toast("기준을 확정했습니다."); $("#vd-next").focus();
    };
    $("#vd-unlock").onclick = () => {
      if (!g.stage1Confirmed) return;
      if (g.locked) Object.assign(g,clone(g.locked));
      if (g.truthSeen) g.replannedAfterReveal = true;
      g.locked = null; g.stage1Confirmed = false; g.revealed = false; g.policyMode = "pending";
      save(); paintControls(); paintPolicy(); paintResults(); $("#vd-stage1-confirm").focus();
    };
    $("#vd-next").onclick = () => {
      if (!validSnapshot(g.locked)) return;
      save(); next();
      document.querySelector('.phases button[data-phase="room"]')?.focus({preventScroll:true});
    };
    $("#vd-finish-prep").onclick = () => { save(); KCP.toast("준비실 기록을 남겼습니다. 원하면 다음에 이어갈 수 있습니다."); window.location.hash = "#home"; };
    paintTabs(); paintBoard(); paintDetail(); paintPolicy(); paintResults(); paintControls();
  }
  function reflectExtra(state) {
    if (!normalizeGame(state && state.game).locked) return '<p class="small muted vd-notice">준비실에서 기준을 확정하면 가상의 답과 과학 해설을 볼 수 있습니다.</p>';
    return `<div class="vd-reflect stack">
      <p>세 판단은 서로 다른 기준을 드러내는 가상의 답입니다. 어느 하나를 정답으로 제시하지 않습니다. 나와 가장 다른 판단이 타당할 수 있는 조건을 생각해 보세요.</p>
      <details class="reveal vd-reveal">
        <summary>가. 놓침 줄이기 우선 <span class="tag-mine vd-source">가상의 답</span></summary>
        <p>기준과 무게: 대비할 기회를 남기는 것을 먼저, 본인의 정보 선택권을 다음, 상담 자원을 그다음에 두겠습니다. 증거 무게는 가계 3, 빈도 2, 기능 3, 예측 1, 같은 위치 1입니다.</p>
        <p>선택: 보고선 1, 상담선 0으로 두겠습니다. 2차 발견과 예방·치료법 없는 질환은 보고하되, 미성년 참여자의 성인기 위험 보고와 참여자 거부 시 혈족 고지 검토는 끄겠습니다. 수동 변경은 하지 않습니다.</p>
        <p>얻는 것과 잃는 것: 미성년인 P-03을 제외해 병원성 5장을 포함한 최종 11장을 보고합니다. 그 안에 비병원성 P-09·P-10과 미확정 4장도 들어 있습니다. 조치 검토 요청은 정기 영상 검사 6건, 예방적 수술 상담 1건, 약물 5건, 추가 가족 검사 6건입니다. 이 중 미확정 4장에서 나온 요청은 각각 2·0·2·2건이며, 재검토·재연락 등록 4건도 함께 셉니다. 대비할 기회를 넓게 얻지만 불필요한 관찰 검토와 정보 부담을 늘립니다.</p>
        <p>약점: 참여자 상담 11건으로 동시 8건을 넘습니다. 혈족에게 별도로 알리지 않아 대비 기회를 놓칠 수 있고, 미성년인 P-03의 보호자가 지금 준비할 기회도 줄어듭니다. 많이 보고한다는 이유만으로 참여자의 이해와 동의가 확보되지는 않습니다.</p>
      </details>
      <details class="reveal vd-reveal">
        <summary>나. 과한 개입 피하기 우선 <span class="tag-mine vd-source">가상의 답</span></summary>
        <p>기준과 무게: 근거가 충분한 경우의 개입을 먼저, 불필요한 의료 개입을 줄이는 것을 다음, 자원 배분을 그다음에 두겠습니다. 증거 무게는 가계 2, 빈도 3, 기능 3, 예측 0, 같은 위치 1입니다.</p>
        <p>선택: 보고선 18, 상담선 10으로 두고 정책 네 개를 모두 끄겠습니다. 이는 정책 단계를 건너뛴 것이 아니라 제외 규칙까지 적용하는 선택입니다. 수동 변경은 하지 않습니다.</p>
        <p>얻는 것과 잃는 것: 1단계에서는 3장을 보고하고 2장을 상담에 둡니다. 보고만 세면 민감도 3/6, 특이도 6/6이고, 상담까지 세면 4/6과 6/6입니다. 정책 뒤에는 P-01과 P-02만 보고합니다. 불필요한 조치 검토를 줄이지만 병원성으로 설정된 4장이 최종 보고 목록에 남지 않습니다.</p>
        <p>약점: 상담 수요가 3건으로 줄어도 보고에서 빠진 사람에게 충분한 도움이 되었다고 말할 수 없습니다. 상담 칸에 있던 P-03은 미성년이라는 이유로 상담에서도 빠지고, P-04는 2차 발견이면서 예방·치료법이 없다는 이유로 빠집니다. 예방 수단이 없어도 생활 계획을 위해 정보를 원하는 참여자가 있을 수 있습니다.</p>
      </details>
      <details class="reveal vd-reveal">
        <summary>다. 선택권 중심 <span class="tag-mine vd-source">가상의 답</span></summary>
        <p>기준과 무게: 자기결정을 먼저, 불확실성을 이해할 기회를 다음, 처리 속도를 그다음에 두겠습니다. 증거 무게는 가계 2, 빈도 2, 기능 2, 예측 1, 같은 위치 1입니다.</p>
        <p>선택: 보고선 22, 상담선 0으로 두고 정책 단계는 건너뛰겠습니다. 수동 변경은 하지 않습니다. 1단계 보고 분류는 0장이고 정책 판단을 보류하며 12장이 상담에 남습니다. 실제 운영 대안으로는 2차 발견 등 정보 종류별로 받을지 고르는 단계별 동의를 제안하겠습니다.</p>
        <p>얻는 것과 잃는 것: 상담까지 세면 민감도 6/6, 특이도 4/6입니다. 정보를 들을 범위를 고를 기회를 남기는 대신 확정 통보를 늦추고 상담 수요 12건으로 대기를 만듭니다. 이 게임은 아직 동의를 받지 않았으므로 정책 판단을 보류한 1단계 보고 분류 0장을 동의 뒤의 결과로 읽으면 안 됩니다.</p>
        <p>약점: 상담을 기다리는 동안 대비가 늦어질 수 있습니다. 동의 절차를 이해하기 어려운 참여자에게 선택권이 서류상으로만 주어질 수도 있습니다. 쉬운 설명, 통역, 다시 묻는 시간에 추가 자원이 필요합니다.</p>
      </details>
      <details class="reveal vd-reveal">
        <summary>과학 개념: 변이·유전형·발병을 구별하기</summary>
        <p>대립유전자 빈도는 비교 집단의 유전자 사본 중 특정 변이가 차지하는 비율입니다. 드물고 침투율이 높은 중한 유전 질환의 원인이라는 주장에 비해 변이가 너무 흔하다면 반대 근거가 될 수 있습니다. 반대로 드물다는 사실은 약한 근거입니다. 한 사람의 유전체에는 드문 변이가 많고 그 대부분은 병원성이 아니기 때문입니다. 이 카드 묶음에서도 빈도만 쓰면 드물지만 비병원성인 P-11·P-12 때문에 최소 4장을 잘못 분류합니다. 유전 양식과 침투율, 질환의 빈도에 따라 해석이 달라집니다.</p>
        <p>가계 내 공동분리는 변이와 특징이 가족 안에서 함께 전달되고 나타나는지 살피는 근거입니다. 단백질의 기능을 측정하는 실험이나 구조를 추정하는 계산과 다른 층위의 정보입니다. 가족 수가 적거나 아직 발병 시기가 아니거나 침투율이 낮으면 함께 보이지 않을 수도 있습니다. 공동분리만으로 원인을 확정할 수 없습니다. 공동분리의 반대 근거는 증상이 있는 가족에게 변이가 없는 경우입니다.</p>
        <p>침투율은 해당 유전형을 가진 사람 중 정한 관찰 기간에 특징이 나타나는 비율이고, 표현도는 나타나는 특징의 종류와 정도입니다. 병원성 변이가 있다는 사실만으로 발병 여부나 증상의 정도가 정해지지 않습니다. 이 게임의 침투율도 병원성이라는 조건 아래 주어진 가상 범위입니다.</p>
        <p>상염색체 우성에서는 한 사본의 변이로 영향이 나타날 수 있습니다. 상염색체 열성에서는 보통 양쪽 사본의 관련 변이를 함께 살펴야 합니다. 이 게임의 열성 카드는 다른 쪽 사본의 병원성 변이가 확인되어 있다는 조건을 적었습니다. 한 사본만 가진 보인자에게 같은 발병 범위를 적용하지 않습니다.</p>
        <p>X 연관에서는 X의 수와 해당 유전형, X 불활성화 등의 조건이 나타나는 양상에 영향을 줍니다. ‘X 연관은 한 성별에서만 나타난다’고 단정하지 않습니다. 같은 변이를 가졌는지와 같은 정도로 발현하는지도 다른 질문입니다.</p>
      </details>
      <details class="reveal vd-reveal">
        <summary>확률 해설: 비율 π가 바뀌면 무엇이 달라지는가</summary>
        <p>민감도는 병원성으로 설정한 카드 중 양성으로 분류한 비율입니다. 특이도는 비병원성으로 설정한 카드 중 음성으로 분류한 비율입니다. 양성예측도는 반대로 양성 판정을 받은 변이가 병원성일 가능성을 묻습니다. 질환 발병 확률과는 다릅니다.</p>
        <p>계산 구조만 보기 위해 민감도와 특이도가 모두 5/6으로 정확히 알려졌다고 가정하겠습니다. π=0.2%=1/500이면 PPV=(5/6×1/500)÷[(5/6×1/500)+(1/6×499/500)]=5/504입니다. π=5%=1/20이면 같은 식에서 5/24가 됩니다. 같은 분류 능력을 가정해도 판독 대상 변이 집단의 병원성 비율이 달라지면 양성예측도가 달라집니다.</p>
        <p>방금 두 분수는 공식을 손으로 확인하는 가정 계산입니다. 실제 화면에서는 카드 6장씩으로 얻은 5/6을 정확히 알려진 성능으로 보지 않습니다. 기본 기준의 보고·상담 집계에서 π=0.2%의 PPV 범위는 0.1~2.1%, π=5.0%에서는 4.3~35.3%입니다. 넓은 범위는 자료가 부족함을 드러냅니다. 한 번의 숫자로 좋은 검사인지 판정하지 않습니다.</p>
        <p>PPV와 침투율도 다릅니다. 예를 들어 모든 변이를 보고하여 PPV가 가정 π=1.0%와 같고, 병원성일 때 침투율이 40~70%인 동일 조건 집단을 가정하면 해당 변이로 인한 발병 범위는 0.01×[0.40,0.70]=0.4~0.7%입니다. 보고된 실제 개인의 전체 발병 위험을 뜻하지 않습니다. 미확정 카드에는 이 곱을 적용해 숫자를 만들지 않습니다.</p>
      </details>
      <details class="reveal vd-reveal">
        <summary>이 모형이 단순화한 것과 빠진 것</summary>
        <ul>
          <li>실제 변이 해석은 증거를 강도별로 조합하는 규칙 체계를 쓰며 단순 가중합이 아닙니다. 증거 간 의존성·중복과 질환별 기준도 이 저울에 충분히 반영하지 않았습니다.</li>
          <li>실제 지침(ACMG/AMP 2015)은 변이를 병원성, 병원성 가능성 높음, 의미불명, 양성(良性) 가능성 높음, 양성(良性)의 다섯 단계로 나눕니다. 이 게임의 가상 분류는 병원성·비병원성·미확정 세 값뿐이고, 보고/상담 후 결정/보고하지 않음은 변이 등급이 아니라 전달 방식입니다.</li>
          <li>실제로 강한 근거로 쓰이는 여러 종류가 이 저울에 없습니다. 기능 상실이 질환의 원인으로 알려진 유전자에서 단백질 기능을 잃게 하는 변이(PVS1), 부모에게 없이 새로 생긴 변이(de novo), 환자-대조군 비교 등이 그 예입니다. 이 게임은 생식세포 변이만 다루며, 암 조직 같은 체세포 변이는 다루지 않습니다.</li>
          <li>실제 해석에서 비교 집단의 대립유전자 빈도가 5%를 넘을 만큼 매우 흔하면(BA1) 그것만으로 양성(良性)으로 분류할 수 있습니다. 반면 ‘드물다’는 약한 지지 근거에 그치며, ClinGen은 이 근거(PM2)를 ‘지지’ 수준으로 낮춰 쓰도록 권고했습니다. 이 저울은 빈도 무게 하나로 양쪽을 같은 강도로 다룹니다. 컴퓨터 예측도 무게 하나로 다루었지만, 실제로는 보정을 거친 도구가 중간이나 강한 근거 수준에 이를 수 있습니다(Pejaver 외 2022).</li>
          <li>침투율은 분류 점수에 넣지 않고 보고 목록의 별도 조건부 계산에만 사용했습니다. 연령에 따른 변화, 예방·치료 효과, 환경과 다른 유전자의 영향은 계산하지 않았습니다.</li>
          <li>게임이 12장의 병원성 여부를 정하고 4장을 미확정으로 남긴 설정은 현실의 정답표가 아닙니다. 실제로는 새 증거에 따라 분류가 바뀔 수 있습니다. 의미불명 변이가 재분류될 때는 대부분 양성(良性) 쪽으로 내려갑니다. 유전성 암 검사 자료에서는 재분류된 의미불명 변이의 약 90%가 양성 또는 양성 가능성 높음으로 바뀌었습니다(Mersch 외 2018, JAMA).</li>
          <li>카드 12장은 직접 고른 교육 자료입니다. 여기에서 기준을 정하고 다시 집계한 값은 새로운 표본의 검사 성능이 아닙니다. Wilson 식으로 만든 범위도 실제 95% 신뢰구간이 아니며 선택 편향과 과적합을 해결하지 못합니다.</li>
          <li>π는 변이 집단에 관한 가정입니다. 개인의 대립유전자 빈도나 질환 유병률과 같지 않습니다. 집단별 차이는 넣지 않았으며 특정 집단의 위험을 비교할 수 없습니다.</li>
          <li>1단계 보고 분류의 PPV와 침투율을 같은 조건의 다른 변이 집단에 적용할 수 있다고 단순화했습니다. 서로 다른 질환·유전형·정책으로 선택된 실제 사람에게 그대로 곱할 수 없습니다. 비병원성·환경 등 다른 원인에 의한 발병도 빠졌습니다.</li>
          <li>상담의 질, 설명의 이해도, 접근성, 보험·고용 차별 위험, 정보 보관과 재연락 비용을 점수로 바꾸지 않았습니다. ‘상담 1건’이 모두 같은 시간과 자원을 쓰는 것도 가정입니다.</li>
          <li>정책 스위치는 실제 법적 허용 여부를 판정하지 않습니다. 혈족 고지는 검토 대상으로만 세고, 연락을 보내거나 실제 의료 조치를 실행하지 않습니다. 한국의 「생명윤리 및 안전에 관한 법률」 제46조는 유전정보를 이유로 한 차별을 금지합니다.</li>
          <li>이 게임의 ‘2차 발견’은 사업의 1차 목적(동의한 질환군) 밖의 발견이라는 가정입니다. 실제 ACMG 2차 발견 권고 목록(ACMG SF)은 예방·치료 조치가 가능한 유전자만 담으므로, 2차 발견이면서 예방·치료법이 없는 P-04 같은 경우는 그 목록 밖입니다.</li>
        </ul>
      </details>
    </div>`;
  }
  KCP.YEARS[ID] = {
    title:"변이 판독대",format:"증거 저울 · 카드 분류",desc:"증거의 무게를 바꾸어 변이 카드 16장을 분류하고, 무엇을 알릴지 판단합니다.",
    prep:25,answer:15,mode:"개인 또는 모둠 · 카드 16장 · 선택형 정책 단계",original:true,
    topics:["생명과학","보건","정보와 선택권"],concepts:["사람의 유전","대립유전자","유전 양식","변이(교과서의 돌연변이)","유전자와 단백질","침투율과 표현도","조건부확률","표본과 불확실성"],
    rubric:{
      "발산적 사고력":["저울과 문턱을 바꾸는 방법 외에 동의·재분류 통보·상담 운영의 대안을 제안한다.","자신과 다른 입장이 타당할 수 있는 조건을 자료에 근거하여 설명한다.","상담 인력이 줄어드는 반문에 여러 대응을 비교하고 수정 또는 유지의 이유를 말한다."],
      "문제해결 능력":["증거 다섯 종의 무게와 두 문턱을 먼저 밝히고 카드 이동을 근거로 설명한다.","보고만 양성인 집계와 보고·상담을 양성으로 본 집계를 구별하여 놓침과 과보고를 해석한다.","병원성 변이의 비율·양성예측도·침투율을 구별하고 작은 자료의 불확실성을 설명한다."],
      "인문적 통찰 역량":["자신의 기준이 얻는 것(예: 대비 기회, 듣지 않을 선택권)과 잃는 것(예: 놓침, 불필요한 개입, 상담 자원)을 한 문장에 함께 담는다.","참여자·혈족·보호자·상담사의 입장에서 정보 제공의 이익과 부담을 검토한다.","미확정이라는 한계를 숨기지 않고 이해하기 쉬운 설명과 차별 방지 방안을 제안한다."]
    },
    intent:["증거에 두는 비중을 조작으로 드러내고 판단 기준을 먼저 말하게 한다.","같은 증거로 구별되지 않는 카드를 통해 놓침과 과보고의 관계를 살핀다.","변이의 병원성·침투율·발병을 구별하고 작은 자료에서 나온 수치의 한계를 읽는다.","과학적 분류와 정보를 전달하는 정책이 서로 다른 판단임을 드러낸다.","반문 뒤 기준을 수정하거나 유지하는 이유와 저울 밖의 제도를 제안하게 한다."]
  };
  KCP.games[ID] = {brief,renderPrep,questions,recap,reflectExtra,
    model:{compute,classify,confusion,wilson,bayes,ppvRange,ppvText,pctRange,fraction,normalizeGame,normalizeSettings,validSnapshot,
      questionKeys:state => questions(state).map(q => q.k),questionsFromSnapshot,
      cards:() => clone(CARDS),defaults:() => clone(DEFAULTS)}};
  KCP.ORIGINAL_ORDER = KCP.ORIGINAL_ORDER || [];
  if (!KCP.ORIGINAL_ORDER.includes(ID)) KCP.ORIGINAL_ORDER.push(ID);
  if (typeof KCP.on === "function") {
    for (const event of ["room:render","reflect:render"]) KCP.on(event,payload => { if (payload.year === ID) syncPhases(payload.state); });
  }
})();
