"""독립 전략 봇과 리그 계약 검사. 브라우저 실행은 로컬 총괄 담당."""
import argparse
import ast
import json
import math
import os
import subprocess
import statistics
from pathlib import Path
from urllib.parse import urlsplit

# AST로 이 문자열을 추출해 node --check할 수 있다. 화면 클릭을 쓰지 않는다.
JS = r"""
({months, rotations}) => {
  const C = KCP.leagueCore, BG = KCP.buildGame, X = KCP.econ;
  const R = C.regionOf("south"), ids = R.teams.map(t => t.id);
  const strategies = ["nothing", "base", "diesel", "renew", "ties", "taxlow", "taxhigh", "dm", "storage"];
  const hasAI = typeof KCP.leagueAI?.plan === "function";
  const out = {checks: [], runs: [], strategies, ids,
    names: Object.fromEntries(R.teams.map(t => [t.id, t.name])), months, rotations,
    planner: hasAI ? "leagueAI balanced" : "legacy fallback (leagueAI 없음)"};
  const finite = Number.isFinite, clone = x => JSON.parse(JSON.stringify(x));
  const sum = xs => xs.reduce((a, b) => a + b, 0);
  const ok = (c, m) => out.checks.push([!!c, m]);
  const test = (label, fn) => { try { fn(); } catch (e) { ok(false, `${label}: ${e.message}`); } };
  const token = id => `bot-token-${id}`;
  const req = (S, id, msg, at) => C.reduce(S, Object.assign({team: id, token: token(id)}, msg), at, BG);
  const claim = S => ids.forEach(id => {
    const r = req(S, id, {type: "claim"}, 1);
    ok(r?.ok === true, `claim ${id}: ${JSON.stringify(r)}`);
  });
  const empty = () => ({builds: [], lines: [], policies: [], missions: [], shed: "home", fab2: false});
  const newGame = room => C.newState(room, "south", 0, ids, {turns: 36});
  ok(ids.length === 6 && strategies.length === 9, `south 팀 ${ids.length}, 전략 ${strategies.length}`);

  // B9: 방 이름 200개 × 12달. drawEvents는 상태에 사건 이력을 남기므로 같은 S를 이어 쓴다.
  test("B9 달 사건 표본", () => {
    let count = 0, two = 0, repeats = 0, invalid = 0;
    const histogram = {};
    for (let room = 0; room < 200; room++) {
      const S = C.newState(`bots-events-${room}`, "south", 0, ids, {turns: 12});
      let prev = [];
      for (let m = 1; m <= 12; m++) {
        S.round = m; S.phase = "plan"; C.drawEvents(S, R);
        const ev = S.events.filter(e => e.round === m && e.id !== "finedust_coal_cap").map(e => e.id);
        count += ev.length; if (ev.length >= 2) two++;
        if (ev.length > 1) invalid++;
        repeats += ev.filter(id => prev.includes(id)).length;
        ev.forEach(id => { histogram[id] = (histogram[id] || 0) + 1; }); prev = ev;
      }
    }
    const n = 200 * 12, mean = count / n;
    ok(invalid === 0, `B9 달 사건 0/1개: 위반 ${invalid}/${n}`);
    ok(mean >= 0.4 && mean <= 0.6, `B9 달 사건 평균 ${mean.toFixed(4)} (목표 0.4~0.6)`);
    ok(two / n <= 0.1, `B9 두 개 이상 비율 ${(two / n * 100).toFixed(3)}% (목표 ≤10%)`);
    ok(repeats === 0, `B9 다음 달 같은 사건 ${repeats}개 (목표 0)`);
    out.monthEvents = {n, mean, two, repeats, invalid, histogram};
  });
  test("B9 계절 분포 참고", () => {
    let count = 0;
    for (let room = 0; room < 200; room++) {
      const S = C.newState(`bots-season-${room}`, "south", 0, ids);
      for (let m = 1; m <= 4; m++) {
        S.round = m; C.drawEvents(S, R);
        count += S.events.filter(e => e.round === m).length;
      }
    }
    const mean = count / 800;
    // '1.2 안팎'을 1.0~1.6으로 해석. 기존 1개+40% 두 개 분포도 유지 대상으로 포함.
    ok(mean >= 1 && mean <= 1.6, `B9 계절 사건 참고 평균 ${mean.toFixed(4)} (1.0~1.6)`);
    out.seasonEvents = {n: 800, mean};
  });

  // 건설 가능 종류·타일은 매번 해당 지도 BLD/siteRule/TILES에서 읽는다.
  const legalBuild = (id, type) => {
    BG.selectPack(id, "league");
    if (!BG.BLD[type]) return null;
    const tile = BG.TILES.find(t => !BG.siteRule(type, t));
    return tile ? {t: type, i: tile.i ?? BG.TILES.indexOf(tile)} : null;
  };
  test("B7 예산과 한도 아래 건설 금지", () => {
    const S = newGame("bots-budget"); claim(S); C.host(S, "next", 100);
    ids.forEach(id => {
      const city = S.econ?.cities?.[id], T = S.teams[id];
      ok(finite(city?.cash) && finite(city?.debtCap), `B7 ${id} cash/debtCap 계약`);
      if (!city) return;
      const before = city.cash;
      city.cash = -city.debtCap * 0.5;
      const expected = city.cash + city.debtCap + (T.committed || 0) + (T.tieAt || 0)
        - C.tieShare(S, R, id) + C.bonusOf(S, R, id, S.round);
      const actual = C.budget(S, id);
      ok(finite(expected) && finite(actual) && Math.abs(actual - expected) < 0.011,
        `B7 ${id} budget=${actual}, cash+debtCap 등=${expected}`);
      const cashBudget = actual; city.cash += 1;
      ok(Math.abs(C.budget(S, id) - cashBudget - 1) < 0.011, `B7 ${id} 현금+1 → budget+1`);
      city.cash = -city.debtCap - 1;
      BG.selectPack(id, "league");
      const type = Object.keys(BG.BLD).find(k => BG.TILES.some(t => !BG.siteRule(k, t)));
      const build = type && legalBuild(id, type);
      ok(!!build, `B7 ${id} 건설 가능한 검사 설비 존재`);
      if (build) {
        const old = JSON.stringify(T.plan), r = req(S, id,
          {type: "plan", rev: T.rev + 1, plan: Object.assign(empty(), {builds: [build]})}, 101);
        ok(r?.ok === false && JSON.stringify(T.plan) === old,
          `B7 ${id} cash<-debtCap 새 계획 거부 ${JSON.stringify(r)}`);
      }
      city.cash = before;
    });
  });

  // B10 지원금·철거를 실제 호스트 경로에서 강제로 일으키는 별도 12달 장치.
  // 전략 결과에는 이 인위적인 사건을 섞지 않는다.
  test("B10 지원금·철거 현금 연결", () => {
    const S = C.newState("bots-cash-probe", "south", 0, ids, {turns: 12}); claim(S);
    const target = ids[0];
    const bonusDef = (R.events || []).find(e => finite(e.effect?.budgetAdd) && e.effect.budgetAdd > 0 &&
      ids.some(id => C.hits(R, e, id)));
    ok(!!bonusDef, "B10 budgetAdd 검사 사건 존재");
    let prior = null, sawSalvage = false, sawBonus = false, expectedSalvage = 0;
    for (let m = 1; m <= 12; m++) {
      C.host(S, "next", m * 1000);
      S.events = S.events.filter(e => e.round !== S.round);
      if (m === 2 && bonusDef) S.events.push({id: bonusDef.id, round: S.round, x: 1});
      if (m === 1) {
        BG.selectPack(target, "league");
        const type = Object.keys(BG.BLD).find(k => BG.TILES.some(t => !BG.siteRule(k, t)));
        const build = type && legalBuild(target, type);
        const r = build && req(S, target, {type: "plan", rev: S.teams[target].rev + 1,
          plan: Object.assign(empty(), {builds: [build]})}, m * 1000 + 1);
        ok(r?.ok === true && S.teams[target].plan?.builds?.length === 1,
          `B10 철거용 첫 달 건설 ${JSON.stringify(r)}`);
      }
      if (m === 2) {
        expectedSalvage = sum((S.teams[target].base || []).map(x => x.c)) * C.SALV;
        const r = req(S, target, {type: "plan", rev: S.teams[target].rev + 1, plan: empty()}, m * 1000 + 1);
        ok(r?.ok === true, `B10 둘째 달 철거 ${JSON.stringify(r)}`);
      }
      const res = C.run(S, BG, m * 1000 + 50), rep = res?.econ;
      ok(!!rep?.fiscal, `B10 강제 장치 ${m}달 fiscal 존재`);
      ids.forEach(id => {
        const f = rep?.fiscal?.[id], city = S.econ?.cities?.[id];
        if (prior) ok(finite(f?.cashBefore) && finite(prior[id]?.cashAfter) &&
          Math.abs(prior[id].cashAfter - f.cashBefore) < 1e-6,
          `B10 장치 ${id} ${m - 1}→${m}달 ${prior[id]?.cashAfter} == ${f?.cashBefore}`);
        ok(finite(f?.cashAfter) && finite(city?.cash) && Math.abs(f.cashAfter - city.cash) < 1e-6,
          `B10 장치 ${id} ${m}달 보고=${f?.cashAfter}, 상태=${city?.cash}`);
        if (m === 2) {
          const bonus = C.bonusOf(S, R, id, S.round);
          ok(finite(f?.eventBonus) && Math.abs(f.eventBonus - bonus) < 0.011,
            `B9/B10 ${id} eventBonus=${f?.eventBonus}, 사건=${bonus}`);
          if (bonus > 0 && f?.eventBonus > 0) sawBonus = true;
          if (id === target) {
            // B10은 fiscal에 회수 줄을 요구한다. rev.salvage와 기존 salvage 보고를 모두 허용한다.
            const salvage = f?.rev?.salvage ?? f?.salvage;
            ok(finite(salvage) && salvage > 0 && Math.abs(salvage - expectedSalvage) < 0.011,
              `B10 ${id} 철거 회수 줄 salvage=${salvage}, 목표=${expectedSalvage}`);
            sawSalvage = finite(salvage) && salvage > 0;
          }
        }
      });
      prior = rep?.fiscal || null;
    }
    ok(sawBonus, "B10 양수 사건 지원금 실제 발생·보고");
    ok(sawSalvage, "B10 양수 철거 회수 실제 발생·보고");
  });

  const legacyPlan = (S, id, strategy) => {
    if (strategy === "nothing") return empty();
    BG.selectPack(id, "league");
    const old = S.teams[id].plan, plan = old ? clone(old) : __auto(id);
    const cap = C.budget(S, id);
    if (strategy !== "diesel" && strategy !== "renew") return plan;
    // 발전 종류는 BLD의 키와 분류에서 읽고, 해당 도시 자리 규칙으로 거른다.
    const types = strategy === "diesel" ? Object.keys(BG.BLD).filter(k => k === "diesel") :
      Object.keys(BG.BLD).filter(k => (BG.BLD[k].cls === "ren" && ["solar", "roof", "wind", "offshore"].includes(k)) || BG.BLD[k].cls === "bat");
    const connected = new Set(plan.lines.flatMap(l => l.p));
    if (!connected.size && BG.SITES[0]) connected.add(BG.SITES[0].tile);
    const used = new Set(plan.builds.map(b => b.i));
    const denied = new Set(); let cursor = 0;
    // 한 자리당 한 설비. 최소거리 연결을 포함한 실제 spendOf가 예산 이내인 후보만 채택.
    for (let attempt = 0; attempt < BG.TILES.length * Math.max(1, types.length); attempt++) {
      if (!types.length) break;
      const type = types[cursor++ % types.length];
      const candidates = BG.TILES.map((t, i) => ({t, i})).filter(({t, i}) => !used.has(i) &&
        !denied.has(`${type}:${i}`) && !BG.siteRule(type, t));
      if (!candidates.length) {
        if (types.every(k => !BG.TILES.some((t, i) => !used.has(i) && !denied.has(`${k}:${i}`) && !BG.siteRule(k, t)))) break;
        continue;
      }
      const distance = i => Math.min(...Array.from(connected, j => Math.hypot(BG.TILES[i].X - BG.TILES[j].X, BG.TILES[i].Y - BG.TILES[j].Y)));
      candidates.sort((a, b) => distance(a.i) - distance(b.i) || a.i - b.i);
      const i = candidates[0].i;
      const near = Array.from(connected).sort((a, b) => Math.hypot(BG.TILES[i].X - BG.TILES[a].X, BG.TILES[i].Y - BG.TILES[a].Y) -
        Math.hypot(BG.TILES[i].X - BG.TILES[b].X, BG.TILES[i].Y - BG.TILES[b].Y))[0];
      const route = connected.has(i) ? null : BG.routePath(near, i);
      if (!connected.has(i) && !route) { denied.add(`${type}:${i}`); continue; }
      const candidate = clone(plan); candidate.builds.push({t: type, i});
      if (route) candidate.lines.push({p: route});
      if (C.spendOf(BG, S, R, id, candidate) <= cap + 1e-6) {
        plan.builds = candidate.builds; plan.lines = candidate.lines;
        used.add(i); if (route) route.forEach(j => connected.add(j));
      } else denied.add(`${type}:${i}`);
      // 남은 돈이 어떤 설비의 기본값보다도 적으면 연결 후보를 더 찾을 이유가 없다.
      if (cap - C.spendOf(BG, S, R, id, plan) < Math.min(...types.map(k => BG.BLD[k].cost))) break;
    }
    return plan;
  };
  const assets = plan => ({builds: clone(plan?.builds || []), lines: clone(plan?.lines || [])});
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const select = id => BG.selectPack(R.teams.find(t => t.id === id).pack, "league");
  const fossil = type => ["diesel", "lng", "coal"].includes(type) && BG.BLD[type]?.cls === "disp";
  const variableMW = plan => sum((plan?.builds || []).filter(b => BG.BLD[b.t]?.variable).map(b => BG.BLD[b.t].mw));
  const essMW = plan => sum((plan?.builds || []).filter(b => BG.BLD[b.t]?.cls === "bat").map(b => BG.BLD[b.t].mw));
  // 공개 headroom은 접속 예약 뒤 남은 값이다. 기존 대기의 미예약 몫과 AI의 새 설비도 차감한다.
  // B18 계약: ESS 1MW는 접속 여유 1MW를 더한다. 이미 있던 ESS를 다시 더하지 않는다.
  const hostingRoom = (S, id, plan) => {
    const g = S.grid?.[id], old = S.teams[id].plan;
    if (![g?.headroomMW, g?.connectedMW, g?.reservedMW].every(finite)) return null;
    return g.headroomMW + g.connectedMW + g.reservedMW - variableMW(plan) + essMW(plan) - essMW(old);
  };
  const forecastGrid = (S, id, plan) => {
    try {
      return C.gridStatus({...S, teams: {...S.teams, [id]: {...S.teams[id], plan}}}, R, BG, id, true);
    } finally { select(id); } // 연계선 양 끝 도시를 검사한 뒤 전환 대상 지도로 복원한다.
  };
  // 선 길이 80칸은 기존 sanitize 프로토콜이다. 구간 경계 한 칸을 공유한다.
  const addRoute = (plan, path) => {
    for (let i = 0; i < path.length - 1; i += 79) plan.lines.push({p: path.slice(i, i + 80)});
  };
  // AI의 연결선을 유지하고 가장 싼 합법 자리·연결 경로부터 찾는다.
  const placeTypes = (plan, types) => {
    const candidate = assets(plan), used = new Set(candidate.builds.map(b => b.i));
    const connected = new Set(candidate.lines.flatMap(l => l.p));
    BG.network(candidate).nodes.filter(n => n.live).forEach(n => connected.add(n.tile));
    if (!connected.size) return null;
    for (const type of types) {
      let best = null;
      for (const tile of BG.TILES.filter(t => !used.has(t.i) && !BG.siteRule(type, t))) {
        const near = Array.from(connected).sort((a, b) =>
          Math.hypot(tile.X - BG.TILES[a].X, tile.Y - BG.TILES[a].Y) -
          Math.hypot(tile.X - BG.TILES[b].X, tile.Y - BG.TILES[b].Y) || a - b)[0];
        const path = connected.has(tile.i) ? [tile.i] : BG.routePath(near, tile.i);
        if (!path) continue;
        const extra = {builds: [{t: type, i: tile.i}], lines: []}; addRoute(extra, path);
        const cost = BG.capex(extra);
        if (!best || cost < best.cost || cost === best.cost && tile.i < best.i)
          best = {i: tile.i, path, cost};
      }
      if (!best) return null;
      candidate.builds.push({t: type, i: best.i}); used.add(best.i);
      addRoute(candidate, best.path); best.path.forEach(i => connected.add(i));
    }
    return candidate;
  };
  // ESS는 발전원이 아니다. 연결된 확정 공급을 먼저 남겨 피크 수요를 확보한다.
  // ECON-SPEC §12.1의 AI 공급 원칙과 동일한 공개 G 계수를 사용한다.
  const firmSupply = (S, id, plan) => {
    const city = S.econ.cities[id], params = KCP.ECON_DATA.params;
    const growth = Math.max(city.pop / city.pop0, city.ind / city.ind0);
    const target = BG.peakDemand({}, false) * growth * (1 + params.aiSupplyReserve.v +
      params.aiSafeReserve.v * (1 - params.aiStyles.v.balanced.risk));
    const firm = sum(BG.network(plan).nodes.filter(n => n.live && !["import", "town"].includes(n.kind))
      .map(n => n.cap || (BG.BLD[n.kind]?.cls === "disp" && n.kind !== "smr" ? BG.BLD[n.kind].mw : 0)));
    return {firm, target};
  };
  const storagePlan = (S, id, original) => {
    select(id);
    let plan = assets(original);
    const changes = [], supply = firmSupply(S, id, plan), city = S.econ.cities[id];
    if (city.cash < -city.debtCap || supply.firm < supply.target) return {plan, changes};
    // 저장 전략은 기존 AI의 재생 목표(신중 기준)까지 태양광을 매달 한 묶음씩 투자한다.
    // 공급·실제 예산은 유지하며 접속 여유가 부족하면 ESS를 같은 묶음으로 확보한다.
    const renewableTarget = BG.peakDemand({}, false) *
      (KCP.ECON_DATA.params.aiRenewFloor.v + KCP.ECON_DATA.params.aiRenewTarget.v);
    if (variableMW(plan) < renewableTarget && forecastGrid(S, id, plan).waitingMW <= 1e-6) {
      let candidate = placeTypes(plan, ["solar"]);
      if (candidate && hostingRoom(S, id, candidate) < 0) candidate = placeTypes(plan, ["solar", "battery"]);
      if (candidate && hostingRoom(S, id, candidate) >= 0 &&
          C.spendOf(BG, S, R, id, candidate) <= C.budget(S, id) + 1e-6) {
        const added = candidate.builds.filter(b => BG.BLD[b.t].cls === "bat" && !plan.builds.some(x => x.i === b.i));
        if (added.length) changes.push({removed: [], added: added.map(b => b.t), mw: 0, addedMW: 0,
          storageMW: sum(added.map(b => BG.BLD[b.t].mw)), storageKeys: added.map(b => b.t + ":" + b.i),
          chargeSourceMWh: 0, capturedMWh: 0});
        plan = candidate;
      }
    }
    const spill = candidate => {
      const draft = {...S, teams: {...S.teams, [id]: {...S.teams[id], plan: candidate}}};
      const forecast = C.simTeam(BG, R, id, candidate,
        {...C.roundsOf(S)[S.round - 1], seed: X.hashStr(`${S.room}:${S.round}:storage`)},
        C.budget(S, id), C.trialMods(draft, R, id));
      select(id);
      // build.simulate의 C.RB는 출력제어분도 기존 ESS에 먼저 넣고 잔여 g.cut만
      // curtailMWh로 기록한다. 그 버린 양은 새 ESS를 추가할 때 포착 가능한 충전원이다.
      return forecast.k.curt + (forecast.curtailMWh || 0);
    };
    const types = Object.keys(BG.BLD).filter(t => BG.BLD[t].cls === "bat" &&
      (!BG.BLD[t].tech || C.techOf(S, id).includes(BG.BLD[t].tech)))
      .sort((a, b) => BG.BLD[a].cost / BG.BLD[a].mw - BG.BLD[b].cost / BG.BLD[b].mw);
    let available = spill(plan);
    while (available > 1e-6) {
      let next = null, nextSpill = available, chosen = null;
      for (const type of types) {
        const candidate = placeTypes(plan, [type]);
        if (!candidate || C.spendOf(BG, S, R, id, candidate) > C.budget(S, id) + 1e-6) continue;
        const clean = C.cleanPlan(BG, R, id, candidate,
          C.budget(S, id) - C.fixedOf(S, R, id) - C.lossOf(S.teams[id].base, candidate));
        select(id);
        if (!same(candidate, assets(clean))) continue;
        const remaining = spill(candidate);
        // 실제 시간별 모형에서 버림이 줄어야 충전 가능한 추가 저장으로 인정한다.
        if (available - remaining <= 1e-6) continue;
        next = candidate; nextSpill = remaining; chosen = type; break;
      }
      if (!next) break;
      const capturedMWh = available - nextSpill;
      ok(capturedMWh > 0 && firmSupply(S, id, next).firm >= supply.target,
        `B18 storage ${id} ${S.round}달 확정 공급 유지·추가 저장으로 버림 ${capturedMWh}MWh 감소`);
      changes.push({removed: [], added: [chosen], mw: 0, addedMW: 0,
        storageMW: BG.BLD[chosen].mw, chargeSourceMWh: available, capturedMWh});
      plan = next; available = nextSpill;
    }
    return {plan, changes};
  };
  const transform = (S, id, strategy, original) => {
    select(id);
    const city = S.econ?.cities?.[id], changes = [];
    if (city && city.cash < -city.debtCap) return {plan: original, changes};
    const prior = new Set((S.teams[id].plan?.builds || []).map(b => C.itemKey("b", b)));
    // 이미 운영한 설비는 유지한다. AI가 이번 달 새로 제안한 설비만 전환한다.
    const sources = original.builds.filter(b => !prior.has(C.itemKey("b", b)) &&
      (strategy === "diesel" ? (["ren", "bat"].includes(BG.BLD[b.t]?.cls) || b.t === "biomass") : fossil(b.t)));
    const legalTypes = cls => Object.keys(BG.BLD).filter(t => BG.BLD[t].cls === cls &&
      BG.BLD[t].mw > 0 && BG.TILES.some(tile => !BG.siteRule(t, tile)));
    const dispatch = legalTypes("disp").filter(fossil).sort((a, b) =>
      Number(b === "diesel") - Number(a === "diesel") || BG.BLD[a].cost / BG.BLD[a].mw - BG.BLD[b].cost / BG.BLD[b].mw);
    const renew = legalTypes("ren"), storage = legalTypes("bat");
    let plan = assets(original), pending = [];
    for (const source of sources) {
      pending.push(source);
      const mw = sum(pending.map(b => BG.BLD[b.t].mw)), recipes = [];
      if (strategy === "diesel") {
        // 정격 MW가 정확히 같은 묶음만 전환한다. 2 MW→3 MW 증설은 하지 않는다.
        for (const t of dispatch) {
          const count = Math.round(mw / BG.BLD[t].mw);
          if (count > 0 && Math.abs(count * BG.BLD[t].mw - mw) < 1e-6)
            recipes.push(Array(count).fill(t));
        }
      } else {
        // 설비는 쪼갤 수 없으므로 원 화력 MW 이상인 최소 기수의 재생+저장을 묶는다.
        for (const r of renew) for (const b of storage) {
          const room = hostingRoom(S, id, plan);
          if (room === null) continue; // 공개 접속 계약을 확인할 수 없으면 원 계획 유지.
          const count = Math.ceil(mw / BG.BLD[r].mw);
          const variable = BG.BLD[r].variable ? count * BG.BLD[r].mw : 0;
          const batteries = Math.max(Math.ceil(mw / BG.BLD[b].mw),
            Math.ceil(Math.max(0, variable - room) / BG.BLD[b].mw));
          // 여유를 만드는 ESS 자리를 먼저 확보한다. 모자란 H만큼은 저장 기수를 늘린다.
          recipes.push([...Array(batteries).fill(b), ...Array(count).fill(r)]);
        }
        recipes.sort((a, b) => sum(a.map(t => BG.BLD[t].cost)) - sum(b.map(t => BG.BLD[t].cost)));
      }
      const removed = new Set(pending.map(b => C.itemKey("b", b)));
      const kept = assets(plan); kept.builds = kept.builds.filter(b => !removed.has(C.itemKey("b", b)));
      let replacement = null, recipe = null;
      for (const types of recipes) {
        if (types.length > BG.TILES.length - kept.builds.length) continue;
        const trial = placeTypes(kept, types);
        if (!trial || C.spendOf(BG, S, R, id, trial) > C.budget(S, id) + 1e-6) continue;
        if (strategy === "renew") {
          if (hostingRoom(S, id, trial) < -1e-6) continue;
          // H를 늘려도 월별 접속 처리량은 늘지 않는다. 이번 달 전량 접속할 수 있는 설비만 전환한다.
          // 기존 대기와 AI가 제안한 다른 변동 재생까지 같은 순서로 처리한 실제 엔진 경로를 확인한다.
          const grid = forecastGrid(S, id, trial);
          const added = trial.builds.slice(kept.builds.length).filter(b => BG.BLD[b.t].variable);
          if (!grid || variableMW(trial) > grid.hostMW + 1e-6 ||
            added.some(b => !grid.entries.some(e => e.key === `${b.t}:${b.i}` && e.allocatedMW >= e.mw))) continue;
        }
        const clean = C.cleanPlan(BG, R, id, trial,
          C.budget(S, id) - C.fixedOf(S, R, id) - C.lossOf(S.teams[id].base, trial));
        select(id);
        if (!same(trial, assets(clean))) continue;
        replacement = trial; recipe = types; break;
      }
      if (replacement) {
        const addedMW = sum(recipe.filter(t => BG.BLD[t].cls !== "bat").map(t => BG.BLD[t].mw));
        const storageMW = sum(recipe.filter(t => BG.BLD[t].cls === "bat").map(t => BG.BLD[t].mw));
        ok(strategy === "diesel" ? Math.abs(addedMW - mw) < 1e-6 : addedMW >= mw && storageMW >= mw,
          `${strategy} ${id} ${S.round}달 전환 ${mw}MW → 발전${addedMW}/저장${storageMW}MW`);
        changes.push({removed: clone(pending), added: recipe, mw, addedMW, storageMW});
        if (strategy === "renew") {
          const grid = forecastGrid(S, id, replacement);
          const room = hostingRoom(S, id, replacement);
          ok(room >= -1e-6 && variableMW(replacement) <= grid.hostMW + 1e-6,
            `B18 renew ${id} ${S.round}달 접속 상한: 변동${variableMW(replacement)}/H${grid.hostMW}MW`);
          Object.assign(changes[changes.length - 1], {headroomMW: room, variableMW: variableMW(replacement),
            projectedWaitingMW: grid.waitingMW});
        }
        plan = replacement; pending = [];
      }
    }
    return {plan, changes, unchanged: clone(pending)};
  };
  const makePlan = (S, id, strategy) => {
    if (strategy === "nothing") return {plan: empty(), changes: []};
    if (!hasAI) {
      const annual = (S.round - 1) % 12 === 0;
      return {plan: annual ? legacyPlan(S, id, strategy) : clone(S.teams[id].plan || empty()), changes: []};
    }
    // 반환 계약 {plan:{builds,lines}, econPol, ties}. 이 비교는 건설 기반만 공유하고 정책0을 기본으로 둔다.
    let planning = S;
    if (strategy === "dm") {
      select(id);
      // 같은 확정 공급 여유율에 실제 카드의 피크 수요 감소를 먼저 반영해 덜 짓는다.
      const ratio = BG.peakDemand({dr: true, save: true}, false) / BG.peakDemand({}, false);
      planning = clone(S);
      planning.econ.cities[id].pop *= ratio; planning.econ.cities[id].ind *= ratio;
      planning.teams[id].plan = { ...(planning.teams[id].plan || empty()), policies: ["dr", "save"] };
    }
    const answer = KCP.leagueAI.plan(planning, R, id, BG, "balanced");
    const original = assets(answer.plan);
    if (strategy === "dm") original.policies = ["dr", "save"];
    if (strategy === "storage") return storagePlan(S, id, original);
    return ["diesel", "renew"].includes(strategy) ? transform(S, id, strategy, original) :
      {plan: original, changes: []};
  };
  test("B18 renew 접속·유지 경계", () => {
    const S = newGame("bots-renew-grid-probe"), id = ids[0];
    C.host(S, "next", 100); select(id);
    S.econ.cities[id].cash = 10000;
    // v1.4.1 검사 장치(M): 기준 피크 100MW의 H를 파라미터로 계산해 기존 태양광으로 채운다.
    // 계수는 바꾸지 않고 기존 접속 이력과 재정을 주입한다. 전략 통계에는 섞지 않는다.
    const peakMW = 100, hostMW = peakMW * KCP.ECON_DATA.params.hostCapMul.v;
    const solarMW = BG.BLD.solar.mw, solarCount = Math.floor(hostMW / solarMW);
    const headroomTolerance = hostMW - solarCount * solarMW + 1e-6;
    const existing = placeTypes(assets(__auto(id)), Array(solarCount).fill("solar"));
    ok(!!existing, "B18 검사 장치 합법 태양광 자리·경로 존재");
    if (!existing) return;
    S.teams[id].plan = existing;
    S.grid[id].peakMW = peakMW;
    S.grid[id] = forecastGrid(S, id, existing);
    S.grid[id].entries.forEach(e => { e.allocatedMW = e.mw; });
    S.grid[id].round = 0;
    S.grid[id] = C.gridStatus(S, R, BG, id);
    select(id);
    ok(Math.abs(S.grid[id].headroomMW) < headroomTolerance, "B18 기존 설비가 H를 모두 사용");
    const original = placeTypes(existing, ["solar", "solar", "solar", "diesel"]);
    ok(!!original, "B18 검사 장치 AI 새 재생6MW·화력3MW 계획 존재");
    if (!original) return;
    const before = JSON.stringify(S), input = clone(original);
    const answer = transform(S, id, "renew", original), grid = forecastGrid(S, id, answer.plan);
    ok(answer.changes.length > 0 && answer.changes.some(c => c.storageMW > c.mw &&
      c.added.some(t => BG.BLD[t].variable)) && grid.waitingMW === 0,
      "B18 H 부족: 기존·새 재생 몫 차감, ESS 확충 후 전량 접속");
    ok(same(original, input) && JSON.stringify(S) === before, "B18 전환 입력 계획·상태 불변");
    ok(existing.builds.every(b => answer.plan.builds.some(n => same(b, n))) &&
      existing.lines.every(l => answer.plan.lines.some(n => same(l, n))) &&
      answer.plan.builds.every(b => !BG.siteRule(b.t, BG.TILES[b.i])) &&
      new Set(answer.plan.builds.map(b => b.i)).size === answer.plan.builds.length &&
      C.spendOf(BG, S, R, id, answer.plan) <= C.budget(S, id),
      "B18 ESS 추가: 기존 자산·합법 자리·중복·예산 유지");
    const poor = clone(S);
    poor.econ.cities[id].cash += C.spendOf(BG, poor, R, id, original) - C.budget(poor, id);
    const fallback = transform(poor, id, "renew", original);
    ok(fallback.changes.length === 0 && same(fallback.plan, original), "B18 ESS 예산 부족: 원 화력 계획 유지");
    const exhausted = clone(S);
    exhausted.grid[id].round = exhausted.round;
    const simple = placeTypes(existing, ["diesel"]), full = transform(exhausted, id, "renew", simple);
    ok(full.changes.every(c => c.added.every(t => !BG.BLD[t].variable)),
      "B18 같은 달 재계획: 사용한 월 접속 처리량 재사용 금지");
    const packed = assets(simple), used = new Set(packed.builds.map(b => b.i));
    BG.TILES.filter(tile => !used.has(tile.i) && !BG.siteRule("battery", tile)).forEach(tile => {
      const type = Object.keys(BG.BLD).find(t => ["ren", "bat"].includes(BG.BLD[t].cls) && !BG.siteRule(t, tile));
      if (type) packed.builds.push({t: type, i: tile.i});
    });
    ok(same(transform(S, id, "renew", packed).plan, packed), "B18 ESS 자리 부족: 원 화력 계획 유지");
    const missing = clone(S); delete missing.grid;
    ok(same(transform(missing, id, "renew", original).plan, original), "B18 접속 계약 누락: 원 계획 유지");
    const debt = clone(S); debt.econ.cities[id].cash = -debt.econ.cities[id].debtCap - 1;
    ok(same(transform(debt, id, "renew", original).plan, original), "B18 부채 한도 초과: 원 계획 유지");
  });
  const cooperate = (S, assignment, at) => {
    const run = out.runs[out.runs.length - 1];
    R.ties.forEach(def => {
      const side = [def.a, def.b].find(id => assignment[id] === "ties");
      if (!side) return;
      const other = side === def.a ? def.b : def.a;
      const existing = S.ties.find(t => t.a === def.a && t.b === def.b);
      if (existing?.st === "built") return;
      if (!existing) {
        const result = req(S, side, {type: "tie", other, op: "propose", cap: 2}, at);
        run.tieRequests.push({round: S.round, a: side, b: other, op: "propose", result});
        if (!result?.ok) return;
      }
      const proposal = S.ties.find(t => t.a === def.a && t.b === def.b);
      const receiver = proposal.by === side ? other : side;
      // 모든 상대는 기존 계획·예산·지방채 규칙 안에서 수락한다. 남은 제안은 다음 달 재시도한다.
      const result = req(S, receiver, {type: "tie", other: proposal.by, op: "accept"}, at + 1);
      run.tieRequests.push({round: S.round, a: proposal.by, b: receiver, op: "accept", result});
    });
  };
  for (let rotation = 0; rotation < rotations; rotation++) test(`전략 회전 ${rotation}`, () => {
    // 같은 방 씨앗: 회전별 난수 차이가 도시×전략 비교를 흐리지 않게 한다.
    const S = newGame("bots-strategy-common"); claim(S);
    const assignment = Object.fromEntries(ids.map((id, i) => [id, strategies[(i + rotation) % strategies.length]]));
    const run = {rotation, assignment, hist: [], rows: [], tieRequests: [], planRequests: []}; out.runs.push(run);
    const starting = clone(S.econ.cities); let prior = null, offerChecks = 0;
    for (let m = 1; m <= months; m++) {
      const at = m * 100000; C.host(S, "next", at);
      ok(S.phase === "plan" && S.round === m, `회전${rotation} ${m}달 host 계획 단계`);
      const publicEcon = C.publicView(S, at + 1)?.econ;
      if (m === 1) ok(finite(publicEcon?.eduSpeed), `B1 공개 eduSpeed=${publicEcon?.eduSpeed}`);
      ids.forEach(id => {
        const strategy = assignment[id];
        const tax = strategy === "taxlow" ? -2 : strategy === "taxhigh" ? 2 : 0;
        const policy = req(S, id, {type: "econ", taxRes: tax, taxInd: tax, service: -tax, incentive: 0}, at + 2);
        ok(policy?.ok === true, `회전${rotation} ${id} ${m}달 econ ${JSON.stringify(policy)}`);
      });
      // 모든 도시의 AI 입력은 같은 월초 상태다. 요청 순서로 다른 도시 계획이 새 입력에 섞이지 않는다.
      const plans = Object.fromEntries(ids.map(id => [id, makePlan(S, id, assignment[id])]));
      ids.forEach(id => {
        const strategy = assignment[id], proposal = plans[id], plan = proposal.plan;
        select(id);
        ok(plan.builds.every(b => BG.TILES[b.i] && !BG.siteRule(b.t, BG.TILES[b.i])) &&
          new Set(plan.builds.map(b => b.i)).size === plan.builds.length,
          `회전${rotation} ${id} ${m}달 합법 자리·중복 없음`);
        const city = S.econ.cities[id], before = assets(S.teams[id].plan);
        const spend = C.spendOf(BG, S, R, id, plan), budget = C.budget(S, id);
        ok(spend <= budget + 1e-6 || city.cash < -city.debtCap && same(assets(plan), before),
          `회전${rotation} ${id} ${m}달 계획 예산 ${spend}/${budget}`);
        const r = req(S, id, {type: "plan", rev: S.teams[id].rev + 1, plan}, at + 5);
        ok(r?.ok === true && same(assets(plan), assets(S.teams[id].plan)),
          `회전${rotation} ${id} ${m}달 계획 수락·무손실 ${JSON.stringify(r)}`);
        run.planRequests.push({month: m, id, strategy, spend, budget, result: r,
          changes: proposal.changes, unchanged: proposal.unchanged || []});
        if (strategy === "nothing") ok((S.teams[id].plan?.builds || []).length === 0 &&
          (S.teams[id].plan?.lines || []).length === 0, `nothing ${id} 건설 없음`);
      });
      // 공통 기반 건설 뒤 가능한 연계선을 모두 제안·수락한다. 비용으로 기반 계획을 깎지 않는다.
      cooperate(S, assignment, at + 6);
      const res = C.run(S, BG, at + 50), rep = res?.econ;
      ok(!!rep?.fiscal, `회전${rotation} ${m}달 econ report 계약`);
      if (!rep) throw new Error(`${m}달 econ 보고서 없음`);
      // 접속용 ESS의 관측 달에 접속용 키 전체를 제거해 묶음 효과를 확인한다.
      // 같은 접속 완료 발전·날씨·수요·mods를 고정한다. 개별 ESS 추가 효과는 정보로만 남긴다.
      for (const id of ids.filter(id => assignment[id] === "storage")) {
        const pending = run.planRequests.filter(p => p.id === id).flatMap(p => p.changes)
          .filter(c => c.storageKeys && !c.verifiedAtMonth);
        if (!pending.length) continue;
        select(id);
        const plan = S.teams[id].plan, mods = C.modsFor(S, R, id), rnd = {...C.roundsOf(S)[m - 1], seed: res.seed};
        const actual = C.simTeam(BG, R, id, plan, rnd, Number.MAX_VALUE, mods);
        const actualSpill = actual.k.curt + (actual.curtailMWh || 0);
        const connected = (res.team[id].grid?.waitingMW || 0) <= 1e-6 && pending.some(change =>
          change.storageKeys.every(key => plan.builds.some(b => b.t + ":" + b.i === key)));
        if (connected) {
          const storageKeys = [...new Set(run.planRequests.filter(p => p.id === id && p.strategy === "storage")
            .flatMap(p => p.changes).flatMap(c => c.storageKeys || []))];
          const without = {...plan, builds: plan.builds.filter(b => !storageKeys.includes(b.t + ":" + b.i))};
          const counter = C.simTeam(BG, R, id, without, rnd, Number.MAX_VALUE, mods);
          const sourceMWh = counter.k.curt + (counter.curtailMWh || 0);
          (run.storageObservations ||= []).push({id, month: m, connected, storageKeys,
            sourceMWh, actualMWh: actualSpill});
          ok(Number.isFinite(sourceMWh) && Number.isFinite(actualSpill) && actualSpill <= sourceMWh + 1e-6,
            `B18 storage ${id}/${m} 같은 급전의 접속용 ESS 전체 제거 대조: 버림 비증가`);
        }
        for (const change of pending) {
          const without = {...plan, builds: plan.builds.filter(b => !change.storageKeys.includes(b.t + ":" + b.i))};
          const counter = C.simTeam(BG, R, id, without, rnd, Number.MAX_VALUE, mods);
          const source = counter.k.curt + (counter.curtailMWh || 0);
          const connected = change.storageKeys.every(key => plan.builds.some(b => b.t + ":" + b.i === key)) &&
            (res.team[id].grid?.waitingMW || 0) <= 1e-6;
          if (connected) {
            change.observedMonths = (change.observedMonths || 0) + 1;
          }
          if (source - actualSpill > 1e-6) {
            change.chargeSourceMWh = source; change.capturedMWh = source - actualSpill; change.verifiedAtMonth = m;
          }
        }
      }
      const coop = X.score(S.econ);
      ok(ids.every(id => coop.by[id].coop === coop.by[ids[0]].coop), `D61 회전${rotation} ${m}달 같은 공동 보너스`);
      ids.forEach(id => {
        const f = rep.fiscal?.[id], r = res.team?.[id];
        if (prior) ok(finite(prior[id]?.cashAfter) && finite(f?.cashBefore) && Math.abs(prior[id].cashAfter - f.cashBefore) < 1e-6,
          `B10 회전${rotation} ${id} ${m - 1}→${m}달 ${prior[id]?.cashAfter} == ${f?.cashBefore}`);
        const input = r && C.econInput(S, R, id, r, C.roundsOf(S)[m - 1].mdays / 7);
        ok(finite(input?.energy?.spareMW), `B8 회전${rotation} ${id} ${m}달 econInput spareMW=${input?.energy?.spareMW}`);
        ok(finite(input?.energy?.waitingMW) && input.energy.waitingMW >= 0 &&
          finite(input?.energy?.curtailMWh) && input.energy.curtailMWh >= 0,
          `B18 회전${rotation} ${id} ${m}달 접속 대기·출력제어 계약`);
        ok(finite(f?.eventBonus), `B9/B10 회전${rotation} ${id} ${m}달 eventBonus=${f?.eventBonus}`);
      });
      (rep.offers || []).forEach(o => ids.forEach(id => {
        offerChecks++;
        ok(finite(o.eval?.by?.[id]?.checks?.mw?.have), `B8 회전${rotation} ${m}달 ${o.id} ${id} mw.have=${o.eval?.by?.[id]?.checks?.mw?.have}`);
      }));
      run.hist.push({month: m, score: [12,24,36].includes(m) ? clone(X.score({...S.econ, len:m})) : null, fiscal: clone(rep.fiscal), review: clone(rep.review),
        cities: clone(S.econ.cities), energy: clone(res.team), offers: clone(rep.offers || [])});
      prior = rep.fiscal;
    }
    ok(offerChecks > 0, `B8 회전${rotation} 실제 offers eval 관찰 ${offerChecks}건`);
    const score = X.score(S.econ), ranks = score?.rank || [];
    ids.forEach(id => {
      const city = S.econ.cities[id], sc = score?.by?.[id];
      ok(finite(sc?.score), `회전${rotation} ${id} 최종 score=${sc?.score}`);
      const first = run.hist.slice(0, 12).map(h => h.fiscal[id]);
      const operating = sum(first.map(f => f.revTotal - (f.expTotal - f.exp.capex)));
      const bonuses = sum(first.map(f => f.eventBonus ?? 0));
      const uns = run.hist.map(h => h.energy[id].unsPct);
      // B18 실용성 기준은 운영 전략마다, 각 도시의 전체 기간 평균에 적용한다.
      // 건설하지 않는 nothing만 대조군이며 높은 정전을 검증에서 숨기지 않는다.
      if (assignment[id] !== "nothing") ok(sum(uns) / uns.length <= 5,
        `B18 ${assignment[id]} ${id} 운영 평균 정전 ${(sum(uns) / uns.length).toFixed(3)}% ≤5%`);
      const waiting = run.hist.map(h => h.energy[id].grid?.waitingMW);
      const curtailed = run.hist.map(h => h.energy[id].curtailMWh * C.roundsOf(S)[h.month - 1].mdays / 7);
      const co2 = run.hist.map(h => h.energy[id].co2Cons * C.roundsOf(S)[h.month - 1].mdays / 7);
      const population = sum(run.hist.map(h => h.cities[id].pop));
      run.rows.push({id, name: out.names[id], strategy: assignment[id], score: sc?.score ?? null,
        rank: sc?.rank ?? (ranks.findIndex(r => r.id === id) + 1 || null), parts: sc?.parts || {},
        popPct: (city.pop / starting[id].pop - 1) * 100, indPct: (city.ind / starting[id].ind - 1) * 100,
        cash: city.cash, cash0: starting[id].cash0,
        operatingYear1: operating, eventBonusYear1: bonuses,
        operatingRatio: (operating - bonuses) / starting[id].cash0,
        unsPct: sum(uns) / uns.length,
        waitingMW: waiting.every(finite) ? sum(waiting) / waiting.length : null,
        curtailMWh: curtailed.every(finite) ? sum(curtailed) / curtailed.length : null,
        co2PerPerson: sum(co2) / population, approval: city.approval,
        reviewPass: run.hist.filter(h => h.review?.[id]?.pass === true).length,
        plans: clone(S.teams[id].plan), ties: clone(S.ties)});
    });
  });
  if (rotations === strategies.length) strategies.forEach(strategy => {
    const cities = out.runs.flatMap(r => r.rows).filter(r => r.strategy === strategy).map(r => r.id);
    ok(cities.length === 6 && new Set(cities).size === 6, `${strategy} 모든 도시 1회 배정 ${cities.join(",")}`);
  });
  if (rotations === strategies.length) {
    const added = out.runs.flatMap(r => r.planRequests).filter(p => p.strategy === "storage")
      .flatMap(p => p.changes);
    // 관측 유무 판정은 Python의 공통 집계에서 한다. 관측0은 통과가 아니다.
    ok(added.length > 0, `B18 storage 실제 ESS 추가 ${added.length}회`);
  }
  return out;
}
"""



