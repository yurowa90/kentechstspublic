/* 도시 경제 모형(화면 없음, SPEC v2, 3차(v1.2) 보정). 1턴 = 1달.
 * - 주민·산업은 지역 총량 안에서 더 좋은 도시로 옮긴다(로짓 목표 몫 + 관성, 정수 보존).
 * - 재정: 1월 국가 재정지원금 + 달마다 주민·산업 세 − 공공서비스·보조·운영비·이자.
 * - 집단 6개 만족 → 지지율(Democracy), 정책·투자 효과는 λ만큼씩 늦게 닿는다.
 * - 국제 지수(LNG·환율·수출·해운)는 씨앗 고정 무작위 걷기 + 사건. 난수는 씨앗 난수만 쓴다.
 * 모든 함수는 E를 바꾸지 않고 새 E를 돌려준다(진행자 기기가 돌리고 모두에게 알린다).
 */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP) return;
  const DATA = () => KCP.ECON_DATA;
  const fin = (x, d) => (typeof x === "number" && isFinite(x) ? x : d);
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const num = (x, lo, hi, d) => clamp(fin(x, d), lo, hi);
  const c100 = x => clamp(fin(x, 0), 0, 100);
  // 판정·회계와 표시 경로가 같은 G 장부 눈금을 공유한다(QUALITY-model §8.3).
  // 보고 사본도 장부와 같은 정밀도로 읽게 하며, 배수의 곱셈→나눗셈 순서를 보존한다.
  const r1 = (x, data) => { const mul = pv(data, "ledgerRound1"); return Math.round(x * mul) / mul; };
  const r3 = (x, data) => { const mul = pv(data, "ledgerRound3"); return Math.round(x * mul) / mul; };
  const sum = a => a.reduce((s, x) => s + x, 0);
  const clone = x => JSON.parse(JSON.stringify(x));
  const fmt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const pv = (data, k) => data.params[k].v;
  // 씨앗 난수(league-core.js와 같은 꼴)
  function hashStr(x) { let h = 2166136261; for (let i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const rngOf = (E, tag) => rng(hashStr(E.seed + ":" + tag));

  /* ---------- 시간 ---------- */
  const SEASONS = { 12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring", 6: "summer", 7: "summer", 8: "summer", 9: "autumn", 10: "autumn", 11: "autumn" };
  const seasonOfMonth = m => SEASONS[m] || "spring";
  const monthsInGame = n => ([12, 24, 36].includes(n) ? n : 12);
  const leap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysOf = (y, m) => [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] || 30;
  // 대표 7일 결과를 달 전체로 늘리는 배수(정전 %는 그대로)
  const weekMul = (y, m) => daysOf(y, m) / 7;
  const monthLabel = E => `${E.year}년 ${E.month}월`;

  /* ---------- 정수 나누기(보존) ---------- */
  // arr(실수)을 합이 target(정수)인 정수 배열로. 큰 소수 부분부터 1씩(같으면 앞 도시부터).
  function roundSum(arr, target) {
    const base = arr.map(x => Math.floor(fin(x, 0))), frac = arr.map((x, i) => fin(x, 0) - base[i]);
    let k = target - sum(base);
    const ord = arr.map((_, i) => i).sort((a, b) => frac[b] - frac[a] || a - b);
    if (!ord.length) return base;
    for (let j = 0; k > 0; j++, k--) base[ord[j % ord.length]]++;
    for (let j = ord.length - 1; k < 0; j--, k++) base[ord[((j % ord.length) + ord.length) % ord.length]]--;
    return base;
  }
  // 순이동(합 0)을 도시 쌍 흐름으로: 잃은 도시마다 얻은 도시의 남은 몫에 비례해 나눈다(행·열 합 정확).
  function pairFlows(ids, mig) {
    const rem = mig.map(x => Math.max(0, x)), out = [];
    ids.forEach((from, i) => {
      const loss = -Math.min(0, mig[i]);
      if (!loss) return;
      const tot = sum(rem);
      if (!tot) return;
      const part = roundSum(rem.map(r => (loss * r) / tot), loss);
      part.forEach((n, j) => { if (n > 0) { out.push({ from, to: ids[j], n }); rem[j] -= n; } });
    });
    return out.sort((a, b) => b.n - a.n);
  }

  /* ---------- 입력 정리 ---------- */
  const has = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k) && typeof o[k] === "number" && isFinite(o[k]);
  function cleanInput(raw, C, S, data) {
    data = data || DATA();
    const P = k => pv(data, k), priceBounds = P("inputPriceMulBounds"), policyBounds = P("inputPolicyStepBounds");
    const I = raw || {}, e = I.energy || {}, po = I.policy || {}, as = I.assets || {};
    const BIG = 1e7;
    const energy = {
      // H01: 생산 기준 월 MWh. 누락은 무배출과 구분하며 CO₂로 역산하지 않는다.
      genMWh: e.genMWh && typeof e.genMWh === "object" && !Array.isArray(e.genMWh)
        ? Object.fromEntries(["coal", "lng", "diesel", "biomass", "smr"].map(f => [f, num(e.genMWh[f], 0, BIG, 0)])) : null,
      // 호스트 내부 PM 장부만 신·구를 구분한다. 구버전 입력은 genMWh의 기존 가중으로 계산한다.
      pmGenMWh: e.pmGenMWh && typeof e.pmGenMWh === "object" && !Array.isArray(e.pmGenMWh)
        ? Object.fromEntries(["coal", "lng", "diesel", "biomass", "coalNew", "lngNew"].map(f => [f, num(e.pmGenMWh[f], 0, BIG, 0)])) : null,
      residentDemandShare: num(e.residentDemandShare, 0, 1, 1), priceMul: num(e.priceMul, priceBounds[0], priceBounds[1], 1), bioCo2: num(e.bioCo2, 0, BIG, 0), unsPct: num(e.unsPct, 0, 100, 0), hospH: num(e.hospH, 0, P("inputHospHoursMax"), 0),
      costPerMWh: has(e, "costPerMWh") ? clamp(e.costPerMWh, 0, P("inputCostPerMWhMax")) : null,
      co2Local: has(e, "co2Local") ? clamp(e.co2Local, 0, BIG) : null,
      co2: has(e, "co2") ? clamp(e.co2, 0, BIG) : null,
      renPct: num(e.renPct, 0, 100, 0), tradeNet: num(e.tradeNet, -BIG, BIG, 0), royalty: num(e.royalty, 0, BIG, 0),
      opex: num(e.opex, 0, BIG, 0), capexNew: num(e.capexNew, 0, BIG, 0),
      bonus: num(e.bonus, -BIG, BIG, 0), salvage: num(e.salvage, 0, BIG, 0),
      demMWh: has(e, "demMWh") ? clamp(e.demMWh, 0, BIG) : null,
      servedMWh: has(e, "servedMWh") ? clamp(e.servedMWh, 0, BIG) : null,
      buyCost: num(e.buyCost, 0, BIG, Math.max(0, -fin(e.tradeNet, 0))),
      co2Int: has(e, "co2Int") ? clamp(e.co2Int, 0, P("inputCo2IntMax")) : null,
      fossilMWh: has(e, "fossilMWh") ? clamp(e.fossilMWh, 0, BIG) : null,
      spareMW: has(e, "spareMW") ? clamp(e.spareMW, 0, BIG) : null,
      exportMWh: num(e.exportMWh, 0, BIG, 0), importMWh: num(e.importMWh, 0, BIG, 0), tieCost: num(e.tieCost, 0, BIG, 0),
      cpList: (Array.isArray(e.cpList) ? e.cpList : []).filter(c => c && ["noise", "view", "smoke", "forest", "siting"].includes(c.kind)).map(c => ({ kind: c.kind, score: num(c.score, 0, BIG, 0), near: c.near, src: c.src }))
    };
    const old = C.policy, step = (x, d) => Math.round(num(x, policyBounds[0], policyBounds[1], d));
    const policy = { taxRes: step(po.taxRes, old.taxRes), taxInd: step(po.taxInd, old.taxInd), service: step(po.service, old.service), incentive: num(po.incentive, 0, P("inputIncentiveMax"), old.incentive) };
    const assets = {
      uni: num(as.uni, 0, P("inputUniMax"), S.univ0 || 0), lab: num(as.lab, 0, P("inputLabMax"), S.lab0 || 0),
      port: as.port == null ? !!S.port : !!as.port, site: as.site == null ? !!S.site : !!as.site,
      houseCap: has(as, "houseCap") && as.houseCap > 0 ? as.houseCap : null,
      indCap: has(as, "indCap") && as.indCap > 0 ? as.indCap : null
    };
    if (po.save === true) policy.save = true;
    if (po.share === true) policy.share = true;
    if (po.re100 === true) policy.re100 = true;
    return { energy, policy, assets };
  }

  /* ---------- 지역 맥락 ---------- */
  function pmContext(ids, ins, data) {
    const weights = { ...pv(data, "pmFuelW"), ...Object.fromEntries(Object.entries(pv(data, "pmNewFuelW") || {}).map(([f, w]) => [f + "New", w])) }, own = {}, neighbours = {};
    ids.forEach(id => {
      const gen = ins[id].energy.pmGenMWh ?? ins[id].energy.genMWh;
      own[id] = gen == null ? null : pv(data, "kPM") * sum(Object.keys(weights).map(f => weights[f] * fin(gen[f], 0)));
      neighbours[id] = new Map();
    });
    // D-69: 현재 게임의 참가 도시 사이, 자료에 있는 발원 → 수용 방향만 합산한다.
    // 연계선·다른 지역 목록을 순회하지 않고 발원 도시 자체 증분만 한 번 사용한다.
    (data.airNeighbours || []).forEach(({ from, to, ratio }) => {
      if (from !== to && neighbours[from] && neighbours[to] && Number.isFinite(ratio) && !neighbours[to].has(from)) neighbours[to].set(from, ratio);
    });
    return Object.fromEntries(ids.map(id => [id, {
      own: own[id],
      delta: fin(own[id], 0) + sum([...neighbours[id]].map(([n, ratio]) => ratio * fin(own[n], 0))),
      complete: own[id] != null && [...neighbours[id].keys()].every(n => own[n] != null)
    }]));
  }
  function regionCtx(E, ins, data) {
    const ids = E.order, C = E.cities;
    const supplied = sum(ids.map(id => servedOf(ins[id].energy)));
    const costs = sum(ids.map(id => servedOf(ins[id].energy) * fin(ins[id].energy.costPerMWh, pv(data, "normalCost"))));
    const popT = sum(ids.map(id => C[id].pop)), indT = sum(ids.map(id => C[id].ind));
    return {
      pm25: pmContext(ids, ins, data),
      avgCost: supplied > 0 ? costs / supplied : null,
      otherCost: Object.fromEntries(ids.map(id => { const e = ins[id].energy, rest = supplied - servedOf(e); return [id, rest > 0 ? (costs - servedOf(e) * fin(e.costPerMWh, pv(data, "normalCost"))) / rest : pv(data, "normalCost")]; })),
      taxResAvg: sum(ids.map(id => ins[id].policy.taxRes)) / Math.max(1, ids.length),
      taxIndAvg: sum(ids.map(id => ins[id].policy.taxInd)) / Math.max(1, ids.length),
      jobsAvg: indT / Math.max(1, popT),
      jobsAvg0: E.totals.ind0 / Math.max(1, E.totals.pop0),
      popGrowth: popT / Math.max(1, E.totals.pop0),
      popAvg: popT / Math.max(1, ids.length),
      youthAvg: sum(ids.map(id => C[id].pop * C[id].groups.youth.share)) / Math.max(1, popT)
    };
  }
  const ctxOf = (E, ins, data, id, reg) => ({ inp: ins[id], reg: reg || regionCtx(E, ins, data), intl: E.intl.cur, data, start: data.start[id] || {} });
  const mixOf = S => S.mix || { other: 1 };
  function re100Of(S, data) { const m = mixOf(S); return sum(Object.keys(m).map(k => m[k] * (pv(data, "sectorRe100")[k] ?? pv(data, "sectorRe100").other))); }
  const wsum = (parts, w, data) => { let a = 0, b = 0; Object.keys(w).forEach(k => { if (parts[k] != null) { a += w[k] * parts[k]; b += w[k]; } }); return b > 0 ? c100(a / b) : pv(data, "neutralScore"); };
  // 넘침 꼴: 수용의 90%까지 90점 이상, 넘으면 빠르게 감점(SimCity 'R 수요' 포화)
  const crowdScore = (over, data) => { const knee = pv(data, "crowdKnee"), base = pv(data, "crowdBase"); return c100(over <= knee ? base + (100 - base) * (knee - over) / knee : base - pv(data, "crowdSlope") * (over - knee)); };
  const servedOf = e => e.servedMWh != null ? Math.min(e.servedMWh, e.demMWh == null ? e.servedMWh : e.demMWh) : (e.demMWh || 0) * (1 - e.unsPct / 100);
  const priceScore = (e, reg, data, previous) => servedOf(e) <= 0 ? fin(previous, pv(data, "neutralScore")) : !reg.avgCost ? pv(data, "neutralScore") : c100(pv(data, "neutralScore") * (pv(data, "priceScoreIntercept") - Math.max(fin(e.costPerMWh, reg.avgCost), reg.avgCost * pv(data, "priceFloor")) / reg.avgCost));
  const taxSatisfaction = (step, average, data) => { const d = step - pv(data, "taxYardstick") * fin(average, 0); return c100(pv(data, "taxBase") + pv(data, "taxGain") * -d * (d > 0 ? pv(data, "lossAversion") : 1)); };
  const carbonScore = (C, data) => {
    const W = pv(data, "scoreCo2Worst"), T = pv(data, "scoreCo2Best");
    const mid = pv(data, "scoreCo2Mid"), cut = pv(data, "scoreCo2RelCut");
    const I = fin(C.co2Intensity, fin(C.co2Intensity0, pv(data, "co2IntDef")));
    const absolute = c100(I >= W ? 0 : I <= 0 ? 100 : I >= T ?
      mid * (W - I) / (W - T) : mid + (100 - mid) * (T - I) / T);
    const I0 = fin(C.co2Intensity0, 0);
    if (I0 <= 0) return absolute;
    const r = 1 - I / I0;
    const relative = c100(r <= 0 ? 0 : r >= 1 ? 100 : r <= cut ?
      mid * r / cut : mid + (100 - mid) * (r - cut) / (1 - cut));
    return Math.max(absolute, relative);
  };
  const serviceBase = (C, data) => C.pop * (pv(data, "svcCost") + C.groups.senior.share * pv(data, "svcCostSenior"));
  const debtRatio = (C, data) => Math.max(0, -C.cash) / Math.max(1e-9, pv(data, "budgetToRevenue") * C.revYear);
  const debtStage = (c, data = KCP.ECON_DATA) => c.cash < -c.debtCap || debtRatio(c, data) >= pv(data, "debtCrisisRatio") - 1e-12 ? "crisis" :
    -c.cash >= pv(data, "debtWarnRatio") * c.revYear - 1e-12 ? "warn" : "ok";
  const approvalRelative = E => { const ds = E.order.map(id => E.cities[id].approval - E.cities[id].approval0); const avg = ds.length > 1 ? sum(ds) / ds.length : 0; return Object.fromEntries(E.order.map((id, i) => [id, ds[i] - avg])); };
  const lagRate = (key, data) => pv(data, ["svc", "re", "crowd", "talent", "land", "labor", "air"].includes(key) ? "lambdaSlow" : "lambdaFast");
  // 호스트가 발전량을 넘기면 사용, 없으면 비재생 공급량을 화석 사용의 대리값으로 쓴다(G).
  const fossilOf = e => e.fossilMWh != null ? e.fossilMWh : (e.demMWh || 0) * Math.max(0, 1 - (e.unsPct + e.renPct) / 100);
  function co2IntOf(e, data) {
    if (servedOf(e) <= 0) return pv(data, "co2IntDef");
    if (e.co2 != null) return clamp(e.co2 / servedOf(e), 0, pv(data, "inputCo2IntMax"));
    if (e.co2Int != null) return e.co2Int;
    return pv(data, "co2IntDef");
  }

  /* ---------- 살기 좋음 L ---------- */
  function livability(city, ctx) {
    const data = ctx.data || DATA(), P = k => pv(data, k), e = ctx.inp.energy, as = ctx.inp.assets, pol = city.policy, reg = ctx.reg;
    const pop = Math.max(1, city.pop);
    // REF 3.7: 현재와 시작 모두 활성 지역 평균 대비 비율로 비교한다.
    const jobs = (city.ind / pop) / Math.max(1e-6, reg.jobsAvg);
    const jobs0 = (city.ind0 / Math.max(1, city.pop0)) / Math.max(1e-6, reg.jobsAvg0);
    const parts = {
      rel: c100(100 * (1 - e.unsPct / P("unsZeroL")) - P("hospPen") * Math.min(1, e.hospH / P("hospPenHours"))),
      price: priceScore(e, reg, data, city.lagL && city.lagL.price),
      air: c100(P("airBase") - P("airSlope") * (reg.pm25?.[city.id]?.delta || 0)),
      jobs: c100(P("neutralScore") + P("jobsJ") * 100 * Math.log(Math.max(1e-6, jobs) / Math.max(1e-6, jobs0))),
      svc: c100(P("neutralScore") + P("serviceCurve")[pol.service + 2] + Math.min(P("eduMax"), P("eduUni") * as.uni + P("eduLab") * as.lab)),
      tax: c100(P("taxBase") - P("taxPoints") * (pol.taxRes - fin(reg.taxResAvg, 0))),
      crowd: c100(P("neutralScore") - P("crowdK") * 100 * (pop / Math.max(1, city.pop0) - reg.popGrowth))
    };
    const w = P("wL");
    return { score: wsum(parts, w, data), parts, w };
  }

  /* ---------- 산업 매력 A ---------- */
  function industryAttract(city, ctx) {
    const data = ctx.data || DATA(), P = k => pv(data, k), e = ctx.inp.energy, as = ctx.inp.assets, pol = city.policy, reg = ctx.reg, I = ctx.intl || {}, S = ctx.start;
    const pop = Math.max(1, city.pop), ind = Math.max(1, city.ind), mix = mixOf(S);
    const steelX = (mix.steel || 0) * (S.exportShare || 0);
    const parts = {
      rel: c100(100 * (1 - e.unsPct / P("unsZeroA"))),
      price: servedOf(e) <= 0 ? fin(city.lagA && city.lagA.price, P("neutralScore")) : !reg.avgCost ? P("neutralScore") : c100(P("neutralScore") + P("priceSlopeA") * (1 - Math.max(fin(e.costPerMWh, reg.avgCost) * e.priceMul / reg.avgCost, P("priceFloor")))),
      re: c100((100 * e.renPct) / P("reTarget")),
      labor: c100(P("neutralScore") + P("laborLog") * Math.log(pop / Math.max(1, reg.popAvg)) + P("laborYouth") * (city.groups.youth.share - reg.youthAvg)),
      talent: c100(P("talentBase") + P("talentUni") * as.uni + P("talentLab") * as.lab),
      logi: c100(P("logiBase") + (as.port ? P("logiPortPoints") * fin(I.ship, 1) : 0) + (as.site ? P("logiSitePoints") : 0)),
      tax: c100(P("taxBase") - P("taxPoints") * (pol.taxInd - fin(reg.taxIndAvg, 0))),
      inc: c100(100 * (1 - Math.exp(-pol.incentive / (P("incRef") * ind / P("incentiveWorkersUnit"))))),
      land: crowdScore(ind / (as.indCap || city.ind0 * (S.landCapMul || P("landCapMul"))), data),
      carbon: c100(100 * (1 - co2IntOf(e, data) / (P("carbonRefMul") * P("co2IntRef"))))
    };
    const w0 = P("wA"), w = Object.assign({}, w0);
    w.price = w0.price * (P("priceWeightBase") + P("priceSteelMul") * (mix.steel || 0));
    w.re = w0.re * (P("reWeightBase") + re100Of(S, data));
    if (ctx.inp.policy.re100) w.re *= P("re100PolicyWeight");
    w.carbon = w0.carbon + (I.eu_indirect ? data.intl.events.find(e => e.id === "eu_indirect").carbonWeight * steelX : P("carbonWeight") * steelX);
    return { score: wsum(parts, w, data), parts, w };
  }

  /* ---------- 국제 지수 ---------- */
  function initIntl(data) {
    const b = data.intl.base;
    const I = { walk: clone(b), active: [], cur: null };
    I.cur = intlCur(I, data);
    return I;
  }
  function intlCur(I, data) {
    const bounds = pv(data, "intlCurrentBounds");
    const ev = I.active.map(a => (data.intl.events.find(x => x.id === a.id) || {}).fx || {});
    const add = k => sum(ev.map(f => fin(f[k], 0)));
    const exp = {};
    Object.keys(I.walk.export).forEach(s => { exp[s] = r3(clamp(I.walk.export[s] + sum(ev.map(f => fin((f.export || {})[s], 0))), bounds.export[0], bounds.export[1]), data); });
    const lng = r3(clamp(I.walk.lng + add("lng") + fin(I.marketLng, 0), bounds.lng[0], bounds.lng[1]), data), fx = r3(clamp(I.walk.fx + add("fx"), bounds.fx[0], bounds.fx[1]), data);
    return {
      marketLng: fin(I.marketLng, 0), lng, fx, ship: r3(clamp(I.walk.ship + add("ship"), bounds.ship[0], bounds.ship[1]), data), export: exp,
      cbam: add("cbam") > 0 ? 1 : 0, eu_indirect: add("eu_indirect") > 0 ? 1 : 0,
      fuelMul: r3(lng * fx, data), active: I.active.map(a => ({ id: a.id, name: a.name, until: a.until }))
    };
  }
  function intlStep(E, data) {
    const I = E.intl, D = data.intl, bounds = pv(data, "intlWalkBounds"), R = rngOf(E, "intl:" + E.t), n = () => (R() + R() - 1) * Math.sqrt(6);
    // params가 원장. JSON/structuredClone 사본에서 복제 시점과 달라진 별칭만 우선한다.
    // params만 수정하면 새 params, 별칭도 수정하면 별칭 우선(sigma=0 등 기존 검사 계약).
    const snapshot = D.paramSnapshot;
    const P = (key, legacy) => snapshot && legacy !== snapshot[key] ? legacy : pv(data, key);
    const theta = k => P("intlTheta" + k[0].toUpperCase() + k.slice(1), D.theta[k]);
    const sigma = k => P("intlSigma" + k[0].toUpperCase() + k.slice(1), D.sigma[k]);
    const rev = (k, x, m, s, lo, hi) => clamp(x + theta(k) * (m - x) + s * n(), lo, hi);
    I.marketLng = fin(I.nextMarketLng, 0);
    I.walk.lng = rev("lng", I.walk.lng, D.base.lng, sigma("lng"), bounds.lng[0], bounds.lng[1]);
    I.walk.fx = rev("fx", I.walk.fx, D.base.fx, sigma("fx"), bounds.fx[0], bounds.fx[1]);
    I.walk.ship = rev("ship", I.walk.ship, D.base.ship, sigma("ship"), bounds.ship[0], bounds.ship[1]);
    Object.keys(I.walk.export).forEach(s => { I.walk.export[s] = rev("export", I.walk.export[s], fin(D.base.export[s], 1), sigma("export"), bounds.export[0], bounds.export[1]); });
    I.active = I.active.filter(a => a.until > E.t);
    const started = [];
    const start = ev => {
      if (I.active.some(a => a.id === ev.id)) return;
      const dur = ev.dur[0] + Math.floor(R() * (ev.dur[1] - ev.dur[0] + 1));
      I.active.push({ id: ev.id, name: ev.name, until: E.t + dur });
      started.push({ id: ev.id, name: ev.name, dur, text: ev.text });
    };
    (D.schedule || []).filter(s => s.t === E.t).forEach(s => { const ev = D.events.find(x => x.id === s.id); if (ev) start(ev); });
    const free = D.events.filter(ev => !ev.sched && !ev.disabled && !I.active.some(a => a.id === ev.id));
    const roll = R(), pick = R();
    if (I.active.filter(a => a.until < E.t + 900).length < P("intlMaxActive", D.maxActive) && free.length && roll < P("intlEventP", D.eventP)) start(free[Math.floor(pick * free.length)]);
    I.cur = intlCur(I, data);
    return started;
  }

  /* ---------- 시작 ---------- */
  function initCities(ids, data, opts) {
    data = data || DATA(); opts = opts || {};
    const P = k => pv(data, k), list = (ids || Object.keys(data.start)).filter(id => data.start[id]);
    const cities = {};
    list.forEach(id => {
      const S = data.start[id], gs = S.groups || {}, gT = sum(Object.keys(data.groups).map(g => fin(gs[g], 0))) || 1;
      const groups = {};
      Object.keys(data.groups).forEach(g => { groups[g] = { share: fin(gs[g], 0) / gT, sat: P("neutralScore") }; });
      cities[id] = {
        id, name: S.name || id, pop: Math.round(S.pop0), ind: Math.round(S.ind0), pop0: Math.round(S.pop0), ind0: Math.round(S.ind0),
        cash: fin((opts.cash || {})[id], S.cash0 || 0), cash0: 0, equalize: 0, debtCap: 0, revYear: 0, revenueHistory: [], subsidy: 0,
        policy: { taxRes: 0, taxInd: 0, service: 0, incentive: 0 },
        groups, approval: P("neutralScore"), L: P("neutralScore"), A: P("neutralScore"), Leff: 0, Aeff: 0, lagL: {}, lagA: {}, baseL: {}, baseA: {},
        out: 1, unsS: 0, co2pc: 0, renS: 0, unrest: 0, hist: []
      };
    });
    const pop0 = sum(list.map(id => cities[id].pop)), ind0 = sum(list.map(id => cities[id].ind));
    const E = {
      v: 1, seed: String(opts.seed == null ? "kcp" : opts.seed), t: 0, year: data.startYear || 2027, month: 1,
      len: monthsInGame(opts.months), order: list, cities, totals: { pop0, ind0, pop: pop0, ind: ind0 },
      intl: initIntl(data), offers: [], nextOffer: 0, paidYear: null
    };
    const g = P("offerGap");
    E.nextOffer = g[0] + Math.floor(rngOf(E, "offer:init")() * (g[1] - g[0] + 1));
    list.forEach(id => { const C = cities[id]; C.cash0 = C.cash; });
    setBase(E, opts.base || {}, data);
    return E;
  }

  // 기준 매력: 시작 상태(opts.base 또는 calibrate 입력, 없으면 중립)의 부분 점수.
  // 지금 분포는 이미 시작 조건의 균형이라 보고 anchor만큼 상쇄한다 → 시작 뒤 '달라진 것'이 이동을 만든다.
  function setBase(E, raw, data) {
    const P = k => pv(data, k), ins = {};
    E.order.forEach(id => { ins[id] = cleanInput(raw[id], E.cities[id], data.start[id] || {}, data); });
    const reg = regionCtx(E, ins, data);
    E.intl.fossilBase = sum(E.order.map(id => fossilOf(ins[id].energy)));
    E.intl.marketLng = 0; E.intl.nextMarketLng = 0;
    E.intl.cur = intlCur(E.intl, data);
    E.order.forEach(id => {
      const C = E.cities[id], ctx = ctxOf(E, ins, data, id, reg), l = livability(C, ctx), a = industryAttract(C, ctx);
      C.baseL = l.parts; C.lagL = clone(l.parts); C.L = l.score;
      C.baseA = a.parts; C.lagA = clone(a.parts); C.A = a.score;
      const own = ownRev(C, ins[id], data, 1, reg), e0 = ins[id].energy;
      // 단가를 바꾸지 않고 시작 보통 조건의 운영 수지를 정액 이전재원으로 맞춘다.
      const operating = own.resTax + own.indTax + own.tariff - netOpex(e0) - serviceBase(C, data);
      const baseSub = subsidyBase(C, data), startTax = 12 * (C.pop0 * P("resTax") + C.ind0 * P("indTax"));
      // 지원금 보정도 시작 연 세입에 포함되므로 목표식을 보정액에 대해 푼다.
      C.equalize = r3(clamp((P("fiscalTargetRev") * (startTax + baseSub) - 12 * operating - baseSub) / (1 - P("fiscalTargetRev")), 0, baseSub * P("equalizeMaxShare") / (1 - P("equalizeMaxShare"))), data);
      C.revenueHistory = []; C.standardRevenueHistory = []; C.outHistory = [];
      C.revYear = Math.max(0, 12 * (own.resTax + own.indTax + own.facility) + subsidyOf(C, data));
      C.Leff = 0; C.Aeff = 0;
      C.debtCap = r1(P("debtCapRatio") * C.revYear, data);
      // 지연 추적·집단 만족도 시작 상태의 균형값에서 출발(아무것도 안 하면 지지율이 저절로 오르내리지 않게)
      const e = ins[id].energy, co2 = e.co2 != null ? e.co2 : fin(e.co2Local, 0);
      C.co2Intensity0 = co2IntOf(e, data);
      C.co2Intensity = C.co2Intensity0;
      C.unsS = e.unsPct; C.renS = e.renPct; C.co2pc = co2 / Math.max(1, C.pop / 1000);
      C.out = outIdx(C, ins[id], E.intl.cur, data, E.year).v;
      C.hospRel = l.parts.rel - c100(100 * (1 - e.unsPct / P("unsZeroL")));
      const g = groupTargets(C, ins[id], C.out, data, reg);
      C.groupContrib = clone(g.contrib); C.groupParts = clone(g.parts);
      Object.keys(C.groups).forEach(k => { C.groups[k].sat = g.tg[k]; });
      C.approval = c100(sum(Object.keys(C.groups).map(k => C.groups[k].share * C.groups[k].sat)));
      C.approval0 = C.approval;
      C.approvalHistory = [];
    });
    return E;
  }
  // 진행자가 시작 지도(새 건설 없음)를 한 번 돌린 결과로 기준을 다시 잡는다. 첫 monthStep 전에.
  function calibrate(E, inputs, data) { data = data || DATA(); return setBase(clone(E), inputs || {}, data); }

  /* ---------- 재정 ---------- */
  function fsrOf(C, data) {
    const S = data.start[C.id] || {}, j = (C.ind / Math.max(1, C.pop)) / Math.max(1e-6, C.ind0 / Math.max(1, C.pop0));
    const exponent = pv(data, "fsrExponent"), bounds = pv(data, "fsrBounds");
    // 기존 지수 1/2에서는 sqrt 연산을 유지해 부동소수점 계산 경로도 보존한다.
    const change = exponent === 0.5 ? Math.sqrt(Math.max(0, j)) : Math.pow(Math.max(0, j), exponent);
    return clamp(fin(S.fsr0, pv(data, "fsrDefault")) * change, bounds[0], bounds[1]);
  }
  function subsidyBase(C, data) {
    const P = k => pv(data, k);
    return P("subBase") + P("subPerCap") * C.pop + P("subEq") * C.pop * Math.max(0, P("fsrRef") - fsrOf(C, data));
  }
  function subsidyOffset(C, data) {
    const h = C.standardRevenueHistory || [];
    if (h.length < 12) return 0;
    const base = 12 * (C.pop0 * pv(data, "resTax") + C.ind0 * pv(data, "indTax"));
    return pv(data, "subRevenueRate") * pv(data, "subAdjust") * (sum(h) - base);
  }
  function equalizeOf(C, data) {
    const base = Math.max(0, subsidyBase(C, data) - subsidyOffset(C, data)), cap = pv(data, "equalizeMaxShare");
    const mul = pv(data, "equalizeFloorUnit");
    // G 장부 단위(기본 0.001억) 내림: 보정 지원금의 실제 지급액·상한에 닿는다.
    return Math.floor(Math.min(Math.max(0, fin(C.equalize, 0)), base * cap / (1 - cap)) * mul) / mul;
  }
  const subsidyOf = (C, data) => r3(Math.max(0, subsidyBase(C, data) - subsidyOffset(C, data)) + equalizeOf(C, data), data);
  const subsidyNewsPrefix = "국가 재정지원금 연액: ";
  const subsidyPayNote = (data = DATA()) => `(지급 월마다 1/${pv(data, "subsidyPayMonths").length} 지급)`;
  // 예전 저장의 차익 포함 세입 이력은 v1.2 세금·지원금 이력으로 넘기지 않는다.
  function restoreDefaults(E, data) {
    E.order.forEach(id => {
      const c = E.cities[id];
      c.equalize = Math.max(0, fin(c.equalize, 0));
      c.approval0 = fin(c.approval0, c.approval);
      c.hist = c.hist || [];
      c.approvalHistory = c.approvalHistory || c.hist.slice(-pv(data, "approvalWindow")).map(h => h.appr).filter(Number.isFinite);
      if (c.revenueVersion !== pv(data, "revenueVersion")) c.revenueHistory = [];
      c.revenueVersion = pv(data, "revenueVersion");
      c.revenueHistory = c.revenueHistory || [];
      c.standardRevenueHistory = c.standardRevenueHistory || [];
    });
    return E;
  }
  // 자기수요 연료·정책·구매비는 차익에서 한 번 차감한다. 판매용 연료·대응·연구는 별도 지출.
  const netOpex = e => Math.max(0, e.opex + e.buyCost - servedOf(e) * (e.costPerMWh || 0));
  function ownRev(C, inp, data, out, reg) {
    const P = k => pv(data, k), e = inp.energy, pol = C.policy;
    // H03: 생산지 과세(수출 생산 포함, 수입 제외). 지도 축척은 기존 지역 숫자 필드를 쓴다.
    // genMWh.smr: 호스트 내부 입력(공개 상태 아님). PM 가중(pmFuelW)에는 smr이 없어 대기 계산에는 들어가지 않는다.
    const mwScale = Object.values(KCP.LEAGUE_REGIONS || {}).find(r => r.teams.some(t => t.id === C.id))?.mwScale || 0;
    const o = {
      resTax: r3(C.pop * P("resTax") * (1 + P("taxStep") * pol.taxRes), data),
      indTax: r3(C.ind * P("indTax") * Math.pow(C.outHistory?.length ? sum(C.outHistory) / C.outHistory.length : 1, P("indTaxK")) * (1 + P("taxStep") * pol.taxInd), data),
      facility: P("facilityShare") * sum(Object.entries(P("facilityRate")).map(([fuel, rate]) => rate * (e.genMWh?.[fuel] || 0))) * mwScale * P("mwhToKwh") / P("wonPerEok") / P("moneyScale"),
      tariff: e.demMWh != null ? r3(servedOf(e) * ((reg.otherCost[C.id]) * (1 + P("tariffMarkup")) - fin(e.costPerMWh, reg.otherCost[C.id])), data) : 0,
      trade: r3(Math.max(0, e.tradeNet + e.buyCost), data)
    };
    return o;
  }
  // 연초에 연액과 한도를 확정하고 분기 초에 1/4을 지급한다.
  function prepareYear(E, data) {
    if (E.month !== 1 || E.fiscalYear === E.year) return;
    E.order.forEach(id => {
      const C = E.cities[id];
      if (C.revenueHistory.length === 12) C.revYear = Math.max(0, sum(C.revenueHistory));
      C.debtCap = r1(pv(data, "debtCapRatio") * C.revYear, data);
      C.subsidy = subsidyOf(C, data);
      // B14: 1월에 공지한 연액에서 정액 항목을 분리해 비지급 달에도 같은 기준 사용.
      C.subsidyFixed = pv(data, "subBase") + equalizeOf(C, data);
    });
    E.fiscalYear = E.year;
  }
  function yearStart(E, data) {
    data = data || DATA();
    const quarter = `${E.year}:${E.month}`;
    const payMonths = pv(data, "subsidyPayMonths");
    if (!payMonths.includes(E.month) || E.paidQuarter === quarter) return { E, subsidy: {} };
    const E2 = restoreDefaults(clone(E), data), subsidy = {};
    prepareYear(E2, data);
    E2.order.forEach(id => { const C = E2.cities[id], s = C.subsidy / payMonths.length; C.cash += s; C.paidSubsidy = s; subsidy[id] = s; });
    E2.paidQuarter = quarter;
    return { E: E2, subsidy };
  }
  // 지금 쓸 수 있는 돈(현금 + 남은 지방채 한도)
  const spendable = (C, data = DATA()) => r1(C.cash + C.debtCap, data);

  /* ---------- 산업 산출 지수 ---------- */
  function outIdx(C, inp, I, data, year = data.startYear) {
    const P = k => pv(data, k), S = data.start[C.id] || {}, mix = mixOf(S), xs = fin(S.exportShare, P("exportShareDefault")), e = inp.energy;
    const exportEff = xs * (sum(Object.keys(mix).map(s => mix[s] * (fin((I.export || {})[s], 1) - 1))) + P("fxExport") * (fin(I.fx, 1) - 1));
    const logi = inp.assets.port ? P("logiPort") * (fin(I.ship, 1) - 1) : 0;
    const phases = P("cbamPhase"), years = Object.keys(phases).map(Number);
    const phaseYear = years.reduce((a, b) => Math.abs(b - year) < Math.abs(a - year) ? b : a);
    const cbam = I.cbam || I.eu_indirect ? (mix.steel || 0) * xs * P("cbamEuShare") * P("cbamDrop") * phases[phaseYear] * P("eduCbam") * (I.eu_indirect ? co2IntOf(e, data) / P("co2IntRef") : 1) : 0;
    const v = clamp(1 - (P("outRel") + P("outRelSemi") * ((mix.semi || 0) + (mix.display || 0))) * e.unsPct + exportEff + logi - cbam, P("outMin"), P("outMax"));
    return { v, exportEff, logi, cbam };
  }

  /* ---------- 이동 ---------- */
  const WHY_L = { rel: "정전이 잦아서", price: "전기요금이 비싸서", air: "공기가 나빠서", jobs: "일자리가 적어서", svc: "공공서비스가 부족해서", tax: "세금이 무거워서", crowd: "집값이 올라서" };
  // REF 3.3·3.5·3.7–3.12: 방향 근거와 점수 크기 등급을 구분한다.
  const WHY_L_GRADE = { rel: "G", price: "G", air: "G", jobs: "M", svc: "M", tax: "M", crowd: "G" };
  const WHY_A = { rel: "전력이 불안해서", price: "전기값이 비싸서", re: "재생에너지가 모자라서", labor: "인력이 부족해서", talent: "인재가 적어서", logi: "물류가 불편해서", tax: "세금이 무거워서", inc: "유치 보조가 적어서", land: "산업 용지가 모자라서", carbon: "전력 탄소가 많아서" };
  // 실효 매력 = 지금 − anchor × 기준(시작 차이 상쇄)
  const effOf = (C, which, w, data) => {
    const lag = which === "L" ? C.lagL : C.lagA, base = which === "L" ? C.baseL : C.baseA, a = pv(data, "anchor");
    return wsum(lag, w, data) - a * wsum(base, w, data);
  };
  function move(E, key, eff, beta, kappa, totNew, data) {
    const ids = E.order, cur = ids.map(id => E.cities[id][key]), T = sum(cur);
    const m = sum(eff) / Math.max(1, eff.length);
    const mix = pv(data, "startMix"), total0 = E.totals[key + "0"], bounds = pv(data, "moveExponentBounds");
    const raw = cur.map((c, i) => ((1 - mix) * c / T + mix * E.cities[ids[i]][key + "0"] / total0) * Math.exp(clamp((beta * (eff[i] - m)) / pv(data, "moveUtilityScale"), bounds[0], bounds[1])));
    const Z = sum(raw) || 1, s = raw.map(x => x / Z);
    const mig = roundSum(cur.map((c, i) => kappa * (s[i] * T - c)), 0);
    const grow = roundSum(cur.map(c => (c / T) * (totNew - T)), totNew - T);
    ids.forEach((id, i) => { E.cities[id][key] = Math.max(1, cur[i] + mig[i] + grow[i]); });
    return { mig, grow, target: s };
  }
  function causeOf(Cf, Ct, which, w, data) {
    const a = which === "L" ? pv(data, "anchor") : 1, lagF = which === "L" ? Cf.lagL : Cf.lagA, lagT = which === "L" ? Ct.lagL : Ct.lagA;
    const bF = which === "L" ? Cf.baseL : Cf.baseA, bT = which === "L" ? Ct.baseL : Ct.baseA;
    let best = null, bv = -Infinity;
    Object.keys(w).forEach(k => {
      const d = w[k] * ((lagT[k] - a * bT[k]) - (lagF[k] - a * bF[k]));
      if (d > bv) { bv = d; best = k; }
    });
    const grade = which === "L" ? WHY_L_GRADE[best] : null;
    const why = (which === "L" ? WHY_L : WHY_A)[best] || "";
    return { part: best, why, whyGrade: grade || "G" };
  }

  /* ---------- 기업 이전 희망 ---------- */
  function makeOffer(E, data) {
    const R = rngOf(E, "offer:" + E.t), T = data.offers[Math.floor(R() * data.offers.length)];
    const pick = (r, step, mw) => {
      const ticks = Math.round((r[0] + R() * (r[1] - r[0])) / step);
      // MW는 역수로 나눠 현재 0.1 눈금의 부동소수 표현을 유지하고 더 작은 눈금도 허용한다.
      return mw ? ticks / (1 / step) : ticks * step;
    };
    return {
      id: "of" + E.t, tpl: T.id, name: T.name, sector: T.sector,
      workers: pick(T.workers, pv(data, "offerWorkersStep")), mw: pick(T.mw, pv(data, "offerMwStep"), true), rePct: pick(T.re, pv(data, "offerReStep")), unsMax: T.uns,
      t: E.t, until: E.t + pv(data, "offerLife")
    };
  }
  // 도시마다 조건을 맞추는지(여유 전력 · 재생 % · 정전 · 구직 인력). 정할 사람은 진행자.
  function evalOffer(offer, E, inputs, data) {
    data = data || DATA();
    const out = {};
    E.order.forEach(id => {
      const C = E.cities[id], inp = cleanInput((inputs || {})[id], C, data.start[id] || {}, data), e = inp.energy;
      const pool = Math.round(C.pop * (C.groups.worker.share + C.groups.youth.share) * pv(data, "seekRate"));
      const checks = {
        mw: { need: offer.mw, have: e.spareMW, ok: e.spareMW != null && e.spareMW >= offer.mw },
        re: { need: offer.rePct, have: r1(e.renPct, data), ok: e.renPct >= offer.rePct },
        rel: { need: offer.unsMax, have: r1(e.unsPct, data), ok: e.unsPct <= offer.unsMax },
        workers: { need: offer.workers, have: pool, ok: pool >= offer.workers }
      };
      const ks = Object.keys(checks), fail = ks.filter(k => checks[k].ok === false);
      out[id] = { ok: !fail.length, unknown: ks.filter(k => checks[k].ok == null), fail, checks, attract: C.Aeff - (C.unrest > 0 ? pv(data, "unrestAttract") : 0) };
    });
    const random = rngOf(E, "offer:tie:" + offer.id + ":" + E.t), tie = {};
    E.order.forEach(id => { tie[id] = random(); });
    const rank = E.order.slice().sort((a, b) => (out[b].ok - out[a].ok) || (out[b].attract - out[a].attract) || tie[a] - tie[b]);
    rank.forEach((id, i) => { out[id].rank = i + 1; });
    return { by: out, rank };
  }
  // 진행자가 고른 도시로 기업이 옮긴다: 종사자·주민 workers명을 다른 도시에서 산업 비례로 가져온다(총량 보존).
  function acceptOffer(E, offerId, cityId, data) {
    data = data || DATA();
    const E2 = clone(E), of = E2.offers.find(o => o.id === offerId);
    if (!of || !E2.cities[cityId]) return { E: E2, ok: false, moved: 0 };
    const others = E2.order.filter(id => id !== cityId);
    const take = (key) => {
      const have = others.map(id => E2.cities[id][key]), n = Math.min(of.workers, Math.max(0, sum(have) - others.length * pv(data, "offerSourceMin")));
      const part = roundSum(have.map(h => (n * h) / Math.max(1, sum(have))), n);
      others.forEach((id, i) => { E2.cities[id][key] -= part[i]; });
      E2.cities[cityId][key] += n;
      return n;
    };
    const moved = take("ind"); take("pop");
    E2.offers = E2.offers.filter(o => o.id !== offerId);
    return { E: E2, ok: true, moved, news: `${of.name} → ${E2.cities[cityId].name} 이전 확정(${fmt(moved)}명)` };
  }

  /* ---------- 전력 수요 배수 ---------- */
  function demandMul(city, city0, data) {
    data = data || DATA();
    const bounds = pv(data, "demandMulBounds");
    const p0 = city0 ? city0.pop : city.pop0, i0 = city0 ? city0.ind : city.ind0;
    return { res: r3(clamp(city.pop / Math.max(1, p0), bounds[0], bounds[1]), data), ind: r3(clamp(city.ind / Math.max(1, i0), bounds[0], bounds[1]), data) };
  }

  /* ---------- 집단 만족 ---------- */
  function groupTargets(C, inp, out, data, reg = {}) {
    const P = k => pv(data, k), W = P("groupW"), e = inp.energy;
    const parts = Object.assign({}, C.lagL, {
      air: c100(P("airBase") - P("eduAir") * P("airSlope") * (reg.pm25?.[C.id]?.delta || 0)),
      tax: taxSatisfaction(C.policy.taxRes, reg.taxResAvg, data),
      A: C.A, out: c100((100 * (out - P("outMin"))) / (P("outMax") - P("outMin"))), taxI: taxSatisfaction(C.policy.taxInd, reg.taxIndAvg, data),
      ren: c100((100 * C.renS) / P("reTarget")), co2: carbonScore(C, data)
    });
    const tg = {}, contrib = {};
    Object.keys(data.groups).forEach(g => {
      const w = W[g] || {}, z = sum(Object.keys(w).filter(k => parts[k] != null).map(k => w[k])) || 1;
      const terms = Object.fromEntries(Object.keys(w).map(k => [k, w[k] * fin(parts[k], 0) / z]));
      // 신뢰 점수에 이미 든 병원 감점도 별도 원인으로 분리한다(감점 총량은 유지).
      const hospital = (w.rel || 0) * fin(C.hospRel, 0) / z;
      terms.rel = fin(terms.rel, 0) - hospital;
      terms.hospital = hospital - (g === "senior" ? P("seniorHosp") * Math.min(1, e.hospH / P("hospPenHours")) : 0);
      terms.outage = e.unsPct >= P("outageSatThreshold") ? -P("outageSatPenalty") : 0;
      const complaints = sum(e.cpList.filter(c => (P("complaintGroups")[c.kind] || []).includes(g)).map(c => c.score));
      terms.complaint = -Math.min(P("complaintCap"), complaints * P("complaintScale"));
      const eligible = sum(e.cpList.filter(c => ["noise", "view"].includes(c.kind) && ["wind", "offshore", "solar"].includes(c.src) && (P("complaintGroups")[c.kind] || []).includes(g)).map(c => c.score));
      terms.share = inp.policy.share ? P("shareRelief") * Math.min(P("complaintCap"), eligible * P("complaintScale")) : 0;
      terms.save = inp.policy.save ? -P("saveSatPenalty") : 0;
      terms.unrest = C.unrest > 0 ? -P("unrestPenalty") : 0;
      const total = sum(Object.values(terms));
      tg[g] = c100(total);
      terms.bounds = tg[g] - total;
      contrib[g] = terms;
    });
    return { tg, parts, contrib };
  }
  // 실제 월 운영과 AI 예상이 같은 만족 기억·지지율 창을 사용한다.
  function advanceApproval(c, g, data) {
    const P = k => pv(data, k);
    const changes = {}, previous = c.groupContrib || {};
    Object.keys(c.groups).forEach(k => {
      const old = previous[k] || { other: c.groups[k].sat }, target = g.contrib[k], next = {};
      const memory = g.tg[k] < c.groups[k].sat ? 1 : P("approvalMemoryReal") * P("eduMemory");
      new Set([...Object.keys(old), ...Object.keys(target)]).forEach(key => {
        const delta = memory * (fin(target[key], 0) - fin(old[key], 0));
        next[key] = fin(old[key], 0) + delta;
        changes[key] = fin(changes[key], 0) + c.groups[k].share * delta;
      });
      g.contrib[k] = next;
      c.groups[k].sat = c100(c.groups[k].sat + memory * (g.tg[k] - c.groups[k].sat));
    });
    c.groupContrib = g.contrib; c.groupParts = clone(g.parts);
    c.approval = c100(sum(Object.keys(c.groups).map(k => c.groups[k].share * c.groups[k].sat)));
    c.approvalHistory.push(c.approval);
    if (c.approvalHistory.length > P("approvalWindow")) c.approvalHistory.shift();
    return changes;
  }

  const GW = { rel: "전력 신뢰", price: "전기요금", air: "공기", jobs: "일자리", svc: "공공서비스", tax: "세금", crowd: "집값", A: "산업 여건", out: "생산", taxI: "법인 세금", ren: "재생에너지", co2: "탄소 배출", outage: "정전 감점", hospital: "병원 정전 감점", complaint: "민원", share: "이익공유", save: "절전", unrest: "시위", bounds: "만족도 상한·하한", other: "이전 만족도" };
  function approvalChangeCause(causes, data) {
    const cause = causes[0];
    return { scope: "city-month-change", key: cause ? cause.key : null, part: cause ? cause.key : null,
      delta: cause ? cause.delta : 0,
      text: cause ? `${cause.label}: 이번 달 도시 전체 지지율 ${cause.delta > 0 ? "+" : ""}${r3(cause.delta, data)}%p` : "이번 달 지지율 변화 없음" };
  }
  function lowestGroupDissatisfaction(C, data) {
    const group = Object.keys(C.groups).sort((a, b) => C.groups[a].sat - C.groups[b].sat)[0];
    const w = pv(data, "groupW")[group], z = sum(Object.values(w)) || 1, terms = C.groupContrib[group];
    // 현재 만족 수준의 부족분: 가중 항은 만점 기여 대비, 별도 감점은 0 대비.
    // 월 변화량이 아니므로 계속되는 정전·민원을 공기 개선과 혼동하지 않는다.
    const deficits = Object.keys(terms).map(key => [key, Math.max(0, 100 * (w[key] || 0) / z - terms[key])])
      .filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const [key, deficit] = deficits[0] || [null, 0];
    return { scope: "lowest-group-level", group, key, deficit, satisfaction: C.groups[group].sat,
      text: key ? `${GW[key] || key}: 현재 만족도 부족 ${r3(deficit, data)}점(모형 추정)` : "현재 별도 불만 요인 없음" };
  }

  /* ---------- 한 달 ---------- */
  // inputs[id] = {energy:{genMWh?:{coal,lng,diesel,biomass,smr}(생산·월, smr은 H03 세입만), unsPct, hospH, costPerMWh, co2Local, co2?, renPct, tradeNet(판매−구매), royalty?(기술 사용료 수입), buyCost(구매 대금), servedMWh?, opex(구매 제외), capexNew, bonus?, salvage?, demMWh?, co2Int?, spareMW?},
  //               policy:{taxRes, taxInd, service, incentive}, assets:{uni, lab, port, site, houseCap?, indCap?}}
  function monthStep(E0, inputs, data) {
    data = data || DATA();
    if (E0.t >= E0.len) return { E: E0, report: null };
    const P = k => pv(data, k), E = restoreDefaults(clone(E0), data), ids = E.order, C = E.cities, lam = P("lambdaFast");
    inputs = inputs || {};
    const news = [], fiscal = {}, cashBefore = {};
    ids.forEach(id => { cashBefore[id] = C[id].cash; });
    // 1) 연액 공지와 분기 지급. yearStart 선지급과 중복하지 않는다.
    const sub = {}, subOffset = {}, equalize = {};
    const announce = E.month === 1 && E.announcedYear !== E.year;
    prepareYear(E, data);
    if (announce) {
      ids.forEach(id => { subOffset[id] = subsidyOffset(C[id], data); equalize[id] = equalizeOf(C[id], data); });
      E.announcedYear = E.year;
      news.push(`${subsidyNewsPrefix}${ids.map(id => `${C[id].name} ${Math.round(C[id].subsidy)}억${subsidyPayNote(data)}`).join(" · ")}`);
    }
    const quarter = `${E.year}:${E.month}`;
    if (P("subsidyPayMonths").includes(E.month) && E.paidQuarter !== quarter) {
      ids.forEach(id => { sub[id] = C[id].subsidy / P("subsidyPayMonths").length; });
      E.paidQuarter = quarter;
    }
    // 2) 국제
    const started = intlStep(E, data), I = E.intl.cur;
    started.forEach(s => news.push(`국제: ${s.name}${s.dur < 900 ? `(${s.dur}달)` : ""} — ${s.text}`));
    // 3) 입력 정리 · 정책 반영(시위 중 정책 바꾸기 비용)
    const ins = {}, polCost = {};
    ids.forEach(id => {
      const before = C[id].policy;
      ins[id] = cleanInput(inputs[id], C[id], data.start[id] || {}, data);
      const p = ins[id].policy, steps = Math.abs(p.taxRes - before.taxRes) + Math.abs(p.taxInd - before.taxInd) + Math.abs(p.service - before.service);
      polCost[id] = C[id].unrest > 0 ? steps * P("polChangeCost") : 0;
      C[id].policy = p;
    });
    // 4) 매력(목표 부분 점수 → λ 지연)
    const reg = regionCtx(E, ins, data), Lr = {}, Ar = {};
    ids.forEach(id => {
      const c = C[id], ctx = ctxOf(E, ins, data, id, reg), l = livability(c, ctx), a = industryAttract(c, ctx);
      Object.keys(l.parts).forEach(k => { c.lagL[k] += lagRate(k, data) * (l.parts[k] - c.lagL[k]); });
      Object.keys(a.parts).forEach(k => { c.lagA[k] = fin(c.lagA[k], a.parts[k]) + lagRate(k, data) * (a.parts[k] - fin(c.lagA[k], a.parts[k])); });
      const hospRel = l.parts.rel - c100(100 * (1 - ins[id].energy.unsPct / P("unsZeroL")));
      c.hospRel = fin(c.hospRel, 0) + lagRate("rel", data) * (hospRel - fin(c.hospRel, 0));
      c.L = wsum(c.lagL, l.w, data); c.A = wsum(c.lagA, a.w, data);
      c.Leff = effOf(c, "L", l.w, data);
      // 유치 순위는 시작 매력을 전부 빼서 같은 개선은 동점으로 취급한다.
      c.Aeff = wsum(c.lagA, a.w, data) - wsum(c.baseA, a.w, data);
      Lr[id] = { now: l, eff: c.Leff }; Ar[id] = { now: a, eff: c.Aeff };
    });
    const fossil = sum(ids.map(id => fossilOf(ins[id].energy)));
    const fossilBase = fin(E.intl.fossilBase, 0);
    E.intl.nextMarketLng = fossilBase > 0 ? clamp(P("lngMarketK") * (fossil / fossilBase - 1), -P("lngMarketMax"), P("lngMarketMax")) : 0;
    // 5) 이동(지역 총량 = 시작 × (1+g)^(달/12), 정수 보존)
    const mo = E.t + 1;
    const popNew = Math.round(E.totals.pop0 * Math.pow(1 + P("gpYear"), mo / 12));
    const indNew = Math.round(E.totals.ind0 * Math.pow(1 + P("giYear"), mo / 12));
    const before = {}; ids.forEach(id => { before[id] = { pop: C[id].pop, ind: C[id].ind }; });
    const mp = move(E, "pop", ids.map(id => Lr[id].eff), P("betaPopReal"), P("kappaPopReal") * P("eduSpeed"), popNew, data);
    const mi = move(E, "ind", ids.map(id => Ar[id].eff), P("betaIndReal"), P("kappaIndReal") * P("eduSpeed"), indNew, data);
    E.totals.pop = popNew; E.totals.ind = indNew;
    const wL = P("wL");
    const fp = pairFlows(ids, mp.mig).map(f => Object.assign(f, causeOf(C[f.from], C[f.to], "L", wL, data)));
    const fi = pairFlows(ids, mi.mig).map(f => Object.assign(f, causeOf(C[f.from], C[f.to], "A", Ar[f.to].now.w, data)));
    if (fp[0] && fp[0].n >= Math.max(P("newsMin"), before[fp[0].from].pop * P("newsFrac"))) news.push(`${C[fp[0].from].name} → ${C[fp[0].to].name} ${fmt(fp[0].n)}명 이주: ${fp[0].why}`);
    if (fi[0] && fi[0].n >= Math.max(P("newsMin"), before[fi[0].from].ind * P("newsFrac"))) news.push(`${C[fi[0].from].name} → ${C[fi[0].to].name} 일자리 ${fmt(fi[0].n)}개 이전: ${fi[0].why}`);
    // 6) 재정
    ids.forEach(id => {
      const c = C[id], inp = ins[id], e = inp.energy, o = outIdx(c, inp, I, data, E.year);
      c.out = o.v;
      c.outHistory = [...(c.outHistory || []), o.v].slice(-P("indTaxLag"));
      const own = ownRev(c, inp, data, o.v, reg);
      const rev = { subsidy: fin(sub[id], 0), resTax: own.resTax, indTax: own.indTax, facility: own.facility, tariff: own.tariff, trade: own.trade, royalty: r3(e.royalty, data), bonus: r3(e.bonus, data), salvage: r3(e.salvage, data) };
      const exp = {
        capex: r3(e.capexNew, data), opex: r3(netOpex(e), data),
        service: r3(serviceBase(c, data) * (1 + P("svcStep") * c.policy.service), data),
        incentive: r3(c.policy.incentive * (1 - (data.start[id]?.natShare || 0)), data), interest: r3(Math.max(0, -c.cash) * P("debtRate"), data),
        trade: 0, policy: r3(polCost[id], data)
      };
      const revT = sum(Object.values(rev)), expT = sum(Object.values(exp));
      // 선지급과 같은 덧셈 순서: 지원금을 먼저 더해 부동소수 오차로 두 경로가 갈리지 않는다.
      c.cash = (cashBefore[id] + rev.subsidy) + sum(Object.entries(rev).filter(([key]) => key !== "subsidy").map(([, value]) => value)) - expT;
      // 지방세 배분 세입도 연간 세입·지방채 한도에 포함. 표준 주민·산업세 기반 지원금 상쇄식은 유지.
      const recurring = own.resTax + own.indTax + own.facility;
      c.standardRevenueHistory = c.standardRevenueHistory || [];
      c.standardRevenueHistory.push(c.pop * P("resTax") + c.ind * P("indTax") * Math.pow(sum(c.outHistory) / c.outHistory.length, P("indTaxK")));
      if (c.standardRevenueHistory.length > 12) c.standardRevenueHistory.shift();
      c.revenueHistory.push(recurring + rev.subsidy + (c.paidSubsidy || 0));
      c.paidSubsidy = 0;
      if (c.revenueHistory.length > 12) c.revenueHistory.shift();
      const over = c.cash < -c.debtCap;
      const ratio = debtRatio(c, data), stage = debtStage(c, data);
      // 억/명·달. 주민세 + 인구 배분 지원금/12 + 주민 수요 몫 전기 차익 − 서비스 비용.
      // 정액 지원은 제외하며, 소액·음수 기여를 보존하도록 억 단위 반올림하지 않는다.
      const fixedSubsidy = fin(c.subsidyFixed, P("subBase") + equalizeOf(c, data));
      const perResidentNet = (rev.resTax + (c.subsidy - fixedSubsidy) / 12 + rev.tariff * e.residentDemandShare - exp.service) / Math.max(1, c.pop);
      if (over || stage !== "ok") news.push(`${c.name} 재정 ${stage === "crisis" || over ? `위기: 새 건설·유료 대응 제한, 재정 점수 ${r1(finScore(c, data), data)}` : `주의: 채무비율 ${+(100 * P("debtWarnRatio") / P("budgetToRevenue")).toFixed(2)}% 이상`}${over ? " — 운영 적자로 한도 초과 부채가 계속 쌓이고 있어요" : ""}`);
      fiscal[id] = { tariffGross: r3(servedOf(e) * reg.otherCost[id] * (1 + P("tariffMarkup")), data), eventBonus: r3(e.bonus, data), equalize: fin(equalize[id], 0), subsidyOffset: fin(subOffset[id], 0), rev, exp, revTotal: revT, expTotal: expT, cashBefore: cashBefore[id], cashAfter: c.cash, debtCap: c.debtCap, debtOver: over, debtRatio: ratio, debtStage: stage, spendable: spendable(c, data), out: o };
      fiscal[id].perResidentNet = perResidentNet;
      // 지연 추적(정전·CO₂·재생)
      const co2 = e.co2 != null ? e.co2 : fin(e.co2Local, 0);
      c.unsS += lam * (e.unsPct - c.unsS);
      c.co2pc += P("lambdaSlow") * (co2 / Math.max(1, c.pop / 1000) - c.co2pc);
      advanceCarbon(c, e, data);
      c.renS += P("lambdaSlow") * (e.renPct - c.renS);
    });
    // 7) 집단 만족 → 지지율
    const groups = {}, causes = {};
    ids.forEach(id => {
      const c = C[id], g = groupTargets(c, ins[id], c.out, data, reg);
      const changes = advanceApproval(c, g, data);
      causes[id] = Object.entries(changes).filter(([, delta]) => delta !== 0)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || a[0].localeCompare(b[0]))
        .slice(0, P("causeCount")).map(([key, delta]) => ({ key, label: GW[key] || key, delta }));
      const sats = {}; Object.keys(c.groups).forEach(k => { sats[k] = r1(c.groups[k].sat, data); });
      const change = approvalChangeCause(causes[id], data);
      groups[id] = { sat: sats, approval: r1(c.approval, data), approvalChangeCause: change,
        lowestGroupDissatisfaction: lowestGroupDissatisfaction(c, data),
        why: change.text, whyGrade: WHY_L_GRADE[change.key] || "G", contrib: clone(c.groupContrib), parts: g.parts }; // 옛 클라이언트 호환: 도시 전체 월 변화만. group 필드는 두지 않는다.
    });
    const relative = approvalRelative(E);
    ids.forEach(id => {
      const c = C[id];
      if (c.unrest > 0 && relative[id] >= -P("unrestOffDrop")) c.unrest = 0;
      else if (c.unrest <= 0 && relative[id] < -P("approvalDrop")) { c.unrest = P("unrestMonths"); news.push(`${c.name} 시위 — 다른 도시 대비 지지율이 회복되면 멈춰요`); }
    });
    // 8) 기업 이전 희망
    E.offers = E.offers.filter(o => o.until > E.t);
    if (E.t >= E.nextOffer) {
      const of = makeOffer(E, data), g = P("offerGap");
      E.offers.push(of);
      E.nextOffer = E.t + g[0] + Math.floor(rngOf(E, "offer:gap:" + E.t)() * (g[1] - g[0] + 1));
      news.push(`기업 이전 희망: ${of.name} ${fmt(of.workers)}명 · ${of.mw} MW · 재생 ${of.rePct}% 이상`);
    }
    const offers = E.offers.map(o => Object.assign(clone(o), { eval: evalOffer(o, E, inputs, data) }));
    // 9) 주민 평가(12턴마다)
    let review = null;
    if ((E.t + 1) % P("reviewEvery") === 0) {
      review = {};
      ids.forEach(id => {
        const c = C[id], pass = relative[id] >= -P("approvalDrop");
        if (!pass) { c.unrest = P("unrestMonths"); news.push(`평가: ${c.name} 지지율 ${Math.round(c.approval)}% — 시위, 정책 바꾸기 비용↑`); }
        review[id] = { approval: r1(c.approval, data), pass };
      });
    }
    // 10) 보고
    const cities = {};
    ids.forEach(id => {
      const c = C[id];
      c.hist.push({ t: E.t, pop: c.pop, ind: c.ind, cash: r1(c.cash, data), appr: r1(c.approval, data) });
      if (c.hist.length > P("historyMonths")) c.hist.shift();
      cities[id] = {
        pm25: reg.pm25[id], // ㎍/㎥ 증분. complete=false이면 알려진 발전량만의 부분 추정.
        causes: causes[id], L: r1(c.L, data), A: r1(c.A, data), Lparts: Lr[id].now.parts, Aparts: Ar[id].now.parts, Leff: r1(Lr[id].eff, data), Aeff: r1(Ar[id].eff, data),
        pop: c.pop, ind: c.ind, dPop: c.pop - before[id].pop, dInd: c.ind - before[id].ind,
        co2Intensity: c.co2Intensity, bioCo2: ins[id].energy.bioCo2, out: c.out, demandMul: demandMul(c, undefined, data), cash: r1(c.cash, data)
      };
    });
    const net = {};
    ids.forEach((id, i) => { net[id] = { pop: mp.mig[i], ind: mi.mig[i], growPop: mp.grow[i], growInd: mi.grow[i] }; });
    const report = {
      t: E.t, year: E.year, month: E.month, season: seasonOfMonth(E.month), days: daysOf(E.year, E.month), weekMul: r3(weekMul(E.year, E.month), data),
      flows: { pop: fp, ind: fi }, net, fiscal, groups, cities,
      intl: Object.assign(clone(I), { started, fossilMWh: r3(fossil, data), fossilEstimated: ids.some(id => ins[id].energy.fossilMWh == null), fossilBase: r3(fossilBase, data), nextMarketLng: E.intl.nextMarketLng }), offers, review, news, totals: clone(E.totals)
    };
    // 지역 실적은 월 MWh/t, 연계선 분담은 누적 투자 억. 감축은 실제 공급량 × 보통 배출계수 − 소비 배출(수입 포함, 음수 보존).
    const demand = sum(ids.map(id => ins[id].energy.demMWh || 0));
    const goal = inputs.region && inputs.region.goal || { uns: P("coopUnsGoal"), co2: demand * P("normalCo2") * (1 - P("coopCo2Cut") * Math.min(1, (E.year - P("coopCo2Path").baseYear) / P("coopCo2Path").rampYears)) * P("coopEase") };
    const uns = sum(ids.map(id => Math.max(0, (ins[id].energy.demMWh || 0) - servedOf(ins[id].energy))));
    const co2 = sum(ids.map(id => fin(ins[id].energy.co2Local, 0)));
    report.region = { unsPct: demand > 0 ? 100 * uns / demand : 0, co2, goal: clone(goal), met: { uns: demand > 0 && 100 * uns / demand <= goal.uns, co2: co2 <= goal.co2 } };
    report.contrib = Object.fromEntries(ids.map(id => {
      const e = ins[id].energy;
      return [id, { exportMWh: e.exportMWh, importMWh: e.importMWh, co2Cut: P("normalCo2") * servedOf(e) - fin(e.co2, fin(e.co2Local, 0)), tieCost: e.tieCost }];
    }));
    E.coop = report.region.met.uns && report.region.met.co2 ? P("coopBonus") : 0;
    // 다음 달로
    E.t++; E.month++;
    if (E.month > 12) { E.month = 1; E.year++; }
    // 다음 달 운영은 monthStep보다 먼저 cur.fuelMul을 읽는다. 이번 달 보고서는 I로 보존한다.
    E.intl.marketLng = E.intl.nextMarketLng;
    E.intl.cur = intlCur(E.intl, data);
    report.score = score(E, data);
    return { E, report };
  }

  function advanceCarbon(c, e, data) {
    const P = k => pv(data, k);
    if (servedOf(e) > 0) c.co2Intensity = fin(c.co2Intensity, fin(c.co2Intensity0, P("co2IntDef"))) + P("lambdaSlow") * (co2IntOf(e, data) - fin(c.co2Intensity, fin(c.co2Intensity0, P("co2IntDef"))));
    else c.co2Intensity = fin(c.co2Intensity, fin(c.co2Intensity0, P("co2IntDef")));
  }

  // D-87: 공개 대표 주의 소비 탄소와 민원을 고정해 남은 전망 기간 말 점수를 예상한다.
  // 인구·재정·신뢰·PM·세율·집단 구성 등은 현재 값 고정. 미래 사건·이주·거래 예측 아님.
  // 민원 외 집단 항은 현재 만족 기여를 유지하여 탄소/민원만의 한계 차이를 비교한다.
  function projectEnergyScore(E, id, energy, months, data = DATA()) {
    const c = clone(E.cities[id]), projected = { ...E, cities: { ...E.cities, [id]: c } };
    const inp = cleanInput({ energy, policy: c.policy }, c, data.start[id] || {}, data);
    const original = groupTargets(c, inp, c.out, data);
    for (let m = 0; m < months; m++) {
      advanceCarbon(c, inp.energy, data);
      const g = groupTargets(c, inp, c.out, data);
      // 다른 경제 항의 시차를 새로 예측하지 않는다. 같은 기준을 후보 전후에 사용한다.
      Object.keys(c.groups).forEach(k => {
        const terms = g.contrib[k], fixed = E.cities[id].groupContrib?.[k];
        if (fixed) {
          const carbonDelta = (terms.co2 || 0) - (original.contrib[k].co2 || 0);
          g.contrib[k] = { ...fixed, complaint: terms.complaint, share: terms.share,
            co2: (fixed.co2 || 0) + carbonDelta, bounds: 0 };
          const total = sum(Object.values(g.contrib[k]));
          g.tg[k] = c100(total); g.contrib[k].bounds = g.tg[k] - total;
        }
      });
      advanceApproval(c, g, data);
    }
    return score(projected, data).by[id];
  }

  /* ---------- 점수 · 순위 ---------- */
  function finScore(c, data) {
    const P = k => pv(data, k), marks = P("scoreFinDebtMarks");
    return c.cash < -c.debtCap ? P("scoreFinOverCap") : c100(100 - Math.max(0, debtRatio(c, data) - marks[0]) * (100 - P("neutralScore")) / (marks[1] - marks[0]));
  }
  function score(E, data) {
    data = data || DATA();
    const P = k => pv(data, k), w = P("wScore"), K = P("scoreGrowthK")[E.len] || P("scoreGrowthK")[36], T = E.totals;
    const floor = clamp(fin(P("scorePartFloor"), 1), 1, 100);
    const list = E.order.map(id => {
      const c = E.cities[id];
      // 증가율은 지역 총량 증가를 뺀 몫 변화(경쟁)
      const gp = (c.pop / Math.max(1, c.pop0)) / (T.pop / Math.max(1, T.pop0)) - 1;
      const gi = (c.ind / Math.max(1, c.ind0)) / (T.ind / Math.max(1, T.ind0)) - 1;
      const parts = {
        pop: c100(P("neutralScore") + K.pop * gp), ind: c100(P("neutralScore") + K.ind * gi),
        fin: finScore(c, data),
        co2: carbonScore(c, data),
        appr: c100(c.approvalHistory && c.approvalHistory.length ? sum(c.approvalHistory) / c.approvalHistory.length : c.approval), rel: c100(100 * (1 - fin(c.unsS, 0) / P("scoreUnsZero")))
      };
      Object.keys(parts).forEach(k => { parts[k] = r1(parts[k], data); });
      return { id, name: c.name, score: r1(c100(Math.exp(sum(Object.keys(w).map(k => w[k] * Math.log(Math.max(floor, parts[k])))) / sum(Object.values(w))) + fin(E.coop, 0)), data), parts, coop: fin(E.coop, 0) };
    });
    const rank = list.slice().sort((a, b) => b.score - a.score || E.order.indexOf(a.id) - E.order.indexOf(b.id));
    rank.forEach((x, i) => { x.rank = i + 1; });
    const by = {}; list.forEach(x => { by[x.id] = x; });
    return { rank, by, aggregation: { name: "균형 점수", formula: `0~100 자름(exp(Σ w × ln(max(${floor}, 부분 점수)) / Σ w) + 공동 보너스)`, weights: clone(w), floor } };
  }

  KCP.econ = {
    initCities, calibrate, livability, industryAttract, yearStart, monthStep, demandMul, score, projectEnergyScore,
    subsidyNewsPrefix, subsidyPayNote,
    evalOffer, acceptOffer, spendable, debtStage, outIdx, regionCtx, ctxOf, cleanInput,
    seasonOfMonth, monthsInGame, daysOf, weekMul, monthLabel, roundSum, pairFlows, hashStr, rng
  };
})();
