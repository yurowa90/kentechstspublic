"use strict";
// 회귀: 연구 화면·예약 계산(researchView·researchReserve)은 유레카·공동 연구 판정 중에 다른 도시 지도를 고른다.
// 진행자 공개 상태와 팀 기기 예산 훅이 화면 지도(BG.PK)를 바꾸면 안 된다(2026-10-06 독립 검토 재현을 옮김).
const path = require("node:path"), ROOT = path.resolve(__dirname, "../../..");
global.window = { KCP: { route() {}, on() {}, esc: s => String(s) } };
global.document = { documentElement: {} };
global.KCP = window.KCP;
for (const n of ["build-maps", "tech-data", "build", "econ-data", "econ", "league-data", "league-core", "league-ai"])
  require(path.join(ROOT, `ui/${n}.js`));
const T = require(path.join(ROOT, "tests/league/tech.js")), { C, BG, R } = T.context();

let pass = 0, fail = 0;
const ok = (cond, name, detail) => { if (cond) pass++; else { fail++; console.log("FAIL", name, detail || ""); } };
const view = id => { BG.selectPack(C.teamDef(R, id).pack, "league"); return BG.PK.id; };

// 1. 이전받은 카드를 연구 중인 팀이 있을 때 진행자 공개 상태·팀 기기 예약
{
  const { S, ids } = T.fixture({ all: true });
  const [donor, buyer, third] = ids;
  S.teams[donor].research = T.research(["grid", "sic", "fcst"]);
  ok(T.special(S, buyer, "license", donor, "grid").ok, "기술 이전 준비");
  const before = view(third);
  C.publicView(S, 0);
  ok(BG.PK.id === before, "이전 카드: 진행자 공개 상태가 지도 유지", `${before} -> ${BG.PK.id}`);
  const V = JSON.parse(JSON.stringify(C.publicView(S, 0)));
  const mine = view(buyer);
  C.researchReserve(V, buyer, BG, V.teams[buyer].plan);
  ok(BG.PK.id === mine, "이전 카드: 팀 기기 예약이 지도 유지", `${mine} -> ${BG.PK.id}`);
}

// 2. 인력 0 + 이전받은 hvdc + 건설된 연계선(유레카 판정이 이웃 지도를 고름)
{
  const { S, ids } = T.fixture({ all: true });
  const def = R.ties.find(t => t.kind !== "sea"), me = def.a, other = def.b;
  S.ties.push({ a: def.a, b: def.b, cap: 2, st: "built", by: me });
  for (const id of [me, other]) {
    view(id);
    const anchor = BG.SITES.find(s => s.dem).tile, gate = BG.SITES.find(s => s.kind === "gridpt" && (s.to || []).includes(id === me ? other : me));
    const p = gate && BG.routePath(anchor, gate.tile);
    S.teams[id].plan = BG.sanitize({ builds: [], lines: p ? [{ p }] : [], policies: [], rq: [] }, 1e9);
  }
  const donor = ids.find(id => id !== me && id !== other);
  S.teams[donor].research = T.research(["scable", "hvdc"]);
  S.teams[me].research = T.research(["scable"]);
  ok(T.special(S, me, "license", donor, "hvdc").ok, "hvdc 이전 준비");
  const before = view(me);
  C.researchReserve(S, me, BG, S.teams[me].plan);
  ok(BG.PK.id === before, "hvdc 유레카: 예약이 지도 유지", `${before} -> ${BG.PK.id}`);
  view(me); C.publicView(S, 0);
  ok(BG.PK.id === before, "hvdc 유레카: 공개 상태가 지도 유지", `${before} -> ${BG.PK.id}`);
}

// 3. 공동 연구(연계선으로 이어진 두 도시)
{
  const { S, ids } = T.fixture({ staff: true });
  const [a, b] = ids;
  const def = R.ties.find(t => [t.a, t.b].includes(a) && [t.a, t.b].includes(b));
  S.ties.push({ a: def.a, b: def.b, cap: 2, st: "built", by: a });
  for (const [id, other] of [[a, b], [b, a]]) {
    BG.selectPack(id, "league");
    const gate = BG.SITES.find(s => s.kind === "gridpt" && (s.to || []).includes(other));
    const p = gate && BG.routePath(BG.SITES.find(s => s.dem).tile, gate.tile);
    S.teams[id].plan.lines.push({ p });
  }
  const r1 = T.special(S, a, "joint", b, "grid"), r2 = T.special(S, b, "joint", a, "grid");
  ok(r1.ok && r2.ok && S.teams[a].research.joint.grid?.active, "공동 연구 준비");
  const V = JSON.parse(JSON.stringify(C.publicView(S, 0)));
  const mine = view(a);
  C.researchReserve(V, a, BG, V.teams[a].plan);
  ok(BG.PK.id === mine, "공동 연구: 팀 기기 예약이 지도 유지", `${mine} -> ${BG.PK.id}`);
  const third = R.teams.map(t => t.id).find(id => ![a, b].includes(id));
  const pb = view(third); C.publicView(S, 0);
  ok(BG.PK.id === pb, "공동 연구: 진행자 공개 상태가 지도 유지", `${pb} -> ${BG.PK.id}`);
}

console.log(`지도 유지 checks ${pass + fail} fail ${fail}`);
process.exit(fail ? 1 : 0);