def b18_storage_observation(out):
    """씨앗별 저장 묶음 효과를 단언하고 개별 추가 효과는 정보로 남긴다."""
    changes = [change for run in out.get("runs", [])
               for request in run.get("planRequests", []) if request.get("strategy") == "storage"
               for change in request.get("changes", []) if change.get("storageKeys")]
    observed = [change for change in changes if change.get("observedMonths", 0) > 0]
    improved = [change for change in observed
                if change.get("verifiedAtMonth") and change.get("capturedMWh", 0) > 1e-6]
    collective = [row for run in out.get("runs", [])
                  for row in run.get("storageObservations", []) if row.get("connected")]
    valid = all(isinstance(row.get(key), (int, float)) and math.isfinite(row[key])
                for row in collective for key in ("sourceMWh", "actualMWh"))
    nonincreasing = valid and all(row["actualMWh"] <= row["sourceMWh"] + 1e-6
                                 for row in collective)
    positive = [row for row in collective
                if valid and row["sourceMWh"] - row["actualMWh"] > 1e-6]
    passed = nonincreasing and bool(positive)
    result = {"status": "관측 없음" if not observed else "통과" if passed else "실패",
              "bundles": len(changes), "observedBundles": len(observed),
              "observedMonths": sum(c.get("observedMonths", 0) for c in observed),
              "improvedBundles": len(improved),
              "individualCapturedMWh": sum(c.get("capturedMWh", 0) for c in improved),
              "collectiveEvidence": "관측 있음" if collective else "자료 없음" if observed else "관측 없음",
              "collectiveMonths": len(collective), "collectiveImprovedMonths": len(positive),
              "collectiveCapturedMWh": sum(row["sourceMWh"] - row["actualMWh"]
                                           for row in collective) if collective and valid else None}
    out["b18Observation"] = result
    if observed:
        out["checks"].append([passed,
            "B18 storage 접속용 ESS 전체 제거 대조: 관측 달 버림 비증가·양수 묶음 효과 존재"])
    return result


