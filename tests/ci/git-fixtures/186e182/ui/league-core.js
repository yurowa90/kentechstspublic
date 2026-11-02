/* 멀티플레이 리그의 규칙(화면 없음). 진행자 기기가 이 규칙으로 상태를 정하고 모두에게 알린다.
 * - 상태(state): 방 · 라운드 · 단계 · 팀 자리와 계획 · 연계선 · 라운드 결과
 * - reduce(state, msg): 팀이 보낸 요청(자리 잡기 · 계획 · 판매 단가 · 연계선 · 준비)을 검사해 반영
 * - runRound(state, bg): 팀마다 자기 도시를 따로 돌린 뒤(bg = KCP.buildGame) settle로 도시 사이 거래를 정산
 * 정산은 시간마다: 모자란 도시가 연계선으로 이어진 이웃에게서 남는 재생 전력 → 남는 화력 여유 순으로, 단가가 싼 쪽부터 산다.
 * 팔 쪽 화력은 단가가 연료비보다 비쌀 때만 판다. 기본 연계선 손실은 TIE_LOSS. 돈은 도착한 양만큼 낸다.
 */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP) return;
  const PHASES = ["lobby", "plan", "run", "review", "end"];
  // M · LNG 0.008·SMP/LNG 0.91, 월 변동 범위 [S16][S18][S19] · REF 7.11
  const PRICE = { min: 0.004, max: 0.025, def: 0.009 };
  // G · 설계 선택: 전국 송변전 손실 1.57%보다 작은 한 구간 1% [S20] · REF 8.10
  const TIE_LOSS = 0.01, LOG_MAX = 40, GROW = 0.25;
  // 지난 라운드까지 운영한 설비·선을 철거하면 건설비의 30%만 돌려받는다(게임 가정 G). 이번 라운드에 놓은 것은 되돌리기라 전액.
  const SALV = 0.3;
  // 실제 운영 재생은 이 기기의 메모리에만 둔다(D-65).
  let lastRun = null, replayCache = null;
  // 시간 정전 문턱: 일반 정전 시간과 병원 정전 시간이 같은 규칙을 쓴다.
  const outageFloor = dem => Math.max(KCP.ECON_DATA.params.outageHourMinMW.v, KCP.ECON_DATA.params.outageHourShare.v * dem);
  const isOutHour = (uns, del, dem, k) => uns[k] - del[k] > outageFloor(dem[k]);
  function replayOf(round, id, salt = KCP.league?.state?.()?.S?.salt ?? 0, room = KCP.league?.state?.()?.room) {
    const data = replayCache?.round === round && replayCache.salt === salt && replayCache.room === room
      ? replayCache.data : null, t = data?.teams[id];
    return t ? { ...t, days: data.days, season: data.season, seed: data.seed, outHour: k => isOutHour(t.uns, t.del, t.dem, k) } : null;
  }

  const PLAN_MS = 8 * 60 * 1000, REVIEW_MS = 5 * 60 * 1000;

  const regionOf = id => (KCP.LEAGUE_REGIONS || {})[id] || null;
  const teamDef = (R, id) => R.teams.find(t => t.id === id) || null;
  const tieDef = (R, a, b) => R.ties.find(t => (t.a === a && t.b === b) || (t.a === b && t.b === a)) || null;
  const tieId = T => T.a + "~" + T.b;
  const isTeam = (R, id, S) => !!teamDef(R, id) && (!S || Object.hasOwn(S.teams, id));
  const num = (x, lo, hi, d) => (typeof x === "number" && isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
  const r2 = x => { const mul = KCP.ECON_DATA.params.ledgerRound2.v; return Math.round(x * mul) / mul; };
  const r3 = x => { const mul = KCP.ECON_DATA.params.ledgerRound3.v; return Math.round(x * mul) / mul; };

  // 참가 도시 고르기: 2~6곳, 꼭 들어갈 도시(R.must, 평택) 포함, 육상·만 횡단 연계선으로 서로 이어져야 한다(해저 연계선 후보는 이웃으로 치지 않음).
  const ALL = R => R.teams.map(t => t.id);
  function validTeams(R, list) {
    const ids = ALL(R).filter(id => (list || []).includes(id));
    if (ids.length < 2) return { ok: false, err: "2곳 이상 고르세요", ids };
    if (ids.length > R.teams.length) return { ok: false, err: "너무 많습니다", ids };
    const miss = (R.must || []).filter(id => !ids.includes(id));
    if (miss.length) return { ok: false, err: `${miss.map(id => teamDef(R, id).name).join(", ")}은(는) 꼭 들어가야 합니다`, ids };
    const seen = new Set([ids[0]]), q = [ids[0]];
    while (q.length) { const u = q.shift(); R.ties.forEach(T => { if (T.kind === "sea") return; const v = T.a === u ? T.b : T.b === u ? T.a : null; if (v && ids.includes(v) && !seen.has(v)) { seen.add(v); q.push(v); } }); }
    if (seen.size !== ids.length) return { ok: false, err: "고른 도시끼리 서로 이웃해야 합니다(육지·만으로 이어지게)", ids };
    return { ok: true, ids };
  }
  // 턴 목록: 달 턴(경제 모드, S.rounds = [{month, year, season, days}]) 또는 지역 기본(계절 4라운드)
  const SEASON_OF_MONTH = m => (m === 12 || m <= 2 ? "winter" : m <= 5 ? "spring" : m <= 8 ? "summer" : "autumn");
  function monthRounds(turns, y0, m0) {
    const out = [];
    for (let k = 0; k < turns; k++) { const mm = ((m0 - 1 + k) % 12) + 1, yy = y0 + Math.floor((m0 - 1 + k) / 12); out.push({ month: mm, year: yy, season: SEASON_OF_MONTH(mm), days: 7, mdays: new Date(Date.UTC(yy, mm, 0)).getUTCDate() }); }
    return out;
  }
  const roundsOf = S => (Array.isArray(S.rounds) && S.rounds.length ? S.rounds : regionOf(S.region).rounds);
  const activeOf = S => (Array.isArray(S.active) && S.active.length ? S.active : Object.keys(S.teams));
  // opt.turns(12·24·36)를 주면 1턴 = 1달(경제 모드). 없으면 지역 기본 라운드.
  function newState(room, regionId, now, list, opt) {
    lastRun = null; replayCache = null;
    const R = regionOf(regionId);
    if (!R) throw new Error("region");
    const V = validTeams(R, list || ALL(R));
    if (!V.ok) throw new Error(V.err);
    const teams = {};
    V.ids.forEach(id => { teams[id] = { token: null, online: 0, ready: false, plan: null, rev: 0, price: PRICE.def, hist: [] }; });
    if (KCP.TECH_DATA) V.ids.forEach(id => saveResearch(teams[id], researchOf(teams[id])));
    // 지역 CO₂ 목표는 고른 도시의 실제 사용량 몫만큼(6곳 = R.goals.co2)
    const tw = id => (teamDef(R, id).real || { twh: 1 }).twh, share = V.ids.reduce((a, id) => a + tw(id), 0) / ALL(R).reduce((a, id) => a + tw(id), 0);
    const goals = { unsPct: R.goals.unsPct, co2: Math.round(R.goals.co2 * share / 10) * 10 };
    const S = { v: 2, room, region: R.id, created: now || 0, rev: 1, round: 0, phase: "lobby", ends: null, active: V.ids, goals, teams, ties: [], results: [], events: [], log: [] };
    S.seedMode = opt?.seedMode === "room" ? "room" : "fixed";
    S.salt = S.seedMode === "room" ? hashStr(String(room)) : 0;
    // 명시한 모드는 모든 난수를 같은 판 소금으로 묶는다. 옛 호출·저장본의 씨앗은 보존한다.
    if (["room", "fixed"].includes(opt?.seedMode)) S.seedKey = String(S.salt);
    if (opt && [12, 24, 36].includes(opt.turns)) {
      S.rounds = monthRounds(opt.turns, opt.year || 2027, 1);
      // 경제 층(ui/econ.js): 주민·산업·현금·지지율. 시작 현금 = 도시 지도 예산.
      if (KCP.econ && KCP.ECON_DATA) {
        const cash = {}; V.ids.forEach(id => { cash[id] = baseBudget(R, id); });
        S.econ = KCP.econ.initCities(V.ids, KCP.ECON_DATA, { seed: S.seedKey ?? room, months: opt.turns, cash });
        S.econRep = null; S.econCal = false; S.grid = {};
        if (KCP.buildGame) { calibrateStart(S, R, KCP.buildGame); refreshGrid(S, KCP.buildGame); }
      }
    }
    return S;
  }

  function log(S, text, now) {
    let message = String(text);
    const econ = KCP.econ, prefix = econ?.subsidyNewsPrefix;
    if (prefix && message.startsWith(prefix) && typeof econ.subsidyPayNote === "function" && KCP.ECON_DATA) {
      const suffix = econ.subsidyPayNote(KCP.ECON_DATA);
      const cities = message.slice(prefix.length).replaceAll(suffix, "").split(" · ");
      let shown = cities.length;
      const compact = () => prefix + cities.slice(0, shown).join(" · ") + (shown < cities.length ? ` 외 ${cities.length - shown}곳` : "") + ` ${suffix}`;
      while (shown > 0 && compact().length > 120) shown--;
      message = compact();
    }
    S.log.push({ at: now || 0, t: message.slice(0, 120) });
    if (S.log.length > LOG_MAX) S.log.splice(0, S.log.length - LOG_MAX);
  }

  // 팀 예산: 처음 예산에서 라운드마다 25%씩 투자금이 더 들어온다. 연계선 몫은 빠진다.
  function packOf(R, id) { const t = teamDef(R, id); return t && KCP.BUILD_MAPS ? KCP.BUILD_MAPS[t.pack] : null; }
  function baseBudget(R, id) { const P = packOf(R, id); return P ? P.budget || 200 : 200; }
  function tieCost(R, T) { const D = tieDef(R, T.a, T.b); return D ? r2(D.cost * (T.cap === 4 ? 1.6 : 1) * (T.kind === "hvdc" && KCP.TECH_DATA ? tp("hvdcCost") : 1)) : 0; }
  function tieShare(S, R, id) { return S.ties.filter(T => T.st === "built" && (T.a === id || T.b === id)).reduce((a, T) => a + tieCost(R, T) / 2, 0); }
  function budget(S, id) {
    const R = regionOf(S.region);
    // 일반 예산만 반환한다(기존 자산 몫 포함). 재난 교부세는 grantOf로 별도 유도한다.
    // budget − spendOf만으로 승인 여부를 판단하지 않는다. 용도 제한·초과 예외는 fundingOf가 판정한다.
    // 경제 모드: 시작 현금 + 지방채 한도 + 확정 투자 − 새 연계선 몫 + 일반 사건 지원금
    if (S.econ && S.econ.cities[id]) {
      const T = S.teams?.[id] || {}, unpaid = ["lobby", "plan", "run"].includes(S.phase) ? bonusOf(S, R, id, S.round) : 0;
      const city = S.econ.cities[id], grant = ["lobby", "plan", "run"].includes(S.phase) ? grantAmount(S, R, id, S.round) : 0;
      // 교부세 달에도 초과 부채를 그대로 보존한다. 전용 건설 예외는 fundingOf가 판정한다.
      const headroom = city.cash + city.debtCap + unpaid - grant;
      return r2(headroom + (T.committed || 0) + (T.tieAt || 0) - tieShare(S, R, id));
    }
    return r2(baseBudget(R, id) * (1 + GROW * Math.max(0, S.round - 1)) - tieShare(S, R, id) + bonusOf(S, R, id) + (S.teams?.[id]?.royaltyNet || 0));
  }

  /* ---------- 돈의 흐름: 철거 손실 · 사건 대응비 ---------- */
  // 설비·선의 이름표. 같은 이름표면 같은 물건(지난 라운드부터 있던 것).
  const itemKey = (kind, x) => kind === "b" ? `b:${x.t}:${x.i}` : `l:${x.p.join("-")}`;
  const keysOf = plan => new Set([...((plan && plan.builds) || []).filter(b => b && b.t != null).map(b => itemKey("b", b)), ...((plan && plan.lines) || []).filter(L => L && Array.isArray(L.p)).map(L => itemKey("l", L))]);
  // base = 지난 운영 때 있던 물건 [{k, c(건설비)}]. 지금 계획에서 빠진 것마다 70%를 잃는다.
  function lossOf(base, plan) {
    if (!Array.isArray(base) || !base.length) return 0;
    const ks = keysOf(plan);
    return r2(base.reduce((a, x) => a + (ks.has(x.k) ? 0 : x.c * (1 - SALV)), 0));
  }
  function itemCosts(bg, R, id, plan) {
    return withPack(bg, R, id, () => {
      const st = bg.sanitize(plan || {}, 1e9);
      return [...st.builds.map(b => ({ k: itemKey("b", b), c: r2(bg.capex({ builds: [b], lines: [] })) })), ...st.lines.map(L => ({ k: itemKey("l", L), c: r2(bg.capex({ builds: [], lines: [L] })) }))];
    });
  }
  // 사건 대응: T.resp["라운드:사건"] = 고른 대응 id
  const respOpt = (R, S, id, ev) => { const T = S.teams && S.teams[id], o = T && T.resp && T.resp[ev.round + ":" + ev.id], E = eventDef(R, ev.id); return o && E && Array.isArray(E.opts) ? E.opts.find(x => x.id === o) || null : null; };
  function respCost(S, R, id, round, grantOnly = false) {
    return r2((S.events || []).filter(ev => round == null || ev.round === round).reduce((a, ev) => { const E = eventDef(R, ev.id), o = E && (!grantOnly || E.grant) && eventValid(S, R, E) && hits(R, E, id, S) ? respOpt(R, S, id, ev) : null; return a + (o ? o.cost || 0 : 0); }, 0));
  }
  // 사건 지원금(budgetAdd) — 조건부 유치·보류를 고르면 grant 배수만큼
  function bonusOf(S, R, id, round) {
    return r2((S.events || []).filter(ev => round == null || ev.round === round).reduce((a, ev) => {
      const E = eventDef(R, ev.id);
      if (!E || !eventValid(S, R, E) || !E.effect || typeof E.effect.budgetAdd !== "number" || !scopeHits(R, E, id)) return a;
      const o = respOpt(R, S, id, ev);
      return a + E.effect.budgetAdd * (o && typeof o.grant === "number" ? o.grant : 1);
    }, 0) + grantAmount(S, R, id, round ?? S.round));
  }
  // 추첨과 독립된 부가 지원. 월 모드에만 적용하며 대응 자격(hits)이 아닌 원래 효과 범위를 따른다.
  function grantAmount(S, R, id, round = S.round) {
    if (!S.econ) return 0;
    return r2((S.events || []).filter(ev => ev.round === round).reduce((sum, ev) => {
      const E = eventDef(R, ev.id);
      return sum + (E?.grant && eventValid(S, R, E) && scopeHits(R, E, id) ? KCP.ECON_DATA.params[E.grant.param].v : 0);
    }, 0));
  }
  // 월초 자산과 비교한 새 설비·선로의 총비용 + 이번 달 교부 대상 재난 대응비. 철거 회수·연계선·연구비는 제외.
  // 계획을 바꾸거나 요청을 나눠도 같은 자산을 두 번 지원하지 않는다. 상태/전송 필드를 만들지 않는다.
  function grantOf(S, R, id, bg = KCP.buildGame, plan = S.teams[id]?.plan || {}) {
    const awarded = ["lobby", "plan", "run"].includes(S.phase) ? grantAmount(S, R, id) : 0;
    if (!awarded) return { awarded: 0, eligible: 0, used: 0, left: 0 };
    const base = new Set((S.teams[id]?.base || []).map(x => x.k));
    const fresh = bg ? itemCosts(bg, R, id, plan).filter(x => !base.has(x.k)).reduce((sum, x) => sum + x.c, 0) : 0;
    const eligible = r2(fresh + respCost(S, R, id, S.round, true)), used = Math.min(awarded, eligible);
    return { awarded, eligible, used, left: r2(awarded - used) };
  }
  // 승인 경로와 AI가 공유하는 자금 판정. plan은 문법·해금 검사를 마친 후보다.
  // extra는 새 연계선 등 일반 지출. kind=respond는 유료 대응을 적용한 임시 상태에서 호출한다.
  // 기존 공개 budget/fixed/base/plan/resp/events만으로 재현하며 반환값을 저장·전송하지 않는다.
  function fundingOf(bg, S, R, id, plan = S.teams[id]?.plan || {}, { kind = "plan", extra = 0 } = {}) {
    const calculate = () => {
      const T = S.teams[id], city = S.econ?.cities[id], over = !!city && city.cash < -city.debtCap;
      const general = T.budget ?? budget(S, id), grant = grantOf(S, R, id, bg, plan);
      const spent = bg ? spendOf(bg, S, R, id, plan) : T.fixed ?? fixedOf(S, R, id);
      const generalSpend = r2(spent + extra - grant.used), left = r2(general - generalSpend);
      const covered = grant.awarded > 0 && grant.eligible <= grant.awarded + 1e-6;
      let reason = null;
      if (kind === "tie" && over) reason = "debt";
      else if (kind === "respond" && over) {
        // 교부 대상이 아닌 사건의 유료 대응에는 초과 부채 예외를 적용하지 않는다.
        if (!covered || respCost(S, R, id, S.round) > respCost(S, R, id, S.round, true) + 1e-6) reason = "budget";
      }
      else if (kind === "plan" && over) {
        const existing = keysOf(T.plan), adds = [...keysOf(plan)].some(k => !existing.has(k));
        if (adds && (!bg || !covered)) reason = "debt";
        // 한도 초과여도 기존 자산 유지·철거는 허용한다. 연구 예약에는 이 예외가 없다.
        else if (bg && (capexOf(bg, R, id, plan) > Math.max(capexOf(bg, R, id, T.plan || {}), covered ? capexOf(bg, R, id, plan) : 0) + 1e-6 ||
          researchReserve(S, id, bg, plan) > 0 && left < -1e-6)) reason = "budget";
      } else if (left < -1e-6) reason = "budget";
      return { ok: !reason, reason, general, grant, generalSpend, left, over };
    };
    return bg ? preserveMap(bg, calculate) : calculate();
  }
  // 계획 밖에서 이미 나간 돈: 지난 철거 손실 + 사건 대응비(모든 라운드)
  const fixedOf = (S, R, id) => r2(((S.teams[id] && S.teams[id].sunk) || 0) + ((S.teams[id] && S.teams[id].rfix) || 0) + respCost(S, R, id));

  /* 기술 트리: rs는 옛 화면/저장 호환, research가 확장 상태의 공개 이름이다. */
  const techCards = bg => KCP.TECH_DATA ? KCP.TECH_DATA.cards : bg.TECHS;
  const tp = k => KCP.TECH_DATA.params[k].v;
  function researchOf(T) {
    const old = T.research || T.rs || {};
    return { queue: (T.plan && T.plan.rq || old.queue || []).slice(), prog: { ...old.prog }, stage: { ...old.stage }, adoptR: { ...old.adoptR }, adopted: (old.adopted || []).slice(), eureka: (old.eureka || []).slice(), licensedFrom: { ...old.licensedFrom }, joint: Object.fromEntries(Object.entries(old.joint || {}).map(([key, value]) => [key, { ...value }])), jointEnded: { ...old.jointEnded }, royaltyMonths: { ...old.royaltyMonths }, drMonths: old.drMonths || 0, staff: old.staff || 0, eff: old.eff || 0 };
  }
  const techOf = (S, id) => {
    const T = S.teams[id], rs = T && (T.research || T.rs);
    return rs ? [...new Set([...(rs.adopted || []).filter(t => !rs.adoptR || rs.adoptR[t] == null || rs.adoptR[t] <= S.round), ...Object.keys(rs.adoptR || {}).filter(t => rs.adoptR[t] <= S.round)])] : [];
  };
  function saveResearch(T, rs) { T.research = rs; T.rs = rs; }
  // 연구 화면·예약 계산은 유레카·공동 연구 판정에서 다른 도시 지도를 고른다 — 화면 지도를 바꾸지 않게 감싼다.
  function researchView(S, id) {
    const bg = KCP.buildGame;
    return bg ? preserveMap(bg, () => researchViewRaw(S, id)) : researchViewRaw(S, id);
  }
  function researchViewRaw(S, id) {
    const rs = researchOf(S.teams[id]), cards = techCards(KCP.buildGame), adopted = techOf(S, id);
    const progress = Object.fromEntries(cards.map(c => [c.id, Math.min(100, 100 * (rs.prog[c.id] || 0) / (c.need * (rs.licensedFrom[c.id] ? tp("licenseNeed") : 1)))]));
    const titles = KCP.TECH_DATA ? KCP.TECH_DATA.titles.filter(t => cards.filter(c => c.branch === t.branch && adopted.includes(c.id)).length >= t.need.v).map(t => t.id) : [];
    return { ...rs, ...researchStaff(KCP.buildGame, S.teams[id]), adopted, progress, titles, reservedCost: researchReserve(S, id, KCP.buildGame, S.teams[id].plan), stepsPerTurn: S.econ && KCP.TECH_DATA ? tp("roundSteps") : KCP.buildGame.RS.roundSteps, current: researchTurn(S, id, KCP.buildGame, S.teams[id].plan).current || Object.keys(rs.stage).find(key => rs.stage[key] === "demo") || null,
      construction: { ...S.teams[id].construction } };
  }
  function researchError(S, id, queue, bg) {
    if (!Array.isArray(queue) || new Set(queue).size !== queue.length) return "research";
    const cards = techCards(bg), adopted = techOf(S, id), rs = researchOf(S.teams[id]);
    const selected = [...adopted, ...Object.keys(rs.stage).filter(t => rs.stage[t]), ...queue];
    if (KCP.TECH_DATA && KCP.TECH_DATA.pairs.some(pair => pair.every(t => selected.includes(t)))) return "exclusive";
    for (const key of queue) {
      const c = cards.find(x => x.id === key);
      if (!c) return "research";
      if (rs.stage[key] || adopted.includes(key)) continue;
      if (c.req && c.req.length && !(c.id === "mass" ? c.req.some(t => adopted.includes(t)) : c.req.every(t => adopted.includes(t)))) return "prerequisite:" + key;
      if (key === "re100" && (S.results.findLast(r => r.round !== S.round)?.team[id]?.renPct || 0) < tp("re100Need")) return "renewable";
    }
    return null;
  }
  function demoCost(S, id, c, bg, plan) {
    const rs = researchOf(S.teams[id]);
    const retro = c.id === "bms" ? (plan?.builds || []).filter(b => ["battery", "nbat"].includes(b.t)).length * bg.RS.retroBat : 0;
    return c.demo * (rs.joint[c.id]?.active ? tp("jointShare") : 1) + retro;
  }
  function researchReserve(S, id, bg, plan) {
    if (!KCP.TECH_DATA || !S.teams?.[id]) return 0;
    return bg ? preserveMap(bg, () => researchReserveRaw(S, id, bg, plan)) : researchReserveRaw(S, id, bg, plan);
  }
  function researchReserveRaw(S, id, bg, plan) {
    const rs = researchOf(S.teams[id]);
    const royalty = royaltyCards(S, id, bg, plan).length * tp("royalty");
    return royalty + (plan?.rq || []).reduce((sum, key) => {
      const c = techCards(bg).find(x => x.id === key);
      return sum + (c && !rs.stage[key] && !techOf(S, id).includes(key) ? demoCost(S, id, c, bg, plan) : 0);
    }, 0);
  }
  function researchStaff(bg, T) {
    const plan = T.plan || {}, n = kind => (plan.builds || []).filter(b => b.t === kind).length;
    const uni = (T.base || []).filter(x => x.k.startsWith("b:uni:") && keysOf(plan).has(x.k)).length;
    const staff = n("lab") * bg.RS.labStaff + uni * bg.RS.uniStaff;
    return { staff, eff: Math.min(staff, n("lab") * bg.RS.labSeats) };
  }
  function connectedTie(S, R, bg, a, b) {
    return S.ties.some(t => t.st === "built" && [t.a, t.b].includes(a) && [t.a, t.b].includes(b)) && [a, b].every(id => withPack(bg, R, id, () => {
      const net = bg.network(bg.sanitize(S.teams[id].plan || {}, 1e9));
      return net.nodes.some(n => n.kind === "import" && n.live && n.comp >= 0 && (bg.SITES[n.si].to || []).includes(id === a ? b : a));
    }));
  }
  function eurekaMet(S, R, bg, id, key, rs, result) {
    const plan = S.teams[id].plan || {}, adopted = techOf(S, id);
    const live = withPack(bg, R, id, () => bg.network(bg.sanitize(plan, 1e9)).nodes.filter(n => n.live));
    const has = (...ts) => live.some(n => ts.includes(n.kind));
    switch (key) {
      case "grid": return (plan.lines || []).length > 0;
      case "hvdc": return activeOf(S).filter(other => other !== id && connectedTie(S, R, bg, id, other)).length >= tp("eurekaTies");
      case "scable": return S.ties.some(t => t.st === "built" && t.kind === "hvdc" && [t.a, t.b].includes(id));
      case "sic": return result.renPct > 0;
      case "bms": return has("battery", "nbat");
      case "tandem": return live.filter(n => ["solar", "roof", "tandem", "tandem_roof"].includes(n.kind)).length >= tp("eurekaSolar") && result.renPct > 0;
      case "nbat": return adopted.includes("bms") && has("battery", "nbat");
      case "mass": return has("tandem", "tandem_roof", "nbat");
      case "h2store": return result.curtailMWh > 0 || (S.events || []).some(e => e.round === S.round && e.id === "light_load_curtailment" && result.renPct > 0);
      case "h2mix": return has("h2store");
      case "ccu": return has("coal") && result.co2Prod > 0;
      case "smr": { const c = S.econ?.cities[id]; return !!c && (c.approval >= c.approval0 - tp("eurekaApproval") || !c.unrest); }
      case "fcst": return (S.events || []).some(e => e.round === S.round && e.id === "heatwave_peak");
      case "vpp": return rs.drMonths >= tp("eurekaDr");
      case "re100": return result.renPct >= tp("re100Need");
      default: return false;
    }
  }
  function releaseJoint(S, id, key, reason) {
    const rs = researchOf(S.teams[id]), other = rs.joint[key]?.other;
    delete rs.joint[key]; rs.jointEnded[key] = reason; saveResearch(S.teams[id], rs);
    if (other && S.teams[other]) {
      const peer = researchOf(S.teams[other]);
      if (peer.joint[key]?.other === id) {
        delete peer.joint[key]; peer.jointEnded[key] = reason; saveResearch(S.teams[other], peer);
      }
    }
  }
  function releaseUnusedJoints(S, id) {
    const rs = researchOf(S.teams[id]);
    const current = rs.queue.find(key => !rs.stage[key] && !techOf(S, id).includes(key));
    Object.keys(rs.joint).forEach(key => {
      if (!rs.queue.includes(key) || rs.joint[key].active && current !== key)
        releaseJoint(S, id, key, "queue-changed");
    });
  }
  function advanceResearchAll(bg, R, S, res, now) {
    const cards = techCards(bg), states = {}, current = {}, finished = new Set();
    const eligible = (id, key) => !researchError(S, id, [key], bg);
    const first = id => {
      const rs = researchOf(S.teams[id]);
      return rs.queue.find(key => !rs.stage[key] && !techOf(S, id).includes(key) && eligible(id, key));
    };
    // 상대가 다른 카드를 택했으면 같은 진척에서 단독 연구를 이어 간다.
    activeOf(S).forEach(id => {
      const rs = researchOf(S.teams[id]);
      Object.entries(rs.joint).forEach(([key, joint]) => {
        const peer = S.teams[joint.other] && researchOf(S.teams[joint.other]);
        if (joint.active && (!peer || peer.joint[key]?.other !== id || !peer.joint[key]?.active || first(joint.other) !== key))
          releaseJoint(S, id, key, "partner-stopped");
      });
    });
    activeOf(S).forEach(id => {
      const T = S.teams[id], rs = researchOf(T);
      Object.assign(rs, researchStaff(bg, T));
      if ((T.plan?.policies || []).includes("dr")) rs.drMonths++;
      const { demo, current: cur } = researchTurn(S, id, bg, T.plan);
      demo.forEach(key => {
        rs.stage[key] = "done"; rs.adoptR[key] = S.round + 1;
        if (!rs.adopted.includes(key)) rs.adopted.push(key);
        log(S, `${teamDef(R, id).name}: ${cards.find(c => c.id === key).name} 개발 · 다음 턴 도입`, now);
      });
      // 한 턴은 연구 또는 실증 하나. 12달에 모든 카드를 쓸어 담지 않는다(T1).
      current[id] = cur && !researchError(S, id, [cur], bg) ? cur : null;
      states[id] = rs;
    });
    activeOf(S).forEach(id => {
      const rs = states[id], key = current[id], c = cards.find(c => c.id === key);
      if (!c || finished.has(id + ":" + key)) return;
      const other = rs.joint[key]?.active && rs.joint[key].other;
      const partners = other && current[other] === key && states[other].joint[key]?.other === id && connectedTie(S, R, bg, id, other) ? [id, other] : [id];
      if (other && partners.length === 1) {
        // 상대가 실증 등으로 이번 달 그 카드를 연구하지 않으면 단독으로 진행한다.
        delete rs.joint[key]; rs.jointEnded[key] = "partner-stopped";
        const peer = states[other];
        if (peer?.joint[key]?.other === id) { delete peer.joint[key]; peer.jointEnded[key] = "partner-stopped"; }
        saveResearch(S.teams[id], rs);
        if (peer) saveResearch(S.teams[other], peer);
      }
      const eff = partners.reduce((sum, who) => sum + states[who].eff, 0);
      const need = c.need * (rs.licensedFrom[key] ? tp("licenseNeed") : 1);
      let progress = Math.max(...partners.map(who => states[who].prog[key] || 0));
      const boosted = KCP.TECH_DATA && partners.some(who => !states[who].eureka.includes(key) && eurekaMet(S, R, bg, who, key, states[who], res.team[who]));
      // T2: 조건을 채운 달의 유레카는 즉시 진척한다. 인력은 정규 연구량에만 적용한다.
      if (!eff && !boosted) return;
      if (boosted) {
        progress += Math.max(0, need - progress) * tp("eurekaFrac");
        partners.forEach(who => { if (!states[who].eureka.includes(key)) states[who].eureka.push(key); log(S, `유레카! ${teamDef(R, who).name}: ${c.name} 연구가 빨라졌습니다`, now); });
      }
      progress = Math.min(need, progress + (S.econ && KCP.TECH_DATA ? tp("roundSteps") : bg.RS.roundSteps) * eff);
      const afford = partners.every(who => fundingOf(bg, S, R, who, S.teams[who].plan, { kind: "research" }).ok);
      partners.forEach(who => {
        const wrs = states[who]; wrs.prog[key] = progress; finished.add(who + ":" + key);
        if (progress >= need && afford) {
          wrs.stage[key] = "demo";
          const cost = demoCost(S, who, c, bg, S.teams[who].plan);
          S.teams[who].rfix = r2((S.teams[who].rfix || 0) + cost);
          log(S, `${teamDef(R, who).name}: ${c.name} 실증 시작`, now);
        }
      });
    });
    activeOf(S).forEach(id => saveResearch(S.teams[id], states[id]));
  }
  function spendOf(bg, S, R, id, plan) { return r2(capexOf(bg, R, id, plan) + (S.teams[id].fixed ?? fixedOf(S, R, id)) + lossOf(S.teams[id].base, plan) + researchReserve(S, id, bg, plan)); }

  // 실증은 대기열에서 빠져도 진행한다. 연구는 실증 없는 턴의 첫 유효 카드만 진행한다.
  function researchTurn(S, id, bg, plan) {
    const rs = researchOf(S.teams[id]), demo = Object.keys(rs.stage).filter(key => rs.stage[key] === "demo");
    const current = demo.length ? null : (plan?.rq || rs.queue).find(key => !rs.stage[key] &&
      !techOf(S, id).includes(key) && !researchError(S, id, [key], bg) &&
      (!rs.joint[key]?.active || connectedTie(S, regionOf(S.region), bg, id, rs.joint[key].other))) || null;
    return { demo, current };
  }
  function royaltyCards(S, id, bg, plan, result) {
    const T = S.teams[id], rs = researchOf(T), turn = researchTurn(S, id, bg, plan);
    const cards = turn.demo.slice(), key = turn.current, c = techCards(bg).find(c => c.id === key);
    if (c && rs.licensedFrom[key] && (rs.prog[key] || 0) < c.need * tp("licenseNeed")) {
      const draft = { ...S, teams: { ...S.teams, [id]: { ...T, plan } } };
      // 계획 단계는 유레카를 일으킬 설비가 있으면 현재 카드 사용료를 예약한다.
      // 정산은 실제 운영 결과를 받아 진척 없는 달에는 지급하지 않는다.
      if (!result) result = withPack(bg, regionOf(S.region), id, () => {
        const live = bg.network(bg.sanitize(plan || {}, 1e9)).nodes.filter(n => n.live);
        const renewable = live.some(n => bg.BLD[n.kind]?.cls === "ren");
        return { renPct: renewable ? 100 : 0, curtailMWh: renewable ? 1 : 0, co2Prod: live.some(n => n.kind === "coal") ? 1 : 0 };
      });
      if (researchStaff(bg, { ...T, plan }).eff > 0 || !rs.eureka.includes(key) &&
          eurekaMet(draft, regionOf(S.region), bg, id, key, { ...rs,
            drMonths: rs.drMonths + ((plan?.policies || []).includes("dr") ? 1 : 0) }, result)) cards.push(key);
    }
    return cards.filter(key => rs.licensedFrom[key] && S.teams[rs.licensedFrom[key]] &&
      (rs.royaltyMonths[key] || 0) < tp("royaltyMonths"));
  }
  function royaltyLedger(S, results) {
    const out = Object.fromEntries(activeOf(S).map(id => [id, { income: 0, expense: 0, payments: [] }]));
    if (!KCP.TECH_DATA) return out;
    activeOf(S).slice().sort().forEach(id => {
      const rs = researchOf(S.teams[id]);
      royaltyCards(S, id, KCP.buildGame, S.teams[id].plan, results?.[id]).forEach(card => {
        const other = rs.licensedFrom[card];
        if (!other || !out[other] || rs.stage[card] === "done" || (rs.royaltyMonths[card] || 0) >= tp("royaltyMonths")) return;
        const amount = Math.min(tp("royalty"), tp("royaltyCap") - out[other].income);
        if (amount <= 0) return;
        out[id].expense += amount; out[other].income += amount;
        out[id].payments.push({ card, other, amount });
      });
    });
    return out;
  }
  function originalDeveloper(S, id, card) {
    const seen = new Set();
    while (S.teams[id] && !seen.has(id)) {
      seen.add(id); const next = researchOf(S.teams[id]).licensedFrom[card];
      if (!next) return id; id = next;
    }
    return null;
  }

  const goalsOf = (S, demand) => {
    if (!S.econ) return S.goals || regionOf(S.region).goals;
    if (S.goalPlan?.[S.round]) return { ...S.goalPlan[S.round] };
    // 공개 상태에는 goalPlan 대신 이번 달 goals만 있으므로 전달된 확정값을 그대로 읽는다.
    if (S.goals?.co2Plan != null) return { ...S.goals };
    const P = KCP.ECON_DATA.params, rd = roundsOf(S)[Math.max(0, S.round - 1)];
    const weekMul = (rd?.mdays || 30) / (rd?.days || 7);
    const previous = (S.results || []).find(result => result.round === S.round - 1);
    const previousRound = previous && roundsOf(S)[previous.round - 1];
    // 계획용 수요 추정은 아직 없다. 직전 달 실제 일평균 수요에 이번 달 일수를 곱한다(31일→28일 같은 일수 차이만 보정, 계절 변화는 그대로).
    // 첫 달만 학생 계획·정책·사건을 포함하지 않은 시작 보정 운영의 월 수요를 쓴다.
    let monthlyDemand = previous
      ? Object.values(previous.team).reduce((total, team) => total + team.dem * (rd?.mdays || previousRound.mdays) / previous.days, 0)
      : S.goalDemand0;
    if (monthlyDemand == null && demand == null && KCP.buildGame) {
      // 목표 저장 전의 옛 데이터는 첫 달 보정과 같은 지도·씨앗으로 수요만 복원한다.
      const first = roundsOf(S)[0], bg = KCP.buildGame;
      monthlyDemand = preserveMap(bg, () => activeOf(S).reduce((total, id) => {
        const normal = simTeam(bg, regionOf(S.region), id, KCP.ECON_DATA.normalStartPlans[id] || {},
          { season: first.season, days: first.days, seed: 0 }, Number.MAX_VALUE, {}).k;
        return total + normal.dem * first.mdays / first.days;
      }, 0));
    }
    // demand는 미확정 상태에서 명시한 대표 주 수요 추정값(현재 호출처 없음 — 계획 수요 추정을 붙일 때 쓰는 자리). 확정 후에는 위에서 저장값을 반환한다.
    const co2Plan = (demand == null ? monthlyDemand || 0 : demand * weekMul) * P.normalCo2.v *
      (1 - P.coopCo2Cut.v * Math.min(1, ((rd?.year || S.econ.year) - 2018) / 12)) * P.coopEase.v;
    // 공개 계약: co2Plan은 평가에 그대로 쓰는 월 t, 기존 co2는 화면 호환용 대표 주 t.
    return { unsPct: P.coopUnsGoal.v, co2: co2Plan / weekMul, co2Plan,
      co2Basis: demand != null ? "계획 수요 추정" : previous ? "지난달 수요(일수 보정)" : "첫 달 보정 운영 수요" };
  };
  function preserveGoalPlan(S) {
    if (!S.econ || S.goalPlan?.[S.round]) return;
    const goal = goalsOf(S);
    // 수요를 못 구해 0이 되면 저장하지 않는다('≤ 0 t' 고정 방지). run 첫머리에서 다시 시도한다.
    if (goal.co2Plan > 0) S.goalPlan = { ...S.goalPlan, [S.round]: goal };
  }
  // 예측 기술을 도입한 팀은 실제 크기 x를 원래 범위 ×fcstWidth 폭으로 미리 안다(가운데는 x에서 조금 비켜 둔다). 근거는 tech-data params.
  function fcxOf(S, id) {
    if (!techOf(S, id).includes("fcst")) return null;
    const R = regionOf(S.region), out = {};
    (S.events || []).filter(ev => ev.round === S.round && typeof ev.x === "number").forEach(ev => {
      const E = eventDef(R, ev.id), fc = (E && E.fc) || 0;
      if (!fc) return;
      const u = (hashStr((S.seedKey ?? S.room) + ":" + id + ":" + ev.id) % 1000) / 1000, c = ev.x + (fc * tp("fcstWidth")) * (u - 0.5);
      out[ev.id] = [r3(Math.max(1 - fc, c - fc * tp("fcstWidth"))), r3(Math.min(1 + fc, c + fc * tp("fcstWidth")))];
    });
    return out;
  }
  function groupParts(c, report) {
    // 목표 부분 점수와 지연된 집단별 기여는 엔진의 같은 계산 결과를 사용한다.
    return report?.parts || c.groupParts || {};
  }
  // 경제 요약(도시마다 주민·산업·현금·지지율·정책·집단 만족 + 국제 지수 + 진행 중 기업 제안 + 시간 기록)
  function econView(S) {
    const E = S.econ;
    if (!E) return null;
    const cities = {};
    E.order.forEach(id => {
      const c = E.cities[id];
      cities[id] = { research: researchView(S, id), grid: gridView(S.grid && S.grid[id]), curtailMWh: S.econRep && S.econRep.grid && S.econRep.grid[id] ? S.econRep.grid[id].curtailMWh : 0, name: c.name, pop: c.pop, ind: c.ind, pop0: c.pop0, ind0: c.ind0, cash: r2(c.cash), debtCap: c.debtCap, co2pc: c.co2pc, unsS: c.unsS, approval: c.approval, approval0: c.approval0, L: Math.round(c.L), A: Math.round(c.A), policy: S.teams[id].econPol || c.policy, groups: Object.fromEntries(Object.keys(c.groups).map(g => [g, c.groups[g].sat])), groupParts: groupParts(c, S.econRep?.groups[id]), shares: Object.fromEntries(Object.keys(c.groups).map(g => [g, c.groups[g].share])), lagL: c.lagL, lagA: c.lagA, hist: (c.hist || []).slice(-36) };
    });
    const report = S.econRep || null;
    const P = KCP.ECON_DATA.params, speed = P.eduSpeed.v;
    const speeds = Object.fromEntries(["eduSpeed", "eduMemory", "reviewEvery", "eduCbam", "eduConn", "eduCurtail", "hazardFreq"].map(k => [k, P[k].v]));
    Object.assign(speeds, { monthsPerTurn: speed, smrConstruction: speed, eduAir: P.eduAir.v, eduAirSpecified: P.eduAir.v,
      smrTurns: KCP.TECH_DATA?.params.smrTurns.v ?? Math.round(P.smrMonthsReal.v / speed),
      lngSpikeFrequency: P.lngSpikeFrequency.v, outageHoursPerPercent: P.outageHoursPerPercent.v, koreaOutageHours2019: P.koreaOutageHours2019.v,
      islandLineLoss: P.islandLineLoss.v, researchYears: P.researchYears.v.slice(), complaintPoliticalEffect: P.complaintPoliticalEffect.v.slice(),
      note: `주민·기업 이동과 SMR 공사 시간 ×${speed}(게임 1달 ≈ 현실 약 ${speed}달)`,
      items: [
        ["eduSpeed", `주민·기업 이동 시간 ×${speed}: 수업 안에서 변화 관찰`],
        ["eduMemory", `지지율 회복 시간 ×${P.eduMemory.v}: 회복 시간을 ${P.eduMemory.v}배 압축`],
        ["reviewEvery", `주민 평가는 ${P.reviewEvery.v}턴마다: 현실 임기 4년(48달)을 ×4 압축`],
        ["eduAir", `대기 영향 ×${P.eduAir.v}(교육용·집단 만족만, 이주에는 ×1)`],
        ["eduCbam", `CBAM 효과 ×${P.eduCbam.v}: 교육용 확대`],
        ["eduConn", `재생 접속 속도 ×${P.eduConn.v}: 수업 기간 안에 접속`],
        ["eduCurtail", `출력제어 손실 ×${P.eduCurtail.v}: 버림을 관찰하도록 확대`],
        ["hazardFreq", `기상 사건 빈도 ×${P.hazardFreq.v}: 정책 판단 시간을 확보`],
        ["lngSpikeFrequency", `LNG 급등이 현실보다 약 ${P.lngSpikeFrequency.v}배 자주 나와요(추정 비교값, 추첨 확률에 곱하지 않음)`],
        ["outageHoursPerPercent", `정전 1%를 같은 수요의 시간으로 바꾼 값: 연 ${P.outageHoursPerPercent.v}시간(에너지 미공급률의 등가 시간 환산이며, 실제 정전시간과 다름)`],
        ["islandLineLoss", `섬 연습 지도 송전 손실은 리그의 ${P.islandLineLoss.v}배: 짧은 지도에서 손실 관찰`],
        ["smrConstruction", `SMR 공사 시간 ×${speed}: 현실 비교 약 ${P.smrMonthsReal.v}개월 → 게임 ${KCP.TECH_DATA?.params.smrTurns.v ?? Math.round(P.smrMonthsReal.v / speed)}달`],
        ["researchYears", `연구 기간 수십 배 압축: 현실 ${P.researchYears.v.join("~")}년 → 게임 수 달`],
        ["complaintPoliticalEffect", `마을 민원을 도시 전체 만족에 반영: 지지에 미치는 영향이 현실보다 약 ${P.complaintPoliticalEffect.v.join("~")}배 커요(추정 비교값, 계산 배수 아님)`]
      ].map(([key, note]) => ({ key, note })) });
    return { speeds, year: E.year, month: E.month, t: E.t, eduSpeed: KCP.ECON_DATA.params.eduSpeed.v, cities, totals: E.totals, intl: E.intl.cur, intlActive: E.intl.cur?.active || [], offers: E.offers.map(o => Object.assign({}, o, { eval: report && (report.offers || []).find(x => x.id === o.id)?.eval || null })), score: KCP.econ ? KCP.econ.score(E) : null, report, before: S.econBefore || null, previousScore: S.econPreviousScore || null, scoreState: { len: E.len, coop: E.coop || 0, order: E.order, cities: Object.fromEntries(E.order.map(id => { const c = E.cities[id]; return [id, { name: c.name, pop: c.pop, pop0: c.pop0, ind: c.ind, ind0: c.ind0, cash: c.cash, debtCap: c.debtCap, revYear: c.revYear, co2Intensity0: c.co2Intensity0, co2Intensity: c.co2Intensity, co2pc: c.co2pc, approval: c.approval, approvalHistory: (c.approvalHistory || []).slice(), unsS: c.unsS }]; })), totals: E.totals } };
  }
  // 공개 상태는 허용한 필드만 내보낸다. 키·서명·내부 자리 식별자·순번은 제외한다.
  function publicView(S, now) {
    const teams = {};
    Object.keys(S.teams).forEach(id => {
      const T = S.teams[id];
      // D-75: 판정은 진행자의 전체 상태에만 남기고 팀 기기에 공개하지 않는다.
      const left = KCP.buildGame ? fundingOf(KCP.buildGame, S, regionOf(S.region), id).left : null;
      teams[id] = { ...(S.econ ? { trialGrid: S.grid && S.grid[id] ? {
        peakMW: S.grid[id].peakMW, round: S.grid[id].round,
        entries: S.grid[id].entries.map(({ key, allocatedMW }) => ({ key, allocatedMW }))
      } : null } : {}), left, seatVersion: T.seatVersion || 0, seated: !!T.token, online: !!T.token && now - T.online < 20000, ready: T.ready, crit: T.crit || null, econPol: T.econPol || null, plan: T.plan, rev: T.rev, price: T.price, budget: budget(S, id), fixed: fixedOf(S, regionOf(S.region), id), base: T.base || [], resp: T.resp || {}, rs: T.rs || null, research: researchView(S, id), fcx: fcxOf(S, id), hist: (T.hist || []).slice(-40) };
    });
    // 사건의 실제 크기(x)는 그 라운드 운영이 끝난 뒤에 공개한다 — 계획 때는 예보 범위만.
    const shown = ev => ev.round < S.round || S.phase === "review" || S.phase === "end";
    const events = (S.events || []).map(ev => shown(ev) ? ev : { id: ev.id, round: ev.round });
    // 화면은 최근 두 달을 비교한다. 그 이전에는 끝 성찰(누적 정전·도움)과 로그용 요약만 필요하다.
    // 진행자의 S.results와 혼자 하기 저장에는 모든 결과를 그대로 보관한다.
    const results = S.results.map((x, i) => i < S.results.length - 2 ? {
      round: x.round, month: x.month, year: x.year, season: x.season, days: x.days, region: x.region,
      team: Object.fromEntries(Object.entries(x.team).map(([id, t]) => [id, { outH: t.outH, imp: t.imp, unsPct: t.unsPct }])), econ: null
    } : (x.econ && i < S.results.length - 1 ? { ...x, econ: null } : x));
    return { ...(S.econ ? { grid: Object.fromEntries(activeOf(S).map(id => [id, gridView(S.grid && S.grid[id])])) } : {}), v: S.v, sid: S.sid, room: S.room, region: S.region, rounds: S.rounds || null, rev: S.rev, round: S.round, phase: S.phase, ends: S.ends, now, active: activeOf(S), goals: goalsOf(S), teams, ties: S.ties, results, events, econ: econView(S), log: S.log.slice(-12) };
  }

  const canPlan = S => S.phase === "lobby" || S.phase === "plan";
  const err = e => ({ ok: false, err: e });

  // 내부 요청만 받는다. 네트워크 요청은 leagueNet.receiver에서 서명을 검증한 뒤 들어온다.
  // token은 검증된 공개 키 지문(혼자 하기·컴퓨터 도시는 내부 자리 식별자)이다.
  // 팀 요청 하나를 반영한다. 반환: {ok, err?, quiet?}  quiet = 공개 상태가 안 바뀜(접속 표시만)
  function reduce(S, m, now, bg) {
    const R = regionOf(S.region);
    if (!m || typeof m !== "object" || !isTeam(R, m.team, S) || typeof m.token !== "string" || m.token.length < 8 || m.token.length > 64) return err("bad");
    const T = S.teams[m.team];
    if (m.type === "claim") {
      if (T.token && T.token !== m.token) return err("taken");
      const fresh = !T.token;
      T.token = m.token; T.online = now;
      if (m.publicKey) T.publicKey = m.publicKey;
      if (fresh) { log(S, `${teamDef(R, m.team).name} 팀 입장`, now); S.rev++; }
      return { ok: true, quiet: !fresh };
    }
    if (T.token !== m.token) return err("seat");
    // 식별자가 없는 옛 클라이언트와 claim·hello는 기존 규약을 유지한다.
    if (["plan", "econ", "crit", "ready", "tie", "research", "license", "joint", "respond", "price", "verdict"].includes(m.type) &&
        ((Object.hasOwn(m, "rd") && m.rd !== S.round) || (Object.hasOwn(m, "ph") && m.ph !== S.phase))) return err("stale");
    T.online = now;
    if (m.type === "hello") return { ok: true, quiet: true };
    if (m.type === "verdict") {
      // 봉투 필드 외에는 round·hit만 허용한다. 학생 글은 저장하거나 재방송하지 않는다.
      const allowed = ["type", "team", "token", "kid", "n", "sid", "seat", "id", "born", "rd", "ph", "round", "hit"];
      if (Object.keys(m).some(k => !allowed.includes(k)) || !Number.isInteger(m.round) || typeof m.hit !== "boolean") return err("verdict");
      if (!["review", "end"].includes(S.phase)) return err("phase");
      if (m.round !== S.round || m.round !== S.results.at(-1)?.round) return err("stale");
      // 최초 판정 고정: 재접속·ack 유실의 같은 값 재전송은 성공, 뒤늦은 변경은 거부해 집계를 보존한다.
      if (Object.hasOwn(T.verdicts || {}, m.round)) return T.verdicts[m.round] === m.hit ? { ok: true, quiet: true } : err("verdict");
      T.verdicts ||= {}; T.verdicts[m.round] = m.hit; S.rev++;
      return { ok: true };
    }
    if (m.type === "ready") {
      const ready = m.ready === true;
      if (T.ready === ready) return { ok: true, quiet: true };
      T.ready = ready; S.rev++; return { ok: true };
    }
    if (m.type === "price") {
      if (!canPlan(S)) return err("phase");
      T.price = r3(num(m.price, PRICE.min, PRICE.max, PRICE.def)); S.rev++; return { ok: true };
    }
    if (["research", "license", "joint"].includes(m.type)) {
      if (!canPlan(S) || !bg || !KCP.TECH_DATA) return err("phase");
      const rs = researchOf(T), card = m.card, c = techCards(bg).find(c => c.id === card);
      if (m.type === "joint" && m.op === "cancel") {
        if (!c) return err("research");
        if (!rs.joint[card]) return { ok: true, quiet: true };
        releaseJoint(S, m.team, card, "cancelled");
        T.rev++; S.rev++; return { ok: true };
      }
      const queue = m.type === "research" ? m.queue || m.rq : [card, ...rs.queue.filter(t => t !== card)];
      const failure = researchError(S, m.team, queue, bg);
      if (failure) return err(failure);
      if (m.type !== "research") {
        if (!c || !S.teams[m.other] || m.other === m.team || rs.stage[card] || techOf(S, m.team).includes(card)) return err("research");
        if (m.type === "license") {
          if (!techOf(S, m.other).includes(card) || rs.joint[card]?.active) return err("license");
          const origin = originalDeveloper(S, m.other, card);
          if (!origin || origin === m.team) return err("license");
          rs.licensedFrom[card] = origin;
          delete rs.joint[card];
        } else {
          if (rs.licensedFrom[card] || researchOf(S.teams[m.other]).licensedFrom[card] || !connectedTie(S, R, bg, m.team, m.other)) return err("joint");
          const failure = researchError(S, m.other, [card], bg);
          if (failure || researchOf(S.teams[m.other]).stage[card] || techOf(S, m.other).includes(card)) return err(failure || "joint");
          if (rs.joint[card] && rs.joint[card].other !== m.other) return err("joint");
          rs.joint[card] = { other: m.other, active: false };
        }
      }
      // 모든 실증비를 먼저 예약한다. 승인 실패 때 원 상태로 돌린다.
      const oldResearch = T.research, oldRs = T.rs, oldPlan = T.plan;
      T.plan = { ...(T.plan || {}), rq: queue.slice() }; rs.queue = queue.slice(); saveResearch(T, rs);
      if (!fundingOf(bg, S, R, m.team, T.plan, { kind: "research" }).ok) {
        T.plan = oldPlan; if (oldResearch) T.research = oldResearch; else delete T.research;
        if (oldRs) T.rs = oldRs; else delete T.rs;
        return err("budget:" + m.team);
      }
      if (m.type === "joint") {
        const peer = S.teams[m.other], prs = researchOf(peer);
        if (prs.joint[card]?.other === m.team && prs.queue[0] === card) {
          rs.joint[card].active = true; prs.joint[card].active = true; saveResearch(peer, prs);
        }
      }
      releaseUnusedJoints(S, m.team);
      T.rev++; S.rev++; return { ok: true };
    }
    if (m.type === "plan") {
      if (!canPlan(S)) return err("phase");
      if (!Number.isInteger(m.rev) || m.rev <= T.rev) return { ok: true, quiet: true };
      let plan = m.plan;
      if (!plan || typeof plan !== "object") return err("plan");
      const failure = bg && researchError(S, m.team, plan.rq || [], bg);
      if (failure) return err(failure);
      if (KCP.TECH_DATA && bg) {
        const adopted = techOf(S, m.team), existing = new Map((T.plan?.builds || []).map(b => [itemKey("b", b), b]));
        plan = { ...plan, builds: Array.isArray(plan.builds) ? plan.builds.filter(b => b && typeof b === "object") : [] };
        const locked = withPack(bg, R, m.team, () => (plan.builds || []).some(b => bg.BLD[b.t]?.tech && !adopted.includes(bg.BLD[b.t].tech)));
        if (locked) return err("locked");
        const valid = withPack(bg, R, m.team, () => bg.sanitize({ ...plan, builds: plan.builds.map(b => ({ t: b.t, i: b.i })) }, 1e9).builds);
        plan = { ...plan, builds: valid.map(b => {
          const next = { t: b.t, i: b.i }, prev = existing.get(itemKey("b", b));
          if (prev && Number.isFinite(prev.paidCost)) next.paidCost = prev.paidCost;
          else if (!prev && adopted.includes("mass") && ["solar", "roof", "tandem", "tandem_roof", "battery", "nbat"].includes(b.t)) {
            next.paidCost = withPack(bg, R, m.team, () => r2(bg.capex({ builds: [next], lines: [] }) * tp("massCost")));
          }
          return next;
        }) };
      }
      // 문법만 정리하고 공동 판정으로 승인한다. 예산에 맞춰 자산을 몰래 삭제하지 않는다.
      if (bg) plan = cleanPlan(bg, R, m.team, plan, Number.MAX_VALUE);
      const funding = fundingOf(bg, S, R, m.team, plan);
      if (!funding.ok) return err(funding.reason + ":" + m.team);
      if (S.econ && !S.grid && bg) refreshGrid(S, bg); // 새 계획을 넣기 전에 옛 설비만 이행
      T.plan = plan; T.rev = m.rev; S.rev++;
      if (KCP.TECH_DATA) {
        const rs = researchOf(T); rs.queue = (plan.rq || []).slice(); saveResearch(T, rs);
        releaseUnusedJoints(S, m.team);
        const construction = {};
        (plan.builds || []).filter(b => b.t === "smr").forEach(b => {
          const key = b.t + ":" + b.i;
          construction[key] = T.construction?.[key] || { startRound: Math.max(1, S.round), readyRound: Math.max(1, S.round) + tp("smrTurns") };
        });
        if (Object.keys(construction).length || T.construction) T.construction = construction;
      }
      if (S.econ && bg) refreshGrid(S, bg);
      // 진행 기록(교사 화면의 '건설 속도'): 15초 안의 연속 변경은 한 점으로
      if (bg) {
        const pt = { t: now, r: S.round, cap: Math.round(capexOf(bg, R, m.team, plan)), n: plan.builds.length, l: plan.lines.length };
        T.hist = Array.isArray(T.hist) ? T.hist : [];
        const last = T.hist[T.hist.length - 1];
        if (last && now - last.t < 15000 && last.r === pt.r) T.hist[T.hist.length - 1] = pt; else T.hist.push(pt);
        if (T.hist.length > 60) T.hist.splice(0, T.hist.length - 60);
      }
      return { ok: true };
    }
    // D-59: 허용 목록으로 새 객체를 만든다. 이유·일지 등 자유 서술은 복사하지 않는다.
    if (m.type === "crit") {
      if (!S.econ || S.phase !== "plan") return err("phase");
      const keys = Object.keys(KCP.ECON_DATA.params.wScore.v);
      if (!Array.isArray(m.chips) || m.chips.length < 1 || m.chips.length > 2 || new Set(m.chips).size !== m.chips.length || m.chips.some(k => !keys.includes(k)) || !Number.isInteger(m.line) || m.line < 0 || m.line > 100 || !["keep", "change"].includes(m.choice)) return err("crit");
      if (T.crit && T.crit.line === m.line && T.crit.choice === m.choice && T.crit.chips.length === m.chips.length && T.crit.chips.every((k, i) => k === m.chips[i])) return { ok: true, quiet: true };
      T.crit = { chips: m.chips.slice(), line: m.line, choice: m.choice };
      S.rev++; return { ok: true };
    }
    if (m.type === "econ") {
      if (!S.econ || !canPlan(S)) return err("phase");
      const st = x => Math.max(-2, Math.min(2, Math.round(num(x, -2, 2, 0))));
      const P0 = T.econPol || {}, P1 = { taxRes: st(m.taxRes), taxInd: st(m.taxInd), service: st(m.service), incentive: r2(num(m.incentive, 0, 20, 0)) };
      if (m.re100 === true && !techOf(S, m.team).includes("re100")) return err("locked:re100");
      if (typeof m.re100 === "boolean") P1.re100 = m.re100;
      else if (P0.re100 != null) P1.re100 = P0.re100;
      if (JSON.stringify(P0) === JSON.stringify(P1)) return { ok: true, quiet: true };
      T.econPol = P1; S.rev++; return { ok: true };
    }
    if (m.type === "respond") {
      if (S.phase !== "plan") return err("phase");
      const ev = (S.events || []).find(x => x.round === S.round && x.id === m.ev), E = ev && eventDef(R, ev.id);
      if (!E || !hits(R, E, m.team, S)) return err("noev");
      const key = S.round + ":" + E.id, prev = T.resp ? T.resp[key] : undefined;
      if (m.opt !== "none" && !(Array.isArray(E.opts) && E.opts.some(o => o.id === m.opt))) return err("noopt");
      T.resp = T.resp || {};
      if (m.opt === "none") delete T.resp[key]; else T.resp[key] = m.opt;
      if (prev === T.resp[key]) return { ok: true, quiet: true };
      const cost = m.opt === "none" ? 0 : E.opts.find(o => o.id === m.opt).cost || 0;
      // 무료 대응은 유지. 초과 도시의 유료 대응도 건설과 같은 교부세 한도를 함께 쓴다.
      if (cost > 0 && !fundingOf(bg, S, R, m.team, T.plan || {}, { kind: "respond" }).ok) { if (prev) T.resp[key] = prev; else delete T.resp[key]; return err("budget:" + m.team); }
      log(S, `${teamDef(R, m.team).name}: ${E.name} — ${m.opt === "none" ? "대응 안 함" : E.opts.find(o => o.id === m.opt).name}`, now);
      S.rev++; return { ok: true };
    }
    if (m.type === "tie") {
      if (!canPlan(S)) return err("phase");
      const D = tieDef(R, m.team, m.other);
      if (!D || !Object.hasOwn(S.teams, m.other)) return err("notie");
      let X = S.ties.find(x => x.a === D.a && x.b === D.b);
      if (m.op === "propose") {
        const cap = m.cap === 4 ? 4 : 2;
        if (m.kind === "hvdc" && !techOf(S, m.team).includes("hvdc")) return err("locked:hvdc");
        if (X && X.st === "built") return err("built");
        if (!X) { X = { a: D.a, b: D.b, cap, st: "prop", by: m.team, round: S.round }; S.ties.push(X); }
        else { X.cap = cap; X.by = m.team; }
        if (m.kind === "hvdc") X.kind = "hvdc"; else delete X.kind;
        log(S, `${teamDef(R, m.team).name} → ${teamDef(R, m.other).name} 연계선 ${cap} MW 제안`, now);
        S.rev++; return { ok: true };
      }
      if (m.op === "accept") {
        if (!X || X.st !== "prop" || X.by === m.team) return err("noprop");
        const half = tieCost(R, X) / 2;
        for (const id of [X.a, X.b]) {
          const funding = fundingOf(bg, S, R, id, S.teams[id].plan || {}, { kind: "tie", extra: half });
          if (!funding.ok) return err(funding.reason + ":" + id);
        }
        X.st = "built"; X.round = S.round;
        if (S.econ && bg) refreshGrid(S, bg);
        log(S, `${teamDef(R, X.a).name}–${teamDef(R, X.b).name} 연계선 ${X.cap} MW 연결(각 ${r2(half)}억)`, now);
        S.rev++; return { ok: true };
      }
      if (m.op === "cancel") {
        if (!X || X.st !== "prop") return err("noprop");
        S.ties.splice(S.ties.indexOf(X), 1);
        log(S, `${teamDef(R, m.team).name}: ${teamDef(R, m.other).name} 연계선 ${X.by === m.team ? "제안 거둠" : "제안 거절"}`, now);
        S.rev++; return { ok: true };
      }
      return err("op");
    }
    return err("type");
  }

  // 진행자만 하는 일
  function host(S, op, now, arg) {
    const R = regionOf(S.region);
    if (op === "kick" && isTeam(R, arg, S)) {
      const T = S.teams[arg];
      if (T.token) { T.retired ||= {}; T.retired[T.token] = Math.max(T.retired[T.token] || 0, T.lastN || 0); }
      delete T.receipts;
      S.teams[arg].token = null; delete S.teams[arg].publicKey; delete S.teams[arg].lastN; S.teams[arg].seatVersion = (S.teams[arg].seatVersion || 0) + 1; S.teams[arg].ready = false; log(S, `${teamDef(R, arg).name} 자리 비움`, now); S.rev++; return true; }
    if (op === "extend" && S.ends) { S.ends += 60000; S.rev++; return true; }
    if (op === "next") {
      if (S.phase === "lobby" || S.phase === "review") {
        if (S.round >= roundsOf(S).length) { S.phase = "end"; S.ends = null; log(S, "리그 끝", now); S.rev++; return true; }
        if (S.econ && !S.econCal && S.econ.t === 0 && KCP.buildGame) calibrateStart(S, R, KCP.buildGame);
        S.round++; S.phase = "plan"; S.ends = now + PLAN_MS;
        preserveGoalPlan(S);
        Object.values(S.teams).forEach(T => { T.ready = false; });
        log(S, S.econ ? `${roundsOf(S)[S.round - 1].month}월 계획 시작` : `${S.round}라운드 계획 시작`, now);
        drawEvents(S, R).forEach(E => log(S, `사건: ${E.name}`, now));
        S.rev++; return true;
      }
      return false;
    }
    return false;
  }

  /* ---------- 라운드 이벤트(계절 사건) ---------- */
  // R.events: {id, name, seasons, weight, scope: region | team:<id> | kind:coastal|industrial|coal, effect:{...}, text, why, sources}
  // 라운드가 시작될 때 진행자가 1개(40%는 2개)를 뽑아 계획 단계부터 알린다 — 대비할 시간을 준다.
  function hashStr(x) { let h = 2166136261; for (let i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function packHas(R, id, what) {
    const P = packOf(R, id);
    if (!P) return false;
    if (what === "coastal") return !!P.fitSea;
    if (what === "industrial") return P.sites.some(s => s.kind === "factory_big");
    if (what === "coal") return P.sites.some(s => s.fuel === "coal");
    return false;
  }
  function eventValid(S, R, E) {
    if (!S) return true; // 옛 표시 호출 호환. 서버는 항상 S를 전달한다.
    const active = activeOf(S), target = E.effect?.tieDown;
    if (!active.some(id => scopeHits(R, E, id))) return false;
    if (!target || E.id === "typhoon_coast") return true;
    return S.ties.some(t => t.st === "built" && active.includes(t.a) && active.includes(t.b) &&
      (typeof target !== "string" || target === tieId(t) || target === t.b + "~" + t.a));
  }
  function hits(R, E, id, S) {
    if (S && (!activeOf(S).includes(id) || !eventValid(S, R, E))) return false;
    // 유효한 지정 연계선 사건은 양 끝 모두 대응할 수 있다.
    if (typeof E.effect?.tieDown === "string" && E.effect.tieDown.split("~").includes(id)) return true;
    return scopeHits(R, E, id);
  }
  // 대응 자격과 효과 범위는 구분한다. 한쪽 도시 지원금·수요 효과를 이웃에게 복제하지 않는다.
  function scopeHits(R, E, id) {
    const sc = E.scope || "region";
    if (sc === "region") return true;
    if (sc.startsWith("prov:")) return teamDef(R, id)?.prov === sc.slice(5);
    if (sc.startsWith("team:")) return sc.slice(5) === id;
    if (sc.startsWith("kind:") && R.kinds?.[sc.slice(5)]) return R.kinds[sc.slice(5)].includes(id);
    if (sc === "kind:inland") return !packHas(R, id, "coastal");
    if (sc.startsWith("kind:")) return packHas(R, id, sc.slice(5));
    return false;
  }
  const MUL = ["demandMul", "solarMul", "windMul", "offshoreMul", "tidalMul", "coalCapMul", "lngCapMul"];
  const eventDef = (R, id) => (R.events || []).find(E => E.id === id) || null;
  function drawEvents(S, R) {
    const rd = roundsOf(S)[S.round - 1], act = activeOf(S);
    const pool = (R.events || []).filter(E => (!S.econ || !["finedust_coal_cap", "light_load_curtailment"].includes(E.id)) &&
      (!S.rounds || !(S.events || []).some(ev => ev.round === S.round - 1 && ev.id === E.id)) &&
      (E.seasons || []).includes(rd.season) && act.some(id => scopeHits(R, E, id)) && eventValid(S, R, E));
    const rnd = rng(hashStr((S.seedKey ?? S.room) + ":" + S.round)), out = [];
    // P(event)=monthEventP*w/sum(w)。그 계절의 나머지 가중을 고정하고 역산한다.
    const P = KCP.ECON_DATA?.params;
    const hazards = S.econ ? pool.filter(E => E.hazardReal?.[rd.season]) : [];
    const targetP = hazards.reduce((a, E) => a + E.hazardReal[rd.season] * P.hazardFreq.v, 0);
    const otherW = pool.filter(E => !hazards.includes(E)).reduce((a, E) => a + (E.weight || 1), 0);
    const totalW = otherW / Math.max(1e-9, 1 - targetP / (P?.monthEventP.v || 1));
    const weight = E => hazards.includes(E) ? E.hazardReal[rd.season] * P.hazardFreq.v / P.monthEventP.v * totalW : E.weight || 1;
    const pick = () => { const list = pool.filter(E => !out.includes(E)), w = list.reduce((a, E) => a + weight(E), 0); let u = rnd() * w; for (const E of list) { u -= weight(E); if (u <= 0) return E; } return list[list.length - 1]; };
    if (S.rounds) {
      if (pool.length && rnd() < KCP.ECON_DATA.params.monthEventP.v) out.push(pick());
    } else {
      if (pool.length) out.push(pick());
      if (pool.length > 1 && rnd() < 0.4) out.push(pick());
    }
    if (S.econ && [12, 1, 2, 3].includes(rd.month)) { const fixed = eventDef(R, "finedust_coal_cap"); if (fixed) out.push(fixed); }
    // 예보는 범위(fc)로만 알린다. 실제 크기 x(1 ± fc)는 지금 정해 두고 운영이 끝나야 공개한다(같은 방·라운드면 같은 값).
    S.events = (S.events || []).filter(x => x.round !== S.round).concat(out.map(E => ({ id: E.id, round: S.round, x: r3(1 + (E.fc || 0) * (2 * rnd() - 1)) })));
    return out;
  }
  // 숨은 사건과 실제 크기를 제거하고, 이번 달 한 번의 접속 진행을 복사본에만 적용한다.
  function preserveMap(bg, fn) {
    const before = Object.entries(bg.PACKS).find(([, p]) => p._bL?.tiles === bg.TILES || p._b?.tiles === bg.TILES);
    const mode = before?.[1]._bL?.tiles === bg.TILES ? "league" : undefined;
    const oldBLD = bg.BLD, hadPK = Object.hasOwn(bg, "PK");
    try { return fn(); }
    finally {
      if (before) bg.selectPack(before[0], mode);
      bg.BLD = oldBLD;
      if (!hadPK) delete bg.PK;
    }
  }
  function trialMods(S, R, id) {
    const bg = KCP.buildGame;
    if (bg) return preserveMap(bg, () => trialModsFor(S, R, id, bg));
    return modsFor({ ...S, events: [] }, R, id);
  }
  function trialModsFor(S, R, id, bg) {
    // 팀이 받는 공개 상태도 지원한다. grid 요약에는 설비 이력이 없으므로
    // 숨은 사건과 무관한 최소 예약 이력만 teams.trialGrid에서 복원한다.
    const source = { ...S, events: [], teams: Object.fromEntries(Object.entries(S.teams).map(([key, t]) =>
      [key, { ...t, construction: t.construction || t.research?.construction }])) };
    if (S.econ) {
      source.econ = { ...S.econ, intl: S.econ.intl?.cur ? S.econ.intl : { cur: S.econ.intl } };
      if (S.grid) {
        source.grid = Object.fromEntries(activeOf(S).map(key =>
          [key, S.grid[key]?.entries ? S.grid[key] : S.teams[key].trialGrid || null]));
        // 이전 저장의 공개 요약은 {id:null}. 원본의 grid 없음과 같은 이행 경로를 쓴다.
        if (activeOf(S).every(key => Object.hasOwn(S.teams[key], "trialGrid") && !source.grid[key])) delete source.grid;
      }
    }
    const trial = { ...source };
    if (S.econ) trial.grid = { ...source.grid, [id]: gridStatus(source, R, bg, id, true) };
    bg.selectPack(teamDef(R, id).pack, "league");
    return modsFor(trial, R, id);
  }
  // 이번 라운드에 팀 id에 걸리는 배수 모음
  function modsFor(S, R, id) {
    const M = {}, tech = techOf(S, id);
    if (tech.length) M.tech = tech;
    // 경제 모드: 주민·산업 규모만큼 수요, 국제 연료 가격만큼 연료비
    if (S.econ && S.econ.cities[id] && KCP.econ) {
      const P = KCP.ECON_DATA.params, g = S.grid && S.grid[id];
      M.essCap = P.essCap.v;
      M.hydroMonth = roundsOf(S)[Math.max(0, S.round - 1)]?.month || S.econ.month;
      if (g) {
        M.reCap = Object.fromEntries(g.entries.map(b => [b.key, b.allocatedMW >= b.mw ? b.mw : 0]));
        const variableMW = g.entries.reduce((sum, b) => sum + (KCP.buildGame.BLD[b.t].variable && b.allocatedMW >= b.mw ? b.mw : 0), 0);
        const r = g.peakMW > 0 ? variableMW / (P.curtailLoadMul.v * g.peakMW) : 0;
        const p = Math.max(0, Math.min(P.curtailMax.v, P.curtailSlope.v * (r - P.curtailKnee.v)));
        const rd = roundsOf(S)[Math.max(0, S.round - 1)];
        M.curtailP = p * (["spring", "autumn"].includes(rd.season) ? 1 : P.curtailOffSeason.v) * (P.curtailLossReal.v * P.eduCurtail.v);
      }
      const dm = KCP.econ.demandMul(S.econ.cities[id]), I = S.econ.intl && S.econ.intl.cur;
      if (Math.abs(dm.res - 1) > 1e-3) M.demandRes = dm.res;
      if (Math.abs(dm.ind - 1) > 1e-3) M.demandInd = dm.ind;
      // M · 연료비 로그회귀 탄력 석탄 0.644·유류 0.598 [S16] · REF 7.3
      if (I && Math.abs(I.fuelMul - 1) > 1e-3) M.fuelMul = { lng: I.fuelMul, diesel: Math.pow(I.fuelMul, 0.6), coal: Math.pow(I.fuelMul, 0.6) };
      if (tech.includes("smr")) M.fuelMul = { ...M.fuelMul, smr: P.smrFuelMul.v };
    }
    (S.events || []).filter(x => x.round === S.round).forEach(ev => {
      const E = eventDef(R, ev.id);
      if (!E || !eventValid(S, R, E) || !scopeHits(R, E, id)) return;
      const f = E.effect || {}, o = respOpt(R, S, id, ev), x = typeof ev.x === "number" ? ev.x : 1;
      // 크기 = 1 + (기본 배수 − 1) × 실제 크기 x × 대응 배수(dev, knobs가 있으면 그 손잡이만)
      MUL.forEach(k => {
        if (typeof f[k] !== "number") return;
        let dv = o && typeof o.dev === "number" && (!o.knobs || o.knobs.includes(k)) ? o.dev : 1;
        if (KCP.TECH_DATA && ev.id === "heatwave_peak" && k === "demandMul" && tech.includes("vpp")) dv *= tp("heatDamage");
        M[k] = (M[k] == null ? 1 : M[k]) * Math.max(0, 1 + (f[k] - 1) * x * dv);
      });
      if (Array.isArray(f.hours)) M.demandHours = f.hours;
      if (f.carbonTaxOn) M.tax = true;
    });
    if (KCP.TECH_DATA) {
      if (tech.includes("sic")) M.renewOutput = tp("sicOutput");
      if (tech.includes("ccu")) { M.co2Mul = { coal: tp("ccuCo2") }; M.coalCapMul = (M.coalCapMul ?? 1) * tp("ccuOutput"); }
      if (tech.includes("h2mix")) M.h2Co2 = tp("h2Co2");
      if (tech.includes("vpp")) { M.drEffect = tp("drEffect"); M.drCost = tp("drCost"); if (M.curtailP != null) M.curtailP *= tp("vppCurtail"); }
      const pending = Object.entries(S.teams[id].construction || {}).filter(([, c]) => S.round < c.readyRound).map(([key]) => key);
      if (pending.length) M.disabledBuilds = pending;
    }
    return M;
  }
  function effectiveTie(S, T, mul = 1) {
    const tech = [...techOf(S, T.a), ...techOf(S, T.b)];
    const scable = KCP.TECH_DATA && tech.includes("scable"), hvdc = KCP.TECH_DATA && T.kind === "hvdc";
    return { id: tieId(T), a: T.a, b: T.b, cap: T.cap * mul * (hvdc ? tp("hvdcCap") : 1) * (scable ? tp("scableCap") : 1), loss: (hvdc ? tp("hvdcLoss") : TIE_LOSS) * (scable ? tp("scableLoss") : 1) };
  }
  function coolingCost(S, id) {
    if (!KCP.TECH_DATA || !techOf(S, id).includes("scable")) return 0;
    return S.ties.filter(t => t.st === "built" && [t.a, t.b].includes(id)).reduce((sum, t) => sum + tp("scableCooling") / [t.a, t.b].filter(cid => techOf(S, cid).includes("scable")).length, 0);
  }
  function tieMods(S, R) {
    let mul = 1; const down = [];
    (S.events || []).filter(x => x.round === S.round).forEach(ev => {
      const E = eventDef(R, ev.id);
      if (!E || !eventValid(S, R, E)) return;
      const f = E.effect || {};
      if (typeof f.tieCapMul === "number") mul *= f.tieCapMul;
      if (!f.tieDown) return;
      // 선 양 끝 도시(지정 없으면 사건이 걸린 아무 도시) 중 하나라도 '보강·협의'를 골랐으면 고장 나지 않는다.
      const ends = typeof f.tieDown === "string" ? f.tieDown.split("~") : activeOf(S).filter(id => hits(R, E, id, S));
      if (ends.some(id => { const o = respOpt(R, S, id, ev); return o && o.cancel; })) return;
      down.push(typeof f.tieDown === "string" ? f.tieDown : "*");
    });
    return { mul, down };
  }

  /* ---------- 도시 하나 돌리기와 정산 ---------- */
  function withPack(bg, R, id, fn) {
    const t = teamDef(R, id);
    bg.selectPack(t.pack, "league");
    return fn();
  }
  function cleanPlan(bg, R, id, plan, cap) {
    return withPack(bg, R, id, () => {
      const st = bg.sanitize(plan, cap);
      return { builds: st.builds, lines: st.lines, policies: st.policies, shed: st.shed, fab2: st.fab2, seed: st.seed, season: st.season, missions: st.missions, rq: st.rq };
    });
  }
  function capexOf(bg, R, id, plan) { return withPack(bg, R, id, () => bg.capex(bg.sanitize(plan, 1e9))); }

  // B18: 피크는 시작 지도의 기준 수요. 계절·정책·인구로 접속 한도를 바꾸지 않는다.
  // 승인 순서대로 접속 진행 MW를 예약하며, 한 기 전량 접속 전에는 발전하지 않는다.
  function gridStatus(S, R, bg, id, advance = false) {
    if (!S.econ) return null;
    const P = KCP.ECON_DATA.params, old = S.grid && S.grid[id];
    const local = withPack(bg, R, id, () => {
      const st = bg.sanitize(S.teams[id].plan || {}, 1e9);
      return {
        peakMW: old ? old.peakMW : bg.peakDemand({}, false),
        essMW: st.builds.reduce((sum, b) => sum + (bg.BLD[b.t].cls === "bat" ? bg.BLD[b.t].mw : 0), 0),
        builds: st.builds.filter(b => bg.BLD[b.t].hostLimited).map(b => ({ key: b.t + ":" + b.i, t: b.t, i: b.i, mw: bg.BLD[b.t].mw, allocatedMW: 0 }))
      };
    });
    const linked = (cid, other) => withPack(bg, R, cid, () => {
      const net = bg.network(bg.sanitize(S.teams[cid].plan || {}, 1e9));
      return net.nodes.some(n => n.kind === "import" && n.live && n.comp >= 0 && (bg.SITES[n.si].to || []).includes(other));
    });
    const tieMW = S.ties.filter(t => t.st === "built" && (t.a === id || t.b === id) && S.teams[t.a] && S.teams[t.b])
      .reduce((sum, t) => sum + (linked(t.a, t.b) && linked(t.b, t.a) ? effectiveTie(S, t).cap : 0), 0);
    const hostMW = local.peakMW * P.hostCapMul.v + local.essMW * P.hostEssMul.v + tieMW * P.hostTieMul.v;
    const monthlyMW = local.peakMW * (P.connPerMonthReal.v * P.eduConn.v);
    const byKey = new Map(local.builds.map(b => [b.key, b]));
    const entries = (old ? old.entries : []).filter(b => byKey.has(b.key)).map(b => {
      const entry = Object.assign({}, byKey.get(b.key), { allocatedMW: b.allocatedMW });
      byKey.delete(b.key); return entry;
    }).concat([...byKey.values()]);
    // v1.4.1: grid가 없던 저장의 기존 설비만 H 안에서 한 번 즉시 접속한다.
    // 새 게임은 빈 grid로 시작하며, 이후 추가 설비에는 월 처리량을 적용한다.
    if (!S.grid) entries.forEach(b => { b.allocatedMW = b.mw; });
    // ESS 철거·내부 전선 단절로 H가 줄면 뒤쪽 설비부터 다시 대기한다.
    // 접속 완료 이력만으로 상한을 우회할 수 없고, 재접속도 월 처리량을 쓴다.
    let room = hostMW;
    entries.forEach(b => {
      b.allocatedMW = Math.min(b.allocatedMW, room); room -= b.allocatedMW;
    });
    const tick = advance && S.round > 0 && (!old || old.round !== S.round);
    let left = tick ? monthlyMW : 0;
    for (const b of entries) {
      if (b.allocatedMW >= b.mw) continue;
      const need = b.mw - b.allocatedMW, add = Math.min(need, room, left);
      b.allocatedMW = add === need ? b.mw : b.allocatedMW + add;
      room -= add; left -= add;
      if (b.allocatedMW < b.mw) break;
    }
    const connectedMW = entries.reduce((sum, b) => sum + (b.allocatedMW >= b.mw ? b.mw : 0), 0);
    return { peakMW: local.peakMW, hostMW, headroomMW: Math.max(0, room), connectedMW,
      waitingMW: entries.reduce((sum, b) => sum + (b.allocatedMW < b.mw ? b.mw : 0), 0),
      reservedMW: entries.reduce((sum, b) => sum + b.allocatedMW, 0) - connectedMW,
      monthlyMW, entries, round: tick ? S.round : old ? old.round : 0 };
  }
  function gridView(g) {
    if (!g) return null;
    const { entries, ...view } = g;
    return view;
  }
  function refreshGrid(S, bg, advance = false) {
    if (!S.econ) return;
    const R = regionOf(S.region);
    S.grid = Object.fromEntries(activeOf(S).map(id => [id, gridStatus(S, R, bg, id, advance)]));
  }

  // 팀 도시 하나를 고립 운전한다. 반환: 정산에 쓸 시간별 자료와 자체 지표.
  function simTeam(bg, R, id, plan, rnd, cap, mods) {
    return withPack(bg, R, id, () => {
      const st = bg.sanitize(plan || {}, cap);
      st.season = rnd.season;
      st.seed = rnd.seed;
      if (mods && mods.tax && !st.policies.includes("tax")) st.policies.push("tax");
      const res = bg.simulate(st, rnd.days, { league: true, mods: mods && Object.keys(mods).length ? mods : null });
      const H = res.H, NT = res.NT, uns = new Float32Array(H);
      for (let k = 0; k < H; k++) { let s = 0; for (let ti = 0; ti < NT; ti++) s += res.hrUns[k * NT + ti]; uns[k] = s; }
      // 최대 수요 시각에 계통 접속된 잉여 재생 + 추가 화력 출력에서 미공급 수요를 뺀다.
      // gx는 build.simulate가 연계 정산용으로 내보내는 시간별 여유 능력이다.
      let peak = 0;
      for (let k = 1; k < H; k++) if (res.hrDem[k] > res.hrDem[peak]) peak = k;
      const spareMW = res.gx ? Math.max(0, res.gx.reduce((a, g) => a + g.ren[peak] + g.head[peak], 0) - uns[peak]) : null;
      // 발전 가동률은 실제 운전값을 유지하고, 재생 민원의 기존 공유 할인만 원상복원한다.
      const raw = st.policies.includes("share") ? bg.complaints({ ...st, policies: st.policies.filter(p => p !== "share") }, null).items : [];
      const complaints = new Map();
      res.cp.items.forEach(item => {
        const base = ["wind", "offshore", "solar"].includes(st.builds[item.bi].t) ? raw.find(x => x.bi === item.bi && x.ti === item.ti && x.kind === item.kind) : null;
        const kind = item.kind === "green" ? "forest" : item.kind, src = item.src || st.builds[item.bi].t, key = kind + ":" + item.ti + ":" + src;
        const entry = complaints.get(key) || { kind, score: 0, near: item.ti, src };
        entry.score += base ? base.pts : item.pts; complaints.set(key, entry);
      });
      const ret = {
        residentDemandShare: res.tot.dem > 0 ? res.town.reduce((s, t, i) => s + (["factory_big", "industry", "port"].includes(bg.TOWNS[i].kind) ? 0 : t.dem), 0) / res.tot.dem : 0,
        loss: res.tot.loss, idle: res.tot.idle, cpList: [...complaints.values()],
        ...(mods && mods.curtailP != null ? { curtailMWh: res.tot.curtailMWh } : {}),
        spareMW, H, dem: res.hrDem, uns, gx: res.gx || [], hosp: res.hrHosp, hospDem: res.hrHospDem, hospUns: res.hrHospUns,
        k: {
          dem: res.tot.dem, uns: res.unsTotal, hospH: res.hospH || 0, capex: res.cost.capex, fuel: res.cost.fuel, policy: res.cost.policy,
          co2: res.co2, bioCo2: res.bioCo2, sat: Math.min(...res.sat), curt: res.tot.curt, ren: res.tot.ren + res.tot.batOut, by: res.tot.by, pmBy: res.tot.pmBy, cp: res.cp.issues
        }
      };
      Object.defineProperty(ret, "_res", { value: res, enumerable: false });
      return ret;
    });
  }

  // ties: [{id, a, b, cap}] (지어진 것), sims: {id: simTeam 결과}, price: {id: 억/MWh}
  // 시간마다 두 번 산다: ① 모자란 만큼(정전 막기) ② 이웃 단가가 우리 화력 연료비보다 싸면 그 화력을 줄이고 사 온다(대체).
  function settle(ties, sims, price, H, days) {
    const out = {}, flow = {};
    Object.keys(sims).forEach(id => {
      out[id] = { imp: 0, exp: 0, pay: 0, earn: 0, fuelX: 0, co2X: 0, co2In: 0, bioCo2X: 0, saveBioCo2: 0, byX: {}, saveBy: {}, pmX: {}, savePM: {}, curtX: 0, sub: 0, saveFuel: 0, saveCo2: 0, del: new Float32Array(H), unlinked: [] };
    });
    const gate = (id, other) => (sims[id] ? sims[id].gx.find(g => g.to.includes(other)) : null);
    const usable = [];
    ties.forEach(T => {
      flow[T.id] = { ab: 0, ba: 0, day: new Array(days).fill(0) };
      const ga = gate(T.a, T.b), gb = gate(T.b, T.a);
      if (!ga && out[T.a]) out[T.a].unlinked.push(T.b);
      if (!gb && out[T.b]) out[T.b].unlinked.push(T.a);
      if (ga && gb) usable.push({ T, ga, gb });
    });
    const left = new Map();
    for (let k = 0; k < H; k++) {
      left.clear();
      const offers = [];
      usable.forEach(U => {
        [U.ga, U.gb].forEach(g => { if (!left.has(g)) left.set(g, { def: g.def[k], ren: g.ren[k], head: g.head[k], disp: g.disp ? g.disp[k] : 0, dmc: g.dmc ? g.dmc[k] : 0, dco2: g.dco2 ? g.dco2[k] : 0, dbioCo2: g.dbioCo2 ? g.dbioCo2[k] : 0 }); });
        U.capLeft = U.T.cap;
        // 팔 쪽 → 살 쪽, 종류(재생·버릴 전력 0 · 화력 여유 1), 단가
        [[U.T.a, U.ga, U.T.b, U.gb, 1], [U.T.b, U.gb, U.T.a, U.ga, -1]].forEach(([s, gs, b, gbuy, dir]) => {
          offers.push({ U, s, gs, b, gbuy, dir, kind: 0, p: price[s] });
          if (price[s] >= gs.mc - 1e-12) offers.push({ U, s, gs, b, gbuy, dir, kind: 1, p: price[s] });
        });
      });
      offers.sort((x, y) => (x.kind - y.kind) || (x.p - y.p));
      for (const mode of ["def", "disp"]) {
        for (const o of offers) {
          const S = left.get(o.gs), B = left.get(o.gbuy);
          if (o.U.capLeft <= 1e-6) continue;
          const need = mode === "def" ? B.def : (o.p < B.dmc - 1e-12 ? B.disp : 0);
          if (need <= 1e-6) continue;
          const have = o.kind === 0 ? S.ren : S.head;
          if (have <= 1e-6) continue;
          const loss = o.U.T.loss == null ? TIE_LOSS : o.U.T.loss;
          const sent = Math.min(have, o.U.capLeft, need / (1 - loss)), got = sent * (1 - loss);
          if (o.kind === 0) S.ren -= sent; else S.head -= sent;
          o.U.capLeft -= sent;
          const so = out[o.s], bo = out[o.b];
          if (mode === "def") { B.def -= got; bo.del[k] += got; }
          else { B.disp -= got; bo.sub += got; bo.saveFuel += got * B.dmc; bo.saveCo2 += got * B.dco2; bo.saveBioCo2 += got * B.dbioCo2; }
          if (mode === "disp") Object.entries(o.gbuy.byDisp || {}).forEach(([fuel, share]) => {
            bo.saveBy[fuel] = (bo.saveBy[fuel] || 0) + got * share[k];
          });
          if (mode === "disp") Object.entries(o.gbuy.pmDisp || o.gbuy.byDisp || {}).forEach(([fuel, share]) => {
            bo.savePM[fuel] = (bo.savePM[fuel] || 0) + got * share[k];
          });
          so.exp += sent; so.earn += got * o.p; bo.imp += got; bo.pay += got * o.p;
          if (o.kind === 1) { so.fuelX += sent * o.gs.mc; so.co2X += sent * o.gs.co2i; so.bioCo2X += sent * (o.gs.bioCo2i || 0); bo.co2In += sent * o.gs.co2i; }
          else so.curtX += sent;
          if (o.kind === 1) Object.entries(o.gs.byHead || {}).forEach(([fuel, share]) => {
            so.byX[fuel] = (so.byX[fuel] || 0) + sent * share;
          });
          if (o.kind === 1) Object.entries(o.gs.pmHead || o.gs.byHead || {}).forEach(([fuel, share]) => {
            so.pmX[fuel] = (so.pmX[fuel] || 0) + sent * share;
          });
          const F = flow[o.U.T.id];
          if (o.dir > 0) F.ab += got; else F.ba += got;
          F.day[Math.floor(k / 24)] += o.dir * got;
        }
      }
    }
    Object.values(flow).forEach(F => { F.ab = r2(F.ab); F.ba = r2(F.ba); F.day = F.day.map(r2); });
    return { out, flow };
  }

  // D-74: 이웃 거래 뒤의 부족만 현재 운영 시간별 수요에 비례해 보충한다.
  // 기존 정산 필드만 사용한다. 지역 생산·PM·수출 연료 회계에는 넣지 않는다.
  function gridSupply(o, s) {
    const P = KCP.ECON_DATA.params;
    let total = 0;
    for (let k = 0; k < s.H; k++) {
      const amount = Math.min(Math.max(0, s.uns[k] - o.del[k]), s.dem[k] * P.gridImportShare.v);
      o.del[k] += amount;
      total += amount;
    }
    o.fuelX += total * P.normalCost.v * P.gridImportMarkup.v;
    o.co2In += total * P.normalCo2.v;
    return total; // imp·pay는 이웃 거래 전용. 계통 공급량은 내부 호출에서만 쓴다.
  }

  // AI의 거래 없는 공개 대표 주. 운영과 같은 계통 보충으로 소비 CO2/공급량 산출.
  function planningEnergy(s) {
    const o = { del: new Float32Array(s.H), fuelX: 0, co2In: 0 };
    const imported = gridSupply(o, s);
    return { demMWh: s.k.dem, servedMWh: Math.max(0, s.k.dem - s.k.uns + imported),
      co2: s.k.co2 + o.co2In, cpList: s.cpList };
  }

  // 거래 없는 도시 시험. 자체 생산(tot.co2)은 보존하고 co2는 소비 배출로 표시한다.
  // 원본·공개 필드 집합은 그대로 두며 시간별 수요 보조자료는 WeakMap에서만 읽는다.
  function gridFill(sim) {
    const res = structuredClone(sim), uns = new Float32Array(res.H);
    for (let k = 0; k < res.H; k++) {
      let total = 0;
      for (let ti = 0; ti < res.NT; ti++) total += res.hrUns[k * res.NT + ti];
      uns[k] = total;
    }
    const o = { del: new Float32Array(res.H), fuelX: 0, co2In: 0 };
    const imported = gridSupply(o, { H: res.H, dem: res.hrDem, uns });
    const detail = KCP.buildGame.gridFillContext(sim);
    if (!detail) throw new Error("gridFill needs an original league simulation");
    res.town.forEach(t => { t.uns = t.outH = t.eveH = t.cloudH = t.hotH = 0; t.dayOut.fill(0); });
    for (let k = 0; k < res.H; k++) {
      const d = Math.floor(k / 24), h = k % 24;
      // 실제 운영의 병원 정전 판정과 같이 수입을 병원 부족부터 배분한다.
      let left = o.del[k];
      for (const hospital of [true, false]) {
        const shortage = res.town.reduce((sum, _, ti) => sum + (detail.hospTi[ti] === hospital ? sim.hrUns[k * res.NT + ti] : 0), 0);
        const fill = Math.min(left, shortage);
        left -= fill;
        res.town.forEach((t, ti) => {
          if (detail.hospTi[ti] !== hospital) return;
          const at = k * res.NT + ti, remaining = Math.max(0, sim.hrUns[at] * (shortage > 0 ? 1 - fill / shortage : 1));
          res.hrUns[at] = remaining; t.uns += remaining;
          if (remaining > Math.max(.005, .02 * detail.townDemand[at])) {
            t.outH++; t.dayOut[d]++;
            if (h >= 17 && h < 23) t.eveH++;
            if (res.wx[d].w > 0) t.cloudH++;
            if (res.wx[d].hot) t.hotH++;
          }
        });
      }
      res.hrSup[k] += o.del[k];
      res.hrHospUns[k] = Math.max(0, sim.hrHospUns[k] - o.del[k]);
      res.hrHosp[k] = res.hrHospUns[k] > Math.max(.005, .02 * res.hrHospDem[k]) ? 1 : 0;
    }
    res.unsTotal = Math.max(0, sim.unsTotal - imported);
    res.outTotal = res.town.reduce((sum, t) => sum + t.outH, 0);
    res.hospH = res.hrHosp.reduce((sum, h) => sum + h, 0);
    res.tot.sup += imported; res.tot.by.import += imported;
    res.tot.fuel += o.fuelX; res.cost.fuel += o.fuelX; res.cost.total += o.fuelX;
    res.co2 += o.co2In;
    const bg = KCP.buildGame;
    preserveMap(bg, () => { bg.selectPack(res.map, "league"); detail.finish(res); });
    return res;
  }

  // 라운드 하나를 돌려 결과를 state.results에 붙인다.
  function runRound(S, bg) {
    const R = regionOf(S.region), rd = roundsOf(S)[S.round - 1];
    if (S.econ) refreshGrid(S, bg, true);
    const rnd = { season: rd.season, days: rd.days, seed: (7000 + S.round * 13 + (S.salt || 0)) >>> 0 };
    const sims = {}, price = {};
    const act = R.teams.filter(t => Object.hasOwn(S.teams, t.id));
    act.forEach(t => {
      const T = S.teams[t.id];
      // 이미 승인된 설비는 운영 적자로 지방채 한도를 넘더라도 사라지지 않는다.
      const cap = S.econ ? Math.max(budget(S, t.id), capexOf(bg, R, t.id, T.plan || {})) : budget(S, t.id);
      sims[t.id] = simTeam(bg, R, t.id, T.plan, rnd, cap, modsFor(S, R, t.id));
      price[t.id] = T.price;
    });
    const H = rnd.days * 24;
    // 이벤트: 연계선 용량 배수, 고장 난 선 하나(지정 없으면 지어진 선 중 하나를 같은 씨앗으로)
    const TM = tieMods(S, R);
    let built = S.ties.filter(T => T.st === "built").map(T => effectiveTie(S, T, TM.mul));
    if (TM.down.length && built.length) {
      const named = TM.down.filter(x => x !== "*");
      const victim = named.find(x => built.some(T => T.id === x || T.id === x.split("~").reverse().join("~"))) || (TM.down.includes("*") ? built[hashStr((S.seedKey ?? S.room) + S.round) % built.length].id : null);
      if (victim) {
        const reverse = victim.split("~").reverse().join("~");
        const causes = (S.events || []).filter(e => e.round === S.round).filter(ev => {
          const effect = eventDef(R, ev.id)?.effect, target = effect?.tieDown;
          if (!target || typeof target === "string" && target !== victim && target !== reverse) return false;
          const ends = typeof target === "string" ? target.split("~") : activeOf(S).filter(id => hits(R, eventDef(R, ev.id), id, S));
          return !ends.some(id => respOpt(R, S, id, ev)?.cancel);
        });
        const shield = KCP.TECH_DATA && causes.length && causes.every(ev => ev.id === "typhoon_coast") && built.some(t => t.id === victim && [t.a, t.b].some(id => techOf(S, id).includes("scable")));
        if (!shield) { built = built.filter(T => T.id !== victim && T.id !== victim.split("~").reverse().join("~")); rnd.tieDown = victim; }
      }
    }
    const { out, flow } = settle(built, sims, price, H, rnd.days);
    if (S.econ) act.forEach(({ id }) => gridSupply(out[id], sims[id]));
    lastRun = { round: S.round, days: rnd.days, seed: rnd.seed, season: rnd.season,
      teams: Object.fromEntries(act.map(({ id }) => [id, { res: sims[id]._res, del: out[id].del, uns: sims[id].uns, dem: sims[id].dem }])) };
    const team = {};
    let rDem = 0, rUns = 0, rCo2 = 0;
    act.forEach(t => {
      const s = sims[t.id], o = out[t.id], K = s.k;
      let outH = 0, hospH = 0;
      for (let k = 0; k < H; k++) {
        if (isOutHour(s.uns, o.del, s.dem, k)) outH++;
        if (s.hosp && s.hosp[k] && Math.max(0, (s.hospUns?.[k] ?? s.uns[k]) - o.del[k]) > outageFloor(s.hospDem?.[k] || 0)) hospH++;
      }
      const uns = Math.max(0, K.uns - o.del.reduce((sum, amount) => sum + amount, 0));
      const tie = tieShare(S, R, t.id), Tm = S.teams[t.id], loss = r2((Tm.sunk || 0) + lossOf(Tm.base, Tm.plan));
      // 현금 흐름: 이번 라운드 새 투자(누적 투자 − 지난 라운드까지) + 이번 라운드 운영비. 라운드를 더해도 건설비가 두 번 세지지 않는다.
      const rfix = r2(Tm.rfix || 0), stock = r2(K.capex + tie + loss + rfix), resp = respCost(S, R, t.id, S.round);
      const labs = ((Tm.plan && Tm.plan.builds) || []).filter(b => b.t === "lab").length, research = (bg.RS ? labs * bg.RS.labOpexR : 0) + coolingCost(S, t.id);
      const cost = { capex: r2(K.capex), ties: r2(tie), loss, rfix, stock, inv: r2(stock - (Tm.stock || 0)), fuel: r2(K.fuel + o.fuelX - o.saveFuel), policy: r2(K.policy), resp, research, trade: r2(o.pay - o.earn) };
      cost.opex = r2(cost.fuel + cost.policy + cost.resp + cost.research + cost.trade);
      cost.total = r2(cost.inv + cost.opex);
      const co2Prod = K.co2 + o.co2X - o.saveCo2, co2Cons = co2Prod - o.co2X + o.co2In;
      team[t.id] = {
        spareMW: s.spareMW, dem: r2(K.dem), uns: r2(uns), unsPct: r2(100 * uns / Math.max(1e-9, K.dem)), outH, hospH,
        cost, bioCo2: Math.max(0, (K.bioCo2 || 0) + o.bioCo2X - o.saveBioCo2), co2Prod: Math.round(co2Prod), co2Cons: Math.round(co2Cons), imp: r2(o.imp), sub: r2(o.sub), exp: r2(o.exp), earn: r2(o.earn), pay: r2(o.pay),
        sat: K.sat, cp: K.cp, curt: r2(Math.max(0, K.curt - o.curtX)), renPct: Math.round(100 * Math.min(1, K.ren / Math.max(1e-9, K.dem))),
        unlinked: o.unlinked, isolated: { uns: r2(K.uns), co2: Math.round(K.co2) }
      };
      if (S.econ) {
        Object.assign(team[t.id], { loss: s.loss, idle: s.idle, cpList: s.cpList });
        team[t.id].grid = gridView(S.grid[t.id]);
        team[t.id].curtailMWh = s.curtailMWh;
      }
      rDem += K.dem; rUns += uns; rCo2 += co2Prod;
    });
    const royalties = royaltyLedger(S, team);
    act.forEach(({ id }) => {
      const ledger = royalties[id], cost = team[id].cost;
      cost.research = r2(cost.research + ledger.expense);
      if (!S.econ) cost.trade = r2(cost.trade - ledger.income);
      cost.opex = r2(cost.fuel + cost.policy + cost.resp + cost.research + cost.trade);
      cost.total = r2(cost.inv + cost.opex);
      if (ledger.income || ledger.expense || coolingCost(S, id)) team[id].technologyCost = { ...ledger, cooling: coolingCost(S, id) };
    });
    const region = { dem: r2(rDem), uns: r2(rUns), unsPct: r2(100 * rUns / Math.max(1e-9, rDem)), co2: Math.round(rCo2) };
    const G = goalsOf(S);
    region.ok = { uns: region.unsPct <= G.unsPct, co2: region.co2 <= G.co2 };
    const result = { round: S.round, month: rd.month || null, year: rd.year || null, season: rd.season, days: rd.days, seed: rnd.seed, team, region, flow, events: (S.events || []).filter(x => x.round === S.round).map(x => x.id), tieDown: rnd.tieDown || null };
    S.results = S.results.filter(x => x.round !== S.round).concat([result]);
    return result;
  }

  // 같은 계획·접속·거래·날씨에서 사건만 제거한 반사실을 결과에 보존한다.
  // 결과 화면에서 이미 다음 계획으로 바뀌어도 당시 기준을 재사용할 수 있다.
  function recordCo2Attribution(S, bg, res) {
    const rd = roundsOf(S)[S.round - 1], mul = rd.mdays / res.days;
    const previous = S.results.find(r => r.round === res.round - 1);
    const noEvents = { ...S, events: [], results: [] };
    const clear = runRound(noEvents, bg);
    res.demandBefore = Object.fromEntries(activeOf(S).map(id => [id, { pop: S.econ.cities[id].pop, ind: S.econ.cities[id].ind }]));
    activeOf(S).forEach(id => { res.team[id].co2NoEvent = clear.team[id].co2Prod; });
    res.co2Attribution = {};
    if (!previous?.demandBefore || activeOf(S).some(id => !Number.isFinite(previous.team[id]?.co2NoEvent))) return;
    const oldRd = roundsOf(S)[previous.round - 1], prevMul = oldRd.mdays / previous.days;
    const reference = { ...noEvents, results: [], rounds: roundsOf(S).map((r, i) => i === S.round - 1 ? { ...r, season: previous.season } : r),
      econ: { ...S.econ, cities: Object.fromEntries(activeOf(S).map(id => [id, { ...S.econ.cities[id], ...previous.demandBefore[id] }])) } };
    const baseline = runRound(reference, bg);
    activeOf(S).forEach(id => {
      const r = res.team[id], old = previous.team[id];
      const total = r.co2Prod * mul - old.co2Prod * prevMul;
      const event = (r.co2Prod - r.co2NoEvent) * mul - (old.co2Prod - old.co2NoEvent) * prevMul;
      const seasonalDemand = (r.co2NoEvent - baseline.team[id].co2Prod) * mul;
      const calendar = old.co2NoEvent * (rd.mdays - oldRd.mdays) / previous.days;
      res.co2Attribution[id] = { total, seasonalDemand, calendar, event,
        remainder: total - event - seasonalDemand - calendar };
    });
  }
  // 운영 단계: 진행자 기기에서 바로 돌리고 결과 단계로.
  function run(S, bg, now) {
    if (S.phase !== "plan") return null;
    // 계획 중인 옛 저장도 운영 수요가 계산되기 전에 계획 기준을 한 번 보존한다.
    preserveGoalPlan(S);
    // 이미 계획 단계인 옛 저장도 학생이 본 기준을 소급 변경하지 않는다.
    if (S.econ && !S.econCal) S.econCal = true;
    S.phase = "run"; S.ends = null;
    const res = runRound(S, bg);
    replayCache = { round: S.round, salt: S.salt || 0, room: S.room, data: lastRun };
    if (S.econ) preserveMap(bg, () => recordCo2Attribution(S, bg, res));
    // 운영한 것은 이제 '지난 라운드 것' — 철거하면 손실. 누적 투자도 확정.
    const R = regionOf(S.region);
    const beforeEureka = Object.fromEntries(activeOf(S).map(id => [id, researchOf(S.teams[id]).eureka]));
    const beforeResearch = Object.fromEntries(activeOf(S).map(id => [id, S.teams[id].rfix || 0]));
    if (bg.TECHS) advanceResearchAll(bg, R, S, res, now);
    // 월초 자산을 갱신하기 전에 적격 사용액을 지역 변수로 보존한다(공개 상태에 추가하지 않음).
    const grants = Object.fromEntries(activeOf(S).map(id => [id, grantOf(S, R, id, bg).used]));
    Object.keys(res.team).forEach(id => {
      const T = S.teams[id], add = r2((T.rfix || 0) - beforeResearch[id]), c = res.team[id].cost;
      if (add) { c.rfix = r2(c.rfix + add); c.stock = r2(c.stock + add); c.inv = r2(c.inv + add); c.total = r2(c.inv + c.opex); }
      const rs = researchOf(T), ledger = res.team[id].technologyCost;
      if (ledger && !S.econ) T.royaltyNet = r2((T.royaltyNet || 0) + ledger.income - ledger.expense);
      if (ledger) ledger.payments.forEach(p => { rs.royaltyMonths[p.card] = (rs.royaltyMonths[p.card] || 0) + 1; });
      saveResearch(T, rs);
      if (Object.keys(rs.prog).length) res.team[id].research = { ...researchView(S, id),
        completed: Object.keys(rs.adoptR).filter(key => rs.adoptR[key] === S.round + 1),
        eurekaNow: rs.eureka.filter(key => !beforeEureka[id].includes(key)) };
      T.sunk = r2((T.sunk || 0) + lossOf(T.base, T.plan));
      T.base = T.plan ? itemCosts(bg, R, id, T.plan) : [];
      T.stock = res.team[id].cost.stock;
    });
    if (S.econ && KCP.econ) econMonth(S, R, bg, res, grants);
    S.phase = "review"; S.ends = now + REVIEW_MS;
    const reported = res.econ?.region || res.region;
    log(S, `${S.econ ? res.month + "월" : S.round + "라운드"} 운영 끝 · 지역 정전 ${r2(reported.unsPct)}% · CO₂ ${Math.round(reported.co2)} t${S.econ ? "(월)" : ""}`, now);
    S.rev++;
    return res;
  }

  /* ---------- 경제 한 달(ui/econ.js) ---------- */
  // 대표 운영 결과를 그 달 일수로 환산한다. 기준 보정은 첫 계획 전에 고정한다.
  function calibrateStart(S, R, bg) {
    // 시작 지도·첫 달 달력만 사용한다. 학생 계획·정책·사건은 기준을 바꾸지 않는다.
    const rd = roundsOf(S)[0], wk = rd.mdays / rd.days, P = KCP.ECON_DATA.params, base = {};
    preserveMap(bg, () => activeOf(S).forEach(id => {
      // 기준 배치는 학생의 자산이 아니며 비용·연구·사건을 보정에 청구하지 않는다.
      // 지도에 있는 발전소만 고정 전선으로 연결해 운전한다. 부족한 공급은 기준 설비를 추가해 메우지 않는다.
      const normalPlan = KCP.ECON_DATA.normalStartPlans[id];
      const normal = simTeam(bg, R, id, normalPlan || {}, { season: rd.season, days: rd.days, seed: 0 }, Number.MAX_VALUE, {}).k;
      const dem = normal.dem, served = Math.max(0, dem - normal.uns);
      // 부분 공급도 무발전 도시와 같은 계통 대체값으로 부족 MWh를 보충한다.
      const missing = Math.max(0, dem - served);
      const intensity = dem > 1e-6 ? (normal.co2 + missing * P.normalCo2.v) / dem : P.normalCo2.v;
      // F05: 월 입력과 같은 자산 경로. 시작 보정에는 학생 건설·정책을 포함하지 않는다.
      const initial = { ...S, teams: { ...S.teams, [id]: { ...S.teams[id], plan: { builds: [], policies: [] }, econPol: {} } } };
      base[id] = econInput(initial, R, id, { by: normal.by, pmBy: normal.pmBy, dem, uns: 0, unsPct: 0, hospH: 0,
        co2Prod: intensity * dem, co2Cons: intensity * dem, renPct: P.normalRen.v,
        exp: 0, imp: 0, pay: 0, earn: 0, cost: { fuel: normal.fuel + missing * P.normalCost.v, policy: 0 } }, wk);
    }));
    S.econ = KCP.econ.calibrate(S.econ, base); S.econCal = true;
    // 공동목표 첫 달의 근거: 보정 운영 수요(월 MWh). 학생 운영 수요로 갱신하지 않는다.
    S.goalDemand0 = Object.values(base).reduce((total, input) => total + input.energy.demMWh, 0);
  }
  function econInput(S, R, id, r, wk, extra, grantUsed) {
    const c = r.cost, served = Math.max(0, r.dem - (r.uns == null ? r.dem * r.unsPct / 100 : r.uns)), plan = S.teams[id].plan || { builds: [] }, n = t => (plan.builds || []).filter(b => b.t === t).length;
    return {
      // by는 거래 후 대표 운영 기간의 생산 MWh(시작 보정은 거래 없음). 수입 전기는 제외한다.
      energy: { ...(r.pmBy ? { pmGenMWh: Object.fromEntries(Object.entries(r.pmBy).map(([f, v]) => [f, v * wk])) } : {}), genMWh: Object.fromEntries(["coal", "lng", "diesel", "biomass", "smr"].map(f => [f, (r.by?.[f] || 0) * wk])), bioCo2: (r.bioCo2 || 0) * wk, priceMul: (S.events || []).some(ev => ev.round === S.round && ev.id === "regional_tariff" && scopeHits(R, eventDef(R, ev.id), id)) ? eventDef(R, "regional_tariff").effect.industryPriceMul : 1, residentDemandShare: r.residentDemandShare ?? 1, cpList: r.cpList || [], exportMWh: r.exp * wk, importMWh: r.imp * wk, tieCost: c.ties || 0, ...(S.econ ? { waitingMW: r.grid ? r.grid.waitingMW : 0, curtailMWh: (r.curtailMWh || 0) * wk } : {}), unsPct: r.unsPct, hospH: r.hospH * wk, costPerMWh: served > 0 ? (Math.max(0, c.fuel - (r.exportFuel || 0)) + c.policy + r.pay) / served : 0, co2Local: r.co2Prod * wk, co2: r.co2Cons * wk, renPct: r.renPct,
        tradeNet: r2((r.earn - r.pay) * wk), royalty: r.technologyCost?.income || 0, opex: r2(Math.max(0, (c.fuel + c.policy) * wk + (c.resp || 0) + (c.research || 0))), capexNew: Math.max(0, c.inv || 0), demMWh: r.dem * wk, servedMWh: served * wk, buyCost: r.pay * wk, spareMW: r.spareMW,
        // 특별교부세의 미사용분은 세입으로 인정하지 않아 운영 적자·다음 달 현금에 쓰이지 않는다.
        bonus: r2(bonusOf(S, R, id, S.round) - grantAmount(S, R, id) + (grantUsed ?? grantOf(S, R, id).used)), salvage: Math.max(0, -(c.inv || 0)) },
      policy: { ...(S.teams[id].econPol || {}), save: (plan.policies || []).includes("save"), share: (plan.policies || []).includes("share") },
      assets: Object.assign({ uni: (KCP.ECON_DATA.start[id]?.univ0 || 0) + n("uni"), lab: (KCP.ECON_DATA.start[id]?.lab0 || 0) + n("lab") }, extra || {})
    };
  }
  function econMonth(S, R, bg, res, grants) {
    const rd = roundsOf(S)[S.round - 1], wk = (rd?.mdays || 30) / (rd?.days || res.days), ids = Object.keys(res.team);
    if (S.econ.t >= S.econ.len) return;
    // runRound의 공개 결과에는 판매용 연료와 시간별 거래가 없다.
    // 같은 씨앗·계획·운영 배수로 정산을 재현한다. 계절 모드는 이 경로에 들어오지 않는다.
    const sims = {}, price = {}, rnd = { season: res.season, days: res.days, seed: res.seed };
    ids.forEach(id => {
      const plan = S.teams[id].plan || {};
      sims[id] = simTeam(bg, R, id, plan, rnd, Math.max(budget(S, id), capexOf(bg, R, id, plan)), modsFor(S, R, id));
      price[id] = S.teams[id].price;
    });
    const tm = tieMods(S, R), ties = S.ties.filter(t => t.st === "built" && tieId(t) !== res.tieDown && tieId(t).split("~").reverse().join("~") !== res.tieDown)
      .map(t => effectiveTie(S, t, tm.mul));
    const settled = settle(ties, sims, price, res.days * 24, res.days);
    ids.forEach(id => {
      const s = sims[id], r = res.team[id];
      r.exportFuel = settled.out[id].fuelX;
      r.residentDemandShare = s.residentDemandShare;
      let peak = 0;
      for (let k = 1; k < s.H; k++) if (s.dem[k] > s.dem[peak]) peak = k;
      // 해당 시각만 재정산해 판매에 쓴 여유를 뺀다. 미접속 망의 부족은 섞지 않는다.
      const slice = {};
      ids.forEach(cid => { slice[cid] = { gx: sims[cid].gx.map(g => Object.assign({}, g,
        { byDisp: Object.fromEntries(Object.entries(g.byDisp || {}).map(([fuel, share]) => [fuel, [share[peak]]])), pmDisp: Object.fromEntries(Object.entries(g.pmDisp || g.byDisp || {}).map(([fuel, share]) => [fuel, [share[peak]]])) },
        Object.fromEntries(["def", "ren", "head", "disp", "dmc", "dco2"].map(key => [key, [g[key] ? g[key][peak] : 0]])))) }; });
      const atPeak = settle(ties, slice, price, 1, 1).out[id];
      // 추가 화력 출력만 인정하고, 재생 판매도 전부 차감하는 보수적 하한이다.
      r.spareMW = Math.max(0, s.gx.reduce((a, g) => a + Math.max(0, g.head[peak] - g.def[peak]), 0) - atPeak.exp);
    });
    const inputs = {};
    ids.forEach(id => {
      const o = settled.out[id], by = Object.fromEntries(["coal", "lng", "diesel", "biomass", "smr"].map(fuel =>
        [fuel, Math.max(0, (sims[id].k.by[fuel] || 0) + (o.byX[fuel] || 0) - (o.saveBy[fuel] || 0))]));
      const pmBy = Object.fromEntries(["coal", "lng", "diesel", "biomass", "smr", "coalNew", "lngNew"].map(fuel =>
        [fuel, Math.max(0, (sims[id].k.pmBy?.[fuel] || 0) + (o.pmX[fuel] || 0) - (o.savePM[fuel] || 0))]));
      // 월 입력에서만 사용한다. 공개 결과·36달 저장에는 연료별 중간값을 싣지 않는다.
      inputs[id] = econInput(S, R, id, { ...res.team[id], by, pmBy }, wk, undefined, grants[id]);
    });
    // 화면 원인 설명용 직전 값. 학생 자유 서술은 포함하지 않는다.
    S.econPreviousScore = KCP.econ.score(S.econ);
    S.econBefore = Object.fromEntries(ids.map(id => {
      const c = S.econ.cities[id];
      return [id, { pop: c.pop, ind: c.ind, cash: c.cash, approval: c.approval, groups: Object.fromEntries(Object.keys(c.groups).map(g => [g, c.groups[g].sat])), lagL: Object.assign({}, c.lagL), groupParts: groupParts(c, S.econRep?.groups[id]) }];
    }));
    const goals = goalsOf(S);
    inputs.region = { goal: { uns: goals.unsPct, co2: goals.co2Plan } };
    const out = KCP.econ.monthStep(S.econ, inputs);
    S.econ = out.E;
    // 투자 기준만 확정한다. 지원금·철거 회수는 monthStep 보고서에서 이미 정산했다.
    ids.forEach(id => {
      const T = S.teams[id];
      T.committed = r2(capexOf(bg, R, id, T.plan || {}) + fixedOf(S, R, id));
      T.tieAt = tieShare(S, R, id);
    });
    const rep = out.report;
    if (!rep) return;
    rep.co2Attribution = res.co2Attribution || {};
    ids.forEach(id => {
      const f = rep.fiscal[id];
      // 재정은 차익 회계를 유지하되, 총지출 장부에는 상계된 전력 원가를 수입·운영비 양쪽에 복원한다.
      const powerCost = f.tariffGross - f.rev.tariff;
      res.team[id].ledger = { open: f.cashBefore, income: r3(f.revTotal + powerCost), invest: f.exp.capex,
        opex: r3(f.expTotal - f.exp.capex + powerCost), close: f.cashAfter };
    });
    rep.grid = Object.fromEntries(ids.map(id => [id, Object.assign({}, res.team[id].grid,
      { curtailMWh: inputs[id].energy.curtailMWh })]));
    // 기업 이전 희망: 마지막 달까지 조건(재생 %·정전·구직 인력)을 맞춘 도시 가운데 산업 매력이 가장 큰 곳으로 정한다.
    (rep.offers || []).forEach(o => {
      if (rep.t < o.until - 1 || !o.eval) return;
      const best = o.eval.rank.find(id => o.eval.by[id] && o.eval.by[id].ok);
      if (!best) { rep.news.push(`${o.name}: 조건을 맞춘 도시가 없어 이전 무산`); return; }
      const r = KCP.econ.acceptOffer(S.econ, o.id, best);
      if (r.ok) { S.econ = r.E; rep.news.push(r.news); }
    });
    res.econ = rep;
    S.econRep = rep;
    rep.news.slice(0, 3).forEach(t => log(S, t, 0));
  }

  // 혼자 하기에서도 컴퓨터 요청을 사람과 같은 reduce 경로로 검사한다.
  function computerPlans(S, bg, player, style, repliesOnly) {
    if (S.phase !== "plan" || !KCP.leagueAI || typeof KCP.leagueAI.plan !== "function") return [];
    const R = regionOf(S.region), answers = [];
    activeOf(S).filter(id => id !== player).forEach(id => {
      const T = S.teams[id], result = KCP.leagueAI.plan(S, R, id, bg, style);
      if (!result) return;
      const apply = (type, extra) => { const r = reduce(S, Object.assign({ type, team: id, token: T.token }, extra), 0, bg); answers.push({ id, type, ok: r.ok, err: r.err }); };
      if (!repliesOnly) {
        if (result.plan) apply("plan", { rev: T.rev + 1, plan: result.plan });
        if (result.econPol) apply("econ", result.econPol);
      }
      (result.ties || []).forEach(tie => { if (!repliesOnly || tie.type !== "propose") apply("tie", { op: tie.type, other: tie.other, cap: tie.cap, kind: tie.kind }); });
      apply("ready", { ready: true });
    });
    return answers;
  }

  KCP.leagueCore = {
    replayOf, researchView, researchError, researchReserve, effectiveTie, royaltyLedger, techCards, connectedTie,
    gridStatus, refreshGrid, econView, computerPlans, eventDef, modsFor, trialMods, hits, drawEvents, roundsOf, monthRounds, SEASON_OF_MONTH,
    PHASES, PRICE, TIE_LOSS, regionOf, teamDef, tieDef, tieId, validTeams, activeOf, goalsOf, newState, publicView, reduce, host, run, runRound, settle, simTeam, planningEnergy,
    budget, tieCost, tieShare, cleanPlan, capexOf, gridFill,
    SALV, MUL, itemKey, lossOf, itemCosts, respCost, bonusOf, grantAmount, grantOf, fundingOf, fixedOf, spendOf, techOf, econInput
  };
})();
