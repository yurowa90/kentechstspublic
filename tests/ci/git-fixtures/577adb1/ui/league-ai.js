/* 컴퓨터 도시(U3, ECON-GAMES A1). 호스트 상태를 읽고 사람과 같은 요청 자료만 만든다.
 * 호출 순서: plan → econ → ties(type을 tie 요청의 op로). 요청마다 reduce 결과를 확인한다.
 * S·R 불변, DOM·시계·비씨앗 난수 없음. buildGame의 지도 선택은 finally에서 복원한다.
 */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP) return;

  const value = key => KCP.ECON_DATA.params[key].v;
  const clone = x => JSON.parse(JSON.stringify(x));
  const assets = p => ({ builds: clone(p?.builds || []), lines: clone(p?.lines || []) });
  const clampStep = x => Math.max(-1, Math.min(1, Math.round(x || 0)));
  // 아래 수치는 조정 계수가 아닌 기존 프로토콜이다: 선 80칸 이하, 연계선 최소 2 MW.
  const LINE_MAX = 80, TIE_CAP = 2;

  function withMap(bg, R, id, fn) {
    const before = Object.entries(bg.PACKS).find(([, p]) =>
      p._bL?.tiles === bg.TILES || p._b?.tiles === bg.TILES);
    const mode = before?.[1]._bL?.tiles === bg.TILES ? "league" : undefined;
    const oldBLD = bg.BLD, hadPK = Object.hasOwn(bg, "PK");
    try {
      bg.selectPack(R.teams.find(t => t.id === id).pack, "league");
      return fn();
    } finally {
      if (before) bg.selectPack(before[0], mode);
      bg.BLD = oldBLD;
      if (!hadPK) delete bg.PK;
    }
  }

  // 여러 출발점에서 한 번 탐색한다. 선 비용은 지형 계수를 복제하지 않고 capex에서 읽는다.
  function routes(bg, roots) {
    const tiles = bg.TILES, dist = tiles.map(() => Infinity), prev = tiles.map(() => -1);
    const heap = [];
    const push = item => {
      let i = heap.length; heap.push(item);
      while (i) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= item[0]) break;
        heap[i] = heap[p]; i = p;
      }
      heap[i] = item;
    };
    const pop = () => {
      const first = heap[0], last = heap.pop();
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let c = i * 2 + 1;
          if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
          if (heap[c][0] >= last[0]) break;
          heap[i] = heap[c]; i = c;
        }
        heap[i] = last;
      }
      return first;
    };
    roots.forEach(i => { if (tiles[i] && !tiles[i].out) { dist[i] = 0; push([0, i]); } });
    const costs = [];
    while (heap.length) {
      const [d, u] = pop();
      if (d !== dist[u]) continue;
      tiles[u].nb.forEach(v => {
        if (tiles[v].out) return;
        if (costs[v] == null) costs[v] = bg.capex({ builds: [], lines: [{ p: [u, v] }] });
        const next = d + costs[v];
        if (next < dist[v]) { dist[v] = next; prev[v] = u; push([next, v]); }
      });
    }
    return { dist, path: i => {
      if (!Number.isFinite(dist[i])) return null;
      const p = [i];
      while (prev[p[0]] >= 0) p.unshift(prev[p[0]]);
      return p;
    } };
  }
  function addPath(plan, path) {
    // 구간 경계 한 칸을 공유하여 연결성을 유지한다.
    for (let i = 0; i < path.length - 1; i += LINE_MAX - 1)
      plan.lines.push({ p: path.slice(i, i + LINE_MAX) });
  }

  function supply(bg, S, id, plan) {
    const net = bg.network(plan), city = S.econ?.cities[id];
    const growth = city ? Math.max(city.pop / city.pop0, city.ind / city.ind0) : 1;
    const peak = bg.peakDemand({}, false) * growth;
    let firm = 0, renew = 0, storage = 0;
    net.nodes.filter(n => n.live).forEach(n => {
      const b = bg.BLD[n.kind];
      if (n.kind === "import" || n.kind === "town") return;
      if (n.cap) firm += n.cap;
      else if (b?.cls === "disp" && !(n.kind === "smr" && S.round < (S.teams[id].construction?.["smr:" + n.tile]?.readyRound || Infinity))) firm += b.mw;
      else if (b?.cls === "ren") renew += b.mw;
      else if (b?.cls === "bat") storage += b.mw;
    });
    const gates = bg.SITES.filter(s => s.kind === "gridpt" && net.nodes.some(n =>
      n.tile === s.tile && n.comp >= 0 && net.comps.some(c =>
        c.towns.length && c.towns[0].comp === n.comp))).flatMap(s => s.to || []);
    return { peak, firm, renew, storage, gates };
  }

  // 호스트의 승인 순서·예약·연계선 연결 판정을 재사용한다. 원 상태와 지도 선택은 보존한다.
  function gridFor(bg, S, R, id, plan, advance = false) {
    if (!S.econ) return null;
    const existingGrid = S.grid || Object.fromEntries(Object.keys(S.teams).map(key =>
      [key, withMap(bg, R, key, () => KCP.leagueCore.gridStatus(S, R, bg, key))]));
    const draft = { ...S, grid: existingGrid, teams: { ...S.teams, [id]: { ...S.teams[id], plan } } };
    return withMap(bg, R, id, () => KCP.leagueCore.gridStatus(draft, R, bg, id, advance));
  }

  function policy(S, id, style, investment) {
    const c = S.econ?.cities[id], previous = S.teams[id].econPol || c?.policy || {};
    const p = { taxRes: clampStep(previous.taxRes), taxInd: clampStep(previous.taxInd),
      service: clampStep(previous.service), incentive: 0 };
    if (!c) return p;
    // 신중 성향은 재생 여유를 더 요구한다. 기존 연구 문턱·위험 선호 계수만 사용한다.
    if (KCP.TECH_DATA) p.re100 = KCP.leagueCore.techOf(S, id).includes("re100") &&
      (S.results.at(-1)?.team[id]?.renPct || 0) >= KCP.TECH_DATA.params.re100Need.v * (2 - style.risk);
    const stage = KCP.econ.debtStage(c);
    if (stage !== "ok") {
      const name = Object.keys(value("aiStyles")).find(key => value("aiStyles")[key].risk === style.risk) || "balanced";
      p.taxRes = Math.min(2, Math.max(1, (previous.taxRes || 0) + 1));
      p.taxInd = Math.min(2, Math.max(1, (previous.taxInd || 0) + 1));
      p.service = value("aiDebtPolicy")[name][stage];
      return p;
    }
    const active = S.econ.order.map(key => S.econ.cities[key]);
    const change = city => city.approval - (city.approval0 ?? city.approval);
    const relative = change(c) - (active.length > 1 ? active.reduce((s, city) => s + change(city), 0) / active.length : 0);
    const floor = -KCP.ECON_DATA.params.approvalDrop.v;
    const cash = c.cash - investment;
    const reserve = c.pop * KCP.ECON_DATA.params.svcCost.v *
      (value("aiCashReserveMonths") + value("aiSafeCashMonths") * (1 - style.risk));
    if (cash < 0) {
      p.taxRes = p.taxInd = 1; p.service = 0;
    } else if (cash < reserve) {
      p.taxRes = p.taxInd = clampStep(1 - style.risk); p.service = 0;
    } else if (relative <= floor + value("aiApprovalMargin")) {
      p.taxRes = p.taxInd = -1; p.service = 1;
    } else {
      p.taxRes = p.taxInd = clampStep(1 - 2 * style.risk);
      p.service = clampStep(style.risk);
    }
    return p;
  }

  function build(S, R, id, bg, style, plan) {
    const C = KCP.leagueCore, city = S.econ?.cities[id];
    const stage = city ? KCP.econ.debtStage(city) : "ok";
    if (stage === "crisis") return plan;
    const rounds = C.roundsOf(S), turn = Math.max(1, S.round);
    const origin = rounds.slice(0, turn).reduce((a, rd, i) => rd.month === 1 ? i + 1 : a, 1);
    const age = turn - origin - style.delay;
    const annual = age === 0;
    const scheduled = annual || age > 0 && age % value(S.econ ? "aiGridRepairEvery" : "aiRepairEvery") === 0;
    const initial = supply(bg, S, id, plan);
    const safetyTarget = initial.peak * (1 + value("aiSupplyReserve") + value("aiSafeReserve") * (1 - style.risk));
    // 안전 공급은 첫 달·성향 지연과 무관하다. 재생 정격과 빈 저장장치는 보증으로 세지 않는다.
    const unsafe = initial.firm < safetyTarget;
    if (stage === "warn" && !unsafe) return plan;
    if (!unsafe && !scheduled) return plan;
    const funding = C.fundingOf(bg, S, R, id, plan);
    // 건설 후보의 상한에는 전용 몫을 포함하되 실제 승인은 후보마다 공동 판정한다.
    const budget = C.budget(S, id) + funding.grant.awarded, fixed = C.fixedOf(S, R, id) + C.lossOf(S.teams[id].base, plan) + (C.researchReserve ? C.researchReserve(S, id, bg, S.teams[id].plan) : 0);
    const committed = S.teams[id].committed ??
      (S.teams[id].base || []).reduce((sum, x) => sum + x.c, 0) + fixed;
    const extra = Math.max(0, budget - committed) * style.invest * (annual ? 1 : value("aiRepairInvest"));
    const choiceCap = committed + extra - fixed;
    const cap = unsafe ? budget - fixed : choiceCap;
    if (bg.capex(plan) >= cap) return plan;
    const types = Object.keys(bg.BLD).filter(t => ["ren", "disp", "bat"].includes(bg.BLD[t].cls) && (!bg.BLD[t].tech || C.techOf(S, id).includes(bg.BLD[t].tech)));
    const used = new Set(plan.builds.map(b => b.i));
    const legal = Object.fromEntries(types.map(t => [t, bg.TILES.filter(x => !bg.siteRule(t, x)).map(x => x.i)]));
    // 실제 비용과 별도로 입지 민원을 가상 비용으로 비교한다. 계절 AI는 기존 판단을 유지한다.
    const complaintCost = Object.fromEntries(types.map(t => [t, Object.fromEntries(legal[t].map(i =>
      [i, S.econ ? bg.complaints({ builds: [{ t, i }], policies: [], lines: [] }, null).items.reduce((sum, c) => sum + c.pts, 0) * value("aiComplaintCost") : 0]))]));
    const viable = types.filter(t => legal[t].some(i => !used.has(i)));
    if (!viable.length) return plan;
    const reserve = Math.min(...viable.filter(t => bg.BLD[t].cls !== "bat").map(t => bg.BLD[t].cost));
    const start = bg.SITES.find(s => s.kind === "plant") || bg.SITES.find(s => s.dem);
    if (!start) return plan;
    const roots = new Set([start.tile]);
    const existing = bg.network(plan), originNode = existing.nodes.find(n => n.tile === start.tile);
    if (originNode?.comp >= 0) {
      originNode.bf.dist.forEach((_, i) => roots.add(i));
      existing.nodes.filter(n => n.comp === originNode.comp).forEach(n => roots.add(n.tile));
    }
    // 기존 선도 별도 섬일 수 있다. 모든 설비·수요지·연결점을 같은 나무에 차례로 붙인다.
    const targets = new Set([...bg.SITES.map(s => s.tile), ...plan.builds.map(b => b.i)]);
    roots.forEach(i => targets.delete(i));
    while (targets.size) {
      const route = routes(bg, roots);
      const target = Array.from(targets).sort((a, b) => route.dist[a] - route.dist[b] || a - b)[0];
      targets.delete(target);
      const path = route.path(target);
      if (!path) continue;
      const candidate = assets(plan); addPath(candidate, path);
      // 기존 선과 똑같은 구간을 다시 사지 않는다.
      candidate.lines = candidate.lines.filter((line, i, all) =>
        all.findIndex(l => l.p.join(",") === line.p.join(",")) === i);
      if (bg.capex(candidate) <= cap - (plan.builds.length ? 0 : reserve) && C.fundingOf(bg, S, R, id, candidate).ok) {
        plan = candidate; path.forEach(i => roots.add(i));
      }
    }
    // 실제 연결된 선 전체를 출발점으로 쓴다.
    const connected = bg.network(plan);
    const anchor = connected.nodes.find(n => n.tile === start.tile);
    connected.nodes.filter(n => anchor && n.comp === anchor.comp && n.comp >= 0)
      .forEach(n => n.att.forEach(([i]) => roots.add(i)));
    const maxMW = Math.max(...viable.map(t => bg.BLD[t].mw));
    const seed = `${S.seedKey ?? S.room}:${S.round}:${id}`;
    const have = supply(bg, S, id, plan);
    const grid = gridFor(bg, S, R, id, plan);
    const hydroLimit = (grid ? grid.peakMW : bg.peakDemand({}, false)) * value("aiHydroMaxShare");
    let hydroMW = plan.builds.reduce((sum, b) => sum + (b.t === "hydro" ? bg.BLD[b.t].mw : 0), 0);
    // 기존 대기의 미예약 몫부터 처리한다. 같은 달 운영을 마쳤다면 처리량은 다시 주지 않는다.
    const waiting = grid ? grid.waitingMW - grid.reservedMW : 0;
    let gridRoom = grid ? grid.headroomMW - waiting : Infinity;
    // 월 처리량보다 큰 최소 설비도 유한 기간 안에 접속할 수 있다.
    // 기존 미접속이 남으면 새 묶음을 추가하지 않아 대기를 누적시키지 않는다.
    let gridMonth = grid ? (waiting > 1e-8 || grid.round === S.round ? 0 :
      grid.monthlyMW * value("aiConnectionMonths")) : Infinity;
    const reachesDemand = bg.SITES.some(s => s.dem && roots.has(s.tile));
    let route = routes(bg, roots);
    while (used.size < bg.TILES.length) {
      const safety = have.firm < safetyTarget;
      if (stage === "warn" && !safety) break;
      const firmNeed = Math.max(0, safetyTarget + (scheduled ? have.peak * value("aiBoldExpansion") * style.risk : 0) - have.firm);
      const renewReady = scheduled && (!grid || age >= value("aiGridRenewDelay") * style.risk);
      const renewNeed = renewReady ? Math.max(0, have.peak * (value("aiRenewFloor") + value("aiRenewTarget") * (1 - style.risk)) - have.renew) : 0;
      const hydroAllowed = t => !grid || t !== "hydro" || hydroMW + bg.BLD[t].mw <= hydroLimit;
      const nextLimited = viable.filter(t => hydroAllowed(t) && bg.BLD[t].hostLimited && bg.BLD[t].mw <= gridMonth &&
        legal[t].some(i => !used.has(i))).map(t => bg.BLD[t].mw);
      const nextMW = renewNeed > 0 && nextLimited.length ? Math.min(...nextLimited) : 0;
      const hostNeed = grid && value("hostEssMul") > 0 ?
        Math.max(0, nextMW - gridRoom) / value("hostEssMul") : 0;
      const storageNeed = scheduled ? Math.max(hostNeed,
        have.renew * value("aiStorageShare") * (1 - style.risk) - have.storage, 0) : 0;
      if (!safety && (!scheduled || firmNeed + renewNeed + storageNeed <= 0)) break;
      // 공개 가격·수요의 대표 주 급전으로 연료비 차이를 예상한다. 숨은 사건은 제외한다.
      const rd = rounds[turn - 1], publicState = { ...S, events: [] };
      const forecast = p => C.simTeam(bg, R, id, p,
        { ...rd, seed: KCP.econ.hashStr(`${seed}:fuel`) }, Number.MAX_VALUE,
        C.trialMods({ ...publicState, teams: { ...S.teams, [id]: { ...S.teams[id], plan: p } } }, R, id));
      const before = S.econ ? forecast(plan) : null;
      const scoreMonths = Math.min(value("aiFuelMonths"), rounds.length - turn + 1);
      const scoreBefore = S.econ && value("aiScoreValue") > 0 ?
        KCP.econ.projectEnergyScore(S.econ, id, C.planningEnergy(before), scoreMonths).score : 0;
      const fuelWeeks = rounds.slice(turn - 1, turn - 1 + value("aiFuelMonths"))
        .reduce((sum, r) => sum + (r.mdays || r.days) / rd.days, 0);
      const candidates = [], buildBudget = (safety ? cap : choiceCap) - bg.capex(plan);
      viable.forEach(t => {
        const b = bg.BLD[t], battery = b.cls === "bat";
        if (!hydroAllowed(t)) return;
        // 일부 예약 중인 설비의 발전은 0. 전체 정격은 접속 상한과 G 기간의 건설 묶음 안에 둔다.
        if (b.hostLimited && b.mw > Math.min(gridRoom, gridMonth)) return;
        const need = b.cls === "disp" ? firmNeed : b.cls === "ren" ? renewNeed : storageNeed;
        if (need <= 0 || safety && b.cls !== "disp") return;
        let best = null;
        legal[t].forEach(i => {
          if (used.has(i) || !Number.isFinite(route.dist[i])) return;
          const cost = bg.capex({ builds: [{ t, i }], lines: [] }) + route.dist[i];
          if (cost > buildBudget) return;
          const rank = KCP.econ.hashStr(`${seed}:${t}:${i}`);
          const socialCost = (cost + complaintCost[t][i]) / (S.econ && t === "biomass" && bg.TILES[i].livestock ? value("aiLocalFuelWeight") : 1);
          if (!best || socialCost < best.socialCost || socialCost === best.socialCost && rank < best.rank) best = { t, i, cost, socialCost, rank };
        });
        if (!best || bg.capex(plan) + best.cost > (safety ? cap : choiceCap)) return;
        const capacity = Math.min(need, b.mw);
        const trial = assets(plan); trial.builds.push({ t, i: best.i }); addPath(trial, route.path(best.i));
        if (!C.fundingOf(bg, S, R, id, trial).ok) return;
        const after = S.econ ? forecast(trial) : null;
        const fuelDelta = S.econ ? (after.k.fuel - before.k.fuel) * fuelWeeks : 0;
        const scoreDelta = S.econ && value("aiScoreValue") > 0 ?
          KCP.econ.projectEnergyScore(S.econ, id, C.planningEnergy(after), scoreMonths).score - scoreBefore : 0;
        // 입지 선호는 종류 안에서만 사용한다. 종류 간에는 실제 비용과 학생 총점 차이를 비교한다.
        // 절약액이 건설비보다 커도 역전/발산하지 않도록 비용/MW의 음수를 최대화한다.
        const costScore = -(best.cost + fuelDelta - value("aiScoreValue") * scoreDelta) / capacity;
        const large = 1 + style.risk * value("aiLargeWeight") * b.mw / maxMW;
        // 연료 절약으로 순비용이 음수여도 대형 선호의 방향은 뒤집지 않는다.
        best.score = costScore < 0 ? costScore / large : costScore * large;
        best.storage = battery && storageNeed > 0;
        candidates.push(best);
      });
      candidates.sort((a, b) => Number(b.storage) - Number(a.storage) || b.score - a.score || a.rank - b.rank);
      const best = candidates[0];
      if (!best) break;
      const path = route.path(best.i);
      plan.builds.push({ t: best.t, i: best.i }); used.add(best.i);
      const added = bg.BLD[best.t];
      if (best.t === "hydro") hydroMW += added.mw;
      if (grid && added.hostLimited) { gridRoom -= added.mw; gridMonth -= added.mw; }
      if (grid && added.cls === "bat") gridRoom += added.mw * value("hostEssMul");
      const extended = path.some(i => !roots.has(i));
      addPath(plan, path); path.forEach(i => roots.add(i));
      // 나무에 붙인 설비만 더하므로 매 기마다 전체 network를 재계산할 필요가 없다.
      if (reachesDemand) {
        const b = bg.BLD[best.t];
        if (b.cls === "ren") have.renew += b.mw;
        else if (b.cls === "bat") have.storage += b.mw;
        else have.firm += b.mw;
      }
      if (extended) route = routes(bg, roots);
    }
    return plan;
  }

  function ties(S, R, id, bg, style, plan) {
    if (S.econ && KCP.econ.debtStage(S.econ.cities[id]) !== "ok") return S.ties
      .filter(t => t.st === "prop" && [t.a, t.b].includes(id) && t.by !== id)
      .map(t => ({ type: "cancel", other: t.by, cap: t.cap, kind: t.kind }));
    const C = KCP.leagueCore, own = supply(bg, S, id, plan), actions = [];
    let tieReserved = 0;
    const pending = R.ties.filter(t => t.a === id || t.b === id);
    let sims, prices, accepted = S.ties.filter(t => t.st === "built").map(t => C.effectiveTie(S, t));
    // 공개 계획·수요·연료 가격으로 대표 주를 예상한다. 사건의 숨은 실현값은 읽지 않는다.
    const rd = C.roundsOf(S)[Math.max(0, S.round - 1)];
    const preview = () => {
      if (sims) return;
      sims = {}; prices = {};
      for (const key of Object.keys(S.teams)) {
        const p = key === id ? plan : assets(S.teams[key].plan);
        const grid = gridFor(bg, S, R, key, p, true);
        // 이번 달 접속 뒤의 발전·ESS 상한만 예상한다. 비공개 사건 실현값은 제외한다.
        const mods = S.econ ? withMap(bg, R, key, () => C.modsFor({ ...S, events: [],
          grid: { ...S.grid, [key]: grid } }, R, key)) : {};
        sims[key] = withMap(bg, R, key, () => C.simTeam(bg, R, key, p,
          { ...rd, seed: KCP.econ.hashStr(`${S.seedKey ?? S.room}:${S.round}:trade`) },
          Math.max(C.budget(S, key), bg.capex(p)), mods));
        prices[key] = S.teams[key].price;
      }
    };
    for (const def of pending) {
      const other = def.a === id ? def.b : def.a;
      if (!S.teams[other]) continue;
      const existing = S.ties.find(t => t.a === def.a && t.b === def.b);
      if (existing?.st === "built") continue;
      const incoming = existing?.st === "prop" && existing.by !== id;
      // 성향과 무관하게 미제안 후보를 평가한다. 자기 제안의 중복 예약만 막는다.
      if (!incoming && existing) continue;
      const kind = incoming ? existing.kind : C.techOf(S, id).includes("hvdc") ? "hvdc" : def.kind;
      const cap = existing?.cap || TIE_CAP, half = C.tieCost(R, { ...def, cap, kind }) / 2;
      const theirs = assets(S.teams[other].plan);
      const neighbor = withMap(bg, R, other, () => supply(bg, S, other, theirs));
      const eligible = own.gates.includes(other) && neighbor.gates.includes(id) &&
        C.fundingOf(bg, S, R, id, plan, { kind: "tie", extra: tieReserved + half }).ok &&
        C.fundingOf(bg, S, R, other, S.teams[other].plan || theirs, { kind: "tie", extra: half }).ok;
      let worthwhile = false;
      const candidate = C.effectiveTie(S, { ...def, cap, kind });
      if (eligible) {
        preview();
        const before = C.settle(accepted, sims, prices, sims[id].H, rd.days);
        const after = C.settle([...accepted, candidate], sims, prices, sims[id].H, rd.days);
        const horizon = C.roundsOf(S).slice(Math.max(0, S.round - 1), Math.max(0, S.round - 1) + value("aiTieMonths"));
        const weeks = horizon.reduce((sum, r) => sum + (r.mdays || r.days) / rd.days, 0);
        const worth = key => {
          const net = t => t.earn - t.pay - t.fuelX + t.saveFuel +
            t.del.reduce((sum, mw) => sum + mw, 0) * (value("aiVollMul") * value("normalCost"));
          const cash = (net(after.out[key]) - net(before.out[key])) * weeks;
          if (!S.econ || value("aiScoreValue") <= 0) return cash;
          const energy = settled => {
            const s = sims[key], o = settled.out[key];
            // 거래 뒤 남은 부족은 설비 평가와 같은 계통 보충·소비 배출로 환산한다.
            const delivered = o.del.reduce((sum, mw) => sum + mw, 0);
            return C.planningEnergy({ ...s,
              uns: Array.from(s.uns, (u, i) => Math.max(0, u - o.del[i])),
              k: { ...s.k, uns: Math.max(0, s.k.uns - delivered), co2: s.k.co2 - o.saveCo2 + o.co2In } });
          };
          const scoreDelta = KCP.econ.projectEnergyScore(S.econ, key, energy(after), horizon.length).score -
            KCP.econ.projectEnergyScore(S.econ, key, energy(before), horizon.length).score;
          return cash + value("aiScoreValue") * scoreDelta;
        };
        worthwhile = worth(id) > half && (incoming || worth(other) > half);
      }
      if (incoming) actions.push({ type: worthwhile ? "accept" : "cancel", other, cap, kind });
      else if (worthwhile) actions.push({ type: "propose", other, cap, kind });
      if (worthwhile) { tieReserved += half; accepted.push(candidate); }
    }
    return actions;
  }

  // 연구도 공개 규칙 안에서 고른다. 운영 가능한 공급을 먼저 확보한 뒤 인력을 짓는다.
  function research(S, R, id, bg, styleName, style, plan) {
    if (!KCP.TECH_DATA) return plan;
    if (S.econ && KCP.econ.debtStage(S.econ.cities[id]) !== "ok") { plan.rq = []; return plan; }
    const D = KCP.TECH_DATA, C = KCP.leagueCore, rs = C.researchView(S, id), p = k => D.params[k].v;
    plan.rq = rs.queue.filter(key => rs.stage[key] !== "done");
    const pending = plan.rq[0];
    const order = p("aiOrder")[styleName] || p("aiOrder").balanced;
    const card = pending || order.find(key => !rs.stage[key] && !rs.adopted.includes(key) && !C.researchError(S, id, [key], bg));
    if (!card) return plan;
    const have = supply(bg, S, id, plan);
    if (have.firm < have.peak) return plan;
    const rounds = C.roundsOf(S), turn = Math.max(1, S.round);
    const origin = rounds.slice(0, turn).reduce((a, rd, i) => rd.month === 1 ? i + 1 : a, 1);
    const age = turn - origin - style.delay, annual = age === 0;
    if (age < 0 || !annual && age % value(S.econ ? "aiGridRepairEvery" : "aiRepairEvery") !== 0) return plan;
    if (style.risk === 0 && have.renew < have.peak * (value("aiRenewFloor") + value("aiRenewTarget"))) return plan;
    const labCost = bg.RS.labOpexR * p("aiLabs") * p("aiResearchReserve");
    const demoReserve = C.researchReserve(S, id, bg, { ...plan, rq: [card] });
    const fixed = C.fixedOf(S, R, id) + C.lossOf(S.teams[id].base, plan);
    const committed = S.teams[id].committed ?? (S.teams[id].base || []).reduce((a, x) => a + x.c, 0) + fixed;
    const funding = C.fundingOf(bg, S, R, id, plan), constructionBudget = C.budget(S, id) + funding.grant.awarded;
    const extra = Math.max(0, constructionBudget - committed) * style.invest * (annual ? 1 : value("aiRepairInvest"));
    const researchBudget = constructionBudget - (S.econ?.cities[id].debtCap || 0) * (1 - value("aiResearchDebtShare"));
    const limit = Math.min(committed + extra, researchBudget) - fixed - demoReserve - labCost;
    for (const [kind, count] of [["lab", p("aiLabs")], ["uni", p("aiUnis")]]) {
      if (plan.builds.filter(b => b.t === kind).length >= count) continue;
      const tile = bg.TILES.find(t => !plan.builds.some(b => b.i === t.i) && !bg.siteRule(kind, t));
      if (!tile) continue;
      const candidate = { ...plan, builds: [...plan.builds, { t: kind, i: tile.i }] };
      if (bg.capex(candidate) <= limit && C.fundingOf(bg, S, R, id, { ...candidate, rq: [card] }, { kind: "research" }).ok) plan = candidate;
    }
    if (plan.builds.some(b => b.t === "lab") && bg.capex(plan) <= limit &&
      C.fundingOf(bg, S, R, id, { ...plan, rq: [card] }, { kind: "research" }).ok) plan.rq = [card];
    if (rs.adopted.includes("vpp")) plan.policies = [...new Set([...(plan.policies || []), "dr"])].slice(0, 2);
    return plan;
  }

  function plan(S, R, id, bg, style) {
    if (!S.teams[id] || !R.teams.some(t => t.id === id)) throw new Error("AI: 참가 도시가 아닙니다");
    const styles = value("aiStyles"), selected = typeof style === "string" ? styles[style] : style;
    const chosen = selected || styles.balanced;
    if (!(chosen.invest >= 0 && chosen.invest <= 1 && chosen.risk >= 0 && chosen.risk <= 1 &&
      Number.isInteger(chosen.delay) && chosen.delay >= 0)) throw new Error("AI: 성향 값 범위를 확인하세요");
    return withMap(bg, R, id, () => {
      const original = assets(S.teams[id].plan);
      const constructed = build(S, R, id, bg, chosen, original);
      const styleName = Object.keys(styles).find(key => styles[key].risk === chosen.risk) || "balanced";
      const result = research(S, R, id, bg, styleName, chosen, constructed);
      // 공급 보강으로 실증 예약금까지 썼다면 연구를 대기한다. 진척은 호스트에 남는다.
      const C = KCP.leagueCore;
      if (KCP.TECH_DATA && !C.fundingOf(bg, S, R, id, result).ok && C.researchReserve(S, id, bg, result) > 0) result.rq = [];
      return { plan: result, econPol: policy(S, id, chosen, Math.max(0, bg.capex(result) - (S.teams[id].committed || 0))), ties: ties(S, R, id, bg, chosen, result) };
    });
  }
  KCP.leagueAI = { plan, get STYLES() { return clone(value("aiStyles")); } };
})();