def b18_observation_report(outputs):
    results = [b18_storage_observation(out) for out in outputs]
    counts = {status: sum(r["status"] == status for r in results)
              for status in ("통과", "실패", "관측 없음")}
    print("B18 씨앗 집계: " + " · ".join(f"{k} {v}" for k, v in counts.items()))
    for i, row in enumerate(results):
        print(f"B18 씨앗 {i + 1}: " + json.dumps(row, ensure_ascii=False))
    if counts["통과"] + counts["실패"] == 0:
        message = "B18 storage 실행 전체에 관측된 씨앗 없음: 미판정(통과 아님)"
        print("FAIL " + message)
        if outputs:
            outputs[0]["checks"].append([False, message])
    elif counts["실패"]:
        print(f"FAIL B18 storage 관측 씨앗 중 실패 {counts['실패']}개")
    print("B18 개별 ESS 추가 효과는 정보 출력이며 단언 아님: 다른 ESS의 중복 흡수로 0일 수 있음.")
    return counts


def load_auto():
    """calib.py를 실행하지 않고 AUTO 상수만 읽는다(외부 요청·별도 브라우저 없음)."""
    source = Path(__file__).with_name("calib.py").read_text(encoding="utf-8")
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "AUTO" for t in node.targets
        ):
            return ast.literal_eval(node.value)
    raise ValueError("calib.py의 AUTO 계약 없음")


def strategy_summary(out):
    """같은 도시의 전략 점수를 비교한다. 리그 상대 순위와 구분하고 공동1위도 센다."""
    rows = [row for run in out.get("runs", []) for row in run.get("rows", [])]
    strategies = out.get("strategies", [])
    def mean(group, key):
        values = [r.get(key) for r in group]
        if not values or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
            return None
        return sum(values) / len(values)
    first = dict.fromkeys(strategies, 0)
    complete = []
    for city in out.get("ids", []):
        scores = {s: mean([r for r in rows if r["id"] == city and r["strategy"] == s], "score")
                  for s in strategies}
        if not scores or any(v is None for v in scores.values()):
            continue
        complete.append(city)
        best = max(scores.values())
        for strategy, score in scores.items():
            if abs(score - best) <= 1e-9:
                first[strategy] += 1
    scores = {s: mean([r for r in rows if r["strategy"] == s], "score") for s in strategies}
    active = {s: score for s, score in scores.items() if s != "nothing" and score is not None}
    best = max(active, key=active.get) if active else None
    worst = min(active, key=active.get) if active else None
    return {"firstCounts": first, "completeCities": complete, "meanScores": scores,
            "meanUnsPct": {s: mean([r for r in rows if r["strategy"] == s], "unsPct") for s in strategies},
            "meanWaitingMW": {s: mean([r for r in rows if r["strategy"] == s], "waitingMW") for s in strategies},
            "meanCurtailMWh": {s: mean([r for r in rows if r["strategy"] == s], "curtailMWh") for s in strategies},
            "best": best, "worst": worst,
            "meanScoreGap": active[best] - active[worst] if active else None}


def horizon_summary(out):
    result = {}
    if out.get("rotations") != len(out.get("strategies", [])):
        return result  # 부분 회전은 도시별 9전략 비교가 아니다.
    for month in (12, 24, 36):
        runs = [r for r in out.get("runs", []) if len(r["hist"]) >= month]
        if not runs:
            continue
        rows = []
        for run in runs:
            h = run["hist"][month - 1]
            for city, strategy in run["assignment"].items():
                c, f = h["cities"][city], h["fiscal"][city]
                rows.append(dict(id=city, strategy=strategy, cash=c["cash"],
                    debtRatio=max(0, -c["cash"]) / c["debtCap"], over=f["debtOver"],
                    score=h["score"]["by"][city]["score"]))
        strategies = out["strategies"]
        means = {s: statistics.mean(r["score"] for r in rows if r["strategy"] == s) for s in strategies}
        cash = {s: statistics.mean(r["cash"] for r in rows if r["strategy"] == s) for s in strategies}
        winners = {}
        nothing_ranks = {}
        nothing_score_ranks = {}
        for city in out["ids"]:
            group = [r for r in rows if r["id"] == city]
            best = max(r["score"] for r in group)
            winners[city] = [r["strategy"] for r in group if r["score"] == best]
            nothing = next((r for r in group if r["strategy"] == "nothing"), None)
            if nothing:
                nothing_score_ranks[city] = 1 + sum(r["score"] > nothing["score"] for r in group)
                nothing_ranks[city] = 1 + sum(r["cash"] > nothing["cash"] for r in group)
        samples = [f for run in runs for h in run["hist"][:month] for f in h["fiscal"].values()]
        result[month] = dict(n=len(rows), overCities=sum(r["over"] for r in rows),
            debtMedian=statistics.median(r["debtRatio"] for r in rows),
            overCityMonths=sum(f["debtOver"] for f in samples), cityMonths=len(samples),
            nothingCashRank=1 + sum(v > cash["nothing"] for v in cash.values()),
            nothingCashCityRanks=nothing_ranks, nothingScoreCityRanks=nothing_score_ranks, meanScores=means, meanCash=cash, winners=winners)
    return result


def debt_breakdown(out):
    """총액 회계로 복원한다. 차익에서 이미 차감한 연료를 다시 비용에 더하지 않는다."""
    rows = []
    for run in out.get("runs", []):
        assignment = run.get("assignment") or {city: run["style"] for city in run["hist"][0]["fiscal"]}
        for city, strategy in assignment.items():
            totals = dict(income=0, fuel=0, operation=0, purchase=0, interest=0,
                          service=0, construction=0, repair=0, other=0, rounding=0)
            for h in run["hist"]:
                f, r = h["fiscal"][city], h["energy"][city]
                # 월별 보고에 사용한 실제 달력 일수. 2027년부터 시작하는 검사 방.
                import calendar
                wk = calendar.monthrange(2027 + (h["month"] - 1) // 12, (h["month"] - 1) % 12 + 1)[1] / 7
                power = f["tariffGross"] - f["rev"]["tariff"]
                fuel = r["cost"]["fuel"] * wk
                operation = r["cost"]["policy"] * wk + r["cost"].get("resp", 0) + r["cost"].get("research", 0)
                purchase = r["pay"] * wk
                amounts = dict(income=f["revTotal"] + power, fuel=fuel, operation=operation,
                    purchase=purchase, interest=f["exp"]["interest"], service=f["exp"]["service"],
                    construction=f["exp"]["capex"], repair=f["exp"].get("repair", 0),
                    other=f["exp"]["incentive"] + f["exp"]["policy"],
                    rounding=power + f["exp"]["opex"] - fuel - operation - purchase)
                for key, amount in amounts.items():
                    totals[key] += amount
            first, last = run["hist"][0]["fiscal"][city], run["hist"][-1]["fiscal"][city]
            close = first["cashBefore"] + totals["income"] - sum(v for k, v in totals.items() if k != "income")
            if abs(close - last["cashAfter"]) > 1e-6:
                raise AssertionError(f"지출 분해 현금 항등식 {strategy}/{city}: {close}/{last['cashAfter']}")
            rows.append(dict(id=city, strategy=strategy, **totals, opening=first["cashBefore"],
                cash=last["cashAfter"], debtCap=last["debtCap"], over=last["debtOver"],
                firstWarn=next((h["month"] for h in run["hist"] if h["fiscal"][city]["debtStage"] != "ok"), None),
                firstOver=next((h["month"] for h in run["hist"] if h["fiscal"][city]["debtOver"]), None)))
    strategies = list(dict.fromkeys(r["strategy"] for r in rows))
    means = {s: {key: statistics.mean(r[key] for r in rows if r["strategy"] == s)
                 for key in [*totals, "opening", "cash", "debtCap"]} for s in strategies} if rows else {}
    for s in strategies:
        means[s]["overCities"] = sum(r["over"] for r in rows if r["strategy"] == s)
    return dict(rows=rows, means=means)


def markdown(out):
    summary = strategy_summary(out)
    rows = [row for run in out.get("runs", []) for row in run.get("rows", [])]
    def average(group, key, part=False):
        values = [(r.get("parts", {}) if part else r).get(key) for r in group]
        if not values or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
            return "-"
        return f"{sum(values) / len(values):.3f}"
    lines = [f"# 전략 봇 {out['months']}달 결과", "",
             f"회전 {out['rotations']}회. 동일 방 씨앗, 도시·전략 회전 배정. 수치는 전략별 산술 평균.", "",
             f"기반 계획기: {out.get('planner', '미실행')}. nothing은 건설 없음, 나머지는 정책 0의 공통 건설 기반에 전략만 추가한다.", "",
             "운영 수지/cash0는 1년차 사건 지원금을 제외한다(B6 참고). 지원금은 별도 억 단위. CO₂는 사람당 월 평균 t. 정전은 달별 평균 %. 접속 대기는 운영 뒤 달별 평균 MW, 출력제어는 7일 보고를 각 달 일수로 환산한 월 평균 MWh.", "",
             "| 전략 | 점수 | 순위 | 도시 1위/6 | pop | ind | fin | co2 | appr | rel | 주민 Δ% | 종사자 Δ% | 현금 억 | 1년 수지/cash0 | 사건 지원금 억 | 정전 평균 % | 평균 접속 대기 MW | 평균 출력제어 MWh | CO₂ t/인·월 | 지지율 | 평가 통과 | 표본 |",
             "|---|" + "---:|" * 21]
    for strategy in out.get("strategies", []):
        group = [r for r in rows if r["strategy"] == strategy]
        cells = [strategy, average(group, "score"), average(group, "rank"),
                 f"{summary['firstCounts'][strategy]}/6"]
        cells += [average(group, key, part=True) for key in ("pop", "ind", "fin", "co2", "appr", "rel")]
        cells += [average(group, key) for key in ("popPct", "indPct", "cash", "operatingRatio", "eventBonusYear1", "unsPct", "waitingMW", "curtailMWh", "co2PerPerson", "approval", "reviewPass")]
        cells += [str(len(group))]
        lines.append("| " + " | ".join(cells) + " |")
    gap = summary["meanScoreGap"]
    gap_line = (f"전략 평균 점수 1위−최하위 차이(nothing 제외): {gap:.3f}점 "
                f"({summary['best']} − {summary['worst']})." if gap is not None else
                "전략 평균 점수 차이(nothing 제외): 미측정.")
    lines += ["", gap_line, "",
              f"도시 1위는 같은 도시의 9전략 비교이며 공동1위도 센다. 완전 비교 도시 {len(summary['completeCities'])}/6; "
              "부분 실행에서는 1위 횟수가 전체 판정이 아니다.", ""]
    lines += [f"B16 strategy-dominance: {s} 1위 {summary['firstCounts'][s]}/6" for s in out.get("strategies", [])]
    lines += ["", "## 도시×전략 점수", "",
              "| 도시 | " + " | ".join(out.get("strategies", [])) + " |",
              "|---|" + "---:|" * len(out.get("strategies", []))]
    for city in out.get("ids", []):
        cells = [out["names"].get(city, city)]
        for strategy in out.get("strategies", []):
            cells.append(average([r for r in rows if r["id"] == city and r["strategy"] == strategy], "score"))
        lines.append("| " + " | ".join(cells) + " |")
    for key, title in (("monthEvents", "달 사건"), ("seasonEvents", "계절 사건 참고")):
        if key in out:
            lines += ["", f"{title}: `{json.dumps(out[key], ensure_ascii=False)}`"]
    if out.get("horizons"):
        lines += ["", "## 12·24·36달 재정·전략 비교", "",
                  "| 달 | 한도 초과 도시 | 부채/한도 중앙값 | 한도 초과 도시·달 | nothing 평균 현금 순위 |", "|---|---:|---:|---:|---:|"]
        for month, h in out["horizons"].items():
            lines.append(f"| {month} | {h['overCities']}/{h['n']} | {h['debtMedian']:.3f} | {h['overCityMonths']}/{h['cityMonths']} | {h['nothingCashRank']}/9 |")
        for month, h in out["horizons"].items():
            lines += ["", f"### {month}달 전략별 평균", "", "| 전략 | 점수 | 현금 억 |", "|---|---:|---:|"]
            lines += [f"| {s} | {h['meanScores'][s]:.3f} | {h['meanCash'][s]:.3f} |" for s in out["strategies"]]
            lines += ["", f"도시별 1위: `{json.dumps(h['winners'], ensure_ascii=False)}`",
                      f"nothing 도시별 현금 순위: `{json.dumps(h['nothingCashCityRanks'], ensure_ascii=False)}`",
                      f"nothing 도시별 점수 순위: `{json.dumps(h['nothingScoreCityRanks'], ensure_ascii=False)}`"]
    if out.get("debtBreakdown"):
        lines += ["", "## 누적 지출 분해(도시 평균 억)", "", "차익에서 상계한 전력 원가를 복원한 총액 회계. 연료와 차익 비용의 중복 없음. operation은 전력 정책·사건 대응·연구 운영비이며 보수비·서비스·이자는 별도다.", "",
                  "| 전략 | 초과 | 총수입 | 연료 | 운영 | 전력구매 | 이자 | 서비스 | 건설 | 보수 | 기타 | 반올림 | 최종 현금 |",
                  "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
        for strategy, row in out["debtBreakdown"]["means"].items():
            values = [str(row["overCities"])] + [f"{row[k]:.3f}" for k in ("income", "fuel", "operation", "purchase", "interest", "service", "construction", "repair", "other", "rounding", "cash")]
            lines.append("| " + " | ".join([strategy, *values]) + " |")
    if "b18Observation" in out:
        observation = out["b18Observation"]
        lines += ["", "B18 접속용 ESS: " + observation["status"] +
                  f" (관측 묶음 {observation['observedBundles']}, 관측 달 {observation['observedMonths']}, "
                  f"묶음 대조 {observation['collectiveEvidence']}, "
                  f"묶음 효과 양수 달 {observation['collectiveImprovedMonths']}/{observation['collectiveMonths']}, "
                  f"버림 감소 {observation['collectiveCapturedMWh']}MWh)",
                  f"개별 ESS 추가 효과: 양수 {observation['improvedBundles']}묶음 "
                  f"·최초 양수 기록 합 {observation['individualCapturedMWh']}MWh "
                  "(정보 출력·단언 아님; 다른 ESS의 중복 흡수로 0일 수 있음)."]
    checks = out.get("checks", [])
    bad = [message for passed, message in checks if not passed]
    lines += ["", f"checks {len(checks)} fail {len(bad)}", ""]
    lines += [f"- FAIL {message}" for message in bad]
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", nargs="?", default="http://127.0.0.1:9430/index.html")
    parser.add_argument("--months", type=int, choices=(12, 24, 36), default=36)
    parser.add_argument("--node", action="store_true", help="브라우저 없이 같은 전략 JS를 Node에서 실행")
    parser.add_argument("--quick", action="store_true", help="12달·회전 2개")
    parser.add_argument("--output-dir", type=Path, help="결과 파일 저장 경로(기본 tests/results)")
    parser.add_argument("--b18-only", nargs="+", type=Path,
                        help="저장된 씨앗별 JSON의 B18 관측 집계만 재실행(시뮬레이션 없음)")
    args = parser.parse_args()
    if args.b18_only:
        outputs = [json.loads(p.read_text(encoding="utf-8")) for p in args.b18_only]
        counts = b18_observation_report(outputs)
        return 1 if counts["실패"] or counts["통과"] == 0 else 0
    months, rotations = (12, 2) if args.quick else (args.months, 9)
    out = {"months": months, "rotations": rotations, "strategies":
           ["nothing", "base", "diesel", "renew", "ties", "taxlow", "taxhigh", "dm", "storage"],
           "ids": [], "names": {}, "runs": [], "checks": []}
    errors = []
    try:
        if args.node:
            root = Path(__file__).resolve().parents[2]
            runner = r"""
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const arg = JSON.parse(fs.readFileSync(0, 'utf8'));
const ctx = vm.createContext({console, document:{documentElement:{}}, KCP:{route(){},on(){},esc:x=>x}});
ctx.window=ctx;
vm.runInContext('Math.random=()=>{throw new Error("unseeded random");}',ctx);
for (const f of ['build-maps','tech-data','build','econ-data','econ','league-data','league-core','league-ai'])
  vm.runInContext(fs.readFileSync(path.join(arg.root,'ui',f+'.js'),'utf8'),ctx,{filename:f});
if (arg.variant) require(path.join(arg.root, "tests/league/review/g6-variants")).apply(ctx.KCP, arg.variant);
vm.runInContext(arg.auto,ctx);
const run = vm.runInContext(arg.js,ctx);
process.stdout.write(JSON.stringify(run({months:arg.months,rotations:arg.rotations})));
"""
            result = subprocess.run(["node", "-e", runner], input=json.dumps({"root": str(root), "js": JS,
                "months": months, "rotations": rotations, "auto": load_auto(), "variant": os.environ.get("G6_VARIANT")}), text=True, capture_output=True, check=True)
            out = json.loads(result.stdout)
        else:
            out = browser_run(args.url, months, rotations, errors)
    except Exception as exc:
        errors.append(f"실행 예외: {exc}")
    out["checks"].extend([[False, message] for message in errors])
    b18_observation_report([out])
    out["url"] = "node (no network)" if args.node else args.url
    out["strategySummary"] = strategy_summary(out)
    out["horizons"] = horizon_summary(out)
    out["debtBreakdown"] = debt_breakdown(out)
    if rotations == len(out["strategies"]):
        summary = out["strategySummary"]
        out["checks"].append([len(summary["completeCities"]) == len(out["ids"]), "D61 모든 도시 전략 비교"])
        for strategy, wins in summary["firstCounts"].items():
            out["checks"].append([wins < len(out["ids"]), f"D61 {strategy} 도시별 1위 {wins}/{len(out['ids'])}: 독식 없음"])
    for month, horizon in out["horizons"].items():
        for city, rank in horizon["nothingScoreCityRanks"].items():
            out["checks"].append([rank == 9, f"G10 {month}달 {city} nothing 점수 {rank}/9위: 꼴찌"])
        for strategy in out["strategies"]:
            wins = sum(strategy in w for w in horizon["winners"].values())
            out["checks"].append([wins < len(out["ids"]), f"B16 {month}달 {strategy} 도시1위 {wins}/6: 독식 없음"])
    if months == 36 and rotations == len(out["strategies"]):
        for run in out["runs"]:
            for row in run["rows"]:
                if row["strategy"] == "base":
                    over = sum(h["fiscal"][row["id"]]["debtOver"] for h in run["hist"])
                    out["checks"].append([over == 0, f"G10 정책0 base {row['id']} 지방채 초과 {over}달"])
        means = out["horizons"][36]["meanScores"]
        out["checks"].append([means["renew"] > means["diesel"], "G10 36달 재생 평균 > 디젤 평균"])
    result_dir = args.output_dir or Path(__file__).resolve().parents[1] / "results"
    result_dir.mkdir(parents=True, exist_ok=True)
    report = markdown(out)
    (result_dir / "bots36.json").write_text(json.dumps(out, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    (result_dir / "bots36.md").write_text(report, encoding="utf-8")
    print(report, end="")
    failed = sum(not passed for passed, _ in out["checks"])
    print(f"checks {len(out['checks'])} fail {failed}")
    return 1 if failed else 0


def browser_run(url, months, rotations, errors):
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError("외부 네트워크 전송 금지: 로컬 서버 주소만 허용")
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page(service_workers="block")
            # 외부 폰트·API 등도 전송 전에 차단한다.
            def local_only(route):
                url = urlsplit(route.request.url)
                if url.hostname in ("127.0.0.1", "localhost", "::1") or url.scheme in ("data", "blob"):
                    route.continue_()
                elif url.hostname == "fonts.googleapis.com" and route.request.resource_type == "stylesheet":
                    # 외부 요청 없이 빈 스타일시트를 제공해 시스템 폰트로 계산한다.
                    route.fulfill(status=200, content_type="text/css", body="")
                else:
                    route.abort()
            page.route("**/*", local_only)
            page.on("pageerror", lambda e: errors.append(f"페이지 오류: {e}"))
            page.on("console", lambda m: errors.append(f"콘솔 {m.type}: {m.text}")
                    if m.type in ("error", "warning") else None)
            page.goto(url.split("#")[0] + "#home")
            page.wait_for_function("!!(window.KCP && KCP.leagueCore && KCP.buildGame && KCP.econ)")
            page.evaluate(load_auto())
            out = page.evaluate(JS, {"months": months, "rotations": rotations})
        finally:
            browser.close()
    return out


if __name__ == "__main__":
    raise SystemExit(main())
